# Company and operator guide

## Company onboarding and access

Register through HRMS, verify your mailbox and enroll a time-based authenticator. Free registration creates the centrally configured entitlement without a payment or activation code. Seeded Free capacity is five active employees and two active/invited company users; owner-configured plan changes can change future registrations.

Company Settings maintains names, contact/address, timezone, logo URL and accent color, monthly standard-hour defaults and self-approval policy. Changes are audited; approved payroll snapshots are preserved. The approved payroll package supplies the standard hours used by calculation, so reconcile it with company policy before payroll preparation. Self-approval starts disabled.

Users & Roles sends invitations, links memberships to employee profiles and manages role permissions and TEAM/TENANT approval scopes. Existing verified identities can join companies without resetting their passwords. Deactivation revokes sessions. An administrator cannot remove their own authority; Company Admin is a protected recovery role. Named and custom privileged permissions require MFA. Password reset revokes sessions and retains MFA enrollment.

Permissions govern authority; subscription features govern availability. Expiry after grace blocks ordinary writes and new payroll, while authorized historical viewing and exports remain available. Suspended/revoked licences block business access. Subscription information and redemption remain available for commercial recovery.

## Employees and configuration

Create employees with a company-unique number, organizational references, hire/employment dates and eligibility. HR officers can establish employee records; compensation requires independent compensation authority. An unconfigured salary is excluded from payroll preparation rather than treated as authorized zero pay. Payroll officers can change compensation from the employee profile without general employee editing permission. Changes require a reason and current record version; salary history retains effective dates and actors.

Link managers and user memberships explicitly. A user account is not automatically an employee. Managers may submit eligible requests for any active company employee, but their review scope remains their direct reports unless an authorized role explicitly grants broader scope. Deactivation preserves employment/financial history and reactivation enforces capacity.

Master Data maintains departments, positions, branches, employment types, shifts, schedules, overtime categories, holidays and leave types. Pay-impacting rule changes are prospective proposals. A different configuration administrator must approve them. Future approved changes are applied by the worker and calculation selects approved historical versions for work dates. Do not backdate configuration to alter an approved payroll.

## Leave, attendance and imports

Leave days follow the employee work schedule, company timezone and configured holidays. Opening balances and adjustments require authorized reasons. Debits allocate to credits so spent balances do not reappear when a credit expires. Monthly accrual is idempotent; carry-forward keeps ledger history. Review pending requests separately from submission.

Weekly/fortnightly time supports local and overnight shifts with break/overlap/leave checks. Monthly employees cannot submit regular timesheets; approved overtime depends on explicit eligibility. Approved/locked payroll prevents input edits. Reverse the affected payroll before an authorized reviewer withdraws an input and a corrected entry is submitted for separate approval.

Imports use versioned CSV/XLSX templates or explicit header mapping. Inspect, preview, correct errors, execute, then download per-row results. Blank update fields preserve existing values. The worker rechecks current membership, permissions, MFA eligibility, entitlements and capacity. Legacy identifiers preserve migration mappings across repeat imports. Source limits are 5 MiB, 5,000 rows and 100 columns; macros, formula cells, external links and excessive ZIP expansion are rejected.

## Documents and exports

Employee documents are restricted to their subject and authorized sensitive-data officers. Upload PDF/PNG/JPEG files up to 5 MiB. They remain quarantined until a real ClamAV daemon returns a clean verdict; unavailable or inconclusive scanning never releases a file. Retention dates are metadata, not automatic authorization to delete records. Retry scans after configuring the scanner.

Reports provide date-filtered CSV, XLSX, PDF or JSON. Small direct exports allow 1,000 source records. Background exports allow 50,000 CSV source records or 10,000 for PDF/XLSX. A job's private download belongs to its requesting actor and rechecks current authority. Financial reports use approved/locked/reversed snapshots with explicit state and test-mode markers.

## Operator controls

Keep runtime, migration, field-encryption and backup credentials in a secret manager. Runtime MySQL requires verified TLS in production; use `MYSQL_SSL=true` and the appropriate trusted CA. Redis supports authenticated `rediss` connections. SMTP requires TLS in production. S3 uses private buckets and verified HTTPS. Reverse proxies must supply only trusted client address headers.

Sessions are opaque and hashed, with HttpOnly/SameSite Strict/Secure production cookies, session-bound CSRF and exact allowed browser Origins. Distributed rate limits are backed by atomic Redis windows. Append-only database triggers protect audit, payment/subscription history, configuration reviews and approved payroll. External immutable audit retention, lost-MFA recovery policy and independent security review remain launch responsibilities.
