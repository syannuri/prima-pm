import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { searchProjects } from '../assistant/search.service.js';

// Cross-project full-text search (Anett's search_projects tool). Verifies FTS matching, that a
// project's aggregated text (here a risk description) is searchable, and — since the query is raw SQL
// that bypasses the tenant-extension — that the manual tenant filter isolates workspaces.
let prevFlag: string | undefined;
let tidA = '', tidB = '';
let p1 = '', p2 = '', p3 = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const A = await prisma.tenant.create({ data: { slug: 'srcha', name: 'Search A' } }); tidA = A.id;
  const B = await prisma.tenant.create({ data: { slug: 'srchb', name: 'Search B' } }); tidB = B.id;

  // Seed the searchable phrase via clientName (also part of the FTS doc). The full query still runs
  // its charter/risk/CR/lesson/issue subqueries (empty here) — so the whole SQL path is exercised.
  await runWithTenant(tidA, async () => {
    const a1 = await prisma.project.create({ data: { code: 'SRCH-1', name: 'Alpha', clientName: 'Requirements kept expanding — clear scope creep every sprint', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } }); p1 = a1.id;
    const a2 = await prisma.project.create({ data: { code: 'SRCH-2', name: 'Beta', clientName: 'Costs trending above the budget baseline', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } }); p2 = a2.id;
  });
  await runWithTenant(tidB, async () => {
    const b1 = await prisma.project.create({ data: { code: 'SRCH-3', name: 'Gamma', clientName: 'Scope creep on vendor deliverables', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } }); p3 = b1.id;
  });
});

afterAll(() => { if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag; });

describe('searchProjects (FTS cross-project)', () => {
  it('finds the project whose text matches; excludes non-matching', async () => {
    const hits = await runWithTenant(tidA, () => searchProjects('scope creep', [p1, p2]));
    const codes = hits.map((h) => h.code);
    expect(codes).toContain('SRCH-1');
    expect(codes).not.toContain('SRCH-2');
    expect(hits.find((h) => h.code === 'SRCH-1')?.snippet.toLowerCase()).toContain('scope');
  });

  it('is tenant-scoped: a projectId from another tenant is filtered out', async () => {
    const hits = await runWithTenant(tidA, () => searchProjects('scope creep', [p1, p3])); // p3 is tenant B
    const codes = hits.map((h) => h.code);
    expect(codes).toContain('SRCH-1');
    expect(codes).not.toContain('SRCH-3'); // in projectIds but filtered by the manual tenant guard
  });

  it('empty / whitespace query returns nothing', async () => {
    const hits = await runWithTenant(tidA, () => searchProjects('   ', [p1, p2]));
    expect(hits).toEqual([]);
  });
});
