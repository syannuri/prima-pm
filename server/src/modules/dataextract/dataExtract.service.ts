import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort } from '../../lib/ai.js';

// Stage A — extract structured project updates from free-text notes (meeting minutes, status
// reports). READ-ONLY: it returns a DRAFT only. The PM reviews the checklist and applies each item
// via the EXISTING write endpoints (PATCH task progress, POST issue) — so every write is audited and
// respects the user's permissions; the AI never writes.

// The model's raw extraction. progressUpdates reference tasks by WBS code (validated server-side);
// issues are new problems raised in the notes.
const ExtractionSchema = z.object({
  progressUpdates: z.array(z.object({
    taskWbsCode: z.string(),
    taskName: z.string(),
    newPct: z.number().int().min(0).max(100),
  })),
  issues: z.array(z.object({
    title: z.string(),
    description: z.string(),
    category: z.string(),
    impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  })),
});
type Extraction = z.infer<typeof ExtractionSchema>;

// What the route returns: progress updates RESOLVED to real task ids (+ current %), plus the issues.
export interface DataExtractDraft {
  progressUpdates: { taskId: string; taskWbsCode: string; taskName: string; currentPct: number; newPct: number }[];
  issues: Extraction['issues'];
}

const EXTRACT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    progressUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          taskWbsCode: { type: 'string' },
          taskName: { type: 'string' },
          newPct: { type: 'integer' },
        },
        required: ['taskWbsCode', 'taskName', 'newPct'],
        additionalProperties: false,
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          impact: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        },
        required: ['title', 'description', 'category', 'impact'],
        additionalProperties: false,
      },
    },
  },
  required: ['progressUpdates', 'issues'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'Anda adalah asisten PMO yang mengekstrak update terstruktur dari catatan proyek (notulen rapat, laporan status) menjadi data yang dapat ditindaklanjuti.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas.',
  '',
  'ATURAN (WAJIB):',
  '- Ekstrak HANYA yang DIDUKUNG oleh teks. Jangan mengarang angka, task, atau isu.',
  '- progressUpdates: hanya untuk task yang ADA pada daftar tasks (cocokkan berdasarkan taskWbsCode/nama). Jika teks menyebut kemajuan sebuah task, tentukan persentase baru (0-100). Jika task tidak ada di daftar, JANGAN membuatnya.',
  '- issues: masalah/hambatan BARU yang diangkat dalam catatan (bukan risiko potensial, melainkan isu yang sedang terjadi). impact: LOW/MEDIUM/HIGH/CRITICAL.',
  '- Jika tidak ada yang bisa diekstrak untuk sebuah bagian, kembalikan array kosong.',
].join('\n');

async function assertTenantOptedIn(projectId: string): Promise<void> {
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiNarrativeEnabled !== true) {
    throw Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
  }
}

// PURE: build the {system,user} pair from the notes + the task list (for grounding the mapping).
export function buildExtractPrompt(text: string, tasks: { wbsCode: string; name: string; progressPct: number }[]): { system: string; user: string } {
  const payload = {
    tasks: tasks.map((t) => ({ wbsCode: t.wbsCode, name: t.name, currentPct: t.progressPct })),
    notes: text,
  };
  return { system: SYSTEM_PROMPT, user: JSON.stringify(payload) };
}

// Extract a DRAFT from notes. Does NOT persist. Assumes the global env gate (aiEnabled) was already
// checked by the route (→ 503 when off).
export async function extractFromNotes(projectId: string, text: string): Promise<DataExtractDraft> {
  await assertTenantOptedIn(projectId);
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true, wbsCode: true, name: true, progressPct: true },
    orderBy: { wbsCode: 'asc' },
  });
  const { system, user } = buildExtractPrompt(text, tasks);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: EXTRACT_JSON_SCHEMA, maxTokens: 2500 });
  const parsed = raw == null ? null : ExtractionSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(502, 'AI tidak dapat mengekstrak data saat ini. Silakan masukkan manual.', 'AI_UNAVAILABLE');
  }
  // Security/grounding: keep only progress updates that map to a REAL task in this project.
  const byCode = new Map(tasks.map((t) => [t.wbsCode, t]));
  const progressUpdates = parsed.data.progressUpdates
    .map((u) => {
      const t = byCode.get(u.taskWbsCode);
      if (!t) return null;
      return { taskId: t.id, taskWbsCode: t.wbsCode, taskName: t.name, currentPct: t.progressPct, newPct: u.newPct };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return { progressUpdates, issues: parsed.data.issues };
}
