// Quality-trend dashboard (round-6 #5). Aggregates the AiJudgeSample rows recorded by
// lib/aiJudgeSample into daily buckets so an admin can watch Anett's real answer quality over time.
// ADMIN/PMO only. Tenant-scoped via the Prisma extension (findMany is auto-filtered to the caller).
import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Forbidden } from '../../lib/errors.js';
import { aiEnabled } from '../../lib/ai.js';
import { judgeSampleRate } from '../../lib/aiJudgeSample.js';
import { canWriteTenantScope } from './memory.service.js';

export interface JudgeTrendBucket {
  date: string; // YYYY-MM-DD (day bucket)
  count: number;
  avgOverall: number;
  passRate: number;
  avgGroundedness: number;
  avgHelpfulness: number;
  avgClarity: number;
}
export interface JudgeTrendRecent {
  question: string;
  overall: number;
  pass: boolean;
  rationale: string;
  createdAt: Date;
}
// Per-feature roll-up over the whole window (phase 2): which generative surface — chat, briefings,
// review, EVM explainer, … — is scoring well vs. regressing. Always computed over EVERY feature's rows
// (not scoped by the active filter) so the breakdown list stays complete while you drill into one.
export interface JudgeFeatureStat {
  feature: string;
  count: number;
  avgOverall: number;
  passRate: number;
  avgGroundedness: number;
  avgHelpfulness: number;
  avgClarity: number;
}
export interface JudgeTrend {
  enabled: boolean;   // is sampling currently armed (rate > 0 + key)?
  sampleRate: number;
  feature: string | null; // the active feature filter (null = all features)
  totalSamples: number;
  avgOverall: number; // across the whole window
  passRate: number;
  buckets: JudgeTrendBucket[];
  byFeature: JudgeFeatureStat[];
  recent: JudgeTrendRecent[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const avg = (xs: number[]): number => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export async function getJudgeTrend(caller: { role: Role }, opts?: { days?: number; feature?: string | null }): Promise<JudgeTrend> {
  if (!canWriteTenantScope(caller.role)) throw Forbidden('Hanya admin/PMO yang dapat melihat tren kualitas Anett.');
  const days = Math.max(1, Math.min(365, opts?.days ?? 30));
  const feature = opts?.feature?.trim() || null;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const all = await prisma.aiJudgeSample.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { question: true, feature: true, overall: true, pass: true, rationale: true, groundedness: true, helpfulness: true, clarity: true, createdAt: true },
  });

  // Per-feature breakdown over the WHOLE window (independent of the active filter). Sorted by volume so
  // the busiest surfaces lead; each row is a mini-scorecard the admin can scan for a lagging feature.
  const byFeatureMap = new Map<string, typeof all>();
  for (const r of all) {
    const bucket = byFeatureMap.get(r.feature) ?? [];
    if (bucket.length === 0) byFeatureMap.set(r.feature, bucket);
    bucket.push(r);
  }
  const byFeature: JudgeFeatureStat[] = [...byFeatureMap.entries()]
    .map(([feat, rs]) => ({
      feature: feat,
      count: rs.length,
      avgOverall: avg(rs.map((r) => r.overall)),
      passRate: round2(rs.filter((r) => r.pass).length / rs.length),
      avgGroundedness: avg(rs.map((r) => r.groundedness)),
      avgHelpfulness: avg(rs.map((r) => r.helpfulness)),
      avgClarity: avg(rs.map((r) => r.clarity)),
    }))
    .sort((a, b) => b.count - a.count);

  // The daily buckets, headline average and recent list reflect the ACTIVE feature filter (all when none).
  const rows = feature ? all.filter((r) => r.feature === feature) : all;

  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.createdAt.toISOString().slice(0, 10);
    const bucket = byDay.get(key) ?? [];
    if (bucket.length === 0) byDay.set(key, bucket);
    bucket.push(r);
  }
  const buckets: JudgeTrendBucket[] = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rs]) => ({
      date,
      count: rs.length,
      avgOverall: avg(rs.map((r) => r.overall)),
      passRate: round2(rs.filter((r) => r.pass).length / rs.length),
      avgGroundedness: avg(rs.map((r) => r.groundedness)),
      avgHelpfulness: avg(rs.map((r) => r.helpfulness)),
      avgClarity: avg(rs.map((r) => r.clarity)),
    }));

  return {
    enabled: judgeSampleRate() > 0 && aiEnabled(),
    sampleRate: judgeSampleRate(),
    feature,
    totalSamples: rows.length,
    avgOverall: avg(rows.map((r) => r.overall)),
    passRate: rows.length ? round2(rows.filter((r) => r.pass).length / rows.length) : 0,
    buckets,
    byFeature,
    recent: rows.slice(0, 10).map((r) => ({ question: r.question, overall: r.overall, pass: r.pass, rationale: r.rationale, createdAt: r.createdAt })),
  };
}
