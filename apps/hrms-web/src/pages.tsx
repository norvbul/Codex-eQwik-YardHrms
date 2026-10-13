import { UserAccessDialog, RoleEditor } from './access.js';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Users,
  UserCheck,
  Clock3,
  ShieldCheck,
  Building2,
  ArrowRight,
  Activity,
  X,
  Plus,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { companySchema } from '../../../packages/types/src/index.js';
import { api, post, patch } from '../../../packages/ui/src/api.js';
import {
  Card,
  Button,
  Field,
  Notice,
  Empty,
  Loading,
  Metric,
  SectionHeading,
  Badge,
  Modal,
} from '../../../packages/ui/src/components.js';
type DashboardData = {
  employeesOnLeave: number;
  timesheetStates: { status: string; count: number }[];
  overtimeStates: { status: string; count: number; hours: string }[];
  payrollStates: { status: string; count: number }[];
  payrollMonthTotals: Record<string, string> | null;
  totalEmployees: number;
  activeEmployees: number;
  activeUsers: number;
  pendingApprovals: number;
  departments: { name: string; employees: number }[];
  subscription: { name: string; status: string; employeeLimit: number; userLimit: number };
  recentActivity: { id: string; action: string; createdAt: string }[];
};
export function Dashboard() {
  const { me } = useOutletContext<SessionOutlet>();
  const query = useQuery({
    queryKey: ['dashboard', me.tenant?.id],
    queryFn: () => api<DashboardData>('/dashboard'),
  });
  if (query.isPending)
    return <div className="skeleton" role="status" aria-label="Loading dashboard" />;
  if (query.error) return <Notice tone="error">{query.error.message}</Notice>;
  const data = query.data!;
  return (
    <>
      <SectionHeading
        eyebrow="YOUR PEOPLE, AT A GLANCE"
        title={`Welcome to ${me.tenant?.displayName}`}
        description="A connected view of your workforce, access and subscription."
        action={
          me.permissions.includes('company.write') ? (
            <Link className="button secondary" to="/company">
              <Building2 size={15} /> Manage company
            </Link>
          ) : undefined
        }
      />
      <div className="metrics">
        <Metric
          label="Total employees"
          value={data.totalEmployees}
          caption="Company workforce"
          icon={<Users size={17} />}
        />
        <Metric
          label="Active employees"
          value={data.activeEmployees}
          caption="Current employment records"
          icon={<UserCheck size={17} />}
        />
        <Metric
          label="Pending approvals"
          value={data.pendingApprovals}
          caption="Within your approval scope"
          icon={<Clock3 size={17} />}
        />
        <Metric
          label="Active users"
          value={data.activeUsers}
          caption="Authorized company access"
          icon={<ShieldCheck size={17} />}
        />
      </div>
      <div className="dashboard-grid">
        <Card>
          <div className="card-header">
            <div>
              <h2>Workforce distribution</h2>
              <p>Active employees by department</p>
            </div>
            <Badge>LIVE DATA</Badge>
          </div>
          {data.departments.some((d) => d.employees) ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.departments}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="employees" fill="#92af75" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty title="Your workforce starts here">
              There are no active department records to chart yet. Your company data will appear
              here as it grows.
            </Empty>
          )}
        </Card>
        <Card className="subscription-card">
          <div className="card-header">
            <div>
              <span className="eyebrow">YOUR SUBSCRIPTION</span>
              <h2>{data.subscription.name} workspace</h2>
            </div>
            <Badge>{data.subscription.status}</Badge>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            A clear view of your available capacity.
          </p>
          <div className="usage-line">
            <span>Active employees</span>
            <strong>
              {data.activeEmployees} / {data.subscription.employeeLimit}
            </strong>
          </div>
          <div className="progress">
            <span
              style={{
                width:
                  Math.min(100, (data.activeEmployees / data.subscription.employeeLimit) * 100) +
                  '%',
              }}
            />
          </div>
          <div className="usage-line">
            <span>Active users</span>
            <strong>
              {data.activeUsers} / {data.subscription.userLimit}
            </strong>
          </div>
          <div className="progress">
            <span
              style={{
                width: Math.min(100, (data.activeUsers / data.subscription.userLimit) * 100) + '%',
              }}
            />
          </div>
          <Link to="/subscription" className="button secondary">
            View subscription <ArrowRight size={15} />
          </Link>
        </Card>
      </div>
      <Card className="section-card">
        <h2>Operating overview</h2>
        <div className="usage-line">
          <span>Employees on approved leave today</span>
          <strong>{data.employeesOnLeave}</strong>
        </div>
        <div className="usage-line">
          <span>Timesheet states</span>
          <strong>
            {data.timesheetStates.map((t) => `${t.status}: ${t.count}`).join(' · ') || 'No entries'}
          </strong>
        </div>
        <div className="usage-line">
          <span>Overtime activity</span>
          <strong>
            {data.overtimeStates.map((t) => `${t.status}: ${t.hours} hours`).join(' · ') ||
              'No entries'}
          </strong>
        </div>
        {me.permissions.includes('payroll.read') && (
          <>
            <div className="usage-line">
              <span>Payroll run states</span>
              <strong>
                {data.payrollStates.map((t) => `${t.status}: ${t.count}`).join(' · ') || 'No runs'}
              </strong>
            </div>
            {data.payrollMonthTotals &&
              Object.entries(data.payrollMonthTotals).map(([label, value]) => (
                <div className="usage-line" key={label}>
                  <span>Current month {label}</span>
                  <strong>JMD {value}</strong>
                </div>
              ))}
          </>
        )}
      </Card>
      <div className="lower-grid">
        <Card>
          <div className="card-header">
            <div>
              <h2>Company workspace</h2>
              <p>Your organization’s operating context</p>
            </div>
            <Building2 size={20} />
          </div>
          <div className="activity-item">
            <span className="dot" />
            <div>
              {me.tenant?.displayName}
              <small>Active company · {me.tenant?.timezone}</small>
            </div>
          </div>
          <div className="activity-item">
            <span className="dot" />
            <div>
              Monthly standard hours
              <small>{me.tenant?.monthlyStandardHours} hours · company-configured policy</small>
            </div>
          </div>
          <div className="activity-item">
            <span className="dot" />
            <div>
              Multi-factor authentication
              <small>
                {me.mfaEnabled ? 'Authenticator enrolled' : 'Role-based security policy'}
              </small>
            </div>
          </div>
        </Card>
        <Card>
          <div className="card-header">
            <div>
              <h2>Recent activity</h2>
              <p>Authorized company audit events</p>
            </div>
            <Activity size={20} />
          </div>
          {data.recentActivity.length ? (
            data.recentActivity.map((e) => (
              <div className="activity-item" key={e.id}>
                <span className="dot" />
                <div>
                  {e.action.replaceAll('.', ' · ').replaceAll('_', ' ')}
                  <small>
                    {new Date(e.createdAt).toLocaleString('en-JM', {
                      timeZone: me.tenant?.timezone,
                    })}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <Empty title="Keep your company in view">
              Detailed audit viewing is available when included in your subscription and role.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
export function Company() {
  const { me } = useOutletContext<SessionOutlet>();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['company', me.tenant?.id],
    queryFn: () => api<z.infer<typeof companySchema>>('/tenants/current'),
  });
  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    values: query.data
      ? {
          legalName: query.data.legalName,
          displayName: query.data.displayName,
          address: query.data.address || '',
          contactEmail: query.data.contactEmail || null,
          timezone: query.data.timezone,
          locale: query.data.locale,
          logoUrl: query.data.logoUrl || '',
          accentColor: query.data.accentColor,
          monthlyStandardHours: String(query.data.monthlyStandardHours),
          allowSelfApproval: query.data.allowSelfApproval,
        }
      : undefined,
  });
  const mutation = useMutation({
    mutationFn: (b: z.infer<typeof companySchema>) => patch('/tenants/current', b),
    onSuccess: () => client.invalidateQueries(),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <Notice tone="error">{query.error.message}</Notice>;
  return (
    <>
      <SectionHeading
        eyebrow="ORGANIZATION"
        title="Company settings"
        description="Keep your company identity and operating policies consistent."
      />
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <Card className="section-card">
          <h2>Company profile</h2>
          <p>Branding appears throughout your authenticated workspace.</p>
          <div className="form-grid">
            <Field
              label="Registered company name"
              {...form.register('legalName')}
              error={form.formState.errors.legalName?.message}
            />
            <Field
              label="Display / trading name"
              {...form.register('displayName')}
              error={form.formState.errors.displayName?.message}
            />
            <Field label="Company address" {...form.register('address')} />
            <Field
              label="Contact email"
              type="email"
              {...form.register('contactEmail', { setValueAs: (v) => v || null })}
              error={form.formState.errors.contactEmail?.message}
            />
            <Field
              label="Company logo URL (HTTPS)"
              {...form.register('logoUrl')}
              error={form.formState.errors.logoUrl?.message}
            />
            <Field
              label="Accent color"
              type="color"
              {...form.register('accentColor')}
              error={form.formState.errors.accentColor?.message}
            />
          </div>
        </Card>
        <Card className="section-card">
          <h2>Operating policies</h2>
          <p>Policy changes are audited and do not rewrite historical payroll snapshots.</p>
          <div className="form-grid">
            <Field
              label="Timezone"
              {...form.register('timezone')}
              error={form.formState.errors.timezone?.message}
            />
            <Field
              label="Locale"
              {...form.register('locale')}
              error={form.formState.errors.locale?.message}
            />
            <Field
              label="Monthly standard hours"
              inputMode="decimal"
              {...form.register('monthlyStandardHours')}
              error={form.formState.errors.monthlyStandardHours?.message}
            />
          </div>
          <label className="checkbox-field">
            <input type="checkbox" {...form.register('allowSelfApproval')} /> Permit self-approval
            under company policy
          </label>
          <Notice>
            Changing separation-of-duties policies affects approval controls. Keep self-approval
            disabled unless the company has explicitly authorized it.
          </Notice>
        </Card>
        {mutation.error && <Notice tone="error">{mutation.error.message}</Notice>}
        {mutation.isSuccess && <Notice tone="success">Company settings saved.</Notice>}
        <Button disabled={mutation.isPending || me.subscription?.status === 'EXPIRED'}>
          Save company settings
        </Button>
      </form>
    </>
  );
}
type Member = {
  id: string;
  active: boolean;
  employeeId: string | null;
  user: { id: string; email: string; name: string; verifiedAt: string | null };
  roles: { role: { id: string; name: string } }[];
};
type Role = {
  id: string;
  name: string;
  approvalScope: string;
  permissions: { permissionCode: string }[];
};
const inviteSchema = z.object({ email: z.email(), name: z.string().min(2), roleId: z.uuid() });
export function UsersPage() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient(),
    [show, setShow] = useState(false),
    [search, setSearch] = useState(''),
    [access, setAccess] = useState<Member | null>(null);
  const query = useQuery({
    queryKey: ['users', me.tenant?.id],
    queryFn: () => api<Member[]>('/users'),
  });
  const roles = useQuery({
    queryKey: ['roles', me.tenant?.id],
    queryFn: () => api<Role[]>('/roles'),
  });
  const form = useForm<z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema) });
  const invite = useMutation({
    mutationFn: (b: z.infer<typeof inviteSchema>) => post('/users/invite', b),
    onSuccess: () => {
      client.invalidateQueries();
      setShow(false);
      form.reset();
    },
  });
  const change = useMutation({
    mutationFn: (m: Member) =>
      patch('/users/' + m.id, {
        active: !m.active,
        employeeId: m.employeeId,
        roleIds: m.roles.map((r) => r.role.id),
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const members = (query.data || []).filter((m) =>
    (m.user.name + ' ' + m.user.email).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <SectionHeading
        eyebrow="ACCESS MANAGEMENT"
        title="Users & roles"
        description="Invite trusted colleagues and control company access."
        action={
          <Button onClick={() => setShow(true)} disabled={me.subscription?.status === 'EXPIRED'}>
            <Plus size={16} /> Invite user
          </Button>
        }
      />
      <Card>
        <div className="toolbar">
          <label className="sr-only" htmlFor="search-users">
            Search users
          </label>
          <input
            id="search-users"
            className="search"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Badge>{members.length} USERS</Badge>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <Notice tone="error">{query.error.message}</Notice>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.user.name}</strong>
                      <small>{m.user.email}</small>
                    </td>
                    <td>{m.roles.map((r) => r.role.name.replaceAll('_', ' ')).join(', ')}</td>
                    <td>
                      <Badge>
                        {m.active ? (m.user.verifiedAt ? 'ACTIVE' : 'INVITED') : 'INACTIVE'}
                      </Badge>
                    </td>
                    <td>
                      {
                        <Button variant="secondary" onClick={() => setAccess(m)}>
                          Manage access
                        </Button>
                      }
                      {m.user.id !== me.user.id && (
                        <Button
                          variant="secondary"
                          disabled={change.isPending || me.subscription?.status === 'EXPIRED'}
                          onClick={() => {
                            if (
                              window.confirm(
                                `${m.active ? 'Deactivate' : 'Reactivate'} ${m.user.name}?`,
                              )
                            )
                              change.mutate(m);
                          }}
                        >
                          {m.active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!members.length && <Empty title="No users match your search" />}
          </div>
        )}
      </Card>
      {change.error && <Notice tone="error">{change.error.message}</Notice>}
      {invite.isSuccess && (
        <Notice tone="success">Invitation sent to the configured mailbox.</Notice>
      )}
      <Card className="section-card">
        <h2 style={{ marginBottom: 16 }}>Company role permissions</h2>
        <p>Permissions are enforced by the API independently of subscription features.</p>
        {roles.data?.map((r) => (
          <details key={r.id} style={{ padding: '14px 0', borderBottom: '1px solid #e4eae6' }}>
            <summary>
              {r.name.replaceAll('_', ' ')} · {r.permissions.length} permissions
            </summary>
            <p style={{ lineHeight: 1.8 }}>
              {r.permissions.map((p) => p.permissionCode).join(' · ')}
            </p>
          </details>
        ))}
      </Card>
      {access && (
        <UserAccessDialog
          member={access}
          roles={roles.data || []}
          onClose={() => setAccess(null)}
        />
      )}
      <RoleEditor roles={roles.data || []} />
      {show && (
        <Modal titleId="invite-title" onClose={() => setShow(false)}>
          <div className="modal-header">
            <h2 id="invite-title">Invite a colleague</h2>
            <Button
              variant="secondary"
              aria-label="Close invitation"
              onClick={() => setShow(false)}
            >
              <X size={17} />
            </Button>
          </div>
          <form onSubmit={form.handleSubmit((v) => invite.mutate(v))}>
            <Field
              label="Full name"
              {...form.register('name')}
              error={form.formState.errors.name?.message}
            />
            <Field
              label="Email address"
              type="email"
              {...form.register('email')}
              error={form.formState.errors.email?.message}
            />
            <div className="field">
              <label htmlFor="invite-role">Company role</label>
              <select id="invite-role" {...form.register('roleId')}>
                <option value="">Select a role</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              {form.formState.errors.roleId && <small className="field-error">Select a role</small>}
            </div>
            {invite.error && <Notice tone="error">{invite.error.message}</Notice>}
            <Button disabled={invite.isPending}>Send invitation</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
type SubscriptionData = {
  status: string;
  employeeLimit: number;
  userLimit: number;
  expiresAt: string | null;
  graceEndsAt: string | null;
  features: string[];
  plan: { name: string; currency: string; price: string | null };
  usage: { employees: number; users: number };
};
export function Subscription() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient(),
    [code, setCode] = useState('');
  const redeem = useMutation({
    mutationFn: () => post('/subscription/redeem-code', { code }),
    onSuccess: async () => {
      setCode('');
      await client.invalidateQueries();
    },
  });
  const query = useQuery({
    queryKey: ['subscription', me.tenant?.id],
    queryFn: () => api<SubscriptionData>('/subscription'),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <Notice tone="error">{query.error.message}</Notice>;
  const d = query.data!;
  return (
    <>
      <SectionHeading
        eyebrow="COMMERCIAL ACCESS"
        title="Subscription"
        description="Your company’s plan, capacity and enabled features."
      />
      <Card className="section-card">
        <div className="card-header">
          <h2>{d.plan.name} plan</h2>
          <Badge>{d.status}</Badge>
        </div>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <Metric
            label="Active employees"
            value={`${d.usage.employees} / ${d.employeeLimit}`}
            caption="Inactive records do not count"
            icon={<Users size={18} />}
          />
          <Metric
            label="Active users"
            value={`${d.usage.users} / ${d.userLimit}`}
            caption="Active company memberships"
            icon={<ShieldCheck size={18} />}
          />
        </div>
        <p>
          {d.expiresAt
            ? `Subscription ends ${new Date(d.expiresAt).toLocaleDateString('en-JM', { timeZone: me.tenant?.timezone })}`
            : 'Free access has no fixed expiry.'}
        </p>
        <h3 style={{ marginTop: 25 }}>Enabled features</h3>
        <div className="role-list">
          {d.features.map((f) => (
            <Badge key={f}>{f.toUpperCase()}</Badge>
          ))}
        </div>
        <Notice>
          Paid subscriptions are arranged through Qwik using verified manual payments. Commercial
          pricing must be confirmed by Qwik; no payment gateway is used.
        </Notice>
      </Card>
      {me.permissions.includes('subscription.write') && (
        <Card>
          <h2>Activate a paid subscription</h2>
          <p>Enter the company-bound code securely supplied by Qwik.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              redeem.mutate();
            }}
          >
            <Field
              label="Activation code"
              value={code}
              required
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
            />
            <Button disabled={redeem.isPending}>Redeem code</Button>
          </form>
          {redeem.error && <Notice tone="error">{redeem.error.message}</Notice>}
          {redeem.isSuccess && <Notice tone="success">Subscription activated.</Notice>}
        </Card>
      )}
    </>
  );
}
export function AuditPage() {
  const { me } = useOutletContext<SessionOutlet>();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['audit', me.tenant?.id, page],
    queryFn: () =>
      api<
        {
          id: string;
          action: string;
          actorId: string | null;
          entityId: string | null;
          createdAt: string;
          details: unknown;
        }[]
      >('/audit?page=' + page),
  });
  return (
    <>
      <SectionHeading
        eyebrow="ACCOUNTABILITY"
        title="Audit log"
        description="Protected records of who changed what and when."
      />
      <Card>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <Notice tone="error">{query.error.message}</Notice>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Actor</th>
                    <th>Time</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.action}
                        <small>{e.entityId}</small>
                      </td>
                      <td>{e.actorId || 'System'}</td>
                      <td>
                        {new Date(e.createdAt).toLocaleString('en-JM', {
                          timeZone: me.tenant?.timezone,
                        })}
                      </td>
                      <td>
                        <details>
                          <summary>View changes</summary>
                          <pre>{JSON.stringify(e.details, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data?.length && <Empty title="No audit events" />}
            <div className="toolbar">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={(query.data?.length || 0) < 25}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
