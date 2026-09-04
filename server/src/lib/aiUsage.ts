import { prisma } from './prisma.js';
import { getTenantStore } from './tenant/context.js';
import { estimateCostUsd } from './aiPricing.js';

// Token & cost accounting for every Claude call (see docs — improvement #1). The single choke point
// lib/ai.ts records one row per API request via recordAiUsage(); the tenant dashboard and platform
// console read it back through the summary helpers. Best-effort: a failed insert must NEVER break the
// user-facing AI response, so recordAiUsage swallows its own errors.

// The Anthropic response.usage shape we care about (cache tokens included — they price differently).
export interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// Stable feature labels (one per AI-powered surface). Kept as a plain string on the row so adding a
// feature never needs a migration; this union is just the authoring contract for call sites.
export type AiFeature =
  | 'narrative'
  | 'assistant_qa'
  | 'cr_impact'
  | 'evm_explain'
  | 'risk_suggest'
  | 'portfolio_qa'
  | 'proactive'
  | 'data_extract'
  | 'resource_realloc'
  | 'schedule_suggest'
  | 'whatif'
  | 'unknown';

// Record one API call's usage. Reads the active tenant from AsyncLocalStorage (the same context the
// Prisma extension uses), so the row is stamped to whichever workspace made the call. Awaited by the
// port but wrapped here so an accounting failure is logged-and-dropped, never propagated.
export async function recordAiUsage(input: {
  feature: AiFeature;
  model: string;
  usage: RawUsage | null | undefined;
  userId?: string | null;
  projectId?: string | null;
}): Promise<void> {
  try {
    const u = input.usage ?? {};
    const tenantId = getTenantStore()?.tenantId ?? null;
    await prisma.aiUsage.create({
      data: {
        tenantId, // extension also injects this under a tenant context; explicit for the no-context path
        feature: input.feature,
        model: input.model,
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
      },
    });
  } catch {
    // Accounting is non-critical: never let it break the AI feature that just succeeded.
  }
}

export interface UsageBucket {
  key: string;              // feature name or model id
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

export interface UsageSummary {
  since: string;
  totals: Omit<UsageBucket, 'key'>;
  byFeature: UsageBucket[];
  byModel: UsageBucket[];
}

// Roll up usage for the active tenant since `since` (the extension scopes the read to this tenant).
// Cost is computed here from the per-model price table, so a price change needs no data migration.
export async function summarizeTenantUsage(since: Date): Promise<UsageSummary> {
  const rows = await prisma.aiUsage.findMany({
    where: { createdAt: { gte: since } },
    select: {
      feature: true, model: true,
      inputTokens: true, outputTokens: true, cacheCreationTokens: true, cacheReadTokens: true,
    },
  });
  return rollup(rows, since);
}

// Shared roll-up used by both the tenant and (platform) system-wide summaries.
export function rollup(
  rows: Array<{ feature: string; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>,
  since: Date,
): UsageSummary {
  const byFeature = new Map<string, UsageBucket>();
  const byModel = new Map<string, UsageBucket>();
  const totals: Omit<UsageBucket, 'key'> = { calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };

  const bump = (map: Map<string, UsageBucket>, key: string, r: typeof rows[number], cost: number) => {
    const b = map.get(key) ?? { key, calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };
    b.calls += 1;
    b.inputTokens += r.inputTokens;
    b.outputTokens += r.outputTokens;
    b.cacheCreationTokens += r.cacheCreationTokens;
    b.cacheReadTokens += r.cacheReadTokens;
    b.estimatedCostUsd += cost;
    map.set(key, b);
  };

  for (const r of rows) {
    const cost = estimateCostUsd(r);
    totals.calls += 1;
    totals.inputTokens += r.inputTokens;
    totals.outputTokens += r.outputTokens;
    totals.cacheCreationTokens += r.cacheCreationTokens;
    totals.cacheReadTokens += r.cacheReadTokens;
    totals.estimatedCostUsd += cost;
    bump(byFeature, r.feature, r, cost);
    bump(byModel, r.model, r, cost);
  }

  const sort = (a: UsageBucket, b: UsageBucket) => b.estimatedCostUsd - a.estimatedCostUsd;
  return {
    since: since.toISOString(),
    totals,
    byFeature: [...byFeature.values()].sort(sort),
    byModel: [...byModel.values()].sort(sort),
  };
}
