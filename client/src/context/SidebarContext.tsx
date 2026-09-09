import { createContext, useContext, useEffect } from 'react';

// Sidebar collapse state, lifted to a context so a deep child (e.g. the Schedule/Gantt tab) can
// TEMPORARILY collapse the workspace sidebar for more horizontal room and then RESTORE the user's
// prior choice when it goes away — without prop-drilling through the whole page tree.
//
// The action callbacks (toggle/beginAuto/endAuto) are stable (useCallback in the provider), so the
// auto-collapse effect below depends only on them, never on `collapsed`. That's what stops the
// begin→collapse→re-render→cleanup→restore loop a naive implementation would hit.
export type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;      // manual toggle — also forgets any remembered auto-collapse state
  beginAuto: () => void;   // remember the current state (once) and collapse
  endAuto: () => void;     // restore the remembered state (unless a manual toggle cancelled it)
};

export const SidebarContext = createContext<SidebarContextValue | null>(null);

// May be null when rendered outside the provider (e.g. isolated component tests) — callers must guard.
export function useSidebar(): SidebarContextValue | null {
  return useContext(SidebarContext);
}

// Collapse the sidebar while the calling component is mounted, then restore on unmount. Mount the
// hook in a component whose lifecycle matches the view you want collapsed (the Schedule panel only
// mounts while its tab is active), so switching tabs auto-restores the previous layout.
export function useSidebarAutoCollapse() {
  const ctx = useSidebar();
  const beginAuto = ctx?.beginAuto;
  const endAuto = ctx?.endAuto;
  useEffect(() => {
    if (!beginAuto || !endAuto) return; // no provider (tests) → no-op
    beginAuto();
    return () => endAuto();
  }, [beginAuto, endAuto]);
}
