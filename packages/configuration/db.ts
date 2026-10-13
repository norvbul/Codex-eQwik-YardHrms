import './env.js';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { readFileSync } from 'node:fs';
export function createDatabase() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.NODE_ENV === 'production' && process.env.MYSQL_SSL !== 'true')
    throw new Error('Production MySQL connections must enable verified TLS');
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionLimit: 10,
    allowPublicKeyRetrieval:
      process.env.NODE_ENV !== 'production' &&
      ['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname),
    ...(process.env.MYSQL_SSL === 'true'
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(process.env.MYSQL_SSL_CA
              ? { ca: readFileSync(process.env.MYSQL_SSL_CA, 'utf8') }
              : {}),
          },
        }
      : {}),
  });
  return new PrismaClient({ adapter });
}
