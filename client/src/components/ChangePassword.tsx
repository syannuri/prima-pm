import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Field, Input } from './ui';

// A small "Change password" button that opens a modal. Self-contained so it can
// drop straight into the header.
export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm(''); setErr(''); setDone(false);
  };
  const close = () => { setOpen(false); reset(); };

  const submit = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => { setDone(true); setErr(''); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not change password'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next !== confirm) { setErr('New password and confirmation do not match'); return; }
    submit.mutate();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
      >
        Change password
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-100">Change password</h2>
            {done ? (
              <div className="space-y-4">
                <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                  Password updated. Use it the next time you sign in.
                </p>
                <Button className="w-full" onClick={close}>Done</Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Use a unique password of 10+ characters with at least one letter and one number.
                </p>
                <Field label="Current password">
                  <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
                </Field>
                <Field label="New password">
                  <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
                </Field>
                <Field label="Confirm new password">
                  <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </Field>
                {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="secondary" className="flex-1" onClick={close}>Cancel</Button>
                  <Button type="submit" className="flex-1" disabled={submit.isPending || !current || !next}>
                    {submit.isPending ? 'Saving…' : 'Update'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
