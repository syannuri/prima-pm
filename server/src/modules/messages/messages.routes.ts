import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { Forbidden } from '../../lib/errors.js';
import { sendMessageSchema } from './messages.schemas.js';
import {
  listContacts,
  listConversations,
  getUnreadCount,
  getConversationMessages,
  markRead,
  sendMessageTo,
} from './messages.service.js';

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

// Send a message to a user (find-or-create the conversation).
router.post('/to/:userId', validateBody(sendMessageSchema), asyncHandler(async (req, res) => {
  const result = await sendMessageTo(req.user!.id, req.params.userId, req.body.body);
  res.status(201).json(result);
}));

export default router;
