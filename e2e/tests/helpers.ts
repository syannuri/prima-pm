import { Page, expect } from '@playwright/test';

// Real accounts (demo accounts were deactivated). Passwords default to the values set
// at account creation but are overridable via env so the suite survives password
// rotation: E2E_ADMIN_PASSWORD / E2E_PM_PASSWORD / E2E_FINANCE_PASSWORD.
export type Role = 'Admin' | 'Project Manager' | 'Finance';

// Emails + passwords are env-overridable so the suite runs against the live prod DB
// (real accounts) OR a freshly-seeded CI DB (seed accounts): set
// E2E_{ADMIN,PM,FINANCE}_{EMAIL,PASSWORD}.
// NO passwords are hard-coded here (this repo is public). CI sets E2E_*_PASSWORD for the
// seed accounts (all Password123!); for a local run against the live DB, first export your
// own E2E_ADMIN_PASSWORD / E2E_PM_PASSWORD / E2E_FINANCE_PASSWORD.
export const ACCOUNTS: Record<Role, { email: string; password: string }> = {
  Admin: { email: process.env.E2E_ADMIN_EMAIL ?? 'mamed@prismatix.id', password: process.env.E2E_ADMIN_PASSWORD ?? '' },
  'Project Manager': { email: process.env.E2E_PM_EMAIL ?? 'budi@prismatix.id', password: process.env.E2E_PM_PASSWORD ?? '' },
  Finance: { email: process.env.E2E_FINANCE_EMAIL ?? 'sari-fina@prismatix.id', password: process.env.E2E_FINANCE_PASSWORD ?? '' },
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
  await page.getByRole('button', { name: 'Sign in' }).click();

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
  await expect(page.getByRole('button', { name: 'Charter', exact: true })).toBeVisible();
}
