import { Skeleton } from './ui';

// Shown during the initial auth check instead of a lone spinner on a blank screen. An app-shell
// skeleton (sidebar + topbar + content placeholders) makes the first paint feel instant and
// on-brand rather than like an empty void.
export default function AppShellSkeleton() {
  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col gap-3 border-r border-slate-200 p-4 dark:border-slate-800 md:flex">
        <Skeleton className="h-9 w-40 rounded-lg" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
        </div>
        <Skeleton className="mt-6 h-3 w-20" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
      </aside>
      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-9 w-72 rounded-lg" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </header>
        <main className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        </main>
      </div>
    </div>
  );
}
