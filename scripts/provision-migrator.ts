import '../packages/configuration/env.js';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const url = new URL(process.env.DATABASE_URL!);
if (
  process.env.NODE_ENV !== 'development' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/yardhrms'
)
  throw new Error(
    'Provisioning is only for the local Docker development database. Configure a dedicated migration account securely for other deployments.',
  );
const existing = process.env.MIGRATION_DATABASE_URL
  ? new URL(process.env.MIGRATION_DATABASE_URL)
  : null;
if (existing && (existing.username !== 'yard_migrator' || existing.hostname !== url.hostname)) {
  console.log('User-configured migration connection preserved.');
  process.exit(0);
}
const password = existing ? decodeURIComponent(existing.password) : randomBytes(32).toString('hex');
const sql = `CREATE USER IF NOT EXISTS 'yard_migrator'@'%' IDENTIFIED BY '${password}'; ALTER USER 'yard_migrator'@'%' IDENTIFIED BY '${password}'; GRANT ALL PRIVILEGES ON yardhrms.* TO 'yard_migrator'@'%'; GRANT SUPER ON *.* TO 'yard_migrator'@'%'; REVOKE ALL PRIVILEGES ON yardhrms.* FROM 'yard'@'%'; GRANT SELECT, INSERT, UPDATE, DELETE ON yardhrms.* TO 'yard'@'%';`;
const result = spawnSync(
  'docker',
  ['compose', 'exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'],
  { input: sql, encoding: 'utf8' },
);
if (result.status !== 0)
  throw new Error('Local migration account provisioning failed; no connection was saved.');
url.username = 'yard_migrator';
url.password = password;
if (!existing)
  appendFileSync('.env', '\nMIGRATION_DATABASE_URL=' + url.toString() + '\n', { mode: 0o600 });
console.log(
  'Provisioned a dedicated local migration account and restricted the application account to data access. Secrets remain in ignored .env.',
);
