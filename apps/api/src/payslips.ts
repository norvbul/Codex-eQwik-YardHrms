import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import {
  db,
  tenant,
  entitlement,
  check,
  audit,
  jobs,
  hash,
  decrypt,
  loadTenantActor,
  type Tx,
  type Context,
} from './core.js';
import { storePrivate, hasPrivate, readPrivate } from './storage.js';
import { csvCell } from './reports.js';
import type { PayrollResult } from '../../../packages/payroll-engine/src/index.js';
export const payslips = Router();
type SavedSnapshot = {
  employee: {
    id: string;
    employeeNumber: string;
    name: string;
    position: string | null;
    frequency: string;
  };
  company: { legalName: string; displayName: string };
  result: PayrollResult;
  approval: { approvedBy: string; approvedAt: string };
  rule: { id: string; name: string };
  paymentInstructions: { bankName: string; accountCipher: string } | null;
  inputs: { input: unknown };
};
async function authorizedSnapshot(tx: Tx, ctx: Context, snapshotId: string) {
  check(ctx.tenantId, 403, 'TENANT_REQUIRED', 'Select a company');
  const snapshot = await tx.payrollSnapshot.findUnique({
    where: { tenantId_id: { tenantId: ctx.tenantId, id: snapshotId } },
    include: { run: true, tenant: true },
  });
  check(snapshot, 404, 'NOT_FOUND', 'Payslip not found');
  check(
    ['APPROVED', 'LOCKED', 'REVERSED'].includes(snapshot.run.status),
    403,
    'PAYSLIP_NOT_APPROVED',
    'Payslips require approved payroll',
  );
  check(
    ctx.permissions.has('payslips.print.any') ||
      (ctx.permissions.has('payslips.read.self') && ctx.employeeId === snapshot.employeeId),
    403,
    'PAYSLIP_DENIED',
    'You are not authorized to access this employee’s payslip',
  );
  await entitlement(tx, ctx.tenantId);
  return snapshot;
}
function objectKey(snapshot: Awaited<ReturnType<typeof authorizedSnapshot>>) {
  return `${snapshot.tenantId}/payslips/${snapshot.id}/${hash(snapshot.tenant.updatedAt.toISOString() + snapshot.run.status)}.pdf`;
}
payslips.get('/payslips', async (req, res) => {
  const tid = tenant(req);
  await entitlement(db, tid);
  const any = req.ctx.permissions.has('payslips.print.any');
  check(
    any || req.ctx.permissions.has('payslips.read.self'),
    403,
    'PAYSLIP_DENIED',
    'Payslip access is not permitted',
  );
  const items = await db.payrollSnapshot.findMany({
    where: {
      tenantId: tid,
      run: { status: { in: ['APPROVED', 'LOCKED', 'REVERSED'] } },
      ...(!any ? { employeeId: req.ctx.employeeId || 'none' } : {}),
      ...(req.query.employeeId
        ? { employeeId: !any ? req.ctx.employeeId || 'none' : String(req.query.employeeId) }
        : {}),
    },
    include: {
      run: {
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          payDate: true,
          frequency: true,
        },
      },
      employee: { select: { employeeNumber: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ data: items.map(({ snapshot: _saved, ...item }) => item) });
});
payslips.post('/payslips/:id/generate', async (req, res) => {
  tenant(req);
  const snapshot = await authorizedSnapshot(db, req.ctx, String(req.params.id)),
    key = objectKey(snapshot);
  const existing = await db.privateFile.findUnique({ where: { objectKey: key } });
  if (existing && (await hasPrivate(key))) {
    res.json({ data: { ready: true } });
    return;
  }
  await jobs.add(
    'payslip',
    { snapshotId: snapshot.id, tenantId: snapshot.tenantId, actorId: req.ctx.userId, key },
    {
      jobId: 'payslip-' + hash(key),
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
  res.status(202).json({ data: { ready: false, message: 'Protected PDF generation queued' } });
});
payslips.get('/payslips/:id/status', async (req, res) => {
  tenant(req);
  const snapshot = await authorizedSnapshot(db, req.ctx, String(req.params.id)),
    key = objectKey(snapshot),
    file = await db.privateFile.findUnique({ where: { objectKey: key } });
  res.json({ data: { ready: Boolean(file && (await hasPrivate(key))) } });
});
payslips.get('/payslips/:id/download', async (req, res) => {
  tenant(req);
  const snapshot = await authorizedSnapshot(db, req.ctx, String(req.params.id)),
    key = objectKey(snapshot);
  const file = await db.privateFile.findUnique({ where: { objectKey: key } });
  check(file, 409, 'FILE_NOT_READY', 'Prepare the protected PDF before downloading');
  const body = await readPrivate(key);
  await audit(db, req.ctx, 'payslip.downloaded', snapshot.id, {
    employeeId: snapshot.employeeId,
    downloadedBy: req.ctx.userId,
    runStatus: snapshot.run.status,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${req.query.inline === 'true' ? 'inline' : 'attachment'}; filename="payslip-${snapshot.id}.pdf"`,
  );
  res.send(body);
});
payslips.post('/payslips/:id/print-event', async (req, res) => {
  tenant(req);
  const snapshot = await authorizedSnapshot(db, req.ctx, String(req.params.id));
  await audit(db, req.ctx, 'payslip.print_requested', snapshot.id, {
    employeeId: snapshot.employeeId,
    printedBy: req.ctx.userId,
    runStatus: snapshot.run.status,
  });
  res.json({ data: { message: 'Authorized print request recorded' } });
});
export async function generatePayslip(
  snapshotId: string,
  tenantId: string,
  actorId: string,
  expectedKey: string,
) {
  const ctx = await loadTenantActor(db, tenantId, actorId),
    snapshot = await authorizedSnapshot(db, ctx, snapshotId);
  const key = objectKey(snapshot);
  if (key !== expectedKey) return;
  const saved = snapshot.snapshot as unknown as SavedSnapshot;
  const document = new PDFDocument({ size: 'A4', margin: 45 }),
    chunks: Buffer[] = [];
  document.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  const font = process.env.PDF_FONT_PATH || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  if (existsSync(font)) document.font(font);
  document.fontSize(22).text(snapshot.tenant.displayName);
  document.fontSize(10).text(snapshot.tenant.legalName);
  document.moveDown().fontSize(16).text('Employee payslip');
  document.fontSize(9).text('eQwik YardHRMS™ · Qwik Business Solutions™');
  document.moveDown();
  if (saved.result.complianceMode === 'TEST_ONLY')
    document
      .fillColor('#a43333')
      .fontSize(12)
      .text('TEST ONLY — NOT FOR DISBURSEMENT')
      .fillColor('#203b37');
  if (snapshot.run.status === 'REVERSED')
    document
      .fillColor('#a43333')
      .fontSize(12)
      .text('REVERSED PAYROLL — HISTORICAL RECORD')
      .fillColor('#203b37');
  document.fontSize(11).text(`${saved.employee.name} · ${saved.employee.employeeNumber}`);
  document
    .fontSize(10)
    .text(
      `${saved.employee.frequency} · Period ${snapshot.run.startDate.toISOString().slice(0, 10)} to ${snapshot.run.endDate.toISOString().slice(0, 10)}`,
    );
  document.text(`Pay date ${snapshot.run.payDate.toISOString().slice(0, 10)}`);
  document.moveDown();
  const result = saved.result,
    currency = result.currency;
  for (const [name, amount] of [
    ['Regular pay', result.regular],
    ['Approved overtime', result.overtime],
    ['Taxable additions', result.taxableEarnings],
    ['Non-taxable additions', result.nonTaxableEarnings],
    ['Gross pay', result.gross],
  ])
    document.text(`${name}: ${currency} ${amount}`);
  document.moveDown();
  for (const c of result.components) document.text(`${c.name}: ${currency} ${c.employee}`);
  for (const d of result.personalDeductions) document.text(`${d.name}: ${currency} ${d.amount}`);
  document
    .moveDown()
    .fontSize(13)
    .text(`Total deductions: ${currency} ${result.deductions}`)
    .text(`NET PAY: ${currency} ${result.net}`);
  document
    .moveDown()
    .fontSize(9)
    .text(`Approved by ${saved.approval.approvedBy} on ${saved.approval.approvedAt}`)
    .text(`Statutory rule version: ${saved.rule.name} (${saved.rule.id})`)
    .text('Private employee document. Access and download events are audited.');
  document.end();
  const body = await finished;
  await storePrivate(key, body, 'application/pdf');
  await db.privateFile.upsert({
    where: { objectKey: key },
    create: {
      tenantId,
      employeeId: snapshot.employeeId,
      objectKey: key,
      name: 'payslip.pdf',
      contentType: 'application/pdf',
      size: body.length,
      scanStatus: 'CLEAN',
      kind: 'PAYSLIP',
      createdBy: actorId,
    },
    update: { size: body.length },
  });
  await audit(db, ctx, 'payslip.generated', snapshot.id, {
    employeeId: snapshot.employeeId,
    fileKey: key,
  });
}
payslips.get('/payroll-runs/:id/bank-file', async (req, res) => {
  const tid = tenant(req, 'payroll.read');
  check(
    req.ctx.permissions.has('employees.sensitive'),
    403,
    'BANK_EXPORT_DENIED',
    'Bank exports require sensitive-employee access',
  );
  await entitlement(db, tid);
  const run = await db.payrollRun.findUnique({
    where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    include: { snapshots: true },
  });
  check(
    run && ['APPROVED', 'LOCKED'].includes(run.status),
    409,
    'PAYROLL_NOT_APPROVED',
    'Bank files require an approved unreversed payroll',
  );
  const format = z.enum(['csv', 'xlsx']).parse(req.query.format || 'csv');
  const company = await db.tenant.findUniqueOrThrow({ where: { id: tid } });
  const rows = run.snapshots.map((row) => {
    const saved = row.snapshot as unknown as SavedSnapshot;
    check(
      saved.paymentInstructions,
      409,
      'BANK_DETAILS_MISSING',
      'Every selected employee must have approved bank details before creating a bank file',
    );
    return {
      company: company.displayName,
      employeeNumber: saved.employee.employeeNumber,
      name: saved.employee.name,
      bank: saved.paymentInstructions.bankName,
      account: decrypt<string>(saved.paymentInstructions.accountCipher),
      amount: row.net.toFixed(2),
      currency: saved.result.currency,
      payrollReference: run.id,
      payDate: run.payDate.toISOString().slice(0, 10),
      mode: saved.result.complianceMode,
    };
  });
  check(rows.length, 409, 'NO_PAYROLL_LINES', 'No approved payroll lines');
  const testOnly = rows.some((row) => row.mode === 'TEST_ONLY');
  check(
    !testOnly || (process.env.NODE_ENV !== 'production' && req.query.testPreview === 'true'),
    403,
    'TEST_BANK_PREVIEW',
    'Test-only calculations permit only an explicitly requested development bank preview',
  );
  await audit(db, req.ctx, 'payroll.bank_exported', run.id, {
    format,
    rows: rows.length,
    testOnly,
  });
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${testOnly ? 'TEST_ONLY-' : ''}bank-${run.id}.${format}"`,
  );
  const columns = Object.keys(rows[0]);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.send(
      columns.map(csvCell).join(',') +
        '\n' +
        rows
          .map((row) => columns.map((k) => csvCell(row[k as keyof typeof row])).join(','))
          .join('\n'),
    );
  } else {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Bank export');
    sheet.addRow(columns);
    rows.forEach((row) => sheet.addRow(columns.map((k) => String(row[k as keyof typeof row]))));
    sheet.columns.forEach((c) => {
      c.width = 24;
      c.numFmt = '@';
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }
});
