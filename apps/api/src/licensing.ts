import { Router, type Request } from 'express';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { Temporal } from '@js-temporal/polyfill';
import argon2 from 'argon2';
import { Prisma, type Plan, type Subscription } from '@prisma/client';
import {
  featureCodes,
  productCode,
  commercialPolicyDefaults,
} from '../../../packages/types/src/features.js';
import {
  db,
  platform,
  tenant,
  check,
  hash,
  random,
  day,
  audit,
  sendMail,
  now,
  refreshTenantActor,
  type Tx,
  type Context,
  pagination,
} from './core.js';
import { subscriptionState } from '../../../packages/authorization/src/index.js';
import { newCompany } from './identity.js';
export const licensing = Router();
export async function commercialPolicy(tx: Tx = db) {
  const row = await tx.platformSetting.findUnique({ where: { key: 'COMMERCIAL_POLICY' } });
  return z
    .object({
      paymentSeparationOfDuties: z.boolean(),
      allowCommercialOverrides: z.boolean(),
      activationTtlDays: z.number().int().min(1).max(30),
    })
    .parse(row?.value || commercialPolicyDefaults);
}
export async function platformWrite<T>(
  req: Request,
  superOnly: boolean,
  fn: (tx: Tx) => Promise<T>,
) {
  platform(req, superOnly);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id=${req.ctx.userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.ctx.userId } }),
        session = await tx.session.findUnique({ where: { id: req.ctx.sessionId } });
      check(
        user.active &&
          user.verifiedAt &&
          user.mfaEnabled &&
          session?.mfaVerified &&
          session.expiresAt > now(),
        403,
        'PLATFORM_AUTH',
        'Current verified platform authentication is required',
      );
      check(
        superOnly
          ? user.platformRole === 'PLATFORM_SUPER_ADMIN'
          : ['PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER'].includes(
              user.platformRole || '',
            ),
        403,
        'PLATFORM_ONLY',
        'Your platform authority was removed',
      );
      req.ctx = {
        ...req.ctx,
        platformRole: user.platformRole,
        name: user.name,
        email: user.email,
        mfaEnabled: user.mfaEnabled,
        mfaVerified: session!.mfaVerified,
      };
      return fn(tx);
    },
    { timeout: 30000 },
  );
}
async function customer(tx: Tx, id: string) {
  const c = await tx.tenant.findUnique({ where: { id } });
  check(c, 404, 'NOT_FOUND', 'Customer company not found');
  return c;
}
async function lockCustomer(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${id} FOR UPDATE`;
  return customer(tx, id);
}
async function syncLicense(tx: Tx, s: Subscription, actorId?: string) {
  await tx.license.upsert({
    where: { tenantId: s.tenantId },
    create: {
      tenantId: s.tenantId,
      subscriptionId: s.id,
      status: s.status,
      employeeLimit: s.employeeLimit,
      userLimit: s.userLimit,
      ...(actorId ? { activatedBy: actorId, activatedAt: new Date() } : {}),
    },
    update: {
      subscriptionId: s.id,
      status: s.status,
      employeeLimit: s.employeeLimit,
      userLimit: s.userLimit,
      ...(actorId ? { activatedBy: actorId, activatedAt: new Date() } : {}),
    },
  });
}
async function subscriptionEvent(
  tx: Tx,
  ctx: Context,
  tenantId: string,
  kind: string,
  details: Prisma.InputJsonValue,
) {
  await tx.subscriptionEvent.create({ data: { tenantId, actorId: ctx.userId, kind, details } });
  await audit(
    tx,
    { ...ctx, tenantId },
    'platform.subscription.' + kind.toLowerCase(),
    tenantId,
    details,
  );
}
function termEnd(date: Date, timezone: string, addDays = 0) {
  const plain = Temporal.PlainDate.from(date.toISOString().slice(0, 10)).add({ days: addDays });
  return new Date(
    plain.toZonedDateTime({ timeZone: timezone, plainTime: '23:59:59.999' }).epochMilliseconds,
  );
}
function termStart(date: Date, timezone: string) {
  return new Date(
    Temporal.PlainDate.from(date.toISOString().slice(0, 10)).toZonedDateTime({
      timeZone: timezone,
      plainTime: '00:00',
    }).epochMilliseconds,
  );
}
const planInput = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
    productId: z.uuid(),
    name: z.string().trim().min(2).max(100),
    price: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/)
      .nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    durationDays: z.number().int().min(1).max(3660).nullable(),
    employeeLimit: z.number().int().min(1).max(100000),
    userLimit: z.number().int().min(1).max(10000),
    graceDays: z.number().int().min(0).max(365),
    features: z.array(z.enum(featureCodes)).max(30),
    active: z.boolean(),
  })
  .strict();
licensing.get('/platform/features', async (req, res) => {
  platform(req);
  res.json({ data: await db.feature.findMany({ orderBy: { code: 'asc' } }) });
});
licensing.get('/platform/products', async (req, res) => {
  platform(req);
  res.json({ data: await db.product.findMany({ orderBy: { name: 'asc' } }) });
});
licensing.post('/platform/products', async (req, res) => {
  const b = z
    .object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
      name: z.string().min(2).max(100),
      description: z.string().min(3).max(2000),
      active: z.boolean().default(true),
    })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    const p = await tx.product.create({ data: b });
    await audit(tx, req.ctx, 'platform.product_created', p.id, b);
    return p;
  });
  res.status(201).json({ data });
});
licensing.post('/platform/plans', async (req, res) => {
  const b = planInput.parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    check(
      await tx.product.findUnique({ where: { id: b.productId } }),
      422,
      'INVALID_PRODUCT',
      'Select a configured product',
    );
    if (b.code === 'FREE')
      check(
        (!b.price || new Decimal(b.price).isZero()) && b.durationDays === null,
        422,
        'FREE_PLAN',
        'Free registration cannot require payment or a fixed expiry',
      );
    const p = await tx.plan.create({
      data: {
        ...b,
        configuredFeatures: {
          create: [...new Set(b.features)].map((featureCode) => ({ featureCode })),
        },
      },
    });
    await audit(tx, req.ctx, 'platform.plan_created', p.id, b);
    return p;
  });
  res.status(201).json({ data });
});
licensing.patch('/platform/plans/:id', async (req, res) => {
  const b = planInput.parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    const before = await tx.plan.findUnique({ where: { id: String(req.params.id) } });
    check(before, 404, 'NOT_FOUND', 'Plan not found');
    check(
      before.code !== 'FREE' || b.code === 'FREE',
      422,
      'FREE_PLAN',
      'The central Free plan code must be retained',
    );
    check(
      await tx.product.findUnique({ where: { id: b.productId } }),
      422,
      'INVALID_PRODUCT',
      'Select a configured product',
    );
    if (b.code === 'FREE')
      check(
        (!b.price || new Decimal(b.price).isZero()) && b.durationDays === null,
        422,
        'FREE_PLAN',
        'Free cannot require payment or fixed expiry',
      );
    await tx.planFeature.deleteMany({ where: { planId: before.id } });
    const after = await tx.plan.update({
      where: { id: before.id },
      data: {
        ...b,
        version: { increment: 1 },
        configuredFeatures: {
          create: [...new Set(b.features)].map((featureCode) => ({ featureCode })),
        },
      },
    });
    await audit(tx, req.ctx, 'platform.plan_updated', before.id, {
      before: {
        name: before.name,
        price: before.price?.toString() || null,
        features: before.features,
        employeeLimit: before.employeeLimit,
        userLimit: before.userLimit,
      },
      after: b,
    });
    return after;
  });
  res.json({ data });
});
licensing.post('/platform/customers', async (req, res) => {
  const b = z
    .object({
      companyName: z.string().trim().min(2).max(191),
      ownerName: z.string().trim().min(2).max(191),
      ownerEmail: z.email().transform((s) => s.toLowerCase()),
    })
    .strict()
    .parse(req.body);
  const token = random(),
    passwordHash = await argon2.hash(random(), { type: argon2.argon2id });
  const data = await platformWrite(req, false, async (tx) => {
    const user = await tx.user.upsert({
      where: { email: b.ownerEmail },
      update: {},
      create: { email: b.ownerEmail, name: b.ownerName, passwordHash },
    });
    const company = await newCompany(tx, user.id, b.companyName, req.ctx.userId);
    await tx.tenant.update({ where: { id: company.id }, data: { contactEmail: b.ownerEmail } });
    if (!user.verifiedAt)
      await tx.authToken.create({
        data: {
          userId: user.id,
          tenantId: company.id,
          hash: hash(token),
          kind: 'INVITE',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    await audit(tx, { ...req.ctx, tenantId: company.id }, 'platform.customer_created', company.id, {
      ownerEmail: b.ownerEmail,
      ownerName: b.ownerName,
    });
    return { company, verified: Boolean(user.verifiedAt) };
  });
  await sendMail(
    b.ownerEmail,
    'YardHRMS company invitation',
    data.verified
      ? `Your company has been created. Sign in at ${process.env.HRMS_URL} using your existing account. MFA is required for Company Administrators.`
      : `Set your password and verify access: ${process.env.HRMS_URL}/reset-password?token=${token}`,
  );
  res.status(201).json({ data: data.company });
});
licensing.get('/platform/settings', async (req, res) => {
  platform(req, true);
  res.json({ data: await commercialPolicy() });
});
licensing.patch('/platform/settings', async (req, res) => {
  const b = z
    .object({
      paymentSeparationOfDuties: z.boolean(),
      allowCommercialOverrides: z.boolean(),
      activationTtlDays: z.number().int().min(1).max(30),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    const before = await commercialPolicy(tx),
      { reason, ...value } = b;
    const row = await tx.platformSetting.upsert({
      where: { key: 'COMMERCIAL_POLICY' },
      create: { key: 'COMMERCIAL_POLICY', value, updatedBy: req.ctx.userId },
      update: { value, updatedBy: req.ctx.userId },
    });
    await audit(tx, req.ctx, 'platform.policy_changed', null, { before, after: value, reason });
    return row.value;
  });
  res.json({ data });
});
licensing.get('/platform/users', async (req, res) => {
  platform(req, true);
  res.json({
    data: await db.user.findMany({
      where: { platformRole: { not: null } },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        active: true,
        mfaEnabled: true,
        verifiedAt: true,
      },
    }),
  });
});
licensing.post('/platform/users/invite', async (req, res) => {
  const b = z
    .object({
      name: z.string().min(2).max(191),
      email: z.email().transform((s) => s.toLowerCase()),
      role: z.enum(['PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER']),
    })
    .strict()
    .parse(req.body);
  const token = random(),
    passwordHash = await argon2.hash(random(), { type: argon2.argon2id });
  const data = await platformWrite(req, true, async (tx) => {
    const u = await tx.user.upsert({
      where: { email: b.email },
      update: { platformRole: b.role },
      create: { email: b.email, name: b.name, passwordHash, platformRole: b.role },
    });
    if (!u.verifiedAt)
      await tx.authToken.create({
        data: {
          userId: u.id,
          hash: hash(token),
          kind: 'PLATFORM_INVITE',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    await audit(tx, req.ctx, 'platform.staff_invited', u.id, { email: b.email, role: b.role });
    return { id: u.id, verified: Boolean(u.verifiedAt) };
  });
  await sendMail(
    b.email,
    'Qwik Licence Manager invitation',
    data.verified
      ? `Qwik staff access has been granted. Sign in at ${process.env.QWIK_URL} with your existing password. MFA is mandatory.`
      : `Set your staff password: ${process.env.QWIK_URL}/reset-password?token=${token}\nMFA is mandatory.`,
  );
  res.status(201).json({ data: { id: data.id, message: 'Staff invitation sent' } });
});
licensing.patch('/platform/users/:id', async (req, res) => {
  const b = z
    .object({
      active: z.boolean(),
      role: z.enum(['PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER']),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    check(
      String(req.params.id) !== req.ctx.userId,
      422,
      'SELF_ACCESS',
      'You cannot deactivate or change your own platform authority',
    );
    const user = await tx.user.findUnique({ where: { id: String(req.params.id) } });
    check(user?.platformRole, 404, 'NOT_FOUND', 'Platform account not found');
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.user.update({
      where: { id: user.id },
      data: { active: b.active, platformRole: b.role },
    });
    await audit(tx, req.ctx, 'platform.staff_updated', user.id, b);
    return { message: 'Staff access updated and sessions revoked' };
  });
  res.json({ data });
});
const paymentInput = z
  .object({
    tenantId: z.uuid(),
    amount: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/)
      .refine((s) => new Decimal(s).gt(0), 'Amount must be positive'),
    currency: z.string().regex(/^[A-Z]{3}$/),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
    reference: z.string().trim().min(3).max(191),
    invoiceNumber: z.string().trim().min(2).max(100),
    paymentDate: z.iso.date(),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    evidenceFileId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((b) => b.periodEnd >= b.periodStart, {
    message: 'Covered period end must follow its start',
    path: ['periodEnd'],
  });
licensing.post('/platform/payments', async (req, res) => {
  const b = paymentInput.parse(req.body);
  const data = await platformWrite(req, false, async (tx) => {
    await customer(tx, b.tenantId);
    if (b.evidenceFileId) {
      const file = await tx.privateFile.findFirst({
        where: {
          id: b.evidenceFileId,
          tenantId: b.tenantId,
          employeeId: null,
          kind: 'PAYMENT_EVIDENCE',
        },
      });
      check(
        file?.scanStatus === 'CLEAN',
        422,
        'PAYMENT_EVIDENCE',
        'Choose clean, authorized customer evidence',
      );
    }
    const company = await customer(tx, b.tenantId);
    const received = Temporal.Now.plainDateISO(company.timezone).toString();
    check(
      b.paymentDate <= received,
      422,
      'FUTURE_PAYMENT',
      'Received payment date cannot be in the future',
    );
    const payment = await tx.manualPayment.create({
      data: {
        ...b,
        paymentDate: day(b.paymentDate),
        periodStart: day(b.periodStart),
        periodEnd: day(b.periodEnd),
        recordedBy: req.ctx.userId,
        events: {
          create: { actorId: req.ctx.userId, status: 'PENDING', reason: 'Manual payment recorded' },
        },
      },
    });
    await audit(tx, { ...req.ctx, tenantId: b.tenantId }, 'platform.payment_recorded', payment.id, {
      amount: b.amount,
      currency: b.currency,
      reference: b.reference,
    });
    return payment;
  });
  res.status(201).json({ data });
});
licensing.get('/platform/payments', async (req, res) => {
  platform(req);
  const where: Prisma.ManualPaymentWhereInput = {
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.tenantId ? { tenantId: String(req.query.tenantId) } : {}),
    ...(req.query.unused === 'true' ? { usedAt: null } : {}),
  };
  res.json({
    data: {
      items: await db.manualPayment.findMany({
        where,
        include: {
          tenant: { select: { displayName: true } },
          events: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        ...pagination(req),
      }),
      total: await db.manualPayment.count({ where }),
    },
  });
});
licensing.post('/platform/payments/:id/decision', async (req, res) => {
  const b = z
    .object({
      status: z.enum(['VERIFIED', 'REJECTED', 'REVERSED']),
      reason: z.string().trim().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, b.status === 'REVERSED', async (tx) => {
    const payment = await tx.manualPayment.findUnique({ where: { id: String(req.params.id) } });
    check(payment, 404, 'NOT_FOUND', 'Payment not found');
    await lockCustomer(tx, payment.tenantId);
    const current = await tx.manualPayment.findUniqueOrThrow({ where: { id: payment.id } });
    const policy = await commercialPolicy(tx);
    if (b.status === 'VERIFIED') {
      check(
        current.status === 'PENDING',
        409,
        'PAYMENT_STATE',
        'Only pending payments can be verified',
      );
      check(
        !policy.paymentSeparationOfDuties || current.recordedBy !== req.ctx.userId,
        403,
        'PAYMENT_SELF_VERIFICATION',
        'A different authorized staff member must verify this payment',
      );
    } else if (b.status === 'REJECTED')
      check(
        current.status === 'PENDING',
        409,
        'PAYMENT_STATE',
        'Only pending payments may be rejected',
      );
    else
      check(
        current.status === 'VERIFIED',
        409,
        'PAYMENT_STATE',
        'Only verified payments may be reversed',
      );
    const after = await tx.manualPayment.update({
      where: { id: current.id },
      data: {
        status: b.status,
        reason: b.reason,
        ...(b.status === 'VERIFIED' ? { verifiedBy: req.ctx.userId, verifiedAt: new Date() } : {}),
        events: { create: { actorId: req.ctx.userId, status: b.status, reason: b.reason } },
      },
    });
    if (b.status === 'REVERSED' && current.usedAt) {
      const sub = await tx.subscription.findUniqueOrThrow({
        where: { tenantId: current.tenantId },
      });
      const suspended = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'SUSPENDED' },
      });
      await syncLicense(tx, suspended);
      await tx.activationCode.updateMany({
        where: { tenantId: current.tenantId, redeemedAt: null },
        data: { expiresAt: new Date(0) },
      });
      await subscriptionEvent(tx, req.ctx, current.tenantId, 'PAYMENT_REVERSED', {
        paymentId: current.id,
        reason: b.reason,
        status: 'SUSPENDED',
      });
    }
    await audit(
      tx,
      { ...req.ctx, tenantId: current.tenantId },
      'platform.payment_' + b.status.toLowerCase(),
      current.id,
      {
        reason: b.reason,
        recordedBy: current.recordedBy,
        verifiedBy: b.status === 'VERIFIED' ? req.ctx.userId : current.verifiedBy,
      },
    );
    return after;
  });
  res.json({ data });
});
async function validPaidPlan(tx: Tx, id: string) {
  const plan = await tx.plan.findUnique({ where: { id }, include: { product: true } });
  check(
    plan?.active &&
      plan.code !== 'FREE' &&
      plan.product?.code === productCode &&
      plan.product.active,
    422,
    'PAID_PLAN',
    'Select an active YardHRMS paid plan',
  );
  check(
    plan.price !== null && plan.durationDays !== null && plan.price.gt(0),
    409,
    'COMMERCIAL_CONFIGURATION',
    'Configure approved price and duration before issuing a paid entitlement',
  );
  return plan;
}
async function consumePayment(
  tx: Tx,
  ctx: Context,
  tenantId: string,
  plan: Plan,
  paymentId: string | undefined,
  overrideReason: string | undefined,
  subscriptionId: string,
  kind: string,
) {
  if (!paymentId) {
    const policy = await commercialPolicy(tx);
    check(
      ctx.platformRole === 'PLATFORM_SUPER_ADMIN' &&
        policy.allowCommercialOverrides &&
        overrideReason &&
        overrideReason.length >= 10,
      403,
      'VERIFIED_PAYMENT_REQUIRED',
      'A verified payment or explicitly enabled Super Admin override is required',
    );
    return null;
  }
  const payment = await tx.manualPayment.findUnique({ where: { id: paymentId } });
  check(payment && payment.tenantId === tenantId, 404, 'NOT_FOUND', 'Customer payment not found');
  check(
    payment.status === 'VERIFIED' && !payment.usedAt,
    409,
    'VERIFIED_PAYMENT_REQUIRED',
    'Payment must be verified and unused',
  );
  check(
    payment.currency === plan.currency && payment.amount.gte(plan.price!),
    409,
    'PAYMENT_AMOUNT',
    'Payment currency and amount must cover the configured plan price',
  );
  const covered = (payment.periodEnd.getTime() - payment.periodStart.getTime()) / 86400000 + 1;
  check(
    covered === plan.durationDays,
    422,
    'COVERED_TERM',
    'Payment covered period must match the configured plan duration',
  );
  const used = await tx.manualPayment.updateMany({
    where: { id: payment.id, status: 'VERIFIED', usedAt: null },
    data: { usedAt: new Date(), subscriptionId, applicationKind: kind },
  });
  check(used.count === 1, 409, 'PAYMENT_USED', 'This payment has already been applied');
  return payment;
}
licensing.post('/platform/codes', async (req, res) => {
  const b = z
    .object({
      tenantId: z.uuid(),
      planId: z.uuid(),
      paymentId: z.uuid().optional(),
      overrideReason: z.string().min(10).max(2000).optional(),
      overridePeriodStart: z.iso.date().optional(),
      overridePeriodEnd: z.iso.date().optional(),
    })
    .strict()
    .parse(req.body);
  const code = 'QWIK-' + random();
  const data = await platformWrite(req, false, async (tx) => {
    const company = await lockCustomer(tx, b.tenantId),
      plan = await validPaidPlan(tx, b.planId),
      sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId: b.tenantId } });
    check(
      !['SUSPENDED', 'REVOKED'].includes(sub.status),
      409,
      'LICENCE_BLOCKED',
      'Resolve suspension/revocation before issuing a code',
    );
    const payment = await consumePayment(
      tx,
      req.ctx,
      b.tenantId,
      plan,
      b.paymentId,
      b.overrideReason,
      sub.id,
      'ACTIVATION',
    );
    const start =
        payment?.periodStart || (b.overridePeriodStart ? day(b.overridePeriodStart) : null),
      end = payment?.periodEnd || (b.overridePeriodEnd ? day(b.overridePeriodEnd) : null);
    check(
      start && end && end >= start,
      422,
      'TERM_REQUIRED',
      'An explicitly covered subscription period is required',
    );
    const expiresAt = termEnd(end, company.timezone),
      startsAt = termStart(start, company.timezone);
    check(expiresAt > now(), 422, 'TERM_EXPIRED', 'Covered term already expired');
    const policy = await commercialPolicy(tx),
      codeExpiresAt = new Date(
        Math.min(
          expiresAt.getTime(),
          Math.max(Date.now(), startsAt.getTime()) + policy.activationTtlDays * 86400000,
        ),
      );
    const record = await tx.activationCode.create({
      data: {
        hash: hash(code),
        tenantId: b.tenantId,
        subscriptionId: sub.id,
        issuedBy: req.ctx.userId,
        expiresAt: codeExpiresAt,
        payload: {
          productCode,
          planId: plan.id,
          planVersion: plan.version,
          startsAt: startsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          graceEndsAt: termEnd(end, company.timezone, plan.graceDays).toISOString(),
          employeeLimit: plan.employeeLimit,
          userLimit: plan.userLimit,
          features: plan.features!,
          paymentId: payment?.id || null,
          overrideReason: b.overrideReason || null,
        },
      },
    });
    await subscriptionEvent(tx, req.ctx, b.tenantId, 'CODE_ISSUED', {
      codeId: record.id,
      planId: plan.id,
      paymentId: payment?.id || null,
      overrideReason: b.overrideReason || null,
    });
    return { id: record.id, tenantId: b.tenantId, expiresAt: record.expiresAt };
  });
  res.status(201).json({ data: { ...data, code } });
});
licensing.get('/platform/codes', async (req, res) => {
  platform(req);
  res.json({
    data: await db.activationCode.findMany({
      where: req.query.tenantId ? { tenantId: String(req.query.tenantId) } : {},
      select: {
        id: true,
        tenantId: true,
        subscriptionId: true,
        expiresAt: true,
        redeemedAt: true,
        issuedBy: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      ...pagination(req),
    }),
  });
});
const codePayload = z
  .object({
    productCode: z.literal(productCode),
    planId: z.uuid(),
    planVersion: z.number(),
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    graceEndsAt: z.iso.datetime(),
    employeeLimit: z.number().int(),
    userLimit: z.number().int(),
    features: z.array(z.enum(featureCodes)),
    paymentId: z.uuid().nullable(),
    overrideReason: z.string().nullable(),
  })
  .strict();
licensing.post('/subscription/redeem-code', async (req, res) => {
  const b = z
    .object({ code: z.string().trim().min(20).max(200) })
    .strict()
    .parse(req.body);
  const tid = tenant(req, 'subscription.write');
  const data = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tid} FOR UPDATE`;
    const ctx = await refreshTenantActor(tx, req, tid);
    check(
      ctx.permissions.has('subscription.write'),
      403,
      'PERMISSION_DENIED',
      'Subscription authority was removed',
    );
    const row = await tx.activationCode.findUnique({ where: { hash: hash(b.code) } });
    check(
      row && row.tenantId === tid && row.expiresAt > now() && !row.redeemedAt,
      409,
      'INVALID_ACTIVATION_CODE',
      'Code is invalid, expired, already used or bound to another company',
    );
    const payload = codePayload.parse(row.payload),
      current = await tx.subscription.findUniqueOrThrow({ where: { tenantId: tid } });
    check(
      !['SUSPENDED', 'REVOKED'].includes(current.status),
      403,
      'LICENCE_BLOCKED',
      'Qwik must resolve suspension or revocation',
    );
    check(
      !current.expiresAt || new Date(payload.expiresAt) >= current.expiresAt,
      409,
      'TERM_SHORTENING',
      'An activation code cannot shorten an existing paid term',
    );
    check(
      new Date(payload.startsAt) <= now() && new Date(payload.expiresAt) > now(),
      409,
      'ACTIVATION_TERM',
      'This paid term has not begun or has already expired',
    );
    if (payload.paymentId)
      check(
        (await tx.manualPayment.findUnique({ where: { id: payload.paymentId } }))?.status ===
          'VERIFIED',
        409,
        'PAYMENT_REVERSED',
        'The authorizing payment is no longer verified',
      );
    const used = await tx.activationCode.updateMany({
      where: { id: row.id, redeemedAt: null, expiresAt: { gt: now() } },
      data: { redeemedAt: new Date() },
    });
    check(used.count === 1, 409, 'ACTIVATION_USED', 'Code was already redeemed');
    const sub = await tx.subscription.update({
      where: { id: current.id },
      data: {
        planId: payload.planId,
        status: 'ACTIVE',
        startsAt: new Date(payload.startsAt),
        expiresAt: new Date(payload.expiresAt),
        graceEndsAt: new Date(payload.graceEndsAt),
        employeeLimit: payload.employeeLimit,
        userLimit: payload.userLimit,
        features: payload.features,
      },
    });
    await syncLicense(tx, sub, req.ctx.userId);
    await tx.subscriptionEvent.create({
      data: {
        tenantId: tid,
        actorId: req.ctx.userId,
        kind: 'CODE_REDEEMED',
        details: { codeId: row.id, planId: payload.planId },
      },
    });
    await audit(tx, req.ctx, 'subscription.code_redeemed', sub.id, {
      codeId: row.id,
      planId: payload.planId,
    });
    return { message: 'Paid subscription activated', status: 'ACTIVE' };
  });
  res.json({ data });
});
licensing.post('/platform/subscriptions/:id/renew', async (req, res) => {
  const b = z.object({ paymentId: z.uuid() }).strict().parse(req.body);
  const data = await platformWrite(req, false, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: String(req.params.id) } });
    check(sub, 404, 'NOT_FOUND', 'Subscription not found');
    const company = await lockCustomer(tx, sub.tenantId),
      current = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    check(
      current.status !== 'FREE' && !['SUSPENDED', 'REVOKED'].includes(current.status),
      409,
      'RENEWAL_STATE',
      'Only an issued paid entitlement can be renewed without activation',
    );
    const plan = await validPaidPlan(tx, current.planId),
      payment = await consumePayment(
        tx,
        req.ctx,
        current.tenantId,
        plan,
        b.paymentId,
        undefined,
        current.id,
        'RENEWAL',
      );
    check(payment, 409, 'PAYMENT_REQUIRED', 'A verified renewal payment is required');
    const from = termStart(payment.periodStart, company.timezone),
      end = termEnd(payment.periodEnd, company.timezone);
    check(
      !current.expiresAt || current.expiresAt >= now()
        ? !current.expiresAt || from.getTime() === current.expiresAt.getTime() + 1
        : from > current.expiresAt && from <= now(),
      422,
      'RENEWAL_PERIOD',
      'Active renewals must be contiguous; expired renewals may resume a non-overlapping current term',
    );
    check(
      (!current.expiresAt || end > current.expiresAt) && end > now(),
      422,
      'RENEWAL_EXTENSION',
      'Renewal must extend to a valid future expiry',
    );
    const after = await tx.subscription.update({
      where: { id: current.id },
      data: {
        status: 'ACTIVE',
        expiresAt: end,
        graceEndsAt: termEnd(payment.periodEnd, company.timezone, plan.graceDays),
      },
    });
    await syncLicense(tx, after);
    await subscriptionEvent(tx, req.ctx, current.tenantId, 'RENEWED', {
      paymentId: payment.id,
      periodStart: payment.periodStart.toISOString(),
      periodEnd: payment.periodEnd.toISOString(),
      previousExpiry: current.expiresAt?.toISOString() || null,
      expiresAt: end.toISOString(),
      noActivationRequired: true,
    });
    return after;
  });
  res.json({ data });
});
licensing.get('/platform/subscriptions', async (req, res) => {
  platform(req);
  const items = await db.subscription.findMany({
    include: {
      tenant: { select: { id: true, displayName: true, timezone: true } },
      plan: { select: { id: true, name: true, code: true } },
      license: true,
    },
    orderBy: { updatedAt: 'desc' },
    ...pagination(req),
  });
  res.json({ data: items.map((s) => ({ ...s, status: subscriptionState(s) })) });
});
licensing.get('/platform/licences', async (req, res) => {
  platform(req);
  const items = await db.license.findMany({
    include: {
      tenant: { select: { displayName: true } },
      subscription: { include: { plan: { select: { name: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    ...pagination(req),
  });
  res.json({ data: items.map((l) => ({ ...l, status: subscriptionState(l.subscription) })) });
});
licensing.post('/platform/subscriptions/:id/status', async (req, res) => {
  const b = z
    .object({
      status: z.enum(['SUSPENDED', 'REVOKED', 'ACTIVE']),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id: String(req.params.id) },
      include: { plan: true },
    });
    check(sub, 404, 'NOT_FOUND', 'Subscription not found');
    await lockCustomer(tx, sub.tenantId);
    if (b.status === 'ACTIVE' && sub.plan.code !== 'FREE')
      check(
        sub.expiresAt && sub.expiresAt > now(),
        409,
        'RENEWAL_REQUIRED',
        'A valid paid term is required before restoring active status',
      );
    const after = await tx.subscription.update({
      where: { id: sub.id },
      data: { status: b.status === 'ACTIVE' && sub.plan.code === 'FREE' ? 'FREE' : b.status },
    });
    await syncLicense(tx, after);
    if (b.status === 'REVOKED')
      await tx.activationCode.updateMany({
        where: { tenantId: sub.tenantId, redeemedAt: null },
        data: { expiresAt: new Date(0) },
      });
    await subscriptionEvent(tx, req.ctx, sub.tenantId, b.status, { reason: b.reason });
    return after;
  });
  res.json({ data });
});
licensing.post('/platform/subscriptions/:id/capacity', async (req, res) => {
  const b = z
    .object({
      employeeLimit: z.number().int().min(1).max(100000),
      userLimit: z.number().int().min(1).max(10000),
      reason: z.string().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: String(req.params.id) } });
    check(sub, 404, 'NOT_FOUND', 'Subscription not found');
    await lockCustomer(tx, sub.tenantId);
    const after = await tx.subscription.update({
      where: { id: sub.id },
      data: { employeeLimit: b.employeeLimit, userLimit: b.userLimit },
    });
    await syncLicense(tx, after);
    await subscriptionEvent(tx, req.ctx, sub.tenantId, 'CAPACITY_CHANGED', {
      before: { employeeLimit: sub.employeeLimit, userLimit: sub.userLimit },
      after: b,
    });
    return after;
  });
  res.json({ data });
});
licensing.post('/platform/subscriptions/:id/plan', async (req, res) => {
  const b = z
    .object({ planId: z.uuid(), reason: z.string().min(10).max(2000) })
    .strict()
    .parse(req.body);
  const data = await platformWrite(req, true, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: String(req.params.id) } });
    check(sub, 404, 'NOT_FOUND', 'Subscription not found');
    await lockCustomer(tx, sub.tenantId);
    const plan = await tx.plan.findUnique({ where: { id: b.planId }, include: { product: true } });
    check(
      plan?.active && plan.product?.code === productCode,
      422,
      'PLAN_INVALID',
      'Choose an active YardHRMS plan',
    );
    check(
      plan.code === 'FREE' || sub.status !== 'FREE',
      409,
      'PAID_ACTIVATION_REQUIRED',
      'Free-to-paid conversion requires a verified paid activation code',
    );
    if (plan.code !== 'FREE') {
      await validPaidPlan(tx, plan.id);
      const downgrade =
        plan.employeeLimit <= sub.employeeLimit &&
        plan.userLimit <= sub.userLimit &&
        (plan.features as string[]).every((feature) =>
          (sub.features as string[]).includes(feature),
        );
      check(
        downgrade || (await commercialPolicy(tx)).allowCommercialOverrides,
        403,
        'COMMERCIAL_OVERRIDE_REQUIRED',
        'Use a verified activation code or explicitly enabled Super Admin override for a paid upgrade',
      );
    }
    const after = await tx.subscription.update({
      where: { id: sub.id },
      data: {
        planId: plan.id,
        employeeLimit: plan.employeeLimit,
        userLimit: plan.userLimit,
        features: plan.features!,
        ...(plan.code === 'FREE' ? { status: 'FREE', expiresAt: null, graceEndsAt: null } : {}),
      },
    });
    await syncLicense(tx, after);
    await subscriptionEvent(tx, req.ctx, sub.tenantId, 'PLAN_CHANGED', {
      before: sub.planId,
      after: plan.id,
      reason: b.reason,
    });
    return after;
  });
  res.json({ data });
});
licensing.get('/platform/renewals', async (req, res) => {
  platform(req);
  const limit = new Date(Date.now() + 30 * 86400000);
  const rows = await db.subscription.findMany({
    where: { expiresAt: { lte: limit }, status: { notIn: ['FREE', 'REVOKED'] } },
    include: {
      tenant: { select: { displayName: true, contactEmail: true } },
      plan: { select: { name: true } },
    },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });
  res.json({ data: rows.map((row) => ({ ...row, status: subscriptionState(row) })) });
});
licensing.get('/platform/usage', async (req, res) => {
  platform(req);
  const rows = await db.tenant.findMany({
    select: {
      id: true,
      displayName: true,
      subscription: {
        select: {
          employeeLimit: true,
          userLimit: true,
          status: true,
          expiresAt: true,
          graceEndsAt: true,
        },
      },
      _count: {
        select: {
          employees: { where: { active: true } },
          memberships: { where: { active: true, user: { active: true } } },
        },
      },
    },
    ...pagination(req),
  });
  res.json({
    data: rows.map((row) => ({
      ...row,
      subscription: row.subscription
        ? { ...row.subscription, status: subscriptionState(row.subscription) }
        : null,
    })),
  });
});
