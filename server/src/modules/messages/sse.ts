import type { Response } from 'express';

// In-process Server-Sent-Events hub for chat. The app runs as a single Node process on each
// deployment, so an in-memory registry of open streams keyed by userId is sufficient (no Redis).
// Events are tiny "pokes" — { conversationId } — that tell a client to refetch the relevant
// react-query keys, so the SSE layer never has to reproduce the REST payloads or ordering.

type Res = Response;
const clients = new Map<string, Set<Res>>();

// Register a stream. Returns true if this is the user's FIRST stream (they just came online).
export function addClient(userId: string, res: Res): boolean {
  let set = clients.get(userId);
  const wasOffline = !set || set.size === 0;
  if (!set) { set = new Set(); clients.set(userId, set); }
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
export function publishToUsers(userIds: Iterable<string>, event: string, data: unknown): void {
  for (const uid of userIds) {
    const set = clients.get(uid);
    if (!set) continue;
    for (const res of set) {
      try { writeEvent(res, event, data); } catch { /* broken pipe — the close handler cleans up */ }
    }
  }
}

export function connectedClientCount(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

// A single shared heartbeat keeps connections alive through proxies (nginx default
// proxy_read_timeout is 60s; a comment every 25s resets it). Comments are ignored by EventSource.
let heartbeat: ReturnType<typeof setInterval> | null = null;
export function startSseHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const set of clients.values()) {
      for (const res of set) {
        try { res.write(': ping\n\n'); } catch { /* cleaned up on close */ }
      }
    }
  }, 25_000);
  heartbeat.unref();
}
