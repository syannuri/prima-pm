import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setEmbedder } from '../../lib/embeddings.js';
import { searchProjects, searchProjectsDetailed, getSearchStatus } from '../assistant/search.service.js';

// Semantic search v2 (#1): a deterministic fake embedder maps text → a 3-dim keyword-count vector, so
// cosine ranking is predictable without a network/Voyage key. Verifies meaning-based ranking, the
// docHash re-embed cache (a repeat search only embeds the query), and the FTS fallback when disabled.
const KEYS = ['alpha', 'beta', 'gamma'];
let embedCalls = 0; let embedTexts = 0;
const fakeEmbedder = {
  async embed(texts: string[]) {
    embedCalls += 1; embedTexts += texts.length;
    return texts.map((t) => KEYS.map((k) => (t.match(new RegExp(k, 'g')) || []).length));
  },
};

let prevKey: string | undefined; let prevFlag: string | undefined;
let tid = ''; let idA = ''; let idB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevKey = process.env.VOYAGE_API_KEY;
  __setEmbedder(fakeEmbedder);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'sem', name: 'Sem' } }); tid = t.id;
  await runWithTenant(tid, async () => {
    // The searchable signal lives in clientName (part of the doc) — avoids Risk's many required fields.
    const a = await prisma.project.create({ data: { code: 'SM-A', name: 'Proj A', clientName: 'alpha alpha' }, select: { id: true } });
    const b = await prisma.project.create({ data: { code: 'SM-B', name: 'Proj B', clientName: 'beta' }, select: { id: true } });
    idA = a.id; idB = b.id;
  });
});

afterAll(async () => {
  __setEmbedder(null);
  if (prevKey === undefined) delete process.env.VOYAGE_API_KEY; else process.env.VOYAGE_API_KEY = prevKey;
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

beforeEach(() => { embedCalls = 0; embedTexts = 0; });

describe('semanticSearchProjects (#1)', () => {
  it('ranks by meaning and drops low-similarity projects', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    await runAsSystem(() => prisma.projectEmbedding.deleteMany({}));
    const hits = await runWithTenant(tid, () => searchProjects('alpha', [idA, idB]));
    expect(hits.map((h) => h.code)).toEqual(['SM-A']); // B (beta) is orthogonal → below threshold
    expect(hits[0].rank).toBeCloseTo(1, 5);
    // Both project docs got embedded + cached.
    const rows = await runAsSystem(() => prisma.projectEmbedding.count({}));
    expect(rows).toBe(2);
  });

  it('re-uses cached embeddings — a repeat search only embeds the query', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    // Warm the cache.
    await runWithTenant(tid, () => searchProjects('alpha', [idA, idB]));
    embedCalls = 0; embedTexts = 0;
    await runWithTenant(tid, () => searchProjects('beta', [idA, idB]));
    expect(embedCalls).toBe(1); // no doc re-embed (unchanged) — just the query
    expect(embedTexts).toBe(1);
  });

  it('falls back to lexical FTS when embeddings are disabled', async () => {
    delete process.env.VOYAGE_API_KEY;
    embedCalls = 0;
    const hits = await runWithTenant(tid, () => searchProjects('alpha', [idA, idB]));
    expect(embedCalls).toBe(0); // never called the embedder
    expect(hits.some((h) => h.code === 'SM-A')).toBe(true); // FTS matches 'alpha' in clientName
  });

  // #4 pilot observability: the returned mode reflects which engine actually ran.
  it('reports mode "semantic" when armed and "fts" when disabled', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    const armed = await runWithTenant(tid, () => searchProjectsDetailed('alpha', [idA, idB]));
    expect(armed.mode).toBe('semantic');
    delete process.env.VOYAGE_API_KEY;
    const off = await runWithTenant(tid, () => searchProjectsDetailed('alpha', [idA, idB]));
    expect(off.mode).toBe('fts');
  });

  it('status probe reflects the armed state + cached vector count, and is ADMIN/PMO-only', async () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    await runAsSystem(() => prisma.projectEmbedding.deleteMany({}));
    await runWithTenant(tid, () => searchProjects('alpha', [idA, idB])); // warms 2 vectors
    const status = await runWithTenant(tid, () => getSearchStatus({ role: 'ADMIN' }));
    expect(status).toMatchObject({ enabled: true, model: 'voyage-3', cachedVectors: 2 });
    // A non-governance role is refused.
    await expect(runWithTenant(tid, () => getSearchStatus({ role: 'VIEWER' }))).rejects.toThrow();
    delete process.env.VOYAGE_API_KEY;
    const off = await runWithTenant(tid, () => getSearchStatus({ role: 'ADMIN' }));
    expect(off.enabled).toBe(false);
  });
});
