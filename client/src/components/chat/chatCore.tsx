import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fileUrl } from '../../api/client';
import type { ChatContact, ChatConversation, ChatConversationBase, ChatMember, ChatMessage, ChatSearchResult, ChatThread } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import { useOnline, useTypingMap } from '../../lib/chatLive';

// ---- Shared bits for the chat surfaces (full Messages page + the floating widget) ----

// monday.com-style people colours — each user gets a stable, vivid avatar colour.
const PERSON_COLORS = ['#ff642e', '#00c875', '#a25ddc', '#0086c0', '#e2445c', '#fdab3d', '#579bfc', '#ff158a', '#037f4c', '#9d50dd', '#00a9a5', '#cab641'];
export function personColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Avatar({ id, name, size = 40, online }: { id: string; name: string; size?: number; online?: boolean }) {
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span className="grid h-full w-full place-items-center rounded-full font-semibold text-white" style={{ background: personColor(id), fontSize: size * 0.36 }}>
        {initials(name)}
      </span>
      {online && <span className="absolute bottom-0 right-0 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" style={{ width: dot, height: dot }} title="Online" />}
    </span>
  );
}

// A group avatar: a stable-coloured tile with a people glyph (distinct from a person's round avatar).
export function GroupAvatar({ id, size = 40 }: { id: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-xl text-white" style={{ width: size, height: size, background: personColor(id) }}>
      <svg viewBox="0 0 24 24" style={{ width: size * 0.55, height: size * 0.55 }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    </span>
  );
}

// Avatar for a conversation: a person (DIRECT, with presence dot) or a group tile (GROUP).
function ConvAvatar({ conv, size = 44, online }: { conv: { id: string; type: 'DIRECT' | 'GROUP'; title: string; other: ChatContact | null }; size?: number; online?: boolean }) {
  return conv.type === 'GROUP' || !conv.other ? <GroupAvatar id={conv.id} size={size} /> : <Avatar id={conv.other.id} name={conv.other.name} size={size} online={online} />;
}

// "Alice is typing", "Alice & Bob are typing", or "Several people are typing".
function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} & ${names[1]} are typing…`;
  return 'Several people are typing…';
}

// Animated three-dot "typing" glyph.
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />)}
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
type ProjectLite = { id: string; code?: string; name: string };
// The open conversation. A brand-new DM has no convId yet (only `other`); everything else has one.
export type ActiveChat =
  | { convId?: string; type: 'DIRECT'; title: string; other: ChatContact; members?: ChatMember[]; iAmAdmin?: boolean; projectId?: string | null }
  | { convId: string; type: 'GROUP'; title: string; other: null; members: ChatMember[]; iAmAdmin?: boolean; projectId?: string | null }
  | null;

function activeFromConversation(c: ChatConversationBase): ActiveChat {
  return c.type === 'GROUP'
    ? { convId: c.id, type: 'GROUP', title: c.title, other: null, members: c.members, iAmAdmin: c.iAmAdmin, projectId: c.projectId }
    : { convId: c.id, type: 'DIRECT', title: c.title, other: c.other ?? { id: '', name: c.title, email: '', role: 'TEAM_MEMBER' as ChatContact['role'] }, members: c.members, iAmAdmin: c.iAmAdmin, projectId: c.projectId };
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

  // A message goes to an existing conversation (DIRECT or GROUP) by id, or starts a new DM to a user.
  const sendPath = (suffix = '') =>
    active?.convId ? `/messages/conversations/${active.convId}/messages${suffix}` : `/messages/to/${active!.other!.id}${suffix}`;

  const send = useMutation({
    mutationFn: (body: string) => api.post<{ conversationId: string }>(sendPath(), { body }),
    onSuccess: (res) => {
      setDraft('');
      if (!active?.convId) setActive((a) => (a ? { ...a, convId: res.conversationId } : a));
      qc.invalidateQueries({ queryKey: ['chat-thread', res.conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to send'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.patch(`/messages/messages/${id}`, { body }),
    onSuccess: () => {
      setEditingId(null); setEditDraft('');
      qc.invalidateQueries({ queryKey: ['chat-thread', active?.convId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to edit'),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.del(`/messages/messages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-thread', active?.convId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });

  const sendFile = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      if (draft.trim()) fd.append('body', draft.trim()); // optional caption from the composer
      return api.upload<{ conversationId: string }>(sendPath('/attachment'), fd);
    },
    onSuccess: (res) => {
      setDraft('');
      if (!active?.convId) setActive((a) => (a ? { ...a, convId: res.conversationId } : a));
      qc.invalidateQueries({ queryKey: ['chat-thread', res.conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to send file'),
  });

  // Group create + management. Each refreshes the conversation list; a create also opens the group.
  const createGroupMut = useMutation({
    mutationFn: (input: { title: string; memberIds: string[]; projectId?: string }) =>
      api.post<{ conversation: ChatConversationBase }>('/messages/groups', input),
    onSuccess: (res) => { setActive(activeFromConversation(res.conversation)); qc.invalidateQueries({ queryKey: ['chat-conversations'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create group'),
  });
  const groupAction = (fn: () => Promise<{ conversation: ChatConversationBase }>) =>
    fn().then((res) => {
      setActive(activeFromConversation(res.conversation));
      qc.invalidateQueries({ queryKey: ['chat-thread', res.conversation.id] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Action failed'));
  const renameGroup = (title: string) => active?.convId && groupAction(() => api.patch(`/messages/conversations/${active.convId}`, { title }));
  const addMembers = (userIds: string[]) => active?.convId && userIds.length > 0 && groupAction(() => api.post(`/messages/conversations/${active.convId}/members`, { userIds }));
  const removeMember = (userId: string) => active?.convId && groupAction(() => api.del(`/messages/conversations/${active.convId}/members/${userId}`));
  const leaveGroup = () => {
    if (active?.convId && window.confirm('Leave this group?')) {
      const id = active.convId;
      api.post(`/messages/conversations/${id}/leave`).then(() => {
        setActive(null);
        qc.invalidateQueries({ queryKey: ['chat-conversations'] });
        qc.invalidateQueries({ queryKey: ['chat-unread'] });
      }).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to leave'));
    }
  };

  // Debounce the search box so we don't hit the API on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const searchQ = useQuery({
    queryKey: ['chat-search', debouncedQuery],
    queryFn: () => api.get<{ results: ChatSearchResult[] }>(`/messages/search?q=${encodeURIComponent(debouncedQuery)}`).then((r) => r.results),
    enabled: !!user && !isGuest && debouncedQuery.length >= 2,
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
  const openConversation = (c: ChatConversation) => { setEditingId(null); setActive(activeFromConversation(c)); };
  const openContact = (c: ChatContact) => {
    setEditingId(null);
    const existing = conversations.find((cv) => cv.type === 'DIRECT' && cv.other?.id === c.id);
    setActive(existing ? activeFromConversation(existing) : { type: 'DIRECT', title: c.name, other: c });
  };
  const closeThread = () => { setEditingId(null); setActive(null); };

  // The freshest thread metadata (type/title/members/admin) once the thread has loaded — the header
  // and members panel read this so add/remove/rename reflect immediately; falls back to `active`.
  const header: ActiveChat = threadQ.data ? activeFromConversation(threadQ.data) : active;
  const submit = () => { const b = draft.trim(); if (b && !send.isPending) send.mutate(b); };
  const attachFile = (file: File | null | undefined) => { if (file && !sendFile.isPending) sendFile.mutate(file); };

  // Fire a "typing" ping at most once every 3s while composing (only for an existing conversation).
  const lastTyping = useRef(0);
  const notifyTyping = () => {
    const convId = active?.convId;
    if (!convId) return;
    const now = Date.now();
    if (now - lastTyping.current < 3000) return;
    lastTyping.current = now;
    api.post(`/messages/conversations/${convId}/typing`).catch(() => {});
  };

  const startEdit = (m: ChatMessage) => { setEditingId(m.id); setEditDraft(m.body); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(''); };
  const submitEdit = () => {
    const b = editDraft.trim();
    if (editingId && b && !editMut.isPending) editMut.mutate({ id: editingId, body: b });
  };
  const removeMessage = (m: ChatMessage) => {
    if (!delMut.isPending && window.confirm('Delete this message? This cannot be undone.')) delMut.mutate(m.id);
  };
  // Deep-link a search hit into its thread.
  const openSearchResult = (r: ChatSearchResult) => {
    setSearchQuery(''); setEditingId(null);
    setActive(r.conversation.type === 'GROUP'
      ? { convId: r.conversationId, type: 'GROUP', title: r.conversation.title, other: null, members: [] }
      : { convId: r.conversationId, type: 'DIRECT', title: r.conversation.title, other: r.conversation.other ?? { id: '', name: r.conversation.title, email: '', role: 'TEAM_MEMBER' as ChatContact['role'] } });
  };

  return {
    me, loading: convsQ.isLoading, conversations,
    contacts: contactsQ.data ?? [], contactsLoading: contactsQ.isLoading, loadContacts: () => contactsQ.refetch(),
    active, header, openConversation, openContact, closeThread,
    grouped, draft, setDraft, submit, sending: send.isPending, endRef, notifyTyping,
    attachFile, attaching: sendFile.isPending,
    editingId, editDraft, setEditDraft, startEdit, cancelEdit, submitEdit, editing: editMut.isPending, removeMessage,
    searchQuery, setSearchQuery, searchResults: searchQ.data ?? [], searchActive: debouncedQuery.length >= 2, searchLoading: searchQ.isFetching, openSearchResult,
    createGroup: (title: string, memberIds: string[], projectId?: string) => createGroupMut.mutate({ title, memberIds, projectId }),
    creatingGroup: createGroupMut.isPending,
    renameGroup, addMembers, removeMember, leaveGroup,
  };
}

export type ChatState = ReturnType<typeof useChat>;

// ---- Presentational pieces ----

export function ConversationList({ conversations, me, activeConvId, onOpen }: { conversations: ChatConversation[]; me: string; activeConvId?: string; onOpen: (c: ChatConversation) => void }) {
  const online = useOnline();
  const typingMap = useTypingMap();
  if (conversations.length === 0) {
    return <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No conversations yet.<br />Tap “New message” to start one.</div>;
  }
  return (
    <>
      {conversations.map((c) => {
        const isActive = activeConvId === c.id;
        const isOnline = c.type === 'DIRECT' && !!c.other && online.has(c.other.id);
        const someoneTyping = [...(typingMap.get(c.id) ?? [])].some((id) => id !== me);
        return (
          <button key={c.id} onClick={() => onOpen(c)} className={`relative flex w-full items-center gap-3 px-4 py-3 text-left transition ${isActive ? 'bg-brand-50/70 dark:bg-brand-900/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
            {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-500" />}
            <ConvAvatar conv={c} size={44} online={isOnline} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`flex min-w-0 items-center gap-1 truncate text-sm ${c.unread > 0 ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>
                  {c.type === 'GROUP' && <span className="shrink-0 text-slate-400" title="Group">👥</span>}
                  <span className="truncate">{c.title}</span>
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">{c.lastMessage ? dayLabel(c.lastMessage.createdAt).replace('Today', timeOf(c.lastMessage.createdAt)) : ''}</span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2">
                {someoneTyping
                  ? <span className="truncate text-xs font-medium text-[#0073ea]">typing…</span>
                  : <span className={`truncate text-xs ${c.lastMessage?.deleted ? 'italic text-slate-400 dark:text-slate-500' : c.unread > 0 ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>{c.lastMessage ? (c.lastMessage.deleted ? 'Message deleted' : (c.lastMessage.senderId === me ? 'You: ' : '') + c.lastMessage.body) : 'No messages yet'}</span>}
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
  const online = useOnline();
  if (loading) return <div className="p-4 text-sm text-slate-500">Loading contacts…</div>;
  if (contacts.length === 0) return <div className="p-4 text-sm text-slate-500">No contacts available.</div>;
  return (
    <>
      {contacts.map((c) => (
        <button key={c.id} onClick={() => onPick(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
          <Avatar id={c.id} name={c.name} size={36} online={online.has(c.id)} />
          <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span><span className="block truncate text-xs text-slate-400">{c.role.replace(/_/g, ' ').toLowerCase()}</span></span>
        </button>
      ))}
    </>
  );
}

// Search hits across the caller's conversations — each row deep-links into its thread with the
// matched text highlighted.
function highlight(body: string, q: string): ReactNode {
  const i = body.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return body;
  return (<>{body.slice(0, i)}<mark className="rounded bg-amber-200 px-0.5 text-slate-900 dark:bg-amber-500/40 dark:text-amber-100">{body.slice(i, i + q.length)}</mark>{body.slice(i + q.length)}</>);
}

export function SearchResults({ results, query, loading, me, onOpen }: { results: ChatSearchResult[]; query: string; loading: boolean; me: string; onOpen: (r: ChatSearchResult) => void }) {
  if (loading) return <div className="p-4 text-sm text-slate-500">Searching…</div>;
  if (results.length === 0) return <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No messages match “{query}”.</div>;
  return (
    <>
      {results.map((r) => {
        const isGroup = r.conversation.type === 'GROUP';
        // In a group, show who sent it; in a DM, "You: " for your own.
        const prefix = r.senderId === me ? 'You: ' : isGroup ? `${r.senderName}: ` : '';
        return (
          <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <ConvAvatar conv={r.conversation} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.conversation.title}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{dayLabel(r.createdAt).replace('Today', timeOf(r.createdAt))}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{prefix}{highlight(r.body, query)}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}

// A rounded search input for the conversation panel.
export function ChatSearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 focus-within:border-[#0073ea] focus-within:bg-white dark:border-slate-700 dark:bg-slate-800">
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input aria-label="Search messages" placeholder="Search messages…" value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-100" />
      {value && <button onClick={() => onChange('')} aria-label="Clear search" className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">×</button>}
    </div>
  );
}

const humanSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

// An attachment inside a bubble: images render inline (tap → open full size); other files show a
// download chip. The <img>/download both ride the same-origin session cookie.
function MessageAttachment({ m, mine }: { m: ChatMessage; mine: boolean }) {
  if (!m.attachment) return null;
  const url = fileUrl(`/messages/messages/${m.id}/file`);
  if (m.attachment.mime.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 block overflow-hidden rounded-xl">
        <img src={url} alt={m.attachment.name} loading="lazy" className="max-h-64 w-auto max-w-full rounded-xl object-cover" />
      </a>
    );
  }
  const download = () => { api.download(`/messages/messages/${m.id}/file`, m.attachment!.name).catch(() => {}); };
  return (
    <button onClick={download} className={`mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${mine ? 'bg-white/15 hover:bg-white/25' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700'}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg ${mine ? 'bg-white/20' : 'bg-white dark:bg-slate-800'}`}>📎</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{m.attachment.name}</span>
        <span className={`block text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{humanSize(m.attachment.size)} · tap to download</span>
      </span>
    </button>
  );
}

// The thread body: sticky header (+ optional back), grouped messages, pinned composer. The parent
// supplies the sized/positioned container; this fills it (h-full flex-col). `safeArea` adds
// top/bottom safe-area padding for the phone full-screen surface.
export function ChatThread({ chat, onBack, showBack = true, backMobileOnly = false, safeArea = false, headerRight }: { chat: ChatState; onBack: () => void; showBack?: boolean; backMobileOnly?: boolean; safeArea?: boolean; headerRight?: ReactNode }) {
  const { active, header, grouped, me, draft, setDraft, submit, sending, endRef, editingId, editDraft, setEditDraft, startEdit, cancelEdit, submitEdit, editing, removeMessage, attachFile, attaching, notifyTyping } = chat;
  const fileRef = useRef<HTMLInputElement>(null);
  const [showInfo, setShowInfo] = useState(false);
  const onlineSet = useOnline();
  const typingMap = useTypingMap();
  if (!active || !header) return null;
  const isGroup = header.type === 'GROUP';
  const members = header.members ?? [];
  // Resolve a message sender to a contact (for the incoming avatar + group sender label).
  const senderOf = (id: string): ChatContact => members.find((mm) => mm.id === id) ?? header.other ?? { id, name: '?', email: '', role: 'TEAM_MEMBER' as ChatContact['role'] };
  const typerIds = header.convId ? [...(typingMap.get(header.convId) ?? [])].filter((id) => id !== me) : [];
  const typerNames = typerIds.map((id) => senderOf(id).name);
  const otherOnline = !isGroup && !!header.other && onlineSet.has(header.other.id);
  const subtitle = typerIds.length
    ? (isGroup ? typingLabel(typerNames) : 'typing…')
    : (isGroup ? `${members.length} member${members.length === 1 ? '' : 's'} · tap for info` : otherOnline ? 'Online' : header.other?.role.replace(/_/g, ' ').toLowerCase());
  return (
    <div className="relative flex h-full flex-col bg-[#f6f7fb] dark:bg-slate-950">
      <div className={`flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-4 pb-3 dark:border-slate-800 dark:bg-slate-800/60 ${safeArea ? 'pt-[calc(env(safe-area-inset-top)+0.75rem)]' : 'pt-3'}`}>
        {showBack && <button onClick={onBack} className={`-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 hover:bg-white/70 dark:hover:bg-slate-700 ${backMobileOnly ? 'sm:hidden' : ''}`} aria-label="Back">←</button>}
        <button onClick={() => isGroup && setShowInfo(true)} className={`flex min-w-0 flex-1 items-center gap-3 text-left ${isGroup ? '' : 'cursor-default'}`}>
          <ConvAvatar conv={{ id: header.convId ?? '', type: header.type, title: header.title, other: header.other }} size={38} online={otherOnline} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{header.title}</span>
            <span className={`block truncate text-xs ${typerIds.length ? 'font-medium text-[#0073ea]' : otherOnline ? 'text-emerald-500' : 'text-slate-400'}`}>{subtitle}</span>
          </span>
        </button>
        {isGroup && <button onClick={() => setShowInfo(true)} aria-label="Group info" title="Group info" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/70 dark:hover:bg-slate-700"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg></button>}
        {headerRight && <span className="flex shrink-0 items-center gap-1">{headerRight}</span>}
      </div>
      {showInfo && isGroup && <GroupInfoPanel chat={chat} onClose={() => setShowInfo(false)} />}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4">
        {grouped.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-slate-400">Say hello 👋</div>
        ) : grouped.map((it) => it.type === 'day' ? (
          <div key={it.key} className="flex justify-center py-2">
            <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{it.label}</span>
          </div>
        ) : (() => {
          const m = it.m, mine = m.senderId === me;

          // Tombstone for a deleted message — no bubble chrome, no actions.
          if (m.deleted) {
            return (
              <div key={m.id} className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${it.firstOfRun ? 'mt-2' : ''}`}>
                {!mine && (it.firstOfRun ? <Avatar id={senderOf(m.senderId).id} name={senderOf(m.senderId).name} size={28} /> : <span className="w-7 shrink-0" />)}
                <div className="max-w-[78%] rounded-2xl px-3.5 py-2 text-xs italic text-slate-400 ring-1 ring-slate-200/70 dark:text-slate-500 dark:ring-slate-700/70">🚫 This message was deleted</div>
              </div>
            );
          }

          // Inline editor for my own message.
          if (mine && editingId === m.id) {
            return (
              <div key={m.id} className={`flex justify-end ${it.firstOfRun ? 'mt-2' : ''}`}>
                <div className="w-full max-w-[85%]">
                  <input
                    autoFocus aria-label="Edit message" value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                    className="w-full rounded-2xl border border-[#0073ea] bg-white px-3.5 py-2 text-sm text-slate-700 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                  />
                  <div className="mt-1 flex justify-end gap-3 text-[11px]">
                    <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Cancel</button>
                    <button onClick={submitEdit} disabled={!editDraft.trim() || editing} className="font-semibold text-[#0073ea] disabled:opacity-40">Save</button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={m.id} className={`group flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${it.firstOfRun ? 'mt-2' : ''}`}>
              {!mine && (it.firstOfRun ? <Avatar id={senderOf(m.senderId).id} name={senderOf(m.senderId).name} size={28} /> : <span className="w-7 shrink-0" />)}
              {mine && (
                <span className="flex shrink-0 items-center gap-0.5 self-center opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                  <button onClick={() => startEdit(m)} aria-label="Edit message" title="Edit" className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                  </button>
                  <button onClick={() => removeMessage(m)} aria-label="Delete message" title="Delete" className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40 dark:hover:text-red-400">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                  </button>
                </span>
              )}
              <div className={`max-w-[78%] px-3.5 py-2 text-sm shadow-sm ${mine
                ? `rounded-2xl ${it.firstOfRun ? 'rounded-tr-md' : ''} bg-[#0073ea] text-white`
                : `rounded-2xl ${it.firstOfRun ? 'rounded-tl-md' : ''} bg-white text-slate-700 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700`}`}>
                {isGroup && !mine && it.firstOfRun && <div className="mb-0.5 text-[11px] font-semibold" style={{ color: personColor(m.senderId) }}>{senderOf(m.senderId).name}</div>}
                {m.body && <div className="whitespace-pre-wrap break-words leading-snug">{m.body}</div>}
                <MessageAttachment m={m} mine={mine} />
                <div className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{m.editedAt ? 'edited · ' : ''}{timeOf(m.createdAt)}</div>
              </div>
            </div>
          );
        })())}
        {typerIds.length > 0 && (
          <div className="flex items-end gap-2">
            <Avatar id={typerIds[0]} name={senderOf(typerIds[0]).name} size={28} />
            <div className="rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"><TypingDots /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={`border-t border-slate-100 bg-white px-3 pt-3 dark:border-slate-800 dark:bg-slate-900 ${safeArea ? 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]' : 'pb-3'}`}>
        <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-2 pr-1.5 focus-within:border-[#0073ea] focus-within:bg-white dark:border-slate-700 dark:bg-slate-800">
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.xlsx,.docx,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf" onChange={(e) => { attachFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} disabled={attaching} aria-label="Attach file" title="Attach file" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-200">
            {attaching
              ? <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" /></svg>
              : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>}
          </button>
          <input aria-label="Message" placeholder="Type a message…" value={draft} onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim()) notifyTyping(); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-100" />
          <button onClick={submit} disabled={!draft.trim() || sending} aria-label="Send" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0073ea] text-white transition enabled:hover:bg-[#0060b9] disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-4 w-4 -ml-px" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Group info + management overlay (covers the thread). Admins can rename, add/remove members;
// anyone can leave. Reads live member state from chat.header.
export function GroupInfoPanel({ chat, onClose }: { chat: ChatState; onClose: () => void }) {
  const { header, me, contacts, loadContacts, renameGroup, addMembers, removeMember, leaveGroup } = chat;
  const online = useOnline();
  const members = header?.members ?? [];
  const iAmAdmin = !!header?.iAmAdmin;
  const [title, setTitle] = useState(header?.title ?? '');
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { if (showAdd) loadContacts(); }, [showAdd, loadContacts]);
  const memberIds = new Set(members.map((m) => m.id));
  const addable = contacts.filter((c) => !memberIds.has(c.id));

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">←</button>
        <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Group info</span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-col items-center gap-2 py-2">
          <GroupAvatar id={header?.convId ?? ''} size={64} />
          {iAmAdmin ? (
            <div className="flex w-full max-w-xs items-center gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-sm font-semibold text-slate-800 focus:border-[#0073ea] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
              {title.trim() && title.trim() !== header?.title && <button onClick={() => renameGroup(title.trim())} className="shrink-0 text-xs font-semibold text-[#0073ea]">Save</button>}
            </div>
          ) : (
            <span className="text-base font-bold text-slate-800 dark:text-slate-100">{header?.title}</span>
          )}
          <span className="text-xs text-slate-400">{members.length} member{members.length === 1 ? '' : 's'}</span>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Members</span>
            {iAmAdmin && <button onClick={() => setShowAdd((s) => !s)} className="text-xs font-semibold text-[#0073ea]">{showAdd ? 'Done' : '+ Add people'}</button>}
          </div>

          {showAdd && (
            <div className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
              {addable.length === 0 ? <div className="p-3 text-xs text-slate-400">Everyone is already in this group.</div> : addable.map((c) => (
                <button key={c.id} onClick={() => addMembers([c.id])} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <Avatar id={c.id} name={c.name} size={30} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{c.name}</span>
                  <span className="text-xs font-semibold text-[#0073ea]">Add</span>
                </button>
              ))}
            </div>
          )}

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <Avatar id={m.id} name={m.name} size={34} online={m.id !== me && online.has(m.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{m.name}{m.id === me ? ' (you)' : ''}</span>
                  <span className="block truncate text-xs text-slate-400">{m.role.replace(/_/g, ' ').toLowerCase()}</span>
                </span>
                {m.isAdmin && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Admin</span>}
                {iAmAdmin && m.id !== me && <button onClick={() => removeMember(m.id)} aria-label={`Remove ${m.name}`} className="shrink-0 text-xs font-medium text-red-500 hover:underline">Remove</button>}
              </li>
            ))}
          </ul>
        </div>

        <button onClick={leaveGroup} className="w-full rounded-lg border border-red-200 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20">Leave group</button>
      </div>
    </div>
  );
}

// New-group form: a name, an optional project link, and a multi-select of members (need 2+).
export function NewGroupForm({ chat, onCreated }: { chat: ChatState; onCreated: () => void }) {
  const { contacts, contactsLoading, loadContacts, createGroup, creatingGroup } = chat;
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { loadContacts(); }, [loadContacts]);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: ProjectLite[] }>('/projects') });
  const projects = projectsQ.data?.projects ?? [];

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const onProject = (id: string) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p && !title.trim()) setTitle(p.code ? `${p.code} · ${p.name}` : p.name);
  };
  const canCreate = title.trim().length > 0 && picked.size >= 2 && !creatingGroup;
  const create = () => { if (canCreate) { createGroup(title.trim(), [...picked], projectId || undefined); onCreated(); } };

  return (
    <div className="flex flex-col">
      <div className="space-y-2 border-b border-slate-100 p-3 dark:border-slate-800">
        <input aria-label="Group name" placeholder="Group name" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#0073ea] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        <select aria-label="Link to project" value={projectId} onChange={(e) => onProject(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-[#0073ea] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <option value="">Link to a project (optional)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>)}
        </select>
        <div className="text-[11px] text-slate-400">Pick at least 2 people below.</div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {contactsLoading ? <div className="p-4 text-sm text-slate-500">Loading…</div> : contacts.map((c) => {
          const on = picked.has(c.id);
          return (
            <button key={c.id} onClick={() => toggle(c.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <Avatar id={c.id} name={c.name} size={34} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span><span className="block truncate text-xs text-slate-400">{c.role.replace(/_/g, ' ').toLowerCase()}</span></span>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${on ? 'border-[#0073ea] bg-[#0073ea] text-white' : 'border-slate-300 dark:border-slate-600'}`}>{on ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
        <button onClick={create} disabled={!canCreate} className="w-full rounded-full bg-brand-600 py-2 text-sm font-semibold text-white transition enabled:hover:bg-brand-700 disabled:opacity-40">{creatingGroup ? 'Creating…' : `Create group${picked.size ? ` (${picked.size})` : ''}`}</button>
      </div>
    </div>
  );
}
