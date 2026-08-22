import { useState } from 'react';
import { useGuidedSetup } from '../context/GuidedSetupContext';
import { useLang } from '../context/LanguageContext';
import { GUIDED_STEPS } from '../lib/guidedSetup';

// First-project guided setup — a resumable checklist (the backbone). Auto-advances off real state
// (see GuidedSetupContext). Coach-marks that spotlight each step's target are P2. Guests only.
export default function GuidedSetup() {
  const g = useGuidedSetup();
  const { lang } = useLang();
  const id = lang === 'id';
  const [collapsed, setCollapsed] = useState(false);
  if (!g.active) return null;

  const total = g.steps.length;
  const doneCount = g.steps.filter((s) => s.done).length;
  const current = g.currentIndex; // index of the step to do next (== total when all done)

  // Collapsed pill.
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed left-4 z-40 inline-flex items-center gap-2 rounded-full border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-lg bottom-[5.5rem] md:bottom-4 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-300"
      >
        <span aria-hidden>🚀</span> {id ? 'Panduan setup' : 'Setup guide'}
        <span className="rounded-full bg-brand-100 px-1.5 text-xs text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{doneCount}/{total}</span>
      </button>
    );
  }

  return (
    <div className="fixed left-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl bottom-[5.5rem] md:bottom-4 dark:border-slate-700 dark:bg-slate-900">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-4 py-3 dark:border-slate-800 dark:from-slate-800 dark:to-slate-900">
        <span aria-hidden className="text-lg">🚀</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{id ? 'Siapkan project pertama' : 'Set up your first project'}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{doneCount}/{total} {id ? 'selesai' : 'done'}</div>
        </div>
        <button onClick={() => setCollapsed(true)} aria-label={id ? 'Kecilkan' : 'Collapse'} title={id ? 'Kecilkan' : 'Collapse'} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">–</button>
      </div>

      {/* progress bar */}
      <div className="h-1 w-full bg-slate-100 dark:bg-slate-800"><div className="h-full bg-brand-500 transition-[width] duration-500" style={{ width: `${(doneCount / total) * 100}%` }} /></div>

      {g.allDone ? (
        <div className="p-4 text-center">
          <div className="text-3xl" aria-hidden>🎉</div>
          <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{id ? 'Project Anda siap!' : 'Your project is ready!'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{id ? 'Baseline terkunci & project aktif — pelacakan EVM dimulai.' : 'Baseline locked & project activated — EVM tracking has started.'}</p>
          <button onClick={g.finish} className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">{id ? 'Selesai' : 'Finish'}</button>
        </div>
      ) : (
        <ol className="max-h-[22rem] space-y-0.5 overflow-y-auto p-2">
          {GUIDED_STEPS.map((step, i) => {
            const done = g.steps[i].done;
            const isCurrent = i === current;
            return (
              <li key={step.id} className={`rounded-lg px-2 py-1.5 ${isCurrent ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? 'bg-emerald-500 text-white' : isCurrent ? 'border-2 border-brand-500 text-brand-600 dark:text-brand-300' : 'border-2 border-slate-300 text-slate-400 dark:border-slate-600'}`}>
                    {done ? '✓' : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${done ? 'text-slate-400 line-through dark:text-slate-500' : isCurrent ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>{step.title[id ? 'id' : 'en']}</div>
                    {isCurrent && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{step.hint[id ? 'id' : 'en']}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!g.allDone && (
        <div className="border-t border-slate-100 px-4 py-2 text-right dark:border-slate-800">
          <button onClick={g.dismiss} className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{id ? 'Lewati panduan' : 'Skip guide'}</button>
        </div>
      )}
    </div>
  );
}
