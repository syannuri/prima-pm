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
# Overridable via env: PRIMA_SERVICE, PRIMA_HEALTH_URL, PRIMA_HEALTH_RETRIES, PRIMA_BRANCH.
#
# NOTE: rollback reverts CODE only, not DB migrations (migrate deploy is forward-only).
# A code-only update — the common case — rolls back cleanly. If a failed update added a
# migration, the schema stays ahead; older code usually tolerates extra columns, but verify.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE="${PRIMA_SERVICE:-prima-pm}"
# Health-check the lightweight /health endpoint (returns instantly the moment Express binds) rather
# than "/" (which serves the SPA index). On a small / swapless box the process can cold-start slowly
# right after a heavy build, and a too-tight window would false-negative and trigger a needless
# rollback of a perfectly healthy build. See docs — overridable via env.
HEALTH_URL="${PRIMA_HEALTH_URL:-http://127.0.0.1:4000/health}"
HEALTH_RETRIES="${PRIMA_HEALTH_RETRIES:-90}"   # ~90s: generous for a cold start under build memory pressure
BRANCH="${PRIMA_BRANCH:-master}"

[ "$(id -u)" = 0 ] || { echo "Run as root:  sudo ./scripts/update-prod.sh" >&2; exit 1; }

# Poll the service until it answers 200 (it's briefly unbound mid-restart, and can be slow to warm
# up on a memory-pressured box just after building). A short settle first, then up to HEALTH_RETRIES
# one-second polls.
wait_healthy() {
  sleep 3
  for _ in $(seq 1 "$HEALTH_RETRIES"); do
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
# Hard-sync to the remote tip instead of `git pull`. A plain pull can ABORT (incidental tree drift —
# a package-lock rewrite, a half-written file from an aborted run) or silently land a commit behind,
# which is the #1 cause of "I ran update-prod.sh but /version didn't change". This deploy checkout is
# never hand-edited, so fetch + reset --hard puts it at exactly origin/$BRANCH every single time.
echo "==> Fetching origin/$BRANCH"
git fetch --prune origin "$BRANCH"
echo "==> Hard-syncing to origin/$BRANCH"
git reset --hard "origin/$BRANCH"
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
