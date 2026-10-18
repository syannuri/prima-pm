import { prisma } from '../../lib/prisma.js';

// RAG v2 — chunking. Turns one project into a list of retrievable CHUNKS (one per source entity),
// the granular upgrade over the single per-project doc in search.service. Each chunk carries the
// metadata needed to cite its exact row via the existing [[cite:CODE|SOURCE|id]] deep-links. Pure read
// (Prisma, tenant-scoped by the extension) + deterministic text assembly — no embedding here (that's
// chunkIndex). Runs inside a tenant context (callers hold one).

export type ChunkEntityType = 'charter' | 'risk' | 'cr' | 'lesson' | 'issue' | 'task' | 'cost';
// Citation SOURCE the chunk maps onto (the ?tab= / row deep-link target). charter/lesson/issue have no
// row-level link → Overview (project level); the rest deep-link to their row by entityId.
export type ChunkSource = 'Overview' | 'Risk' | 'ChangeRequest' | 'Schedule' | 'Cost';

export interface ProjectChunk {
  entityType: ChunkEntityType;
  entityId: string; // source row id (for citations); charter uses "<charterId>:<section>"
  source: ChunkSource;
  code: string; // project code
  text: string;
}

const MAX_CHUNK_CHARS = 1200; // token control — a chunk is a title + a description, not an essay
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const clip = (s: string): string => (s.length > MAX_CHUNK_CHARS ? s.slice(0, MAX_CHUNK_CHARS) : s);

// Build every chunk for one project. Returns [] for an unknown/inaccessible project (the tenant
// extension scopes the reads; a cross-tenant id simply finds nothing).
export async function buildProjectChunks(projectId: string): Promise<ProjectChunk[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, code: true } });
  if (!project) return [];
  const code = project.code;
  const chunks: ProjectChunk[] = [];
  const add = (entityType: ChunkEntityType, entityId: string, source: ChunkSource, parts: Array<string | null | undefined>) => {
    const text = clip(norm(parts.filter((p): p is string => !!p && p.trim().length > 0).join('. ')));
    if (text) chunks.push({ entityType, entityId, source, code, text });
  };

  // Charter — split into named sections so retrieval can surface the relevant part.
  const charter = await prisma.projectCharter.findUnique({
    where: { projectId },
    select: { id: true, description: true, goals: true, hiScope: true, hiDeliverables: true },
  });
  if (charter) {
    add('charter', `${charter.id}:description`, 'Overview', ['Charter — description', charter.description]);
    add('charter', `${charter.id}:goals`, 'Overview', ['Charter — goals', charter.goals]);
    add('charter', `${charter.id}:scope`, 'Overview', ['Charter — scope', charter.hiScope]);
    add('charter', `${charter.id}:deliverables`, 'Overview', ['Charter — deliverables', charter.hiDeliverables]);
  }

  for (const r of await prisma.risk.findMany({ where: { projectId }, select: { id: true, title: true, description: true, category: true } }))
    add('risk', r.id, 'Risk', [`Risk: ${r.title}`, r.description, r.category]);

  for (const c of await prisma.changeRequest.findMany({ where: { projectId }, select: { id: true, title: true, description: true, type: true } }))
    add('cr', c.id, 'ChangeRequest', [`Change request (${c.type}): ${c.title}`, c.description]);

  for (const l of await prisma.lessonLearned.findMany({ where: { projectId }, select: { id: true, title: true, description: true } }))
    add('lesson', l.id, 'Overview', [`Lesson learned: ${l.title}`, l.description]);

  for (const i of await prisma.issue.findMany({ where: { projectId }, select: { id: true, title: true, description: true, category: true } }))
    add('issue', i.id, 'Overview', [`Issue: ${i.title}`, i.description, i.category]);

  for (const t of await prisma.task.findMany({ where: { projectId }, select: { id: true, wbsCode: true, name: true, description: true, deliverable: true, acceptanceCriteria: true } }))
    add('task', t.id, 'Schedule', [`Task ${t.wbsCode}: ${t.name}`, t.description, t.deliverable, t.acceptanceCriteria]);

  for (const d of await prisma.costItemDirect.findMany({ where: { projectId }, select: { id: true, label: true, subCategory: true } }))
    add('cost', d.id, 'Cost', [`Cost line (direct): ${d.label}`, d.subCategory]);

  for (const n of await prisma.costItemIndirect.findMany({ where: { projectId }, select: { id: true, description: true, subCategory: true } }))
    add('cost', n.id, 'Cost', [`Cost line (indirect): ${n.description}`, n.subCategory]);

  return chunks;
}
