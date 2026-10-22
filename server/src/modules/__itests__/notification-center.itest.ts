import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { createNotification, getInbox, getNotificationHistory, markInboxSeen, notifCategory } from '../notification/notification.service.js';
import { softDeleteProject } from '../projects/projects.service.js';

// Notification Center backend: full history (read + unread), category derivation + filtering, and
// cursor pagination. "Mark all read" reuses markInboxSeen.
let userId = '';

async function wipe() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

describe('notification center', () => {
  beforeAll(async () => {
    await wipe();
    const u = await prisma.user.create({ data: { name: 'NC User', email: 'nc@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    userId = u.id;
  });

  beforeEach(async () => { await prisma.notification.deleteMany({}); });

  const seed = async (type: string, title: string) => createNotification({ userId, type, title });

  it('derives categories from the stored type', () => {
    expect(notifCategory('APPROVAL_PENDING')).toBe('approvals');
    expect(notifCategory('CR_APPROVED')).toBe('approvals');
    expect(notifCategory('PROJECT_ASSIGNED')).toBe('assignments');
    expect(notifCategory('SECURITY_GHOST_LOGIN')).toBe('account');
    expect(notifCategory('trial-reminder:3')).toBe('account');
    expect(notifCategory('SOMETHING_ELSE')).toBe('other');
  });

  it('returns full history (read + unread), newest first, with categories', async () => {
    await seed('APPROVAL_PENDING', 'a');
    await seed('PROJECT_ASSIGNED', 'b');
    await seed('SECURITY_GHOST_LOGIN', 'c');
    // Mark all as read → history must still return them (unlike the unread-only bell inbox).
    await markInboxSeen(userId);
    const { items } = await getNotificationHistory(userId, {});
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.readAt !== null)).toBe(true); // read items are retained in history
    expect(items[0].title).toBe('c'); // newest first
    expect(new Set(items.map((i) => i.category))).toEqual(new Set(['approvals', 'assignments', 'account']));
  });

  it('filters by category (incl. trial-reminder → account, and other)', async () => {
    await seed('APPROVAL_PENDING', 'appr');
    await seed('trial-reminder:14', 'trial');
    await seed('SECURITY_GHOST_LOGIN', 'ghost');
    await seed('WEIRD_TYPE', 'misc');

    expect((await getNotificationHistory(userId, { category: 'approvals' })).items.map((i) => i.title)).toEqual(['appr']);
    const account = (await getNotificationHistory(userId, { category: 'account' })).items.map((i) => i.title).sort();
    expect(account).toEqual(['ghost', 'trial']);
    expect((await getNotificationHistory(userId, { category: 'other' })).items.map((i) => i.title)).toEqual(['misc']);
    expect((await getNotificationHistory(userId, { category: 'all' })).items).toHaveLength(4);
  });

  it('paginates via the cursor', async () => {
    for (let i = 0; i < 5; i++) await seed('PROJECT_ASSIGNED', `n${i}`);
    const first = await getNotificationHistory(userId, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await getNotificationHistory(userId, { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    // No overlap between pages.
    const ids = new Set(first.items.map((i) => i.id));
    expect(second.items.some((i) => ids.has(i.id))).toBe(false);
  });

  // A deleted project's notifications must not linger as clickable dead deep-links. They're cleared
  // at delete time, and the read paths also hide any orphan left by a past deletion.
  it('drops notifications for a deleted project (and keeps non-project ones)', async () => {
    const proj = await prisma.project.create({ data: { code: 'PRJ-NTF-0001', name: 'Doomed', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: userId } });
    await createNotification({ userId, type: 'PROJECT_ASSIGNED', title: 'assigned', projectId: proj.id });
    await createNotification({ userId, type: 'SECURITY_GHOST_LOGIN', title: 'account notice' }); // no project

    // While the project is live, both show up.
    expect((await getNotificationHistory(userId, {})).items).toHaveLength(2);
    expect((await getInbox(userId)).unread).toBe(2);

    // Deleting the project clears its notification rows outright; the account notice stays.
    await softDeleteProject(proj.id, userId);
    const rowsLeft = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    expect(rowsLeft.map((r) => r.title)).toEqual(['account notice']);

    // Read-time guard: an orphan left by a PAST deletion (notification still present) is hidden too.
    const orphan = await prisma.project.create({ data: { code: 'PRJ-NTF-0002', name: 'Past orphan', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: userId, deletedAt: new Date() } });
    await createNotification({ userId, type: 'PROJECT_ASSIGNED', title: 'stale', projectId: orphan.id });
    expect((await getNotificationHistory(userId, {})).items.map((i) => i.title)).toEqual(['account notice']);
    expect((await getInbox(userId)).items.map((i) => i.title)).toEqual(['account notice']);
  });
});
