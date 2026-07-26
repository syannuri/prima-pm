import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { sendMessageTo, sendToConversation, createGroup, getConversationMessages } from '../messages/messages.service.js';

// Read receipts: a sender's own message carries { count, all } = how many other members have read
// it (cursor lastReadAt >= createdAt). Others' messages carry read: null.
let alice = '';
let bob = '';
let carol = '';

const readOf = async (viewer: string, conversationId: string, messageId: string) => {
  const thread = await getConversationMessages(viewer, conversationId);
  return thread.messages.find((m) => m.id === messageId)!.read;
};

describe('Read receipts', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'rr-alice@t.test');
    bob = await mk('Bob', 'rr-bob@t.test');
    carol = await mk('Carol', 'rr-carol@t.test');
  });

  it('a DM message flips to read once the recipient opens the thread', async () => {
    const { message, conversationId } = await sendMessageTo(alice, bob, 'seen yet?');
    // Before Bob reads it.
    expect(await readOf(alice, conversationId, message.id)).toEqual({ count: 0, all: false });

    // Bob opens the conversation → his cursor advances past the message.
    await getConversationMessages(bob, conversationId);
    expect(await readOf(alice, conversationId, message.id)).toEqual({ count: 1, all: true });
  });

  it("does not attach read info to the other party's messages", async () => {
    const { message, conversationId } = await sendMessageTo(bob, alice, 'from bob');
    // Alice viewing Bob's message → read is null (receipts are only on your own messages).
    expect(await readOf(alice, conversationId, message.id)).toBeNull();
  });

  it('a group message counts each member that has read it, all=true only when everyone has', async () => {
    const g = await createGroup(alice, 'Seen team', [bob, carol]);
    const { message } = await sendToConversation(alice, g.id, 'roll call');
    expect(await readOf(alice, g.id, message.id)).toEqual({ count: 0, all: false });

    await getConversationMessages(bob, g.id);
    expect(await readOf(alice, g.id, message.id)).toEqual({ count: 1, all: false });

    await getConversationMessages(carol, g.id);
    expect(await readOf(alice, g.id, message.id)).toEqual({ count: 2, all: true });
  });
});
