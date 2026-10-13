import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { company, member, cleanTenant, type Actor } from '../support/fixtures.js';
import { syntheticRules, syntheticVectors } from '../support/payroll.js';
import { db, jobs } from '../../apps/api/src/core.js';
import { preparePayroll } from '../../apps/api/src/payroll.js';
import { generatePayslip } from '../../apps/api/src/payslips.js';
import { processReport } from '../../apps/api/src/reports.js';
import { hash } from '../../apps/api/src/core.js';
let admin: Actor, finance: Actor, preparer: Actor, employee: Actor, manager: Actor, other: Actor;
let employeeId: string, runId: string, ruleId: string, snapshotId: string;
const post = (a: Actor, path: string, body: object = {}) =>
  a.agent
    .post('/api/v1' + path)
    .set('x-csrf-token', a.csrf)
    .send(body);
async function prepare() {
  const request = await post(preparer, '/payroll-runs/' + runId + '/prepare');
  assert.equal(request.status, 202, JSON.stringify(request.body));
  await preparePayroll(runId, admin.tenantId, preparer.userId, request.body.data.version);
  return db.payrollRun.findUniqueOrThrow({ where: { id: runId } });
}
before(async () => {
  admin = await company('payroll');
  other = await company('payroll-other');
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
  preparer = await member(admin, 'PAYROLL_OFFICER');
  const e = await post(admin, '/employees', {
    employeeNumber: 'PAY-1',
    firstName: 'Synthetic',
    lastName: 'Payroll Fixture',
    hireDate: '2026-01-01',
    frequency: 'MONTHLY',
    payType: 'SALARY',
    basePay: '100000',
    standardHours: '173.33',
    overtimeEligible: true,
    active: true,
    employmentType: 'Permanent',
    reason: 'Explicit payroll test fixture',
    sensitive: { bankName: 'Test institution', bankAccount: 'TEST-ACCOUNT-PRIVATE' },
  });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  employeeId = e.body.data.id;
  employee = await member(admin, 'EMPLOYEE', employeeId);
  manager = await member(admin, 'MANAGER');
});
after(async () => {
  if (admin) await db.$transaction((tx) => cleanTenant(tx, admin.tenantId), { timeout: 30000 });
  if (other) await db.$transaction((tx) => cleanTenant(tx, other.tenantId), { timeout: 30000 });
  await jobs.close();
  await db.$disconnect();
});
test('payroll cannot prepare without approved effective-dated statutory configuration', async () => {
  const created = await post(preparer, '/payroll-runs', {
    frequency: 'MONTHLY',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    payDate: '2026-09-30',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  runId = created.body.data.id;
  const queued = await post(preparer, '/payroll-runs/' + runId + '/prepare');
  assert.equal(queued.status, 202);
  await assert.rejects(() =>
    preparePayroll(runId, admin.tenantId, preparer.userId, queued.body.data.version),
  );
  assert.equal((await db.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status, 'DRAFT');
});
test('statutory approval validates reference vectors, separation, and normalized decimal storage', async () => {
  const created = await post(admin, '/payroll/rules', {
    name: 'Synthetic arithmetic only',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    sourceReference: 'Explicit synthetic arithmetic fixture; NOT Jamaican legal rates',
    configuration: syntheticRules,
    referenceVectors: syntheticVectors,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  ruleId = created.body.data.id;
  assert.equal(
    (
      await post(admin, '/payroll/rules/' + ruleId + '/approve', {
        reviewerName: 'Synthetic fixture reviewer',
        attestation: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(finance, '/payroll/rules/' + ruleId + '/approve', {
        reviewerName: 'Synthetic fixture reviewer',
        attestation: true,
      })
    ).status,
    200,
  );
  const normalized = await db.statutoryComponent.findMany({
    where: { tenantId: admin.tenantId, ruleId },
    include: { bands: true },
  });
  assert.equal(normalized.length, 4);
  assert.ok(normalized.some((c) => c.bands.length === 2));
  await assert.rejects(() =>
    db.statutoryComponent.update({
      where: { id: normalized[0].id },
      data: { employeeRate: '0.99' },
    }),
  );
});
test('AC-08: preparation snapshots approved overtime/leave, rule version and reproducible inputs', async () => {
  const overtime = await post(preparer, '/overtime', {
    employeeId,
    workDate: '2026-09-10',
    hours: '2',
    category: 'Standard',
    reason: 'Synthetic approved overtime',
  });
  assert.equal(overtime.status, 201);
  assert.equal(
    (
      await post(admin, '/overtime/' + overtime.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Reviewed test overtime',
      })
    ).status,
    200,
  );
  const leave = await db.leaveType.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: admin.tenantId, name: 'Unpaid' } },
  });
  const request = await post(preparer, '/leave-requests', {
    employeeId,
    leaveTypeId: leave.id,
    startDate: '2026-09-14',
    endDate: '2026-09-14',
    reason: 'Synthetic unpaid leave',
  });
  assert.equal(request.status, 201);
  assert.equal(
    (
      await post(admin, '/leave-requests/' + request.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Reviewed test leave',
      })
    ).status,
    200,
  );
  const r = await prepare();
  assert.equal(r.status, 'PREPARED');
  assert.equal(r.ruleId, ruleId);
  const snapshot = await db.payrollSnapshot.findFirstOrThrow({ where: { runId } });
  snapshotId = snapshot.id;
  const saved = snapshot.snapshot as unknown as {
    inputs: { overtime: { id: string }[]; leave: { id: string }[]; input: { unpaidDays: string } };
    result: { complianceMode: string };
  };
  assert.equal(saved.inputs.overtime[0].id, overtime.body.data.id);
  assert.equal(saved.inputs.leave[0].id, request.body.data.id);
  assert.equal(saved.inputs.input.unpaidDays, '1');
  assert.equal(saved.result.complianceMode, 'TEST_ONLY');
});
test('prepared payroll cannot be silently approved after changing an input', async () => {
  await post(preparer, '/payroll/adjustments', {
    employeeId,
    name: 'Synthetic bonus',
    kind: 'EARNING',
    amount: '1000',
    taxable: true,
    taxRelief: false,
    effectiveDate: '2026-09-01',
    endDate: '2026-09-30',
    reason: 'Test changed payroll input',
  });
  const stale = await post(finance, '/payroll-runs/' + runId + '/review');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_PAYROLL');
  await prepare();
  snapshotId = (await db.payrollSnapshot.findFirstOrThrow({ where: { runId } })).id;
  assert.equal((await post(finance, '/payroll-runs/' + runId + '/review')).status, 200);
  assert.equal((await post(preparer, '/payroll-runs/' + runId + '/approve')).status, 403);
  assert.equal((await post(finance, '/payroll-runs/' + runId + '/approve')).status, 200);
  assert.equal((await post(finance, '/payroll-runs/' + runId + '/lock')).status, 200);
});
test('AC-09: locked payroll and audit records are immutable through API and direct database writes', async () => {
  assert.equal((await post(preparer, '/payroll-runs/' + runId + '/prepare')).status, 409);
  await assert.rejects(() =>
    db.payrollSnapshot.update({ where: { id: snapshotId }, data: { net: '1' } }),
  );
  await assert.rejects(() => db.payrollSnapshot.delete({ where: { id: snapshotId } }));
  await assert.rejects(() =>
    db.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT' } }),
  );
  const audit = await db.auditEvent.findFirstOrThrow({
    where: { tenantId: admin.tenantId, action: 'payroll.approved' },
  });
  await assert.rejects(() =>
    db.auditEvent.update({ where: { id: audit.id }, data: { action: 'tampered' } }),
  );
  await assert.rejects(() => db.auditEvent.delete({ where: { id: audit.id } }));
  const detail = await preparer.agent.get('/api/v1/payroll-runs/' + runId);
  assert.equal(detail.status, 200);
  const bank = await db.employeeBankAccount.findUniqueOrThrow({
    where: { tenantId_employeeId: { tenantId: admin.tenantId, employeeId } },
  });
  assert.ok(!JSON.stringify(detail.body).includes(bank.accountCipher));
});
test('AC-10/12: manager payslip access is authorized and print/download attribution is audited', async () => {
  const snapshot = await db.payrollSnapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { run: true, tenant: true },
  });
  const key = `${admin.tenantId}/payslips/${snapshot.id}/${hash(snapshot.tenant.updatedAt.toISOString() + snapshot.run.status)}.pdf`;
  await generatePayslip(snapshot.id, admin.tenantId, manager.userId, key);
  const file = await manager.agent.get('/api/v1/payslips/' + snapshotId + '/download');
  assert.equal(file.status, 200, JSON.stringify(file.body));
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.ok(file.body.toString('binary').startsWith('%PDF'));
  assert.equal((await post(manager, '/payslips/' + snapshotId + '/print-event')).status, 200);
  const event = await db.auditEvent.findFirstOrThrow({
    where: { tenantId: admin.tenantId, action: 'payslip.print_requested', entityId: snapshotId },
  });
  assert.equal(event.actorId, manager.userId);
  assert.equal((event.details as { employeeId: string }).employeeId, employeeId);
  assert.equal((await other.agent.get('/api/v1/payslips/' + snapshotId + '/download')).status, 404);
  assert.equal((await employee.agent.get('/api/v1/payslips')).body.data[0].id, snapshotId);
});
test('bank output requires sensitive permission, approval and explicit test-only preview', async () => {
  assert.equal(
    (await finance.agent.get('/api/v1/payroll-runs/' + runId + '/bank-file')).status,
    403,
  );
  assert.equal((await admin.agent.get('/api/v1/payroll-runs/' + runId + '/bank-file')).status, 403);
  const csv = await admin.agent.get(
    '/api/v1/payroll-runs/' + runId + '/bank-file?testPreview=true',
  );
  assert.equal(csv.status, 200);
  assert.match(csv.text, /TEST_ONLY/);
  assert.match(csv.text, /TEST-ACCOUNT-PRIVATE/);
});
test('AC-11: expired paid access blocks new payroll while historical payslips remain protected and available', async () => {
  await db.subscription.update({
    where: { tenantId: admin.tenantId },
    data: {
      status: 'ACTIVE',
      expiresAt: new Date('2025-01-01'),
      graceEndsAt: new Date('2025-01-02'),
    },
  });
  assert.equal(
    (
      await post(preparer, '/payroll-runs', {
        frequency: 'MONTHLY',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        payDate: '2026-10-31',
      })
    ).status,
    403,
  );
  assert.equal(
    (await employee.agent.get('/api/v1/payslips/' + snapshotId + '/download')).status,
    200,
  );
  await db.subscription.update({
    where: { tenantId: admin.tenantId },
    data: { status: 'FREE', expiresAt: null, graceEndsAt: null },
  });
});
test('audited reversal retains the immutable snapshot and permits a new revision', async () => {
  const before = await db.payrollSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  assert.equal(
    (
      await post(finance, '/payroll-runs/' + runId + '/reverse', {
        reason: 'Explicit test payroll reversal for corrected input',
      })
    ).status,
    200,
  );
  const after = await db.payrollSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.equal(
    (await db.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status,
    'REVERSED',
  );
  const created = await post(preparer, '/payroll-runs', {
    frequency: 'MONTHLY',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    payDate: '2026-09-30',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.revision, 2);
  assert.ok(
    await db.auditEvent.findFirst({
      where: { tenantId: admin.tenantId, action: 'payroll.reversed' },
    }),
  );
});

test('statutory and department reports reproduce immutable results; private background exports recheck authority', async () => {
  const report = await admin.agent.get(
    '/api/v1/reports/statutory?format=json&startDate=2026-09-01&endDate=2026-09-30',
  );
  assert.equal(report.status, 200);
  assert.ok(report.body.data.rows.length >= 4);
  assert.ok(
    report.body.data.rows.every(
      (r: { complianceMode: string }) => r.complianceMode === 'TEST_ONLY',
    ),
  );
  assert.ok(!JSON.stringify(report.body).includes('TEST-ACCOUNT-PRIVATE'));
  assert.equal((await manager.agent.get('/api/v1/reports/statutory')).status, 403);
  assert.equal((await other.agent.get('/api/v1/report-jobs/' + runId + '/download')).status, 404);
  const queued = await post(admin, '/report-jobs', {
    type: 'department-payroll',
    format: 'csv',
    filters: { startDate: '2026-09-01', endDate: '2026-09-30' },
  });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  await processReport(queued.body.data.id);
  const file = await admin.agent.get('/api/v1/report-jobs/' + queued.body.data.id + '/download');
  assert.equal(file.status, 200);
  assert.ok(file.text.includes('TEST_ONLY'));
  assert.ok(file.text.includes('REVERSED'));
  assert.equal(
    (await finance.agent.get('/api/v1/report-jobs/' + queued.body.data.id + '/download')).status,
    404,
  );
  assert.ok(
    await db.auditEvent.findFirst({
      where: { entityId: queued.body.data.id, action: 'report.downloaded' },
    }),
  );
});
