import { Decimal } from 'decimal.js';
import { Prisma, type PayrollRun } from '@prisma/client';
import {
  ruleSetSchema,
  calculatePayroll,
  type PayrollInput,
  type RuleSet,
} from '../../../packages/payroll-engine/src/index.js';
import { check, hash, day, decrypt, ApiError, type Tx } from './core.js';
export function calendarDays(
  start: Date,
  end: Date,
  weekdays: readonly number[],
  holidays: Set<string>,
) {
  let count = 0;
  for (let date = new Date(start); date <= end; date = new Date(date.getTime() + 86400000))
    if (weekdays.includes(date.getUTCDay()) && !holidays.has(date.toISOString().slice(0, 10)))
      count++;
  return count;
}
const maxDate = (a: Date, b: Date) => (a > b ? a : b),
  minDate = (a: Date, b: Date) => (a < b ? a : b);
function taxYearStart(payDate: Date, rules: RuleSet) {
  let year = payDate.getUTCFullYear();
  let start = day(
    `${year}-${String(rules.taxYearStart.month).padStart(2, '0')}-${String(rules.taxYearStart.day).padStart(2, '0')}`,
  );
  if (start > payDate) {
    year--;
    start = day(
      `${year}-${String(rules.taxYearStart.month).padStart(2, '0')}-${String(rules.taxYearStart.day).padStart(2, '0')}`,
    );
  }
  return start;
}
export async function computePayroll(tx: Tx, run: PayrollRun) {
  const tenantId = run.tenantId,
    company = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const rule = await tx.statutoryRule.findFirst({
    where: {
      tenantId,
      status: 'APPROVED',
      effectiveFrom: { lte: run.payDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.payDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  check(
    rule,
    409,
    'STATUTORY_APPROVAL_REQUIRED',
    'Supply an approved, effective-dated statutory package and accepted reference calculations before preparing payroll',
  );
  const rules = ruleSetSchema.parse(rule.configuration);
  check(
    process.env.NODE_ENV !== 'production' || rules.complianceMode === 'PRODUCTION_APPROVED',
    403,
    'TEST_RULES_ONLY',
    'Test-only statutory configuration cannot process production payroll',
  );
  const yearStart = taxYearStart(run.payDate, rules),
    selection = Array.isArray(run.employeeSelection)
      ? run.employeeSelection.filter((id): id is string => typeof id === 'string')
      : null;
  const employees = await tx.employee.findMany({
    where: {
      tenantId,
      hireDate: { lte: run.endDate },
      OR: [{ active: true }, { terminationDate: { gte: run.startDate, lte: run.endDate } }],
      ...(selection ? { id: { in: selection } } : {}),
    },
    include: {
      department: { select: { name: true } },
      compensation: {
        where: { effectiveDate: { lte: run.endDate } },
        orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
      },
      bankAccounts: true,
      schedule: true,
    },
    orderBy: { employeeNumber: 'asc' },
  });
  const [timesheets, overtime, leave, adjustments, prior, holidays] = await Promise.all([
    tx.timesheet.findMany({
      where: {
        tenantId,
        status: 'APPROVED',
        workDate: { gte: run.startDate, lte: run.endDate },
        OR: [{ payrollRunId: null }, { payrollRunId: run.id }],
      },
    }),
    tx.overtime.findMany({
      where: {
        tenantId,
        status: 'APPROVED',
        workDate: { gte: run.startDate, lte: run.endDate },
        OR: [{ payrollRunId: null }, { payrollRunId: run.id }],
      },
    }),
    tx.leaveRequest.findMany({
      where: {
        tenantId,
        status: 'APPROVED',
        startDate: { lte: run.endDate },
        endDate: { gte: run.startDate },
      },
    }),
    tx.payrollAdjustment.findMany({
      where: {
        tenantId,
        OR: [
          {
            recurrence: 'ONE_OFF',
            effectiveDate: { gte: run.startDate, lte: run.endDate },
            AND: { OR: [{ payrollRunId: null }, { payrollRunId: run.id }] },
          },
          {
            recurrence: 'PER_PERIOD',
            effectiveDate: { lte: run.payDate },
            AND: { OR: [{ endDate: null }, { endDate: { gte: run.payDate } }] },
          },
        ],
      },
    }),
    tx.payrollSnapshot.findMany({
      where: {
        tenantId,
        run: {
          status: { in: ['APPROVED', 'LOCKED'] },
          payDate: { gte: yearStart, lt: run.payDate },
        },
      },
      include: { run: { select: { payDate: true, frequency: true } } },
    }),
    tx.holiday.findMany({ where: { tenantId, date: { gte: run.startDate, lte: run.endDate } } }),
  ]);
  const standardSchedule = await tx.referenceData.findUnique({
    where: { tenantId_category_name: { tenantId, category: 'SCHEDULE', name: 'Standard' } },
  });
  const scheduleVersions = await tx.configurationChange.findMany({
    where: { tenantId, kind: 'REFERENCE_SCHEDULE', status: 'APPROVED' },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
  });
  const holidaysSet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
    outputs: Prisma.PayrollSnapshotUncheckedCreateInput[] = [];
  const inputs: { employeeId: string; source: unknown }[] = [];
  for (const e of employees) {
    if (process.env.NODE_ENV === 'production') {
      const identifiers = e.sensitiveCipher
        ? decrypt<Record<string, string>>(e.sensitiveCipher)
        : {};
      check(
        identifiers.trn && identifiers.nis && identifiers.nht,
        409,
        'STATUTORY_IDENTIFIERS',
        `Employee ${e.employeeNumber} requires validated TRN, NIS and NHT identifiers before production payroll`,
      );
    }
    const termsAt = (date: Date) =>
      e.compensation.filter((c) => c.effectiveDate <= date).at(-1) || e;
    const finalTerms = termsAt(run.endDate);
    if (finalTerms.frequency !== run.frequency) continue;
    check(
      e.compensationConfigured,
      409,
      'COMPENSATION_SETUP',
      `Employee ${e.employeeNumber} requires authorized compensation setup`,
    );
    const start = maxDate(run.startDate, e.hireDate),
      end = e.terminationDate ? minDate(run.endDate, e.terminationDate) : run.endDate;
    if (start > end) continue;
    const schedule = (e.schedule?.configuration || standardSchedule?.configuration) as {
        weekdays?: number[];
      } | null,
      weekdays = schedule?.weekdays || [1, 2, 3, 4, 5];
    const versions = scheduleVersions.filter(
      (v) => v.targetKey === (e.schedule?.name || standardSchedule?.name || 'Standard'),
    );
    const countWork = (a: Date, b: Date) => {
      let count = 0;
      for (let date = new Date(a); date <= b; date = new Date(date.getTime() + 86400000)) {
        const latest = versions.filter((v) => v.effectiveDate <= date).at(-1);
        const policy = (latest?.proposal || (versions.length ? versions[0]!.previous : null)) as {
          configuration?: { weekdays?: number[] };
        } | null;
        if (
          (policy?.configuration?.weekdays || weekdays).includes(date.getUTCDay()) &&
          !holidaysSet.has(date.toISOString().slice(0, 10))
        )
          count++;
      }
      return count;
    };
    const working = countWork(run.startDate, run.endDate);
    check(working > 0, 409, 'NO_WORKING_DAYS', 'Payroll period has no configured working days');
    const employeeTimes = timesheets.filter((t) => t.employeeId === e.id),
      employeeOvertime = overtime.filter((t) => t.employeeId === e.id),
      employeeLeave = leave.filter((l) => l.employeeId === e.id),
      employeeAdjustments = adjustments.filter((a) => a.employeeId === e.id);
    if (finalTerms.payType === 'HOURLY')
      check(
        employeeTimes.length > 0,
        409,
        'TIMESHEETS_REQUIRED',
        `Employee ${e.employeeNumber} needs approved regular attendance`,
      );
    const boundaries = [
      start,
      ...e.compensation.map((c) => c.effectiveDate).filter((date) => date > start && date <= end),
      new Date(end.getTime() + 86400000),
    ];
    const uniqueBoundaries = [
      ...new Map(boundaries.map((date) => [date.getTime(), date])).values(),
    ].sort((a, b) => a.getTime() - b.getTime());
    const segments: NonNullable<PayrollInput['segments']> = [];
    for (let i = 0; i < uniqueBoundaries.length - 1; i++) {
      const segmentStart = uniqueBoundaries[i],
        segmentEnd = new Date(uniqueBoundaries[i + 1].getTime() - 86400000),
        terms = termsAt(segmentStart);
      check(
        terms.frequency === run.frequency,
        409,
        'FREQUENCY_CHANGE',
        'Align payroll periods around an effective pay-frequency change',
      );
      const work = countWork(segmentStart, segmentEnd),
        regularHours = employeeTimes
          .filter((t) => t.workDate >= segmentStart && t.workDate <= segmentEnd)
          .reduce((n, t) => n.plus(t.hours.toString()), new Decimal(0));
      const unpaid = employeeLeave.reduce((n, l) => {
        const a = maxDate(segmentStart, l.startDate),
          b = minDate(segmentEnd, l.endDate);
        return a > b
          ? n
          : n.plus(
              new Decimal(countWork(a, b)).times(new Decimal(1).minus(l.paidFraction.toString())),
            );
      }, new Decimal(0));
      segments.push({
        basePay: terms.basePay.toString(),
        payType: terms.payType as PayrollInput['payType'],
        regularHours: regularHours.toString(),
        unpaidDays: unpaid.toString(),
        prorationFraction: new Decimal(work).div(working).toDecimalPlaces(30).toString(),
        prorationNumerator: String(work),
        prorationDenominator: String(working),
      });
    }
    const ytd: PayrollInput['yearToDate'] = {
      componentBases: {},
      employeeAmounts: {},
      employerAmounts: {},
    };
    for (const snapshot of prior.filter((p) => p.employeeId === e.id)) {
      const saved = snapshot.snapshot as unknown as {
        result: {
          components: { code: string; base: string; employee: string; employer: string }[];
        };
      };
      check(
        (snapshot.snapshot as unknown as { result: { currency: string } }).result.currency ===
          rules.currency,
        409,
        'YTD_CURRENCY',
        'Payroll currency changed within the tax year. Reconcile approved opening balances before processing.',
      );
      for (const component of saved.result.components) {
        for (const [target, field] of [
          ['componentBases', 'base'],
          ['employeeAmounts', 'employee'],
          ['employerAmounts', 'employer'],
        ] as const)
          ytd[target][component.code] = new Decimal(ytd[target][component.code] || '0')
            .plus(component[field])
            .toString();
      }
    }
    const daysSince = Math.floor((run.payDate.getTime() - yearStart.getTime()) / 86400000) + 1,
      elapsed =
        run.frequency === 'MONTHLY'
          ? (run.payDate.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 +
            run.payDate.getUTCMonth() -
            yearStart.getUTCMonth() +
            1
          : Math.ceil(daysSince / (run.frequency === 'WEEKLY' ? 7 : 14));
    const input: PayrollInput = {
      frequency: run.frequency as PayrollInput['frequency'],
      payType: finalTerms.payType as PayrollInput['payType'],
      basePay: finalTerms.basePay.toString(),
      standardHours:
        run.frequency === 'MONTHLY'
          ? rules.monthlyStandardHours
          : finalTerms.standardHours.toString(),
      regularHours: employeeTimes
        .reduce((n, t) => n.plus(t.hours.toString()), new Decimal(0))
        .toString(),
      unpaidDays: segments.reduce((n, s) => n.plus(s.unpaidDays), new Decimal(0)).toString(),
      workingDaysInPeriod: String(working),
      prorationFraction: new Decimal(countWork(start, end))
        .div(working)
        .toDecimalPlaces(30)
        .toString(),
      prorationNumerator: String(countWork(start, end)),
      prorationDenominator: String(working),
      elapsedPeriods: Math.min(
        elapsed,
        rules.periodsPerYear[run.frequency as PayrollInput['frequency']],
      ),
      segments,
      overtime: employeeOvertime.map((t) => {
        const terms = termsAt(t.workDate);
        return {
          hours: t.hours.toString(),
          multiplier: t.multiplier.toString(),
          rateBasePay: terms.basePay.toString(),
          rateStandardHours:
            run.frequency === 'MONTHLY'
              ? rules.monthlyStandardHours
              : terms.standardHours.toString(),
          ratePayType: terms.payType as PayrollInput['payType'],
        };
      }),
      earnings: employeeAdjustments
        .filter((a) => a.kind === 'EARNING')
        .map((a) => ({ name: a.name, amount: a.amount.toString(), taxable: a.taxable })),
      deductions: employeeAdjustments
        .filter((a) => a.kind === 'DEDUCTION')
        .map((a) => ({ name: a.name, amount: a.amount.toString(), taxRelief: a.taxRelief })),
      yearToDate: ytd,
    };
    let result: ReturnType<typeof calculatePayroll>;
    try {
      result = calculatePayroll(input, rules);
    } catch (error) {
      throw new ApiError(
        409,
        'PAYROLL_EXCEPTION',
        `Employee ${e.employeeNumber}: ${(error as Error).message}`,
      );
    }
    const bank = e.bankAccounts[0];
    const source = {
      scheduleVersions: versions,
      employeeVersion: e.version,
      compensation: e.compensation.map((c) => ({
        id: c.id,
        effectiveDate: c.effectiveDate.toISOString(),
        basePay: c.basePay.toString(),
        frequency: c.frequency,
        payType: c.payType,
        standardHours: c.standardHours.toString(),
      })),
      timesheets: employeeTimes.map((t) => ({
        id: t.id,
        hours: t.hours.toString(),
        approvedBy: t.approvedBy,
      })),
      overtime: employeeOvertime.map((t) => ({
        id: t.id,
        hours: t.hours.toString(),
        multiplier: t.multiplier.toString(),
        approvedBy: t.approvedBy,
      })),
      leave: employeeLeave.map((l) => ({
        id: l.id,
        startDate: l.startDate.toISOString(),
        endDate: l.endDate.toISOString(),
        days: l.days.toString(),
        paidFraction: l.paidFraction.toString(),
        approvedBy: l.approvedBy,
      })),
      adjustments: employeeAdjustments.map((a) => ({
        id: a.id,
        amount: a.amount.toString(),
        kind: a.kind,
        taxable: a.taxable,
        taxRelief: a.taxRelief,
      })),
      schedule: { weekdays, holidays: [...holidaysSet] },
      input,
      ruleId: rule.id,
      ruleConfiguration: rules,
      bankCipher: bank?.accountCipher || null,
    };
    inputs.push({ employeeId: e.id, source });
    const data = {
      employee: {
        id: e.id,
        employeeNumber: e.employeeNumber,
        name: e.firstName + ' ' + e.lastName,
        departmentId: e.departmentId,
        departmentName: e.department?.name || 'Unassigned',
        position: e.position,
        frequency: run.frequency,
      },
      company: { legalName: company.legalName, displayName: company.displayName },
      rule: {
        id: rule.id,
        name: rule.name,
        sourceReference: rule.sourceReference,
        configuration: rules,
      },
      inputs: source,
      result,
      identifiersCipher: e.sensitiveCipher,
      paymentInstructions: bank
        ? { bankName: bank.bankName, accountCipher: bank.accountCipher }
        : null,
    };
    outputs.push({
      tenantId,
      runId: run.id,
      employeeId: e.id,
      gross: result.gross,
      net: result.net,
      deductions: result.deductions,
      employerContributions: result.employerContributions,
      snapshot: JSON.parse(JSON.stringify(data)),
    });
  }
  check(
    outputs.length > 0,
    409,
    'NO_ELIGIBLE_EMPLOYEES',
    'No eligible employees matched this pay group and frequency',
  );
  return {
    rule,
    outputs,
    digest: hash(
      JSON.stringify({
        frequency: run.frequency,
        payGroup: run.payGroup,
        startDate: run.startDate,
        endDate: run.endDate,
        payDate: run.payDate,
        inputs,
      }),
    ),
    timesheetIds: timesheets
      .filter((t) => outputs.some((o) => o.employeeId === t.employeeId))
      .map((t) => t.id),
    overtimeIds: overtime
      .filter((t) => outputs.some((o) => o.employeeId === t.employeeId))
      .map((t) => t.id),
    adjustmentIds: adjustments
      .filter(
        (a) => a.recurrence === 'ONE_OFF' && outputs.some((o) => o.employeeId === a.employeeId),
      )
      .map((a) => a.id),
    leaveIds: leave
      .filter((t) => outputs.some((o) => o.employeeId === t.employeeId))
      .map((t) => t.id),
  };
}
export function publicPayrollSnapshot(
  snapshot: { snapshot: Prisma.JsonValue } & Record<string, unknown>,
) {
  const saved = snapshot.snapshot as Prisma.JsonObject;
  const { paymentInstructions: _payment, identifiersCipher: _identifiers, ...data } = saved;
  const rawInputs = data.inputs as Prisma.JsonObject | undefined;
  return {
    ...snapshot,
    snapshot: { ...data, inputs: rawInputs ? { ...rawInputs, bankCipher: undefined } : undefined },
  };
}
