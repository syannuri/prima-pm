# ✅ Deploy checklist — Hostinger VPS (KVM 1)

All-in-one on **one VPS** (API + React SPA + PostgreSQL from a single origin — **no split**).
This is a Hostinger-specific wrapper around **[`DEPLOYMENT.md`](DEPLOYMENT.md)** — do the numbered
steps here, following the referenced `DEPLOYMENT.md` sections for the full commands. Path used:
**Part 2A (public domain + Let's Encrypt)**.

> KVM 1 (1 vCPU / 4 GB / 50 GB NVMe) is comfortably enough — the current prod box runs the whole
> stack in ~0.7 GB on a 1.6 GB machine; the live DB is ~12 MB.

---

## Two ways to do this

- **Fast path — one-shot script** ([`deploy/hostinger-kvm1.sh`](../deploy/hostinger-kvm1.sh)):
  automates §3–§6 (base install → HTTPS → first admin → backup cron). Still do **§0** (provision)
  and **§2** (DNS) yourself first. Steps:
  1. Provision the VPS (§0) and point your domain at it (§2), then `ssh root@YOUR_VPS_IP`.
  2. Get the script onto the box. **The repo is private, so `raw.githubusercontent.com` 404s** —
     instead either paste it into `nano hostinger-kvm1.sh` (copy the file from the GitHub web UI
     while logged in), **or** from your own machine `scp deploy/hostinger-kvm1.sh root@YOUR_VPS_IP:~`.
  3. Edit the **CONFIG block** at the top — `DOMAIN`, `LE_EMAIL`, the `ADMIN_*` fields, and
     **`GIT_URL`** (a token/deploy-key URL, since the repo is private — see §3 below).
  4. `bash hostinger-kvm1.sh`  → open **https://your-domain** and log in. Done (~5–10 min).
- **Manual path — the checklist below** (§0–§6): every step spelled out, following the referenced
  `DEPLOYMENT.md` sections. Use this if you want to understand/customise each part, or if the
  script fails partway.

Both use **Part 2A (public domain + Let's Encrypt)**.

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
      You need a credential. **Full click-by-click steps are in the [Appendix](#appendix--clone-the-private-repo) below.** In short, pick one:
  - **Fine-grained PAT (recommended):** a read-only, repo-scoped token, then
    ```bash
    sudo git clone https://YOUR_GH_USER:YOUR_TOKEN@github.com/syannuri/prima-pm.git /opt/prismatix
    ```
  - **SSH deploy key (most locked-down):** an `ed25519` key on the VPS, added read-only to the repo,
    then `sudo git clone git@github.com:syannuri/prima-pm.git /opt/prismatix`.
  - **Tarball (no GitHub on the VPS):** on a machine that has the repo,
    `git archive --format=tar.gz -o prismatix.tgz HEAD`, `scp` it over, extract to `/opt/prismatix`.
  - For the one-shot script, put the chosen URL in its `GIT_URL` variable.
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

---

## Appendix — clone the private repo

The repo is **private**, so the VPS needs a credential to `git clone`/`git pull`. Pick **one** of
the three below. **Fine-grained PAT** is the quickest; a **deploy key** is the most locked-down.

Set the result as the script's `GIT_URL` (or use it directly in your `git clone` in §3).

### Option A — Fine-grained PAT (recommended, read-only)

1. GitHub → top-right avatar → **Settings** → (bottom of the left menu) **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name:** `prismatix-vps`. **Expiration:** e.g. 90 days (or a custom date). **Resource
   owner:** your account (`syannuri`).
3. **Repository access:** *Only select repositories* → pick **`syannuri/prima-pm`**.
4. **Permissions** → *Repository permissions* → **Contents: Read-only** (Metadata is auto-set to
   Read-only; leave everything else *No access*).
5. **Generate token** → **copy it now** (shown once; starts with `github_pat_…`).
6. Use it (username can be your GitHub login):
   ```bash
   GIT_URL="https://syannuri:github_pat_XXXXXXXX@github.com/syannuri/prima-pm.git"
   # or clone directly:
   sudo git clone "$GIT_URL" /opt/prismatix
   ```

### Option B — Classic PAT (fallback)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** →
   **Tokens (classic)** → **Generate new token (classic)**.
2. **Note:** `prismatix-vps`. Set an **expiration**. **Scope:** tick **`repo`**.
   > A classic token can't be read-only — `repo` grants read **and** write to your private repos.
   > Prefer Option A unless fine-grained tokens are unavailable to you.
3. **Generate token** → copy it (starts with `ghp_…`) → use the same URL form as Option A.

### Option C — SSH deploy key (most locked-down, per-repo)

A key that works for **this one repo only**, with **no token in the git URL**. If you'll run the
one-shot script **as root**, do this as root first (so the key lands in `/root/.ssh`).

1. On the VPS, generate a key (no passphrase, so `git pull` is non-interactive):
   ```bash
   ssh-keygen -t ed25519 -C "prismatix-vps" -f ~/.ssh/prismatix_deploy -N ""
   cat ~/.ssh/prismatix_deploy.pub          # copy this whole line
   ```
2. GitHub → the **`prima-pm`** repo → **Settings** → **Deploy keys** → **Add deploy key**.
   **Title:** `prismatix-vps`; **Key:** paste the `.pub` line; leave **Allow write access
   UNCHECKED** (read-only). **Add key.**
3. Tell SSH to use that key for github.com:
   ```bash
   cat >> ~/.ssh/config <<'CFG'
   Host github.com
     IdentityFile ~/.ssh/prismatix_deploy
     IdentitiesOnly yes
   CFG
   chmod 600 ~/.ssh/config
   ssh -T git@github.com     # type "yes" to trust the host; expect a "successfully authenticated" line
   ```
4. Use the SSH URL:
   ```bash
   GIT_URL="git@github.com:syannuri/prima-pm.git"
   sudo git clone "$GIT_URL" /opt/prismatix
   ```

### Security notes

- **A PAT in the git URL is stored in plaintext** at `/opt/prismatix/.git/config`. Keep it
  **read-only** (Option A), give it an **expiry**, and **revoke** it when you no longer need to
  `git pull` (GitHub → token settings → *Revoke*). A **deploy key** avoids a token-in-URL entirely
  and is scoped to just this repo.
- **Updates (`git pull`) reuse whatever you set up here** — the stored token, or the deploy key.
  If a PAT expires, `git pull` starts failing with an auth error; issue a new token and update the
  remote: `git -C /opt/prismatix remote set-url origin "https://syannuri:NEW_TOKEN@github.com/syannuri/prima-pm.git"`.
- **Never commit a token.** These live only on the VPS (in `.git/config` or `~/.ssh`), never in the repo.
