import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { company, member, cleanTenant, type Actor } from '../support/fixtures.js';
import { db, jobs } from '../../apps/api/src/core.js';
import { processImport } from '../../apps/api/src/imports.js';
let admin: Actor, other: Actor, manager: Actor, employee: Actor, payroll: Actor;
let monthlyId: string, weeklyId: string, vacationId: string;
const input = (number: string, frequency = 'MONTHLY') => ({
  employeeNumber: number,
  firstName: 'Test',
  lastName: number,
  hireDate: '2026-01-01',
  frequency,
  payType: frequency === 'MONTHLY' ? 'SALARY' : 'HOURLY',
  basePay: frequency === 'MONTHLY' ? '100000.00' : '1000.00',
  standardHours: frequency === 'MONTHLY' ? '173.33' : '40.00',
  overtimeEligible: true,
  active: true,
  employmentType: 'Permanent',
  reason: 'Explicit integration fixture',
});
const post = (actor: Actor, path: string, body: object) =>
  actor.agent
    .post('/api/v1' + path)
    .set('x-csrf-token', actor.csrf)
    .send(body);
before(async () => {
  admin = await company('core');
  other = await company('other');
});
after(async () => {
  if (admin) await db.$transaction((tx) => cleanTenant(tx, admin.tenantId), { timeout: 30000 });
  if (other) await db.$transaction((tx) => cleanTenant(tx, other.tenantId), { timeout: 30000 });
  await jobs.close();
  await db.$disconnect();
});
test('EMP-001/006: employee creation persists compensation attribution and encrypted identity', async () => {
  const response = await post(admin, '/employees', {
    ...input('M-1'),
    sensitive: {
      trn: 'TEST-ID-123',
      bankName: 'Test institution',
      bankAccount: 'TEST-ACCOUNT-001',
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  monthlyId = response.body.data.id;
  const e = await db.employee.findUniqueOrThrow({ where: { id: monthlyId } });
  assert.ok(e.sensitiveCipher && !e.sensitiveCipher.includes('TEST-ID-123'));
  const bank = await db.employeeBankAccount.findUniqueOrThrow({
    where: { tenantId_employeeId: { tenantId: admin.tenantId, employeeId: monthlyId } },
  });
  assert.ok(!bank.accountCipher.includes('TEST-ACCOUNT-001'));
  const history = await db.compensationHistory.findFirstOrThrow({
    where: { tenantId: admin.tenantId, employeeId: monthlyId },
  });
  assert.equal(history.actorId, admin.userId);
  assert.equal(history.reason, 'Explicit integration fixture');
});
test('AC-12: employee IDs and associations cannot cross tenant boundaries', async () => {
  assert.equal((await other.agent.get('/api/v1/employees/' + monthlyId)).status, 404);
  assert.equal(
    (
      await other.agent
        .patch('/api/v1/employees/' + monthlyId)
        .set('x-csrf-token', other.csrf)
        .send({ firstName: 'Illegal', version: 1, reason: 'Attack fixture' })
    ).status,
    404,
  );
  const dept = await post(other, '/departments', { name: 'Other tenant department' });
  assert.equal(
    (await post(admin, '/employees', { ...input('CROSS'), departmentId: dept.body.data.id }))
      .status,
    400,
  );
});
test('AC-02: concurrent employee creates enforce Free capacity without deleting records', async () => {
  for (const n of ['W-1', 'M-2', 'M-3']) {
    const r = await post(admin, '/employees', input(n, n === 'W-1' ? 'WEEKLY' : 'MONTHLY'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (n === 'W-1') weeklyId = r.body.data.id;
  }
  const pair = await Promise.all(
    ['LAST-A', 'LAST-B'].map((n) => post(admin, '/employees', input(n))),
  );
  assert.deepEqual(pair.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await db.employee.count({ where: { tenantId: admin.tenantId, active: true } }), 5);
  assert.equal((await post(admin, '/employees', input('SIXTH'))).body.error.code, 'EMPLOYEE_LIMIT');
});
test('deactivation preserves history and reactivation respects capacity', async () => {
  let e = await db.employee.findUniqueOrThrow({ where: { id: monthlyId } });
  assert.equal(
    (
      await admin.agent
        .patch('/api/v1/employees/' + e.id)
        .set('x-csrf-token', admin.csrf)
        .send({ active: false, version: e.version, reason: 'Test deactivation' })
    ).status,
    200,
  );
  assert.ok(await db.compensationHistory.count({ where: { employeeId: e.id } }));
  assert.equal((await post(admin, '/employees', input('REPLACEMENT'))).status, 201);
  e = await db.employee.findUniqueOrThrow({ where: { id: monthlyId } });
  const reactivate = await admin.agent
    .patch('/api/v1/employees/' + e.id)
    .set('x-csrf-token', admin.csrf)
    .send({ active: true, version: e.version, reason: 'Test capacity reactivation' });
  assert.equal(reactivate.status, 409);
  await db.subscription.update({
    where: { tenantId: admin.tenantId },
    data: {
      employeeLimit: 20,
      userLimit: 20,
      features: [
        'employees',
        'leave',
        'timesheets',
        'overtime',
        'imports',
        'reports',
        'audit',
        'payroll',
        'payslips',
      ],
    },
  });
  assert.equal(
    (
      await admin.agent
        .patch('/api/v1/employees/' + e.id)
        .set('x-csrf-token', admin.csrf)
        .send({ active: true, version: e.version, reason: 'Test authorized restored capacity' })
    ).status,
    200,
  );
  manager = await member(admin, 'MANAGER', monthlyId);
  employee = await member(admin, 'EMPLOYEE', weeklyId);
  payroll = await member(admin, 'PAYROLL_OFFICER');
});
test('SEC-007: Manager listings redact compensation and bank data; employee sees only own profile', async () => {
  const list = await manager.agent.get('/api/v1/employees');
  assert.equal(list.status, 200);
  assert.ok(
    list.body.data.items
      .filter((e: { id: string }) => e.id !== monthlyId)
      .every(
        (e: Record<string, unknown>) =>
          e.basePay === undefined && e.sensitive === undefined && e.bank === undefined,
      ),
  );
  assert.equal(
    list.body.data.items.find((e: { id: string }) => e.id === monthlyId).basePay,
    '100000',
  );
  assert.equal((await employee.agent.get('/api/v1/employees/' + monthlyId)).status, 403);
  assert.equal((await employee.agent.get('/api/v1/employees/me')).body.data.id, weeklyId);
});
test('AC-06/07: monthly regular time rejected; delegated weekly overnight entry stores actor', async () => {
  const bad = await post(manager, '/timesheets', {
    employeeId: monthlyId,
    workDate: '2026-10-05',
    shift: 'Day',
    startTime: '08:00',
    endTime: '16:00',
    breakHours: '0',
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'MONTHLY_TIMESHEET');
  const delegated = await post(manager, '/timesheets', {
    employeeId: weeklyId,
    workDate: '2026-10-05',
    shift: 'Day',
    startTime: '22:00',
    endTime: '06:00',
    breakHours: '1',
  });
  assert.equal(delegated.status, 201, JSON.stringify(delegated.body));
  assert.equal(delegated.body.data.employeeId, weeklyId);
  assert.equal(delegated.body.data.submittedBy, manager.userId);
  assert.equal(String(delegated.body.data.hours), '7');
  assert.equal(delegated.body.data.status, 'PENDING');
  assert.equal(
    (
      await post(manager, '/timesheets/' + delegated.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Test self approval',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(payroll, '/timesheets/' + delegated.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Unauthorized payroll approval',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(admin, '/timesheets/' + delegated.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Reviewed test attendance',
      })
    ).status,
    200,
  );
});
test('approval scope survives role renaming and delegated submission grants no team authority', async () => {
  const entry = await post(employee, '/timesheets', {
    employeeId: weeklyId,
    workDate: '2026-10-06',
    shift: 'Day',
    startTime: '08:00',
    endTime: '16:00',
    breakHours: '0',
  });
  assert.equal(entry.status, 201);
  const role = await db.role.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: admin.tenantId, name: 'MANAGER' } },
    include: { permissions: true },
  });
  const changed = await admin.agent
    .patch('/api/v1/roles/' + role.id)
    .set('x-csrf-token', admin.csrf)
    .send({
      name: 'Custom team supervisor',
      permissions: role.permissions.map((p) => p.permissionCode),
    });
  assert.equal(changed.status, 200);
  const decision = await post(manager, '/timesheets/' + entry.body.data.id + '/decision', {
    status: 'APPROVED',
    comment: 'Not a direct report',
  });
  assert.equal(decision.status, 403);
  assert.equal(decision.body.error.code, 'APPROVAL_SCOPE');
});
test('overtime eligibility is distinct from monthly regular time eligibility', async () => {
  const r = await post(manager, '/overtime', {
    employeeId: monthlyId,
    workDate: '2026-10-07',
    hours: '2',
    category: 'Standard',
    reason: 'Test monthly approved overtime',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'PENDING');
  assert.equal(
    (
      await post(admin, '/overtime/' + r.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Reviewed test overtime',
      })
    ).status,
    200,
  );
  const e = await db.employee.findUniqueOrThrow({ where: { id: weeklyId } });
  await admin.agent
    .patch('/api/v1/employees/' + e.id)
    .set('x-csrf-token', admin.csrf)
    .send({ overtimeEligible: false, version: e.version, reason: 'Test ineligibility' });
  assert.equal(
    (
      await post(employee, '/overtime', {
        employeeId: weeklyId,
        workDate: '2026-10-08',
        hours: '1',
        category: 'Standard',
        reason: 'Should reject ineligible',
      })
    ).status,
    422,
  );
});
test('leave calendar excludes weekends/holidays and approved utilization allocates credited days', async () => {
  const type = await db.leaveType.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: admin.tenantId, name: 'Vacation' } },
  });
  vacationId = type.id;
  assert.equal(
    (await post(admin, '/holidays', { date: '2026-10-22', name: 'Explicit test holiday' })).status,
    200,
  );
  assert.equal(
    (
      await post(admin, '/leave-balances/adjust', {
        employeeId: weeklyId,
        leaveTypeId: vacationId,
        days: '20',
        effectiveDate: '2026-01-01',
        reason: 'Test opening balance',
      })
    ).status,
    200,
  );
  const r = await post(manager, '/leave-requests', {
    employeeId: weeklyId,
    leaveTypeId: vacationId,
    startDate: '2026-10-19',
    endDate: '2026-10-25',
    reason: 'Test calendar leave',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(String(r.body.data.days), '4');
  assert.equal(
    (
      await post(admin, '/leave-requests/' + r.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Reviewed test leave',
      })
    ).status,
    200,
  );
  const b = await employee.agent.get('/api/v1/leave-balances');
  assert.equal(
    b.body.data.find((x: { leaveTypeId: string }) => x.leaveTypeId === vacationId).available,
    '16.00',
  );
  assert.equal(
    (
      await post(manager, '/leave-requests', {
        employeeId: weeklyId,
        leaveTypeId: vacationId,
        startDate: '2026-10-20',
        endDate: '2026-10-21',
        reason: 'Overlapping test leave',
      })
    ).status,
    409,
  );
});
test('monthly accrual is idempotent and preserves ledger allocation history', async () => {
  const proposal = await post(admin, '/leave-types', {
    name: 'Vacation',
    paidFraction: '1',
    annualDays: '24',
    carryForwardDays: '5',
  });
  assert.equal(proposal.status, 200);
  const reviewer = await member(admin, 'COMPANY_ADMIN');
  assert.equal(
    (
      await post(admin, '/configuration-changes/' + proposal.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Self approval must be denied',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(reviewer, '/configuration-changes/' + proposal.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Independent explicit test policy review',
      })
    ).status,
    200,
  );
  const first = await post(admin, '/leave-balances/accrue', { month: '2026-10' });
  assert.equal(first.status, 200);
  assert.ok(first.body.data.posted > 0);
  const second = await post(admin, '/leave-balances/accrue', { month: '2026-10' });
  assert.equal(second.body.data.posted, 0);
  assert.equal(
    await db.leaveLedger.count({
      where: { tenantId: admin.tenantId, employeeId: weeklyId, kind: 'UTILIZATION' },
    }),
    1,
  );
});
test('AC-13: mixed import commits valid rows exactly once, redacts staging and rejects monthly time', async () => {
  const csv =
    'id,employeeNumber,firstName,lastName,hireDate,frequency,payType,basePay,standardHours,trn\n,IMP-1,Import,Valid,2026-01-01,MONTHLY,SALARY,100000,173.33,TEST-PRIVATE-ID\n,IMP-2,,Invalid,2026-01-01,MONTHLY,SALARY,100000,173.33,\n';
  const preview = await post(admin, '/imports/preview', {
    kind: 'EMPLOYEES',
    filename: 'fixture.csv',
    fileBase64: Buffer.from(csv).toString('base64'),
    mapping: {},
  });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  const id = preview.body.data.id;
  assert.equal(preview.body.data.rows[0].input.trn, 'REDACTED');
  const staging = await db.importRow.findFirstOrThrow({ where: { batchId: id, rowNumber: 2 } });
  assert.ok(!JSON.stringify(staging.input).includes('TEST-PRIVATE-ID'));
  await db.importBatch.update({ where: { id }, data: { status: 'QUEUED' } });
  await processImport(id);
  await processImport(id);
  assert.equal(
    await db.employee.count({ where: { tenantId: admin.tenantId, employeeNumber: 'IMP-1' } }),
    1,
  );
  const result = await admin.agent.get('/api/v1/imports/' + id);
  assert.deepEqual(
    result.body.data.rows.map((r: { status: string }) => r.status),
    ['CREATED', 'REJECTED'],
  );
  assert.ok(result.body.data.rows[1].error);
  const timeCsv = `employeeId,workDate,shift,startTime,endTime,breakHours\n${monthlyId},2026-10-01,Day,08:00,16:00,0\n`;
  const p = await post(admin, '/imports/preview', {
    kind: 'TIMESHEETS',
    filename: 'fixture.csv',
    fileBase64: Buffer.from(timeCsv).toString('base64'),
    mapping: {},
  });
  assert.equal(p.status, 201);
  await db.importBatch.update({ where: { id: p.body.data.id }, data: { status: 'QUEUED' } });
  await processImport(p.body.data.id);
  const r = await admin.agent.get('/api/v1/imports/' + p.body.data.id);
  assert.equal(r.body.data.rows[0].status, 'REJECTED');
  assert.match(r.body.data.rows[0].error, /MONTHLY_TIMESHEET/);
});
test('imports with update IDs preserve blank cells and cannot update another tenant', async () => {
  const csv = `id,firstName,lastName\n${weeklyId},Updated,\n${(await db.employee.findUniqueOrThrow({ where: { id: monthlyId } })).id},Changed,\n`;
  const p = await post(admin, '/imports/preview', {
    kind: 'EMPLOYEES',
    filename: 'update.csv',
    fileBase64: Buffer.from(csv).toString('base64'),
    mapping: {},
  });
  assert.equal(p.status, 201);
  await db.importBatch.update({ where: { id: p.body.data.id }, data: { status: 'QUEUED' } });
  await processImport(p.body.data.id);
  const updated = await db.employee.findUniqueOrThrow({ where: { id: weeklyId } });
  assert.equal(updated.firstName, 'Updated');
  assert.equal(updated.lastName, 'W-1');
  await db.subscription.update({
    where: { tenantId: other.tenantId },
    data: { features: ['employees', 'leave', 'timesheets', 'imports'] },
  });
  assert.equal((await other.agent.get('/api/v1/imports/' + p.body.data.id)).status, 404);
});

test('legacy employee and time IDs remain tenant-bound and repeated migration never duplicates entities', async () => {
  const stage = async (kind: string, csv: string) => {
    const response = await post(admin, '/imports/preview', {
      kind,
      filename: 'explicit-legacy-fixture.csv',
      fileBase64: Buffer.from(csv).toString('base64'),
      mapping: {},
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(
      (await post(admin, '/imports/' + response.body.data.id + '/execute', {})).status,
      200,
    );
    await processImport(response.body.data.id);
    return (await admin.agent.get('/api/v1/imports/' + response.body.data.id)).body.data;
  };
  const count = await db.employee.count({ where: { tenantId: admin.tenantId } });
  const first = await stage(
    'EMPLOYEES',
    `id,legacySource,legacyId,phone\n${monthlyId},sheet_fixture,legacy-employee-1,555-0101`,
  );
  assert.equal(first.rows[0].status, 'UPDATED');
  const repeat = await stage(
    'EMPLOYEES',
    'legacySource,legacyId,phone\nsheet_fixture,legacy-employee-1,555-0102',
  );
  assert.equal(repeat.rows[0].status, 'UPDATED');
  assert.equal(repeat.rows[0].entityId, monthlyId);
  assert.equal(await db.employee.count({ where: { tenantId: admin.tenantId } }), count);
  const timeCsv = `employeeId,workDate,shift,startTime,endTime,breakHours,legacySource,legacyId\n${weeklyId},2026-10-27,Day,09:00,17:00,1,sheet_fixture,legacy-time-1`;
  const imported = await stage('TIMESHEETS', timeCsv);
  assert.equal(imported.rows[0].status, 'CREATED');
  const repeated = await stage('TIMESHEETS', timeCsv);
  assert.equal(repeated.rows[0].status, 'SKIPPED');
  assert.equal(repeated.rows[0].entityId, imported.rows[0].entityId);
  assert.equal(
    (await other.agent.get('/api/v1/legacy-mappings?source=EMPLOYEES:sheet_fixture')).body.data
      .length,
    0,
  );
  assert.ok(
    await db.auditEvent.findFirst({
      where: { tenantId: admin.tenantId, action: 'migration.legacy_mapped', entityId: monthlyId },
    }),
  );
});

test('import staging cannot disclose compensation to an HR officer without salary-read authority', async () => {
  const csv = `id,basePay,phone\n${monthlyId},12345.67,555-0123`;
  const staged = await post(admin, '/imports/preview', {
    kind: 'EMPLOYEES',
    filename: 'explicit-private-compensation.csv',
    fileBase64: Buffer.from(csv).toString('base64'),
    mapping: {},
  });
  assert.equal(staged.status, 201);
  assert.equal(staged.body.data.rows[0].input.basePay, '12345.67');
  const hr = await member(admin, 'HR_OFFICER');
  const view = await hr.agent.get('/api/v1/imports/' + staged.body.data.id);
  assert.equal(view.status, 200);
  assert.equal(view.body.data.rows[0].input.basePay, 'REDACTED');
  assert.ok(!JSON.stringify(view.body).includes('12345.67'));
  const uploader = await admin.agent.get('/api/v1/imports/' + staged.body.data.id);
  assert.equal(uploader.body.data.rows[0].input.basePay, '12345.67');
});
