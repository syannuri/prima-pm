import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Portfolio dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
  });

  test('shows the portfolio health command bar (gauge + KPIs)', async ({ page }) => {
    // Consolidated hero: the gauge readout carries SPI/CPI/% complete; the KPI grid the money.
    await expect(page.getByText('Total BAC')).toBeVisible();
    await expect(page.getByText('Earned Value')).toBeVisible();
    await expect(page.getByText('Actual Cost')).toBeVisible();
    await expect(page.getByText(/SPI \d/).first()).toBeVisible(); // gauge readout "SPI 1.10"
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
    await expect(page.getByText('Planned m-d')).toBeVisible();
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
