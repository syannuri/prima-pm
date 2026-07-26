import fs from 'node:fs';
import path from 'node:path';
import type { Message } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';
import { publishToUsers } from './sse.js';

// Push a real-time "poke" to a conversation's members (+ any extra users, e.g. a just-removed
// member so their list updates). Best-effort — a delivery failure never breaks the mutation.
async function notify(conversationId: string, event: 'message' | 'conversation', extraUserIds: string[] = []) {
  try {
    const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
    const ids = new Set<string>(extraUserIds);
    for (const m of members) ids.add(m.userId);
    publishToUsers(ids, event, { conversationId });
  } catch { /* never let notification failure break the write */ }
}

// Chat = DIRECT (1-to-1) and GROUP conversations, unified by a ConversationMember join with a
// per-member read cursor (lastReadAt). A DIRECT thread is deduped by the canonical (userAId <
// userBId) pair; a GROUP has a title, N members, an optional linked project, and admins. A
// member's unread = messages from OTHERS newer than their own cursor.

const CONTACT = { id: true, name: true, email: true, role: true } as const;

// A file to attach to an outgoing message (multer's server-generated safe name = the storage key).
export interface OutgoingAttachment {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

// Canonical ordering of a user pair (for the DIRECT dedup key).
function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

// One emoji's reaction summary on a message: how many reacted, whether I did, and who (names).
type ReactionSummary = { emoji: string; count: number; mine: boolean; users: string[] };
type ReactionRow = { emoji: string; userId: string; user: { name: string } };

// Group a message's raw reaction rows into per-emoji summaries (stable order = first reaction seen).
function summarizeReactions(rows: ReactionRow[] | undefined, meId: string): ReactionSummary[] {
  if (!rows || rows.length === 0) return [];
  const byEmoji = new Map<string, ReactionSummary>();
  for (const r of rows) {
    let s = byEmoji.get(r.emoji);
    if (!s) { s = { emoji: r.emoji, count: 0, mine: false, users: [] }; byEmoji.set(r.emoji, s); }
    s.count += 1;
    s.users.push(r.user.name);
    if (r.userId === meId) s.mine = true;
  }
  return [...byEmoji.values()];
}

// A message as sent to the client. A soft-deleted message keeps its row (so runs/threads stay
// consistent) but its body is never serialized — the UI renders a "message was deleted" tombstone.
// `read` = a read-receipt summary for one's OWN messages (how many other members have read it,
// and whether ALL have). null for others' messages / where not computed.
type ReadInfo = { count: number; all: boolean };
function toWire(m: Message & { reactions?: ReactionRow[] }, meId: string, read: ReadInfo | null = null) {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: deleted ? '' : m.body,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deleted,
    attachment:
      !deleted && m.attachmentKey
        ? { name: m.attachmentName ?? 'file', mime: m.attachmentMime ?? 'application/octet-stream', size: m.attachmentSize ?? 0 }
        : null,
    reactions: deleted ? [] : summarizeReactions(m.reactions, meId),
    read,
  };
}

type Contact = { id: string; name: string; email: string; role: string };
type MemberRow = { userId: string; isAdmin: boolean; lastReadAt: Date | null; user: Contact };
type ConvWithMembers = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string | null;
  projectId: string | null;
  createdById: string | null;
  members: MemberRow[];
};

// The display shape of a conversation for a given viewer: a DIRECT shows the counterpart; a GROUP
// shows its title + member list.
function describe(conv: ConvWithMembers, meId: string) {
  const isGroup = conv.type === 'GROUP';
  const other = isGroup ? null : conv.members.find((m) => m.userId !== meId)?.user ?? null;
  const me = conv.members.find((m) => m.userId === meId);
  return {
    id: conv.id,
    type: conv.type,
    title: isGroup ? conv.title ?? 'Group' : other?.name ?? 'Unknown',
    other: other ?? null,
    members: conv.members.map((m) => ({ ...m.user, isAdmin: m.isAdmin })),
    projectId: conv.projectId,
    createdById: conv.createdById,
    iAmAdmin: !!me?.isAdmin,
  };
}

// Users the caller can start a DM / add to a group: active, non-guest, not self.
export async function listContacts(meId: string) {
  return prisma.user.findMany({
    where: { isActive: true, role: { not: 'GUEST' }, id: { not: meId } },
    select: CONTACT,
    orderBy: { name: 'asc' },
  });
}

const memberInclude = { members: { include: { user: { select: CONTACT } } } } as const;

// The caller's conversations, newest activity first, with display info, last-message preview and
// the caller's unread count.
export async function listConversations(meId: string) {
  const convs = await prisma.conversation.findMany({
    where: { members: { some: { userId: meId } } },
    orderBy: { lastMessageAt: 'desc' },
    include: { ...memberInclude, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  // Hide conversations the caller "deleted" — unless a message arrived after they hid it.
  const visible = convs.filter((c) => {
    const mine = c.members.find((m) => m.userId === meId);
    return !(mine?.hiddenAt && c.lastMessageAt <= mine.hiddenAt);
  });

  return Promise.all(
    visible.map(async (c) => {
      const myCursor = c.members.find((m) => m.userId === meId)?.lastReadAt ?? null;
      const last = c.messages[0] ?? null;
      const unread = await prisma.message.count({
        where: { conversationId: c.id, senderId: { not: meId }, ...(myCursor ? { createdAt: { gt: myCursor } } : {}) },
      });
      return {
        ...describe(c as ConvWithMembers, meId),
        lastMessage: last
          ? {
              // Preview text: a file-only message shows its filename with a paperclip.
              body: last.deletedAt ? '' : last.body || (last.attachmentKey ? `📎 ${last.attachmentName ?? 'file'}` : ''),
              senderId: last.senderId,
              createdAt: last.createdAt,
              deleted: last.deletedAt !== null,
            }
          : null,
        lastMessageAt: c.lastMessageAt,
        unread,
      };
    }),
  );
}

// Total unread across all the caller's conversations — drives the header badge (polled).
export async function getUnreadCount(meId: string): Promise<number> {
  const mems = await prisma.conversationMember.findMany({ where: { userId: meId }, select: { conversationId: true, lastReadAt: true } });
  const counts = await Promise.all(
    mems.map((mem) =>
      prisma.message.count({
        where: { conversationId: mem.conversationId, senderId: { not: meId }, ...(mem.lastReadAt ? { createdAt: { gt: mem.lastReadAt } } : {}) },
      }),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

// Verify the caller is a member and return the conversation (with members). Optionally require the
// caller be a GROUP admin (for management actions).
async function requireMember(meId: string, conversationId: string, opts: { admin?: boolean; group?: boolean } = {}) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: memberInclude });
  const me = conv?.members.find((m) => m.userId === meId);
  if (!conv || !me) throw NotFound('Conversation not found');
  if (opts.group && conv.type !== 'GROUP') throw BadRequest('Not a group conversation');
  if (opts.admin && !me.isAdmin) throw Forbidden('Only a group admin can do that');
  return conv;
}

// Messages in a conversation (optionally only those after `afterId`, for lightweight polling).
// Reading marks the caller's cursor so their unread resets.
export async function getConversationMessages(meId: string, conversationId: string, afterId?: string) {
  const conv = await requireMember(meId, conversationId);

  let after: Date | undefined;
  if (afterId) {
    const cursor = await prisma.message.findUnique({ where: { id: afterId }, select: { createdAt: true, conversationId: true } });
    if (cursor && cursor.conversationId === conversationId) after = cursor.createdAt;
  }

  const messages = await prisma.message.findMany({
    where: { conversationId, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { reactions: { include: { user: { select: { name: true } } } } },
  });

  await markRead(meId, conversationId);

  // Read receipts on MY messages: how many other members' read cursors have reached each message.
  const otherCursors = (conv as ConvWithMembers).members.filter((mm) => mm.userId !== meId).map((mm) => mm.lastReadAt);
  const readOf = (m: Message): ReadInfo | null => {
    if (m.senderId !== meId || m.deletedAt || otherCursors.length === 0) return null;
    const count = otherCursors.filter((c) => c !== null && c >= m.createdAt).length;
    return { count, all: count === otherCursors.length };
  };

  return { conversationId, ...describe(conv as ConvWithMembers, meId), messages: messages.map((m) => toWire(m, meId, readOf(m))) };
}

// Advance the caller's read cursor to now.
export async function markRead(meId: string, conversationId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: meId } },
    select: { id: true, lastReadAt: true },
  });
  if (!member) throw NotFound('Conversation not found');

  // Did my cursor actually move past unread messages from others? Only then poke the senders so
  // their read receipts update — this keeps the 4s thread poll (which re-marks read but sees
  // nothing new) from spamming SSE events.
  const newlyRead = await prisma.message.count({
    where: { conversationId, senderId: { not: meId }, ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}) },
  });
  await prisma.conversationMember.update({ where: { id: member.id }, data: { lastReadAt: new Date(), hiddenAt: null } });
  if (newlyRead > 0) await notify(conversationId, 'message');
  return { ok: true };
}

function attachmentData(attachment?: OutgoingAttachment) {
  return attachment
    ? { attachmentKey: attachment.filename, attachmentName: attachment.originalname, attachmentMime: attachment.mimetype, attachmentSize: attachment.size }
    : {};
}

// Create a message, bump the conversation activity time and advance the sender's own read cursor.
async function postMessage(meId: string, conversationId: string, body: string, attachment?: OutgoingAttachment) {
  if (!body.trim() && !attachment) throw BadRequest('Message cannot be empty');
  const now = new Date();
  const message = await prisma.message.create({ data: { conversationId, senderId: meId, body, ...attachmentData(attachment) } });
  await prisma.conversationMember.updateMany({ where: { conversationId, userId: meId }, data: { lastReadAt: now, hiddenAt: null } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  await notify(conversationId, 'message');
  return { conversationId, message: toWire(message, meId) };
}

// Send a DM to a user, creating the canonical conversation (+ both memberships) if needed.
export async function sendMessageTo(meId: string, toUserId: string, body: string, attachment?: OutgoingAttachment) {
  if (toUserId === meId) throw BadRequest('Cannot message yourself');
  if (!body.trim() && !attachment) throw BadRequest('Message cannot be empty');
  const recipient = await prisma.user.findFirst({ where: { id: toUserId, isActive: true, role: { not: 'GUEST' } }, select: { id: true } });
  if (!recipient) throw NotFound('Recipient not found');

  const [aId, bId] = pair(meId, toUserId);
  const now = new Date();
  const conv = await prisma.conversation.upsert({
    where: { userAId_userBId: { userAId: aId, userBId: bId } },
    create: { type: 'DIRECT', userAId: aId, userBId: bId, lastMessageAt: now, members: { create: [{ userId: aId }, { userId: bId }] } },
    update: {},
    select: { id: true },
  });
  return postMessage(meId, conv.id, body, attachment);
}

// Send a message to an existing conversation the caller belongs to (DIRECT or GROUP).
export async function sendToConversation(meId: string, conversationId: string, body: string, attachment?: OutgoingAttachment) {
  await requireMember(meId, conversationId);
  return postMessage(meId, conversationId, body, attachment);
}

// Create a GROUP conversation. The creator is an admin; `memberIds` are the other members (deduped,
// must be active non-guests). `projectId` optionally links it to a project (display only).
export async function createGroup(meId: string, rawTitle: string, memberIds: string[], projectId?: string) {
  const title = rawTitle.trim();
  if (!title) throw BadRequest('A group needs a name');
  if (title.length > 120) throw BadRequest('Group name is too long');
  const others = [...new Set(memberIds)].filter((id) => id !== meId);
  if (others.length < 2) throw BadRequest('Add at least two other people to start a group');

  const valid = await prisma.user.findMany({ where: { id: { in: others }, isActive: true, role: { not: 'GUEST' } }, select: { id: true } });
  if (valid.length !== others.length) throw BadRequest('One or more members are not valid');

  const now = new Date();
  const conv = await prisma.conversation.create({
    data: {
      type: 'GROUP',
      title,
      projectId: projectId || null,
      createdById: meId,
      lastMessageAt: now,
      members: { create: [{ userId: meId, isAdmin: true, lastReadAt: now }, ...others.map((id) => ({ userId: id }))] },
    },
    include: memberInclude,
  });
  await notify(conv.id, 'conversation');
  return describe(conv as ConvWithMembers, meId);
}

// Add members to a group (admin only). Silently skips users who are already members.
export async function addGroupMembers(meId: string, conversationId: string, userIds: string[]) {
  const conv = await requireMember(meId, conversationId, { group: true, admin: true });
  const existing = new Set(conv.members.map((m) => m.userId));
  const toAdd = [...new Set(userIds)].filter((id) => !existing.has(id));
  if (toAdd.length) {
    const valid = await prisma.user.findMany({ where: { id: { in: toAdd }, isActive: true, role: { not: 'GUEST' } }, select: { id: true } });
    await prisma.conversationMember.createMany({ data: valid.map((u) => ({ conversationId, userId: u.id })), skipDuplicates: true });
  }
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, include: memberInclude });
  await notify(conversationId, 'conversation');
  return describe(fresh as ConvWithMembers, meId);
}

// Remove a member from a group (admin only). Use leaveGroup to remove yourself.
export async function removeGroupMember(meId: string, conversationId: string, userId: string) {
  await requireMember(meId, conversationId, { group: true, admin: true });
  if (userId === meId) throw BadRequest('Use "leave group" to remove yourself');
  await prisma.conversationMember.deleteMany({ where: { conversationId, userId } });
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, include: memberInclude });
  await notify(conversationId, 'conversation', [userId]); // include the removed user so their list drops it
  return describe(fresh as ConvWithMembers, meId);
}

// Rename a group (admin only).
export async function renameGroup(meId: string, conversationId: string, rawTitle: string) {
  await requireMember(meId, conversationId, { group: true, admin: true });
  const title = rawTitle.trim();
  if (!title) throw BadRequest('A group needs a name');
  if (title.length > 120) throw BadRequest('Group name is too long');
  const conv = await prisma.conversation.update({ where: { id: conversationId }, data: { title }, include: memberInclude });
  await notify(conversationId, 'conversation');
  return describe(conv as ConvWithMembers, meId);
}

// Leave a group. If the caller was the last admin, the earliest remaining member is promoted so the
// group is never adminless. If no members remain, the conversation (and its files) are removed.
export async function leaveGroup(meId: string, conversationId: string) {
  const conv = await requireMember(meId, conversationId, { group: true });
  const audience = conv.members.map((m) => m.userId); // capture BEFORE leaving (incl. the leaver)
  await prisma.conversationMember.deleteMany({ where: { conversationId, userId: meId } });

  const remaining = await prisma.conversationMember.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  if (remaining.length === 0) {
    // Purge any attached files, then the conversation (messages cascade).
    const withFiles = await prisma.message.findMany({ where: { conversationId, attachmentKey: { not: null } }, select: { attachmentKey: true } });
    for (const m of withFiles) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, m.attachmentKey!)); } catch { /* already gone */ }
    }
    await prisma.conversation.delete({ where: { id: conversationId } });
  } else if (!remaining.some((m) => m.isAdmin)) {
    await prisma.conversationMember.update({ where: { id: remaining[0].id }, data: { isAdmin: true } });
  }
  try { publishToUsers(audience, 'conversation', { conversationId }); } catch { /* best-effort */ }
  return { ok: true };
}

// "Delete conversation" for the caller only (DM or group): hide it from their list + clear unread.
// It reappears when a new message arrives (lastMessageAt > hiddenAt) or when they reopen/post.
export async function hideConversation(meId: string, conversationId: string) {
  const now = new Date();
  const updated = await prisma.conversationMember.updateMany({ where: { conversationId, userId: meId }, data: { hiddenAt: now, lastReadAt: now } });
  if (updated.count === 0) throw NotFound('Conversation not found');
  return { ok: true };
}

// Delete a GROUP for EVERYONE (admin only): purge attachment files, cascade-delete the conversation
// (members + messages + reactions), and notify all members so it drops from their lists.
export async function deleteGroup(meId: string, conversationId: string) {
  const conv = await requireMember(meId, conversationId, { group: true, admin: true });
  const audience = conv.members.map((m) => m.userId);
  const withFiles = await prisma.message.findMany({ where: { conversationId, attachmentKey: { not: null } }, select: { attachmentKey: true } });
  for (const m of withFiles) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, m.attachmentKey!)); } catch { /* already gone */ }
  }
  await prisma.conversation.delete({ where: { id: conversationId } });
  try { publishToUsers(audience, 'conversation', { conversationId }); } catch { /* best-effort */ }
  return { ok: true };
}

// Load a message the caller OWNS and can still act on (not already deleted). Only the sender may
// edit or delete their own messages.
async function requireOwnMessage(meId: string, messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m) throw NotFound('Message not found');
  if (m.senderId !== meId) throw Forbidden('You can only change your own messages');
  if (m.deletedAt) throw BadRequest('Message was deleted');
  return m;
}

// Edit the body of one's own message. Stamps editedAt; does NOT reorder the conversation
// (lastMessageAt is unchanged) so an edit never bumps a thread to the top.
export async function editMessage(meId: string, messageId: string, body: string) {
  const existing = await requireOwnMessage(meId, messageId);
  const updated = await prisma.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
  await notify(existing.conversationId, 'message');
  return { message: toWire(updated, meId) };
}

// Soft-delete one's own message: the row stays (thread/cursor consistency) but the body is never
// served again — the UI shows a "message was deleted" tombstone in its place. Any attached file's
// bytes are purged from disk (best-effort) and its metadata cleared, reclaiming storage.
export async function deleteMessage(meId: string, messageId: string) {
  const m = await requireOwnMessage(meId, messageId);
  if (m.attachmentKey) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, m.attachmentKey)); } catch { /* file already gone — proceed */ }
  }
  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), attachmentKey: null, attachmentName: null, attachmentMime: null, attachmentSize: null },
  });
  await notify(m.conversationId, 'message');
  return { message: toWire(updated, meId) };
}

// Toggle the caller's emoji reaction on a message (add if absent, remove if present). The caller
// must belong to the message's conversation and the message must not be deleted. Returns the fresh
// reaction summary and pushes a `message` poke so every member re-renders.
export async function toggleReaction(meId: string, messageId: string, emoji: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true, deletedAt: true } });
  if (!m || m.deletedAt) throw NotFound('Message not found');
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: m.conversationId, userId: meId } }, select: { id: true } });
  if (!member) throw NotFound('Message not found');

  const existing = await prisma.messageReaction.findUnique({ where: { messageId_userId_emoji: { messageId, userId: meId, emoji } }, select: { id: true } });
  if (existing) await prisma.messageReaction.delete({ where: { id: existing.id } });
  else await prisma.messageReaction.create({ data: { messageId, userId: meId, emoji } });

  const rows = await prisma.messageReaction.findMany({ where: { messageId }, include: { user: { select: { name: true } } } });
  await notify(m.conversationId, 'message');
  return { messageId, reactions: summarizeReactions(rows, meId) };
}

// Resolve an attachment's file for a participant to download/view. Verifies the caller belongs to
// the conversation, the message isn't deleted, and it actually carries a file that exists on disk.
export async function getMessageFile(meId: string, messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.deletedAt || !m.attachmentKey) throw NotFound('Attachment not found');
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: m.conversationId, userId: meId } }, select: { id: true } });
  if (!member) throw NotFound('Attachment not found');
  const absPath = path.join(UPLOAD_DIR, m.attachmentKey);
  if (!fs.existsSync(absPath)) throw NotFound('File missing on storage');
  return { absPath, name: m.attachmentName ?? 'file', mime: m.attachmentMime ?? 'application/octet-stream' };
}

// Distinct users who share at least one conversation with `userId` — the audience for that user's
// presence (online/offline) broadcasts.
export async function getConversationPartnerIds(userId: string): Promise<string[]> {
  const mine = await prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true } });
  if (mine.length === 0) return [];
  const others = await prisma.conversationMember.findMany({
    where: { conversationId: { in: mine.map((m) => m.conversationId) }, userId: { not: userId } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return others.map((o) => o.userId);
}

// Broadcast an ephemeral "typing" ping to the OTHER members of a conversation the caller belongs to.
// Not persisted; the client resolves the userId to a name from its own member list and auto-expires.
export async function typingSignal(meId: string, conversationId: string) {
  const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  if (!members.some((m) => m.userId === meId)) throw NotFound('Conversation not found');
  publishToUsers(members.filter((m) => m.userId !== meId).map((m) => m.userId), 'typing', { conversationId, userId: meId });
  return { ok: true };
}

// Case-insensitive substring search over the caller's conversations (body OR attachment filename),
// optionally scoped to one conversation. Deleted messages excluded. Each hit carries its
// conversation's display info + the sender name so the client can deep-link into the thread.
export async function searchMessages(meId: string, rawQuery: string, conversationId?: string) {
  const q = rawQuery.trim();
  if (q.length < 2) return { query: q, results: [] as unknown[] };

  const convs = await prisma.conversation.findMany({
    where: { members: { some: { userId: meId } }, ...(conversationId ? { id: conversationId } : {}) },
    include: memberInclude,
  });
  if (convs.length === 0) return { query: q, results: [] };

  const displayById = new Map(convs.map((c) => [c.id, describe(c as ConvWithMembers, meId)]));

  const hits = await prisma.message.findMany({
    where: {
      conversationId: { in: convs.map((c) => c.id) },
      deletedAt: null,
      OR: [{ body: { contains: q, mode: 'insensitive' } }, { attachmentName: { contains: q, mode: 'insensitive' } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { sender: { select: { name: true } } },
  });

  return {
    query: q,
    results: hits.map((m) => {
      const d = displayById.get(m.conversationId)!;
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: m.sender.name,
        // Fall back to the filename so a file-only hit still shows something meaningful.
        body: m.body || (m.attachmentName ? `📎 ${m.attachmentName}` : ''),
        createdAt: m.createdAt,
        conversation: { id: d.id, type: d.type, title: d.title, other: d.other },
      };
    }),
  };
}
