#!/usr/bin/env bash
# Build PRIMA-PM for production: client static bundle + compiled server.
# Run from anywhere; paths are resolved relative to the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing dependencies"
# `npm ci` (not install): a clean, deterministic install straight from package-lock.json that
# NEVER rewrites the lockfile — so a deploy checkout stays clean and `git pull` won't abort on
# "local changes to package-lock.json". Requires the lockfile to be in sync with package.json
# (it is; both are committed together). Falls back to `npm install` if no lockfile is present.
[ -f server/package-lock.json ] && npm --prefix server ci || npm --prefix server install
[ -f client/package-lock.json ] && npm --prefix client ci || npm --prefix client install

echo "==> Building client (Vite → client/dist)"
# Same-origin production build: the browser calls the serving Express origin. Default to a
# relative API path so a fresh VPS build (which has no client/.env — it's gitignored) does
# NOT bake in the localhost fallback. Override by exporting VITE_API_URL for split-origin.
VITE_API_URL="${VITE_API_URL:-/api/v1}" npm --prefix client run build

echo "==> Building server (Prisma generate + tsc → server/dist)"
npm --prefix server run build

echo "==> Done. Next:"
echo "    1) Set server/.env (DATABASE_URL, JWT secrets, NODE_ENV=production, PORT)"
echo "    2) npm --prefix server run migrate:deploy   # apply migrations"
echo "    3) npm --prefix server run db:seed          # first deploy only (optional)"
echo "    4) ./scripts/start-prod.sh                  # or use the systemd unit"
