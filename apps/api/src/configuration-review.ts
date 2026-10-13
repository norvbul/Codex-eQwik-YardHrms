import { isDeepStrictEqual } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, ConfigurationChange } from '@prisma/client';
import {
  db,
  tenant,
  entitlement,
  writeTenant,
  check,
  day,
  companyToday,
  audit,
  publicContext,
  pagination,
  type Tx,
  type Context,
} from './core.js';
export const configurationReview = Router();
export async function proposeConfiguration(
  tx: Tx,
  ctx: Context,
  kind: string,
  targetKey: string,
  proposal: Prisma.InputJsonObject,
  previous: Prisma.InputJsonValue,
  reason?: string,
  effectiveDate?: string,
) {
  const tid = ctx.tenantId!,
    today = await companyToday(tx, tid),
    date = effectiveDate ? day(effectiveDate) : today;
  check(
    date >= today,
    422,
    'PROSPECTIVE_CONFIGURATION',
    'Configuration must take effect today or later',
  );
  check(
    !(await tx.configurationChange.findFirst({
      where: {
        tenantId: tid,
        kind,
        targetKey,
        OR: [{ status: 'PENDING' }, { status: 'APPROVED', appliedAt: null }],
      },
    })),
    409,
    'PENDING_CONFIGURATION',
    'Review or apply the existing proposal for this setting first',
  );
  const change = await tx.configurationChange.create({
    data: {
      tenantId: tid,
      kind,
      targetKey,
      proposal,
      previous,
      proposedBy: ctx.userId,
      reason: reason || 'Company configuration proposal',
      effectiveDate: date,
    },
  });
  await audit(tx, ctx, 'configuration.proposed', change.id, {
    kind,
    targetKey,
    proposal,
    previous,
    effectiveDate: date.toISOString(),
    reason: change.reason,
  });
  return change;
}
async function currentValue(tx: Tx, change: ConfigurationChange) {
  if (change.kind === 'LEAVE_POLICY') {
    const t = await tx.leaveType.findUnique({
      where: { tenantId_name: { tenantId: change.tenantId, name: change.targetKey } },
    });
    return t
      ? {
          name: t.name,
          paidFraction: t.paidFraction.toString(),
          annualDays: t.annualDays.toString(),
          carryForwardDays: t.carryForwardDays.toString(),
        }
      : {};
  }
  const b = change.proposal as { category: string };
  const r = await tx.referenceData.findUnique({
    where: {
      tenantId_category_name: {
        tenantId: change.tenantId,
        category: b.category,
        name: change.targetKey,
      },
    },
  });
  return r
    ? { category: r.category, name: r.name, configuration: r.configuration || {}, active: r.active }
    : {};
}
async function apply(tx: Tx, change: ConfigurationChange) {
  const b = change.proposal as Prisma.InputJsonObject;
  if (change.kind === 'LEAVE_POLICY') {
    const policy = z
      .object({
        name: z.string(),
        paidFraction: z.string(),
        annualDays: z.string(),
        carryForwardDays: z.string(),
      })
      .parse(b);
    await tx.leaveType.upsert({
      where: { tenantId_name: { tenantId: change.tenantId, name: change.targetKey } },
      create: { tenantId: change.tenantId, ...policy },
      update: policy,
    });
  } else {
    const reference = z
      .object({
        category: z.string(),
        name: z.string(),
        configuration: z.record(z.string(), z.unknown()),
        active: z.boolean(),
      })
      .parse(b);
    await tx.referenceData.upsert({
      where: {
        tenantId_category_name: {
          tenantId: change.tenantId,
          category: reference.category,
          name: change.targetKey,
        },
      },
      create: {
        tenantId: change.tenantId,
        ...reference,
        configuration: reference.configuration as Prisma.InputJsonObject,
      },
      update: {
        configuration: reference.configuration as Prisma.InputJsonObject,
        active: reference.active,
      },
    });
  }
  await tx.configurationChange.update({
    where: { id: change.id },
    data: { appliedAt: new Date() },
  });
  await audit(
    tx,
    publicContext(change.reviewedBy, change.tenantId),
    'configuration.applied',
    change.id,
    {
      kind: change.kind,
      targetKey: change.targetKey,
      effectiveDate: change.effectiveDate.toISOString(),
    },
  );
}
export async function applyDueConfigurations() {
  const pending = await db.configurationChange.findMany({
    where: { status: 'APPROVED', appliedAt: null, effectiveDate: { lte: new Date() } },
    select: { tenantId: true },
  });
  for (const tid of new Set(pending.map((p) => p.tenantId)))
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tid} FOR UPDATE`;
        const today = await companyToday(tx, tid);
        const due = await tx.configurationChange.findMany({
          where: {
            tenantId: tid,
            status: 'APPROVED',
            appliedAt: null,
            effectiveDate: { lte: today },
          },
          orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
        });
        for (const change of due) await apply(tx, change);
      },
      { timeout: 20000 },
    );
}
configurationReview.get('/configuration-changes', async (req, res) => {
  const tid = tenant(req, 'company.write');
  await entitlement(db, tid);
  res.json({
    data: await db.configurationChange.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
      ...pagination(req),
    }),
  });
});
configurationReview.post('/configuration-changes/:id/decision', async (req, res) => {
  const b = z
    .object({
      status: z.enum(['APPROVED', 'REJECTED']),
      comment: z.string().trim().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const change = await tx.configurationChange.findFirst({
      where: { id: String(req.params.id), tenantId: tid },
    });
    check(change, 404, 'NOT_FOUND', 'Configuration proposal not found');
    check(
      change.status === 'PENDING',
      409,
      'CONFIGURATION_STATE',
      'This proposal has already been reviewed',
    );
    check(
      change.proposedBy !== req.ctx.userId,
      403,
      'CONFIGURATION_SELF_APPROVAL',
      'A different company configuration administrator must review this proposal',
    );
    if (b.status === 'APPROVED') {
      check(
        change.effectiveDate >= (await companyToday(tx, tid)),
        409,
        'PROPOSAL_EXPIRED',
        'The proposed effective date has passed. Reject and submit a new prospective proposal.',
      );
      check(
        isDeepStrictEqual(await currentValue(tx, change), change.previous),
        409,
        'STALE_CONFIGURATION',
        'Current configuration changed. Reject and submit a new proposal.',
      );
    }
    const reviewed = await tx.configurationChange.update({
      where: { id: change.id },
      data: {
        status: b.status,
        reviewedBy: req.ctx.userId,
        reviewedAt: new Date(),
        reviewComment: b.comment,
      },
    });
    await audit(tx, req.ctx, 'configuration.' + b.status.toLowerCase(), change.id, {
      comment: b.comment,
      proposedBy: change.proposedBy,
    });
    if (b.status === 'APPROVED' && change.effectiveDate <= (await companyToday(tx, tid)))
      await apply(tx, reviewed);
    return tx.configurationChange.findUniqueOrThrow({ where: { id: change.id } });
  });
  res.json({ data });
});

export async function policyAt<T>(
  tx: Tx,
  tenantId: string,
  kind: string,
  targetKey: string,
  date: Date,
  fallback: T,
): Promise<T> {
  const versions = await tx.configurationChange.findMany({
    where: { tenantId, kind, targetKey, status: 'APPROVED' },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
  });
  const latest = versions.filter((v) => v.effectiveDate <= date).at(-1);
  if (latest) return latest.proposal as T;
  if (versions.length && Object.keys(versions[0]!.previous as object).length)
    return versions[0]!.previous as T;
  return fallback;
}
