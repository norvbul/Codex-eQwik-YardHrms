import { DocumentVault } from '../../../packages/ui/src/documents.js';
import { useState, useDeferredValue } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, X, Download, UserRound } from 'lucide-react';
import { employeeSchema, type EmployeeInput } from '../../../packages/types/src/index.js';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { api, post, patch, download } from '../../../packages/ui/src/api.js';
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
export type ReferenceData = {
  departments: { id: string; name: string }[];
  references: {
    id: string;
    category: string;
    name: string;
    active: boolean;
    configuration: Record<string, unknown> | null;
  }[];
  leaveTypes: {
    id: string;
    name: string;
    paidFraction: string;
    annualDays: string;
    carryForwardDays: string;
  }[];
  holidays: { id: string; name: string; date: string }[];
};
export type EmployeeRecord = Omit<EmployeeInput, 'reason' | 'hireDate' | 'version'> & {
  id: string;
  hireDate: string;
  version: number;
  department?: { name: string } | null;
  bank?: { bankName: string; bankAccount: string };
};
export type EmployeeChoice = {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  frequency: string;
  overtimeEligible: boolean;
};
export function SelectField({
  label,
  name,
  children,
  register,
  disabled = false,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
  register?: Record<string, unknown>;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} disabled={disabled} {...register}>
        {children}
      </select>
    </div>
  );
}
function EmployeeForm({ record, onClose }: { record?: EmployeeRecord; onClose: () => void }) {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const refs = useQuery({
    queryKey: ['reference-data', me.tenant?.id],
    queryFn: () => api<ReferenceData>('/reference-data'),
  });
  const choices = useQuery({
    queryKey: ['employee-choices', me.tenant?.id],
    queryFn: () => api<EmployeeChoice[]>('/employees/choices'),
  });
  const canComp = me.permissions.includes('compensation.write'),
    canSensitive = me.permissions.includes('employees.sensitive');
  const [defaultDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: me.tenant?.timezone }).format(new Date()),
  );
  const form = useForm<EmployeeInput>({
    defaultValues: record
      ? {
          ...record,
          hireDate: record.hireDate.slice(0, 10),
          ...Object.fromEntries(
            ['dateOfBirth', 'probationDate', 'confirmationDate', 'terminationDate'].map((key) => [
              key,
              (record[key as keyof EmployeeRecord] as string | null | undefined)?.slice(0, 10) ||
                '',
            ]),
          ),
          basePay: String(record.basePay ?? '0'),
          standardHours: String(record.standardHours),
          reason: '',
          sensitive: { ...record.sensitive, ...record.bank },
        }
      : {
          employeeNumber: '',
          firstName: '',
          lastName: '',
          hireDate: defaultDate,
          frequency: 'MONTHLY',
          payType: 'SALARY',
          basePay: '0',
          standardHours: String(me.tenant?.monthlyStandardHours || ''),
          employmentType: 'Permanent',
          overtimeEligible: false,
          active: true,
          reason: '',
        },
  });
  const [validation, setValidation] = useState('');
  const mutation = useMutation({
    mutationFn: (b: EmployeeInput) =>
      record ? patch('/employees/' + record.id, b) : post('/employees', b),
    onSuccess: () => {
      client.invalidateQueries();
      onClose();
    },
  });
  const refOptions = (category: string) =>
    refs.data?.references
      .filter((r) => r.category === category && r.active)
      .map((r) => (
        <option key={r.id} value={r.name}>
          {r.name}
        </option>
      ));
  function submit(raw: EmployeeInput) {
    const value = Object.fromEntries(
      Object.keys(employeeSchema.shape).map((key) => [key, raw[key as keyof EmployeeInput]]),
    ) as EmployeeInput;
    for (const key of [
      'dateOfBirth',
      'probationDate',
      'confirmationDate',
      'terminationDate',
      'effectiveDate',
    ] as const)
      if (!value[key]) delete value[key];
    if (!value.departmentId) value.departmentId = null;
    if (!value.managerId) value.managerId = null;
    if (!value.scheduleId) value.scheduleId = null;
    for (const [key, entry] of Object.entries(value))
      if (entry === null && !['departmentId', 'managerId', 'scheduleId'].includes(key))
        delete (value as Partial<EmployeeInput>)[key as keyof EmployeeInput];
    if (value.emergencyContacts)
      value.emergencyContacts = value.emergencyContacts.filter((contact) =>
        Boolean(contact.name || contact.phone || contact.relationship),
      );
    if (!canSensitive) delete value.sensitive;
    const result = employeeSchema.safeParse(value);
    if (!result.success) {
      setValidation(result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '));
      return;
    }
    setValidation('');
    const payload = result.data as EmployeeInput;
    if (record && !canComp) {
      const filtered = { ...payload } as Partial<EmployeeInput>;
      delete filtered.basePay;
      delete filtered.frequency;
      delete filtered.payType;
      delete filtered.standardHours;
      mutation.mutate(filtered as EmployeeInput);
    } else mutation.mutate(payload);
  }
  return (
    <Modal titleId="employee-form-title" onClose={onClose}>
      <div className="modal-header">
        <div>
          <span className="eyebrow">EMPLOYEE RECORD</span>
          <h2 id="employee-form-title">{record ? 'Edit employee' : 'Add an employee'}</h2>
        </div>
        <Button variant="secondary" onClick={onClose} aria-label="Close employee form">
          <X size={18} />
        </Button>
      </div>
      <form onSubmit={form.handleSubmit(submit)}>
        <div className="form-grid">
          <Field label="Employee number" required {...form.register('employeeNumber')} />
          <Field label="Hire date" type="date" required {...form.register('hireDate')} />
          <Field label="First name" required {...form.register('firstName')} />
          <Field label="Last name" required {...form.register('lastName')} />
          <Field label="Email address" type="email" {...form.register('email')} />
          <Field label="Phone" {...form.register('phone')} />
          <SelectField
            label="Department"
            name="departmentId"
            register={form.register('departmentId')}
          >
            <option value="">Not assigned</option>
            {refs.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Supervisor" name="managerId" register={form.register('managerId')}>
            <option value="">Not assigned</option>
            {choices.data
              ?.filter((e) => e.id !== record?.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
          </SelectField>
          <SelectField
            label="Work schedule"
            name="scheduleId"
            register={form.register('scheduleId')}
          >
            <option value="">Company standard</option>
            {refs.data?.references
              .filter((r) => r.category === 'SCHEDULE' && r.active)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </SelectField>
          <SelectField label="Position" name="position" register={form.register('position')}>
            <option value="">Not assigned</option>
            {refOptions('POSITION')}
          </SelectField>
          <SelectField label="Branch" name="branch" register={form.register('branch')}>
            <option value="">Not assigned</option>
            {refOptions('BRANCH')}
          </SelectField>
          <SelectField
            label="Employment type"
            name="employmentType"
            register={form.register('employmentType')}
          >
            {refOptions('EMPLOYMENT_TYPE')}
          </SelectField>
          <SelectField label="Parish" name="parish" register={form.register('parish')}>
            <option value="">Not specified</option>
            {refOptions('PARISH')}
          </SelectField>
          <Field label="Address" {...form.register('address')} />
          <Field label="Gender (optional)" {...form.register('gender')} />
          <Field label="Date of birth" type="date" {...form.register('dateOfBirth')} />
          <Field label="Probation end date" type="date" {...form.register('probationDate')} />
          <Field label="Confirmation date" type="date" {...form.register('confirmationDate')} />
          <Field label="Termination date" type="date" {...form.register('terminationDate')} />
        </div>
        <h3 style={{ marginTop: 22 }}>Compensation & eligibility</h3>
        <div className="form-grid">
          <SelectField
            label="Pay frequency"
            name="frequency"
            register={form.register('frequency')}
            disabled={!canComp}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="FORTNIGHTLY">Fortnightly</option>
            <option value="WEEKLY">Weekly</option>
          </SelectField>
          <SelectField
            label="Pay type"
            name="payType"
            register={form.register('payType')}
            disabled={!canComp}
          >
            <option value="SALARY">Salary per period</option>
            <option value="HOURLY">Hourly</option>
          </SelectField>
          {canComp && (
            <>
              <Field label="Base pay (JMD)" inputMode="decimal" {...form.register('basePay')} />
              <Field
                label="Standard hours"
                inputMode="decimal"
                {...form.register('standardHours')}
              />
              {record && (
                <Field
                  label="Compensation effective date"
                  type="date"
                  {...form.register('effectiveDate')}
                />
              )}
            </>
          )}
        </div>
        <label className="checkbox-field">
          <input type="checkbox" {...form.register('overtimeEligible')} /> Eligible for approved
          overtime
        </label>
        <label className="checkbox-field">
          <input type="checkbox" {...form.register('active')} /> Active employee
        </label>
        {canSensitive && (
          <details>
            <summary>Sensitive identity & banking</summary>
            <div className="form-grid">
              <Field label="TRN" {...form.register('sensitive.trn')} />
              <Field label="NIS identifier" {...form.register('sensitive.nis')} />
              <Field label="NHT identifier" {...form.register('sensitive.nht')} />
              <Field label="Bank name" {...form.register('sensitive.bankName')} />
              <Field label="Bank account" {...form.register('sensitive.bankAccount')} />
            </div>
            <small className="muted">
              Identity and account details are encrypted and permission-restricted.
            </small>
          </details>
        )}
        <details style={{ marginTop: 20 }}>
          <summary>Emergency contact</summary>
          <Field label="Emergency contact name" {...form.register('emergencyContacts.0.name')} />
          <Field label="Relationship" {...form.register('emergencyContacts.0.relationship')} />
          <Field label="Emergency contact phone" {...form.register('emergencyContacts.0.phone')} />
        </details>
        <Field label="Reason for this change" required minLength={3} {...form.register('reason')} />
        {(validation || mutation.error) && (
          <Notice tone="error">{validation || mutation.error?.message}</Notice>
        )}
        <Button disabled={mutation.isPending} type="submit">
          {mutation.isPending ? 'Saving…' : record ? 'Save employee' : 'Create employee'}
        </Button>
      </form>
    </Modal>
  );
}
export function EmployeesPage() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const [search, setSearch] = useState(''),
    [active, setActive] = useState(''),
    [page, setPage] = useState(1),
    [sort, setSort] = useState('lastName'),
    [editing, setEditing] = useState<EmployeeRecord | null>(),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState('');
  const deferred = useDeferredValue(search);
  const q = useQuery({
    queryKey: ['employees', me.tenant?.id, deferred, active, page, sort],
    queryFn: () =>
      api<{ items: EmployeeRecord[]; total: number }>(
        `/employees?search=${encodeURIComponent(deferred)}&active=${active}&page=${page}&sort=${sort}`,
      ),
  });
  const profile = useQuery({
    queryKey: ['employee', selected, me.tenant?.id],
    queryFn: () => api<EmployeeRecord>('/employees/' + selected),
    enabled: Boolean(selected),
  });
  const change = useMutation({
    mutationFn: (r: EmployeeRecord) =>
      patch('/employees/' + r.id, {
        active: !r.active,
        version: r.version,
        reason: r.active ? 'Authorized deactivation' : 'Authorized reactivation',
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <>
      <SectionHeading
        eyebrow="YOUR WORKFORCE"
        title="Employees"
        description="Manage company records while preserving employment and payroll history."
        action={
          <div className="table-actions">
            {me.permissions.includes('reports.read') && (
              <Button
                variant="secondary"
                onClick={() =>
                  download('/reports/employees?format=csv', 'employee-roster.csv').catch((e) =>
                    setError(e.message),
                  )
                }
              >
                <Download size={15} /> Export roster
              </Button>
            )}
            {me.permissions.includes('employees.write') && (
              <Button onClick={() => setEditing(null)}>
                <Plus size={16} /> Add employee
              </Button>
            )}
          </div>
        }
      />
      {(error || change.error) && <Notice tone="error">{error || change.error?.message}</Notice>}
      <Card>
        <div className="toolbar">
          <Search size={17} />
          <label className="sr-only" htmlFor="employee-search">
            Search employees
          </label>
          <input
            className="search"
            id="employee-search"
            value={search}
            placeholder="Search name, number or email…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <label className="sr-only" htmlFor="employee-status">
            Employment status
          </label>
          <select
            id="employee-status"
            style={{ maxWidth: 150 }}
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <Badge>{q.data?.total || 0} RECORDS</Badge>
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
                    <th>
                      <button onClick={() => setSort('employeeNumber')}>Employee number</button>
                    </th>
                    <th>
                      <button onClick={() => setSort('lastName')}>Employee</button>
                    </th>
                    <th>Department</th>
                    <th>Pay frequency</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((e) => (
                    <tr key={e.id}>
                      <td>{e.employeeNumber}</td>
                      <td>
                        <button onClick={() => setSelected(e.id)} style={{ textAlign: 'left' }}>
                          <strong>
                            {e.firstName} {e.lastName}
                          </strong>
                          <small>{e.email || e.position}</small>
                        </button>
                      </td>
                      <td>{e.department?.name || 'Unassigned'}</td>
                      <td>{e.frequency.toLowerCase()}</td>
                      <td>
                        <Badge>{e.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
                      </td>
                      <td>
                        {me.permissions.includes('employees.write') && (
                          <div className="table-actions">
                            <Button
                              variant="secondary"
                              onClick={async () => {
                                try {
                                  setEditing(await api<EmployeeRecord>('/employees/' + e.id));
                                } catch (error) {
                                  setError((error as Error).message);
                                }
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={change.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `${e.active ? 'Deactivate' : 'Reactivate'} ${e.firstName} ${e.lastName}? Historical data will be retained.`,
                                  )
                                )
                                  change.mutate(e);
                              }}
                            >
                              {e.active ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.items.length && (
              <Empty title="No employee records in this view">
                Add your first employee or adjust your search.
              </Empty>
            )}
            <div className="toolbar">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                disabled={page * 25 >= (q.data?.total || 0)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
      {editing !== undefined && (
        <EmployeeForm record={editing || undefined} onClose={() => setEditing(undefined)} />
      )}{' '}
      {selected && (
        <Modal titleId="employee-profile-title" onClose={() => setSelected(null)}>
          <div className="modal-header">
            <h2 id="employee-profile-title">Employee profile</h2>
            <Button
              variant="secondary"
              aria-label="Close employee profile"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </Button>
          </div>
          {profile.isPending ? (
            <Loading />
          ) : profile.error ? (
            <Notice tone="error">{profile.error.message}</Notice>
          ) : (
            profile.data && <ProfileDetails employee={profile.data} />
          )}
        </Modal>
      )}
    </>
  );
}
export function ProfileDetails({ employee: e }: { employee: EmployeeRecord }) {
  const { me } = useOutletContext<SessionOutlet>();
  return (
    <div>
      <div className="activity-item">
        <span className="avatar">
          <UserRound size={18} />
        </span>
        <div>
          <h2>
            {e.firstName} {e.lastName}
          </h2>
          <small>
            {e.employeeNumber} · {e.position || 'Employee'}
          </small>
        </div>
      </div>
      <div className="activity-item">
        <div>
          {e.email || 'No email provided'}
          <small>{e.phone || 'No phone provided'}</small>
        </div>
      </div>
      <div className="activity-item">
        <div>
          {e.employmentType} · {e.frequency.toLowerCase()}
          <small>
            Hired {e.hireDate.slice(0, 10)} · {e.active ? 'Active' : 'Inactive'}
          </small>
        </div>
      </div>
      {e.basePay !== undefined && (
        <div className="activity-item">
          <div>
            JMD {Number(e.basePay).toLocaleString('en-JM', { minimumFractionDigits: 2 })}
            <small>
              {e.payType === 'HOURLY' ? 'Hourly compensation' : 'Contractual pay per period'} ·{' '}
              {e.standardHours} standard hours
            </small>
          </div>
        </div>
      )}
      {e.sensitive && (
        <details>
          <summary>Authorized identity details</summary>
          <p className="muted">
            TRN: {e.sensitive.trn || 'Not provided'}
            <br />
            NIS: {e.sensitive.nis || 'Not provided'}
            <br />
            NHT: {e.sensitive.nht || 'Not provided'}
          </p>
        </details>
      )}
      {e.bank && (
        <details>
          <summary>Authorized bank details</summary>
          <p className="muted">
            {e.bank.bankName}
            <br />
            {e.bank.bankAccount}
          </p>
        </details>
      )}
      {(me.employeeId === e.id || me.permissions.includes('employees.sensitive')) && (
        <DocumentVault
          employeeId={e.id}
          canUpload={me.permissions.includes('employees.sensitive')}
        />
      )}
      <CompensationHistory employee={e} />
    </div>
  );
}
export function MyProfile() {
  const { me } = useOutletContext<SessionOutlet>();
  const q = useQuery({
    queryKey: ['my-profile', me.tenant?.id],
    queryFn: () => api<EmployeeRecord>('/employees/me'),
  });
  return (
    <>
      <SectionHeading
        eyebrow="EMPLOYEE SELF-SERVICE"
        title="My profile"
        description="Your own employment record and authorized details."
      />
      <Card className="section-card">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <Notice>{q.error.message}</Notice>
        ) : (
          <ProfileDetails employee={q.data!} />
        )}
      </Card>
    </>
  );
}

function CompensationHistory({ employee: e }: { employee: EmployeeRecord }) {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient(),
    [editing, setEditing] = useState(false),
    canRead = me.employeeId === e.id || me.permissions.includes('compensation.read');
  const q = useQuery({
    queryKey: ['compensation-history', me.tenant?.id, e.id],
    queryFn: () =>
      api<
        {
          id: string;
          effectiveDate: string;
          basePay: string;
          frequency: string;
          payType: string;
          reason: string;
          actorId: string;
        }[]
      >('/employees/' + e.id + '/compensation'),
    enabled: canRead,
  });
  const form = useForm({
    defaultValues: {
      basePay: String(e.basePay || '0'),
      standardHours: String(e.standardHours),
      frequency: e.frequency,
      payType: e.payType,
      effectiveDate: '',
      reason: '',
    },
  });
  const save = useMutation({
    mutationFn: (v: object) =>
      post('/employees/' + e.id + '/compensation', { ...v, version: e.version }),
    onSuccess: () => {
      client.invalidateQueries();
      setEditing(false);
    },
  });
  if (!canRead) return null;
  return (
    <Card className="section-card">
      <div className="card-header">
        <h2>Compensation history</h2>
        {me.permissions.includes('compensation.write') && (
          <Button variant="secondary" onClick={() => setEditing(!editing)}>
            Change compensation
          </Button>
        )}
      </div>
      {q.error && <Notice tone="error">{q.error.message}</Notice>}
      {q.data?.map((h) => (
        <div className="usage-line" key={h.id}>
          <span>
            {h.effectiveDate.slice(0, 10)} · {h.frequency.toLowerCase()} · {h.payType.toLowerCase()}
            <small>
              {h.reason} · {h.actorId}
            </small>
          </span>
          <strong>JMD {h.basePay}</strong>
        </div>
      ))}
      {editing && (
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Compensation base pay" required {...form.register('basePay')} />
          <Field label="Compensation standard hours" required {...form.register('standardHours')} />
          <SelectField
            label="Compensation pay frequency"
            name="comp-frequency"
            register={form.register('frequency')}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="FORTNIGHTLY">Fortnightly</option>
            <option value="WEEKLY">Weekly</option>
          </SelectField>
          <SelectField
            label="Compensation pay type"
            name="comp-pay-type"
            register={form.register('payType')}
          >
            <option value="SALARY">Salary</option>
            <option value="HOURLY">Hourly</option>
          </SelectField>
          <Field
            label="Compensation effective date"
            type="date"
            required
            {...form.register('effectiveDate')}
          />
          <Field
            label="Compensation change reason"
            required
            minLength={3}
            {...form.register('reason')}
          />
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <Button disabled={save.isPending}>Save compensation</Button>
        </form>
      )}
    </Card>
  );
}
