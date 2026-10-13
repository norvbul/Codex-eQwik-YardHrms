import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Plus, X, Download, Printer, LockKeyhole, RefreshCw } from 'lucide-react';
import { api, post, download } from '../../../packages/ui/src/api.js';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import {
  SectionHeading,
  Card,
  Button,
  Field,
  Notice,
  Badge,
  Modal,
  Loading,
  Empty,
} from '../../../packages/ui/src/components.js';
import type { EmployeeChoice } from './employees.js';
type Rule = {
  id: string;
  name: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  configuration: { complianceMode: string; currency: string; monthlyStandardHours: string };
  sourceReference: string;
  approvedBy: string | null;
};
type Run = {
  id: string;
  frequency: string;
  startDate: string;
  endDate: string;
  payDate: string;
  payGroup: string;
  revision: number;
  status: string;
  preparationError: string | null;
  preparedBy: string | null;
  version: number;
  _count?: { snapshots: number };
  snapshots?: Snapshot[];
};
type Snapshot = {
  id: string;
  employeeId: string;
  gross: string;
  net: string;
  deductions: string;
  employerContributions: string;
  snapshot: {
    employee: { name: string; employeeNumber: string };
    result: {
      complianceMode: string;
      currency: string;
      regular: string;
      overtime: string;
      components: { code: string; employee: string; employer: string }[];
    };
  };
};
export function PayrollSetup() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const q = useQuery({
    queryKey: ['payroll-rules', me.tenant?.id],
    queryFn: () => api<Rule[]>('/payroll/rules'),
  });
  const [creating, setCreating] = useState(false),
    [reviewing, setReviewing] = useState<Rule | null>(null),
    [parseError, setParseError] = useState('');
  const form = useForm<{
      name: string;
      effectiveFrom: string;
      effectiveTo: string;
      sourceReference: string;
      configuration: string;
      referenceVectors: string;
    }>({ defaultValues: { configuration: '', referenceVectors: '[]' } }),
    review = useForm<{
      reviewerName: string;
      attestation: boolean;
      closePreviousVersion: boolean;
    }>();
  const create = useMutation({
    mutationFn: (b: object) => post('/payroll/rules', b),
    onSuccess: () => {
      client.invalidateQueries();
      setCreating(false);
    },
  });
  const approve = useMutation({
    mutationFn: (b: object) => post('/payroll/rules/' + reviewing?.id + '/approve', b),
    onSuccess: () => {
      client.invalidateQueries();
      setReviewing(null);
    },
  });
  return (
    <>
      <SectionHeading
        eyebrow="VERIFIED PAYROLL CONFIGURATION"
        title="Payroll setup"
        description="Effective-dated statutory packages, decimal rules and reviewed reference calculations."
        action={
          me.permissions.includes('payroll.rules') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> New rule version
            </Button>
          ) : undefined
        }
      />
      <Notice>
        Production payroll requires independently verified Jamaican statutory rules and accepted
        reference calculations. No statutory percentages are supplied as application defaults.
        Test-only packages cannot process production payroll.
      </Notice>
      <Card>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <Notice tone="error">{q.error.message}</Notice>
        ) : q.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rule version</th>
                  <th>Effective dates</th>
                  <th>Compliance</th>
                  <th>Approval</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <small>{r.sourceReference}</small>
                    </td>
                    <td>
                      {r.effectiveFrom.slice(0, 10)} → {r.effectiveTo?.slice(0, 10) || 'Open-ended'}
                    </td>
                    <td>
                      <Badge>{r.configuration.complianceMode}</Badge>
                    </td>
                    <td>
                      <Badge>{r.status}</Badge>
                    </td>
                    <td>
                      {r.status === 'DRAFT' && me.permissions.includes('payroll.approve') && (
                        <Button variant="secondary" onClick={() => setReviewing(r)}>
                          Review & approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Approved statutory configuration is required">
            Add a reviewed rules package and reference vectors. Payroll preparation remains gated
            until approval.
          </Empty>
        )}
      </Card>
      <p className="muted" style={{ marginTop: 22, fontSize: 12 }}>
        Approved configurations are immutable. Create a new version and prospectively close the
        previous period when rates or policies change.
      </p>
      {creating && (
        <Modal titleId="rule-create-title" onClose={() => setCreating(false)}>
          <div className="modal-header">
            <h2 id="rule-create-title">New statutory rule version</h2>
            <Button
              variant="secondary"
              aria-label="Close rule form"
              onClick={() => setCreating(false)}
            >
              <X size={18} />
            </Button>
          </div>
          <form
            onSubmit={form.handleSubmit((b) => {
              try {
                setParseError('');
                create.mutate({
                  ...b,
                  effectiveTo: b.effectiveTo || null,
                  configuration: JSON.parse(b.configuration),
                  referenceVectors: JSON.parse(b.referenceVectors),
                });
              } catch {
                setParseError('Rule package and reference calculations must contain valid JSON.');
              }
            })}
          >
            <Field label="Version name" required {...form.register('name')} />
            <div className="form-grid">
              <Field
                label="Effective from"
                type="date"
                required
                {...form.register('effectiveFrom')}
              />
              <Field
                label="Effective through (optional)"
                type="date"
                {...form.register('effectiveTo')}
              />
            </div>
            <Field
              label="Authoritative source / review reference"
              required
              minLength={10}
              {...form.register('sourceReference')}
            />
            <div className="field">
              <label htmlFor="rules-json">Reviewed rules package (JSON)</label>
              <textarea id="rules-json" required rows={12} {...form.register('configuration')} />
            </div>
            <div className="field">
              <label htmlFor="vectors-json">Accepted reference calculations (JSON array)</label>
              <textarea
                id="vectors-json"
                required
                rows={8}
                {...form.register('referenceVectors')}
              />
            </div>
            <Notice>
              Import the package prepared by your payroll reviewers. The format, rounding and YTD
              policies are documented in the payroll configuration guide. Do not use unverified
              outline examples as law.
            </Notice>
            {(parseError || create.error) && (
              <Notice tone="error">{parseError || create.error?.message}</Notice>
            )}
            <Button disabled={create.isPending}>Save draft for review</Button>
          </form>
        </Modal>
      )}
      {reviewing && (
        <Modal titleId="rule-approve-title" onClose={() => setReviewing(null)}>
          <h2 id="rule-approve-title">Approve reviewed statutory package</h2>
          <p className="muted" style={{ marginTop: 16 }}>
            {reviewing.name} · {reviewing.sourceReference}
          </p>
          <form onSubmit={review.handleSubmit((b) => approve.mutate(b))}>
            <Field
              label="Qualified reviewer / approval name"
              required
              minLength={3}
              {...review.register('reviewerName')}
            />
            <label className="checkbox-field">
              <input type="checkbox" required {...review.register('attestation')} /> I attest that
              the package and expected calculations have been independently reviewed.
            </label>
            <label className="checkbox-field">
              <input type="checkbox" {...review.register('closePreviousVersion')} /> Prospectively
              close a previous overlapping version
            </label>
            {approve.error && <Notice tone="error">{approve.error.message}</Notice>}
            <Button disabled={approve.isPending}>Verify vectors & approve version</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function PayrollRuns() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [selection, setSelection] = useState<string[]>([]);
  const choices = useQuery({
    queryKey: ['employee-choices', me.tenant?.id],
    queryFn: () => api<EmployeeChoice[]>('/employees/choices'),
  });
  const form = useForm<{
    frequency: string;
    startDate: string;
    endDate: string;
    payDate: string;
    payGroup: string;
  }>({ defaultValues: { frequency: 'MONTHLY', payGroup: 'ALL' } });
  const selectedFrequency = useWatch({ control: form.control, name: 'frequency' });
  const list = useQuery({
    queryKey: ['payroll-runs', me.tenant?.id, page],
    queryFn: () => api<{ items: Run[]; total: number }>('/payroll-runs?page=' + page),
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === 'PREPARING') ? 1500 : false,
  });
  const detail = useQuery({
    queryKey: ['payroll-run', selected, me.tenant?.id],
    queryFn: () => api<Run>('/payroll-runs/' + selected),
    enabled: Boolean(selected),
    refetchInterval: (q) => (q.state.data?.status === 'PREPARING' ? 1500 : false),
  });
  const create = useMutation({
    mutationFn: (b: object) => post('/payroll-runs', b),
    onSuccess: () => {
      client.invalidateQueries();
      setCreating(false);
    },
  });
  const action = useMutation({
    mutationFn: ({ id, step, body = {} }: { id: string; step: string; body?: object }) =>
      post('/payroll-runs/' + id + '/' + step, body),
    onSuccess: () => client.invalidateQueries(),
  });
  const permissions = new Set(me.permissions);
  function act(run: Run, step: string) {
    let body: object = {};
    if (step === 'reverse') {
      const reason = window.prompt('Reason for this audited reversal (at least 10 characters):');
      if (!reason) return;
      body = { reason };
    } else if (
      ['approve', 'lock'].includes(step) &&
      !window.confirm(
        `${step === 'approve' ? 'Approve and freeze' : 'Lock'} this payroll run? Approved amounts cannot be edited.`,
      )
    )
      return;
    action.mutate({ id: run.id, step, body });
  }
  const buttons = (r: Run) => (
    <div className="table-actions">
      {['DRAFT', 'PREPARED', 'REVIEWED'].includes(r.status) &&
        permissions.has('payroll.prepare') && (
          <Button variant="secondary" disabled={action.isPending} onClick={() => act(r, 'prepare')}>
            <RefreshCw size={13} />
            {r.status === 'DRAFT' ? 'Prepare' : 'Prepare again'}
          </Button>
        )}
      {r.status === 'PREPARED' && permissions.has('payroll.review') && (
        <Button variant="secondary" disabled={action.isPending} onClick={() => act(r, 'review')}>
          Review
        </Button>
      )}
      {r.status === 'REVIEWED' && permissions.has('payroll.approve') && (
        <Button disabled={action.isPending} onClick={() => act(r, 'approve')}>
          Approve
        </Button>
      )}
      {r.status === 'APPROVED' && permissions.has('payroll.approve') && (
        <Button variant="secondary" onClick={() => act(r, 'lock')}>
          <LockKeyhole size={13} /> Lock
        </Button>
      )}
      {['APPROVED', 'LOCKED'].includes(r.status) && permissions.has('payroll.approve') && (
        <Button variant="secondary" onClick={() => act(r, 'reverse')}>
          Reverse
        </Button>
      )}
    </div>
  );
  return (
    <>
      <SectionHeading
        eyebrow="CONTROLLED PAY CYCLES"
        title="Payroll runs"
        description="Prepare, independently review, approve, lock and retain reproducible payroll history."
        action={
          permissions.has('payroll.prepare') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> New payroll run
            </Button>
          ) : undefined
        }
      />
      <Notice>
        Payroll approval freezes the calculation snapshot. Input changes after preparation require a
        new preparation and review. Corrections use audited reversal and a new revision.
      </Notice>
      {(action.error || error) && <Notice tone="error">{action.error?.message || error}</Notice>}
      <Card>
        {list.isPending ? (
          <Loading />
        ) : list.error ? (
          <Notice tone="error">{list.error.message}</Notice>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pay group</th>
                    <th>Frequency / period</th>
                    <th>State</th>
                    <th>Employees</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data?.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.payGroup}</strong>
                        <small>Revision {r.revision}</small>
                      </td>
                      <td>
                        {r.frequency}
                        <small>
                          {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                        </small>
                      </td>
                      <td>
                        <Badge>{r.status}</Badge>
                        <small>{r.preparationError}</small>
                      </td>
                      <td>{r._count?.snapshots || 0}</td>
                      <td>
                        <Button variant="secondary" onClick={() => setSelected(r.id)}>
                          View calculation
                        </Button>
                        {buttons(r)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.data?.items.length && (
              <Empty title="No payroll runs yet">
                Configure approved statutory rules, then create your first eligible period.
              </Empty>
            )}
            <div className="toolbar">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={page * 25 >= (list.data?.total || 0)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
      {creating && (
        <Modal titleId="payroll-create-title" onClose={() => setCreating(false)}>
          <h2 id="payroll-create-title">Create payroll run</h2>
          <form
            onSubmit={form.handleSubmit((b) =>
              create.mutate({ ...b, ...(selection.length ? { employeeIds: selection } : {}) }),
            )}
          >
            <Field label="Pay group" required {...form.register('payGroup')} />
            <div className="field">
              <label htmlFor="run-frequency">Pay frequency</label>
              <select id="run-frequency" {...form.register('frequency')}>
                <option value="MONTHLY">Monthly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>
            <div className="form-grid">
              <Field label="Period start" type="date" required {...form.register('startDate')} />
              <Field label="Period end" type="date" required {...form.register('endDate')} />
              <Field label="Pay date" type="date" required {...form.register('payDate')} />
            </div>
            <fieldset>
              <legend>Employee selection</legend>
              <p className="muted" style={{ fontSize: 12 }}>
                Leave unselected to include all eligible employees for this frequency. A named pay
                group does not automatically select a department.
              </p>
              <div className="role-list">
                {choices.data
                  ?.filter((e) => e.frequency === selectedFrequency)
                  .map((e) => (
                    <label key={e.id}>
                      <input
                        type="checkbox"
                        checked={selection.includes(e.id)}
                        onChange={(event) =>
                          setSelection(
                            event.target.checked
                              ? [...selection, e.id]
                              : selection.filter((id) => id !== e.id),
                          )
                        }
                      />{' '}
                      {e.employeeNumber} · {e.firstName} {e.lastName}
                    </label>
                  ))}
              </div>
            </fieldset>
            {create.error && <Notice tone="error">{create.error.message}</Notice>}
            <Button disabled={create.isPending}>Create draft payroll</Button>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal titleId="payroll-detail-title" onClose={() => setSelected(null)}>
          <div className="modal-header">
            <h2 id="payroll-detail-title">Payroll calculation</h2>
            <Button
              variant="secondary"
              aria-label="Close payroll calculation"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </Button>
          </div>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <Notice tone="error">{detail.error.message}</Notice>
          ) : (
            detail.data && (
              <>
                <div className="toolbar">
                  <Badge>{detail.data.status}</Badge>
                  {buttons(detail.data)}
                </div>
                {detail.data.preparationError && (
                  <Notice tone="error">{detail.data.preparationError}</Notice>
                )}
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Gross</th>
                        <th>Deductions</th>
                        <th>Net</th>
                        <th>Rule calculations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.snapshots?.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.snapshot.employee.name}
                            <small>{s.snapshot.employee.employeeNumber}</small>
                          </td>
                          <td>{s.gross}</td>
                          <td>{s.deductions}</td>
                          <td>{s.net}</td>
                          <td>
                            <details>
                              <summary>Review components</summary>
                              <pre>{JSON.stringify(s.snapshot.result, null, 2)}</pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {detail.data.snapshots?.some(
                  (s) => s.snapshot.result.complianceMode === 'TEST_ONLY',
                ) && (
                  <Notice tone="error">
                    Test-only calculations are not approved for real disbursement.
                  </Notice>
                )}
                {['APPROVED', 'LOCKED'].includes(detail.data.status) &&
                  me.permissions.includes('employees.sensitive') && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const test = detail.data?.snapshots?.some(
                          (s) => s.snapshot.result.complianceMode === 'TEST_ONLY',
                        );
                        download(
                          `/payroll-runs/${selected}/bank-file?format=csv${test ? '&testPreview=true' : ''}`,
                          `${test ? 'TEST_ONLY-' : ''}bank-file.csv`,
                        ).catch((e) => setError(e.message));
                      }}
                    >
                      <Download size={14} />{' '}
                      {detail.data.snapshots?.some(
                        (s) => s.snapshot.result.complianceMode === 'TEST_ONLY',
                      )
                        ? 'Preview test bank file'
                        : 'Download bank file'}
                    </Button>
                  )}
              </>
            )
          )}
        </Modal>
      )}
    </>
  );
}
export function PayrollAdjustments() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const q = useQuery({
    queryKey: ['payroll-adjustments', me.tenant?.id],
    queryFn: () =>
      api<
        {
          id: string;
          name: string;
          kind: string;
          recurrence: string;
          amount: string;
          effectiveDate: string;
          employee: { firstName: string; lastName: string };
        }[]
      >('/payroll/adjustments'),
  });
  const choices = useQuery({
    queryKey: ['employee-choices', me.tenant?.id],
    queryFn: () => api<EmployeeChoice[]>('/employees/choices'),
  });
  const [show, setShow] = useState(false);
  const form = useForm<{
    employeeId: string;
    name: string;
    kind: string;
    recurrence: string;
    amount: string;
    taxable: boolean;
    taxRelief: boolean;
    effectiveDate: string;
    endDate: string;
    reason: string;
  }>({
    defaultValues: { kind: 'EARNING', recurrence: 'ONE_OFF', taxable: true, taxRelief: false },
  });
  const end = useMutation({
    mutationFn: ({ id, endDate, reason }: { id: string; endDate: string; reason: string }) =>
      post('/payroll/adjustments/' + id + '/end', { endDate, reason }),
    onSuccess: () => client.invalidateQueries(),
  });
  const save = useMutation({
    mutationFn: (b: object) => post('/payroll/adjustments', b),
    onSuccess: () => {
      client.invalidateQueries();
      setShow(false);
    },
  });
  return (
    <>
      <SectionHeading
        eyebrow="AUTHORIZED PAYROLL INPUTS"
        title="Earnings & deductions"
        description="Effective-dated allowances, bonuses, pension, loans and other approved payroll inputs."
        action={
          me.permissions.includes('payroll.prepare') ? (
            <Button onClick={() => setShow(true)}>
              <Plus size={15} /> Add input
            </Button>
          ) : undefined
        }
      />
      {end.error && <Notice tone="error">{end.error.message}</Notice>}
      <Card>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <Notice tone="error">{q.error.message}</Notice>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Input</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Effective from</th>
                  <th>Recurrence</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.employee.firstName} {r.employee.lastName}
                    </td>
                    <td>{r.name}</td>
                    <td>
                      {r.kind}
                      <small>{r.recurrence}</small>
                    </td>
                    <td>{r.amount}</td>
                    <td>{r.effectiveDate.slice(0, 10)}</td>
                    <td>
                      {r.recurrence === 'PER_PERIOD' &&
                        me.permissions.includes('payroll.prepare') && (
                          <Button
                            variant="secondary"
                            disabled={end.isPending}
                            onClick={() => {
                              const endDate = window.prompt(
                                'End recurring input on date (YYYY-MM-DD, today or later)',
                              );
                              const reason = endDate
                                ? window.prompt('Reason (at least 10 characters)')
                                : null;
                              if (endDate && reason) end.mutate({ id: r.id, endDate, reason });
                            }}
                          >
                            End recurrence
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {show && (
        <Modal titleId="pay-input-title" onClose={() => setShow(false)}>
          <h2 id="pay-input-title">Add payroll input</h2>
          <form
            onSubmit={form.handleSubmit((b) => save.mutate({ ...b, endDate: b.endDate || null }))}
          >
            <div className="field">
              <label htmlFor="input-employee">Employee</label>
              <select id="input-employee" {...form.register('employeeId')}>
                <option value="">Select an employee</option>
                {choices.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Input name" required {...form.register('name')} />
            <div className="field">
              <label htmlFor="input-kind">Input type</label>
              <select id="input-kind" {...form.register('kind')}>
                <option value="EARNING">Earning / allowance</option>
                <option value="DEDUCTION">Personal deduction</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="input-recurrence">Recurrence</label>
              <select id="input-recurrence" {...form.register('recurrence')}>
                <option value="ONE_OFF">Once in its effective payroll period</option>
                <option value="PER_PERIOD">Each eligible pay period until ended</option>
              </select>
            </div>
            <Field label="Amount" required inputMode="decimal" {...form.register('amount')} />
            <Field
              label="Effective date"
              required
              type="date"
              {...form.register('effectiveDate')}
            />
            <Field label="End date (optional)" type="date" {...form.register('endDate')} />
            <label className="checkbox-field">
              <input type="checkbox" {...form.register('taxable')} /> Taxable earning
            </label>
            <label className="checkbox-field">
              <input type="checkbox" {...form.register('taxRelief')} /> Approved deduction provides
              tax relief under configured rules
            </label>
            <Field
              label="Authorization reason"
              required
              minLength={3}
              {...form.register('reason')}
            />
            {save.error && <Notice tone="error">{save.error.message}</Notice>}
            <Button disabled={save.isPending}>Save audited input</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
type Payslip = {
  id: string;
  gross: string;
  net: string;
  deductions: string;
  employee: { employeeNumber: string; firstName: string; lastName: string };
  run: { status: string; startDate: string; endDate: string; payDate: string; frequency: string };
};
export function Payslips() {
  const { me } = useOutletContext<SessionOutlet>();
  const q = useQuery({
    queryKey: ['payslips', me.tenant?.id],
    queryFn: () => api<Payslip[]>('/payslips'),
  });
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState('');
  async function document(slip: Payslip, print = false) {
    const preview = print ? window.open('about:blank', '_blank') : null;
    if (preview) {
      preview.opener = null;
      preview.document.title = 'Preparing private payslip';
      preview.document.body.textContent = 'Preparing your protected payslip…';
    }
    setBusy(slip.id);
    setError('');
    try {
      if (print && !preview)
        throw new Error('Allow a new window for payslip viewing, or use Download PDF.');
      await post('/payslips/' + slip.id + '/generate', {});
      let ready = false;
      for (let i = 0; i < 30; i++) {
        const state = await api<{ ready: boolean }>('/payslips/' + slip.id + '/status');
        if (state.ready) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!ready) throw new Error('PDF is still preparing. Retry in a moment.');
      if (print) {
        await post('/payslips/' + slip.id + '/print-event', {});
        preview!.location.replace('/api/v1/payslips/' + slip.id + '/download?inline=true');
      } else await download('/payslips/' + slip.id + '/download', 'payslip-' + slip.id + '.pdf');
    } catch (e) {
      preview?.close();
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="PROTECTED EMPLOYEE DOCUMENTS"
        title="Payslips"
        description="Approved payroll documents with permission checks and print/download attribution."
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <Notice tone="error">{q.error.message}</Notice>
        ) : q.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Period</th>
                  <th>Gross / net</th>
                  <th>State</th>
                  <th>Private document</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.employee.firstName} {p.employee.lastName}
                      <small>{p.employee.employeeNumber}</small>
                    </td>
                    <td>
                      {p.run.startDate.slice(0, 10)} → {p.run.endDate.slice(0, 10)}
                      <small>{p.run.frequency}</small>
                    </td>
                    <td>
                      {p.gross} / {p.net}
                    </td>
                    <td>
                      <Badge>{p.run.status}</Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button
                          variant="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => document(p)}
                        >
                          <Download size={14} />
                          {busy === p.id ? 'Preparing…' : 'Download PDF'}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => document(p, true)}
                        >
                          <Printer size={14} /> Print / view
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No approved payslips available">
            Payslips appear after payroll approval. Your role and employee link determine which
            documents you can access.
          </Empty>
        )}
      </Card>
      <p className="muted" style={{ fontSize: 12, marginTop: 20 }}>
        Historical approved documents remain available to authorized users after subscription
        expiry. Reversed runs are clearly marked.
      </p>
    </>
  );
}
