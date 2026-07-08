import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { ActionItemInput, AttendeeInput, UpsertMeetingInput } from './kickoff.schemas.js';

// Lazily create the (empty) kick-off record so attendees/action items can be added before the
// meeting details are filled in.
async function ensureMeeting(projectId: string, actorId: string) {
  return prisma.kickoffMeeting.upsert({
    where: { projectId },
    update: {},
    create: { projectId, createdById: actorId },
  });
}

export async function getKickoff(projectId: string) {
  const meeting = await prisma.kickoffMeeting.findUnique({
    where: { projectId },
    include: {
      attendees: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      actionItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!meeting) return { meeting: null, attendees: [], actionItems: [] };
  const { attendees, actionItems, ...m } = meeting;
  const createdByName = m.createdById
    ? (await prisma.user.findUnique({ where: { id: m.createdById }, select: { name: true } }))?.name ?? null
    : null;
  return { meeting: { ...m, createdByName }, attendees, actionItems };
}

export async function upsertMeeting(projectId: string, input: UpsertMeetingInput, actorId: string) {
  const existing = await prisma.kickoffMeeting.findUnique({ where: { projectId } });
  const meeting = existing
    ? await prisma.kickoffMeeting.update({ where: { projectId }, data: input })
    : await prisma.kickoffMeeting.create({ data: { ...input, projectId, createdById: actorId } });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffMeeting', entityId: meeting.id, action: existing ? 'UPDATE' : 'CREATE', after: meeting });
  return meeting;
}

// ---- Attendees ----
export async function addAttendee(projectId: string, input: AttendeeInput, actorId: string) {
  const meeting = await ensureMeeting(projectId, actorId);
  const count = await prisma.kickoffAttendee.count({ where: { meetingId: meeting.id } });
  const a = await prisma.kickoffAttendee.create({
    data: { meetingId: meeting.id, name: input.name, role: input.role ?? null, present: input.present ?? true, sortOrder: count },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffAttendee', entityId: a.id, action: 'CREATE', after: a });
  return a;
}

export async function updateAttendee(projectId: string, id: string, input: Partial<AttendeeInput>, actorId: string) {
  const existing = await prisma.kickoffAttendee.findFirst({ where: { id, meeting: { projectId } } });
  if (!existing) throw NotFound('Attendee not found');
  const a = await prisma.kickoffAttendee.update({ where: { id }, data: input });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffAttendee', entityId: id, action: 'UPDATE', before: existing, after: a });
  return a;
}

export async function deleteAttendee(projectId: string, id: string, actorId: string) {
  const existing = await prisma.kickoffAttendee.findFirst({ where: { id, meeting: { projectId } } });
  if (!existing) throw NotFound('Attendee not found');
  await prisma.kickoffAttendee.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffAttendee', entityId: id, action: 'DELETE', before: existing });
}

// ---- Action items ----
export async function addActionItem(projectId: string, input: ActionItemInput, actorId: string) {
  const meeting = await ensureMeeting(projectId, actorId);
  const count = await prisma.kickoffActionItem.count({ where: { meetingId: meeting.id } });
  const a = await prisma.kickoffActionItem.create({
    data: { meetingId: meeting.id, description: input.description, ownerName: input.ownerName ?? null, dueDate: input.dueDate ?? null, status: input.status ?? 'OPEN', sortOrder: count },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffActionItem', entityId: a.id, action: 'CREATE', after: a });
  return a;
}

export async function updateActionItem(projectId: string, id: string, input: Partial<ActionItemInput>, actorId: string) {
  const existing = await prisma.kickoffActionItem.findFirst({ where: { id, meeting: { projectId } } });
  if (!existing) throw NotFound('Action item not found');
  const a = await prisma.kickoffActionItem.update({ where: { id }, data: input });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffActionItem', entityId: id, action: 'UPDATE', before: existing, after: a });
  return a;
}

export async function deleteActionItem(projectId: string, id: string, actorId: string) {
  const existing = await prisma.kickoffActionItem.findFirst({ where: { id, meeting: { projectId } } });
  if (!existing) throw NotFound('Action item not found');
  await prisma.kickoffActionItem.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'KickoffActionItem', entityId: id, action: 'DELETE', before: existing });
}
