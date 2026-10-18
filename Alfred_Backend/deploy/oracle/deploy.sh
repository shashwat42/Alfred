#!/usr/bin/env bash
# Invoked over verified SSH by a protected main-branch workflow. JSON arrives on stdin.
set -euo pipefail
umask 077
export COMPOSE_ANSI=never
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
  x86_64) platform=linux/amd64; grep -qw avx /proc/cpuinfo || { echo 'MongoDB requires AVX.' >&2; exit 1; } ;;
  aarch64) platform=linux/arm64; grep -qE '^Features.* (fphp|dcpop|sha3|sm3|sm4|asimddp|sha512|sve)( |$)' /proc/cpuinfo || { echo 'MongoDB requires ARMv8.2-A or newer.' >&2; exit 1; } ;;
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
if config['BACKEND_IMAGE'] != metadata['backendImage'] or config['MONGO_IMAGE'] != metadata['mongoImage']:
    sys.exit('Image configuration does not match artifacts')
PY
release_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$stage/metadata.json")
release="$base/releases/$release_id"
[[ ! -e $release ]] || { echo 'Release directory already exists; use a fresh workflow attempt.' >&2; exit 1; }
install -d -m 700 "$release" "$release/docker"
cp "$stage/compose.yaml" "$stage/compose.production.yaml" "$release/"
cp -R "$stage/deploy" "$release/deploy"
cp "$stage/docker/init-replica.js" "$release/docker/"
cp "$stage/metadata.json" "$release/metadata.json"
python3 "$release/deploy/oracle/config.py" --input "$incoming/config.json" --directory "$release/runtime"
compose=(docker compose --project-name alfred --env-file "$release/runtime/deploy.env" -f "$release/compose.yaml" -f "$release/compose.production.yaml")
# Quiet mode is essential: expanded Compose output contains credentials.
"${compose[@]}" config --quiet

cd "$stage"
sha256sum --check --status images.sha256 || { echo 'Image archive checksum mismatch.' >&2; exit 1; }
gzip -dc images.tar.gz | docker image load --quiet >/dev/null
python3 - "$stage/metadata.json" <<'PY'
import json, subprocess, sys
metadata = json.load(open(sys.argv[1]))
for kind in ('backend', 'mongo'):
    image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', metadata[kind + 'Image']]))[0]
    if image['Id'] != metadata[kind + 'Id'] or f"{image['Os']}/{image['Architecture']}" != metadata['platform']:
        sys.exit('Loaded image identity/architecture mismatch')
PY
volume=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["MONGO_VOLUME"])' "$release/runtime/config.json")
# Never create a replacement volume when its name is missing or mistyped.
docker volume inspect "$volume" >/dev/null || { echo 'Explicit MongoDB volume must already exist.' >&2; exit 1; }
[[ $(docker volume inspect -f '{{.Driver}}' "$volume") == local ]] || { echo 'Only local named volumes are supported.' >&2; exit 1; }
mountpoint=$(docker volume inspect -f '{{.Mountpoint}}' "$volume")
[[ -d $mountpoint ]] || { echo 'Cannot inspect MongoDB storage safely.' >&2; exit 1; }
populated=false
if [[ -n $(find "$mountpoint" -mindepth 1 -maxdepth 1 -print -quit) ]]; then populated=true; fi
python3 "$release/deploy/oracle/database_identity.py" "$release/runtime/config.json" "$base/database-config.json" "$populated"
# Reject other Compose projects sharing the selected database volume.
python3 - "$volume" <<'PY'
import json, subprocess, sys
ids = subprocess.check_output(['docker', 'ps', '-aq', '--filter', 'volume=' + sys.argv[1]]).decode().split()
if ids:
    for container in json.loads(subprocess.check_output(['docker', 'inspect', *ids])):
        if container['Config'].get('Labels', {}).get('com.docker.compose.project') != 'alfred':
            sys.exit('MongoDB volume is used by another project; refusing deployment')
PY
# Immutable release directories retain previous configurations as protected backups.
# No down, volume removal, schema migration, rs.reconfig or credential update occurs.
"${compose[@]}" up -d --no-build --pull never mongo
"${compose[@]}" up -d --no-build --pull never --force-recreate mongo-init
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
