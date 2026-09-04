// Tiny cross-component channel to open the Anett widget (optionally with a prefilled question) from
// anywhere in the app — e.g. an in-context "ask Anett" nudge on a project page (#B). There is exactly
// one AiAssistant mounted, so a single-listener bus is enough (mirrors the lightweight lib/chatLive
// store style — no react-query, transient).

type Listener = (prompt?: string) => void;
let listener: Listener | null = null;

// AiAssistant registers here on mount; pass null on unmount.
export function onOpenAnett(fn: Listener | null): void {
  listener = fn;
}

// Open Anett; if `prompt` is given, it is asked immediately. No-op if the widget isn't mounted
// (AI disabled) — the caller's nudge simply shouldn't render in that case.
export function openAnett(prompt?: string): void {
  listener?.(prompt);
}

export function anettAvailable(): boolean {
  return listener !== null;
}
