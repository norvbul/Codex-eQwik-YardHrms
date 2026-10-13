import assert from 'node:assert/strict';
import { company, member, type Actor } from '../tests/support/fixtures.js';
import { syntheticRules, syntheticVectors } from '../tests/support/payroll.js';
import { db, jobs, hash } from '../apps/api/src/core.js';
import { preparePayroll } from '../apps/api/src/payroll.js';
import { generatePayslip } from '../apps/api/src/payslips.js';
if (
  process.env.YARD_ISOLATED_TESTS !== 'true' ||
  !/^\/yardhrms_test_[a-f0-9]{12}$/.test(new URL(process.env.DATABASE_URL!).pathname)
)
  throw new Error('Recovery fixture requires an owned isolated test database');
const post = async (a: Actor, path: string, body: object, expected: number) => {
  const result = await a.agent
    .post('/api/v1' + path)
    .set('x-csrf-token', a.csrf)
    .send(body);
  assert.equal(result.status, expected, JSON.stringify(result.body));
  return result.body.data;
};
try {
  const admin = await company('recovery-fixture');
  await db.subscription.update({
    where: { tenantId: admin.tenantId },
    data: {
      features: ['employees', 'payroll', 'payslips', 'reports'],
      employeeLimit: 10,
      userLimit: 10,
    },
  });
  const finance = await member(admin, 'FINANCE_APPROVER');
  await post(
    admin,
    '/employees',
    {
      employeeNumber: 'RECOVERY-TEST',
      firstName: 'Synthetic',
      lastName: 'Recovery Fixture',
      hireDate: '2026-01-01',
      frequency: 'MONTHLY',
      payType: 'SALARY',
      basePay: '100000',
      standardHours: '173.33',
      active: true,
      reason: 'Explicit isolated recovery fixture',
    },
    201,
  );
  const rule = await post(
    admin,
    '/payroll/rules',
    {
      name: 'Synthetic recovery fixture only',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'Synthetic arithmetic; not verified Jamaican rates',
      configuration: syntheticRules,
      referenceVectors: syntheticVectors,
    },
    201,
  );
  await post(
    finance,
    '/payroll/rules/' + rule.id + '/approve',
    { reviewerName: 'Explicit synthetic independent reviewer', attestation: true },
    200,
  );
  const run = await post(
    admin,
    '/payroll-runs',
    { frequency: 'MONTHLY', startDate: '2026-09-01', endDate: '2026-09-30', payDate: '2026-09-30' },
    201,
  );
  const prepare = await post(admin, '/payroll-runs/' + run.id + '/prepare', {}, 202);
  await preparePayroll(run.id, admin.tenantId, admin.userId, prepare.version);
  const prepared = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  await post(
    finance,
    '/payroll-runs/' + run.id + '/review',
    { version: prepared.version, comment: 'Explicit recovery fixture review' },
    200,
  );
  const reviewed = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  await post(finance, '/payroll-runs/' + run.id + '/approve', { version: reviewed.version }, 200);
  const snapshot = await db.payrollSnapshot.findFirstOrThrow({ where: { runId: run.id } }),
    tenant = await db.tenant.findUniqueOrThrow({ where: { id: admin.tenantId } });
  await generatePayslip(
    snapshot.id,
    admin.tenantId,
    admin.userId,
    `${admin.tenantId}/payslips/${snapshot.id}/${hash(tenant.updatedAt.toISOString() + 'APPROVED')}.pdf`,
  );
  console.log(
    'Created an isolated approved TEST_ONLY payroll and protected PDF for recovery verification.',
  );
} finally {
  await jobs.close();
  await db.$disconnect();
}
