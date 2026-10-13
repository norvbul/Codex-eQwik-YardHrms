import '../packages/configuration/env.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
const options = z
  .object({
    file: z.string(),
    mapping: z.string(),
    kind: z.enum(['EMPLOYEES', 'TIMESHEETS', 'HISTORICAL_RECONCILIATION']),
    source: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    out: z.string(),
    mode: z.enum(['stage', 'preview', 'commit']).default('stage'),
    baseUrl: z.url().optional(),
  })
  .parse(
    Object.fromEntries(
      process.argv.slice(2).map((arg) => {
        const [key, ...value] = arg.replace(/^--/, '').split('=');
        return [key, value.join('=')];
      }),
    ),
  );
const mapping = z
    .record(z.string(), z.string())
    .parse(JSON.parse(readFileSync(options.mapping, 'utf8'))),
  buffer = readFileSync(options.file);
if (buffer.length > 5 * 1024 * 1024 || !options.file.toLowerCase().endsWith('.csv'))
  throw new Error('Export source Sheets as a values-only CSV at most 5 MiB');
const workbook = new ExcelJS.Workbook();
await workbook.csv.read(Readable.from(buffer));
const sheet = workbook.worksheets[0];
if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 5001)
  throw new Error('Stage 1–5,000 rows per source file');
const headers: string[] = [];
sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, index) => {
  headers[index - 1] = String(cell.value || '').trim();
});
const targets = Object.values(mapping).filter(Boolean);
if (new Set(targets).size !== targets.length)
  throw new Error('Mapping must assign each target once');
if (!targets.includes('legacyId'))
  throw new Error('Map the original source identifier to legacyId');
const rows: Record<string, string>[] = [],
  issues: { row: number; field: string; message: string }[] = [],
  legacyIds = new Set<string>();
let gross = new Decimal(0),
  net = new Decimal(0);
for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
  const row: Record<string, string> = { legacySource: options.source };
  for (let i = 0; i < headers.length; i++) {
    const target = mapping[headers[i]!];
    if (!target) continue;
    const value = sheet.getRow(rowNumber).getCell(i + 1).value;
    if (value && typeof value === 'object') {
      issues.push({
        row: rowNumber,
        field: target,
        message: 'Export plain values; formula/rich cells are unsupported',
      });
      continue;
    }
    row[target] = String(value ?? '').trim();
    if (/Date$/.test(target) && row[target] && !/^\d{4}-\d{2}-\d{2}$/.test(row[target]))
      issues.push({
        row: rowNumber,
        field: target,
        message: 'Normalize explicitly to YYYY-MM-DD; ambiguous dates are never inferred',
      });
  }
  if (!row.legacyId || legacyIds.has(row.legacyId))
    issues.push({
      row: rowNumber,
      field: 'legacyId',
      message: 'Legacy ID must be present and unique within this source',
    });
  if (row.legacyId) legacyIds.add(row.legacyId);
  if (row.frequency) {
    const normalized = { monthly: 'MONTHLY', weekly: 'WEEKLY', fortnightly: 'FORTNIGHTLY' }[
      row.frequency.toLowerCase()
    ];
    if (normalized) row.frequency = normalized;
    else
      issues.push({
        row: rowNumber,
        field: 'frequency',
        message: 'Use weekly, fortnightly or monthly',
      });
  }
  for (const field of ['basePay', 'standardHours', 'gross', 'net'])
    if (row[field]) {
      if (!/^\d+(\.\d{1,2})?$/.test(row[field]))
        issues.push({
          row: rowNumber,
          field,
          message: 'Use an unsigned decimal with at most two places, without commas/currency signs',
        });
      else if (field === 'gross') gross = gross.plus(row[field]);
      else if (field === 'net') net = net.plus(row[field]);
    }
  rows.push(row);
}
const directory = resolve(options.out);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"',
  outputHeaders = ['legacySource', ...targets.filter((t) => t !== 'legacySource')],
  csv =
    outputHeaders.map(quote).join(',') +
    '\n' +
    rows.map((row) => outputHeaders.map((key) => quote(row[key] || '')).join(',')).join('\n');
const normalizedPath = resolve(directory, options.source + '-normalized.csv'),
  manifestPath = resolve(directory, options.source + '-manifest.json');
writeFileSync(normalizedPath, csv, { mode: 0o600 });
const manifest = {
  source: options.source,
  kind: options.kind,
  sourceName: basename(options.file),
  sourceSha256: createHash('sha256').update(buffer).digest('hex'),
  createdAt: new Date().toISOString(),
  rows: rows.length,
  uniqueLegacyIds: legacyIds.size,
  gross: gross.toFixed(2),
  net: net.toFixed(2),
  issues,
  mode: options.mode,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
if (issues.length)
  throw new Error(
    `Staging found ${issues.length} issues; review the private manifest before importing`,
  );
if (options.mode !== 'stage') {
  if (options.kind === 'HISTORICAL_RECONCILIATION')
    throw new Error(
      'Historical financial archives require payroll/finance reconciliation and a signed migration plan; this command never fabricates approved payroll',
    );
  if (!options.baseUrl) throw new Error('Provide --baseUrl for API preview or commit');
  const url = new URL(options.baseUrl);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Remote migration must use verified HTTPS');
  const cookie = process.env.YARD_SESSION_COOKIE,
    csrf = process.env.YARD_CSRF;
  if (!cookie || !csrf)
    throw new Error(
      'Provide a current MFA-verified session cookie and CSRF through secure environment variables',
    );
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(new URL('/api/v1' + path, url), {
      method: body ? 'POST' : 'GET',
      headers: {
        Cookie: cookie,
        'x-csrf-token': csrf,
        'Content-Type': 'application/json',
        Origin: url.origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Migration API request failed');
    return result.data;
  };
  const preview = await call('/imports/preview', {
    kind: options.kind,
    filename: basename(normalizedPath),
    fileBase64: Buffer.from(csv).toString('base64'),
    mapping: {},
  });
  writeFileSync(
    resolve(directory, options.source + '-preview.json'),
    JSON.stringify(preview, null, 2),
    { mode: 0o600 },
  );
  if (options.mode === 'commit') {
    if (preview.summary.REJECTED)
      throw new Error('Preview contains rejected rows; review and repair before committing');
    await call('/imports/' + preview.id + '/execute', {});
    let result;
    for (let attempt = 0; attempt < 120; attempt++) {
      result = await call('/imports/' + preview.id);
      if (result.status === 'COMPLETE') break;
      await delay(1000);
    }
    if (result?.status !== 'COMPLETE')
      throw new Error('Migration is still running; inspect its job in the application');
    writeFileSync(
      resolve(directory, options.source + '-results.json'),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    const maps = await call(
      '/legacy-mappings?source=' + encodeURIComponent(options.kind + ':' + options.source),
    );
    writeFileSync(
      resolve(directory, options.source + '-id-map.json'),
      JSON.stringify(maps, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        event: 'migration.complete',
        jobId: preview.id,
        summary: result.summary,
        output: directory,
      }),
    );
  } else
    console.log(
      JSON.stringify({
        event: 'migration.preview',
        jobId: preview.id,
        summary: preview.summary,
        output: directory,
      }),
    );
} else
  console.log(
    JSON.stringify({
      event: 'migration.staged',
      rows: rows.length,
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      output: directory,
    }),
  );
