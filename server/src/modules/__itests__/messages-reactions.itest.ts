import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import {
  sendMessageTo,
  sendToConversation,
  createGroup,
  deleteMessage,
  toggleReaction,
  getConversationMessages,
} from '../messages/messages.service.js';

// Emoji reactions on messages: toggle add/remove, per-user-per-emoji uniqueness, summaries.
let alice = '';
let bob = '';
let carol = '';
let dave = '';

const reactionsOf = async (viewer: string, conversationId: string, messageId: string) => {
  const thread = await getConversationMessages(viewer, conversationId);
  return thread.messages.find((m) => m.id === messageId)!.reactions;
};

describe('Message reactions', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'rx-alice@t.test');
    bob = await mk('Bob', 'rx-bob@t.test');
    carol = await mk('Carol', 'rx-carol@t.test');
    dave = await mk('Dave', 'rx-dave@t.test');
  });

  it('toggles a reaction on and off, and reports mine + who reacted', async () => {
    const { message, conversationId } = await sendMessageTo(alice, bob, 'ship it');

    const added = await toggleReaction(bob, message.id, '👍');
    expect(added.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, users: ['Bob'] }]);

    // Alice sees the same reaction but mine=false (she didn't react).
    const aliceView = await reactionsOf(alice, conversationId, message.id);
    expect(aliceView).toEqual([{ emoji: '👍', count: 1, mine: false, users: ['Bob'] }]);

    // Bob toggles the same emoji off.
    const removed = await toggleReaction(bob, message.id, '👍');
    expect(removed.reactions).toEqual([]);
  });

  it('counts multiple users on the same emoji and multiple emojis per message', async () => {
    const { message, conversationId } = await sendMessageTo(alice, bob, 'launch day');
    await toggleReaction(alice, message.id, '🎉');
    await toggleReaction(bob, message.id, '🎉');
    await toggleReaction(bob, message.id, '🔥'); // bob adds a second, different emoji

    const view = await reactionsOf(alice, conversationId, message.id);
    const party = view!.find((r) => r.emoji === '🎉')!;
    expect(party.count).toBe(2);
    expect(party.users.sort()).toEqual(['Alice', 'Bob']);
    expect(view!.find((r) => r.emoji === '🔥')!.count).toBe(1);
  });

  it('a user reacting with the same emoji twice is idempotent (unique constraint via toggle)', async () => {
    const { message } = await sendMessageTo(alice, bob, 'dedup');
    await toggleReaction(alice, message.id, '❤️');
    // Toggling again removes it (not a second row).
    const after = await toggleReaction(alice, message.id, '❤️');
    expect(after.reactions).toEqual([]);
    expect(await prisma.messageReaction.count({ where: { messageId: message.id } })).toBe(0);
  });

  it('only a member can react; a deleted message rejects reactions and shows none', async () => {
    const g = await createGroup(alice, 'Reactors', [bob, carol]);
    const { message } = await sendToConversation(bob, g.id, 'group msg');
    await expect(toggleReaction(dave, message.id, '👍')).rejects.toThrow(/not found/i); // dave isn't a member

    await toggleReaction(carol, message.id, '🙏');
    await deleteMessage(bob, message.id); // sender deletes it
    await expect(toggleReaction(carol, message.id, '👍')).rejects.toThrow(/not found/i);

    const view = await reactionsOf(alice, g.id, message.id);
    expect(view).toEqual([]); // a deleted message serializes no reactions
  });
});
