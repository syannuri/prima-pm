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

## Phase 0 — Foundations (no schema change)
- Ratify the 5 decisions above.
- Build the **cross-tenant leakage test harness**: helper that seeds 2 tenants + data and asserts
  every list/read/mutation from tenant A cannot see/touch tenant B (starts red; becomes the gate).
- Add a `MULTITENANCY_ENFORCE` feature flag (env) — default off.
- Pick the **default tenant** that will own ALL current data.

## Phase 1 — `Tenant` + `Membership` (additive, backfill, non-enforcing)
- New models: `Tenant(id, name, slug @unique, status, createdAt, …)`,
  `Membership(id, userId, tenantId, role, createdAt, @@unique([userId, tenantId]))`.
- Migration seeds ONE default `Tenant` and a `Membership` per existing user carrying their current
  `User.role`. `User.role` is kept (dual-read) — nothing removed.
- **No behaviour change.** Ships safely; everyone is in one tenant.

## Phase 2 — `tenantId` columns (nullable → backfill → NOT NULL)
- Add **nullable** `tenantId` to every tenant-owned model (roots + denormalized children).
- Backfill: roots → default tenant; children → their `Project.tenantId`.
- Follow-up migration flips to `NOT NULL` + FK + index once backfilled.
- `Project.code` → `@@unique([tenantId, code])`; `AppSetting` PK becomes `tenantId`.
- Still **no query enforcement** — data now carries tenantId but reads don't filter. Single-tenant
  behaviour is byte-identical. Ships safely.

## Phase 3 — Tenant context + Prisma extension (the safety net) ⟵ hardest phase
- **Auth:** add `tid` (active tenant) to the access-token payload (`jwt.ts` `AccessTokenPayload`).
  Login: 1 membership → auto-select; >1 → return a tenant list and require `/auth/switch-tenant`
  (re-mints the token with the chosen `tid` + that membership's role).
- **Context:** middleware reads `tid` from the verified token → `AsyncLocalStorage` store.
- **Prisma `$extends`:** for scoped models, auto-inject `where.tenantId`, stamp `tenantId` on
  create, and **throw if no tenant context** (fail-closed). Cron/system jobs run inside an explicit
  per-tenant context loop.
- Turn on behind `MULTITENANCY_ENFORCE` in staging; the Phase-0 leakage suite must go green.
- Remove the ad-hoc `personalOwnerId` filters that the extension now supersedes (carefully, one
  module at a time, each covered by the leakage suite).

## Phase 4 — Per-tenant roles (retire global `User.role`)
- `requireProjectAccess` / `requireProjectGovernance` / all role checks read the **membership role
  from tenant context**, not `User.role`.
- Token carries the active tenant's role. Admin UI: manage members per tenant (invite, set role,
  remove). `/users/directory` returns only the active tenant's members.
- Contract step: drop `User.role` once no reader remains.

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
