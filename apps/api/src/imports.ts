import { Router } from 'express';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { employeeSchema, timesheetSchema } from '../../../packages/types/src/index.js';
import {
  db,
  tenant,
  writeTenant,
  entitlement,
  check,
  audit,
  jobs,
  ApiError,
  encrypt,
  decrypt,
  hash,
  loadTenantActor,
  type Context,
} from './core.js';
import { saveEmployee, mergeEmployee } from './employees.js';
import { saveTimesheet } from './time.js';
export const imports = Router();
export const employeeColumns = [
  'id',
  'employeeNumber',
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'parish',
  'departmentId',
  'position',
  'branch',
  'employmentType',
  'managerId',
  'hireDate',
  'frequency',
  'payType',
  'basePay',
  'standardHours',
  'overtimeEligible',
  'active',
  'trn',
  'nis',
  'nht',
  'bankName',
  'bankAccount',
  'legacyId',
  'legacySource',
];
export const timesheetColumns = [
  'employeeId',
  'workDate',
  'shift',
  'startTime',
  'endTime',
  'breakHours',
  'legacyId',
  'legacySource',
];
function safeWorkbook(buffer: Buffer) {
  return new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(new ApiError(422, 'INVALID_XLSX', 'Invalid Excel workbook'));
        return;
      }
      let size = 0,
        count = 0;
      zip.on('entry', (entry) => {
        size += entry.uncompressedSize;
        count++;
        if (
          size > 30 * 1024 * 1024 ||
          entry.uncompressedSize > 10 * 1024 * 1024 ||
          count > 200 ||
          /vbaProject|externalLinks|\.exe$/i.test(entry.fileName)
        ) {
          zip.close();
          reject(
            new ApiError(
              422,
              'UNSAFE_WORKBOOK',
              'Workbook is too large or contains unsupported macros/external links',
            ),
          );
          return;
        }
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        if (entry.generalPurposeBitFlag & 1) {
          zip.close();
          reject(new ApiError(422, 'UNSAFE_WORKBOOK', 'Encrypted workbooks are unsupported'));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zip.close();
            reject(new ApiError(422, 'INVALID_XLSX', 'Invalid workbook ZIP entry'));
            return;
          }
          let actual = 0;
          stream.on('data', (chunk) => {
            actual += chunk.length;
            if (actual > 10 * 1024 * 1024) stream.destroy(new Error('ZIP entry limit exceeded'));
          });
          stream.on('error', () => {
            zip.close();
            reject(
              new ApiError(
                422,
                'UNSAFE_WORKBOOK',
                'Workbook expansion or declared size is invalid',
              ),
            );
          });
          stream.on('end', () => {
            if (actual !== entry.uncompressedSize) {
              zip.close();
              reject(new ApiError(422, 'UNSAFE_WORKBOOK', 'Workbook ZIP declared size is invalid'));
              return;
            }
            zip.readEntry();
          });
        });
      });
      zip.on('end', resolve);
      zip.on('error', () => reject(new ApiError(422, 'INVALID_XLSX', 'Invalid workbook archive')));
      zip.readEntry();
    }),
  );
}
export async function parseSpreadsheet(
  filename: string,
  buffer: Buffer,
  mapping: Record<string, string>,
  kind: 'EMPLOYEES' | 'TIMESHEETS',
  inspectOnly = false,
) {
  check(buffer.length <= 5 * 1024 * 1024, 413, 'FILE_TOO_LARGE', 'Upload at most 5 MB');
  const workbook = new ExcelJS.Workbook();
  if (filename.toLowerCase().endsWith('.xlsx')) {
    await safeWorkbook(buffer);
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } else if (filename.toLowerCase().endsWith('.csv'))
    await workbook.csv.read(Readable.from(buffer));
  else throw new ApiError(422, 'FILE_TYPE', 'Only CSV and XLSX are supported');
  const sheet = workbook.worksheets[0];
  check(
    sheet && sheet.rowCount > 1 && sheet.rowCount <= 5001 && sheet.columnCount <= 100,
    422,
    'ROW_LIMIT',
    'Upload 1–5000 rows and at most 100 columns',
  );
  const allowed = kind === 'EMPLOYEES' ? employeeColumns : timesheetColumns;
  check(
    Object.values(mapping).every((value) => value === '' || allowed.includes(value)),
    422,
    'COLUMN_MAPPING',
    'Mapping includes an unsupported target column',
  );
  const headers: string[] = [];
  sheet
    .getRow(1)
    .eachCell(
      { includeEmpty: true },
      (cell, index) => (headers[index - 1] = String(cell.value || '').trim()),
    );
  check(
    new Set(headers.filter(Boolean)).size === headers.filter(Boolean).length,
    422,
    'DUPLICATE_HEADERS',
    'Spreadsheet headers must be unique',
  );
  check(
    headers.every((header) => header.length <= 100),
    422,
    'HEADER_LENGTH',
    'Column names may not exceed 100 characters',
  );
  const targets = headers
    .map((source) => mapping[source] ?? source)
    .filter((target) => allowed.includes(target));
  if (!inspectOnly)
    check(targets.length > 0, 422, 'COLUMN_MAPPING', 'Map at least one supported column');
  check(
    new Set(targets).size === targets.length,
    422,
    'COLUMN_MAPPING',
    'Multiple source columns map to the same target',
  );
  const rows: Record<string, string>[] = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row: Record<string, string> = Object.create(null);
    for (let index = 0; index < headers.length; index++) {
      const source = headers[index],
        target = mapping[source] ?? source;
      if (!allowed.includes(target)) continue;
      const value = sheet.getRow(n).getCell(index + 1).value;
      check(
        !value || typeof value !== 'object' || value instanceof Date,
        422,
        'FORMULA_CELL',
        'Formula and rich-value cells are unsupported. Paste values only.',
      );
      check(
        String(value ?? '').length <= 4096,
        422,
        'CELL_SIZE',
        'Cells may not exceed 4096 characters',
      );
      row[target] =
        value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}
function normalizedRow(input: Record<string, string>, kind: string) {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== '') data[k] = v;
  if (data.legacyId || data.legacySource) {
    z.object({
      legacyId: z.string().min(1).max(100),
      legacySource: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    }).parse({ legacyId: data.legacyId, legacySource: data.legacySource });
  }
  delete data.legacyId;
  delete data.legacySource;
  if (kind === 'EMPLOYEES') {
    const sensitive: Record<string, string> = {};
    for (const key of ['trn', 'nis', 'nht', 'bankName', 'bankAccount'])
      if (typeof data[key] === 'string') {
        sensitive[key] = String(data[key]);
        delete data[key];
      }
    if (Object.keys(sensitive).length) data.sensitive = sensitive;
    for (const key of ['overtimeEligible', 'active'])
      if (key in data) {
        check(
          ['true', 'false'].includes(String(data[key]).toLowerCase()),
          422,
          'BOOLEAN_VALUE',
          `${key} must be true or false`,
        );
        data[key] = String(data[key]).toLowerCase() === 'true';
      }
    data.reason = 'Spreadsheet import';
  }
  return data;
}
function rowError(error: unknown) {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof z.ZodError)
    return error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
    return 'DUPLICATE: Employee number or timesheet already exists';
  return 'IMPORT_ERROR: This row could not be committed; review its values and references';
}
imports.get('/imports/templates/:kind', async (req, res) => {
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports');
  const kind = String(req.params.kind);
  check(['employees', 'timesheets'].includes(kind), 404, 'NOT_FOUND', 'Template not found');
  const columns = kind === 'employees' ? employeeColumns : timesheetColumns;
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet(kind + ' v1');
  sheet.addRow(columns);
  sheet.columns.forEach((c) => {
    c.width = 22;
    c.numFmt = '@';
  });
  sheet.getRow(1).font = { bold: true };
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-template-v1.xlsx"`);
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});
function visiblePreview(ctx: Context, value: Prisma.JsonValue | Prisma.InputJsonValue | undefined) {
  const preview = { ...((value || {}) as Record<string, unknown>) };
  if (!ctx.permissions.has('compensation.read') && 'basePay' in preview)
    preview.basePay = 'REDACTED';
  return preview;
}
function importSummary(rows: { status: string }[]) {
  return rows.reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    },
    { PENDING: 0, CREATED: 0, UPDATED: 0, REJECTED: 0, SKIPPED: 0 },
  );
}
imports.post('/imports/columns', async (req, res) => {
  const b = z
    .object({
      kind: z.enum(['EMPLOYEES', 'TIMESHEETS']),
      filename: z.string().max(191),
      fileBase64: z.string().max(7 * 1024 * 1024),
    })
    .strict()
    .parse(req.body);
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports', true);
  const parsed = await parseSpreadsheet(
    b.filename,
    Buffer.from(b.fileBase64, 'base64'),
    {},
    b.kind,
    true,
  );
  res.json({
    data: {
      headers: parsed.headers,
      targets: b.kind === 'EMPLOYEES' ? employeeColumns : timesheetColumns,
    },
  });
});
imports.post('/imports/preview', async (req, res) => {
  const b = z
    .object({
      kind: z.enum(['EMPLOYEES', 'TIMESHEETS']),
      filename: z.string().max(191),
      fileBase64: z.string().max(7 * 1024 * 1024),
      mapping: z.record(z.string(), z.string()).default({}),
    })
    .strict()
    .parse(req.body);
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports', true);
  check(
    b.kind === 'EMPLOYEES'
      ? req.ctx.permissions.has('employees.write')
      : req.ctx.permissions.has('timesheets.submit.any') ||
          req.ctx.permissions.has('timesheets.submit.self'),
    403,
    'PERMISSION_DENIED',
    'Your role cannot import these records',
  );
  const parsed = await parseSpreadsheet(
    b.filename,
    Buffer.from(b.fileBase64, 'base64'),
    b.mapping,
    b.kind,
  );
  const existingLegacy = await db.legacyMap.findMany({
    where: {
      tenantId: tid,
      source: {
        in: [
          ...new Set(
            parsed.rows.filter((r) => r.legacyId).map((r) => b.kind + ':' + r.legacySource),
          ),
        ],
      },
    },
  });
  const legacyIds = new Map(existingLegacy.map((m) => [m.source + ':' + m.legacyId, m.entityId]));
  const prepared = parsed.rows.map((input, index) => {
    const empty = Object.values(input).every((value) => value === '');
    let error: string | null = empty ? 'BLANK_ROW: Empty row skipped' : null;
    try {
      const normalized = normalizedRow(input, b.kind);
      if (!normalized.id && b.kind === 'EMPLOYEES' && input.legacyId)
        normalized.id = legacyIds.get(b.kind + ':' + input.legacySource + ':' + input.legacyId);
      if (b.kind === 'EMPLOYEES') {
        if (!normalized.id) employeeSchema.parse(normalized);
        else z.uuid().parse(normalized.id);
      } else timesheetSchema.parse(normalized);
    } catch (e) {
      error = rowError(e);
    }
    return {
      rowNumber: index + 2,
      input: {
        cipher: encrypt(input),
        preview: Object.fromEntries(
          Object.entries(input).map(([key, value]) => [
            key,
            ['trn', 'nis', 'nht', 'bankAccount'].includes(key) ? 'REDACTED' : value,
          ]),
        ),
      } as Prisma.InputJsonObject,
      status: empty ? 'SKIPPED' : error ? 'REJECTED' : 'PENDING',
      error,
    };
  });
  const data = await writeTenant(req, 'imports.write', 'imports', async (tx) => {
    const batch = await tx.importBatch.create({
      data: { tenantId: tid, kind: b.kind, actorId: req.ctx.userId, rows: { create: prepared } },
    });
    await audit(tx, req.ctx, 'import.previewed', batch.id, { kind: b.kind, rows: prepared.length });
    return {
      ...batch,
      headers: parsed.headers,
      rows: prepared.map((row) => ({ ...row, input: visiblePreview(req.ctx, row.input.preview) })),
      summary: importSummary(prepared),
    };
  });
  res.status(201).json({ data });
});
imports.get('/imports', async (req, res) => {
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports');
  res.json({
    data: await db.importBatch.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { _count: { select: { rows: true } } },
    }),
  });
});
imports.get('/imports/:id', async (req, res) => {
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports');
  const batch = await db.importBatch.findUnique({
    where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    include: { rows: { orderBy: { rowNumber: 'asc' } } },
  });
  check(batch, 404, 'NOT_FOUND', 'Import not found');
  res.json({
    data: {
      ...batch,
      rows: batch.rows.map((row) => ({
        ...row,
        input: visiblePreview(req.ctx, (row.input as Prisma.JsonObject).preview),
      })),
      summary: importSummary(batch.rows),
    },
  });
});
imports.post('/imports/:id/execute', async (req, res) => {
  const data = await writeTenant(req, 'imports.write', 'imports', async (tx, tid) => {
    const batch = await tx.importBatch.findUnique({
      where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    });
    check(batch, 404, 'NOT_FOUND', 'Import not found');
    check(
      batch.actorId === req.ctx.userId,
      403,
      'IMPORT_ACTOR',
      'Only the uploader can execute this staged import',
    );
    check(
      ['PREVIEW', 'QUEUED', 'PROCESSING', 'COMPLETE'].includes(batch.status),
      409,
      'IMPORT_STATE',
      'Import state is invalid',
    );
    if (batch.status === 'PREVIEW')
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: 'QUEUED' } });
    return batch;
  });
  await jobs.add(
    'import',
    { batchId: data.id },
    {
      jobId: 'import-' + data.id,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
  res.json({ data: { id: data.id, message: 'Import queued; monitor row outcomes' } });
});
imports.get('/imports/:id/results.csv', async (req, res) => {
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports');
  const batch = await db.importBatch.findUnique({
    where: { tenantId_id: { tenantId: tid, id: String(req.params.id) } },
    include: { rows: { orderBy: { rowNumber: 'asc' } } },
  });
  check(batch, 404, 'NOT_FOUND', 'Import not found');
  const csv = (v: unknown) =>
    '"' +
    String(v ?? '')
      .replace(/^[=+\-@]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="import-results.csv"');
  res.send(
    'row,status,entity_id,error\n' +
      batch.rows
        .map((r) => [r.rowNumber, r.status, r.entityId, r.error].map(csv).join(','))
        .join('\n'),
  );
});
export async function processImport(batchId: string) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status === 'COMPLETE') return;
  check(
    ['QUEUED', 'PROCESSING'].includes(batch.status),
    409,
    'IMPORT_STATE',
    'Only queued imports can run',
  );
  await db.importBatch.update({ where: { id: batchId }, data: { status: 'PROCESSING' } });
  const rows = await db.importRow.findMany({
    where: { batchId, status: 'PENDING' },
    orderBy: { rowNumber: 'asc' },
  });
  for (const row of rows) {
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${batch.tenantId} FOR UPDATE`;
          const current = await tx.importRow.findUniqueOrThrow({ where: { id: row.id } });
          if (current.status !== 'PENDING') return;
          const membership = await tx.membership.findUnique({
            where: { tenantId_userId: { tenantId: batch.tenantId, userId: batch.actorId } },
            include: {
              user: true,
              roles: { include: { role: { include: { permissions: true } } } },
            },
          });
          check(
            membership?.active && membership.user.active && membership.user.verifiedAt,
            403,
            'ACTOR_INACTIVE',
            'Import actor is no longer authorized',
          );
          await loadTenantActor(tx, batch.tenantId, batch.actorId);
          const permissions = new Set(
            membership.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)),
          );
          check(
            permissions.has('imports.write'),
            403,
            'PERMISSION_DENIED',
            'Import permission was removed',
          );
          await entitlement(tx, batch.tenantId, 'imports', true);
          const ctx: Context = {
            tenantId: batch.tenantId,
            userId: batch.actorId,
            name: membership.user.name,
            email: membership.user.email,
            platformRole: membership.user.platformRole,
            roles: membership.roles.map((r) => r.role.name),
            permissions,
            approvalScopes: {},
            employeeId: membership.employeeId,
            mfaEnabled: membership.user.mfaEnabled,
            mfaVerified: true,
            csrfToken: '',
            sessionId: '',
            requestId: randomUUID(),
          };
          const rawInput = decrypt<Record<string, string>>(
            String((row.input as Prisma.JsonObject).cipher),
          );
          const input = normalizedRow(rawInput, batch.kind);
          const legacy = rawInput.legacyId
            ? { source: batch.kind + ':' + rawInput.legacySource, legacyId: rawInput.legacyId }
            : null;
          const sourceDigest = hash(JSON.stringify(rawInput));
          const mapped = legacy
            ? await tx.legacyMap.findUnique({
                where: { tenantId_source_legacyId: { tenantId: batch.tenantId, ...legacy } },
              })
            : null;
          if (mapped && batch.kind === 'TIMESHEETS') {
            check(
              mapped.sourceDigest === sourceDigest,
              409,
              'LEGACY_INPUT_CHANGED',
              'Mapped time changed; use the controlled correction workflow rather than reimporting it',
            );
            await tx.importRow.update({
              where: { id: row.id },
              data: {
                status: 'SKIPPED',
                entityId: mapped.entityId,
                error: 'Existing unchanged legacy time entry',
              },
            });
            return;
          }
          if (mapped && batch.kind === 'EMPLOYEES') {
            check(
              !input.id || input.id === mapped.entityId,
              409,
              'LEGACY_MAPPING_CONFLICT',
              'Legacy ID is already bound to another employee',
            );
            input.id = mapped.entityId;
          }
          let entityId: string, status: string;
          if (batch.kind === 'EMPLOYEES') {
            check(
              permissions.has('employees.write'),
              403,
              'PERMISSION_DENIED',
              'Employee write permission was removed',
            );
            const id = typeof input.id === 'string' ? input.id : null;
            delete input.id;
            if (id) {
              const e = await tx.employee.findUnique({
                where: { tenantId_id: { tenantId: batch.tenantId, id } },
              });
              check(e, 404, 'NOT_FOUND', 'Update ID is not an employee in this company');
              const after = await saveEmployee(
                tx,
                ctx,
                mergeEmployee(e, { ...input, version: e.version }),
                id,
              );
              entityId = after.id;
              status = 'UPDATED';
            } else {
              const after = await saveEmployee(tx, ctx, employeeSchema.parse(input));
              entityId = after.id;
              status = 'CREATED';
            }
          } else {
            const b = timesheetSchema.parse(input);
            check(
              permissions.has('timesheets.submit.any') ||
                (permissions.has('timesheets.submit.self') && ctx.employeeId === b.employeeId),
              403,
              'SUBJECT_DENIED',
              'You cannot import for this employee',
            );
            const t = await saveTimesheet(tx, ctx, b);
            entityId = t.id;
            status = 'CREATED';
          }
          if (legacy) {
            await tx.legacyMap.upsert({
              where: { tenantId_source_legacyId: { tenantId: batch.tenantId, ...legacy } },
              create: { tenantId: batch.tenantId, ...legacy, entityId, sourceDigest },
              update: { sourceDigest },
            });
            await audit(tx, ctx, 'migration.legacy_mapped', entityId, {
              ...legacy,
              sourceDigest,
              importId: batch.id,
            });
          }
          await tx.importRow.update({
            where: { id: row.id },
            data: { status, entityId, error: null },
          });
        },
        { timeout: 20000 },
      );
    } catch (error) {
      await db.importRow.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'REJECTED', error: rowError(error) },
      });
    }
  }
  await db.$transaction(async (tx) => {
    const changed = await tx.importBatch.updateMany({
      where: { id: batchId, status: 'PROCESSING' },
      data: { status: 'COMPLETE', completedAt: new Date() },
    });
    if (changed.count)
      await audit(
        tx,
        { tenantId: batch.tenantId, userId: batch.actorId, requestId: randomUUID() },
        'import.completed',
        batchId,
        { kind: batch.kind, processed: rows.length },
      );
  });
}

imports.get('/legacy-mappings', async (req, res) => {
  const tid = tenant(req, 'imports.write');
  await entitlement(db, tid, 'imports');
  res.json({
    data: await db.legacyMap.findMany({
      where: { tenantId: tid, ...(req.query.source ? { source: String(req.query.source) } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    }),
  });
});
