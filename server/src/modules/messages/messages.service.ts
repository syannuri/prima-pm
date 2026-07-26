import fs from 'node:fs';
import path from 'node:path';
import type { Message } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';

// A file to attach to an outgoing message (multer's server-generated safe name = the storage key).
export interface OutgoingAttachment {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

// Direct 1-to-1 messaging. A Conversation stores its pair in canonical order (userAId < userBId)
// so there is exactly one thread per pair and find-or-create is deterministic. Each side has a
// read cursor (lastReadAAt / lastReadBAt); a user's unread = messages from the OTHER side newer
// than their own cursor.

// Canonical ordering of a user pair.
function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

// A message as sent to the client. A soft-deleted message keeps its row (so runs/threads stay
// consistent) but its body is never serialized — the UI renders a "message was deleted" tombstone.
function toWire(m: Message) {
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
  };
}

// Which side of the conversation `me` is on, plus the counterpart id.
function side(conv: { userAId: string; userBId: string; lastReadAAt: Date | null; lastReadBAt: Date | null }, me: string) {
  const isA = conv.userAId === me;
  return {
    isA,
    otherId: isA ? conv.userBId : conv.userAId,
    myCursor: isA ? conv.lastReadAAt : conv.lastReadBAt,
  };
}

// Users the caller can start a DM with: active, non-guest, not self.
export async function listContacts(meId: string) {
  return prisma.user.findMany({
    where: { isActive: true, role: { not: 'GUEST' }, id: { not: meId } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

// The caller's conversations, newest activity first, with the counterpart, a last-message
// preview and the caller's unread count.
export async function listConversations(meId: string) {
  const convs = await prisma.conversation.findMany({
    where: { OR: [{ userAId: meId }, { userBId: meId }] },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      userA: { select: { id: true, name: true, email: true, role: true } },
      userB: { select: { id: true, name: true, email: true, role: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  return Promise.all(
    convs.map(async (c) => {
      const { isA, otherId, myCursor } = side(c, meId);
      const other = isA ? c.userB : c.userA;
      const last = c.messages[0] ?? null;
      const unread = await prisma.message.count({
        where: { conversationId: c.id, senderId: otherId, ...(myCursor ? { createdAt: { gt: myCursor } } : {}) },
      });
      return {
        id: c.id,
        other: { id: other.id, name: other.name, email: other.email, role: other.role },
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
  const convs = await prisma.conversation.findMany({
    where: { OR: [{ userAId: meId }, { userBId: meId }] },
    select: { id: true, userAId: true, userBId: true, lastReadAAt: true, lastReadBAt: true },
  });
  let total = 0;
  for (const c of convs) {
    const { otherId, myCursor } = side(c, meId);
    total += await prisma.message.count({
      where: { conversationId: c.id, senderId: otherId, ...(myCursor ? { createdAt: { gt: myCursor } } : {}) },
    });
  }
  return total;
}

// Verify the caller belongs to the conversation and return it (with the counterpart).
async function requireParticipant(meId: string, conversationId: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      userA: { select: { id: true, name: true, email: true, role: true } },
      userB: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) throw NotFound('Conversation not found');
  return conv;
}

// Messages in a conversation (optionally only those after `afterId`, for lightweight polling).
// Reading marks the caller's cursor so their unread resets.
export async function getConversationMessages(meId: string, conversationId: string, afterId?: string) {
  const conv = await requireParticipant(meId, conversationId);

  let after: Date | undefined;
  if (afterId) {
    const cursor = await prisma.message.findUnique({ where: { id: afterId }, select: { createdAt: true, conversationId: true } });
    if (cursor && cursor.conversationId === conversationId) after = cursor.createdAt;
  }

  const messages = await prisma.message.findMany({
    where: { conversationId, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  await markRead(meId, conversationId);

  const { isA, otherId } = side(conv, meId);
  const other = isA ? conv.userB : conv.userA;
  return { conversationId, other: { id: other.id, name: other.name, email: other.email, role: other.role }, messages: messages.map(toWire) };
}

// Advance the caller's read cursor to now.
export async function markRead(meId: string, conversationId: string) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { userAId: true, userBId: true } });
  if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) throw NotFound('Conversation not found');
  const field = conv.userAId === meId ? 'lastReadAAt' : 'lastReadBAt';
  await prisma.conversation.update({ where: { id: conversationId }, data: { [field]: new Date() } });
  return { ok: true };
}

// Send a message to a user, creating the (canonical) conversation if needed. An optional file may
// be attached; a message must carry text OR a file. The sender's own cursor is advanced.
export async function sendMessageTo(meId: string, toUserId: string, body: string, attachment?: OutgoingAttachment) {
  if (toUserId === meId) throw BadRequest('Cannot message yourself');
  if (!body.trim() && !attachment) throw BadRequest('Message cannot be empty');
  const recipient = await prisma.user.findFirst({
    where: { id: toUserId, isActive: true, role: { not: 'GUEST' } },
    select: { id: true },
  });
  if (!recipient) throw NotFound('Recipient not found');

  const [aId, bId] = pair(meId, toUserId);
  const now = new Date();
  const conv = await prisma.conversation.upsert({
    where: { userAId_userBId: { userAId: aId, userBId: bId } },
    create: { userAId: aId, userBId: bId, lastMessageAt: now },
    update: {},
    select: { id: true, userAId: true },
  });

  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      senderId: meId,
      body,
      ...(attachment
        ? { attachmentKey: attachment.filename, attachmentName: attachment.originalname, attachmentMime: attachment.mimetype, attachmentSize: attachment.size }
        : {}),
    },
  });
  // Bump activity + advance the sender's own read cursor.
  const senderField = conv.userAId === meId ? 'lastReadAAt' : 'lastReadBAt';
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, [senderField]: now } });

  return { conversationId: conv.id, message: toWire(message) };
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
  await requireOwnMessage(meId, messageId);
  const updated = await prisma.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
  return { message: toWire(updated) };
}

// Soft-delete one's own message: the row stays (thread/cursor consistency) but the body is never
// served again — the UI shows a "message was deleted" tombstone in its place. Any attached file's
// bytes are purged from disk (best-effort) and its metadata cleared, reclaiming storage.
export async function deleteMessage(meId: string, messageId: string) {
  const m = await requireOwnMessage(meId, messageId);
  if (m.attachmentKey) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, m.attachmentKey));
    } catch {
      /* file already gone — proceed */
    }
  }
  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), attachmentKey: null, attachmentName: null, attachmentMime: null, attachmentSize: null },
  });
  return { message: toWire(updated) };
}

// Resolve an attachment's file for a participant to download/view. Verifies the caller belongs to
// the conversation, the message isn't deleted, and it actually carries a file that exists on disk.
export async function getMessageFile(meId: string, messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.deletedAt || !m.attachmentKey) throw NotFound('Attachment not found');
  const conv = await prisma.conversation.findUnique({ where: { id: m.conversationId }, select: { userAId: true, userBId: true } });
  if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) throw NotFound('Attachment not found');
  const absPath = path.join(UPLOAD_DIR, m.attachmentKey);
  if (!fs.existsSync(absPath)) throw NotFound('File missing on storage');
  return { absPath, name: m.attachmentName ?? 'file', mime: m.attachmentMime ?? 'application/octet-stream' };
}

// Full-text-ish search over the caller's own conversations (case-insensitive substring on body),
// optionally scoped to one conversation. Deleted messages are excluded. Each hit carries its
// conversation + counterpart so the client can deep-link straight into the thread.
export async function searchMessages(meId: string, rawQuery: string, conversationId?: string) {
  const q = rawQuery.trim();
  if (q.length < 2) return { query: q, results: [] as unknown[] };

  const convs = await prisma.conversation.findMany({
    where: {
      OR: [{ userAId: meId }, { userBId: meId }],
      ...(conversationId ? { id: conversationId } : {}),
    },
    include: {
      userA: { select: { id: true, name: true, email: true, role: true } },
      userB: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (convs.length === 0) return { query: q, results: [] };

  const otherById = new Map(convs.map((c) => [c.id, c.userAId === meId ? c.userB : c.userA]));

  const hits = await prisma.message.findMany({
    where: {
      conversationId: { in: convs.map((c) => c.id) },
      deletedAt: null,
      OR: [
        { body: { contains: q, mode: 'insensitive' } },
        { attachmentName: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return {
    query: q,
    results: hits.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      // Fall back to the filename so a file-only hit still shows something meaningful.
      body: m.body || (m.attachmentName ? `📎 ${m.attachmentName}` : ''),
      createdAt: m.createdAt,
      other: otherById.get(m.conversationId)!,
    })),
  };
}
