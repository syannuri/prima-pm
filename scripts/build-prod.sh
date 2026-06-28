#!/usr/bin/env bash
# Build PRIMA-PM for production: client static bundle + compiled server.
# Run from anywhere; paths are resolved relative to the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing dependencies"
npm --prefix server install
npm --prefix client install

echo "==> Building client (Vite → client/dist)"
npm --prefix client run build

echo "==> Building server (Prisma generate + tsc → server/dist)"
npm --prefix server run build

echo "==> Done. Next:"
echo "    1) Set server/.env (DATABASE_URL, JWT secrets, NODE_ENV=production, PORT)"
echo "    2) npm --prefix server run migrate:deploy   # apply migrations"
echo "    3) npm --prefix server run db:seed          # first deploy only (optional)"
echo "    4) ./scripts/start-prod.sh                  # or use the systemd unit"
