import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type Employee } from '@prisma/client';
import { employeeSchema, type EmployeeInput } from '../../../packages/types/src/index.js';
import {
  db,
  tenant,
  writeTenant,
  entitlement,
  check,
  encrypt,
  decrypt,
  day,
  audit,
  employeeScope,
  pagination,
  companyToday,
  type Tx,
  type Context,
} from './core.js';
export const employees = Router();
export async function compensationAt(tx: Tx, e: Employee, date: Date) {
  return (
    (await tx.compensationHistory.findFirst({
      where: { tenantId: e.tenantId, employeeId: e.id, effectiveDate: { lte: date } },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    })) || e
  );
}
export async function employeeDto(tx: Tx, ctx: Context, e: Employee) {
  const terms = await compensationAt(tx, e, await companyToday(tx, e.tenantId));
  const own = ctx.employeeId === e.id,
    sensitive = ctx.permissions.has('employees.sensitive') || own,
    compensation = ctx.permissions.has('compensation.read') || own;
  const { sensitiveCipher, basePay: _basePay, ...publicData } = e;
  const bank = sensitive
    ? await tx.employeeBankAccount.findUnique({
        where: { tenantId_employeeId: { tenantId: e.tenantId, employeeId: e.id } },
      })
    : null;
  return {
    ...publicData,
    frequency: terms.frequency,
    payType: terms.payType,
    standardHours: terms.standardHours,
    basePay: compensation ? terms.basePay.toString() : undefined,
    sensitive:
      sensitive && sensitiveCipher ? decrypt<Record<string, string>>(sensitiveCipher) : undefined,
    bank: bank
      ? { bankName: bank.bankName, bankAccount: decrypt<string>(bank.accountCipher) }
      : undefined,
  };
}
async function validateReferences(tx: Tx, tid: string, b: EmployeeInput, id?: string) {
  if (b.scheduleId) {
    const schedule = await tx.referenceData.findFirst({
      where: { id: b.scheduleId, tenantId: tid, category: 'SCHEDULE', active: true },
    });
    check(schedule, 422, 'INVALID_SCHEDULE', 'Choose a work schedule in this company');
  }
  if (b.departmentId)
    check(
      await tx.department.findUnique({
        where: { tenantId_id: { tenantId: tid, id: b.departmentId } },
      }),
      400,
      'INVALID_DEPARTMENT',
      'Select a department in this company',
    );
  if (b.managerId) {
    check(b.managerId !== id, 400, 'MANAGER_CYCLE', 'An employee cannot supervise themselves');
    let current: string | null = b.managerId;
    const visited = new Set<string>();
    while (current) {
      check(
        !visited.has(current) && current !== id,
        400,
        'MANAGER_CYCLE',
        'This supervisor assignment would create a cycle',
      );
      visited.add(current);
      check(visited.size <= 500, 400, 'MANAGER_DEPTH', 'Supervisor hierarchy is too deep');
      const manager = await employeeScope(tx, tid, current);
      check(manager.active, 400, 'INACTIVE_MANAGER', 'Supervisor must be active');
      current = manager.managerId;
    }
  }
  for (const [category, name] of [
    ['POSITION', b.position],
    ['BRANCH', b.branch],
    ['PARISH', b.parish],
    ['EMPLOYMENT_TYPE', b.employmentType],
  ] as const)
    if (name)
      check(
        await tx.referenceData.findUnique({
          where: { tenantId_category_name: { tenantId: tid, category, name } },
        }),
        400,
        'INVALID_REFERENCE',
        `Configure ${category.toLowerCase()} '${name}' in company master data first`,
      );
}
export async function saveEmployee(tx: Tx, ctx: Context, b: EmployeeInput, id?: string) {
  const tid = ctx.tenantId!;
  const current = id ? await employeeScope(tx, tid, id) : null;
  await validateReferences(tx, tid, b, id);
  if (current) {
    check(
      b.version === current.version,
      409,
      'STALE_VERSION',
      'This employee changed. Reload before saving.',
    );
  }
  if (b.active && (!current || !current.active)) {
    const s = await tx.subscription.findUniqueOrThrow({ where: { tenantId: tid } });
    check(
      (await tx.employee.count({ where: { tenantId: tid, active: true } })) < s.employeeLimit,
      409,
      'EMPLOYEE_LIMIT',
      'Active-employee capacity reached. Deactivate an employee or arrange an upgrade.',
    );
  }
  const company = await tx.tenant.findUniqueOrThrow({ where: { id: tid } });
  check(Number(b.standardHours) > 0, 422, 'STANDARD_HOURS', 'Standard hours must be positive');
  check(
    b.payType !== 'HOURLY' || b.frequency !== 'MONTHLY',
    422,
    'MONTHLY_PAY_TYPE',
    'Monthly payroll requires contractual salary compensation',
  );
  check(
    !b.terminationDate || b.terminationDate >= b.hireDate,
    422,
    'EMPLOYMENT_DATES',
    'Termination must not precede hire date',
  );
  const termsChanged =
    !current ||
    (ctx.permissions.has('compensation.write') && !current.compensationConfigured) ||
    ['frequency', 'payType', 'basePay', 'standardHours'].some(
      (key) => String(b[key as keyof EmployeeInput]) !== String(current[key as keyof Employee]),
    );
  if (termsChanged)
    check(
      ctx.permissions.has('compensation.write') || (!current && b.basePay === '0'),
      403,
      'COMPENSATION_DENIED',
      'Compensation changes require compensation.write',
    );
  if (b.sensitive)
    check(
      ctx.permissions.has('employees.sensitive'),
      403,
      'SENSITIVE_DENIED',
      'Sensitive identity/bank updates require permission',
    );
  const today = await companyToday(tx, tid);
  const effectiveDate = day(
    b.effectiveDate || (current ? today.toISOString().slice(0, 10) : b.hireDate),
  );
  if (current && termsChanged)
    check(
      effectiveDate >= today,
      422,
      'COMPENSATION_EFFECTIVE_DATE',
      'Compensation changes must apply prospectively',
    );
  const scalar: Prisma.EmployeeUncheckedCreateInput = {
    tenantId: tid,
    employeeNumber: b.employeeNumber,
    firstName: b.firstName,
    lastName: b.lastName,
    email: b.email || null,
    phone: b.phone,
    address: b.address,
    parish: b.parish,
    gender: b.gender,
    dateOfBirth: b.dateOfBirth ? day(b.dateOfBirth) : null,
    departmentId: b.departmentId || null,
    scheduleId: b.scheduleId || null,
    position: b.position,
    branch: b.branch,
    employmentType: b.employmentType,
    managerId: b.managerId || null,
    hireDate: day(b.hireDate),
    probationDate: b.probationDate ? day(b.probationDate) : null,
    confirmationDate: b.confirmationDate ? day(b.confirmationDate) : null,
    terminationDate: b.terminationDate ? day(b.terminationDate) : null,
    frequency: b.frequency,
    payType: b.payType,
    basePay: b.basePay,
    standardHours: b.frequency === 'MONTHLY' ? company.monthlyStandardHours : b.standardHours,
    overtimeEligible: b.overtimeEligible,
    compensationConfigured:
      ctx.permissions.has('compensation.write') || Boolean(current?.compensationConfigured),
    active: b.active,
  };
  if (b.sensitive) {
    const { bankName: _bankName, bankAccount: _bankAccount, ...identity } = b.sensitive;
    scalar.sensitiveCipher = encrypt({
      ...(current?.sensitiveCipher ? decrypt<Record<string, string>>(current.sensitiveCipher) : {}),
      ...identity,
    });
  }
  if (current && termsChanged && effectiveDate > today) {
    scalar.frequency = current.frequency;
    scalar.payType = current.payType;
    scalar.basePay = current.basePay;
    scalar.standardHours = current.standardHours;
  }
  const employee = current
    ? await tx.employee.update({
        where: { id: current.id },
        data: { ...scalar, version: { increment: 1 } },
      })
    : await tx.employee.create({ data: scalar });
  if (termsChanged)
    await tx.compensationHistory.create({
      data: {
        tenantId: tid,
        employeeId: employee.id,
        effectiveDate,
        basePay: b.basePay,
        frequency: b.frequency,
        payType: b.payType,
        standardHours: b.frequency === 'MONTHLY' ? company.monthlyStandardHours : b.standardHours,
        reason: b.reason,
        actorId: ctx.userId,
      },
    });
  if (
    b.sensitive &&
    (b.sensitive.bankAccount !== undefined || b.sensitive.bankName !== undefined)
  ) {
    const before = await tx.employeeBankAccount.findUnique({
      where: { tenantId_employeeId: { tenantId: tid, employeeId: employee.id } },
    });
    const account =
      b.sensitive.bankAccount !== undefined
        ? encrypt(b.sensitive.bankAccount)
        : before?.accountCipher;
    if (account)
      await tx.employeeBankAccount.upsert({
        where: { tenantId_employeeId: { tenantId: tid, employeeId: employee.id } },
        create: {
          tenantId: tid,
          employeeId: employee.id,
          bankName: b.sensitive.bankName ?? before?.bankName ?? '',
          accountCipher: account,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
        update: {
          bankName: b.sensitive.bankName ?? before?.bankName ?? '',
          accountCipher: account,
          updatedBy: ctx.userId,
        },
      });
  }
  if (b.emergencyContacts) {
    await tx.emergencyContact.deleteMany({ where: { tenantId: tid, employeeId: employee.id } });
    await tx.emergencyContact.createMany({
      data: b.emergencyContacts.map((contact) => ({
        tenantId: tid,
        employeeId: employee.id,
        ...contact,
      })),
    });
  }
  await audit(tx, ctx, current ? 'employee.updated' : 'employee.created', employee.id, {
    reason: b.reason,
    before: current
      ? {
          employeeNumber: current.employeeNumber,
          firstName: current.firstName,
          lastName: current.lastName,
          active: current.active,
          frequency: current.frequency,
          version: current.version,
        }
      : null,
    after: {
      employeeNumber: employee.employeeNumber,
      firstName: employee.firstName,
      lastName: employee.lastName,
      active: employee.active,
      frequency: employee.frequency,
      version: employee.version,
    },
    compensationChanged: termsChanged,
    sensitiveChanged: Boolean(b.sensitive),
  });
  return employee;
}
export function mergeEmployee(current: Employee, raw: Record<string, unknown>): EmployeeInput {
  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);
  const base = {
    employeeNumber: current.employeeNumber,
    firstName: current.firstName,
    lastName: current.lastName,
    email: current.email || '',
    phone: current.phone || '',
    address: current.address || '',
    parish: current.parish || '',
    gender: current.gender || '',
    dateOfBirth: date(current.dateOfBirth),
    departmentId: current.departmentId,
    scheduleId: current.scheduleId,
    position: current.position || '',
    branch: current.branch || '',
    employmentType: current.employmentType,
    managerId: current.managerId,
    hireDate: date(current.hireDate),
    probationDate: date(current.probationDate),
    confirmationDate: date(current.confirmationDate),
    terminationDate: date(current.terminationDate),
    frequency: current.frequency,
    payType: current.payType,
    basePay: current.basePay.toString(),
    standardHours: current.standardHours.toString(),
    overtimeEligible: current.overtimeEligible,
    active: current.active,
    version: current.version,
  };
  return employeeSchema.parse({ ...base, ...raw });
}
employees.get('/employees', async (req, res) => {
  const tid = tenant(req, 'employees.read');
  await entitlement(db, tid, 'employees');
  const search = String(req.query.search || '').slice(0, 100),
    where: Prisma.EmployeeWhereInput = {
      tenantId: tid,
      ...(req.query.active ? { active: req.query.active === 'true' } : {}),
      ...(req.query.departmentId ? { departmentId: String(req.query.departmentId) } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
              { employeeNumber: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    };
  const sort = ['employeeNumber', 'firstName', 'lastName', 'hireDate'].includes(
    String(req.query.sort),
  )
    ? String(req.query.sort)
    : 'lastName';
  const records = await db.employee.findMany({
    where,
    orderBy: { [sort]: req.query.order === 'desc' ? 'desc' : 'asc' },
    include: { department: true },
    ...pagination(req),
  });
  res.json({
    data: {
      items: await Promise.all(
        records.map((e) =>
          employeeDto(db, req.ctx, e).then((d) => ({ ...d, department: e.department })),
        ),
      ),
      total: await db.employee.count({ where }),
    },
  });
});
employees.get('/employees/choices', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'employees');
  const any =
    req.ctx.permissions.has('employees.read') ||
    ['leave', 'timesheets', 'overtime'].some((kind) =>
      req.ctx.permissions.has(kind + '.submit.any'),
    ) ||
    req.ctx.permissions.has('payslips.print.any');
  const records = await db.employee.findMany({
    where: { tenantId: tid, active: true, ...(!any ? { id: req.ctx.employeeId || 'none' } : {}) },
    orderBy: { lastName: 'asc' },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      frequency: true,
      overtimeEligible: true,
    },
    take: 1000,
  });
  res.json({ data: records });
});
employees.get('/employees/me', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'employees');
  check(
    req.ctx.employeeId,
    404,
    'NO_EMPLOYEE_LINK',
    'Your user account is not linked to an employee. Ask your company administrator.',
  );
  const e = await employeeScope(db, tid, req.ctx.employeeId);
  res.json({
    data: {
      ...(await employeeDto(db, req.ctx, e)),
      emergencyContacts: await db.emergencyContact.findMany({
        where: { tenantId: tid, employeeId: e.id },
      }),
    },
  });
});
employees.get('/employees/:id', async (req, res) => {
  const tid = tenant(req);
  const id = String(req.params.id);
  check(
    req.ctx.permissions.has('employees.read') || req.ctx.employeeId === id,
    403,
    'PERMISSION_DENIED',
    'You cannot view this profile',
  );
  await entitlement(db, tid, 'employees');
  const e = await employeeScope(db, tid, id);
  res.json({
    data: {
      ...(await employeeDto(db, req.ctx, e)),
      emergencyContacts:
        req.ctx.permissions.has('employees.sensitive') || req.ctx.employeeId === id
          ? await db.emergencyContact.findMany({ where: { tenantId: tid, employeeId: id } })
          : undefined,
    },
  });
});
employees.get('/employees/:id/compensation', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid, 'employees');
  const id = String(req.params.id);
  check(
    req.ctx.permissions.has('compensation.read') || req.ctx.employeeId === id,
    403,
    'PERMISSION_DENIED',
    'Compensation history is restricted',
  );
  await employeeScope(db, tid, id);
  res.json({
    data: await db.compensationHistory.findMany({
      where: { tenantId: tid, employeeId: id },
      orderBy: { effectiveDate: 'desc' },
    }),
  });
});
employees.post('/employees', async (req, res) => {
  const b = employeeSchema.parse(req.body);
  const data = await writeTenant(req, 'employees.write', 'employees', (tx) =>
    saveEmployee(tx, req.ctx, b),
  );
  res.status(201).json({ data: await employeeDto(db, req.ctx, data) });
});
employees.patch('/employees/:id', async (req, res) => {
  const raw = z.record(z.string(), z.unknown()).parse(req.body);
  const data = await writeTenant(req, 'employees.write', 'employees', async (tx, tid) => {
    const current = await employeeScope(tx, tid, String(req.params.id));
    return saveEmployee(tx, req.ctx, mergeEmployee(current, raw), current.id);
  });
  res.json({ data: await employeeDto(db, req.ctx, data) });
});
employees.post('/employees/:id/compensation', async (req, res) => {
  const b = importCompensationSchema.parse(req.body);
  const data = await writeTenant(req, 'compensation.write', 'employees', async (tx, tid) => {
    const e = await employeeScope(tx, tid, String(req.params.id));
    return saveEmployee(tx, req.ctx, mergeEmployee(e, b), e.id);
  });
  res.json({ data: await employeeDto(db, req.ctx, data) });
});
const importCompensationSchema = z
  .object({
    basePay: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']),
    payType: z.enum(['SALARY', 'HOURLY']),
    standardHours: z.string().regex(/^\d+(\.\d{1,2})?$/),
    effectiveDate: z.iso.date(),
    reason: z.string().min(3).max(2000),
    version: z.number().int().positive(),
  })
  .strict();
