import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Link, Outlet, Navigate } from 'react-router-dom';
import {
  Menu,
  X,
  LayoutDashboard,
  Building2,
  Users,
  UserRound,
  CalendarDays,
  Clock3,
  Timer,
  Wallet,
  Receipt,
  FileSpreadsheet,
  BarChart3,
  ShieldCheck,
  LogOut,
  CreditCard,
  FileClock,
  Layers,
} from 'lucide-react';
import { getMe, MfaChallenge } from './auth.js';
import { post, HttpError } from './api.js';
import { Loading, Notice, Badge } from './components.js';
import type { Me } from '../../types/src/index.js';
export type SessionOutlet = { me: Me };
export function Workspace({ platform = false }: { platform?: boolean }) {
  const query = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const client = useQueryClient(),
    [open, setOpen] = useState(false);
  const switcher = useMutation({
    mutationFn: (tenantId: string) => post('/auth/switch-tenant', { tenantId }),
    onSuccess: async () => {
      await client.invalidateQueries();
      setOpen(false);
    },
  });
  useEffect(() => {
    if (query.data)
      document.title = platform
        ? 'Qwik Licence Manager'
        : query.data.tenant?.displayName + ' · eQwik YardHRMS';
  }, [platform, query.data]);
  if (query.isPending) return <Loading />;
  if (query.error) {
    if (query.error instanceof HttpError && query.error.status === 401)
      return <Navigate to="/login" replace />;
    return (
      <main className="error-page">
        <Notice tone="error">{query.error.message}</Notice>
        <Link to="/login">Return to sign in</Link>
      </main>
    );
  }
  const me = query.data;
  if (!me) return <Navigate to="/login" replace />;
  if (platform && !me.user.platformRole)
    return (
      <main className="error-page">
        <Notice tone="error">This account has no Qwik platform access.</Notice>
        <Link to="/login">Use a Qwik account</Link>
      </main>
    );
  if (me.mfaRequired) return <MfaChallenge me={me} />;
  if (!platform && !me.tenant)
    return (
      <main className="error-page">
        <Notice>Select a company membership to continue.</Notice>
      </main>
    );
  const permissions = new Set(me.permissions),
    features = new Set(me.subscription?.features || []);
  const nav = platform
    ? [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/customers', label: 'Customers', icon: Building2 },
        { to: '/plans', label: 'Plans & Features', icon: Layers },
        { to: '/payments', label: 'Manual Payments', icon: CreditCard },
        { to: '/subscriptions', label: 'Subscriptions & Licences', icon: ShieldCheck },
        { to: '/codes', label: 'Activation Codes', icon: Receipt },
        { to: '/renewals', label: 'Renewals', icon: Clock3 },
        { to: '/usage', label: 'Capacity Usage', icon: BarChart3 },
        ...(me.user.platformRole === 'PLATFORM_SUPER_ADMIN'
          ? [{ to: '/settings', label: 'Policies & Staff', icon: Users }]
          : []),
        { to: '/audit', label: 'Platform Audit', icon: FileClock },
      ]
    : [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'company.read' },
        { to: '/profile', label: 'My Profile', icon: UserRound, permission: 'company.read' },
        {
          to: '/employees',
          label: 'Employees',
          icon: Users,
          permission: 'employees.read',
          feature: 'employees',
        },
        {
          to: '/leave',
          label: 'Leave Requests',
          icon: CalendarDays,
          permission: 'company.read',
          feature: 'leave',
          actions: ['leave.submit.self', 'leave.submit.any', 'leave.approve'],
        },
        {
          to: '/leave-balances',
          label: 'Leave Balances',
          icon: CalendarDays,
          permission: 'company.read',
          feature: 'leave',
          actions: ['leave.submit.self', 'leave.submit.any', 'leave.approve'],
        },
        {
          to: '/timesheets',
          label: 'Timesheets',
          icon: Clock3,
          permission: 'company.read',
          feature: 'timesheets',
          actions: ['timesheets.submit.self', 'timesheets.submit.any', 'timesheets.approve'],
        },
        {
          to: '/overtime',
          label: 'Overtime',
          icon: Timer,
          permission: 'company.read',
          feature: 'overtime',
          actions: ['overtime.submit.self', 'overtime.submit.any', 'overtime.approve'],
        },
        {
          to: '/payroll-setup',
          label: 'Payroll Setup',
          icon: Wallet,
          permission: 'payroll.read',
          feature: 'payroll',
        },
        {
          to: '/payroll',
          label: 'Payroll Runs',
          icon: Wallet,
          permission: 'payroll.read',
          feature: 'payroll',
        },
        {
          to: '/payroll-adjustments',
          label: 'Earnings & Deductions',
          icon: Wallet,
          permission: 'payroll.read',
          feature: 'payroll',
        },
        {
          to: '/payslips',
          label: 'Payslips',
          icon: Receipt,
          permission: 'company.read',
          actions: ['payslips.read.self', 'payslips.print.any'],
        },
        {
          to: '/imports',
          label: 'Bulk Imports',
          icon: FileSpreadsheet,
          permission: 'imports.write',
          feature: 'imports',
        },
        {
          to: '/reports',
          label: 'Reports',
          icon: BarChart3,
          permission: 'reports.read',
          feature: 'reports',
        },
        { to: '/master-data', label: 'Master Data', icon: Building2, permission: 'company.write' },
        { to: '/company', label: 'Company Settings', icon: Building2, permission: 'company.write' },
        { to: '/users', label: 'Users & Roles', icon: Users, permission: 'users.write' },
        {
          to: '/subscription',
          label: 'Subscription',
          icon: CreditCard,
          permission: 'subscription.read',
        },
        {
          to: '/audit',
          label: 'Audit Log',
          icon: FileClock,
          permission: 'audit.read',
          feature: 'audit',
        },
      ].filter(
        (n) =>
          permissions.has(n.permission) &&
          (!n.feature || features.has(n.feature)) &&
          (!n.actions || n.actions.some((p) => permissions.has(p))),
      );
  const initials = me.user.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  return (
    <div
      className={'app-shell ' + (platform ? 'platform-theme' : '')}
      style={
        !platform ? ({ '--accent': me.tenant?.accentColor } as React.CSSProperties) : undefined
      }
    >
      {open && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={'sidebar ' + (open ? 'open' : '')}>
        <Link to="/dashboard" className="brand">
          <span className="brand-mark">Q</span>
          <span>
            Qwik<span className="brand-sub">BUSINESS SOLUTIONS™</span>
          </span>
        </Link>
        <div className="product-name">
          {platform ? 'LICENCE & SUBSCRIPTION MANAGER' : 'eQwik YardHRMS™'}
        </div>
        <div className="tenant-chip">
          {!platform && me.tenant?.logoUrl ? (
            <img src={me.tenant.logoUrl} alt="Company logo" />
          ) : (
            <Building2 size={18} />
          )}
          <span>{platform ? 'Qwik Administration' : me.tenant?.displayName}</span>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)}>
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ShieldCheck size={18} />
          <p>Secure company workspace</p>
          <Link to="/about">About YardHRMS</Link>
          <div className="legal-links">
            <Link to="/licence">Licence</Link>
            <Link to="/disclaimer">Disclaimer</Link>
            <Link to="/copyright">Copyright</Link>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="mobile-menu"
              aria-label={open ? 'Close navigation' : 'Open navigation'}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={21} /> : <Menu size={21} />}
            </button>
            <div>
              <span className="company-name">
                {platform ? 'Qwik Licence & Subscription Manager' : me.tenant?.displayName}
              </span>
              <small>{platform ? 'PLATFORM OPERATIONS' : 'PEOPLE & ORGANIZATION'}</small>
            </div>
          </div>
          <div className="topbar-actions">
            {!platform && me.memberships.length > 1 && (
              <div>
                <label className="sr-only" htmlFor="company-switch">
                  Active company
                </label>
                <select
                  id="company-switch"
                  className="company-select"
                  value={me.tenant?.id || ''}
                  onChange={(e) => switcher.mutate(e.target.value)}
                  disabled={switcher.isPending}
                >
                  {me.memberships.map((m) => (
                    <option key={m.tenantId} value={m.tenantId}>
                      {m.tenant.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Badge>{platform ? 'STAFF' : me.subscription?.plan.name}</Badge>
            <div className="profile">
              <span className="avatar">{initials}</span>
              <div>
                <strong>{me.user.name}</strong>
                <small>
                  {platform
                    ? me.user.platformRole?.replaceAll('_', ' ')
                    : me.roles[0]?.replaceAll('_', ' ')}
                </small>
              </div>
            </div>
            <button
              className="mobile-menu"
              style={{ display: 'inline-flex' }}
              aria-label="Sign out"
              onClick={async () => {
                await post('/auth/logout', {});
                client.clear();
                window.location.assign('/login');
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="content">
          {switcher.error && <Notice tone="error">{switcher.error.message}</Notice>}
          {!platform && me.subscription?.status === 'EXPIRED' && (
            <div className="read-only">
              Your subscription is read-only. Historical records remain available. Contact Qwik to
              renew.
            </div>
          )}
          <Outlet context={{ me } satisfies SessionOutlet} />
        </main>
      </div>
    </div>
  );
}
export function LegalPage({ page }: { page: 'about' | 'licence' | 'disclaimer' | 'copyright' }) {
  const copy = {
    about: {
      title: 'About eQwik YardHRMS™',
      text: 'eQwik YardHRMS is a company-focused human resources and payroll platform from Qwik Business Solutions™. Each organization has its own data, access controls and subscription entitlements.',
    },
    licence: {
      title: 'Licence information',
      text: 'Access is governed by the organization’s centrally managed subscription and role permissions. Free and paid feature availability and capacity are configured by Qwik. Commercial prices and binding licence terms require owner-approved publication.',
    },
    disclaimer: {
      title: 'Payroll and compliance notice',
      text: 'Jamaican payroll processing requires independently verified, effective-dated statutory configuration and accepted reference calculations. The application does not replace advice from qualified payroll or legal professionals. Production statutory processing remains subject to compliance approval.',
    },
    copyright: {
      title: 'Copyright',
      text: '© 2026 Qwik Business Solutions. All rights reserved. eQwik YardHRMS™ and Qwik Business Solutions™ are product and company marks.',
    },
  }[page];
  return (
    <main className="content legal-copy">
      <Link to="/">← YardHRMS</Link>
      <h1 style={{ marginTop: 24 }}>{copy.title}</h1>
      <p>{copy.text}</p>
      {page === 'licence' && (
        <Notice>
          Approved customer agreements, privacy notices and retention policies must be supplied
          before commercial launch.
        </Notice>
      )}
      <div className="legal-links">
        {(['about', 'licence', 'disclaimer', 'copyright'] as const).map((p) => (
          <Link key={p} to={'/' + p}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </Link>
        ))}
      </div>
    </main>
  );
}
