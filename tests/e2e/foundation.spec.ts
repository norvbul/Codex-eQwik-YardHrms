import { test, expect } from '../support/browser.js';
import * as OTPAuth from 'otpauth';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cleanTenant } from '../support/fixtures.js';
import { db } from '../../apps/api/src/core.js';
const suffix = randomUUID().slice(0, 8),
  email = `browser-${suffix}@example.test`,
  staffEmail = `staff-${suffix}@example.test`,
  password = 'Browser-test-password-2026';
async function mailboxLink(recipient: string, path: string) {
  for (let i = 0; i < 30; i++) {
    const listing = await fetch('http://127.0.0.1:8025/api/v1/messages').then((r) => r.json());
    for (const message of listing.messages || []) {
      if (message.To?.some((to: { Address: string }) => to.Address === recipient)) {
        const body = await fetch('http://127.0.0.1:8025/api/v1/message/' + message.ID).then((r) =>
          r.json(),
        );
        const match = String(body.Text).match(
          new RegExp('http://127\\.0\\.0\\.1:[0-9]+/' + path + '\\?token=[A-Za-z0-9_-]+'),
        );
        if (match) return match[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Expected email was not delivered to the development mailbox');
}
async function enroll(page: import('@playwright/test').Page, recipient: string) {
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  const secret = await page.locator('.mfa-secret>code').innerText();
  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    issuer: 'eQwik YardHRMS',
    label: recipient,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
  await page.getByLabel('Six-digit authenticator code').fill(code);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
}
test.afterAll(async () => {
  if (process.env.YARD_ISOLATED_TESTS !== 'true')
    for (const recipient of [email, staffEmail]) {
      const user = await db.user.findUnique({
        where: { email: recipient },
        include: { memberships: true },
      });
      if (!user) continue;
      if (user.memberships.length)
        for (const member of user.memberships)
          await db.$transaction((tx) => cleanTenant(tx, member.tenantId), { timeout: 30000 });
      else
        await db.$transaction(async (tx) => {
          await tx.session.deleteMany({ where: { userId: user.id } });
          await tx.authToken.deleteMany({ where: { userId: user.id } });
          await tx.auditEvent.deleteMany({ where: { actorId: user.id } });
          await tx.user.delete({ where: { id: user.id } });
        });
    }
});
test('Free registration, real email, MFA, branding, mobile navigation and platform denial', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', { name: 'Create your Free company', exact: false }).click();
  await page.getByLabel('Your full name').fill('Browser Test Admin');
  await page.getByLabel('Company name').fill('Browser Test Company ' + suffix);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create Free company' }).click();
  await expect(
    page.getByText('Check your email to verify your account.', { exact: false }),
  ).toBeVisible();
  const link = new URL(await mailboxLink(email, 'verify-email'));
  await page.goto(link.pathname + link.search);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByText('Email verified. You can now sign in.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await enroll(page, email);
  await expect(
    page.getByRole('heading', { name: 'Welcome to Browser Test Company ' + suffix }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Company Settings', exact: true }).click();
  await page.getByLabel('Display / trading name').fill('Branded Company ' + suffix);
  await page.getByRole('button', { name: 'Save company settings' }).click();
  await expect(page.getByText('Company settings saved.')).toBeVisible();
  await expect(page).toHaveTitle('Branded Company ' + suffix + ' · eQwik YardHRMS');
  await page.getByRole('link', { name: 'Employees', exact: true }).click();
  await page.getByRole('button', { name: 'Add employee' }).click();
  await page.getByLabel('Employee number').fill('BROWSER-1');
  await page.getByLabel('First name').fill('Browser');
  await page.getByLabel('Last name').fill('Employee');
  await page.getByLabel('Base pay (JMD)').fill('100000.00');
  await page.getByLabel('Reason for this change').fill('Explicit browser test fixture');
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByText('BROWSER-1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('First name').fill('Updated Browser');
  await page.getByLabel('Reason for this change').fill('Browser edit validation');
  await page.getByRole('button', { name: 'Save employee' }).click();
  await expect(page.getByText('Updated Browser Employee', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Timesheets', exact: true }).click();
  await page.getByRole('button', { name: 'Submit entry' }).click();
  await expect(
    page.locator('select[name="employeeId"] option').filter({ hasText: 'BROWSER-1' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close entry form' }).click();
  await page.getByRole('link', { name: 'Subscription', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Free plan' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome to Branded Company ' + suffix }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: '/tmp/yardhrms-dashboard-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: '/tmp/yardhrms-dashboard-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto((process.env.QWIK_URL || 'http://127.0.0.1:5174') + '/dashboard');
  await expect(page.getByText('This account has no Qwik platform access.')).toBeVisible();
  expect(errors).toEqual([]);
});
test('Qwik invitation, mandatory MFA and commercial-only portal', async ({ page }) => {
  execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/invite-platform.ts',
      staffEmail,
      'Browser Licensing Staff',
      'PLATFORM_LICENSING_OFFICER',
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
  const link = new URL(await mailboxLink(staffEmail, 'reset-password'));
  await page.goto((process.env.QWIK_URL || 'http://127.0.0.1:5174') + link.pathname + link.search);
  await page.getByLabel('New password').fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Password set. Sign in with your new password.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email address').fill(staffEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await enroll(page, staffEmail);
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Plans & Features', exact: true }).click();
  await expect(page.getByText('Price unset', { exact: true })).toHaveCount(3);
  await page.screenshot({
    path: '/tmp/yardhrms-qwik-plans.png',
    fullPage: true,
    animations: 'disabled',
  });
  const forbidden = await page.evaluate(async () => {
    const r = await fetch('/api/v1/tenants/current');
    return r.status;
  });
  expect(forbidden).toBe(403);
});
