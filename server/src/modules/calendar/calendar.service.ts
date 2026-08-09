import { randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { buildIcs, type IcalEvent } from '../../lib/ical.js';

// Personal iCal calendar feed (T4.2). A user enables a feed → gets an unguessable URL that Google/
// Outlook/Apple Calendar poll. The feed lists the milestones and task windows of the projects they
// manage. The URL token is the credential (the endpoint is unauthenticated, like a Slack webhook).

const genToken = () => randomBytes(24).toString('base64url');

// User is a GLOBAL model (not tenant-scoped), so these run fine in any context.
export async function getOrCreateFeedToken(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { calendarFeedToken: true } });
  if (u?.calendarFeedToken) return u.calendarFeedToken;
  const token = genToken();
  await prisma.user.update({ where: { id: userId }, data: { calendarFeedToken: token } });
  return token;
}

export async function rotateFeedToken(userId: string): Promise<string> {
  const token = genToken();
  await prisma.user.update({ where: { id: userId }, data: { calendarFeedToken: token } });
  return token;
}

// Resolve a feed token to its iCalendar body, or null if the token is unknown. Runs as SYSTEM: the
// request is unauthenticated and context-less (the token selects the user), and it reads that user's
// projects across whatever tenant they live in.
export async function buildFeedForToken(token: string): Promise<string | null> {
  return runAsSystem(async () => {
    const user = await prisma.user.findUnique({ where: { calendarFeedToken: token }, select: { id: true, name: true } });
    if (!user) return null;
    const tasks = await prisma.task.findMany({
      where: { project: { pmUserId: user.id, deletedAt: null }, planStart: { not: undefined }, planEnd: { not: undefined } },
      select: { id: true, name: true, planStart: true, planEnd: true, isMilestone: true, project: { select: { code: true, name: true } } },
      take: 500,
      orderBy: { planStart: 'asc' },
    });
    const events: IcalEvent[] = tasks
      .filter((t) => t.planStart && t.planEnd)
      .map((t) => ({
        uid: `task-${t.id}@prismatix`,
        summary: `${t.isMilestone ? '◆ ' : ''}[${t.project?.code ?? '—'}] ${t.name}`,
        start: t.planStart as Date,
        end: t.planEnd as Date,
        description: t.project?.name ?? undefined,
      }));
    return buildIcs(events, `Prismatix — ${user.name}`);
  });
}
