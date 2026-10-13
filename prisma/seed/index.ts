import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { createDatabase } from '../../packages/configuration/db.js';
import {
  featureCodes,
  productCode,
  commercialPolicyDefaults,
} from '../../packages/types/src/features.js';
import { allPermissions, rolePermissions } from '../../packages/authorization/src/index.js';
const db = createDatabase();
export async function createTenantRoles(
  tx: Prisma.TransactionClient,
  tenantId: string,
  membershipId: string,
) {
  for (const [name, permissions] of Object.entries(rolePermissions)) {
    const role = await tx.role.create({
      data: {
        tenantId,
        name,
        approvalScope: name === 'MANAGER' ? 'TEAM' : 'TENANT',
        permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
      },
    });
    if (name === 'COMPANY_ADMIN')
      await tx.membershipRole.create({ data: { tenantId, membershipId, roleId: role.id } });
  }
}
export async function seed() {
  const product = await db.product.upsert({
    where: { code: productCode },
    update: {},
    create: {
      code: productCode,
      name: 'eQwik YardHRMS',
      description: 'Jamaican HR and payroll SaaS with centrally managed subscriptions',
    },
  });
  for (const code of featureCodes)
    await db.feature.upsert({
      where: { code },
      update: {},
      create: { code, name: code.charAt(0).toUpperCase() + code.slice(1) },
    });
  await db.platformSetting.upsert({
    where: { key: 'COMMERCIAL_POLICY' },
    update: {},
    create: { key: 'COMMERCIAL_POLICY', value: commercialPolicyDefaults },
  });
  for (const code of allPermissions)
    await db.permission.upsert({ where: { code }, update: {}, create: { code } });
  for (const [code, name, employeeLimit, userLimit] of [
    ['FREE', 'Free', 5, 2],
    ['STARTER', 'Starter', 25, 5],
    ['PROFESSIONAL', 'Professional', 100, 15],
    ['BUSINESS', 'Business', 250, 30],
  ] as const) {
    let plan = await db.plan.upsert({
      where: { code },
      update: {},
      create: {
        code,
        productId: product.id,
        name,
        employeeLimit,
        userLimit,
        features:
          code === 'FREE'
            ? ['employees', 'leave', 'timesheets', 'reports']
            : [
                'employees',
                'leave',
                'timesheets',
                'overtime',
                'payroll',
                'payslips',
                'imports',
                'reports',
                'audit',
              ],
        price: code === 'FREE' ? '0' : null,
      },
    });
    if (!plan.productId)
      plan = await db.plan.update({ where: { id: plan.id }, data: { productId: product.id } });
    for (const featureCode of (plan.features as string[]).filter((f) =>
      featureCodes.includes(f as (typeof featureCodes)[number]),
    ))
      await db.planFeature.upsert({
        where: { planId_featureCode: { planId: plan.id, featureCode } },
        update: {},
        create: { planId: plan.id, featureCode },
      });
  }
  for (const subscription of await db.subscription.findMany())
    await db.license.upsert({
      where: { tenantId: subscription.tenantId },
      update: {},
      create: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        status: subscription.status,
        employeeLimit: subscription.employeeLimit,
        userLimit: subscription.userLimit,
      },
    });
}
if (process.argv[1]?.endsWith('prisma/seed/index.ts'))
  seed()
    .then(() => console.log('Seeded permissions and configurable plans; paid prices remain unset.'))
    .finally(() => db.$disconnect());
