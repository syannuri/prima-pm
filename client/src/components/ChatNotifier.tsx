import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ChatConversation } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { playChime } from '../lib/chime';

// Global new-message alerter (renders nothing). Polls the caller's conversations and, when a
// conversation gains a newer message FROM THE OTHER SIDE that is still unread, plays a soft chime
// and either shows an in-app toast (tab focused) or an OS notification (tab hidden, if the user
// granted permission). Threads you're actively reading stay read (unread=0) so they don't alert.
export default function ChatNotifier() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isGuest = user?.role === 'GUEST';
  const me = user?.id ?? '';

  // Last-seen lastMessageAt per conversation; `init` guards the first poll so pre-existing unread
  // on load doesn't fire a burst of alerts.
  const seen = useRef<Map<string, string>>(new Map());
  const init = useRef(false);

  const { data } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => api.get<{ conversations: ChatConversation[] }>('/messages/conversations').then((r) => r.conversations),
    enabled: !!user && !isGuest,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!data) return;
    const first = !init.current;
    for (const c of data) {
      const prev = seen.current.get(c.id);
      seen.current.set(c.id, c.lastMessageAt);
      if (first) continue;
      const lm = c.lastMessage;
      const isNew = lm && lm.senderId !== me && c.unread > 0 && (!prev || new Date(c.lastMessageAt) > new Date(prev));
      if (isNew) alertNew(c.other.name, lm!.body);
    }
    init.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function alertNew(name: string, body: string) {
    playChime();
    const preview = body.length > 80 ? body.slice(0, 80) + '…' : body;
    // Tab hidden + permission granted → OS notification; otherwise an in-app toast.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try {
        const n = new Notification(`New message from ${name}`, { body: preview, tag: 'prima-chat', icon: '/icon-192.png' });
        n.onclick = () => { window.focus(); navigate('/messages'); n.close(); };
      } catch { toast.info(`💬 ${name}: ${preview}`); }
    } else {
      toast.info(`💬 ${name}: ${preview}`);
    }
    // Ask once so future hidden-tab alerts can use OS notifications (no-op if already decided).
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { void Notification.requestPermission(); } catch { /* ignore */ }
    }
  }

  return null;
}
