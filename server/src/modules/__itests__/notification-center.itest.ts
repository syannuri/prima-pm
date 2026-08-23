import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { createNotification, getNotificationHistory, markInboxSeen, notifCategory } from '../notification/notification.service.js';

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
});
