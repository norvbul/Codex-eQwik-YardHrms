# Payroll configuration and operation

No Jamaican statutory percentages or commercial payroll datasets are seeded. The synthetic packages in `tests/support/payroll.ts` verify arithmetic only. They are explicitly `TEST_ONLY`, watermark PDFs, and cannot generate a disbursable bank output. Production execution rejects test configuration.

## Supply an approved package

Obtain an effective-dated package and signed expected calculations from qualified Jamaican payroll/legal reviewers. Configure currency JMD, company monthly standard hours (development default 173.33), periods per year for weekly/fortnightly/monthly, tax-year start, HALF_UP rounding, taxation method and ordered components.

The package must explicitly include PAYE, NIS, NHT and EDUCATION_TAX. Each component declares its taxable/gross base, excluded prior components and relief, optional annual ceiling, employee and employer methods. Flat methods take decimal rates; progressive methods use increasing thresholds and an unlimited final band. Other components can be included explicitly. No rate is inferred from the conflicting examples in the original outline.

Payroll Setup accepts validated configuration JSON and reference-vector JSON. Every vector contains its inputs and expected gross, deductions, net and employer contributions. Production packages require all frequencies and expected amounts for every configured component. A different authorized approver validates the calculations, records their reviewer name and attestation and approves the version. An overlapping previous version can be closed only prospectively without changing already approved runs. Approved rule rows, normalized components/bands and their original configuration are immutable.

The version is selected by pay date. Standard hours and monetary values must be supplied as decimal strings. Keep approved monthly hours aligned with company policy and check overtime-reference cases whenever hours change.

## Process a run

1. Complete authorized employee compensation, active employment dates, banking/identifiers and relevant opening balances. Production processing requires TRN/NIS/NHT presence; legal-format validation and real reference data must be accepted before launch.
2. Submit and separately approve eligible overtime, regular hourly time and leave. Monthly salary needs no regular timesheet. Establish effective-dated one-off or recurring allowances, bonuses and personal deductions with reasons.
3. Create a full weekly seven-day, fortnightly fourteen-day or monthly 28–31-day period, pay date, pay group and optional employee selection. Overlapping unreversed payroll for the same employee is rejected.
4. Prepare asynchronously. The worker rechecks the actor and subscription, selects effective compensation/rules and approved inputs, applies salary segments/proration, relief, caps and YTD, and saves a reproducible input fingerprint. Failed preparation returns to Draft with a visible error.
5. Review the saved calculation and totals. A different reviewer checks current inputs against the fingerprint. Changing a prepared input requires re-preparation.
6. Final approval requires authorized separation from preparation. Snapshots capture employee/company identity, calculations, package version, sources and approval attribution. Lock the approved run to finish processing.
7. Generate private PDF payslips and download controlled bank CSV/XLSX. Bank output requires sensitive permission and approved unreversed payroll. `TEST_ONLY` output is permitted only as an explicit, named preview.

One-off inputs are consumed once on approval. Recurring inputs apply to eligible periods until prospectively ended. Input consumption is released by an audited reversal; original approved snapshots remain frozen and visibly reversed. Re-submit corrected inputs and prepare a new revision rather than editing historical results.

## Reconcile and retain

Compare the register, deductions, statutory components, employer costs, departmental totals and bank output against the approved expected results before disbursement. Private payslips preserve historical employee details and show current company branding/name. View/print requests and downloads record the actor; the system records a print request, not physical printer completion.

Approved historical payslips remain available to their subject and users with payslip-any authority after paid expiry. Managers with that permission may view/print any approved company employee's payslip; it does not grant bank export or payroll approval authority.

Cumulative deductions currently clamp negative statutory adjustments to zero. Supplemental/off-cycle runs, full retro-arrears automation, statutory refunds and externally verified employer-specific bank layouts need reviewed extensions. Do not use the generic bank format as an accepted bank specification without provider validation.
