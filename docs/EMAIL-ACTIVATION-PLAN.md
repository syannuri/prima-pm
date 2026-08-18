# Email notifications & account activation

Transactional email for Prismatix: a **welcome / activation** flow for new users plus platform
notifications. Built dormant-by-default (like Sentry / VAPID / Lemon Squeezy) — nothing changes until
SMTP is configured, and configuring it **arms a hard email-verification wall**.

## The dormant gate (critical)

`emailEnabled()` (lib/mailer.ts) is true only when `SMTP_HOST` **and** a from-address
(`MAIL_FROM`, else `SMTP_USER`) are set. Everything keys off it:

- **Email OFF (no SMTP)** — current prod behaviour, byte-identical. New accounts are born verified
  (`emailVerifiedAt = now`), guest signup auto-logs-in, `login()` never checks verification. A
  mail-less deployment can therefore **never lock anyone out**.
- **Email ON (SMTP set)** — the hard wall is armed: new local accounts are born **unverified**
  (`emailVerifiedAt = null`), guest signup does **not** auto-login (202 `{ verify:true }`), and
  `login()` returns **403 `EMAIL_NOT_VERIFIED`** until the emailed activation link is redeemed.

The migration backfills **every existing user to verified** (`emailVerifiedAt = createdAt`), so only
accounts created after the deploy face the wall — no existing user is affected.

## Transport

SMTP via `nodemailer`. Config read LIVE from `process.env` (like `lsConfig()`), so ops can set keys
without a rebuild:

| var          | meaning                                             |
|--------------|-----------------------------------------------------|
| `SMTP_HOST`  | SMTP server host (arms the feature)                 |
| `SMTP_PORT`  | default 587 (secure auto-on for 465)                |
| `SMTP_USER`  | SMTP auth user (optional)                           |
| `SMTP_PASS`  | SMTP auth password                                  |
| `SMTP_SECURE`| force TLS on/off (else inferred from the port)      |
| `MAIL_FROM`  | `From:` header, e.g. `Prismatix <no-reply@…>`       |
| `APP_URL`    | base URL for email links (else first CORS origin)   |

`sendMail()` is **best-effort** — it never throws, so a mail hiccup can't break signup/approval. Tests
route sends to `__setMailSink` (no network).

## Flows that email

1. **Guest self-signup** — activation email; no auto-login while armed.
2. **Tenant admin provisioned** by a platform admin (`POST /admin/tenants`) — activation email; must
   activate before first login.
3. **Org signup** — activation email on request; **workspace-approved** email when a platform admin
   approves (login needs *both* a verified email and an ACTIVE workspace).
4. **Platform-admin alert** — an email nudge (on top of the in-app notification) when a new org signup
   is awaiting review.

Google / Microsoft sign-ins are pre-verified by the provider (`emailVerifiedAt = now`), never walled.

## Tokens

`EmailToken` — single-use, 24h expiry, **only the SHA-256 hash stored** (raw token lives solely in the
emailed link). Redeem: `POST /auth/verify-email { token }`. Resend: `POST /auth/resend-activation
{ email }` (throttled per IP+email, generic 200 — no user enumeration).

## Go-live

Set the `SMTP_*` + `MAIL_FROM` (+ `APP_URL`) env vars and restart. Nothing else. To roll back, unset
`SMTP_HOST` — the wall disarms instantly.
