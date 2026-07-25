import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { haptic } from '../lib/haptics';

// Floating chat bubble. On phones it sits in the bottom-right corner just above the tab bar's
// Timesheet quicklink (and above the page FAB when present); on desktop it drops to the true
// bottom-right corner. It's a frosted/translucent button that FADES + SLIDES in only when there
// are unread direct messages, so it stays out of the way otherwise. Tapping opens the Messages
// page. Hidden for guests (they can't message) and on the Messages page itself.
export default function ChatFab() {
  const { user } = useAuth();
  const loc = useLocation();
  const isGuest = user?.role === 'GUEST';

  const { data } = useQuery({
    queryKey: ['chat-unread'],
    queryFn: () => api.get<{ unread: number }>('/messages/unread-count'),
    enabled: !!user && !isGuest,
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;
  const show = !!user && !isGuest && unread > 0 && loc.pathname !== '/messages';

  return (
    <Link
      to="/messages"
      onClick={() => haptic()}
      aria-label={`${unread} new message${unread === 1 ? '' : 's'}`}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      // Phones: stacked above the FAB slot (4.75rem) so it clears the tab bar + a page FAB.
      // Desktop (md+): the true bottom-right corner (no tab bar there).
      className={`fixed right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-white/70 text-[#0073ea] shadow-lg shadow-slate-900/10 ring-1 ring-slate-200/80 backdrop-blur-md backdrop-saturate-150 transition-all duration-300 ease-out active:scale-90 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+4rem)] md:bottom-6 md:right-6 dark:bg-slate-800/70 dark:text-[#4c9bff] dark:ring-white/10 ${
        show ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-3 scale-90 opacity-0'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-[#e2445c] px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
        {unread > 99 ? '99+' : unread}
      </span>
    </Link>
  );
}
