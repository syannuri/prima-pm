#!/usr/bin/env bash
# Scheduled backup for PRIMA-PM.
# Dumps the DB (custom format, compressed) AND tars up the uploaded attachments
# (server/uploads) into backups/, prunes old files, then mirrors off-box.
# Reads DATABASE_URL from server/.env. Safe to run by hand or from cron.
#
#   Env overrides:
#     PRIMA_BACKUP_DIR        (default: <repo>/backups)
#     PRIMA_BACKUP_RETENTION  (default: 14 — number of dumps to keep)
#     PRIMA_OFFBOX_DEST       (rsync target "user@host:/path"; empty = skip off-box copy)
#     PRIMA_OFFBOX_KEY        (ssh identity for the off-box copy)
set -euo pipefail

# Where to mirror a second copy of the backups (OFF this box). Best-effort:
# if the destination is unreachable the local backup still counts as a success.
# Set PRIMA_OFFBOX_DEST="" to disable.
OFFBOX_DEST="${PRIMA_OFFBOX_DEST-mamed@192.168.1.11:/home/mamed/prima-backups}"
OFFBOX_KEY="${PRIMA_OFFBOX_KEY:-/root/.ssh/prima_backup}"

# cron has a minimal PATH; make sure pg_dump is found.
export PATH=/usr/local/bin:/usr/bin:/bin:${PATH:-}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/server/.env"
BACKUP_DIR="${PRIMA_BACKUP_DIR:-$ROOT/backups}"
RETENTION="${PRIMA_BACKUP_RETENTION:-14}"
# Where the app stores uploaded attachments (server UUID filenames). Backed up
# alongside the DB because the DB only holds metadata + the filename, not bytes.
UPLOADS_DIR="${PRIMA_UPLOADS_DIR:-$ROOT/server/uploads}"

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

# --- Uploaded attachments (best-effort, must not fail the DB backup) --------
# The DB dump above holds attachment metadata only; the actual files live in
# server/uploads. Tar them so a restore has both. A missing/empty uploads dir
# is normal (no attachments yet) — log and carry on, never fail the run.
UPLOADS_OUT="$BACKUP_DIR/prima_uploads_${TS}.tar.gz"
if [ -d "$UPLOADS_DIR" ] && [ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  if tar -czf "$UPLOADS_OUT" -C "$UPLOADS_DIR" . 2>>"$LOG"; then
    log "OK uploads $UPLOADS_OUT ($(du -h "$UPLOADS_OUT" | cut -f1); $(find "$UPLOADS_DIR" -type f | wc -l) file(s))"
  else
    log "WARN uploads: tar failed — DB backup is fine, attachment archive skipped this run"
    rm -f "$UPLOADS_OUT"
  fi
else
  log "uploads: none to archive ($UPLOADS_DIR empty or absent)"
fi

# Rotation: keep the newest $RETENTION of each artifact, delete the rest.
for pat in 'prima_pm_*.dump' 'prima_uploads_*.tar.gz'; do
  while IFS= read -r f; do
    rm -f "$f" && log "pruned $f"
  done < <(ls -1t "$BACKUP_DIR"/$pat 2>/dev/null | tail -n +"$((RETENTION + 1))")
done

log "done; $(ls -1 "$BACKUP_DIR"/prima_pm_*.dump 2>/dev/null | wc -l) DB + $(ls -1 "$BACKUP_DIR"/prima_uploads_*.tar.gz 2>/dev/null | wc -l) uploads backup(s) retained in $BACKUP_DIR"

# --- Off-box copy (best-effort) -------------------------------------------
# Mirror the backups dir to another machine over SSH so a disk/host failure
# here doesn't lose every copy. Failures here MUST NOT fail the backup, so the
# whole block is guarded and never propagates a non-zero exit.
if [ -n "$OFFBOX_DEST" ]; then
  if [ ! -r "$OFFBOX_KEY" ]; then
    log "WARN off-box: ssh key $OFFBOX_KEY not readable; skipping off-box copy"
  else
    log "off-box: mirroring -> $OFFBOX_DEST"
    SSH_CMD="ssh -i $OFFBOX_KEY -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
    # --delete keeps the remote in lockstep with local retention (same 14 dumps).
    if rsync -az --delete --timeout=60 -e "$SSH_CMD" \
         --include='prima_pm_*.dump' --include='prima_uploads_*.tar.gz' \
         --include='backup.log' --exclude='*' \
         "$BACKUP_DIR"/ "$OFFBOX_DEST"/ >>"$LOG" 2>&1; then
      log "off-box: OK -> $OFFBOX_DEST"
    else
      rc=$?
      log "WARN off-box: rsync failed (exit $rc) — local backup is fine, off-box copy skipped this run"
    fi
  fi
fi
