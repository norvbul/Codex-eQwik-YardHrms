import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { X, Plus } from 'lucide-react';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { api, post, patch } from '../../../packages/ui/src/api.js';
import { Button, Field, Card, Modal, Notice } from '../../../packages/ui/src/components.js';
import type { EmployeeChoice } from './employees.js';
export type AccessMember = {
  id: string;
  active: boolean;
  employeeId: string | null;
  user: { id: string; email: string; name: string };
  roles: { role: { id: string; name: string } }[];
};
export type AccessRole = {
  id: string;
  name: string;
  approvalScope: string;
  permissions: { permissionCode: string }[];
};
export function UserAccessDialog({
  member,
  roles,
  onClose,
}: {
  member: AccessMember;
  roles: AccessRole[];
  onClose: () => void;
}) {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const choices = useQuery({
    queryKey: ['employee-choices', me.tenant?.id],
    queryFn: () => api<EmployeeChoice[]>('/employees/choices'),
  });
  const [selected, setSelected] = useState(member.roles.map((r) => r.role.id)),
    [employeeId, setEmployeeId] = useState(member.employeeId || ''),
    [active, setActive] = useState(member.active);
  const save = useMutation({
    mutationFn: () =>
      patch('/users/' + member.id, { active, employeeId: employeeId || null, roleIds: selected }),
    onSuccess: () => {
      client.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal titleId="user-access-title" onClose={onClose}>
      <div className="modal-header">
        <h2 id="user-access-title">Manage user access</h2>
        <Button variant="secondary" aria-label="Close access dialog" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>
      <p className="muted" style={{ marginTop: 18 }}>
        {member.user.name} · {member.user.email}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset style={{ marginTop: 20 }}>
          <legend>Company roles</legend>
          <div className="role-list">
            {roles.map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  disabled={member.user.id === me.user.id}
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id),
                    )
                  }
                />{' '}
                {r.name.replaceAll('_', ' ')}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="linked-employee">Linked employee for self-service</label>
          <select
            id="linked-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">No employee link</option>
            {choices.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} · {e.employeeNumber}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            disabled={member.user.id === me.user.id}
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />{' '}
          Active membership
        </label>
        <Notice>
          Changes revoke this company’s existing sessions. Privileged roles require MFA before
          access.
        </Notice>
        {save.error && <Notice tone="error">{save.error.message}</Notice>}
        <Button disabled={save.isPending || !selected.length}>Save access</Button>
      </form>
    </Modal>
  );
}
export function RoleEditor({ roles }: { roles: AccessRole[] }) {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient();
  const [editing, setEditing] = useState<AccessRole | null>(),
    [permissions, setPermissions] = useState<string[]>([]),
    [scope, setScope] = useState('TEAM');
  const form = useForm<{ name: string }>();
  const list = useQuery({
    queryKey: ['permissions', me.tenant?.id],
    queryFn: () => api<{ code: string }[]>('/permissions'),
  });
  const save = useMutation({
    mutationFn: (b: { name: string }) =>
      editing
        ? patch('/roles/' + editing.id, { ...b, permissions, approvalScope: scope })
        : post('/roles', { ...b, permissions, approvalScope: scope }),
    onSuccess: () => {
      client.invalidateQueries();
      setEditing(undefined);
    },
  });
  function edit(role: AccessRole | null) {
    setEditing(role);
    setPermissions(role?.permissions.map((p) => p.permissionCode) || []);
    setScope(role?.approvalScope || 'TEAM');
    form.reset({ name: role?.name || '' });
    save.reset();
  }
  const label = (code: string) =>
    code
      .replaceAll('.', ' · ')
      .replaceAll('any', 'any employee')
      .replaceAll('self', 'own records')
      .replaceAll('write', 'manage')
      .replaceAll('read', 'view');
  return (
    <>
      <Card className="section-card">
        <div className="card-header">
          <h2>Role permissions</h2>
          <Button variant="secondary" onClick={() => edit(null)}>
            <Plus size={14} /> Create role
          </Button>
        </div>
        {roles.map((r) => (
          <div key={r.id} className="activity-item" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{r.name.replaceAll('_', ' ')}</strong>
              <small>
                {r.permissions.length} permissions ·{' '}
                {r.approvalScope === 'TEAM'
                  ? 'Direct-report approval scope'
                  : 'Company-wide approval scope'}
              </small>
            </div>
            {r.name !== 'COMPANY_ADMIN' && (
              <Button variant="secondary" onClick={() => edit(r)}>
                Edit permissions
              </Button>
            )}
          </div>
        ))}
      </Card>
      {editing !== undefined && (
        <Modal titleId="role-editor-title" onClose={() => setEditing(undefined)}>
          <div className="modal-header">
            <h2 id="role-editor-title">{editing ? 'Edit role' : 'Create role'}</h2>
            <Button
              variant="secondary"
              aria-label="Close role editor"
              onClick={() => setEditing(undefined)}
            >
              <X size={18} />
            </Button>
          </div>
          <form onSubmit={form.handleSubmit((b) => save.mutate(b))}>
            <Field label="Role name" required minLength={2} {...form.register('name')} />
            <div className="field">
              <label htmlFor="approval-scope">Approval authority</label>
              <select id="approval-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="TEAM">Direct reports only</option>
                <option value="TENANT">Company-wide</option>
              </select>
            </div>
            <fieldset>
              <legend>Allowed actions</legend>
              <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                {list.data?.map((p) => (
                  <label key={p.code} style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={permissions.includes(p.code)}
                      onChange={(e) =>
                        setPermissions(
                          e.target.checked
                            ? [...permissions, p.code]
                            : permissions.filter((c) => c !== p.code),
                        )
                      }
                    />{' '}
                    {label(p.code)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Notice>
              Submission permissions and approval authority remain independent. Subscription
              features do not grant role permissions.
            </Notice>
            {save.error && <Notice tone="error">{save.error.message}</Notice>}
            <Button disabled={save.isPending} style={{ marginTop: 20 }}>
              Save role permissions
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
