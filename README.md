# PRIMA-PM — Integrated Project Management Web App

Multi-project, multi-user PM tool covering **Charter → Cost → Risk → Schedule → EVM**, aligned to PMBOK.
Stack: **React** (frontend, planned) · **Node/Express + Prisma** · **PostgreSQL** · JWT + RBAC · IDR currency.

See `../PM-App-Blueprint.md` and `docs/ERD.md` for design.

## Backend status
All four modules + EVM are implemented and tested (66 unit tests + a full end-to-end seed).

| # | Module | Endpoints (under `/api/v1`) |
|---|--------|------|
| 1 | Charter | `projects`, `projects/:id/charter[/commit\|/versions\|/change-requests]` |
| 2 | Cost | `projects/:id/cost[/direct\|/indirect\|/management-reserve\|/recompute]`, `ratecards` |
| 3 | Risk | `projects/:id/risk[/analysis]` |
| 4 | Schedule | `projects/:id/schedule[/gantt\|/manpower-sync\|/evm\|/tasks\|/dependencies]` |
| – | Auth | `auth/[register\|login\|refresh\|me]`, `users` |

## Run locally

### 1. Start PostgreSQL (Docker)
```bash
docker compose up -d        # postgres :5432, adminer :8080
```
Credentials match `server/.env`: `prima:prima` / db `prima_pm`.

### 2. Backend
```bash
cd server
cp .env.example .env        # already set for the compose DB
npm install
npx prisma migrate deploy   # apply migrations/0_init
npx prisma generate
npm run db:seed             # demo users + one fully populated project
npm run dev                 # API on http://localhost:4000
```

### Demo logins (password for all: `Password123!`)
| Role | Email |
|------|-------|
| Admin | admin@prima.id |
| PMO | pmo@prima.id |
| Project Manager | pm@prima.id |
| Finance | finance@prima.id |
| Risk Officer | risk@prima.id |
| Team Member (PIC) | pic@prima.id |
| Viewer | viewer@prima.id |

### Quick smoke test
```bash
# login -> grab accessToken
curl -s localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"pm@prima.id","password":"Password123!"}'

# then (with Authorization: Bearer <token>)
curl localhost:4000/api/v1/projects -H "Authorization: Bearer $TOKEN"
```

### 3. Frontend
```bash
cd client
npm install
npm run dev                 # Vite on http://localhost:5173 (proxies /api -> :4000)
```
Open http://localhost:5173 and log in with a demo account. Pages: Portfolio dashboard,
Project → Charter (commit) / Cost / Risk (heatmap) / Schedule (Gantt + EVM).

## Production build

In production a **single Node process serves both the API and the built React app**
from one origin, so the client's relative `/api/v1` calls need no proxy or CORS.

```bash
# 1. Build client (Vite → client/dist) + server (Prisma generate + tsc → server/dist)
./scripts/build-prod.sh

# 2. Configure secrets
cp server/.env.production.example server/.env   # then edit: real JWT secrets, PORT, DB

# 3. Apply migrations (and seed on first deploy only)
npm --prefix server run migrate:deploy
npm --prefix server run db:seed                 # optional, first time

# 4. Start (serves app + API on PORT, default 4000)
./scripts/start-prod.sh                          # foreground
```

Open `http://<server-ip>:<PORT>` — e.g. `http://192.168.1.150:4000`. The same port
serves the UI and the API; you no longer run Vite.

### Run as a service (auto-start, auto-restart)
```bash
sudo cp scripts/prima-pm.service /etc/systemd/system/prima-pm.service
sudo systemctl daemon-reload
sudo systemctl enable --now prima-pm
journalctl -u prima-pm -f                         # logs
```
Rebuild + restart after code changes: `./scripts/build-prod.sh && sudo systemctl restart prima-pm`.

> Static serving + a relaxed-for-inline-styles CSP only activate when `NODE_ENV=production`,
> so local dev (Vite on :5173) is unchanged.

## Database backups

Nightly `pg_dump` (custom format, compressed) with retention, driven by cron.

```bash
./scripts/db-backup.sh                       # run once now → backups/prima_pm_<ts>.dump
PRIMA_BACKUP_RETENTION=30 ./scripts/db-backup.sh   # keep more (default 14)
./scripts/db-restore.sh                      # restore newest dump (stop the app first!)
./scripts/db-restore.sh backups/prima_pm_20260627_020000.dump
```

Cron entry (root crontab — daily 02:00):
```cron
0 2 * * * /home/mamed/prima-pm/scripts/db-backup.sh >> /home/mamed/prima-pm/backups/cron.log 2>&1
```
Logs: `backups/backup.log`. Dumps connect via `DATABASE_URL` from `server/.env`.
Inspect a dump without restoring: `pg_restore -l backups/<file>.dump`.
> For off-box safety, periodically copy `backups/*.dump` to another machine.

## Tests
```bash
cd server
npm test                    # vitest — 77 unit tests
npx tsc --noEmit            # typecheck
cd ../e2e && npm test       # Playwright — 14 browser E2E tests
```

## Notes
- Money is `Decimal(18,2)`; all calculations live in `src/calc/*` (pure, unit-tested).
- The seed runs through the real service layer, so it doubles as an integration test.
- Without Docker you can use a local Postgres 16+; just point `DATABASE_URL` at it.
