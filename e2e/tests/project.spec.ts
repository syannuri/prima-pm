import { test, expect } from '@playwright/test';
import { login, openFirstProject } from './helpers';

test.describe('Project workspace', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
    await openFirstProject(page);
  });

  test('switches between module tabs on a chartered project', async ({ page }) => {
    // Seed project is chartered → Cost/Risk/Schedule panels unlock.
    await page.getByRole('button', { name: 'Cost', exact: true }).click();
    await expect(page.getByText(/Commit the Project Charter first/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Risk', exact: true }).click();
    await expect(page.getByText(/Commit the Project Charter first/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.getByText(/Commit the Project Charter first/i)).toHaveCount(0);
  });

  test('manpower cost line offers a named-resource picker', async ({ page }) => {
    await page.getByRole('button', { name: 'Cost', exact: true }).click();
    // The Direct Cost form's type selector switches the row to manpower fields.
    const typeSelect = page.locator('select').filter({ hasText: 'Manpower' }).first();
    await typeSelect.selectOption('MANPOWER');
    // The add-form resource picker (scoped by its placeholder, to avoid the inline
    // per-row selects) appears with the seeded users.
    const addResourceSelect = page.locator('select').filter({ hasText: 'Resource… (optional)' });
    await expect(addResourceSelect).toBeVisible();
    await expect(addResourceSelect.getByRole('option', { name: 'Budi Santoso' })).toBeAttached();
    await page.screenshot({ path: 'test-results/manpower-resource-picker.png', fullPage: true });
  });

  test('reassigns a resource inline on an existing manpower row', async ({ page }) => {
    await page.getByRole('button', { name: 'Cost', exact: true }).click();
    // The per-row inline dropdown carries the "👤 Unassigned" placeholder option.
    const rowSelect = page.locator('select').filter({ hasText: '👤 Unassigned' }).first();
    await expect(rowSelect).toBeVisible();

    // Assign → the PUT round-trips and the refetched row reflects the new value.
    await rowSelect.selectOption({ label: '👤 Budi Santoso' });
    await expect(page.locator('select').filter({ hasText: '👤 Unassigned' }).first())
      .toHaveValue(/.+/, { timeout: 10_000 });
    await page.screenshot({ path: 'test-results/manpower-inline-reassign.png', fullPage: true });

    // Restore to keep the seed project clean for the user.
    await page.locator('select').filter({ hasText: '👤 Unassigned' }).first().selectOption('');
    await expect(page.locator('select').filter({ hasText: '👤 Unassigned' }).first()).toHaveValue('');
  });

  test('exposes export buttons on a chartered project', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Excel/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /PDF/ })).toBeVisible();
  });

  test('audit tab lists committed history', async ({ page }) => {
    await page.getByRole('button', { name: 'Audit', exact: true }).click();
    // Seed data produces audit entries; expect at least one action badge in the table
    // (scoped to <table> to avoid matching the hidden filter <option> elements).
    await expect(page.locator('table').getByText(/COMMIT|CREATE|UPDATE/).first()).toBeVisible();
  });

  test('back link returns to the dashboard', async ({ page }) => {
    await page.getByRole('link', { name: /All projects/ }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
