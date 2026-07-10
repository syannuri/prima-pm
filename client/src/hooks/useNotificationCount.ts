import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Total unread/attention count shown on the notification bell, reused for the
// mobile tab-bar badge. Uses the SAME query keys as NotificationBell, so
// TanStack Query dedupes the fetches — no extra network calls.
export function useNotificationCount(): number {
  const { user } = useAuth();
  const isAdminPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const attn = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.get<{ total: number }>('/notifications/attention'),
    refetchInterval: 60_000,
  });
  const changes = useQuery({
    queryKey: ['changes'],
    queryFn: () => api.get<{ unread: number }>('/notifications/changes'),
    enabled: isAdminPmo,
    refetchInterval: 60_000,
  });
  const inbox = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ unread: number }>('/notifications/inbox'),
    refetchInterval: 60_000,
  });

  return (attn.data?.total ?? 0) + (isAdminPmo ? changes.data?.unread ?? 0 : 0) + (inbox.data?.unread ?? 0);
}
