import { describe, it, expect, beforeEach } from 'vitest';
import type { Response } from 'express';
import { addClient, removeClient, publishToUsers, connectedClientCount, isOnline, onlineAmong, setOfflineHandler, sseStats } from './sse.js';

// The SSE hub is pure in-memory plumbing — no DB. A "response" here is a tiny stub that records
// what was written to it. `dead:true` makes write() throw, simulating a socket whose peer has gone
// away without a graceful close.
function stubRes(opts: { dead?: boolean } = {}) {
  const writes: string[] = [];
  let ended = false;
  const res = {
    write: (s: string) => { if (opts.dead) throw new Error('EPIPE'); writes.push(s); return true; },
    end: () => { ended = true; },
  };
  return { writes, get ended() { return ended; }, res: res as unknown as Response };
}

describe('SSE hub', () => {
  beforeEach(() => {
    // Each test uses fresh user ids so counts are isolated.
  });

  it('delivers an event only to the targeted users, formatted as SSE frames', () => {
    const a = stubRes();
    const b = stubRes();
    addClient('u-alice', a.res);
    addClient('u-bob', b.res);

    publishToUsers(['u-alice'], 'message', { conversationId: 'c1' });

    expect(a.writes).toHaveLength(1);
    expect(a.writes[0]).toBe('event: message\ndata: {"conversationId":"c1"}\n\n');
    expect(b.writes).toHaveLength(0); // bob was not targeted

    removeClient('u-alice', a.res);
    removeClient('u-bob', b.res);
  });

  it('fans out to every open stream of a user and stops after removal', () => {
    const tab1 = stubRes();
    const tab2 = stubRes();
    addClient('u-carol', tab1.res);
    addClient('u-carol', tab2.res);
    expect(connectedClientCount()).toBe(2);

    publishToUsers(['u-carol'], 'conversation', { conversationId: 'c2' });
    expect(tab1.writes).toHaveLength(1);
    expect(tab2.writes).toHaveLength(1);

    removeClient('u-carol', tab1.res);
    publishToUsers(['u-carol'], 'conversation', { conversationId: 'c3' });
    expect(tab1.writes).toHaveLength(1); // closed tab gets nothing more
    expect(tab2.writes).toHaveLength(2);

    removeClient('u-carol', tab2.res);
    expect(connectedClientCount()).toBe(0);
  });

  it('publishing to an unknown user is a no-op', () => {
    expect(() => publishToUsers(['nobody'], 'message', { conversationId: 'x' })).not.toThrow();
  });

  it('reports online transitions: first stream = came online, last close = went offline', () => {
    const t1 = stubRes();
    const t2 = stubRes();
    expect(isOnline('u-dave')).toBe(false);
    expect(addClient('u-dave', t1.res)).toBe(true); // first stream → came online
    expect(addClient('u-dave', t2.res)).toBe(false); // second tab → no transition
    expect(isOnline('u-dave')).toBe(true);
    expect(onlineAmong(['u-dave', 'ghost'])).toEqual(['u-dave']);

    expect(removeClient('u-dave', t1.res)).toBe(false); // still one tab open
    expect(removeClient('u-dave', t2.res)).toBe(true); // last stream → went offline
    expect(isOnline('u-dave')).toBe(false);
  });

  it('evicts a dead stream on write failure and announces the user offline', () => {
    const offline: string[] = [];
    setOfflineHandler((uid) => offline.push(uid));
    const bad = stubRes({ dead: true });
    addClient('u-eve', bad.res);
    expect(isOnline('u-eve')).toBe(true);

    publishToUsers(['u-eve'], 'message', { conversationId: 'c9' }); // write throws → evicted

    expect(isOnline('u-eve')).toBe(false); // dropped from the hub, not leaked
    expect(bad.ended).toBe(true); // the socket was closed out
    expect(offline).toEqual(['u-eve']); // last stream gone → offline announced
    setOfflineHandler(() => {}); // reset so later tests don't accumulate
  });

  it('caps streams per user, closing the oldest when the limit is hit', () => {
    const streams = Array.from({ length: 7 }, () => stubRes());
    for (const s of streams) addClient('u-frank', s.res);
    // 7 opened, cap is 6 → the very first (oldest) was closed and dropped.
    expect(connectedClientCount()).toBe(6);
    expect(streams[0].ended).toBe(true);
    expect(streams[6].ended).toBe(false); // newest stays open
    for (const s of streams) removeClient('u-frank', s.res);
  });

  it('sseStats reports open streams and distinct users', () => {
    const a = stubRes();
    const b = stubRes();
    addClient('u-gina', a.res);
    addClient('u-gina', b.res); // same user, two tabs
    addClient('u-hank', stubRes().res);
    const s = sseStats();
    expect(s.connections).toBeGreaterThanOrEqual(3);
    expect(s.users).toBeGreaterThanOrEqual(2);
    removeClient('u-gina', a.res);
    removeClient('u-gina', b.res);
  });
});
