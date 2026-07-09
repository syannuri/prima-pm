import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Read-only smoke coverage for the centralized Reporting Hub (/reports): each view renders
// and the newly-wired Daily/Yearly cadences are enabled. Admin sees the whole portfolio.
test.describe('Reporting Hub', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });

  test('Executive view rolls up portfolio health', async ({ page }) => {
    await page.getByRole('button', { name: 'Executive', exact: true }).click();
    await expect(page.getByText(/Portfolio SPI/i)).toBeVisible();
    await expect(page.getByText(/Project heatmap/i)).toBeVisible();
  });

  test('Portfolio view shows budget vs actual', async ({ page }) => {
    await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
    await expect(page.getByText(/Budget vs actual/i).first()).toBeVisible();
    await expect(page.getByText(/Cost variance/i)).toBeVisible();
  });

  test('Analytics view offers the velocity & burndown lens', async ({ page }) => {
    await page.getByRole('button', { name: 'Analytics', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Velocity & Burndown' })).toBeVisible();
  });

  test('all four cadences (incl. Daily & Yearly) are enabled', async ({ page }) => {
    for (const c of ['Daily', 'Weekly', 'Monthly', 'Yearly']) {
      await expect(page.getByRole('button', { name: c, exact: true })).toBeEnabled();
    }
  });
});
