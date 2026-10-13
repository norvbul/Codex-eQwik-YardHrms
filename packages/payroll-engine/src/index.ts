import { Decimal } from 'decimal.js';
import { z } from 'zod';
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const amount = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/);
const rate = z.string().regex(/^(0(\.\d{1,8})?|1(\.0{1,8})?)$/);
const ratio = z.string().regex(/^(0(\.\d{1,30})?|1(\.0{1,30})?)$/);
const band = z.object({ upTo: amount.nullable(), rate }).strict();
export const calculationMethod = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FLAT'), rate }).strict(),
  z.object({ type: z.literal('PROGRESSIVE'), bands: z.array(band).min(1).max(30) }).strict(),
]);
export const statutoryComponent = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    name: z.string().min(1).max(100),
    base: z.enum(['GROSS', 'TAXABLE']),
    deductComponents: z.array(z.string()).max(20),
    deductTaxRelief: z.boolean(),
    annualCeiling: amount.nullable(),
    employee: calculationMethod,
    employer: calculationMethod,
  })
  .strict();
export const ruleSetSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    monthlyStandardHours: amount,
    complianceMode: z.enum(['TEST_ONLY', 'PRODUCTION_APPROVED']),
    rounding: z.literal('HALF_UP'),
    taxationMethod: z.enum(['PERIOD_ANNUALIZED', 'CUMULATIVE']),
    periodsPerYear: z
      .object({
        WEEKLY: z.number().int().min(1).max(366),
        FORTNIGHTLY: z.number().int().min(1).max(366),
        MONTHLY: z.number().int().min(1).max(366),
      })
      .strict(),
    taxYearStart: z
      .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(28) })
      .strict(),
    components: z.array(statutoryComponent).min(4).max(30),
  })
  .strict()
  .superRefine((rules, ctx) => {
    if (new Decimal(rules.monthlyStandardHours).lte(0))
      ctx.addIssue({
        code: 'custom',
        message: 'Monthly standard hours must be positive',
        path: ['monthlyStandardHours'],
      });
    const codes = new Set<string>();
    for (const component of rules.components) {
      if (codes.has(component.code))
        ctx.addIssue({
          code: 'custom',
          message: 'Duplicate statutory component',
          path: ['components'],
        });
      for (const reference of component.deductComponents)
        if (!codes.has(reference))
          ctx.addIssue({
            code: 'custom',
            message: 'Deducted components must appear earlier in calculation order',
            path: ['components'],
          });
      codes.add(component.code);
      for (const method of [component.employee, component.employer])
        if (method.type === 'PROGRESSIVE') {
          let previous = new Decimal(0);
          method.bands.forEach((b, index) => {
            if (b.upTo === null && index !== method.bands.length - 1)
              ctx.addIssue({
                code: 'custom',
                message: 'Only the last progressive band may be unlimited',
                path: ['components'],
              });
            if (b.upTo !== null) {
              const upper = new Decimal(b.upTo);
              if (upper.lte(previous))
                ctx.addIssue({
                  code: 'custom',
                  message: 'Progressive thresholds must increase',
                  path: ['components'],
                });
              previous = upper;
            }
          });
          if (method.bands.at(-1)?.upTo !== null)
            ctx.addIssue({
              code: 'custom',
              message: 'Progressive schedules must end with an unlimited band',
              path: ['components'],
            });
        }
    }
    for (const code of ['PAYE', 'NIS', 'NHT', 'EDUCATION_TAX'])
      if (!codes.has(code))
        ctx.addIssue({
          code: 'custom',
          message: `Configure ${code} explicitly; no statutory default is supplied`,
          path: ['components'],
        });
  });
export type RuleSet = z.infer<typeof ruleSetSchema>;
export const payrollInputSchema = z
  .object({
    frequency: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']),
    payType: z.enum(['SALARY', 'HOURLY']),
    basePay: amount,
    standardHours: amount,
    regularHours: amount,
    unpaidDays: amount,
    workingDaysInPeriod: amount,
    prorationFraction: ratio,
    prorationNumerator: amount.optional(),
    prorationDenominator: amount.optional(),
    elapsedPeriods: z.number().int().positive(),
    segments: z
      .array(
        z
          .object({
            basePay: amount,
            payType: z.enum(['SALARY', 'HOURLY']),
            regularHours: amount,
            unpaidDays: amount,
            prorationFraction: ratio,
            prorationNumerator: amount.optional(),
            prorationDenominator: amount.optional(),
          })
          .strict(),
      )
      .optional(),
    overtime: z.array(
      z
        .object({
          hours: amount,
          multiplier: amount,
          hourlyRate: amount.optional(),
          rateBasePay: amount.optional(),
          rateStandardHours: amount.optional(),
          ratePayType: z.enum(['SALARY', 'HOURLY']).optional(),
        })
        .strict(),
    ),
    earnings: z.array(z.object({ name: z.string(), amount, taxable: z.boolean() }).strict()),
    deductions: z.array(z.object({ name: z.string(), amount, taxRelief: z.boolean() }).strict()),
    yearToDate: z
      .object({
        componentBases: z.record(z.string(), amount),
        employeeAmounts: z.record(z.string(), amount),
        employerAmounts: z.record(z.string(), amount),
      })
      .strict(),
  })
  .strict();
export type PayrollInput = z.infer<typeof payrollInputSchema>;
export type PayrollResult = {
  regular: string;
  overtime: string;
  taxableEarnings: string;
  nonTaxableEarnings: string;
  gross: string;
  deductions: string;
  net: string;
  employerContributions: string;
  components: { code: string; name: string; base: string; employee: string; employer: string }[];
  personalDeductions: { name: string; amount: string }[];
  rounding: 'HALF_UP';
  currency: string;
  complianceMode: RuleSet['complianceMode'];
};
export const money = (value: Decimal.Value) =>
  new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
function evaluate(base: Decimal, method: z.infer<typeof calculationMethod>) {
  if (method.type === 'FLAT') return base.times(method.rate);
  let lower = new Decimal(0),
    tax = new Decimal(0);
  for (const band of method.bands) {
    const upper = band.upTo === null ? base : new Decimal(band.upTo);
    const portion = Decimal.max(0, Decimal.min(base, upper).minus(lower));
    tax = tax.plus(portion.times(band.rate));
    lower = upper;
    if (base.lte(upper)) break;
  }
  return tax;
}
export function calculatePayroll(raw: PayrollInput, rawRules: RuleSet): PayrollResult {
  const input = payrollInputSchema.parse(raw),
    rules = ruleSetSchema.parse(rawRules),
    periods = rules.periodsPerYear[input.frequency];
  const standard = new Decimal(
    input.frequency === 'MONTHLY' ? rules.monthlyStandardHours : input.standardHours,
  );
  if (standard.lte(0)) throw new Error('Standard hours must be positive');
  if (input.payType === 'HOURLY' && input.frequency === 'MONTHLY')
    throw new Error('Monthly payroll uses contractual salary');
  if (new Decimal(input.unpaidDays).gt(input.workingDaysInPeriod))
    throw new Error('Unpaid leave exceeds working days in period');
  const prorate = (base: string, fraction: string, numerator?: string, denominator?: string) => {
    if (numerator !== undefined && denominator !== undefined) {
      if (new Decimal(denominator).lte(0))
        throw new Error('Proration denominator must be positive');
      return new Decimal(base).times(numerator).div(denominator);
    }
    return new Decimal(base).times(fraction);
  };
  const contractual =
    input.payType === 'HOURLY'
      ? new Decimal(input.basePay).times(input.regularHours)
      : prorate(
          input.basePay,
          input.prorationFraction,
          input.prorationNumerator,
          input.prorationDenominator,
        );
  const unpaid =
    input.payType === 'SALARY' && new Decimal(input.workingDaysInPeriod).gt(0)
      ? new Decimal(input.basePay).times(input.unpaidDays).div(input.workingDaysInPeriod)
      : new Decimal(0);
  const segmentPay = input.segments
    ? input.segments.reduce((total, s) => {
        const base =
          s.payType === 'HOURLY'
            ? new Decimal(s.basePay).times(s.regularHours)
            : prorate(s.basePay, s.prorationFraction, s.prorationNumerator, s.prorationDenominator);
        const leave =
          s.payType === 'SALARY' && new Decimal(input.workingDaysInPeriod).gt(0)
            ? new Decimal(s.basePay).times(s.unpaidDays).div(input.workingDaysInPeriod)
            : new Decimal(0);
        return total.plus(Decimal.max(0, base.minus(leave)));
      }, new Decimal(0))
    : null;
  const regular = new Decimal(money(segmentPay || Decimal.max(0, contractual.minus(unpaid))));
  const hourly =
    input.payType === 'HOURLY'
      ? new Decimal(input.basePay)
      : new Decimal(input.basePay).div(standard);
  const overtime = new Decimal(
    money(
      input.overtime.reduce(
        (total, entry) =>
          total.plus(
            entry.rateBasePay
              ? entry.ratePayType === 'HOURLY'
                ? new Decimal(entry.rateBasePay).times(entry.hours).times(entry.multiplier)
                : new Decimal(entry.rateBasePay)
                    .times(entry.hours)
                    .times(entry.multiplier)
                    .div(entry.rateStandardHours!)
              : new Decimal(entry.hourlyRate || hourly).times(entry.hours).times(entry.multiplier),
          ),
        new Decimal(0),
      ),
    ),
  );
  const taxableEarnings = new Decimal(
      money(
        input.earnings.filter((e) => e.taxable).reduce((n, e) => n.plus(e.amount), new Decimal(0)),
      ),
    ),
    nonTaxableEarnings = new Decimal(
      money(
        input.earnings.filter((e) => !e.taxable).reduce((n, e) => n.plus(e.amount), new Decimal(0)),
      ),
    );
  const gross = new Decimal(
      money(regular.plus(overtime).plus(taxableEarnings).plus(nonTaxableEarnings)),
    ),
    taxable = gross.minus(nonTaxableEarnings),
    personal = input.deductions.reduce((n, d) => n.plus(d.amount), new Decimal(0)),
    relief = input.deductions
      .filter((d) => d.taxRelief)
      .reduce((n, d) => n.plus(d.amount), new Decimal(0));
  const components: PayrollResult['components'] = [];
  for (const component of rules.components) {
    let base = component.base === 'GROSS' ? gross : taxable;
    if (component.deductTaxRelief) base = base.minus(relief);
    for (const code of component.deductComponents)
      base = base.minus(components.find((c) => c.code === code)!.employee);
    base = Decimal.max(0, base);
    const priorBase = new Decimal(input.yearToDate.componentBases[component.code] || '0');
    if (component.annualCeiling !== null)
      base = Decimal.min(
        base,
        Decimal.max(0, new Decimal(component.annualCeiling).minus(priorBase)),
      );
    let employeeAmount: Decimal, employerAmount: Decimal;
    if (rules.taxationMethod === 'CUMULATIVE') {
      const elapsed = Decimal.min(input.elapsedPeriods, periods),
        annualized = priorBase.plus(base).times(periods).div(elapsed);
      employeeAmount = Decimal.max(
        0,
        evaluate(annualized, component.employee)
          .times(elapsed)
          .div(periods)
          .minus(input.yearToDate.employeeAmounts[component.code] || '0'),
      );
      employerAmount = Decimal.max(
        0,
        evaluate(annualized, component.employer)
          .times(elapsed)
          .div(periods)
          .minus(input.yearToDate.employerAmounts[component.code] || '0'),
      );
    } else {
      employeeAmount = evaluate(base.times(periods), component.employee).div(periods);
      employerAmount = evaluate(base.times(periods), component.employer).div(periods);
    }
    components.push({
      code: component.code,
      name: component.name,
      base: money(base),
      employee: money(employeeAmount),
      employer: money(employerAmount),
    });
  }
  const statutory = components.reduce((n, c) => n.plus(c.employee), new Decimal(0)),
    employer = components.reduce((n, c) => n.plus(c.employer), new Decimal(0)),
    deductions = new Decimal(money(statutory.plus(personal))),
    net = gross.minus(deductions);
  if (net.lt(0)) throw new Error('Deductions exceed gross pay; review payroll inputs');
  return {
    regular: money(regular),
    overtime: money(overtime),
    taxableEarnings: money(taxableEarnings),
    nonTaxableEarnings: money(nonTaxableEarnings),
    gross: money(gross),
    deductions: money(deductions),
    net: money(net),
    employerContributions: money(employer),
    components,
    personalDeductions: input.deductions.map((d) => ({ name: d.name, amount: money(d.amount) })),
    rounding: rules.rounding,
    currency: rules.currency,
    complianceMode: rules.complianceMode,
  };
}
export const referenceVectorSchema = z
  .object({
    name: z.string().min(1),
    input: payrollInputSchema,
    expected: z
      .object({
        gross: amount,
        deductions: amount,
        net: amount,
        employerContributions: amount,
        componentAmounts: z
          .record(z.string(), z.object({ employee: amount, employer: amount }).strict())
          .optional(),
      })
      .strict(),
  })
  .strict();
export function verifyReferenceVectors(
  rules: RuleSet,
  vectors: z.infer<typeof referenceVectorSchema>[],
) {
  if (!vectors.length) throw new Error('Approved reference calculations are required');
  for (const vector of vectors) {
    const calculated = calculatePayroll(vector.input, rules);
    for (const key of ['gross', 'deductions', 'net', 'employerContributions'] as const)
      if (!new Decimal(calculated[key]).eq(vector.expected[key]))
        throw new Error(`Reference vector ${vector.name} does not match expected ${key}`);
    for (const [code, expected] of Object.entries(vector.expected.componentAmounts || {})) {
      const actual = calculated.components.find((component) => component.code === code);
      if (
        !actual ||
        !new Decimal(actual.employee).eq(expected.employee) ||
        !new Decimal(actual.employer).eq(expected.employer)
      )
        throw new Error(`Reference vector ${vector.name} does not match expected ${code}`);
    }
  }
  return true;
}
