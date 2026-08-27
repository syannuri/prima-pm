# Anett — Cross-session Memory + Feedback Learning

Give the portfolio AI assistant (Anett) durable, transparent **memory across sessions** and a
**deterministic feedback→learning loop**, so it adapts to each user and organization without
fine-tuning or per-session LLM cost.

Status: **Fase 1 in progress** (backend memory foundation). Decisions locked (2026-08-27):
- **Scope** = both **USER** (personal) and **TENANT** (org-shared).
- **Formation** = **explicit first** (remember/forget tools); auto-distill deferred to Fase 4.
- **Feedback** = **deterministic** — 👎 + note becomes a verbatim TENANT *GUIDANCE* memory that is
  injected into later prompts. No LLM in the loop.

## Principles
- **Dormant-by-default** via a new `Tenant.aiMemoryEnabled` (`@default(false)`), consistent with
  `aiNarrativeEnabled` / `aiActionsEnabled` / `aiProactiveEnabled`.
- **~Zero extra LLM cost** in Fases 1–3: memory injection only lengthens the (bounded) prompt;
  remember/forget are tools inside the existing `runToolLoop`; feedback→memory is deterministic.
- **Transparent + deletable** (trust + GDPR): every memory is visible and removable in Settings;
  both tables carry `tenantId` so tenant hard-delete cascades.

## Data model (tenant-scoped — register in `src/lib/tenant/scopedModels.ts`)

### `AiMemory`
- `scope` USER | TENANT · `userId?` (set when scope=USER)
- `kind` PREFERENCE | FACT | GLOSSARY | GUIDANCE
- `content` (verbatim, ≤ ~280 chars enforced in the service)
- `source` EXPLICIT | FEEDBACK | AUTO (AUTO reserved for Fase 4)
- `sourceRef?` (audit — e.g. feedback id) · `pinned` · `active` (soft-delete / forget)
- `createdById?` / `createdByName?` · `useCount` / `lastUsedAt?` · timestamps
- indices: `[tenantId]`, `[tenantId, scope, userId, active]`

### `AiFeedback`
- `rating` UP | DOWN · `question?` · `answer` (bounded) · `note?` (👎 correction)
- `projectId?` · `memoryId?` (the GUIDANCE memory it spawned, if any) · timestamps
- indices: `[tenantId]`, `[tenantId, rating, createdAt]`

Enums: `AiMemoryScope`, `AiMemoryKind`, `AiMemorySource`, `AiFeedbackRating`.

## How it works
1. **Injection** (`askAssistant`): when `aiMemoryEnabled`, load the caller-visible memories (all active
   TENANT + this user's active USER), pinned-first, **capped ~20 items / ~1800 chars**, and append to
   the `system` prompt as a "What Anett knows — honor this" block. GUIDANCE items are framed as
   "corrections from earlier feedback — comply".
2. **Explicit** (Fase 1): `remember` { content, scope?, kind? } and `forget` { description } tools,
   exposed only when the flag is on. Anett **confirms before storing** (same convention as
   `propose_action`). `forget` matches by substring within the caller's visible set; 0/ambiguous →
   Anett asks to be specific (no fuzzy delete).
3. **Feedback** (deterministic): 👍/👎 per answer. 👎 + note → store `AiFeedback` **and** (when flag on)
   create an `AiMemory` GUIDANCE (scope=TENANT, source=FEEDBACK, content = the note verbatim). The
   next turn's GUIDANCE block carries it → a real learning loop.

## Governance & routes
- TENANT-scope writes (create/edit/delete) → **ADMIN/PMO only**; USER-scope → the owner. GUIDANCE from
  feedback is created via a controlled system path.
- `POST /assistant/feedback`; `GET/POST/PATCH/DELETE /assistant/memory`.
- `/ai-settings` gains `memoryEnabled` → response shape becomes
  `{ configured, enabled, actionsEnabled, proactiveEnabled, memoryEnabled }` (update `narrative.itest`).

## Client
- 👍/👎 under each answer (not on errors, not while the typewriter streams); 👎 opens a short note
  field → POST feedback; subtle ack; buttons disable after rating.
- "🧠 Anett mengingat: …" chip when the `remember` tool stored something (collect refs in the ask
  response, mirroring `proposals` / `navigate`).
- **Settings → Governance**: an "Ingatan Anett" card — list (USER + TENANT), pin / edit / delete +
  the `memoryEnabled` toggle (mirrors `AiNarrativeCard`).

## Phases (each: own itest + rbac 125 + tsc; commit on a `feat/` branch → PR)
- **Fase 1 — Memory backend**: schema + migration + scoped-reg + flag; `memory.service`
  (list-for-prompt, add, forget, list, update); inject into `askAssistant`; remember/forget tools;
  ai-settings `memoryEnabled`; memory refs in the ask response. *(has migration)*
- **Fase 2 — Feedback backend**: `AiFeedback` + migration; `recordFeedback` (+ DOWN→GUIDANCE); route.
  *(has migration)*
- **Fase 3 — Client**: 👍/👎 + note, "mengingat" chip, Settings CRUD card + toggle; build +
  browser-verify (stubbed AI, key-free).
- **Fase 4 (later, optional)**: auto-distill durable facts at conversation end (Haiku, dedupe, capped);
  admin feedback inbox `/admin/ai-feedback`.

## Deploy notes
Fases 1 & 2 each add a **migration** → VPS needs `migrate:deploy` (via `scripts/update-prod.sh`,
user-run). LAN migrated locally. Fase 3 is client-only. Feature stays dormant until a tenant flips
`aiMemoryEnabled` (Settings → Governance).
