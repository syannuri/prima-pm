import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Portfolio dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
  });

  test('shows the portfolio health command bar (gauge + KPIs)', async ({ page }) => {
    // The desktop portfolio is now the command-center bento: a hero gauge (% complete + SPI/CPI
    // readout) over three money tiles. The tiles read "Budget · BAC / Earned · EV / Actual · AC".
    await expect(page.getByText(/Budget.*BAC/).first()).toBeVisible();
    await expect(page.getByText(/Earned.*EV/).first()).toBeVisible();
    await expect(page.getByText(/Actual.*AC/).first()).toBeVisible();
    await expect(page.getByText(/SPI \d/).first()).toBeVisible(); // gauge subtitle "… SPI 1.10, CPI 0.99"
  });

  test('portfolio hero rolls up a computed SPI and CPI', async ({ page }) => {
    // The old editable "Status date (EVM)" control + per-project SPI table were a widget-stack
    // feature; the desktop dashboard is now the bento, which surfaces the portfolio-wide EVM
    // roll-up as the hero gauge subtitle + KPI tiles. Assert the roll-up actually computed real
    // SPI/CPI numbers (the seed has EVM data) rather than falling back to "no data".
    // Wait for the bento to finish loading its summary (money tile) before reading the subtitle.
    await expect(page.getByText(/Budget.*BAC/).first()).toBeVisible();
    await expect(page.getByText(/SPI \d/).first()).toBeVisible();
    await expect(page.getByText(/CPI \d/).first()).toBeVisible();
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
    await expect(page.getByText(/Budget.*BAC/).first()).toBeVisible();
  });
});
