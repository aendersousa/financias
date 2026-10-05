import { describe, expect, it } from 'vitest';
import { calculateFreeToSpend, essentialQuotaCents, type FreeToSpendInput, type ForecastCommitment } from './freeToSpend';

const base = (): FreeToSpendInput => ({ today: '2026-10-12', fallbackCycleDay: 5, cashBalanceCents: 560000, safetyReserveCents: 30000, commitments: [], statements: [], people: [], reserves: [], scheduled: [], essentialNeedCents: 30000 });
const commitment = (id: string, amount: number, date: string, direction: 'inflow' | 'outflow' = 'outflow'): ForecastCommitment => ({ id, direction, certainty: 'confirmed', dueCents: amount, paidCents: 0, effectiveDueOn: date, paymentLiquidity: 'cash' });

describe('Official free-to-spend model', () => {
  it('excludes settled estimates even when history exceeds the actual payment', () => {
    const input = base();
    input.commitments = [{ ...commitment('settled-energy',20000,'2026-10-20'),paidCents:20000,certainty:'estimated',actualHistoryCents:[30000,40000,50000] }];
    expect(calculateFreeToSpend(input).conservative.committedCents).toBe(0);
  });
  it('does not use a benefit payment as the next cash income cycle', () => {
    const input = base();
    input.commitments = [{ ...commitment('benefit',50000,'2026-10-15','inflow'),paymentLiquidity:'benefit',mainIncome:true }];
    expect(calculateFreeToSpend(input).horizonEnd).toBe('2026-11-05');
  });
  it('CT-LFG-001 reference produces 230 conservatively and 1030 expected', () => {
    const input = base();
    input.commitments = [commitment('rent',150000,'2026-10-20'),commitment('energy',22000,'2026-10-13'),commitment('internet',11000,'2026-10-22'),{ ...commitment('freelance',80000,'2026-10-28','inflow'),certainty:'conditional' }];
    input.statements = [{ id:'closed',status:'closed',effectiveDueOn:'2026-10-15',remainingIncludingScheduledCents:130000 },{ id:'open',status:'open',effectiveDueOn:'2026-11-16',remainingIncludingScheduledCents:64000 }];
    input.reserves = [{ id:'travel',holdingMode:'virtual',active:true,balanceCents:60000 },{ id:'ipva',holdingMode:'virtual',active:true,balanceCents:40000 }];
    const result = calculateFreeToSpend(input);
    expect(result.horizonEnd).toBe('2026-11-05');
    expect(result.conservative.valueCents).toBe(23000);
    expect(result.expected.valueCents).toBe(103000);
  });
  it('CT-LFG-004 closes the horizon before next main income', () => {
    const input = { ...base(),today:'2026-10-02',cashBalanceCents:200000,safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('salary',500000,'2026-10-30','inflow'),mainIncome:true },commitment('internet',12000,'2026-10-15'),commitment('rent',150000,'2026-11-05')] };
    expect(calculateFreeToSpend(input).conservative.valueCents).toBe(188000);
  });
  it('CT-LFG-010 uses actual historical extrema without comparing income to estimate', () => {
    const input = { ...base(),today:'2026-10-02',cashBalanceCents:400000,safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('next-salary',500000,'2026-11-05','inflow'),mainIncome:true },commitment('rent',150000,'2026-10-13'),{ ...commitment('energy',20000,'2026-10-20'),certainty:'estimated' as const,actualHistoryCents:[33000,36000,39000] },
        { ...commitment('commission',120000,'2026-10-20','inflow'),certainty:'estimated' as const,actualHistoryCents:[90000,100000,140000] },{ ...commitment('freelance',80000,'2026-10-26','inflow'),certainty:'conditional' as const }],
      people:[{ id:'João',balanceCents:40000,openReminderDates:['2026-10-15'] }] };
    const result = calculateFreeToSpend(input);
    expect(result.conservative.valueCents).toBe(304000);
    expect(result.expected.valueCents).toBe(470000);
  });
  it('CT-GOAL-002 counts a linked provision once, with uncovered difference', () => {
    const input = { ...base(),cashBalanceCents:300000,safetyReserveCents:0,essentialNeedCents:0,
      reserves:[{ id:'ipva',holdingMode:'virtual' as const,active:true,balanceCents:180000 }], commitments:[{ ...commitment('ipva-bill',240000,'2026-10-20'),reserveId:'ipva' }] };
    const result = calculateFreeToSpend(input).conservative;
    expect(result.reservedCents).toBe(180000);
    expect(result.uncoveredReserveCents).toBe(60000);
    expect(result.valueCents).toBe(60000);
  });
  it('keeps negative results and counts full open statement beyond horizon', () => {
    const result = calculateFreeToSpend({ ...base(),cashBalanceCents:0,essentialNeedCents:0,safetyReserveCents:0,statements:[{ id:'open',status:'open',effectiveDueOn:'2027-01-01',remainingIncludingScheduledCents:50000 }] });
    expect(result.conservative.valueCents).toBe(-50000);
  });
  it('does not double count scheduled settlement with a cleared commitment', () => {
    const input = { ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,commitments:[{ ...commitment('bill',50000,'2026-10-20'),paidCents:50000 }], scheduled:[{ id:'payment',occurredOn:'2026-10-20',netCashCents:-50000 }] };
    expect(calculateFreeToSpend(input).conservative.valueCents).toBe(50000);
  });
  it('essential quota subtracts today spending after ceiling proration', () => {
    expect(essentialQuotaCents(90000,52000,0,0,20,20)).toBe(38000);
    expect(essentialQuotaCents(90000,0,0,0,4,30)).toBe(12000);
    expect(essentialQuotaCents(90000,0,0,10000,4,30)).toBe(2000);
  });
});
