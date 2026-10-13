import '../packages/configuration/env.js';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase } from '../packages/configuration/db.js';
const marker = '.private/manual-migration.sha256',
  migration = '202610130001_foundation';
if (process.env.NODE_ENV !== 'development')
  throw new Error('This baseline helper is only for the manually initialized development database');
if (!existsSync(marker)) {
  console.log('No manual-development baseline marker; nothing to do.');
  process.exit(0);
}
const checksum = createHash('sha256')
  .update(readFileSync(`prisma/migrations/${migration}/migration.sql`))
  .digest('hex');
if (readFileSync(marker, 'utf8').trim() !== checksum)
  throw new Error(
    'Initial migration changed after manual application. Review and reconcile before baselining.',
  );
const db = createDatabase();
try {
  const history = await db.$queryRaw<
    { n: bigint }[]
  >`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='_prisma_migrations'`;
  if (Number(history[0].n) > 0) {
    console.log('Prisma migration history already exists; marker removed.');
    unlinkSync(marker);
  } else {
    const tenantTable = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Tenant'`;
    if (Number(tenantTable[0].n) === 0)
      throw new Error('Expected initialized development schema is missing');
    // Require Prisma itself to prove equivalence before recording an applied baseline.
    const diff = spawnSync(
      'npx',
      [
        '--no-install',
        'prisma',
        'migrate',
        'diff',
        '--from-schema-datasource',
        'prisma/schema.prisma',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { stdio: 'inherit' },
    );
    if (diff.status !== 0)
      throw new Error('Schema equivalence is unverified or drift exists; no baseline was recorded');
    const resolve = spawnSync(
      'npx',
      ['--no-install', 'prisma', 'migrate', 'resolve', '--applied', migration],
      { stdio: 'inherit' },
    );
    if (resolve.status !== 0) throw new Error('Prisma baseline was not confirmed');
    unlinkSync(marker);
    console.log('Prisma verified and recorded the development baseline.');
  }
} finally {
  await db.$disconnect();
}
