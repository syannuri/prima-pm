import { Router, raw } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiEnabled } from '../../lib/ai.js';
import { AppError } from '../../lib/errors.js';
import { transcribeAudio, synthesizeSpeech, voiceServerAvailable, MAX_STT_BYTES } from './voice.service.js';
import { askAssistant, assistantAvailable, assistantActionsAvailable, assistantBriefing, type AssistantTurn } from './assistant.service.js';
import { listMemories, addMemory, updateMemory, deleteMemory, normalizeKind, type MemScope } from './memory.service.js';
import { recordFeedback, listFeedbackInbox } from './feedback.service.js';
import { distillConversation, autoDistillEnabled } from './memoryDistill.service.js';

const router = Router();
router.use(requireAuth);

// Availability probe: `aiAvailable` = launcher on (env + narrative opt-in); `actionsAvailable` = Stage C
// propose enabled (env + the separate aiActionsEnabled opt-in) → drives Anett's capability-aware UI.
router.get('/available', asyncHandler(async (_req, res) => {
  const [aiAvailable, actionsAvailable, voiceServer] = await Promise.all([assistantAvailable(), assistantActionsAvailable(), voiceServerAvailable()]);
  // autoDistill hints the client to POST the transcript at session end (server still enforces the gate).
  res.json({ aiAvailable, actionsAvailable, voiceServer, autoDistill: autoDistillEnabled() });
}));

// ── Server-side voice (Whisper STT + ElevenLabs TTS) — dormant unless keys set + tenant opt-in ──────
const langOf = (v: unknown): 'id' | 'en' => (v === 'en' ? 'en' : 'id');

// Speech→text: raw audio body (audio/*) → transcript. Route-level raw parser (global express.json
// ignores non-JSON, so it doesn't consume the audio body).
router.post('/stt', raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_STT_BYTES }), asyncHandler(async (req, res) => {
  const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const text = await transcribeAudio(audio, req.headers['content-type'] || 'audio/webm', langOf(req.query.lang));
  res.json({ text });
}));

// Text→speech: JSON { text, lang } → audio/mpeg bytes.
router.post('/tts', validateBody(z.object({ text: z.string().min(1).max(4000), lang: z.enum(['id', 'en']).optional() })), asyncHandler(async (req, res) => {
  const { audio, contentType } = await synthesizeSpeech(req.body.text, langOf(req.body.lang));
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(audio);
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

// Streaming variant of /ask — Server-Sent Events. Emits live "thinking" steps (the real tool-loop
// activity, e.g. "Menganalisis EVM PRJ-7…") then a final `answer` event, so the client can show
// Anett's reasoning process in real time. The client falls back to /ask if streaming is unavailable.
router.post('/ask/stream', validateBody(askSchema), asyncHandler(async (req, res) => {
  if (!aiEnabled()) {
    res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
    return;
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
  });
  res.flushHeaders();
  const send = (obj: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  let aborted = false;
  req.on('close', () => { aborted = true; });
  try {
    const messages = req.body.messages as AssistantTurn[];
    const result = await askAssistant(
      req.user!.id, req.user!.role, messages, req.body.context, req.body.lang ?? 'id',
      (label) => send({ type: 'step', label }),
      {
        // Forward each answer-text delta live; `reset` discards preamble streamed before a tool call;
        // `reasoning` carries Anett's thinking-summary deltas (#D).
        onText: (delta) => { if (!aborted) send({ type: 'token', delta }); },
        onTextReset: () => { if (!aborted) send({ type: 'reset' }); },
        onThinking: (delta) => { if (!aborted) send({ type: 'reasoning', delta }); },
      },
    );
    if (!aborted) send({ type: 'answer', ...result });
  } catch (e) {
    send({ type: 'error', message: e instanceof AppError ? e.message : 'AI tidak dapat menjawab saat ini.' });
  }
  if (!res.writableEnded) { send({ type: 'done' }); res.end(); }
}));

// ── Feedback on an answer (👍/👎) ─────────────────────────────────────────────────────────────────
const feedbackSchema = z.object({
  rating: z.enum(['UP', 'DOWN']),
  answer: z.string().min(1).max(4000),
  question: z.string().max(2000).nullish(),
  note: z.string().max(2000).nullish(),
  projectId: z.string().uuid().nullish(),
});
// Any authenticated user may rate an answer. A 👎 with a note becomes a GUIDANCE memory (when the
// tenant opted into memory) that later prompts honor — the deterministic learning loop.
router.post('/feedback', validateBody(feedbackSchema), asyncHandler(async (req, res) => {
  const out = await recordFeedback(
    { userId: req.user!.id, role: req.user!.role, name: req.user!.email ?? null },
    { rating: req.body.rating, answer: req.body.answer, question: req.body.question ?? null, note: req.body.note ?? null, projectId: req.body.projectId ?? null },
  );
  res.status(201).json(out);
}));

// Admin feedback inbox (Fase 4): review how Anett is being rated + which 👎 became guidance.
router.get('/feedback/inbox', asyncHandler(async (req, res) => {
  const rating = req.query.rating === 'UP' || req.query.rating === 'DOWN' ? req.query.rating : undefined;
  const rows = await listFeedbackInbox({ role: req.user!.role }, { rating });
  res.json({ feedback: rows });
}));

// ── Cross-session memory (Settings surface) ───────────────────────────────────────────────────────
// List the memories the caller can see (own USER + all TENANT). Any authenticated user.
router.get('/memory', asyncHandler(async (req, res) => {
  res.json({ memories: await listMemories(req.user!.id) });
}));

// Auto-distill a session transcript into durable memories (Fase 4). Dormant unless
// AI_MEMORY_AUTODISTILL is set + the tenant opted into memory; the client calls this at session end.
const distillSchema = z.object({
  turns: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).min(1).max(60),
});
router.post('/memory/distill', validateBody(distillSchema), asyncHandler(async (req, res) => {
  const out = await distillConversation(req.body.turns, { userId: req.user!.id, role: req.user!.role, name: req.user!.email ?? null });
  res.status(201).json(out);
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
