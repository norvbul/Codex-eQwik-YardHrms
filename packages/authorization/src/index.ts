export const allPermissions = [
  'company.read',
  'company.write',
  'employees.read',
  'employees.write',
  'employees.sensitive',
  'compensation.read',
  'compensation.write',
  'leave.submit.self',
  'leave.submit.any',
  'leave.approve',
  'leave.balance.adjust',
  'timesheets.submit.self',
  'timesheets.submit.any',
  'timesheets.approve',
  'overtime.submit.self',
  'overtime.submit.any',
  'overtime.approve',
  'payroll.read',
  'payroll.prepare',
  'payroll.review',
  'payroll.approve',
  'payroll.rules',
  'payslips.read.self',
  'payslips.print.any',
  'imports.write',
  'reports.read',
  'users.write',
  'subscription.read',
  'subscription.write',
  'audit.read',
] as const;
export const rolePermissions: Record<string, readonly string[]> = {
  COMPANY_ADMIN: allPermissions,
  HR_OFFICER: [
    'company.read',
    'employees.read',
    'employees.write',
    'employees.sensitive',
    'leave.submit.any',
    'leave.approve',
    'leave.balance.adjust',
    'reports.read',
    'imports.write',
    'audit.read',
    'subscription.read',
  ],
  PAYROLL_OFFICER: [
    'company.read',
    'employees.read',
    'employees.sensitive',
    'compensation.read',
    'compensation.write',
    'leave.submit.any',
    'timesheets.submit.any',
    'overtime.submit.any',
    'payroll.read',
    'payroll.prepare',
    'payroll.rules',
    'payslips.print.any',
    'reports.read',
    'imports.write',
    'subscription.read',
  ],
  FINANCE_APPROVER: [
    'company.read',
    'employees.read',
    'compensation.read',
    'payroll.read',
    'payroll.review',
    'payroll.approve',
    'reports.read',
    'payslips.print.any',
    'subscription.read',
  ],
  MANAGER: [
    'company.read',
    'employees.read',
    'leave.submit.any',
    'timesheets.submit.any',
    'overtime.submit.any',
    'leave.approve',
    'timesheets.approve',
    'overtime.approve',
    'payslips.print.any',
    'subscription.read',
  ],
  EMPLOYEE: [
    'company.read',
    'leave.submit.self',
    'timesheets.submit.self',
    'overtime.submit.self',
    'payslips.read.self',
    'subscription.read',
  ],
};
export function subscriptionState(
  s: { status: string; expiresAt: Date | null; graceEndsAt: Date | null },
  now = new Date(),
): string {
  if (['SUSPENDED', 'REVOKED', 'PENDING'].includes(s.status)) return s.status;
  if (s.status === 'FREE') return 'FREE';
  if (s.expiresAt && s.expiresAt < now)
    return s.graceEndsAt && s.graceEndsAt >= now ? 'GRACE' : 'EXPIRED';
  return s.status;
}
export function canWriteSubscription(s: Parameters<typeof subscriptionState>[0]) {
  return ['FREE', 'ACTIVE', 'GRACE', 'TRIAL'].includes(subscriptionState(s));
}
export function requiresMfa(
  roles: string[],
  platformRole: string | null,
  permissions: readonly string[] = [],
) {
  return (
    Boolean(platformRole) ||
    permissions.some((p) =>
      [
        'users.write',
        'subscription.write',
        'company.write',
        'compensation.write',
        'compensation.read',
        'payroll.read',
        'payroll.review',
        'payroll.prepare',
        'payroll.approve',
        'payroll.rules',
      ].includes(p),
    ) ||
    roles.some((r) => ['COMPANY_ADMIN', 'PAYROLL_OFFICER', 'FINANCE_APPROVER'].includes(r))
  );
}
