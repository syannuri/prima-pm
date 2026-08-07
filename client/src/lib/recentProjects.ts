// Most-recently-visited project ids, persisted for the command palette's "Recent" group.
// Stamped on every project-page visit (ProjectPage), read by CommandPalette. Capped, newest-first.
const KEY = 'prima_recent_projects';
const CAP = 6;

export function getRecentProjectIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecentProject(id: string): void {
  try {
    const next = [id, ...getRecentProjectIds().filter((x) => x !== id)].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / disabled storage */
  }
}
