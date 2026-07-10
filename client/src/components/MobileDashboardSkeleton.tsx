// Loading placeholder that mirrors the MobileDashboard layout (hero, quick
// actions, KPI tiles, project cards) so the shell doesn't jump when data
// arrives. Phones only — the desktop dashboard has its own AppShellSkeleton.
const Block = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800 ${className}`} />
);

export default function MobileDashboardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {/* Hero */}
      <div className="flex items-center gap-4 rounded-3xl bg-slate-200/80 p-5 dark:bg-slate-800/80">
        <div className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-slate-300 dark:bg-slate-700" />
        <div className="flex-1 space-y-2">
          <Block className="h-3 w-24 bg-slate-300 dark:bg-slate-700" />
          <Block className="h-6 w-32 bg-slate-300 dark:bg-slate-700" />
          <Block className="h-4 w-40 bg-slate-300 dark:bg-slate-700" />
        </div>
      </div>
      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2.5">
        <Block className="h-24" />
        <Block className="h-24" />
      </div>
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <Block className="h-3 w-20" />
            <Block className="h-6 w-24" />
          </div>
        ))}
      </div>
      {/* Projects */}
      <Block className="h-4 w-24" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <Block className="h-4 w-40" />
              <Block className="h-4 w-16" />
            </div>
            <Block className="h-2 w-full" />
            <div className="flex justify-between">
              <Block className="h-3 w-24" />
              <Block className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
