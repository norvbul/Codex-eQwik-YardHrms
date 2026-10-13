import '../../../packages/configuration/env.js';
import { Prisma } from '@prisma/client';
import { createDatabase } from '../../../packages/configuration/db.js';
import {
  createHash,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Queue } from 'bullmq';
import {
  canWriteSubscription,
  requiresMfa,
  subscriptionState,
} from '../../../packages/authorization/src/index.js';
export const db = createDatabase();
export const now = () => new Date();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function check(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
const key = Buffer.from(process.env.FIELD_ENCRYPTION_KEY || '', 'hex');
check(key.length === 32, 500, 'CONFIGURATION', 'FIELD_ENCRYPTION_KEY must be a 32-byte hex key');
export function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decrypt<T>(s: string): T {
  const data = Buffer.from(s, 'base64'),
    decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
  ) as T;
}
export const redisUrl = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
export const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
};
export const jobs = new Queue((process.env.QUEUE_NAMESPACE || 'yard') + '-jobs', {
  connection: redisConnection,
});
export async function sendMail(to: string, subject: string, text: string) {
  await jobs.add(
    'email',
    { to, subject, text },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}
export type Tx = Prisma.TransactionClient;
export type Context = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  platformRole: string | null;
  tenantId: string | null;
  roles: string[];
  permissions: Set<string>;
  approvalScopes: Record<string, string>;
  employeeId: string | null;
  mfaVerified: boolean;
  mfaEnabled: boolean;
  csrfToken: string;
  requestId: string;
};
declare global {
  namespace Express {
    interface Request {
      ctx: Context;
      requestId: string;
    }
  }
}
export async function audit(
  tx: Tx,
  ctx: { tenantId: string | null; userId: string | null; requestId: string },
  action: string,
  entityId: string | null,
  details: Prisma.InputJsonValue = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action,
      scope: action.startsWith('platform.') ? 'PLATFORM' : 'TENANT',
      entityId,
      details,
      requestId: ctx.requestId,
    },
  });
}
export async function auth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.yard_session;
    check(typeof token === 'string', 401, 'UNAUTHENTICATED', 'Sign in to continue');
    const session = await db.session.findUnique({
      where: { tokenHash: hash(token) },
      include: {
        user: {
          include: {
            memberships: {
              where: { active: true },
              include: { roles: { include: { role: { include: { permissions: true } } } } },
            },
          },
        },
      },
    });
    const idle = Number(process.env.SESSION_IDLE_MINUTES || 30) * 60000;
    check(
      session &&
        session.user.active &&
        session.expiresAt > now() &&
        session.lastSeenAt.getTime() + idle > Date.now(),
      401,
      'SESSION_EXPIRED',
      'Your session expired. Sign in again.',
    );
    check(session.user.verifiedAt, 403, 'EMAIL_UNVERIFIED', 'Verify your email before signing in');
    const membership = session.user.memberships.find((m) => m.tenantId === session.tenantId);
    if (session.tenantId)
      check(membership, 403, 'MEMBERSHIP_INACTIVE', 'Company access is inactive');
    const roles = membership?.roles.map((m) => m.role.name) || [];
    const csrf = req.cookies.yard_csrf || '';
    const approvalScopes: Record<string, string> = {};
    for (const assignment of membership?.roles || [])
      for (const p of assignment.role.permissions)
        if (p.permissionCode.endsWith('.approve') || p.permissionCode === 'payroll.review') {
          if (approvalScopes[p.permissionCode] !== 'TENANT')
            approvalScopes[p.permissionCode] = assignment.role.approvalScope;
        }
    req.ctx = {
      sessionId: session.id,
      userId: session.userId,
      name: session.user.name,
      email: session.user.email,
      platformRole: session.user.platformRole,
      tenantId: session.tenantId,
      roles,
      permissions: new Set(
        membership?.roles.flatMap((m) => m.role.permissions.map((p) => p.permissionCode)) || [],
      ),
      approvalScopes,
      employeeId: membership?.employeeId || null,
      mfaVerified: session.mfaVerified,
      mfaEnabled: session.user.mfaEnabled,
      csrfToken: csrf,
      requestId: req.requestId,
    };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const supplied = req.get('x-csrf-token') || '';
      check(
        supplied.length > 0 &&
          timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(session.csrfHash)),
        403,
        'CSRF',
        'Reload the page and retry',
      );
    }
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now() } });
    next();
  } catch (e) {
    next(e);
  }
}
export function requireMfa(req: Request) {
  check(
    !(
      requiresMfa(req.ctx.roles, req.ctx.platformRole, [...req.ctx.permissions]) ||
      req.ctx.mfaEnabled
    ) || req.ctx.mfaVerified,
    403,
    'MFA_REQUIRED',
    'Set up and verify multi-factor authentication to continue',
  );
}
export function tenant(req: Request, permission?: string) {
  requireMfa(req);
  check(req.ctx.tenantId, 403, 'TENANT_REQUIRED', 'Select an active company');
  if (permission)
    check(
      req.ctx.permissions.has(permission),
      403,
      'PERMISSION_DENIED',
      'Your role does not allow this action',
    );
  return req.ctx.tenantId;
}
export function platform(req: Request, superOnly = false) {
  requireMfa(req);
  check(
    req.ctx.platformRole &&
      (superOnly
        ? req.ctx.platformRole === 'PLATFORM_SUPER_ADMIN'
        : ['PLATFORM_SUPER_ADMIN', 'PLATFORM_LICENSING_OFFICER'].includes(req.ctx.platformRole)),
    403,
    'PLATFORM_ONLY',
    'Qwik staff access required',
  );
}
export async function entitlement(tx: Tx, tenantId: string, feature?: string, write = false) {
  const s = await tx.subscription.findUnique({ where: { tenantId } });
  check(s, 403, 'NO_SUBSCRIPTION', 'No subscription is configured');
  check(
    !['SUSPENDED', 'REVOKED', 'PENDING'].includes(subscriptionState(s)),
    403,
    'SUBSCRIPTION_BLOCKED',
    'Contact Qwik about your subscription',
  );
  if (write)
    check(
      canWriteSubscription(s),
      403,
      'SUBSCRIPTION_READ_ONLY',
      'This subscription is read-only. Historical records remain available.',
    );
  if (feature)
    check(
      Array.isArray(s.features) && s.features.includes(feature),
      403,
      'FEATURE_UNAVAILABLE',
      `Your plan does not include ${feature}`,
    );
  return s;
}
export async function writeTenant<T>(
  req: Request,
  permission: string,
  feature: string | undefined,
  fn: (tx: Tx, tid: string) => Promise<T>,
) {
  const tid = tenant(req, permission);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tid} FOR UPDATE`;
      const fresh = await refreshTenantActor(tx, req, tid);
      check(
        fresh.permissions.has(permission),
        403,
        'PERMISSION_DENIED',
        'Your permission for this action was removed',
      );
      await entitlement(tx, tid, feature, true);
      return fn(tx, tid);
    },
    { timeout: 20000 },
  );
}
export const publicContext = (userId: string | null, tenantId: string | null = null) => ({
  userId,
  tenantId,
  requestId: randomUUID(),
});
export const day = (s: string) => new Date(s + 'T00:00:00.000Z');
export const pagination = (req: Request) => {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  check(
    Number.isSafeInteger(page) && page >= 1 && page <= 100000,
    422,
    'PAGINATION',
    'Page must be an integer from 1 to 100000',
  );
  return { skip: (page - 1) * 25, take: 25 };
};
export function actorScope(req: Request, kind: string, employeeId: string) {
  check(
    req.ctx.permissions.has(`${kind}.submit.any`) ||
      (req.ctx.permissions.has(`${kind}.submit.self`) && req.ctx.employeeId === employeeId),
    403,
    'SUBJECT_DENIED',
    'You cannot submit for this employee',
  );
}
export async function employeeScope(tx: Tx, tenantId: string, id: string) {
  const e = await tx.employee.findUnique({ where: { tenantId_id: { tenantId, id } } });
  check(e, 404, 'NOT_FOUND', 'Employee not found');
  return e;
}
export async function approvalScope(
  tx: Tx,
  req: Request,
  employeeId: string,
  submittedBy: string,
  permission = 'leave.approve',
) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: req.ctx.tenantId! } });
  check(
    t.allowSelfApproval || (submittedBy !== req.ctx.userId && employeeId !== req.ctx.employeeId),
    403,
    'SELF_APPROVAL',
    'A different authorized reviewer must approve this submission',
  );
  if (req.ctx.approvalScopes[permission] === 'TEAM') {
    const own = req.ctx.employeeId;
    const e = await employeeScope(tx, t.id, employeeId);
    check(
      own && e.managerId === own,
      403,
      'APPROVAL_SCOPE',
      'Managers may approve only their direct reports',
    );
  }
}
export async function companyToday(tx: Tx, tenantId: string) {
  const company = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  });
  return day(new Intl.DateTimeFormat('en-CA', { timeZone: company.timezone }).format(new Date()));
}
export async function loadTenantActor(
  tx: Tx,
  tenantId: string,
  userId: string,
  requestId: string = randomUUID(),
): Promise<Context> {
  const member = await tx.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    include: { user: true, roles: { include: { role: { include: { permissions: true } } } } },
  });
  check(
    member?.active && member.user.active && member.user.verifiedAt,
    403,
    'ACTOR_INACTIVE',
    'This company membership is no longer active',
  );
  const permissions = new Set(
      member.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)),
    ),
    approvalScopes: Record<string, string> = {};
  check(
    !requiresMfa(
      member.roles.map((r) => r.role.name),
      member.user.platformRole,
      [...permissions],
    ) || member.user.mfaEnabled,
    403,
    'MFA_REQUIRED',
    'Privileged job authority requires enrolled MFA',
  );
  for (const assigned of member.roles)
    for (const p of assigned.role.permissions)
      if (p.permissionCode.endsWith('.approve') || p.permissionCode === 'payroll.review')
        if (approvalScopes[p.permissionCode] !== 'TENANT')
          approvalScopes[p.permissionCode] = assigned.role.approvalScope;
  return {
    tenantId,
    userId,
    name: member.user.name,
    email: member.user.email,
    platformRole: member.user.platformRole,
    roles: member.roles.map((r) => r.role.name),
    permissions,
    approvalScopes,
    employeeId: member.employeeId,
    mfaEnabled: member.user.mfaEnabled,
    mfaVerified: false,
    csrfToken: '',
    sessionId: '',
    requestId,
  };
}

export async function refreshTenantActor(tx: Tx, req: Request, tenantId: string) {
  const fresh = await loadTenantActor(tx, tenantId, req.ctx.userId, req.ctx.requestId),
    session = await tx.session.findUnique({ where: { id: req.ctx.sessionId } });
  check(
    session &&
      session.userId === fresh.userId &&
      session.tenantId === tenantId &&
      session.expiresAt > now(),
    401,
    'SESSION_REVOKED',
    'Your session was revoked. Sign in again.',
  );
  req.ctx = {
    ...fresh,
    sessionId: session.id,
    csrfToken: req.ctx.csrfToken,
    mfaVerified: session.mfaVerified,
  };
  requireMfa(req);
  return req.ctx;
}
