import { Router } from 'express';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';
import {
  db,
  tenant,
  entitlement,
  audit,
  check,
  day,
  jobs,
  refreshTenantActor,
  loadTenantActor,
  hash,
  type Context,
  type Tx,
  ApiError,
} from './core.js';
import { storePrivate, readPrivate } from './storage.js';
import type { PayrollResult } from '../../../packages/payroll-engine/src/index.js';
export const reports = Router();
export const csvCell = (value: unknown) =>
  '"' +
  String(value ?? '')
    .replace(/^[=+\-@\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
const typeSchema = z.enum([
  'employees',
  'leave',
  'timesheets',
  'overtime',
  'payroll',
  'statutory',
  'department-payroll',
  'deductions',
  'payroll-history',
]);
const filterSchema = z
  .object({ startDate: z.iso.date().optional(), endDate: z.iso.date().optional() })
  .strict()
  .refine(
    (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate,
    'End date must follow start date',
  );
type Filters = z.infer<typeof filterSchema>;
type Row = Record<string, unknown>;
async function authorize(tx: Tx, ctx: Context, type: string) {
  check(
    ctx.tenantId && ctx.permissions.has('reports.read'),
    403,
    'PERMISSION_DENIED',
    'Report access is restricted',
  );
  await entitlement(tx, ctx.tenantId, 'reports');
  if (
    ['payroll', 'statutory', 'department-payroll', 'deductions', 'payroll-history'].includes(type)
  ) {
    check(
      ctx.permissions.has('payroll.read'),
      403,
      'PERMISSION_DENIED',
      'Payroll reporting is restricted',
    );
    await entitlement(tx, ctx.tenantId, 'payroll');
  } else if (type === 'overtime') await entitlement(tx, ctx.tenantId, 'overtime');
}
async function sourceRows(
  tx: Tx,
  ctx: Context,
  type: string,
  filters: Filters,
  skip: number,
  take: number,
): Promise<{ count: number; rows: Row[] }> {
  const tid = ctx.tenantId!,
    range = {
      ...(filters.startDate ? { gte: day(filters.startDate) } : {}),
      ...(filters.endDate ? { lte: day(filters.endDate) } : {}),
    };
  if (type === 'employees') {
    const records = await tx.employee.findMany({
      where: { tenantId: tid, ...(Object.keys(range).length ? { hireDate: range } : {}) },
      include: { department: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    });
    return {
      count: records.length,
      rows: records.map((e) => ({
        employeeNumber: e.employeeNumber,
        name: e.firstName + ' ' + e.lastName,
        email: e.email,
        department: e.department?.name || '',
        frequency: e.frequency,
        active: e.active,
        hireDate: e.hireDate.toISOString().slice(0, 10),
        ...(ctx.permissions.has('compensation.read') ? { basePay: e.basePay.toString() } : {}),
      })),
    };
  }
  if (type === 'leave') {
    const records = await tx.leaveRequest.findMany({
      where: { tenantId: tid, ...(Object.keys(range).length ? { startDate: range } : {}) },
      include: { employee: true, leaveType: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    });
    return {
      count: records.length,
      rows: records.map((r) => ({
        employeeNumber: r.employee.employeeNumber,
        name: r.employee.firstName + ' ' + r.employee.lastName,
        leaveType: r.leaveType.name,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        days: r.days.toString(),
        status: r.status,
        submittedBy: r.submittedBy,
      })),
    };
  }
  if (type === 'timesheets') {
    const records = await tx.timesheet.findMany({
      where: { tenantId: tid, ...(Object.keys(range).length ? { workDate: range } : {}) },
      include: { employee: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    });
    return {
      count: records.length,
      rows: records.map((r) => ({
        employeeNumber: r.employee.employeeNumber,
        name: r.employee.firstName + ' ' + r.employee.lastName,
        workDate: r.workDate.toISOString().slice(0, 10),
        hours: r.hours.toString(),
        shift: r.shift,
        status: r.status,
        submittedBy: r.submittedBy,
      })),
    };
  }
  if (type === 'overtime') {
    const records = await tx.overtime.findMany({
      where: { tenantId: tid, ...(Object.keys(range).length ? { workDate: range } : {}) },
      include: { employee: true },
      orderBy: { id: 'asc' },
      skip,
      take,
    });
    return {
      count: records.length,
      rows: records.map((r) => ({
        employeeNumber: r.employee.employeeNumber,
        name: r.employee.firstName + ' ' + r.employee.lastName,
        workDate: r.workDate.toISOString().slice(0, 10),
        hours: r.hours.toString(),
        multiplier: r.multiplier.toString(),
        status: r.status,
      })),
    };
  }
  if (type === 'payroll-history') {
    const records = await tx.auditEvent.findMany({
      where: {
        tenantId: tid,
        action: { in: ['payslip.downloaded', 'payslip.print_requested', 'payroll.bank_exported'] },
        ...(Object.keys(range).length
          ? {
              createdAt: {
                ...(range.gte ? { gte: range.gte } : {}),
                ...(range.lte ? { lt: new Date(range.lte.getTime() + 86400000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      skip,
      take,
    });
    return {
      count: records.length,
      rows: records.map((r) => ({
        action: r.action,
        actor: r.actorId,
        target: r.entityId,
        time: r.createdAt.toISOString(),
        details: JSON.stringify(r.details),
      })),
    };
  }
  const records = await tx.payrollSnapshot.findMany({
    where: {
      tenantId: tid,
      run: {
        status: { in: ['APPROVED', 'LOCKED', 'REVERSED'] },
        ...(Object.keys(range).length ? { payDate: range } : {}),
      },
    },
    include: { run: true },
    orderBy: { id: 'asc' },
    skip,
    take,
  });
  const rows = records.flatMap<Row>((r) => {
    const saved = r.snapshot as unknown as {
      employee: { employeeNumber: string; name: string; departmentName: string };
      result: PayrollResult;
      rule: { id: string; name: string };
    };
    const identity = {
      employeeNumber: saved.employee.employeeNumber,
      name: saved.employee.name,
      department: saved.employee.departmentName,
      runId: r.runId,
      payDate: r.run.payDate.toISOString().slice(0, 10),
      periodStart: r.run.startDate.toISOString().slice(0, 10),
      periodEnd: r.run.endDate.toISOString().slice(0, 10),
      runStatus: r.run.status,
      currency: saved.result.currency,
      complianceMode: saved.result.complianceMode,
    };
    if (type === 'statutory')
      return saved.result.components.map((c) => ({
        ...identity,
        ruleVersion: saved.rule.id,
        component: c.code,
        base: c.base,
        employeeDeduction: c.employee,
        employerContribution: c.employer,
      }));
    if (type === 'deductions')
      return [
        ...saved.result.components.map((c) => ({
          ...identity,
          deduction: c.name,
          amount: c.employee,
        })),
        ...saved.result.personalDeductions.map((c) => ({
          ...identity,
          deduction: c.name,
          amount: c.amount,
        })),
      ];
    return [
      {
        ...identity,
        gross: r.gross.toString(),
        deductions: r.deductions.toString(),
        net: r.net.toString(),
        employerContributions: r.employerContributions.toString(),
      },
    ];
  });
  return { count: records.length, rows };
}
function finalize(rows: Row[], type: string) {
  if (type !== 'department-payroll') return rows;
  const groups = new Map<string, Row>();
  for (const row of rows) {
    const key = JSON.stringify([row.runId, row.department, row.currency, row.complianceMode]);
    const current = groups.get(key) || {
      runId: row.runId,
      payDate: row.payDate,
      department: row.department,
      runStatus: row.runStatus,
      currency: row.currency,
      complianceMode: row.complianceMode,
      employees: 0,
      gross: '0',
      deductions: '0',
      net: '0',
      employerContributions: '0',
    };
    current.employees = Number(current.employees) + 1;
    for (const field of ['gross', 'deductions', 'net', 'employerContributions'])
      current[field] = new Decimal(String(current[field])).plus(String(row[field])).toFixed(2);
    groups.set(key, current);
  }
  return [...groups.values()];
}
export async function renderReport(
  company: string,
  type: string,
  format: string,
  rows: Row[],
): Promise<Buffer> {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (format === 'csv')
    return Buffer.from(
      headers.map(csvCell).join(',') +
        '\n' +
        rows.map((row) => headers.map((key) => csvCell(row[key])).join(',')).join('\n'),
    );
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Report');
    sheet.addRow([company]);
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(headers.map((key) => String(row[key] ?? ''))));
    sheet.columns.forEach((c) => (c.width = 24));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 35 }),
    chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.fontSize(18).text(company);
  pdf.fontSize(12).text('eQwik YardHRMS · ' + type + ' report');
  pdf.moveDown();
  pdf.fontSize(8).text(headers.join(' | '));
  rows.forEach((row) => {
    pdf.moveDown(0.6).text(headers.map((key) => String(row[key] ?? '')).join(' | '));
  });
  pdf.end();
  return finished;
}
const contentType = (format: string) =>
  format === 'csv'
    ? 'text/csv'
    : format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';
reports.get('/reports/:type', async (req, res) => {
  tenant(req, 'reports.read');
  const type = typeSchema.parse(req.params.type),
    format = z.enum(['json', 'csv', 'xlsx', 'pdf']).parse(req.query.format || 'json'),
    filters = filterSchema.parse({ startDate: req.query.startDate, endDate: req.query.endDate });
  await authorize(db, req.ctx, type);
  const source = await sourceRows(db, req.ctx, type, filters, 0, 1001);
  check(
    source.count <= 1000,
    409,
    'REPORT_TOO_LARGE',
    'Use background export or narrow the date range for more than 1,000 source records',
  );
  const company = await db.tenant.findUniqueOrThrow({ where: { id: req.ctx.tenantId! } }),
    rows = finalize(source.rows, type);
  await audit(db, req.ctx, 'report.exported', null, { type, format, rows: rows.length, filters });
  if (format === 'json') {
    res.json({ data: { company: company.displayName, type, rows } });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${type}.${format}"`);
  res.type(contentType(format)).send(await renderReport(company.displayName, type, format, rows));
});
reports.post('/report-jobs', async (req, res) => {
  const b = z
    .object({ type: typeSchema, format: z.enum(['csv', 'xlsx', 'pdf']), filters: filterSchema })
    .strict()
    .parse(req.body);
  const tid = tenant(req, 'reports.read');
  const data = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tid} FOR UPDATE`;
    await refreshTenantActor(tx, req, tid);
    await authorize(tx, req.ctx, b.type);
    const job = await tx.reportJob.create({
      data: { tenantId: tid, actorId: req.ctx.userId, ...b, filters: b.filters },
    });
    await audit(tx, req.ctx, 'report.queued', job.id, b);
    return job;
  });
  await jobs.add(
    'report',
    { jobId: data.id },
    {
      jobId: 'report-' + data.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
  res.status(202).json({ data });
});
reports.get('/report-jobs', async (req, res) => {
  const tid = tenant(req, 'reports.read');
  await entitlement(db, tid, 'reports');
  res.json({
    data: await db.reportJob.findMany({
      where: { tenantId: tid, actorId: req.ctx.userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  });
});
reports.get('/report-jobs/:id/download', async (req, res) => {
  const tid = tenant(req, 'reports.read');
  const job = await db.reportJob.findFirst({
    where: { id: String(req.params.id), tenantId: tid, actorId: req.ctx.userId },
    include: { file: true },
  });
  check(job, 404, 'NOT_FOUND', 'Report job not found');
  await authorize(db, req.ctx, job.type);
  check(
    job.status === 'COMPLETE' && job.file?.scanStatus === 'CLEAN',
    409,
    'REPORT_NOT_READY',
    'Report export is not ready',
  );
  await audit(db, req.ctx, 'report.downloaded', job.id, { type: job.type, format: job.format });
  res
    .type(contentType(job.format))
    .setHeader('Content-Disposition', `attachment; filename="${job.type}.${job.format}"`);
  res.send(await readPrivate(job.file.objectKey));
});
export async function processReport(jobId: string) {
  const job = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === 'COMPLETE') return;
  try {
    const ctx = await loadTenantActor(db, job.tenantId, job.actorId);
    await authorize(db, ctx, job.type);
    await db.reportJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', error: null },
    });
    let rows: Row[] = [],
      count = 0;
    for (;;) {
      const batch = await sourceRows(
        db,
        ctx,
        job.type,
        filterSchema.parse(job.filters),
        count,
        1000,
      );
      count += batch.count;
      check(count <= 50000, 422, 'REPORT_LIMIT', 'Narrow exports to at most 50,000 source records');
      check(
        job.format === 'csv' || count <= 10000,
        422,
        'REPORT_FORMAT_LIMIT',
        'Use CSV for background exports above 10,000 source records',
      );
      rows.push(...batch.rows);
      if (batch.count < 1000) break;
    }
    rows = finalize(rows, job.type);
    const company = await db.tenant.findUniqueOrThrow({ where: { id: job.tenantId } }),
      body = await renderReport(company.displayName, job.type, job.format, rows),
      key = job.tenantId + '/reports/' + job.id + '.' + job.format;
    await authorize(db, await loadTenantActor(db, job.tenantId, job.actorId), job.type);
    await storePrivate(key, body, contentType(job.format));
    await db.$transaction(async (tx) => {
      const file = await tx.privateFile.upsert({
        where: { objectKey: key },
        create: {
          tenantId: job.tenantId,
          objectKey: key,
          name: job.type + '.' + job.format,
          contentType: contentType(job.format),
          size: body.length,
          createdBy: job.actorId,
          scanStatus: 'CLEAN',
          kind: 'REPORT',
        },
        update: { size: body.length },
      });
      await tx.reportJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETE', fileId: file.id, completedAt: new Date() },
      });
      await audit(tx, ctx, 'report.generated', job.id, {
        type: job.type,
        format: job.format,
        rows: rows.length,
        checksum: hash(body.toString('base64')),
      });
    });
  } catch (error) {
    await db.reportJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        error:
          error instanceof ApiError
            ? error.message
            : 'Report generation failed; retry or contact support',
      },
    });
    throw error;
  }
}
export type ReportFilters = Prisma.InputJsonObject;
