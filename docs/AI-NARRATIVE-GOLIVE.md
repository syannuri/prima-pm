# AI Status Narrative — Go-Live Runbook

The **AI Status Narrative** feature generates a draft PM status commentary (executive summary +
highlights / lowlights / next focus) from a project's existing report data, via Claude. It is
**dormant by default** and **human-in-the-loop** — the AI never auto-saves; a PM reviews/edits the
draft and saves it through the normal commentary editor.

## Architecture (Phase 1 — backend, shipped)

- `POST /api/v1/projects/:projectId/report/commentary/ai-draft?period=<daily|weekly|monthly|yearly>`
  → returns `{ executiveSummary, highlights, lowlights, nextFocus }`. **Does not persist.**
- Write access = PM (owning) / PMO / ADMIN (same guard as saving commentary). API keys are
  read-only, so they are refused (403).
- The endpoint reuses `getProjectReport()` (EVM, forecast, task counts, overdue list, period delta)
  and sends a compacted payload to the model. Nothing new is computed.
- Model call lives behind an injectable port (`src/lib/ai.ts` `getAiNarrativePort()`), so tests run
  with a fake (no network). Model: `claude-opus-4-8` (override with `AI_MODEL`), structured output
  via `output_config.format` (JSON schema) + adaptive thinking + `effort: medium`, `max_tokens` 2000,
  prompt-cached system prompt. Refusals (`stop_reason: "refusal"`) → graceful 502.

## Two gates (both must be true)

1. **Global (deployment):** `ANTHROPIC_API_KEY` set. `aiEnabled()` reads `process.env` live. Unset ⇒
   endpoint returns **503** and nothing else in the app changes.
2. **Per-tenant opt-in:** `Tenant.aiNarrativeEnabled = true`. Not opted in ⇒ **403**. Default `false`
   so project metrics are only sent to the LLM provider when a tenant explicitly enables it.

## Go-live steps

1. Add to `server/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   # AI_MODEL=claude-opus-4-8   # optional override
   ```
2. Restart the service (`.env` is read at process start): `systemctl restart prima-pm`
   (VPS: `scripts/update-prod.sh` already pulls + restarts; the migration
   `20260814170000_add_ai_narrative_flag` applies automatically).
3. Enable per tenant. Until the self-serve Settings toggle lands (Phase 2), a super-admin flips it:
   ```
   PATCH /api/v1/admin/tenants/:id   { "aiNarrativeEnabled": true }
   ```
4. Verify: `POST …/report/commentary/ai-draft` returns 200 with a draft for an opted-in tenant;
   503 if the key is unset; 403 for a tenant that has not opted in.

## Cost & safety

- ~1–3¢ per draft (input a few K tokens, output ≤2K). Already under the per-tenant request rate
  limiter (`enforceTenantRate` in `requireAuth`).
- Grounding: only real numbers are sent; the system prompt forbids inventing figures. Output is
  schema-constrained. The PM is always the author of the saved commentary.

## Pending (later phases)

- **Phase 2:** client "✨ Draft dengan AI" button + review UX in the commentary editor; self-serve
  per-tenant toggle in Settings → Governance (ADMIN).
- **Phase 3 / extensions:** portfolio-level summary, auto-risk-suggestion from adverse SPI/CPI trends.
