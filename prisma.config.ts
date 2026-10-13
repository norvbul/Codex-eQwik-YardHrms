import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed/index.ts' },
  engine: 'classic',
  datasource: { url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL! },
});
