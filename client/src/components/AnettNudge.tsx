import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { openAnett } from '../lib/anettBus';

// In-context "ask Anett" nudge (#B): a small chip that opens the Anett widget with a prefilled
// question. Renders only when AI is available (shares the assistant's ['assistant-available'] cache,
// so no extra request), so it never appears as a dead button when AI is off / the tenant hasn't opted
// in. Anett resolves "this project" from the page context (currentProjectId), so the prompt can stay
// generic.
export default function AnettNudge({ prompt, label, className }: { prompt: string; label: string; className?: string }) {
  const { data } = useQuery({
    queryKey: ['assistant-available'],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/assistant/available`),
    staleTime: 5 * 60_000,
  });
  if (data?.aiAvailable !== true) return null;
  return (
    <button
      type="button"
      onClick={() => openAnett(prompt)}
      className={`inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/40 ${className ?? ''}`}
    >
      <span aria-hidden>✨</span> {label}
    </button>
  );
}
