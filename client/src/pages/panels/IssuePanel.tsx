import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Issue, IssueImpact, IssueStatus, User } from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../lib/format';

const IMPACTS: IssueImpact[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES: IssueStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const IMPACT_COLOR: Record<IssueImpact, string> = { LOW: 'green', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red' };
const STATUS_COLOR: Record<IssueStatus, string> = { OPEN: 'amber', IN_PROGRESS: 'sky', RESOLVED: 'green', CLOSED: 'slate' };
const statusLabel = (s: string) => s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function IssuePanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const qc = useQueryClient();
  const base = `/projects/${projectId}/issues`;
  const [editing, setEditing] = useState<Issue | null>(null);
  const [creating, setCreating] = useState(false);

  const issuesQ = useQuery({ queryKey: ['issues', projectId], queryFn: () => api.get<{ issues: Issue[] }>(base) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['issues', projectId] });

  if (issuesQ.isLoading) return <Spinner />;
  const issues = issuesQ.data?.issues ?? [];
  const openCount = issues.filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle sub="Problems that have occurred — raised date, category, impact, owner, resolution & status.">Issue Log</SectionTitle>
          {canWrite && <Button onClick={() => setCreating(true)}>+ Log issue</Button>}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Badge key={s} color={STATUS_COLOR[s]}>{statusLabel(s)}: {issues.filter((i) => i.status === s).length}</Badge>
          ))}
          <Badge color={openCount > 0 ? 'red' : 'green'}>{openCount} unresolved</Badge>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Code</th><th>Raised</th><th>Issue</th><th>Category</th>
                <th>Impact</th><th>Owner</th><th>Status</th><th>Resolution</th><th></th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{i.code}</td>
                  <td className="py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(i.raisedAt)}</td>
                  <td className="py-2">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{i.title}</div>
                    {i.description && <div className="max-w-[16rem] truncate text-xs text-slate-500 dark:text-slate-400">{i.description}</div>}
                  </td>
                  <td className="py-2 text-slate-600 dark:text-slate-300">{i.category ?? '—'}</td>
                  <td className="py-2"><Badge color={IMPACT_COLOR[i.impact]}>{i.impact}</Badge></td>
                  <td className="py-2 text-slate-600 dark:text-slate-300">{i.owner?.name ?? '—'}</td>
                  <td className="py-2"><Badge color={STATUS_COLOR[i.status]}>{statusLabel(i.status)}</Badge></td>
                  <td className="py-2">
                    {i.resolution
                      ? <div className="max-w-[16rem] whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{i.resolution}{i.resolvedAt && <span className="block text-slate-500 dark:text-slate-400">✓ {formatDate(i.resolvedAt)}</span>}</div>
                      : <span className="text-slate-500 dark:text-slate-400">—</span>}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {canWrite && <button onClick={() => setEditing(i)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>}
                    {canWrite && <DeleteIssue base={base} id={i.id} title={i.title} onDone={invalidate} />}
                  </td>
                </tr>
              ))}
              {!issues.length && <tr><td colSpan={9} className="py-4 text-center text-slate-500 dark:text-slate-400">No issues logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {(creating || editing) && (
        <IssueForm base={base} issue={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={invalidate} />
      )}
    </div>
  );
}

function DeleteIssue({ base, id, title, onDone }: { base: string; id: string; title: string; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success('Issue deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete issue'),
  });
  const onClick = async () => {
    if (await confirm({ title: 'Delete issue?', message: <>Delete <strong>{title}</strong> from the log?</>, confirmLabel: 'Delete', danger: true })) del.mutate();
  };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}

// ISO date (YYYY-MM-DD) for a date input; from an ISO timestamp or "now".
const toDateInput = (iso?: string | null) => (iso ? new Date(iso) : new Date()).toISOString().slice(0, 10);

function IssueForm({ base, issue, onClose, onDone }: { base: string; issue: Issue | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory') });
  const [f, setF] = useState({
    title: issue?.title ?? '',
    category: issue?.category ?? '',
    impact: issue?.impact ?? 'MEDIUM',
    status: issue?.status ?? 'OPEN',
    ownerUserId: issue?.ownerUserId ?? '',
    raisedAt: toDateInput(issue?.raisedAt),
    description: issue?.description ?? '',
    resolution: issue?.resolution ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title: f.title, impact: f.impact, status: f.status,
        raisedAt: f.raisedAt, // coerced to a Date server-side
      };
      if (f.category.trim()) body.category = f.category.trim();
      if (f.ownerUserId) body.ownerUserId = f.ownerUserId;
      if (f.description.trim()) body.description = f.description.trim();
      if (f.resolution.trim()) body.resolution = f.resolution.trim();
      return issue ? api.put(`${base}/${issue.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(issue ? 'Issue updated' : 'Issue logged'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save issue'),
  });

  return (
    <Modal onClose={onClose} title={issue ? `Edit ${issue.code}` : 'Log an issue'} size="lg">
      <div className="space-y-3">
        <Field label="Title"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="What went wrong?" /></Field>
        {/* 2-col even on phones so "Date raised" isn't full-width and the form is tidier. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Technical, Vendor, Scope" /></Field>
          <Field label="Date raised"><Input type="date" value={f.raisedAt} onChange={(e) => set('raisedAt', e.target.value)} /></Field>
          <Field label="Impact">
            <Select value={f.impact} onChange={(e) => set('impact', e.target.value)}>
              {IMPACTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={f.ownerUserId} onChange={(e) => set('ownerUserId', e.target.value)}>
              <option value="">— Unassigned —</option>
              {dirQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Details, context, affected area…" /></Field>
        <Field label="Resolution" hint="How it was (or will be) resolved. Setting status to Resolved/Closed stamps the resolved date.">
          <Textarea rows={2} value={f.resolution} onChange={(e) => set('resolution', e.target.value)} placeholder="Action taken / decision…" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending}>{issue ? 'Save' : 'Log issue'}</Button>
        </div>
      </div>
    </Modal>
  );
}
