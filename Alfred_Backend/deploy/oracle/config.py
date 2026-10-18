"""Generate protected runtime files. Never print values or exception contents."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlsplit

SECRETS = (
    "JWT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "LLM_API_KEY",
    "MONGO_ROOT_USERNAME", "MONGO_ROOT_PASSWORD", "MONGO_APP_USERNAME",
    "MONGO_APP_PASSWORD", "MONGO_REPLICA_KEY",
)
DEPLOY = ("BACKEND_IMAGE", "MONGO_IMAGE", "TARGET_PLATFORM", "MONGO_VOLUME", "PUBLIC_HEALTH_URL", "ALLOW_EMPTY_DATABASE")
PUBLIC = ("FRONTEND_URL", "ALLOWED_ORIGINS", "GOOGLE_CALLBACK_URL")
OPTIONAL = {
    "STORAGE_QUOTA_BYTES": "10000000", "AI_DAILY_REQUESTS": "50", "AI_MONTHLY_REQUESTS": "1000",
    "RATE_LIMIT_GUEST_WINDOW_MS": "900000", "RATE_LIMIT_GUEST_MAX": "10",
    "RATE_LIMIT_AUTH_WINDOW_MS": "900000", "RATE_LIMIT_AUTH_MAX": "30",
    "RATE_LIMIT_API_WINDOW_MS": "60000", "RATE_LIMIT_API_MAX": "120",
    "RATE_LIMIT_AI_WINDOW_MS": "60000", "RATE_LIMIT_AI_MAX": "20",
    "LLM_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "LLM_MODEL": "gemini-3.5-flash-lite", "LLM_FALLBACK_MODELS": "gemini-3.1-flash-lite",
    "LLM_SITE_NAME": "Alfred", "LLM_MAX_OUTPUT_TOKENS": "1024", "LLM_TIMEOUT_MS": "60000",
    "LLM_SITE_URL": "", "JWT_LEGACY_ACCEPT_UNTIL": "",
}


class ConfigurationError(Exception):
    pass


def require(condition, field):
    if not condition:
        raise ConfigurationError(f"Missing or invalid configuration: {field}")


def https_url(value, field):
    try:
        url = urlsplit(value)
        require(url.scheme == "https" and url.hostname and not url.username and not url.password
                and not url.query and not url.fragment and url.hostname not in ("localhost", "127.0.0.1", "::1"), field)
        return url
    except ValueError:
        raise ConfigurationError(f"Invalid URL: {field}") from None


def validate(config):
    require(isinstance(config, dict), "configuration object")
    require(not (set(config) - set(SECRETS + DEPLOY + PUBLIC) - set(OPTIONAL)), "unknown setting")
    for field in SECRETS + DEPLOY + PUBLIC:
        require(isinstance(config.get(field), str) and config[field].strip(), field)
    for field, value in config.items():
        require(isinstance(value, str) and not any(c in value for c in "\r\n\x00"), field)
    require(len(config["JWT_SECRET"]) >= 32, "JWT_SECRET")
    for field in ("MONGO_ROOT_PASSWORD", "MONGO_APP_PASSWORD"):
        require(len(config[field]) >= 20, field)
    for field in ("MONGO_ROOT_USERNAME", "MONGO_APP_USERNAME"):
        require(re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,62}", config[field]), field)
    require(config["MONGO_ROOT_USERNAME"] != config["MONGO_APP_USERNAME"], "distinct MongoDB users")
    require(re.fullmatch(r"[A-Za-z0-9+/=]{6,1024}", config["MONGO_REPLICA_KEY"]), "MONGO_REPLICA_KEY")
    require(config["TARGET_PLATFORM"] in ("linux/amd64", "linux/arm64"), "TARGET_PLATFORM")
    require(config["ALLOW_EMPTY_DATABASE"] in ("true", "false"), "ALLOW_EMPTY_DATABASE")
    require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", config["MONGO_VOLUME"]), "MONGO_VOLUME")
    for field in ("BACKEND_IMAGE", "MONGO_IMAGE"):
        require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_./:@-]+", config[field]), field)
    frontend = https_url(config["FRONTEND_URL"], "FRONTEND_URL")
    require(frontend.path in ("", "/"), "FRONTEND_URL origin")
    callback = https_url(config["GOOGLE_CALLBACK_URL"], "GOOGLE_CALLBACK_URL")
    require(callback.path == "/auth/google/callback", "GOOGLE_CALLBACK_URL path")
    readiness = https_url(config["PUBLIC_HEALTH_URL"], "PUBLIC_HEALTH_URL")
    require(readiness.netloc == callback.netloc and readiness.path == "/ready", "PUBLIC_HEALTH_URL origin/path")
    origins = [value.strip() for value in config["ALLOWED_ORIGINS"].split(",")]
    require(all(origins), "ALLOWED_ORIGINS")
    for origin in origins:
        if origin in ("http://tauri.localhost", "https://tauri.localhost"):
            continue
        parsed = https_url(origin, "ALLOWED_ORIGINS")
        require(parsed.path == "", "ALLOWED_ORIGINS exact origins")
    for field, default in OPTIONAL.items():
        value = config.get(field, default)
        if field.startswith("RATE_LIMIT_") or field in (
            "STORAGE_QUOTA_BYTES", "AI_DAILY_REQUESTS", "AI_MONTHLY_REQUESTS", "LLM_MAX_OUTPUT_TOKENS", "LLM_TIMEOUT_MS"
        ):
            require(re.fullmatch(r"[1-9][0-9]*", value) and int(value) <= 9007199254740991, field)
        config[field] = value
    https_url(config["LLM_BASE_URL"], "LLM_BASE_URL")
    config["LLM_SITE_URL"] = config["LLM_SITE_URL"] or config["FRONTEND_URL"]
    https_url(config["LLM_SITE_URL"], "LLM_SITE_URL")
    if config["JWT_LEGACY_ACCEPT_UNTIL"]:
        from datetime import datetime, timezone, timedelta
        try:
            deadline = datetime.fromisoformat(config["JWT_LEGACY_ACCEPT_UNTIL"].replace("Z", "+00:00"))
            require(config["JWT_LEGACY_ACCEPT_UNTIL"].endswith("Z") and deadline <= datetime.now(timezone.utc) + timedelta(days=7), "JWT_LEGACY_ACCEPT_UNTIL")
        except (ValueError, TypeError):
            raise ConfigurationError("Invalid JWT_LEGACY_ACCEPT_UNTIL") from None
    return config


def protected_write(path, text):
    # All parent directories are private too. Files are never opened permissively.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as target:
        target.write(text)
    if os.name != "nt":
        os.chmod(path, 0o600)


def generate(config, directory):
    config = validate(dict(config))
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        os.chmod(directory, 0o700)
    backend = {key: config[key] for key in ("JWT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "LLM_API_KEY") + PUBLIC}
    backend.update({key: config[key] for key in OPTIONAL if config[key]})
    backend.update(MODE="production", NODE_ENV="production", PORT="8000")
    backend["MONGODB_URI"] = (
        f"mongodb://{quote(config['MONGO_APP_USERNAME'], safe='')}:{quote(config['MONGO_APP_PASSWORD'], safe='')}"
        "@mongo:27017/alfred?authSource=alfred&replicaSet=alfred"
    )
    mongo = {
        "MONGO_ROOT_USERNAME": config["MONGO_ROOT_USERNAME"],
        "MONGO_ROOT_PASSWORD": config["MONGO_ROOT_PASSWORD"],
        **{key: config[key] for key in ("MONGO_APP_USERNAME", "MONGO_APP_PASSWORD", "MONGO_REPLICA_KEY")},
    }
    for filename, values in (("backend.env", backend), ("mongo.env", mongo)):
        protected_write(directory / filename, "".join(f"{key}={value}\n" for key, value in values.items()))
    # Only non-secret, validated paths/image names go into Compose interpolation.
    require(not re.search(r"[\s$#'\"]", str(directory)), "runtime directory path")
    deploy = {
        "ALFRED_RUNTIME_DIR": str(directory).replace("\\", "/"),
        "ALFRED_BACKEND_IMAGE": config["BACKEND_IMAGE"], "ALFRED_MONGO_IMAGE": config["MONGO_IMAGE"],
        "ALFRED_PLATFORM": config["TARGET_PLATFORM"], "ALFRED_MONGO_VOLUME": config["MONGO_VOLUME"],
    }
    protected_write(directory / "deploy.env", "".join(f"{key}={value}\n" for key, value in deploy.items()))
    protected_write(directory / "config.json", json.dumps(config))


def from_environment():
    config = {key: os.environ.get(key, "") for key in SECRETS + DEPLOY + PUBLIC}
    try:
        settings = json.loads(os.environ.get("ALFRED_SETTINGS_JSON", "{}") or "{}")
    except ValueError:
        raise ConfigurationError("Invalid ALFRED_SETTINGS_JSON") from None
    require(isinstance(settings, dict) and not (set(settings) - set(OPTIONAL)), "ALFRED_SETTINGS_JSON keys")
    return {**config, **settings}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        source = json.loads(args.input.read_text(encoding="utf-8")) if args.input else from_environment()
        generate(source, args.directory)
    except ConfigurationError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Runtime configuration generation failed; values suppressed", file=sys.stderr)
        sys.exit(1)
