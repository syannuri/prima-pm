import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireProjectGovernance, requireProjectAccess } from '../../middleware/rbac.js';
import { upsertMeetingSchema, attendeeSchema, attendeePatchSchema, actionItemSchema, actionItemPatchSchema } from './kickoff.schemas.js';
import * as svc from './kickoff.service.js';

const router = Router({ mergeParams: true });

// Initiating artifact: the owning PM + ADMIN/PMO manage it (same as Charter/Closeout).
const canRead = requireProjectAccess();
const canWrite = [requireProjectAccess({ write: true }), requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER')];

router.get('/', canRead, asyncHandler(async (req, res) => {
  res.json(await svc.getKickoff(req.params.projectId));
}));

router.put('/', ...canWrite, validateBody(upsertMeetingSchema), asyncHandler(async (req, res) => {
  res.json({ meeting: await svc.upsertMeeting(req.params.projectId, req.body, req.user!.id) });
}));

// Attendees
router.post('/attendees', ...canWrite, validateBody(attendeeSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ attendee: await svc.addAttendee(req.params.projectId, req.body, req.user!.id) });
}));
router.patch('/attendees/:id', ...canWrite, validateBody(attendeePatchSchema), asyncHandler(async (req, res) => {
  res.json({ attendee: await svc.updateAttendee(req.params.projectId, req.params.id, req.body, req.user!.id) });
}));
router.delete('/attendees/:id', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteAttendee(req.params.projectId, req.params.id, req.user!.id);
  res.status(204).send();
}));

// Action items
router.post('/actions', ...canWrite, validateBody(actionItemSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ actionItem: await svc.addActionItem(req.params.projectId, req.body, req.user!.id) });
}));
router.patch('/actions/:id', ...canWrite, validateBody(actionItemPatchSchema), asyncHandler(async (req, res) => {
  res.json({ actionItem: await svc.updateActionItem(req.params.projectId, req.params.id, req.body, req.user!.id) });
}));
router.delete('/actions/:id', ...canWrite, asyncHandler(async (req, res) => {
  await svc.deleteActionItem(req.params.projectId, req.params.id, req.user!.id);
  res.status(204).send();
}));

export default router;
