import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { Forbidden } from '../../lib/errors.js';
import { getOrCreateFeedToken, rotateFeedToken, buildFeedForToken } from './calendar.service.js';

// Personal iCal calendar feed (T4.2).
const router = Router();

function feedUrl(req: Request, token: string): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] || req.protocol;
  return `${proto}://${req.get('host')}/api/v1/calendar/${token}/feed.ics`;
}

// PUBLIC: the .ics feed itself — the token is the credential (calendar apps poll it unauthenticated).
// Registered before requireAuth so it stays open. Two path segments, so it never collides with /feed.
router.get('/:token/feed.ics', asyncHandler(async (req, res) => {
  const ics = await buildFeedForToken(req.params.token);
  if (ics == null) { res.status(404).send('Not found'); return; }
  res.type('text/calendar; charset=utf-8').send(ics);
}));

// Everything below requires a real session (not an API key — a key principal has no calendar).
router.use(requireAuth, (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.isApiKey) return next(Forbidden('API keys have no calendar feed'));
  next();
});

router.get('/feed', asyncHandler(async (req, res) => {
  const token = await getOrCreateFeedToken(req.user!.id);
  res.json({ url: feedUrl(req, token) });
}));

router.post('/feed/rotate', asyncHandler(async (req, res) => {
  const token = await rotateFeedToken(req.user!.id);
  res.json({ url: feedUrl(req, token) });
}));

export default router;
