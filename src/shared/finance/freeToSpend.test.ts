import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
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
  it('CT-LFG-010 preserves the reference scenario using the lower historical income', () => {
    const input = { ...base(),today:'2026-10-02',cashBalanceCents:400000,safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('next-salary',500000,'2026-11-05','inflow'),mainIncome:true },commitment('rent',150000,'2026-10-13'),{ ...commitment('energy',20000,'2026-10-20'),certainty:'estimated' as const,actualHistoryCents:[33000,36000,39000] },
        { ...commitment('commission',120000,'2026-10-20','inflow'),certainty:'estimated' as const,actualHistoryCents:[90000,100000,140000] },{ ...commitment('freelance',80000,'2026-10-26','inflow'),certainty:'conditional' as const }],
      people:[{ id:'João',balanceCents:40000,openReminderDates:['2026-10-15'] }] };
    const result = calculateFreeToSpend(input);
    expect(result.conservative.valueCents).toBe(304000);
    expect(result.expected.valueCents).toBe(470000);
  });
  it.each([0,70000])('caps conservative estimated income when history exceeds the forecast, with %i cents already paid', (paidCents) => {
    const input = { ...base(),cashBalanceCents:400000,safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('commission',120000,'2026-10-20','inflow'),paidCents,certainty:'estimated' as const,actualHistoryCents:[150000,160000,170000] }] };
    const result = calculateFreeToSpend(input);
    expect(result.conservative.expectedInflowsCents).toBe(120000-paidCents);
    expect(result.expected.expectedInflowsCents).toBe(120000-paidCents);
    expect(result.conservative.valueCents).toBe(520000-paidCents);
    expect(result.expected.valueCents).toBe(result.conservative.valueCents);
  });
  it('uses the current estimated income when no actual history is available', () => {
    const input = { ...base(),safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('commission',120000,'2026-10-20','inflow'),certainty:'estimated' as const }] };
    const result = calculateFreeToSpend(input);
    expect(result.conservative.expectedInflowsCents).toBe(120000);
    expect(result.expected.expectedInflowsCents).toBe(120000);
  });
  it('uses only the three most recent actual income values', () => {
    const input = { ...base(),safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('commission',120000,'2026-10-20','inflow'),certainty:'estimated' as const,actualHistoryCents:[110000,100000,115000,1000] }] };
    expect(calculateFreeToSpend(input).conservative.expectedInflowsCents).toBe(100000);
  });
  it('keeps expected income at least as high as conservative income across estimates, histories and partial settlements', () => {
    fc.assert(fc.property(fc.integer({min:1,max:1_000_000_000}),fc.array(fc.integer({min:1,max:1_000_000_000}),{minLength:1,maxLength:5}),fc.integer({min:0,max:1_000_000_000}),(dueCents,history,paid) => {
      const paidCents=Math.min(paid,dueCents);
      const result=calculateFreeToSpend({ ...base(),cashBalanceCents:0,safetyReserveCents:0,essentialNeedCents:0,
        commitments:[{ ...commitment('commission',dueCents,'2026-10-20','inflow'),paidCents,certainty:'estimated',actualHistoryCents:history }] });
      expect(result.conservative.expectedInflowsCents).toBeGreaterThanOrEqual(0);
      expect(result.conservative.expectedInflowsCents).toBeLessThanOrEqual(dueCents-paidCents);
      expect(result.expected.valueCents).toBeGreaterThanOrEqual(result.conservative.valueCents);
    }));
  });
  it('CT-GOAL-002 counts a linked provision once, with uncovered difference', () => {
    const input = { ...base(),cashBalanceCents:300000,safetyReserveCents:0,essentialNeedCents:0,
      reserves:[{ id:'ipva',holdingMode:'virtual' as const,active:true,balanceCents:180000 }], commitments:[{ ...commitment('ipva-bill',240000,'2026-10-20'),reserveId:'ipva' }] };
    const result = calculateFreeToSpend(input).conservative;
    expect(result.reservedCents).toBe(180000);
    expect(result.uncoveredReserveCents).toBe(60000);
    expect(result.valueCents).toBe(60000);
    expect(result.items.find((item) => item.id === 'ipva-bill')).toMatchObject({ amountCents:-60000,consideredCents:240000,coveredCents:180000,reserveId:'ipva' });
  });
  it('keeps negative results and counts full open statement beyond horizon', () => {
    const result = calculateFreeToSpend({ ...base(),cashBalanceCents:0,essentialNeedCents:0,safetyReserveCents:0,statements:[{ id:'open',status:'open',effectiveDueOn:'2027-01-01',remainingIncludingScheduledCents:50000 }] });
    expect(result.conservative.valueCents).toBe(-50000);
  });
  it('does not double count scheduled settlement with a cleared commitment', () => {
    const input = { ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,commitments:[{ ...commitment('bill',50000,'2026-10-20'),paidCents:50000 }], scheduled:[{ id:'payment',occurredOn:'2026-10-20',netCashCents:-50000 }] };
    expect(calculateFreeToSpend(input).conservative.valueCents).toBe(50000);
  });
  it('counts a partially settled commitment and its scheduled payment once in total', () => {
    const input = { ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('bill',50000,'2026-10-20'),paidCents:20000 }],scheduled:[{ id:'partial-payment',occurredOn:'2026-10-20',netCashCents:-20000 }] };
    const result=calculateFreeToSpend(input);
    expect(result.conservative.committedCents).toBe(50000);
    expect(result.conservative.valueCents).toBe(50000);
  });
  it('counts a settled future income through its scheduled cash receipt only', () => {
    const input = { ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,
      commitments:[{ ...commitment('commission',120000,'2026-10-20','inflow'),paidCents:120000,certainty:'estimated' as const,actualHistoryCents:[150000,160000,170000] }],scheduled:[{ id:'income-receipt',occurredOn:'2026-10-20',netCashCents:120000 }] };
    const result=calculateFreeToSpend(input);
    expect(result.conservative.expectedInflowsCents).toBe(120000);
    expect(result.expected.expectedInflowsCents).toBe(120000);
    expect(result.conservative.valueCents).toBe(220000);
  });
  it('counts a card statement net of scheduled payment plus the scheduled cash payment once', () => {
    const input = { ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,
      statements:[{id:'statement',status:'open' as const,effectiveDueOn:'2026-11-10',remainingIncludingScheduledCents:30000}],scheduled:[{id:'card-payment',occurredOn:'2026-10-20',netCashCents:-20000}] };
    expect(calculateFreeToSpend(input).conservative.committedCents).toBe(50000);
  });
  it('covers a future counted card installment with its unconsumed reserve once', () => {
    const result=calculateFreeToSpend({ ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,
      reserves:[{id:'travel',holdingMode:'virtual',active:true,balanceCents:50000}],
      statements:[{id:'future',status:'future',effectiveDueOn:'2026-10-30',remainingIncludingScheduledCents:50000,reservedUnconsumed:[{reserveId:'travel',amountCents:50000,occurredOn:'2026-10-20'}]}] }).conservative;
    expect(result.reservedCents).toBe(50000);
    expect(result.committedCents).toBe(0);
    expect(result.valueCents).toBe(50000);
    expect(result.items.find((item)=>item.group==='card_reserve')).toMatchObject({amountCents:0,coveredCents:50000});
  });
  it('allocates the same reserve chronologically across Agenda, future card and scheduled expenses', () => {
    const result=calculateFreeToSpend({ ...base(),cashBalanceCents:200000,safetyReserveCents:0,essentialNeedCents:0,
      reserves:[{id:'travel',holdingMode:'virtual',active:true,balanceCents:80000}],
      commitments:[{...commitment('latest-bill',50000,'2026-11-01'),reserveId:'travel'}],
      scheduled:[{id:'early-payment',occurredOn:'2026-10-20',netCashCents:-50000,reservedOutflows:[{reserveId:'travel',amountCents:50000}]}],
      statements:[{id:'future',status:'future',effectiveDueOn:'2026-10-30',remainingIncludingScheduledCents:50000,reservedUnconsumed:[{reserveId:'travel',amountCents:50000,occurredOn:'2026-10-25'}]}] }).conservative;
    expect(result.uncoveredReserveCents).toBe(70000);
    expect(result.valueCents).toBe(50000);
    expect(result.items.find((item)=>item.id==='early-payment:travel')?.coveredCents).toBe(50000);
    expect(result.items.find((item)=>item.id==='future:travel')?.coveredCents).toBe(30000);
    expect(result.items.find((item)=>item.id==='latest-bill')?.coveredCents).toBe(0);
    expect(result.items.reduce((sum,item)=>sum+item.amountCents,0)).toBe(-result.committedCents);
  });
  it('does not cover installments already consumed or linked to an investment goal', () => {
    const result=calculateFreeToSpend({ ...base(),cashBalanceCents:100000,safetyReserveCents:0,essentialNeedCents:0,
      reserves:[{id:'investment-goal',holdingMode:'account',active:true,balanceCents:50000}],
      statements:[{id:'open',status:'open',effectiveDueOn:'2026-12-01',remainingIncludingScheduledCents:50000,reservedUnconsumed:[{reserveId:'investment-goal',amountCents:20000}]}] }).conservative;
    expect(result.reservedCents).toBe(0);
    expect(result.committedCents).toBe(50000);
  });
  it('essential quota subtracts today spending after ceiling proration', () => {
    expect(essentialQuotaCents(90000,52000,0,0,20,20)).toBe(38000);
    expect(essentialQuotaCents(90000,0,0,0,4,30)).toBe(12000);
    expect(essentialQuotaCents(90000,0,0,10000,4,30)).toBe(2000);
  });
});
