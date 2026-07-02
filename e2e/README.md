# PRIMA-PM End-to-End Tests

Browser E2E coverage with [Playwright](https://playwright.dev), driving the real
React client against the live Express API and seeded PostgreSQL.

## Prerequisites

- PostgreSQL running with the seeded `prima_pm` database (`npm --prefix ../server run db:seed`).
- Server and client deps installed (`npm install` in `../server` and `../client`).
- Chromium for Playwright: `npx playwright install chromium`.

## Run

```bash
npm install        # first time only
npm test           # boots server (:4000) + client (:5173), runs all specs
```

`playwright.config.ts` starts both dev servers automatically (`reuseExistingServer`
so a running stack is reused) and waits for `/health` before the suite begins.

## Accounts

The suite logs in with the real accounts (the demo accounts were deactivated).
Passwords default to the values set at account creation but are overridable via env
so the suite survives password rotation:

```bash
E2E_ADMIN_PASSWORD=…   E2E_PM_PASSWORD=…   E2E_FINANCE_PASSWORD=…   npm test
```

| Helper role        | Email           | Default env var        |
|--------------------|-----------------|------------------------|
| `Admin`            | mamed@prismatix.id     | `E2E_ADMIN_PASSWORD`   |
| `Project Manager`  | budi@prismatix.id      | `E2E_PM_PASSWORD`      |
| `Finance`          | sari-fina@prismatix.id | `E2E_FINANCE_PASSWORD` |

If a teammate changes their password via the app, set the matching env var (or update
the default in `tests/helpers.ts`) before running.

## Specs

- `auth.spec.ts` — login, invalid-credential rejection, role-based UI gating
  (PM can create projects, Finance cannot), logout.
- `portfolio.spec.ts` — portfolio EVM KPI cards, status-date driven EVM,
  Portfolio EVM ↔ Project Cards toggle.
- `project.spec.ts` — module tab navigation on a chartered project, export
  buttons, audit log, back-to-dashboard.

`tests/helpers.ts` holds the shared `login()` (via demo-account buttons) and
`openFirstProject()` helpers.

> Note: the first run after a cold start can be slow because the dev servers
> compile on demand; the invalid-credentials assertion uses a 20s timeout to
> absorb this.
