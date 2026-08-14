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

// A narrow port so the report service never touches the SDK shape and integration tests can inject
// a fake (no network, no key). Returns null when the model DECLINED (stop_reason: "refusal") or
// produced no parseable output — the caller maps that to a graceful "couldn't draft" response.
export interface AiNarrativePort {
  draftNarrative(input: { system: string; user: string }): Promise<NarrativeDraft | null>;
}

let injected: AiNarrativePort | null = null;
// Test seam (mirrors webhook.service __setAutoDeliver): inject a fake port in itests.
export function __setAiNarrativePort(port: AiNarrativePort | null): void {
  injected = port;
}

export function getAiNarrativePort(): AiNarrativePort {
  if (injected) return injected;
  return {
    async draftNarrative({ system, user }) {
      const { apiKey, model } = aiConfig();
      const client = new Anthropic({ apiKey });
      // Structured output (constrains to valid JSON) + adaptive thinking (light reasoning to judge
      // health) + medium effort (cost/quality balance). System prompt is stable ⇒ prompt-cached.
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: NARRATIVE_JSON_SCHEMA } },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      });
      // Guard the refusal stop reason BEFORE reading content (empty/partial on a refusal).
      if (res.stop_reason === 'refusal') return null;
      const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
      if (!text) return null;
      try {
        const parsed = NarrativeSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
      } catch {
        return null; // non-JSON output (shouldn't happen with json_schema) → graceful null
      }
    },
  };
}
