import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ChatContact, ChatConversation, ChatMessage, ChatThread } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Card, PanelLoading } from '../components/ui';
import { useToast } from '../components/Toast';

// monday.com-style people colours — each user gets a stable, vivid avatar colour from this palette.
const PERSON_COLORS = ['#ff642e', '#00c875', '#a25ddc', '#0086c0', '#e2445c', '#fdab3d', '#579bfc', '#ff158a', '#037f4c', '#9d50dd', '#00a9a5', '#cab641'];
function personColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: personColor(id), fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string): string {
  const d = new Date(iso), t = new Date();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

export default function MessagesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const me = user?.id ?? '';

  const [active, setActive] = useState<{ convId?: string; contact: ChatContact } | null>(null);
  const [draft, setDraft] = useState('');
  const [showNew, setShowNew] = useState(false);

  const convsQ = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => api.get<{ conversations: ChatConversation[] }>('/messages/conversations').then((r) => r.conversations),
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
    enabled: showNew,
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

  const openConversation = (c: ChatConversation) => setActive({ convId: c.id, contact: c.other });
  const openContact = (c: ChatContact) => {
    setShowNew(false);
    const existing = convsQ.data?.find((cv) => cv.other.id === c.id);
    setActive(existing ? { convId: existing.id, contact: c } : { contact: c });
  };
  const submit = () => { const b = draft.trim(); if (b && !send.isPending) send.mutate(b); };

  const conversations = convsQ.data ?? [];
  const contacts = useMemo(() => contactsQ.data ?? [], [contactsQ.data]);

  // Group thread messages into blocks by (sender, run) with day separators.
  const grouped = useMemo(() => {
    const items: Array<{ type: 'day'; label: string; key: string } | { type: 'msg'; m: ChatMessage; firstOfRun: boolean }> = [];
    let lastDay = '', lastSender = '';
    for (const m of threadQ.data?.messages ?? []) {
      const dk = dayKey(m.createdAt);
      if (dk !== lastDay) { items.push({ type: 'day', label: dayLabel(m.createdAt), key: 'day-' + dk }); lastDay = dk; lastSender = ''; }
      items.push({ type: 'msg', m, firstOfRun: m.senderId !== lastSender });
      lastSender = m.senderId;
    }
    return items;
  }, [threadQ.data]);

  if (convsQ.isLoading) return <PanelLoading />;

  return (
    <div className="space-y-4">
      <div className={`items-center justify-between ${active ? 'hidden sm:flex' : 'flex'}`}>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 sm:text-2xl">Messages</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Private 1-to-1 chat with your team</p>
        </div>
        <button onClick={() => setShowNew((s) => !s)} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
          <span className="text-base leading-none">＋</span> {showNew ? 'Close' : 'New message'}
        </button>
      </div>

      {showNew && (
        <Card className="!p-0 overflow-hidden !rounded-2xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">Start a conversation</div>
          <div className="max-h-72 overflow-y-auto">
            {contactsQ.isLoading ? <div className="p-4 text-sm text-slate-500">Loading contacts…</div>
              : contacts.length === 0 ? <div className="p-4 text-sm text-slate-500">No contacts available.</div>
              : contacts.map((c) => (
                <button key={c.id} onClick={() => openContact(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <Avatar id={c.id} name={c.name} size={36} />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span><span className="block truncate text-xs text-slate-400">{c.role.replace(/_/g, ' ').toLowerCase()}</span></span>
                </button>
              ))}
          </div>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden shadow-sm -mx-4 !rounded-none sm:mx-0 sm:!rounded-2xl">
        <div className="grid sm:grid-cols-[20rem_1fr]" style={{ height: 'calc(100vh - 11rem)' }}>
          {/* Conversation list */}
          <div className={`border-r border-slate-100 dark:border-slate-800 sm:block ${active ? 'hidden' : 'block'} overflow-y-auto bg-white dark:bg-slate-900`}>
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No conversations yet.<br />Tap “New message” to start one.</div>
            ) : conversations.map((c) => {
              const isActive = active?.convId === c.id;
              return (
                <button key={c.id} onClick={() => openConversation(c)} className={`relative flex w-full items-center gap-3 px-4 py-3 text-left transition ${isActive ? 'bg-brand-50/70 dark:bg-brand-900/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
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
          </div>

          {/* Thread — on phones an immersive full-screen overlay (covers the app header + tab bar);
              a normal grid cell on sm+ (two-pane). */}
          <div className={`bg-[#f6f7fb] dark:bg-slate-950 ${active ? 'fixed inset-0 z-50 flex flex-col sm:static sm:z-auto sm:flex' : 'hidden flex-col sm:flex'}`}>
            {!active ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-400">
                <div><div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">💬</div>Select a conversation to start chatting.</div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] dark:border-slate-800 dark:bg-slate-900 sm:pt-3">
                  <button onClick={() => setActive(null)} className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 sm:hidden" aria-label="Back">←</button>
                  <Avatar id={active.contact.id} name={active.contact.name} size={38} />
                  <span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{active.contact.name}</span><span className="block truncate text-xs text-slate-400">{active.contact.role.replace(/_/g, ' ').toLowerCase()}</span></span>
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
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

                <div className="border-t border-slate-100 bg-white px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] dark:border-slate-800 dark:bg-slate-900 sm:pb-3">
                  <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-4 pr-1.5 focus-within:border-[#0073ea] focus-within:bg-white dark:border-slate-700 dark:bg-slate-800">
                    <input
                      aria-label="Message"
                      placeholder="Type a message…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                    />
                    <button onClick={submit} disabled={!draft.trim() || send.isPending} aria-label="Send" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0073ea] text-white transition enabled:hover:bg-[#0060b9] disabled:opacity-40">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 -ml-px" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
