import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

// Shown to the owning PM (and ADMIN/PMO) when the PMO has sent a chartered project back:
// displays the PMO's note and a "Resubmit for activation" action that returns it to the queue.
export default function ActivationReviewBanner({ project }: { project: Project }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const resubmit = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/activation/resubmit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['awaiting-activation'] });
      toast.success('Resubmitted for activation');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not resubmit'),
  });

  const status = project.activationReviewStatus;
  if (!status) return null;
  const isOwner = !!user?.id && user.id === project.pmUserId;
  const isGov = user?.role === 'ADMIN' || user?.role === 'PMO';
  if (!isOwner && !isGov) return null;

  const rejected = status === 'REJECTED';
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${rejected ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20' : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20'}`}>
      <span aria-hidden className="text-lg">{rejected ? '⛔' : '📝'}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${rejected ? 'text-red-800 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'}`}>
          {rejected ? 'Activation rejected by PMO' : 'PMO requested a revision before activation'}
        </p>
        {project.activationReviewNote && <p className={`break-words text-sm ${rejected ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>“{project.activationReviewNote}”</p>}
      </div>
      {isOwner && (
        <Button variant="secondary" disabled={resubmit.isPending} onClick={() => resubmit.mutate()}>
          {resubmit.isPending ? 'Resubmitting…' : '↻ Resubmit for activation'}
        </Button>
      )}
    </div>
  );
}
