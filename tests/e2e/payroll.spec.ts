import { test, expect } from '../support/browser.js';
import { company, member, type Actor } from '../support/fixtures.js';
import { syntheticRules, syntheticVectors } from '../support/payroll.js';
import { db } from '../../apps/api/src/core.js';
let admin: Actor, finance: Actor;
async function signIn(page: import('@playwright/test').Page, actor: Actor) {
  const host = new URL(process.env.HRMS_URL!).hostname;
  await page.context().addCookies([
    {
      name: 'yard_session',
      value: actor.token,
      domain: host,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
    { name: 'yard_csrf', value: actor.csrf, domain: host, path: '/', sameSite: 'Strict' },
  ]);
}
test.beforeAll(async () => {
  admin = await company('browser-payroll');
  await db.subscription.update({
    where: { tenantId: admin.tenantId },
    data: {
      features: [
        'employees',
        'leave',
        'timesheets',
        'overtime',
        'payroll',
        'payslips',
        'reports',
        'audit',
      ],
      employeeLimit: 20,
      userLimit: 20,
    },
  });
  finance = await member(admin, 'FINANCE_APPROVER');
  const created = await admin.agent
    .post('/api/v1/employees')
    .set('x-csrf-token', admin.csrf)
    .send({
      employeeNumber: 'BROWSER-PAY-1',
      firstName: 'Browser',
      lastName: 'Payroll Fixture',
      hireDate: '2026-01-01',
      frequency: 'MONTHLY',
      payType: 'SALARY',
      basePay: '100000',
      standardHours: '173.33',
      overtimeEligible: true,
      active: true,
      employmentType: 'Permanent',
      reason: 'Explicit browser payroll fixture',
      sensitive: { bankName: 'Test institution', bankAccount: 'TEST-BROWSER-ACCOUNT' },
    });
  expect(created.status).toBe(201);
});
test.afterAll(async () => {});
test('rule approval, worker preparation, review, immutable approval and protected PDF download', async ({
  page,
}) => {
  await signIn(page, admin);
  await page.goto('/payroll-setup');
  await page.getByRole('button', { name: 'New rule version' }).click();
  await page.getByLabel('Version name').fill('Browser synthetic rules — not law');
  await page.getByLabel('Effective from').fill('2026-01-01');
  await page
    .getByLabel('Authoritative source / review reference')
    .fill('Synthetic arithmetic fixture; NOT Jamaican legal rates');
  await page.getByLabel('Reviewed rules package (JSON)').fill(JSON.stringify(syntheticRules));
  await page
    .getByLabel('Accepted reference calculations (JSON array)')
    .fill(JSON.stringify(syntheticVectors));
  await page.getByRole('button', { name: 'Save draft for review' }).click();
  await expect(page.getByText('Browser synthetic rules — not law', { exact: true })).toBeVisible();
  const reviewContext = await page.context().browser()!.newContext();
  const reviewer = await reviewContext.newPage();
  await signIn(reviewer, finance);
  await reviewer.goto(process.env.HRMS_URL! + '/payroll-setup');
  await reviewer.getByRole('button', { name: 'Review & approve' }).click();
  await reviewer
    .getByLabel('Qualified reviewer / approval name')
    .fill('Synthetic browser reviewer');
  await reviewer
    .getByLabel(
      'I attest that the package and expected calculations have been independently reviewed.',
    )
    .check();
  await reviewer.getByRole('button', { name: 'Verify vectors & approve version' }).click();
  await expect(reviewer.getByText('APPROVED', { exact: true })).toBeVisible();
  await page.goto('/payroll');
  await page.getByRole('button', { name: 'New payroll run' }).click();
  await page.getByLabel('Period start').fill('2026-08-01');
  await page.getByLabel('Period end').fill('2026-08-31');
  await page.getByLabel('Pay date', { exact: true }).fill('2026-08-31');
  await page.getByRole('button', { name: 'Create draft payroll' }).click();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare', exact: true }).click();
  await expect(page.getByText('PREPARED', { exact: true })).toBeVisible({ timeout: 30000 });
  await reviewer.goto(process.env.HRMS_URL! + '/payroll');
  await reviewer.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(reviewer.getByText('REVIEWED', { exact: true })).toBeVisible();
  reviewer.on('dialog', (dialog) => dialog.accept());
  await reviewer.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(reviewer.getByText('APPROVED', { exact: true })).toBeVisible();
  await reviewer.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(reviewer.getByText('LOCKED', { exact: true })).toBeVisible();
  await page.goto('/payslips');
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const downloaded = await file;
  expect(downloaded.suggestedFilename()).toMatch(/payslip.*\.pdf$/);
  expect(await downloaded.failure()).toBeNull();
  await page.screenshot({
    path: '/tmp/yardhrms-payslips-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await reviewContext.close();
});
