import { describe, it, expect, beforeEach } from 'vitest';
import type { Response } from 'express';
import { addClient, removeClient, publishToUsers, connectedClientCount } from './sse.js';

// The SSE hub is pure in-memory plumbing — no DB. A "response" here is a tiny stub that records
// what was written to it.
function stubRes() {
  const writes: string[] = [];
  return { writes, res: { write: (s: string) => { writes.push(s); return true; } } as unknown as Response };
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
});
