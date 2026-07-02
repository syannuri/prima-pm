import { Page, expect } from '@playwright/test';

// Real accounts (demo accounts were deactivated). Passwords default to the values set
// at account creation but are overridable via env so the suite survives password
// rotation: E2E_ADMIN_PASSWORD / E2E_PM_PASSWORD / E2E_FINANCE_PASSWORD.
export type Role = 'Admin' | 'Project Manager' | 'Finance';

const ACCOUNTS: Record<Role, { email: string; password: string }> = {
  Admin: { email: 'mamed@prismatix.id', password: process.env.E2E_ADMIN_PASSWORD ?? 'Password123!' },
  'Project Manager': { email: 'budi@prismatix.id', password: process.env.E2E_PM_PASSWORD ?? 'Budi-Prima-2026' },
  Finance: { email: 'sari-fina@prismatix.id', password: process.env.E2E_FINANCE_PASSWORD ?? 'Sari-Prima-2026' },
};

/** Log in by typing the real account's email + password. */
export async function login(page: Page, role: Role = 'Project Manager') {
  const acct = ACCOUNTS[role];
  await page.goto('/');
  // If a stale token persists, the app skips the login screen — clear first.
  await page.evaluate(() => localStorage.removeItem('prima_token'));
  await page.reload();

  await expect(page.getByRole('heading', { name: 'PRIMA' })).toBeVisible();
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
