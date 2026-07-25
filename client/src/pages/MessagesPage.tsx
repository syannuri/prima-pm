import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ChatContact, ChatConversation, ChatThread } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Input, PanelLoading } from '../components/ui';
import { useToast } from '../components/Toast';

// Initials avatar for a contact.
function Avatar({ name, className = '' }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300 ${className}`}>
      {initials}
    </span>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export default function MessagesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const me = user?.id ?? '';

  // The open conversation: an existing one (convId set) or a fresh contact (no convId yet).
  const [active, setActive] = useState<{ convId?: string; contact: ChatContact } | null>(null);
  const [draft, setDraft] = useState('');
  const [showNew, setShowNew] = useState(false);

  const convsQ = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => api.get<{ conversations: ChatConversation[] }>('/messages/conversations').then((r) => r.conversations),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  // Thread of the open conversation — polled while it's open.
  const threadQ = useQuery({
    queryKey: ['chat-thread', active?.convId],
    queryFn: () => api.get<ChatThread>(`/messages/conversations/${active!.convId}`),
    enabled: !!active?.convId,
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
  });

  // Opening/refetching a thread marks it read server-side → refresh the unread badges.
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

  // Auto-scroll the thread to the newest message.
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = threadQ.data?.messages;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, active?.convId]);

  const openConversation = (c: ChatConversation) => setActive({ convId: c.id, contact: c.other });
  const openContact = (c: ChatContact) => {
    setShowNew(false);
    // Reuse an existing conversation with this contact if one exists.
    const existing = convsQ.data?.find((cv) => cv.other.id === c.id);
    setActive(existing ? { convId: existing.id, contact: c } : { contact: c });
  };

  const submit = () => { const b = draft.trim(); if (b && !send.isPending) send.mutate(b); };

  const conversations = convsQ.data ?? [];
  const contacts = useMemo(() => contactsQ.data ?? [], [contactsQ.data]);

  if (convsQ.isLoading) return <PanelLoading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 sm:text-2xl">Messages</h1>
        <Button onClick={() => setShowNew((s) => !s)}>{showNew ? 'Close' : '+ New message'}</Button>
      </div>

      {showNew && (
        <Card className="!p-0">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">Start a conversation</div>
          <div className="max-h-64 overflow-y-auto">
            {contactsQ.isLoading ? <div className="p-4 text-sm text-slate-500">Loading contacts…</div>
              : contacts.length === 0 ? <div className="p-4 text-sm text-slate-500">No contacts available.</div>
              : contacts.map((c) => (
                <button key={c.id} onClick={() => openContact(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <Avatar name={c.name} className="h-8 w-8" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span><span className="block truncate text-xs text-slate-400">{c.role.replace(/_/g, ' ')}</span></span>
                </button>
              ))}
          </div>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        <div className="grid sm:grid-cols-[18rem_1fr]" style={{ height: 'calc(100vh - 12rem)' }}>
          {/* Conversation list — hidden on phones once a thread is open */}
          <div className={`border-r border-slate-100 dark:border-slate-800 sm:block ${active ? 'hidden' : 'block'} overflow-y-auto`}>
            {conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No conversations yet.<br />Tap “+ New message” to start one.</div>
            ) : conversations.map((c) => (
              <button key={c.id} onClick={() => openConversation(c)} className={`flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/60 ${active?.convId === c.id ? 'bg-brand-50/60 dark:bg-brand-900/15' : ''}`}>
                <Avatar name={c.other.name} className="h-9 w-9" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.other.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">{c.lastMessage ? dayOf(c.lastMessage.createdAt) : ''}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500 dark:text-slate-400">{c.lastMessage ? (c.lastMessage.senderId === me ? 'You: ' : '') + c.lastMessage.body : 'No messages yet'}</span>
                    {c.unread > 0 && <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{c.unread}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Thread */}
          <div className={`flex-col ${active ? 'flex' : 'hidden sm:flex'}`}>
            {!active ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-400">Select a conversation to start chatting.</div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <button onClick={() => setActive(null)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 sm:hidden" aria-label="Back">←</button>
                  <Avatar name={active.contact.name} className="h-8 w-8" />
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{active.contact.name}</span><span className="block truncate text-xs text-slate-400">{active.contact.role.replace(/_/g, ' ')}</span></span>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-4 dark:bg-slate-900/40">
                  {(threadQ.data?.messages ?? []).length === 0 ? (
                    <div className="grid h-full place-items-center text-xs text-slate-400">Say hello 👋</div>
                  ) : (threadQ.data?.messages ?? []).map((m) => {
                    const mine = m.senderId === me;
                    return (
                      <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-100'}`}>
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{timeOf(m.createdAt)}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={endRef} />
                </div>

                <div className="flex items-center gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
                  <Input aria-label="Message" placeholder="Type a message…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
                  <Button onClick={submit} disabled={!draft.trim() || send.isPending}>{send.isPending ? '…' : 'Send'}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
