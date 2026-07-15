import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CriticalPathPanel from './CriticalPathPanel';

// Renders the CPM panel against a fixed network so the mobile card branch (added when the
// dense table was carded) is exercised — prod has 0 task dependencies, so a screenshot can't.
const cpm = {
  hasNetwork: true,
  cyclic: false,
  projectDuration: 12,
  criticalCount: 1,
  taskCount: 2,
  tasks: [
    { id: 't1', wbsCode: '1.1', name: 'Design', planStart: '2026-07-01', planEnd: '2026-07-05', duration: 5, es: 0, ef: 5, ls: 0, lf: 5, totalFloat: 0, critical: true },
    { id: 't2', wbsCode: '1.2', name: 'Docs', planStart: '2026-07-01', planEnd: '2026-07-03', duration: 3, es: 0, ef: 3, ls: 4, lf: 7, totalFloat: 4, critical: false },
  ],
};

vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {},
  api: { get: vi.fn(() => Promise.resolve(cpm)) },
}));

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CriticalPathPanel projectId="p1" />
    </QueryClientProvider>,
  );
}

describe('CriticalPathPanel', () => {
  afterEach(cleanup);

  it('renders the mobile card list alongside the desktop table (no CSS in jsdom → both present)', async () => {
    renderPanel();
    // Task names appear (in both table row and mobile card).
    await waitFor(() => expect(screen.getAllByText('Design').length).toBeGreaterThan(0));
    // The card grid uses full-word "Duration" labels; the table header is the abbreviated "Dur".
    // So finding "Duration" proves the card branch rendered without crashing.
    expect(screen.getAllByText('Duration').length).toBe(2); // one card per task
    // Critical badge shown for the on-path task (table + card).
    expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(2);
    // Float value from the fixture is present.
    expect(screen.getAllByText('4d').length).toBeGreaterThan(0);
  });
});
