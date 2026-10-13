import { NewCustomer } from './commercial.js';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, ShieldCheck, CreditCard, Clock3 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import {
  SectionHeading,
  Card,
  Metric,
  Badge,
  Notice,
  Loading,
  Empty,
  Button,
} from '../../../packages/ui/src/components.js';
import { api } from '../../../packages/ui/src/api.js';
type Plan = {
  id: string;
  name: string;
  code: string;
  price: string | null;
  currency: string;
  employeeLimit: number;
  userLimit: number;
  features: string[];
  active: boolean;
  tenants?: number;
};
export function Dashboard() {
  const q = useQuery({
    queryKey: ['platform-dashboard'],
    queryFn: () =>
      api<{
        customers: number;
        freeSubscriptions: number;
        activeSubscriptions: number;
        expiredSubscriptions: number;
        pendingPayments: number;
        upcomingRenewals: number;
        activeEmployees: number;
        activeUsers: number;
        verifiedReceipts: { currency: string; amount: string; payments: number }[];
        plans: Plan[];
      }>('/platform/dashboard'),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <Notice tone="error">{q.error.message}</Notice>;
  const d = q.data!;
  return (
    <>
      <SectionHeading
        eyebrow="QWIK CONTROL CENTRE"
        title="Platform overview"
        description="A clear view of customers, capacity and subscription health."
      />
      <div className="metrics">
        <Metric
          label="Customers"
          value={d.customers}
          caption="Registered organizations"
          icon={<Building2 size={18} />}
        />
        <Metric
          label="Active paid"
          value={d.activeSubscriptions}
          caption="Current subscriptions"
          icon={<CreditCard size={18} />}
        />
        <Metric
          label="Free workspaces"
          value={d.freeSubscriptions}
          caption="Centrally provisioned access"
          icon={<ShieldCheck size={18} />}
        />
        <Metric
          label="Expired subscriptions"
          value={d.expiredSubscriptions}
          caption="Renewal follow-up"
          icon={<Clock3 size={18} />}
        />
      </div>
      <Card className="section-card">
        <h2>Renewals & verified receipts</h2>
        <div className="usage-line">
          <span>Renewals due within 30 days</span>
          <strong>{d.upcomingRenewals}</strong>
        </div>
        <div className="usage-line">
          <span>Active employees / company memberships</span>
          <strong>
            {d.activeEmployees} / {d.activeUsers}
          </strong>
        </div>
        {d.verifiedReceipts.length ? (
          d.verifiedReceipts.map((r) => (
            <div className="usage-line" key={r.currency}>
              <span>
                {r.currency} verified receipts · {r.payments} payments
              </span>
              <strong>{r.amount}</strong>
            </div>
          ))
        ) : (
          <p>No verified receipts yet.</p>
        )}
        <p>Amounts exclude reversed payments and remain separated by currency.</p>
      </Card>
      <div className="dashboard-grid">
        <Card>
          <div className="card-header">
            <div>
              <h2>Plan distribution</h2>
              <p>Organizations by configured tier</p>
            </div>
            <Badge>LIVE DATA</Badge>
          </div>
          {d.customers ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.plans}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="tenants" fill="#848bae" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty title="No registered customers yet">
              Free company registrations are centrally provisioned and will appear here.
            </Empty>
          )}
        </Card>
        <Card>
          <span className="eyebrow">COMMERCIAL CONTROLS</span>
          <h2>Manual payment policy</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 20, lineHeight: 1.8 }}>
            Payments require authorized staff verification. This release does not use payment
            gateways or automated checkout.
          </p>
          <Notice>
            Paid plan prices and subscription terms remain owner-configured. No commercial amounts
            have been assumed.
          </Notice>
          <div className="usage-line">
            <span>Pending manual payments</span>
            <strong>{d.pendingPayments}</strong>
          </div>
        </Card>
      </div>
    </>
  );
}
type Customer = {
  id: string;
  displayName: string;
  legalName: string;
  contactEmail: string | null;
  status: string;
  subscription: {
    status: string;
    employeeLimit: number;
    userLimit: number;
    plan: { name: string };
  } | null;
  _count: { employees: number; memberships: number };
};
export function Customers() {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () =>
      api<Customer[]>(`/platform/customers?search=${encodeURIComponent(search)}&page=${page}`),
  });
  return (
    <>
      <SectionHeading
        eyebrow="CUSTOMER RELATIONSHIPS"
        title="Customers"
        description="Organization and subscription metadata. Private HR records stay tenant-restricted."
        action={<NewCustomer />}
      />
      <Card>
        <div className="toolbar">
          <label className="sr-only" htmlFor="customer-search">
            Search customers
          </label>
          <input
            className="search"
            id="customer-search"
            placeholder="Search company name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <Notice tone="error">{q.error.message}</Notice>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Plan</th>
                    <th>State</th>
                    <th>Employees</th>
                    <th>Users</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.displayName}</strong>
                        <small>{c.contactEmail || c.legalName}</small>
                      </td>
                      <td>{c.subscription?.plan.name || 'Unconfigured'}</td>
                      <td>
                        <Badge>{c.subscription?.status || c.status}</Badge>
                      </td>
                      <td>
                        {c._count.employees} / {c.subscription?.employeeLimit || '—'}
                      </td>
                      <td>
                        {c._count.memberships} / {c.subscription?.userLimit || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.length && <Empty title="No customers match this view" />}
            <div className="toolbar">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={(q.data?.length || 0) < 25}
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
export function Plans() {
  const q = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<Plan[]>('/platform/plans'),
  });
  return (
    <>
      <SectionHeading
        eyebrow="CONFIGURED ENTITLEMENTS"
        title="Plans & features"
        description="Seeded capacities are configurable starting points; paid prices require owner decisions."
      />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <Notice tone="error">{q.error.message}</Notice>
      ) : (
        <div className="metrics">
          {q.data?.map((p) => (
            <Card key={p.id}>
              <Badge>{p.code}</Badge>
              <h2 style={{ margin: '18px 0' }}>{p.name}</h2>
              <strong style={{ fontSize: 25 }}>
                {p.price === null ? 'Price unset' : `${p.currency} ${p.price}`}
              </strong>
              <p className="muted" style={{ fontSize: 12, margin: '20px 0' }}>
                {p.employeeLimit} active employees
                <br />
                {p.userLimit} active users
              </p>
              <div className="role-list">
                {p.features.map((f) => (
                  <Badge key={f}>{f}</Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
export function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['platform-audit', page],
    queryFn: () =>
      api<
        {
          id: string;
          action: string;
          actorId: string | null;
          createdAt: string;
          details: unknown;
        }[]
      >('/platform/audit?page=' + page),
  });
  return (
    <>
      <SectionHeading
        eyebrow="ACCOUNTABILITY"
        title="Platform audit"
        description="Protected Qwik administration events, separate from tenant HR audit records."
      />
      <Card>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <Notice tone="error">{q.error.message}</Notice>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Time</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((e) => (
                    <tr key={e.id}>
                      <td>{e.action}</td>
                      <td>{e.actorId || 'System'}</td>
                      <td>
                        {new Date(e.createdAt).toLocaleString('en-JM', {
                          timeZone: 'America/Jamaica',
                        })}
                      </td>
                      <td>
                        <details>
                          <summary>View event</summary>
                          <pre>{JSON.stringify(e.details, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.length && <Empty title="No platform audit events" />}
            <div className="toolbar">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={(q.data?.length || 0) < 25}
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
