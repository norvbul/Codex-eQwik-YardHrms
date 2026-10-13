import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  ruleSetSchema,
  referenceVectorSchema,
  verifyReferenceVectors,
  type RuleSet,
} from '../../../packages/payroll-engine/src/index.js';
import {
  db,
  tenant,
  writeTenant,
  entitlement,
  check,
  day,
  audit,
  jobs,
  companyToday,
  loadTenantActor,
  hash,
  ApiError,
  pagination,
  type Tx,
  type Context,
} from './core.js';
import { computePayroll, publicPayrollSnapshot } from './payroll-calculation.js';
import { employeeScope } from './core.js';
export const payroll = Router();
async function normalizedComponents(tx: Tx, tenantId: string, ruleId: string, config: RuleSet) {
  for (const component of config.components) {
    const row = await tx.statutoryComponent.create({
      data: {
        tenantId,
        ruleId,
        code: component.code,
        name: component.name,
        base: component.base,
        deductComponents: component.deductComponents,
        deductTaxRelief: component.deductTaxRelief,
        annualCeiling: component.annualCeiling,
        employeeMethod: component.employee.type,
        employeeRate: component.employee.type === 'FLAT' ? component.employee.rate : null,
        employerMethod: component.employer.type,
        employerRate: component.employer.type === 'FLAT' ? component.employer.rate : null,
      },
    });
    for (const side of ['employee', 'employer'] as const) {
      const method = component[side];
      if (method.type === 'PROGRESSIVE')
        for (let ordinal = 0; ordinal < method.bands.length; ordinal++)
          await tx.taxBand.create({
            data: {
              tenantId,
              componentId: row.id,
              side: side.toUpperCase(),
              ordinal,
              upTo: method.bands[ordinal].upTo,
              rate: method.bands[ordinal].rate,
            },
          });
    }
  }
}
const ruleInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable().optional(),
    sourceReference: z.string().min(10).max(5000),
    configuration: ruleSetSchema,
    referenceVectors: z.array(referenceVectorSchema).max(100),
  })
  .strict();
payroll.get('/payroll/rules', async (req, res) => {
  const tid = tenant(req, 'payroll.read');
  res.json({
    data: await db.statutoryRule.findMany({
      where: { tenantId: tid },
      orderBy: { effectiveFrom: 'desc' },
    }),
  });
});
payroll.post('/payroll/rules', async (req, res) => {
  const b = ruleInput.parse(req.body);
  check(
    b.configuration.currency === 'JMD',
    422,
    'PAYROLL_CURRENCY',
    'Jamaican payroll compensation is denominated in JMD; billing currencies are configured separately',
  );
  check(
    !b.effectiveTo || b.effectiveTo >= b.effectiveFrom,
    422,
    'EFFECTIVE_DATES',
    'Rule end must follow its start',
  );
  const data = await writeTenant(req, 'payroll.rules', 'payroll', async (tx, tid) => {
    const row = await tx.statutoryRule.create({
      data: {
        tenantId: tid,
        name: b.name,
        effectiveFrom: day(b.effectiveFrom),
        effectiveTo: b.effectiveTo ? day(b.effectiveTo) : null,
        sourceReference: b.sourceReference,
        configuration: b.configuration as unknown as Prisma.InputJsonValue,
        referenceVectors: b.referenceVectors as unknown as Prisma.InputJsonValue,
        createdBy: req.ctx.userId,
      },
    });
    await normalizedComponents(tx, tid, row.id, b.configuration);
    await audit(tx, req.ctx, 'payroll.rule_created', row.id, {
      name: b.name,
      sourceReference: b.sourceReference,
      complianceMode: b.configuration.complianceMode,
    });
    return row;
  });
  res.status(201).json({ data });
});
payroll.patch('/payroll/rules/:id', async (req, res) => {
  const b = ruleInput.parse(req.body);
  check(
    b.configuration.currency === 'JMD',
    422,
    'PAYROLL_CURRENCY',
    'Jamaican payroll compensation is denominated in JMD; billing currencies are configured separately',
  );
  const data = await writeTenant(req, 'payroll.rules', 'payroll', async (tx, tid) => {
    const rule = await tx.statutoryRule.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(rule, 404, 'NOT_FOUND', 'Rule version not found');
    check(
      rule.status === 'DRAFT',
      409,
      'RULE_IMMUTABLE',
      'Approved rule versions require a new effective-dated version',
    );
    const components = await tx.statutoryComponent.findMany({
      where: { tenantId: tid, ruleId: rule.id },
    });
    await tx.taxBand.deleteMany({
      where: { tenantId: tid, componentId: { in: components.map((c) => c.id) } },
    });
    await tx.statutoryComponent.deleteMany({ where: { tenantId: tid, ruleId: rule.id } });
    const after = await tx.statutoryRule.update({
      where: { id: rule.id },
      data: {
        name: b.name,
        effectiveFrom: day(b.effectiveFrom),
        effectiveTo: b.effectiveTo ? day(b.effectiveTo) : null,
        sourceReference: b.sourceReference,
        configuration: b.configuration as unknown as Prisma.InputJsonValue,
        referenceVectors: b.referenceVectors as unknown as Prisma.InputJsonValue,
      },
    });
    await normalizedComponents(tx, tid, rule.id, b.configuration);
    await audit(tx, req.ctx, 'payroll.rule_updated', rule.id, {
      before: rule.configuration,
      after: b.configuration as unknown as Prisma.InputJsonValue,
    });
    return after;
  });
  res.json({ data });
});
payroll.post('/payroll/rules/:id/approve', async (req, res) => {
  const b = z
    .object({
      reviewerName: z.string().min(3).max(191),
      attestation: z.literal(true),
      closePreviousVersion: z.boolean().default(false),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'payroll.approve', 'payroll', async (tx, tid) => {
    const rule = await tx.statutoryRule.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(rule, 404, 'NOT_FOUND', 'Rule version not found');
    check(rule.status === 'DRAFT', 409, 'ALREADY_APPROVED', 'Rule version is already approved');
    const company = await tx.tenant.findUniqueOrThrow({ where: { id: tid } });
    check(
      company.allowSelfApproval || rule.createdBy !== req.ctx.userId,
      403,
      'SELF_APPROVAL',
      'A different authorized reviewer must approve this rule package',
    );
    const config = ruleSetSchema.parse(rule.configuration),
      vectors = z.array(referenceVectorSchema).min(1).parse(rule.referenceVectors);
    if (config.complianceMode === 'PRODUCTION_APPROVED') {
      check(
        vectors.every((vector) =>
          config.components.every((component) =>
            Boolean(vector.expected.componentAmounts?.[component.code]),
          ),
        ),
        409,
        'REFERENCE_COMPONENTS',
        'Production vectors must specify every employee and employer statutory component',
      );
      for (const freq of ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'])
        check(
          vectors.some((v) => v.input.frequency === freq),
          409,
          'REFERENCE_COVERAGE',
          'Production rule approval requires accepted weekly, fortnightly and monthly calculations',
        );
    }
    try {
      verifyReferenceVectors(config, vectors);
    } catch (error) {
      throw new ApiError(409, 'REFERENCE_MISMATCH', (error as Error).message);
    }
    const overlaps = await tx.statutoryRule.findMany({
      where: {
        tenantId: tid,
        status: 'APPROVED',
        effectiveFrom: { lte: rule.effectiveTo || day('9999-12-31') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: rule.effectiveFrom } }],
      },
    });
    if (overlaps.length) {
      check(
        b.closePreviousVersion &&
          overlaps.length === 1 &&
          overlaps[0].effectiveFrom < rule.effectiveFrom &&
          rule.effectiveFrom >= (await companyToday(tx, tid)),
        409,
        'RULE_OVERLAP',
        'Choose a non-overlapping period or explicitly close the previous version prospectively',
      );
      check(
        !(await tx.payrollRun.findFirst({
          where: {
            tenantId: tid,
            status: { in: ['APPROVED', 'LOCKED'] },
            ruleId: overlaps[0].id,
            payDate: { gte: rule.effectiveFrom },
          },
        })),
        409,
        'APPROVED_HISTORY',
        'New rule dates would affect approved payroll history',
      );
      await tx.statutoryRule.update({
        where: { id: overlaps[0].id },
        data: { effectiveTo: new Date(rule.effectiveFrom.getTime() - 86400000) },
      });
      await audit(tx, req.ctx, 'payroll.rule_period_closed', overlaps[0].id, {
        effectiveTo: new Date(rule.effectiveFrom.getTime() - 86400000).toISOString(),
      });
    }
    const approved = await tx.statutoryRule.update({
      where: { id: rule.id },
      data: { status: 'APPROVED', approvedBy: req.ctx.userId, approvedAt: new Date() },
    });
    await audit(tx, req.ctx, 'payroll.rule_approved', rule.id, {
      reviewerName: b.reviewerName,
      attestation: b.attestation,
      sourceReference: rule.sourceReference,
      vectors: vectors.length,
      vectorDigest: hash(JSON.stringify(vectors)),
      complianceMode: config.complianceMode,
    });
    return approved;
  });
  res.json({ data });
});
payroll.get('/payroll/adjustments', async (req, res) => {
  const tid = tenant(req, 'payroll.read');
  await entitlement(db, tid, 'payroll');
  res.json({
    data: await db.payrollAdjustment.findMany({
      where: { tenantId: tid },
      include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } },
      orderBy: { effectiveDate: 'desc' },
      ...pagination(req),
    }),
  });
});
payroll.post('/payroll/adjustments', async (req, res) => {
  const b = z
    .object({
      employeeId: z.uuid(),
      name: z.string().min(2).max(100),
      kind: z.enum(['EARNING', 'DEDUCTION']),
      recurrence: z.enum(['ONE_OFF', 'PER_PERIOD']).default('ONE_OFF'),
      amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
      taxable: z.boolean(),
      taxRelief: z.boolean(),
      effectiveDate: z.iso.date(),
      endDate: z.iso.date().nullable(),
      reason: z.string().min(3).max(2000),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'payroll.prepare', 'payroll', async (tx, tid) => {
    await employeeScope(tx, tid, b.employeeId);
    check(
      !b.endDate || b.endDate >= b.effectiveDate,
      422,
      'ADJUSTMENT_DATES',
      'End date must follow effective date',
    );
    check(
      !(await tx.payrollRun.findFirst({
        where: {
          tenantId: tid,
          status: { in: ['APPROVED', 'LOCKED'] },
          endDate: { gte: day(b.effectiveDate) },
          startDate: { lte: b.endDate ? day(b.endDate) : day(b.effectiveDate) },
          snapshots: { some: { employeeId: b.employeeId } },
        },
      })),
      409,
      'PAYROLL_LOCKED',
      'Use an authorized reversal/correction before adding inputs to a locked period',
    );
    const a = await tx.payrollAdjustment.create({
      data: {
        tenantId: tid,
        ...b,
        effectiveDate: day(b.effectiveDate),
        endDate: b.endDate ? day(b.endDate) : null,
        createdBy: req.ctx.userId,
      },
    });
    await audit(tx, req.ctx, 'payroll.adjustment_created', a.id, {
      employeeId: b.employeeId,
      kind: b.kind,
      amount: b.amount,
      reason: b.reason,
    });
    return a;
  });
  res.status(201).json({ data });
});
const runInput = z
  .object({
    frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    payDate: z.iso.date(),
    payGroup: z.string().trim().min(1).max(64).default('ALL'),
    employeeIds: z.array(z.uuid()).min(1).max(10000).optional(),
  })
  .strict();
payroll.post('/payroll-runs', async (req, res) => {
  const b = runInput.parse(req.body);
  check(
    b.endDate >= b.startDate && b.payDate >= b.endDate,
    422,
    'PAYROLL_DATES',
    'Period and pay dates must be in order',
  );
  const days = (day(b.endDate).getTime() - day(b.startDate).getTime()) / 86400000 + 1;
  check(
    b.frequency === 'MONTHLY'
      ? days >= 28 && days <= 31
      : b.frequency === 'WEEKLY'
        ? days === 7
        : days === 14,
    422,
    'PERIOD_LENGTH',
    'Use a full monthly (28–31 days), weekly (7 days), or fortnightly (14 days) period',
  );
  const data = await writeTenant(req, 'payroll.prepare', 'payroll', async (tx, tid) => {
    if (b.employeeIds)
      check(
        (await tx.employee.count({ where: { tenantId: tid, id: { in: b.employeeIds } } })) ===
          new Set(b.employeeIds).size,
        422,
        'EMPLOYEE_SELECTION',
        'All selected employees must belong to this company',
      );
    const prior = await tx.payrollRun.findMany({
      where: {
        tenantId: tid,
        payGroup: b.payGroup,
        frequency: b.frequency,
        startDate: day(b.startDate),
        endDate: day(b.endDate),
      },
    });
    check(
      prior.every((r) => r.status === 'REVERSED'),
      409,
      'PERIOD_EXISTS',
      'An unreversed run already exists for this pay group and period',
    );
    // Prevent double-paying an employee through overlapping pay groups.
    const conflict = await tx.payrollRun.findFirst({
      where: {
        tenantId: tid,
        status: { not: 'REVERSED' },
        frequency: b.frequency,
        startDate: { lte: day(b.endDate) },
        endDate: { gte: day(b.startDate) },
        ...(b.employeeIds
          ? {
              OR: [
                { employeeSelection: { equals: Prisma.DbNull } },
                ...b.employeeIds.map((id) => ({ employeeSelection: { array_contains: id } })),
              ],
            }
          : {}),
      },
    });
    check(
      !conflict,
      409,
      'PAYROLL_OVERLAP',
      'A non-reversed payroll already overlaps this frequency/employee selection',
    );
    const r = await tx.payrollRun.create({
      data: {
        tenantId: tid,
        frequency: b.frequency,
        startDate: day(b.startDate),
        endDate: day(b.endDate),
        payDate: day(b.payDate),
        payGroup: b.payGroup,
        employeeSelection: b.employeeIds || Prisma.DbNull,
        revision: Math.max(0, ...prior.map((r) => r.revision)) + 1,
        createdBy: req.ctx.userId,
      },
    });
    await audit(tx, req.ctx, 'payroll.created', r.id, {
      frequency: b.frequency,
      payGroup: b.payGroup,
      revision: r.revision,
    });
    return r;
  });
  res.status(201).json({ data });
});
payroll.get('/payroll-runs', async (req, res) => {
  const tid = tenant(req, 'payroll.read');
  await entitlement(db, tid, 'payroll');
  res.json({
    data: {
      items: await db.payrollRun.findMany({
        where: { tenantId: tid },
        include: { _count: { select: { snapshots: true } } },
        orderBy: { createdAt: 'desc' },
        ...pagination(req),
      }),
      total: await db.payrollRun.count({ where: { tenantId: tid } }),
    },
  });
});
payroll.get('/payroll-runs/:id', async (req, res) => {
  const tid = tenant(req, 'payroll.read');
  await entitlement(db, tid, 'payroll');
  const r = await db.payrollRun.findUnique({
    where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    include: { snapshots: true, rule: { select: { id: true, name: true, status: true } } },
  });
  check(r, 404, 'NOT_FOUND', 'Payroll run not found');
  res.json({
    data: {
      ...r,
      snapshots: r.snapshots.map((s) =>
        publicPayrollSnapshot(s as typeof s & Record<string, unknown>),
      ),
    },
  });
});
payroll.post('/payroll-runs/:id/prepare', async (req, res) => {
  const data = await writeTenant(req, 'payroll.prepare', 'payroll', async (tx, tid) => {
    const r = await tx.payrollRun.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(r, 404, 'NOT_FOUND', 'Payroll run not found');
    check(
      ['DRAFT', 'PREPARED', 'REVIEWED'].includes(r.status),
      409,
      'PAYROLL_STATE',
      'This run cannot be prepared again',
    );
    const after = await tx.payrollRun.update({
      where: { id: r.id },
      data: {
        status: 'PREPARING',
        version: { increment: 1 },
        preparationError: null,
        preparedBy: req.ctx.userId,
        reviewedBy: null,
      },
    });
    await audit(tx, req.ctx, 'payroll.prepare_requested', r.id, { version: after.version });
    return after;
  });
  await jobs.add(
    'payroll-prepare',
    { runId: data.id, tenantId: data.tenantId, actorId: req.ctx.userId, version: data.version },
    {
      jobId: `payroll-${data.id}-${data.version}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
  res.status(202).json({ data });
});
export async function preparePayroll(
  runId: string,
  tenantId: string,
  actorId: string,
  version: number,
) {
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;
        const ctx = await loadTenantActor(tx, tenantId, actorId);
        check(
          ctx.permissions.has('payroll.prepare') && ctx.mfaEnabled,
          403,
          'PERMISSION_DENIED',
          'Payroll preparation actor is no longer authorized',
        );
        await entitlement(tx, tenantId, 'payroll', true);
        const run = await tx.payrollRun.findUniqueOrThrow({
          where: { tenantId_id: { tenantId, id: runId } },
        });
        if (run.status !== 'PREPARING' || run.version !== version) return;
        const calc = await computePayroll(tx, run);
        await tx.payrollSnapshot.deleteMany({ where: { tenantId, runId } });
        await tx.payrollSnapshot.createMany({ data: calc.outputs });
        await tx.payrollRun.update({
          where: { id: runId },
          data: {
            status: 'PREPARED',
            ruleId: calc.rule.id,
            inputDigest: calc.digest,
            preparedBy: actorId,
            preparationError: null,
            version: { increment: 1 },
          },
        });
        await audit(tx, ctx, 'payroll.prepared', runId, {
          employees: calc.outputs.length,
          ruleId: calc.rule.id,
          inputDigest: calc.digest,
        });
      },
      { timeout: 60000, maxWait: 10000 },
    );
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : 'Payroll preparation failed. Review the inputs and retry.';
    await db.$transaction(async (tx) => {
      const changed = await tx.payrollRun.updateMany({
        where: { id: runId, tenantId, status: 'PREPARING', version },
        data: { status: 'DRAFT', preparationError: message },
      });
      if (changed.count)
        await audit(
          tx,
          { tenantId, userId: actorId, requestId: crypto.randomUUID() },
          'payroll.prepare_failed',
          runId,
          { message },
        );
    });
    throw error;
  }
}
async function scopePayroll(tx: Tx, ctx: Context, runId: string, permission: string) {
  if (ctx.approvalScopes[permission] === 'TEAM') {
    const snapshots = await tx.payrollSnapshot.findMany({
      where: { tenantId: ctx.tenantId!, runId },
      include: { employee: { select: { managerId: true } } },
    });
    check(
      ctx.employeeId && snapshots.every((s) => s.employee.managerId === ctx.employeeId),
      403,
      'APPROVAL_SCOPE',
      'This run includes employees outside your approval scope',
    );
  }
}
payroll.post('/payroll-runs/:id/review', async (req, res) => {
  const data = await writeTenant(req, 'payroll.review', 'payroll', async (tx, tid) => {
    const run = await tx.payrollRun.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(run, 404, 'NOT_FOUND', 'Payroll run not found');
    check(run.status === 'PREPARED', 409, 'PAYROLL_STATE', 'Only prepared payroll can be reviewed');
    const company = await tx.tenant.findUniqueOrThrow({ where: { id: tid } });
    check(
      company.allowSelfApproval || run.preparedBy !== req.ctx.userId,
      403,
      'SELF_REVIEW',
      'A different authorized reviewer must review prepared payroll',
    );
    await scopePayroll(tx, req.ctx, run.id, 'payroll.review');
    const current = await computePayroll(tx, run);
    check(
      current.digest === run.inputDigest,
      409,
      'STALE_PAYROLL',
      'Inputs changed after preparation. Prepare and review the run again.',
    );
    const after = await tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'REVIEWED', reviewedBy: req.ctx.userId, version: { increment: 1 } },
    });
    await audit(tx, req.ctx, 'payroll.reviewed', run.id, {
      reviewer: req.ctx.userId,
      inputDigest: run.inputDigest,
    });
    return after;
  });
  res.json({ data });
});
payroll.post('/payroll-runs/:id/approve', async (req, res) => {
  const data = await writeTenant(req, 'payroll.approve', 'payroll', async (tx, tid) => {
    const run = await tx.payrollRun.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(run, 404, 'NOT_FOUND', 'Payroll run not found');
    check(run.status === 'REVIEWED', 409, 'PAYROLL_STATE', 'Only reviewed payroll can be approved');
    const company = await tx.tenant.findUniqueOrThrow({ where: { id: tid } });
    check(
      company.allowSelfApproval || run.preparedBy !== req.ctx.userId,
      403,
      'SELF_APPROVAL',
      'Final approval must be separate from preparation',
    );
    await scopePayroll(tx, req.ctx, run.id, 'payroll.approve');
    const current = await computePayroll(tx, run);
    check(
      current.digest === run.inputDigest,
      409,
      'STALE_PAYROLL',
      'Payroll inputs changed. Prepare and review the run again.',
    );
    const approvedAt = new Date(),
      snapshots = await tx.payrollSnapshot.findMany({ where: { tenantId: tid, runId: run.id } });
    for (const snapshot of snapshots)
      await tx.payrollSnapshot.update({
        where: { id: snapshot.id },
        data: {
          snapshot: {
            ...(snapshot.snapshot as Prisma.InputJsonObject),
            approval: {
              approvedBy: req.ctx.userId,
              approvedAt: approvedAt.toISOString(),
              inputDigest: run.inputDigest,
            },
          },
        },
      });
    await tx.payrollAdjustment.updateMany({
      where: { tenantId: tid, id: { in: current.adjustmentIds } },
      data: { payrollRunId: run.id },
    });
    await tx.timesheet.updateMany({
      where: { tenantId: tid, id: { in: current.timesheetIds } },
      data: { payrollRunId: run.id },
    });
    await tx.overtime.updateMany({
      where: { tenantId: tid, id: { in: current.overtimeIds } },
      data: { payrollRunId: run.id },
    });
    await tx.leaveRequest.updateMany({
      where: { tenantId: tid, id: { in: current.leaveIds } },
      data: { payrollRunId: run.id },
    });
    const after = await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'APPROVED',
        approvedBy: req.ctx.userId,
        approvedAt,
        version: { increment: 1 },
      },
    });
    await audit(tx, req.ctx, 'payroll.approved', run.id, {
      approvedBy: req.ctx.userId,
      inputDigest: run.inputDigest,
      employees: snapshots.length,
    });
    return after;
  });
  res.json({ data });
});
payroll.post('/payroll-runs/:id/lock', async (req, res) => {
  const data = await writeTenant(req, 'payroll.approve', 'payroll', async (tx, tid) => {
    const run = await tx.payrollRun.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(run, 404, 'NOT_FOUND', 'Payroll run not found');
    check(run.status === 'APPROVED', 409, 'PAYROLL_STATE', 'Only approved runs may be locked');
    await scopePayroll(tx, req.ctx, run.id, 'payroll.approve');
    const after = await tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'LOCKED', version: { increment: 1 } },
    });
    await audit(tx, req.ctx, 'payroll.locked', run.id, { actor: req.ctx.userId });
    return after;
  });
  res.json({ data });
});
payroll.post('/payroll-runs/:id/reverse', async (req, res) => {
  const b = z
    .object({ reason: z.string().trim().min(10).max(2000) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'payroll.approve', 'payroll', async (tx, tid) => {
    const run = await tx.payrollRun.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(run, 404, 'NOT_FOUND', 'Payroll run not found');
    check(
      ['APPROVED', 'LOCKED'].includes(run.status),
      409,
      'PAYROLL_STATE',
      'Only approved/locked runs can be reversed',
    );
    await scopePayroll(tx, req.ctx, run.id, 'payroll.approve');
    const after = await tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'REVERSED', reversalReason: b.reason, version: { increment: 1 } },
    });
    await tx.payrollAdjustment.updateMany({
      where: { tenantId: tid, payrollRunId: run.id },
      data: { payrollRunId: null },
    });
    await tx.timesheet.updateMany({
      where: { tenantId: tid, payrollRunId: run.id },
      data: { payrollRunId: null },
    });
    await tx.overtime.updateMany({
      where: { tenantId: tid, payrollRunId: run.id },
      data: { payrollRunId: null },
    });
    await tx.leaveRequest.updateMany({
      where: { tenantId: tid, payrollRunId: run.id },
      data: { payrollRunId: null },
    });
    await audit(tx, req.ctx, 'payroll.reversed', run.id, {
      reason: b.reason,
      reversedBy: req.ctx.userId,
      originalApprover: run.approvedBy,
    });
    return after;
  });
  res.json({ data });
});

payroll.post('/payroll/adjustments/:id/end', async (req, res) => {
  const b = z
    .object({ endDate: z.iso.date(), reason: z.string().min(10).max(2000) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'payroll.prepare', 'payroll', async (tx, tid) => {
    const row = await tx.payrollAdjustment.findFirst({
      where: { id: String(req.params.id), tenantId: tid },
    });
    check(row, 404, 'NOT_FOUND', 'Payroll input not found');
    check(row.recurrence === 'PER_PERIOD', 422, 'ONE_OFF_INPUT', 'One-off inputs do not recur');
    check(
      day(b.endDate) >= (await companyToday(tx, tid)) && day(b.endDate) >= row.effectiveDate,
      422,
      'PROSPECTIVE_END',
      'End recurring inputs prospectively',
    );
    const after = await tx.payrollAdjustment.update({
      where: { id: row.id },
      data: { endDate: day(b.endDate) },
    });
    await audit(tx, req.ctx, 'payroll.input_ended', row.id, {
      before: row.endDate?.toISOString() || null,
      endDate: b.endDate,
      reason: b.reason,
    });
    return after;
  });
  res.json({ data });
});
