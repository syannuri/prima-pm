import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { KickoffActionItem, KickoffActionStatus, KickoffAttendee, KickoffData } from '../../api/types';
import { Badge, Button, Card, Field, Input, SectionTitle, Spinner, Textarea, Toggle } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatDateInput } from '../../lib/format';

export default function KickoffPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const base = `/projects/${projectId}/kickoff`;
  const canEdit = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);

  const q = useQuery({ queryKey: ['kickoff', projectId], queryFn: () => api.get<KickoffData>(base) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['kickoff', projectId] });

  if (q.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  const data = q.data!;

  return (
    <div className="space-y-5">
      <MeetingDetails base={base} data={data} canEdit={canEdit} onSaved={invalidate} />
      <Attendees base={base} rows={data.attendees} canEdit={canEdit} onChange={invalidate} />
      <ActionItems base={base} rows={data.actionItems} canEdit={canEdit} onChange={invalidate} />
    </div>
  );
}

function MeetingDetails({ base, data, canEdit, onSaved }: { base: string; data: KickoffData; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const m = data.meeting;
  const [meetingDate, setDate] = useState(m?.meetingDate ? formatDateInput(m.meetingDate) : '');
  const [location, setLocation] = useState(m?.location ?? '');
  const [facilitator, setFacilitator] = useState(m?.facilitator ?? '');
  const [agenda, setAgenda] = useState(m?.agenda ?? '');
  const [objectives, setObjectives] = useState(m?.objectives ?? '');
  const [decisions, setDecisions] = useState(m?.decisions ?? '');
  const [notes, setNotes] = useState(m?.notes ?? '');
  // Re-sync when the record loads/changes.
  useEffect(() => {
    setDate(m?.meetingDate ? formatDateInput(m.meetingDate) : ''); setLocation(m?.location ?? ''); setFacilitator(m?.facilitator ?? '');
    setAgenda(m?.agenda ?? ''); setObjectives(m?.objectives ?? ''); setDecisions(m?.decisions ?? ''); setNotes(m?.notes ?? '');
  }, [m?.id, m?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.put(`${base}`, {
      meetingDate: meetingDate || null, location: location || null, facilitator: facilitator || null,
      agenda: agenda || null, objectives: objectives || null, decisions: decisions || null, notes: notes || null,
    }),
    onSuccess: () => { toast.success('Kick-off details saved'); onSaved(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  return (
    <Card>
      <SectionTitle sub="Kick-Off Meeting minutes — the project's opening alignment record.">Kick-Off Meeting</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Meeting date"><Input type="date" value={meetingDate} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} /></Field>
        <Field label="Location / mode"><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Online (Teams)" disabled={!canEdit} /></Field>
        <Field label="Facilitator"><Input value={facilitator} onChange={(e) => setFacilitator(e.target.value)} placeholder="Who chairs" disabled={!canEdit} /></Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Agenda"><Textarea rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="1. Introductions\n2. Scope & objectives\n3. Schedule & roles\n4. Risks\n5. Next steps" disabled={!canEdit} /></Field>
        <Field label="Objectives"><Textarea rows={4} value={objectives} onChange={(e) => setObjectives(e.target.value)} placeholder="What this meeting must achieve" disabled={!canEdit} /></Field>
        <Field label="Decisions"><Textarea rows={3} value={decisions} onChange={(e) => setDecisions(e.target.value)} placeholder="Key decisions made" disabled={!canEdit} /></Field>
        <Field label="Notes / minutes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Discussion notes" disabled={!canEdit} /></Field>
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{m ? `Last updated ${formatDate(m.updatedAt)}${m.createdByName ? ` · created by ${m.createdByName}` : ''}` : 'Not created yet'}</span>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save details'}</Button>
        </div>
      )}
    </Card>
  );
}

function Attendees({ base, rows, canEdit, onChange }: { base: string; rows: KickoffAttendee[]; canEdit: boolean; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`${base}/attendees`, { name, role: role || undefined }),
    onSuccess: () => { setName(''); setRole(''); onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add'),
  });
  const toggle = useMutation({
    mutationFn: (a: KickoffAttendee) => api.patch(`${base}/attendees/${a.id}`, { present: !a.present }),
    onSuccess: onChange,
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${base}/attendees/${id}`), onSuccess: onChange });

  const present = rows.filter((a) => a.present).length;
  return (
    <Card>
      <SectionTitle sub={rows.length ? `${present} of ${rows.length} present` : 'Who attended the kick-off'}>Attendees</SectionTitle>
      {rows.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                {a.role && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{a.role}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {canEdit ? (
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Toggle checked={a.present} onChange={() => toggle.mutate(a)} label="Present" /> Present</label>
                ) : (
                  <Badge color={a.present ? 'green' : 'slate'}>{a.present ? 'Present' : 'Absent'}</Badge>
                )}
                {canEdit && (
                  <button onClick={async () => { if (await confirm({ title: 'Remove attendee?', message: <>Remove <strong>{a.name}</strong>?</>, confirmLabel: 'Remove', danger: true })) del.mutate(a.id); }} className="text-red-500 hover:underline">Del</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Attendee name" /></Field>
          <Field label="Role / org"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Sponsor" /></Field>
          <Button variant="secondary" disabled={!name || add.isPending} onClick={() => add.mutate()}>+ Add attendee</Button>
        </div>
      )}
    </Card>
  );
}

function ActionItems({ base, rows, canEdit, onChange }: { base: string; rows: KickoffActionItem[]; canEdit: boolean; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [description, setDesc] = useState('');
  const [ownerName, setOwner] = useState('');
  const [dueDate, setDue] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`${base}/actions`, { description, ownerName: ownerName || undefined, dueDate: dueDate || undefined }),
    onSuccess: () => { setDesc(''); setOwner(''); setDue(''); onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: KickoffActionStatus }) => api.patch(`${base}/actions/${id}`, { status }),
    onSuccess: onChange,
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`${base}/actions/${id}`), onSuccess: onChange });

  const open = rows.filter((a) => a.status === 'OPEN').length;
  return (
    <Card>
      <SectionTitle sub={rows.length ? `${open} open of ${rows.length}` : 'Follow-up actions agreed at kick-off (owner + due date)'}>Action Items</SectionTitle>
      {rows.length > 0 && (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400 [&>th]:py-2 [&>th]:pr-3">
              <th className="w-8" /><th>Action</th><th>Owner</th><th>Due</th>{canEdit && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const done = a.status === 'DONE';
              const overdue = !done && a.dueDate && +new Date(a.dueDate) < Date.now();
              return (
                <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 [&>td]:py-2 [&>td]:pr-3">
                  <td>
                    <button disabled={!canEdit} onClick={() => setStatus.mutate({ id: a.id, status: done ? 'OPEN' : 'DONE' })} title={done ? 'Mark open' : 'Mark done'}
                      className={`grid h-5 w-5 place-items-center rounded-full border-2 ${done ? 'border-green-500 bg-green-500 text-white' : 'border-slate-300 text-transparent dark:border-slate-600'} ${canEdit ? 'hover:border-brand-500' : ''}`}>✓</button>
                  </td>
                  <td className={done ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}>{a.description}</td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">{a.ownerName ?? '—'}</td>
                  <td className="whitespace-nowrap text-xs">{a.dueDate ? <span className={overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}>{formatDate(a.dueDate)}{overdue ? ' · overdue' : ''}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap text-right text-xs">
                      <button onClick={async () => { if (await confirm({ title: 'Delete action item?', message: 'Delete this action item?', confirmLabel: 'Delete', danger: true })) del.mutate(a.id); }} className="text-red-500 hover:underline">Del</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Action"><Input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="What needs doing" /></Field>
          <Field label="Owner"><Input value={ownerName} onChange={(e) => setOwner(e.target.value)} placeholder="Who" /></Field>
          <div className="w-40"><Field label="Due"><Input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} /></Field></div>
          <Button variant="secondary" disabled={!description || add.isPending} onClick={() => add.mutate()}>+ Add action</Button>
        </div>
      )}
    </Card>
  );
}
