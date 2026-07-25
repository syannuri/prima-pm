import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { haptic } from '../lib/haptics';
import { useChat, ConversationList, ContactPicker, ChatThread } from './chat/chatCore';
import type { ChatContact } from '../api/types';

const CHAT_ICON = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';

// Persistent floating chat quick-link. The bubble is always available (bottom-right, above the
// mobile tab bar / bottom-right on desktop) with an unread badge; tapping it opens a COMPACT
// chat surface in-context — a bottom-sheet on phones, a floating card on desktop — so you can
// read/reply without leaving the current page. Hidden for guests and on the full Messages page.
export default function ChatWidget() {
  const { user } = useAuth();
  const loc = useLocation();
  const isGuest = user?.role === 'GUEST';
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['chat-unread'],
    queryFn: () => api.get<{ unread: number }>('/messages/unread-count'),
    enabled: !!user && !isGuest,
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;

  if (!user || isGuest || loc.pathname === '/messages') return null;

  if (open) return <ChatWidgetPanel onClose={() => setOpen(false)} />;

  return (
    <button
      onClick={() => { haptic(); setOpen(true); }}
      aria-label={`Chat${unread > 0 ? ` — ${unread} unread` : ''}`}
      className="fixed right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-[#0073ea] text-white shadow-lg shadow-[#0073ea]/30 ring-1 ring-black/5 transition-transform active:scale-90 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+4rem)] md:bottom-6 md:right-6"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={CHAT_ICON} /></svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-[#e2445c] px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">{unread > 99 ? '99+' : unread}</span>
      )}
    </button>
  );
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} aria-label={label} title={label} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">{children}</button>
);

function ChatWidgetPanel({ onClose }: { onClose: () => void }) {
  const chat = useChat();
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);

  const openFull = () => { onClose(); navigate('/messages'); };
  const pick = (c: ChatContact) => { setShowNew(false); chat.openContact(c); };
  const toggleNew = () => { setShowNew((s) => { if (!s) chat.loadContacts(); return !s; }); };

  const Expand = <IconBtn label="Open full page" onClick={openFull}><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></IconBtn>;
  const Close = <IconBtn label="Close" onClick={onClose}><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg></IconBtn>;

  return (
    <>
      {/* Scrim (phones) — tap to close */}
      <div onClick={onClose} className="fixed inset-0 z-[55] bg-black/30 sm:hidden" aria-hidden />
      {/* Panel: bottom-sheet on phones, floating card on desktop */}
      <div className="prima-slide-up fixed z-[56] flex flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10 inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[34rem] sm:max-h-none sm:w-[23rem] sm:rounded-2xl sm:pb-0">
        {chat.active ? (
          <ChatThread chat={chat} onBack={chat.closeThread} headerRight={<>{Expand}{Close}</>} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Messages</span>
              <span className="ml-auto flex items-center gap-1">
                <IconBtn label={showNew ? 'Close' : 'New message'} onClick={toggleNew}><span className="text-lg leading-none">{showNew ? '×' : '＋'}</span></IconBtn>
                {Expand}{Close}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {showNew
                ? <ContactPicker contacts={chat.contacts} loading={chat.contactsLoading} onPick={pick} />
                : chat.loading
                  ? <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
                  : <ConversationList conversations={chat.conversations} me={chat.me} onOpen={chat.openConversation} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}
