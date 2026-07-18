import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';
import { Button, Field, Modal, Select } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

// Inline "Change PM" control for a project header. Visible to ADMIN/PMO only.
export default function ReassignPm({ projectId, currentPmId }: { projectId: string; currentPmId: string | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pmUserId, setPmUserId] = useState(currentPmId ?? '');
  const [err, setErr] = useState('');

  const usersQ = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<{ users: User[] }>('/users/directory'),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${projectId}/pm`, { pmUserId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setErr('');
      toast.success('Project manager reassigned');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to reassign PM'),
  });

  if (user?.role !== 'ADMIN' && user?.role !== 'PMO') return null;

  return (
    <>
      <button
        onClick={() => { setPmUserId(currentPmId ?? ''); setOpen(true); }}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Change PM
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} title="Reassign Project Manager" size="sm">
            <Field label="Project Manager">
              <Select value={pmUserId} onChange={(e) => setPmUserId(e.target.value)} disabled={usersQ.isLoading}>
                <option value="">— select —</option>
                {usersQ.data?.users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </Select>
            </Field>
            {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!pmUserId || pmUserId === currentPmId || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Reassign'}
              </Button>
            </div>
        </Modal>
      )}
    </>
  );
}
