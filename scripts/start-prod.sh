#!/usr/bin/env bash
# Start the production server (serves API + the built client on one port).
# Loads server/.env. Expects `build-prod.sh` to have run and migrations applied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/server"

if [ ! -f dist/server.js ]; then
  echo "dist/server.js not found — run ./scripts/build-prod.sh first." >&2
  exit 1
fi

export NODE_ENV="${NODE_ENV:-production}"
echo "==> Starting PRIMA-PM (NODE_ENV=$NODE_ENV)"
exec node dist/server.js
