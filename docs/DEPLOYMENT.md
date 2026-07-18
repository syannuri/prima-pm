# 🚀 Deployment Guide — Prismatix (production, from a bare server)

Step-by-step to take a **fresh Ubuntu/Debian server** (VPS, cloud instance, or on-prem box)
to a live, HTTPS-secured Prismatix deployment. Two TLS paths are covered — pick one:

- **Path A — Public domain (VPS / cloud)** → TLS via **Let's Encrypt** (`certbot`).
- **Path B — LAN / on-prem by IP (no domain)** → TLS via a **local CA** you install on each device.

> **On a Hostinger VPS?** See **[`HOSTINGER-VPS.md`](HOSTINGER-VPS.md)** — a provider-specific
> checklist (VPS provisioning, DNS in hPanel, private-repo clone) that wraps Path A below.

Everything else (OS packages, PostgreSQL, the Node app, systemd, hardening, backups) is
**common to both paths**. Do **Part 1** first, then your chosen **Part 2**.

> **Architecture.** One Node process serves the **REST API and the built React client** on a
> single port (`4000`), bound to **loopback** (`127.0.0.1`). **nginx** terminates TLS on
> `:443` and reverse-proxies to it. PostgreSQL runs locally. The app never faces the internet
> directly.
>
> ```
> [ browser ] ──https:443──▶ [ nginx ] ──▶ [ node :4000 (127.0.0.1) ] ──▶ [ PostgreSQL :5432 ]
> ```

**Assumptions:** Ubuntu 22.04/24.04 (or Debian 12), a `sudo`-capable user, and — for Path A —
a domain whose DNS `A`/`AAAA` record points at the server's public IP.

---

## Part 1 — Base install (common to both paths)

### 1.1 System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates gnupg nginx ufw

# Node.js 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v            # expect v20.x

# PostgreSQL 16 (PGDG repo — guarantees 16 on any release)
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-16
sudo systemctl enable --now postgresql
```

### 1.2 Create the database & role

Pick a strong DB password and keep it for the `.env` `DATABASE_URL`.

```bash
DB_PASS="$(openssl rand -hex 16)"; echo "DB password: $DB_PASS"   # save this
sudo -u postgres psql <<SQL
CREATE ROLE prima WITH LOGIN PASSWORD '${DB_PASS}';
CREATE DATABASE prima_pm OWNER prima;
SQL
```

### 1.3 Get the code

```bash
sudo git clone https://github.com/syannuri/prima-pm.git /opt/prismatix
cd /opt/prismatix
```

> `/opt` is world-traversable, so the non-root service user (set up in 1.7) can read the code
> with no extra permission tweaks. If you clone under `/home/<user>` instead, you must also run
> `sudo chmod o+x /home/<user>` so the service user can traverse into it.

### 1.4 Configure the environment

```bash
cp server/.env.production.example server/.env
```

Edit `server/.env` and set at minimum:

```bash
NODE_ENV=production
PORT=4000
HOST=127.0.0.1                         # loopback — only nginx reaches the app
DATABASE_URL=postgresql://prima:PASTE_DB_PASS_HERE@localhost:5432/prima_pm?schema=public
JWT_ACCESS_SECRET=PASTE_openssl_rand_hex_32
JWT_REFRESH_SECRET=PASTE_a_DIFFERENT_openssl_rand_hex_32
CORS_ORIGIN=https://pm.example.com     # Path A: your domain · Path B: https://YOUR_LAN_IP
SECURE=true                            # HSTS + upgrade-insecure-requests (we serve over https)
TRUST_PROXY=1                          # one nginx hop in front → real client IP for rate-limiter
```

Generate the two JWT secrets:

```bash
openssl rand -hex 32   # → JWT_ACCESS_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET
```

> **Never commit `server/.env`** (it's git-ignored). `SECURE=true` requires HTTPS in front —
> we set that up in Part 2. `TRUST_PROXY=1` matters: without it the login rate-limiter would
> throttle everyone behind the proxy as if they were one IP.

### 1.5 Build

```bash
sudo ./scripts/build-prod.sh
```

This installs deps, builds the client (`client/dist`) and compiles the server (`server/dist`).

### 1.6 Apply migrations (and optional demo seed)

```bash
npm --prefix server run migrate:deploy      # create all tables
# OPTIONAL — demo users + sample projects (skip for a clean production DB):
# npm --prefix server run db:seed
```

### 1.7 Run as a hardened systemd service (non-root)

Prismatix runs as a dedicated non-login user `prima` (least privilege — it can read the code
but not modify it; only `server/uploads` is writable). One-time setup:

```bash
# 1) dedicated system user + group
sudo groupadd --system prima
sudo useradd  --system --no-create-home --shell /usr/sbin/nologin --gid prima prima

# 2) let it read secrets + write attachments (code stays root-owned + world-readable)
sudo chown root:prima /opt/prismatix/server/.env && sudo chmod 640 /opt/prismatix/server/.env
sudo mkdir -p /opt/prismatix/server/uploads
sudo chown -R prima:prima /opt/prismatix/server/uploads

# 3) install the unit (already set to User=prima + sandboxing; edit WorkingDirectory if your
#    path differs from /opt/prismatix — see the note below)
sudo cp scripts/prima-pm.service /etc/systemd/system/prima-pm.service
sudo systemctl daemon-reload
sudo systemctl enable --now prima-pm
journalctl -u prima-pm -f      # watch it boot; Ctrl-C to stop watching
```

> **Path note:** `scripts/prima-pm.service` ships with `WorkingDirectory` and `EnvironmentFile`
> pointing at `/home/mamed/prima-pm/server`. If you cloned to `/opt/prismatix`, edit those two
> lines to `/opt/prismatix/server` before `daemon-reload`.

Verify the app answers on loopback:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/     # expect 200
```

### 1.8 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'     # opens :80 and :443
sudo ufw --force enable
```

Port `4000` is **not** opened — it's loopback-only and reached only through nginx.

Now do **Part 2A** (domain) or **Part 2B** (LAN/IP).

---

## Part 2A — TLS with a public domain (Let's Encrypt)

Point your domain's DNS at the server first (`A`/`AAAA` → public IP), then:

```bash
sudo apt install -y certbot python3-certbot-nginx

# install the proxy config, set your domain, drop nginx's default site
sudo cp deploy/nginx/prismatix-domain.conf /etc/nginx/sites-available/prismatix
sudo sed -i 's/pm.example.com/YOUR.DOMAIN/g' /etc/nginx/sites-available/prismatix
sudo ln -sf /etc/nginx/sites-available/prismatix /etc/nginx/sites-enabled/prismatix
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# obtain the cert AND auto-inject the :443 block + http→https redirect
sudo certbot --nginx -d YOUR.DOMAIN
sudo certbot renew --dry-run      # confirm auto-renewal works (runs via a systemd timer)
```

Make sure `server/.env` has `CORS_ORIGIN=https://YOUR.DOMAIN` and `SECURE=true`, then
`sudo systemctl restart prima-pm`. Open **https://YOUR.DOMAIN** — done.

---

## Part 2B — TLS on a LAN / on-prem host by IP (local CA)

No public domain → issue your own CA once, trust it on each device. Replace `192.168.1.50`
with your server's LAN IP and `myhost` with its hostname throughout.

### 2B.1 Generate a local CA + server certificate

```bash
sudo mkdir -p /etc/nginx/certs && cd /etc/nginx/certs

# Root CA (10 years)
sudo openssl genrsa -out ca.key 4096
sudo openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=Prismatix Local CA" -out ca.crt

# Server key + cert signed by the CA (825 days), with the IP + hostname in the SAN
sudo openssl genrsa -out server.key 2048
sudo openssl req -new -key server.key -subj "/CN=192.168.1.50" -out server.csr
sudo bash -c 'cat > server.ext <<EXT
subjectAltName = IP:192.168.1.50, IP:127.0.0.1, DNS:myhost, DNS:localhost
EXT'
sudo openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 -extfile server.ext
sudo chmod 600 ca.key server.key
```

### 2B.2 Install the nginx config

```bash
cd /opt/prismatix
sudo cp deploy/nginx/prismatix-lan.conf /etc/nginx/sites-available/prismatix
sudo sed -i 's/192.168.1.150/192.168.1.50/g; s/myhost/YOUR_HOSTNAME/g' \
  /etc/nginx/sites-available/prismatix
sudo ln -sf /etc/nginx/sites-available/prismatix /etc/nginx/sites-enabled/prismatix
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 2B.3 Trust the CA on each device (once per device)

Download `http://192.168.1.50/prismatix-ca.crt` and install it as a trusted **root**
certificate authority:
- **Windows:** double-click → Install → *Local Machine* → *Trusted Root Certification Authorities*.
- **macOS:** Keychain Access → System → import → set *Always Trust*.
- **iOS:** install profile → Settings → General → About → Certificate Trust Settings → enable.
- **Android:** Settings → Security → Encryption & credentials → Install a CA certificate.
- **Ubuntu:** `sudo cp prismatix-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates`.

With `CORS_ORIGIN=https://192.168.1.50` and `SECURE=true` in `.env`, `sudo systemctl restart
prima-pm`, then open **https://192.168.1.50** — no browser warning on trusted devices.

---

## Part 3 — Create the first admin account

Accounts are admin-provisioned (no open registration). If you seeded demo data, log in as
`admin@prismatix.id` / `Password123!` and **create real accounts, then deactivate the demos**.

For a **clean (unseeded) DB**, create the first ADMIN directly:

```bash
cd /opt/prismatix/server
# hash a password and insert an ADMIN user (replace the email + password)
HASH="$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" 'YourStrongPass1')"
sudo -u postgres psql -d prima_pm -c \
  "INSERT INTO \"User\" (id,name,email,\"passwordHash\",role,\"isActive\",\"tokenVersion\",\"createdAt\",\"updatedAt\")
   VALUES (gen_random_uuid(),'Administrator',lower('admin@yourco.com'),'${HASH}','ADMIN',true,0,now(),now());"
```

> The `lower(...)` matters: the app lowercases email on login, so an email stored with
> any uppercase letter can never sign in. If you already inserted a mixed-case email, fix
> it with `UPDATE "User" SET email = lower(email);`.

Then sign in and manage the rest from **Admin → Users**.

---

## Part 4 — Backups & monitoring

The repo ships backup + disk-monitor scripts. Wire them into `root`'s crontab:

```bash
sudo crontab -e
```

Add:

```cron
# nightly DB backup (compressed dump + rotation) at 02:00
0 2 * * * /opt/prismatix/scripts/db-backup.sh >> /opt/prismatix/backups/cron.log 2>&1
# disk-space alert every 30 min (logs to journald + backups/disk-alert.log; read-only)
*/30 * * * * /opt/prismatix/scripts/disk-check.sh
```

- **Off-box copies** (recommended): set `PRIMA_OFFBOX_DEST="user@host:/path"` (+ an SSH key via
  `PRIMA_OFFBOX_KEY`) so `db-backup.sh` rsyncs each dump to a second machine — otherwise a
  disk/box loss also loses the local backups. See `scripts/db-backup.sh`.
- **Restore:** `./scripts/db-restore.sh [dumpfile]` (stop the app first).
- ⚠️ The DB dump covers the database only — **also back up `server/uploads/`** (attachment files)
  and keep `server/.env` safe; neither is in git.

---

## Part 5 — Updating / redeploying

**One command** — pull + build + migrate + fix-ownership + restart + health-check, with
automatic rollback to the previous commit if the new build fails to come up healthy:

```bash
cd /opt/prismatix
sudo ./scripts/update-prod.sh
```

<details><summary>…or the equivalent manual steps</summary>

```bash
cd /opt/prismatix
sudo git pull
sudo ./scripts/build-prod.sh
npm --prefix server run migrate:deploy        # apply any new migrations
sudo systemctl restart prima-pm               # picks up server changes
# keep uploads/.env owned right if you recreated them:
sudo chown -R prima:prima server/uploads
sudo chown root:prima server/.env && sudo chmod 640 server/.env
```
</details>

> A **client-only** change goes live the moment `build-prod.sh` finishes (nginx→node serves
> `client/dist` directly) — no restart needed. **Server** changes need the `systemctl restart`.
> `vite build` empties `client/dist` first, so don't interrupt the build (the site briefly 500s
> until it completes).

---

## Part 6 — Troubleshooting

| Symptom | Check |
|---|---|
| `curl 127.0.0.1:4000` not 200 | `journalctl -u prima-pm -n 50` — usually a bad `DATABASE_URL`, a missing JWT secret, or a migration not applied. |
| Blank page over HTTP | `SECURE=true` forces HTTPS (`upgrade-insecure-requests`). Serve via nginx `:443`, not plain http. |
| Service won't start as `prima` | Ensure `prima` can read `server/.env` (`root:prima 640`) and the path is traversable (`/opt` is fine; under `/home` add `chmod o+x /home/<user>`). |
| Uploads fail / 500 on attach | `server/uploads` must be `prima:prima` and writable; nginx `client_max_body_size 12m` must be set. |
| Rate-limiter locks everyone out | `TRUST_PROXY=1` must be set so `req.ip` is the real client, not nginx. |
| Cert warning (Path B) | The device hasn't trusted the local CA — install `http://<ip>/prismatix-ca.crt`. |
| Postgres “in recovery / no space” | Free disk (`df -h /`), then Postgres self-heals; `disk-check.sh` warns early. |

---

## Appendix — quick reference

**Ports:** `443` (nginx TLS, public) · `80` (nginx: redirect / CA download) · `4000` (Node,
loopback-only) · `5432` (PostgreSQL, local).

**Key paths:** app `/opt/prismatix` · env `server/.env` · uploads `server/uploads/` · built
client `client/dist/` · backups `backups/` · systemd `/etc/systemd/system/prima-pm.service` ·
nginx `/etc/nginx/sites-available/prismatix` · certs (Path A) `/etc/letsencrypt/…` / (Path B)
`/etc/nginx/certs/`.

**Env vars:** see `server/.env.production.example` for the full annotated list.

**Service:** `sudo systemctl {status|restart|stop} prima-pm` · logs `journalctl -u prima-pm -f`.

**Docker (local dev only):** `docker compose up -d` brings up Postgres+Adminer for development;
production uses the systemd unit above, not compose.
