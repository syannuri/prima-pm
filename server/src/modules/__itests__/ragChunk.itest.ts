import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setEmbedder } from '../../lib/embeddings.js';
import { buildProjectChunks } from '../assistant/chunking.service.js';
import { reindexProject } from '../assistant/chunkIndex.service.js';

// RAG v2 Phase 1: chunking + chunk-index pipeline. A deterministic fake embedder (no key/network)
// returns a fixed-length vector per text, so reindex can run and cache. Verifies the chunk set per
// source entity, charter sectioning, docHash re-embed-only-when-changed, delete-on-removal, and
// tenant isolation.
let embedTexts = 0;
const fakeEmbedder = {
  async embed(texts: string[]) {
    embedTexts += texts.length;
    return texts.map((t) => [t.length % 7, (t.match(/a/g) || []).length, 1]);
  },
};

let prevFlag: string | undefined;
let tid = '';
let otherTid = '';
let projectId = '';
let riskId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  __setEmbedder(fakeEmbedder);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'rag', name: 'Rag' } }); tid = t.id;
  const o = await prisma.tenant.create({ data: { slug: 'rag2', name: 'Rag2' } }); otherTid = o.id;

  await runWithTenant(tid, async () => {
    const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@rag.test', role: 'PROJECT_MANAGER', passwordHash: 'x', isActive: true } });
    const p = await prisma.project.create({ data: { code: 'RG-1', name: 'Rag One', clientName: 'Acme' }, select: { id: true } });
    projectId = p.id;
    await prisma.projectCharter.create({ data: {
      projectId, description: 'Build a resilient network', goals: 'Zero downtime', category: 'NETWORK_INFRA',
      hiScope: 'Twelve sites in scope', hiCostIdr: 1_000_000_000, hiScheduleStart: new Date('2026-01-01'),
      hiScheduleEnd: new Date('2026-06-01'), hiDeliverables: 'Core switches deployed', pmUserId: pm.id,
    } });
    const r = await prisma.risk.create({ data: {
      projectId, code: 'R-1', title: 'Vendor hardware lead time', description: 'Long lead time delays cutovers',
      probabilityScore: 4, impactScore: 4, riskScore: 16, severity: 'HIGH', probabilityPct: 0.6, impactCostIdr: 200_000_000, emv: 120_000_000,
    }, select: { id: true } });
    riskId = r.id;
    await prisma.task.create({ data: { projectId, wbsCode: '1.1', name: 'Site survey', description: 'Survey all sites', planStart: new Date('2026-01-01'), planEnd: new Date('2026-01-15') } });
    await prisma.costItemDirect.create({ data: { projectId, type: 'HARDWARE_EQUIPMENT', label: 'Core switch hardware', subCategory: 'Hardware' } });
  });
});

afterAll(async () => {
  __setEmbedder(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('buildProjectChunks', () => {
  it('emits one chunk per source entity with the right type/source mapping', async () => {
    const chunks = await runWithTenant(tid, () => buildProjectChunks(projectId));
    // 4 charter sections + 1 risk + 1 task + 1 cost line = 7.
    expect(chunks.length).toBe(7);
    const charter = chunks.filter((c) => c.entityType === 'charter');
    expect(charter.length).toBe(4);
    expect(charter.every((c) => c.source === 'Overview')).toBe(true);
    // Charter sections carry the "<charterId>:<section>" entityId convention.
    expect(charter.map((c) => c.entityId.split(':')[1]).sort()).toEqual(['deliverables', 'description', 'goals', 'scope']);
    expect(chunks.find((c) => c.entityType === 'risk')).toMatchObject({ source: 'Risk', entityId: riskId, code: 'RG-1' });
    expect(chunks.find((c) => c.entityType === 'task')?.source).toBe('Schedule');
    expect(chunks.find((c) => c.entityType === 'cost')?.source).toBe('Cost');
    // Text is assembled title + body.
    expect(chunks.find((c) => c.entityType === 'risk')?.text).toContain('Vendor hardware lead time');
  });

  it('returns [] for an unknown / cross-tenant project', async () => {
    expect(await runWithTenant(otherTid, () => buildProjectChunks(projectId))).toEqual([]);
  });
});

describe('reindexProject', () => {
  it('embeds every chunk on first run, then re-embeds nothing when unchanged', async () => {
    await runAsSystem(() => prisma.chunkEmbedding.deleteMany({}));
    embedTexts = 0;
    const first = await runWithTenant(tid, () => reindexProject(projectId));
    expect(first).toMatchObject({ indexed: 7, deleted: 0, total: 7 });
    expect(embedTexts).toBe(7);
    expect(await runAsSystem(() => prisma.chunkEmbedding.count({ where: { projectId } }))).toBe(7);

    // Second run: nothing changed → no embed calls, no writes.
    embedTexts = 0;
    const second = await runWithTenant(tid, () => reindexProject(projectId));
    expect(second).toMatchObject({ indexed: 0, deleted: 0, total: 7 });
    expect(embedTexts).toBe(0);
  });

  it('deletes chunks whose source entity was removed', async () => {
    await runWithTenant(tid, () => reindexProject(projectId)); // ensure warm
    await runWithTenant(tid, () => prisma.risk.delete({ where: { id: riskId } }));
    const res = await runWithTenant(tid, () => reindexProject(projectId));
    expect(res.deleted).toBe(1);
    expect(await runAsSystem(() => prisma.chunkEmbedding.count({ where: { projectId } }))).toBe(6);
    expect(await runAsSystem(() => prisma.chunkEmbedding.count({ where: { projectId, entityType: 'risk' } }))).toBe(0);
  });

  it('keeps chunks tenant-isolated', async () => {
    await runWithTenant(tid, () => reindexProject(projectId));
    expect(await runWithTenant(otherTid, () => prisma.chunkEmbedding.count({}))).toBe(0);
  });
});
