// Lets a page publish a CONTEXTUAL top-bar title (e.g. the project name) that Layout shows on mobile
// in place of the generic route title ("Projects"). Single value + listeners, transient — mirrors the
// lightweight lib/anettBus style (no react-query). Read in Layout via useSyncExternalStore.
let current: string | null = null;
const listeners = new Set<() => void>();

export function setPageTitle(title: string | null): void {
  current = title;
  listeners.forEach((l) => l());
}
export function getPageTitle(): string | null {
  return current;
}
export function subscribePageTitle(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
