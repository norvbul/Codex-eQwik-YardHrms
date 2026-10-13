import { test, expect } from '../support/browser.js';
import type { Page } from '@playwright/test';
import argon2 from 'argon2';
import { actor, company, type Actor } from '../support/fixtures.js';
import { db, random, encrypt } from '../../apps/api/src/core.js';
let superAdmin: Actor, officer: Actor, owner: Actor;
async function staff(role: string) {
  const user = await db.user.create({
    data: {
      name: 'Explicit browser licensing staff',
      email: random().slice(0, 12) + '@example.test',
      passwordHash: await argon2.hash(random()),
      verifiedAt: new Date(),
      mfaEnabled: true,
      mfaSecret: encrypt('JBSWY3DPEHPK3PXP'),
      platformRole: role,
    },
  });
  return actor('', user.id);
}
async function session(page: Page, identity: Actor) {
  await page.context().clearCookies();
  const domain = new URL(process.env.QWIK_URL!).hostname;
  await page.context().addCookies([
    {
      name: 'yard_session',
      value: identity.token,
      domain,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
    { name: 'yard_csrf', value: identity.csrf, domain, path: '/', sameSite: 'Strict' },
  ]);
}
async function customer(page: Page) {
  await page.getByLabel('Find a customer').fill('Test browser-licence-journey');
  await expect(
    page.getByRole('option', { name: 'Test browser-licence-journey', exact: true }),
  ).toBeAttached();
  await page.getByLabel('Customer company', { exact: true }).selectOption(owner.tenantId);
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved successfully.', { exact: true })).toBeVisible();
}
async function close(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
}
test.beforeAll(async () => {
  owner = await company('browser-licence-journey');
  superAdmin = await staff('PLATFORM_SUPER_ADMIN');
  officer = await staff('PLATFORM_LICENSING_OFFICER');
});

test('paid plan, independent manual verification, one-time code display and tenant activation work through both portals', async ({
  page,
}) => {
  await session(page, superAdmin);
  await page.goto(process.env.QWIK_URL! + '/plans');
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await page.getByLabel('Plan code', { exact: true }).fill('BROWSER_PAID');
  await page
    .getByLabel('Plan name', { exact: true })
    .fill('Explicit synthetic browser pricing fixture');
  await page.getByLabel('Owner-approved price').fill('1000.00');
  await page.getByLabel('Covered duration in days').fill('30');
  await page.getByLabel('Active employee capacity').fill('20');
  await page.getByLabel('Active user capacity').fill('5');
  await page
    .getByLabel('Features (comma separated)')
    .fill('employees,leave,timesheets,overtime,reports,audit');
  await save(page);
  await close(page);
  await session(page, officer);
  await page.goto(process.env.QWIK_URL! + '/payments');
  await customer(page);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Jamaica' }).format(
      new Date(),
    ),
    date = (offset: number) =>
      new Date(new Date(today + 'T00:00:00Z').getTime() + offset * 86400000)
        .toISOString()
        .slice(0, 10);
  await page.getByLabel('Amount received').fill('1000');
  await page.getByLabel('Payment reference', { exact: true }).fill('EXPLICIT-BROWSER-RECEIPT');
  await page.getByLabel('Invoice number').fill('EXPLICIT-BROWSER-INVOICE');
  await page.getByLabel('Received date').fill(today);
  await page.getByLabel('Covered period start').fill(date(-7));
  await page.getByLabel('Covered period end').fill(date(22));
  await save(page);
  await close(page);
  await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeDisabled();
  await session(page, superAdmin);
  await page.goto(process.env.QWIK_URL! + '/payments');
  await customer(page);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page
    .getByLabel('Reason / review evidence (at least 10 characters)')
    .fill('Explicit independent synthetic receipt verification');
  await save(page);
  await close(page);
  await page.getByRole('link', { name: 'Activation Codes', exact: true }).click();
  await customer(page);
  await page.getByRole('button', { name: 'Issue code', exact: true }).click();
  await expect(
    page.getByRole('option', { name: /Explicit synthetic browser pricing fixture/ }),
  ).toBeAttached();
  await save(page);
  const code = await page.getByLabel('One-time activation code').inputValue();
  expect(code).toMatch(/^QWIK-/);
  await close(page);
  await expect(page.getByLabel('One-time activation code')).toHaveCount(0);
  await session(page, owner);
  await page.goto(process.env.HRMS_URL! + '/subscription');
  await expect(page.getByRole('heading', { name: 'Free plan', exact: true })).toBeVisible();
  await page.getByLabel('Activation code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Redeem code', exact: true }).click();
  await expect(page.getByText('Subscription activated.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Explicit synthetic browser pricing fixture plan',
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();
});
