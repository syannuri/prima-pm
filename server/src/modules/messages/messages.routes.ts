import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { BadRequest, Forbidden } from '../../lib/errors.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';
import { addClient, removeClient, startSseHeartbeat, onlineAmong, publishToUsers } from './sse.js';
import { sendMessageSchema, editMessageSchema, createGroupSchema, addMembersSchema, renameGroupSchema, reactionSchema } from './messages.schemas.js';
import {
  listContacts,
  listConversations,
  getUnreadCount,
  getConversationMessages,
  markRead,
  sendMessageTo,
  sendToConversation,
  editMessage,
  deleteMessage,
  searchMessages,
  getMessageFile,
  createGroup,
  addGroupMembers,
  removeGroupMember,
  renameGroup,
  leaveGroup,
  getConversationPartnerIds,
  typingSignal,
  toggleReaction,
} from './messages.service.js';

// Chat file uploads reuse the shared uploads/ dir + the same document/image whitelist and 10 MB
// cap as project Attachments. Server-generated safe names (never trust the client filename).
const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
});
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedExts = ALLOWED_UPLOAD_TYPES[file.mimetype];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExts || !allowedExts.includes(ext)) {
    cb(BadRequest('Unsupported file type. Allowed: PDF, XLSX, DOCX, PNG, JPG'));
    return;
  }
  cb(null, true);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Private 1-to-1 direct messaging. Mounted at /api/v1/messages. Sandboxed GUEST accounts are
// excluded from messaging (they can't be contacts and can't send).
const router = Router();
router.use(requireAuth);
router.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.user!.role === 'GUEST') return next(Forbidden('Messaging is not available for guest accounts'));
  next();
});

// Users the caller can start a DM with.
router.get('/contacts', asyncHandler(async (req, res) => {
  res.json({ contacts: await listContacts(req.user!.id) });
}));

// The caller's conversation list (with previews + unread counts).
router.get('/conversations', asyncHandler(async (req, res) => {
  res.json({ conversations: await listConversations(req.user!.id) });
}));

// Total unread — polled by the header badge.
router.get('/unread-count', asyncHandler(async (req, res) => {
  res.json({ unread: await getUnreadCount(req.user!.id) });
}));

// Real-time event stream (SSE). Pushes tiny { conversationId } pokes on `message`/`conversation`
// events so the client refetches instantly instead of waiting for the poll. `X-Accel-Buffering: no`
// disables nginx buffering for this response; the shared 25s heartbeat keeps it alive.
startSseHeartbeat();
router.get('/stream', asyncHandler(async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n'); // client reconnect backoff hint
  const userId = req.user!.id;
  const cameOnline = addClient(userId, res);

  // Presence: tell this client who among its conversation partners is already online, and (if this
  // is the user's first stream) announce them online to those partners.
  const partners = await getConversationPartnerIds(userId);
  res.write(`event: presence-init\ndata: ${JSON.stringify({ online: onlineAmong(partners) })}\n\n`);
  if (cameOnline) publishToUsers(partners, 'presence', { userId, online: true });

  req.on('close', () => {
    const wentOffline = removeClient(userId, res);
    if (wentOffline) getConversationPartnerIds(userId).then((ps) => publishToUsers(ps, 'presence', { userId, online: false })).catch(() => {});
  });
}));

// Ephemeral "I'm typing" ping to the conversation's other members (throttled client-side).
router.post('/conversations/:id/typing', asyncHandler(async (req, res) => {
  res.json(await typingSignal(req.user!.id, req.params.id));
}));

// Search the caller's messages (optionally within one conversation via ?conversationId=).
router.get('/search', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
  res.json(await searchMessages(req.user!.id, q, conversationId));
}));

// Messages in a conversation (optionally only those after ?after=<messageId>, for polling).
// Reading marks the caller's cursor.
router.get('/conversations/:id', asyncHandler(async (req, res) => {
  const after = typeof req.query.after === 'string' ? req.query.after : undefined;
  res.json(await getConversationMessages(req.user!.id, req.params.id, after));
}));

// Mark a conversation read.
router.post('/conversations/:id/read', asyncHandler(async (req, res) => {
  res.json(await markRead(req.user!.id, req.params.id));
}));

// Send a message to an existing conversation the caller belongs to (DIRECT or GROUP).
router.post('/conversations/:id/messages', validateBody(sendMessageSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await sendToConversation(req.user!.id, req.params.id, req.body.body));
}));

// Send a message with a file to an existing conversation (multipart: file + optional body).
router.post('/conversations/:id/messages/attachment', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw BadRequest('file is required');
  const body = typeof req.body.body === 'string' ? req.body.body.slice(0, 4000) : '';
  res.status(201).json(await sendToConversation(req.user!.id, req.params.id, body, req.file));
}));

// Create a group conversation.
router.post('/groups', validateBody(createGroupSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ conversation: await createGroup(req.user!.id, req.body.title, req.body.memberIds, req.body.projectId) });
}));

// Rename a group (admin only).
router.patch('/conversations/:id', validateBody(renameGroupSchema), asyncHandler(async (req, res) => {
  res.json({ conversation: await renameGroup(req.user!.id, req.params.id, req.body.title) });
}));

// Add members to a group (admin only).
router.post('/conversations/:id/members', validateBody(addMembersSchema), asyncHandler(async (req, res) => {
  res.json({ conversation: await addGroupMembers(req.user!.id, req.params.id, req.body.userIds) });
}));

// Remove a member from a group (admin only).
router.delete('/conversations/:id/members/:userId', asyncHandler(async (req, res) => {
  res.json({ conversation: await removeGroupMember(req.user!.id, req.params.id, req.params.userId) });
}));

// Leave a group.
router.post('/conversations/:id/leave', asyncHandler(async (req, res) => {
  res.json(await leaveGroup(req.user!.id, req.params.id));
}));

// Send a message to a user (find-or-create the conversation).
router.post('/to/:userId', validateBody(sendMessageSchema), asyncHandler(async (req, res) => {
  const result = await sendMessageTo(req.user!.id, req.params.userId, req.body.body);
  res.status(201).json(result);
}));

// Send a message with a file attachment (multipart: file + optional body).
router.post('/to/:userId/attachment', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw BadRequest('file is required');
  const body = typeof req.body.body === 'string' ? req.body.body.slice(0, 4000) : '';
  const result = await sendMessageTo(req.user!.id, req.params.userId, body, req.file);
  res.status(201).json(result);
}));

// Stream a message's attachment to a participant (images render inline; other types download).
router.get('/messages/:id/file', asyncHandler(async (req, res) => {
  const { absPath, name, mime } = await getMessageFile(req.user!.id, req.params.id);
  res.type(mime);
  res.setHeader('Content-Disposition', `${mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`);
  res.sendFile(absPath);
}));

// Edit one's own message.
router.patch('/messages/:id', validateBody(editMessageSchema), asyncHandler(async (req, res) => {
  res.json(await editMessage(req.user!.id, req.params.id, req.body.body));
}));

// Soft-delete one's own message.
router.delete('/messages/:id', asyncHandler(async (req, res) => {
  res.json(await deleteMessage(req.user!.id, req.params.id));
}));

// Toggle an emoji reaction on a message.
router.post('/messages/:id/reactions', validateBody(reactionSchema), asyncHandler(async (req, res) => {
  res.json(await toggleReaction(req.user!.id, req.params.id, req.body.emoji));
}));

export default router;
