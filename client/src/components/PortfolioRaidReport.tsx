import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioRaid } from '../api/types';
import { Badge, Card, EmptyState, Spinner } from './ui';
import { formatIdrShort, formatDate } from '../lib/format';

// Portfolio RAID roll-up (R5) — Risks, Assumptions, Issues & Dependencies aggregated across every
// visible project, the cross-project view the hub was missing (RAID had only been per-project).
// Reuses GET /portfolio/raid; role/tenant scoping is server-side. Each section is worst-first.
const SEV_COLOR: Record<string, string> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'slate' };
const DEP_COLOR: Record<string, string> = { AT_RISK: 'red', PENDING: 'amber', ON_TRACK: 'green', RESOLVED: 'slate' };
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default function PortfolioRaidReport() {
  const q = useQuery({ queryKey: ['portfolio-raid'], queryFn: () => api.get<PortfolioRaid>('/portfolio/raid') });

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
  const d = q.data;
  if (!d || d.projectCount === 0)
    return <EmptyState title="No active projects" hint="The RAID roll-up covers every project past the draft stage — commit a charter to see risks, assumptions, issues and dependencies here." />;

  const c = d.counts;
  const allClear = c.risks + c.assumptions + c.issues + c.dependencies === 0;

  return (
    <div className="space-y-5">
      {/* Header + count band */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Portfolio RAID · Risks, Assumptions, Issues, Dependencies</div>
            <h2 className="mt-0.5 text-xl font-bold text-slate-800 dark:text-slate-100">All projects</h2>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{d.projectCount} project{d.projectCount === 1 ? '' : 's'} · as of {formatDate(d.statusDate)}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CountTile label="Open risks" value={c.risks} sub={c.risksHigh ? `${c.risksHigh} high/critical` : 'none high'} warn={c.risksHigh > 0} />
          <CountTile label="Open assumptions" value={c.assumptions} sub="to validate" />
          <CountTile label="Open issues" value={c.issues} sub="unresolved" warn={c.issues > 0} />
          <CountTile label="Dependencies" value={c.dependencies} sub={c.dependenciesAtRisk ? `${c.dependenciesAtRisk} at-risk/overdue` : 'on track'} warn={c.dependenciesAtRisk > 0} />
        </div>
        {allClear && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">✓ Nothing open across the portfolio — no live risks, assumptions, issues or dependencies.</p>}
      </Card>

      {/* Risks */}
      <RaidSection title="Risks" count={c.risks} empty="No open risks across the portfolio.">
        <RaidTable
          cols={['Project', 'Risk', 'Severity', 'EMV', 'Response', 'Owner']}
          rows={d.risks.map((r) => [
            <ProjTag key="p" code={r.project} />, r.title,
            <Badge key="s" color={SEV_COLOR[r.severity] ?? 'slate'}>{titleCase(r.severity)}</Badge>,
            <span key="e" className="tabular-nums">{r.emv ? formatIdrShort(r.emv) : '—'}</span>,
            r.response ? titleCase(r.response) : '—', r.owner ?? '—',
          ])}
          aligns={['', '', '', 'right', '', '']}
        />
      </RaidSection>

      {/* Assumptions */}
      <RaidSection title="Assumptions" count={c.assumptions} empty="No open assumptions across the portfolio.">
        <RaidTable
          cols={['Project', 'Assumption', 'Impact if false', 'Category', 'Owner']}
          rows={d.assumptions.map((a) => [
            <ProjTag key="p" code={a.project} />, a.statement,
            <Badge key="i" color={SEV_COLOR[a.impact] ?? 'slate'}>{titleCase(a.impact)}</Badge>,
            a.category ?? '—', a.owner ?? '—',
          ])}
          aligns={['', '', '', '', '']}
        />
      </RaidSection>

      {/* Issues */}
      <RaidSection title="Issues" count={c.issues} empty="No open issues across the portfolio.">
        <RaidTable
          cols={['Project', 'Issue', 'Impact', 'Status', 'Age', 'Owner']}
          rows={d.issues.map((i) => [
            <ProjTag key="p" code={i.project} />, i.title,
            <Badge key="i" color={SEV_COLOR[i.impact] ?? 'slate'}>{titleCase(i.impact)}</Badge>,
            titleCase(i.status), <span key="a" className="tabular-nums">{i.ageDays}d</span>, i.owner ?? '—',
          ])}
          aligns={['', '', '', '', 'right', '']}
        />
      </RaidSection>

      {/* Dependencies */}
      <RaidSection title="Dependencies" count={c.dependencies} empty="No open dependencies across the portfolio.">
        <RaidTable
          cols={['Project', 'Dependency', 'Direction', 'Counterparty', 'Status', 'Due', 'Owner']}
          rows={d.dependencies.map((dep) => [
            <ProjTag key="p" code={dep.project} />, dep.description,
            dep.direction === 'INBOUND' ? '← Inbound' : '→ Outbound', dep.counterparty ?? '—',
            <Badge key="s" color={DEP_COLOR[dep.status] ?? 'slate'}>{titleCase(dep.status)}</Badge>,
            <span key="d" className={`tabular-nums ${dep.overdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{dep.dueDate ? formatDate(dep.dueDate) : '—'}{dep.overdue ? ' ⚠' : ''}</span>,
            dep.owner ?? '—',
          ])}
          aligns={['', '', '', '', '', '', '']}
        />
      </RaidSection>
    </div>
  );
}

function CountTile({ label, value, sub, warn }: { label: string; value: number; sub: string; warn?: boolean }) {
  const tint = warn ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800';
  return (
    <div className={`min-w-0 rounded-lg border p-2.5 ${tint}`}>
      <div className="truncate text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      <div className="truncate text-[10px] text-slate-400">{sub}</div>
    </div>
  );
}

function RaidSection({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <div className="mb-3 flex items-center gap-2 rounded-lg border-l-4 border-[#108AB1] bg-[#108AB1]/10 px-3 py-1.5 dark:bg-[#108AB1]/20">
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">{title}</h3>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-200">{count}</span>
      </div>
      {count === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">{empty}</p> : children}
    </Card>
  );
}

function RaidTable({ cols, rows, aligns }: { cols: string[]; rows: ReactNode[][]; aligns: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {cols.map((h, i) => <th key={i} className={`px-2 py-1.5 font-semibold ${aligns[i] === 'right' ? 'text-right' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-2 py-1.5 align-top text-slate-700 dark:text-slate-200 ${aligns[ci] === 'right' ? 'text-right' : ''} ${ci === 1 ? 'min-w-[180px]' : ''}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjTag({ code }: { code: string }) {
  return <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{code}</span>;
}
