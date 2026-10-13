import { Router } from 'express';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import { z } from 'zod';
import { registerSchema, loginSchema, passwordSchema } from '../../../packages/types/src/index.js';
import { requiresMfa, subscriptionState } from '../../../packages/authorization/src/index.js';
import { initializeMasterData } from './master-data.js';
import { createTenantRoles } from '../../../prisma/seed/index.js';
import {
  db,
  auth,
  check,
  hash,
  random,
  encrypt,
  decrypt,
  audit,
  publicContext,
  sendMail,
  now,
  tenant,
  writeTenant,
  requireMfa,
} from './core.js';
import type { Request, Response } from 'express';
export const identity = Router();
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 12 * 3600000,
};
const totp = (secret: string, email: string) =>
  new OTPAuth.TOTP({
    issuer: 'eQwik YardHRMS',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
async function tokenMail(
  user: { id: string; email: string; name: string },
  kind: string,
  portal = 'hrms',
) {
  const token = random();
  await db.authToken.create({
    data: { userId: user.id, hash: hash(token), kind, expiresAt: new Date(Date.now() + 3600000) },
  });
  const url =
    (portal === 'platform' ? process.env.QWIK_URL : process.env.HRMS_URL) ||
    'http://localhost:5173';
  await sendMail(
    user.email,
    kind === 'VERIFY' ? 'Verify your YardHRMS email' : 'Reset your YardHRMS password',
    `Hello ${user.name},\n\nOpen ${url}/${kind === 'VERIFY' ? 'verify-email' : 'reset-password'}?token=${token}\n\nThis link expires in one hour. If you did not request it, ignore this message.`,
  );
}
export async function newCompany(
  tx: Parameters<typeof createTenantRoles>[0],
  userId: string,
  companyName: string,
  actorUserId = userId,
) {
  const free = await tx.plan.findUniqueOrThrow({
    where: { code: 'FREE' },
    include: { product: true },
  });
  check(
    free.product?.code === 'YARD_HRMS',
    503,
    'FREE_UNAVAILABLE',
    'Free plan must belong to YardHRMS',
  );
  check(free.active, 503, 'FREE_UNAVAILABLE', 'Free registration is currently unavailable');
  const t = await tx.tenant.create({
    data: {
      legalName: companyName,
      displayName: companyName,
      slug:
        companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 70) +
        '-' +
        random().slice(0, 10),
    },
  });
  const member = await tx.membership.create({ data: { tenantId: t.id, userId } });
  await createTenantRoles(tx, t.id, member.id);
  const subscription = await tx.subscription.create({
    data: {
      tenantId: t.id,
      planId: free.id,
      status: 'FREE',
      employeeLimit: free.employeeLimit,
      userLimit: free.userLimit,
      features: free.features!,
    },
  });
  await tx.license.create({
    data: {
      tenantId: t.id,
      subscriptionId: subscription.id,
      status: 'FREE',
      employeeLimit: free.employeeLimit,
      userLimit: free.userLimit,
    },
  });
  await tx.subscriptionEvent.create({
    data: {
      tenantId: t.id,
      actorId: actorUserId,
      kind: 'FREE_CREATED',
      details: { planId: free.id, employeeLimit: free.employeeLimit, userLimit: free.userLimit },
    },
  });
  await audit(
    tx,
    publicContext(actorUserId, t.id),
    'platform.subscription.free_created',
    subscription.id,
    { planId: free.id },
  );
  for (const name of [
    'Vacation',
    'Sick',
    'Maternity',
    'Compassionate',
    'Unpaid',
    'Study',
    'Special',
  ])
    await tx.leaveType.create({
      data: { tenantId: t.id, name, paidFraction: name === 'Unpaid' ? '0' : '1' },
    });
  await initializeMasterData(tx, t.id);
  await audit(tx, publicContext(actorUserId, t.id), 'tenant.registered', t.id, { plan: 'FREE' });
  return t;
}
identity.post('/auth/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  check(
    !(await db.user.findUnique({ where: { email: body.email } })),
    409,
    'EMAIL_EXISTS',
    'This email is already registered. Sign in or reset your password.',
  );
  const passwordHash = await argon2.hash(body.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { name: body.name, email: body.email, passwordHash } });
    await newCompany(tx, u.id, body.companyName);
    return u;
  });
  await tokenMail(user, 'VERIFY');
  res.status(201).json({
    data: {
      message: 'Check your email to verify your account. Your company has a Free subscription.',
    },
  });
});
identity.post('/auth/verify-email', async (req, res) => {
  const { token } = z
    .object({ token: z.string().min(20).max(200) })
    .strict()
    .parse(req.body);
  await db.$transaction(async (tx) => {
    const t = await tx.authToken.findUnique({ where: { hash: hash(token) } });
    check(
      t && t.kind === 'VERIFY' && !t.usedAt && t.expiresAt > now(),
      400,
      'INVALID_TOKEN',
      'This verification link is invalid or expired',
    );
    const used = await tx.authToken.updateMany({
      where: { id: t.id, usedAt: null },
      data: { usedAt: now() },
    });
    check(used.count === 1, 400, 'INVALID_TOKEN', 'This verification link has been used');
    await tx.user.update({ where: { id: t.userId }, data: { verifiedAt: now() } });
    await audit(tx, publicContext(t.userId), 'auth.email_verified', t.userId);
  });
  res.json({ data: { message: 'Email verified. You can now sign in.' } });
});
identity.post('/auth/resend-verification', async (req, res) => {
  const { email } = z.object({ email: z.email() }).parse(req.body);
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user && !user.verifiedAt) await tokenMail(user, 'VERIFY');
  res.json({ data: { message: 'If verification is needed, an email has been sent.' } });
});
identity.post('/auth/forgot-password', async (req, res) => {
  const { email, portal } = z
    .object({ email: z.email(), portal: z.enum(['hrms', 'platform']).default('hrms') })
    .parse(req.body);
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user && user.active) await tokenMail(user, 'RESET', portal);
  res.json({
    data: { message: 'If this account exists, password reset instructions have been sent.' },
  });
});
identity.post('/auth/reset-password', async (req, res) => {
  const { token, password } = z
    .object({ token: z.string().min(20).max(200), password: passwordSchema })
    .strict()
    .parse(req.body);
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });
  await db.$transaction(async (tx) => {
    const t = await tx.authToken.findUnique({ where: { hash: hash(token) } });
    check(
      t &&
        ['RESET', 'INVITE', 'PLATFORM_INVITE'].includes(t.kind) &&
        !t.usedAt &&
        t.expiresAt > now(),
      400,
      'INVALID_TOKEN',
      'This reset link is invalid or expired',
    );
    const used = await tx.authToken.updateMany({
      where: { id: t.id, usedAt: null },
      data: { usedAt: now() },
    });
    check(used.count === 1, 400, 'INVALID_TOKEN', 'This reset link has been used');
    await tx.user.update({
      where: { id: t.userId },
      data: { passwordHash, ...(t.kind !== 'RESET' ? { verifiedAt: now() } : {}) },
    });
    await tx.session.deleteMany({ where: { userId: t.userId } });
    await audit(tx, publicContext(t.userId, t.tenantId), 'auth.password_reset', t.userId);
  });
  res.json({ data: { message: 'Password set. Sign in with your new password.' } });
});
async function openSession(
  req: Request,
  res: Response,
  userId: string,
  tenantId: string | null,
  mfaVerified = false,
) {
  const token = random(),
    csrf = random();
  if (req.cookies?.yard_session)
    await db.session.deleteMany({ where: { tokenHash: hash(req.cookies.yard_session) } });
  await db.session.create({
    data: {
      userId,
      tenantId,
      mfaVerified,
      tokenHash: hash(token),
      csrfHash: hash(csrf),
      expiresAt: new Date(Date.now() + 12 * 3600000),
    },
  });
  res.cookie('yard_session', token, cookieOptions);
  res.cookie('yard_csrf', csrf, { ...cookieOptions, httpOnly: false });
}
identity.post('/auth/login', async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await db.user.findUnique({
    where: { email: body.email },
    include: { memberships: { where: { active: true } } },
  });
  const dummy =
    '$argon2id$v=19$m=65536,t=3,p=4$9sk56jhmhhWP1vaLtLR3hQ$lw6DNaM/vEq2iHzcxTyuEROS3niDZcm31nDlFu/TsAY';
  const valid = await argon2.verify(user?.passwordHash || dummy, body.password).catch(() => false);
  check(user && user.active && valid, 401, 'INVALID_LOGIN', 'Email or password is incorrect');
  check(user.verifiedAt, 403, 'EMAIL_UNVERIFIED', 'Verify your email before signing in');
  check(
    body.portal !== 'platform' || user.platformRole,
    403,
    'PLATFORM_ONLY',
    'This account is not a Qwik platform account',
  );
  const tid = body.portal === 'platform' ? null : user.memberships[0]?.tenantId || null;
  await openSession(req, res, user.id, tid);
  await audit(db, publicContext(user.id, tid), 'auth.login', user.id, { portal: body.portal });
  res.json({ data: { message: 'Signed in' } });
});
identity.use(auth);
identity.get('/me', async (req, res) => {
  const c = req.ctx,
    user = await db.user.findUniqueOrThrow({
      where: { id: c.userId },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        memberships: {
          where: { active: true },
          select: { tenantId: true, tenant: { select: { displayName: true } } },
        },
      },
    });
  const company = c.tenantId ? await db.tenant.findUnique({ where: { id: c.tenantId } }) : null;
  const subscription = c.tenantId
    ? await db.subscription.findUnique({ where: { tenantId: c.tenantId }, include: { plan: true } })
    : null;
  res.json({
    data: {
      user: { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole },
      memberships: user.memberships,
      tenant: company,
      roles: c.roles,
      permissions: [...c.permissions],
      employeeId: c.employeeId,
      csrfToken: c.csrfToken,
      mfaRequired:
        (requiresMfa(c.roles, c.platformRole, [...c.permissions]) || c.mfaEnabled) &&
        !c.mfaVerified,
      mfaEnabled: c.mfaEnabled,
      subscription: subscription
        ? { ...subscription, status: subscriptionState(subscription) }
        : null,
    },
  });
});
identity.post('/auth/logout', async (req, res) => {
  await db.session.delete({ where: { id: req.ctx.sessionId } });
  res.clearCookie('yard_session', cookieOptions);
  res.clearCookie('yard_csrf', { ...cookieOptions, httpOnly: false });
  res.json({ data: { message: 'Signed out' } });
});
identity.post('/auth/mfa/setup', async (req, res) => {
  check(!req.ctx.mfaEnabled, 409, 'MFA_ALREADY_ENABLED', 'MFA is already configured');
  const u = await db.user.findUniqueOrThrow({ where: { id: req.ctx.userId } });
  const secret = u.mfaSecret
    ? decrypt<string>(u.mfaSecret)
    : new OTPAuth.Secret({ size: 20 }).base32;
  if (!u.mfaSecret)
    await db.user.update({ where: { id: u.id }, data: { mfaSecret: encrypt(secret) } });
  res.json({ data: { secret, uri: totp(secret, u.email).toString() } });
});
identity.post('/auth/mfa/verify', async (req, res) => {
  const { code } = z
    .object({ code: z.string().regex(/^\d{6}$/) })
    .strict()
    .parse(req.body);
  const u = await db.user.findUniqueOrThrow({ where: { id: req.ctx.userId } });
  check(u.mfaSecret, 400, 'MFA_NOT_CONFIGURED', 'Set up an authenticator first');
  check(
    totp(decrypt<string>(u.mfaSecret), u.email).validate({ token: code, window: 1 }) !== null,
    400,
    'INVALID_MFA',
    'Authenticator code is invalid',
  );
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
    await tx.session.update({ where: { id: req.ctx.sessionId }, data: { mfaVerified: true } });
    await audit(tx, req.ctx, 'auth.mfa_verified', u.id);
  });
  res.json({ data: { message: 'Authenticator verified' } });
});
identity.post('/auth/switch-tenant', async (req, res) => {
  const { tenantId } = z.object({ tenantId: z.uuid() }).strict().parse(req.body);
  check(
    await db.membership.findFirst({ where: { tenantId, userId: req.ctx.userId, active: true } }),
    403,
    'MEMBERSHIP_REQUIRED',
    'No active membership for this company',
  );
  await openSession(req, res, req.ctx.userId, tenantId, req.ctx.mfaVerified);
  res.json({ data: { message: 'Company selected' } });
});
identity.post('/tenants', async (req, res) => {
  requireMfa(req);
  const { companyName } = z
    .object({ companyName: z.string().min(2).max(191) })
    .strict()
    .parse(req.body);
  const t = await db.$transaction((tx) => newCompany(tx, req.ctx.userId, companyName));
  await openSession(req, res, req.ctx.userId, t.id, req.ctx.mfaVerified);
  res.status(201).json({ data: t });
});
identity.get('/users', async (req, res) => {
  const tid = tenant(req, 'users.write');
  const users = await db.membership.findMany({
    where: { tenantId: tid },
    include: {
      user: { select: { id: true, email: true, name: true, verifiedAt: true } },
      roles: { include: { role: { select: { id: true, name: true } } } },
    },
  });
  res.json({ data: users });
});
identity.get('/roles', async (req, res) => {
  const tid = tenant(req, 'users.write');
  res.json({
    data: await db.role.findMany({ where: { tenantId: tid }, include: { permissions: true } }),
  });
});
identity.post('/users/invite', async (req, res) => {
  const b = z
    .object({
      email: z.email().transform((s) => s.toLowerCase()),
      name: z.string().min(2).max(191),
      roleId: z.uuid(),
      employeeId: z.uuid().nullable().optional(),
    })
    .strict()
    .parse(req.body);
  const passwordHash = await argon2.hash(random(), { type: argon2.argon2id });
  const token = random();
  const member = await writeTenant(req, 'users.write', undefined, async (tx, tid) => {
    const s = await tx.subscription.findUniqueOrThrow({ where: { tenantId: tid } });
    check(
      (await tx.membership.count({ where: { tenantId: tid, active: true } })) < s.userLimit,
      409,
      'USER_LIMIT',
      'The active-user capacity has been reached',
    );
    const role = await tx.role.findUnique({
      where: { tenantId_id: { tenantId: tid, id: b.roleId } },
    });
    check(role, 400, 'INVALID_ROLE', 'Role must belong to this company');
    if (b.employeeId)
      check(
        await tx.employee.findUnique({
          where: { tenantId_id: { tenantId: tid, id: b.employeeId } },
        }),
        400,
        'INVALID_EMPLOYEE',
        'Employee must belong to this company',
      );
    const user = await tx.user.upsert({
      where: { email: b.email },
      update: {},
      create: { email: b.email, name: b.name, passwordHash },
    });
    check(
      !(await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: tid, userId: user.id } },
      })),
      409,
      'ALREADY_MEMBER',
      'This user already has a membership',
    );
    const m = await tx.membership.create({
      data: {
        tenantId: tid,
        userId: user.id,
        employeeId: b.employeeId,
        roles: { create: { role: { connect: { tenantId_id: { tenantId: tid, id: role.id } } } } },
      },
    });
    if (!user.verifiedAt)
      await tx.authToken.create({
        data: {
          userId: user.id,
          tenantId: tid,
          roleName: role.name,
          kind: 'INVITE',
          hash: hash(token),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    await audit(tx, req.ctx, 'user.invited', m.id, { email: b.email, role: role.name });
    return { member: m, verified: Boolean(user.verifiedAt) };
  });
  await sendMail(
    b.email,
    'YardHRMS company invitation',
    member.verified
      ? `You have been invited to a company. Sign in at ${process.env.HRMS_URL}`
      : `Set your password: ${process.env.HRMS_URL}/reset-password?token=${token}`,
  );
  res.status(201).json({ data: member.member });
});
identity.patch('/users/:id', async (req, res) => {
  const b = z
    .object({
      active: z.boolean(),
      roleIds: z.array(z.uuid()).min(1).max(10),
      employeeId: z.uuid().nullable(),
    })
    .strict()
    .parse(req.body);
  const data = await writeTenant(req, 'users.write', undefined, async (tx, tid) => {
    const id = String(req.params.id),
      m = await tx.membership.findUnique({ where: { tenantId_id: { tenantId: tid, id } } });
    check(m, 404, 'NOT_FOUND', 'Membership not found');
    if (m.userId === req.ctx.userId) {
      const assigned = await tx.membershipRole.findMany({
        where: { tenantId: tid, membershipId: id },
      });
      check(
        b.active === m.active &&
          assigned.length === b.roleIds.length &&
          assigned.every((r) => b.roleIds.includes(r.roleId)),
        400,
        'SELF_MEMBERSHIP',
        'You cannot deactivate yourself or change your own roles',
      );
    }
    const roles = await tx.role.findMany({ where: { tenantId: tid, id: { in: b.roleIds } } });
    check(
      roles.length === new Set(b.roleIds).size,
      400,
      'INVALID_ROLE',
      'Roles must belong to this company',
    );
    if (b.active && !m.active) {
      const s = await tx.subscription.findUniqueOrThrow({ where: { tenantId: tid } });
      check(
        (await tx.membership.count({ where: { tenantId: tid, active: true } })) < s.userLimit,
        409,
        'USER_LIMIT',
        'Active-user capacity reached',
      );
    }
    if (b.employeeId)
      check(
        await tx.employee.findUnique({
          where: { tenantId_id: { tenantId: tid, id: b.employeeId } },
        }),
        400,
        'INVALID_EMPLOYEE',
        'Employee must belong to this company',
      );
    await tx.membershipRole.deleteMany({ where: { tenantId: tid, membershipId: id } });
    for (const roleId of b.roleIds)
      await tx.membershipRole.create({ data: { tenantId: tid, membershipId: id, roleId } });
    await tx.session.deleteMany({ where: { userId: m.userId, tenantId: tid } });
    const after = await tx.membership.update({
      where: { id },
      data: { active: b.active, employeeId: b.employeeId },
    });
    await audit(tx, req.ctx, 'user.updated', id, { active: b.active, roleIds: b.roleIds });
    return after;
  });
  res.json({ data });
});
