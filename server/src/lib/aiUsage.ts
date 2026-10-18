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
  | 'review'
  | 'proactive'
  | 'data_extract'
  | 'resource_realloc'
  | 'schedule_suggest'
  | 'whatif'
  | 'memory_distill'
  | 'feedback_distill'
  | 'eval_judge'
  | 'unknown';

// Record one API call's usage. Reads the active tenant from AsyncLocalStorage (the same context the
// Prisma extension uses), so the row is stamped to whichever workspace made the call. Awaited by the
// port but wrapped here so an accounting failure is logged-and-dropped, never propagated.
export async function recordAiUsage(input: {
  feature: AiFeature;
  model: string;
  usage: RawUsage | null | undefined;
  latencyMs?: number | null; // wall-clock of the model call (phase 5); omit on untimed paths
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
        latencyMs: input.latencyMs != null && Number.isFinite(input.latencyMs) ? Math.round(input.latencyMs) : null,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
      },
    });
  } catch {
    // Accounting is non-critical: never let it break the AI feature that just succeeded.
  }
}

// #5 cost meter: map one RawUsage to token counts + an estimated USD cost for a single turn/call, so
// a live per-conversation meter can total them client-side. Pure (no DB) — reuses the price table.
export function costOfRawUsage(model: string, u: RawUsage | null | undefined): { inputTokens: number; outputTokens: number; costUsd: number } {
  const usage = u ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const costUsd = estimateCostUsd({ model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens });
  return { inputTokens, outputTokens, costUsd };
}

export interface UsageBucket {
  key: string;              // feature name or model id
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  p50LatencyMs: number | null; // median call latency (phase 5); null when no timed calls in the bucket
  p95LatencyMs: number | null; // 95th-percentile call latency; null when no timed calls
}

// Nearest-rank percentile over an ascending-sorted array. Null for an empty set. p∈[0,100].
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
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
      latencyMs: true,
    },
  });
  return rollup(rows, since);
}

type UsageRow = { feature: string; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; latencyMs?: number | null };

// Shared roll-up used by both the tenant and (platform) system-wide summaries.
export function rollup(rows: UsageRow[], since: Date): UsageSummary {
  const byFeature = new Map<string, UsageBucket>();
  const byModel = new Map<string, UsageBucket>();
  // Latency samples collected per key (+ overall) so we can compute p50/p95 after the pass.
  const latByFeature = new Map<string, number[]>();
  const latByModel = new Map<string, number[]>();
  const latTotal: number[] = [];
  const totals: Omit<UsageBucket, 'key'> = { calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0, p50LatencyMs: null, p95LatencyMs: null };

  const bump = (map: Map<string, UsageBucket>, key: string, r: UsageRow, cost: number) => {
    const b = map.get(key) ?? { key, calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0, p50LatencyMs: null, p95LatencyMs: null };
    b.calls += 1;
    b.inputTokens += r.inputTokens;
    b.outputTokens += r.outputTokens;
    b.cacheCreationTokens += r.cacheCreationTokens;
    b.cacheReadTokens += r.cacheReadTokens;
    b.estimatedCostUsd += cost;
    map.set(key, b);
  };
  const pushLat = (map: Map<string, number[]>, key: string, lat: number) => {
    const a = map.get(key) ?? [];
    if (a.length === 0) map.set(key, a);
    a.push(lat);
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
    if (r.latencyMs != null) {
      latTotal.push(r.latencyMs);
      pushLat(latByFeature, r.feature, r.latencyMs);
      pushLat(latByModel, r.model, r.latencyMs);
    }
  }

  // Attach p50/p95 to each bucket from its collected latency samples.
  const attachLatency = (map: Map<string, UsageBucket>, latMap: Map<string, number[]>) => {
    for (const [key, b] of map) {
      const arr = (latMap.get(key) ?? []).slice().sort((x, y) => x - y);
      b.p50LatencyMs = percentile(arr, 50);
      b.p95LatencyMs = percentile(arr, 95);
    }
  };
  attachLatency(byFeature, latByFeature);
  attachLatency(byModel, latByModel);
  const latTotalSorted = latTotal.slice().sort((x, y) => x - y);
  totals.p50LatencyMs = percentile(latTotalSorted, 50);
  totals.p95LatencyMs = percentile(latTotalSorted, 95);

  const sort = (a: UsageBucket, b: UsageBucket) => b.estimatedCostUsd - a.estimatedCostUsd;
  return {
    since: since.toISOString(),
    totals,
    byFeature: [...byFeature.values()].sort(sort),
    byModel: [...byModel.values()].sort(sort),
  };
}
