import { Router } from 'express';
import { z } from 'zod';
import { companySchema } from '../../../packages/types/src/index.js';
import { subscriptionState } from '../../../packages/authorization/src/index.js';
import {
  db,
  companyToday,
  tenant,
  writeTenant,
  audit,
  entitlement,
  pagination,
  check,
} from './core.js';
export const foundation = Router();
foundation.get('/tenants/current', async (req, res) => {
  const tid = tenant(req, 'company.read');
  res.json({ data: await db.tenant.findUniqueOrThrow({ where: { id: tid } }) });
});
foundation.patch('/tenants/current', async (req, res) => {
  const b = companySchema.parse(req.body);
  check(
    Number(b.monthlyStandardHours) > 0,
    400,
    'STANDARD_HOURS',
    'Monthly standard hours must be greater than zero',
  );
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tid } });
    const after = await tx.tenant.update({
      where: { id: tid },
      data: { ...b, logoUrl: b.logoUrl || null },
    });
    await audit(tx, req.ctx, 'company.updated', tid, {
      before: {
        legalName: before.legalName,
        displayName: before.displayName,
        monthlyStandardHours: before.monthlyStandardHours.toString(),
        allowSelfApproval: before.allowSelfApproval,
      },
      after: {
        legalName: after.legalName,
        displayName: after.displayName,
        monthlyStandardHours: after.monthlyStandardHours.toString(),
        allowSelfApproval: after.allowSelfApproval,
      },
    });
    return after;
  });
  res.json({ data });
});
foundation.get('/subscription', async (req, res) => {
  const tid = tenant(req, 'subscription.read');
  const s = await db.subscription.findUniqueOrThrow({
    where: { tenantId: tid },
    include: { plan: true },
  });
  const employees = await db.employee.count({ where: { tenantId: tid, active: true } }),
    users = await db.membership.count({ where: { tenantId: tid, active: true } });
  res.json({ data: { ...s, status: subscriptionState(s), usage: { employees, users } } });
});
foundation.post('/subscription/start-free', async (req, res) => {
  const tid = tenant(req, 'subscription.write');
  const data = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tid} FOR UPDATE`;
    const existing = await tx.subscription.findUnique({ where: { tenantId: tid } });
    if (existing) {
      check(
        existing.status === 'FREE',
        409,
        'SUBSCRIPTION_EXISTS',
        'An existing paid subscription cannot be replaced with Free',
      );
      return existing;
    }
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    check(plan.active, 503, 'FREE_UNAVAILABLE', 'Free registration is unavailable');
    const subscription = await tx.subscription.create({
      data: {
        tenantId: tid,
        planId: plan.id,
        status: 'FREE',
        employeeLimit: plan.employeeLimit,
        userLimit: plan.userLimit,
        features: plan.features!,
      },
    });
    await audit(tx, req.ctx, 'subscription.free_created', subscription.id);
    return subscription;
  });
  res.json({ data });
});
foundation.get('/dashboard', async (req, res) => {
  const tid = tenant(req, 'company.read');
  await entitlement(db, tid);
  const ownOnly = !req.ctx.permissions.has('employees.read'),
    employeeFilter = ownOnly ? { id: req.ctx.employeeId || 'none' } : {};
  const scope = { tenantId: tid, ...employeeFilter };
  const [total, active, members, departments] = await Promise.all([
    db.employee.count({ where: scope }),
    db.employee.count({ where: { ...scope, active: true } }),
    db.membership.count({ where: { tenantId: tid, active: true } }),
    db.department.findMany({
      where: { tenantId: tid },
      select: {
        name: true,
        _count: { select: { employees: { where: { active: true, ...employeeFilter } } } },
      },
    }),
  ]);
  const sub = await db.subscription.findUniqueOrThrow({
    where: { tenantId: tid },
    include: { plan: { select: { name: true } } },
  });
  const approvalWhere = (permission: string) => ({
    tenantId: tid,
    status: 'PENDING',
    ...(!req.ctx.permissions.has(permission) ? { id: 'none' } : {}),
    ...(req.ctx.approvalScopes[permission] === 'TEAM'
      ? { employee: { managerId: req.ctx.employeeId || 'none' } }
      : {}),
    ...(!req.ctx.employeeId ? {} : { employeeId: { not: req.ctx.employeeId } }),
    submittedBy: { not: req.ctx.userId },
  });
  const today = await companyToday(db, tid),
    subjects = ownOnly ? { employeeId: req.ctx.employeeId || 'none' } : {};
  const [
    leaveApprovals,
    timeApprovals,
    overtimeApprovals,
    onLeave,
    timesheets,
    overtime,
    payrollStates,
    payrollTotals,
  ] = await Promise.all([
    db.leaveRequest.count({ where: approvalWhere('leave.approve') }),
    db.timesheet.count({ where: approvalWhere('timesheets.approve') }),
    db.overtime.count({ where: approvalWhere('overtime.approve') }),
    db.leaveRequest.findMany({
      where: {
        tenantId: tid,
        status: 'APPROVED',
        startDate: { lte: today },
        endDate: { gte: today },
        ...subjects,
      },
      select: { employeeId: true },
      distinct: ['employeeId'],
    }),
    db.timesheet.groupBy({ by: ['status'], where: { tenantId: tid, ...subjects }, _count: true }),
    db.overtime.groupBy({
      by: ['status'],
      where: { tenantId: tid, ...subjects },
      _count: true,
      _sum: { hours: true },
    }),
    req.ctx.permissions.has('payroll.read')
      ? db.payrollRun.groupBy({ by: ['status'], where: { tenantId: tid }, _count: true })
      : Promise.resolve([]),
    req.ctx.permissions.has('payroll.read')
      ? db.payrollSnapshot.aggregate({
          where: {
            tenantId: tid,
            run: {
              status: { in: ['APPROVED', 'LOCKED'] },
              payDate: {
                gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
                lte: today,
              },
            },
          },
          _sum: { gross: true, net: true, deductions: true, employerContributions: true },
        })
      : Promise.resolve(null),
  ]);
  const approvals = leaveApprovals + timeApprovals + overtimeApprovals;
  const events =
    req.ctx.permissions.has('audit.read') &&
    Array.isArray(sub.features) &&
    sub.features.includes('audit')
      ? await db.auditEvent.findMany({
          where: { tenantId: tid },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, action: true, createdAt: true },
        })
      : [];
  res.json({
    data: {
      totalEmployees: total,
      activeEmployees: active,
      employeesOnLeave: onLeave.length,
      timesheetStates: timesheets.map((t) => ({ status: t.status, count: t._count })),
      overtimeStates: overtime.map((t) => ({
        status: t.status,
        count: t._count,
        hours: t._sum.hours?.toString() || '0',
      })),
      payrollStates: payrollStates.map((t) => ({ status: t.status, count: t._count })),
      payrollMonthTotals: payrollTotals
        ? Object.fromEntries(
            Object.entries(payrollTotals._sum).map(([key, value]) => [
              key,
              value?.toString() || '0',
            ]),
          )
        : null,
      activeUsers: members,
      pendingApprovals: approvals,
      departments: departments.map((d) => ({ name: d.name, employees: d._count.employees })),
      subscription: {
        name: sub.plan.name,
        status: subscriptionState(sub),
        employeeLimit: sub.employeeLimit,
        userLimit: sub.userLimit,
      },
      recentActivity: events,
    },
  });
});
foundation.get('/audit', async (req, res) => {
  const tid = tenant(req, 'audit.read');
  await entitlement(db, tid, 'audit');
  const where = { tenantId: tid };
  res.json({
    data: await db.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pagination(req),
    }),
    total: await db.auditEvent.count({ where }),
  });
});
foundation.patch('/roles/:id', async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(64),
      permissions: z.array(z.string().max(100)).max(100),
      approvalScope: z.enum(['TEAM', 'TENANT']).optional(),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'users.write', undefined, async (tx, tid) => {
    const role = await tx.role.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(role, 404, 'NOT_FOUND', 'Role not found');
    check(
      role.name !== 'COMPANY_ADMIN',
      400,
      'PROTECTED_ROLE',
      'Company Admin is a protected recovery role',
    );
    const valid = await tx.permission.count({ where: { code: { in: b.permissions } } });
    check(
      valid === new Set(b.permissions).size,
      400,
      'INVALID_PERMISSION',
      'An unknown permission was supplied',
    );
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({
      data: b.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })),
    });
    const updated = await tx.role.update({
      where: { id: role.id },
      data: { name: b.name, approvalScope: b.approvalScope || role.approvalScope },
    });
    await audit(tx, req.ctx, 'role.updated', role.id, {
      permissions: b.permissions,
      name: b.name,
      approvalScope: b.approvalScope || role.approvalScope,
    });
    return updated;
  });
  res.json({ data });
});

foundation.post('/roles', async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(64),
      permissions: z.array(z.string().max(100)).max(100),
      approvalScope: z.enum(['TEAM', 'TENANT']).default('TEAM'),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'users.write', undefined, async (tx, tid) => {
    const codes = [...new Set(b.permissions)];
    check(
      (await tx.permission.count({ where: { code: { in: codes } } })) === codes.length,
      422,
      'INVALID_PERMISSION',
      'An unknown permission was supplied',
    );
    const role = await tx.role.create({
      data: {
        tenantId: tid,
        name: b.name,
        approvalScope: b.approvalScope,
        permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
      },
    });
    await audit(tx, req.ctx, 'role.created', role.id, { ...b });
    return role;
  });
  res.status(201).json({ data });
});
foundation.get('/permissions', async (req, res) => {
  tenant(req, 'users.write');
  res.json({ data: await db.permission.findMany({ orderBy: { code: 'asc' } }) });
});
