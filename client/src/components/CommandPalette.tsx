import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { PROJECT_STATUS_DOT } from '../lib/labels';

type Cmd = { id: string; label: string; sub?: string; group: string; dot?: string; keywords?: string; run: () => void };

// Global quick-jump / command palette (⌘K / Ctrl-K). Search projects and jump
// anywhere, or run a quick action. Keyboard-first: ↑/↓ to move, Enter to run, Esc to close.
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/projects'), enabled: open });
  const projects = data?.projects ?? [];

  const go = (path: string) => { navigate(path); onClose(); };
  const cmds: Cmd[] = useMemo(() => {
    const isAdmin = user?.role === 'ADMIN';
    const isPortfolio = !!user && ['ADMIN', 'PMO', 'FINANCE'].includes(user.role);
    const nav: Cmd[] = [
      { id: 'nav-dash', group: 'Navigate', label: 'Dashboard', sub: 'Portfolio overview', keywords: 'home portfolio', run: () => go('/') },
      ...(isAdmin ? [{ id: 'nav-users', group: 'Navigate', label: 'Users', sub: 'Admin', keywords: 'accounts', run: () => go('/admin/users') } as Cmd] : []),
      ...(isPortfolio ? [{ id: 'nav-res', group: 'Navigate', label: 'Resource Pool', sub: 'Capacity & rates', keywords: 'resources capacity', run: () => go('/admin/resources') } as Cmd] : []),
      { id: 'nav-settings', group: 'Navigate', label: 'Settings', keywords: 'preferences theme language', run: () => go('/settings') },
      { id: 'nav-manual', group: 'Navigate', label: 'Manual', sub: 'Help & guide', keywords: 'help docs', run: () => go('/manual') },
    ];
    const proj: Cmd[] = projects.map((p) => ({
      id: `p-${p.id}`, group: 'Projects', label: p.name, sub: p.code, keywords: `${p.code} ${p.status}`,
      dot: PROJECT_STATUS_DOT[p.status] ?? 'bg-slate-400', run: () => go(`/projects/${p.id}`),
    }));
    const actions: Cmd[] = [
      { id: 'act-theme', group: 'Actions', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, keywords: 'theme dark light appearance', run: () => { toggle(); onClose(); } },
      { id: 'act-logout', group: 'Actions', label: 'Log out', keywords: 'signout exit', run: () => { onClose(); logout(); } },
    ];
    return [...nav, ...proj, ...actions];
  }, [projects, user, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cmds;
    return cmds.filter((c) => `${c.label} ${c.sub ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(s));
  }, [q, cmds]);

  useEffect(() => { setSel(0); }, [q, open]);
  useEffect(() => { if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  // Keep the selected row in view as you arrow through.
  useEffect(() => { listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  if (!open) return null;

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  // Group consecutive items by their group header, preserving overall index for selection.
  let idx = -1;
  const groups: { group: string; items: { c: Cmd; i: number }[] }[] = [];
  for (const c of filtered) {
    idx += 1;
    const last = groups[groups.length - 1];
    if (last && last.group === c.group) last.items.push({ c, i: idx });
    else groups.push({ group: c.group, items: [{ c, i: idx }] });
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 dark:border-slate-800">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search projects or jump to…"
            className="w-full bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          <kbd className="hidden shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 sm:block">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No matches for “{q}”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="mb-1">
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{g.group}</div>
                {g.items.map(({ c, i }) => (
                  <button
                    key={c.id}
                    data-sel={i === sel ? '1' : undefined}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => c.run()}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      i === sel ? 'bg-brand-600/10 text-brand-700 dark:text-brand-200' : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {c.dot ? <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} /> : <span className="grid h-4 w-4 shrink-0 place-items-center text-slate-400">›</span>}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.sub && <span className="shrink-0 font-mono text-xs text-slate-400 dark:text-slate-500">{c.sub}</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span><kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">↵</kbd> open</span>
          <span><kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
