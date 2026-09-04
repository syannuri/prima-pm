import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Forbidden } from './errors.js';
import { activeTenantIsPersonal } from './tenant/context.js';
import { recordAiUsage, type AiFeature } from './aiUsage.js';
import { assertAiBudget } from './aiBudget.js';

// The Forbidden thrown when an AI feature is gated off for the caller's tenant. A guest's personal
// sandbox has no governance surface and can NEVER opt in, so the generic "not enabled for this
// workspace" (which implies an admin could switch it on) is misleading there — give guests an
// honest, sandbox-specific message instead. Corporate tenants keep the actionable original.
export function aiNotEnabledError() {
  if (activeTenantIsPersonal()) {
    return Forbidden('Fitur AI tidak tersedia di ruang kerja tamu (sandbox). Buat atau gabung workspace untuk memakai asisten AI.');
  }
  return Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
}

// AI Status Narrative — the first Claude-powered feature. Config is read LIVE from process.env
// (like lsConfig()/billingEnabled() and multitenancyEnforced()), NOT captured at import, so tests
// can toggle it and ops can set the key without a rebuild. Missing key ⇒ endpoints 503 and nothing
// else in the app changes (dormant-by-default). See docs/AI-NARRATIVE-GOLIVE.md.
export function aiConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    // Default to the most capable model; overridable for cost tuning without a code change.
    model: process.env.AI_MODEL || 'claude-opus-4-8',
    // Cheaper model for BULK/proactive work (the weekly portfolio sweep drafts one narrative per
    // active project — Haiku keeps that affordable). Overridable; falls back to Haiku.
    proactiveModel: process.env.AI_MODEL_PROACTIVE || 'claude-haiku-4-5',
  };
}

// Resilience (improvement #3): bound every AI request so a hung/overloaded Anthropic call can't stall
// a request for the SDK's 10-minute default, and let the SDK auto-retry transient failures (it retries
// 408/409/429/5xx + connection errors with exponential backoff). Both env-overridable. Timeout is
// per-request (per tool-loop step), not for the whole loop. `timeout` is MILLISECONDS in the TS SDK.
function aiClient(apiKey: string): Anthropic {
  const timeout = Number(process.env.AI_TIMEOUT_MS) || 120_000; // 2 min/request
  const maxRetries = Number.isFinite(Number(process.env.AI_MAX_RETRIES)) && process.env.AI_MAX_RETRIES !== undefined
    ? Number(process.env.AI_MAX_RETRIES)
    : 3; // one more than the SDK default (2) — cheap insurance against a transient 429/529
  return new Anthropic({ apiKey, timeout, maxRetries });
}

// Globally enabled only when the API key is present. This is the deployment-level gate; a SECOND,
// per-tenant opt-in (Tenant.aiNarrativeEnabled) is enforced in the narrative service.
export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// The structured draft the model returns. executiveSummary is shown as a banner above the editor;
// the three fields map 1:1 onto ProjectCommentary{highlights,lowlights,nextFocus}.
export const NarrativeSchema = z.object({
  executiveSummary: z.string(),
  highlights: z.string(),
  lowlights: z.string(),
  nextFocus: z.string(),
});
export type NarrativeDraft = z.infer<typeof NarrativeSchema>;

// Structured-output JSON schema (constrains the model's response to valid JSON). Hand-authored
// rather than derived from the zod schema — the SDK's zod helper targets a different zod major than
// the app's, so we constrain via raw JSON schema and validate the result with NarrativeSchema.
const NARRATIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: { type: 'string' },
    highlights: { type: 'string' },
    lowlights: { type: 'string' },
    nextFocus: { type: 'string' },
  },
  required: ['executiveSummary', 'highlights', 'lowlights', 'nextFocus'],
  additionalProperties: false,
} as const;

// A narrow port so feature services never touch the SDK shape and integration tests can inject a
// fake (no network, no key). Every method returns null when the model DECLINED
// (stop_reason: "refusal") or produced no parseable output — the caller maps that to a graceful
// "couldn't draft" response.
//
// `draftJson` is the GENERIC core reused by every structured-output AI feature (status narrative,
// CR impact analysis, EVM explainer, risk suggestions…): pass a stable system prompt, a data
// payload as `user`, and a raw JSON schema; get back parsed-but-unvalidated JSON (the caller
// validates with its own zod schema). `draftNarrative` is a thin, typed wrapper kept for the
// existing report service.
// A read-only tool the assistant can call. `execute` runs on the server against existing services;
// the model never touches the DB directly.
export interface AiToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiPort {
  draftJson(input: { system: string; user: string; jsonSchema: Record<string, unknown>; maxTokens?: number; model?: string; feature?: AiFeature }): Promise<unknown | null>;
  draftNarrative(input: { system: string; user: string; model?: string; feature?: AiFeature }): Promise<NarrativeDraft | null>;
  // Manual agentic tool loop for the project Q&A assistant (Phase 4). Optional so existing fake
  // ports (narrative/CR/EVM/risk itests) don't need to implement it. `executeTool` is a server-side
  // callback that runs the named read-only tool and returns a JSON string; the port drives the
  // call → tool_use → tool_result loop, bounded by maxSteps, and returns the final answer text
  // (null on refusal, empty output, or exceeding maxSteps).
  runToolLoop?(input: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools: AiToolDef[];
    executeTool: (name: string, input: unknown) => Promise<string>;
    maxSteps?: number;
    maxTokens?: number;
    feature?: AiFeature;
    // Real-time streaming (improvement #2): `onText` fires with each answer-text delta as Claude
    // generates it; `onTextReset` fires when a step turns out to be a tool call, so any preamble text
    // streamed that step is discarded on the client (only the final end_turn text is the answer).
    // Both optional — omit for a plain one-shot result.
    onText?: (delta: string) => void;
    onTextReset?: () => void;
  }): Promise<string | null>;
}
// Back-compat alias (report/narrative code imported this name).
export type AiNarrativePort = AiPort;

let injected: AiPort | null = null;
// Test seam (mirrors webhook.service __setAutoDeliver): inject a fake port in itests.
export function __setAiNarrativePort(port: AiPort | null): void {
  injected = port;
}
export const __setAiPort = __setAiNarrativePort;

function liveAiPort(): AiPort {
  return {
    async draftJson({ system, user, jsonSchema, maxTokens, model: modelOverride, feature }) {
      await assertAiBudget(); // #4: block if the tenant is over its monthly AI budget (no-op unless configured)
      const { apiKey, model: defaultModel } = aiConfig();
      const model = modelOverride || defaultModel;
      const client = aiClient(apiKey);
      // Structured output (constrains to valid JSON) + adaptive thinking (light reasoning) + medium
      // effort (cost/quality balance). System prompt is stable per feature ⇒ prompt-cached.
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens ?? 2000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: jsonSchema } },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      });
      await recordAiUsage({ feature: feature ?? 'unknown', model, usage: res.usage });
      // Guard the refusal stop reason BEFORE reading content (empty/partial on a refusal).
      if (res.stop_reason === 'refusal') return null;
      const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null; // non-JSON output (shouldn't happen with json_schema) → graceful null
      }
    },
    async draftNarrative({ system, user, model, feature }) {
      const raw = await this.draftJson({ system, user, jsonSchema: NARRATIVE_JSON_SCHEMA, model, feature: feature ?? 'narrative' });
      if (raw == null) return null;
      const parsed = NarrativeSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    async runToolLoop({ system, messages, tools, executeTool, maxSteps = 6, maxTokens = 1500, feature, onText, onTextReset }) {
      await assertAiBudget(); // #4: block if the tenant is over its monthly AI budget (no-op unless configured)
      const { apiKey, model } = aiConfig();
      const client = aiClient(apiKey);
      const msgs: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
      for (let step = 0; step < maxSteps; step++) {
        // Stream so answer text can be forwarded token-by-token (improvement #2). Thinking blocks
        // stream as thinking_delta, not text — `on('text')` fires only for the visible answer.
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          // AiToolDef carries a raw JSON-schema object (with `type: 'object'` at runtime); cast to
          // the SDK's Tool shape whose InputSchema requires the literal `type`.
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) as Anthropic.Tool[],
          messages: msgs,
        });
        if (onText) stream.on('text', (delta) => onText(delta));
        const res = await stream.finalMessage();
        // Record every step of the loop (each is a billed API call).
        await recordAiUsage({ feature: feature ?? 'assistant_qa', model, usage: res.usage });
        if (res.stop_reason === 'refusal') return null;
        if (res.stop_reason === 'tool_use') {
          // The text streamed this step (if any) was preamble before a tool call — tell the client to
          // discard it; only the final end_turn text is the real answer.
          onTextReset?.();
          // Echo the assistant turn (with its tool_use blocks) then run each tool and feed results back.
          msgs.push({ role: 'assistant', content: res.content });
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of res.content) {
            if (block.type === 'tool_use') {
              let out: string;
              try {
                out = await executeTool(block.name, block.input);
              } catch {
                out = JSON.stringify({ error: 'Tool gagal dijalankan.' });
              }
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: out });
            }
          }
          msgs.push({ role: 'user', content: toolResults });
          continue;
        }
        // end_turn (or any non-tool stop) → return the concatenated text answer.
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return text || null;
      }
      return null; // exceeded maxSteps
    },
  };
}

export function getAiPort(): AiPort {
  return injected ?? liveAiPort();
}
// Back-compat alias.
export const getAiNarrativePort = getAiPort;
