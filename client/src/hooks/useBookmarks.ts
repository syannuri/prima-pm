import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

// Per-user project bookmarks, synced to the server (GET/PUT/DELETE /bookmarks).
// Returns a Set of bookmarked project ids + an optimistic toggle.
const KEY = ['bookmarks'];

export function useBookmarks() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ projectIds: string[] }>('/bookmarks').then((r) => r.projectIds),
    staleTime: 60_000,
  });
  const ids = data ?? [];
  const pinned = new Set(ids);

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      if (pinned.has(id)) await api.del<void>(`/bookmarks/${id}`);
      else await api.put<void>(`/bookmarks/${id}`);
    },
    // Optimistic: flip the id in the cache immediately, roll back on error.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<string[]>(KEY) ?? [];
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      qc.setQueryData(KEY, next);
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return { pinned, toggle: (id: string) => mutation.mutate(id) };
}
