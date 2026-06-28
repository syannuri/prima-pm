import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button } from './ui';
import { formatDate } from '../lib/format';

interface AttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Reusable attachments widget for any owner (CHARTER / RISK / PROJECT).
export default function Attachments({
  projectId,
  ownerType,
  ownerId,
  readOnly,
}: {
  projectId: string;
  ownerType: 'CHARTER' | 'RISK' | 'PROJECT';
  ownerId: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/attachments`;
  const key = ['attachments', projectId, ownerType, ownerId];
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');

  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ attachments: AttachmentDto[] }>(`${base}?ownerType=${ownerType}&ownerId=${ownerId}`),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ownerType', ownerType);
      fd.append('ownerId', ownerId);
      return api.upload(base, fd);
    },
    onSuccess: () => { setErr(''); if (fileRef.current) fileRef.current.value = ''; qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Upload failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const items = list.data?.attachments ?? [];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Attachments</span>
        {!readOnly && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? 'Uploading…' : '+ Upload'}
            </Button>
          </>
        )}
      </div>

      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

      {!items.length ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No files attached.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded bg-slate-50 dark:bg-slate-800 px-2 py-1 text-sm">
              <button
                onClick={() => api.download(`${base}/${a.id}/download`, a.fileName)}
                className="truncate text-brand-600 hover:underline"
                title="Download"
              >
                📎 {a.fileName}
              </button>
              <span className="ml-2 flex shrink-0 items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                {humanSize(a.sizeBytes)} · {formatDate(a.createdAt)}
                {!readOnly && (
                  <button onClick={() => del.mutate(a.id)} className="text-red-500 hover:underline">delete</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
