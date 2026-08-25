import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiEnabled } from '../../lib/ai.js';
import { askAssistant, assistantAvailable, assistantActionsAvailable, type AssistantTurn } from './assistant.service.js';

const router = Router();
router.use(requireAuth);

// Availability probe: `aiAvailable` = launcher on (env + narrative opt-in); `actionsAvailable` = Stage C
// propose enabled (env + the separate aiActionsEnabled opt-in) → drives Anett's capability-aware UI.
router.get('/available', asyncHandler(async (_req, res) => {
  const [aiAvailable, actionsAvailable] = await Promise.all([assistantAvailable(), assistantActionsAvailable()]);
  res.json({ aiAvailable, actionsAvailable });
}));

// Recent conversation (last turns + the new question). Bounded to keep token cost + payload sane.
const askSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).min(1).max(20),
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
    // { answer, proposals } — proposals are any Stage C actions Anett staged this turn (for the card).
    res.json(await askAssistant(req.user!.id, req.user!.role, messages));
  }),
);

export default router;
