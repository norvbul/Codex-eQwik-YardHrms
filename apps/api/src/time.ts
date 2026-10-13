import { policyAt } from './configuration-review.js';
import { Router } from 'express';
import { Decimal } from 'decimal.js';
import { Temporal } from '@js-temporal/polyfill';
import type { Prisma } from '@prisma/client';
import {
  timesheetSchema,
  overtimeSchema,
  decisionSchema,
} from '../../../packages/types/src/index.js';
import {
  db,
  tenant,
  writeTenant,
  entitlement,
  check,
  day,
  audit,
  employeeScope,
  actorScope,
  approvalScope,
  pagination,
  type Tx,
  type Context,
} from './core.js';
import { compensationAt } from './employees.js';
import { checkPayrollLock } from './leave.js';
export const time = Router();
export function timeSpan(workDate: string, startTime: string, endTime: string, timezone: string) {
  const date = Temporal.PlainDate.from(workDate);
  const start = date
    .toPlainDateTime(Temporal.PlainTime.from(startTime))
    .toZonedDateTime(timezone, { disambiguation: 'reject' });
  const endDate = endTime <= startTime ? date.add({ days: 1 }) : date;
  const end = endDate
    .toPlainDateTime(Temporal.PlainTime.from(endTime))
    .toZonedDateTime(timezone, { disambiguation: 'reject' });
  return {
    startsAt: new Date(start.epochMilliseconds),
    endsAt: new Date(end.epochMilliseconds),
    spanHours: new Decimal(end.epochMilliseconds - start.epochMilliseconds).div(3600000),
  };
}
export async function saveTimesheet(
  tx: Tx,
  ctx: Context,
  b: ReturnType<typeof timesheetSchema.parse>,
) {
  const tid = ctx.tenantId!,
    e = await employeeScope(tx, tid, b.employeeId),
    date = day(b.workDate);
  check(e.active, 422, 'INACTIVE_EMPLOYEE', 'Choose an active employee');
  const terms = await compensationAt(tx, e, date);
  check(
    terms.frequency !== 'MONTHLY',
    422,
    'MONTHLY_TIMESHEET',
    'Monthly employees cannot submit regular timesheets. Use eligible overtime instead.',
  );
  check(date >= e.hireDate, 422, 'BEFORE_HIRE', 'Work date cannot precede hire date');
  const company = await tx.tenant.findUniqueOrThrow({ where: { id: tid } });
  const shift = await tx.referenceData.findUnique({
    where: { tenantId_category_name: { tenantId: tid, category: 'SHIFT', name: b.shift } },
  });
  check(shift?.active, 422, 'INVALID_SHIFT', 'Choose a configured active shift');
  let span: ReturnType<typeof timeSpan>;
  try {
    span = timeSpan(b.workDate, b.startTime, b.endTime, company.timezone);
  } catch {
    throw new importError(
      422,
      'LOCAL_TIME',
      'Ambiguous or invalid local time. Choose an unambiguous time for the company timezone.',
    );
  }
  const hours = span.spanHours.minus(b.breakHours),
    config = (
      await policyAt(tx, tid, 'REFERENCE_SHIFT', b.shift, date, {
        configuration: shift.configuration as { maxHours?: string },
      })
    ).configuration;
  check(
    hours.gt(0) &&
      hours.lte(config?.maxHours || '24') &&
      new Decimal(b.breakHours).lte(span.spanHours),
    422,
    'INVALID_HOURS',
    'Break and worked hours must fit the configured shift limit',
  );
  await checkPayrollLock(tx, tid, e.id, date);
  check(
    !(await tx.timesheet.findFirst({
      where: {
        tenantId: tid,
        employeeId: e.id,
        status: { in: ['PENDING', 'APPROVED'] },
        startsAt: { lt: span.endsAt },
        endsAt: { gt: span.startsAt },
      },
    })),
    409,
    'OVERLAPPING_TIME',
    'This time overlaps an existing active entry',
  );
  check(
    !(await tx.leaveRequest.findFirst({
      where: {
        tenantId: tid,
        employeeId: e.id,
        status: 'APPROVED',
        startDate: { lte: date },
        endDate: { gte: date },
      },
    })),
    409,
    'LEAVE_CONFLICT',
    'This employee has approved leave on that date',
  );
  const t = await tx.timesheet.create({
    data: {
      tenantId: tid,
      employeeId: e.id,
      workDate: date,
      shift: b.shift,
      startsAt: span.startsAt,
      endsAt: span.endsAt,
      breakHours: b.breakHours,
      hours: hours.toFixed(2),
      submittedBy: ctx.userId,
    },
  });
  await audit(tx, ctx, 'timesheet.submitted', t.id, {
    employeeId: e.id,
    submittedBy: ctx.userId,
    workDate: b.workDate,
    hours: t.hours.toString(),
  });
  return t;
}
import { ApiError as importError } from './core.js';
time.get('/timesheets', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'timesheets');
  const any =
    req.ctx.permissions.has('timesheets.submit.any') ||
    req.ctx.permissions.has('timesheets.approve');
  const where: Prisma.TimesheetWhereInput = {
    tenantId: tid,
    ...(!any ? { employeeId: req.ctx.employeeId || 'none' } : {}),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  };
  res.json({
    data: {
      items: await db.timesheet.findMany({
        where,
        include: {
          employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
        },
        orderBy: { workDate: 'desc' },
        ...pagination(req),
      }),
      total: await db.timesheet.count({ where }),
    },
  });
});
time.post('/timesheets', async (req, res) => {
  const b = timesheetSchema.parse(req.body);
  tenant(req);
  actorScope(req, 'timesheets', b.employeeId);
  const p = req.ctx.permissions.has('timesheets.submit.any')
    ? 'timesheets.submit.any'
    : 'timesheets.submit.self';
  const data = await writeTenant(req, p, 'timesheets', (tx) => saveTimesheet(tx, req.ctx, b));
  res.status(201).json({ data });
});
time.post('/timesheets/:id/decision', async (req, res) => {
  const b = decisionSchema.parse(req.body);
  const data = await writeTenant(req, 'timesheets.approve', 'timesheets', async (tx, tid) => {
    const t = await tx.timesheet.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(t, 404, 'NOT_FOUND', 'Timesheet not found');
    check(t.status === 'PENDING', 409, 'ALREADY_REVIEWED', 'This entry has already been reviewed');
    await approvalScope(tx, req, t.employeeId, t.submittedBy, 'timesheets.approve');
    await checkPayrollLock(tx, tid, t.employeeId, t.workDate);
    const after = await tx.timesheet.update({
      where: { id: t.id },
      data: {
        status: b.status,
        approvedBy: req.ctx.userId,
        approvedAt: new Date(),
        comment: b.comment,
      },
    });
    await audit(tx, req.ctx, 'timesheet.' + b.status.toLowerCase(), t.id, {
      employeeId: t.employeeId,
      submittedBy: t.submittedBy,
      reviewedBy: req.ctx.userId,
      comment: b.comment,
    });
    return after;
  });
  res.json({ data });
});
time.get('/overtime', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'overtime');
  const any =
    req.ctx.permissions.has('overtime.submit.any') || req.ctx.permissions.has('overtime.approve');
  const where: Prisma.OvertimeWhereInput = {
    tenantId: tid,
    ...(!any ? { employeeId: req.ctx.employeeId || 'none' } : {}),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  };
  res.json({
    data: {
      items: await db.overtime.findMany({
        where,
        include: {
          employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
        },
        orderBy: { workDate: 'desc' },
        ...pagination(req),
      }),
      total: await db.overtime.count({ where }),
    },
  });
});
time.post('/overtime', async (req, res) => {
  const b = overtimeSchema.parse(req.body);
  tenant(req);
  actorScope(req, 'overtime', b.employeeId);
  const p = req.ctx.permissions.has('overtime.submit.any')
    ? 'overtime.submit.any'
    : 'overtime.submit.self';
  const data = await writeTenant(req, p, 'overtime', async (tx, tid) => {
    const e = await employeeScope(tx, tid, b.employeeId);
    check(
      e.active && e.overtimeEligible,
      422,
      'OVERTIME_INELIGIBLE',
      'Choose an active overtime-eligible employee',
    );
    check(
      new Decimal(b.hours).gt(0) && new Decimal(b.hours).lte(24),
      422,
      'OVERTIME_HOURS',
      'Overtime hours must be greater than zero and at most 24',
    );
    const date = day(b.workDate);
    check(date >= e.hireDate, 422, 'BEFORE_HIRE', 'Work date cannot precede hire date');
    await checkPayrollLock(tx, tid, e.id, date);
    const rule = await tx.referenceData.findUnique({
      where: { tenantId_category_name: { tenantId: tid, category: 'OVERTIME', name: b.category } },
    });
    const config = rule
      ? (
          await policyAt(tx, tid, 'REFERENCE_OVERTIME', b.category, date, {
            configuration: rule.configuration as { multiplier?: string },
          })
        ).configuration
      : null;
    check(
      rule?.active && config?.multiplier,
      422,
      'OVERTIME_RULE',
      'Choose a configured overtime category',
    );
    const t = await tx.overtime.create({
      data: {
        tenantId: tid,
        employeeId: e.id,
        workDate: date,
        hours: b.hours,
        multiplier: config.multiplier,
        category: b.category,
        reason: b.reason,
        submittedBy: req.ctx.userId,
      },
    });
    await audit(tx, req.ctx, 'overtime.submitted', t.id, {
      employeeId: e.id,
      submittedBy: req.ctx.userId,
      hours: b.hours,
      multiplier: config.multiplier,
    });
    return t;
  });
  res.status(201).json({ data });
});
time.post('/overtime/:id/decision', async (req, res) => {
  const b = decisionSchema.parse(req.body);
  const data = await writeTenant(req, 'overtime.approve', 'overtime', async (tx, tid) => {
    const t = await tx.overtime.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(t, 404, 'NOT_FOUND', 'Overtime request not found');
    check(
      t.status === 'PENDING',
      409,
      'ALREADY_REVIEWED',
      'This request has already been reviewed',
    );
    await approvalScope(tx, req, t.employeeId, t.submittedBy, 'overtime.approve');
    await checkPayrollLock(tx, tid, t.employeeId, t.workDate);
    const after = await tx.overtime.update({
      where: { id: t.id },
      data: {
        status: b.status,
        approvedBy: req.ctx.userId,
        approvedAt: new Date(),
        comment: b.comment,
      },
    });
    await audit(tx, req.ctx, 'overtime.' + b.status.toLowerCase(), t.id, {
      employeeId: t.employeeId,
      submittedBy: t.submittedBy,
      reviewedBy: req.ctx.userId,
      comment: b.comment,
    });
    return after;
  });
  res.json({ data });
});
import { z } from 'zod';
for (const [path, permission] of [
  ['timesheets', 'timesheets'],
  ['overtime', 'overtime'],
] as const)
  time.post('/' + path + '/:id/withdraw', async (req, res) => {
    const b = z
      .object({ reason: z.string().trim().min(10).max(2000) })
      .strict()
      .parse(req.body);
    tenant(req);
    const p = req.ctx.permissions.has(permission + '.submit.any')
      ? permission + '.submit.any'
      : permission + '.submit.self';
    const data = await writeTenant(req, p, permission, async (tx, tid) => {
      const record =
        path === 'timesheets'
          ? await tx.timesheet.findFirst({ where: { id: String(req.params.id), tenantId: tid } })
          : await tx.overtime.findFirst({ where: { id: String(req.params.id), tenantId: tid } });
      check(record, 404, 'NOT_FOUND', 'Time entry not found');
      actorScope(req, permission, record.employeeId);
      check(
        ['PENDING', 'APPROVED', 'REJECTED'].includes(record.status),
        409,
        'ENTRY_STATE',
        'This entry was already withdrawn',
      );
      await checkPayrollLock(tx, tid, record.employeeId, record.workDate);
      check(
        !record.payrollRunId,
        409,
        'PAYROLL_INPUT_IN_USE',
        'Reverse the affected payroll before correcting its inputs',
      );
      if (record.status === 'APPROVED') {
        check(
          req.ctx.permissions.has('payroll.prepare') ||
            req.ctx.permissions.has('company.write') ||
            req.ctx.permissions.has(permission + '.approve'),
          403,
          'CORRECTION_AUTHORITY',
          'Approved time requires authorized payroll or scoped review authority',
        );
        await approvalScope(
          tx,
          req,
          record.employeeId,
          record.submittedBy,
          permission + '.approve',
        );
      } else
        check(
          record.submittedBy === req.ctx.userId || req.ctx.permissions.has('company.write'),
          403,
          'WITHDRAW_AUTHORITY',
          'Only the submitter or company administrator may withdraw this entry',
        );
      const after =
        path === 'timesheets'
          ? await tx.timesheet.update({
              where: { id: record.id },
              data: { status: 'WITHDRAWN', comment: b.reason },
            })
          : await tx.overtime.update({
              where: { id: record.id },
              data: { status: 'WITHDRAWN', comment: b.reason },
            });
      await audit(tx, req.ctx, permission + '.withdrawn', record.id, {
        previousStatus: record.status,
        employeeId: record.employeeId,
        originalSubmitter: record.submittedBy,
        reason: b.reason,
      });
      return after;
    });
    res.json({ data });
  });
