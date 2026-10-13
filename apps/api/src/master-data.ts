import { proposeConfiguration } from './configuration-review.js';
import { Router } from 'express';
import { z } from 'zod';
import { db, tenant, writeTenant, audit, check, day, entitlement, type Tx } from './core.js';
export const masterData = Router();
export async function initializeMasterData(tx: Tx, tenantId: string) {
  for (const [category, name, configuration] of [
    ['SCHEDULE', 'Standard', { weekdays: [1, 2, 3, 4, 5] }],
    ['SHIFT', 'Day', { maxHours: '16.00' }],
    ['OVERTIME', 'Standard', { multiplier: '1.00' }],
    ['EMPLOYMENT_TYPE', 'Permanent', {}],
    ['EMPLOYMENT_TYPE', 'Contract', {}],
    ['EMPLOYMENT_TYPE', 'Temporary', {}],
  ] as const)
    await tx.referenceData.upsert({
      where: { tenantId_category_name: { tenantId, category, name } },
      update: {},
      create: { tenantId, category, name, configuration },
    });
  for (const name of [
    'Kingston',
    'St. Andrew',
    'St. Thomas',
    'Portland',
    'St. Mary',
    'St. Ann',
    'Trelawny',
    'St. James',
    'Hanover',
    'Westmoreland',
    'St. Elizabeth',
    'Manchester',
    'Clarendon',
    'St. Catherine',
  ])
    await tx.referenceData.upsert({
      where: { tenantId_category_name: { tenantId, category: 'PARISH', name } },
      update: {},
      create: { tenantId, category: 'PARISH', name },
    });
}
masterData.get('/reference-data', async (req, res) => {
  const tid = tenant(req, 'company.read');
  await entitlement(db, tid);
  const [departments, references, holidays, leaveTypes] = await Promise.all([
    db.department.findMany({ where: { tenantId: tid }, orderBy: { name: 'asc' } }),
    db.referenceData.findMany({
      where: { tenantId: tid },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    db.holiday.findMany({ where: { tenantId: tid }, orderBy: { date: 'asc' } }),
    db.leaveType.findMany({ where: { tenantId: tid }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ data: { departments, references, holidays, leaveTypes } });
});
masterData.post('/departments', async (req, res) => {
  const b = z
    .object({ name: z.string().trim().min(1).max(100) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const d = await tx.department.create({ data: { tenantId: tid, ...b } });
    await audit(tx, req.ctx, 'department.created', d.id, b);
    return d;
  });
  res.status(201).json({ data });
});
masterData.patch('/departments/:id', async (req, res) => {
  const b = z
    .object({ name: z.string().trim().min(1).max(100) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const d = await tx.department.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(d, 404, 'NOT_FOUND', 'Department not found');
    const after = await tx.department.update({ where: { id: d.id }, data: b });
    await audit(tx, req.ctx, 'department.updated', d.id, { before: d.name, after: b.name });
    return after;
  });
  res.json({ data });
});
masterData.post('/reference-data', async (req, res) => {
  const input = z
    .object({
      category: z.enum([
        'BRANCH',
        'POSITION',
        'EMPLOYMENT_TYPE',
        'SHIFT',
        'OVERTIME',
        'SCHEDULE',
        'PARISH',
        'ALLOWANCE',
        'DEDUCTION',
      ]),
      name: z.string().trim().min(1).max(100),
      configuration: z.record(z.string(), z.unknown()).default({}),
      active: z.boolean().default(true),
      reason: z.string().min(3).max(2000).optional(),
      effectiveDate: z.iso.date().optional(),
    })
    .strict()
    .parse(req.body);
  const { reason, effectiveDate, ...b } = input;
  if (b.category === 'OVERTIME')
    check(
      typeof b.configuration.multiplier === 'string' &&
        /^\d+(\.\d{1,2})?$/.test(b.configuration.multiplier) &&
        Number(b.configuration.multiplier) > 0 &&
        Number(b.configuration.multiplier) <= 10,
      422,
      'OVERTIME_MULTIPLIER',
      'Set a multiplier greater than zero and at most ten',
    );
  if (b.category === 'SHIFT')
    check(
      typeof b.configuration.maxHours === 'string' &&
        Number(b.configuration.maxHours) > 0 &&
        Number(b.configuration.maxHours) <= 24,
      422,
      'SHIFT_HOURS',
      'Set maximum shift hours between zero and 24',
    );
  if (b.category === 'SCHEDULE')
    check(
      Array.isArray(b.configuration.weekdays) &&
        b.configuration.weekdays.length > 0 &&
        b.configuration.weekdays.every(
          (d) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6,
        ),
      422,
      'SCHEDULE_DAYS',
      'Configure working weekdays as 0 (Sunday) through 6 (Saturday)',
    );
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const before = await tx.referenceData.findUnique({
      where: { tenantId_category_name: { tenantId: tid, category: b.category, name: b.name } },
    });
    if (['OVERTIME', 'ALLOWANCE', 'DEDUCTION', 'SHIFT', 'SCHEDULE'].includes(b.category))
      return proposeConfiguration(
        tx,
        req.ctx,
        'REFERENCE_' + b.category,
        b.name,
        b as import('@prisma/client').Prisma.InputJsonObject,
        before
          ? {
              category: before.category,
              name: before.name,
              configuration: before.configuration || {},
              active: before.active,
            }
          : {},
        reason,
        effectiveDate,
      );
    const d = await tx.referenceData.upsert({
      where: { tenantId_category_name: { tenantId: tid, category: b.category, name: b.name } },
      create: {
        tenantId: tid,
        ...b,
        configuration: b.configuration as import('@prisma/client').Prisma.InputJsonObject,
      },
      update: {
        configuration: b.configuration as import('@prisma/client').Prisma.InputJsonObject,
        active: b.active,
      },
    });
    await audit(tx, req.ctx, 'reference.configured', d.id, {
      category: b.category,
      name: b.name,
      before: before?.configuration || {},
      after: b.configuration as import('@prisma/client').Prisma.InputJsonObject,
      active: b.active,
    });
    return d;
  });
  res.json({ data });
});
masterData.post('/holidays', async (req, res) => {
  const b = z
    .object({ date: z.iso.date(), name: z.string().trim().min(1).max(100) })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const date = day(b.date);
    const h = await tx.holiday.upsert({
      where: { tenantId_date: { tenantId: tid, date } },
      create: { tenantId: tid, date, name: b.name },
      update: { name: b.name },
    });
    await audit(tx, req.ctx, 'holiday.configured', h.id, b);
    return h;
  });
  res.json({ data });
});
masterData.post('/leave-types', async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(64),
      paidFraction: z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/),
      annualDays: z.string().regex(/^\d+(\.\d{1,2})?$/),
      carryForwardDays: z.string().regex(/^\d+(\.\d{1,2})?$/),
      reason: z.string().min(3).max(2000).optional(),
      effectiveDate: z.iso.date().optional(),
    })
    .strict()
    .parse(req.body);
  const { reason, effectiveDate, ...b } = input;
  check(
    Number(b.annualDays) <= 366 && Number(b.carryForwardDays) <= 366,
    422,
    'LEAVE_POLICY',
    'Leave policy values may not exceed 366 days',
  );
  const data = await writeTenant(req, 'company.write', undefined, async (tx, tid) => {
    const before = await tx.leaveType.findUnique({
      where: { tenantId_name: { tenantId: tid, name: b.name } },
    });
    return proposeConfiguration(
      tx,
      req.ctx,
      'LEAVE_POLICY',
      b.name,
      b,
      before
        ? {
            name: before.name,
            paidFraction: before.paidFraction.toString(),
            annualDays: before.annualDays.toString(),
            carryForwardDays: before.carryForwardDays.toString(),
          }
        : {},
      reason,
      effectiveDate,
    );
  });
  res.json({ data });
});
