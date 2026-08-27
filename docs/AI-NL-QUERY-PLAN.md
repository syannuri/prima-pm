# Anett — Natural-language data query → table + CSV

Let users ask for data in plain language ("projects with SPI < 0.9 and a pending change request",
"my overdue tasks this month") and get a **structured table + CSV**, via Anett. Turns Anett from a
Q&A assistant into a working tool.

Decisions (2026-08-27): entities v1 = **Projects + Tasks**; surface = **inside Anett (a `query_data`
tool)** — the table renders as a card in chat with CSV export. Risks/CRs + a dedicated panel are later.

## Safety model (the crux)
The AI **never emits SQL.** It emits a **structured query spec** (JSON) constrained by a whitelist:
```
{ entity: 'projects'|'tasks',
  filters?: [{ field, op: eq|ne|gt|gte|lt|lte|contains|in, value }],
  sort?: { field, dir: asc|desc }, limit?: <=200, columns?: string[] }
```
The server **validates** the spec against a per-entity field/operator whitelist, then executes it
**deterministically** with Prisma — bounded to the **caller's accessible set** (same rule as
`listProjects`; no cross-tenant / cross-PM leakage). Read-only; no AI in the data path. An invalid
spec returns a friendly error the model relays (never a 500).

## Data sources (cheap, no heavy recompute)
- **Projects**: `listProjects(userId, role)` (access-scoped) + `costBaseline.budgetAtCompletion` (BAC)
  + the **latest `EvmSnapshot`** per project (ev/ac/spi/cpi/weightedProgress; null if never captured)
  + cheap `groupBy` aggregates: overdue tasks, open risks (status ∉ CLOSED/OCCURRED), pending CRs
  (status ∈ SUBMITTED/UNDER_REVIEW). Filter/sort/limit applied in memory over ≤200 rows.
- **Tasks**: tasks across accessible projects (optional `project` filter) → wbs/name/pct/planEnd/
  overdue/milestone/owner. In-memory filter/sort/limit.

### Whitelisted fields
- **projects**: code, name, status, pm, approach, bac, ev, ac, spi, cpi, percentComplete,
  overdueTasks, openRisks, pendingCRs.
- **tasks**: project, wbs, name, pct, planEnd, overdue, milestone, owner, status.

## Flow
User asks → Anett calls `query_data` with a spec → engine materializes rows + derived columns →
validate/filter/sort/limit → returns a **table** (columns + rows + total). The model gets a compact
version (first ~10 rows + total) to summarize in prose; the **client renders the full table** as a
card (mirrors `proposals`/`memories`) with **Export CSV** (reuses `lib/csv`). Table rows capped at 100
for display (+ "N of M" note); spec `limit` bounds the query itself.

## Phases (each: itest + rbac 125 + tsc; feat branch → PR)
- **Fase 1 — backend**: spec types + whitelist + validator + execution engine (`query.service.ts`),
  `query_data` tool wired into `askAssistant`/`executeTool`, `tables` added to the `/ask` (+ stream)
  response. itests: safety (unknown entity/field/op → error, not crash), access scoping, filter/sort/
  limit correctness.
- **Fase 2 — client**: render the table card in Anett + CSV export; handle the streamed `tables` event.
- **Fase 3 (optional)**: risks + CRs entities; a dedicated "Ask your data" panel; saved queries;
  server-side CSV for large result sets.

## Notes
No migration (read-only over existing data). Dormant with the rest of Anett (AI armed + tenant opt-in).
EVM columns (spi/cpi/ev/ac/%) are null for projects without a captured `EvmSnapshot` — filters on
those simply exclude null rows.
