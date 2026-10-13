import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { randomUUID } from 'node:crypto';
import { app } from '../../apps/api/src/app.js';
import { db, jobs } from '../../apps/api/src/core.js';
const suffix = randomUUID().slice(0, 8),
  password = 'Integration-test-password-2026';
type Fixture = {
  email: string;
  tenantId: string;
  userId: string;
  agent: ReturnType<typeof request.agent>;
  csrf: string;
};
const fixtures: Fixture[] = [];
async function createCompany(label: string): Promise<Fixture> {
  const email = `${label}-${suffix}@example.test`;
  const agent = request.agent(app);
  const registration = await agent.post('/api/v1/auth/register').send({
    name: `${label} Admin`,
    email,
    password,
    companyName: `Integration ${label} ${suffix}`,
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.body));
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: true },
  });
  const f = { email, userId: user.id, tenantId: user.memberships[0].tenantId, agent, csrf: '' };
  fixtures.push(f);
  const mails = await jobs.getJobs(['wait', 'delayed', 'active']);
  const mail = mails.find((m) => m.data.to === email);
  assert.ok(mail, 'Verification notification queued');
  const token = new URL(mail.data.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  assert.ok(token);
  const verification = await agent.post('/api/v1/auth/verify-email').send({ token });
  assert.equal(verification.status, 200, JSON.stringify(verification.body));
  assert.equal(
    (await agent.post('/api/v1/auth/verify-email').send({ token })).status,
    400,
    'Verification token is single-use',
  );
  assert.equal((await agent.post('/api/v1/auth/login').send({ email, password })).status, 200);
  let me = await agent.get('/api/v1/me');
  f.csrf = me.body.data.csrfToken;
  assert.equal(me.body.data.mfaRequired, true);
  assert.equal(
    (await agent.get('/api/v1/dashboard')).status,
    403,
    'MFA gate applies before business reads',
  );
  const setup = await agent.post('/api/v1/auth/mfa/setup').set('x-csrf-token', f.csrf).send({});
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(setup.body.data.secret),
    issuer: 'eQwik YardHRMS',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
  assert.equal(
    (await agent.post('/api/v1/auth/mfa/verify').set('x-csrf-token', f.csrf).send({ code })).status,
    200,
  );
  me = await agent.get('/api/v1/me');
  assert.equal(me.body.data.mfaRequired, false);
  return f;
}
let first: Fixture, second: Fixture;
before(async () => {
  first = await createCompany('first');
  second = await createCompany('second');
});
after(async () => {
  if (process.env.YARD_ISOLATED_TESTS !== 'true')
    for (const f of fixtures) {
      const members = await db.membership.findMany({ where: { tenantId: f.tenantId } }),
        ids = members.map((m) => m.userId);
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: { in: ids } } });
        await tx.authToken.deleteMany({ where: { userId: { in: ids } } });
        await tx.auditEvent.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.membershipRole.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.membership.deleteMany({ where: { tenantId: f.tenantId } });
        const roles = await tx.role.findMany({ where: { tenantId: f.tenantId } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
        await tx.role.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.subscription.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.referenceData.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.leaveType.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.department.deleteMany({ where: { tenantId: f.tenantId } });
        await tx.tenant.delete({ where: { id: f.tenantId } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      });
    }
  for (const mail of await jobs.getJobs(['wait', 'delayed']))
    if (String(mail.data.to).includes(suffix)) await mail.remove();
  await jobs.close();
  await db.$disconnect();
});
test('AC-01: Free provisioning is central, idempotent, payment-free', async () => {
  const res = await first.agent.get('/api/v1/subscription');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.plan.code, 'FREE');
  assert.equal(res.body.data.employeeLimit, 5);
  assert.equal(res.body.data.userLimit, 2);
  assert.equal(res.body.data.usage.users, 1);
  assert.equal(await db.manualPayment.count({ where: { tenantId: first.tenantId } }), 0);
  assert.equal(
    (
      await first.agent
        .post('/api/v1/subscription/start-free')
        .set('x-csrf-token', first.csrf)
        .send({})
    ).status,
    200,
  );
  assert.equal(await db.subscription.count({ where: { tenantId: first.tenantId } }), 1);
});
test('SEC-002: unauthenticated sessions and missing CSRF tokens are rejected', async () => {
  assert.equal((await request(app).get('/api/v1/me')).status, 401);
  assert.equal((await first.agent.post('/api/v1/auth/logout').send({})).status, 403);
  assert.equal(
    (await first.agent.post('/api/v1/auth/logout').set('x-csrf-token', 'invalid').send({})).status,
    403,
  );
});
test('SEC-004: tenant Admin cannot enter Qwik platform endpoints', async () => {
  assert.equal((await first.agent.get('/api/v1/platform/customers')).status, 403);
  assert.equal((await first.agent.get('/api/v1/platform/plans')).status, 403);
});
test('AC-12 foundation: active tenant comes from authorized membership', async () => {
  assert.equal(
    (
      await first.agent
        .post('/api/v1/auth/switch-tenant')
        .set('x-csrf-token', first.csrf)
        .send({ tenantId: second.tenantId })
    ).status,
    403,
  );
  const current = await first.agent.get('/api/v1/tenants/current');
  assert.equal(current.body.data.id, first.tenantId);
  assert.equal(
    (
      await first.agent
        .patch('/api/v1/tenants/current')
        .set('x-csrf-token', first.csrf)
        .send({ ...current.body.data, tenantId: second.tenantId })
    ).status,
    422,
  );
});
test('AC-15: company branding updates are persistent and audited', async () => {
  const body = {
    legalName: 'Integration legal ' + suffix,
    displayName: 'Updated company ' + suffix,
    address: 'Test address',
    contactEmail: first.email,
    timezone: 'America/Jamaica',
    locale: 'en-JM',
    logoUrl: '',
    accentColor: '#2b705a',
    monthlyStandardHours: '180.00',
    allowSelfApproval: false,
  };
  const r = await first.agent
    .patch('/api/v1/tenants/current')
    .set('x-csrf-token', first.csrf)
    .send(body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const me = await first.agent.get('/api/v1/me');
  assert.equal(me.body.data.tenant.displayName, body.displayName);
  assert.equal(String(me.body.data.tenant.monthlyStandardHours), '180');
  assert.ok(
    await db.auditEvent.findFirst({
      where: { tenantId: first.tenantId, action: 'company.updated', actorId: first.userId },
    }),
  );
});
test('LIC-011: concurrent seat invitations cannot exceed Free capacity', async () => {
  const role = await db.role.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: first.tenantId, name: 'EMPLOYEE' } },
  });
  const responses = await Promise.all(
    ['invite-a', 'invite-b'].map((n) =>
      first.agent
        .post('/api/v1/users/invite')
        .set('x-csrf-token', first.csrf)
        .send({ name: n, email: `${n}-${suffix}@example.test`, roleId: role.id }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await db.membership.count({ where: { tenantId: first.tenantId, active: true } }), 2);
});
test('tenant-qualified role FK rejects cross-company assignment', async () => {
  const member = await db.membership.findUniqueOrThrow({
    where: { tenantId_userId: { tenantId: first.tenantId, userId: first.userId } },
  });
  const foreignRole = await db.role.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: second.tenantId, name: 'EMPLOYEE' } },
  });
  await assert.rejects(() =>
    db.membershipRole.create({
      data: { tenantId: first.tenantId, membershipId: member.id, roleId: foreignRole.id },
    }),
  );
});
test('LIC-010: expired subscription blocks company writes but retains permitted history', async () => {
  await db.subscription.update({
    where: { tenantId: second.tenantId },
    data: {
      status: 'ACTIVE',
      expiresAt: new Date('2025-01-01'),
      graceEndsAt: new Date('2025-01-02'),
    },
  });
  const current = await second.agent.get('/api/v1/tenants/current');
  assert.equal(current.status, 200);
  const d = current.body.data;
  const body = {
    legalName: d.legalName,
    displayName: d.displayName,
    timezone: d.timezone,
    locale: d.locale,
    accentColor: d.accentColor,
    monthlyStandardHours: String(d.monthlyStandardHours),
    allowSelfApproval: d.allowSelfApproval,
  };
  const change = await second.agent
    .patch('/api/v1/tenants/current')
    .set('x-csrf-token', second.csrf)
    .send(body);
  assert.equal(change.status, 403);
  assert.equal(change.body.error.code, 'SUBSCRIPTION_READ_ONLY');
  assert.equal((await second.agent.get('/api/v1/subscription')).body.data.status, 'EXPIRED');
});
test('logout revokes the server session', async () => {
  assert.equal(
    (await second.agent.post('/api/v1/auth/logout').set('x-csrf-token', second.csrf).send({}))
      .status,
    200,
  );
  assert.equal((await second.agent.get('/api/v1/me')).status, 401);
});
