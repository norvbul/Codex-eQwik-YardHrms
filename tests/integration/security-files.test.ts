import ExcelJS from 'exceljs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { company, member, type Actor } from '../support/fixtures.js';
import { db, jobs } from '../../apps/api/src/core.js';
import { processFileScan } from '../../apps/api/src/files.js';
import { RedisRateStore } from '../../apps/api/src/rate-limits.js';
let admin: Actor, other: Actor, manager: Actor, employeeId: string, fileId: string;
const post = (a: Actor, path: string, body: object) =>
  a.agent
    .post('/api/v1' + path)
    .set('x-csrf-token', a.csrf)
    .send(body);
before(async () => {
  admin = await company('security-files');
  other = await company('security-files-other');
  manager = await member(admin, 'MANAGER');
  const e = await post(admin, '/employees', {
    employeeNumber: 'SEC-1',
    firstName: 'Explicit',
    lastName: 'Security Fixture',
    hireDate: '2026-01-01',
    frequency: 'WEEKLY',
    payType: 'HOURLY',
    basePay: '100',
    standardHours: '40',
    active: true,
    reason: 'Explicit security test employee',
  });
  assert.equal(e.status, 201);
  employeeId = e.body.data.id;
});
after(async () => {
  await jobs.close();
  await db.$disconnect();
});
test('NFR-007: spoofed types, HTML and unsafe names are rejected before private storage', async () => {
  const base = {
    name: 'fixture.pdf',
    contentType: 'application/pdf',
    data: Buffer.from('<script>alert(1)</script>').toString('base64'),
  };
  assert.equal((await post(admin, '/employees/' + employeeId + '/documents', base)).status, 422);
  assert.equal(
    (
      await post(admin, '/employees/' + employeeId + '/documents', {
        ...base,
        name: '../fixture.pdf',
        data: Buffer.from('%PDF-fixture').toString('base64'),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await post(manager, '/employees/' + employeeId + '/documents', {
        ...base,
        data: Buffer.from('%PDF-fixture').toString('base64'),
      })
    ).status,
    403,
  );
});
test('private document quarantine fails closed without malware scanning and blocks cross-company access', async () => {
  const uploaded = await post(admin, '/employees/' + employeeId + '/documents', {
    name: 'explicit-quarantine-fixture.pdf',
    contentType: 'application/pdf',
    data: Buffer.from('%PDF-1.7\nExplicit quarantine test, not a generated payslip').toString(
      'base64',
    ),
    retainUntil: '2027-01-01',
  });
  assert.equal(uploaded.status, 202, JSON.stringify(uploaded.body));
  fileId = uploaded.body.data.id;
  assert.equal(uploaded.body.data.scanStatus, 'QUARANTINED');
  assert.equal(
    (await admin.agent.get('/api/v1/private-files/' + fileId + '/download')).status,
    403,
  );
  assert.equal(
    (await other.agent.get('/api/v1/private-files/' + fileId + '/download')).status,
    404,
  );
  assert.equal(
    (await manager.agent.get('/api/v1/employees/' + employeeId + '/documents')).status,
    403,
  );
  const saved = process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_HOST;
  try {
    await assert.rejects(() => processFileScan(fileId), /Configure a real ClamAV/);
  } finally {
    if (saved) process.env.CLAMAV_HOST = saved;
  }
  assert.equal(
    (await db.privateFile.findUniqueOrThrow({ where: { id: fileId } })).scanStatus,
    'QUARANTINED',
  );
});
test('distributed rate windows count concurrent requests atomically and reset only their owned key', async () => {
  const store = new RedisRateStore((process.env.QUEUE_NAMESPACE || 'yard') + ':rate:test:');
  await store.resetKey('fixture');
  const results = await Promise.all(Array.from({ length: 12 }, () => store.increment('fixture')));
  assert.deepEqual(
    results.map((r) => r.totalHits).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  await store.decrement('fixture');
  assert.equal((await store.increment('fixture')).totalHits, 12);
  await store.resetKey('fixture');
});
test('configuration history cannot be retroactive, self-approved, deleted or mutated after review', async () => {
  const proposed = await post(admin, '/reference-data', {
    category: 'OVERTIME',
    name: 'Prospective fixture',
    configuration: { multiplier: '1.25' },
    reason: 'Explicit policy test fixture',
  });
  assert.equal(proposed.status, 200);
  assert.equal(
    await db.referenceData.count({
      where: { tenantId: admin.tenantId, category: 'OVERTIME', name: 'Prospective fixture' },
    }),
    0,
  );
  assert.equal(
    (
      await post(admin, '/configuration-changes/' + proposed.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Self-approval must be rejected',
      })
    ).status,
    403,
  );
  const reviewer = await member(admin, 'COMPANY_ADMIN');
  assert.equal(
    (
      await post(reviewer, '/configuration-changes/' + proposed.body.data.id + '/decision', {
        status: 'APPROVED',
        comment: 'Explicit independent policy review',
      })
    ).status,
    200,
  );
  assert.ok(
    (await db.configurationChange.findUniqueOrThrow({ where: { id: proposed.body.data.id } }))
      .appliedAt,
  );
  await assert.rejects(() =>
    db.configurationChange.update({
      where: { id: proposed.body.data.id },
      data: { proposal: { multiplier: '9' } },
    }),
  );
  await assert.rejects(() =>
    db.configurationChange.delete({ where: { id: proposed.body.data.id } }),
  );
  assert.equal(
    (
      await post(admin, '/reference-data', {
        category: 'OVERTIME',
        name: 'Past policy fixture',
        configuration: { multiplier: '1' },
        effectiveDate: '2000-01-01',
      })
    ).status,
    422,
  );
});

test('spreadsheet ZIP sizes are checked against actual decompression before workbook parsing', async () => {
  await db.subscription.update({
    where: { tenantId: admin.tenantId },
    data: { features: ['employees', 'imports', 'reports'] },
  });
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet('Explicit fixture');
  sheet.addRow(['employeeNumber', 'firstName']);
  sheet.addRow(['FIXTURE', 'Example']);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const valid = await post(admin, '/imports/columns', {
    kind: 'EMPLOYEES',
    filename: 'fixture.xlsx',
    fileBase64: bytes.toString('base64'),
  });
  assert.equal(valid.status, 200);
  const corrupt = Buffer.from(bytes);
  let index = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(index >= 0);
  while (index >= 0) {
    if (corrupt.readUInt32LE(index + 24) > 0) {
      corrupt.writeUInt32LE(1, index + 24);
      break;
    }
    index = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), index + 4);
  }
  const rejected = await post(admin, '/imports/columns', {
    kind: 'EMPLOYEES',
    filename: 'tampered-size.xlsx',
    fileBase64: corrupt.toString('base64'),
  });
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
});
