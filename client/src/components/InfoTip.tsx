import { useState } from 'react';

// Small "i" affordance that reveals an explanatory tooltip on hover/focus/tap.
// Keyboard- and touch-accessible (aria-label + click toggle), used wherever a KPI
// needs a plain-language definition (forecast panel, overview gauges, …).
export default function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-0.5 inline-flex">
      <button
        type="button"
        aria-label={text}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[8px] font-semibold leading-none text-slate-400 hover:border-slate-400 hover:text-slate-500 dark:border-slate-600 dark:text-slate-500"
      >
        i
      </button>
      {open && (
        <span role="tooltip" className="absolute bottom-full left-1/2 z-20 mb-1 w-48 -translate-x-1/2 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-normal leading-snug text-white shadow-lg dark:bg-slate-700">
          {text}
        </span>
      )}
    </span>
  );
}
