#!/usr/bin/env bash
# Invoked over verified SSH by a protected main-branch workflow. JSON arrives on stdin.
set -euo pipefail
umask 077
export COMPOSE_ANSI=never
# Root must not leave bytecode caches in the SSH user's temporary upload tree.
export PYTHONDONTWRITEBYTECODE=1
[[ $(id -u) == 0 ]] || { echo 'Deployment requires root via sudo.' >&2; exit 1; }
stage=${1:?Missing artifact directory}
[[ $stage =~ ^/tmp/alfred-deploy\.[a-zA-Z0-9]+$ ]] || { echo 'Invalid staging directory.' >&2; exit 1; }
base=/opt/alfred
install -d -m 700 "$base" "$base/releases" "$base/incoming"
exec 9>/run/lock/alfred-deploy.lock
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 1; }
incoming=$(mktemp -d "$base/incoming/config.XXXXXXXX")
cleanup() { rm -rf -- "$incoming"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cat > "$incoming/config.json"
[[ -s $incoming/config.json ]] || { echo 'Missing runtime configuration.' >&2; exit 1; }

command -v python3 >/dev/null
command -v curl >/dev/null
docker info >/dev/null
python3 - "$(docker compose version --short)" <<'PY'
import re, sys
version = re.match(r"v?(\d+)\.(\d+)", sys.argv[1])
if not version or tuple(map(int, version.groups())) < (2, 30):
    sys.exit("Docker Compose >= 2.30 is required")
PY
platform=$(uname -m)
case "$platform" in
  x86_64) platform=linux/amd64 ;;
  aarch64) platform=linux/arm64 ;;
  *) echo 'Unsupported VM architecture.' >&2; exit 1 ;;
esac
python3 - "$stage/metadata.json" "$incoming/config.json" "$platform" <<'PY'
import json, re, sys
metadata = json.load(open(sys.argv[1]))
config = json.load(open(sys.argv[2]))
if metadata['platform'] != sys.argv[3] or config['TARGET_PLATFORM'] != sys.argv[3]:
    sys.exit('Image/VM architecture mismatch')
if not re.fullmatch(r'[0-9a-f]{40}-[0-9]+-[0-9]+', metadata['release']):
    sys.exit('Invalid release identity')
if config['BACKEND_IMAGE'] != metadata['backendImage']:
    sys.exit('Image configuration does not match artifacts')
PY
release_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$stage/metadata.json")
release="$base/releases/$release_id"
[[ ! -e $release ]] || { echo 'Release directory already exists; use a fresh workflow attempt.' >&2; exit 1; }
install -d -m 700 "$release"
cp "$stage/compose.yaml" "$stage/compose.production.yaml" "$release/"
cp -R "$stage/deploy" "$release/deploy"
cp "$stage/metadata.json" "$release/metadata.json"
python3 "$release/deploy/oracle/config.py" --input "$incoming/config.json" --directory "$release/runtime"
compose=(docker compose --project-name alfred --env-file "$release/runtime/deploy.env" -f "$release/compose.yaml" -f "$release/compose.production.yaml")
# Quiet mode is essential: expanded Compose output contains credentials.
"${compose[@]}" config --quiet

cd "$stage"
sha256sum --check --status images.sha256 || { echo 'Image archive checksum mismatch.' >&2; exit 1; }
gzip -dc images.tar.gz | docker image load --quiet >/dev/null
python3 - "$stage/metadata.json" <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]).parent / 'deploy/oracle'))
from image_identity import loaded_identity
metadata = json.load(open(sys.argv[1]))
identity = loaded_identity(metadata['backendImage'])
if identity['configDigest'] != metadata['backendConfigDigest'] or identity['platform'] != metadata['platform']:
    sys.exit('Loaded image identity/architecture mismatch')
PY
# An existing self-hosted deployment needs an explicit migration; do not touch it.
if [[ -e $base/database-config.json ]] || [[ -n $(docker ps -aq --filter label=com.docker.compose.project=alfred --filter label=com.docker.compose.service=mongo) ]]; then
  echo 'Existing local MongoDB deployment detected. Migrate it to Atlas explicitly before this deployment.' >&2
  exit 1
fi
# Atlas storage is external. No MongoDB containers, volumes or data deletion.
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 180 backend
python3 - <<'PY'
import json, urllib.request
with urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=5) as response:
    body = json.load(response)
if body.get('status') != 'ok' or body.get('mode') != 'production':
    raise SystemExit('Production API readiness verification failed')
PY
public_health=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["PUBLIC_HEALTH_URL"])' "$release/runtime/config.json")
# Do not print response bodies, query strings, or expanded configuration.
curl --proto '=https' --proto-redir '=https' --fail --silent --output "$incoming/public-ready.json" --max-time 20 --retry 3 "$public_health"
python3 - "$incoming/public-ready.json" <<'PY'
import json, sys
try:
    body = json.load(open(sys.argv[1]))
    if body.get('status') != 'ok' or body.get('mode') != 'production':
        raise ValueError()
except Exception:
    sys.exit('Public HTTPS API readiness verification failed')
PY
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
echo 'Deployment succeeded: containers healthy and local/public API ready.'
