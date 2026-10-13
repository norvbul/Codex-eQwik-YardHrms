# Managed legacy migration

Migration from Apps Script/Google Sheets is a controlled ETL project. No Google runtime or Sheets database is used by the application. Obtain an inventory and representative exports before approving a customer cutover; no live legacy data was supplied in this task.

## Working staging and import tool

Export values-only CSV, document exact headers and provide a mapping JSON. An example field map is in `docs/examples/legacy-employee-mapping.json`; it contains field names only, not fabricated customer data.

```sh
npm run legacy:etl -- --file=/secure/source/employees.csv --mapping=/secure/source/employee-map.json --kind=EMPLOYEES --source=approved_source --out=.private/etl --mode=stage
```

The tool checks limits, source-ID uniqueness, explicit ISO dates and decimal strings, normalizes stated pay-frequency names, records a source SHA-256 and produces a private normalized CSV and reconciliation/issue manifest. It never guesses ambiguous dates, local statutory identifiers, bank formats, organizational IDs or compensation. Repair reported issues before import.

For actual API preview or commit, supply `--baseUrl` and a current MFA-verified session cookie/CSRF using secure `YARD_SESSION_COOKIE` and `YARD_CSRF` environment variables. Remote API access requires verified HTTPS. Do not pass tokens as command-line arguments or print them.

```sh
npm run legacy:etl -- --file=/secure/source/employees.csv --mapping=/secure/source/employee-map.json --kind=EMPLOYEES --source=approved_source --out=.private/etl --mode=preview --baseUrl=https://your-staging-hrms
```

Review the staged application rows. Use `--mode=commit` to submit a validated batch, await its worker outcomes and save private results plus the legacy ID map. The same workflow supports `TIMESHEETS` after related employees/references are resolved to tenant UUIDs. Payroll input constraints, monthly-timesheet rejection, permissions and capacity still apply.

`legacySource` and `legacyId` are explicit import columns. Mappings are qualified by company, import kind and source. Repeated employee imports resolve to their existing employee; repeated unchanged time rows are skipped. Changed mapped time cannot overwrite an approved entry and requires the controlled correction workflow. Mapping creation and row/entity commit are transactional and audited. There is no global installation-ID ownership.

## Historical reconciliation and cutover

Use `--kind=HISTORICAL_RECONCILIATION --mode=stage` with approved mappings for archived gross/net fields to record source counts, checksums and exact totals. This stages an archive for financial review; it does not fabricate approved payroll, historical tax rules, licence ownership or YTD openings. Historical leave/payroll/licensing backfill requires a source-specific, signed import plan and explicit supported transformations before execution.

Inventory company configuration, users, documents/contracts, employees, leave balances and ledgers, attendance/OT, allowances, payroll details/payslips, audit and legacy licences. Establish the company/references first; resolve IDs; deduplicate and protect sensitive data; perform employee/time imports; reconcile dependent archival data under finance/HR supervision. Compare source counts, leave balances, gross/net/employer totals and sample documents. Run one complete pay cycle in parallel with approved legacy results and resolve every discrepancy.

Freeze legacy writes for a final delta import. Verify customer access, historical availability and entitlement ownership, then obtain HR/finance/customer/owner acceptance before traffic cutover. Retain encrypted legacy exports and a tested restore path until acceptance. Full historical automation is intentionally source-dependent; no representative customer dataset or approved financial/licensing migration mapping was provided.
