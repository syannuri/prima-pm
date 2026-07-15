import { test, expect, type Page } from '@playwright/test';
import { login, openFirstProject } from './helpers';

// The tab bar groups tabs by management domain (Initiation/Schedule/Cost/Risk/Quality/
// Monitoring/Closure/Audit); open the group (its stable aria-label) then click the tab.
// `.first()` guards the case where a group label also exists as a sub-tab pill (e.g. the
// "Cost" group contains a "Cost" tab). Single-tab groups (Closure/Audit) are plain buttons.
async function openTab(page: Page, group: string, tab: string) {
  await page.getByRole('button', { name: group, exact: true }).first().click();
  await page.getByRole('button', { name: tab, exact: true }).first().click();
}

test.describe('Project workspace', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
    await openFirstProject(page);
  });

  test('switches between module tabs on a chartered project', async ({ page }) => {
    // Seed project is chartered → Cost/Risk/Schedule panels unlock.
    await openTab(page, 'Cost', 'Cost');
    await expect(page.getByText(/Commit the Project Charter first/i)).toHaveCount(0);

    await openTab(page, 'Risk', 'Risk');
    await expect(page.getByText(/Commit the Project Charter first/i)).toHaveCount(0);

    await openTab(page, 'Schedule', 'Schedule');
    await expect(page.getByText(/Commit the Project Charter first/i)).toHaveCount(0);
  });

  test('manpower cost line offers a named-resource picker', async ({ page }) => {
    await openTab(page, 'Cost', 'Cost');
    // The Direct Cost form's type selector switches the row to manpower fields.
    const typeSelect = page.locator('select').filter({ hasText: 'Manpower' }).first();
    await typeSelect.selectOption('MANPOWER');
    // The add-form resource picker (scoped by its placeholder, to avoid the inline
    // per-row selects) appears with the seeded users.
    const addResourceSelect = page.locator('select').filter({ hasText: 'Resource…' });
    await expect(addResourceSelect).toBeVisible();
    await expect(addResourceSelect.getByRole('option', { name: 'Budi Santoso' })).toBeAttached();
    await page.screenshot({ path: 'test-results/manpower-resource-picker.png', fullPage: true });
  });

  test('reassigns a resource inline on an existing manpower row', async ({ page }) => {
    await openTab(page, 'Cost', 'Cost');
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
    // Excel/PDF export now live under the header's "⋯ More" overflow menu.
    await page.getByRole('button', { name: /More/ }).click();
    await expect(page.getByRole('menuitem', { name: /Excel/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /PDF/ })).toBeVisible();
  });

  test('audit tab lists committed history', async ({ page }) => {
    await page.getByRole('button', { name: /^Audit/ }).click(); // tab carries a change-count badge ("Audit N")
    // Seed data produces audit entries; expect at least one action badge in the table
    // (scoped to <table> to avoid matching the hidden filter <option> elements).
    await expect(page.locator('table').getByText(/COMMIT|CREATE|UPDATE/).first()).toBeVisible();
  });

  test('back link returns to the dashboard', async ({ page }) => {
    await page.getByRole('link', { name: /All projects/ }).click();
    await expect(page.getByRole('heading', { name: /👋/ })).toBeVisible(); // dashboard greeting "…, <name> 👋"
  });
});
