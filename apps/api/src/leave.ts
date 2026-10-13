import { policyAt } from './configuration-review.js';
import { Router } from 'express';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { leaveSchema, decisionSchema } from '../../../packages/types/src/index.js';
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
  random,
  companyToday,
  type Tx,
  type Context,
} from './core.js';
export const leave = Router();
export async function checkPayrollLock(
  tx: Tx,
  tenantId: string,
  employeeId: string,
  start: Date,
  end = start,
) {
  const locked = await tx.payrollRun.findFirst({
    where: {
      tenantId,
      status: { in: ['APPROVED', 'LOCKED'] },
      startDate: { lte: end },
      endDate: { gte: start },
      snapshots: { some: { employeeId } },
    },
  });
  check(
    !locked,
    409,
    'PAYROLL_LOCKED',
    'This period belongs to approved payroll. Use an authorized correction workflow.',
  );
}
export async function workingDays(
  tx: Tx,
  tenantId: string,
  start: Date,
  end: Date,
  employeeId?: string,
) {
  check(
    (end.getTime() - start.getTime()) / 86400000 <= 366,
    422,
    'LEAVE_RANGE',
    'A leave request cannot span more than 366 days',
  );
  const employee = employeeId ? await employeeScope(tx, tenantId, employeeId) : null;
  const schedule = employee?.scheduleId
    ? await tx.referenceData.findUnique({ where: { id: employee.scheduleId } })
    : await tx.referenceData.findUnique({
        where: { tenantId_category_name: { tenantId, category: 'SCHEDULE', name: 'Standard' } },
      });
  const config = schedule?.configuration as { weekdays?: number[] } | null;
  const versions = schedule
    ? await tx.configurationChange.findMany({
        where: {
          tenantId,
          kind: 'REFERENCE_SCHEDULE',
          targetKey: schedule.name,
          status: 'APPROVED',
        },
        orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
      })
    : [];
  const holidays = await tx.holiday.findMany({
    where: { tenantId, date: { gte: start, lte: end } },
  });
  const excluded = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  let count = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    const version = versions.filter((v) => v.effectiveDate <= d).at(-1);
    const policy = (version?.proposal || (versions.length ? versions[0]!.previous : null)) as {
      configuration?: { weekdays?: number[] };
    } | null;
    const weekdays = policy?.configuration?.weekdays || config?.weekdays || [1, 2, 3, 4, 5];
    if (weekdays.includes(d.getUTCDay()) && !excluded.has(d.toISOString().slice(0, 10))) count++;
  }
  return count;
}
export async function creditBalance(
  tx: Tx,
  tenantId: string,
  employeeId: string,
  leaveTypeId: string,
  asOf?: Date,
) {
  asOf = asOf || (await companyToday(tx, tenantId));
  const credits = await tx.leaveLedger.findMany({
    where: {
      tenantId,
      employeeId,
      leaveTypeId,
      days: { gt: 0 },
      effectiveDate: { lte: asOf },
      OR: [{ expiresAt: null }, { expiresAt: { gte: day(asOf.toISOString().slice(0, 10)) } }],
    },
    include: { allocations: true },
    orderBy: [{ expiresAt: 'asc' }, { effectiveDate: 'asc' }],
  });
  const remaining = credits.map((c) => ({
    credit: c,
    available: c.allocations.reduce(
      (n, a) => n.plus(a.days.toString()),
      new Decimal(c.days.toString()),
    ),
  }));
  return {
    credits: remaining,
    total: remaining.reduce((n, c) => n.plus(c.available), new Decimal(0)),
  };
}
export async function debitLeave(
  tx: Tx,
  ctx: Context,
  employeeId: string,
  leaveTypeId: string,
  days: Decimal,
  reason: string,
  source: string,
  effectiveDate: Date,
) {
  const balance = await creditBalance(tx, ctx.tenantId!, employeeId, leaveTypeId, effectiveDate);
  check(
    balance.total.gte(days),
    409,
    'INSUFFICIENT_LEAVE',
    'Insufficient available leave. Record an authorized opening balance or adjustment first.',
  );
  let remaining = days;
  // Expiring credits are consumed first. Allocations preserve spent-credit history after expiry.
  const credits = balance.credits.sort(
    (a, b) =>
      (a.credit.expiresAt?.getTime() || Infinity) - (b.credit.expiresAt?.getTime() || Infinity),
  );
  for (const c of credits) {
    if (remaining.lte(0)) break;
    const used = Decimal.min(remaining, c.available);
    if (used.lte(0)) continue;
    await tx.leaveLedger.create({
      data: {
        tenantId: ctx.tenantId!,
        employeeId,
        leaveTypeId,
        parentId: c.credit.id,
        days: used.negated().toString(),
        kind: 'UTILIZATION',
        reason,
        actorId: ctx.userId,
        sourceId: source + ':' + c.credit.id,
        effectiveDate,
      },
    });
    remaining = remaining.minus(used);
  }
}
leave.get('/leave-requests', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'leave');
  const any =
    req.ctx.permissions.has('leave.submit.any') || req.ctx.permissions.has('leave.approve');
  const where: Prisma.LeaveRequestWhereInput = {
    tenantId: tid,
    ...(!any ? { employeeId: req.ctx.employeeId || 'none' } : {}),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  };
  res.json({
    data: {
      items: await db.leaveRequest.findMany({
        where,
        include: {
          employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
          leaveType: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...pagination(req),
      }),
      total: await db.leaveRequest.count({ where }),
    },
  });
});
leave.post('/leave-requests', async (req, res) => {
  const b = leaveSchema.parse(req.body);
  tenant(req);
  actorScope(req, 'leave', b.employeeId);
  const p = req.ctx.permissions.has('leave.submit.any') ? 'leave.submit.any' : 'leave.submit.self';
  const data = await writeTenant(req, p, 'leave', async (tx, tid) => {
    const e = await employeeScope(tx, tid, b.employeeId);
    check(e.active, 422, 'INACTIVE_EMPLOYEE', 'Choose an active employee');
    const type = await tx.leaveType.findUnique({
      where: { tenantId_id: { tenantId: tid, id: b.leaveTypeId } },
    });
    check(type, 422, 'INVALID_LEAVE_TYPE', 'Choose a leave type in this company');
    const start = day(b.startDate),
      end = day(b.endDate);
    check(start >= e.hireDate, 422, 'LEAVE_BEFORE_HIRE', 'Leave cannot precede the hire date');
    await checkPayrollLock(tx, tid, e.id, start, end);
    check(
      !(await tx.leaveRequest.findFirst({
        where: {
          tenantId: tid,
          employeeId: e.id,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
      })),
      409,
      'OVERLAPPING_LEAVE',
      'This employee has an overlapping leave request',
    );
    const days = await workingDays(tx, tid, start, end, e.id);
    check(days > 0, 422, 'NO_WORKING_DAYS', 'This range has no configured working days');
    const r = await tx.leaveRequest.create({
      data: {
        tenantId: tid,
        employeeId: e.id,
        leaveTypeId: type.id,
        startDate: start,
        endDate: end,
        days,
        paidFraction: (
          await policyAt(tx, tid, 'LEAVE_POLICY', type.name, start, {
            paidFraction: type.paidFraction.toString(),
          })
        ).paidFraction,
        reason: b.reason,
        submittedBy: req.ctx.userId,
      },
    });
    await audit(tx, req.ctx, 'leave.submitted', r.id, {
      employeeId: e.id,
      submittedBy: req.ctx.userId,
      startDate: b.startDate,
      endDate: b.endDate,
      days,
    });
    return r;
  });
  res.status(201).json({ data });
});
leave.post('/leave-requests/:id/decision', async (req, res) => {
  const b = decisionSchema.parse(req.body);
  const data = await writeTenant(req, 'leave.approve', 'leave', async (tx, tid) => {
    const r = await tx.leaveRequest.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(r, 404, 'NOT_FOUND', 'Leave request not found');
    check(
      r.status === 'PENDING',
      409,
      'ALREADY_REVIEWED',
      'This request has already been reviewed',
    );
    await approvalScope(tx, req, r.employeeId, r.submittedBy);
    await checkPayrollLock(tx, tid, r.employeeId, r.startDate, r.endDate);
    if (b.status === 'APPROVED') {
      check(
        !(await tx.timesheet.findFirst({
          where: {
            tenantId: tid,
            employeeId: r.employeeId,
            status: 'APPROVED',
            workDate: { gte: r.startDate, lte: r.endDate },
          },
        })),
        409,
        'ATTENDANCE_CONFLICT',
        'Approved regular attendance overlaps this leave',
      );
      if (new Decimal(r.paidFraction.toString()).gt(0))
        await debitLeave(
          tx,
          req.ctx,
          r.employeeId,
          r.leaveTypeId,
          new Decimal(r.days.toString()),
          'Approved leave ' + r.id,
          r.id,
          r.startDate,
        );
    }
    const after = await tx.leaveRequest.update({
      where: { id: r.id },
      data: {
        status: b.status,
        approvedBy: req.ctx.userId,
        approvedAt: new Date(),
        comment: b.comment,
      },
    });
    await audit(tx, req.ctx, 'leave.' + b.status.toLowerCase(), r.id, {
      employeeId: r.employeeId,
      submittedBy: r.submittedBy,
      reviewedBy: req.ctx.userId,
      comment: b.comment,
    });
    return after;
  });
  res.json({ data });
});
leave.get('/leave-balances', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'leave');
  const requested = String(req.query.employeeId || req.ctx.employeeId || '');
  check(requested, 422, 'EMPLOYEE_REQUIRED', 'Select an employee');
  check(
    req.ctx.employeeId === requested ||
      req.ctx.permissions.has('leave.submit.any') ||
      req.ctx.permissions.has('leave.approve'),
    403,
    'SUBJECT_DENIED',
    'You cannot view this balance',
  );
  await employeeScope(db, tid, requested);
  const types = await db.leaveType.findMany({ where: { tenantId: tid } });
  const data = await Promise.all(
    types.map(async (t) => ({
      leaveTypeId: t.id,
      name: t.name,
      available: (await creditBalance(db, tid, requested, t.id)).total.toFixed(2),
      annualDays: t.annualDays.toString(),
      carryForwardDays: t.carryForwardDays.toString(),
    })),
  );
  res.json({ data });
});
leave.get('/leave-ledger', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'leave');
  const employeeId = String(req.query.employeeId || req.ctx.employeeId || '');
  check(employeeId, 422, 'EMPLOYEE_REQUIRED', 'Select an employee');
  check(
    req.ctx.employeeId === employeeId || req.ctx.permissions.has('leave.balance.adjust'),
    403,
    'SUBJECT_DENIED',
    'Leave history is restricted',
  );
  await employeeScope(db, tid, employeeId);
  res.json({
    data: await db.leaveLedger.findMany({
      where: { tenantId: tid, employeeId },
      include: { leaveType: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      ...pagination(req),
    }),
  });
});
leave.post('/leave-balances/adjust', async (req, res) => {
  const b = z
    .object({
      employeeId: z.uuid(),
      leaveTypeId: z.uuid(),
      days: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
      reason: z.string().min(3).max(2000),
      effectiveDate: z.iso.date(),
      expiresAt: z.iso.date().nullable().optional(),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'leave.balance.adjust', 'leave', async (tx, tid) => {
    await employeeScope(tx, tid, b.employeeId);
    check(
      await tx.leaveType.findUnique({
        where: { tenantId_id: { tenantId: tid, id: b.leaveTypeId } },
      }),
      422,
      'INVALID_LEAVE_TYPE',
      'Choose a leave type in this company',
    );
    const amount = new Decimal(b.days);
    check(
      !amount.isZero() && amount.abs().lte(10000),
      422,
      'ADJUSTMENT_AMOUNT',
      'Enter a nonzero adjustment within 10,000 days',
    );
    const effective = day(b.effectiveDate);
    check(
      !b.expiresAt || b.expiresAt >= b.effectiveDate,
      422,
      'EXPIRY_DATE',
      'Expiry must follow the effective date',
    );
    if (amount.lt(0))
      await debitLeave(
        tx,
        req.ctx,
        b.employeeId,
        b.leaveTypeId,
        amount.abs(),
        b.reason,
        random(),
        effective,
      );
    else
      await tx.leaveLedger.create({
        data: {
          tenantId: tid,
          employeeId: b.employeeId,
          leaveTypeId: b.leaveTypeId,
          days: b.days,
          kind: 'ADJUSTMENT',
          reason: b.reason,
          actorId: req.ctx.userId,
          effectiveDate: effective,
          expiresAt: b.expiresAt ? day(b.expiresAt) : null,
        },
      });
    await audit(tx, req.ctx, 'leave.balance_adjusted', b.employeeId, {
      ...b,
      actor: req.ctx.userId,
    });
    return { message: 'Leave balance adjusted' };
  });
  res.json({ data });
});
leave.post('/leave-balances/accrue', async (req, res) => {
  const b = z
    .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'leave.balance.adjust', 'leave', async (tx, tid) => {
    const date = day(b.month + '-01');
    check(
      date <= (await companyToday(tx, tid)),
      422,
      'FUTURE_ACCRUAL',
      'Future monthly accruals cannot be posted',
    );
    const employees = await tx.employee.findMany({
      where: { tenantId: tid, active: true, hireDate: { lte: date } },
    });
    const types = await tx.leaveType.findMany({ where: { tenantId: tid, annualDays: { gt: 0 } } });
    let posted = 0;
    const year = Number(b.month.slice(0, 4)),
      month = Number(b.month.slice(5));
    for (const e of employees)
      for (const t of types) {
        const sourceId = `ACCRUAL:${e.id}:${t.id}:${b.month}`;
        if (
          await tx.leaveLedger.findUnique({
            where: { tenantId_sourceId: { tenantId: tid, sourceId } },
          })
        )
          continue;
        const annual = new Decimal(t.annualDays.toString()),
          amount = annual
            .times(month)
            .div(12)
            .toDecimalPlaces(2)
            .minus(
              annual
                .times(month - 1)
                .div(12)
                .toDecimalPlaces(2),
            );
        await tx.leaveLedger.create({
          data: {
            tenantId: tid,
            employeeId: e.id,
            leaveTypeId: t.id,
            days: amount.toString(),
            kind: 'ACCRUAL',
            reason: 'Monthly accrual ' + b.month,
            actorId: req.ctx.userId,
            sourceId,
            effectiveDate: date,
            expiresAt: day(year + '-12-31'),
          },
        });
        posted++;
      }
    await audit(tx, req.ctx, 'leave.accrual_posted', null, { month: b.month, posted });
    return { posted };
  });
  res.json({ data });
});
leave.post('/leave-balances/carry-forward', async (req, res) => {
  const b = z
    .object({ year: z.number().int().min(2000).max(2200) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'leave.balance.adjust', 'leave', async (tx, tid) => {
    const start = day(b.year + '-01-01');
    check(
      start <= (await companyToday(tx, tid)),
      422,
      'FUTURE_CARRY',
      'Future carry-forward cannot be posted',
    );
    const rows = await tx.leaveLedger.findMany({
      where: { tenantId: tid, days: { gt: 0 }, expiresAt: day(b.year - 1 + '-12-31') },
      include: { allocations: true, leaveType: true },
    });
    const groups = new Map<
      string,
      { employeeId: string; leaveTypeId: string; available: Decimal; cap: Decimal }
    >();
    for (const r of rows) {
      const key = r.employeeId + ':' + r.leaveTypeId;
      const g = groups.get(key) || {
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        available: new Decimal(0),
        cap: new Decimal(r.leaveType.carryForwardDays.toString()),
      };
      g.available = g.available.plus(
        r.allocations.reduce((a, d) => a.plus(d.days.toString()), new Decimal(r.days.toString())),
      );
      groups.set(key, g);
    }
    let posted = 0;
    for (const g of groups.values()) {
      const sourceId = `CARRY:${g.employeeId}:${g.leaveTypeId}:${b.year}`;
      if (
        await tx.leaveLedger.findUnique({
          where: { tenantId_sourceId: { tenantId: tid, sourceId } },
        })
      )
        continue;
      const amount = Decimal.min(g.available, g.cap);
      if (amount.lte(0)) continue;
      await tx.leaveLedger.create({
        data: {
          tenantId: tid,
          employeeId: g.employeeId,
          leaveTypeId: g.leaveTypeId,
          days: amount.toString(),
          kind: 'CARRY_FORWARD',
          reason: 'Configured annual carry-forward',
          actorId: req.ctx.userId,
          sourceId,
          effectiveDate: start,
          expiresAt: day(b.year + '-12-31'),
        },
      });
      posted++;
    }
    await audit(tx, req.ctx, 'leave.carry_forward', null, { year: b.year, posted });
    return { posted };
  });
  res.json({ data });
});
