# Pooled Multitenancy — Phased Migration Plan

Status: PROPOSAL (2026-07-29). Target: move from **single-tenant + guest sandboxes** to
**pooled multitenancy** (one shared database, many isolated organizations) — incrementally,
with every phase independently shippable and reversible.

> Today the app is single-tenant. The only isolation is `personalOwnerId` (per-user GUEST
> sandboxes). Multi-customer is achieved by **separate instances** (LAN box, Hostinger VPS).
> There are **0 `tenantId` columns** across 43 models. See the assessment that preceded this plan.

## Guiding principles
- **Expand → migrate → contract.** Every change is additive first (nullable column, dual-read),
  backfilled, then enforced, and only later does anything get dropped. No big-bang.
- **Every phase deploys on its own** and is a no-op for the (single) existing tenant until
  enforcement is switched on.
- **Enforcement lives in one place** (a Prisma Client extension + request-scoped tenant context),
  not sprinkled across ~200 queries — the current ad-hoc `personalOwnerId` filtering is exactly
  the leakage risk we must remove.
- **Isolation is tested, not assumed:** a dedicated cross-tenant leakage test suite gates each phase.

## Key architectural decisions (settle in Phase 0)
1. **Identity vs membership.** Keep `User` as a **global identity** (email stays globally unique,
   SSO-friendly) and add **`Membership(userId, tenantId, role)`**. This lets one person belong to
   several tenants (PMO/consultants across orgs) — the right model for the PM domain. The global
   `User.role` is retired in favour of the per-tenant membership role.
2. **Isolation depth.** Denormalize **`tenantId` onto every tenant-owned model** (not just roots),
   backfilled from the owning `Project`. This makes the Prisma extension uniform and gives
   defense-in-depth, at the cost of a wider (but mechanical) backfill. Child `@@unique([projectId, …])`
   constraints already isolate via project, so they need no change.
3. **Scoping mechanism.** Request-scoped tenant context via **`AsyncLocalStorage`** + a **Prisma
   `$extends`** that (a) injects `where: { tenantId }` on read/update/delete/aggregate/count for
   scoped models and (b) stamps `tenantId` on create, and (c) throws if a scoped model is queried
   with no tenant context. Fail-closed.
4. **Guests.** Decide early: fold the `personalOwnerId` sandbox into the tenant model (each guest =
   a personal tenant) so there is ONE isolation mechanism, not two. Retiring `personalOwnerId` is a
   later contract step, not a blocker.
5. **Existing deployments.** LAN box and VPS each become a tenant only if you consolidate onto one
   pooled instance (a data-merge migration). Otherwise they stay silo and pooled is for NEW customers.

## Models — where `tenantId` goes
- **Root (must carry `tenantId` directly):** `Project`, `Resource`, `RateCard`, `AppSetting`
  (singleton → one row per tenant), `Conversation`, `Message`, `ConversationMember`,
  `MessageReaction`, `PushSubscription`, `Notification`, `AuditLog`, `ProjectBookmark`.
- **Project-children (get denormalized `tenantId`, backfilled from `Project`):** `ProjectCharter`,
  `CharterVersion`, `CostItemDirect/Indirect`, `CostBaseline`, `ActualCostEntry`, `MandayEntry`,
  `Risk`, `Issue`, `Stakeholder`, `Procurement`, `Assumption`, `ProjectDependency`, `Task`,
  `TaskDependency`, `ChangeRequest`, `Attachment`, `Sprint`, `SprintSnapshot`, `EvmSnapshot`,
  `BacklogItem`, `LessonLearned`, `AcceptanceSignoff`, `UatTestCase`, `KickoffMeeting/Attendee/
  ActionItem`, `Requirement`, `RequirementTaskLink`.
- **Identity / global (NO tenantId):** `User`, `RefreshToken` (belongs to the user identity).
- **Unique constraints to change:** `Project.code @unique` → `@@unique([tenantId, code])`. `User.email`,
  `googleSub`, `PushSubscription.endpoint` stay global. All `@@unique([projectId, …])` unchanged.

---

## Phase 0 — Foundations (no schema change) ✅ DONE (2026-07-30)
- Ratify the 5 decisions above. — **Ratified as written** (global `User` + `Membership`;
  denormalized `tenantId` everywhere; `AsyncLocalStorage` + Prisma `$extends`, fail-closed;
  guests fold into personal tenants; existing LAN/VPS stay silo unless a later data-merge).
- Build the **cross-tenant leakage test harness**: helper that seeds 2 tenants + data and asserts
  every list/read/mutation from tenant A cannot see/touch tenant B (starts red; becomes the gate).
  — `server/src/test/tenancy.harness.ts` (`seedGuestOrg` + `expectIsolated`) driven by
  `server/src/modules/__itests__/tenancy-leakage.itest.ts`. Runs GREEN today against the guest
  sandbox (the only isolation that exists), guarding it from regression; the corporate-tenant
  block is gated behind the flag and arms in Phase 3.
- Add a `MULTITENANCY_ENFORCE` feature flag (env) — default off. — `env.multitenancy.enforce`
  in `server/src/config/env.ts`.
- Pick the **default tenant** that will own ALL current data. — `slug='default'`, `name='PRIMA'`
  in `server/src/lib/tenant/constants.ts` (the Phase-1 seed + Phase-2 backfill anchor).

## Phase 1 — `Tenant` + `Membership` (additive, backfill, non-enforcing) ✅ DONE (2026-07-30)
- New models: `Tenant(id, name, slug @unique, status, createdAt, …)`,
  `Membership(id, userId, tenantId, role, createdAt, @@unique([userId, tenantId]))`.
  — added to `schema.prisma` (+ `TenantStatus` enum, `User.memberships` relation); migration
  `20260730133521_tenant_membership`.
- Migration seeds ONE default `Tenant` and a `Membership` per existing user carrying their current
  `User.role`. `User.role` is kept (dual-read) — nothing removed. — seed embedded in the migration
  SQL (idempotent `ON CONFLICT DO NOTHING`); mirrored programmatically by
  `lib/tenant/backfill.ts` (`backfillDefaultTenant`) and regression-tested by
  `tenant-backfill.itest.ts`. Verified on dev (21 users → 21 memberships, 0 role mismatch) + test DB.
- Also declared the two pre-existing `Procurement` FK indexes in the schema (drift fix) so
  `migrate dev` stopped trying to drop them; no DB change (they already exist).
- **No behaviour change.** Ships safely; everyone is in one tenant.

## Phase 2 — `tenantId` columns (nullable → backfill → NOT NULL)
Split into **2a (expand)** and **2b (contract)** per the expand-migrate-contract rule.

### Phase 2a — nullable `tenantId` + FK + backfill ✅ DONE (2026-07-30)
- Added nullable `tenantId` + `tenant Tenant?` relation to **all 41 tenant-owned models** (12 roots
  + 29 project-children/grandchildren) and the matching back-relations on `Tenant`. Migration
  `20260730135548_tenant_id_columns`.
- **Deviation (noted):** the FK is added here (nullable) rather than in 2b, so Prisma manages
  referential integrity from the start and we declare the relation once. `@@index([tenantId])` and
  `NOT NULL` are still deferred to 2b.
- Backfill (in the migration): roots → default tenant; project-children → their `Project.tenantId`;
  grandchildren (TaskDependency, Attachment, SprintSnapshot, Kickoff{Attendee,ActionItem},
  RequirementTaskLink) → their already-stamped parent. Guarded by `IS NULL` (idempotent).
- **Finding:** a legacy orphaned `Attachment` (owner deleted, null `projectRelId`) can't resolve via
  FK. Since all current data belongs to the ONE existing org, 2b adds a universal *still-NULL →
  default tenant* sweep before the NOT NULL flip. 2a leaves the column nullable, so this is fine.
- Verified: full integration suite (235 tests) + tenancy itests green; single-tenant behaviour
  unchanged (nothing filters by tenant yet).

### Phase 2b — `@@index([tenantId])` on all scoped models ✅ DONE (2026-07-30)
- Added `@@index([tenantId])` to all 41 scoped models. Migration `20260730142133_tenant_id_indexes`
  (index-only; nothing else). tenantId stays **nullable**. Verified: full suite (235) + build green.

> **Ordering correction (important).** The original plan put `NOT NULL` + the unique swaps here.
> That is unsafe *before* the app stamps `tenantId` on inserts: making the column required broke
> **91 `create()` call-sites** at compile time (nothing sets tenantId until the Phase-3 Prisma
> extension does). So the contract steps below move to **Phase 3**, bundled with the create-stamping
> extension that makes them safe. Phase 2 stays purely additive (columns + FK + index + backfill),
> zero behaviour change.

### Phase 2c / early Phase 3 — the contract (deferred, runs WITH create-stamping)
- Straggler sweep (incl. the orphaned attachment) → default tenant; assert **zero** nulls.
- Flip every `tenantId` to `NOT NULL` (+ required relation) — only after the extension stamps
  tenantId on every create, so no insert can produce a null.
- `Project.code` → `@@unique([tenantId, code])` (+ switch the 2 clash-checks to `findFirst`);
  `AppSetting` gains a per-tenant unique (its singleton `id` PK stays until it's read per-tenant).

## Phase 3 — Tenant context + Prisma extension (the safety net) ⟵ hardest phase
Split into **3a (the extension core)**, **3b (auth + middleware wiring)**, **3c (contract)**,
**3d (de-scatter personalOwnerId)**.

### Phase 3a — tenant context + Prisma extension ✅ DONE (2026-07-30)
- **Context:** `lib/tenant/context.ts` — `AsyncLocalStorage` store with `runWithTenant(tenantId, fn)`
  and `runAsSystem(fn)` (explicit cross-tenant bypass). The callback is `await`ed *inside* the ALS
  scope because Prisma promises are lazy (execute at await time) — otherwise the extension would see
  no context and fail-closed.
- **Extension:** `lib/tenant/extension.ts` — for the 41 scoped models (`lib/tenant/scopedModels.ts`)
  it injects `where.tenantId` on read/update/delete/count/aggregate/groupBy, and stamps `tenantId` on
  create — **including nested writes**, resolved via the DMMF relation map so only scoped children are
  stamped (covers `Conversation.create({ members: { create } })`). By-id ops (findUnique/update/delete)
  are scoped too — verified Prisma 6.19 honours an injected non-unique `tenantId` in a findUnique
  `where`. **Fail-closed:** a scoped query with no context throws. Applied unconditionally in
  `lib/prisma.ts`; gated by `MULTITENANCY_ENFORCE` (live-read) so it is a **no-op when off**.
- The extended client changed the exported type → added `Db`/`TxClient` aliases in `lib/prisma.ts`
  and pointed `cost`/`baseline`/`backfill` at them.
- **Verified:** `tenant-extension.itest.ts` (8 tests, flag ON) proves read/write isolation,
  create-stamping incl. nested, fail-closed, `runAsSystem` bypass, global models untouched. Full
  suite with flag OFF: **243 pass** (no regressions — extension is a true no-op). Build green.

### Phase 3b — auth `tid` + request middleware ✅ DONE (2026-07-30)
- **Auth:** `tid` added to the access-token payload (`jwt.ts`). `issueTokenPair` resolves the active
  tenant (chosen tenant if a membership, else the first by createdAt) and embeds it, so login /
  refresh / google / guest-register all mint tenant-pinned tokens. New self-service users get a
  default-tenant `Membership` (`ensureDefaultMembership`). `GET /auth/tenants` lists memberships;
  `POST /auth/switch-tenant` re-mints the pair pinned to another of the caller's tenants (rejects a
  non-membership).
- **Middleware:** `requireAuth` reads `tid` → `bindTenantContext(tid, () => next())` runs the whole
  downstream chain in the tenant's ALS scope — but only when `MULTITENANCY_ENFORCE` is on and the
  token carries `tid`, so single-tenant/off behaviour is unchanged.
- **Audit fix:** `writeAudit` self-heals — stamps the ambient tenant when in a request, else
  `runAsSystem` (so context-less auth/system audits don't hit the fail-closed extension). Cron's
  per-tenant loop is still Phase 5.
- **Verified:** `tenancy-http.itest.ts` (6 tests, flag ON) proves the full stack — login embeds
  `tid`, list/read/mutate isolated between two corporate ADMIN tenants (so only the extension can be
  what isolates), and `switch-tenant` re-scopes + rejects non-members. Full suite flag OFF: **249
  pass**, no regressions. Build green.

### Staging soak (local enforce-on, 2026-07-30)
Ran `dist/server.js` with `MULTITENANCY_ENFORCE=true` against the migrated+backfilled dev DB (on a
side port, real dev server untouched). Findings:
- ✅ Every authenticated request path works: `/auth/me`, `/projects`, `/portfolio`, `/users`,
  `/users/directory`, `/ratecards`, `/resources`, `/notifications`, `/bookmarks`, `/messages`,
  `/admin/audit`, `/admin/settings`, `/me/timesheet`, and per-project cost/risk/schedule/charter/
  stakeholders/forecast — all 200 (context established by `requireAuth`). A live risk create was
  correctly stamped with the caller's `tenantId`. **Zero** fail-closed errors on any request path.
- ✅ **FIXED (was a blocker) — EVM auto-capture cron.** It ran OUTSIDE any request (no tenant
  context) so its first `AppSetting.findUnique` fail-closed. Now `runWeeklyAutoCaptureIfDueAllTenants`
  fans out over every ACTIVE tenant inside `runWithTenant` under enforcement (single global run when
  off — unchanged). Re-soak: startup shows **zero** fail-closed errors. Guarded by
  `tenant-cron.itest.ts` (flag ON). This was the Phase-5 "cron iterates per tenant" item, pulled
  forward because it gated enforce-on.

### 🟢 ENFORCEMENT LIVE on LAN prod (2026-07-30)
Turned on via a **staged** rollout on the LAN box (`/home/mamed`, `prima_pm` — the live DB):
Step 1 deployed current `master` with the flag OFF (all no-op) and verified healthy; Step 2 set
`MULTITENANCY_ENFORCE=true` + restart. The flag is a **reversible kill-switch** (false + restart).
- **Transition fix (found during the flip):** existing sessions carry a token with no `tid`, which
  fail-closed to a **500** on scoped routes — and a 500 doesn't trigger the client's refresh. Fixed:
  `requireAuth` now returns **401** for a no-`tid` token under enforcement → the client auto-refreshes
  → `/auth/refresh` re-mints a tenant-pinned token → retry succeeds. Seamless, no forced logout.
- **Verified live:** 15 scoped endpoints 200 with a `tid` token; no-`tid` → 401; zero fail-closed in
  the service log. The single default tenant means AppSetting-singleton etc. behave normally.
- **NOT yet on the VPS** (`prismatix.tech`, `/opt/prismatix`) — a separate deploy; enable there with
  its own `update-prod.sh` + flag when ready.

### Enforce-on prerequisites (before turning the flag on in a real deployment)
1. Deploy code + `prisma migrate deploy` on that env (creates Tenant/Membership + tenantId columns +
   backfill) — no remote env has the tenant migrations yet.
2. ~~Fix the EVM auto-capture cron~~ — DONE (per-tenant fan-out).
3. Expect a one-time re-auth: tokens minted before this carry no `tid`, so scoped queries fail-closed
   until the 15-min access token refreshes (refresh re-mints with `tid`).

### Phase 3c — per-tenant uniques ✅ DONE & LIVE (2026-07-31)
- `Project.code` → `@@unique([tenantId, code])` (two orgs can reuse a code) + the 2 clash-checks
  switched to `findFirst`; `AppSetting` → `@@unique([tenantId])`. Migration
  `20260731000000_tenant_per_tenant_uniques` (3 index statements); applied to prod + test DB.
  Safe with nullable tenantId (enforcement stamps every row; Postgres NULLs are distinct).
- **`tenantId` NOT NULL is DEFERRED (deliberate):** making the Prisma field required breaks **~99
  create-sites** — the extension injects `tenantId` at runtime, which TypeScript can't see; the only
  ways around it are threading tenantId through 99 sites (defeats the extension) or a poison
  `@default(dbgenerated())` on a FK column (fragile). The fail-closed extension already guarantees
  non-null on every real insert, so the DB NOT NULL is marginal defense-in-depth not worth the churn.
  `AuditLog` would have to stay nullable regardless (auth-flow audits are context-less by design).
- **Test-hygiene fix shipped alongside:** `test:integration` now pins `MULTITENANCY_ENFORCE=false`
  (the suite loads `server/.env` via dotenv, and prod's `.env` has the flag ON — which had made the
  whole suite run under enforcement and fail on no-`tid` test tokens). The 3 tenancy suites toggle it
  on themselves.
- **Known follow-up:** under enforcement, auth-flow audits (login/logout/password) are written with
  no tenant context → null tenantId → they don't appear in the (scoped) `/admin/audit` view. Decide
  whether to stamp them with the user's active tenant.

### Phase 3d — remove ad-hoc `personalOwnerId` filters the extension now supersedes
- Carefully, one module at a time, each covered by the leakage suite.

## Phase 4 — Per-tenant roles (retire global `User.role`)

### Phase 4a — role from the active membership ✅ DONE (2026-07-30)
- `issueTokenPair` embeds the EFFECTIVE role: the active tenant's `Membership.role` under
  enforcement, else the global `User.role` (single-tenant behaviour unchanged). `switch-tenant`
  therefore also switches role.
- `requireAuth` resolves the role FRESH from the membership for the active tenant (not trusted from
  the token — so a token can't escalate) when enforcement is on; a token whose membership was revoked
  is rejected. `/auth/me` reports this effective role. All existing `requireRole` /
  `requireProjectAccess` checks now read the per-tenant role via `req.user.role` with no change.
- **Verified:** `tenancy-http.itest.ts` — same user is ADMIN in tenant A / VIEWER in tenant B
  (tokens forged as ADMIN in both, yet `/admin/audit` gives 200 in A, 403 in B; `/auth/me` reports
  the right role each). Full suite flag OFF: **251 pass**; build green.

### Phase 4b — tenant-scoped user administration ✅ DONE (2026-07-30)
- `/users/directory` and `GET /users` filter to the active tenant's members
  (`memberships.some({ tenantId })`) under enforcement — closes the cross-tenant user-enumeration
  leak (`User` is global, so the extension can't do this; scoped explicitly in the route).
- Every mutating user-admin endpoint (`role`/`active`/`profile`/`password`/`delete`) asserts the
  target is a member of the caller's active tenant (404 otherwise) — an admin of tenant A can't
  touch tenant B's people.
- Role changes and admin-created users are mirrored into the active (or default) tenant's
  `Membership` (`upsertMembershipRole`), so the per-tenant role stays in sync with `User.role`
  (dual-write until 4c). All flag-gated: off ⇒ single-tenant behaviour unchanged.
- **Verified:** `tenancy-http.itest.ts` — directory/list exclude a non-member, and a tenant-A admin
  gets 404 administering a tenant-B-only user. Full suite flag OFF: **253 pass**; build green.
- **Member-management API ✅ DONE (2026-07-30):** `/members` module (ADMIN, active tenant) —
  `GET` list members with per-tenant role, `POST` add an existing user by email, `PATCH /:userId`
  set role, `DELETE /:userId` remove (guards: not self, never the tenant's last admin; global `User`
  untouched). Verified in `tenancy-http.itest.ts`. A members **UI** is still pending.

### Phase 4c — contract: drop `User.role`
- Once no reader remains (all role checks use the membership), remove `User.role`.

### Phase 4c — contract: drop `User.role`
- Once no reader remains (all role checks use the membership), remove `User.role`.

## Phase 5 — Cross-cutting & platform
- **Per-tenant sequences:** `PRJ-YYYY-####`, `PRC-###`, etc. scoped by tenant.
- **Attachments/uploads** namespaced by `tenantId` (path prefix + quota); storage limit per tenant.
- **EVM auto-capture cron** (`AppSetting.evmAutoCapture*`) iterates per tenant instead of globally.
- **Guests:** convert `personalOwnerId` sandboxes into personal tenants; retire `personalOwnerId`.
- **Platform/super-admin console:** create/suspend tenants, provisioning, impersonation (audited).
- Per-tenant rate limits & quotas.

## Phase 6 — Tenant lifecycle / SaaS
- Self-serve signup → creates `Tenant` + owner `Membership`.
- Tenant settings, branding, **subdomain/custom domain** (tenant `slug` → host), plan/billing gating.
- Per-tenant data export, deletion (GDPR), and backup.

---

## Cross-cutting engineering practices
- Expand-migrate-contract on **every** column/constraint; dual-read until backfilled.
- Isolation test suite runs in CI and is the merge gate for Phases 3–5.
- Audit every mutation with `tenantId`.
- Dark-launch enforcement via the flag; keep a kill-switch until confidence is high.

## Codebase-specific gotchas
- ~20 `@@unique([projectId, …])` are **already tenant-safe** (project is tenant-scoped) → minimal change.
- Non-project roots needing explicit tenantId: `AppSetting` (singleton!), `AuditLog`, `Notification`,
  and all messaging models (`Conversation`/`Message`/`ConversationMember`/`MessageReaction`/`PushSubscription`).
- Two overlapping isolation mechanisms during transition (`personalOwnerId` + `tenantId`) — converge to
  one (tenants) to avoid confusion and leakage.
- `email @unique` / `googleSub @unique` stay global (identity); do NOT scope them per tenant.
- Consolidating the existing silo deployments (LAN + VPS) is a **separate data-merge migration**, not
  part of the core refactor.

## Rough effort (engineering, not calendar)
| Phase | Scope | Relative effort |
|------|-------|-----------------|
| 0 | Decisions + leakage harness + flag | S |
| 1 | Tenant + Membership + backfill | S–M |
| 2 | tenantId everywhere + backfill + uniques | M |
| 3 | Context + Prisma extension + auth + de-scatter | **L (highest risk)** |
| 4 | Per-tenant roles, retire User.role | M |
| 5 | Sequences, uploads, cron, guests, super-admin | M–L |
| 6 | SaaS lifecycle (signup, domains, billing) | L (product-driven) |

**Recommendation:** do Phases 0–2 first (cheap, safe, no behaviour change) to lay the rails, then
invest heavily in Phase 3 with the leakage suite as the gate. Do not attempt Phase 3 without the
Prisma extension — per-query scoping by hand will leak.
