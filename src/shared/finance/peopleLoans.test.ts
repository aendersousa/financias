import { describe, expect, it } from 'vitest';
import { addMonthsClamped, calculateNextMonthlyDueDate, calculatePeopleLoan, getPersonLoanDates, getPersonLoanTerms } from './peopleLoans';

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

  it('calculates next monthly due date correctly based on loan start day', () => {
    // Started on 11th of August, today is 7th of October -> next due date is 11th of October
    expect(calculateNextMonthlyDueDate('2026-08-11', '2026-10-07')).toBe('2026-10-11');
    // If today is past the 11th (e.g. 15th of October) -> next due date is 11th of November
    expect(calculateNextMonthlyDueDate('2026-08-11', '2026-10-15')).toBe('2026-11-11');
    // If loan starts today -> next due date is next month
    expect(calculateNextMonthlyDueDate('2026-10-07', '2026-10-07')).toBe('2026-11-07');
  });

  it('calculates Regina scenario: borrowed 1500 on 11/08/2026, today 07/10/2026 at 5% monthly gives 2 months and due date 11/10/2026', () => {
    const result = calculatePeopleLoan({
      principalInput: '1500,00',
      interestType: 'percent',
      interestRate: '5',
      interestFixedInput: '',
      interestPeriod: 'monthly',
      payMode: 'indefinite',
      startDate: '2026-08-11',
      firstDueDate: '', // empty to let it calculate automatically
      today: '2026-10-07'
    });

    expect(result.principalCents).toBe(150000);
    expect(result.isIndefinite).toBe(true);
    expect(result.elapsedMonths).toBe(2); // August to October = 2 months
    expect(result.monthlyInterestCents).toBe(7500); // 5% of 1500 = 75
    expect(result.interestCents).toBe(15000); // 2 * 75 = 150
    expect(result.totalCents).toBe(165000); // 1500 + 150 = 1650
    expect(result.nextDueDate).toBe('2026-10-11');
    expect(result.schedule[0].dueDate).toBe('2026-10-11');
  });

  it('allows overriding elapsed months with customElapsedMonths', () => {
    const result = calculatePeopleLoan({
      principalInput: '1500,00',
      interestType: 'percent',
      interestRate: '5',
      interestFixedInput: '',
      interestPeriod: 'monthly',
      payMode: 'indefinite',
      startDate: '2026-08-11',
      firstDueDate: '2026-10-11',
      today: '2026-10-07',
      customElapsedMonths: 1
    });

    expect(result.elapsedMonths).toBe(1);
    expect(result.interestCents).toBe(7500); // 1 * 75 = 75
    expect(result.totalCents).toBe(157500);
  });

  it('extracts loan start date and next payment date from opening_on and reminders', () => {
    const dates = getPersonLoanDates({
      opening_on: '2026-08-11',
      balance_cents: 150000,
      reminders: [
        { id: 'rem-1', title: 'Cobrar juros', due_on: '2026-10-11', completed_at: null }
      ]
    }, '2026-10-07');

    expect(dates.startDate).toBe('2026-08-11');
    expect(dates.nextDueDate).toBe('2026-10-11');
    expect(dates.isOverdue).toBe(false);
    expect(dates.isToday).toBe(false);
  });

  it('extracts loan dates from notes when no reminders are present', () => {
    const dates = getPersonLoanDates({
      opening_on: null,
      notes: '📌 [Empréstimo iniciado em 15/09/2026] Emprestado para João: Principal R$ 300,00 | próximo vencimento em 15/10/2026',
      balance_cents: 30000
    }, '2026-10-07');

    expect(dates.startDate).toBe('2026-09-15');
    expect(dates.nextDueDate).toBe('2026-10-15');
  });

  it('calculates next monthly due date automatically if active balance has start date but no reminders', () => {
    const dates = getPersonLoanDates({
      opening_on: '2026-08-11',
      balance_cents: 150000,
      reminders: []
    }, '2026-10-07');

    expect(dates.startDate).toBe('2026-08-11');
    expect(dates.nextDueDate).toBe('2026-10-11');
  });

  it('calculates interestType none with empty fixed input cleanly without throwing', () => {
    const result = calculatePeopleLoan({
      principalInput: '240,00',
      interestType: 'none',
      interestRate: '5',
      interestFixedInput: '',
      interestPeriod: 'monthly',
      installmentsCount: 2,
      frequency: 'monthly',
      payMode: 'installments',
      startDate: '2026-09-07',
      firstDueDate: '2026-11-07',
      today: '2026-10-07'
    });

    expect(result.principalCents).toBe(24000);
    expect(result.interestCents).toBe(0);
    expect(result.totalCents).toBe(24000);
    expect(result.count).toBe(2);
    expect(result.schedule).toHaveLength(2);
    expect(result.schedule[0].amountCents).toBe(12000);
    expect(result.schedule[0].dueDate).toBe('2026-11-07');
    expect(result.schedule[1].amountCents).toBe(12000);
    expect(result.schedule[1].dueDate).toBe('2026-12-07');
  });

  it('extracts installment terms from reminders with Parcela X/Y', () => {
    const terms = getPersonLoanTerms({
      opening_on: '2026-10-07',
      balance_cents: 30000,
      reminders: [
        { id: '1', title: 'Cobrar João: Parcela 1/3 (R$ 100,00)', due_on: '2026-11-07', completed_at: null },
        { id: '2', title: 'Cobrar João: Parcela 2/3 (R$ 100,00)', due_on: '2026-12-07', completed_at: null },
        { id: '3', title: 'Cobrar João: Parcela 3/3 (R$ 100,00)', due_on: '2027-01-07', completed_at: null }
      ]
    }, '2026-10-07');

    expect(terms.totalInstallments).toBe(3);
    expect(terms.currentInstallment).toBe(1);
    expect(terms.remainingInstallments).toBe(3);
    expect(terms.installmentAmountCents).toBe(10000);
    expect(terms.installmentsBadge).toBe('3x');
    expect(terms.installmentsText).toBe('3x de R$ 100,00');
    expect(terms.installmentDetail).toBe('~R$ 100,00 /mês');
  });

  it('tracks progress when installments are partially completed in reminders', () => {
    const terms = getPersonLoanTerms({
      opening_on: '2026-10-07',
      balance_cents: 20000,
      reminders: [
        { id: '1', title: 'Cobrar João: Parcela 1/3 (R$ 100,00)', due_on: '2026-11-07', completed_at: '2026-11-07T12:00:00Z' },
        { id: '2', title: 'Cobrar João: Parcela 2/3 (R$ 100,00)', due_on: '2026-12-07', completed_at: null },
        { id: '3', title: 'Cobrar João: Parcela 3/3 (R$ 100,00)', due_on: '2027-01-07', completed_at: null }
      ]
    }, '2026-11-10');

    expect(terms.totalInstallments).toBe(3);
    expect(terms.currentInstallment).toBe(2);
    expect(terms.remainingInstallments).toBe(2);
    expect(terms.installmentsBadge).toBe('3x');
    expect(terms.installmentDetail).toBe('Parcela 2 de 3');
  });

  it('extracts installment terms from notes when no reminders are present', () => {
    const terms = getPersonLoanTerms({
      opening_on: '2026-09-07',
      balance_cents: 24000,
      notes: '📌 [Empréstimo em 07/09/2026] Emprestado para Madu: Principal R$ 240,00 | Devolução em 2 meses (2 parcelas mensais de ~R$ 120,00 (total R$ 240,00)).'
    }, '2026-10-07');

    expect(terms.totalInstallments).toBe(2);
    expect(terms.installmentsBadge).toBe('2x');
    expect(terms.installmentsText).toBe('2x de R$ 120,00');
    expect(terms.installmentDetail).toBe('~R$ 120,00 /mês');
  });

  it('identifies indefinite agreement from notes', () => {
    const terms = getPersonLoanTerms({
      opening_on: '2026-08-11',
      balance_cents: 150000,
      notes: '📌 [Empréstimo por Prazo Indefinido iniciado em 11/08/2026] Emprestado para Regina: Principal R$ 1.500,00 | prazo indefinido (sem data final), juro de 5% /mês correndo todo mês com próximo vencimento em 11/10/2026.'
    }, '2026-10-07');

    expect(terms.payMode).toBe('indefinite');
    expect(terms.installmentsBadge).toBe('Indefinido');
    expect(terms.installmentsText).toBe('Prazo indefinido');
    expect(terms.installmentDetail).toBe('Juros mensais');
  });

  it('identifies single payment from notes', () => {
    const terms = getPersonLoanTerms({
      opening_on: '2026-10-01',
      balance_cents: 100000,
      notes: '📌 [Empréstimo em 01/10/2026] Emprestado para Tatiele: Principal R$ 1.000,00 | Devolução em 1 mês (pagamento único de R$ 1.000,00 em 01/11/2026).'
    }, '2026-10-07');

    expect(terms.payMode).toBe('single');
    expect(terms.totalInstallments).toBe(1);
    expect(terms.installmentsBadge).toBe('1x');
    expect(terms.installmentsText).toBe('1x (à vista)');
    expect(terms.installmentDetail).toBe('Pagamento único');
  });

  it('infers installment amount from total balance when count is in notes without explicit amount', () => {
    const terms = getPersonLoanTerms({
      opening_on: '2026-10-07',
      balance_cents: 150000,
      notes: 'Combinado em 3 parcelas mensais.'
    }, '2026-10-07');

    expect(terms.totalInstallments).toBe(3);
    expect(terms.installmentAmountCents).toBe(50000);
    expect(terms.installmentsBadge).toBe('3x');
    expect(terms.installmentsText).toBe('3x de R$ 500,00');
  });
});


