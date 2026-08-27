import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { AiMemory, AiMemoryScope, AiMemoryKind } from '../api/types';
import { Button, Card, Input, SectionTitle, Select, Spinner } from './ui';
import { useToast } from './Toast';

const SCOPE_LABEL: Record<AiMemoryScope, string> = { USER: 'Pribadi', TENANT: 'Organisasi' };
const KIND_LABEL: Record<AiMemoryKind, string> = { PREFERENCE: 'Preferensi', FACT: 'Fakta', GLOSSARY: 'Istilah', GUIDANCE: 'Panduan (feedback)' };

// Manage Anett's cross-session memory (Fase 3). Tenant-ADMIN self-serve alongside AiNarrativeCard:
// list / add / pin / delete the durable facts, preferences, glossary and feedback-corrections Anett
// injects into its prompt. Backed by /assistant/memory (USER = own, TENANT = org, governance-gated).
export default function AiMemoryCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<AiMemoryScope>('TENANT');
  const [kind, setKind] = useState<AiMemoryKind>('FACT');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-memories'],
    queryFn: () => api.get<{ memories: AiMemory[] }>('/assistant/memory'),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ai-memories'] });

  const add = useMutation({
    mutationFn: () => api.post<AiMemory>('/assistant/memory', { content: content.trim(), scope, kind }),
    onSuccess: () => { setContent(''); invalidate(); toast.success('Ingatan ditambahkan'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menambah ingatan'),
  });
  const pin = useMutation({
    mutationFn: (m: AiMemory) => api.patch<AiMemory>(`/assistant/memory/${m.id}`, { pinned: !m.pinned }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal memperbarui'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/assistant/memory/${id}`),
    onSuccess: () => { invalidate(); toast.success('Ingatan dihapus'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menghapus'),
  });

  const memories = data?.memories ?? [];

  return (
    <Card>
      <SectionTitle sub="Workspace-wide — fakta, preferensi, istilah & koreksi feedback yang diingat Anett lintas sesi. Anda selalu bisa meninjau & menghapusnya.">Ingatan Anett</SectionTitle>

      {/* Add a memory */}
      <div className="mt-3 space-y-2">
        <Input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={280}
          placeholder="Mis. Nilai selalu ditulis dalam juta Rupiah"
          onKeyDown={(e) => { if (e.key === 'Enter' && content.trim().length >= 3 && !add.isPending) add.mutate(); }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scope} onChange={(e) => setScope(e.target.value as AiMemoryScope)} className="w-36">
            <option value="TENANT">Organisasi</option>
            <option value="USER">Pribadi</option>
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value as AiMemoryKind)} className="w-40">
            <option value="FACT">Fakta</option>
            <option value="PREFERENCE">Preferensi</option>
            <option value="GLOSSARY">Istilah</option>
          </Select>
          <Button onClick={() => add.mutate()} disabled={content.trim().length < 3 || add.isPending}>Tambah</Button>
        </div>
      </div>

      {/* List */}
      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
        {isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : memories.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400 dark:text-slate-500">Belum ada ingatan. Tambahkan di atas, atau minta Anett “ingat bahwa…” saat mengobrol.</p>
        ) : (
          <ul className="space-y-1.5">
            {memories.map((m) => (
              <li key={m.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 dark:text-slate-100">{m.pinned && <span title="Disematkan">📌 </span>}{m.content}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{SCOPE_LABEL[m.scope]}</span>
                    <span className="rounded-full bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">{KIND_LABEL[m.kind]}</span>
                    {m.source === 'FEEDBACK' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">dari feedback</span>}
                  </div>
                </div>
                <button onClick={() => pin.mutate(m)} disabled={pin.isPending} title={m.pinned ? 'Lepas sematan' : 'Sematkan'} className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-slate-400 hover:bg-slate-200 hover:text-violet-600 dark:hover:bg-slate-700">{m.pinned ? '📌' : '📍'}</button>
                <button onClick={() => remove.mutate(m.id)} disabled={remove.isPending} title="Hapus" className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30">🗑</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
