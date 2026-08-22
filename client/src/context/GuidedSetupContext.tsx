import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import type { Project } from '../api/types';
import { GUIDED_STEPS, guidedKey, type GuidedState, type GuidedStepId } from '../lib/guidedSetup';

interface ComputedStep { id: GuidedStepId; done: boolean }
interface GuidedValue {
  active: boolean;                 // the guide should be shown
  steps: ComputedStep[];           // 6 steps + computed done
  currentIndex: number;            // first not-done step (== steps.length when all done)
  currentAnchor?: string;          // the data-tour anchor to spotlight now (step 3 is two-phase)
  allDone: boolean;
  projectId?: string;              // the project the guide is following
  dismiss: () => void;
  finish: () => void;
}

const Ctx = createContext<GuidedValue | null>(null);
export function useGuidedSetup(): GuidedValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGuidedSetup must be used within GuidedSetupProvider');
  return v;
}

const load = (uid: string): GuidedState => { try { return JSON.parse(localStorage.getItem(guidedKey(uid)) || '{}'); } catch { return {}; } };

export function GuidedSetupProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id;
  const [state, setState] = useState<GuidedState>({});

  // Load persisted state when the user resolves.
  useEffect(() => { if (uid) setState(load(uid)); }, [uid]);
  const patch = useCallback((p: Partial<GuidedState>) => {
    setState((prev) => { const next = { ...prev, ...p }; if (uid) localStorage.setItem(guidedKey(uid), JSON.stringify(next)); return next; });
  }, [uid]);

  // The guide runs for GUESTs until finished or skipped.
  const active = !!user && user.role === 'GUEST' && !state.dismissed && !state.done;

  // Projects list — detect the user's own (newly created) project and read its status.
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
    enabled: active,
    refetchInterval: active ? 4000 : false,
  });
  const projects = projectsQ.data?.projects;

  // Adopt the project the guide follows: snapshot the pre-existing (demo) ids once, then adopt the
  // first project that appears outside that snapshot as the user's own.
  useEffect(() => {
    if (!active || !projects || state.projectId) return;
    if (!state.seenProjectIds) { patch({ seenProjectIds: projects.map((p) => p.id) }); return; }
    const fresh = projects.find((p) => !state.seenProjectIds!.includes(p.id));
    if (fresh) patch({ projectId: fresh.id });
  }, [active, projects, state.projectId, state.seenProjectIds, patch]);

  const projectId = state.projectId;
  const proj = projects?.find((p) => p.id === projectId);
  const base = projectId ? `/projects/${projectId}` : '';

  // Baseline signals for the followed project (schedule baseline / combined lock, and cost BAC).
  const ganttQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ baselinedAt: string | null; baselineLocked?: boolean; tree?: unknown[] }>(`${base}/schedule/gantt`),
    enabled: active && !!projectId,
    refetchInterval: active && !!projectId ? 4000 : false,
  });
  const costQ = useQuery({
    queryKey: ['cost', projectId],
    queryFn: () => api.get<{ baseline?: { costBaseline?: number } }>(`${base}/cost`),
    enabled: active && !!projectId,
    refetchInterval: active && !!projectId ? 4000 : false,
  });

  const steps = useMemo<ComputedStep[]>(() => {
    const bac = Number(costQ.data?.baseline?.costBaseline ?? 0);
    const done: Record<GuidedStepId, boolean> = {
      create: !!projectId,
      charter: !!proj && proj.status !== 'DRAFT',
      schedule: !!ganttQ.data?.baselinedAt,
      cost: bac > 0,
      lock: !!ganttQ.data?.baselineLocked,
      activate: proj?.status === 'IN_PROGRESS',
    };
    return GUIDED_STEPS.map((s) => ({ id: s.id, done: done[s.id] }));
  }, [projectId, proj, ganttQ.data, costQ.data]);

  const currentIndex = steps.findIndex((s) => !s.done);
  const allDone = currentIndex === -1;

  // Step 3 (schedule) is two-phase: point at "add task" until ≥1 task exists, then at "capture
  // baseline". Every other step uses its static anchor.
  const hasTasks = (ganttQ.data?.tree?.length ?? 0) > 0;
  const cur = allDone ? undefined : GUIDED_STEPS[currentIndex];
  const currentAnchor = cur ? (cur.id === 'schedule' && !hasTasks ? 'add-task' : cur.anchor) : undefined;

  const value: GuidedValue = {
    active,
    steps,
    currentIndex: allDone ? steps.length : currentIndex,
    currentAnchor,
    allDone,
    projectId,
    dismiss: () => patch({ dismissed: true }),
    finish: () => patch({ done: true }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
