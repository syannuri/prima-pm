#!/usr/bin/env bash
# Restore a PRIMA-PM backup produced by db-backup.sh.
# Usage: ./scripts/db-restore.sh <path-to.dump>   (defaults to the newest dump)
#
# WARNING: --clean drops and recreates objects in the target DB. The app should
# be stopped first:  systemctl stop prima-pm
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:${PATH:-}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/server/.env"
BACKUP_DIR="${PRIMA_BACKUP_DIR:-$ROOT/backups}"

FILE="${1:-$(ls -1t "$BACKUP_DIR"/prima_pm_*.dump 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Backup file not found: ${FILE:-<none>}"; exit 1; }

DBURL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
DBURL="${DBURL%%\?*}"

echo "About to restore $FILE into $DBURL"
echo "This DROPS and recreates existing objects. Ctrl-C within 5s to abort."
sleep 5
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DBURL" "$FILE"
echo "Restore complete."
