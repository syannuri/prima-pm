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
export interface JudgeTrend {
  enabled: boolean;   // is sampling currently armed (rate > 0 + key)?
  sampleRate: number;
  totalSamples: number;
  avgOverall: number; // across the whole window
  passRate: number;
  buckets: JudgeTrendBucket[];
  recent: JudgeTrendRecent[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const avg = (xs: number[]): number => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export async function getJudgeTrend(caller: { role: Role }, opts?: { days?: number }): Promise<JudgeTrend> {
  if (!canWriteTenantScope(caller.role)) throw Forbidden('Hanya admin/PMO yang dapat melihat tren kualitas Anett.');
  const days = Math.max(1, Math.min(365, opts?.days ?? 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.aiJudgeSample.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { question: true, overall: true, pass: true, rationale: true, groundedness: true, helpfulness: true, clarity: true, createdAt: true },
  });

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
    totalSamples: rows.length,
    avgOverall: avg(rows.map((r) => r.overall)),
    passRate: rows.length ? round2(rows.filter((r) => r.pass).length / rows.length) : 0,
    buckets,
    recent: rows.slice(0, 10).map((r) => ({ question: r.question, overall: r.overall, pass: r.pass, rationale: r.rationale, createdAt: r.createdAt })),
  };
}
