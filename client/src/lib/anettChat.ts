// Anett's conversation is client-only: the server /assistant/ask endpoint is stateless (the client
// resends the transcript each turn), so the chat "history" lives in sessionStorage. To keep one
// account from ever reading another's chat when they share a browser tab (in-tab logout → login, or
// impersonation), the history is keyed per user id, and every auth transition wipes all Anett chats.
const CHAT_KEY_PREFIX = 'anett-chat';

// Per-user storage key. Falls back to the bare prefix before the user has loaded (harmless — a fresh
// mount under an authenticated Layout always has the user, so this only guards the transient case).
export function anettChatKey(userId?: string | null): string {
  return userId ? `${CHAT_KEY_PREFIX}:${userId}` : CHAT_KEY_PREFIX;
}

// Remove every Anett chat (the bare legacy key + all per-user keys). Call on any identity change.
export function clearAnettChats(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k === CHAT_KEY_PREFIX || k?.startsWith(`${CHAT_KEY_PREFIX}:`)) sessionStorage.removeItem(k);
    }
  } catch { /* private mode / disabled storage — nothing to clear */ }
}
