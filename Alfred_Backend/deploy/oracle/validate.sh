#!/usr/bin/env bash
# Validate production Compose without production credentials or starting services.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
python3 - "$root" "$temporary/runtime" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / 'deploy/oracle'))
from config import generate
from test_config import fixture
generate(fixture(), Path(sys.argv[2]))
PY
docker compose --env-file "$temporary/runtime/deploy.env" -f "$root/compose.yaml" -f "$root/compose.production.yaml" config --quiet
# Verify the merged model without echoing environment values.
docker compose --env-file "$temporary/runtime/deploy.env" -f "$root/compose.yaml" -f "$root/compose.production.yaml" config --format json > "$temporary/compose.json"
python3 - "$temporary/compose.json" <<'PY'
import json, sys
model = json.load(open(sys.argv[1]))
api = model['services']['backend']
assert set(model['services']) == {'backend'}
assert not model.get('volumes')
assert not api.get('depends_on')
assert api['environment']['MONGODB_URI'].startswith('mongodb+srv://')
assert not api.get('build')
assert api['environment']['MODE'] == 'production'
assert api['environment']['NODE_ENV'] == 'production'
assert api['environment']['GOOGLE_CLIENT_SECRET'] == 'test-only-oauth-secret'
assert 'MONGO_ROOT_PASSWORD' not in api['environment']
assert api['ports'][0]['host_ip'] == '127.0.0.1'
print('Production Compose configuration validated with isolated fixture values.')
PY
