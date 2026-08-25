import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// AI Status Narrative — the first Claude-powered feature. Config is read LIVE from process.env
// (like lsConfig()/billingEnabled() and multitenancyEnforced()), NOT captured at import, so tests
// can toggle it and ops can set the key without a rebuild. Missing key ⇒ endpoints 503 and nothing
// else in the app changes (dormant-by-default). See docs/AI-NARRATIVE-GOLIVE.md.
export function aiConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    // Default to the most capable model; overridable for cost tuning without a code change.
    model: process.env.AI_MODEL || 'claude-opus-4-8',
  };
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
export interface AiPort {
  draftJson(input: { system: string; user: string; jsonSchema: Record<string, unknown>; maxTokens?: number }): Promise<unknown | null>;
  draftNarrative(input: { system: string; user: string }): Promise<NarrativeDraft | null>;
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
    async draftJson({ system, user, jsonSchema, maxTokens }) {
      const { apiKey, model } = aiConfig();
      const client = new Anthropic({ apiKey });
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
    async draftNarrative({ system, user }) {
      const raw = await this.draftJson({ system, user, jsonSchema: NARRATIVE_JSON_SCHEMA });
      if (raw == null) return null;
      const parsed = NarrativeSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
  };
}

export function getAiPort(): AiPort {
  return injected ?? liveAiPort();
}
// Back-compat alias.
export const getAiNarrativePort = getAiPort;
