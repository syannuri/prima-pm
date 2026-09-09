import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Quantitative risk Monte-Carlo endpoint: GET /projects/:id/risks/simulation → exposure distribution
// (percentiles + recommended reserve at a confidence level). Read-only, seeded per project.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let ownerToken = '';
let tenantId = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'mcrisk', name: 'MC Risk Co' } });
  tenantId = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@mcrisk.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: tenantId });

  await runWithTenant(tenantId, async () => {
    const proj = await prisma.project.create({
      data: { code: 'MC-1', name: 'MC Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
      select: { id: true },
    });
    projectId = proj.id;
    // Three threats: Σ emv = 3.0M + 2.0M + 3.0M = 8.0M
    const rows = [
      { code: 'R-1', title: 'Vendor delay', probabilityScore: 3, impactScore: 4, prob: 0.3, impact: 10_000_000 },
      { code: 'R-2', title: 'Scope creep', probabilityScore: 4, impactScore: 3, prob: 0.5, impact: 4_000_000 },
      { code: 'R-3', title: 'Rework', probabilityScore: 2, impactScore: 5, prob: 0.2, impact: 15_000_000 },
    ];
    for (const r of rows) {
      await prisma.risk.create({
        data: {
          projectId, code: r.code, title: r.title, status: 'IDENTIFIED', kind: 'THREAT',
          probabilityScore: r.probabilityScore, impactScore: r.impactScore,
          riskScore: r.probabilityScore * r.impactScore, severity: 'HIGH',
          probabilityPct: r.prob, impactCostIdr: r.impact, emv: r.prob * r.impact,
          includeInReserve: true,
        },
      });
    }
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

const url = () => api(`/projects/${projectId}/risk/simulation`);

describe('risk Monte-Carlo simulation endpoint', () => {
  it('rejects unauthenticated access', async () => {
    await request(app).get(url()).expect(401);
  });

  it('returns a distribution whose mean ties back to the deterministic EMV', async () => {
    const res = await request(app).get(url()).query({ iterations: 20000, confidence: 0.8 }).set(bearer(ownerToken)).expect(200);
    expect(res.body.riskCount).toBe(3);
    expect(res.body.deterministicEmv).toBeCloseTo(8_000_000, 0);
    expect(Math.abs(res.body.mean - 8_000_000) / 8_000_000).toBeLessThan(0.03);
    // Monotonic percentile ladder + reserve == the confidence percentile.
    const { p50, p80, p90, p95 } = res.body.percentiles;
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(res.body.recommendedReserve).toBe(p80);
    expect(Array.isArray(res.body.histogram)).toBe(true);
    expect(res.body.histogram.length).toBeGreaterThan(0);
  });

  it('is reproducible (seeded per project) across calls', async () => {
    const a = await request(app).get(url()).query({ iterations: 8000 }).set(bearer(ownerToken)).expect(200);
    const b = await request(app).get(url()).query({ iterations: 8000 }).set(bearer(ownerToken)).expect(200);
    expect(b.body).toEqual(a.body);
  });
});
