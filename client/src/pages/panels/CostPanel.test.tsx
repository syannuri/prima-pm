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
      del: vi.fn(() => Promise.resolve({})),
    },
  };
});

import { api } from '../../api/client';

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
  it('invalidates the EVM/forecast/portfolio queries when an Actual Cost entry is deleted', async () => {
    const user = userEvent.setup();
    const { invalidateSpy } = renderPanel();

    // Wait for the actual-cost row to render (cost query resolved).
    const cell = await screen.findByText(AC_DESC);
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
  });
});
