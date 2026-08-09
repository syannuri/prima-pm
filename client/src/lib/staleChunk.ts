// Recovery for the classic SPA-after-deploy failure: an open tab references JS chunk hashes that no
// longer exist once a new build ships, so the chunk fetch 404s (or the server returns index.html) and
// a dynamic import throws e.g. "'text/html' is not a valid JavaScript MIME type" / "Failed to fetch
// dynamically imported module". The fix is to reload once so the fresh index.html + new hashes load.

const RELOAD_KEY = 'prima_chunk_reload_at';
const COOLDOWN_MS = 15_000; // don't loop-reload a genuinely broken deploy

// Is this error a chunk/module-load failure (stale deploy), rather than a real app bug?
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('is not a valid javascript mime type') ||
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('chunkloaderror') ||
    (msg.includes('unexpected token') && msg.includes('<')) // HTML served where JS was expected
  );
}

// Reload once to pick up the new build. Guarded by a short cooldown so a truly broken deploy shows
// the error UI instead of reloading forever. Returns true if a reload was triggered.
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < COOLDOWN_MS) return false; // already reloaded very recently → give up, show error
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable — reload anyway */
  }
  window.location.reload();
  return true;
}
