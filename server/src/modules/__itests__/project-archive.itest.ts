import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { archiveProject, unarchiveProject, listProjectDatabase, listProjects } from '../projects/projects.service.js';
import { getPortfolioSummary } from '../portfolio/portfolio.service.js';

// Project archive: a reversible hide. Archived projects drop out of the corporate list, dashboard
// and portfolio, and only surface in the ADMIN/PMO Project Database Archive.
let adminId = '';
let pmA = '';
let pmB = '';
let seq = 0;

async function project(opts: { status?: 'DRAFT' | 'IN_PROGRESS' | 'CLOSED'; year?: number; pm?: string } = {}) {
  seq += 1;
  const year = opts.year ?? 2026;
  return prisma.project.create({
    data: {
      code: `PRJ-${year}-${String(seq).padStart(4, '0')}`,
      name: `Archive fixture ${seq}`,
      status: opts.status ?? 'IN_PROGRESS',
      deliveryApproach: 'PREDICTIVE',
      pmUserId: opts.pm ?? pmA,
    },
  });
}

describe('Project archive', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const admin = await prisma.user.create({ data: { name: 'Arc Admin', email: 'arc-admin@t.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
    adminId = admin.id;
    pmA = (await prisma.user.create({ data: { name: 'Arc PM A', email: 'arc-pma@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    pmB = (await prisma.user.create({ data: { name: 'Arc PM B', email: 'arc-pmb@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
  });

  it('archiving hides a project from the corporate list, dashboard and portfolio; restoring brings it back', async () => {
    const p = await project();
    // Visible before archiving.
    expect((await listProjects(adminId, 'ADMIN')).some((x) => x.id === p.id)).toBe(true);
    expect((await getPortfolioSummary(adminId, 'ADMIN', new Date())).projects.some((x: { id: string }) => x.id === p.id)).toBe(true);

    const archived = await archiveProject(p.id, adminId);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.archivedById).toBe(adminId);

    // Gone from the list and the dashboard roll-up.
    expect((await listProjects(adminId, 'ADMIN')).some((x) => x.id === p.id)).toBe(false);
    expect((await getPortfolioSummary(adminId, 'ADMIN', new Date())).projects.some((x: { id: string }) => x.id === p.id)).toBe(false);

    const restored = await unarchiveProject(p.id, adminId);
    expect(restored.archivedAt).toBeNull();
    expect(restored.archivedById).toBeNull();
    expect((await listProjects(adminId, 'ADMIN')).some((x) => x.id === p.id)).toBe(true);
  });

  it('an ARCHIVE + UNARCHIVE audit trail is recorded', async () => {
    const p = await project();
    await archiveProject(p.id, adminId);
    await unarchiveProject(p.id, adminId);
    const actions = (await prisma.auditLog.findMany({ where: { projectId: p.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toContain('ARCHIVE');
    expect(actions).toContain('UNARCHIVE');
  });

  it('re-archiving or restoring a non-archived project is rejected', async () => {
    const p = await project();
    await archiveProject(p.id, adminId);
    await expect(archiveProject(p.id, adminId)).rejects.toThrow(/already archived/i);
    await unarchiveProject(p.id, adminId);
    await expect(unarchiveProject(p.id, adminId)).rejects.toThrow(/not archived/i);
  });

  it('listProjectDatabase separates active vs archived and filters by status, year and PM', async () => {
    // Fresh scope for deterministic counts.
    const draftA = await project({ status: 'DRAFT', year: 2025, pm: pmA });
    const inProgB = await project({ status: 'IN_PROGRESS', year: 2026, pm: pmB });
    const closedA = await project({ status: 'CLOSED', year: 2026, pm: pmA });
    const toArchive = await project({ status: 'IN_PROGRESS', year: 2026, pm: pmA });
    await archiveProject(toArchive.id, adminId);

    const active = await listProjectDatabase({ archived: false });
    const activeIds = active.map((p) => p.id);
    expect(activeIds).toContain(draftA.id);
    expect(activeIds).toContain(inProgB.id);
    expect(activeIds).toContain(closedA.id);
    expect(activeIds).not.toContain(toArchive.id); // archived → excluded from the Database tab

    const archivedTab = await listProjectDatabase({ archived: true });
    expect(archivedTab.some((p) => p.id === toArchive.id)).toBe(true);
    expect(archivedTab.every((p) => p.archivedAt !== null)).toBe(true);

    // Filters.
    expect((await listProjectDatabase({ status: 'CLOSED' })).every((p) => p.status === 'CLOSED')).toBe(true);
    expect((await listProjectDatabase({ year: 2025 })).every((p) => p.code.startsWith('PRJ-2025-'))).toBe(true);
    expect((await listProjectDatabase({ pmUserId: pmB })).every((p) => p.pmUserId === pmB)).toBe(true);
  });
});
