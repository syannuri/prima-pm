import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';

// Personal, per-user project bookmarks ("pin to top"). No audit — it's a private
// UI preference, not a governance action.

export async function listBookmarks(userId: string): Promise<string[]> {
  const rows = await prisma.projectBookmark.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

export async function addBookmark(userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw NotFound('Project not found');
  // Idempotent — bookmarking twice is a no-op.
  await prisma.projectBookmark.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId },
    update: {},
  });
}

export async function removeBookmark(userId: string, projectId: string): Promise<void> {
  await prisma.projectBookmark.deleteMany({ where: { userId, projectId } });
}
