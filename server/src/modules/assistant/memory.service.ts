import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { AppError, Forbidden } from '../../lib/errors.js';
import type { AssistantLang } from './assistant.service.js';

// Cross-session AI memory for Anett — durable facts/preferences injected into its prompt so it
// "remembers" across sessions. Dormant unless the caller's tenant opted in (Tenant.aiMemoryEnabled).
// See docs/AI-MEMORY-FEEDBACK-PLAN.md. Everything here is deterministic (no LLM cost).

export const MAX_MEMORY_CHARS = 280;      // one crisp sentence per memory
const PROMPT_MAX_ITEMS = 20;              // cap the injected set …
const PROMPT_MAX_CHARS = 1800;            // … and the injected characters, so token cost stays bounded

export type MemScope = 'USER' | 'TENANT';
export type MemKind = 'PREFERENCE' | 'FACT' | 'GLOSSARY' | 'GUIDANCE';
export type MemSource = 'EXPLICIT' | 'FEEDBACK' | 'AUTO';

// Org-wide (TENANT) writes are governance: admin/PMO only. GUEST governs their own personal sandbox
// tenant, so they may write tenant-scope there too.
export function canWriteTenantScope(role: Role): boolean {
  return role === 'ADMIN' || role === 'PMO' || role === 'GUEST';
}

// The memories a caller can see: every active TENANT memory in their tenant + their own active USER
// memories. (Tenant scoping to the caller's tenant is enforced by the Prisma tenant extension.)
function visibleWhere(userId: string) {
  return { active: true, OR: [{ scope: 'TENANT' as const }, { scope: 'USER' as const, userId }] };
}

// Per-tenant opt-in gate. No tenant (single-tenant deploy) → governed by the global env gate alone.
export async function callerMemoryEnabled(): Promise<boolean> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true;
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiMemoryEnabled: true } });
  return tenant?.aiMemoryEnabled === true;
}

export interface MemoryRow {
  id: string; scope: MemScope; kind: MemKind; content: string; source: MemSource;
  pinned: boolean; userId: string | null; createdByName: string | null; createdAt: Date; updatedAt: Date;
}

const toRow = (m: {
  id: string; scope: MemScope; kind: MemKind; content: string; source: MemSource;
  pinned: boolean; userId: string | null; createdByName: string | null; createdAt: Date; updatedAt: Date;
}): MemoryRow => ({ ...m });

// Full caller-visible list for the Settings CRUD surface (pinned first, newest next).
export async function listMemories(userId: string): Promise<MemoryRow[]> {
  const rows = await prisma.aiMemory.findMany({
    where: visibleWhere(userId),
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });
  return rows.map(toRow);
}

// The bounded set injected into the system prompt. Empty when the tenant hasn't opted in.
export async function loadMemoriesForPrompt(userId: string): Promise<{ scope: MemScope; kind: MemKind; content: string }[]> {
  if (!(await callerMemoryEnabled())) return [];
  const rows = await prisma.aiMemory.findMany({
    where: visibleWhere(userId),
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: PROMPT_MAX_ITEMS,
  });
  const out: { scope: MemScope; kind: MemKind; content: string }[] = [];
  let chars = 0;
  for (const r of rows) {
    chars += r.content.length;
    if (chars > PROMPT_MAX_CHARS) break;
    out.push({ scope: r.scope, kind: r.kind, content: r.content });
  }
  return out;
}

// Render the memory block appended to the system prompt. GUIDANCE (feedback corrections) is framed
// more strongly than plain facts so the model treats it as a rule.
export function buildMemoryBlock(mem: { kind: MemKind; content: string }[], lang: AssistantLang): string {
  if (!mem.length) return '';
  const en = lang === 'en';
  const guidance = mem.filter((m) => m.kind === 'GUIDANCE');
  const facts = mem.filter((m) => m.kind !== 'GUIDANCE');
  let s = '';
  if (facts.length) {
    s += en
      ? '\n\nWhat you remember about this user/organization (honor it; do not contradict it unless the user updates it):\n'
      : '\n\nYang Anda ingat tentang pengguna/organisasi ini (hormati; jangan bertentangan kecuali pengguna memperbaruinya):\n';
    s += facts.map((m) => `- ${m.content}`).join('\n');
  }
  if (guidance.length) {
    s += en
      ? '\n\nCorrections from earlier feedback — comply with these:\n'
      : '\n\nKoreksi dari feedback sebelumnya — patuhi:\n';
    s += guidance.map((m) => `- ${m.content}`).join('\n');
  }
  return s;
}

const KIND_IN: Record<string, MemKind> = { preference: 'PREFERENCE', fact: 'FACT', glossary: 'GLOSSARY', guidance: 'GUIDANCE' };

// Store a memory. USER scope → owned by the caller; TENANT scope → org-shared (governance-gated).
export async function addMemory(
  input: { content: string; scope: MemScope; kind?: MemKind; source?: MemSource; sourceRef?: string | null },
  caller: { userId: string; role: Role; name?: string | null },
): Promise<{ id: string; scope: MemScope; kind: MemKind; content: string }> {
  const content = input.content.trim();
  if (content.length < 3) throw new AppError(400, 'Isi memori terlalu pendek.', 'MEMORY_INVALID');
  if (content.length > MAX_MEMORY_CHARS) throw new AppError(400, `Memori maksimal ${MAX_MEMORY_CHARS} karakter.`, 'MEMORY_TOO_LONG');
  if (input.scope === 'TENANT' && !canWriteTenantScope(caller.role)) {
    throw Forbidden('Hanya admin/PMO yang dapat menyimpan memori tingkat organisasi.');
  }
  const created = await prisma.aiMemory.create({
    data: {
      scope: input.scope,
      userId: input.scope === 'USER' ? caller.userId : null,
      kind: input.kind ?? 'FACT',
      content,
      source: input.source ?? 'EXPLICIT',
      sourceRef: input.sourceRef ?? null,
      createdById: caller.userId,
      createdByName: caller.name ?? null,
    },
    select: { id: true, scope: true, kind: true, content: true },
  });
  return created as { id: string; scope: MemScope; kind: MemKind; content: string };
}

// Convert a client-supplied kind string ("fact" | "preference" | …) to the enum, defaulting to FACT.
export function normalizeKind(v: unknown): MemKind {
  return (typeof v === 'string' && KIND_IN[v.toLowerCase()]) || 'FACT';
}

// Turn a 👎 feedback note into a durable GUIDANCE memory Anett will honor. Scope depends on the
// rater: org-writers (admin/PMO/guest) shape TENANT-wide guidance; everyone else shapes only their
// own (USER) future answers. No-op (returns null) when memory is off or the note is too short.
export async function addFeedbackGuidance(
  note: string,
  caller: { userId: string; role: Role; name?: string | null },
  sourceRef: string,
): Promise<{ id: string; scope: MemScope } | null> {
  if (!(await callerMemoryEnabled())) return null;
  const content = note.trim().slice(0, MAX_MEMORY_CHARS);
  if (content.length < 3) return null;
  const scope: MemScope = canWriteTenantScope(caller.role) ? 'TENANT' : 'USER';
  const m = await addMemory({ content, scope, kind: 'GUIDANCE', source: 'FEEDBACK', sourceRef }, caller);
  return { id: m.id, scope: m.scope };
}

// Forget (soft-delete) a memory the caller may manage, matched by a text fragment. 0 or >1 matches →
// no delete (the caller/model is asked to be more specific), so we never guess-delete the wrong one.
export async function forgetMemory(
  query: string,
  caller: { userId: string; role: Role },
): Promise<{ status: 'forgotten' | 'none' | 'ambiguous'; content?: string; candidates?: string[] }> {
  const q = query.trim().toLowerCase();
  if (!q) return { status: 'none' };
  const rows = await prisma.aiMemory.findMany({ where: visibleWhere(caller.userId), take: 200 });
  const deletable = rows.filter(
    (r) => (r.scope === 'USER' && r.userId === caller.userId) || (r.scope === 'TENANT' && canWriteTenantScope(caller.role)),
  );
  const matches = deletable.filter((r) => r.content.toLowerCase().includes(q));
  if (matches.length === 0) return { status: 'none' };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.slice(0, 5).map((m) => m.content) };
  await prisma.aiMemory.update({ where: { id: matches[0].id }, data: { active: false } });
  return { status: 'forgotten', content: matches[0].content };
}

// Load a memory the caller is allowed to manage (for pin/edit/delete). USER → owner only; TENANT →
// governance-gated. Returns null when not found / not manageable.
async function loadManageable(id: string, caller: { userId: string; role: Role }) {
  const m = await prisma.aiMemory.findFirst({ where: { id }, select: { id: true, scope: true, userId: true } });
  if (!m) return null;
  const ok = (m.scope === 'USER' && m.userId === caller.userId) || (m.scope === 'TENANT' && canWriteTenantScope(caller.role));
  return ok ? m : null;
}

export async function updateMemory(
  id: string,
  patch: { content?: string; pinned?: boolean },
  caller: { userId: string; role: Role },
): Promise<MemoryRow> {
  const m = await loadManageable(id, caller);
  if (!m) throw Forbidden('Memori tidak ditemukan atau tidak dapat Anda ubah.');
  const data: { content?: string; pinned?: boolean } = {};
  if (patch.content !== undefined) {
    const c = patch.content.trim();
    if (c.length < 3) throw new AppError(400, 'Isi memori terlalu pendek.', 'MEMORY_INVALID');
    if (c.length > MAX_MEMORY_CHARS) throw new AppError(400, `Memori maksimal ${MAX_MEMORY_CHARS} karakter.`, 'MEMORY_TOO_LONG');
    data.content = c;
  }
  if (patch.pinned !== undefined) data.pinned = patch.pinned;
  const updated = await prisma.aiMemory.update({ where: { id }, data });
  return toRow(updated as Parameters<typeof toRow>[0]);
}

// Soft-delete (forget) by id from the Settings surface.
export async function deleteMemory(id: string, caller: { userId: string; role: Role }): Promise<void> {
  const m = await loadManageable(id, caller);
  if (!m) throw Forbidden('Memori tidak ditemukan atau tidak dapat Anda hapus.');
  await prisma.aiMemory.update({ where: { id }, data: { active: false } });
}
