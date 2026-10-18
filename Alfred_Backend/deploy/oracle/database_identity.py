"""Refuse unsafe volume adoption and silent bootstrap credential rotation."""
import json
import os
from pathlib import Path
import sys

IDENTITY_KEYS = (
    "MONGO_VOLUME", "MONGO_ROOT_USERNAME", "MONGO_ROOT_PASSWORD",
    "MONGO_APP_USERNAME", "MONGO_APP_PASSWORD", "MONGO_REPLICA_KEY",
)


def ensure_identity(config, baseline: Path, populated: bool):
    identity = {key: config[key] for key in IDENTITY_KEYS}
    if baseline.exists():
        if identity != json.loads(baseline.read_text(encoding="utf-8")):
            raise ValueError("Database identity/credentials changed; plan a separate backed-up rotation or migration")
        return
    if populated:
        raise ValueError("Existing populated database is unmanaged; review authentication before deployment")
    if config.get("ALLOW_EMPTY_DATABASE") != "true":
        raise ValueError("First empty-database deployment requires OCI_ALLOW_EMPTY_DATABASE=true")
    # Record the authorized identity before init; retries keep the same credentials.
    temporary = baseline.with_suffix(".pending")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(identity, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, baseline)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        ensure_identity(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")), Path(sys.argv[2]), sys.argv[3] == "true")
    except ValueError as error:
        # Only our fixed messages are safe; JSON parsing failures get a generic one.
        print("Invalid database identity file" if isinstance(error, json.JSONDecodeError) else str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Database identity preflight failed; values suppressed", file=sys.stderr)
        sys.exit(1)
