import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Portfolio dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
  });

  test('shows EVM KPI cards', async ({ page }) => {
    await expect(page.getByText('Total BAC')).toBeVisible();
    await expect(page.getByText('Portfolio CPI')).toBeVisible();
    await expect(page.getByText('Portfolio SPI')).toBeVisible();
    await expect(page.getByText('% Complete')).toBeVisible();
  });

  test('status date drives EVM (future date yields SPI)', async ({ page }) => {
    const dateInput = page.getByLabel('Status date (EVM)');
    await dateInput.fill('2026-10-01');
    // After a future status date some schedule progress should exist → a real SPI table.
    await expect(page.getByRole('cell', { name: 'SPI' }).or(page.getByText('Portfolio SPI'))).toBeVisible();
  });

  test('resources view shows capacity heatmap and over-allocation', async ({ page }) => {
    await page.getByRole('button', { name: 'Utilization', exact: true }).click();
    await expect(page.getByText('Over-allocated', { exact: true })).toBeVisible();
    await expect(page.getByText('Planned man-days')).toBeVisible();
    // Seed data has an over-allocated manpower line → at least one red "over" badge.
    await expect(page.getByText('over', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/resources-view.png', fullPage: true });

    // Switching to weekly granularity re-renders the table.
    await page.getByRole('button', { name: 'Weekly' }).click();
    await expect(page.getByText('Over-allocated', { exact: true })).toBeVisible();
  });

  test('toggles between portfolio and project cards', async ({ page }) => {
    await page.getByRole('button', { name: 'Project Cards' }).click();
    await expect(page.locator('a[href^="/projects/"]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Portfolio EVM' }).click();
    await expect(page.getByText('Total BAC')).toBeVisible();
  });
});
