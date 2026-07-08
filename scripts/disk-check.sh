#!/usr/bin/env bash
# =====================================================================
# Disk-usage monitor for the Prismatix box.
#
# Alerts (syslog + a log file) when the root filesystem crosses a
# threshold. Meant to run from cron every ~30 min. It is READ-ONLY — it
# never deletes anything (background: on 2026-07-08 the disk hit 100% and
# crash-looped PostgreSQL; the disk was later grown 12G->23G).
#
# View alerts:
#   journalctl -t prima-disk            # syslog channel
#   tail -f /home/mamed/prima-pm/backups/disk-alert.log
#
# Tunables (env):  DISK_WARN=80  DISK_CRIT=90  DISK_MOUNT=/  DISK_LOG=...
# =====================================================================
set -uo pipefail

WARN="${DISK_WARN:-80}"
CRIT="${DISK_CRIT:-90}"
MOUNT="${DISK_MOUNT:-/}"
LOG="${DISK_LOG:-/home/mamed/prima-pm/backups/disk-alert.log}"

# Current usage % (integer) + human-readable free/size for the mount.
use=$(df --output=pcent "$MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')
avail=$(df -h --output=avail "$MOUNT" 2>/dev/null | tail -1 | tr -d ' ')
size=$(df -h --output=size "$MOUNT" 2>/dev/null | tail -1 | tr -d ' ')
[ -z "$use" ] && exit 0

# Pick a severity; stay silent below the warning threshold.
if   [ "$use" -ge "$CRIT" ]; then level="CRITICAL"; prio="user.crit"
elif [ "$use" -ge "$WARN" ]; then level="WARNING";  prio="user.warning"
else exit 0
fi

ts=$(date '+%Y-%m-%d %H:%M:%S %Z')

# 1) syslog / journald.
logger -t prima-disk -p "$prio" "$level: ${MOUNT} ${use}% used, ${avail} free of ${size}"

# 2) Append to the alert log (+ the biggest space users, for quick diagnosis).
#    The log lives under backups/, so it also rides the nightly off-box rsync.
mkdir -p "$(dirname "$LOG")"
{
  echo "[$ts] $level: root ($MOUNT) at ${use}% used — ${avail} free of ${size} (warn=${WARN}% crit=${CRIT}%)"
  echo "  top space users:"
  du -shx \
    /home/mamed/prima-pm/server/node_modules \
    /home/mamed/prima-pm/client/node_modules \
    /root/.cache /var/log /var/lib/postgresql \
    /home/mamed/prima-pm/backups 2>/dev/null | sort -rh | head -6 | sed 's/^/    /'
  echo "  hint: journalctl --vacuum-size=15M ; apt-get clean ; rm -f /var/lib/snapd/cache/*"
} >> "$LOG"

# Keep the alert log small (last 400 lines).
tail -n 400 "$LOG" > "${LOG}.tmp" 2>/dev/null && mv "${LOG}.tmp" "$LOG"

exit 0
