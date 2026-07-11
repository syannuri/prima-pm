# Split deploy — Frontend on Hostinger Business Web + Backend on a Node/Postgres host

Hostinger **Business Web Hosting** is shared PHP/MySQL hosting: it **cannot** run the Node
API or PostgreSQL. This guide keeps using Business Web for what it *is* good at — serving the
**static frontend** — while the **API + PostgreSQL** run on a small Node host. Both sit under
**one registrable domain** (e.g. `app.example.com` + `api.example.com`) so the httpOnly session
cookies + CSRF double-submit keep working with no security downgrade.

```
Browser ──▶ https://app.example.com   (Business Web / LiteSpeed)   → client/dist  (static SPA)
        └─▶ https://api.example.com   (Railway / Render / VPS)     → Express API + PostgreSQL
              same registrable domain "example.com"  →  cookies are same-site (SameSite=Strict OK)
```

> **Reality check:** you still pay for/operate a second host for the backend. A single small
> **VPS** serving API+SPA from one origin (see `../../docs/DEPLOYMENT.md`) is simpler and often
> cheaper. Use this split only if you specifically want the frontend on your existing Business
> Web plan.

---

## Prerequisites

- A domain whose DNS you manage (in hPanel or elsewhere).
- The Business Web plan (for the frontend).
- A backend host that runs **Node 20+** and can reach a **PostgreSQL 16+** database. Cheapest
  combos: **Railway** or **Render** (Node) + **Neon** or **Supabase** (managed Postgres); or a
  **Hostinger VPS KVM 1**. Node tooling on your own machine to build the client.

---

## Part A — Backend API (`api.example.com`)

### A1. PostgreSQL (Neon example)
1. Create a project/database on Neon → copy the connection string
   `postgresql://USER:PASS@HOST/DB?sslmode=require`. That is your `DATABASE_URL`.

### A2. Deploy the server (Railway example)
1. Point Railway at the repo, **root directory `server/`**. Build `npm ci && npm run build`,
   start `node dist/server.js`.
2. Set the environment variables (Railway → Variables):

   ```env
   DATABASE_URL=postgresql://…?sslmode=require
   JWT_ACCESS_SECRET=<64+ random hex>
   JWT_REFRESH_SECRET=<different 64+ random hex>
   NODE_ENV=production
   HOST=0.0.0.0            # PaaS proxies to the app; Railway also injects PORT
   SECURE=true             # served over HTTPS → HSTS + Secure cookies
   TRUST_PROXY=1           # behind the platform's proxy, so req.ip is the real client
   CORS_ORIGIN=https://app.example.com
   COOKIE_DOMAIN=.example.com   # <-- shares prima_csrf across app./api. (see note below)
   ```

   Generate secrets with `openssl rand -hex 48`.
3. **Migrate + seed the first admin** (Railway shell, or locally with `DATABASE_URL` exported):
   ```bash
   cd server
   npx prisma migrate deploy
   # create the first admin — see docs/DEPLOYMENT.md "First admin" for the exact snippet
   ```
4. **Custom domain:** add `api.example.com` to the service; it gives a target to point DNS at
   (Part C) and provisions TLS automatically.

> **Why `COOKIE_DOMAIN=.example.com`?** The API sets three cookies: `prima_at` / `prima_rt`
> (httpOnly, only ever sent to the API) and **`prima_csrf`** (JS-readable — the SPA echoes it in
> an `X-CSRF-Token` header). Without a Domain the cookie is host-only to `api.example.com`, so
> JS on `app.example.com` can't read `prima_csrf` and every mutation would 403. Setting the
> leading-dot domain shares the trio across sibling subdomains. `app.` and `api.` share the
> registrable domain, so they stay **same-site** and `SameSite=Strict` still holds — no
> `SameSite=None` downgrade needed. (Requires the `COOKIE_DOMAIN` support added to the server.)

> **⚠️ Ephemeral storage on PaaS:** Railway/Render wipe the container filesystem on redeploy, so
> `server/uploads` (attachments) is lost. Attach a **persistent volume** mounted at
> `server/uploads`, or run the backend on a **VPS**, if attachments must survive deploys. DB
> backups: use the provider's (Neon branching / Supabase backups) instead of the local cron.

---

## Part B — Frontend (`app.example.com`) on Business Web

Build the SPA **pointing at the API**, then upload it.

1. On your machine:
   ```bash
   cd client
   VITE_API_URL=https://api.example.com/api/v1 npm ci && npm run build
   ```
   (`VITE_API_URL` is baked in at build time — rebuild if the API URL changes.)
2. In hPanel: **create the subdomain `app`** (Domains → Subdomains); note its document root
   (e.g. `public_html/app`).
3. Upload the **contents of `client/dist`** into that document root (hPanel File Manager or
   FTP/SFTP), **plus the `.htaccess`** from this folder (`deploy/hostinger/.htaccess`).
   The final layout is `…/app/index.html`, `…/app/assets/…`, `…/app/.htaccess`, `sw.js`, etc.
4. In hPanel: **enable SSL** for `app.example.com` (Security → SSL → free Let's Encrypt).

---

## Part C — DNS

| Record | Name | Value |
|---|---|---|
| A / CNAME | `app` | → Business Web (Hostinger's server IP, or leave as-is if the domain is on this plan) |
| A / CNAME | `api` | → the backend host target (Railway/Render domain target, or the VPS IP) |

Wait for propagation, then confirm both resolve over HTTPS.

---

## Part D — Verify

1. `https://api.example.com/health` → `200`.
2. Open `https://app.example.com` → login page loads, no console errors.
3. Sign in. In DevTools → Application → Cookies you should see `prima_at`, `prima_rt`,
   `prima_csrf` all with **Domain `.example.com`**.
4. Do a write (e.g. add a stakeholder) → succeeds (proves cross-origin CORS + CSRF header work).
5. Deep-link refresh (e.g. reload on `/projects/…`) → still loads (proves the `.htaccess` SPA
   fallback).

## Troubleshooting

- **Mutations 403 "CSRF"** → `COOKIE_DOMAIN` not set (or wrong) on the API, so `prima_csrf`
  isn't readable at `app.` Check the cookie's Domain in DevTools.
- **CORS error / cookies not sent** → `CORS_ORIGIN` must be exactly `https://app.example.com`
  (no trailing slash) and the API must be HTTPS with `SECURE=true` (Secure cookies need HTTPS).
- **Blank page / 404 on refresh** → `.htaccess` missing from the subdomain root.
- **`app.` and `api.` are NOT the same registrable domain** (e.g. api on a different domain) →
  cookies become cross-site; you'd need `SameSite=None; Secure`, which this build intentionally
  does not use. Keep both under one domain.
