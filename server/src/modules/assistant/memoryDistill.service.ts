import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getAiPort } from '../../lib/ai.js';
import { addMemory, callerMemoryEnabled, MAX_MEMORY_CHARS, type MemKind, type MemScope } from './memory.service.js';

// Auto-distill (AI-MEMORY-FEEDBACK-PLAN Fase 4): at the end of a chat session, ask the model to extract
// the few DURABLE, reusable things worth remembering (a stable preference, a lasting fact, a glossary
// term) from the transcript and persist them as source=AUTO memories — so Anett keeps learning without
// the user having to say "remember this". DORMANT by default: runs only when AI_MEMORY_AUTODISTILL is
// on AND the tenant opted into memory. Deterministic dedupe keeps a re-distill idempotent (no dupes).

export function autoDistillEnabled(): boolean {
  const v = process.env.AI_MEMORY_AUTODISTILL;
  return v === '1' || v === 'true';
}

const MAX_NEW = 5;          // never flood the store from one session
const MAX_TRANSCRIPT = 8000; // bound the tokens we send

const DISTILL_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['PREFERENCE', 'FACT', 'GLOSSARY'] },
          content: { type: 'string' },
        },
        required: ['kind', 'content'],
        additionalProperties: false,
      },
    },
  },
  required: ['memories'],
  additionalProperties: false,
} as const;

const SYSTEM = `You maintain a project manager's durable memory for an assistant named Anett.
From the conversation, extract ONLY things worth remembering across future sessions:
- PREFERENCE: how the user likes answers (tone, length, language, format).
- FACT: a lasting fact about the user or their organization (role, standards, recurring context).
- GLOSSARY: a term/acronym → meaning the user uses.
STRICT rules: skip anything ephemeral or specific to one project/task/number; skip greetings and one-off Q&A; skip anything already obvious. Prefer 0 items over a weak guess. Each item is ONE crisp sentence, max ${MAX_MEMORY_CHARS} characters, written as a durable statement. Return at most ${MAX_NEW}. If nothing qualifies, return an empty list.`;

export interface DistillTurn { role: 'user' | 'assistant'; content: string }

// Distill a session transcript into durable memories. Returns the created memories (may be empty).
// No-op (returns []) when disabled, the tenant hasn't opted into memory, or the transcript is thin.
export async function distillConversation(
  turns: DistillTurn[],
  caller: { userId: string; role: Role; name?: string | null },
): Promise<{ created: { id: string; kind: MemKind; content: string; scope: MemScope }[] }> {
  if (!autoDistillEnabled()) return { created: [] };
  if (!(await callerMemoryEnabled())) return { created: [] };
  const transcript = turns
    .filter((t) => t.content?.trim())
    .map((t) => `${t.role === 'user' ? 'User' : 'Anett'}: ${t.content.trim()}`)
    .join('\n')
    .slice(0, MAX_TRANSCRIPT);
  if (transcript.length < 40) return { created: [] }; // nothing substantial to distill

  const port = getAiPort();
  const raw = (await port.draftJson({
    system: SYSTEM,
    user: transcript,
    jsonSchema: DISTILL_SCHEMA,
    maxTokens: 700,
    feature: 'memory_distill',
  })) as { memories?: { kind?: string; content?: string }[] } | null;
  const candidates = (raw?.memories ?? [])
    .map((m) => ({ kind: normalizeDistillKind(m.kind), content: (m.content ?? '').trim() }))
    .filter((m) => m.content.length >= 3)
    .slice(0, MAX_NEW);
  if (candidates.length === 0) return { created: [] };

  // Dedupe against what's already stored (case-insensitive; skip near-duplicates) so a re-distill of an
  // overlapping session doesn't pile up copies.
  const existing = await prisma.aiMemory.findMany({
    where: { active: true, OR: [{ scope: 'TENANT' }, { scope: 'USER', userId: caller.userId }] },
    select: { content: true },
    take: 300,
  });
  const seen = new Set(existing.map((e) => norm(e.content)));

  // AUTO memories default to USER scope: a machine guess shouldn't silently reshape org-wide behaviour.
  // (Org-scope memory stays an explicit admin/PMO action.)
  const scope: MemScope = 'USER';
  const created: { id: string; kind: MemKind; content: string; scope: MemScope }[] = [];
  for (const c of candidates) {
    const key = norm(c.content);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const m = await addMemory(
        { content: c.content.slice(0, MAX_MEMORY_CHARS), scope, kind: c.kind, source: 'AUTO' },
        caller,
      );
      created.push({ id: m.id, kind: m.kind, content: m.content, scope: m.scope });
    } catch {
      // validation (too long/short) → skip that one, keep the rest
    }
  }
  return { created };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeDistillKind(v: unknown): MemKind {
  return v === 'PREFERENCE' || v === 'GLOSSARY' ? v : 'FACT';
}
