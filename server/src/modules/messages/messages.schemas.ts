import { z } from 'zod';

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(4000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// Editing reuses the same body constraints as sending.
export const editMessageSchema = sendMessageSchema;

export const createGroupSchema = z.object({
  title: z.string().trim().min(1, 'A group needs a name').max(120),
  memberIds: z.array(z.string()).min(2, 'Add at least two other people'),
  projectId: z.string().optional(),
});

export const addMembersSchema = z.object({
  userIds: z.array(z.string()).min(1),
});

export const renameGroupSchema = z.object({
  title: z.string().trim().min(1, 'A group needs a name').max(120),
});

// Curated reaction emoji — the only ones the picker offers and the server accepts.
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '🔥', '✅', '👀'] as const;
export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});

// A browser Web-Push subscription posted by the client (from PushManager.subscribe()).
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});
