import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test.describe('Authentication & RBAC', () => {
  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => { sessionStorage.removeItem('prima_token'); localStorage.removeItem('prima_token'); });
    await page.reload();

    await page.getByLabel('Email').fill(ACCOUNTS['Project Manager'].email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Generous timeout: the login round-trip can be slow on a cold dev server.
    await expect(page.getByText(/invalid|incorrect|credential/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0);
  });

  test('PM can log in and reaches the dashboard', async ({ page }) => {
    await login(page, 'Project Manager');
    // Dashboard greeting heading ("Good <time>, <name> 👋") — matched via the wave emoji.
    await expect(page.getByRole('heading', { name: /👋/ })).toBeVisible();
    await expect(page.getByText('PROJECT_MANAGER', { exact: true })).toBeVisible();
  });

  test('only PMO/Admin can create projects; PM and Finance cannot', async ({ page }) => {
    test.slow(); // three logins
    // Admin can create.
    await login(page, 'Admin');
    await expect(page.getByRole('button', { name: '+ New Project' })).toBeVisible();

    // Project Manager cannot create (PMO assigns projects to PMs, not the reverse).
    await page.getByRole('button', { name: 'Logout' }).click();
    await login(page, 'Project Manager');
    await expect(page.getByText('PROJECT_MANAGER', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New Project' })).toHaveCount(0);

    // Finance cannot either.
    await page.getByRole('button', { name: 'Logout' }).click();
    await login(page, 'Finance');
    await expect(page.getByText('FINANCE', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New Project' })).toHaveCount(0);
  });

  test('change-password form validates without mutating the account', async ({ page }) => {
    await login(page, 'Project Manager');
    // Change-password now lives on the Settings page (moved out of the header).
    await page.goto('/settings');
    // Target the three fields by their autocomplete tokens: the live password checklist
    // renders inside the <label>, so getByLabel('New password') is no longer an exact
    // accessible-name match once a value is typed.
    const currentPw = page.locator('input[autocomplete="current-password"]');
    const newPw = page.locator('input[autocomplete="new-password"]').first();
    const confirmPw = page.locator('input[autocomplete="new-password"]').nth(1);
    await expect(currentPw).toBeVisible();

    // Client-side: a mismatched confirmation is flagged inline and the submit button
    // stays disabled — no request is ever made.
    await currentPw.fill('Whatever-Current-1');
    await newPw.fill('Brand-New-Pass-1');
    await confirmPw.fill('different-2');
    await expect(page.getByText(/does not match the new password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/change-password-form.png' });

    // Server-side: a wrong current password is rejected → NO mutation, so the account
    // keeps working (verified by every other test logging in).
    await confirmPw.fill('Some-Strong-Pass-9');
    await newPw.fill('Some-Strong-Pass-9');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText(/incorrect|invalid|differ|common|breach/i)).toBeVisible();
  });

  test('admin sees the Users management page; non-admins do not', async ({ page }) => {
    test.slow(); // two full logins + navigation — give it extra time on a cold dev server
    // Admin: header link + populated user table + create form.
    await login(page, 'Admin');
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'User management' })).toBeVisible();
    await expect(page.getByText('Create user')).toBeVisible();
    // The admin's own email also renders in the sidebar profile, so scope to the user table.
    await expect(page.getByRole('cell', { name: ACCOUNTS.Admin.email })).toBeVisible();
    await expect(page.getByRole('cell', { name: ACCOUNTS['Project Manager'].email })).toBeVisible();
    await page.screenshot({ path: 'test-results/admin-users.png', fullPage: true });

    // Non-admin (a Project Manager): no link, and direct navigation is blocked by a notice.
    await page.getByRole('button', { name: 'Logout' }).click();
    await login(page, 'Project Manager');
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page.getByText(/need the Admin role/i)).toBeVisible();
  });

  test('logout returns to the public landing (with a Sign in link)', async ({ page }) => {
    await login(page, 'Admin');
    await page.getByRole('button', { name: 'Logout' }).click();
    // After logout the guest lands on the public homepage at "/".
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    // "Enter Prismatix" appears twice (hero + closing CTA) — scope to the first.
    await expect(page.getByRole('link', { name: 'Enter Prismatix' }).first()).toBeVisible();
  });
});
