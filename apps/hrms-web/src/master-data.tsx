import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Plus, CalendarDays, Building2 } from 'lucide-react';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { api, post } from '../../../packages/ui/src/api.js';
import {
  Card,
  SectionHeading,
  Field,
  Button,
  Notice,
  Badge,
  Loading,
} from '../../../packages/ui/src/components.js';
import type { ReferenceData } from './employees.js';
export function MasterData() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['reference-data', me.tenant?.id],
    queryFn: () => api<ReferenceData>('/reference-data'),
  });
  const [category, setCategory] = useState('POSITION'),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const department = useForm<{ name: string }>(),
    reference = useForm<{ name: string; value: string; effectiveDate: string; reason: string }>(),
    holiday = useForm<{ name: string; date: string }>(),
    policy = useForm<{
      name: string;
      paidFraction: string;
      annualDays: string;
      carryForwardDays: string;
      effectiveDate: string;
      reason: string;
    }>();
  const create = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => post(path, body),
    onSuccess: () => client.invalidateQueries(),
  });
  const submitReference = (b: {
    name: string;
    value: string;
    reason: string;
    effectiveDate: string;
  }) => {
    const configuration =
      category === 'OVERTIME'
        ? { multiplier: b.value }
        : category === 'SHIFT'
          ? { maxHours: b.value }
          : category === 'SCHEDULE'
            ? { weekdays }
            : {};
    create.mutate({
      path: '/reference-data',
      body: {
        category,
        name: b.name,
        configuration,
        active: true,
        reason: b.reason || undefined,
        effectiveDate: b.effectiveDate || undefined,
      },
    });
  };
  if (query.isPending) return <Loading />;
  if (query.error) return <Notice tone="error">{query.error.message}</Notice>;
  return (
    <>
      <SectionHeading
        eyebrow="COMPANY CONFIGURATION"
        title="Master data & policies"
        description="Configure organization references, working calendars and prospective leave policies."
      />
      {create.error && <Notice tone="error">{create.error.message}</Notice>}
      {create.isSuccess && (
        <Notice tone="success">Configuration saved or submitted for independent review.</Notice>
      )}
      <div className="lower-grid">
        <Card>
          <div className="card-header">
            <h2>Departments</h2>
            <Building2 size={18} />
          </div>
          <div className="role-list">
            {query.data?.departments.map((d) => (
              <Badge key={d.id}>{d.name}</Badge>
            ))}
          </div>
          <form
            onSubmit={department.handleSubmit((b) =>
              create.mutate({ path: '/departments', body: b }),
            )}
          >
            <Field label="New department name" required {...department.register('name')} />
            <Button disabled={create.isPending}>
              <Plus size={15} /> Add department
            </Button>
          </form>
        </Card>
        <Card>
          <h2>Locations, roles & working rules</h2>
          <div className="field">
            <label htmlFor="reference-category">Reference category</label>
            <select
              id="reference-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                ['POSITION', 'Positions'],
                ['BRANCH', 'Branches'],
                ['EMPLOYMENT_TYPE', 'Employment types'],
                ['SHIFT', 'Shift limits'],
                ['OVERTIME', 'Overtime categories'],
                ['SCHEDULE', 'Work schedules'],
                ['PARISH', 'Parishes'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="role-list">
            {query.data?.references
              .filter((r) => r.category === category)
              .map((r) => (
                <Badge key={r.id}>
                  {r.name}
                  {r.configuration && category === 'OVERTIME'
                    ? ' × ' + r.configuration.multiplier
                    : ''}
                </Badge>
              ))}
          </div>
          <form onSubmit={reference.handleSubmit(submitReference)}>
            <Field
              label="Reference name (existing name updates its rule)"
              required
              {...reference.register('name')}
            />
            {(category === 'OVERTIME' || category === 'SHIFT') && (
              <Field
                label={category === 'OVERTIME' ? 'Overtime multiplier' : 'Maximum hours per shift'}
                required
                inputMode="decimal"
                {...reference.register('value')}
              />
            )}{' '}
            {category === 'SCHEDULE' && (
              <div className="role-list">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={weekdays.includes(index)}
                      onChange={(e) =>
                        setWeekdays(
                          e.target.checked
                            ? [...weekdays, index]
                            : weekdays.filter((d) => d !== index),
                        )
                      }
                    />{' '}
                    {day}
                  </label>
                ))}
              </div>
            )}
            <Field
              label="Policy effective date (today or later)"
              type="date"
              {...reference.register('effectiveDate')}
            />
            <Field label="Reason for configuration" {...reference.register('reason')} />
            <Button disabled={create.isPending}>Save reference</Button>
          </form>
        </Card>
        <Card>
          <div className="card-header">
            <h2>Public holidays</h2>
            <CalendarDays size={18} />
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                {query.data?.holidays.map((h) => (
                  <tr key={h.id}>
                    <td>{h.date.slice(0, 10)}</td>
                    <td>{h.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            onSubmit={holiday.handleSubmit((b) => create.mutate({ path: '/holidays', body: b }))}
          >
            <Field label="Holiday name" required {...holiday.register('name')} />
            <Field label="Holiday date" required type="date" {...holiday.register('date')} />
            <Button disabled={create.isPending}>Save holiday</Button>
          </form>
        </Card>
        <Card>
          <h2>Leave policies</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Annual days</th>
                  <th>Paid fraction</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.leaveTypes.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.annualDays}</td>
                    <td>{t.paidFraction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            onSubmit={policy.handleSubmit((b) =>
              create.mutate({
                path: '/leave-types',
                body: {
                  ...b,
                  reason: b.reason || undefined,
                  effectiveDate: b.effectiveDate || undefined,
                },
              }),
            )}
          >
            <Field label="Leave policy name" required {...policy.register('name')} />
            <div className="form-grid">
              <Field
                label="Annual entitlement (days)"
                required
                inputMode="decimal"
                {...policy.register('annualDays')}
              />
              <Field
                label="Paid fraction (0–1)"
                required
                inputMode="decimal"
                {...policy.register('paidFraction')}
              />
              <Field
                label="Carry-forward cap (days)"
                required
                inputMode="decimal"
                {...policy.register('carryForwardDays')}
              />
            </div>
            <Notice>
              Enter company-approved entitlements. Defaults do not assume statutory leave limits.
              Existing approved requests keep their paid-fraction snapshot.
            </Notice>
            <Field
              label="Leave policy effective date (today or later)"
              type="date"
              {...policy.register('effectiveDate')}
            />
            <Field label="Leave policy reason" {...policy.register('reason')} />
            <Button disabled={create.isPending}>Propose leave policy</Button>
          </form>
        </Card>
      </div>
      <ConfigurationHistory />
    </>
  );
}
export function ConfigurationHistory() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient(),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['configuration-history', me.tenant?.id, page],
    queryFn: () =>
      api<
        {
          id: string;
          kind: string;
          targetKey: string;
          status: string;
          proposedBy: string;
          reason: string;
          effectiveDate: string;
          appliedAt: string | null;
          proposal: unknown;
          previous: unknown;
        }[]
      >('/configuration-changes?page=' + page),
  });
  const review = useMutation({
    mutationFn: ({ id, status, comment }: { id: string; status: string; comment: string }) =>
      post('/configuration-changes/' + id + '/decision', { status, comment }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <Card className="section-card">
      <h2>Configuration proposals & version history</h2>
      <Notice>
        Pay-impacting policies require a different authorized company administrator to approve them.
        Future versions take effect on their approved date. Approved payroll snapshots retain their
        original inputs.
      </Notice>
      {review.error && <Notice tone="error">{review.error.message}</Notice>}
      {q.error && <Notice tone="error">{q.error.message}</Notice>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Policy / effective date</th>
              <th>State</th>
              <th>Versions</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.targetKey}
                  <small>
                    {c.kind} · {c.effectiveDate.slice(0, 10)} · {c.reason}
                  </small>
                </td>
                <td>
                  <Badge>{c.status}</Badge>
                  <small>{c.appliedAt ? 'Applied' : 'Awaiting review / effective date'}</small>
                </td>
                <td>
                  <details>
                    <summary>Compare configuration</summary>
                    <pre>
                      {JSON.stringify({ previous: c.previous, proposed: c.proposal }, null, 2)}
                    </pre>
                  </details>
                </td>
                <td>
                  {c.status === 'PENDING' &&
                    c.proposedBy !== me.user.id &&
                    ['APPROVED', 'REJECTED'].map((status) => (
                      <Button
                        key={status}
                        variant="secondary"
                        disabled={review.isPending}
                        onClick={() => {
                          const comment = window.prompt('Review comment (at least 10 characters)');
                          if (comment) review.mutate({ id: c.id, status, comment });
                        }}
                      >
                        {status === 'APPROVED' ? 'Approve' : 'Reject'}
                      </Button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    </Card>
  );
}
