# Subdomain routing — operator setup (Phase 6)

Turns on tenant workspaces at `https://<slug>.prismatix.tech`. The **app code is already deployed
and ready**; this is the one-time INFRA flip. Nothing here can be tested from inside the app — it's
DNS + nginx + a cert + one env var.

## What's already true (verified 2026-08-01)
- `prismatix.tech` is **proxied by Cloudflare** (edge IPs `2606:4700:*`; origin `31.97.105.155`).
- The client bundle calls the API **same-origin** (`build-prod.sh` bakes `VITE_API_URL=/api/v1`), so
  a page at `acme.prismatix.tech` calls `acme.prismatix.tech/api/v1` — correct.
- The server resolves the tenant from the `Host` header (`server/src/lib/tenant/host.ts`) but ONLY
  when `APP_BASE_DOMAIN` is set. It's unset today, so routing is dormant and the apex is unaffected.
- `requireAuth` rejects a session whose `tid` ≠ the host tenant (403), so a token can't be replayed
  on another workspace's domain. Cookies are host-only (no `Domain=`), so each subdomain is isolated.

## The flip — 4 steps

### 1. DNS — wildcard record (Cloudflare dashboard → DNS)
Add a record so every subdomain reaches the origin:
- **Type** `A` · **Name** `*` · **IPv4** `31.97.105.155` · **Proxy status** Proxied (orange cloud).
  - (If an `AAAA` apex record exists, add `AAAA *` with the same IPv6 too — keep it parallel to the apex.)
- Leave the existing apex `prismatix.tech` record as-is.

### 2. Edge TLS — Cloudflare Universal SSL (usually already on)
Cloudflare's free Universal SSL covers `prismatix.tech` **and** `*.prismatix.tech` (first level).
- SSL/TLS → Edge Certificates: confirm **Universal SSL** is Active and the cert's hosts include
  `*.prismatix.tech`. It provisions automatically once the wildcard record (step 1) exists — allow a
  few minutes. If it doesn't cover the wildcard, add an **Advanced Certificate** for `*.prismatix.tech`
  (also free on the current plan) — no code change needed.

### 3. Origin TLS — Cloudflare Origin CA wildcard cert (on the VPS)
Secures the Cloudflare⇄nginx hop so you can use **Full (Strict)** SSL mode.
1. Cloudflare → SSL/TLS → **Origin Server** → **Create Certificate**. Hostnames:
   `prismatix.tech, *.prismatix.tech`. Copy the **certificate** and the **private key**.
2. On the VPS install them and swap in the wildcard nginx config:
   ```bash
   sudo install -d -m 700 /etc/nginx/cloudflare
   sudo tee /etc/nginx/cloudflare/prismatix-origin.pem >/dev/null   # paste cert, Ctrl-D
   sudo tee /etc/nginx/cloudflare/prismatix-origin.key >/dev/null   # paste key,  Ctrl-D
   sudo chmod 600 /etc/nginx/cloudflare/prismatix-origin.key
   sudo cp /opt/prismatix/deploy/nginx/prismatix-wildcard.conf /etc/nginx/sites-available/prismatix
   sudo ln -sf /etc/nginx/sites-available/prismatix /etc/nginx/sites-enabled/prismatix
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Cloudflare → SSL/TLS → Overview → set encryption mode to **Full (Strict)**.

### 4. App — turn routing on (one env var + restart)
```bash
echo 'APP_BASE_DOMAIN=prismatix.tech' | sudo tee -a /opt/prismatix/server/.env
sudo systemctl restart prima-pm
```
Only after this env is set does the app start mapping `<slug>.prismatix.tech` → a tenant.

## Verify
```bash
# DNS resolves the wildcard:
getent hosts acme.prismatix.tech
# A real tenant slug loads its branded login (replace <slug> with an existing Tenant.slug):
curl -sS "https://<slug>.prismatix.tech/api/v1/auth/providers" | jq .workspace
#   → { "slug": "<slug>", "name": "…", "status": "ACTIVE" }
# An unknown slug is NOT a tenant → workspace null (falls back to normal login):
curl -sS "https://nope-xyz.prismatix.tech/api/v1/auth/providers" | jq .workspace   # → null
# The apex still works as the generic multi-tenant login:
curl -sS -o /dev/null -w '%{http_code}\n' https://prismatix.tech/   # → 200
```
In a browser, `https://<slug>.prismatix.tech` should show "Sign in to <Tenant name>" with the signup
paths hidden, and logging in as a member of another tenant on that host is refused (403).

## Rollback
Set routing back to dormant without touching DNS/nginx:
```bash
sudo sed -i '/^APP_BASE_DOMAIN=/d' /opt/prismatix/server/.env
sudo systemctl restart prima-pm
```
The apex and all existing logins keep working; subdomains simply stop resolving to tenants.

## Custom domains (later)
A customer pointing `pm.theircompany.com` at us (via `Tenant.customDomain`) is NOT covered by the
Cloudflare wildcard. Each such domain needs either its own origin cert + nginx `server_name` entry, or
Cloudflare **SSL for SaaS** (custom hostnames). Out of scope for the `*.prismatix.tech` flip above.
