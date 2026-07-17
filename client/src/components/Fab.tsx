import { haptic } from '../lib/haptics';

// Floating action button (phones only). A round, thumb-reachable primary
// "add" control that floats above the bottom tab bar. Desktop keeps its inline
// "+ New Project" button, so this is md:hidden.
export default function Fab({ onClick, label = 'Add', icon }: { onClick: () => void; label?: string; icon?: string }) {
  const PLUS = 'M12 5v14M5 12h14';
  return (
    <button
      data-tour="new-project"
      onClick={() => { haptic(); onClick(); }}
      aria-label={label}
      title={label}
      // `fab` marker lets the install banner lift this button above itself (see index.css).
      className="fab fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-600/30 ring-1 ring-black/5 transition-all active:scale-90 md:hidden"
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon || PLUS} />
      </svg>
    </button>
  );
}
