import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import {
  createGroup,
  addGroupMembers,
  removeGroupMember,
  renameGroup,
  leaveGroup,
  sendToConversation,
  sendMessageTo,
  listConversations,
  getConversationMessages,
  getUnreadCount,
  searchMessages,
} from '../messages/messages.service.js';

// Group (multi-member) conversations built on the ConversationMember model.
let alice = '';
let bob = '';
let carol = '';
let dave = '';

describe('Group conversations', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'grp-alice@t.test');
    bob = await mk('Bob', 'grp-bob@t.test');
    carol = await mk('Carol', 'grp-carol@t.test');
    dave = await mk('Dave', 'grp-dave@t.test');
  });

  it('creates a group: creator is admin, all members present, and it shows for every member', async () => {
    const g = await createGroup(alice, 'Launch team', [bob, carol]);
    expect(g.type).toBe('GROUP');
    expect(g.title).toBe('Launch team');
    expect(g.members).toHaveLength(3);
    expect(g.members.find((m) => m.id === alice)!.isAdmin).toBe(true);
    expect(g.members.find((m) => m.id === bob)!.isAdmin).toBe(false);

    for (const uid of [alice, bob, carol]) {
      const convs = await listConversations(uid);
      const row = convs.find((c) => c.id === g.id)!;
      expect(row.type).toBe('GROUP');
      expect(row.title).toBe('Launch team');
    }
    // Dave is not a member.
    expect((await listConversations(dave)).some((c) => c.id === g.id)).toBe(false);
  });

  it('rejects a group with fewer than two other members or an empty name', async () => {
    await expect(createGroup(alice, 'Too small', [bob])).rejects.toThrow(/at least two/i);
    await expect(createGroup(alice, '   ', [bob, carol])).rejects.toThrow(/name/i);
  });

  it('any member can post; a non-member cannot; unread is per-member', async () => {
    const g = await createGroup(alice, 'Standup', [bob, carol]);
    await sendToConversation(bob, g.id, 'morning all');
    await expect(sendToConversation(dave, g.id, 'sneak in')).rejects.toThrow(/not found/i);

    // Bob (sender) has it read; Alice & Carol have 1 unread.
    expect(await getUnreadCount(bob)).toBe(0);
    expect((await listConversations(carol)).find((c) => c.id === g.id)!.unread).toBe(1);

    // Reading resets it.
    await getConversationMessages(carol, g.id);
    expect((await listConversations(carol)).find((c) => c.id === g.id)!.unread).toBe(0);
  });

  it('admin can add & remove members; non-admin cannot; you cannot remove yourself', async () => {
    const g = await createGroup(alice, 'Design', [bob, carol]);
    await expect(addGroupMembers(bob, g.id, [dave])).rejects.toThrow(/admin/i);

    const added = await addGroupMembers(alice, g.id, [dave]);
    expect(added.members.map((m) => m.id)).toContain(dave);
    expect((await listConversations(dave)).some((c) => c.id === g.id)).toBe(true);

    await expect(removeGroupMember(alice, g.id, alice)).rejects.toThrow(/leave/i);
    const removed = await removeGroupMember(alice, g.id, dave);
    expect(removed.members.map((m) => m.id)).not.toContain(dave);
    expect((await listConversations(dave)).some((c) => c.id === g.id)).toBe(false);
  });

  it('admin can rename; non-admin cannot', async () => {
    const g = await createGroup(alice, 'Old name', [bob, carol]);
    await expect(renameGroup(bob, g.id, 'Hijack')).rejects.toThrow(/admin/i);
    const renamed = await renameGroup(alice, g.id, 'New name');
    expect(renamed.title).toBe('New name');
  });

  it('leaving removes you; the last admin leaving promotes another member; the last member leaving deletes the group', async () => {
    const g = await createGroup(alice, 'Ephemeral', [bob, carol]);
    // Admin (alice) leaves → bob or carol is promoted so the group keeps an admin.
    await leaveGroup(alice, g.id);
    expect((await listConversations(alice)).some((c) => c.id === g.id)).toBe(false);
    const afterAlice = (await getConversationMessages(bob, g.id)).members;
    expect(afterAlice.some((m) => m.isAdmin)).toBe(true);

    // Everyone else leaves → conversation is gone.
    await leaveGroup(bob, g.id);
    await leaveGroup(carol, g.id);
    expect(await prisma.conversation.findUnique({ where: { id: g.id } })).toBeNull();
  });

  it('search returns group hits with the group title and sender name', async () => {
    const g = await createGroup(alice, 'Ops room', [bob, carol]);
    await sendToConversation(bob, g.id, 'the deployment window is tonight');
    const res = await searchMessages(carol, 'deployment');
    const hit = res.results.find((r) => r.conversationId === g.id)!;
    expect(hit.conversation.title).toBe('Ops room');
    expect(hit.conversation.type).toBe('GROUP');
    expect(hit.senderName).toBe('Bob');
  });

  it('direct messages still work and create both memberships', async () => {
    const { conversationId } = await sendMessageTo(alice, dave, 'hi dave');
    const mems = await prisma.conversationMember.findMany({ where: { conversationId } });
    expect(mems.map((m) => m.userId).sort()).toEqual([alice, dave].sort());
    const daveConvs = await listConversations(dave);
    const row = daveConvs.find((c) => c.id === conversationId)!;
    expect(row.type).toBe('DIRECT');
    expect(row.other!.id).toBe(alice);
  });
});
