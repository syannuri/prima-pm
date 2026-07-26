import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import {
  sendMessageTo,
  sendToConversation,
  createGroup,
  hideConversation,
  deleteGroup,
  listConversations,
  getConversationMessages,
} from '../messages/messages.service.js';

// "Delete conversation": per-user hide (DM & group) + admin destructive group delete.
let alice = '';
let bob = '';
let carol = '';

const listed = async (uid: string, convId: string) => (await listConversations(uid)).some((c) => c.id === convId);

describe('Delete / hide conversation', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'dc-alice@t.test');
    bob = await mk('Bob', 'dc-bob@t.test');
    carol = await mk('Carol', 'dc-carol@t.test');
  });

  it('hiding a DM removes it from my list only; the other party still sees it', async () => {
    const { conversationId } = await sendMessageTo(alice, bob, 'hi');
    expect(await listed(alice, conversationId)).toBe(true);

    await hideConversation(alice, conversationId);
    expect(await listed(alice, conversationId)).toBe(false); // gone for me
    expect(await listed(bob, conversationId)).toBe(true); // still there for bob
  });

  it('a hidden conversation reappears when a new message arrives', async () => {
    const { conversationId } = await sendMessageTo(alice, bob, 'first');
    await hideConversation(alice, conversationId);
    expect(await listed(alice, conversationId)).toBe(false);

    await sendToConversation(bob, conversationId, 'you back?');
    expect(await listed(alice, conversationId)).toBe(true); // new message un-hides it
    expect((await listConversations(alice)).find((c) => c.id === conversationId)!.unread).toBe(1);
  });

  it('reopening a hidden conversation un-hides it', async () => {
    const { conversationId } = await sendMessageTo(alice, bob, 'ping');
    await hideConversation(alice, conversationId);
    expect(await listed(alice, conversationId)).toBe(false);

    await getConversationMessages(alice, conversationId); // opening marks read + un-hides
    expect(await listed(alice, conversationId)).toBe(true);
  });

  it('hiding is available for groups too, per-user', async () => {
    const g = await createGroup(alice, 'Squad', [bob, carol]);
    await hideConversation(bob, g.id);
    expect(await listed(bob, g.id)).toBe(false);
    expect(await listed(alice, g.id)).toBe(true);
    expect(await listed(carol, g.id)).toBe(true);
  });

  it('an admin can delete a group for everyone; a non-admin cannot; a DM is not deletable this way', async () => {
    const g = await createGroup(alice, 'Doomed', [bob, carol]);
    await sendToConversation(bob, g.id, 'bye');

    await expect(deleteGroup(bob, g.id)).rejects.toThrow(/admin/i); // bob isn't an admin
    await deleteGroup(alice, g.id); // alice created it → admin
    expect(await prisma.conversation.findUnique({ where: { id: g.id } })).toBeNull(); // gone entirely
    expect(await listed(bob, g.id)).toBe(false);
    expect(await listed(carol, g.id)).toBe(false);

    const dm = await sendMessageTo(alice, bob, 'not a group');
    await expect(deleteGroup(alice, dm.conversationId)).rejects.toThrow(/not a group/i);
  });
});
