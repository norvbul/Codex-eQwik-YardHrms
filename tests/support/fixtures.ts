import request from 'supertest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { app } from '../../apps/api/src/app.js';
import { db, hash, random, encrypt, type Tx } from '../../apps/api/src/core.js';
import { createTenantRoles } from '../../prisma/seed/index.js';
import { initializeMasterData } from '../../apps/api/src/master-data.js';
export const testPrefix = 'fixture-' + randomUUID().slice(0, 8);
export type Actor = {
  userId: string;
  tenantId: string;
  csrf: string;
  agent: ReturnType<typeof request.agent>;
  employeeId: string | null;
  token: string;
};
export async function actor(
  tenantId: string,
  userId: string,
  employeeId: string | null = null,
): Promise<Actor> {
  const token = random(),
    csrf = random();
  await db.session.create({
    data: {
      userId,
      tenantId: tenantId || null,
      tokenHash: hash(token),
      csrfHash: hash(csrf),
      mfaVerified: true,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const agent = request.agent(app);
  agent.set('Cookie', `yard_session=${token}; yard_csrf=${csrf}`);
  return { userId, tenantId, csrf, agent, employeeId, token };
}
export async function company(name: string) {
  const passwordHash = await argon2.hash(random(), { type: argon2.argon2id });
  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `${testPrefix}-${name}@example.test`,
        name: 'Test Administrator',
        passwordHash,
        verifiedAt: new Date(),
        mfaEnabled: true,
        mfaSecret: encrypt('JBSWY3DPEHPK3PXP'),
      },
    });
    const tenant = await tx.tenant.create({
      data: {
        legalName: 'Test ' + name,
        displayName: 'Test ' + name,
        slug: testPrefix + '-' + name,
      },
    });
    const membership = await tx.membership.create({
      data: { userId: user.id, tenantId: tenant.id },
    });
    await createTenantRoles(tx, tenant.id, membership.id);
    await initializeMasterData(tx, tenant.id);
    for (const [leaveName, paidFraction] of [
      ['Vacation', '1'],
      ['Unpaid', '0'],
    ])
      await tx.leaveType.create({ data: { tenantId: tenant.id, name: leaveName, paidFraction } });
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'FREE',
        employeeLimit: plan.employeeLimit,
        userLimit: plan.userLimit,
        features: plan.features!,
      },
    });
    return { tenant, user };
  });
  return actor(result.tenant.id, result.user.id);
}
export async function member(admin: Actor, roleName: string, employeeId: string | null = null) {
  const passwordHash = await argon2.hash(random(), { type: argon2.argon2id });
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: `${testPrefix}-${random().slice(0, 10)}@example.test`,
        name: 'Test ' + roleName,
        passwordHash,
        verifiedAt: new Date(),
        mfaEnabled: true,
        mfaSecret: encrypt('JBSWY3DPEHPK3PXP'),
      },
    });
    const role = await tx.role.findUniqueOrThrow({
      where: { tenantId_name: { tenantId: admin.tenantId, name: roleName } },
    });
    const m = await tx.membership.create({
      data: { tenantId: admin.tenantId, userId: u.id, employeeId },
    });
    await tx.membershipRole.create({
      data: { tenantId: admin.tenantId, membershipId: m.id, roleId: role.id },
    });
    return u;
  });
  return actor(admin.tenantId, user.id, employeeId);
}
export async function cleanTenant(tx: Tx, tenantId: string) {
  if (process.env.YARD_ISOLATED_TESTS === 'true') return;
  const members = await tx.membership.findMany({ where: { tenantId } }),
    users = members.map((m) => m.userId),
    roles = await tx.role.findMany({ where: { tenantId } }),
    batches = await tx.importBatch.findMany({ where: { tenantId } }),
    payments = await tx.manualPayment.findMany({ where: { tenantId } }),
    subscription = await tx.subscription.findUnique({ where: { tenantId } });
  if (subscription)
    await tx.activationCode.deleteMany({ where: { subscriptionId: subscription.id } });
  await tx.paymentEvent.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
  await tx.manualPayment.deleteMany({ where: { tenantId } });
  await tx.subscriptionEvent.deleteMany({ where: { tenantId } });
  await tx.importRow.deleteMany({ where: { batchId: { in: batches.map((b) => b.id) } } });
  await tx.importBatch.deleteMany({ where: { tenantId } });
  await tx.privateFile.deleteMany({ where: { tenantId } });
  await tx.payrollSnapshot.deleteMany({ where: { tenantId } });
  await tx.payrollRun.deleteMany({ where: { tenantId } });
  await tx.statutoryRule.deleteMany({ where: { tenantId } });
  await tx.leaveLedger.deleteMany({ where: { tenantId, parentId: { not: null } } });
  await tx.leaveLedger.deleteMany({ where: { tenantId } });
  await tx.leaveRequest.deleteMany({ where: { tenantId } });
  await tx.timesheet.deleteMany({ where: { tenantId } });
  await tx.overtime.deleteMany({ where: { tenantId } });
  await tx.payrollAdjustment.deleteMany({ where: { tenantId } });
  await tx.compensationHistory.deleteMany({ where: { tenantId } });
  await tx.employeeBankAccount.deleteMany({ where: { tenantId } });
  await tx.emergencyContact.deleteMany({ where: { tenantId } });
  await tx.auditEvent.deleteMany({ where: { OR: [{ tenantId }, { actorId: { in: users } }] } });
  await tx.session.deleteMany({ where: { userId: { in: users } } });
  await tx.authToken.deleteMany({ where: { userId: { in: users } } });
  await tx.membershipRole.deleteMany({ where: { tenantId } });
  await tx.membership.deleteMany({ where: { tenantId } });
  await tx.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
  await tx.role.deleteMany({ where: { tenantId } });
  await tx.employee.updateMany({ where: { tenantId }, data: { managerId: null } });
  await tx.employee.deleteMany({ where: { tenantId } });
  await tx.department.deleteMany({ where: { tenantId } });
  await tx.holiday.deleteMany({ where: { tenantId } });
  await tx.referenceData.deleteMany({ where: { tenantId } });
  await tx.leaveType.deleteMany({ where: { tenantId } });
  await tx.subscription.deleteMany({ where: { tenantId } });
  await tx.legacyMap.deleteMany({ where: { tenantId } });
  await tx.tenant.delete({ where: { id: tenantId } });
  await tx.user.deleteMany({ where: { id: { in: users } } });
}
