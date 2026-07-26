import { useSyncExternalStore } from 'react';

// Ephemeral live chat state (presence + typing) that ChatStream feeds from SSE and chat surfaces
// read. Kept OUT of react-query (it's transient, not fetched data). Values are replaced immutably
// on every change so useSyncExternalStore snapshots stay referentially stable between emits.

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => { for (const l of listeners) l(); };
function subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

// ---- Presence: the set of currently-online user ids (among the caller's conversation partners) ----
let online: ReadonlySet<string> = new Set();
const EMPTY_ONLINE: ReadonlySet<string> = new Set();

export function setPresence(userId: string, isOnline: boolean) {
  if (online.has(userId) === isOnline) return;
  const next = new Set(online);
  if (isOnline) next.add(userId); else next.delete(userId);
  online = next;
  emit();
}
export function setPresenceBulk(ids: string[]) {
  online = new Set(ids);
  emit();
}
export function useOnline(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => online, () => EMPTY_ONLINE);
}

// ---- Typing: conversationId -> (userId -> expiry timer). A ping (re)arms a ~4s auto-clear. ----
let typing: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const EMPTY_TYPING: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const TYPING_TTL = 4500;

export function setTyping(conversationId: string, userId: string) {
  const current = typing.get(conversationId);
  if (!current?.has(userId)) {
    const set = new Set(current ?? []);
    set.add(userId);
    const next = new Map(typing);
    next.set(conversationId, set);
    typing = next;
    emit();
  }
  const key = `${conversationId}|${userId}`;
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(key, setTimeout(() => clearTyping(conversationId, userId), TYPING_TTL));
}

export function clearTyping(conversationId: string, userId: string) {
  const key = `${conversationId}|${userId}`;
  const t = timers.get(key);
  if (t) { clearTimeout(t); timers.delete(key); }
  const current = typing.get(conversationId);
  if (!current?.has(userId)) return;
  const set = new Set(current);
  set.delete(userId);
  const next = new Map(typing);
  if (set.size) next.set(conversationId, set); else next.delete(conversationId);
  typing = next;
  emit();
}

export function useTypingMap(): ReadonlyMap<string, ReadonlySet<string>> {
  return useSyncExternalStore(subscribe, () => typing, () => EMPTY_TYPING);
}
