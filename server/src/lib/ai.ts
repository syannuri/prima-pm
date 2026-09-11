import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Forbidden } from './errors.js';
import { activeTenantIsPersonal } from './tenant/context.js';
import { recordAiUsage, type AiFeature, type RawUsage } from './aiUsage.js';
import { assertAiBudget } from './aiBudget.js';
import { createRedactor } from './aiRedact.js';

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

// Effort knob (#D "adaptive effort"): tune thinking depth / token spend without a code change. Default
// 'medium' (unchanged). Raise to 'high'/'max' for more rigorous analysis, 'low' for cheap/fast.
type AiEffort = 'low' | 'medium' | 'high' | 'max';
export function aiEffort(): AiEffort {
  const v = process.env.AI_EFFORT;
  return v === 'low' || v === 'high' || v === 'max' ? v : 'medium';
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
export const NARRATIVE_JSON_SCHEMA = {
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
    // A plain string (one cached block) or ordered segments so a caller can cache the STABLE prefix
    // across users/conversations while keeping the per-user tail on its own breakpoint (#2).
    system: SystemPrompt;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools: AiToolDef[];
    executeTool: (name: string, input: unknown) => Promise<string>;
    maxSteps?: number;
    maxTokens?: number;
    feature?: AiFeature;
    // #3 smart model routing: override the model for this turn (e.g. a cheap model for a simple
    // lookup). Optional — defaults to aiConfig().model.
    model?: string;
    // Real-time streaming (improvement #2): `onText` fires with each answer-text delta as Claude
    // generates it; `onTextReset` fires when a step turns out to be a tool call, so any preamble text
    // streamed that step is discarded on the client (only the final end_turn text is the answer).
    // Both optional — omit for a plain one-shot result.
    onText?: (delta: string) => void;
    onTextReset?: () => void;
    // #D: streamed reasoning summary — fires with each thinking-summary delta so the UI can show Anett
    // "reasoning" before the answer. Optional; a no-op when the caller doesn't want it.
    onThinking?: (delta: string) => void;
    // #5 cost meter: fires once per loop step with that call's raw token usage, so the caller can
    // total the turn's tokens/cost for a live meter. Optional.
    onUsage?: (usage: RawUsage) => void;
  }): Promise<string | null>;
  // Message Batches (#Batch): submit many structured-draft requests as ONE org-wide batch (async,
  // 50% cheaper) and poll for results. Optional — fake ports (itests) don't need them.
  submitBatch?(input: { requests: { customId: string; system: string; user: string; jsonSchema: Record<string, unknown>; model?: string; maxTokens?: number }[] }): Promise<string | null>;
  pollBatch?(batchId: string): Promise<{ ended: boolean; results?: { customId: string; json: unknown | null; usage?: RawUsage }[] }>;
}
// Back-compat alias (report/narrative code imported this name).
export type AiNarrativePort = AiPort;

let injected: AiPort | null = null;
// Test seam (mirrors webhook.service __setAutoDeliver): inject a fake port in itests.
export function __setAiNarrativePort(port: AiPort | null): void {
  injected = port;
}
export const __setAiPort = __setAiNarrativePort;

// Adaptive thinking and the `effort` knob are Claude 4.6+ features; Haiku 4.5 (and older models)
// reject them with a 400 ("adaptive thinking is not supported on this model" / "does not support the
// effort parameter"). Detect the 4.6+ family so the cheap-model paths (proactive narrative & batch,
// #3 model-routing, the LLM judge) send a compatible request — structured `format` works everywhere.
function supportsModernThinking(model: string): boolean {
  return /claude-(opus-4-(6|7|8)|sonnet-4-6|fable-5|mythos-5|mythos-preview)/.test(model);
}

// Prompt-cache the growing conversation prefix in the Q&A tool loop. Each loop STEP (and each new
// chat TURN) re-sends the entire prior message history — the fetched project data lives in those
// tool_result blocks. Placing an ephemeral `cache_control` breakpoint on the LAST block of the LAST
// message means every subsequent request reads that prefix from cache (~0.1× cost) instead of
// reprocessing it at full price. The breakpoint always rides the newest tail (the standard
// incremental multi-turn pattern), so hits accrue as the loop/conversation grows. The system prompt
// keeps its own breakpoint (which also caches the tool definitions), so a request carries at most two
// breakpoints — well under the 4-per-request limit. Returns a shallow copy; the caller's `msgs` stays
// marker-free so exactly one message breakpoint exists per request regardless of history length.
function withHistoryCache(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (msgs.length === 0) return msgs;
  const out = msgs.slice();
  const last = out[out.length - 1];
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]
    : last.content.slice();
  if (blocks.length === 0) return msgs;
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

// A system prompt built from ordered segments (#2 cross-conversation caching). The Q&A assistant's
// prompt is a big STABLE preamble (base instructions + tool/how-to/PMI indexes — byte-identical for
// every user of a language) followed by a small VOLATILE tail (the caller's accessible codes, memory
// block, current-project context). Passing them as separate segments lets us put a `cache_control`
// breakpoint on each: the stable segment then caches ACROSS users and conversations (a shared
// ~0.1× prefix), while the volatile segment keeps its own per-user breakpoint (the within-conversation
// hit). A bare string keeps the old single-block behavior.
export type SystemSegment = { text: string; cache?: boolean };
export type SystemPrompt = string | SystemSegment[];

// Flatten a SystemPrompt back to plain text (for logging and test assertions).
export function systemText(system: SystemPrompt): string {
  return typeof system === 'string' ? system : system.map((s) => s.text).join('');
}

// Build the Anthropic `system` block array from a SystemPrompt, applying the redactor per segment and
// a `cache_control` breakpoint wherever a segment asks for one. A bare string maps to one cached block
// (unchanged). Empty segments are dropped so a breakpoint never lands on a zero-length block.
export function toSystemBlocks(system: SystemPrompt, redact: (s: string) => string): Anthropic.TextBlockParam[] {
  if (typeof system === 'string') {
    return [{ type: 'text', text: redact(system), cache_control: { type: 'ephemeral' } }];
  }
  return system
    .filter((s) => s.text.length > 0)
    .map((s) => ({
      type: 'text' as const,
      text: redact(s.text),
      ...(s.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
}

// Dispatch every tool call from ONE assistant step. The model can emit several tool_use blocks in a
// single step (e.g. get_project_details for three projects at once); awaiting them serially only adds
// latency because the tools are independent server operations. Run them CONCURRENTLY via Promise.all
// — JS is single-threaded so the shared redactor/context mutations stay race-free, and each call is
// error-isolated so one failing tool can't sink the rest. The tool_result blocks preserve the exact
// tool_use order the model emitted. `redact` is the loop's outbound privacy guard applied to output.
export async function runToolCalls(
  blocks: Anthropic.ContentBlock[],
  executeTool: (name: string, input: unknown) => Promise<string>,
  redact: (raw: string) => string,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const uses = blocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  return Promise.all(uses.map(async (block) => {
    let out: string;
    try {
      out = await executeTool(block.name, block.input);
    } catch {
      out = JSON.stringify({ error: 'Tool gagal dijalankan.' });
    }
    return { type: 'tool_result', tool_use_id: block.id, content: redact(out) } as Anthropic.ToolResultBlockParam;
  }));
}

// #3 best-effort partial: when the loop reaches its tool-call limit, tell the model to conclude from
// what it already gathered instead of asking for more tools. Appended (uncached) to the system prompt
// for the FINAL synthesis call only — the stable/volatile cache segments (#2) keep their breakpoints.
const SYNTHESIS_NUDGE =
  '\n\nYou have reached the tool-call limit. Give your best answer NOW using only the information the '
  + 'tools have already returned — do not ask for more tools. If something is missing, say what you '
  + 'could not determine.';
function appendSynthesisNudge(system: SystemPrompt): SystemPrompt {
  const base: SystemSegment[] = typeof system === 'string' ? [{ text: system, cache: true }] : system;
  return [...base, { text: SYNTHESIS_NUDGE }];
}

export type LoopStep = { stopReason: string | null; content: Anthropic.ContentBlock[] };

// Pure orchestration of the agentic Q&A tool loop, split out so the control flow — including the #3
// maxSteps-exhaustion fallback — is unit-testable without the Anthropic SDK. The SDK call, streaming,
// usage recording and redaction all live in the injected `callStep`/`dispatch`/`extractText` closures
// (see liveAiPort.runToolLoop). Each step: refusal → null; tool_use → dispatch the tools and loop;
// any other stop → return the step's text. If maxSteps is reached without a final answer, make ONE
// tool-less synthesis call (callStep with synthesis:true) so the model must answer from the context it
// built — a best-effort partial beats the old hard `null` (which surfaced to the user as a 502 that
// discarded every tool result already fetched). `msgs` is mutated in place (the growing transcript).
export async function driveToolLoop(input: {
  msgs: Anthropic.MessageParam[];
  maxSteps: number;
  callStep: (msgs: Anthropic.MessageParam[], opts: { withTools: boolean; synthesis: boolean }) => Promise<LoopStep>;
  dispatch: (content: Anthropic.ContentBlock[]) => Promise<Anthropic.ToolResultBlockParam[]>;
  extractText: (content: Anthropic.ContentBlock[]) => string | null;
  onTextReset?: () => void;
}): Promise<string | null> {
  const { msgs, maxSteps, callStep, dispatch, extractText, onTextReset } = input;
  for (let step = 0; step < maxSteps; step++) {
    const res = await callStep(msgs, { withTools: true, synthesis: false });
    if (res.stopReason === 'refusal') return null;
    if (res.stopReason === 'tool_use') {
      // Any text streamed this step was preamble before a tool call — tell the client to discard it.
      onTextReset?.();
      msgs.push({ role: 'assistant', content: res.content });
      msgs.push({ role: 'user', content: await dispatch(res.content) });
      continue;
    }
    return extractText(res.content);
  }
  // Exhausted the tool budget → one final tool-less call so the model concludes from context (#3).
  const finalRes = await callStep(msgs, { withTools: false, synthesis: true });
  return extractText(finalRes.content);
}

function liveAiPort(): AiPort {
  return {
    async draftJson({ system, user, jsonSchema, maxTokens, model: modelOverride, feature }) {
      await assertAiBudget(); // #4: block if the tenant is over its monthly AI budget (no-op unless configured)
      const { apiKey, model: defaultModel } = aiConfig();
      const model = modelOverride || defaultModel;
      const client = aiClient(apiKey);
      const redactor = createRedactor(); // #2 privacy guard: scrub secrets/PII outbound (identity unless AI_REDACT)
      // Structured output (constrains to valid JSON) + adaptive thinking (light reasoning) + medium
      // effort (cost/quality balance). System prompt is stable per feature ⇒ prompt-cached.
      const modern = supportsModernThinking(model);
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens ?? 2000,
        // 4.6+ only: adaptive thinking + effort. On older/cheap models omit them (json_schema still works).
        thinking: modern ? { type: 'adaptive' } : undefined,
        output_config: modern
          ? { effort: aiEffort(), format: { type: 'json_schema', schema: jsonSchema } }
          : { format: { type: 'json_schema', schema: jsonSchema } },
        system: [{ type: 'text', text: redactor.redact(system), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: redactor.redact(user) }],
      });
      await recordAiUsage({ feature: feature ?? 'unknown', model, usage: res.usage });
      // Guard the refusal stop reason BEFORE reading content (empty/partial on a refusal).
      if (res.stop_reason === 'refusal') return null;
      const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
      if (!text) return null;
      try {
        return JSON.parse(redactor.restore(text)) as unknown; // restore any tokenised value in the output
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
    async runToolLoop({ system, messages, tools, executeTool, maxSteps = 6, maxTokens = 1500, feature, model: modelOverride, onText, onTextReset, onThinking, onUsage }) {
      await assertAiBudget(); // #4: block if the tenant is over its monthly AI budget (no-op unless configured)
      const { apiKey, model: defaultModel } = aiConfig();
      const model = modelOverride || defaultModel; // #3 smart model routing
      const client = aiClient(apiKey);
      const redactor = createRedactor(); // #2 privacy guard (identity unless AI_REDACT); one map for the whole loop
      const msgs: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: redactor.redact(m.content) }));
      const modern = supportsModernThinking(model); // 4.6+ only: adaptive thinking + effort (omit on Haiku etc)
      // One streaming model call → normalized step. Stream so answer text is forwarded token-by-token
      // (improvement #2); `display: 'summarized'` exposes reasoning as thinking deltas (#D). Both are
      // 4.6+-only, so a routed cheap model (#3) runs without them. `withTools:false` (the #3 final
      // synthesis) omits tools so the model can't emit tool_use and MUST answer; `synthesis:true`
      // appends the tool-limit nudge (uncached — the cache segments keep their breakpoints).
      const callStep = async (m: Anthropic.MessageParam[], { withTools, synthesis }: { withTools: boolean; synthesis: boolean }): Promise<LoopStep> => {
        const sys = synthesis ? appendSynthesisNudge(system) : system;
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          thinking: modern ? { type: 'adaptive', display: 'summarized' } : undefined,
          output_config: modern ? { effort: aiEffort() } : undefined,
          system: toSystemBlocks(sys, (s) => redactor.redact(s)),
          // AiToolDef carries a raw JSON-schema object (with `type: 'object'` at runtime); cast to
          // the SDK's Tool shape whose InputSchema requires the literal `type`.
          tools: withTools ? (tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) as Anthropic.Tool[]) : undefined,
          // Cache the accumulated project-context prefix (tool results + prior turns); see withHistoryCache.
          messages: withHistoryCache(m),
        });
        if (onText) stream.on('text', (delta) => onText(delta));
        if (onThinking) stream.on('thinking', (delta) => onThinking(delta));
        const res = await stream.finalMessage();
        // Record every step of the loop (each is a billed API call), incl. the #3 synthesis call.
        await recordAiUsage({ feature: feature ?? 'assistant_qa', model, usage: res.usage });
        onUsage?.(res.usage as RawUsage); // #5 cost meter: surface this step's tokens to the caller
        return { stopReason: res.stop_reason, content: res.content };
      };
      // Return the concatenated text answer, restoring any tokenised value. (Streamed onText deltas are
      // best-effort un-restored; the settled final answer is authoritative and fully restored.)
      const extractText = (content: Anthropic.ContentBlock[]): string | null => {
        const text = content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return text ? redactor.restore(text) : null;
      };
      return driveToolLoop({
        msgs,
        maxSteps,
        callStep,
        dispatch: (content) => runToolCalls(content, executeTool, (s) => redactor.redact(s)),
        extractText,
        onTextReset,
      });
    },
    async submitBatch({ requests }) {
      const { apiKey, model: defaultModel } = aiConfig();
      const client = aiClient(apiKey);
      const batch = await client.messages.batches.create({
        requests: requests.map((r) => {
          // #2 privacy guard on outbound. Batch results are collected asynchronously in pollBatch
          // (different process/run), so there is no in-memory map to restore against — redaction is
          // outbound-only here. Proactive narratives summarise status/EVM, not raw contact PII, so a
          // leaked placeholder is unlikely; the protection (no secrets/PII sent) is what matters.
          const redactor = createRedactor();
          const model = r.model || defaultModel;
          const modern = supportsModernThinking(model); // proactive batch uses Haiku → omit 4.6+-only params
          return {
            custom_id: r.customId,
            params: {
              model,
              max_tokens: r.maxTokens ?? 2000,
              thinking: modern ? { type: 'adaptive' } : undefined,
              output_config: modern
                ? { effort: aiEffort(), format: { type: 'json_schema', schema: r.jsonSchema } }
                : { format: { type: 'json_schema', schema: r.jsonSchema } },
              system: [{ type: 'text', text: redactor.redact(r.system), cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: redactor.redact(r.user) }],
            },
          };
        }),
      });
      return batch.id;
    },
    async pollBatch(batchId) {
      const { apiKey } = aiConfig();
      const client = aiClient(apiKey);
      const batch = await client.messages.batches.retrieve(batchId);
      if (batch.processing_status !== 'ended') return { ended: false };
      const results: { customId: string; json: unknown | null; usage?: RawUsage }[] = [];
      for await (const r of await client.messages.batches.results(batchId)) {
        if (r.result.type === 'succeeded') {
          const msg = r.result.message;
          const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
          let json: unknown | null = null;
          if (text) { try { json = JSON.parse(text); } catch { json = null; } }
          results.push({ customId: r.custom_id, json, usage: msg.usage as RawUsage });
        } else {
          results.push({ customId: r.custom_id, json: null });
        }
      }
      return { ended: true, results };
    },
  };
}

export function getAiPort(): AiPort {
  return injected ?? liveAiPort();
}
// Back-compat alias.
export const getAiNarrativePort = getAiPort;
