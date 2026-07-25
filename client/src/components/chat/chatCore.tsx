import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { ChatContact, ChatConversation, ChatMessage, ChatThread } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';

// ---- Shared bits for the chat surfaces (full Messages page + the floating widget) ----

// monday.com-style people colours — each user gets a stable, vivid avatar colour.
const PERSON_COLORS = ['#ff642e', '#00c875', '#a25ddc', '#0086c0', '#e2445c', '#fdab3d', '#579bfc', '#ff158a', '#037f4c', '#9d50dd', '#00a9a5', '#cab641'];
export function personColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: personColor(id), fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();
export function dayLabel(iso: string): string {
  const d = new Date(iso), t = new Date();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

type GroupedItem = { type: 'day'; label: string; key: string } | { type: 'msg'; m: ChatMessage; firstOfRun: boolean };
export type ActiveChat = { convId?: string; contact: ChatContact } | null;

// All chat state + queries + actions. Each surface (page / widget) gets its own instance; the
// TanStack queries dedupe by key so there are no duplicate fetches.
export function useChat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const me = user?.id ?? '';
  const isGuest = user?.role === 'GUEST';

  const [active, setActive] = useState<ActiveChat>(null);
  const [draft, setDraft] = useState('');

  const convsQ = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => api.get<{ conversations: ChatConversation[] }>('/messages/conversations').then((r) => r.conversations),
    enabled: !!user && !isGuest,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const threadQ = useQuery({
    queryKey: ['chat-thread', active?.convId],
    queryFn: () => api.get<ChatThread>(`/messages/conversations/${active!.convId}`),
    enabled: !!active?.convId,
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (threadQ.data) {
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  }, [threadQ.data, qc]);

  const contactsQ = useQuery({
    queryKey: ['chat-contacts'],
    queryFn: () => api.get<{ contacts: ChatContact[] }>('/messages/contacts').then((r) => r.contacts),
    enabled: false, // fetched on demand — call contactsQ.refetch() when the picker opens
  });

  const send = useMutation({
    mutationFn: (body: string) => api.post<{ conversationId: string }>(`/messages/to/${active!.contact.id}`, { body }),
    onSuccess: (res) => {
      setDraft('');
      if (!active?.convId) setActive((a) => (a ? { ...a, convId: res.conversationId } : a));
      qc.invalidateQueries({ queryKey: ['chat-thread', res.conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to send'),
  });

  const endRef = useRef<HTMLDivElement>(null);
  const msgs = threadQ.data?.messages;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, active?.convId]);

  const grouped = useMemo<GroupedItem[]>(() => {
    const items: GroupedItem[] = [];
    let lastDay = '', lastSender = '';
    for (const m of threadQ.data?.messages ?? []) {
      const dk = dayKey(m.createdAt);
      if (dk !== lastDay) { items.push({ type: 'day', label: dayLabel(m.createdAt), key: 'day-' + dk }); lastDay = dk; lastSender = ''; }
      items.push({ type: 'msg', m, firstOfRun: m.senderId !== lastSender });
      lastSender = m.senderId;
    }
    return items;
  }, [threadQ.data]);

  const conversations = convsQ.data ?? [];
  const openConversation = (c: ChatConversation) => setActive({ convId: c.id, contact: c.other });
  const openContact = (c: ChatContact) => {
    const existing = conversations.find((cv) => cv.other.id === c.id);
    setActive(existing ? { convId: existing.id, contact: c } : { contact: c });
  };
  const closeThread = () => setActive(null);
  const submit = () => { const b = draft.trim(); if (b && !send.isPending) send.mutate(b); };

  return {
    me, loading: convsQ.isLoading, conversations,
    contacts: contactsQ.data ?? [], contactsLoading: contactsQ.isLoading, loadContacts: () => contactsQ.refetch(),
    active, openConversation, openContact, closeThread,
    grouped, draft, setDraft, submit, sending: send.isPending, endRef,
  };
}

export type ChatState = ReturnType<typeof useChat>;

// ---- Presentational pieces ----

export function ConversationList({ conversations, me, activeConvId, onOpen }: { conversations: ChatConversation[]; me: string; activeConvId?: string; onOpen: (c: ChatConversation) => void }) {
  if (conversations.length === 0) {
    return <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No conversations yet.<br />Tap “New message” to start one.</div>;
  }
  return (
    <>
      {conversations.map((c) => {
        const isActive = activeConvId === c.id;
        return (
          <button key={c.id} onClick={() => onOpen(c)} className={`relative flex w-full items-center gap-3 px-4 py-3 text-left transition ${isActive ? 'bg-brand-50/70 dark:bg-brand-900/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
            {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-500" />}
            <Avatar id={c.other.id} name={c.other.name} size={44} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${c.unread > 0 ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>{c.other.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{c.lastMessage ? dayLabel(c.lastMessage.createdAt).replace('Today', timeOf(c.lastMessage.createdAt)) : ''}</span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2">
                <span className={`truncate text-xs ${c.unread > 0 ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>{c.lastMessage ? (c.lastMessage.senderId === me ? 'You: ' : '') + c.lastMessage.body : 'No messages yet'}</span>
                {c.unread > 0 && <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}

export function ContactPicker({ contacts, loading, onPick }: { contacts: ChatContact[]; loading: boolean; onPick: (c: ChatContact) => void }) {
  if (loading) return <div className="p-4 text-sm text-slate-500">Loading contacts…</div>;
  if (contacts.length === 0) return <div className="p-4 text-sm text-slate-500">No contacts available.</div>;
  return (
    <>
      {contacts.map((c) => (
        <button key={c.id} onClick={() => onPick(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
          <Avatar id={c.id} name={c.name} size={36} />
          <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span><span className="block truncate text-xs text-slate-400">{c.role.replace(/_/g, ' ').toLowerCase()}</span></span>
        </button>
      ))}
    </>
  );
}

// The thread body: sticky header (+ optional back), grouped messages, pinned composer. The parent
// supplies the sized/positioned container; this fills it (h-full flex-col). `safeArea` adds
// top/bottom safe-area padding for the phone full-screen surface.
export function ChatThread({ chat, onBack, showBack = true, safeArea = false, headerRight }: { chat: ChatState; onBack: () => void; showBack?: boolean; safeArea?: boolean; headerRight?: ReactNode }) {
  const { active, grouped, me, draft, setDraft, submit, sending, endRef } = chat;
  if (!active) return null;
  return (
    <div className="flex h-full flex-col bg-[#f6f7fb] dark:bg-slate-950">
      <div className={`flex items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 dark:border-slate-800 dark:bg-slate-900 ${safeArea ? 'pt-[calc(env(safe-area-inset-top)+0.75rem)]' : 'pt-3'}`}>
        {showBack && <button onClick={onBack} className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Back">←</button>}
        <Avatar id={active.contact.id} name={active.contact.name} size={38} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{active.contact.name}</span><span className="block truncate text-xs text-slate-400">{active.contact.role.replace(/_/g, ' ').toLowerCase()}</span></span>
        {headerRight && <span className="flex shrink-0 items-center gap-1">{headerRight}</span>}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4">
        {grouped.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-slate-400">Say hello 👋</div>
        ) : grouped.map((it) => it.type === 'day' ? (
          <div key={it.key} className="flex justify-center py-2">
            <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{it.label}</span>
          </div>
        ) : (() => {
          const m = it.m, mine = m.senderId === me;
          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${it.firstOfRun ? 'mt-2' : ''}`}>
              {!mine && (it.firstOfRun ? <Avatar id={active.contact.id} name={active.contact.name} size={28} /> : <span className="w-7 shrink-0" />)}
              <div className={`max-w-[78%] px-3.5 py-2 text-sm shadow-sm ${mine
                ? `rounded-2xl ${it.firstOfRun ? 'rounded-tr-md' : ''} bg-[#0073ea] text-white`
                : `rounded-2xl ${it.firstOfRun ? 'rounded-tl-md' : ''} bg-white text-slate-700 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700`}`}>
                <div className="whitespace-pre-wrap break-words leading-snug">{m.body}</div>
                <div className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{timeOf(m.createdAt)}</div>
              </div>
            </div>
          );
        })())}
        <div ref={endRef} />
      </div>

      <div className={`border-t border-slate-100 bg-white px-3 pt-3 dark:border-slate-800 dark:bg-slate-900 ${safeArea ? 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]' : 'pb-3'}`}>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-4 pr-1.5 focus-within:border-[#0073ea] focus-within:bg-white dark:border-slate-700 dark:bg-slate-800">
          <input aria-label="Message" placeholder="Type a message…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-100" />
          <button onClick={submit} disabled={!draft.trim() || sending} aria-label="Send" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0073ea] text-white transition enabled:hover:bg-[#0060b9] disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-4 w-4 -ml-px" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
