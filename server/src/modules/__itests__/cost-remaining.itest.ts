import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { addActualCost, getCostSummary } from '../cost/cost.service.js';

// Per-component (per-line) remaining: getCostSummary must attach spent-to-date + remaining to
// each budget line — manpower from the timesheet, material/indirect from attributed Actual Cost —
// while unattributed spend still rolls up to the Direct/Indirect bucket (backward compatible).
let pmId = '';
let seq = 0;

async function project() {
  seq += 1;
  return prisma.project.create({
    data: {
      code: `PRJ-CR-${String(seq).padStart(4, '0')}`,
      name: `CostRem ${seq}`,
      status: 'IN_PROGRESS',
      deliveryApproach: 'PREDICTIVE',
      pmUserId: pmId,
    },
  });
}

describe('Per-component remaining (getCostSummary)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'CR PM', email: 'cr-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.project.deleteMany({});
  });

  it('reports per-line spent/remaining and keeps bucket totals consistent', async () => {
    const p = await project();

    // Material direct line: budget 100.
    const material = await prisma.costItemDirect.create({
      data: { projectId: p.id, type: 'SOFTWARE_LICENSE', label: 'IDE licenses', qty: 1, unitCost: 100, amount: 100 },
    });
    // Manpower direct line: rate 10 × 5 md = budget 50; 3 md logged → labour actual 30.
    const manpower = await prisma.costItemDirect.create({
      data: { projectId: p.id, type: 'MANPOWER', label: 'Engineer', personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 10, planMandays: 5, manpowerCost: 50 },
    });
    await prisma.mandayEntry.createMany({
      data: [
        { projectId: p.id, costItemId: manpower.id, date: new Date('2026-07-01'), mandays: 2 },
        { projectId: p.id, costItemId: manpower.id, date: new Date('2026-07-02'), mandays: 1 },
      ],
    });
    // Indirect line: budget 80.
    const indirect = await prisma.costItemIndirect.create({
      data: { projectId: p.id, type: 'TRANSPORTATION', description: 'Site visits', amount: 80 },
    });

    // Attributed + unattributed actuals (category derives from the picked line).
    await addActualCost(p.id, { date: new Date('2026-07-03'), amount: 40, directLineId: material.id }, pmId);
    await addActualCost(p.id, { date: new Date('2026-07-04'), amount: 5, category: 'DIRECT' }, pmId); // general direct
    await addActualCost(p.id, { date: new Date('2026-07-05'), amount: 30, indirectLineId: indirect.id }, pmId);
    await addActualCost(p.id, { date: new Date('2026-07-06'), amount: 10, category: 'INDIRECT' }, pmId); // general indirect

    const s = await getCostSummary(p.id);

    const mat = s.directCosts.find((d) => d.id === material.id)!;
    expect(mat.actualToDate).toBe(40);
    expect(mat.remaining).toBe(60);

    const mp = s.directCosts.find((d) => d.id === manpower.id)!;
    expect(mp.actualToDate).toBe(30); // 3 md × 10, from timesheet
    expect(mp.remaining).toBe(20);

    const ind = s.indirectCosts.find((i) => i.id === indirect.id)!;
    expect(ind.actualToDate).toBe(30);
    expect(ind.remaining).toBe(50);

    // Unattributed buckets = category actual − attributed portion.
    expect(s.unattributedDirectActual).toBe(5);
    expect(s.unattributedIndirectActual).toBe(10);

    // Reconciliation: bucket totals unchanged by attribution.
    expect(s.directActual).toBe(75); // labour 30 + material 40 + general 5
    expect(s.indirectActual).toBe(40); // 30 + 10

    // Per-line direct actual + unattributed = directMaterialActual (excludes labour).
    const attributedDirect = s.directCosts.filter((d) => d.type !== 'MANPOWER').reduce((a, d) => a + d.actualToDate, 0);
    expect(attributedDirect + s.unattributedDirectActual).toBe(s.directActual - s.labourActual);
  });

  it('derives category from the attributed line and rejects a foreign line', async () => {
    const p = await project();
    const other = await project();
    const line = await prisma.costItemIndirect.create({ data: { projectId: p.id, type: 'MEALS_PERDIEM', description: 'Lunch', amount: 20 } });

    // Category follows the line even if the payload omits/contradicts it.
    const entry = await addActualCost(p.id, { date: new Date('2026-07-03'), amount: 5, category: 'DIRECT', indirectLineId: line.id }, pmId);
    expect(entry.category).toBe('INDIRECT');
    expect(entry.indirectLineId).toBe(line.id);

    // A line from another project must not be attributable.
    await expect(addActualCost(other.id, { date: new Date('2026-07-03'), amount: 5, indirectLineId: line.id }, pmId)).rejects.toThrow();
  });
});
