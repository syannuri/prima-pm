import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Forbidden } from '../../lib/errors.js';
import { addFeedbackGuidance, canWriteTenantScope } from './memory.service.js';

// Feedback on Anett answers (👍/👎). Deterministic learning loop: a 👎 with a note becomes a durable
// GUIDANCE memory that later prompts honor (see docs/AI-MEMORY-FEEDBACK-PLAN.md). No LLM cost.

const MAX_ANSWER = 4000;
const MAX_QUESTION = 2000;

export interface FeedbackInput {
  rating: 'UP' | 'DOWN';
  answer: string;
  question?: string | null;
  note?: string | null;
  projectId?: string | null;
}

// Record a rating; when it's a 👎 with a note (and memory is on), also spawn a GUIDANCE memory and
// link it back. The rating row is always written first, so feedback is captured even if guidance
// creation is skipped (memory off) or refused.
export async function recordFeedback(
  caller: { userId: string; role: Role; name?: string | null },
  input: FeedbackInput,
): Promise<{ id: string; guidanceStored: boolean }> {
  const note = input.note?.trim() || null;
  const fb = await prisma.aiFeedback.create({
    data: {
      userId: caller.userId,
      rating: input.rating,
      question: input.question?.slice(0, MAX_QUESTION) ?? null,
      answer: input.answer.slice(0, MAX_ANSWER),
      note,
      projectId: input.projectId ?? null,
    },
    select: { id: true },
  });

  let guidanceStored = false;
  if (input.rating === 'DOWN' && note) {
    const guidance = await addFeedbackGuidance(note, caller, fb.id);
    if (guidance) {
      await prisma.aiFeedback.update({ where: { id: fb.id }, data: { memoryId: guidance.id } });
      guidanceStored = true;
    }
  }
  return { id: fb.id, guidanceStored };
}

// ── Admin feedback inbox (Fase 4) ───────────────────────────────────────────────────────────────
// Governance review surface: admins/PMO see how Anett is being rated in their workspace and which 👎
// notes became durable GUIDANCE, so they can audit the learning loop. Tenant-scoped by the extension.

export interface FeedbackRow {
  id: string; rating: 'UP' | 'DOWN'; question: string | null; answer: string;
  note: string | null; projectId: string | null; createdAt: Date;
  guidance: string | null; // content of the spawned GUIDANCE memory, if it's still active
}

export async function listFeedbackInbox(
  caller: { role: Role },
  opts: { rating?: 'UP' | 'DOWN'; limit?: number } = {},
): Promise<FeedbackRow[]> {
  // Reuse the org-scope-writer rule: only governance roles (ADMIN/PMO — and a GUEST in their own
  // sandbox) may review the workspace's feedback.
  if (!canWriteTenantScope(caller.role)) throw Forbidden('Hanya admin/PMO yang dapat melihat umpan balik Anett.');
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await prisma.aiFeedback.findMany({
    where: opts.rating ? { rating: opts.rating } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, rating: true, question: true, answer: true, note: true, projectId: true, createdAt: true, memoryId: true },
  });
  // Resolve spawned guidance content in one query (only for rows that linked a memory).
  const memIds = rows.map((r) => r.memoryId).filter((x): x is string => !!x);
  const mems = memIds.length
    ? await prisma.aiMemory.findMany({ where: { id: { in: memIds }, active: true }, select: { id: true, content: true } })
    : [];
  const memById = new Map(mems.map((m) => [m.id, m.content]));
  return rows.map((r) => ({
    id: r.id, rating: r.rating, question: r.question, answer: r.answer, note: r.note,
    projectId: r.projectId, createdAt: r.createdAt,
    guidance: r.memoryId ? memById.get(r.memoryId) ?? null : null,
  }));
}
