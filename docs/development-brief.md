# MASTER APPLICATION DEVELOPMENT PROMPT
## eQwik YardHRMS™ — Full-Stack HR & Payroll SaaS
### React + TypeScript + Node.js + MySQL

You are a **senior full-stack software architect, React developer, backend engineer, database architect, UI/UX designer, payroll systems specialist, and application security engineer**.

Your assignment is to design and develop a complete, commercially deployable, subscription-based Human Resource Management and Payroll System named **eQwik YardHRMS™**, owned and published by **Qwik Business Solutions™**.

Use the attached **eQwik YardHRMS Full-Stack React & MySQL Product Requirements Document (PRD), Version 1.0**, as the authoritative functional specification.

The goal is to produce a **working full-stack application**, including real database persistence, business logic, secure authentication, REST APIs, subscription licensing, and responsive user interfaces.

Do not produce only wireframes, sample dashboards, mockups, static HTML, or hardcoded demonstrations.

All implemented features must function end-to-end.

---

## 1. Project objectives

Build a cloud-hosted, multi-tenant SaaS application that enables Jamaican businesses to:

- Manage employee information and employment records.
- Manage organizational structures and company settings.
- Administer employee leave and absences.
- Record and approve timesheets.
- Manage overtime requests and approvals.
- Process weekly, fortnightly, and monthly payroll.
- Calculate configurable Jamaican statutory payroll deductions.
- Generate payslips and payroll reports.
- Import employee and timesheet data in bulk.
- Allow employees to access self-service functionality.
- Manage access through role-based permissions.
- Subscribe to Free or paid plans.
- Activate subscriptions using authorization codes.

Additionally, build a **separate Qwik Licence & Subscription Manager** for administering customers, manual payments, subscription plans, authorization codes, renewals, licensing status, and feature entitlements.

The final product must not depend on Google Apps Script or Google Sheets.

## 2. Required technology stack

Use the following implementation architecture.

### Frontend

- React with TypeScript
- Vite
- Tailwind CSS
- shadcn/ui or equivalent reusable component system
- React Router
- TanStack Query
- React Hook Form
- Zod for validation
- Recharts for dashboards
- Lucide icons

### Backend

- Node.js with TypeScript
- NestJS preferred
- RESTful API with OpenAPI/Swagger documentation
- Prisma ORM
- Centralized request validation, authorization, error handling, and auditing
- Background worker for asynchronous operations

### Database

- **MySQL 8.4 LTS or supported equivalent**
- InnoDB storage engine
- UTF8MB4 character set
- Prisma schema and version-controlled migrations
- Foreign keys, unique constraints, indexes, and transaction controls
- Decimal types for all financial values

### Supporting infrastructure

- Redis for sessions, caching, rate limits, and background jobs where necessary
- Private S3-compatible object storage for documents and payslips
- Docker and Docker Compose for local deployment
- Environment-based configuration
- Automated tests
- CI/CD-ready structure

Do not substitute a browser-only database, localStorage, Google Sheets, Firebase, or mock API for MySQL.

No Google Apps Script runtime, `SpreadsheetApp`, `google.script.run`, CDN-hosted Babel, or Apps Script-specific code is permitted.

## 3. Application architecture

Create two distinct React applications sharing a secured backend.

### Application A — eQwik YardHRMS

The customer-facing HRMS application.

Each subscribing business is a tenant with its own employees, users, payroll, settings, subscriptions, and reporting data.

### Application B — Qwik Licence & Subscription Manager

A separate administrative portal accessible only to authorized Qwik Business Solutions personnel.

It manages subscription and commercial information, not routine tenant payroll operations.

### Backend organization

Use a modular architecture containing separate domains for:

- Identity and authentication
- Tenants and organizations
- Roles and permissions
- Employees and compensation
- Leave management
- Timesheets and overtime
- Payroll calculation
- Statutory rules
- Reports and exports
- Bulk imports
- Subscriptions and entitlements
- Manual payment administration
- Authorization codes
- Audit logging

The SaaS model should use logical tenant isolation in MySQL. Every tenant-owned business record must be associated with its `tenant_id`.

The tenant must be resolved from an authenticated session and authorized membership—not trusted from arbitrary client-supplied values.

Implement tenant isolation at the API, service, query, and database-constraint levels.

## 4. UI/UX requirements

Create a modern, professional, visually polished SaaS interface.

The visual identity should reflect **Qwik Business Solutions™**, using a consistent design language across the HRMS and Licence Manager while clearly distinguishing the two applications.

### General interface requirements

- Fully responsive on desktop, tablet, and mobile.
- Collapsible sidebar navigation.
- Clean application header with the active company name.
- Role-aware navigation.
- Professional dashboard cards.
- Interactive charts and summary widgets.
- Searchable and filterable data tables.
- Pagination and sorting.
- Modal and drawer-based forms where appropriate.
- Loading skeletons and progress indicators.
- Useful empty states.
- Meaningful validation messages.
- Confirmation prompts for critical actions.
- Toast notifications.
- Accessible form labels and keyboard navigation.
- Consistent spacing, typography, colors, and iconography.

Use a polished business-application design, not a generic administrative template with placeholder content.

### Dynamic branding

Company names, logos, and relevant branding details must come from the authenticated tenant configuration.

Display the tenant company name consistently in:

- Application header
- Sidebar
- Welcome/dashboard screen
- Company-specific documents
- Payslips
- Reports
- Browser title where appropriate

Include product pages for About, Licence, Disclaimer, and Copyright, with Qwik Business Solutions attribution.

## 5. Authentication and user management

Implement secure authentication and authorization.

Requirements include:

- Email/password registration and login.
- Argon2id password hashing.
- Email verification.
- Password reset.
- Secure HttpOnly session cookies.
- Session expiration and revocation.
- CSRF protection for cookie-authenticated write requests.
- Multi-factor authentication for privileged roles.
- Tenant membership management.
- User invitations.
- User activation and deactivation.
- Role and permission management.
- Audit logging of sensitive actions.

### Required roles

1. Platform Super Admin — Qwik
2. Platform Licensing Officer — Qwik
3. Company Administrator
4. HR Officer
5. Payroll Officer
6. Finance Approver
7. Manager/Supervisor
8. Employee

All permissions must be enforced server-side.

**Critical delegated-access rule:** Company Admins, Payroll Officers, and authorized Managers/Supervisors must be able to select any active employee and submit eligible leave, timesheet, or overtime records on that employee's behalf, and view/print authorized approved payslips.

Store the employee as the transaction subject and the signed-in user as the actor.

Delegated submission must not automatically grant approval permissions.

## 6. Employee management

Implement comprehensive employee administration.

Each employee profile should support:

- Unique employee number within the tenant.
- Names and contact information.
- Date of birth and gender where appropriate.
- Address and parish.
- TRN, NIS, and NHT identifiers.
- Department, branch, position, and supervisor.
- Employment type.
- Hire, probation, confirmation, and termination dates.
- Pay frequency and compensation terms.
- Base salary or hourly rate.
- Standard working hours.
- Overtime eligibility.
- Bank account information.
- Emergency contacts.
- Employee documents.
- Employment history.
- Active/inactive status.

Provide CRUD operations, searchable listings, employee detail pages, and an authorized compensation history.

Sensitive information must be appropriately encrypted or access restricted.

Deleting an employee must not erase historical payroll records.

## 7. Leave management

Develop a configurable leave-management module supporting:

- Vacation/annual leave.
- Sick leave.
- Maternity leave.
- Compassionate leave.
- Unpaid leave.
- Study leave.
- Special leave.
- Other company-defined categories.

Include:

- Leave policy configuration.
- Leave requests.
- Manager/HR approvals.
- Rejection and comments.
- Leave balances and accruals.
- Leave adjustments.
- Carry-forward and expiry rules.
- Public holiday consideration.
- Working-day calculations.
- Payroll impact.

Every leave transaction must have a complete audit history.

## 8. Timesheets and overtime

Implement timesheet and overtime administration as separate but integrated workflows.

### Regular timesheets

Weekly and fortnightly employees may submit regular timesheets.

Capture:

- Employee
- Work date
- Shift
- Start time
- End time
- Break hours
- Regular hours
- Submitted by
- Approval status
- Approved by
- Approval date
- Comments

Validate duplicate entries, overnight work, overlapping entries, hour limits, and payroll-period locks.

### Monthly employees

**Important business rule:**

Monthly employees must not submit regular timesheets.

Monthly salary payroll uses the employee's contractual monthly amount and a configurable default of **173.33 standard hours per month**, when an hourly equivalent is needed.

Do not make the monthly standard a permanent hardcoded constant.

### Overtime

Overtime must have its own submission and approval process.

Approved overtime may be paid to eligible weekly, fortnightly, or monthly employees.

Support configurable overtime rules, multipliers, and categories.

Only approved overtime should enter payroll.

## 9. Jamaican payroll engine

Develop an independently testable payroll engine.

Support:

- Weekly payroll.
- Fortnightly payroll.
- Monthly payroll.

### Payroll inputs

Include:

- Regular salary/hourly earnings.
- Approved timesheet hours.
- Approved overtime.
- Taxable allowances.
- Non-taxable allowances.
- Bonus and commission.
- Retroactive payments.
- Paid/unpaid leave adjustments.
- Pension deductions.
- Insurance.
- Loans.
- Salary advances.
- Union dues.
- Other approved deductions.

### Statutory calculations

Support Jamaican payroll calculations for:

- PAYE
- NIS
- NHT
- Education Tax
- Applicable employer contributions and other statutory liabilities

All rates, thresholds, ceilings, eligibility rules, and effective dates must be stored in configurable, versioned database tables.

**Do not invent or hardcode Jamaican statutory rates from examples in the PRD.**

Where approved rates and expected payroll examples are not yet available, build the complete configuration and calculation framework but clearly mark statutory payroll processing as requiring compliance approval before production use.

Use decimal arithmetic—not JavaScript floating-point calculations—for money.

Document rounding, proration, tax bases, year-to-date calculations, and all other payroll calculation policies.

### Payroll approval lifecycle

Implement:

Draft → Prepared → Reviewed → Approved → Locked

Approved payroll must create immutable calculation snapshots.

Editing a locked payroll directly is prohibited.

Provide audited reversal, adjustment, or supplemental processing where authorized.

### Payroll outputs

Generate:

- Payroll register.
- Individual PDF payslips.
- Bank payment files.
- Statutory deduction reports.
- Employer contribution reports.
- Department payroll-cost summaries.
- Earnings and deduction reports.

Payslips must be private, permission controlled, downloadable, and printable with audit records.

## 10. Bulk spreadsheet import

Build real Excel/CSV import functionality for employees and timesheets.

Provide downloadable templates.

The import workflow must support:

1. Spreadsheet upload.
2. File parsing and column mapping.
3. Preview.
4. Required-field validation.
5. Reference-data validation.
6. Duplicate detection.
7. Import execution.
8. Row-level success/error reporting.
9. Downloadable error results.
10. Audit tracking.

Employee imports must support creating employees and updating identified existing employees with documented blank-cell merge behavior.

Timesheet imports must reject monthly regular timesheets and other ineligible or conflicting records.

Process large imports through safe, retryable server-side jobs.

## 11. Subscription and licensing

Implement a centralized subscription system linked to each tenant.

Do not use the previous Apps Script installation-based licensing design.

Every company must have a subscription entitlement, including Free tenants.

### Initial plans

Seed configurable examples:

| Plan | Employees | Users |
|---|---:|---:|
| Free | 5 | 2 |
| Starter | 25 | 5 |
| Professional | 100 | 15 |
| Business | 250 | 30 |

These are editable starting values, not fixed limits.

Do not invent commercial prices.

Each plan must define:

- Name
- Price and currency
- Subscription duration
- Employee limit
- Active-user limit
- Enabled features
- Grace period
- Status

### Free tier

Free registration requires no payment or authorization code.

After company registration, the backend creates a Free subscription automatically.

Free users receive only the features and capacity enabled in their plan.

### Paid subscriptions

Paid subscription activation uses authorization codes generated by the separate Qwik Licence Manager.

Each activation code must be:

- Cryptographically random.
- Bound to its intended subscription/product.
- Stored as a one-way hash.
- Displayed to authorized Qwik staff only when generated.
- Usable once.
- Subject to expiration.
- Redeemed atomically to prevent simultaneous double activation.

### Enforcement

Check subscription entitlements on every protected backend action.

For example, a Free company at its employee limit must not create another active employee through the UI or API.

Do not rely solely on hiding buttons.

### Expiration

After the configured grace period, expired subscriptions enter read-only mode.

Allow authorized historical viewing and export, including payslips, but block new payroll and ordinary business-data writes.

Never automatically delete company data because a subscription expires.

## 12. Qwik Licence & Subscription Manager

Build this as a separate, secure React administrative portal.

Navigation should include:

- Dashboard
- Customers
- Products
- Plans & Features
- Manual Payments
- Subscriptions
- Licences
- Authorization Codes
- Renewals/Expirations
- Usage Monitoring
- Audit Log
- Settings

### Manual payment management

**There is no payment gateway in this release.**

Do not implement Stripe, PayPal, checkout integration, or automated payment webhooks.

Qwik staff must manually record and verify payments.

Payment records must include customer, invoice/reference, payment date, amount, currency, method, covered subscription period, supporting evidence, status, and authorized verification history.

Payment statuses:

- Pending
- Verified
- Rejected
- Reversed

Paid subscriptions may only be issued using verified payments or a separately authorized, audited commercial override.

### Renewals

A verified renewal payment should extend the existing subscription without requiring a new activation code.

### Administration

Authorized Qwik users must be able to:

- Create customers.
- Configure plan pricing and entitlements.
- Verify payments.
- Create subscriptions.
- Generate authorization codes.
- Renew subscriptions.
- Change plans.
- Adjust capacities.
- Suspend or revoke licences.
- Review activation and subscription history.
- Monitor active tenants and subscription usage.

Ordinary tenant administrators must not access the Qwik platform portal.

## 13. Database architecture

Design a fully normalized MySQL schema based on the PRD.

Include tables for:

**Platform:** tenants, users, tenant memberships, roles, permissions, plans, features, subscriptions, licences, activation codes, manual payments, subscription events, audit events.

**HRMS:** employees, contacts, emergency contacts, bank accounts, departments, positions, branches, employment types, compensation history, contracts, leave requests, leave balances/ledger, timesheets, overtime, allowances, deductions, payroll periods, payroll runs, payroll earnings, payroll deductions, statutory rule versions, payslips, imports, reports, and system events.

Include:

- Appropriate primary and foreign keys.
- Tenant-qualified constraints and indexes.
- Unique business identifiers.
- Soft-delete policies.
- Created/updated timestamps.
- Audit attribution.
- Transactional integrity.
- Safe concurrency handling.

Use Prisma migrations rather than relying on automatic schema creation in production.

## 14. Reports and dashboards

Implement role-specific dashboards.

### HRMS Dashboard

Relevant metrics should include:

- Total employees.
- Active employees.
- Employees on leave.
- Pending approvals.
- Timesheet status.
- Overtime activity.
- Payroll status.
- Workforce distribution.
- Leave trends.
- Subscription usage.

### Payroll Dashboard

Include:

- Gross payroll.
- Net payroll.
- Statutory deduction totals.
- Employer contribution totals.
- Payroll by period.
- Payroll by department.
- Pending/approved runs.

### Licence Manager Dashboard

Include:

- Total customers.
- Active paid subscriptions.
- Free subscriptions.
- Expired licences.
- Upcoming renewals.
- Pending payments.
- Verified revenue by currency.
- Plan distribution.
- Employee/user capacity utilization.

All figures must originate from real backend/database queries.

## 15. Security and data protection

Treat security as essential because the application contains personal, banking, employment, and payroll information.

Implement:

- Server-side RBAC.
- Server-side licensing entitlements.
- Strict tenant isolation.
- Secure session management.
- MFA for privileged accounts.
- Input validation.
- SQL injection protection.
- XSS and CSRF protection.
- Rate limiting.
- Encryption of sensitive data.
- Protected file storage and downloads.
- Secure audit trails.
- Payment verification history.
- Payroll approval integrity.
- Safe secret management.
- Backup and recovery procedures.

Never include production credentials or secrets in source control.

Ensure platform administrators cannot casually access private tenant payroll data simply because they administer licences.

## 16. REST API development

Build and connect functional API endpoints for:

- Authentication and sessions
- Tenant registration and switching
- Employee management
- Departments and company configuration
- Leave management
- Timesheets
- Overtime
- Payroll setup and calculations
- Payroll approvals
- Payslips
- Bulk imports
- Reports
- Subscriptions
- Entitlement validation
- Authorization-code redemption
- Manual payments
- Qwik platform administration

Version endpoints under `/api/v1`.

Return consistent structured success/error responses.

Use OpenAPI documentation.

Do not leave frontend buttons wired to nonexistent backend routes.

## 17. Application organization

Create a monorepo similar to:

```text
apps/
  hrms-web/
  license-admin-web/
  api/
  worker/

packages/
  ui/
  types/
  payroll-engine/
  authorization/
  configuration/

prisma/
  schema.prisma
  migrations/
  seed/

infra/
  docker/
  deployment/

tests/
  unit/
  integration/
  e2e/

README.md
.env.example
docker-compose.yml
```

Share reusable UI elements and business types where appropriate.

Keep the payroll calculation engine independent from React and HTTP controllers so that it can be tested in isolation.

## 18. Implementation instructions

**Generate the application progressively, but produce real working implementations at every stage.**

Follow the PRD's P0 priorities and suggested development phases.

### Phase 1 — Foundation

Implement:

- Repository and project setup.
- Docker and MySQL configuration.
- Prisma schema and migrations.
- Seed scripts.
- React app shells.
- Authentication.
- Tenant registration.
- Role-based permissions.
- Audit foundations.
- Dynamic company branding.

### Phase 2 — Core HRMS

Implement:

- Employee management.
- Departments and company settings.
- Leave.
- Leave balances.
- Timesheets.
- Overtime.
- Employee self-service.
- Bulk imports.

### Phase 3 — Payroll

Implement:

- Payroll configuration.
- Effective-dated statutory rule engine.
- Calculation framework.
- Payroll lifecycle.
- Payslips.
- Bank-file generation.
- Statutory and management reports.

Do not certify live payroll until approved statutory configuration and test calculations are supplied.

### Phase 4 — Licensing

Implement:

- Qwik admin portal.
- Customers.
- Products and plans.
- Manual payments.
- Payment verification.
- Subscriptions.
- Authorization codes.
- Free onboarding.
- Paid activation.
- Renewals and expirations.
- Capacity enforcement.
- Subscription dashboard.

### Phase 5 — Testing and production preparation

Implement:

- End-to-end tests.
- API integration tests.
- Payroll calculation tests.
- Tenant isolation tests.
- Authorization-code concurrency tests.
- Import validation tests.
- CI configuration.
- Security hardening.
- Deployment scripts.
- Backup/restore documentation.
- Legacy Google Sheets data migration utility.

## 19. Testing and quality control

Continuously check work for errors.

After implementing each module:

1. Verify TypeScript compiles.
2. Run linting.
3. Test backend endpoints.
4. Verify Prisma queries and migration integrity.
5. Confirm frontend API calls map to real routes.
6. Test role and entitlement restrictions.
7. Test cross-tenant isolation.
8. Test successful and unsuccessful workflows.
9. Correct detected errors before proceeding.

Pay particular attention to React effect cleanup, state handling, form validation, database transactions, payroll rounding, and subscription code redemption.

Write automated tests for all critical PRD acceptance scenarios, especially:

- Free subscription creation.
- Employee/user limit enforcement.
- Manual payment verification.
- One-time activation-code redemption.
- Monthly-timesheet rejection.
- Delegated submission audit attribution.
- Payroll approval and lock integrity.
- Paid subscription expiry/read-only behavior.
- Cross-tenant access denial.
- Mixed-validity bulk imports.
- Renewal without reactivation.

**Do not declare a feature complete merely because its UI renders.** Verify its data, backend operations, validations, security, and error handling.

## 20. Delivery requirements

Produce:

- Complete application source code.
- Fully implemented React frontends.
- Functional Node.js API.
- MySQL schema and migrations.
- Seed/configuration utilities.
- Docker Compose local environment.
- Environment-variable template.
- Swagger/OpenAPI documentation.
- Automated test suite.
- Local setup instructions.
- Production deployment instructions.
- Administrative user guide.
- Payroll configuration guide.
- Subscription administration guide.
- Legacy data migration strategy and tooling.
- Known limitations and unresolved configuration requirements.

The application must be runnable locally with documented commands.

Do not claim production readiness until all required validations, deployment tests, security checks, and payroll compliance approvals are complete.

## 21. Development conduct and completion criteria

Treat the attached PRD as the source of truth for the required product.

Where the PRD labels a choice as a recommendation rather than an approved decision, adopt the specified default architecture for development and record the decision for owner review.

Do not arbitrarily invent subscription prices, legal policies, statutory rates, customer data, or deployment credentials.

Use safe development defaults and explicit configuration variables for unresolved commercial settings.

Start by inspecting the project environment and creating an implementation plan mapped to the PRD requirement IDs.

Then begin writing the actual application code.

For each completed phase, provide:

- What was implemented.
- The files created/modified.
- Commands executed.
- Tests performed and results.
- Any known defects or blockers.
- What remains in the next phase.

Prioritize correctness, maintainability, security, clean UX, and real database integration.

**Final objective:** Deliver an integrated, functional **eQwik YardHRMS™ React/MySQL SaaS platform** together with the separate **Qwik Licence & Subscription Manager**, suitable for commercial launch after the required testing, payroll compliance verification, and owner sign-off.

**Begin with Phase 1 and continue through the PRD in coherent, testable increments.**
