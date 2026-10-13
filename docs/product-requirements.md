QWIK BUSINESS SOLUTIONS
PRODUCT REQUIREMENTSDOCUMENT
eQwik YardHRMS™
Full-Stack React & MySQL SaaSWith Qwik Licence & Subscription Manager

Design mandate: Replace Google Apps Script and Google Sheets with secure hosted React portals, Node.js services and MySQL.
Document version: 1.0
Date: 12 October 2026
Product owner: Qwik Business Solutions
Status: Proposed implementation specification — for approval

Document guide
This specification covers the tenant-facing HRMS, Qwik subscription administration, the new React/Node.js/MySQL architecture, data migration, release acceptance and open owner decisions.
Sections
Focus
01–05
Product context, scope, personas and journeys
06
Tenant HRMS functional requirements
07
Qwik licensing and manual payment requirements
08–10
Architecture, MySQL model and API surface
11–12
Non-functional requirements and acceptance scenarios
13–18
UX, migration, delivery plan, risks and sign-off

All numbered headings are available in Word’s Navigation Pane.

1. Executive summary
eQwik YardHRMS™ will be a cloud-hosted, subscription-based Human Resource Management and Payroll platform designed primarily for Jamaican businesses. It will centralize employee data, leave, timesheets, overtime, salary administration, Jamaican statutory payroll, payslips, reporting, configuration, and audit history. Qwik Business Solutions will operate a distinct Licence & Subscription Manager to manage customers, plans, manual payments, subscription terms, authorization codes, renewals, licensing status, and entitlements.
The new architecture will use React + TypeScript for the YardHRMS portal and the Qwik licensing administration portal; a Node.js/TypeScript REST API for all business logic; and MySQL for transactional data. No core feature will depend on Google Apps Script, a Google Sheet as the operational database, or a client-side licensing decision.
Recommended commercial architecture: one Qwik-hosted, logically multi-tenant SaaS platform, with tenant-isolated business data. A company signs up for the Free tier or activates a paid subscription using a one-time authorization code. A code binds to a tenant/company, not to a Google Apps Script installation. Manual payment verification remains the only payment confirmation method in the first release.
1.1 Confirmed requirements versus design proposals
Decision
Classification
Interpretation
Full-stack React application
Confirmed
Production React frontend; not React via CDN inside HTML Service
MySQL database
Confirmed
Authoritative relational database for HRMS and licensing
Remove Google Apps Script
Confirmed
Remove Apps Script hosting, Sheet-based ObjDB, google.script.run and script properties
Manual payment management
Confirmed
Qwik staff record and verify payments; no payment gateway or webhook
Free tier and paid subscription plans
Confirmed
Plan features, capacities, expiry and activation controls
Separate Qwik licensing management
Confirmed
Distinct administrative portal and protected licensing backend boundary
Single hosted multi-tenant SaaS
Proposed
Preferred replacement for per-customer Apps Script deployments
Node.js/NestJS, Prisma and Redis
Proposed
Recommended implementation choices, subject to engineering review

2. Business goals and success measures
Primary goals:
Offer one secure HR/payroll platform to multiple subscribing organizations without distributing source code or requiring customer-owned Google Sheets.
Process weekly, fortnightly and monthly payroll reliably with effective-dated Jamaican statutory rules.
Reduce manual HR administration through employee self-service, approvals, import tools, reports and controlled delegations.
Monetize the product through Free and paid plans with manual payment confirmation, centrally managed subscriptions and configurable entitlements.
Establish a migration path for existing YardHRMS customers while preserving their company data and historical payroll records.
KPI
Initial product acceptance target
Cross-tenant data access
Zero unauthorized cross-tenant access in automated security tests
Payroll calculation correctness
100% of approved reference payroll scenarios match signed-off expected results
Payroll approval integrity
No approved run can be silently modified; all changes require authorized reversal/correction
Licensing enforcement
100% of restricted write endpoints enforce tenant subscription state on the server
Import feedback
Every processed row is identified as created, updated, rejected or skipped with an actionable reason
Critical user journeys
All P0 end-to-end tests pass before production release
Operational availability
Target 99.9% monthly service availability, excluding announced maintenance

3. Scope and exclusions
3.1 In scope for the full-stack release
Public welcome/splash experience, company-specific branding and product/legal pages.
Authentication, organization membership, tenant-aware RBAC and user management.
Company, department, position, parish/location, employment-type, pay-frequency and payroll-policy configuration.
Employee records, compensation, bank details, documents, emergency contacts and employment status.
Leave types, requests, approvals, accruals, adjustments and balances.
Weekly/fortnightly timesheets and approved overtime; delegated submissions and audit attribution.
Payroll preparation, calculation, approval, locks, corrections and statutory outputs.
Payslip PDF creation, secure employee access and privileged printing.
Bulk spreadsheet import, validation previews, result logs and reusable templates.
Dashboards, HR/payroll reports, CSV/XLSX/PDF exports and audit log.
Qwik-owned Licence & Subscription Manager, Free tier, paid plans, manual payments, code generation, activation, renewals, capacity limits and expiration handling.
Automated migration tools for legacy Google Sheets data exports.
3.2 Out of scope for release 1
Online checkout, Stripe, PayPal and automated payment webhooks.
Native Android/iOS mobile applications (responsive web is included).
Direct banking transactions or automatic disbursement (file exports are included).
Direct live transmission to statutory authorities unless a verified integration is approved.
Biometric attendance, recruitment, performance appraisals and learning-management modules.
Offline payroll execution in a browser.
4. Personas, roles and permissions
Role
Primary responsibilities
Platform Super Admin (Qwik)
Manage products, tenants, plans, payments, subscriptions, entitlements, activation codes and platform operations
Platform Licensing Officer (Qwik)
Maintain customer/licensing records within assigned powers; payment verification according to policy
Company Admin
Manage own company settings, employees, users, roles, payroll configuration and access
HR Officer
Manage personnel records, leave policies, balances and HR reports
Payroll Officer
Maintain payroll inputs, prepare payroll, generate payroll outputs, submit delegated records
Finance Approver
Review/approve payroll and finance-related reports under configured authority
Manager/Supervisor
Review team workflows; submit delegated leave, timesheets and overtime for any active employee as expressly authorized
Employee
View own profile and leave balances, submit own eligible requests and view own payslips

Delegation rule (confirmed): Admin, Payroll Officer and Manager/Supervisor may submit leave, eligible regular timesheets and eligible overtime for any active employee, and view/print approved payslips for any employee. Every transaction records both employee_id (subject) and submitted_by_user_id or printed_by_user_id (actor). Delegated submission does not automatically expand approval authority: supervisory approvals remain governed by a separate policy/approval scope. Self-approval and separation-of-duties rules must be configurable and enforced.
Permission model: roles map to atomic permissions (employees.write, timesheets.submit.any, payroll.approve, payslips.print.any, etc.); license entitlements are an independent layer. A subscription allowing 10 users does not grant any of those users an HR/finance role.
5. Core journeys
5.1 New company — Free
Visitor reaches the Qwik-branded splash/marketing entry and selects Start Free.
Company administrator creates an organization with company details and verifies their email.
Backend creates tenant, primary admin membership and one centrally registered Free subscription.
Free plan entitlements and capacity become active without an authorization code or payment record.
Administrator configures the company, invites users and manages up to the current Free-plan limits.
5.2 New paid subscriber — manual payment
Qwik creates or selects the customer in the separate Licence Manager portal.
Qwik records the payment with amount, currency, date, receipt/reference, invoice number and covered period.
Authorized Qwik officer verifies payment; the verification is auditable.
Qwik creates a paid subscription or converts a Free company using the verified payment and selected plan.
Qwik generates a one-time activation code, displays it once and communicates it securely to the customer.
Company Admin enters the code in the HRMS Subscription page; backend redeems it atomically, binds it to the correct tenant and applies entitlements.
Central subscription changes take effect without redeploying or reinstalling the application.
5.3 Renewal, upgrade and expiry
A renewal uses a newly verified manual payment to extend the existing subscription; no new authorization code is normally required. Upgrades/downgrades update the tenant's subscription/entitlement snapshot, and do not alter employee records. After expiration and any configured grace period, the tenant enters a read-only business-data mode, retaining rights to view and export historical records and payslips while new payroll and transactional writes are blocked. Revoked/suspended states are more restrictive and may require support intervention. Data is never automatically deleted because a subscription expires.
5.4 Payroll run
Select frequency/period → load eligible employees → apply approved timesheets and leave → apply authorized overtime/allowances/deductions → calculate statutory amounts from effective-dated rules → review exceptions → approval by authorized role → lock run → issue payslips, bank file and statutory/management reports. Revisions to approved payroll use controlled reversal, adjustment or supplemental run, never a silent edit.
6. Functional requirements — tenant HRMS
Priority definition: P0 = launch-blocking; P1 = first enhancement release; P2 = later. Acceptance IDs refer to section 12.
6.1 Public site and company branding
ID
Priority
Requirement
HR-001
P0
Responsive landing page with product overview, Jamaican payroll capabilities, feature cards, testimonials/content placeholders and Free/paid entry CTA
HR-002
P0
Authenticated company name/logo displayed consistently in sidebar, header, document headers, splash/CTA after tenant resolution and browser title
HR-003
P0
Accessible About, Licence, Disclaimer and Copyright pages, with Qwik Business Solutions™ attribution
HR-004
P0
Company branding sourced from the tenant record, with defined placeholder/fallback if unset; no hardcoded customer name
HR-005
P1
Configurable tenant logo, accent color and onboarding guidance

6.2 Login, users and organization access
ID
Priority
Requirement
SEC-001
P0
Email/password login using server-side Argon2id password hashes; verified email and reset flow
SEC-002
P0
Secure HttpOnly/SameSite session cookie, session revocation and configurable idle timeout; optional Google/Microsoft SSO later
SEC-003
P0
User identity may belong to multiple organizations; session has an explicitly selected active tenant_id
SEC-004
P0
RBAC enforced in API and service layer; role assignments and custom permissions scoped to tenant
SEC-005
P0
Tenant Admin can invite/deactivate users; active users count against license seats
SEC-006
P0
MFA mandatory for Qwik platform staff; required for tenant Admin/Payroll/Finance roles at launch
SEC-007
P0
Sensitive fields (TRN, bank accounts, salary) are hidden/redacted without appropriate permission

6.3 Company and master-data configuration
ID
Priority
Requirement
CFG-001
P0
Company profile stores registered/trading name, identifiers, address, contacts, payroll details, locale/time zone and logo
CFG-002
P0
Admin configures parishes/locations, branches, departments, positions, employment types, shift types and public holidays
CFG-003
P0
Pay frequencies and standard hours are configuration-driven, including Monthly 173.33 standard hours by default
CFG-004
P0
Effective-dated tax tables, statutory ceilings, leave entitlements, overtime multipliers and allowances are editable with approval/version history
CFG-005
P0
Configuration changes must be validated, audited and apply prospectively; a past approved payroll remains reproducible

6.4 Employee information
ID
Priority
Requirement
EMP-001
P0
Add, view, edit, deactivate/reactivate employees; preserve historical records and unique tenant employee ID
EMP-002
P0
Store personal/contact data, TRN, NIS/NHT identifiers, emergency contacts, branch, manager, position, employment status and hire/termination dates
EMP-003
P0
Store compensation terms, pay type, frequency, standard hours, overtime eligibility, encrypted banking details and effective dates
EMP-004
P0
Enforce tenant employee-count limit for new active employees/reactivations and bulk imports; exclude inactive records from capacity
EMP-005
P1
Employee document vault with access policy, file retention and security scanning
EMP-006
P0
Personal-data changes and compensation changes carry author, reason, timestamp and before/after audit metadata

6.5 Leave/absence management
ID
Priority
Requirement
LEA-001
P0
Configurable leave categories: annual/vacation, sick, maternity, compassionate, unpaid, study, special and other tenant-defined
LEA-002
P0
Record requests with dates, working days, reasons, documents, requester, subject employee and approval history
LEA-003
P0
Apply public holidays, calendars and employee schedule to leave-day calculation
LEA-004
P0
Support opening balances, accruals, utilization, carry-forward, expiry and authorized adjustments
LEA-005
P0
Support manager/HR approval rules, rejection/comments and payroll impacts for unpaid/part-paid leave
LEA-006
P0
Admin/Payroll Officer/Manager may create leave for any active employee; approval permissions are separately evaluated

6.6 Timesheets and overtime
ID
Priority
Requirement
TIM-001
P0
Weekly and fortnightly employees enter or receive delegated regular timesheets with work date, shift, start/end, breaks and regular hours
TIM-002
P0
Monthly employees must not submit regular timesheets; salary calculations use configured 173.33 hours/month (unless a tenant policy explicitly changes the standard)
TIM-003
P0
Overtime is a separate request/approval flow and is available only for employees marked overtime-eligible, including eligible monthly employees
TIM-004
P0
Validate nonnegative hours, overnight spans, duplicates, overlapping entries, approval states and payroll lock conflicts
TIM-005
P0
Admin, Payroll Officer and Manager/Supervisor may record leave, timesheets and overtime on behalf of any eligible employee; capture the submitting actor
TIM-006
P0
Approved records feed payroll; imported or newly submitted records begin in Pending state unless an explicitly approved administrative override exists

6.7 Payroll processing and Jamaican statutory rules
ID
Priority
Requirement
PAY-001
P0
Weekly, fortnightly and monthly pay runs, with period dates, pay date and selection by employee/pay group
PAY-002
P0
Monthly salary employees require no regular timesheet; payroll uses contractual monthly amount and configured 173.33-hour standard where an hourly equivalent is needed
PAY-003
P0
Calculate base/regular pay, approved overtime, taxable/non-taxable allowances, bonus, commission, retro pay and paid/unpaid leave impacts
PAY-004
P0
Calculate PAYE, NIS, NHT, Education Tax and applicable employer liabilities; allow pension, insurance, loans, garnishment and other approved deductions
PAY-005
P0
Rates, thresholds, earnings ceilings and tax bases must be effective-dated and approved, not embedded as fixed constants in source code
PAY-006
P0
Use fixed-precision decimal arithmetic for money; define rounding, year-to-date basis and proration explicitly and test against approved examples
PAY-007
P0
Support Draft → Prepared → Reviewed → Approved → Locked lifecycle; separate preparation and final approval where policy requires
PAY-008
P0
Immutable approved run snapshots (employee pay components, calculations, tax rule version, actor and approval times); corrections through audited adjustments/reversals
PAY-009
P0
Generate individually protected PDF payslips, controlled bank-upload CSV/XLSX and statutory/departmental payroll reports
PAY-010
P0
Admin, Payroll Officer and Manager/Supervisor can securely view/print approved employee payslips for any employee; audit each print/download action
PAY-011
P1
Supplemental and retroactive payroll runs, retro arrears and manual recalculation previews

Compliance guardrail: The supplied HRMS outline contains different figures for certain statutory deductions in its introductory section versus its later 2026 research section. This PRD therefore does not hardcode those figures as verified law. The product must ship with a separately verified, effective-dated Jamaican statutory rules package, signed off by qualified payroll/legal reviewers, and support historic rule versions for accurate re-runs.
6.8 Bulk import and exports
ID
Priority
Requirement
IMP-001
P0
Employees and timesheets accept .xlsx and .csv uploads, and provide downloadable versioned templates
IMP-002
P0
Imports have preview, column mapping/validation, row-level error messages, duplicate detection and summary counts
IMP-003
P0
Employee import supports create by blank ID and update by existing ID, with explicit merge semantics and immutable audit of changes
IMP-004
P0
Timesheet import validates employee eligibility, dates, shifts, duplicate employee/date combinations and monthly-timesheet restriction
IMP-005
P0
Uploaded data enters a server-side staging/import job; bulk processing must be transactionally safe, retryable and report partial successes without duplicate replays
IMP-006
P0
Privileged users can export permitted HR/payroll data to CSV/XLSX/PDF without exposing records from other tenants

6.9 Dashboard, reporting and self-service
ID
Priority
Requirement
RPT-001
P0
Role-specific dashboard: workforce, leave, pending approvals, attendance, payroll snapshots and subscription usage
RPT-002
P0
HR reports: employee roster, hire/termination, leave requests/balances, absenteeism, timesheet and overtime summaries
RPT-003
P0
Payroll reports: register, net/gross totals, deductions, employer costs, statutory summaries, payslip and bank-file history
RPT-004
P0
Employee self-service: own profile, leave, eligible timesheets, overtime status and payslip access
RPT-005
P0
All report endpoints validate RBAC, plan entitlement and tenant_id; sensitive exports are audited

7. Functional requirements — Qwik Licence & Subscription Manager
The Licence Manager is a separate administrative React portal, hosted and operated by Qwik. It shares protected backend platform services and MySQL but has distinct platform-only authentication, permissions, routes and deployment boundaries. Tenant administrators cannot enter the Qwik portal.
ID
Priority
Requirement
LIC-001
P0
Maintain product catalogue, subscription plans, prices/currency, durations, features, user limits, employee limits and grace policies
LIC-002
P0
Maintain customer/tenant organization, contact and subscription history
LIC-003
P0
Record manual payments (cash, bank transfer, cheque, other), invoice/receipt reference, amount, date, currency, covered period and supporting evidence
LIC-004
P0
Payment state: Pending, Verified, Rejected, Reversed; only authorized Qwik staff may verify/reverse; reason/actor/time retained
LIC-005
P0
Paid subscription activation requires a verified payment or explicit privileged, reasoned commercial override
LIC-006
P0
Create code with cryptographically secure randomness; show raw value once; store a one-way hash; enforce one-time redemption, expiry and tenant binding
LIC-007
P0
Free plans provision centrally without codes or payments; one active Free entitlement per tenant by default
LIC-008
P0
Tenant admins view plan, status, renewal/expiry, entitlements, usage and a code-entry upgrade form inside YardHRMS
LIC-009
P0
Renew paid subscriptions using verified manual payments without requiring repeat activation; support plan change and capacity adjustment
LIC-010
P0
Apply states: FREE, TRIAL (optional), ACTIVE, GRACE, EXPIRED, SUSPENDED, REVOKED; feature- and read-only enforcement occurs in API middleware/services
LIC-011
P0
Count active tenant users/employees transactionally; deny over-limit creates/reactivations, never delete existing records on downgrade
LIC-012
P0
Audit code issuance, redemption, payment verification/reversal, renewals, plan changes, suspensions and privileged overrides
LIC-013
P1
Renewal queues, expiring-in-30-days dashboard, manual notification templates and subscription performance analytics
LIC-014
P1
Generate invoice/receipt PDFs and customer statements without collecting payments in-app

7.1 Recommended initial tier configuration
Feature/capacity
Free
Starter
Professional
Business
Active employees
5
25
100
250
Active users
2
5
15
30
Employees / basic HR
Yes
Yes
Yes
Yes
Leave and regular timesheets
Yes
Yes
Yes
Yes
Overtime / payroll / payslips
No
Yes
Yes
Yes
Bulk imports
No
Configurable
Yes
Yes
Advanced reporting / audit view
Limited
Configurable
Yes
Yes
Manual payment required
No
Yes
Yes
Yes
Term
No fixed expiry
Configurable
Configurable
Configurable

These are seed defaults, not commercial prices or non-negotiable limits. All values must be editable in the Qwik platform. No payment processor is included.
7.2 Licensing transition from Apps Script to SaaS
The old per-deployment InstallationID, Apps Script Script Properties, signed doPost validation and LOCAL_FREE cache are removed from the new architecture. The SaaS backend knows each company through its authenticated tenant_id and subscription record. Legacy free/paid licence records can be imported, matched and converted to a tenant subscription during migration, with an administrative reconciliation report. No client-controlled value may authorize paid features.
8. Technical architecture
8.1 Recommended stack
Layer
Technology / responsibility
HRMS frontend
React + TypeScript + Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form and Zod
Qwik admin frontend
Separate React + TypeScript application with restricted platform-only routes
Backend
Node.js + TypeScript, preferably NestJS (or disciplined Express/Fastify equivalent), REST/OpenAPI
Primary database
MySQL 8.4 LTS or a currently supported compatible managed MySQL service; InnoDB and UTF8MB4
ORM/data access
Prisma (or equivalent) with reviewed SQL migrations and transactions
Cache/queues
Redis for sessions/rate limits/job queues; BullMQ-style worker processes where appropriate
Object storage
Private S3-compatible storage for payslips, employee attachments and payment evidence
Authentication
Server-backed sessions in secure cookies, Argon2id, verified email, MFA; enterprise SSO optional
Background work
Dedicated workers for import batches, PDF generation, notifications and report exports
Operations
Docker containers, CI/CD, secrets manager, TLS, metrics/logging/tracing, managed backups

Non-negotiable removals: no .gs runtime, SpreadsheetApp, google.script.run, Google Sheets as DB, ObjDB table wrappers, CDN-hosted Babel JSX or Apps Script-specific deployment workflow. Excel/CSV remains an import/export format, not live operational storage.
8.2 Logical system diagram
                         Public website / Signup
                                   |
                        React YardHRMS Portal
                                   |
                      HTTPS REST API / Auth Layer
                                   |
       +---------------------------+----------------------------+
       |                           |                            |
  Tenant HRMS Services       Payroll / Rules              Entitlements
  People, Leave, Time        Engine + Workers             & Subscription
       |                           |                            |
       +---------------------------+----------------------------+
                                   |
                        MySQL (Tenant Scoped)
                                   |
                  Redis / Private Object Storage
                                   |
               Qwik Platform Admin React Portal
               (Platform-only authenticated APIs)

8.3 Tenant isolation model
Each organization is a tenant with a globally unique identifier; tenant-owned tables include tenant_id and tenant-qualified foreign keys/indexes.
Tenant context comes from the authenticated session/membership and cannot be taken untrusted from a user-supplied request body.
The backend must enforce tenant predicates in repositories/services, including list, search, export, PDF and import background jobs.
MySQL does not provide the same general native row-level security feature set as PostgreSQL; enforce tenant isolation through application policy, schema constraints, service tests and database privileges, not assumed RLS.
Platform licensing administrators can access tenant subscription metadata; routine Qwik staff do not have unrestricted HR/payroll data access. Support impersonation, if ever added, must be separately approved, time-bounded and audited.
Single shared MySQL cluster/database with logical tenant isolation is the launch recommendation. Dedicated tenant databases may be an Enterprise option later.
8.4 Authentication and session flow
Register/login → email verification or verified SSO identity → MFA challenge when required → select tenant membership → establish rotating server-backed session in secure cookie → authorize role permission and plan entitlement on every sensitive API request → write immutable audit event for critical actions. Use CSRF protection for cookie-authenticated writes and short-lived signed URLs for private file downloads.
9. MySQL domain/data model
Conventions: primary keys preferably UUID/ULID; financial fields use DECIMAL(18,2) or appropriately precise DECIMAL; times stored UTC with timezone-aware display; created_at, updated_at, created_by and optimistic version where needed; soft deletes for business entities; foreign keys and unique constraints. Historical payroll/tax snapshots must remain immutable.
9.1 Platform and licensing tables
Table
Key fields and notes
tenants
id, legal_name, display_name, slug, status, locale, timezone, company identifiers, branding
platform_users
id, email, password_hash, email_verified_at, MFA state, status
tenant_memberships
tenant_id, user_id, status; unique membership within tenant
roles, permissions, role_permissions, membership_roles
Tenant-owned/seeded RBAC, many-to-many mappings
plans, plan_features
product/plan code, price, currency, limits, feature flags, effective version
subscriptions
tenant_id, plan_id, period_start/end, grace_end, status, source
licenses
tenant_id, subscription_id, status, capacities, activation history
activation_codes
code_hash, plan/subscription link, expires_at, redeemed_at, redeemed_tenant_id, status
manual_payments
tenant_id, amount, currency, method, invoice/ref, evidence, status, verifier, time
subscription_events
append-only renewal, upgrade, downgrade, suspend, revoke and override events
audit_events
actor, tenant, event type, entity, target ID, before/after redacted details, request ID, time

9.2 Tenant HRMS tables
Domain
Main tables
Organization master
company_profiles, branches, parishes, departments, positions, employment_types, public_holidays, shift_types
Employees
employees, employee_contacts, employee_emergency_contacts, employee_bank_accounts, employment_contracts, employee_documents
Compensation/config
pay_frequencies, compensation_histories, allowance_types, employee_allowances, deduction_types, employee_deductions, overtime_rules
Leave
leave_types, leave_policies, leave_requests, leave_approvals, leave_ledger, leave_adjustments
Time
timesheets, timesheet_approvals, overtime_requests, overtime_approvals
Payroll
payroll_periods, payroll_runs, payroll_run_employees, payroll_earnings, payroll_deductions, statutory_rule_versions, tax_thresholds
Outputs
payslips, bank_export_batches, report_exports, statutory_report_batches
Imports/operations
import_batches, import_rows, background_jobs, notifications, login_events, system_errors

9.3 Critical relational constraints
employees: unique (tenant_id, employee_number); unique normalized employee email only according to an approved tenant policy (people may legitimately use shared or absent emails).
timesheets: prohibit conflicting active entries by (tenant_id, employee_id, work_date, shift/segment) as defined by the business policy; use transactional conflict detection.
payroll_runs: unique tenant/pay-group/frequency/period/revision identity; approved amounts have immutable snapshot rows.
activation_codes: unique one-way code hash; redemption guarded by transaction and row lock to prevent double activation.
tenant_memberships: unique (tenant_id, user_id) with role mappings; seat usage counts only active memberships.
manual_payments: verification/reversal recorded through status transition history and linked once to a paid activation/renewal, preventing double-spend of a payment.
All tenant HRMS tables have tenant_id and appropriate composite tenant-qualified keys/references to prevent cross-tenant associations.
10. API surface (illustrative, not exhaustive)
All routes are versioned under /api/v1; authentication, tenant resolution, validation, RBAC, entitlement, auditing and rate limiting are implemented as middleware/guards and service policies.
Domain
Representative endpoints
Identity
POST /auth/login, POST /auth/logout, POST /auth/reset-password, GET /me, POST /auth/switch-tenant
Company
GET/PATCH /tenants/current, GET /reference-data, PATCH /settings/payroll
Employees
GET/POST /employees, GET/PATCH /employees/:id, POST /employees/:id/deactivate
Leave
GET/POST /leave-requests, POST /leave-requests/:id/approve, GET /leave-balances
Timesheets
GET/POST /timesheets, POST /timesheets/:id/approve, GET/POST /overtime
Payroll
POST /payroll-runs, GET /payroll-runs/:id, POST /payroll-runs/:id/prepare, POST /payroll-runs/:id/approve, POST /payroll-runs/:id/reverse
Payslips
GET /payslips?employeeId=, GET /payslips/:id/download, POST /payslips/:id/print-event
Imports/reports
POST /imports/employees, POST /imports/timesheets, GET /imports/:id, GET /reports/:type
Tenant licensing
GET /subscription, POST /subscription/redeem-code, POST /subscription/start-free, GET /subscription/usage
Qwik platform
GET/POST /platform/customers, GET/POST /platform/payments, POST /platform/payments/:id/verify, POST /platform/subscriptions, POST /platform/subscriptions/:id/renew, POST /platform/codes

API rules: return structured validation errors with machine-readable codes and row identifiers; paginate/filter lists server-side; generate API documentation via OpenAPI; never expose password hashes, full bank accounts or activation-code hashes; protect private exports via permission-bound short-lived access.
11. Non-functional, regulatory and operational requirements
ID
Priority
Requirement / target
NFR-001
P0
HTTPS/TLS for all ingress; encryption at rest for MySQL volumes/backups and private files; field-level encryption for sensitive banking/identity data
NFR-002
P0
99.9% monthly availability target, monitored; planned maintenance communicated
NFR-003
P0
P95 normal API read response target under 500 ms (excluding large reports/imports); async jobs used for large work
NFR-004
P0
Managed daily encrypted backups plus point-in-time recovery; quarterly restore tests; recovery targets set before go-live
NFR-005
P0
Structured audit events immutable to tenant users and protected from casual administrator modification
NFR-006
P0
OWASP-aligned security testing: SQL injection, XSS, CSRF, IDOR, SSRF, broken access control, file upload attacks, session fixation and rate-limit bypass
NFR-007
P0
Private document storage, antivirus/malware checks, maximum upload sizes, content type validation and retention controls
NFR-008
P0
Accessible responsive interface aiming at WCAG 2.2 AA; keyboard navigation, semantic labels, loading and error states
NFR-009
P0
Jamaican data protection and employment/payroll obligations reviewed by local legal/payroll advisers, with documented privacy notices and data processing arrangements
NFR-010
P0
Deployment to separate development, staging and production environments; automated migrations/rollback plans and secrets management
NFR-011
P1
Tenant-wide retention schedule, customer data export and deletion workflow under approved policy/legal holds
NFR-012
P1
Email/in-app notifications for approvals, subscription expiry and scheduled reports; notification history

Financial accuracy: use decimal arithmetic and a documented order of operations for statutory deductions, carryovers, ceilings, cumulative annualization and rounding. The reference output tests must be accepted by a Jamaican payroll specialist before any live payroll is processed.
12. Acceptance scenarios (minimum release gates)
ID
Given / When / Then
AC-01
Given a new tenant, when its Admin starts Free, then one Free subscription is created centrally with configured feature/seat/employee limits and no payment/code.
AC-02
Given a Free tenant at 5 active employees, when a sixth active employee is created directly or via import, then the API rejects that transaction while preserving existing data.
AC-03
Given an unverified payment, when Qwik tries to create a paid subscription, then the operation is rejected; after authorized verification it can proceed.
AC-04
Given a valid unused code, when a tenant Admin redeems it, then the code is marked redeemed once and the paid entitlements apply to that tenant only.
AC-05
Given a redeemed code, when another tenant tries to redeem it, then activation is rejected without modifying either subscription.
AC-06
Given a monthly employee, when a user submits or imports a regular timesheet, then validation rejects it; monthly payroll uses the configured 173.33-hour standard.
AC-07
Given an active eligible weekly employee, when an authorized delegated Manager submits a timesheet, then the employee is the subject, the Manager is stored as actor, and approval policy remains unchanged.
AC-08
Given approved overtime and leave inputs, when Payroll prepares the run, then the values and statutory rule version are present in the payroll calculation snapshot.
AC-09
Given an approved locked payroll, when someone tries to edit it in UI or directly through the API, then the write is rejected and corrections require a controlled workflow.
AC-10
Given a Manager with payslip-any permission, when the Manager prints an approved payslip, then the document opens securely and the print/download event records user, employee, tenant and time.
AC-11
Given a paid subscription past expiry and grace, when an authorized user tries to create a payroll run, then the API rejects the write; historical approved payslips remain available for authorized access.
AC-12
Given two tenants, when a user changes an employee ID or tenant ID in a request, then the system never returns another tenant's record.
AC-13
Given a mixed-validity import, when processed, then every row has an outcome, valid rows are committed exactly once, and failed rows have actionable errors.
AC-14
Given a verified renewal payment, when Qwik renews a subscription, then the expiry is extended, payment is linked once, and no new code is required.
AC-15
Given a company-name change, when the Admin saves settings, then the name appears on splash/CTA, sidebar, header, payslips and tenant-facing exports as configured.

13. UX and information architecture
13.1 YardHRMS navigation
Dashboard; My Profile; Employees; Leave; Timesheets; Overtime; Payroll Setup; Payroll Runs; Payslips; Reports; Users & Roles; Company Settings; Subscription; Audit; About; Licence; Disclaimer; Copyright.
The navigation is role- and entitlement-aware. A hidden item is a convenience only; denied requests must still fail at the API. Important onboarding and licence actions remain accessible even to tenants whose subscriptions have expired.
13.2 Qwik Licence Manager navigation
Dashboard; Customers; Products; Plans & Features; Manual Payments; Subscriptions; Licences; Activation Codes; Renewals/Expirations; Usage; Platform Audit; Settings.
The platform portal is visually distinct from tenant HRMS, with prominent subscription states, payment verification history, code issuance, company lookup and license usage indicators.
13.3 Design guidance
Use a mobile-responsive sidebar/drawer, searchable employee selectors for privileged workflows, clearly labeled approval states, dashboard skeleton/loading indicators, confirmation dialogs for destructive/financial actions, human-readable validation and printable payroll layouts. Branding should retain Qwik Business Solutions™ and eQwik YardHRMS™ attribution and product/legal information, while the tenant name appears prominently in the working interface.
14. Migration from Apps Script / Google Sheets
Migration is a managed ETL project, not an automatic replacement of the production database.
Inventory: export existing Google Sheet tables, script configuration, reference sheets, employee documents and existing licensing records (if present).
Map: document exact mapping from Sheet/ObjDB headers to MySQL entities, enums, IDs and related records; maintain a legacy_id_map table.
Normalize: deduplicate employees/users, normalize date/time zones, validate emails and statutory identifiers, protect bank fields and reconcile reference data.
Import: create tenant/company first, then master data, employees, users, contracts, leave, timesheets, overtime, allowances, payroll runs/details, payslip metadata, audit records and subscription/licensing history.
Validate: compare record counts, leave balances, payroll gross/net totals, historical payslip availability and sample employee profiles against the source Sheets.
Parallel run: test one full pay cycle in the new engine alongside the existing approved payroll results; resolve differences with payroll/finance sign-off.
Cutover: freeze legacy writes, run final delta import, provision tenant/user access, perform acceptance checklist and set historical data read-only where required.
Rollback: maintain secure legacy export/backup and a documented restore/revert path until the cutover is formally approved.
License migration: map LOCAL_FREE and centrally issued legacy licences to the new tenant/subscription objects. Do not carry forward Apps Script InstallationID as the subscription owner; retain it only as legacy audit/reference metadata if needed.
15. Delivery plan and release sequencing
Phase
Deliverables
Exit gate
0 — Discovery and compliance
Data inventory, payroll rule sign-off, pricing/tier decisions, tenant model, solution architecture, migration samples
Approved data model and payroll test vectors
1 — Platform foundation
Repositories, CI/CD, React shells, MySQL migrations, auth, tenant model, RBAC, audit, branding
Cross-tenant/security tests pass
2 — Core HR
Employees, master data, leave, balances, timesheets, overtime, bulk imports
End-to-end P0 HR workflow acceptance
3 — Payroll
Effective-dated rules engine, pay frequencies, run lifecycle, payslips, exports, payroll audit
Payroll reconciliation and approval-control sign-off
4 — Commercial licensing
Qwik admin React portal, manual payments, plans, Free onboarding, paid activation, renewal, limits, expiry
Free→Paid→Renewal→Expiry test suite passes
5 — Migration and hardening
Legacy ETL, performance/security tests, accessibility, backup/restore, admin runbooks, production cutover
Signed UAT and production launch checklist
6 — Post-launch
More reports, notifications, advanced analytics and additional modules
Prioritized after launch evidence

15.1 Recommended repository structure
apps/
  hrms-web/            React tenant-facing app
  license-admin-web/   React Qwik platform admin app
  api/                 Node.js/TypeScript REST backend
  worker/              Imports, PDFs, emails, scheduled jobs
packages/
  ui/                  Shared React design system
  types/               Shared DTOs/types/schema declarations
  payroll-engine/      Independently tested calculations
  authorization/       RBAC and entitlement policies
  configuration/       Shared lint, build, security rules
infra/                 Terraform/Docker/CI/CD definitions
prisma/                MySQL schema and migrations

15.2 Testing matrix
Unit: payroll/leave calculations, tax version selection, policy guards, capacity counters, input validation. Integration: MySQL transactions, code redemption, payment/subscription transitions, file authorization. End-to-end: Free signup, paid activation, delegated entry, payroll lifecycle, import, print and expiry. Security: tenant isolation, privilege escalation, file exposure, race conditions, injection/XSS/CSRF, rate limiting. Operational: load tests, data import reconciliation, backup/restore and deployment rollback.
16. Product risks and dependencies
Risk
Mitigation
Incorrect or obsolete statutory deduction rates
Effective-dated rules, qualified Jamaican payroll validation, year-specific regression tests
Cross-tenant data exposure
Tenant-aware services, composite constraints, adversarial IDOR tests, audited export controls
Payroll rounding/retroactive discrepancies
Decimal engine, immutable snapshots, signed expected-results test packs
One-time activation code replay
Cryptographic randomness, hashed codes, transactional redemption with uniqueness/locking
Manual payment errors/fraud
Verification authority, separation-of-duties option, reversal records and no destructive deletion
SaaS upgrade breaks legacy customers
Staged ETL, parallel payroll runs, count/balance reconciliations and rollback
Loss of customer confidence on expiry
Grace warnings, historical read/export access and straightforward manual renewal
Missing infrastructure/hosting decisions
Separate technical architecture decision record prior to Phase 1 implementation

17. Open decisions for owner approval
Tenant delivery: approve Qwik-hosted logically multi-tenant SaaS (recommended), or mandate isolated tenant databases for every organization.
Hosting/cloud: choose AWS/Azure/GCP or a managed deployment provider, operating region, backup retention and data residency requirements.
Plan pricing: set amounts/currencies, duration options, Free limits and paid plan entitlements; current plan limits are configurable proposals.
Login: email/password + MFA for v1 versus mandatory Google/Microsoft SSO for some customers.
Payment controls: whether recording and verifying a payment must be performed by different Qwik staff; define commercial override roles.
Legal/statutory verification: approve authoritative Jamaican payroll sources, effective dates and test examples before go-live.
Data retention: payroll, personnel, payslip, audit and document retention periods; clarify applicable privacy and cross-border storage requirements.
Migration: identify current live customers/data volumes and which historical data must remain queryable after cutover.
Branding/legal: confirm approved Qwik trademark/legal text and customer-facing terms and privacy notice.
18. Final acceptance and definition of done
The full-stack rewrite is ready for commercial launch only when the system is deployed without Apps Script or Google Sheets dependencies; React clients communicate solely with the secured Node API; MySQL stores and protects all transactional and licensing data; Free/paid entitlement logic is enforced server-side; manual payment verification and one-time activation work; weekly, fortnightly and monthly payroll are approved against Jamaican reference calculations; delegated employee actions preserve actor attribution; historical payroll is locked and auditable; tenant-isolation/security tests pass; backups and recovery have been tested; and representative legacy data has been migrated and reconciled.

Appendix A — Terminology
Tenant: a subscribing company/organization. Membership: a user's affiliation with that tenant. Entitlement: plan-authorized capability/limit. RBAC permission: a role-authorized operation. Activation code: one-time credential redeemable against a tenant subscription. Subscription: commercial time-bound or Free access agreement. Payroll snapshot: immutable approved calculation record. Effective-dated rule: payroll/leave configuration associated with its applicable time period.
Appendix B — Source and derivation notes
This PRD consolidates (a) the uploaded “yardHRMS Outline” document (HR management, Jamaican payroll, leave, roles, reporting and compliance modules) and (b) the feature decisions made during development of the eQwik YardHRMS Apps Script prototype and the Qwik Licence Manager. The source outline discusses Google Apps Script/Google Sheets because it describes the previous implementation; those technological choices are deliberately superseded here by the user's instruction to build a full-stack React/MySQL product. SaaS tenant architecture, API design, technology libraries, performance targets and migration method are recommended design decisions, not claims that they already exist in the prototype.
Statutory notice: payroll rules must be independently verified against current Jamaican law, notices and applicable employment agreements. No example percentage in the original outline should be used as an unreviewed production constant.
Copyright: © 2026 Qwik Business Solutions. All rights reserved. eQwik YardHRMS™ and Qwik Business Solutions™ are used here as product and company marks.