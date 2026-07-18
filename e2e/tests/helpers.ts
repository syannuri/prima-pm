import { Page, expect } from '@playwright/test';

export type Role = 'Admin' | 'Project Manager' | 'Finance';

// Emails + passwords are env-overridable so the suite runs against a freshly-seeded DB
// (the dev-only example.com seed accounts, the defaults below) OR any other DB (e.g. the
// live prod DB with its real accounts): set E2E_{ADMIN,PM,FINANCE}_{EMAIL,PASSWORD}.
// NO password is hard-coded here (this repo is public): the default is empty, so a local
// run must export E2E_*_PASSWORD (the seed password — SEED_PASSWORD, see server/prisma/seed.ts).
// CI sets both the seed's SEED_PASSWORD and these E2E_*_PASSWORD to the same value.
export const ACCOUNTS: Record<Role, { email: string; password: string }> = {
  Admin: { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com', password: process.env.E2E_ADMIN_PASSWORD ?? '' },
  'Project Manager': { email: process.env.E2E_PM_EMAIL ?? 'pm@example.com', password: process.env.E2E_PM_PASSWORD ?? '' },
  Finance: { email: process.env.E2E_FINANCE_EMAIL ?? 'finance@example.com', password: process.env.E2E_FINANCE_PASSWORD ?? '' },
};

/** Log in by typing the real account's email + password. */
export async function login(page: Page, role: Role = 'Project Manager') {
  const acct = ACCOUNTS[role];
  await page.goto('/login');
  // If a stale token persists, the app skips the login screen — clear first.
  // Tokens live in sessionStorage now; clear localStorage too for the migration path.
  await page.evaluate(() => { sessionStorage.removeItem('prima_token'); localStorage.removeItem('prima_token'); });
  await page.reload();

  // Login form is ready (the brand wordmark is no longer a heading, so wait on the field).
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(acct.email);
  await page.getByLabel('Password').fill(acct.password);
  // The redesigned form gates "Sign in" behind `canSubmit` (valid email + password);
  // wait for it to enable so a fast fill→click doesn't hit a still-disabled button.
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeEnabled();
  await signIn.click();

  // Header logout button only renders once authenticated.
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
}

/**
 * Open a chartered project and wait for its detail page. Picks a non-DRAFT card
 * explicitly — user-created DRAFT projects sort first, so "the first card" is not
 * reliably chartered.
 */
export async function openFirstProject(page: Page) {
  await page.getByRole('button', { name: 'Project Cards' }).click();
  // Open the canonical fully-populated seed project (charter + manpower + risk +
  // schedule). Scoped to <main> to hit the card, not the sidebar nav link. Targeting
  // it by name avoids depending on card order (other chartered projects may lack
  // manpower rows that some tests need).
  const charteredCard = page
    .locator('main a[href^="/projects/"]')
    .filter({ hasText: 'SOC Modernization' })
    .first();
  await expect(charteredCard).toBeVisible();
  await charteredCard.click();
  await expect(page.getByRole('tab', { name: 'Initiating', exact: true })).toBeVisible();
}
