import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { reorderDirectLines, addDirectLine, getCostSummary } from '../cost/cost.service.js';

// Direct cost lines carry a manual sortOrder (drag/keyboard reorder). reorderDirectLines re-numbers
// them from the supplied id list; getCostSummary returns them in that order. New lines append.
let pmId = '';
let seq = 0;

async function project() {
  seq += 1;
  return prisma.project.create({
    data: { code: `PRJ-RO-${String(seq).padStart(4, '0')}`, name: `Reorder ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
}

const material = (projectId: string, label: string, sortOrder: number) =>
  prisma.costItemDirect.create({ data: { projectId, type: 'SOFTWARE_LICENSE', label, qty: 1, unitCost: 10, amount: 10, sortOrder } });

describe('Direct cost reorder (sortOrder)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'RO PM', email: 'ro-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.project.deleteMany({});
  });

  it('re-numbers sortOrder from the supplied order and the summary reflects it', async () => {
    const p = await project();
    const a = await material(p.id, 'A', 1);
    const b = await material(p.id, 'B', 2);
    const c = await material(p.id, 'C', 3);

    await reorderDirectLines(p.id, [c.id, a.id, b.id], pmId);

    const s = await getCostSummary(p.id);
    expect(s.directCosts.map((d) => d.label)).toEqual(['C', 'A', 'B']);
    expect(s.directCosts.map((d) => d.sortOrder)).toEqual([1, 2, 3]);
  });

  it('ignores unknown / cross-project ids', async () => {
    const p = await project();
    const a = await material(p.id, 'A', 5);

    // A bogus id is silently dropped; the known line still gets a clean 1-based order.
    await reorderDirectLines(p.id, ['00000000-0000-0000-0000-000000000000', a.id], pmId);
    const row = await prisma.costItemDirect.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.sortOrder).toBe(1);
  });

  it('addDirectLine appends after the current max sortOrder', async () => {
    const p = await project();
    await material(p.id, 'Existing', 7);

    const created = await addDirectLine(p.id, { type: 'OTHER', label: 'New', qty: 1, unitCost: 1, subCategory: 'Misc' }, pmId);
    expect(created.sortOrder).toBe(8);
  });
});
