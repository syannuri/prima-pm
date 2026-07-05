import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { UpsertLessonInput, UpsertAcceptanceInput } from './closeout.schemas.js';

// Resolve a set of plain user ids to display names in one query (createdById /
// recordedById are stored FK-less — "kept light" — so we join names on read).
async function nameMap(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

// --- Lessons learned ---------------------------------------------------------

export async function listLessons(projectId: string) {
  const lessons = await prisma.lessonLearned.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
  const names = await nameMap(lessons.map((l) => l.createdById));
  return lessons.map((l) => ({ ...l, createdByName: l.createdById ? names.get(l.createdById) ?? null : null }));
}

export async function createLesson(projectId: string, input: UpsertLessonInput, actorId: string) {
  const lesson = await prisma.lessonLearned.create({
    data: {
      projectId,
      category: input.category,
      title: input.title,
      description: input.description ?? null,
      createdById: actorId,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'LessonLearned', entityId: lesson.id, action: 'CREATE', after: lesson });
  return lesson;
}

export async function updateLesson(projectId: string, lessonId: string, input: UpsertLessonInput, actorId: string) {
  const existing = await prisma.lessonLearned.findFirst({ where: { id: lessonId, projectId } });
  if (!existing) throw NotFound('Lesson not found');
  const lesson = await prisma.lessonLearned.update({
    where: { id: lessonId },
    data: { category: input.category, title: input.title, description: input.description ?? null },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'LessonLearned', entityId: lessonId, action: 'UPDATE', before: existing, after: lesson });
  return lesson;
}

export async function deleteLesson(projectId: string, lessonId: string, actorId: string) {
  const existing = await prisma.lessonLearned.findFirst({ where: { id: lessonId, projectId } });
  if (!existing) throw NotFound('Lesson not found');
  await prisma.lessonLearned.delete({ where: { id: lessonId } });
  await writeAudit({ projectId, userId: actorId, entity: 'LessonLearned', entityId: lessonId, action: 'DELETE', before: existing });
}

// --- Acceptance sign-offs ----------------------------------------------------

export async function listAcceptances(projectId: string) {
  const acceptances = await prisma.acceptanceSignoff.findMany({
    where: { projectId },
    orderBy: { signedAt: 'desc' },
  });
  const names = await nameMap(acceptances.map((a) => a.recordedById));
  return acceptances.map((a) => ({ ...a, recordedByName: a.recordedById ? names.get(a.recordedById) ?? null : null }));
}

export async function createAcceptance(projectId: string, input: UpsertAcceptanceInput, actorId: string) {
  const acceptance = await prisma.acceptanceSignoff.create({
    data: {
      projectId,
      party: input.party,
      decision: input.decision,
      signedByName: input.signedByName ?? null,
      comments: input.comments ?? null,
      recordedById: actorId,
      ...(input.signedAt ? { signedAt: input.signedAt } : {}),
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'AcceptanceSignoff', entityId: acceptance.id, action: 'CREATE', after: acceptance });
  return acceptance;
}

export async function deleteAcceptance(projectId: string, acceptanceId: string, actorId: string) {
  const existing = await prisma.acceptanceSignoff.findFirst({ where: { id: acceptanceId, projectId } });
  if (!existing) throw NotFound('Acceptance sign-off not found');
  await prisma.acceptanceSignoff.delete({ where: { id: acceptanceId } });
  await writeAudit({ projectId, userId: actorId, entity: 'AcceptanceSignoff', entityId: acceptanceId, action: 'DELETE', before: existing });
}
