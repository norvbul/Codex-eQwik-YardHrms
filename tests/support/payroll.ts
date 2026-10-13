import { ruleSetSchema, type PayrollInput } from '../../packages/payroll-engine/src/index.js';
// Synthetic arithmetic fixture only. These are NOT Jamaican statutory rates or legal guidance.
export const syntheticRules = ruleSetSchema.parse({
  currency: 'JMD',
  monthlyStandardHours: '173.33',
  complianceMode: 'TEST_ONLY',
  rounding: 'HALF_UP',
  taxationMethod: 'PERIOD_ANNUALIZED',
  periodsPerYear: { WEEKLY: 52, FORTNIGHTLY: 26, MONTHLY: 12 },
  taxYearStart: { month: 1, day: 1 },
  components: [
    {
      code: 'NIS',
      name: 'Synthetic NIS test component',
      base: 'GROSS',
      deductComponents: [],
      deductTaxRelief: false,
      annualCeiling: null,
      employee: { type: 'FLAT', rate: '0.01' },
      employer: { type: 'FLAT', rate: '0.01' },
    },
    {
      code: 'NHT',
      name: 'Synthetic NHT test component',
      base: 'GROSS',
      deductComponents: [],
      deductTaxRelief: false,
      annualCeiling: null,
      employee: { type: 'FLAT', rate: '0.02' },
      employer: { type: 'FLAT', rate: '0.02' },
    },
    {
      code: 'EDUCATION_TAX',
      name: 'Synthetic Education Tax test component',
      base: 'GROSS',
      deductComponents: [],
      deductTaxRelief: false,
      annualCeiling: null,
      employee: { type: 'FLAT', rate: '0.005' },
      employer: { type: 'FLAT', rate: '0.005' },
    },
    {
      code: 'PAYE',
      name: 'Synthetic progressive PAYE test component',
      base: 'TAXABLE',
      deductComponents: ['NIS'],
      deductTaxRelief: true,
      annualCeiling: null,
      employee: {
        type: 'PROGRESSIVE',
        bands: [
          { upTo: '600000', rate: '0' },
          { upTo: null, rate: '0.10' },
        ],
      },
      employer: { type: 'FLAT', rate: '0' },
    },
  ],
});
export const monthlyInput: PayrollInput = {
  frequency: 'MONTHLY',
  payType: 'SALARY',
  basePay: '100000',
  standardHours: '173.33',
  regularHours: '0',
  unpaidDays: '0',
  workingDaysInPeriod: '20',
  prorationFraction: '1',
  elapsedPeriods: 1,
  overtime: [],
  earnings: [],
  deductions: [],
  yearToDate: { componentBases: {}, employeeAmounts: {}, employerAmounts: {} },
};
export const syntheticVectors = [
  {
    name: 'Synthetic arithmetic monthly vector (not law)',
    input: monthlyInput,
    expected: {
      gross: '100000.00',
      deductions: '8400.00',
      net: '91600.00',
      employerContributions: '3500.00',
    },
  },
];
