import { prisma } from '../../lib/prisma.js';
import { BadRequest, NotFound } from '../../lib/errors.js';

// Direct 1-to-1 messaging. A Conversation stores its pair in canonical order (userAId < userBId)
// so there is exactly one thread per pair and find-or-create is deterministic. Each side has a
// read cursor (lastReadAAt / lastReadBAt); a user's unread = messages from the OTHER side newer
// than their own cursor.

// Canonical ordering of a user pair.
function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
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
        lastMessage: last ? { body: last.body, senderId: last.senderId, createdAt: last.createdAt } : null,
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
  return { conversationId, other: { id: other.id, name: other.name, email: other.email, role: other.role }, messages };
}

// Advance the caller's read cursor to now.
export async function markRead(meId: string, conversationId: string) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { userAId: true, userBId: true } });
  if (!conv || (conv.userAId !== meId && conv.userBId !== meId)) throw NotFound('Conversation not found');
  const field = conv.userAId === meId ? 'lastReadAAt' : 'lastReadBAt';
  await prisma.conversation.update({ where: { id: conversationId }, data: { [field]: new Date() } });
  return { ok: true };
}

// Send a message to a user, creating the (canonical) conversation if needed. The sender's own
// cursor is advanced (their own message is "read").
export async function sendMessageTo(meId: string, toUserId: string, body: string) {
  if (toUserId === meId) throw BadRequest('Cannot message yourself');
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

  const message = await prisma.message.create({ data: { conversationId: conv.id, senderId: meId, body } });
  // Bump activity + advance the sender's own read cursor.
  const senderField = conv.userAId === meId ? 'lastReadAAt' : 'lastReadBAt';
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, [senderField]: now } });

  return { conversationId: conv.id, message };
}
