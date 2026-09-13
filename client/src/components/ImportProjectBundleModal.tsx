import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Button, Modal, Spinner } from './ui';
import { useToast } from './Toast';

interface Preview {
  sourceName: string;
  sourceCode?: string;
  counts: Record<string, number>;
  warnings: string[];
}
interface ImportResult {
  projectId: string;
  code: string;
  warnings: string[];
  reconciliation: Record<string, { expected: number; imported: number }>;
}

// Uploads a full-project .json bundle to the bundle-import endpoint: first a dry-run preview
// (source + per-component counts + warnings), then commit. A commit always creates a BRAND-NEW
// DRAFT project (clone), so it never overwrites anything.
export default function ImportProjectBundleModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const base = '/projects/import/bundle';
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const fd = (f: File) => { const d = new FormData(); d.append('file', f); return d; };

  const runPreview = async (f: File) => {
    setBusy(true); setPreview(null); setFile(f);
    try {
      const res = await api.upload<{ preview: Preview }>(base, fd(f)); // dryRun defaults true
      setPreview(res.preview);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not read the bundle');
      setFile(null);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.upload<ImportResult>(`${base}?dryRun=false`, fd(file));
      toast.success(`Project imported as ${res.code}`);
      onImported();
      // If the import had notes (lossy references, created defs, skipped rows), keep the modal open
      // so the user sees the reconciliation before opening the project. Otherwise go straight there.
      if (res.warnings.length > 0) setResult(res);
      else { onClose(); navigate(`/projects/${res.projectId}`); }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Import failed');
    } finally { setBusy(false); }
  };

  const openProject = () => { if (result) { onClose(); navigate(`/projects/${result.projectId}`); } };

  // Only show components that actually carry rows, sorted by count desc, for a compact summary.
  const summary = preview
    ? Object.entries(preview.counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <Modal onClose={onClose} title="Import project" size="lg">
      <div className="space-y-4">
        {result ? (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Imported as <strong>{result.code}</strong>. Review the notes below, then open the project.
            </p>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
              <p className="mb-2 font-medium text-slate-800 dark:text-slate-100">Import notes ({result.warnings.length})</p>
              <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                {result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            </div>
            <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">Reconciliation (imported / expected)</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(result.reconciliation).filter(([, r]) => r.expected > 0).map(([k, r]) => (
                  <span key={k} className={`rounded px-1.5 py-0.5 text-xs ${r.imported < r.expected ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {k}: {r.imported}/{r.expected}
                  </span>
                ))}
              </div>
            </details>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={openProject}>Open project</Button>
            </div>
          </>
        ) : (
        <>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Upload a <strong>.json</strong> project bundle (exported with the <strong>Export</strong> action).
          {' '}It is imported as a <strong>brand-new project</strong> in <strong>Draft</strong> — with every phase
          {' '}(charter, schedule, cost, risks, stakeholders, procurement, UAT, agile, lessons…). Nothing existing is overwritten.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void runPreview(f); }}
        />
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {file ? 'Choose a different file' : 'Choose bundle'}
          </Button>
          {file && <span className="min-w-0 truncate text-sm text-slate-500 dark:text-slate-400">{file.name}</span>}
          {busy && <Spinner />}
        </div>

        {preview && (
          <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {preview.sourceName}{preview.sourceCode ? ` · ${preview.sourceCode}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summary.map(([k, n]) => (
                <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {n} {k}
                </span>
              ))}
              {summary.length === 0 && <span className="text-xs text-slate-500 dark:text-slate-400">Empty project (no components).</span>}
            </div>
            {preview.warnings.length > 0 && (
              <ul className="mt-3 space-y-0.5 text-xs text-amber-600 dark:text-amber-400">
                {preview.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={commit} disabled={busy || !preview}>
            {busy ? 'Importing…' : 'Import as new project'}
          </Button>
        </div>
        </>
        )}
      </div>
    </Modal>
  );
}
