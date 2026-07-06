import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { Button, Input } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { formatDateInput } from '../lib/format';

// Portfolio-wide report download (summary + rolled-up EVM trend), scoped to the
// caller's visible projects. Its own status date drives the per-project EVM in the
// report; the trend section is the full captured history regardless of date.
export default function PortfolioExport() {
  const { user } = useAuth();
  const toast = useToast();
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null);

  // Only roles with a meaningful portfolio see the export controls.
  if (!user || !['ADMIN', 'PMO', 'FINANCE', 'PROJECT_MANAGER'].includes(user.role)) return null;

  const download = async (kind: 'excel' | 'pdf') => {
    setBusy(kind);
    try {
      await api.download(`/portfolio/export/${kind}?statusDate=${statusDate}`, `portfolio_report.${kind === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="text-xs text-slate-500 dark:text-slate-400">
        <span className="mr-2 uppercase tracking-wide">Report date</span>
        <Input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} className="!w-auto !py-1.5" />
      </label>
      <Button variant="secondary" onClick={() => download('excel')} disabled={busy !== null}>⬇ Excel</Button>
      <Button variant="secondary" onClick={() => download('pdf')} disabled={busy !== null}>⬇ PDF</Button>
    </div>
  );
}
