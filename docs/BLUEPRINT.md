# 📐 BLUEPRINT — Integrated Project Management Web Application
### "Prismatix" — Contribute to Project Management Community
**Version:** 1.0 (As-Built · Delivered & live in production) · **Date:** 2026-07-09 · **Prepared by:** Achmad Syannuri, PMP,PRINCE2,PSM

> **Status:** This document began as the v0.1 design draft (2026-06-27). It has been updated
> to reflect what was **actually built and is running in production**. Where the delivered
> implementation diverged from the original plan, the *as-built* choice is recorded and the
> reason noted. Internal identifiers remain `prima*` (repo dir, DB `prima_pm`, systemd unit,
> `prima_*` localStorage keys); **"Prismatix"** is the user-facing brand (PRIMA → Precise → Prismatix).

---

## 1. EXECUTIVE SUMMARY

A multi-project, multi-user web application that operationalizes the PMBOK knowledge areas
(Integration, Scope, Cost, Risk, Schedule, Resource) into a single integrated tool — delivered
end-to-end across the full delivery lifecycle: **Charter → WBS/Schedule → Cost → Risk → Change
Control → EVM/Forecast → Closure**, for **Predictive, Agile and Hybrid** projects.

**Core principle — Single Source of Truth & Integration:**
The modules are **not** isolated forms. They are linked through a shared, lockable baseline:

```
PROJECT CHARTER (baseline, committed/locked; delivery approach chosen at initiation)
        │  high-level cost & schedule become the budget/time envelope
        ▼
COST MANAGEMENT ──── Manpower (rate × mandays) ──┐
        ▲                                         │  task ↔ manpower link + owner prefill
        │                                         ▼
RISK MANAGEMENT (EMV) ─► Contingency Reserve   SCHEDULE MANAGEMENT (WBS) / AGILE BACKLOG
        │                                         │  (% progress or story points, actual dates)
        └────────► COST BASELINE = Direct + Indirect + Contingency  (= PMB = BAC)
                                  │
                                  ▼
     EVM ENGINE (PV, EV, AC → CPI, SPI, EAC/VAC) — methodology-aware  ← Dashboard · Reporting Hub
```

| Decision | As-built |
|---|---|
| Scope | Multi-project + multi-user with RBAC (7 roles) |
| Delivery methodologies | **Predictive (WBS/Gantt) · Agile (backlog/sprints/board) · Hybrid (blended EVM)** |
| Stack | React 18 + Vite + Node/Express + PostgreSQL + Prisma |
| Quantitative Risk | EMV (Expected Monetary Value) → contingency reserve |
| Localization | Currency IDR · UI English (bilingual EN/ID greeting + public landing) |
| Deployment | Single Node process serves API **and** built SPA on one port; systemd; nginx TLS |

---

## 2. TECHNOLOGY ARCHITECTURE (as-built)

### 2.1 Stack
| Layer | Technology (delivered) | Notes vs v0.1 plan |
|---|---|---|
| Frontend | **React 18 + Vite + TypeScript** | as planned |
| UI | **Tailwind CSS v3** (hand-built accessible components) | *shadcn/ui not used* — bespoke `ui.tsx` primitives + dark-mode-first design system |
| State/Data | **TanStack Query** (+ light React context) | *Zustand not needed* — server-cache + context sufficed |
| Charts | **Custom SVG/Recharts-style** KPI/EVM/S-curve + a **custom pointer-event Gantt** | *frappe/dhtmlx-gantt dropped* — a lightweight custom Gantt (drag-reschedule, dependency links) fit the data model better |
| Backend | **Node.js + Express + TypeScript** | as planned |
| ORM | **Prisma v6** (pinned) | as planned |
| Database | **PostgreSQL 16+** | money as `Decimal`/`NUMERIC` |
| Auth | **JWT access + rotating refresh, server-side revocation (token version)**; **bcrypt** (cost 12) | *bcrypt, not argon2* — cost-12 bcrypt met the policy with zero native-build friction |
| Validation | **Zod** (shared FE/BE) | as planned |
| Export | **PDFKit** (PDF) + **ExcelJS** (xlsx) | *pure-JS PDFKit, not Puppeteer* — no headless Chromium in prod; corporate-styled report + portfolio PDFs |
| Testing | **Vitest + Supertest + Playwright** | as planned; CI gates all three |
| Deploy | **systemd unit + nginx TLS reverse proxy** (Docker Compose for local dev DB) | single-origin; loopback-bound behind the proxy |

### 2.2 High-Level Topology
```
[ React SPA ]  ⇄  [ Express REST API /api/v1 ]  ⇄  [ PostgreSQL ]
   (served by       │
    same Node        ├─ Auth/RBAC middleware (JWT + per-request account revalidation)
    process)         ├─ Pure calculation core (money · cost rollup · risk EMV · EVM)
                     ├─ Audit-trail interceptor (append-only)
                     └─ Export service (PDFKit / ExcelJS)

Production:  [ browser ] ──https──▶ [ nginx :443 ] ──▶ [ Node :PORT bound 127.0.0.1 ]
```
A single Node process serves the **API and the built React app** from one port, so the client's
relative `/api/v1` calls need no proxy or CORS in the app itself.

---

## 3. ROLES & ACCESS CONTROL (RBAC) — 7 roles

`ADMIN` · `PMO` · `PROJECT_MANAGER` · `FINANCE` · `RISK_OFFICER` · `TEAM_MEMBER` · `VIEWER`

| Role | Charter | Cost | Risk | Schedule/Agile | Closeout | Admin |
|---|---|---|---|---|---|---|
| **Admin/PMO** | CRUD + approve + govern lifecycle | View/audit | View/audit | View/audit | View/approve | Users, resources, rate cards |
| **Project Manager** | Create/Edit/Commit (own) | CRUD (own) | CRUD (own) | CRUD (own) | CRUD (own) | — |
| **Finance/Cost Controller** | View | CRUD cost, baseline | View | View | View | Rate card |
| **Risk Officer** | View | View | CRUD risk | View | View | Risk config |
| **Team Member (PIC)** | View | log own timesheet | Suggest risk | Update progress on assigned tasks | — | — |
| **Viewer/Sponsor** | View | View | View | View | View | — |

> **Ownership rule (enforced at the API layer):** PM sees own projects; PMO/Admin/Finance/Risk
> see all (functional roles bypass ownership where appropriate). Every project-scoped route
> re-scopes nested queries by `projectId` (no IDOR). Lifecycle governance (activate/close/hold,
> baseline unlock, force-close/activate) is **ADMIN/PMO only** and audited.

---

## 4. DATA MODEL (core entities — see `docs/ERD.md` for the full ERD)

```
User(id, name, email, passwordHash, role, isActive, tokenVersion, changesSeenAt)
Project(id, code, name, sponsor, status, deliveryApproach, pmUserId,
        baselineLockedAt, scheduleBaselinedAt, onHoldReason,
        closedAt, closedById, closureNote, createdAt)
   status ∈ {DRAFT, CHARTERED, IN_PROGRESS, ON_HOLD, CLOSED}   (terminal: CLOSED)
   deliveryApproach ∈ {PREDICTIVE, AGILE, HYBRID}

ProjectCharter(id, projectId, description, goals, category, hiScope, hiCost,
   hiScheduleStart, hiScheduleEnd, hiDeliverables, pmUserId, committedAt/By, version, locked)

-- COST --
CostItemDirect(id, projectId, type, taskId?, resourceId?, ...)      -- Material | Manpower
CostItemIndirect(id, projectId, type, description, amount)
ActualCostEntry(id, projectId, date, amount)                       -- time-phased AC (manual)
RateCard(id, roleName, level, unitCostPerManday)
CostBaseline(projectId, directTotal, indirectTotal, contingencyReserve,
             managementReserve, costBaseline(=PMB), budgetAtCompletion(=PMB+MR))

-- RISK --
Risk(id, projectId, code, title, category, status, ownerUserId,
     probabilityScore(1-5), impactScore(1-5), riskScore(=P×I), severity,
     probabilityPct(0-1), impactCostIdr, emv(=prob×impact), responseStrategy,
     responseCost, residualEmv, includeInReserve)

-- SCHEDULE (predictive) --
Task(id, projectId, parentTaskId?, wbsCode, name, plan/actual dates,
     picResourceId?/picUserId?, progressPct, predecessors[], isMilestone,
     baselineStart/baselineEnd)                                    -- link: task ↔ Manpower cost line

-- AGILE / HYBRID --
BacklogItem(id, projectId, title, storyPoints, status, assigneeId?, sprintId?)
Sprint(id, projectId, name, goal, startDate, endDate)  +  SprintSnapshot (burndown)
EvmSnapshot(projectId, statusDate, pv, ev, ac, ...)                -- EVM/portfolio trend history

-- CLOSEOUT --
LessonLearned(id, projectId, category, title, details, createdById)
AcceptanceSignoff(id, projectId, party, decision, signer, date, comments, recordedById)

-- GOVERNANCE / SUPPORT --
ChangeRequest(id, projectId, type, description, status, amount?, requestedBy, reviewedBy, decidedBy)
Issue(id, projectId, title, category, impact, ownerId?, resolution, status)
Attachment(id, projectId, entity, storedName, mime, size, uploadedById)
Notification(id, userId, type, payload, readAt)                    -- personal inbox + bell
AuditLog(id, userId, entity, entityId, action, before, after, timestamp)  -- append-only
Timesheet effort — actual man-days logged against Manpower lines (plan vs earned vs consumed)
```

**Money type:** all currency stored as `NUMERIC`/`Decimal`, displayed as `Rp` (id-ID grouping).

---

## 5. MODULE SPECIFICATIONS (as delivered)

### 5.1 Project Charter
Capture & lock the project baseline. Fields: description, goals, **project category**
(Network / Server / Cloud / Cyber-Security Infrastructure · Application Development),
high-level scope, high-level cost (IDR), high-level schedule, deliverables, **PM assignment**,
and the **delivery approach** (Predictive / Agile / Hybrid) chosen at initiation. **Commit**
sets `status = CHARTERED`, stamps `committedBy/at`, creates a `version`, and unlocks the other
modules. After commit, edits require a **Change Request** (new version, audit-logged).

### 5.2 Cost Management
- **Direct** — Material (Technology on-prem/cloud, Hardware/Software License; qty × unit cost)
  and Manpower (resource from the pool × rate-card day-rate × plan man-days), with **inline edit**
  and a live amount preview. A manpower line can link to a WBS task and **prefills that task's Owner**.
- **Indirect** — Transportation / Accommodation / Entertainment.
- **Roll-up** — `Subtotal (Direct+Indirect) + Contingency (from Risk EMV) + Management Reserve = Cost
  Baseline (PMB = BAC)`. A variance card flags high-level charter cost vs the detailed baseline.
- **Actual Cost** — entered **manually** as time-phased entries (progress drives EV, not AC; AC=0 → CPI "—").
- **BAC = PMB** = direct + indirect + contingency, **excludes** management reserve (shown as "Total Budget").

### 5.3 Risk Management
Qualitative (Probability × Impact 1–5, **5×5 heat-map**, severity Low/Med/High/Critical) and
quantitative (**EMV = Probability% × Impact Cost**, with a live preview). Threats flagged
"include in reserve" sum (residual) into the **Contingency Reserve**, which auto-feeds the cost
roll-up. Heat-map + EMV ranking table + reserve summary.

### 5.4 Schedule Management (predictive)
WBS task/subtask tree; a **custom interactive Gantt** (drag to reschedule, link FS/SS/FF/SF
dependencies with cycle detection, today-line); a **schedule baseline & variance** (tracking
Gantt); per-task progress, PIC and a WBS dictionary. Task ↔ Manpower link reconciles planned
man-days and surfaces over-allocation. Progress % drives **Earned Value**.

### 5.5 Agile & Hybrid delivery
Product **backlog**, **sprints**, and a **Kanban board with drag-and-drop**; **velocity** and
**burndown** (sprint snapshots). **Agile-EVM** derives % complete from **story points**
(done ÷ total); **Hybrid** splits BAC between the WBS-linked (predictive) and backlog (agile)
streams so nothing is double-counted — all blended into the same portfolio EVM.

### 5.6 Timesheet & Resource management
A per-project **Timesheet** logs actual man-days against manpower lines and shows **Planned vs
Earned vs Consumed** man-days and **labour efficiency** (earned ÷ consumed); team members get a
self-service **"My Timesheet"**. A **Resource master pool** (named/generic, rate-carded, linkable
to accounts) drives manpower cost and cross-project **capacity & over-allocation**.

### 5.7 Change Control, Lifecycle & Closure governance
- **Change Requests** — raise → review → PMO/Admin approve/reject, with a full lifecycle log and
  charter versioning. A **chargeable** change can add its agreed amount to project revenue on
  approval; an approved change impacting **cost or schedule auto-unlocks the frozen baseline**.
- **Baseline lock** — one project-level freeze gates cost lines, WBS tasks **and** the schedule
  baseline together. Correct order: capture the schedule baseline **first**, then lock. Unlock is
  a deliberate, audited ADMIN/PMO action (or an approved CR).
- **Lifecycle** — governed transitions **Charter → Active ⇄ On-hold → Closed** (ADMIN/PMO;
  on-hold needs a reason). **Activation gate** requires the baseline set (cost locked + schedule
  baseline when there's a WBS); **closure gate** hard-blocks until schedule 100% (advisory
  warnings for open CRs/risks/issues/backlog/acceptance/lessons). ADMIN/PMO can **force**
  activate/close past a blocker with a mandatory reason. **CLOSED is read-only** (frozen BAC/data).
- **Closeout artifacts** — a **Lessons-learned register** and **Acceptance sign-offs**.
- **Guided next-steps** — a contextual, role-aware card tells the PM exactly what to do next for
  the current stage and jumps to the right tab; dashboard queues surface planning/activation/close handoffs.

### 5.8 Issue Log · Notifications · Attachments · Audit
Per-project **Issue Log** (category/impact/owner/resolution/status); a personal **notification
inbox** + on-demand portfolio alerts (overdue, high risk, budget overrun); **attachments** with a
safe type/extension whitelist, server-generated names and a 10 MB cap; an immutable **audit log**.

---

## 6. INTEGRATION ENGINE — EVM (methodology-aware)

```
PV (Planned Value)  = baseline cost scheduled to date
EV (Earned Value)   = BAC-weighted Σ(work-package % complete × weight)   -- weight = linked cost, else duration
AC (Actual Cost)    = recorded manual actual spend (time-phased)
CV = EV − AC   SV = EV − PV   CPI = EV/AC   SPI = EV/PV   EAC = BAC/CPI   VAC = BAC − EAC
```
EVM adapts to the project's methodology (WBS weighting / agile story-points / hybrid blend) and is
surfaced with **RAG health** on the dashboard, on each project, and in the Reporting Hub. Cost
weighting requires **full** cost-loading; a partially-costed WBS falls back to duration weighting
(so uncosted leaves never collapse to zero). Health is `NO_DATA` (not a false RED) before start / with no AC.

---

## 7. REPORTING HUB (delivered — centralizes formal reporting)

A dedicated **`/reports`** page separates *working dashboards* (in-context, interactive) from
*reports* (formal, point-in-time, exportable). A two-axis model — **View × Cadence**:
- **Executive** — one-screen portfolio health: KPI band, RAG schedule-health distribution, and a
  per-project heatmap sorted worst-first. Exports **portfolio PDF + Excel**.
- **Project Report** — the formal per-project status report (schedule, cost, task completion, forecast).
- **Analytics** — deep EVM-trend + forecast for any project, surfaced centrally.
- **Cadence** — weekly/monthly live (daily/yearly surfaced, engine work pending).
- **Corporate-styled PDFs** — both the per-project **and** portfolio exports render a navy cover
  band + RAG status pill, an auto-written **Executive Summary (BLUF)**, a KPI band, and a per-page
  CONFIDENTIAL footer (pure PDFKit — no headless browser).

---

## 8. SECURITY (AppSec — as-built)

- **Accounts are admin-provisioned** — no open self-registration. Passwords **bcrypt** (cost 12) +
  strong-password policy (≥10, letter+number, common-breach denylist).
- **JWT with real revocation** — short access + rotating refresh tokens carry a per-user token
  version; logout, password change/reset and deactivation invalidate all outstanding tokens
  immediately. `requireAuth` re-validates the account (active + version + role) every request;
  algorithm pinned (HS256).
- **Brute-force protection** — rate-limited `/auth/login` & `/auth/refresh`.
- **RBAC everywhere** — deny-by-default; ownership/soft-delete checks; every nested query
  re-scoped by `projectId` (no IDOR); CLOSED projects read-only across all modules.
- **Input & content** — Zod on all mutations, 100% Prisma (no raw SQL), a Helmet **CSP**
  (hashed inline script, no `unsafe-inline`), file-upload type/extension whitelist + server-generated
  names + 10 MB cap + non-web-served upload dir.
- **Transport hardening** — behind an **nginx TLS reverse proxy** the app binds loopback
  (`HOST=127.0.0.1`), enables HSTS + `upgrade-insecure-requests`, and trusts the proxy for the real
  client IP; http→https redirected. LAN-by-IP uses a local-CA cert.
- **Auditable** — append-only audit trail; production hides internal error details.

---

## 9. QA / QC STRATEGY (delivered)

| Level | Tooling | Focus |
|---|---|---|
| Unit | Vitest (DB-less; pure `*.helpers.ts`) | calc core — cost totals, EMV, contingency, EVM, closure/activation/next-steps |
| API | Supertest (dedicated `prima_pm_test` DB) | RBAC, validation, commit/lock, lifecycle, closeout |
| E2E | Playwright | login/RBAC + portfolio + project specs |
| Data integrity | Prisma constraints | NUMERIC money, FK cascades, status state-machine |

**CI** (GitHub Actions) gates the server build + unit + Postgres-service integration tests, the
client typecheck/build, and the **Playwright E2E** suite on every push & PR.
**Definition of Done:** feature + tests + validation + audit log + role check + docs.

---

## 10. DELIVERY STATUS

| Phase | Deliverables | Status |
|---|---|---|
| **0. Foundation** | Repo, DB schema/Prisma, Auth + RBAC, app shell | ✅ delivered |
| **1. Charter** | Charter + commit/lock + audit + versioning | ✅ delivered |
| **2. Cost** | Direct/Indirect + roll-up + Rate Card + Actual Cost | ✅ delivered |
| **3. Risk** | Qualitative + EMV + Contingency → feeds Cost | ✅ delivered |
| **4. Schedule** | WBS + custom Gantt + baseline/variance + manpower sync | ✅ delivered |
| **5. Agile/Hybrid** | Backlog + sprints + board + velocity/burndown + blended EVM | ✅ delivered |
| **6. Integration** | EVM engine + Portfolio dashboard + **Reporting Hub** | ✅ delivered |
| **7. Governance** | Change control + lifecycle + closure gate + closeout artifacts | ✅ delivered |
| **8. Hardening** | PDF/Excel export, security review, HTTPS/nginx, QA/CI, backups | ✅ delivered (HTTPS full lock-down in transition) |
| **9. Experience** | Command palette, timesheets, notifications, public landing page, UI/UX polish | ✅ delivered |

**Live in production** as a systemd service behind an nginx TLS proxy, with nightly backups and a
disk-space monitor.

---

## 11. ASSUMPTIONS & OPEN ITEMS (current)

- Single tenant (one organization), multi-user. *(SaaS multi-tenant not in scope.)*
- **Actual Cost is manual** (time-phased entries) — no finance-system integration.
- Attachments are lightweight (whitelisted types, 10 MB).
- Approval depth is 1-step (PMO). 
- **Remaining / deferred:** full HTTPS lock-down phase (loopback bind + header re-enable) pending a
  final prod cutover; Reporting Hub daily/yearly cadence + a standalone Portfolio detail view +
  an Agile-velocity analytics lens; refresh-token storage/rotation refinements; drop-root for the
  service. See `docs/AUDIT-2026-06-29.md` for the engineering audit & roadmap.

---
*As-built v1.0 — reflects the delivered, production system. Supersedes design draft v0.1 (2026-06-27).*
