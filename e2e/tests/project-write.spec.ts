import { test, expect, type Page } from '@playwright/test';
import { login, openFirstProject } from './helpers';

// Two-level tab bar: open the domain group (its aria-label) then the sub-tab.
async function openTab(page: Page, phase: string, tab: string) {
  await page.getByRole('tab', { name: phase, exact: true }).first().click();
  await page.getByRole('tab', { name: tab, exact: true }).first().click();
}

// Write-path smoke: the render suite (project-modules.spec) only asserts panels
// paint. This exercises a real form → API → refetch round-trip AND cleans up after
// itself so it's safe against a seeded (or live) project. Register CRUD & RBAC have
// integration coverage; this catches UI wiring regressions (form submit, list refresh,
// delete confirm) the render smoke can't.
test.describe('Project write paths', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
    await openFirstProject(page);
  });

  test('add then remove a stakeholder round-trips through the register', async ({ page }) => {
    await openTab(page, 'Initiating', 'Stakeholders');
    await expect(page.getByText('Stakeholder Register')).toBeVisible();

    // A distinctive name so we can find exactly our row and not a seed one.
    const name = 'E2E Roundtrip Stakeholder';
    const row = page.locator('tr').filter({ hasText: name });
    await expect(row).toHaveCount(0); // not present before we add it

    // Create via the modal form.
    await page.getByRole('button', { name: /Add stakeholder/i }).click();
    await expect(page.getByRole('heading', { name: /Add a stakeholder/i })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Power (influence)').selectOption('HIGH');
    await page.getByLabel('Interest').selectOption('HIGH');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The list refetches → our row appears with its derived "Manage closely" strategy.
    await expect(row).toBeVisible();
    await expect(row.getByText('Manage closely')).toBeVisible();

    // Remove it → confirm dialog → the row disappears (keeps the project clean).
    await row.getByRole('button', { name: 'delete' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(row).toHaveCount(0);
  });
});
