import { platformWrite } from './licensing.js';
import { Router, type Request } from 'express';
import { z } from 'zod';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  db,
  tenant,
  platform,
  writeTenant,
  entitlement,
  check,
  employeeScope,
  audit,
  jobs,
  type Context,
} from './core.js';
import { storePrivate, readPrivate } from './storage.js';
export const files = Router();
const upload = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(191)
      .refine(
        (s) => ![...s].some((c) => c.charCodeAt(0) < 32 || c === '/' || c === '\\'),
        'Use a plain file name',
      ),
    contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    data: z
      .string()
      .min(4)
      .max(6990510)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    retainUntil: z.iso.date().nullable().optional(),
  })
  .strict();
function bytes(body: z.infer<typeof upload>) {
  const value = Buffer.from(body.data, 'base64');
  check(
    value.length > 0 && value.length <= 5 * 1024 * 1024,
    422,
    'FILE_SIZE',
    'Files must be at most 5 MiB',
  );
  const valid =
    body.contentType === 'application/pdf'
      ? value.subarray(0, 5).toString() === '%PDF-'
      : body.contentType === 'image/png'
        ? value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : value[0] === 255 && value[1] === 216 && value[2] === 255;
  check(valid, 422, 'FILE_TYPE', 'File content does not match the declared PDF, PNG or JPEG type');
  return value;
}
async function employeeFileAccess(ctx: Context, employeeId: string, write = false) {
  check(
    (!write && ctx.employeeId === employeeId) || ctx.permissions.has('employees.sensitive'),
    403,
    'DOCUMENT_ACCESS',
    'Employee documents are restricted to the employee and authorized sensitive-data officers',
  );
  await employeeScope(db, ctx.tenantId!, employeeId);
  await entitlement(db, ctx.tenantId!, undefined, write);
}
async function save(
  req: Request,
  ctx: Context,
  body: z.infer<typeof upload>,
  employeeId: string | null,
  kind: string,
) {
  const value = bytes(body),
    id = randomUUID(),
    objectKey = `${ctx.tenantId}/quarantine/${id}`;
  await storePrivate(objectKey, value, body.contentType);
  const commit = async (tx: import('./core.js').Tx) => {
    const f = await tx.privateFile.create({
      data: {
        id,
        tenantId: ctx.tenantId!,
        employeeId,
        kind,
        objectKey,
        name: body.name,
        contentType: body.contentType,
        size: value.length,
        createdBy: ctx.userId,
        retainUntil: body.retainUntil ? new Date(body.retainUntil + 'T00:00:00Z') : null,
      },
    });
    await audit(
      tx,
      ctx,
      kind === 'PAYMENT_EVIDENCE' ? 'platform.evidence_uploaded' : 'document.uploaded',
      f.id,
      {
        name: body.name,
        size: value.length,
        employeeId,
        scanStatus: 'QUARANTINED',
        retainUntil: body.retainUntil || null,
      },
    );
    return f;
  };
  const file =
    kind === 'DOCUMENT'
      ? await writeTenant(req, 'employees.sensitive', undefined, commit)
      : await platformWrite(req, false, commit);
  await jobs.add(
    'file-scan',
    { fileId: id },
    {
      jobId: 'scan-' + id,
      attempts: 5,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
  return file;
}
files.get('/employees/:employeeId/documents', async (req, res) => {
  const tid = tenant(req);
  const employeeId = String(req.params.employeeId);
  await employeeFileAccess(req.ctx, employeeId);
  res.json({
    data: await db.privateFile.findMany({
      where: { tenantId: tid, employeeId, kind: 'DOCUMENT' },
      select: {
        id: true,
        name: true,
        size: true,
        contentType: true,
        scanStatus: true,
        retainUntil: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  });
});
files.post('/employees/:employeeId/documents', async (req, res) => {
  const body = upload.parse(req.body),
    employeeId = String(req.params.employeeId);
  tenant(req, 'employees.sensitive');
  await employeeFileAccess(req.ctx, employeeId, true);
  const data = await save(req, req.ctx, body, employeeId, 'DOCUMENT');
  res.status(202).json({ data: { id: data.id, scanStatus: data.scanStatus } });
});
files.post('/platform/customers/:tenantId/evidence', async (req, res) => {
  platform(req);
  const body = upload.parse(req.body),
    tenantId = z.uuid().parse(req.params.tenantId);
  check(
    await db.tenant.findUnique({ where: { id: tenantId } }),
    404,
    'NOT_FOUND',
    'Customer not found',
  );
  const data = await save(req, { ...req.ctx, tenantId }, body, null, 'PAYMENT_EVIDENCE');
  res.status(202).json({ data: { id: data.id, scanStatus: data.scanStatus } });
});
files.get('/platform/customers/:tenantId/evidence', async (req, res) => {
  platform(req);
  res.json({
    data: await db.privateFile.findMany({
      where: { tenantId: String(req.params.tenantId), kind: 'PAYMENT_EVIDENCE', employeeId: null },
      select: { id: true, name: true, size: true, scanStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  });
});
files.get('/private-files/:id/download', async (req, res) => {
  const tid = tenant(req),
    file = await db.privateFile.findFirst({
      where: { id: String(req.params.id), tenantId: tid, kind: 'DOCUMENT' },
    });
  check(file?.employeeId, 404, 'NOT_FOUND', 'Document not found');
  await employeeFileAccess(req.ctx, file.employeeId);
  check(
    file.scanStatus === 'CLEAN',
    403,
    'FILE_QUARANTINED',
    'Documents cannot be downloaded until a real malware scanner clears them',
  );
  await audit(db, req.ctx, 'document.downloaded', file.id, {
    employeeId: file.employeeId,
    name: file.name,
  });
  res
    .type(file.contentType)
    .setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
  res.send(await readPrivate(file.objectKey));
});
files.get('/platform/evidence/:id/download', async (req, res) => {
  platform(req);
  const file = await db.privateFile.findFirst({
    where: { id: String(req.params.id), kind: 'PAYMENT_EVIDENCE', employeeId: null },
  });
  check(file, 404, 'NOT_FOUND', 'Evidence not found');
  check(
    file.scanStatus === 'CLEAN',
    403,
    'FILE_QUARANTINED',
    'Evidence remains quarantined until malware scanning succeeds',
  );
  await audit(
    db,
    { ...req.ctx, tenantId: file.tenantId },
    'platform.evidence_downloaded',
    file.id,
    {},
  );
  res
    .type(file.contentType)
    .setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
  res.send(await readPrivate(file.objectKey));
});
files.post('/private-files/:id/rescan', async (req, res) => {
  const file = await db.privateFile.findUnique({ where: { id: String(req.params.id) } });
  check(file, 404, 'NOT_FOUND', 'File not found');
  if (file.kind === 'PAYMENT_EVIDENCE') platform(req);
  else {
    tenant(req, 'employees.sensitive');
    check(
      file.tenantId === req.ctx.tenantId && file.kind === 'DOCUMENT' && file.employeeId,
      404,
      'NOT_FOUND',
      'Document not found',
    );
    await employeeFileAccess(req.ctx, file.employeeId, true);
  }
  check(
    file.scanStatus === 'QUARANTINED',
    409,
    'SCAN_STATE',
    'Only quarantined files can be retried',
  );
  await jobs.add(
    'file-scan',
    { fileId: file.id },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
  res.status(202).json({ data: { message: 'Malware scan queued' } });
});
export async function scanBuffer(buffer: Buffer) {
  check(
    process.env.CLAMAV_HOST,
    503,
    'SCANNER_UNAVAILABLE',
    'Configure a real ClamAV daemon before releasing uploaded files',
  );
  return new Promise<'CLEAN' | 'INFECTED'>((resolve, reject) => {
    const socket = net.connect({
        host: process.env.CLAMAV_HOST!,
        port: Number(process.env.CLAMAV_PORT || 3310),
      }),
      responses: Buffer[] = [];
    socket.setTimeout(20000);
    socket.on('timeout', () => socket.destroy(new Error('Malware scanner timed out')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      responses.push(chunk);
      if (Buffer.concat(responses).includes(0)) socket.end();
    });
    socket.on('end', () => {
      const result = Buffer.concat(responses).toString().replaceAll('\0', '').trim();
      if (result === 'stream: OK') resolve('CLEAN');
      else if (/^stream: .+ FOUND$/.test(result)) resolve('INFECTED');
      else reject(new Error('Malware scan did not return a conclusive result'));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < buffer.length; offset += 65536) {
        const chunk = buffer.subarray(offset, offset + 65536),
          length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
export async function processFileScan(fileId: string) {
  const file = await db.privateFile.findUniqueOrThrow({ where: { id: fileId } });
  if (file.scanStatus !== 'QUARANTINED') return;
  const body = await readPrivate(file.objectKey);
  const status = await scanBuffer(body);
  await db.$transaction(async (tx) => {
    await tx.privateFile.updateMany({
      where: { id: file.id, scanStatus: 'QUARANTINED' },
      data: { scanStatus: status },
    });
    await audit(
      tx,
      { tenantId: file.tenantId, userId: file.createdBy, requestId: randomUUID() },
      file.kind === 'PAYMENT_EVIDENCE' ? 'platform.evidence_scanned' : 'document.scanned',
      file.id,
      { status },
    );
  });
}
// Retention is metadata only until the company approves a deletion policy; payroll files are never deleted here.
export type ProtectedFileContext = Context;
