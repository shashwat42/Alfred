"""Generate protected runtime files. Never print values or exception contents."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlsplit
from ipaddress import ip_address

SECRETS = (
    "JWT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "LLM_API_KEY",
    "MONGODB_URI",
)
OPTIONAL_SECRETS = ("FCM_SERVICE_ACCOUNT_BASE64",)
DEPLOY = ("BACKEND_IMAGE", "TARGET_PLATFORM", "PUBLIC_HEALTH_URL")
PUBLIC = ("FRONTEND_URL", "ALLOWED_ORIGINS", "GOOGLE_CALLBACK_URL")
OPTIONAL = {
    "FCM_PROJECT_ID": "",
    "STORAGE_QUOTA_BYTES": "10000000", "AI_DAILY_REQUESTS": "50", "AI_MONTHLY_REQUESTS": "1000",
    "RATE_LIMIT_GUEST_WINDOW_MS": "900000", "RATE_LIMIT_GUEST_MAX": "10",
    "RATE_LIMIT_AUTH_WINDOW_MS": "900000", "RATE_LIMIT_AUTH_MAX": "30",
    "RATE_LIMIT_API_WINDOW_MS": "60000", "RATE_LIMIT_API_MAX": "120",
    "RATE_LIMIT_AI_WINDOW_MS": "60000", "RATE_LIMIT_AI_MAX": "20",
    "LLM_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "LLM_MODEL": "gemini-3.5-flash-lite", "LLM_FALLBACK_MODELS": "gemini-3.1-flash-lite",
    "LLM_SITE_NAME": "Alfred", "LLM_MAX_OUTPUT_TOKENS": "1024", "LLM_TIMEOUT_MS": "60000",
    "LLM_SITE_URL": "", "JWT_LEGACY_ACCEPT_UNTIL": "", "MONGODB_DNS_SERVERS": "",
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
    require(not (set(config) - set(SECRETS + OPTIONAL_SECRETS + DEPLOY + PUBLIC) - set(OPTIONAL)), "unknown setting")
    for field in SECRETS + DEPLOY + PUBLIC:
        require(isinstance(config.get(field), str) and config[field].strip(), field)
    for field, value in config.items():
        require(isinstance(value, str) and not any(c in value for c in "\r\n\x00"), field)
    require(len(config["JWT_SECRET"]) >= 32, "JWT_SECRET")
    try:
        uri = urlsplit(config["MONGODB_URI"])
        require(uri.scheme == "mongodb+srv" and uri.hostname and uri.hostname.endswith(".mongodb.net")
                and uri.username and uri.password and uri.path == "/alfred" and not uri.fragment
                and uri.port is None and not any(c in config["MONGODB_URI"] for c in "<>"), "MONGODB_URI")
        options = {key.lower(): value for key, value in parse_qs(uri.query, keep_blank_values=True).items()}
        require(options.get("authsource", ["admin"]) == ["admin"], "MONGODB_URI authSource")
        for option in ("tls", "ssl"):
            require(option not in options or options[option] == ["true"], "MONGODB_URI TLS")
        for option in ("tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"):
            require(option not in options or options[option] == ["false"], "MONGODB_URI TLS validation")
    except ValueError:
        raise ConfigurationError("Invalid MONGODB_URI") from None
    require(config["TARGET_PLATFORM"] in ("linux/amd64", "linux/arm64"), "TARGET_PLATFORM")
    require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_./:@-]+", config["BACKEND_IMAGE"]), "BACKEND_IMAGE")
    dns_servers = config.get("MONGODB_DNS_SERVERS", "")
    if dns_servers:
        try:
            for server in dns_servers.split(","):
                ip_address(server.strip())
        except ValueError:
            raise ConfigurationError("Invalid MONGODB_DNS_SERVERS") from None
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
    push_key = config.get("FCM_SERVICE_ACCOUNT_BASE64", "")
    require(bool(push_key) == bool(config["FCM_PROJECT_ID"]), "FCM configuration pair")
    if push_key:
        try:
            credential = json.loads(base64.b64decode(push_key, validate=True))
            require(isinstance(credential, dict) and credential.get("type") == "service_account" and credential.get("project_id") == config["FCM_PROJECT_ID"]
                    and isinstance(credential.get("private_key"), str) and isinstance(credential.get("client_email"), str), "FCM credential")
        except (ValueError, TypeError):
            raise ConfigurationError("Invalid FCM credential") from None
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
    backend = {key: config[key] for key in SECRETS + PUBLIC}
    backend.update({key: config[key] for key in OPTIONAL_SECRETS if config.get(key)})
    backend.update({key: config[key] for key in OPTIONAL if config[key]})
    backend.update(MODE="production", NODE_ENV="production", PORT="8000")
    protected_write(directory / "backend.env", "".join(f"{key}={value}\n" for key, value in backend.items()))
    # Only non-secret, validated paths/image names go into Compose interpolation.
    require(not re.search(r"[\s$#'\"]", str(directory)), "runtime directory path")
    deploy = {
        "ALFRED_RUNTIME_DIR": str(directory).replace("\\", "/"),
        "ALFRED_BACKEND_IMAGE": config["BACKEND_IMAGE"],
        "ALFRED_PLATFORM": config["TARGET_PLATFORM"],
    }
    protected_write(directory / "deploy.env", "".join(f"{key}={value}\n" for key, value in deploy.items()))
    protected_write(directory / "config.json", json.dumps(config))


def from_environment():
    config = {key: os.environ.get(key, "") for key in SECRETS + OPTIONAL_SECRETS + DEPLOY + PUBLIC}
    config.update({"FCM_PROJECT_ID": os.environ.get("FCM_PROJECT_ID", "")})
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
