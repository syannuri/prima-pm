import { test, expect } from '@playwright/test';
import { login, ACCOUNTS } from './helpers';

test.describe('Authentication & RBAC', () => {
  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/');
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
    await expect(page.getByLabel('Current password')).toBeVisible();

    // Client-side: a mismatched confirmation is flagged inline and the submit button
    // stays disabled — no request is ever made.
    await page.getByLabel('Current password').fill('Whatever-Current-1');
    await page.getByLabel('New password', { exact: true }).fill('Brand-New-Pass-1');
    await page.getByLabel('Confirm new password').fill('different-2');
    await expect(page.getByText(/does not match the new password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/change-password-form.png' });

    // Server-side: a wrong current password is rejected → NO mutation, so the account
    // keeps working (verified by every other test logging in).
    await page.getByLabel('New password', { exact: true }).fill('Some-Strong-Pass-9');
    await page.getByLabel('Confirm new password').fill('Some-Strong-Pass-9');
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
    await expect(page.getByText(ACCOUNTS.Admin.email)).toBeVisible();
    await expect(page.getByText(ACCOUNTS['Project Manager'].email)).toBeVisible();
    await page.screenshot({ path: 'test-results/admin-users.png', fullPage: true });

    // Non-admin (a Project Manager): no link, and direct navigation is blocked by a notice.
    await page.getByRole('button', { name: 'Logout' }).click();
    await login(page, 'Project Manager');
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page.getByText(/need the Admin role/i)).toBeVisible();
  });

  test('logout returns to the login screen', async ({ page }) => {
    await login(page, 'Admin');
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
