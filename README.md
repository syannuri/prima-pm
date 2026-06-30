# Precise — Project Management Web App

> Multi-project, multi-user project-management platform covering the full delivery lifecycle:
> **Charter → WBS/Schedule → Cost → Risk → Change Control → EVM**, aligned to PMBOK.

Precise gives PMs, PMO and finance one clear, role-aware view of project **health, cost, schedule and risk** —
turning scattered updates into Earned Value insight (CPI/SPI), resource utilization and an auditable trail.

![Precise — portfolio dashboard (dark mode)](docs/screenshots/dashboard.png)

<p align="center"><em>Portfolio dashboard — KPIs, needs-attention, EVM health & status distribution.</em></p>

> **Naming:** "Precise" is the user-facing brand. Internal identifiers stay `prima*` on purpose
> (repo dir, DB `prima_pm`, systemd unit, `prima_*` localStorage keys) — do not rename them.

---

## ✨ Features

- **Role-aware dashboard** — Portfolio EVM (KPIs, CPI/SPI, pie charts, "Needs attention"), Resource Utilization heatmap, and project cards. Personalised, time-based greeting (auto **ID/EN** from the browser).
- **Project Charter** — goals, scope, high-level cost; commit locks a baseline and unlocks the other modules.
- **WBS & Schedule** — work-breakdown tree, interactive Gantt (drag to reschedule / link dependencies), schedule **baseline & variance** (tracking Gantt), per-task progress, PIC and WBS dictionary.
- **Cost** — direct (material + manpower) & indirect costs, management reserve, manual **Actual Cost**, and live **EVM** (EV/PV/AC, CV, **CPI**). `BAC = PMB` = cost baseline excluding management reserve.
- **Risk** — qualitative (P×I, 5×5 heatmap) and quantitative (**EMV**) analysis; EMV drives the contingency reserve.
- **Change Requests** — raise → assess impact (cost/schedule/magnitude) → PMO/Admin approve, with charter versioning.
- **Audit log** — immutable, role-scoped trail of who changed what and when.
- **Notifications** — on-demand alerts (overdue tasks, high risks, budget overrun/overspend) + a portfolio bell.
- **Attachments** — upload/download files against charter, risks or the project.
- **Exports** — per-project **PDF** (PDFKit) and **Excel** (ExcelJS) reports — pure JS, no headless browser.
- **Resource master pool** — named/generic resources with rate cards; cross-project capacity & over-allocation.
- **Admin** — user management (create / role / reset password / activate), project reassignment, rate cards.
- **UX** — **dark mode by default** (light optional), accessible modals/toasts/confirm dialogs, skeleton loaders, IDR currency.

## 🧱 Tech stack

| Layer | Tech |
|------|------|
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS v3 · TanStack Query · React Router |
| Backend | Node.js · Express · TypeScript · Prisma v6 |
| Database | PostgreSQL (16+) |
| Auth | JWT (access/refresh) + **RBAC** |
| Reports | PDFKit (PDF) · ExcelJS (Excel) |
| Tests | Vitest (unit) · Supertest (HTTP integration) · Playwright (E2E) |

## 🏛️ Architecture

- **Pure calc core** (`server/src/calc/*`): money, cost rollup, risk EMV, EVM — all pure & unit-tested. Money is `Decimal`.
- **Modular API** under `/api/v1`: `auth`, `users`, `projects`, `charter`, `cost`, `ratecard`, `risk`, `schedule`, `portfolio`, `resource`, `attachment`, `audit`, `notification`, `export`.
- **RBAC middleware**: role guards + project-ownership checks; functional roles (Finance/Risk) bypass ownership where appropriate.
- **Single-origin in production**: one Node process serves the **API and the built React app** from the same port, so the client's relative `/api/v1` calls need no proxy or CORS.

### Roles
`ADMIN` · `PMO` · `PROJECT_MANAGER` · `FINANCE` · `RISK_OFFICER` · `TEAM_MEMBER` · `VIEWER`

### Domain conventions (don't re-litigate)
- **BAC = PMB** = direct + indirect + contingency, **excludes** management reserve (shown separately as "Total Budget").
- **Actual Cost is entered manually**; **progress drives Earned Value**, not AC. With AC = 0, CPI shows "—".
- Contingency reserve = Σ EMV of open risks flagged "include in reserve".

---

## 🚀 Getting started (local dev)

**Prerequisites:** Node.js 20+, and PostgreSQL 16+ (or Docker).

### 1. Database
```bash
docker compose up -d            # postgres :5432 (+ adminer :8080)
```
Matches `server/.env`: user/pass `prima:prima`, db `prima_pm`. (Or point `DATABASE_URL` at any local Postgres.)

### 2. Backend (API on :4000)
```bash
cd server
cp .env.example .env            # preset for the compose DB
npm install
npm run prisma:generate
npm run migrate:deploy          # apply migrations
npm run db:seed                 # demo users + 3 fully populated projects
npm run dev
```

### 3. Frontend (Vite on :5173)
```bash
cd client
cp .env.example .env            # VITE_API_URL=/api/v1 (proxied to :4000)
npm install
npm run dev
```
Open **http://localhost:5173** and sign in with a demo account.

### Demo logins (seed only — password `Password123!`)
| Role | Email |
|------|-------|
| Admin | admin@prima.id |
| PMO | pmo@prima.id |
| Project Manager | pm@prima.id |
| Finance | finance@prima.id |
| Risk Officer | risk@prima.id |
| Team Member | pic@prima.id |
| Viewer | viewer@prima.id |

> Demo accounts exist only in the seed/dev DB. In a real deployment, create proper accounts and disable the demos.

---

## 📦 Production build & deploy

A single Node process serves the API **and** the built client on one port.

```bash
./scripts/build-prod.sh                          # client (Vite) + server (prisma generate + tsc)
cp server/.env.production.example server/.env    # set real JWT secrets, PORT, DATABASE_URL
npm --prefix server run migrate:deploy
npm --prefix server run db:seed                  # first deploy only (optional)
./scripts/start-prod.sh                           # NODE_ENV=production, serves UI + API on PORT
```
Open `http://<server-ip>:<PORT>` (default 4000) — same port serves UI and API; no Vite.

### Run as a service (auto-start / auto-restart)
```bash
sudo cp scripts/prima-pm.service /etc/systemd/system/prima-pm.service
sudo systemctl daemon-reload
sudo systemctl enable --now prima-pm
journalctl -u prima-pm -f
```
Update flow: `./scripts/build-prod.sh && sudo systemctl restart prima-pm`.
A **client-only** change goes live with just `npm --prefix client run build` (the server serves `client/dist` directly).

### Backups
```bash
./scripts/db-backup.sh                            # pg_dump (compressed) → backups/ with retention
./scripts/db-restore.sh [file]                    # restore newest (or given) dump — stop the app first
```
Schedule via cron (daily 02:00):
```cron
0 2 * * * /path/to/prima-pm/scripts/db-backup.sh >> /path/to/prima-pm/backups/cron.log 2>&1
```

---

## 🧪 Testing

```bash
# Server unit tests (Vitest, no DB)
cd server && npm test
npm run test:coverage

# HTTP integration tests (Supertest against a dedicated prima_pm_test DB)
createdb prima_pm_test 2>/dev/null || true
npm run test:integration:setup     # migrate the test DB
npm run test:integration

# Frontend typecheck + build
cd ../client && npm run typecheck && npm run build

# End-to-end (Playwright, auto-boots server + client)
cd ../e2e && npm test
```
CI (`.github/workflows/ci.yml`) runs the server build + unit + Postgres-service integration tests and the client typecheck/build on every push and PR.

---

## 📁 Project structure
```
prima-pm/
├── client/          # React + Vite frontend
│   └── src/{pages,components,context,api,lib}
├── server/          # Express + Prisma API
│   └── src/{calc,lib,middleware,modules,config}
│   └── prisma/      # schema, migrations, seed
├── e2e/             # Playwright tests
├── docs/            # ERD.md, AUDIT-2026-06-29.md
├── scripts/         # build/start/backup/restore + systemd unit
└── docker-compose.yml
```

## 📝 Notes
- `server/.env`, `backups/`, `server/uploads/`, `node_modules/` and `dist/` are git-ignored — never commit secrets.
- See `docs/ERD.md` for the data model and `docs/AUDIT-2026-06-29.md` for the engineering audit & roadmap.

---

_Internal project for Xapiens. Private repository._
