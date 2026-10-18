import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setEmbedder } from '../../lib/embeddings.js';
import { retrieveChunks, buildRagGroundingBlock } from '../assistant/knowledge.service.js';
import { getSearchStatus } from '../assistant/search.service.js';

// RAG v2 Phase 2: chunk retrieval. A deterministic fake embedder maps text → a 3-dim keyword-count
// vector (vendor/scope/survey), so cosine ranking is predictable with no key/network. Verifies
// meaning-based chunk ranking + citation metadata, the min-score drop, the lexical fallback when
// Voyage is disabled, tenant isolation, and the status probe's chunk count.
const KEYS = ['vendor', 'scope', 'survey'];
const fakeEmbedder = {
  async embed(texts: string[]) {
    return texts.map((t) => KEYS.map((k) => (t.toLowerCase().match(new RegExp(k, 'g')) || []).length));
  },
};

let prevFlag: string | undefined; let prevKey: string | undefined;
let tid = ''; let otherTid = ''; let projectId = ''; let riskId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevKey = process.env.VOYAGE_API_KEY;
  __setEmbedder(fakeEmbedder);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'kn', name: 'Kn' } }); tid = t.id;
  const o = await prisma.tenant.create({ data: { slug: 'kn2', name: 'Kn2' } }); otherTid = o.id;
  await runWithTenant(tid, async () => {
    const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@kn.test', role: 'PROJECT_MANAGER', passwordHash: 'x', isActive: true } });
    const p = await prisma.project.create({ data: { code: 'KN-1', name: 'Kn One', clientName: 'Acme' }, select: { id: true } });
    projectId = p.id;
    await prisma.projectCharter.create({ data: {
      projectId, description: 'A delivery project', goals: 'On time', category: 'NETWORK_INFRA',
      hiScope: 'The scope scope covers twelve sites', hiCostIdr: 1_000_000_000, hiScheduleStart: new Date('2026-01-01'),
      hiScheduleEnd: new Date('2026-06-01'), hiDeliverables: 'Switches', pmUserId: pm.id,
    } });
    const r = await prisma.risk.create({ data: {
      projectId, code: 'R-1', title: 'Vendor vendor lead time', description: 'A vendor delays things',
      probabilityScore: 4, impactScore: 4, riskScore: 16, severity: 'HIGH', probabilityPct: 0.6, impactCostIdr: 200_000_000, emv: 120_000_000,
    }, select: { id: true } });
    riskId = r.id;
    await prisma.task.create({ data: { projectId, wbsCode: '1.1', name: 'Site survey survey', planStart: new Date('2026-01-01'), planEnd: new Date('2026-01-15') } });
  });
});

afterAll(async () => {
  __setEmbedder(null);
  delete process.env.AI_RAG_GROUNDING;
  if (prevKey === undefined) delete process.env.VOYAGE_API_KEY; else process.env.VOYAGE_API_KEY = prevKey;
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('retrieveChunks', () => {
  it('ranks the most relevant chunk first and carries citation metadata (semantic)', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    await runAsSystem(() => prisma.chunkEmbedding.deleteMany({}));
    const { mode, hits } = await runWithTenant(tid, () => retrieveChunks('vendor', [projectId]));
    expect(mode).toBe('semantic');
    // The vendor risk chunk wins; orthogonal chunks (scope/survey) are below the min-score floor.
    expect(hits[0]).toMatchObject({ entityType: 'risk', source: 'Risk', entityId: riskId, code: 'KN-1' });
    expect(hits[0].score).toBeCloseTo(1, 5);
    expect(hits.every((h) => h.entityType === 'risk')).toBe(true);
  });

  it('ranks a different query to its matching chunk', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    const { hits } = await runWithTenant(tid, () => retrieveChunks('survey', [projectId]));
    expect(hits[0].entityType).toBe('task');
    expect(hits[0].source).toBe('Schedule');
  });

  it('falls back to lexical retrieval over live text when Voyage is disabled', async () => {
    delete process.env.VOYAGE_API_KEY;
    await runAsSystem(() => prisma.chunkEmbedding.deleteMany({})); // no cached vectors at all
    const { mode, hits } = await runWithTenant(tid, () => retrieveChunks('vendor', [projectId]));
    expect(mode).toBe('fts');
    expect(hits.some((h) => h.entityType === 'risk' && h.entityId === riskId)).toBe(true);
  });

  it('is tenant-isolated (another tenant retrieves nothing for this project)', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    const { hits } = await runWithTenant(otherTid, () => retrieveChunks('vendor', [projectId]));
    expect(hits).toEqual([]);
  });

  it('status probe reports cached chunk count alongside project vectors', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    await runWithTenant(tid, () => retrieveChunks('vendor', [projectId])); // warms chunk cache
    const status = await runWithTenant(tid, () => getSearchStatus({ role: 'ADMIN' }));
    expect(status.enabled).toBe(true);
    expect(status.cachedChunks).toBeGreaterThan(0);
  });
});

describe('buildRagGroundingBlock (auto-grounding, Phase 3)', () => {
  it('is empty when the flag is off (zero behaviour change)', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    delete process.env.AI_RAG_GROUNDING;
    expect(await runWithTenant(tid, () => buildRagGroundingBlock('vendor', [projectId], true))).toBe('');
  });

  it('is empty when embeddings are disabled, even with the flag on', async () => {
    process.env.AI_RAG_GROUNDING = '1';
    delete process.env.VOYAGE_API_KEY;
    expect(await runWithTenant(tid, () => buildRagGroundingBlock('vendor', [projectId], true))).toBe('');
  });

  it('injects the retrieved chunk text + a row-level citation marker when armed', async () => {
    process.env.AI_RAG_GROUNDING = '1';
    process.env.VOYAGE_API_KEY = 'test-key';
    const block = await runWithTenant(tid, () => buildRagGroundingBlock('vendor', [projectId], true));
    expect(block.toLowerCase()).toContain('vendor');
    expect(block).toContain(`[[cite:KN-1|Risk|${riskId}]]`); // exact-row citation hint
  });
});
