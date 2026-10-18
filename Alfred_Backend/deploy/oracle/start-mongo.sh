#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${MONGO_REPLICA_KEY:?Missing MongoDB replica key}"
mkdir -p /run/alfred-mongo
printf '%s' "$MONGO_REPLICA_KEY" > /run/alfred-mongo/keyfile
chown mongodb:mongodb /run/alfred-mongo/keyfile
chmod 400 /run/alfred-mongo/keyfile
unset MONGO_REPLICA_KEY
exec /usr/local/bin/docker-entrypoint.sh "$@"
