import { describe, expect, it } from 'vitest';
import { addBankingDays, bankingHolidays, effectiveDueDate, todayInSpace } from './calendar';

describe('D-031 banking calendar', () => {
  it.each([
    ['2026-10-10', '2026-10-13'], ['2027-01-10', '2027-01-11'],
    ['2027-02-09', '2027-02-10'], ['2026-11-20', '2026-11-23'], ['2027-02-28', '2027-03-01']
  ])('CT-CARD-009: %s adjusts to %s', (nominal, effective) => {
    expect(effectiveDueDate(nominal)).toBe(effective);
  });
  it('moves income to the previous banking day when configured', () => {
    expect(effectiveDueDate('2026-11-01', 'previous')).toBe('2026-10-30');
  });
  it('CT-CARD-002: releases boleto hold after three banking days', () => {
    expect(addBankingDays('2026-10-09', 3)).toBe('2026-10-15');
  });
  it('generates exactly the specified global holidays and accepts local holidays', () => {
    expect(bankingHolidays(2026)).toHaveLength(12);
    expect(bankingHolidays(2026).map((holiday) => holiday.date)).toContain('2026-02-16');
    expect(effectiveDueDate('2026-10-13', 'next', [{ date: '2026-10-13', kind: 'local', name: 'Local' }])).toBe('2026-10-14');
  });
  it('uses the financial space date rather than UTC date', () => {
    expect(todayInSpace('America/Sao_Paulo', new Date('2026-10-06T01:00:00Z'))).toBe('2026-10-05');
  });
  it('rejects impossible dates', () => {
    expect(() => effectiveDueDate('2026-02-30')).toThrow();
  });
});
