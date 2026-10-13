import { Router } from 'express';
import { platform, db, pagination } from './core.js';
import { subscriptionState } from '../../../packages/authorization/src/index.js';
export const platformFoundation = Router();
platformFoundation.use('/platform', (req, _res, next) => {
  try {
    platform(req);
    next();
  } catch (e) {
    next(e);
  }
});
platformFoundation.get('/platform/dashboard', async (_req, res) => {
  const [customers, subscriptions, pendingPayments, plans] = await Promise.all([
    db.tenant.count(),
    db.subscription.findMany({ select: { status: true, expiresAt: true, graceEndsAt: true } }),
    db.manualPayment.count({ where: { status: 'PENDING' } }),
    db.plan.findMany({
      select: {
        id: true,
        name: true,
        employeeLimit: true,
        userLimit: true,
        _count: { select: { subscriptions: true } },
      },
    }),
  ]);
  const [verifiedReceipts, upcomingRenewals, activeEmployees, activeUsers] = await Promise.all([
    db.manualPayment.groupBy({
      by: ['currency'],
      where: { status: 'VERIFIED' },
      _sum: { amount: true },
      _count: true,
    }),
    db.subscription.count({
      where: {
        status: { notIn: ['FREE', 'SUSPENDED', 'REVOKED'] },
        expiresAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) },
      },
    }),
    db.employee.count({ where: { active: true } }),
    db.membership.count({ where: { active: true, user: { active: true } } }),
  ]);
  const states = subscriptions.map((s) => subscriptionState(s));
  res.json({
    data: {
      customers,
      upcomingRenewals,
      activeEmployees,
      activeUsers,
      verifiedReceipts: verifiedReceipts.map((r) => ({
        currency: r.currency,
        amount: r._sum.amount?.toString() || '0',
        payments: r._count,
      })),
      freeSubscriptions: states.filter((s) => s === 'FREE').length,
      activeSubscriptions: states.filter((s) => s === 'ACTIVE').length,
      expiredSubscriptions: states.filter((s) => s === 'EXPIRED').length,
      pendingPayments,
      plans: plans.map((p) => ({ ...p, tenants: p._count.subscriptions })),
    },
  });
});
platformFoundation.get('/platform/customers', async (req, res) => {
  const where = req.query.search
    ? {
        OR: [
          { displayName: { contains: String(req.query.search).slice(0, 100) } },
          { legalName: { contains: String(req.query.search).slice(0, 100) } },
        ],
      }
    : {};
  const rows = await db.tenant.findMany({
    where,
    select: {
      id: true,
      legalName: true,
      displayName: true,
      contactEmail: true,
      status: true,
      createdAt: true,
      subscription: { include: { plan: { select: { name: true } } } },
      _count: {
        select: {
          employees: { where: { active: true } },
          memberships: { where: { active: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    ...pagination(req),
  });
  res.json({
    data: rows.map((r) => ({
      ...r,
      subscription: r.subscription
        ? { ...r.subscription, status: subscriptionState(r.subscription) }
        : null,
    })),
    total: await db.tenant.count({ where }),
  });
});
platformFoundation.get('/platform/plans', async (_req, res) =>
  res.json({ data: await db.plan.findMany({ orderBy: { employeeLimit: 'asc' } }) }),
);
platformFoundation.get('/platform/audit', async (req, res) =>
  res.json({
    data: await db.auditEvent.findMany({
      where: { scope: 'PLATFORM' },
      orderBy: { createdAt: 'desc' },
      ...pagination(req),
    }),
    total: await db.auditEvent.count({ where: { scope: 'PLATFORM' } }),
  }),
);
