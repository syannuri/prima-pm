import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addFeedbackGuidance } from './memory.service.js';

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
