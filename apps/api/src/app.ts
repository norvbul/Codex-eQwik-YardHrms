import './core.js';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { RedisRateStore } from './rate-limits.js';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError, db, check, jobs } from './core.js';
import { files } from './files.js';
import { identity } from './identity.js';
import { licensing } from './licensing.js';
import { payslips } from './payslips.js';
import { payroll } from './payroll.js';
import { reports } from './reports.js';
import { imports } from './imports.js';
import { leave } from './leave.js';
import { time } from './time.js';
import { employees } from './employees.js';
import { configurationReview } from './configuration-review.js';
import { masterData } from './master-data.js';
import { foundation } from './foundation.js';
import { platformFoundation } from './platform.js';
import { apiSpecification } from './openapi.js';
export const app = express();
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(
  rateLimit({
    windowMs: 60000,
    limit:
      process.env.YARD_ISOLATED_TESTS === 'true' && process.env.NODE_ENV !== 'production'
        ? 10000
        : 120,
    store: new RedisRateStore((process.env.QUEUE_NAMESPACE || 'yard') + ':rate:api:'),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Retry shortly.' } },
  }),
);
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use((req, _res, next) => {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin'),
        allowed = (process.env.APP_ORIGINS || '').split(',');
      if (process.env.NODE_ENV === 'production')
        check(origin, 403, 'ORIGIN_REQUIRED', 'Browser origin required');
      if (origin)
        check(allowed.includes(origin), 403, 'ORIGIN_DENIED', 'Request origin is not permitted');
    }
    next();
  } catch (e) {
    next(e);
  }
});
app.get('/api/v1/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  const redis = await jobs.client;
  await redis.info();
  res.json({ data: { status: 'ok', database: 'mysql', queue: 'redis' } });
});
app.get('/api/v1/openapi.json', (_req, res) => res.json(apiSpecification));
app.use(
  '/api/v1/auth',
  rateLimit({
    windowMs: 60000,
    limit: 20,
    store: new RedisRateStore((process.env.QUEUE_NAMESPACE || 'yard') + ':rate:auth:'),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'AUTH_RATE_LIMIT',
        message: 'Too many authentication attempts. Wait a minute.',
      },
    },
  }),
);
app.use(
  '/api/v1',
  identity,
  foundation,
  employees,
  masterData,
  configurationReview,
  leave,
  time,
  imports,
  reports,
  files,
  payroll,
  payslips,
  licensing,
  platformFoundation,
);
app.use((_req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }),
);
app.use(
  (error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(422).json({
        error: {
          code: 'VALIDATION',
          message: 'Please check the form fields',
          issues: error.issues,
          requestId: req.requestId,
        },
      });
      return;
    }
    if (error instanceof ApiError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message, requestId: req.requestId } });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const conflict = ['P2002', 'P2034'].includes(error.code);
      res.status(conflict ? 409 : 400).json({
        error: {
          code: conflict ? 'CONFLICT' : 'DATABASE_CONSTRAINT',
          message: conflict
            ? 'This record conflicts with an existing record. Reload and retry.'
            : 'A related record is invalid or unavailable.',
          requestId: req.requestId,
        },
      });
      return;
    }
    console.error(
      JSON.stringify({
        event: 'request.failed',
        requestId: req.requestId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed. Contact support with the request ID.',
        requestId: req.requestId,
      },
    });
  },
);
