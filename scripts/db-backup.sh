#!/usr/bin/env bash
# Scheduled PostgreSQL backup for PRIMA-PM.
# Dumps the DB (custom format, compressed) to backups/ and prunes old files.
# Reads DATABASE_URL from server/.env. Safe to run by hand or from cron.
#
#   Env overrides:
#     PRIMA_BACKUP_DIR        (default: <repo>/backups)
#     PRIMA_BACKUP_RETENTION  (default: 14 — number of dumps to keep)
set -euo pipefail

# cron has a minimal PATH; make sure pg_dump is found.
export PATH=/usr/local/bin:/usr/bin:/bin:${PATH:-}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/server/.env"
BACKUP_DIR="${PRIMA_BACKUP_DIR:-$ROOT/backups}"
RETENTION="${PRIMA_BACKUP_RETENTION:-14}"

mkdir -p "$BACKUP_DIR"
LOG="$BACKUP_DIR/backup.log"
log() { echo "$(date -Is) $*" | tee -a "$LOG"; }

# Extract DATABASE_URL and strip the Prisma-only ?schema= query (libpq rejects it).
DBURL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
DBURL="${DBURL%%\?*}"
if [ -z "$DBURL" ]; then log "ERROR: DATABASE_URL not found in $ENV_FILE"; exit 1; fi

TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/prima_pm_${TS}.dump"

log "starting backup -> $OUT"
if pg_dump -Fc --no-owner --no-privileges -f "$OUT" "$DBURL"; then
  if [ -s "$OUT" ]; then
    log "OK $OUT ($(du -h "$OUT" | cut -f1))"
  else
    log "ERROR: dump is empty, removing"; rm -f "$OUT"; exit 1
  fi
else
  rc=$?; log "ERROR: pg_dump failed (exit $rc)"; rm -f "$OUT"; exit "$rc"
fi

# Rotation: keep the newest $RETENTION dumps, delete the rest.
while IFS= read -r f; do
  rm -f "$f" && log "pruned $f"
done < <(ls -1t "$BACKUP_DIR"/prima_pm_*.dump 2>/dev/null | tail -n +"$((RETENTION + 1))")

log "done; $(ls -1 "$BACKUP_DIR"/prima_pm_*.dump 2>/dev/null | wc -l) backup(s) retained in $BACKUP_DIR"
