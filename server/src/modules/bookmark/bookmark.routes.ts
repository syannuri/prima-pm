import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import * as svc from './bookmark.service.js';

// Personal project bookmarks for the signed-in user. Adding one requires that the user can
// actually SEE the project (so a guest can't pin/ probe corporate projects and vice versa);
// removing is unguarded so a stale pin can always be cleared. Mounted at /api/v1/bookmarks.
const router = Router();
router.use(requireAuth);

// List the current user's bookmarked project ids.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ projectIds: await svc.listBookmarks(req.user!.id) });
  }),
);

// Add / remove a bookmark (idempotent).
router.put(
  '/:projectId',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    await svc.addBookmark(req.user!.id, req.params.projectId);
    res.status(204).send();
  }),
);

router.delete(
  '/:projectId',
  asyncHandler(async (req, res) => {
    await svc.removeBookmark(req.user!.id, req.params.projectId);
    res.status(204).send();
  }),
);

export default router;
