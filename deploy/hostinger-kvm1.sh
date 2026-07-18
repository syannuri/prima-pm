#!/usr/bin/env bash
#
# One-shot deploy for Prismatix on a Hostinger KVM1 VPS (Ubuntu).
# Combines DEPLOYMENT.md Part 1 (base install) + 2A (HTTPS via Let's Encrypt)
# + 3 (first admin) + 4 (backup cron). Run once, as root, on a fresh VPS.
#
# Prereqs (do these first):
#   1. Buy a KVM1 VPS, choose Ubuntu 22.04/24.04 LTS. Note its public IP.
#   2. Point your domain's A record at that IP and wait for it to propagate
#      (verify: `dig +short YOUR.DOMAIN` returns the VPS IP).
#   3. SSH in as root, fill the CONFIG block below, then paste/run this file.
#
# See docs/HOSTINGER-VPS.md for the guided walk-through.
set -euo pipefail

############################  FILL THIS IN  ############################
DOMAIN="pm.example.com"            # domain whose A record points at the VPS IP
LE_EMAIL="you@example.com"         # email for Let's Encrypt renewal notices
ADMIN_NAME="Administrator"
ADMIN_EMAIL="admin@example.com"    # the first admin account (used to log in)
ADMIN_PASS="ChangeMeStrong1"       # min 10 chars, at least one letter + number
# The repo is PRIVATE, so a plain https clone fails. Use a token (fine-grained/classic PAT
# with read `repo` scope) or an SSH deploy key. Examples:
#   GIT_URL="https://GH_USER:GH_TOKEN@github.com/syannuri/prima-pm.git"
#   GIT_URL="git@github.com:syannuri/prima-pm.git"     # needs an SSH deploy key on the VPS
GIT_URL="https://github.com/syannuri/prima-pm.git"
#######################################################################

REPO=/opt/prismatix
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
[ "$DOMAIN" != "pm.example.com" ] || { echo "Edit the CONFIG block first."; exit 1; }
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

echo "=====  PART 1.1 — System packages  ====="
apt update && apt upgrade -y
apt install -y git curl ca-certificates gnupg nginx ufw openssl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt update && apt install -y postgresql-16
systemctl enable --now postgresql

echo "=====  PART 1.2 — Database & role  ====="
DB_PASS="$(openssl rand -hex 16)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE prima WITH LOGIN PASSWORD '${DB_PASS}';
CREATE DATABASE prima_pm OWNER prima;
SQL

echo "=====  PART 1.3 — Get the code  ====="
git clone "$GIT_URL" "$REPO"
cd "$REPO"

echo "=====  PART 1.4 — Environment (.env)  ====="
JWT_A="$(openssl rand -hex 32)"; JWT_R="$(openssl rand -hex 32)"
cat > "$REPO/server/.env" <<ENV
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
DATABASE_URL=postgresql://prima:${DB_PASS}@localhost:5432/prima_pm?schema=public
JWT_ACCESS_SECRET=${JWT_A}
JWT_REFRESH_SECRET=${JWT_R}
CORS_ORIGIN=https://${DOMAIN}
SECURE=true
TRUST_PROXY=1
ENV

echo "=====  PART 1.5 — Build  ====="
bash "$REPO/scripts/build-prod.sh"

echo "=====  PART 1.6 — Migrations  ====="
( cd "$REPO/server" && npm run migrate:deploy )
# Optional demo data — SKIP for a clean production DB:
# ( cd "$REPO/server" && npm run db:seed )

echo "=====  PART 1.7 — Hardened systemd service (non-root)  ====="
groupadd --system prima 2>/dev/null || true
id -u prima >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --gid prima prima
chown root:prima "$REPO/server/.env" && chmod 640 "$REPO/server/.env"
mkdir -p "$REPO/server/uploads" && chown -R prima:prima "$REPO/server/uploads"
# Install the unit, rewriting its paths from the dev checkout to /opt/prismatix.
sed 's#/home/mamed/prima-pm/server#/opt/prismatix/server#g' \
  "$REPO/scripts/prima-pm.service" > /etc/systemd/system/prima-pm.service
systemctl daemon-reload
systemctl enable --now prima-pm
sleep 3
echo "Loopback health: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/)  (expect 200)"

echo "=====  PART 1.8 — Firewall  ====="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "=====  PART 2A — HTTPS (Let's Encrypt)  ====="
apt install -y certbot python3-certbot-nginx
cp "$REPO/deploy/nginx/prismatix-domain.conf" /etc/nginx/sites-available/prismatix
sed -i "s/pm.example.com/${DOMAIN}/g" /etc/nginx/sites-available/prismatix
ln -sf /etc/nginx/sites-available/prismatix /etc/nginx/sites-enabled/prismatix
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${LE_EMAIL}" --redirect
systemctl restart prima-pm

echo "=====  PART 3 — First admin account  ====="
# The app lowercases email on login (auth.schemas.ts), so store it lowercased —
# otherwise an ADMIN_EMAIL with any uppercase letter can never log in.
ADMIN_EMAIL="$(printf '%s' "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]')"
HASH="$(cd "$REPO/server" && node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" "$ADMIN_PASS")"
sudo -u postgres psql -d prima_pm -c \
  "INSERT INTO \"User\" (id,name,email,\"passwordHash\",role,\"isActive\",\"tokenVersion\",\"createdAt\",\"updatedAt\")
   VALUES (gen_random_uuid(),'${ADMIN_NAME}','${ADMIN_EMAIL}','${HASH}','ADMIN',true,0,now(),now());"

echo "=====  PART 4 — Backup & disk cron  ====="
mkdir -p "$REPO/backups"
CRON_BK="0 2 * * * $REPO/scripts/db-backup.sh >> $REPO/backups/cron.log 2>&1"
CRON_DK="*/30 * * * * $REPO/scripts/disk-check.sh"
# `|| true` keeps `set -e`/pipefail happy on a fresh VPS where root has no crontab yet.
{ crontab -l 2>/dev/null | grep -vF 'prismatix/scripts/db-backup.sh' | grep -vF 'prismatix/scripts/disk-check.sh' || true; \
  echo "$CRON_BK"; echo "$CRON_DK"; } | crontab -

echo
echo "=========================================================="
echo " DONE ✅   Open:  https://${DOMAIN}"
echo " Login:   ${ADMIN_EMAIL}  /  (the password you set)"
echo "=========================================================="
