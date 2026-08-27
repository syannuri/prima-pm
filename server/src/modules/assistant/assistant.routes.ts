import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiEnabled } from '../../lib/ai.js';
import { askAssistant, assistantAvailable, assistantActionsAvailable, assistantBriefing, type AssistantTurn } from './assistant.service.js';
import { listMemories, addMemory, updateMemory, deleteMemory, normalizeKind, type MemScope } from './memory.service.js';

const router = Router();
router.use(requireAuth);

// Availability probe: `aiAvailable` = launcher on (env + narrative opt-in); `actionsAvailable` = Stage C
// propose enabled (env + the separate aiActionsEnabled opt-in) → drives Anett's capability-aware UI.
router.get('/available', asyncHandler(async (_req, res) => {
  const [aiAvailable, actionsAvailable] = await Promise.all([assistantAvailable(), assistantActionsAvailable()]);
  res.json({ aiAvailable, actionsAvailable });
}));

// Proactive open-state briefing (deterministic, NO LLM cost): what needs the caller's attention now.
router.get('/briefing', asyncHandler(async (req, res) => {
  res.json(await assistantBriefing(req.user!.id, req.user!.role));
}));

// Recent conversation (last turns + the new question) + optional current-view context. Bounded to
// keep token cost + payload sane.
const askSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).min(1).max(20),
  context: z.object({
    projectId: z.string().uuid().nullish(),
    tab: z.string().max(40).nullish(),
  }).optional(),
  // Reply language — follows the caller's UI toggle. Defaults to Indonesian.
  lang: z.enum(['id', 'en']).optional(),
});

// Portfolio Q&A assistant (read-only, ephemeral). Any authenticated user; the service scopes every
// tool to the projects the caller can access. Gated globally by ANTHROPIC_API_KEY (503) + per-tenant
// opt-in (403 in the service). requireAuth already applies the per-tenant request rate limit.
router.post(
  '/ask',
  validateBody(askSchema),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    const messages = req.body.messages as AssistantTurn[];
    // { answer, proposals, navigate } — proposals = Stage C actions staged this turn; navigate = how-to
    // nav targets. `context` lets "proyek ini" resolve to the project the user is viewing.
    res.json(await askAssistant(req.user!.id, req.user!.role, messages, req.body.context, req.body.lang ?? 'id'));
  }),
);

// ── Cross-session memory (Settings surface) ───────────────────────────────────────────────────────
// List the memories the caller can see (own USER + all TENANT). Any authenticated user.
router.get('/memory', asyncHandler(async (req, res) => {
  res.json({ memories: await listMemories(req.user!.id) });
}));

const memoryCreateSchema = z.object({
  content: z.string().min(3).max(280),
  scope: z.enum(['USER', 'TENANT']),
  kind: z.enum(['PREFERENCE', 'FACT', 'GLOSSARY']).optional(),
});
// Add a memory. TENANT scope is governance-gated (ADMIN/PMO/GUEST) inside the service.
router.post('/memory', validateBody(memoryCreateSchema), asyncHandler(async (req, res) => {
  const m = await addMemory(
    { content: req.body.content, scope: req.body.scope as MemScope, kind: normalizeKind(req.body.kind), source: 'EXPLICIT' },
    { userId: req.user!.id, role: req.user!.role, name: req.user!.email ?? null },
  );
  res.status(201).json(m);
}));

const memoryPatchSchema = z.object({
  content: z.string().min(3).max(280).optional(),
  pinned: z.boolean().optional(),
}).refine((b) => b.content !== undefined || b.pinned !== undefined, { message: 'Tidak ada perubahan.' });
// Edit / pin a memory the caller manages.
router.patch('/memory/:id', validateBody(memoryPatchSchema), asyncHandler(async (req, res) => {
  res.json(await updateMemory(req.params.id, req.body, { userId: req.user!.id, role: req.user!.role }));
}));

// Forget (soft-delete) a memory the caller manages.
router.delete('/memory/:id', asyncHandler(async (req, res) => {
  await deleteMemory(req.params.id, { userId: req.user!.id, role: req.user!.role });
  res.status(204).end();
}));

export default router;
