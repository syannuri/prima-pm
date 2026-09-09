import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Proposal, ProposalStatus } from '../api/types';
import { Card } from './ui';
import { useToast } from '../components/Toast';
import { formatIdrShort } from '../lib/format';

// Portfolio Selection — a value-vs-effort bubble matrix, a pipeline roll-up (count + cost + revenue
// by status), and a rank-ordered shortlist of approved proposals (ADMIN/PMO reorder → /intake/rank).
// Pure presentation over the proposals the Pipeline page already fetched.

const HEX: Record<ProposalStatus, string> = {
  DRAFT: '#94a3b8', SUBMITTED: '#3b82f6', UNDER_REVIEW: '#f59e0b', APPROVED: '#22c55e',
  REJECTED: '#ef4444', DEFERRED: '#8b5cf6', CONVERTED: '#6366f1',
};
const num = (v: string | null) => (v == null ? 0 : Number(v));

export default function PortfolioMatrix({ proposals, isPmo, onChanged }: { proposals: Proposal[]; isPmo: boolean; onChanged: () => void }) {
  const toast = useToast();
  const rank = useMutation({
    mutationFn: (order: string[]) => api.post('/intake/rank', { order }),
    onSuccess: onChanged,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to reorder'),
  });

  // Roll-up by status (exclude archived — they're already filtered out server-side by default).
  const active = proposals.filter((p) => p.status !== 'REJECTED' && p.status !== 'CONVERTED');
  const byStatus = (['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DEFERRED'] as ProposalStatus[]).map((s) => {
    const rows = proposals.filter((p) => p.status === s);
    return { s, n: rows.length, cost: rows.reduce((a, p) => a + num(p.estCostIdr), 0), rev: rows.reduce((a, p) => a + num(p.estRevenueIdr), 0) };
  });
  const totalCost = active.reduce((a, p) => a + num(p.estCostIdr), 0);
  const totalRev = active.reduce((a, p) => a + num(p.estRevenueIdr), 0);

  // Plot the scored proposals (need both value + cost/effort axes).
  const plotted = proposals.filter((p) => p.scoreValue != null && p.scoreCost != null && p.status !== 'CONVERTED');
  const shortlist = proposals
    .filter((p) => p.status === 'APPROVED')
    .sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999) || num(b.weightedScore) - num(a.weightedScore));

  const move = (i: number, dir: -1 | 1) => {
    const arr = shortlist.map((p) => p.id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    rank.mutate(arr);
  };

  return (
    <div className="space-y-5">
      {/* Roll-up */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {byStatus.map(({ s, n, cost }) => (
          <Card key={s} className="!p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: HEX[s] }} />{s.replace('_', ' ').toLowerCase()}
            </div>
            <div className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{n}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{cost > 0 ? formatIdrShort(cost) : '—'}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Value vs effort matrix */}
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Value vs. effort</h3>
            <span className="text-[11px] text-slate-400">bubble = est. cost</span>
          </div>
          {plotted.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">Score proposals (value + cost) to plot them here.</p>
          ) : (
            <Matrix rows={plotted} />
          )}
        </Card>

        {/* Approved shortlist, rank-ordered */}
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Selected — priority order</h3>
            <span className="text-[11px] text-slate-400">approved · Σ {formatIdrShort(byStatus.find((b) => b.s === 'APPROVED')?.cost ?? 0)}</span>
          </div>
          {shortlist.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No approved proposals yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {shortlist.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 dark:border-slate-800">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{p.title}</div>
                    <div className="text-[11px] text-slate-400">{p.code} · score {p.weightedScore != null ? Number(p.weightedScore) : '—'} · {p.estCostIdr ? formatIdrShort(p.estCostIdr) : '—'}</div>
                  </div>
                  {isPmo && (
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0 || rank.isPending} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200" aria-label="Move up">▲</button>
                      <button onClick={() => move(i, 1)} disabled={i === shortlist.length - 1 || rank.isPending} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200" aria-label="Move down">▼</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span>Pipeline total (active): <b className="text-slate-700 dark:text-slate-200">{formatIdrShort(totalCost)}</b> cost · <b className="text-slate-700 dark:text-slate-200">{formatIdrShort(totalRev)}</b> revenue</span>
      </div>
    </div>
  );
}

// SVG bubble scatter: X = cost/effort (1..5), Y = business value (1..5), 2×2 quadrants.
function Matrix({ rows }: { rows: Proposal[] }) {
  const W = 480, H = 340, pad = 40;
  const x = (s: number) => pad + ((s - 1) / 4) * (W - pad * 2);
  const y = (s: number) => H - pad - ((s - 1) / 4) * (H - pad * 2);
  const maxCost = Math.max(1, ...rows.map((r) => Number(r.estCostIdr || 0)));
  const r = (c: number) => 7 + Math.sqrt(Math.max(0, c) / maxCost) * 15;
  const mx = x(3), my = y(3);
  const quad = [
    { xx: pad, yy: pad, w: mx - pad, h: my - pad, fill: '#22c55e', label: 'Quick wins' },
    { xx: mx, yy: pad, w: W - pad - mx, h: my - pad, fill: '#3b82f6', label: 'Big bets' },
    { xx: pad, yy: my, w: mx - pad, h: H - pad - my, fill: '#94a3b8', label: 'Fill-ins' },
    { xx: mx, yy: my, w: W - pad - mx, h: H - pad - my, fill: '#ef4444', label: 'Money pits' },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {quad.map((q) => (
        <g key={q.label}>
          <rect x={q.xx} y={q.yy} width={q.w} height={q.h} fill={q.fill} opacity="0.06" />
          <text x={q.xx + q.w / 2} y={q.yy + (q.label === 'Quick wins' || q.label === 'Big bets' ? 16 : q.h - 8)} textAnchor="middle" fontSize="10" fill={q.fill} opacity="0.9" fontWeight="700">{q.label}</text>
        </g>
      ))}
      {/* axes */}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#cbd5e1" strokeWidth="1" />
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">Cost / effort →</text>
      <text x={14} y={H / 2} textAnchor="middle" fontSize="10" fill="#64748b" transform={`rotate(-90 14 ${H / 2})`}>Business value →</text>
      {/* bubbles (deterministic jitter so equal scores don't fully overlap) */}
      {rows.map((p, i) => {
        const jx = ((i % 3) - 1) * 5, jy = (((i * 7) % 3) - 1) * 5;
        return (
          <g key={p.id}>
            <circle cx={x(p.scoreCost!) + jx} cy={y(p.scoreValue!) + jy} r={r(Number(p.estCostIdr || 0))} fill={HEX[p.status]} opacity="0.55" stroke={HEX[p.status]} strokeWidth="1.5">
              <title>{`${p.code} · ${p.title}\nvalue ${p.scoreValue}, effort ${p.scoreCost}\n${p.estCostIdr ? formatIdrShort(p.estCostIdr) : 'no cost'}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
