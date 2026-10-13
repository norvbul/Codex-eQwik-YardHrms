# eQwik YardHRMS™

A React/TypeScript and MySQL HR/payroll application with a separate Qwik Licence & Subscription Manager. This replaces the original Vite scaffold with working tenant-isolated services, two responsive portals, persistent HR workflows, a Decimal payroll engine, private payslips, spreadsheet imports, reports and manual subscription administration.

The implementation follows the [PRD](docs/product-requirements.md) and [development brief](docs/development-brief.md). Production launch still requires independently approved Jamaican statutory configuration, commercial/legal decisions and staging acceptance; synthetic test rates are never seeded or certified as law. See [implementation status](docs/implementation-status.md) and [release gates](docs/release-gates.md).

## Run locally

Use Node **24.19.0** (`.nvmrc`), npm and a running Docker Engine with Compose. Allow verified npm/Docker downloads and `binaries.prisma.sh` for native Prisma migration tooling.

```sh
npm ci
npm run env:init
npm run infra:up
npm run db:provision-local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`env:init` creates a random, ignored `.env` with mode 0600 and preserves existing configuration. Local dependencies are MySQL 8.4, Redis, Mailpit and S3-compatible LocalStack. `db:provision-local` creates a separate development migration account and restricts the application account to data access. MySQL binary logging requires privileged trigger creation by the migration account; those credentials must never be given to the production API/worker.

The HRMS runs on port **5173**, Qwik on **5174**, API on **3000**, Mailpit on **8025** and local S3 on **9000**. Vite proxies `/api`; clients do not store business records in localStorage. `npm run dev` starts both portals, API and worker. Each cloud task already has an isolated checkout; use the existing repository unless a worktree is requested.

Register a Free company, verify the actual email in Mailpit, sign in, and enroll an authenticator. Privileged company, finance/payroll and Qwik accounts require MFA. No customer accounts, passwords, paid prices or statutory rates are seeded.

Bootstrap Qwik access with a mailbox you control:

```sh
npm run platform:invite -- your-email@example.com "Your Name" PLATFORM_SUPER_ADMIN
```

This queues an invitation through SMTP; tokens are not printed. Set the password from the email, sign into Qwik and enroll MFA. Create additional staff through **Policies & Staff**. HR company membership and Qwik platform authority are separate.

## Validate

```sh
npm run format:check
npm run lint
npm run build
npm test
npm run test:integration
npm run test:e2e
npm run test:recovery
npm audit --omit=dev
```

Integration, browser and recovery runners create their own temporary MySQL database, Redis queue namespace and S3 bucket. They migrate and seed a fresh schema, then remove only their owned resources. They refuse nonlocal/production database configurations. Browser checks use system Chromium when available; otherwise install it with `npx playwright install --with-deps chromium`. Tests never require deleting production audit or financial history.

The API exposes `/api/v1/health` and `/api/v1/openapi.json`. Regenerate the operation catalogue and shared request contracts with `npm run api:docs` after changing routes.

## Working modules

- Company registration, verified email, reset/invitations, revocable server sessions, CSRF, TOTP, memberships, configurable roles and branding.
- Employee records, effective-dated compensation, sensitive identity/bank encryption, contacts, master data, prospective configuration review and self-service.
- Leave calendars, allocated balances/ledger, accrual/carry-forward, delegated regular time/overtime and separate scoped approval. Monthly regular timesheets are rejected server-side, including imports.
- CSV/XLSX staging, column mapping, per-row outcomes, transactional execution and tenant-bound legacy IDs.
- Approved statutory packages with reference vectors; weekly/fortnightly/monthly payroll; asynchronous preparation; review/approval/lock; immutable snapshots and audited reversal.
- Private generated PDFs, controlled bank CSV/XLSX, statutory/deduction/department reports and background exports.
- Qwik products/plans, customer invitations, manual receipts and verification history, paid activation codes, renewal, suspension/revocation, capacity/usage and commercial audit.
- Private employee documents/payment evidence, signature and size validation, quarantine and ClamAV INSTREAM integration. Configure a real scanner before uploads can be downloaded or attached as clean evidence.

## Guides and delivery artifacts

- [Administration](docs/administration.md)
- [Payroll configuration and operation](docs/payroll-guide.md)
- [Subscription administration](docs/subscription-guide.md)
- [Architecture and decisions](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Backup and recovery](docs/backup-recovery.md)
- [Legacy migration tooling](docs/legacy-migration.md)

`apps/hrms-web` and `apps/license-admin-web` share reusable components in `packages/ui`. The modular Express 5 API is the alternative explicitly permitted by the PRD. Prisma owns versioned MySQL migrations; Redis/BullMQ runs email, imports, payroll preparation, PDFs, exports and malware scans. The independent payroll engine lives in `packages/payroll-engine`.

Local Compose is development infrastructure. Production images, a private-service application Compose template and CI checks are included under `infra/` and `.github/`; these do not provision production hosting or replace compliance approval.
