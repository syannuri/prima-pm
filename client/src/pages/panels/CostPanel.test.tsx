import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../components/Toast';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import CostPanel from './CostPanel';

// Regression guard for the EVM cache-invalidation fix:
// Deleting an Actual Cost entry (or any cost mutation) must invalidate the
// EVM-derived queries (['evm'], ['forecast'], ['portfolio']) so the EV/AC/CV/CPI
// strip refreshes without a full page reload. Previously invalidate() only touched
// ['cost'] and ['project'], leaving the strip stale (see the 637M-vs-567M bug).

const AC_DESC = 'Cumulative actual cost to date';

// api is mocked so the panel renders against fixtures with no server/DB.
vi.mock('../../api/client', () => {
  const costSummary = {
    directCosts: [],
    indirectCosts: [],
    baseline: {
      directTotal: '485000000',
      indirectTotal: '8000000',
      contingencyReserve: '13500000',
      managementReserve: '0',
      costBaseline: '506500000',
      budgetAtCompletion: '506500000',
    },
    highLevelCharterCost: null,
    // NOTE: literal (not AC_DESC) — vi.mock is hoisted above module-scope consts.
    actualCosts: [{ id: 'ac1', date: '2026-06-24', amount: '567000000', description: 'Cumulative actual cost to date' }],
    actualCostTotal: 567000000,
  };
  const evm = { ev: 506500000, ac: 567000000, cv: -60500000, cpi: 0.89 };
  return {
    ApiError: class ApiError extends Error {},
    api: {
      get: vi.fn((url: string) => {
        if (url.includes('/evm')) return Promise.resolve(evm);
        if (url.includes('/gantt')) return Promise.resolve({ tree: [] });
        if (url.includes('/resources')) return Promise.resolve({ resources: [] });
        if (url.endsWith('/cost')) return Promise.resolve(costSummary);
        return Promise.resolve({});
      }),
      post: vi.fn(() => Promise.resolve({})),
      put: vi.fn(() => Promise.resolve({})),
      patch: vi.fn(() => Promise.resolve({})),
      del: vi.fn(() => Promise.resolve({})),
    },
  };
});

import { api } from '../../api/client';

// CostPanel now renders <BaselineLock>, which calls useAuth(); provide a stub so the
// panel doesn't need a full AuthProvider (this test focuses on cost-cache invalidation).
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Tester', email: 't@x', role: 'ADMIN' }, loading: false, login: vi.fn(), logout: vi.fn() }),
}));

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfirmProvider>
          <CostPanel projectId="p1" />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CostPanel actual-cost mutations', () => {
  // Heavier component test (accordion + confirm modal + multiple async waits): under
  // parallel test-file load the default 5s can be exceeded, so give it headroom and drop
  // userEvent's artificial inter-event delay. It passes in ~3.6s in isolation.
  it('invalidates the EVM/forecast/portfolio queries when an Actual Cost entry is deleted', async () => {
    const user = userEvent.setup({ delay: null });
    const { invalidateSpy } = renderPanel();

    // The cost sections are accordions; "Actual cost (AC)" is collapsed by default, so expand
    // it first (once the cost query has resolved and the header renders).
    await user.click(await screen.findByRole('button', { name: /Actual cost \(AC\)/i }));

    // Wait for the actual-cost row to render. The panel renders BOTH a desktop table and a
    // mobile card list (Tailwind hides one via CSS, which jsdom doesn't apply) — so the
    // description appears twice; pick the one inside the <table>.
    const cells = await screen.findAllByText(AC_DESC);
    const cell = cells.find((el) => el.closest('tr'))!;
    const row = cell.closest('tr')!;

    // Click the row's "delete" link, then confirm in the modal.
    await user.click(within(row).getByRole('button', { name: /^delete$/ }));
    await user.click(await screen.findByRole('button', { name: /^Delete$/ }));

    // The delete actually fired...
    await waitFor(() => expect(vi.mocked(api.del)).toHaveBeenCalledWith('/projects/p1/cost/actuals/ac1'));

    // ...and it invalidated every EVM-derived query (the regression being guarded).
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['evm'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['forecast'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['portfolio'] });
    });
    // ...plus the cost/project queries it already refreshed before the fix.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cost', 'p1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['project', 'p1'] });
  }, 15000);
});
