import type { Response } from 'express';

// In-process Server-Sent-Events hub for chat. The app runs as a single Node process on each
// deployment, so an in-memory registry of open streams keyed by userId is sufficient (no Redis).
// Events are tiny "pokes" — { conversationId } — that tell a client to refetch the relevant
// react-query keys, so the SSE layer never has to reproduce the REST payloads or ordering.

type Res = Response;
const clients = new Map<string, Set<Res>>();

// Cap the streams a single user may hold at once. A flaky client (laptop sleep, mobile
// backgrounding, nginx idle-cut) can reconnect before its old half-open sockets are reaped and
// stack several dead streams; without a cap those linger in the Map. When the cap is reached the
// oldest stream is closed on the next connect. 6 covers a few real tabs/devices with headroom.
const MAX_STREAMS_PER_USER = 6;

// The route layer registers this to announce a user going offline. Deriving the audience needs a
// DB lookup (the user's conversation partners), which is kept OUT of this DB-free hub — so eviction
// calls back through here instead of importing the service.
let offlineHandler: ((userId: string) => void) | null = null;
export function setOfflineHandler(fn: (userId: string) => void): void { offlineHandler = fn; }

// Register a stream. Returns true if this is the user's FIRST stream (they just came online).
export function addClient(userId: string, res: Res): boolean {
  let set = clients.get(userId);
  const wasOffline = !set || set.size === 0;
  if (!set) { set = new Set(); clients.set(userId, set); }
  // Evict the oldest stream(s) if this user is stacking too many. A Set preserves insertion order,
  // so the first entry is the oldest. The user stays online (still ≥1 stream), so no offline event.
  while (set.size >= MAX_STREAMS_PER_USER) {
    const oldest = set.values().next().value as Res | undefined;
    if (!oldest) break;
    set.delete(oldest);
    try { oldest.end(); } catch { /* already gone */ }
  }
  set.add(res);
  return wasOffline;
}

// Deregister a stream. Returns true if this was the user's LAST stream (they just went offline).
export function removeClient(userId: string, res: Res): boolean {
  const set = clients.get(userId);
  if (!set) return false;
  set.delete(res);
  if (set.size === 0) { clients.delete(userId); return true; }
  return false;
}

// Drop a stream whose socket is gone (a write failed but no 'close' has fired yet — a half-open
// connection) and, if it was the user's last, announce them offline. Previously write errors were
// swallowed and the dead Response leaked in the Map until (or unless) 'close' eventually arrived.
function evict(userId: string, res: Res): void {
  const wentOffline = removeClient(userId, res);
  try { res.end(); } catch { /* already destroyed */ }
  if (wentOffline && offlineHandler) offlineHandler(userId);
}

// Whether a user currently has at least one open stream (i.e. is "online").
export function isOnline(userId: string): boolean {
  return clients.has(userId);
}

// Of the given user ids, those currently online.
export function onlineAmong(userIds: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of userIds) if (clients.has(id)) out.push(id);
  return out;
}

function writeEvent(res: Res, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Push an event to every open stream of each given user (a user may have several tabs/devices).
// A write that throws means the socket is dead → collect and evict it after the loop (mutating the
// Map mid-iteration is unsafe), which also fires the offline transition if it was their last stream.
export function publishToUsers(userIds: Iterable<string>, event: string, data: unknown): void {
  const dead: Array<[string, Res]> = [];
  for (const uid of userIds) {
    const set = clients.get(uid);
    if (!set) continue;
    for (const res of set) {
      try { writeEvent(res, event, data); } catch { dead.push([uid, res]); }
    }
  }
  for (const [uid, res] of dead) evict(uid, res);
}

export function connectedClientCount(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

// Snapshot for the admin diagnostics endpoint: total open streams + distinct online users. Lets an
// operator watch whether stale connections accumulate over time (they should stay flat at rest).
export function sseStats(): { connections: number; users: number } {
  return { connections: connectedClientCount(), users: clients.size };
}

// A single shared heartbeat keeps connections alive through proxies (nginx default
// proxy_read_timeout is 60s; a comment every 25s resets it). Comments are ignored by EventSource.
// The heartbeat doubles as a liveness sweep: a ping that throws means the socket is gone, so the
// stream is evicted (a half-open socket that never emitted 'close' would otherwise leak).
let heartbeat: ReturnType<typeof setInterval> | null = null;
export function startSseHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    const dead: Array<[string, Res]> = [];
    for (const [uid, set] of clients) {
      for (const res of set) {
        try { res.write(': ping\n\n'); } catch { dead.push([uid, res]); }
      }
    }
    for (const [uid, res] of dead) evict(uid, res);
  }, 25_000);
  heartbeat.unref();
}
