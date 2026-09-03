import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Button, Modal, Spinner } from './ui';
import { useToast } from './Toast';

interface Preview { total: number; willImport: number; errors: { rowNum: number; message: string }[] }
export type CostImportKind = 'direct' | 'indirect';

// Uploads an .xlsx/.csv to the cost-import endpoint (direct or indirect budget lines): first a
// dry-run preview (counts + per-row errors), then commit. Backend is all-or-nothing, so commit is
// only allowed when there are no errors. Mirrors ImportTasksModal.
export default function ImportCostModal({ projectId, kind, onClose, onImported }: { projectId: string; kind: CostImportKind; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const base = `/projects/${projectId}/cost/import/${kind}`;
  const noun = kind === 'direct' ? 'direct' : 'indirect';
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const fd = (f: File) => { const d = new FormData(); d.append('file', f); return d; };

  const runPreview = async (f: File) => {
    setBusy(true); setPreview(null); setFile(f);
    try {
      setPreview(await api.upload<Preview>(base, fd(f))); // dryRun defaults true
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not read the file');
      setFile(null);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.upload<{ created: number }>(`${base}?dryRun=false`, fd(file));
      toast.success(`Imported ${res.created} ${noun} line${res.created === 1 ? '' : 's'}`);
      onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Import failed');
    } finally { setBusy(false); }
  };

  const hasErrors = (preview?.errors.length ?? 0) > 0;
  const columns = kind === 'direct'
    ? 'Type, Label, Sub-Category, Qty, Unit Cost'
    : 'Type, Description, Sub-Category, Amount';

  return (
    <Modal onClose={onClose} title={`Import ${noun} cost lines`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Upload an <strong>.xlsx</strong> or <strong>.csv</strong> with columns
          {' '}<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">{columns}</code>.
          {kind === 'direct' && (
            <> {' '}<span className="text-slate-500 dark:text-slate-400">For <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">MANPOWER</code> rows use <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">Role, Rate per Man-day, Man-days</code> instead of Qty/Unit Cost.</span></>
          )}
          {' '}<span className="text-slate-500 dark:text-slate-400">Use the Type enum values (e.g. {kind === 'direct' ? 'SOFTWARE_LICENSE, MANPOWER' : 'TRANSPORTATION, MEALS_PERDIEM'}); numbers should be plain.</span>
          {' '}We’ll preview it before anything is saved.
        </p>

        <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void runPreview(f); }} />
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {file ? 'Choose a different file' : 'Choose file'}
          </Button>
          {file && <span className="min-w-0 truncate text-sm text-slate-500 dark:text-slate-400">{file.name}</span>}
          {busy && <Spinner />}
        </div>

        {preview && (
          <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {preview.willImport} of {preview.total} row{preview.total === 1 ? '' : 's'} ready to import
              {hasErrors && <span className="text-red-600 dark:text-red-400"> · {preview.errors.length} with errors</span>}
            </p>
            {hasErrors && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-600 dark:text-red-400">
                {preview.errors.map((er) => <li key={er.rowNum}>Row {er.rowNum}: {er.message}</li>)}
              </ul>
            )}
            {hasErrors && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Fix the rows above and re-upload — import is all-or-nothing.</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={commit} disabled={busy || !preview || hasErrors || preview.willImport === 0}>
            {busy ? 'Importing…' : preview ? `Import ${preview.willImport} line${preview.willImport === 1 ? '' : 's'}` : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
