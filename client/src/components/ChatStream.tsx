import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fileUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Real-time chat via Server-Sent Events (renders nothing). Opens one EventSource for the signed-in
// user; on a `message`/`conversation` poke it invalidates the shared react-query keys so every chat
// surface (page, widget, unread badge, notifier) updates instantly. Polling stays as a fallback, so
// if the stream drops (EventSource auto-reconnects) nothing breaks — it just gets a touch slower.
export default function ChatStream() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isGuest = user?.role === 'GUEST';

  useEffect(() => {
    if (!user || isGuest) return;
    // Same-origin: the httpOnly session cookie rides along with withCredentials.
    const es = new EventSource(fileUrl('/messages/stream'), { withCredentials: true });

    const refresh = (e: MessageEvent) => {
      let conversationId: string | undefined;
      try { conversationId = JSON.parse(e.data)?.conversationId; } catch { /* ignore malformed */ }
      if (conversationId) qc.invalidateQueries({ queryKey: ['chat-thread', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
    };

    es.addEventListener('message', refresh); // new / edited / deleted message
    es.addEventListener('conversation', refresh); // group created / renamed / membership change
    // On error EventSource reconnects on its own (honouring the server's retry hint); nothing to do.

    return () => { es.close(); };
  }, [user, isGuest, qc]);

  return null;
}
