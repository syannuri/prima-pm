import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';
import {
  sendMessageTo,
  deleteMessage,
  getMessageFile,
  searchMessages,
  listConversations,
  getConversationMessages,
} from '../messages/messages.service.js';

// File attachments on direct messages: metadata rides on the Message, bytes live in the shared
// uploads/ dir; only participants can fetch a file; deleting a message purges its file.
let alice = '';
let bob = '';
let carol = '';

// Drop a dummy file into the uploads dir and return the multer-style descriptor for it.
function stubFile(originalname: string, mime: string, bytes = 'hello') {
  const filename = `${randomUUID()}${path.extname(originalname)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), bytes);
  return { filename, originalname, mimetype: mime, size: Buffer.byteLength(bytes) };
}

describe('Message file attachments', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const mk = async (name: string, email: string) =>
      (await prisma.user.create({ data: { name, email, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } })).id;
    alice = await mk('Alice', 'att-alice@t.test');
    bob = await mk('Bob', 'att-bob@t.test');
    carol = await mk('Carol', 'att-carol@t.test');
  });

  it('sends a file-only message: attachment metadata is served, body is empty, preview shows the filename', async () => {
    const file = stubFile('spec.pdf', 'application/pdf');
    const { message, conversationId } = await sendMessageTo(alice, bob, '', file);
    expect(message.body).toBe('');
    expect(message.attachment).toMatchObject({ name: 'spec.pdf', mime: 'application/pdf', size: file.size });

    const thread = await getConversationMessages(bob, conversationId);
    expect(thread.messages.find((m) => m.id === message.id)!.attachment?.name).toBe('spec.pdf');

    const conv = (await listConversations(bob)).find((c) => c.other.id === alice)!;
    expect(conv.lastMessage?.body).toBe('📎 spec.pdf');
  });

  it('a message can carry both a caption and a file', async () => {
    const { message } = await sendMessageTo(alice, bob, 'here is the diagram', stubFile('diagram.png', 'image/png'));
    expect(message.body).toBe('here is the diagram');
    expect(message.attachment?.mime).toBe('image/png');
  });

  it('only a participant can fetch the file', async () => {
    const { message } = await sendMessageTo(alice, bob, '', stubFile('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    const forBob = await getMessageFile(bob, message.id);
    expect(fs.existsSync(forBob.absPath)).toBe(true);
    expect(forBob.name).toBe('budget.xlsx');
    await expect(getMessageFile(carol, message.id)).rejects.toThrow(/not found/i);
  });

  it('deleting a message purges its file from disk and clears the attachment', async () => {
    const file = stubFile('secret.pdf', 'application/pdf');
    const { message } = await sendMessageTo(alice, bob, '', file);
    const abs = path.join(UPLOAD_DIR, file.filename);
    expect(fs.existsSync(abs)).toBe(true);

    const { message: del } = await deleteMessage(alice, message.id);
    expect(del.deleted).toBe(true);
    expect(del.attachment).toBeNull();
    expect(fs.existsSync(abs)).toBe(false); // bytes reclaimed
    await expect(getMessageFile(bob, message.id)).rejects.toThrow(/not found/i);
  });

  it('search matches attachment filenames', async () => {
    await sendMessageTo(alice, bob, '', stubFile('quarterly-roadmap.pdf', 'application/pdf'));
    const res = await searchMessages(alice, 'roadmap');
    expect(res.results.some((r) => r.body === '📎 quarterly-roadmap.pdf')).toBe(true);
  });
});
