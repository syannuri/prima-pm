import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { aiNotEnabledError, runToolCalls, toSystemBlocks, systemText, driveToolLoop, type LoopStep } from './ai.js';
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

// #2 cross-conversation caching: the system prompt splits into a STABLE prefix (shared across users)
// and a VOLATILE tail; each segment can carry its own cache breakpoint. A bare string keeps the old
// single-block behavior. toSystemBlocks also runs the redactor and drops empty segments.
describe('toSystemBlocks / systemText', () => {
  it('maps a bare string to one cached, redacted block', () => {
    const blocks = toSystemBlocks('hello', (s) => `R:${s}`);
    expect(blocks).toEqual([{ type: 'text', text: 'R:hello', cache_control: { type: 'ephemeral' } }]);
  });

  it('emits a breakpoint only where a segment asks for one, redacts each, and drops empties', () => {
    const blocks = toSystemBlocks(
      [{ text: 'stable', cache: true }, { text: '' }, { text: 'volatile' }],
      (s) => `R:${s}`,
    );
    expect(blocks).toEqual([
      { type: 'text', text: 'R:stable', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'R:volatile' },
    ]);
  });

  it('flattens a SystemPrompt back to plain text in order', () => {
    expect(systemText('one')).toBe('one');
    expect(systemText([{ text: 'a' }, { text: 'b', cache: true }])).toBe('ab');
  });
});

// #3 best-effort partial: driveToolLoop is the pure control flow of the Q&A tool loop. A scripted
// callStep lets us exercise every branch — including the maxSteps-exhaustion fallback that makes ONE
// final tool-less synthesis call instead of returning null (which would surface as a 502).
describe('driveToolLoop', () => {
  const textBlock = (t: string) => [{ type: 'text', text: t }] as unknown as Anthropic.ContentBlock[];
  const toolBlock = () => [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] as unknown as Anthropic.ContentBlock[];
  // A callStep driven by a queue of scripted steps; records the opts of every call it received.
  const scripted = (steps: LoopStep[]) => {
    const calls: { withTools: boolean; synthesis: boolean }[] = [];
    const fn = async (_m: Anthropic.MessageParam[], opts: { withTools: boolean; synthesis: boolean }) => {
      calls.push(opts);
      return steps.shift()!;
    };
    return { fn, calls };
  };
  const base = (callStep: ReturnType<typeof scripted>['fn']) => ({
    msgs: [] as Anthropic.MessageParam[],
    callStep,
    dispatch: async () => [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] as Anthropic.ToolResultBlockParam[],
    extractText: (c: Anthropic.ContentBlock[]) => (c[0] && c[0].type === 'text' ? c[0].text : null),
  });

  it('returns the final answer on a plain end_turn (no tools, no synthesis)', async () => {
    const s = scripted([{ stopReason: 'end_turn', content: textBlock('done') }]);
    const out = await driveToolLoop({ ...base(s.fn), maxSteps: 6 });
    expect(out).toBe('done');
    expect(s.calls).toEqual([{ withTools: true, synthesis: false }]);
  });

  it('short-circuits to null on a refusal without any synthesis call', async () => {
    const s = scripted([{ stopReason: 'refusal', content: [] }]);
    const out = await driveToolLoop({ ...base(s.fn), maxSteps: 6 });
    expect(out).toBeNull();
    expect(s.calls).toEqual([{ withTools: true, synthesis: false }]);
  });

  it('dispatches tools, resets streamed preamble, then returns the end_turn answer', async () => {
    let resets = 0;
    const s = scripted([
      { stopReason: 'tool_use', content: toolBlock() },
      { stopReason: 'end_turn', content: textBlock('after tools') },
    ]);
    const out = await driveToolLoop({ ...base(s.fn), maxSteps: 6, onTextReset: () => { resets++; } });
    expect(out).toBe('after tools');
    expect(resets).toBe(1);
    expect(s.calls).toEqual([{ withTools: true, synthesis: false }, { withTools: true, synthesis: false }]);
  });

  it('makes ONE tool-less synthesis call when maxSteps is exhausted, and returns its text', async () => {
    const s = scripted([
      { stopReason: 'tool_use', content: toolBlock() },
      { stopReason: 'tool_use', content: toolBlock() },
      { stopReason: 'end_turn', content: textBlock('best effort') }, // the #3 synthesis call
    ]);
    const out = await driveToolLoop({ ...base(s.fn), maxSteps: 2 });
    expect(out).toBe('best effort');
    // 2 tool steps (withTools) + 1 synthesis step (no tools, synthesis flag set).
    expect(s.calls).toEqual([
      { withTools: true, synthesis: false },
      { withTools: true, synthesis: false },
      { withTools: false, synthesis: true },
    ]);
  });
});
