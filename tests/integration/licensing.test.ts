import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { company, actor, type Actor } from '../support/fixtures.js';
import { db, jobs, random, encrypt } from '../../apps/api/src/core.js';
import { randomUUID } from 'node:crypto';
let tenant: Actor, other: Actor, officer: Actor, supervisor: Actor;
let planId: string,
  paymentId: string,
  rawCode: string,
  subscriptionId: string,
  originalRoles: string[];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Jamaica' }).format(new Date());
const relative = (offset: number) =>
  new Date(new Date(today + 'T00:00:00Z').getTime() + offset * 86400000).toISOString().slice(0, 10);
const termStart = relative(-7),
  termEnd = relative(22),
  renewStart = relative(23),
  renewEnd = relative(52);
const suffix = randomUUID().slice(0, 8),
  post = (a: Actor, path: string, body: object) =>
    a.agent
      .post('/api/v1' + path)
      .set('x-csrf-token', a.csrf)
      .send(body);
async function staff(role: string) {
  const u = await db.user.create({
    data: {
      name: 'Explicit test staff',
      email: `staff-${random().slice(0, 12)}@example.test`,
      passwordHash: await argon2.hash(random()),
      verifiedAt: new Date(),
      mfaEnabled: true,
      mfaSecret: encrypt('JBSWY3DPEHPK3PXP'),
      platformRole: role,
    },
  });
  return actor('', u.id);
}
before(async () => {
  tenant = await company('licensing');
  other = await company('licensing-other');
  officer = await staff('PLATFORM_LICENSING_OFFICER');
  supervisor = await staff('PLATFORM_SUPER_ADMIN');
  const product = await db.product.findUniqueOrThrow({ where: { code: 'YARD_HRMS' } });
  const plan = await post(supervisor, '/platform/plans', {
    code: 'TEST_' + suffix.toUpperCase(),
    productId: product.id,
    name: 'Explicit synthetic pricing fixture',
    price: '1000.00',
    currency: 'JMD',
    durationDays: 30,
    employeeLimit: 25,
    userLimit: 5,
    graceDays: 7,
    features: [
      'employees',
      'leave',
      'timesheets',
      'overtime',
      'payroll',
      'payslips',
      'reports',
      'imports',
      'audit',
    ],
    active: true,
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  planId = plan.body.data.id;
  subscriptionId = (
    await db.subscription.findUniqueOrThrow({ where: { tenantId: tenant.tenantId } })
  ).id;
  originalRoles = (await db.membershipRole.findMany({ where: { tenantId: tenant.tenantId } }))
    .map((r) => r.roleId)
    .sort();
});
after(async () => {
  await jobs.close();
  await db.$disconnect();
});
test('ordinary tenant accounts cannot administer plans, payments or codes', async () => {
  assert.equal((await tenant.agent.get('/api/v1/platform/payments')).status, 403);
  assert.equal(
    (await post(tenant, '/platform/codes', { tenantId: tenant.tenantId, planId })).status,
    403,
  );
  assert.equal(
    (
      await post(officer, '/platform/plans', {
        code: 'FORBIDDEN',
        productId: (await db.product.findUniqueOrThrow({ where: { code: 'YARD_HRMS' } })).id,
        name: 'Denied fixture',
        price: '1',
        currency: 'JMD',
        durationDays: 30,
        employeeLimit: 1,
        userLimit: 1,
        graceDays: 0,
        features: [],
        active: true,
      })
    ).status,
    403,
  );
});
test('AC-03: unverified payments cannot issue paid entitlements; verification requires another staff actor', async () => {
  const p = await post(officer, '/platform/payments', {
    tenantId: tenant.tenantId,
    amount: '1000',
    currency: 'JMD',
    method: 'BANK_TRANSFER',
    reference: 'fixture-' + suffix,
    invoiceNumber: 'TEST-INVOICE-' + suffix,
    paymentDate: termStart,
    periodStart: termStart,
    periodEnd: termEnd,
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  paymentId = p.body.data.id;
  const blocked = await post(supervisor, '/platform/codes', {
    tenantId: tenant.tenantId,
    planId,
    paymentId,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'VERIFIED_PAYMENT_REQUIRED');
  assert.equal(
    (
      await post(officer, '/platform/payments/' + paymentId + '/decision', {
        status: 'VERIFIED',
        reason: 'Explicit self-verification denial fixture',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(supervisor, '/platform/payments/' + paymentId + '/decision', {
        status: 'VERIFIED',
        reason: 'Explicit independent verification fixture',
      })
    ).status,
    200,
  );
  const history = await db.paymentEvent.findMany({ where: { paymentId } });
  assert.equal(history.length, 2);
  assert.equal(history.find((event) => event.status === 'VERIFIED')?.actorId, supervisor.userId);
});
test('paid code issuance preserves Free access until redemption and exposes raw value only once', async () => {
  const issued = await post(officer, '/platform/codes', {
    tenantId: tenant.tenantId,
    planId,
    paymentId,
  });
  assert.equal(issued.status, 201);
  rawCode = issued.body.data.code;
  assert.ok(rawCode.startsWith('QWIK-'));
  const code = await db.activationCode.findUniqueOrThrow({ where: { id: issued.body.data.id } });
  assert.ok(code.hash !== rawCode && !JSON.stringify(code.payload).includes(rawCode));
  assert.equal((await tenant.agent.get('/api/v1/subscription')).body.data.status, 'FREE');
  const list = await officer.agent.get('/api/v1/platform/codes');
  assert.ok(!JSON.stringify(list.body).includes(rawCode));
  assert.ok(
    list.body.data.every(
      (row: Record<string, unknown>) => row.hash === undefined && row.payload === undefined,
    ),
  );
  assert.equal(
    (await post(officer, '/platform/codes', { tenantId: tenant.tenantId, planId, paymentId }))
      .status,
    409,
  );
});
test('AC-04/05: concurrent one-time redemption activates only the bound tenant and never grants roles', async () => {
  assert.equal((await post(other, '/subscription/redeem-code', { code: rawCode })).status, 409);
  const responses = await Promise.all([
    post(tenant, '/subscription/redeem-code', { code: rawCode }),
    post(tenant, '/subscription/redeem-code', { code: rawCode }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const sub = await tenant.agent.get('/api/v1/subscription');
  assert.equal(sub.body.data.status, 'ACTIVE');
  assert.equal(sub.body.data.employeeLimit, 25);
  assert.equal(sub.body.data.userLimit, 5);
  assert.ok(sub.body.data.features.includes('payroll'));
  assert.equal((await other.agent.get('/api/v1/subscription')).body.data.status, 'FREE');
  assert.deepEqual(
    (await db.membershipRole.findMany({ where: { tenantId: tenant.tenantId } }))
      .map((r) => r.roleId)
      .sort(),
    originalRoles,
  );
  assert.equal(
    (await db.license.findUniqueOrThrow({ where: { tenantId: tenant.tenantId } })).activatedBy,
    tenant.userId,
  );
});
test('AC-14: verified renewal extends the existing entitlement without a new code', async () => {
  const p = await post(officer, '/platform/payments', {
    tenantId: tenant.tenantId,
    amount: '1000',
    currency: 'JMD',
    method: 'CASH',
    reference: 'renew-' + suffix,
    invoiceNumber: 'TEST-RENEWAL-' + suffix,
    paymentDate: today,
    periodStart: renewStart,
    periodEnd: renewEnd,
  });
  assert.equal(p.status, 201);
  assert.equal(
    (
      await post(supervisor, '/platform/payments/' + p.body.data.id + '/decision', {
        status: 'VERIFIED',
        reason: 'Reviewed synthetic renewal receipt',
      })
    ).status,
    200,
  );
  const before = await db.subscription.findUniqueOrThrow({ where: { tenantId: tenant.tenantId } }),
    count = await db.activationCode.count({ where: { tenantId: tenant.tenantId } });
  const renewed = await post(officer, '/platform/subscriptions/' + subscriptionId + '/renew', {
    paymentId: p.body.data.id,
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.data.id, subscriptionId);
  assert.ok(new Date(renewed.body.data.expiresAt) > before.expiresAt!);
  assert.equal(await db.activationCode.count({ where: { tenantId: tenant.tenantId } }), count);
  assert.equal(
    (
      await post(officer, '/platform/subscriptions/' + subscriptionId + '/renew', {
        paymentId: p.body.data.id,
      })
    ).status,
    409,
  );
});
test('plan edits do not silently mutate issued entitlements and downgrade never deletes data', async () => {
  const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
  const changed = await supervisor.agent
    .patch('/api/v1/platform/plans/' + planId)
    .set('x-csrf-token', supervisor.csrf)
    .send({
      code: plan.code,
      productId: plan.productId,
      name: plan.name,
      price: plan.price!.toString(),
      currency: plan.currency,
      durationDays: plan.durationDays,
      employeeLimit: 1,
      userLimit: 1,
      graceDays: plan.graceDays,
      features: ['employees', 'leave'],
      active: true,
    });
  assert.equal(changed.status, 200);
  assert.equal((await tenant.agent.get('/api/v1/subscription')).body.data.employeeLimit, 25);
  const adjusted = await post(
    supervisor,
    '/platform/subscriptions/' + subscriptionId + '/capacity',
    { employeeLimit: 1, userLimit: 1, reason: 'Explicit synthetic capacity change fixture' },
  );
  assert.equal(adjusted.status, 200);
  assert.equal(await db.membership.count({ where: { tenantId: tenant.tenantId } }), 1);
  assert.ok(
    await db.subscriptionEvent.findFirst({
      where: { tenantId: tenant.tenantId, kind: 'CAPACITY_CHANGED' },
    }),
  );
});
test('verified-payment reversal is auditable and suspends affected access without deleting records', async () => {
  assert.equal(
    (
      await post(officer, '/platform/payments/' + paymentId + '/decision', {
        status: 'REVERSED',
        reason: 'Unauthorized reversal attempt fixture',
      })
    ).status,
    403,
  );
  const reversed = await post(supervisor, '/platform/payments/' + paymentId + '/decision', {
    status: 'REVERSED',
    reason: 'Explicit synthetic payment reversal fixture',
  });
  assert.equal(reversed.status, 200);
  assert.equal((await tenant.agent.get('/api/v1/subscription')).body.data.status, 'SUSPENDED');
  assert.equal((await tenant.agent.get('/api/v1/dashboard')).status, 403);
  assert.equal(await db.tenant.count({ where: { id: tenant.tenantId } }), 1);
  const restored = await post(supervisor, '/platform/subscriptions/' + subscriptionId + '/status', {
    status: 'ACTIVE',
    reason: 'Explicit financial follow-up and restoration fixture',
  });
  assert.equal(restored.status, 200);
  assert.ok(
    (await db.paymentEvent.findMany({ where: { paymentId } })).some((e) => e.status === 'REVERSED'),
  );
});
test('commercial overrides are disabled by default and require explicit Super Admin policy', async () => {
  assert.equal(
    (
      await post(supervisor, '/platform/codes', {
        tenantId: other.tenantId,
        planId,
        overrideReason: 'Explicit rejected override fixture',
        overridePeriodStart: termStart,
        overridePeriodEnd: termEnd,
      })
    ).status,
    403,
  );
  const policy = await supervisor.agent
    .patch('/api/v1/platform/settings')
    .set('x-csrf-token', supervisor.csrf)
    .send({
      paymentSeparationOfDuties: true,
      allowCommercialOverrides: true,
      activationTtlDays: 7,
      reason: 'Explicit synthetic policy approval fixture',
    });
  assert.equal(policy.status, 200);
  assert.equal(
    (
      await post(officer, '/platform/codes', {
        tenantId: other.tenantId,
        planId,
        overrideReason: 'Officer override must remain forbidden',
        overridePeriodStart: termStart,
        overridePeriodEnd: termEnd,
      })
    ).status,
    403,
  );
  const allowed = await post(supervisor, '/platform/codes', {
    tenantId: other.tenantId,
    planId,
    overrideReason: 'Explicit authorized synthetic commercial override',
    overridePeriodStart: termStart,
    overridePeriodEnd: termEnd,
  });
  assert.equal(allowed.status, 201);
  assert.ok(
    await db.auditEvent.findFirst({
      where: {
        scope: 'PLATFORM',
        action: 'platform.subscription.code_issued',
        tenantId: other.tenantId,
      },
    }),
  );
});

test('commercial override authority is refreshed after a concurrent staff downgrade', async () => {
  const session = await db.session.findUniqueOrThrow({
    where: { tokenHash: (await import('../../apps/api/src/core.js')).hash(supervisor.token) },
  });
  let release!: () => void, ready!: () => void;
  const waitRelease = new Promise<void>((resolve) => (release = resolve)),
    acquired = new Promise<void>((resolve) => (ready = resolve));
  const locked = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id=${supervisor.userId} FOR UPDATE`;
      ready();
      await waitRelease;
      await tx.user.update({
        where: { id: supervisor.userId },
        data: { platformRole: 'PLATFORM_LICENSING_OFFICER' },
      });
    },
    { timeout: 10000 },
  );
  await acquired;
  const pending = Promise.resolve(
    post(supervisor, '/platform/codes', {
      tenantId: other.tenantId,
      planId,
      overrideReason: 'Explicit race fixture must lose Super Administrator override authority',
      overridePeriodStart: termStart,
      overridePeriodEnd: termEnd,
    }),
  );
  let authenticated = false;
  try {
    for (let i = 0; i < 100; i++) {
      const current = await db.session.findUniqueOrThrow({ where: { id: session.id } });
      if (current.lastSeenAt > session.lastSeenAt) {
        authenticated = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(authenticated, 'The request must authenticate before the locked role changes');
  } finally {
    release();
    await locked;
  }
  const result = await pending;
  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal(result.body.error.code, 'VERIFIED_PAYMENT_REQUIRED');
});
