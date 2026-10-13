import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('.env already exists; preserved.');
  process.exit(0);
}
const password = randomBytes(24).toString('hex');
const rootPassword = randomBytes(24).toString('hex');
writeFileSync(
  '.env',
  `NODE_ENV=development
PORT=3000
MYSQL_PASSWORD=${password}
MYSQL_ROOT_PASSWORD=${rootPassword}
DATABASE_URL=mysql://yard:${password}@127.0.0.1:3306/yardhrms
REDIS_URL=redis://127.0.0.1:6379
FIELD_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}
APP_ORIGINS=http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174
HRMS_URL=http://localhost:5173
QWIK_URL=http://localhost:5174
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=YardHRMS <no-reply@localhost>
SESSION_IDLE_MINUTES=30
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=yardhrms-private
S3_ACCESS_KEY=yard-local
S3_SECRET_KEY=${randomBytes(24).toString('hex')}
`,
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Created ignored .env with random development credentials. Never use this file for production.',
);
