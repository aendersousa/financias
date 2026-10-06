import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { automaticContributionOn, provisionContributionCapacity, reserveContributionSchedule, suggestReserveContribution } from './reserveSchedule';

const salary = (day: number) => ({ kind: 'recurrence' as const, frequency: 'monthly' as const, anchorOn: `2026-09-${String(day).padStart(2, '0')}` });
const januaryTarget = [{ dueOn: '2027-01-15', remainingCents: 240_000 }];

describe('CT-GOAL-003: provision contribution dates', () => {
  it.each([
    [5, '2026-10-02', false, ['2026-10-05', '2026-11-05', '2026-12-07', '2027-01-05']],
    [5, '2026-10-20', true, ['2026-10-20', '2026-11-05', '2026-12-07', '2027-01-05']],
    [30, '2026-10-02', true, ['2026-10-02', '2026-10-30', '2026-11-30', '2026-12-30']]
  ])('income day %i, created %s: immediate %s', (day, createdOn, immediate, dates) => {
    const result = reserveContributionSchedule({ createdOn, targetOn: '2027-01-15', mainIncome: salary(day) });
    expect(result.dates).toEqual(dates);
    expect(result.immediate).toBe(immediate);
    expect(suggestReserveContribution({ asOf: createdOn, reservedCents: 0, contributionDates: result.dates, targets: januaryTarget }).suggestedCents).toBe(60_000);
  });

  it('uses the effective September 8 income to identify the 27-day cycle', () => {
    const result = reserveContributionSchedule({ createdOn: '2026-10-02', targetOn: '2027-01-15', mainIncome: salary(5) });
    expect(result.cycle).toEqual({ lastOn: '2026-09-08', nextOn: '2026-10-05', durationDays: 27, elapsedDays: 24 });
  });

  it('includes the halfway day and excludes the following day', () => {
    expect(reserveContributionSchedule({ createdOn: '2026-10-20', targetOn: '2027-01-15', mainIncome: salary(5) }).immediate).toBe(true);
    expect(reserveContributionSchedule({ createdOn: '2026-10-21', targetOn: '2027-01-15', mainIncome: salary(5) }).dates).toEqual(['2026-11-05', '2026-12-07', '2027-01-05']);
  });

  it('counts creation on an income date once and excludes the due date itself', () => {
    const result = reserveContributionSchedule({ createdOn: '2026-10-05', targetOn: '2027-01-05', mainIncome: salary(5) });
    expect(result.dates).toEqual(['2026-10-05', '2026-11-05', '2026-12-07']);
    expect(result.immediate).toBe(true);
  });

  it('uses calendar day 1 when there is no main income, without banking adjustments', () => {
    const result = reserveContributionSchedule({ createdOn: '2026-10-02', targetOn: '2027-01-15' });
    expect(result.dates).toEqual(['2026-10-02', '2026-11-01', '2026-12-01', '2027-01-01']);
    expect(result.cycle).toEqual({ lastOn: '2026-10-01', nextOn: '2026-11-01', durationDays: 31, elapsedDays: 1 });
  });

  it('uses the chosen fallback cycle day and clamps it in short months', () => {
    expect(reserveContributionSchedule({ createdOn: '2027-02-20', targetOn: '2027-04-01', fallbackCycleDay: 31 }).dates).toEqual(['2027-02-28', '2027-03-31']);
  });

  it('respects an income configured for the previous banking day and local holidays', () => {
    const result = reserveContributionSchedule({
      createdOn: '2026-10-20', targetOn: '2027-01-05',
      mainIncome: { ...salary(1), businessDayAdjustment: 'previous' },
      localHolidays: [{ date: '2026-10-30', name: 'Local', kind: 'local' }]
    });
    expect(result.dates).toEqual(['2026-10-29', '2026-12-01', '2026-12-31']);
  });

  it('aligns weekly income by weekday and interval phase', () => {
    const result = reserveContributionSchedule({ createdOn: '2026-10-07', targetOn: '2026-11-01', mainIncome: { kind: 'recurrence', frequency: 'weekly', interval: 2, anchorOn: '2026-10-02' } });
    expect(result.cycle).toEqual({ lastOn: '2026-10-02', nextOn: '2026-10-16', durationDays: 14, elapsedDays: 5 });
    expect(result.dates).toEqual(['2026-10-07', '2026-10-16', '2026-10-30']);
  });

  it('keeps a monthly day-31 anchor after February and aligns yearly leap-day income', () => {
    expect(reserveContributionSchedule({ createdOn: '2027-02-20', targetOn: '2027-04-05', mainIncome: { kind: 'recurrence', frequency: 'monthly', anchorOn: '2027-01-31' } }).dates).toEqual(['2027-03-01', '2027-03-31']);
    // February 29, 2028 is Carnival Tuesday, so that year's effective date is March 1.
    expect(reserveContributionSchedule({ createdOn: '2027-02-20', targetOn: '2029-01-01', mainIncome: { kind: 'recurrence', frequency: 'yearly', anchorOn: '2024-02-29' } }).dates).toEqual(['2027-03-01', '2028-03-01']);
  });

  it('uses Agenda effective overrides directly and deduplicates coincident dates', () => {
    const result = reserveContributionSchedule({ createdOn: '2026-10-20', targetOn: '2027-01-15', mainIncome: { kind: 'occurrences', effectiveDates: ['2027-02-05', '2026-12-09', '2026-10-05', '2026-11-05', '2026-11-05', '2027-01-05'] } });
    expect(result.dates).toEqual(['2026-10-20', '2026-11-05', '2026-12-09', '2027-01-05']);
  });

  it('rejects incomplete Agenda coverage instead of undercounting contributions', () => {
    expect(() => reserveContributionSchedule({ createdOn: '2026-10-20', targetOn: '2027-01-15', mainIncome: { kind: 'occurrences', effectiveDates: ['2026-10-05', '2026-11-05'] } })).toThrow('todo o prazo');
  });

  it('offers no dates when creation is already on or after the target', () => {
    expect(reserveContributionSchedule({ createdOn: '2027-01-15', targetOn: '2027-01-15', mainIncome: salary(5) }).dates).toEqual([]);
  });
});

describe('CT-GOAL-003: recalculated contribution amounts', () => {
  const dates = ['2026-10-05', '2026-11-05', '2026-12-07', '2027-01-05'];

  it('computes capacity from conservative free money plus safety and virtual goal balances', () => {
    expect(provisionContributionCapacity({ conservativeFreeCents: -15_000, safetyReserveCents: 30_000, virtualGoalBalancesCents: [20_000, 10_000] })).toBe(45_000);
    expect(provisionContributionCapacity({ conservativeFreeCents: -60_000, safetyReserveCents: 30_000, virtualGoalBalancesCents: [20_000] })).toBe(0);
    expect(() => provisionContributionCapacity({ conservativeFreeCents: 10_000, safetyReserveCents: 0, virtualGoalBalancesCents: [-1] })).toThrow();
  });

  it('recalculates after the target changes and redistributes a capacity shortfall', () => {
    const targets = [{ dueOn: '2027-01-15', remainingCents: 270_000 }];
    expect(suggestReserveContribution({ asOf: '2026-11-20', reservedCents: 120_000, contributionDates: dates, targets }).suggestedCents).toBe(75_000);
    const december = suggestReserveContribution({ asOf: '2026-12-07', reservedCents: 120_000, contributionDates: dates, targets, capacityCents: 45_000 });
    expect(december).toMatchObject({ suggestedCents: 75_000, contributionCents: 45_000, capacityShortfallCents: 30_000, behindSchedule: true });
    const january = suggestReserveContribution({ asOf: '2027-01-05', reservedCents: 165_000, contributionDates: dates, targets, capacityCents: 105_000 });
    expect(january).toMatchObject({ suggestedCents: 105_000, contributionCents: 105_000, behindSchedule: false });
    expect(120_000 + december.contributionCents! + january.contributionCents!).toBe(270_000);
  });

  it('limits negative capacity to zero and does not create negative suggestions', () => {
    expect(suggestReserveContribution({ asOf: '2026-10-05', reservedCents: 0, contributionDates: dates, targets: januaryTarget, capacityCents: -1 }).contributionCents).toBe(0);
    expect(suggestReserveContribution({ asOf: '2026-10-05', reservedCents: 250_000, contributionDates: dates, targets: januaryTarget })).toMatchObject({ suggestedCents: 0, contributionCents: 0, behindSchedule: false });
  });

  it('rounds upward to the cent and excludes a completed date from the denominator', () => {
    expect(suggestReserveContribution({ asOf: '2026-11-05', reservedCents: 40_000, contributionDates: dates, targets: [{ dueOn: '2027-01-15', remainingCents: 80_000 }] }).suggestedCents).toBe(13_334);
    expect(suggestReserveContribution({ asOf: '2026-11-05', reservedCents: 120_000, contributionDates: dates, completedContributionDates: ['2026-11-05'], targets: januaryTarget }).suggestedCents).toBe(60_000);
  });

  it('flags an underfunded provision with no remaining contribution date', () => {
    expect(suggestReserveContribution({ asOf: '2027-01-15', reservedCents: 165_000, contributionDates: dates, targets: januaryTarget })).toMatchObject({ suggestedCents: 0, contributionCents: 0, overdueCents: 75_000, behindSchedule: true });
  });

  it('has no suggested contribution for a goal without a target date', () => {
    expect(suggestReserveContribution({ asOf: '2026-10-05', reservedCents: 10_000, contributionDates: dates, targets: [] })).toMatchObject({ suggestedCents: null, contributionCents: null, behindSchedule: false });
  });

  it('guarantees all installment targets and recalculates after consuming a paid quota', () => {
    const allDates = [...dates, '2027-02-05', '2027-03-05'];
    const targets = [{ dueOn: '2027-01-15', remainingCents: 80_000 }, { dueOn: '2027-02-15', remainingCents: 80_000 }, { dueOn: '2027-03-15', remainingCents: 80_000 }];
    const initial = suggestReserveContribution({ asOf: '2026-10-05', reservedCents: 0, contributionDates: allDates, targets });
    expect(initial.suggestedCents).toBe(40_000);
    expect(initial.targets.map((target) => [target.cumulativeRemainingCents, target.remainingDates, target.suggestedCents])).toEqual([[80_000, 4, 20_000], [160_000, 5, 32_000], [240_000, 6, 40_000]]);
    expect(suggestReserveContribution({ asOf: '2026-11-05', reservedCents: 40_000, contributionDates: allDates, targets }).targets[0].suggestedCents).toBe(13_334);
    expect(suggestReserveContribution({ asOf: '2027-02-05', reservedCents: 80_000, contributionDates: allDates, targets: targets.slice(1) }).suggestedCents).toBe(40_000);
    expect(suggestReserveContribution({ asOf: '2027-03-05', reservedCents: 40_000, contributionDates: allDates, targets: targets.slice(2) }).suggestedCents).toBe(40_000);
  });

  it('flags an overdue quota while still calculating the future cumulative target', () => {
    expect(suggestReserveContribution({ asOf: '2027-02-05', reservedCents: 40_000, contributionDates: dates.concat('2027-02-05'), targets: [{ dueOn: '2027-01-15', remainingCents: 80_000 }, { dueOn: '2027-02-15', remainingCents: 80_000 }] })).toMatchObject({ overdueCents: 40_000, suggestedCents: 120_000, behindSchedule: true });
  });

  it('uses exact integer rounding throughout the safe cents range', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.integer({ min: 1, max: 100 }), (target, count) => {
      const contributionDates = Array.from({ length: count }, (_, index) => new Date(Date.UTC(2026, 0, index + 1, 12)).toISOString().slice(0, 10));
      const result = suggestReserveContribution({ asOf: '2026-01-01', reservedCents: 0, contributionDates, targets: [{ dueOn: '2027-01-01', remainingCents: target }] });
      const actual = BigInt(result.suggestedCents!);
      expect(actual * BigInt(count)).toBeGreaterThanOrEqual(BigInt(target));
      if (target > 0) expect((actual - 1n) * BigInt(count)).toBeLessThan(BigInt(target));
    }));
  });

  it('rejects fractional money, negative reserves and impossible dates', () => {
    const input = { asOf: '2026-10-05', reservedCents: 0, contributionDates: dates, targets: januaryTarget };
    expect(() => suggestReserveContribution({ ...input, reservedCents: -1 })).toThrow();
    expect(() => suggestReserveContribution({ ...input, capacityCents: 0.5 })).toThrow();
    expect(() => suggestReserveContribution({ ...input, asOf: '2026-02-30' })).toThrow();
    expect(() => suggestReserveContribution({ ...input, targets: [{ dueOn: '2027-01-15', remainingCents: -1 }] })).toThrow();
    expect(() => reserveContributionSchedule({ createdOn: '2026-10-05', targetOn: '2027-01-15', fallbackCycleDay: 0 })).toThrow();
  });
});

describe('automatic contributions wait for actual income', () => {
  it('delays a contribution until the main income is received, including future dated receipts', () => {
    const input = { scheduledOn: '2026-10-05', today: '2026-10-07', source: 'income' as const };
    expect(automaticContributionOn(input)).toBeNull();
    expect(automaticContributionOn({ ...input, incomeReceivedOn: '2026-10-08' })).toBeNull();
    expect(automaticContributionOn({ ...input, incomeReceivedOn: '2026-10-07' })).toBe('2026-10-07');
  });

  it('makes the immediate creation or fallback cycle contribution available on its date', () => {
    expect(automaticContributionOn({ scheduledOn: '2026-10-02', today: '2026-10-02', source: 'creation' })).toBe('2026-10-02');
    expect(automaticContributionOn({ scheduledOn: '2026-11-01', today: '2026-10-31', source: 'cycle' })).toBeNull();
    expect(automaticContributionOn({ scheduledOn: '2026-11-01', today: '2026-11-01', source: 'cycle' })).toBe('2026-11-01');
  });
});
