import '../packages/configuration/env.js';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { Queue } from 'bullmq';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
const mode = process.argv[2];
if (!['integration', 'e2e', 'recovery'].includes(mode))
  throw new Error('Choose integration, e2e or recovery');
const database = 'yardhrms_test_' + randomUUID().replaceAll('-', '').slice(0, 12),
  namespace = database;
const url = new URL(process.env.DATABASE_URL!);
if (
  process.env.NODE_ENV !== 'development' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/yardhrms'
)
  throw new Error(
    'The isolated test runner is restricted to the local development Docker database',
  );
url.pathname = '/' + database;
const migration = new URL(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL!);
migration.pathname = '/' + database;
function mysql(sql: string) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'mysql',
      'sh',
      '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "$1"',
      'sh',
      sql,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error('Could not prepare isolated test database: ' + result.stderr);
}
function port() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const value = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(value));
    });
  });
}
const [apiPort, hrmsPort, qwikPort] = await Promise.all([port(), port(), port()]);
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  MIGRATION_DATABASE_URL: migration.toString(),
  QUEUE_NAMESPACE: namespace,
  S3_BUCKET: database.replaceAll('_', '-'),
  YARD_ISOLATED_TESTS: 'true',
  PORT: String(apiPort),
  HRMS_WEB_PORT: String(hrmsPort),
  QWIK_WEB_PORT: String(qwikPort),
  API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  HRMS_URL: `http://127.0.0.1:${hrmsPort}`,
  QWIK_URL: `http://127.0.0.1:${qwikPort}`,
  APP_ORIGINS: `http://127.0.0.1:${hrmsPort},http://127.0.0.1:${qwikPort}`,
};
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
let failed = false;
try {
  mysql(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO 'yard'@'%'; GRANT ALL PRIVILEGES ON \`${database}\`.* TO 'yard_migrator'@'%';`,
  );
  run('npx', ['--no-install', 'prisma', 'migrate', 'deploy']);
  run('npx', ['--no-install', 'tsx', 'prisma/seed/index.ts']);
  if (mode === 'integration')
    run('npx', [
      '--no-install',
      'tsx',
      '--test',
      '--test-concurrency=1',
      'tests/integration/*.test.ts',
    ]);
  else if (mode === 'recovery') {
    run('npx', ['--no-install', 'tsx', 'scripts/recovery-fixture.ts']);
    const artifact = '.private/backups/' + namespace + '.yardbackup';
    run('npx', ['--no-install', 'tsx', 'scripts/recovery.ts', 'backup', artifact]);
    run('npx', ['--no-install', 'tsx', 'scripts/recovery.ts', 'restore-drill', artifact]);
  } else run('npx', ['--no-install', 'playwright', 'test']);
} catch (error) {
  failed = true;
  console.error((error as Error).message);
} finally {
  const redis = new URL(process.env.REDIS_URL!);
  const queue = new Queue(namespace + '-jobs', {
    connection: {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      password: redis.password || undefined,
    },
  });
  try {
    await queue.obliterate({ force: true });
  } catch {
    failed = true;
    console.error('Isolated test queue cleanup failed');
  } finally {
    try {
      await queue.close();
    } catch {
      failed = true;
    }
  }
  const storage = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  try {
    let token: string | undefined;
    do {
      const list = await storage.send(
        new ListObjectsV2Command({ Bucket: env.S3_BUCKET, ContinuationToken: token }),
      );
      if (list.Contents?.length)
        await storage.send(
          new DeleteObjectsCommand({
            Bucket: env.S3_BUCKET,
            Delete: { Objects: list.Contents.map((object) => ({ Key: object.Key! })) },
          }),
        );
      token = list.NextContinuationToken;
    } while (token);
    await storage.send(new DeleteBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) {
      failed = true;
      console.error('Isolated test storage cleanup failed');
    }
  } finally {
    storage.destroy();
  }
  try {
    mysql(
      `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'yard'@'%'; REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'yard_migrator'@'%'; DROP DATABASE \`${database}\`;`,
    );
  } catch {
    failed = true;
    console.error('Isolated test database cleanup failed');
  }
}
process.exitCode = failed ? 1 : 0;
