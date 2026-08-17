# Subscription Plans — Trial → PRO/ENTERPRISE (feature + quota tiering)

Status: PROPOSAL (2026-08-17). Target: replace the current **quota-only** plan gating
(FREE/PRO/ENTERPRISE differ only by projects/members/storage) with **feature + quota**
tiering, and convert FREE into a **60-day TRIAL** that walls off to a paid upgrade.

## Context / why
Today `lib/tenant/plans.ts` differentiates plans **only quantitatively** (`maxProjects`/
`maxMembers`/`storageMb`); every plan has the identical feature set. We want:
1. **Feature differentiation** across tiers (portfolio, forecasting, reporting hub, resourcing,
   approvals, integrations, AI, SSO, custom domain, governance).
2. **FREE → 60-day TRIAL**: new corporate workspaces get the full PRO experience for 60 days,
   then hit an **upgrade wall** (read-only) until they subscribe to PRO or ENTERPRISE.
3. SMB focus → **PRO is the money tier**; ENTERPRISE is light-touch (SSO/domain/governance/support).

## Key design decisions (defaults — flag any to change)
- **Trial = a plan value.** `TenantPlan` enum: **rename `FREE` → `TRIAL`**, keep `PRO`/`ENTERPRISE`.
  Add `Tenant.trialEndsAt DateTime?`. Trial state is derived:
  - **Active trial:** `plan===TRIAL && trialEndsAt != null && now < trialEndsAt`.
  - **Expired/locked:** `plan===TRIAL && (trialEndsAt == null || now >= trialEndsAt)`.
- **One wall for two cases.** A lapsed *paid* subscription downgrades to `plan=TRIAL, trialEndsAt=now`
  → immediately locked (NOT a fresh trial). So the expiry wall covers both "trial ended" and
  "subscription cancelled/expired" with one code path. (Replaces the billing memo's "downgrade to FREE".)
- **Trial grants the PRO feature set + PRO quotas** (let SMB feel the paid product). SSO/custom-domain
  stay ENTERPRISE-only, excluded from trial. `PLAN_LIMITS.TRIAL` = PRO limits (tunable).
- **Expiry behavior = FULL LOCKOUT** (user choice, 2026-08-17): an expired trial blocks **every**
  route with **402 Payment Required** EXCEPT a minimal allowlist — `/auth/*` (me/login/logout/refresh),
  the billing/upgrade routes, and tenant data export (GDPR). Even reads are blocked; the SPA renders an
  upgrade wall from the `/auth/me` lockout signal. Personal (guest) tenants are exempt.
- **No card up front.** Trial is app-managed (60 days from org signup); the LS checkout happens at the
  wall. `TRIAL_DAYS` is a live env read (default 60).
- **Personal (guest) tenants are exempt** from all plan/trial gating (they're `isPersonal`), same as
  today's quota exemption. The `default` tenant stays ENTERPRISE (unaffected).

## Feature matrix (mapped to real modules)
| Capability | TRIAL (60d) | PRO | ENTERPRISE |
|---|---|---|---|
| Projects / members / storage | 50 / 50 / 20 GB | 50 / 50 / 20 GB | ∞ / ∞ / ∞ |
| Core exec: charter, WBS/Gantt, tasks, RAID, stakeholders, requirements, cost + **basic EVM** | ✅ | ✅ | ✅ |
| Project report (screen) + CSV export | ✅ | ✅ | ✅ |
| Portfolio rollup + analytics | ✅ | ✅ | ✅ |
| Advanced forecasting (EAC scenarios) | ✅ | ✅ | ✅ |
| Reporting Hub (Exec/Portfolio/Analytics, cadence, branded PDF) | ✅ | ✅ | ✅ |
| Resource mgmt (capacity, timesheets, rate cards) | ✅ | ✅ | ✅ |
| Agile (sprints/backlog) | ✅ | ✅ | ✅ |
| Approval workflows | ✅ | ✅ | ✅ (multi-step matrices) |
| Team messaging (DM) | ✅ | ✅ | ✅ |
| Integrations (REST API, webhooks, automation, import, iCal) | ✅ | ✅ | ✅ (higher rate limits) |
| AI status narrative | ✅ | ✅ | ✅ |
| **SSO (Microsoft/Entra)** | — | — | ✅ |
| **Custom domain + branding** | — | — | ✅ |
| **Advanced governance** (audit retention, delegation/SLA) | — | — | ✅ |
| **Data export / GDPR + dedicated backup** | — | — | ✅ |
| Priority support / SLA | — | — | ✅ |

`PlanFeature` union: `portfolio | forecasting | reportingHub | resourceMgmt | agile | approvals |
messaging | integrations | ai | sso | customDomain | auditRetention`. (TRIAL & PRO share the same set;
ENTERPRISE adds the last four + unlimited quotas.)

## Phased build (each phase: own itest + rbac 125/125 + tsc; `feat/` branch → PR → LAN deploy)

### Phase 1 — Plan capability model (dormant, no behavior change) ✅ DONE (2026-08-17, branch `feat/subscription-trial-plans`)
Server: `plans.ts` gains `PlanFeature` + per-plan `features` set + `planAllows`/`planCapabilities`;
`quota.ts` gains dormant `assertFeature`; migration `20260817130000_subscription_trial` renames enum
`FREE`→`TRIAL`, adds `Tenant.trialEndsAt`, defaults plan TRIAL, backfills existing corporate trials
+60d. Client `FREE`→`TRIAL` rename across `api/types.ts`, `planLimits.ts`, `tenantStats.ts`, the two
console pages + 4 unit tests. **Verified:** plans unit 4/4, tenant-plan 3/3 (TRIAL caps at 50), billing
4/4, rbac 125/125, platform 15/15, org-signup 11/11; server tsc + client tsc/build all clean.
registerOrg still starts orgs on PRO (unchanged) — switches to TRIAL in Phase 2.

Original Phase 1 scope:
- `lib/tenant/plans.ts`: add `PlanFeature` union + `features: Set<PlanFeature>` to `PlanLimits`;
  rename `FREE`→`TRIAL`; define TRIAL/PRO/ENTERPRISE limits + feature sets (single source of truth).
- `lib/tenant/quota.ts`: `planAllows(plan, feature)` + `assertFeature(feature)` (enforcement-gated,
  `isPersonal`-exempt — mirror `assertCanCreateProject`). **Not wired into routes yet** (dormant).
- Migration `_subscription_trial`: `ALTER TYPE "TenantPlan" RENAME VALUE 'FREE' TO 'TRIAL'`;
  add `trialEndsAt`; set column default `plan = TRIAL`. **Backfill:** any existing corporate TRIAL
  (was FREE) tenant with null `trialEndsAt` → `now + TRIAL_DAYS` (don't lock existing users out).
- Update the 3 `PLAN_LIMITS.FREE` fallbacks → `TRIAL`; billing "downgrade to FREE" → TRIAL(expired).
- Unit tests for the matrix (`plans.test.ts`).

### Phase 2 — Trial lifecycle (provisioning + expiry wall) ✅ DONE (2026-08-17, branch `feat/subscription-trial-plans`)
`lib/tenant/trial.ts` (trialDays/newTrialExpiry/isTrialExpired/trialDaysLeft; **null deadline = NOT
walled** so bare/admin tenants aren't locked — the lapsed-sub case stamps a past deadline in Phase 4).
`registerOrg` now starts orgs on **TRIAL + trialEndsAt=+60d**. `PaymentRequired` (402) error helper.
Wall wired into `requireAuth` (enforcement + non-personal + expired + path not in `/api/v1/auth|billing`
→ 402). `/auth/me` gains a `workspace { plan, trialEndsAt, trialDaysLeft, trialExpired, capabilities }`
via `authService.activeWorkspace`. **Verified:** trial unit 4/4, subscription 4/4, tenancy-http 16/16,
rbac 125/125, platform 15/15, org-signup 11/11, tenant-plan 3/3, billing 4/4; server tsc clean.
NB: prod is safe pre-Phase-3 — the migration backfilled every existing corporate trial +60d, so nothing
is walled for 60 days even before the client wall UI ships.

Original Phase 2 scope:
- `auth.service.registerOrg`: set `plan=TRIAL, trialEndsAt = now + TRIAL_DAYS` on the new tenant.
- `assertTrialActive()` (new, enforcement-gated, `isPersonal`-exempt): on an expired trial, reject
  with **402** UNLESS the request path is on a minimal allowlist (`/auth/*`, billing/upgrade, tenant
  export). Full lockout — reads included. Wire into `requireAuth` alongside `assertNotFullySuspended`.
- `/auth/me` + login responses expose `plan`, `trialEndsAt`, `trialDaysLeft`, `capabilities: PlanFeature[]`.
- itests (`subscription.itest.ts`): new org → 60-day trial; expired trial → mutation 402 / read 200 /
  billing reachable; personal tenant unaffected; PRO tenant never walled.

### Phase 3 — Enforce feature gates + client gating ✅ DONE (2026-08-17, branch `feat/subscription-trial-plans`)
Server: custom domains gated to ENTERPRISE — the platform PATCH refuses `customDomain` unless the
tenant's EFFECTIVE plan (new plan if the same PATCH upgrades, else current) `planAllows('customDomain')`.
Client: `AuthContext` now carries `workspace` (from /auth/me) + a `hasFeature(f)` helper; `TrialBanner`
(slim countdown strip, urgent in the final week → Upgrade CTA); `UpgradeWall` (full-screen block when
`trialExpired`, billing route + logout stay reachable); the api client dispatches a `trial-expired`
event on any 402 so the wall renders mid-session. Both mounted in `Layout`. **Verified:** tenant-host
14/14 (incl. ENTERPRISE-only gate: 403 on TRIAL, 200 when same PATCH upgrades), subscription 4/4, rbac
125/125, platform 15/15, org-signup 11/11, tenant-plan 3/3; server + client tsc/build clean.
Note: `assertFeature` (server) + `hasFeature` (client) are available for the other ENTERPRISE-only
features (sso, auditRetention) once those get per-tenant surface — deferred, no enforcement point yet.

Original Phase 3 scope:
- Wire `assertFeature(...)` at the entry of the gated modules — ENTERPRISE-only: SSO login availability
  (Microsoft OIDC per-workspace), custom-domain PATCH, audit retention window. (TRIAL/PRO share the rest,
  so most modules stay open; the gate mainly bites at ENTERPRISE features + the expiry wall.)
- Client: consume `capabilities` from `/auth/me` → hide/lock ENTERPRISE-only surfaces + show upgrade
  prompts; a **trial countdown banner** ("N days left in trial") with an Upgrade CTA; an **upgrade-wall**
  screen shown when writes 402. Add to `AuthContext`.
- itests per gated feature (ENTERPRISE key 200, non-ENTERPRISE 403) + rbac 125/125.

### Phase 4 — Billing wiring (dormant until Lemon Squeezy store is live)
- Define LS variants for **PRO** + **ENTERPRISE** (monthly/annual); map `lsVariantId → plan` in billing.
- Webhook: `subscription_created/updated/active` → set `plan` + clear `trialEndsAt`;
  `expired`/`cancelled` (past `endsAt`) → `plan=TRIAL, trialEndsAt=now` (locked wall).
- Self-serve **Upgrade** CTA from the banner + wall → LS checkout; platform-console plan column already
  exists. Ships **dormant** (webhook 503 until `LEMONSQUEEZY_*` env set — existing blocker, see
  docs/BILLING-GOLIVE.md).

### Phase 5 (optional) — polish
- Trial reminder notifications (in-app / email at T-14 / T-3 / T-0).
- Platform console: trial column + "extend trial" admin action; conversion analytics.

## Verification
- Server: `npm run test:integration` (pins enforce=false; tenancy suites toggle it) — new
  `subscription.itest.ts` + `plans.test.ts` green; rbac 125/125; `npm run build` clean.
- Manual (LAN, enforce-ON): org-signup → confirm `trialDaysLeft≈60` on `/auth/me`; force
  `trialEndsAt` into the past on a throwaway tenant → confirm writes 402 + reads 200 + banner/wall;
  PATCH plan→PRO clears the wall. Clean up throwaways (LAN :4000 is the live DB).
- Billing (Phase 4) verified dormant: webhook 503 without env; variant→plan mapping unit-tested.

## Open decisions to confirm
1. **Trial length** = 60 days (env `TRIAL_DAYS`). ✅ per user.
2. **Expiry = read-only wall** (vs full block). Default: read-only.
3. **Trial feature level = PRO** (vs full incl. ENTERPRISE). Default: PRO (upsell SSO/domain).
4. **Existing FREE corporate tenants** (if any on prod) → granted a fresh 60-day trial on deploy.
