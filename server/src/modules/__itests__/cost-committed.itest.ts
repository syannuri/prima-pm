import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { getCostSummary } from '../cost/cost.service.js';

// Committed cost = value of contracts/POs charged to a budget line and currently obligated
// (AWARDED / IN_PROGRESS / DELIVERED). PLANNED/SOLICITATION aren't committed yet; CLOSED/CANCELLED
// don't count. getCostSummary rolls this up per line and overall.
let pmId = '';
let seq = 0;

async function project() {
  seq += 1;
  return prisma.project.create({
    data: { code: `PRJ-CM-${String(seq).padStart(4, '0')}`, name: `Committed ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
}

let prc = 0;
const contract = (projectId: string, amount: number, status: string, link: { costDirectLineId?: string; costIndirectLineId?: string }) => {
  prc += 1;
  return prisma.procurement.create({
    data: { projectId, code: `PRC-${String(prc).padStart(3, '0')}`, title: `C${prc}`, amount, status: status as never, ...link },
  });
};

describe('Committed cost roll-up (getCostSummary)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'CM PM', email: 'cm-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.project.deleteMany({});
  });

  it('sums obligated contracts per line and overall; ignores non-committed statuses', async () => {
    const p = await project();
    const hw = await prisma.costItemDirect.create({ data: { projectId: p.id, type: 'HARDWARE_EQUIPMENT', label: 'Servers', qty: 1, unitCost: 1000, amount: 1000 } });
    const travel = await prisma.costItemIndirect.create({ data: { projectId: p.id, type: 'TRANSPORTATION', description: 'Site visits', amount: 500 } });

    await contract(p.id, 300, 'AWARDED', { costDirectLineId: hw.id });      // counts
    await contract(p.id, 200, 'DELIVERED', { costDirectLineId: hw.id });    // counts
    await contract(p.id, 999, 'PLANNED', { costDirectLineId: hw.id });      // not committed yet
    await contract(p.id, 999, 'CANCELLED', { costDirectLineId: hw.id });    // excluded
    await contract(p.id, 150, 'IN_PROGRESS', { costIndirectLineId: travel.id }); // counts
    await contract(p.id, 999, 'AWARDED', {});                              // committed but unlinked → not per-line

    const s = await getCostSummary(p.id);

    const hwLine = s.directCosts.find((d) => d.id === hw.id)!;
    expect(hwLine.committed).toBe(500); // 300 + 200

    const travelLine = s.indirectCosts.find((i) => i.id === travel.id)!;
    expect(travelLine.committed).toBe(150);

    // Overall totals count only line-linked, committed contracts.
    expect(s.committedDirect).toBe(500);
    expect(s.committedIndirect).toBe(150);
    expect(s.committedTotal).toBe(650);
  });
});
