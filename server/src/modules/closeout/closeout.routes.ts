import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertLessonSchema, upsertAcceptanceSchema } from './closeout.schemas.js';
import * as svc from './closeout.service.js';

const router = Router({ mergeParams: true });

// Closing artifacts are a governance record; functional roles may read alongside
// the owning PM, and the owning PM / ADMIN / PMO may write.
const canRead = requireProjectAccess({ allowRoles: ['RISK_OFFICER', 'FINANCE'] });
const canWrite = [
  requireProjectAccess({ write: true }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER'),
];

// --- Lessons learned ---------------------------------------------------------

router.get(
  '/lessons',
  canRead,
  asyncHandler(async (req, res) => {
    res.json({ lessons: await svc.listLessons(req.params.projectId) });
  }),
);

router.post(
  '/lessons',
  ...canWrite,
  validateBody(upsertLessonSchema),
  asyncHandler(async (req, res) => {
    const lesson = await svc.createLesson(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ lesson });
  }),
);

router.put(
  '/lessons/:lessonId',
  ...canWrite,
  validateBody(upsertLessonSchema),
  asyncHandler(async (req, res) => {
    const lesson = await svc.updateLesson(req.params.projectId, req.params.lessonId, req.body, req.user!.id);
    res.json({ lesson });
  }),
);

router.delete(
  '/lessons/:lessonId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteLesson(req.params.projectId, req.params.lessonId, req.user!.id);
    res.status(204).send();
  }),
);

// --- Acceptance sign-offs ----------------------------------------------------

router.get(
  '/acceptances',
  canRead,
  asyncHandler(async (req, res) => {
    res.json({ acceptances: await svc.listAcceptances(req.params.projectId) });
  }),
);

router.post(
  '/acceptances',
  ...canWrite,
  validateBody(upsertAcceptanceSchema),
  asyncHandler(async (req, res) => {
    const acceptance = await svc.createAcceptance(req.params.projectId, req.body, req.user!.id);
    res.status(201).json({ acceptance });
  }),
);

router.delete(
  '/acceptances/:acceptanceId',
  ...canWrite,
  asyncHandler(async (req, res) => {
    await svc.deleteAcceptance(req.params.projectId, req.params.acceptanceId, req.user!.id);
    res.status(204).send();
  }),
);

export default router;
