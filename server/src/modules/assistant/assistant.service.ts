import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled, getAiPort, type AiToolDef } from '../../lib/ai.js';
import { listProjects } from '../projects/projects.service.js';
import { getProjectReport } from '../report/report.service.js';
import { listRisks } from '../risk/risk.service.js';
import { proposeAction, AI_ACTION_TYPES } from '../aiActions/aiActions.service.js';
import { findGuide, guideIndex } from './processGuide.js';

// Cross-project (portfolio) Q&A assistant (Phase 4). READ-ONLY: it answers questions about the
// projects the CALLER can access, via a server-side manual tool loop. The API key and all data
// access stay on the server; the model never touches the DB. Security boundary: every tool operates
// ONLY on the pre-computed set of projects the user is allowed to see (same rule as listProjects) —
// a project outside that set is unknown to the assistant, so it cannot leak inaccessible data.

const SYSTEM_PROMPT = [
  'Anda adalah "Anett", PM Assistant untuk aplikasi manajemen proyek Prismatix. Anda menjawab pertanyaan pengguna tentang proyek-proyek yang DAPAT DIAKSES olehnya.',
  'Jika pengguna menyapa atau menanyakan nama Anda, perkenalkan diri sebagai Anett secara singkat dan ramah. Jangan menyebut nama diri di setiap jawaban.',
  'Jawab dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas.',
  '',
  'ATURAN (WAJIB):',
  '- Gunakan tool untuk mengambil data sebelum menjawab hal yang butuh angka. Jangan mengarang angka, tanggal, atau nama.',
  '- Anda HANYA dapat melihat proyek yang dikembalikan oleh tool. Jika pengguna menyebut proyek yang tidak ada di daftar, katakan Anda tidak menemukannya atau tidak punya akses.',
  '- Interpretasikan EVM dengan benar: SPI/CPI < 1 = di belakang jadwal / over budget; > 1 = baik.',
  '- Anda bersifat READ-ONLY: Anda tidak dapat mengubah data. Jika diminta melakukan aksi, jelaskan langkahnya secara ringkas namun jangan mengklaim sudah melakukannya.',
  '- Jika data tidak cukup untuk menjawab, katakan dengan jujur.',
  '- Jawab ringkas dan langsung; sertakan angka kunci bila relevan.',
  '- Untuk pertanyaan CARA/PROSES ("bagaimana cara…", "apa yang harus saya lakukan untuk…", "di mana menu…"), GUNAKAN tool get_process_guide lalu sampaikan langkah ringkas + JALUR MENU persis (mis. Proyek → tab Cost → Baseline → Lock). JANGAN mengarang nama menu/tab; jika topik tak ada di panduan, katakan dan sarankan yang terdekat.',
  '',
  'FORMAT JAWABAN (Markdown):',
  '- Bila menyebut beberapa hal (daftar proyek, risiko, langkah), gunakan bullet point ("- ") satu item per baris — jangan menumpuk dalam satu paragraf panjang.',
  '- Tulis kode/konteks proyek dalam inline code backtick, mis. `AI-1`, `CPI`, `SPI`, agar mudah dibaca.',
  '- Gunakan **tebal** untuk menyorot angka/kesimpulan penting. Jaga tetap ringkas.',
].join('\n');

// Tool schemas (raw JSON schema — the SDK zod helper targets a different zod major than the app).
const TOOLS: AiToolDef[] = [
  {
    name: 'list_projects',
    description: 'Daftar proyek yang dapat diakses pengguna (kode, nama, status, PM). Panggil ini dulu untuk mengetahui proyek apa saja yang tersedia.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_project_details',
    description: 'Ringkasan kesehatan sebuah proyek: EVM (BAC/EV/AC/SPI/CPI/% selesai), forecast (EAC, perkiraan selesai, varians hari), dan tugas (total/selesai/overdue). Argumen: project_code dari list_projects.',
    input_schema: {
      type: 'object',
      properties: { project_code: { type: 'string', description: 'Kode proyek, mis. "AI-1"' } },
      required: ['project_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_project_risks',
    description: 'Daftar risiko sebuah proyek (kode, judul, jenis, severity, status, skor, EMV). Argumen: project_code dari list_projects.',
    input_schema: {
      type: 'object',
      properties: { project_code: { type: 'string' } },
      required: ['project_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_process_guide',
    description: 'Panduan CARA memakai aplikasi ini: langkah + jalur menu yang benar untuk sebuah tugas (mis. "cara membuat baseline biaya & jadwal", "cara membuat change request", "cara menutup proyek"). Argumen: topic = frasa bebas tentang yang ingin dilakukan pengguna.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Apa yang ingin dilakukan pengguna, mis. "lock baseline" / "buat CR"' } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
];

// Stage C — the ONE write-adjacent tool. It does NOT change data: it stages an AI-proposed action
// into the approval engine, and the action runs only after a human approves. Added to the loop only
// when the caller's tenant has opted into AI actions (aiActionsEnabled). Params vary per action_type
// and are validated server-side; a bad shape returns an error the model can relay.
const PROPOSE_ACTION_TOOL: AiToolDef = {
  name: 'propose_action',
  description: [
    'USULKAN sebuah aksi untuk proyek — TIDAK langsung dijalankan; harus disetujui manusia lewat approval dulu.',
    'Gunakan hanya bila pengguna secara eksplisit meminta melakukan/mengusulkan perubahan. Selalu konfirmasi ke pengguna sebelum memanggil.',
    'action_type & bentuk params:',
    '- CREATE_RISK: { title (>=3 char), probabilityScore 1-5, impactScore 1-5, kind "THREAT"|"OPPORTUNITY"?, description? }',
    '- CREATE_CHANGE_REQUEST: { title, description (>=5 char), impactAreas: ["SCOPE"?...] salah satu dari CHARTER/COST/SCHEDULE/RESOURCE/QUALITY/RISK, magnitude "MINOR"|"MAJOR"?, chargeable? , amountIdr? }',
    '- TIDY_SCHEDULE: { mode "push"|"asap"? } — rapikan jadwal mengikuti dependensi.',
    'project_code dari list_projects. rationale = alasan singkat mengapa aksi ini diusulkan.',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      project_code: { type: 'string' },
      action_type: { type: 'string', enum: [...AI_ACTION_TYPES] },
      params: { type: 'object', description: 'Parameter aksi sesuai action_type (lihat deskripsi tool).' },
      rationale: { type: 'string', description: 'Alasan singkat aksi diusulkan.' },
    },
    required: ['project_code', 'action_type', 'params'],
    additionalProperties: false,
  },
};

// Per-tenant opt-in for the CALLER's tenant (no single project here). Applies only when a tenant
// exists (single-tenant deploy with no tenant → env gate alone governs).
async function assertCallerTenantOptedIn(): Promise<void> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  if (tenant?.aiNarrativeEnabled !== true) {
    throw Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
  }
}

// Whether the CALLER's tenant has opted into AI actions (Stage C) — a SEPARATE, stronger opt-in than
// the narrative gate above. Governs whether Anett is given the propose_action tool at all.
async function callerActionsEnabled(): Promise<boolean> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true; // single-tenant deploy: env gate alone governs
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiActionsEnabled: true } });
  return tenant?.aiActionsEnabled === true;
}

// Whether the assistant is usable for the caller right now: global env gate + the caller tenant's
// opt-in. Drives the client's show/hide of the AI assistant launcher.
export async function assistantAvailable(): Promise<boolean> {
  if (!aiEnabled()) return false;
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true; // single-tenant deploy: env gate alone governs
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  return tenant?.aiNarrativeEnabled === true;
}

// Whether Anett may PROPOSE actions for the caller (Stage C) — env + the caller tenant's separate
// aiActionsEnabled opt-in. Drives the client's capability-aware footer + the action suggestion chip.
export async function assistantActionsAvailable(): Promise<boolean> {
  if (!aiEnabled()) return false;
  return callerActionsEnabled();
}

// A proposal Anett staged during a turn (surfaced to the client so it can show a "view in Approvals"
// card). Kept minimal — the full detail lives in the approvals inbox.
export interface ProposedRef { actionType: string; projectCode: string; routed: boolean }

// A grounded in-app navigation target the process guide surfaced (id-less top-level route only) — the
// client renders it as a real router-Link button so "buka Reports" actually navigates.
export interface NavRef { label: string; path: string }

function compactReport(r: Awaited<ReturnType<typeof getProjectReport>>) {
  const overdue = r.tasks.remaining.filter((t) => t.overdue).slice(0, 15)
    .map((t) => ({ name: t.name, pct: t.pct, due: t.planEnd }));
  return {
    project: { code: r.project.code, name: r.project.name, status: r.project.status },
    health: r.health,
    evm: { bac: r.evm.bac, pv: r.evm.pv, ev: r.evm.ev, ac: r.evm.ac, spi: r.evm.spi, cpi: r.evm.cpi, percentComplete: r.evm.percentComplete },
    forecast: { eac: r.forecast.eac, forecastFinish: r.forecast.schedule.forecastFinish, varianceDays: r.forecast.schedule.varianceDays },
    tasks: { total: r.tasks.total, completed: r.tasks.completed, inProgress: r.tasks.inProgress, overdueCount: overdue.length, overdue },
  };
}

// Build the executeTool callback bound to the caller's accessible project set. Returns a JSON string
// per tool call. Unknown/inaccessible project_code → a friendly error object (not an exception), so
// the model can tell the user rather than crash the loop.
function makeExecuteTool(accessibleByCode: Map<string, string>, ctx: { userId: string; role: Role; proposals: ProposedRef[]; navs: NavRef[] }) {
  return async (name: string, input: unknown): Promise<string> => {
    const args = (input ?? {}) as { project_code?: string; action_type?: string; params?: unknown; rationale?: string; topic?: string };
    const resolveId = (): string | null => {
      const code = typeof args.project_code === 'string' ? args.project_code.trim() : '';
      return accessibleByCode.get(code) ?? null;
    };
    switch (name) {
      case 'list_projects': {
        const list = [...accessibleByCode.keys()];
        return JSON.stringify({ count: list.length, projectCodes: list });
      }
      case 'get_project_details': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        const report = await getProjectReport(id, 'monthly', new Date());
        return JSON.stringify(compactReport(report));
      }
      case 'list_project_risks': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        const risks = await listRisks(id);
        return JSON.stringify(risks.map((r) => ({
          code: r.code, title: r.title, kind: r.kind, severity: r.severity, status: r.status,
          riskScore: r.riskScore, emv: Number(r.emv),
        })));
      }
      case 'get_process_guide': {
        const entry = findGuide(typeof args.topic === 'string' ? args.topic : '');
        if (!entry) return JSON.stringify({ error: 'Topik tidak ada di panduan.', availableTopics: guideIndex() });
        // Surface an id-less top-level route as a clickable nav button (dedupe by path).
        if (entry.route && !ctx.navs.some((n) => n.path === entry.route!.path)) ctx.navs.push({ label: entry.route.label, path: entry.route.path });
        return JSON.stringify({
          title: entry.title,
          summary: entry.summary,
          prerequisites: entry.prerequisites ?? [],
          steps: entry.steps,
          menuPath: entry.menuPath,
          route: entry.route ?? null,
        });
      }
      case 'propose_action': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        // Write gate mirrors requireProjectAccess({write:true}): VIEWER never writes; a CLOSED
        // project is frozen. Access is already bounded by the accessible set.
        if (ctx.role === 'VIEWER') return JSON.stringify({ error: 'Peran read-only tidak dapat mengusulkan perubahan.' });
        const proj = await prisma.project.findUnique({ where: { id }, select: { status: true } });
        if (proj?.status === 'CLOSED') return JSON.stringify({ error: 'Proyek sudah ditutup (read-only). Buka kembali untuk mengubah.' });
        const actionType = typeof args.action_type === 'string' ? args.action_type : '';
        if (!AI_ACTION_TYPES.includes(actionType as (typeof AI_ACTION_TYPES)[number])) {
          return JSON.stringify({ error: `action_type tidak dikenal. Pilih salah satu: ${AI_ACTION_TYPES.join(', ')}.` });
        }
        try {
          const { routed } = await proposeAction({ projectId: id, actionType, params: args.params, rationale: args.rationale ?? null }, ctx.userId);
          ctx.proposals.push({ actionType, projectCode: (typeof args.project_code === 'string' ? args.project_code.trim() : ''), routed });
          return JSON.stringify({ ok: true, routed, message: routed
            ? 'Usulan aksi telah diajukan untuk approval. Aksi hanya berjalan setelah disetujui.'
            : 'Usulan tersimpan namun belum ada approver yang bisa dituju — minta admin mengatur workflow AI action.' });
        } catch (err) {
          const msg = err instanceof AppError ? err.message : 'Gagal mengajukan usulan aksi.';
          return JSON.stringify({ error: msg });
        }
      }
      default:
        return JSON.stringify({ error: `Tool tidak dikenal: ${name}` });
    }
  };
}

// A single conversation turn from the client (text only).
export interface AssistantTurn { role: 'user' | 'assistant'; content: string }

// Answer a portfolio question. Assumes the global env gate (aiEnabled) was already checked by the
// route (→ 503 when off). `messages` is the recent conversation (last turns + the new question).
export async function askAssistant(userId: string, role: Role, messages: AssistantTurn[]): Promise<{ answer: string; proposals: ProposedRef[]; navigate: NavRef[] }> {
  await assertCallerTenantOptedIn();
  const port = getAiPort();
  if (!port.runToolLoop) throw new AppError(502, 'Asisten AI tidak tersedia.', 'AI_UNAVAILABLE');

  // Pre-compute the accessible project set (same rule the user sees elsewhere) → the security scope.
  const projects = await listProjects(userId, role);
  const byCode = new Map<string, string>();
  for (const p of projects.slice(0, 200)) byCode.set(p.code, p.id);

  // Stage C — only expose the propose_action tool when the caller's tenant opted in AND the caller
  // is not a read-only role (Anett can then STAGE actions for approval, never execute them).
  const actionsEnabled = role !== 'VIEWER' && (await callerActionsEnabled());
  const tools = actionsEnabled ? [...TOOLS, PROPOSE_ACTION_TOOL] : TOOLS;
  const actionNote = actionsEnabled
    ? '\n\nAnda DAPAT mengusulkan aksi (bukan mengeksekusi) via tool propose_action; aksi hanya berjalan setelah disetujui manusia. Konfirmasikan ke pengguna sebelum mengajukan.'
    : '';

  // Proposals + navigation targets Anett surfaces during this turn are collected here for the client.
  const proposals: ProposedRef[] = [];
  const navs: NavRef[] = [];
  // Seed the loop with a short, project-list-aware system prompt + the how-to topic index.
  const system = `${SYSTEM_PROMPT}${actionNote}\n\nProyek yang dapat diakses pengguna (kode): ${[...byCode.keys()].join(', ') || '(tidak ada)'}.\n\nTopik panduan cara-pakai (get_process_guide): ${guideIndex()}.`;
  const answer = await port.runToolLoop({
    system,
    messages,
    tools,
    executeTool: makeExecuteTool(byCode, { userId, role, proposals, navs }),
    maxSteps: 6,
    maxTokens: 1500,
  });
  if (!answer) throw new AppError(502, 'AI tidak dapat menjawab saat ini. Silakan coba lagi.', 'AI_UNAVAILABLE');
  return { answer, proposals, navigate: navs };
}
