import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requiresMfa,
  subscriptionState,
  canWriteSubscription,
  rolePermissions,
} from '../../packages/authorization/src/index.js';
import { registerSchema, companySchema } from '../../packages/types/src/index.js';
test('privileged named and custom permission roles require MFA', () => {
  assert.equal(requiresMfa(['EMPLOYEE'], null), false);
  assert.equal(requiresMfa(['COMPANY_ADMIN'], null), true);
  assert.equal(requiresMfa([], 'PLATFORM_LICENSING_OFFICER'), true);
  assert.equal(requiresMfa(['CUSTOM'], null, ['payroll.approve']), true);
});
test('expiry retains historical read policy while blocking business writes', () => {
  const base = {
    status: 'ACTIVE',
    expiresAt: new Date('2026-01-01'),
    graceEndsAt: new Date('2026-01-08'),
  };
  assert.equal(subscriptionState(base, new Date('2026-01-05')), 'GRACE');
  assert.equal(subscriptionState(base, new Date('2026-01-09')), 'EXPIRED');
  assert.equal(canWriteSubscription({ ...base, status: 'SUSPENDED' }), false);
  assert.equal(canWriteSubscription({ status: 'FREE', expiresAt: null, graceEndsAt: null }), true);
});
test('delegation does not imply approval authority', () => {
  assert.ok(rolePermissions.PAYROLL_OFFICER.includes('timesheets.submit.any'));
  assert.ok(!rolePermissions.PAYROLL_OFFICER.includes('timesheets.approve'));
  assert.ok(!rolePermissions.PAYROLL_OFFICER.includes('payroll.approve'));
});
test('registration rejects weak credentials and client tenant injection', () => {
  const base = {
    name: 'Test Administrator',
    email: 'user@example.test',
    password: 'a-secure-test-password',
    companyName: 'Test Company',
  };
  assert.equal(registerSchema.safeParse(base).success, true);
  assert.equal(registerSchema.safeParse({ ...base, password: 'short' }).success, false);
  assert.equal(registerSchema.safeParse({ ...base, tenantId: 'other' }).success, false);
});
test('company settings reject invalid timezone and insecure logo URLs', () => {
  const base = {
    legalName: 'Test Company',
    displayName: 'Test Company',
    timezone: 'America/Jamaica',
    locale: 'en-JM',
    accentColor: '#1b6b58',
    monthlyStandardHours: '173.33',
    allowSelfApproval: false,
  };
  assert.equal(companySchema.safeParse(base).success, true);
  assert.equal(companySchema.safeParse({ ...base, timezone: 'Unknown/Zone' }).success, false);
  assert.equal(companySchema.safeParse({ ...base, logoUrl: 'javascript:alert(1)' }).success, false);
});
