# Custom domains with automatic TLS (Caddy on-demand) — operator setup

Lets a customer serve their workspace on their OWN domain (e.g. `https://pm.acmecorp.com`) with a TLS
cert that is **issued and renewed automatically** — no per-domain nginx/certbot work. It replaces the
origin proxy (nginx → **Caddy**); the Cloudflare-fronted apex + `*.prismatix.tech` keep working
exactly as before.

## How it works
- The customer points their domain **A → `31.97.105.155`** (the origin, NOT behind Cloudflare).
- On the first HTTPS request, Caddy asks the app *"may I get a cert for this host?"*
  (`GET /_internal/tls-check?domain=…`, loopback-only). The app returns **200** only if an **ACTIVE**
  tenant owns that `customDomain` — otherwise **404** and Caddy refuses (this stops strangers
  exhausting the Let's Encrypt rate limit).
- Caddy issues a Let's Encrypt cert, serves it, and **auto-renews**. The app resolves the Host → the
  tenant (`server/src/lib/tenant/host.ts`) and brands the login for that workspace.

## One-time: migrate the origin proxy from nginx to Caddy
> Prereq: the app is deployed on latest master (the `/_internal/tls-check` endpoint exists) — run
> `sudo ./scripts/update-prod.sh` first.

```bash
# 1) Install Caddy (Debian/Ubuntu)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudflare.com/dl.cloudflare.com/caddy/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/dl.cloudflare.com/caddy/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
# NOTE: if the Caddy apt repo is unavailable, install the static binary from https://caddyserver.com/download
#       (place at /usr/bin/caddy) — the caddy.service unit ships with the package either way.

# 2) Give Caddy the Cloudflare Origin CA cert (reuse the one nginx already has)
sudo cp /etc/nginx/cloudflare/prismatix-origin.pem /etc/caddy/prismatix-origin.pem
sudo cp /etc/nginx/cloudflare/prismatix-origin.key /etc/caddy/prismatix-origin.key
sudo chown caddy:caddy /etc/caddy/prismatix-origin.*
sudo chmod 640 /etc/caddy/prismatix-origin.key

# 3) Install the Caddyfile (edit the `email` first)
sudo cp /opt/prismatix/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# 4) Open the firewall (custom domains hit the origin directly, not via Cloudflare)
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp

# 5) Cut over: stop nginx, start Caddy (brief blip). Reversible: `systemctl stop caddy && systemctl start nginx`.
sudo systemctl stop nginx && sudo systemctl disable nginx
sudo systemctl enable --now caddy
sudo systemctl restart caddy   # picks up the Caddyfile
```

Verify the apex/subdomains still work through Caddy:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://prismatix.tech/            # 200 (via Cloudflare)
curl -sS https://default.prismatix.tech/api/v1/auth/providers | jq .workspace # the PRIMA workspace
```

## Onboarding a customer domain (per tenant)
1. **Platform admin** sets the domain: Platform console → the tenant's **Domain** modal → enter
   `pm.acmecorp.com` (or `PATCH /admin/tenants/:id { "customDomain": "pm.acmecorp.com" }`).
2. **Customer** creates DNS at their registrar: an **A record** `pm.acmecorp.com → 31.97.105.155`
   (proxy OFF / grey-cloud if they happen to use Cloudflare — the cert is issued at OUR origin).
3. Wait for DNS to propagate, then open `https://pm.acmecorp.com`. Caddy issues the cert on the first
   hit (a second or two) and the branded workspace login appears. No restart needed.

## Verify / troubleshoot
```bash
# The gate the way Caddy sees it (run on the VPS):
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:4000/_internal/tls-check?domain=pm.acmecorp.com"  # 200 if set+ACTIVE
# Caddy's issuance log:
sudo journalctl -u caddy -n 50 --no-pager
```
- **TLS won't issue** → the domain isn't set as an ACTIVE tenant's `customDomain` (gate returns 404),
  or DNS isn't pointing at `31.97.105.155` yet, or :80/:443 aren't open.
- **526 / apex broke after cutover** → the Origin CA cert paths in the Caddyfile are wrong, or Caddy
  didn't start — `systemctl status caddy`, then roll back to nginx.

## Rollback
```bash
sudo systemctl stop caddy && sudo systemctl start nginx && sudo systemctl enable nginx
```
The apex + subdomains return to nginx; custom domains stop being served (until Caddy is back).
