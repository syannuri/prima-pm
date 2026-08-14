# Observability & Error Tracking

Two independent layers. **Layer 1 (structured logging)** is always on and sends nothing off-box.
**Layer 2 (Sentry error tracking)** is **dormant** until a DSN is set.

## Layer 1 — Structured logging (always on)

- **pino** JSON logger (`server/src/lib/observability.ts`). Every line carries `service`, `release`,
  and a per-request `reqId`. Secrets (authorization/cookie/password/token/secret/apiKey) are redacted.
- **Correlation id** — `requestContext` middleware assigns `req.id` (or honours an inbound
  `X-Request-Id`), echoes it as the `X-Request-Id` response header, and logs one line per request
  (method, path, status, ms, tenantId, userId) on completion. `/health*` and `/_internal` are skipped.
- **Process safety** — `unhandledRejection` and (new) `uncaughtException` are logged structured;
  uncaught exits the process so systemd restarts a clean one.
- **Health split** — `/health` = liveness; **`/health/ready`** = liveness + a DB `SELECT 1`
  (200 `db:up` / 503 `db:down`) for deploy checks and load balancers.

Query the logs in journald:
```
journalctl -u prima-pm -o cat | jq 'select(.status >= 500)'
journalctl -u prima-pm -o cat | jq 'select(.reqId == "…")'   # trace one request
```
Tuning: `LOG_LEVEL` (default `info`), `APP_RELEASE` (git SHA — groups logs/errors per deploy).

## Layer 2 — Error tracking (Sentry, dormant by default)

Uses the Sentry SDK (`@sentry/node` + `@sentry/react`). **Only 5xx / unexpected errors** are sent
(expected 4xx client faults stay quiet). Enabled by env — unset ⇒ never initialised, complete no-op.

**Privacy:** `sendDefaultPii: false` + a `beforeSend` scrubber that strips request bodies, `Authorization`/
`Cookie` headers, and reduces the user to an opaque id (no email/name/ip). The DSN may point at a
**self-hosted GlitchTip** (Sentry-API-compatible — error data never leaves your infra) **or** sentry.io.

### Go-live

**Server** (`server/.env`):
```
SENTRY_DSN=https://<key>@<host>/<project>
SENTRY_ENV=lan            # or vps
APP_RELEASE=<git-sha>     # optional but recommended
```
then `sudo systemctl restart prima-pm` (env is read at start).

**Client** — Vite inlines env at **build time**, so set these before `npm run build`:
```
VITE_SENTRY_DSN=https://<key>@<host>/<project>
VITE_SENTRY_ENV=lan
VITE_APP_RELEASE=<git-sha>
```
then `cd client && npm run build` (dist is served live).

### Self-hosted GlitchTip (keeps data on your infra)

GlitchTip speaks the Sentry API, so the SDK/DSN are unchanged — only the DSN host differs. Run it
(Docker) on your infra, create a project, and use its DSN in `SENTRY_DSN` / `VITE_SENTRY_DSN`. This is
the recommended option given the app's privacy posture; sentry.io free tier is the zero-ops fallback.

### Verify after go-live
- Server log shows `Sentry error tracking enabled` on boot.
- Trigger a test error → it appears in the Sentry/GlitchTip project, **without** body/cookies/auth and
  with only an opaque user id, tagged with `release` + `environment` + `reqId`.

## Pending (Phase 3, optional)

Basic metrics endpoint (`/metrics`), a super-admin "recent errors" dashboard, and alert rules.
