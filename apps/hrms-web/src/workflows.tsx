import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Plus, X, Check, FileSpreadsheet, Download, Upload } from 'lucide-react';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { api, post, download } from '../../../packages/ui/src/api.js';
import { leaveSchema, timesheetSchema, overtimeSchema } from '../../../packages/types/src/index.js';
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
import { SelectField, type ReferenceData, type EmployeeChoice } from './employees.js';
type WorkflowKind = 'leave' | 'timesheets' | 'overtime';
type WorkRow = {
  id: string;
  employeeId: string;
  employee: { firstName: string; lastName: string; employeeNumber: string };
  status: string;
  submittedBy: string;
  createdAt: string;
  workDate?: string;
  startDate?: string;
  endDate?: string;
  days?: string;
  hours?: string;
  multiplier?: string;
  shift?: string;
  reason?: string;
  leaveType?: { name: string };
  comment?: string;
};
const workflowConfig = {
  leave: {
    title: 'Leave requests',
    description: 'Request time away, track approvals and protect leave balances.',
    route: '/leave-requests',
  },
  timesheets: {
    title: 'Regular timesheets',
    description: 'Weekly and fortnightly attendance, including authorized delegated entries.',
    route: '/timesheets',
  },
  overtime: {
    title: 'Overtime',
    description: 'Separate approved overtime for eligible employees across pay frequencies.',
    route: '/overtime',
  },
};
export function WorkflowPage({ kind }: { kind: WorkflowKind }) {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [show, setShow] = useState(false),
    [review, setReview] = useState<{ row: WorkRow; status: 'APPROVED' | 'REJECTED' } | null>(null),
    [comment, setComment] = useState('');
  const config = workflowConfig[kind];
  const query = useQuery({
    queryKey: [kind, me.tenant?.id, page, status],
    queryFn: () =>
      api<{ items: WorkRow[]; total: number }>(config.route + `?page=${page}&status=${status}`),
  });
  const form = useForm<Record<string, string>>();
  const choices = useQuery({
    queryKey: ['employee-choices', me.tenant?.id],
    queryFn: () => api<EmployeeChoice[]>('/employees/choices'),
  });
  const refs = useQuery({
    queryKey: ['reference-data', me.tenant?.id],
    queryFn: () => api<ReferenceData>('/reference-data'),
  });
  const [validation, setValidation] = useState('');
  const create = useMutation({
    mutationFn: (body: unknown) => post(config.route, body),
    onSuccess: () => {
      client.invalidateQueries();
      setShow(false);
      form.reset();
    },
  });
  const withdraw = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      post('/' + (kind === 'leave' ? 'leave-requests' : kind) + '/' + id + '/withdraw', { reason }),
    onSuccess: () => client.invalidateQueries(),
  });
  const decide = useMutation({
    mutationFn: () =>
      post(config.route + '/' + review?.row.id + '/decision', { status: review?.status, comment }),
    onSuccess: () => {
      client.invalidateQueries();
      setReview(null);
      setComment('');
    },
  });
  const submitPermission = kind === 'leave' ? 'leave' : kind;
  const canSubmit = me.permissions.some(
    (p) => p === submitPermission + '.submit.any' || p === submitPermission + '.submit.self',
  );
  const canApprove = me.permissions.includes(submitPermission + '.approve');
  function submit(data: Record<string, string>) {
    const schema =
      kind === 'leave' ? leaveSchema : kind === 'timesheets' ? timesheetSchema : overtimeSchema;
    const keys =
      kind === 'leave'
        ? ['employeeId', 'leaveTypeId', 'startDate', 'endDate', 'reason']
        : kind === 'timesheets'
          ? ['employeeId', 'workDate', 'shift', 'startTime', 'endTime', 'breakHours']
          : ['employeeId', 'workDate', 'hours', 'category', 'reason'];
    const parsed = schema.safeParse(Object.fromEntries(keys.map((key) => [key, data[key]])));
    if (!parsed.success) {
      setValidation(parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '));
      return;
    }
    setValidation('');
    create.mutate(parsed.data);
  }
  return (
    <>
      <SectionHeading
        eyebrow="PEOPLE OPERATIONS"
        title={config.title}
        description={config.description}
        action={
          canSubmit ? (
            <Button onClick={() => setShow(true)}>
              <Plus size={16} /> {kind === 'leave' ? 'Request leave' : 'Submit entry'}
            </Button>
          ) : undefined
        }
      />
      {kind === 'timesheets' && (
        <Notice>
          Monthly employees use contractual salary and the company’s monthly standard hours. Regular
          timesheets are available only to weekly and fortnightly employees.
        </Notice>
      )}
      {withdraw.error && <Notice tone="error">{withdraw.error.message}</Notice>}
      <Card>
        <div className="toolbar">
          <label htmlFor="workflow-status" className="sr-only">
            Approval status
          </label>
          <select
            id="workflow-status"
            value={status}
            style={{ maxWidth: 180 }}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <Badge>{query.data?.total || 0} RECORDS</Badge>
        </div>
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
                    <th>Employee</th>
                    <th>{kind === 'leave' ? 'Leave period' : 'Work date'}</th>
                    <th>{kind === 'leave' ? 'Days / category' : 'Hours / category'}</th>
                    <th>Status</th>
                    <th>Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>
                          {r.employee.firstName} {r.employee.lastName}
                        </strong>
                        <small>
                          {r.employee.employeeNumber}
                          {r.submittedBy !== me.user.id ? ' · delegated/other actor' : ''}
                        </small>
                      </td>
                      <td>
                        {kind === 'leave'
                          ? `${r.startDate?.slice(0, 10)} → ${r.endDate?.slice(0, 10)}`
                          : r.workDate?.slice(0, 10)}
                      </td>
                      <td>
                        {kind === 'leave'
                          ? `${r.days} · ${r.leaveType?.name}`
                          : `${r.hours} · ${kind === 'timesheets' ? r.shift : '× ' + r.multiplier}`}
                        <small>{r.reason || r.comment}</small>
                      </td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                      <td>
                        {canApprove &&
                        r.status === 'PENDING' &&
                        r.submittedBy !== me.user.id &&
                        r.employeeId !== me.employeeId ? (
                          <div className="table-actions">
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setReview({ row: r, status: 'APPROVED' });
                                decide.reset();
                              }}
                            >
                              <Check size={14} /> Approve
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setReview({ row: r, status: 'REJECTED' });
                                decide.reset();
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : r.status === 'PENDING' ? (
                          'Awaiting authorized review'
                        ) : (
                          'Reviewed'
                        )}
                        {kind !== 'leave' && canSubmit && r.status !== 'WITHDRAWN' && (
                          <Button
                            variant="secondary"
                            disabled={withdraw.isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                'Withdrawal/correction reason (at least 10 characters). Submit a new entry for separate approval after withdrawing.',
                              );
                              if (reason) withdraw.mutate({ id: r.id, reason });
                            }}
                          >
                            Withdraw / correct
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data?.items.length && (
              <Empty title="No records in this view">
                Submit an eligible request or change the status filter.
              </Empty>
            )}
            <div className="toolbar">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={page * 25 >= (query.data?.total || 0)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
      {show && (
        <Modal titleId="workflow-create-title" onClose={() => setShow(false)}>
          <div className="modal-header">
            <h2 id="workflow-create-title">
              {kind === 'leave' ? 'Request leave' : 'Submit ' + kind}
            </h2>
            <Button
              variant="secondary"
              aria-label="Close entry form"
              onClick={() => setShow(false)}
            >
              <X size={18} />
            </Button>
          </div>
          <form onSubmit={form.handleSubmit(submit)}>
            <SelectField label="Employee" name="employeeId" register={form.register('employeeId')}>
              <option value="">Select an employee</option>
              {choices.data?.map((e) => (
                <option
                  key={e.id}
                  value={e.id}
                  disabled={
                    kind === 'timesheets'
                      ? e.frequency === 'MONTHLY'
                      : kind === 'overtime'
                        ? !e.overtimeEligible
                        : false
                  }
                >
                  {e.employeeNumber} · {e.firstName} {e.lastName}
                  {kind === 'timesheets' && e.frequency === 'MONTHLY'
                    ? ' (monthly — ineligible)'
                    : ''}
                </option>
              ))}
            </SelectField>
            {kind === 'leave' ? (
              <>
                <SelectField
                  label="Leave category"
                  name="leaveTypeId"
                  register={form.register('leaveTypeId')}
                >
                  <option value="">Select a category</option>
                  {refs.data?.leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </SelectField>
                <div className="form-grid">
                  <Field label="Start date" type="date" required {...form.register('startDate')} />
                  <Field label="End date" type="date" required {...form.register('endDate')} />
                </div>
                <Field label="Reason" required minLength={3} {...form.register('reason')} />
              </>
            ) : (
              <>
                <Field label="Work date" type="date" required {...form.register('workDate')} />
                {kind === 'timesheets' ? (
                  <>
                    <SelectField label="Shift" name="shift" register={form.register('shift')}>
                      <option value="">Choose a shift</option>
                      {refs.data?.references
                        .filter((r) => r.category === 'SHIFT' && r.active)
                        .map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                    </SelectField>
                    <div className="form-grid">
                      <Field
                        label="Start time"
                        type="time"
                        required
                        {...form.register('startTime')}
                      />
                      <Field label="End time" type="time" required {...form.register('endTime')} />
                    </div>
                    <Field
                      label="Break hours"
                      inputMode="decimal"
                      defaultValue="0"
                      required
                      {...form.register('breakHours')}
                    />
                    <small className="muted">
                      Overnight shifts are supported. Times use the company timezone.
                    </small>
                  </>
                ) : (
                  <>
                    <Field
                      label="Overtime hours"
                      inputMode="decimal"
                      required
                      {...form.register('hours')}
                    />
                    <SelectField
                      label="Overtime category"
                      name="category"
                      register={form.register('category')}
                    >
                      <option value="">Choose a category</option>
                      {refs.data?.references
                        .filter((r) => r.category === 'OVERTIME' && r.active)
                        .map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                    </SelectField>
                    <Field label="Reason" minLength={3} required {...form.register('reason')} />
                  </>
                )}
              </>
            )}
            {(validation || create.error) && (
              <Notice tone="error">{validation || create.error?.message}</Notice>
            )}
            <Button type="submit" disabled={create.isPending}>
              Submit for approval
            </Button>
          </form>
        </Modal>
      )}
      {review && (
        <Modal titleId="workflow-review-title" onClose={() => setReview(null)}>
          <div className="modal-header">
            <h2 id="workflow-review-title">
              {review.status === 'APPROVED' ? 'Approve' : 'Reject'} request
            </h2>
            <Button variant="secondary" aria-label="Close review" onClick={() => setReview(null)}>
              <X size={18} />
            </Button>
          </div>
          <p className="muted" style={{ marginTop: 20 }}>
            Review {review.row.employee.firstName} {review.row.employee.lastName}’s record. Your
            authority and separation-of-duties policy will be checked.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              decide.mutate();
            }}
          >
            <Field
              label="Review comment"
              minLength={3}
              required
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {decide.error && <Notice tone="error">{decide.error.message}</Notice>}
            <Button
              variant={review.status === 'APPROVED' ? 'primary' : 'danger'}
              disabled={decide.isPending}
            >
              Confirm {review.status === 'APPROVED' ? 'approval' : 'rejection'}
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function LeaveBalances() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const choices = useQuery({
    queryKey: ['employee-choices', me.tenant?.id],
    queryFn: () => api<EmployeeChoice[]>('/employees/choices'),
  });
  const [employeeId, setEmployeeId] = useState(me.employeeId || ''),
    [adjusting, setAdjusting] = useState(false),
    [message, setMessage] = useState('');
  const form = useForm<Record<string, string>>();
  const balances = useQuery({
    queryKey: ['leave-balances', me.tenant?.id, employeeId],
    queryFn: () =>
      api<
        {
          leaveTypeId: string;
          name: string;
          available: string;
          annualDays: string;
          carryForwardDays: string;
        }[]
      >('/leave-balances?employeeId=' + employeeId),
    enabled: Boolean(employeeId),
  });
  const adjust = useMutation({
    mutationFn: (b: Record<string, string>) => post('/leave-balances/adjust', { ...b, employeeId }),
    onSuccess: () => {
      client.invalidateQueries();
      setAdjusting(false);
    },
  });
  const accrual = useMutation({
    mutationFn: (month: string) => post<{ posted: number }>('/leave-balances/accrue', { month }),
    onSuccess: (d) => {
      client.invalidateQueries();
      setMessage(`Posted ${d.posted} monthly accrual entries.`);
    },
  });
  return (
    <>
      <SectionHeading
        eyebrow="LEAVE ENTITLEMENT"
        title="Leave balances"
        description="Credits, utilization and authorized adjustments with expiry-aware history."
      />
      <Card className="section-card">
        <label htmlFor="balance-employee">Employee</label>
        <select
          id="balance-employee"
          style={{ margin: '12px 0 20px' }}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          <option value="">Select an employee</option>
          {choices.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.firstName} {e.lastName}
            </option>
          ))}
        </select>
        {!employeeId ? (
          <Empty title="Select an employee to view balances" />
        ) : balances.isPending ? (
          <Loading />
        ) : balances.error ? (
          <Notice tone="error">{balances.error.message}</Notice>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Leave type</th>
                  <th>Available days</th>
                  <th>Annual policy</th>
                  <th>Carry-forward cap</th>
                </tr>
              </thead>
              <tbody>
                {balances.data?.map((t) => (
                  <tr key={t.leaveTypeId}>
                    <td>{t.name}</td>
                    <td>
                      <strong>{t.available}</strong>
                    </td>
                    <td>{t.annualDays}</td>
                    <td>{t.carryForwardDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {employeeId && me.permissions.includes('leave.balance.adjust') && (
          <Button style={{ marginTop: 20 }} onClick={() => setAdjusting(true)}>
            Record opening / adjustment
          </Button>
        )}
      </Card>
      {me.permissions.includes('leave.balance.adjust') && (
        <Card className="section-card">
          <h2>Monthly policy accrual</h2>
          <p className="muted">
            Applies configured annual policies to eligible active employees. Repeated posting of the
            same month does not duplicate credits.
          </p>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const month = new FormData(e.currentTarget).get('month');
              accrual.mutate(String(month));
            }}
          >
            <Field label="Accrual month" type="month" name="month" required />
            <Button disabled={accrual.isPending}>Post accrual</Button>
          </form>
          {message && <Notice tone="success">{message}</Notice>}
          {accrual.error && <Notice tone="error">{accrual.error.message}</Notice>}
        </Card>
      )}
      {adjusting && (
        <Modal titleId="balance-adjust-title" onClose={() => setAdjusting(false)}>
          <h2 id="balance-adjust-title">Adjust leave balance</h2>
          <form onSubmit={form.handleSubmit((b) => adjust.mutate(b))}>
            <SelectField
              label="Leave type"
              name="leaveTypeId"
              register={form.register('leaveTypeId')}
            >
              <option value="">Select a type</option>
              {balances.data?.map((t) => (
                <option key={t.leaveTypeId} value={t.leaveTypeId}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            <Field label="Days (negative to deduct)" required {...form.register('days')} />
            <Field
              label="Effective date"
              type="date"
              required
              {...form.register('effectiveDate')}
            />
            <Field label="Reason" required minLength={3} {...form.register('reason')} />
            {adjust.error && <Notice tone="error">{adjust.error.message}</Notice>}
            <Button disabled={adjust.isPending}>Record audited adjustment</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
type ImportJob = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  rows: {
    rowNumber: number;
    status: string;
    error: string | null;
    entityId: string | null;
    input: unknown;
  }[];
};
export function ImportsPage() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const [kind, setKind] = useState('EMPLOYEES'),
    [file, setFile] = useState<File | null>(null),
    [jobId, setJobId] = useState<string | null>(null),
    [error, setError] = useState(''),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const history = useQuery({
    queryKey: ['imports', me.tenant?.id],
    queryFn: () => api<ImportJob[]>('/imports'),
  });
  const job = useQuery({
    queryKey: ['import-job', jobId, me.tenant?.id],
    queryFn: () => api<ImportJob>('/imports/' + jobId),
    enabled: Boolean(jobId),
    refetchInterval: (q) =>
      ['QUEUED', 'PROCESSING'].includes(q.state.data?.status || '') ? 1500 : false,
  });
  const fileBody = async () => {
    if (!file) throw new Error('Choose a CSV or XLSX file');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { kind, filename: file.name, fileBase64: btoa(binary) };
  };
  const columns = useMutation({
    mutationFn: async () =>
      post<{ headers: string[]; targets: string[] }>('/imports/columns', await fileBody()),
  });
  const preview = useMutation({
    mutationFn: async () => post<ImportJob>('/imports/preview', { ...(await fileBody()), mapping }),
    onSuccess: (d) => {
      setJobId(d.id);
      client.invalidateQueries();
    },
  });
  const execute = useMutation({
    mutationFn: () => post('/imports/' + jobId + '/execute', {}),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <>
      <SectionHeading
        eyebrow="CONTROLLED BULK OPERATIONS"
        title="Spreadsheet imports"
        description="Preview staged rows, execute safely, and review an outcome for every row."
      />
      <Card className="section-card">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="import-kind">Import type</label>
            <select id="import-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="EMPLOYEES">Employees</option>
              <option value="TIMESHEETS">Regular timesheets</option>
            </select>
          </div>
          <Field
            label="CSV or XLSX file (up to 5 MB)"
            name="import-file"
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setMapping({});
              columns.reset();
            }}
          />
        </div>
        <div className="table-actions">
          <Button
            variant="secondary"
            onClick={() =>
              download(
                '/imports/templates/' + kind.toLowerCase(),
                kind.toLowerCase() + '-template-v1.xlsx',
              ).catch((e) => setError(e.message))
            }
          >
            <Download size={16} /> Download template
          </Button>
          <Button
            variant="secondary"
            disabled={columns.isPending || !file}
            onClick={() => columns.mutate()}
          >
            Inspect columns
          </Button>
          <Button disabled={preview.isPending || !file} onClick={() => preview.mutate()}>
            <Upload size={16} /> Validate & preview
          </Button>
        </div>
        {columns.data && (
          <div className="form-grid">
            {columns.data.headers.map((header) => (
              <div className="field" key={header}>
                <label htmlFor={'mapping-' + header}>{header}</label>
                <select
                  id={'mapping-' + header}
                  value={mapping[header] ?? (columns.data?.targets.includes(header) ? header : '')}
                  onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                >
                  <option value="">Ignore column</option>
                  {columns.data?.targets.map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        <Notice>
          Use the versioned template headers. Blank update cells preserve existing values; a blank
          employee ID creates a new employee. Monthly regular timesheets are rejected. Sensitive
          staging fields are encrypted and redacted in previews.
        </Notice>
        {(error || preview.error || columns.error) && (
          <Notice tone="error">{error || preview.error?.message || columns.error?.message}</Notice>
        )}
      </Card>
      {jobId && (
        <Card>
          <div className="card-header">
            <h2>Import preview & results</h2>
            <Badge>{job.data?.status || 'LOADING'}</Badge>
          </div>
          {job.isPending ? (
            <Loading />
          ) : job.error ? (
            <Notice tone="error">{job.error.message}</Notice>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>State</th>
                      <th>Preview</th>
                      <th>Result / error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.data?.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td>
                        <td>
                          <Badge>{r.status}</Badge>
                        </td>
                        <td>
                          <details>
                            <summary>View row</summary>
                            <pre>{JSON.stringify(r.input, null, 2)}</pre>
                          </details>
                        </td>
                        <td>{r.error || r.entityId || 'Ready for execution'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="toolbar">
                {job.data?.status === 'PREVIEW' && (
                  <Button
                    disabled={execute.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Execute this staged import? Valid rows will be committed and every row will receive a result.',
                        )
                      )
                        execute.mutate();
                    }}
                  >
                    <FileSpreadsheet size={16} /> Execute import
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() =>
                    download('/imports/' + jobId + '/results.csv', 'import-results.csv').catch(
                      (e) => setError(e.message),
                    )
                  }
                >
                  Download row results
                </Button>
              </div>
              {execute.error && <Notice tone="error">{execute.error.message}</Notice>}
            </>
          )}
        </Card>
      )}
      <Card className="section-card">
        <h2>Import history</h2>
        {history.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Results</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((j) => (
                  <tr key={j.id}>
                    <td>{j.kind}</td>
                    <td>
                      <Badge>{j.status}</Badge>
                    </td>
                    <td>
                      {new Date(j.createdAt).toLocaleString('en-JM', {
                        timeZone: me.tenant?.timezone,
                      })}
                    </td>
                    <td>
                      <Button variant="secondary" onClick={() => setJobId(j.id)}>
                        View results
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No imports yet" />
        )}
      </Card>
    </>
  );
}
