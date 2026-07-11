import { test, expect, type Page } from '@playwright/test';
import { login, openFirstProject } from './helpers';

// Two-level tab bar: open the lifecycle phase (its aria-label) then the sub-tab. `.first()`
// guards against the phase name also existing as a sub-tab pill once the group is active.
async function openTab(page: Page, phase: string, tab: string) {
  await page.getByRole('button', { name: phase, exact: true }).first().click();
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

  test('Stakeholder register (Charter phase)', async ({ page }) => {
    await openTab(page, 'Initiating', 'Stakeholders');
    await expect(page.getByText('Stakeholder Register')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add stakeholder/i })).toBeVisible();
  });

  test('Procurement register (Plan phase)', async ({ page }) => {
    await openTab(page, 'Planning', 'Procurement');
    await expect(page.getByText('Procurement Register')).toBeVisible();
  });

  test('RAID log with Assumptions & Dependencies (Execute phase)', async ({ page }) => {
    await openTab(page, 'Executing', 'RAID');
    await expect(page.getByText('RAID Log')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add assumption/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add dependency/i })).toBeVisible();
  });

  test('Schedule tab surfaces the Critical Path (CPM)', async ({ page }) => {
    await openTab(page, 'Planning', 'Schedule');
    await expect(page.getByText(/Critical Path \(CPM\)/)).toBeVisible();
  });

  test('Forecast at completion (Track phase)', async ({ page }) => {
    await openTab(page, 'Monitoring & Controlling', 'Forecast');
    await expect(page.getByText(/Forecast at Completion/i)).toBeVisible();
  });

  test('Timesheet effort table (Execute phase)', async ({ page }) => {
    await openTab(page, 'Executing', 'Timesheet');
    await expect(page.getByText(/plan · earned · consumed/i)).toBeVisible();
  });
});
