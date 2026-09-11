import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { recordJudgeSample, shouldSampleJudge, judgeSampleRate } from '../../lib/aiJudgeSample.js';
import { getJudgeTrend } from '../assistant/judgeTrend.service.js';

// Quality-trend sampling (#5). A fake judge port returns a fixed rubric verdict so scoring is
// deterministic without a key/network. Covers the sampling gate, tenant-scoped recording, the ~500-char
// snippet clip, and the ADMIN-only trend aggregation.
const judgePort = (g: number, h: number, c: number): AiPort => ({
  async draftJson() { return { groundedness: g, helpfulness: h, clarity: c, rationale: 'ok' }; },
  async draftNarrative() { return null; },
  async runToolLoop() { return 'ok'; },
});

let prevKey: string | undefined; let prevRate: string | undefined; let prevFlag: string | undefined;
let tidA = ''; let tidB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevKey = process.env.ANTHROPIC_API_KEY; prevRate = process.env.AI_JUDGE_SAMPLE_RATE;
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'jsa', name: 'JS-A' } }); tidA = a.id;
  const b = await prisma.tenant.create({ data: { slug: 'jsb', name: 'JS-B' } }); tidB = b.id;
});

afterAll(() => {
  __setAiPort(null);
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
  if (prevRate === undefined) delete process.env.AI_JUDGE_SAMPLE_RATE; else process.env.AI_JUDGE_SAMPLE_RATE = prevRate;
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('AiJudgeSample (#5 quality-trend sampling)', () => {
  it('gates sampling on both the rate and the AI key', () => {
    delete process.env.AI_JUDGE_SAMPLE_RATE;
    expect(shouldSampleJudge()).toBe(false);        // rate unset ⇒ off
    process.env.AI_JUDGE_SAMPLE_RATE = '1';
    delete process.env.ANTHROPIC_API_KEY;
    expect(shouldSampleJudge()).toBe(false);        // no key ⇒ off even at rate 1
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(judgeSampleRate()).toBe(1);
    expect(shouldSampleJudge()).toBe(true);         // rate 1 + key ⇒ always sample
    process.env.AI_JUDGE_SAMPLE_RATE = '0';
    expect(shouldSampleJudge()).toBe(false);
  });

  it('records a judged sample scoped to the caller tenant', async () => {
    __setAiPort(judgePort(5, 4, 4)); // overall 4.33 ⇒ pass (≥ 3.5)
    const ok = await runWithTenant(tidA, () => recordJudgeSample({ question: 'q1', answer: 'a1', userId: 'u1' }));
    expect(ok).toBe(true);
    const rows = await runWithTenant(tidA, () => prisma.aiJudgeSample.findMany());
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ groundedness: 5, helpfulness: 4, clarity: 4, pass: true, feature: 'assistant_qa', userId: 'u1' });
    // Tenant isolation: B sees nothing.
    const other = await runWithTenant(tidB, () => prisma.aiJudgeSample.findMany());
    expect(other.length).toBe(0);
  });

  it('clips a long question/answer to the snippet length', async () => {
    __setAiPort(judgePort(3, 3, 3)); // overall 3.0 ⇒ fail
    const long = 'x'.repeat(900);
    await runWithTenant(tidA, () => recordJudgeSample({ question: long, answer: long }));
    const row = await runWithTenant(tidA, () => prisma.aiJudgeSample.findFirst({ orderBy: { createdAt: 'desc' } }));
    expect(row!.question.length).toBe(500);
    expect(row!.pass).toBe(false);
  });

  it('aggregates a quality trend (avg/pass-rate/buckets) and is ADMIN/PMO-only', async () => {
    // tidA now has 2 rows: one pass (4.33), one fail (3.0).
    const trend = await runWithTenant(tidA, () => getJudgeTrend({ role: 'ADMIN' }, { days: 30 }));
    expect(trend.totalSamples).toBe(2);
    expect(trend.passRate).toBe(0.5);
    expect(trend.avgOverall).toBeCloseTo(3.67, 1);
    expect(trend.buckets.length).toBe(1); // all recorded today
    expect(trend.buckets[0].count).toBe(2);
    expect(trend.recent.length).toBe(2);
    // A non-governance role is refused.
    await expect(runWithTenant(tidA, () => getJudgeTrend({ role: 'VIEWER' }))).rejects.toThrow();
    // Empty tenant → zeros, not an error.
    const empty = await runWithTenant(tidB, () => getJudgeTrend({ role: 'ADMIN' }));
    expect(empty.totalSamples).toBe(0);
    expect(empty.passRate).toBe(0);
  });

  it('passes the tool context to the judge so groundedness is graded against real data', async () => {
    let capturedUser = '';
    __setAiPort({
      async draftJson({ user }) { capturedUser = String(user); return { groundedness: 5, helpfulness: 5, clarity: 5, rationale: 'ok' }; },
      async draftNarrative() { return null; },
      async runToolLoop() { return 'ok'; },
    });
    await runWithTenant(tidA, () => recordJudgeSample({ question: 'status?', answer: 'green', context: 'SPI=0.92 CPI=1.16 BAC=3089' }));
    expect(capturedUser).toContain('Context:');
    expect(capturedUser).toContain('SPI=0.92 CPI=1.16 BAC=3089'); // the judge can now verify the numbers
  });
});
