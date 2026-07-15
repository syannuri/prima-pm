import { test, expect, type Page } from '@playwright/test';
import { login, openFirstProject } from './helpers';

// Two-level tab bar: open the domain group (its aria-label) then the sub-tab. `.first()`
// guards against the group label also existing as a sub-tab pill (e.g. "Cost" group + "Cost" tab).
async function openTab(page: Page, group: string, tab: string) {
  await page.getByRole('button', { name: group, exact: true }).first().click();
  await page.getByRole('button', { name: tab, exact: true }).first().click();
}

// Read-only render smoke for the modules the earlier e2e suite never exercised
// (PMBOK Stakeholder/Procurement/RAID, CPM, Forecast, Timesheet). Catches UI regressions;
// the write paths & RBAC are covered by the integration suite. Runs on the seeded SOC project.
test.describe('Project modules render', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'Admin');
    await openFirstProject(page);
  });

  test('Stakeholder register (Initiating)', async ({ page }) => {
    await openTab(page, 'Initiating', 'Stakeholders');
    await expect(page.getByText('Stakeholder Register')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add stakeholder/i })).toBeVisible();
  });

  test('Procurement register (Cost group)', async ({ page }) => {
    await openTab(page, 'Cost', 'Procurement');
    await expect(page.getByText('Procurement Register')).toBeVisible();
  });

  test('RAID log with Assumptions & Dependencies (Risk)', async ({ page }) => {
    await openTab(page, 'Risk', 'RAID');
    await expect(page.getByText('RAID Log')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add assumption/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add dependency/i })).toBeVisible();
  });

  test('Schedule tab surfaces the Critical Path (CPM)', async ({ page }) => {
    await openTab(page, 'Schedule & WBS', 'Schedule');
    await expect(page.getByText(/Critical Path \(CPM\)/)).toBeVisible();
  });

  test('Forecast at completion (Monitoring)', async ({ page }) => {
    await openTab(page, 'Monitoring', 'Forecast');
    await expect(page.getByText(/Forecast at Completion/i)).toBeVisible();
  });

  test('Timesheet effort table (Monitoring)', async ({ page }) => {
    await openTab(page, 'Monitoring', 'Timesheet');
    await expect(page.getByText(/plan · earned · consumed/i)).toBeVisible();
  });
});
