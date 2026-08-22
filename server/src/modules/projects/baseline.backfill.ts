import { prisma } from '../../lib/prisma.js';
import { runAsSystem } from '../../lib/tenant/context.js';

// One-time, idempotent backfill: give every ALREADY-locked project a version-1 BaselineVersion built
// from its current committed baseline (Task.baseline* + CostBaseline), so the new history isn't empty
// for pre-existing projects. Runs under runAsSystem (cross-tenant, extension bypassed) and therefore
// stamps tenantId EXPLICITLY from each project. `committedAt` is the HISTORICAL lock date
// (baselineLockedAt, falling back to scheduleBaselinedAt, then updatedAt) — not now — so the timeline
// reads true. Skips any project that already has a version, so it's safe to re-run.
export async function backfillBaselineVersions(): Promise<{ created: number; skipped: number }> {
  return runAsSystem(async () => {
    const projects = await prisma.project.findMany({
      where: { baselineLockedAt: { not: null } },
      select: { id: true, tenantId: true, baselineLockedAt: true, baselineLockedById: true, scheduleBaselinedAt: true, updatedAt: true },
    });
    let created = 0;
    let skipped = 0;
    for (const p of projects) {
      const has = await prisma.baselineVersion.count({ where: { projectId: p.id } });
      if (has > 0) { skipped++; continue; }
      const [tasks, cost] = await Promise.all([
        prisma.task.findMany({
          where: { projectId: p.id },
          orderBy: { wbsCode: 'asc' },
          select: { id: true, wbsCode: true, name: true, baselineStart: true, baselineFinish: true, baselineWeight: true },
        }),
        prisma.costBaseline.findUnique({ where: { projectId: p.id } }),
      ]);
      const schedule = tasks.map((t) => ({
        taskId: t.id, wbsCode: t.wbsCode, name: t.name,
        baselineStart: t.baselineStart, baselineFinish: t.baselineFinish, weight: t.baselineWeight,
      }));
      const costSnap = {
        directTotal: cost?.directTotal?.toString() ?? '0',
        indirectTotal: cost?.indirectTotal?.toString() ?? '0',
        contingencyReserve: cost?.contingencyReserve?.toString() ?? '0',
        managementReserve: cost?.managementReserve?.toString() ?? '0',
        costBaseline: cost?.costBaseline?.toString() ?? '0',
        budgetAtCompletion: cost?.budgetAtCompletion?.toString() ?? '0',
      };
      await prisma.baselineVersion.create({
        data: {
          tenantId: p.tenantId, // explicit — extension is bypassed under runAsSystem
          projectId: p.id,
          version: 1,
          reason: 'Backfilled from existing locked baseline',
          committedBy: p.baselineLockedById ?? 'backfill',
          committedAt: p.baselineLockedAt ?? p.scheduleBaselinedAt ?? p.updatedAt,
          schedule: schedule as object,
          cost: costSnap as object,
        },
      });
      created++;
    }
    return { created, skipped };
  });
}
