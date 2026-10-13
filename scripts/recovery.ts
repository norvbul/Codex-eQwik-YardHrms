import '../packages/configuration/env.js';
import { createCipheriv, createDecipheriv, randomBytes, createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
const [mode, fileArg] = process.argv.slice(2),
  url = new URL(process.env.DATABASE_URL!);
if (
  !['backup', 'restore-drill'].includes(mode || '') ||
  process.env.NODE_ENV !== 'development' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  (url.pathname !== '/yardhrms' &&
    !(
      process.env.YARD_ISOLATED_TESTS === 'true' &&
      /^\/yardhrms_test_[a-f0-9]{12}$/.test(url.pathname)
    ))
)
  throw new Error(
    'Use backup or restore-drill for the local development Docker database only. Production recovery uses your approved managed-service procedure.',
  );
mkdirSync('.private/backups', { recursive: true, mode: 0o700 });
const keyPath = '.private/backup.key';
if (!process.env.BACKUP_ENCRYPTION_KEY && !existsSync(keyPath)) {
  if (mode !== 'backup') throw new Error('Provide the backup encryption key before restoring');
  writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
}
const key = Buffer.from(
  process.env.BACKUP_ENCRYPTION_KEY || readFileSync(keyPath, 'utf8').trim(),
  'hex',
);
if (key.length !== 32) throw new Error('Backup encryption key must be 32-byte hex');
const sourceDatabase = url.pathname.slice(1);
const file = resolve(
  fileArg || '.private/backups/' + new Date().toISOString().replaceAll(':', '-') + '.yardbackup',
);
function mysql(database: string, sql: string) {
  if (!/^yardhrms(?:_(?:restore|test)_[a-f0-9]+)?$/.test(database))
    throw new Error('Unsafe recovery database');
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'mysql',
      'sh',
      '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --batch --raw --skip-column-names -uroot "$1"',
      'sh',
      database,
    ],
    { input: sql, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(
      'Recovery database operation failed (MySQL ' +
        (result.stderr.match(/ERROR (\d+)/)?.[1] || 'process ' + result.status) +
        '); original database is unchanged',
    );
  return result.stdout.trim();
}
const summarySql =
  "SELECT JSON_OBJECT('tenants',(SELECT COUNT(*) FROM Tenant),'users',(SELECT COUNT(*) FROM User),'employees',(SELECT COUNT(*) FROM Employee),'auditEvents',(SELECT COUNT(*) FROM AuditEvent),'payrollRuns',(SELECT COUNT(*) FROM PayrollRun),'snapshots',(SELECT COUNT(*) FROM PayrollSnapshot),'gross',CAST((SELECT COALESCE(SUM(gross),0) FROM PayrollSnapshot) AS CHAR),'net',CAST((SELECT COALESCE(SUM(net),0) FROM PayrollSnapshot) AS CHAR),'migrations',(SELECT COUNT(*) FROM _prisma_migrations))";
const storage = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  }),
  sourceBucket = process.env.S3_BUCKET!;
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
type Archive = {
  version: 1;
  createdAt: string;
  fieldEncryptionKey: string;
  sql: string;
  summary: Record<string, unknown>;
  triggers: string[];
  objects: { key: string; contentType: string; data: string; sha256: string }[];
};
async function list(bucket: string) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await storage.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    keys.push(...(page.Contents || []).map((o) => o.Key!));
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}
try {
  if (mode === 'backup') {
    const result = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'mysql',
        'sh',
        '-c',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --set-gtid-purged=OFF --no-tablespaces "$1"',
        'sh',
        sourceDatabase,
      ],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
    );
    if (result.status !== 0) throw new Error('Database backup failed');
    const objects: Archive['objects'] = [];
    let size = Buffer.byteLength(result.stdout);
    let keys: string[];
    try {
      keys = await list(sourceBucket);
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
        throw error;
      keys = [];
    }
    if (keys.length > 5000)
      throw new Error('Use a streaming managed backup for more than 5,000 objects');
    for (const objectKey of keys) {
      const value = await storage.send(
        new GetObjectCommand({ Bucket: sourceBucket, Key: objectKey, ChecksumMode: 'ENABLED' }),
      );
      const body = Buffer.from(await value.Body!.transformToByteArray());
      size += body.length;
      if (size > 100 * 1024 * 1024)
        throw new Error(
          'Local recovery bundle is limited to 100 MiB; use a streaming managed backup',
        );
      objects.push({
        key: objectKey,
        contentType: value.ContentType || 'application/octet-stream',
        data: body.toString('base64'),
        sha256: sha(body),
      });
    }
    const archive: Archive = {
      version: 1,
      createdAt: new Date().toISOString(),
      fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY!,
      sql: result.stdout,
      summary: JSON.parse(mysql(sourceDatabase, summarySql)),
      triggers: mysql(
        'yardhrms',
        'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME',
      )
        .split('\n')
        .filter(Boolean),
      objects,
    };
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv),
      data = Buffer.concat([cipher.update(gzipSync(JSON.stringify(archive))), cipher.final()]);
    writeFileSync(file, Buffer.concat([Buffer.from('YARD1'), iv, cipher.getAuthTag(), data]), {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        event: 'backup.complete',
        file,
        encrypted: true,
        objects: objects.length,
        summary: archive.summary,
        localKeyFile: process.env.BACKUP_ENCRYPTION_KEY ? undefined : keyPath,
      }),
    );
  } else {
    if (!fileArg) throw new Error('Provide an encrypted backup file');
    const data = readFileSync(file);
    if (data.subarray(0, 5).toString() !== 'YARD1') throw new Error('Unknown backup format');
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(5, 17));
    decipher.setAuthTag(data.subarray(17, 33));
    const archive = JSON.parse(
      gunzipSync(Buffer.concat([decipher.update(data.subarray(33)), decipher.final()])).toString(),
    ) as Archive;
    if (archive.version !== 1 || !archive.sql || !/^[a-f0-9]{64}$/.test(archive.fieldEncryptionKey))
      throw new Error('Invalid recovery archive');
    const id = randomUUID().replaceAll('-', '').slice(0, 12),
      database = 'yardhrms_restore_' + id,
      bucket = 'yard-restore-' + id;
    let createdDb = false,
      createdBucket = false;
    try {
      mysql(
        'yardhrms',
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      createdDb = true;
      mysql(database, archive.sql);
      const summary = JSON.parse(mysql(database, summarySql));
      if (JSON.stringify(summary) !== JSON.stringify(archive.summary))
        throw new Error('Restored counts or payroll totals differ');
      const triggers = mysql(
        database,
        'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME',
      )
        .split('\n')
        .filter(Boolean);
      if (JSON.stringify(triggers) !== JSON.stringify(archive.triggers))
        throw new Error('Restored integrity triggers differ');
      await storage.send(new CreateBucketCommand({ Bucket: bucket }));
      createdBucket = true;
      for (const object of archive.objects) {
        const body = Buffer.from(object.data, 'base64');
        if (sha(body) !== object.sha256) throw new Error('Archive object checksum mismatch');
        await storage.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: object.key,
            Body: body,
            ContentType: object.contentType,
            ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
          }),
        );
        const restored = await storage.send(
          new GetObjectCommand({ Bucket: bucket, Key: object.key, ChecksumMode: 'ENABLED' }),
        );
        if (sha(Buffer.from(await restored.Body!.transformToByteArray())) !== object.sha256)
          throw new Error('Restored object checksum mismatch');
      }
      console.log(
        JSON.stringify({
          event: 'restore-drill.passed',
          database,
          summary,
          integrityTriggers: triggers.length,
          objectsVerified: archive.objects.length,
          originalDatabaseUnchanged: true,
        }),
      );
    } finally {
      if (createdBucket) {
        try {
          const keys = await list(bucket);
          for (let i = 0; i < keys.length; i += 1000)
            await storage.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
              }),
            );
          await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
        } finally {
          if (createdDb) mysql(sourceDatabase, `DROP DATABASE \`${database}\``);
        }
      } else if (createdDb) mysql(sourceDatabase, `DROP DATABASE \`${database}\``);
    }
  }
} finally {
  storage.destroy();
}
