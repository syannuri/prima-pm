#!/usr/bin/env bash
# One-command production update for Prismatix on a VPS.
#
# Pulls the latest master, rebuilds client + server, applies any new DB migrations,
# fixes file ownership, restarts the service, and health-checks it — with AUTOMATIC
# ROLLBACK to the previous commit if the new build fails to come up healthy.
#
# Run ON THE VPS as root (the checkout is root-owned; systemctl needs root):
#   sudo ./scripts/update-prod.sh
#
# Overridable via env: PRIMA_SERVICE, PRIMA_HEALTH_URL, PRIMA_BRANCH.
#
# NOTE: rollback reverts CODE only, not DB migrations (migrate deploy is forward-only).
# A code-only update — the common case — rolls back cleanly. If a failed update added a
# migration, the schema stays ahead; older code usually tolerates extra columns, but verify.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE="${PRIMA_SERVICE:-prima-pm}"
HEALTH_URL="${PRIMA_HEALTH_URL:-http://127.0.0.1:4000/}"
BRANCH="${PRIMA_BRANCH:-master}"

[ "$(id -u)" = 0 ] || { echo "Run as root:  sudo ./scripts/update-prod.sh" >&2; exit 1; }

# Poll the service until it answers 200 (up to ~30s; it's briefly unbound mid-restart).
wait_healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)" = "200" ] && return 0
    sleep 1
  done
  return 1
}

# Build → migrate → fix ownership → restart. Reused for both deploy and rollback.
deploy() {
  echo "==> Building (client + server)"
  ./scripts/build-prod.sh
  echo "==> Applying migrations (no-op if none pending)"
  ( set -a; . ./server/.env; set +a; npm --prefix server run migrate:deploy )
  echo "==> Fixing ownership (.env + uploads)"
  [ -d server/uploads ] && chown -R prima:prima server/uploads || true
  if [ -f server/.env ]; then chown root:prima server/.env && chmod 640 server/.env; fi
  echo "==> Restarting $SERVICE"
  systemctl restart "$SERVICE"
}

PREV="$(git rev-parse HEAD)"
echo "==> Current commit: $PREV"
# A past build-prod.sh ran `npm install`, which can rewrite package-lock.json and leave the
# deploy tree dirty enough to abort `git pull`. That drift is never intentional here, so discard
# it before pulling. (build-prod.sh now uses `npm ci`, so new runs won't dirty the tree.)
git checkout -- server/package-lock.json client/package-lock.json 2>/dev/null || true
echo "==> Pulling origin/$BRANCH"
git pull --ff-only origin "$BRANCH"
NEW="$(git rev-parse HEAD)"

if [ "$PREV" = "$NEW" ]; then
  echo "==> Already up to date ($NEW) — nothing to build."
  exit 0
fi

echo "==> Updating $PREV -> $NEW:"
git --no-pager log --oneline "$PREV..$NEW" | sed 's/^/      /'

deploy

echo "==> Health check ($HEALTH_URL)"
if wait_healthy; then
  echo "✅  Update OK — $SERVICE healthy at $NEW"
  exit 0
fi

echo "❌  New build is unhealthy — rolling back to $PREV" >&2
git reset --hard "$PREV"
deploy
if wait_healthy; then
  echo "↩️   Rolled back to $PREV; service healthy again. Investigate the failed update." >&2
  exit 1
fi
echo "🔥  Rollback is ALSO unhealthy. Inspect:  journalctl -u $SERVICE -n 50" >&2
exit 2
