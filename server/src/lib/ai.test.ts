import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { aiNotEnabledError, runToolCalls } from './ai.js';
import { bindTenantContext } from './tenant/context.js';

// The AI gate message must be honest about who can act on it: a guest's personal sandbox can never
// opt in, so it gets a sandbox-specific message; corporate tenants (and no-context) keep the
// actionable "not enabled for this workspace" that points an admin at Settings.
describe('aiNotEnabledError', () => {
  it('gives a guest-sandbox message when the active tenant is personal', () => {
    bindTenantContext('t-guest', true, () => {
      const e = aiNotEnabledError();
      expect(e.statusCode).toBe(403);
      expect(e.message).toContain('sandbox');
      expect(e.message).not.toContain('belum diaktifkan');
    });
  });

  it('gives the generic (actionable) message for a corporate tenant', () => {
    bindTenantContext('t-corp', false, () => {
      expect(aiNotEnabledError().message).toBe('Fitur AI belum diaktifkan untuk workspace ini.');
    });
  });

  it('defaults to the generic message with no tenant context', () => {
    expect(aiNotEnabledError().message).toBe('Fitur AI belum diaktifkan untuk workspace ini.');
  });
});

// The Q&A tool loop dispatches all tool calls in one assistant step CONCURRENTLY. This exercises the
// extracted helper directly (the live loop's SDK streaming is not unit-testable without a real key).
describe('runToolCalls', () => {
  it('runs a step\'s tool calls concurrently, preserves order, skips non-tool blocks, isolates errors', async () => {
    const started: string[] = [];
    // A gate every call awaits; opened only once all three tool calls have STARTED. Serial dispatch
    // would deadlock here (the 2nd call never starts) → the test would hang and fail, so completing
    // proves the calls were fired concurrently.
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const blocks = [
      { type: 'tool_use', id: 'a', name: 'first', input: { x: 1 } },
      { type: 'text', text: 'preamble — must be ignored' },
      { type: 'tool_use', id: 'b', name: 'boom', input: {} },
      { type: 'tool_use', id: 'c', name: 'third', input: {} },
    ] as unknown as Anthropic.ContentBlock[];

    const executeTool = async (name: string): Promise<string> => {
      started.push(name);
      if (started.length === 3) open();
      await gate;
      if (name === 'boom') throw new Error('tool blew up');
      return JSON.stringify({ ok: name });
    };

    const results = await runToolCalls(blocks, executeTool, (s) => `redacted:${s}`);

    expect(started).toHaveLength(3); // all three dispatched before any resolved ⇒ concurrent
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b', 'c']); // order preserved, text skipped
    expect(results[0].content).toBe(`redacted:${JSON.stringify({ ok: 'first' })}`); // redactor applied
    expect(results[2].content).toBe(`redacted:${JSON.stringify({ ok: 'third' })}`);
    // a throwing tool becomes a friendly error result, not a rejected loop
    expect(results[1].content).toBe(`redacted:${JSON.stringify({ error: 'Tool gagal dijalankan.' })}`);
  });

  it('returns an empty array when the step has no tool calls', async () => {
    const blocks = [{ type: 'text', text: 'just an answer' }] as unknown as Anthropic.ContentBlock[];
    const results = await runToolCalls(blocks, async () => 'unused', (s) => s);
    expect(results).toEqual([]);
  });
});
