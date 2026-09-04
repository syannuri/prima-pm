import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Forbidden } from '../../lib/errors.js';
import { getAiPort } from '../../lib/ai.js';
import { addFeedbackGuidance, addMemory, callerMemoryEnabled, canWriteTenantScope, MAX_MEMORY_CHARS, type MemScope } from './memory.service.js';

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

// ── Feedback → auto prompt-improvement (RLHF-lite, no fine-tune) ─────────────────────────────────
// Closes the learning loop: instead of only turning a single 👎 into one GUIDANCE memory, distill
// RECURRING themes across many 👎 notes into a few crisp, reusable GUIDANCE candidates an admin can
// review and adopt org-wide. DORMANT by default (AI_FEEDBACK_DISTILL + tenant aiMemoryEnabled). The
// suggestion step is AI (cheap model); ADOPTING one is deterministic (creates a TENANT GUIDANCE memory).

export function feedbackDistillEnabled(): boolean {
  const v = process.env.AI_FEEDBACK_DISTILL;
  return v === '1' || v === 'true';
}

const MIN_DOWNVOTES = 3;   // need a few signals before distilling a "pattern"
const MAX_SUGGESTIONS = 5;

const DISTILL_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

const DISTILL_SYSTEM = `You improve an assistant named Anett by learning from user 👎 feedback on its answers.
From the list of (question, answer, correction) items, find the FEW RECURRING patterns and write each as one durable GUIDANCE rule Anett should follow next time (imperative, e.g. "Always show SPI and CPI together with their interpretation").
STRICT: only patterns supported by MULTIPLE items or a clearly general correction; skip one-off/idiosyncratic notes; each rule ONE crisp sentence, max ${MAX_MEMORY_CHARS} chars; return at most ${MAX_SUGGESTIONS}; if nothing generalizes, return an empty list.`;

// Analyze recent 👎 notes → suggested GUIDANCE rules (does NOT persist anything). ADMIN/PMO only.
export async function analyzeFeedback(caller: { role: Role }): Promise<{ suggestions: { content: string }[] }> {
  if (!canWriteTenantScope(caller.role)) throw Forbidden('Hanya admin/PMO yang dapat menganalisis umpan balik.');
  if (!feedbackDistillEnabled() || !(await callerMemoryEnabled())) return { suggestions: [] };
  const downs = await prisma.aiFeedback.findMany({
    where: { rating: 'DOWN', note: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { question: true, answer: true, note: true },
  });
  if (downs.length < MIN_DOWNVOTES) return { suggestions: [] };
  const payload = downs.map((d, i) => `#${i + 1} Q: ${d.question ?? ''}\nA: ${(d.answer || '').slice(0, 300)}\nFIX: ${d.note}`).join('\n\n');
  const raw = (await getAiPort().draftJson({
    system: DISTILL_SYSTEM, user: payload, jsonSchema: DISTILL_SCHEMA, maxTokens: 600, feature: 'feedback_distill',
  })) as { suggestions?: { content?: string }[] } | null;
  const suggestions = (raw?.suggestions ?? [])
    .map((s) => ({ content: (s.content ?? '').trim().slice(0, MAX_MEMORY_CHARS) }))
    .filter((s) => s.content.length >= 3)
    .slice(0, MAX_SUGGESTIONS);
  return { suggestions };
}

// Adopt a suggested rule → a durable TENANT GUIDANCE memory (governance-gated in addMemory). Deterministic.
export async function adoptFeedbackSuggestion(content: string, caller: { userId: string; role: Role; name?: string | null }): Promise<{ id: string; scope: MemScope }> {
  const m = await addMemory({ content, scope: 'TENANT', kind: 'GUIDANCE', source: 'FEEDBACK' }, caller);
  return { id: m.id, scope: m.scope };
}
