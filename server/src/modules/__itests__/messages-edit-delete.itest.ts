import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import {
  sendMessageTo,
  editMessage,
  deleteMessage,
  searchMessages,
  getConversationMessages,
  listConversations,
} from '../messages/messages.service.js';

// Edit / delete / search for direct messages. Only the sender can change their own message; a
// delete is a soft-delete (row kept, body never re-served); search is scoped to the caller.
let alice = '';
let bob = '';
let carol = '';

describe('Messages edit / delete / search', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'msg-alice@t.test');
    bob = await mk('Bob', 'msg-bob@t.test');
    carol = await mk('Carol', 'msg-carol@t.test');
  });

  it('edits one\'s own message: body changes, editedAt is stamped, order unchanged', async () => {
    const { message, conversationId } = await sendMessageTo(alice, bob, 'helo wrld');
    expect(message.editedAt).toBeNull();

    // Capture the conversation activity time before editing.
    const before = (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { lastMessageAt: true } }))!.lastMessageAt;

    const { message: edited } = await editMessage(alice, message.id, 'hello world');
    expect(edited.body).toBe('hello world');
    expect(edited.editedAt).not.toBeNull();
    expect(edited.deleted).toBe(false);

    // Editing must NOT bump the conversation activity time (an edit never reorders threads).
    const after = (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { lastMessageAt: true } }))!.lastMessageAt;
    expect(after.getTime()).toBe(before.getTime());
  });

  it('a non-sender cannot edit or delete the message', async () => {
    const { message } = await sendMessageTo(alice, bob, 'mine only');
    await expect(editMessage(bob, message.id, 'hijack')).rejects.toThrow(/your own/i);
    await expect(deleteMessage(bob, message.id)).rejects.toThrow(/your own/i);
  });

  it('soft-deletes a message: the row stays but the body is never re-served', async () => {
    const { message, conversationId } = await sendMessageTo(alice, bob, 'secret text');
    const { message: del } = await deleteMessage(alice, message.id);
    expect(del.deleted).toBe(true);
    expect(del.body).toBe('');

    // Still present in the thread, as a tombstone with no body.
    const thread = await getConversationMessages(bob, conversationId);
    const row = thread.messages.find((m) => m.id === message.id)!;
    expect(row.deleted).toBe(true);
    expect(row.body).toBe('');

    // The raw body is retained in the DB but is not exposed.
    const raw = await prisma.message.findUnique({ where: { id: message.id }, select: { body: true, deletedAt: true } });
    expect(raw!.deletedAt).not.toBeNull();

    // Editing a deleted message is rejected.
    await expect(editMessage(alice, message.id, 'undo')).rejects.toThrow(/deleted/i);
  });

  it('marks a deleted last message in the conversation preview', async () => {
    const { message } = await sendMessageTo(carol, bob, 'last line');
    await deleteMessage(carol, message.id);
    const convs = await listConversations(bob);
    const conv = convs.find((c) => c.other?.id === carol)!;
    expect(conv.lastMessage?.deleted).toBe(true);
    expect(conv.lastMessage?.body).toBe('');
  });

  it('searches the caller\'s messages case-insensitively, excludes deleted, and is scoped per-user', async () => {
    await sendMessageTo(alice, bob, 'Deploy the WIDGET tonight');
    const { message: toDelete } = await sendMessageTo(alice, bob, 'widget rollback plan');
    await deleteMessage(alice, toDelete.id);

    const res = await searchMessages(alice, 'widget');
    const bodies = res.results.map((r) => r.body);
    expect(bodies).toContain('Deploy the WIDGET tonight'); // case-insensitive match
    expect(bodies).not.toContain('widget rollback plan'); // deleted → excluded

    // Carol is not a participant in the alice↔bob thread, so she gets no hits.
    const carolRes = await searchMessages(carol, 'widget');
    expect(carolRes.results.every((r) => r.body !== 'Deploy the WIDGET tonight')).toBe(true);

    // Short queries return nothing.
    expect((await searchMessages(alice, 'w')).results).toHaveLength(0);
  });

  it('scopes search to a single conversation when conversationId is given', async () => {
    const a = await sendMessageTo(alice, bob, 'sprint review notes');
    const b = await sendMessageTo(alice, carol, 'sprint planning notes');
    const scoped = await searchMessages(alice, 'sprint', a.conversationId);
    expect(scoped.results.every((r) => r.conversationId === a.conversationId)).toBe(true);
    expect(scoped.results.some((r) => r.conversationId === b.conversationId)).toBe(false);
  });
});
