import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { saveSubscription, deleteSubscription, sendPushToUsers, isPushEnabled } from '../messages/push.js';

// Web-push subscription storage: store / rebind / remove. Sending is best-effort and must never
// throw whether push is enabled (VAPID keys present) or not, and whatever the endpoint's fate.
let alice = '';
let bob = '';

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p256-' + endpoint, auth: 'auth-' + endpoint } });

describe('Web-push subscriptions', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'push-alice@t.test');
    bob = await mk('Bob', 'push-bob@t.test');
  });

  it('sending never throws (best-effort) and reports a boolean enabled state', async () => {
    expect(typeof isPushEnabled()).toBe('boolean');
    await saveSubscription(alice, sub('https://push.example/a1'));
    // Unreachable endpoint (or push disabled) → resolves without throwing.
    await expect(sendPushToUsers([alice], { title: 'x', body: 'y' })).resolves.toBeUndefined();
    await expect(sendPushToUsers([], { title: 'x', body: 'y' })).resolves.toBeUndefined(); // empty audience
  });

  it('stores a subscription and rebinds an endpoint on re-subscribe (upsert)', async () => {
    await saveSubscription(alice, { endpoint: 'https://push.example/shared', keys: { p256dh: 'k1', auth: 'a1' } });
    let row = await prisma.pushSubscription.findUnique({ where: { endpoint: 'https://push.example/shared' } });
    expect(row?.userId).toBe(alice);

    // Same browser, now Bob signs in → the endpoint rebinds to Bob with fresh keys, no duplicate.
    await saveSubscription(bob, { endpoint: 'https://push.example/shared', keys: { p256dh: 'k2', auth: 'a2' } });
    row = await prisma.pushSubscription.findUnique({ where: { endpoint: 'https://push.example/shared' } });
    expect(row?.userId).toBe(bob);
    expect(row?.p256dh).toBe('k2');
    expect(await prisma.pushSubscription.count({ where: { endpoint: 'https://push.example/shared' } })).toBe(1);
  });

  it('deletes only the caller\'s own endpoint', async () => {
    await saveSubscription(alice, sub('https://push.example/del'));
    await deleteSubscription(bob, 'https://push.example/del'); // wrong owner → no-op
    expect(await prisma.pushSubscription.count({ where: { endpoint: 'https://push.example/del' } })).toBe(1);
    await deleteSubscription(alice, 'https://push.example/del');
    expect(await prisma.pushSubscription.count({ where: { endpoint: 'https://push.example/del' } })).toBe(0);
  });
});
