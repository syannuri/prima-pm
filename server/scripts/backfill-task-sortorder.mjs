#!/usr/bin/env node
// One-time backfill for the manual-ordering feature.
//
// Until now the Gantt rows were sorted CHRONOLOGICALLY on the client (earliest subtree start first,
// tie-break on plan end) while `Task.sortOrder` was often unmaintained. The manual-order feature makes
// the client follow `sortOrder` instead. To guarantee NO project visually scrambles on deploy, this
// script freezes each project's CURRENT displayed order into `sortOrder` — per sibling group, assign
// sortOrder = index in [subtreeStart asc, planEnd asc] order (identical to the old client `flatten`).
//
// Idempotent: re-running produces the same result. Run once, from the server dir:
//   node scripts/backfill-task-sortorder.mjs            # apply
//   node scripts/backfill-task-sortorder.mjs --dry-run  # report only
import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry-run');
const prisma = new PrismaClient();

const ms = (d) => +new Date(d);

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  let projTouched = 0, taskTouched = 0;
  for (const proj of projects) {
    const tasks = await prisma.task.findMany({
      where: { projectId: proj.id },
      select: { id: true, parentTaskId: true, planStart: true, planEnd: true, sortOrder: true },
    });
    if (!tasks.length) continue;

    // children map + memoised earliest start over each node's subtree (mirrors client subtreeStart).
    const kids = new Map();
    for (const t of tasks) {
      const k = t.parentTaskId ?? '__root__';
      let arr = kids.get(k);
      if (!arr) { arr = []; kids.set(k, arr); }
      arr.push(t);
    }
    const startCache = new Map();
    const subtreeStart = (t) => {
      if (startCache.has(t.id)) return startCache.get(t.id);
      let min = ms(t.planStart);
      for (const c of kids.get(t.id) ?? []) min = Math.min(min, subtreeStart(c));
      startCache.set(t.id, min);
      return min;
    };

    const updates = [];
    for (const [, group] of kids) {
      group.sort((a, b) => subtreeStart(a) - subtreeStart(b) || ms(a.planEnd) - ms(b.planEnd));
      group.forEach((t, i) => { if (t.sortOrder !== i) updates.push({ id: t.id, sortOrder: i }); });
    }
    if (updates.length) {
      projTouched++;
      taskTouched += updates.length;
      if (!DRY) {
        await prisma.$transaction(updates.map((u) => prisma.task.update({ where: { id: u.id }, data: { sortOrder: u.sortOrder } })));
      }
      console.log(`${DRY ? '[dry] ' : ''}${proj.name}: ${updates.length} task(s) re-indexed`);
    }
  }
  console.log(`\n${DRY ? '[dry-run] would update' : 'Updated'} ${taskTouched} task(s) across ${projTouched} project(s). (${projects.length} projects scanned)`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
