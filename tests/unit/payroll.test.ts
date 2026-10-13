import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePayroll,
  verifyReferenceVectors,
  ruleSetSchema,
  money,
} from '../../packages/payroll-engine/src/index.js';
import { syntheticRules, monthlyInput, syntheticVectors } from '../support/payroll.js';
test('synthetic monthly salary needs no regular timesheet and matches reviewed arithmetic vector', () => {
  assert.equal(verifyReferenceVectors(syntheticRules, syntheticVectors), true);
  const result = calculatePayroll(monthlyInput, syntheticRules);
  assert.equal(result.gross, '100000.00');
  assert.equal(result.components.find((c) => c.code === 'PAYE')?.employee, '4900.00');
  assert.equal(result.net, '91600.00');
  assert.equal(result.complianceMode, 'TEST_ONLY');
});
test('weekly hourly earnings include only supplied approved overtime inputs', () => {
  const input = {
    ...monthlyInput,
    frequency: 'WEEKLY' as const,
    payType: 'HOURLY' as const,
    basePay: '1000',
    standardHours: '40',
    regularHours: '7',
    workingDaysInPeriod: '5',
    overtime: [{ hours: '2', multiplier: '1.5' }],
  };
  const result = calculatePayroll(input, syntheticRules);
  assert.equal(result.regular, '7000.00');
  assert.equal(result.overtime, '3000.00');
  assert.equal(result.gross, '10000.00');
  assert.equal(result.net, '9650.00');
});
test('fortnightly progressive annualization uses configured frequency and half-up cents', () => {
  const result = calculatePayroll({ ...monthlyInput, frequency: 'FORTNIGHTLY' }, syntheticRules);
  assert.equal(result.components.find((c) => c.code === 'PAYE')?.employee, '7592.31');
  assert.equal(result.net, '88907.69');
  assert.equal(money('0.105'), '0.11');
});
test('annual earnings ceilings apply to remaining YTD capacity', () => {
  const rules = structuredClone(syntheticRules);
  rules.components[0].annualCeiling = '150000';
  const result = calculatePayroll(
    {
      ...monthlyInput,
      yearToDate: { componentBases: { NIS: '140000' }, employeeAmounts: {}, employerAmounts: {} },
    },
    rules,
  );
  assert.equal(result.components[0].base, '10000.00');
  assert.equal(result.components[0].employee, '100.00');
});
test('effective-dated salary segments and unpaid leave are calculated with decimal proration', () => {
  const result = calculatePayroll(
    {
      ...monthlyInput,
      segments: [
        {
          basePay: '100000',
          payType: 'SALARY',
          regularHours: '0',
          unpaidDays: '1',
          prorationFraction: '0.5',
        },
        {
          basePay: '120000',
          payType: 'SALARY',
          regularHours: '0',
          unpaidDays: '0',
          prorationFraction: '0.5',
        },
      ],
      unpaidDays: '1',
    },
    syntheticRules,
  );
  assert.equal(result.regular, '105000.00');
});
test('tax relief, non-taxable earnings and personal deductions have separate effects', () => {
  const result = calculatePayroll(
    {
      ...monthlyInput,
      earnings: [{ name: 'Non-taxable fixture', amount: '5000', taxable: false }],
      deductions: [{ name: 'Tax-relief fixture', amount: '1000', taxRelief: true }],
    },
    syntheticRules,
  );
  assert.equal(result.gross, '105000.00');
  assert.equal(result.nonTaxableEarnings, '5000.00');
  assert.equal(result.personalDeductions[0].amount, '1000.00');
});
test('invalid rules, monthly hourly compensation and failed reference vectors are rejected', () => {
  assert.throws(() => calculatePayroll({ ...monthlyInput, payType: 'HOURLY' }, syntheticRules));
  assert.throws(() =>
    verifyReferenceVectors(syntheticRules, [
      { ...syntheticVectors[0], expected: { ...syntheticVectors[0].expected, net: '1' } },
    ]),
  );
  assert.equal(
    ruleSetSchema.safeParse({ ...syntheticRules, components: syntheticRules.components.slice(1) })
      .success,
    false,
  );
  assert.throws(() =>
    calculatePayroll(
      {
        ...monthlyInput,
        deductions: [{ name: 'Excessive deduction', amount: '200000', taxRelief: false }],
      },
      syntheticRules,
    ),
  );
});
