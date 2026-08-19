# Deploy runbook — email notifications & account activation (PR #41)

Consolidated deploy for the email-activation feature (`feat/email-activation`, merged to master as
`04ab601`). Feature reference: [`EMAIL-ACTIVATION-PLAN.md`](./EMAIL-ACTIVATION-PLAN.md).

**Safe by design.** The hard verification wall arms only when SMTP is configured (`emailEnabled()`).
Deploying the code without SMTP env is a **no-op behaviourally** — the migration only adds a nullable
column + a table and backfills every existing user to *verified*, so nobody is ever locked out. The
feature goes live later, at your choosing, by setting the SMTP env and restarting.

New migration: `20260818140000_email_verification` — additive (`User.emailVerifiedAt` + `EmailToken`
table + backfill existing → verified). No enum rename, no destructive change.

---

## A. LAN (prima-pm :4000, checkout `/home/mamed/prima-pm`)

Order matters — **build → migrate → restart** (new code references the new schema).

```bash
cd /home/mamed/prima-pm
git status -s && git rev-parse --short HEAD          # clean, on master 04ab601

# 1. Server deps + build (nodemailer is a new dependency)
cd server && npm install && npm run build            # prisma generate && tsc -p tsconfig.build.json

# 2. Apply migration to the prod DB (server/.env → DATABASE_URL)
npm run migrate:deploy                                # prisma migrate deploy

# 3. Client build (dist served live)
cd ../client && npm run build

# 4. Restart (needs sudo; does NOT auto-restart if killed — never pkill dist/server.js)
sudo systemctl restart prima-pm
sudo systemctl status prima-pm --no-pager | head -5
```

Verify:
```bash
curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:4000/health
# 400 (not 404) = the new route is mounted:
curl -s -o /dev/null -w "verify:%{http_code}\n" -X POST http://localhost:4000/api/v1/auth/verify-email \
  -H 'Content-Type: application/json' -d '{}'
```

> On this box tsc/build is slow (~2 min each) and concurrent builds have hung tsc — build server and
> client one at a time.

---

## B. VPS (prismatix.tech, Hostinger KVM1, checkout `/opt/prismatix`)

The VPS already runs PR #40 (subscription plans, `b62cd33`), so the **only** delta is this email PR —
one additive migration. Run as root.

```bash
# 1. Pre-flight — confirm the delta is only email
cd /opt/prismatix
git fetch origin master
echo "VPS at: $(git rev-parse --short HEAD)"          # expect b62cd33
git --no-pager log --oneline HEAD..origin/master       # expect only PR #41 commits + merge 04ab601
git --no-pager diff --name-only HEAD..origin/master -- server/prisma/migrations | grep migration.sql
#   → must be ONLY 20260818140000_email_verification/migration.sql

# 2. (optional, cheap) DB snapshot
sudo -u postgres pg_dump prima_pm | gzip > /root/prima_pm_$(date +%Y%m%d_%H%M).sql.gz

# 3. Deploy — one command: pull → build → migrate → restart → health-check + auto-rollback
sudo ./scripts/update-prod.sh
```

Verify:
```bash
curl -s -o /dev/null -w "health:%{http_code}\n" https://prismatix.tech/health
curl -s -o /dev/null -w "verify:%{http_code}\n" -X POST https://prismatix.tech/api/v1/auth/verify-email \
  -H 'Content-Type: application/json' -d '{}'                       # 400 = mounted
sudo -u postgres psql prima_pm -c \
  "select count(*) filter (where \"emailVerifiedAt\" is null) as unverified from \"User\";"   # → 0
```

> **VPS-verify gotcha:** a cached bundle can return a stale hash right after deploy — re-check with a
> cache-bust (`-H 'Cache-Control: no-cache'` + `?_cb=$(date +%s)`) before concluding "not deployed".

---

## C. Go-live: turn email ON (SMTP)

Do this **after** the code+migration are deployed. Once SMTP is set, the hard wall arms: new signups
must activate via the emailed link before they can log in. Existing users are already verified.

### Hostinger email (simplest for prismatix.tech)

1. hPanel → **Emails** → `prismatix.tech` → create `no-reply@prismatix.tech` (note the password).
   Hostinger auto-configures MX/SPF/DKIM — verify under Emails → Configuration.
2. Append to `server/.env` (on the VPS):
   ```
   SMTP_HOST=smtp.hostinger.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=no-reply@prismatix.tech
   SMTP_PASS=<mailbox password>
   MAIL_FROM=Prismatix <no-reply@prismatix.tech>
   APP_URL=https://prismatix.tech
   ```
   `MAIL_FROM` must use the mailbox domain (`@prismatix.tech`) so SPF/DKIM pass. Then fix perms:
   ```bash
   sudo chown root:prima server/.env && sudo chmod 640 server/.env
   ```
3. Test SMTP before restart (uses the installed nodemailer):
   ```bash
   cd /opt/prismatix/server && set -a; . ./.env; set +a
   node -e "require('nodemailer').createTransport({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT,secure:process.env.SMTP_SECURE==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}).sendMail({from:process.env.MAIL_FROM,to:'YOUR_INBOX@example.com',subject:'Prismatix SMTP test',text:'ok'}).then(i=>console.log('SENT',i.messageId)).catch(e=>console.error('FAIL:',e.message))"
   ```
   - `ETIMEDOUT/ECONNREFUSED` → outbound SMTP blocked; try port 587 (`SMTP_SECURE=false`) or ask
     Hostinger to open it. Quick reachability: `openssl s_client -connect smtp.hostinger.com:465 -crlf`.
   - `535 auth` → wrong user/pass.
4. Arm it:
   ```bash
   sudo systemctl restart prima-pm
   ```
5. End-to-end: register a fresh guest with an inbox you control → 202 "check your email" → click the
   `/verify-email` link → then login works.

### Alternative: a transactional provider (Resend / Brevo / SendGrid)
Same `SMTP_*` shape, swap in their SMTP host/credentials and verify the domain (SPF/DKIM) in their
dashboard. No app code changes.

### Env var reference

| var           | meaning                                              |
|---------------|------------------------------------------------------|
| `SMTP_HOST`   | SMTP server host — **arms the feature**              |
| `SMTP_PORT`   | 465 (SSL) or 587 (STARTTLS); default 587             |
| `SMTP_SECURE` | `true` for 465; else inferred from the port          |
| `SMTP_USER`   | SMTP auth user (full email address)                  |
| `SMTP_PASS`   | SMTP auth password                                   |
| `MAIL_FROM`   | `From:` header — must match the sending domain       |
| `APP_URL`     | base URL for links in emails (`https://prismatix.tech`) |

**Roll back / disable email:** unset `SMTP_HOST` and restart — the wall disarms instantly; the additive
migration needs no revert (old code tolerates the extra column + table).
