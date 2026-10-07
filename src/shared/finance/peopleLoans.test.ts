import { describe, expect, it } from 'vitest';
import { addMonthsClamped, calculatePeopleLoan } from './peopleLoans';

describe('peopleLoans calculations', () => {
  it('correctly clamps dates across month and year boundaries', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29'); // Leap year
    expect(addMonthsClamped('2026-10-15', 1)).toBe('2026-11-15');
    expect(addMonthsClamped('2026-11-30', 1)).toBe('2026-12-30');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-12-31', 2)).toBe('2027-02-28');
  });

  it('calculates 0% interest loan divided in 3 installments', () => {
    const result = calculatePeopleLoan({
      principalInput: '1000,00',
      interestType: 'none',
      interestRate: '0',
      interestFixedInput: '',
      interestPeriod: 'total',
      months: 3,
      payMode: 'installments',
      firstDueDate: '2026-11-10',
      today: '2026-10-10'
    });

    expect(result.principalCents).toBe(100000);
    expect(result.interestCents).toBe(0);
    expect(result.totalCents).toBe(100000);
    expect(result.count).toBe(3);
    expect(result.schedule).toHaveLength(3);

    // Sum of installments must match total cents exactly
    const sum = result.schedule.reduce((acc, s) => acc + s.amountCents, 0);
    expect(sum).toBe(100000);

    expect(result.schedule[0].dueDate).toBe('2026-11-10');
    expect(result.schedule[1].dueDate).toBe('2026-12-10');
    expect(result.schedule[2].dueDate).toBe('2027-01-10');
  });

  it('calculates monthly percentage interest (e.g. 5% per month for 3 months = 15% total)', () => {
    const result = calculatePeopleLoan({
      principalInput: '1000,00',
      interestType: 'percent',
      interestRate: '5',
      interestFixedInput: '',
      interestPeriod: 'monthly',
      months: 3,
      payMode: 'installments',
      firstDueDate: '2026-11-15',
      today: '2026-10-15'
    });

    expect(result.principalCents).toBe(100000);
    expect(result.interestCents).toBe(15000); // 15% of 1000 = 150
    expect(result.totalCents).toBe(115000);
    expect(result.effectiveRate).toBe(15);
    expect(result.count).toBe(3);

    const sum = result.schedule.reduce((acc, s) => acc + s.amountCents, 0);
    expect(sum).toBe(115000);
  });

  it('calculates fixed interest amount (e.g. R$ 50,00 fixed)', () => {
    const result = calculatePeopleLoan({
      principalInput: '500,00',
      interestType: 'fixed',
      interestRate: '',
      interestFixedInput: '50,00',
      interestPeriod: 'total',
      months: 2,
      payMode: 'installments',
      firstDueDate: '2026-11-01',
      today: '2026-10-01'
    });

    expect(result.principalCents).toBe(50000);
    expect(result.interestCents).toBe(5000);
    expect(result.totalCents).toBe(55000);
    expect(result.schedule[0].amountCents).toBe(27500);
    expect(result.schedule[1].amountCents).toBe(27500);
  });

  it('calculates fixed interest per month (e.g. R$ 30,00 per month for 2 months = R$ 60,00 total)', () => {
    const result = calculatePeopleLoan({
      principalInput: '300,00',
      interestType: 'fixed',
      interestRate: '',
      interestFixedInput: '30,00',
      interestPeriod: 'monthly',
      months: 2,
      payMode: 'installments',
      firstDueDate: '2026-11-07',
      today: '2026-10-07'
    });

    expect(result.principalCents).toBe(30000);
    expect(result.interestCents).toBe(6000); // R$ 30 * 2 = R$ 60
    expect(result.totalCents).toBe(36000);
    expect(result.effectiveRate).toBe(20); // 60 / 300 = 20%
    expect(result.count).toBe(2);
    expect(result.schedule[0].amountCents).toBe(18000);
    expect(result.schedule[1].amountCents).toBe(18000);
  });

  it('handles single lump sum payment at the end of the term', () => {
    const result = calculatePeopleLoan({
      principalInput: '2000,00',
      interestType: 'percent',
      interestRate: '10',
      interestFixedInput: '',
      interestPeriod: 'total',
      months: 6,
      payMode: 'single',
      firstDueDate: '2027-04-15',
      today: '2026-10-15'
    });

    expect(result.count).toBe(1);
    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0].amountCents).toBe(220000);
    expect(result.schedule[0].dueDate).toBe('2027-04-15');
  });

  it('calculates daily installments (e.g. 1500 in 30 daily installments)', () => {
    const result = calculatePeopleLoan({
      principalInput: '1500,00',
      interestType: 'none',
      interestRate: '',
      interestFixedInput: '',
      interestPeriod: 'total',
      installmentsCount: 30,
      frequency: 'daily',
      payMode: 'installments',
      firstDueDate: '2026-10-08',
      today: '2026-10-07'
    });

    expect(result.principalCents).toBe(150000);
    expect(result.count).toBe(30);
    expect(result.frequency).toBe('daily');
    expect(result.schedule).toHaveLength(30);
    expect(result.schedule[0].amountCents).toBe(5000);
    expect(result.schedule[0].dueDate).toBe('2026-10-08');
    expect(result.schedule[1].dueDate).toBe('2026-10-09');
    expect(result.schedule[29].dueDate).toBe('2026-11-06');
    const total = result.schedule.reduce((acc, s) => acc + s.amountCents, 0);
    expect(total).toBe(150000);
  });

  it('calculates indefinite loan with fixed monthly interest and elapsed months', () => {
    const result = calculatePeopleLoan({
      principalInput: '1500,00',
      interestType: 'fixed',
      interestRate: '',
      interestFixedInput: '50,00',
      interestPeriod: 'monthly',
      payMode: 'indefinite',
      startDate: '2026-07-07',
      firstDueDate: '2026-11-07',
      today: '2026-10-07'
    });

    expect(result.principalCents).toBe(150000);
    expect(result.isIndefinite).toBe(true);
    expect(result.elapsedMonths).toBe(3);
    expect(result.monthlyInterestCents).toBe(5000);
    expect(result.interestCents).toBe(15000); // 3 * 50 = 150
    expect(result.totalCents).toBe(165000); // 1500 + 150 = 1650
    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0].amountCents).toBe(5000); // next interest reminder
    expect(result.schedule[0].dueDate).toBe('2026-11-07');
  });

  it('calculates indefinite loan with monthly percentage interest starting today', () => {
    const result = calculatePeopleLoan({
      principalInput: '1500,00',
      interestType: 'percent',
      interestRate: '5',
      interestFixedInput: '',
      interestPeriod: 'monthly',
      payMode: 'indefinite',
      startDate: '2026-10-07',
      firstDueDate: '2026-11-07',
      today: '2026-10-07'
    });

    expect(result.principalCents).toBe(150000);
    expect(result.isIndefinite).toBe(true);
    expect(result.elapsedMonths).toBe(0);
    expect(result.monthlyInterestCents).toBe(7500); // 5% of 1500 = 75
    expect(result.interestCents).toBe(0); // 0 elapsed months
    expect(result.totalCents).toBe(150000);
    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0].amountCents).toBe(7500);
    expect(result.schedule[0].dueDate).toBe('2026-11-07');
  });
});

