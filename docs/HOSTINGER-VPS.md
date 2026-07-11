# ✅ Deploy checklist — Hostinger VPS (KVM 1)

All-in-one on **one VPS** (API + React SPA + PostgreSQL from a single origin — **no split**).
This is a Hostinger-specific wrapper around **[`DEPLOYMENT.md`](DEPLOYMENT.md)** — do the numbered
steps here, following the referenced `DEPLOYMENT.md` sections for the full commands. Path used:
**Part 2A (public domain + Let's Encrypt)**.

> KVM 1 (1 vCPU / 4 GB / 50 GB NVMe) is comfortably enough — the current prod box runs the whole
> stack in ~0.7 GB on a 1.6 GB machine; the live DB is ~12 MB.

---

## 0. Provision the VPS (hPanel → VPS → Create)
- [ ] Plan **KVM 1**.
- [ ] OS template **Ubuntu 24.04 LTS** (plain — no control-panel template).
- [ ] Set a strong root password; **note the public IPv4**.
- [ ] (Optional) add your SSH public key in the wizard for key-based login.

## 1. First login + a sudo user
```bash
ssh root@YOUR_VPS_IP
adduser deploy && usermod -aG sudo deploy      # a non-root admin to work as
```
- [ ] Reconnect as `ssh deploy@YOUR_VPS_IP` (use this user from here on; commands use `sudo`).
- [ ] (Optional swap — safety net for build peaks on 4 GB):
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile
  sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## 2. Point your domain at the VPS (hPanel → Domains → DNS Zone)
- [ ] `A` record `pm` (or `@`) → **YOUR_VPS_IP** (use a low TTL while testing).
- [ ] Confirm: `dig +short pm.yourdomain.com` returns the VPS IP before requesting TLS.

## 3. Base install — follow `DEPLOYMENT.md` §1.1–1.8
- [ ] **1.1** System packages (Node 20 + PostgreSQL 16 + nginx + ufw).
- [ ] **1.2** Create DB + role — **save the generated DB password**.
- [ ] **1.3** Get the code — ⚠️ **the repo is PRIVATE**, so a plain `git clone https://…` fails.
      Pick one:
  - **GitHub token (simplest):** create a fine-grained/classic PAT with `repo` (read) scope, then
    ```bash
    sudo git clone https://YOUR_GH_USER:YOUR_TOKEN@github.com/syannuri/prima-pm.git /opt/prismatix
    ```
  - **Deploy key:** `ssh-keygen` on the VPS → add the pubkey as a read-only *Deploy key* in the
    repo settings → `sudo git clone git@github.com:syannuri/prima-pm.git /opt/prismatix`.
  - **Tarball (no GitHub on the VPS):** on a machine that has the repo,
    `git archive --format=tar.gz -o prismatix.tgz HEAD`, `scp` it over, extract to `/opt/prismatix`.
- [ ] **1.4** `server/.env`: `DATABASE_URL` (with the 1.2 password), two `openssl rand -hex 32`
      secrets, `CORS_ORIGIN=https://pm.yourdomain.com`, `SECURE=true`, `TRUST_PROXY=1`,
      `HOST=127.0.0.1`.
- [ ] **1.5** Build: `sudo ./scripts/build-prod.sh`.
- [ ] **1.6** Migrate: `npm --prefix server run migrate:deploy` (skip the demo seed for a clean DB).
- [ ] **1.7** Hardened non-root systemd service. **⚠️ edit `scripts/prima-pm.service`** — change the
      `WorkingDirectory` and `EnvironmentFile` from `/home/mamed/prima-pm/server` to
      **`/opt/prismatix/server`** before `daemon-reload`.
- [ ] **1.8** Firewall: `sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable`.
- [ ] Verify loopback: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/` → **200**.

## 4. TLS with your domain — `DEPLOYMENT.md` §2A
- [ ] `sudo apt install -y certbot python3-certbot-nginx`.
- [ ] Install `deploy/nginx/prismatix-domain.conf`, `sed` in your domain, enable it, remove the
      default site, `nginx -t && reload` (exact commands in §2A).
- [ ] `sudo certbot --nginx -d pm.yourdomain.com` → then `sudo systemctl restart prima-pm`.
- [ ] Open **https://pm.yourdomain.com** — the login page should load over a trusted certificate.

## 5. First admin — `DEPLOYMENT.md` §3
- [ ] Create the first ADMIN row on the clean DB (the `INSERT INTO "User" …` snippet), then sign in
      and manage the rest from **Admin → Users**.

## 6. Backups & monitoring — `DEPLOYMENT.md` §4
- [ ] `sudo crontab -e` → add the nightly `db-backup.sh` (02:00) and `disk-check.sh` (*/30) lines.
- [ ] (Recommended) set `PRIMA_OFFBOX_DEST` for an off-box copy; remember `server/uploads/` + `.env`
      are **not** in git — back them up too.

---

## Hostinger-specific notes
- **Two firewalls exist:** the hPanel VPS firewall *and* in-VM `ufw`. Using `ufw` (step 3.1.8) is
  enough — just don't accidentally block 22/80/443 in the hPanel one.
- **Updates:** `DEPLOYMENT.md` §5 — `sudo git pull` (reuses the stored token/deploy key) →
  `sudo ./scripts/build-prod.sh` → `migrate:deploy` → `sudo systemctl restart prima-pm`.
- **Keep it lean:** don't run the Playwright/e2e suite or repeated throwaway builds on the VPS —
  that's what bloats disk. `disk-check.sh` warns at 80/90 %.
- **Sizing:** KVM 1 fits an internal/departmental tool. Step up to **KVM 2** (2 vCPU / 8 GB) only if
  you expect high concurrency (100+ simultaneous users) or many parallel PDF/Excel exports.
