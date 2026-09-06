import type { DependencyType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest, NotFound, Conflict } from '../../lib/errors.js';

// Cross-project schedule dependencies (Tier-3). A task in one project depends on a task in another.
// This is intentionally decoupled from the per-project scheduler: we model + surface the link and its
// schedule IMPACT (is the external predecessor finishing late for the successor's planned start?), rather
// than silently mutating another project's (possibly baseline-locked, separately-governed) tasks. The
// owning PM sees the impact and decides. Everything runs under the active tenant context.

const MS_DAY = 86_400_000;
const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / MS_DAY);

export interface CrossLinkDto {
  id: string;
  type: DependencyType;
  lagDays: number;
  predecessor: { taskId: string; taskName: string; wbsCode: string; projectId: string; projectCode: string; projectName: string; finish: string };
  successor: { taskId: string; taskName: string; wbsCode: string; projectId: string; projectCode: string; projectName: string; start: string };
  // Positive slack = the successor can start on time; negative = the predecessor finishes too late (late by |slack| days).
  slackDays: number;
  late: boolean;
}

interface TaskRow { id: string; name: string; wbsCode: string; planStart: Date; planEnd: Date; projectId: string }

async function enrich(links: { id: string; predecessorTaskId: string; successorTaskId: string; type: DependencyType; lagDays: number }[]): Promise<CrossLinkDto[]> {
  if (links.length === 0) return [];
  const taskIds = [...new Set(links.flatMap((l) => [l.predecessorTaskId, l.successorTaskId]))];
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, name: true, wbsCode: true, planStart: true, planEnd: true, projectId: true },
  });
  const taskById = new Map<string, TaskRow>(tasks.map((t) => [t.id, t]));
  const projectIds = [...new Set(tasks.map((t) => t.projectId))];
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } });
  const projById = new Map(projects.map((p) => [p.id, p]));

  const out: CrossLinkDto[] = [];
  for (const l of links) {
    const pre = taskById.get(l.predecessorTaskId);
    const suc = taskById.get(l.successorTaskId);
    if (!pre || !suc) continue; // orphaned (a task was deleted) — skip; harmless
    const pp = projById.get(pre.projectId);
    const sp = projById.get(suc.projectId);
    if (!pp || !sp) continue;
    // FS is by far the common case: successor should START after predecessor FINISH + lag. For SS we compare
    // against the predecessor START. (FF/SF are rare across projects; treat like FS/SS on the near edge.)
    const predEdge = l.type === 'SS' || l.type === 'SF' ? pre.planStart : pre.planEnd;
    const required = new Date(predEdge.getTime() + l.lagDays * MS_DAY);
    const sucEdge = l.type === 'FF' || l.type === 'SF' ? suc.planEnd : suc.planStart;
    const slackDays = dayDiff(sucEdge, required);
    out.push({
      id: l.id,
      type: l.type,
      lagDays: l.lagDays,
      predecessor: { taskId: pre.id, taskName: pre.name, wbsCode: pre.wbsCode, projectId: pre.projectId, projectCode: pp.code, projectName: pp.name, finish: pre.planEnd.toISOString() },
      successor: { taskId: suc.id, taskName: suc.name, wbsCode: suc.wbsCode, projectId: suc.projectId, projectCode: sp.code, projectName: sp.name, start: suc.planStart.toISOString() },
      slackDays,
      late: slackDays < 0,
    });
  }
  return out;
}

// Cross links touching a project: `incoming` = this project's tasks wait on another project's task;
// `outgoing` = this project's tasks block another project's task.
export async function listForProject(projectId: string): Promise<{ incoming: CrossLinkDto[]; outgoing: CrossLinkDto[] }> {
  const tasks = await prisma.task.findMany({ where: { projectId }, select: { id: true } });
  const ids = tasks.map((t) => t.id);
  if (ids.length === 0) return { incoming: [], outgoing: [] };
  const [incomingRaw, outgoingRaw] = await Promise.all([
    prisma.crossProjectLink.findMany({ where: { successorTaskId: { in: ids } } }),
    prisma.crossProjectLink.findMany({ where: { predecessorTaskId: { in: ids } } }),
  ]);
  const [incoming, outgoing] = await Promise.all([enrich(incomingRaw), enrich(outgoingRaw)]);
  return { incoming, outgoing };
}

// Create a cross-project link where `successorTaskId` is in `projectId` (the route project the caller has
// write access to) and `predecessorTaskId` is a task in a DIFFERENT project of the same tenant.
export async function createLink(
  projectId: string,
  input: { predecessorTaskId: string; successorTaskId: string; type?: DependencyType; lagDays?: number },
): Promise<CrossLinkDto> {
  if (input.predecessorTaskId === input.successorTaskId) throw BadRequest('A task cannot depend on itself');
  const [pre, suc] = await Promise.all([
    prisma.task.findUnique({ where: { id: input.predecessorTaskId }, select: { id: true, projectId: true } }),
    prisma.task.findUnique({ where: { id: input.successorTaskId }, select: { id: true, projectId: true } }),
  ]);
  if (!pre) throw NotFound('Predecessor task not found');
  if (!suc) throw NotFound('Successor task not found');
  if (suc.projectId !== projectId) throw BadRequest('The successor task must belong to this project');
  if (pre.projectId === suc.projectId) throw BadRequest('Use a normal dependency for tasks in the same project');

  const dup = await prisma.crossProjectLink.findUnique({
    where: { predecessorTaskId_successorTaskId: { predecessorTaskId: input.predecessorTaskId, successorTaskId: input.successorTaskId } },
  });
  if (dup) throw Conflict('That cross-project dependency already exists');

  // Cycle guard over the cross-link graph (task-level edges). Prevents A→B→…→A across projects.
  if (await wouldCycle(input.predecessorTaskId, input.successorTaskId)) {
    throw Conflict('This dependency would create a cross-project cycle');
  }

  const created = await prisma.crossProjectLink.create({
    data: {
      predecessorTaskId: input.predecessorTaskId,
      successorTaskId: input.successorTaskId,
      type: input.type ?? 'FS',
      lagDays: input.lagDays ?? 0,
    },
  });
  const [dto] = await enrich([created]);
  if (!dto) throw BadRequest('Could not resolve the linked tasks');
  return dto;
}

// Would adding predecessor→successor close a cycle? Walk successors from the new successor; if we reach
// the new predecessor, it's a cycle. Bounded by the tenant's cross-link count.
async function wouldCycle(predId: string, sucId: string): Promise<boolean> {
  const all = await prisma.crossProjectLink.findMany({ select: { predecessorTaskId: true, successorTaskId: true } });
  const adj = new Map<string, string[]>();
  for (const e of all) {
    const arr = adj.get(e.predecessorTaskId) ?? [];
    arr.push(e.successorTaskId);
    adj.set(e.predecessorTaskId, arr);
  }
  const seen = new Set<string>();
  const stack = [sucId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === predId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return false;
}

export async function deleteLink(projectId: string, id: string): Promise<void> {
  const link = await prisma.crossProjectLink.findUnique({ where: { id } });
  if (!link) throw NotFound('Cross-project dependency not found');
  // The caller has write access to `projectId`; allow deletion only if the link touches it.
  const tasks = await prisma.task.findMany({ where: { projectId, id: { in: [link.predecessorTaskId, link.successorTaskId] } }, select: { id: true } });
  if (tasks.length === 0) throw NotFound('Cross-project dependency not found for this project');
  await prisma.crossProjectLink.delete({ where: { id } });
}
