import { DocumentVault } from '../../../packages/ui/src/documents.js';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { api, post, patch } from '../../../packages/ui/src/api.js';
import {
  Button,
  Card,
  Field,
  Notice,
  Loading,
  Empty,
  Badge,
  Modal,
  SectionHeading,
} from '../../../packages/ui/src/components.js';
import { featureCodes } from '../../../packages/types/src/features.js';
type Values = Record<string, string>;
type Option = { value: string; label: string };
type Input = {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  options?: Option[];
  value?: string;
};
type Action = {
  title: string;
  path: string;
  method?: 'PATCH';
  fields: Input[];
  body?: (v: Values) => unknown;
  help?: string;
};
const reason: Input = {
    name: 'reason',
    label: 'Reason / review evidence (at least 10 characters)',
  },
  roles = [
    { value: 'PLATFORM_LICENSING_OFFICER', label: 'Licensing Officer' },
    { value: 'PLATFORM_SUPER_ADMIN', label: 'Super Administrator' },
  ];
function useSuper() {
  return useOutletContext<SessionOutlet>().me.user.platformRole === 'PLATFORM_SUPER_ADMIN';
}
export function ActionDialog({ action, onClose }: { action: Action; onClose: () => void }) {
  const client = useQueryClient(),
    [result, setResult] = useState<{ code?: string } | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(z.record(z.string(), z.string())),
    defaultValues: Object.fromEntries(
      action.fields.map((f) => [
        f.name,
        f.value ?? (f.optional ? '' : f.options?.[0]?.value) ?? '',
      ]),
    ),
  });
  const mutation = useMutation({
    mutationFn: (v: Values) =>
      (action.method === 'PATCH' ? patch : post)<{ code?: string }>(
        action.path,
        action.body ? action.body(v) : v,
      ),
    onSuccess: async (r) => {
      await client.invalidateQueries();
      setResult(r);
    },
  });
  return (
    <Modal titleId="commercial-action-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="commercial-action-title">{action.title}</h2>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      {result ? (
        <>
          <Notice tone="success">Saved successfully.</Notice>
          {action.path === '/platform/codes' && result.code && (
            <>
              <Notice>
                This code is shown once. Deliver it securely to the designated company
                administrator.
              </Notice>
              <Field label="One-time activation code" readOnly value={result.code} />
              <Button onClick={() => navigator.clipboard.writeText(result.code!)}>Copy code</Button>
            </>
          )}
        </>
      ) : (
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
          {action.help && <Notice>{action.help}</Notice>}
          {action.fields.map((f) =>
            f.options ? (
              <div className="field" key={f.name}>
                <label htmlFor={'commercial-' + f.name}>{f.label}</label>
                <select
                  id={'commercial-' + f.name}
                  required={!f.optional}
                  {...form.register(f.name)}
                >
                  {f.optional && <option value="">None</option>}
                  {f.options.map((o) => (
                    <option value={o.value} key={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Field
                key={f.name}
                label={f.label}
                type={f.type || 'text'}
                required={!f.optional}
                {...form.register(f.name)}
              />
            ),
          )}
          {mutation.error && <Notice tone="error">{mutation.error.message}</Notice>}
          <Button disabled={mutation.isPending}>Save {mutation.isPending ? '…' : ''}</Button>
        </form>
      )}
    </Modal>
  );
}
export function NewCustomer() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Create customer</Button>
      {open && (
        <ActionDialog
          onClose={() => setOpen(false)}
          action={{
            title: 'Create Free company & invite owner',
            path: '/platform/customers',
            fields: [
              { name: 'companyName', label: 'Company name' },
              { name: 'ownerName', label: 'Owner name' },
              { name: 'ownerEmail', label: 'Owner email', type: 'email' },
            ],
          }}
        />
      )}
    </>
  );
}
function Pager({
  page,
  setPage,
  count,
}: {
  page: number;
  setPage: (p: number) => void;
  count: number;
}) {
  return (
    <div className="toolbar">
      <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
        Previous
      </Button>
      <span>Page {page}</span>
      <Button variant="secondary" disabled={count < 25} onClick={() => setPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}
function CustomerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['commercial-customer-search', search, page],
    queryFn: () =>
      api<{ id: string; displayName: string }[]>(
        `/platform/customers?search=${encodeURIComponent(search)}&page=${page}`,
      ),
  });
  return (
    <Card className="section-card">
      <Field
        label="Find a customer"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
          onChange('');
        }}
      />
      <div className="field">
        <label htmlFor="commercial-customer">Customer company</label>
        <select id="commercial-customer" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a company</option>
          {q.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </div>
      {q.error && <Notice tone="error">{q.error.message}</Notice>}
      <Pager page={page} setPage={setPage} count={q.data?.length || 0} />
    </Card>
  );
}
type Plan = {
  id: string;
  productId: string;
  name: string;
  code: string;
  price: string | null;
  durationDays: number | null;
  currency: string;
  employeeLimit: number;
  userLimit: number;
  graceDays: number;
  features: string[];
  active: boolean;
};
export function Catalog() {
  const admin = useSuper(),
    [action, setAction] = useState<Action | null>(null);
  const products = useQuery({
    queryKey: ['platform-products'],
    queryFn: () =>
      api<{ id: string; name: string; code: string; description: string; active: boolean }[]>(
        '/platform/products',
      ),
  });
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<Plan[]>('/platform/plans'),
  });
  const planAction = (p?: Plan): Action => ({
    title: p ? 'Edit ' + p.name : 'Configure new plan',
    path: '/platform/plans' + (p ? '/' + p.id : ''),
    method: p ? 'PATCH' : undefined,
    help: 'Changes apply to future entitlements. Existing subscription capacity and features are preserved until an explicit commercial action.',
    fields: [
      { name: 'code', label: 'Plan code', value: p?.code },
      {
        name: 'productId',
        label: 'Product',
        value: p?.productId,
        options: products.data?.map((v) => ({ value: v.id, label: v.name })) || [],
      },
      { name: 'name', label: 'Plan name', value: p?.name },
      { name: 'price', label: 'Owner-approved price', optional: true, value: p?.price || '' },
      { name: 'currency', label: 'Currency', value: p?.currency || 'JMD' },
      {
        name: 'durationDays',
        label: 'Covered duration in days',
        type: 'number',
        optional: true,
        value: p?.durationDays?.toString(),
      },
      {
        name: 'employeeLimit',
        label: 'Active employee capacity',
        type: 'number',
        value: p?.employeeLimit.toString(),
      },
      {
        name: 'userLimit',
        label: 'Active user capacity',
        type: 'number',
        value: p?.userLimit.toString(),
      },
      {
        name: 'graceDays',
        label: 'Grace period days',
        type: 'number',
        value: p?.graceDays.toString() || '0',
      },
      {
        name: 'features',
        label: 'Features (comma separated)',
        value: p?.features.join(',') || '',
        optional: true,
      },
      {
        name: 'active',
        label: 'Availability',
        value: String(p?.active ?? true),
        options: [
          { value: 'true', label: 'Active' },
          { value: 'false', label: 'Inactive' },
        ],
      },
    ],
    body: (v) => ({
      ...v,
      price: v.price || null,
      durationDays: v.durationDays ? Number(v.durationDays) : null,
      employeeLimit: Number(v.employeeLimit),
      userLimit: Number(v.userLimit),
      graceDays: Number(v.graceDays),
      features: v.features
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      active: v.active === 'true',
    }),
  });
  return (
    <>
      <SectionHeading
        title="Products, plans & features"
        description="Commercial terms remain owner-configured."
        action={
          admin ? (
            <Button
              disabled={products.isPending || !products.data?.length}
              onClick={() => setAction(planAction())}
            >
              New plan
            </Button>
          ) : undefined
        }
      />
      <Card className="section-card">
        <div className="card-header">
          <h2>Product catalogue</h2>
          {admin && (
            <Button
              variant="secondary"
              onClick={() =>
                setAction({
                  title: 'Add product',
                  path: '/platform/products',
                  fields: [
                    { name: 'code', label: 'Product code' },
                    { name: 'name', label: 'Name' },
                    { name: 'description', label: 'Description' },
                  ],
                })
              }
            >
              Add product
            </Button>
          )}
        </div>
        {products.error && <Notice tone="error">{products.error.message}</Notice>}
        {products.data?.map((p) => (
          <div className="usage-line" key={p.id}>
            <span>
              {p.name}
              <small> · {p.code}</small>
            </span>
            <Badge>{p.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
          </div>
        ))}
      </Card>
      {plans.isPending ? (
        <Loading />
      ) : plans.error ? (
        <Notice tone="error">{plans.error.message}</Notice>
      ) : (
        <div className="metrics">
          {plans.data?.map((p) => (
            <Card key={p.id}>
              <Badge>{p.code}</Badge>
              <h2 style={{ margin: '18px 0' }}>{p.name}</h2>
              <strong>{p.price === null ? 'Price unset' : `${p.currency} ${p.price}`}</strong>
              <p>
                {p.durationDays ? `${p.durationDays} covered days` : 'No fixed duration'} ·{' '}
                {p.employeeLimit} employees · {p.userLimit} users
              </p>
              <div className="role-list">
                {p.features.map((f) => (
                  <Badge key={f}>{f}</Badge>
                ))}
              </div>
              {admin && (
                <Button variant="secondary" onClick={() => setAction(planAction(p))}>
                  Edit plan
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
      <Notice>
        Available features: {featureCodes.join(', ')}. Paid plans cannot be issued until an approved
        price and duration are set.
      </Notice>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
    </>
  );
}
type Payment = {
  id: string;
  tenantId: string;
  amount: string;
  currency: string;
  method: string;
  reference: string;
  invoiceNumber: string;
  status: string;
  recordedBy: string;
  usedAt: string | null;
  periodStart: string;
  periodEnd: string;
  tenant: { displayName: string };
  events: { id: string; status: string; reason: string; createdAt: string; actorId: string }[];
};
export function Payments() {
  const admin = useSuper(),
    { me } = useOutletContext<SessionOutlet>(),
    [tenantId, setTenantId] = useState(''),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [action, setAction] = useState<Action | null>(null);
  const q = useQuery({
    queryKey: ['payments', tenantId, status, page],
    queryFn: () =>
      api<{ items: Payment[]; total: number }>(
        `/platform/payments?tenantId=${tenantId}&status=${status}&page=${page}`,
      ),
  });
  return (
    <>
      <SectionHeading
        title="Manual payments"
        description="Record receipts, verify them independently, and preserve every decision."
        action={
          <Button
            disabled={!tenantId}
            onClick={() =>
              setAction({
                title: 'Record manual payment',
                path: '/platform/payments',
                fields: [
                  { name: 'amount', label: 'Amount received' },
                  { name: 'currency', label: 'Currency', value: 'JMD' },
                  {
                    name: 'method',
                    label: 'Method',
                    options: ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER'].map((v) => ({
                      value: v,
                      label: v.replaceAll('_', ' '),
                    })),
                  },
                  { name: 'reference', label: 'Payment reference' },
                  { name: 'invoiceNumber', label: 'Invoice number' },
                  { name: 'paymentDate', label: 'Received date', type: 'date' },
                  { name: 'periodStart', label: 'Covered period start', type: 'date' },
                  { name: 'periodEnd', label: 'Covered period end', type: 'date' },
                  {
                    name: 'evidenceFileId',
                    label: 'Clean payment evidence ID (optional)',
                    optional: true,
                  },
                ],
                body: (v) => ({ ...v, tenantId, evidenceFileId: v.evidenceFileId || null }),
              })
            }
          >
            Record payment
          </Button>
        }
      />
      <CustomerPicker
        value={tenantId}
        onChange={(v) => {
          setTenantId(v);
          setPage(1);
        }}
      />
      {tenantId && <DocumentVault tenantId={tenantId} canUpload />}
      <Card>
        <div className="field">
          <label htmlFor="payment-status">Payment state</label>
          <select
            id="payment-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {['PENDING', 'VERIFIED', 'REJECTED', 'REVERSED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
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
                    <th>Company / receipt</th>
                    <th>Amount / coverage</th>
                    <th>State</th>
                    <th>Decisions</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.tenant.displayName}</strong>
                        <small>
                          {p.reference} · {p.invoiceNumber}
                        </small>
                        <small>Payment ID: {p.id}</small>
                      </td>
                      <td>
                        {p.currency} {p.amount}
                        <small>
                          {p.periodStart.slice(0, 10)} – {p.periodEnd.slice(0, 10)}
                        </small>
                      </td>
                      <td>
                        <Badge>{p.status}</Badge>
                        {p.usedAt && <small>Applied to subscription</small>}
                      </td>
                      <td>
                        {p.status === 'PENDING' &&
                          ['VERIFIED', 'REJECTED'].map((s) => (
                            <Button
                              key={s}
                              variant="secondary"
                              disabled={s === 'VERIFIED' && p.recordedBy === me.user.id}
                              onClick={() =>
                                setAction({
                                  title:
                                    s === 'VERIFIED'
                                      ? 'Independently verify receipt'
                                      : 'Reject receipt',
                                  path: '/platform/payments/' + p.id + '/decision',
                                  fields: [reason],
                                  body: (v) => ({ ...v, status: s }),
                                })
                              }
                            >
                              {s === 'VERIFIED' ? 'Verify' : 'Reject'}
                            </Button>
                          ))}
                        {admin && p.status === 'VERIFIED' && (
                          <Button
                            variant="danger"
                            onClick={() =>
                              setAction({
                                title: 'Reverse verified payment',
                                path: '/platform/payments/' + p.id + '/decision',
                                fields: [reason],
                                help: 'Reversing an applied payment suspends affected access and invalidates outstanding codes.',
                                body: (v) => ({ ...v, status: 'REVERSED' }),
                              })
                            }
                          >
                            Reverse
                          </Button>
                        )}
                        <details>
                          <summary>Decision history</summary>
                          {p.events.map((e) => (
                            <p key={e.id}>
                              {e.status} · {e.reason}
                              <small>
                                {e.actorId} · {new Date(e.createdAt).toLocaleString()}
                              </small>
                            </p>
                          ))}
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.items.length && <Empty title="No matching payments" />}
            <Pager page={page} setPage={setPage} count={q.data?.items.length || 0} />
          </>
        )}
      </Card>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
    </>
  );
}
type Subscription = {
  id: string;
  tenantId: string;
  status: string;
  expiresAt: string | null;
  employeeLimit: number;
  userLimit: number;
  features: string[];
  tenant: { displayName: string };
  plan: { name: string };
};
export function Subscriptions({ renewals = false }: { renewals?: boolean }) {
  const admin = useSuper(),
    [page, setPage] = useState(1),
    [action, setAction] = useState<Action | null>(null);
  const q = useQuery({
    queryKey: ['platform-subscriptions', renewals, page],
    queryFn: () =>
      api<Subscription[]>(
        '/platform/' + (renewals ? 'renewals' : 'subscriptions') + '?page=' + page,
      ),
  });
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<Plan[]>('/platform/plans'),
  });
  return (
    <>
      <SectionHeading
        title={renewals ? 'Renewal follow-up' : 'Subscriptions & licences'}
        description={
          renewals
            ? 'Expired or due within 30 days. Verify a new payment before extending the term.'
            : 'Entitlements, capacity and access state. Historical company records are retained.'
        }
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
                    <th>Company / plan</th>
                    <th>Status / expiry</th>
                    <th>Capacity</th>
                    <th>Commercial actions</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.tenant.displayName}</strong>
                        <small>{s.plan.name}</small>
                        <details>
                          <summary>Licensed features</summary>
                          {s.features.join(', ')}
                        </details>
                      </td>
                      <td>
                        <Badge>{s.status}</Badge>
                        <small>
                          {s.expiresAt
                            ? new Date(s.expiresAt).toLocaleDateString('en-JM', {
                                timeZone: 'America/Jamaica',
                              })
                            : 'No fixed expiry'}
                        </small>
                      </td>
                      <td>
                        {s.employeeLimit} employees<small>{s.userLimit} users</small>
                      </td>
                      <td>
                        {s.status !== 'FREE' && (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setAction({
                                title: 'Renew existing entitlement',
                                path: '/platform/subscriptions/' + s.id + '/renew',
                                fields: [
                                  { name: 'paymentId', label: 'Verified, unused payment ID' },
                                ],
                                help: 'Use a verified payment for this customer with the configured plan price and covered duration. No activation code is needed.',
                              })
                            }
                          >
                            Renew
                          </Button>
                        )}
                        {admin && (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setAction({
                                  title: 'Change capacity',
                                  path: '/platform/subscriptions/' + s.id + '/capacity',
                                  fields: [
                                    {
                                      name: 'employeeLimit',
                                      label: 'Employee capacity',
                                      type: 'number',
                                      value: String(s.employeeLimit),
                                    },
                                    {
                                      name: 'userLimit',
                                      label: 'User capacity',
                                      type: 'number',
                                      value: String(s.userLimit),
                                    },
                                    reason,
                                  ],
                                  body: (v) => ({
                                    ...v,
                                    employeeLimit: Number(v.employeeLimit),
                                    userLimit: Number(v.userLimit),
                                  }),
                                })
                              }
                            >
                              Capacity
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setAction({
                                  title: 'Change plan',
                                  path: '/platform/subscriptions/' + s.id + '/plan',
                                  fields: [
                                    {
                                      name: 'planId',
                                      label: 'Plan',
                                      options:
                                        plans.data
                                          ?.filter((p) => p.active)
                                          .map((p) => ({ value: p.id, label: p.name })) || [],
                                    },
                                    reason,
                                  ],
                                  help: 'Downgrades preserve all records. Free-to-paid access requires a verified activation code.',
                                })
                              }
                            >
                              Plan
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setAction({
                                  title: 'Change access state',
                                  path: '/platform/subscriptions/' + s.id + '/status',
                                  fields: [
                                    {
                                      name: 'status',
                                      label: 'State',
                                      options: ['SUSPENDED', 'REVOKED', 'ACTIVE'].map((v) => ({
                                        value: v,
                                        label: v,
                                      })),
                                    },
                                    reason,
                                  ],
                                })
                              }
                            >
                              Access state
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.length && <Empty title="No subscriptions in this view" />}
            <Pager page={page} setPage={setPage} count={q.data?.length || 0} />
          </>
        )}
      </Card>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
    </>
  );
}
export function Codes() {
  const [tenantId, setTenantId] = useState(''),
    [page, setPage] = useState(1),
    [checkedAt] = useState(() => Date.now()),
    [action, setAction] = useState<Action | null>(null);
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<Plan[]>('/platform/plans'),
  });
  const payments = useQuery({
    queryKey: ['unused-payments', tenantId],
    queryFn: () =>
      api<{ items: Payment[] }>(
        '/platform/payments?tenantId=' + tenantId + '&status=VERIFIED&unused=true',
      ),
    enabled: !!tenantId,
  });
  const q = useQuery({
    queryKey: ['platform-codes', tenantId, page],
    queryFn: () =>
      api<
        {
          id: string;
          expiresAt: string;
          redeemedAt: string | null;
          tenantId: string;
          createdAt: string;
        }[]
      >('/platform/codes?tenantId=' + tenantId + '&page=' + page),
  });
  return (
    <>
      <SectionHeading
        title="Activation codes"
        description="Company-bound, one-use paid entitlements. Raw codes are never stored or shown again."
        action={
          <Button
            disabled={
              !tenantId ||
              plans.isPending ||
              payments.isPending ||
              !payments.data?.items.some((p) => !p.usedAt) ||
              !plans.data?.some((p) => p.active && p.code !== 'FREE' && p.price && p.durationDays)
            }
            onClick={() =>
              setAction({
                title: 'Issue paid activation code',
                path: '/platform/codes',
                fields: [
                  {
                    name: 'planId',
                    label: 'Approved paid plan',
                    options:
                      plans.data
                        ?.filter((p) => p.active && p.code !== 'FREE' && p.price && p.durationDays)
                        .map((p) => ({
                          value: p.id,
                          label: p.name + ' · ' + p.currency + ' ' + p.price,
                        })) || [],
                  },
                  {
                    name: 'paymentId',
                    label: 'Verified unused payment',
                    options:
                      payments.data?.items
                        .filter((p) => !p.usedAt)
                        .map((p) => ({
                          value: p.id,
                          label: p.reference + ' · ' + p.currency + ' ' + p.amount,
                        })) || [],
                  },
                ],
                body: (v) => ({ ...v, tenantId }),
                help: 'Issuing a code reserves the verified payment. Company Free access remains until its administrator redeems the code.',
              })
            }
          >
            Issue code
          </Button>
        }
      />
      <CustomerPicker
        value={tenantId}
        onChange={(v) => {
          setTenantId(v);
          setPage(1);
        }}
      />
      {payments.error && <Notice tone="error">{payments.error.message}</Notice>}
      {tenantId &&
        !payments.isPending &&
        !payments.error &&
        !payments.data?.items.some((p) => !p.usedAt) && (
          <Notice>
            Record and independently verify an unused receipt for this company before issuing a
            code.
          </Notice>
        )}
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
                    <th>Code reference</th>
                    <th>Company ID</th>
                    <th>Validity</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.id}
                        <small>Issued {new Date(c.createdAt).toLocaleDateString()}</small>
                      </td>
                      <td>{c.tenantId}</td>
                      <td>{new Date(c.expiresAt).toLocaleString()}</td>
                      <td>
                        <Badge>
                          {c.redeemedAt
                            ? 'REDEEMED'
                            : new Date(c.expiresAt).getTime() < checkedAt
                              ? 'EXPIRED'
                              : 'UNUSED'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.length && <Empty title="No activation codes in this view" />}
            <Pager page={page} setPage={setPage} count={q.data?.length || 0} />
          </>
        )}
      </Card>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
    </>
  );
}
export function Usage() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['platform-usage', page],
    queryFn: () =>
      api<
        {
          id: string;
          displayName: string;
          subscription: { employeeLimit: number; userLimit: number; status: string } | null;
          _count: { employees: number; memberships: number };
        }[]
      >('/platform/usage?page=' + page),
  });
  return (
    <>
      <SectionHeading
        title="Capacity usage"
        description="Active employees and active user memberships against licensed capacity."
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
                    <th>Company</th>
                    <th>Employees</th>
                    <th>Users</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.map((c) => (
                    <tr key={c.id}>
                      <td>{c.displayName}</td>
                      <td>
                        {c._count.employees} / {c.subscription?.employeeLimit}
                      </td>
                      <td>
                        {c._count.memberships} / {c.subscription?.userLimit}
                      </td>
                      <td>
                        <Badge>{c.subscription?.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} setPage={setPage} count={q.data?.length || 0} />
          </>
        )}
      </Card>
    </>
  );
}
export function Settings() {
  const admin = useSuper(),
    [action, setAction] = useState<Action | null>(null);
  const q = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () =>
      api<{
        paymentSeparationOfDuties: boolean;
        allowCommercialOverrides: boolean;
        activationTtlDays: number;
      }>('/platform/settings'),
    enabled: admin,
  });
  const users = useQuery({
    queryKey: ['platform-users'],
    queryFn: () =>
      api<
        {
          id: string;
          name: string;
          email: string;
          platformRole: string;
          active: boolean;
          mfaEnabled: boolean;
        }[]
      >('/platform/users'),
    enabled: admin,
  });
  if (!admin) return <Notice tone="error">Super Administrator authority is required.</Notice>;
  return (
    <>
      <SectionHeading
        title="Platform policies & staff"
        description="Reasoned commercial exceptions and platform authority are protected by MFA."
        action={
          <Button
            onClick={() =>
              setAction({
                title: 'Invite Qwik staff',
                path: '/platform/users/invite',
                fields: [
                  { name: 'name', label: 'Staff name' },
                  { name: 'email', label: 'Email', type: 'email' },
                  { name: 'role', label: 'Authority', options: roles },
                ],
              })
            }
          >
            Invite staff
          </Button>
        }
      />
      <Card className="section-card">
        <h2>Commercial policy</h2>
        {q.data && (
          <>
            <p>
              Independent payment verification:{' '}
              {q.data.paymentSeparationOfDuties ? 'Required' : 'Disabled'}
              <br />
              Commercial overrides: {q.data.allowCommercialOverrides ? 'Enabled' : 'Disabled'}
              <br />
              Code validity: {q.data.activationTtlDays} days
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                setAction({
                  title: 'Change commercial policy',
                  path: '/platform/settings',
                  method: 'PATCH',
                  fields: [
                    {
                      name: 'paymentSeparationOfDuties',
                      label: 'Payment verification separation',
                      value: String(q.data!.paymentSeparationOfDuties),
                      options: [
                        { value: 'true', label: 'Required' },
                        { value: 'false', label: 'Disabled' },
                      ],
                    },
                    {
                      name: 'allowCommercialOverrides',
                      label: 'Super Admin commercial exceptions',
                      value: String(q.data!.allowCommercialOverrides),
                      options: [
                        { value: 'false', label: 'Disabled' },
                        { value: 'true', label: 'Enabled' },
                      ],
                    },
                    {
                      name: 'activationTtlDays',
                      label: 'Code validity days (1–30)',
                      type: 'number',
                      value: String(q.data!.activationTtlDays),
                    },
                    reason,
                  ],
                  body: (v) => ({
                    ...v,
                    paymentSeparationOfDuties: v.paymentSeparationOfDuties === 'true',
                    allowCommercialOverrides: v.allowCommercialOverrides === 'true',
                    activationTtlDays: Number(v.activationTtlDays),
                  }),
                })
              }
            >
              Edit policy
            </Button>
          </>
        )}
        {q.error && <Notice tone="error">{q.error.message}</Notice>}
      </Card>
      <Card>
        <h2>Platform staff</h2>
        {users.error && <Notice tone="error">{users.error.message}</Notice>}
        {users.data?.map((u) => (
          <div key={u.id} className="usage-line">
            <div>
              {u.name}
              <small>
                {u.email} · {u.platformRole.replaceAll('_', ' ')} · MFA{' '}
                {u.mfaEnabled ? 'enrolled' : 'pending'}
              </small>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                setAction({
                  title: 'Update staff access',
                  path: '/platform/users/' + u.id,
                  method: 'PATCH',
                  fields: [
                    { name: 'role', label: 'Authority', value: u.platformRole, options: roles },
                    {
                      name: 'active',
                      label: 'Access',
                      value: String(u.active),
                      options: [
                        { value: 'true', label: 'Active' },
                        { value: 'false', label: 'Inactive' },
                      ],
                    },
                    reason,
                  ],
                  body: (v) => ({ ...v, active: v.active === 'true' }),
                })
              }
            >
              Manage
            </Button>
          </div>
        ))}
      </Card>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
    </>
  );
}
// Kept local to this portal; employee records are never loaded by commercial screens.
export type CommercialContent = ReactNode;
