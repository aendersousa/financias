import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateCents, divideCents, formatBrlCents, parseBrlCents, splitInstallments, sumCents } from './money';

describe('Integer money', () => {
  it('parses BRL without multiplying floating point values', () => {
    expect(parseBrlCents('R$ 1.234,56')).toBe(123456);
    expect(parseBrlCents('0,29')).toBe(29);
    expect(parseBrlCents('-0,01')).toBe(-1);
    expect(parseBrlCents('12,5')).toBe(1250);
  });
  it('rejects ambiguous, fractional and unsafe input', () => {
    for (const value of ['1.23', '1,234', '1e3', '', 'NaN', '1.0000,00', '90071992547410,00']) {
      expect(() => parseBrlCents(value)).toThrow();
    }
  });
  it('preserves cents in display and parsing', () => {
    fc.assert(fc.property(fc.integer({ min: -1000000000, max: 1000000000 }), (amount) => {
      const formatted = formatBrlCents(amount);
      expect(parseBrlCents(formatted.replace('R$ ', ''))).toBe(amount);
    }));
  });
  it('assigns installment remainder ties in the configured order', () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(10001, 3, 'last')).toEqual([3333, 3334, 3334]);
  });
  it('matches CT-AGENDA-007 weighted and signed cases', () => {
    expect(allocateCents(20000, [1, 1, 1])).toEqual([6667, 6667, 6666]);
    expect(allocateCents(10000, [1, 2])).toEqual([3333, 6667]);
    expect(allocateCents(100001, [60, 40])).toEqual([60001, 40000]);
    expect(allocateCents(-30000, Array(8).fill(1))).toEqual(Array(8).fill(-3750));
    expect(allocateCents(100, [3, -1])).toEqual([150, -50]);
    expect(allocateCents(101, [1, 0, 1])).toEqual([51, 0, 50]);
  });
  it('preserves the purchased amount across installments', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 120 }), fc.integer({ min: 120, max: 100000000 }), (count, amount) => {
      const parts = splitInstallments(amount, count);
      expect(sumCents(parts)).toBe(amount);
      expect(parts.every((part) => Number.isSafeInteger(part) && part > 0)).toBe(true);
    }));
  });
  it('shares cents fairly without losing value', () => {
    fc.assert(fc.property(fc.integer({ min: -100000000, max: 100000000 }), fc.integer({ min: 1, max: 50 }), (amount, count) => {
      const parts = divideCents(amount, count);
      expect(sumCents(parts)).toBe(amount);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    }));
  });
  it('sums safely at the number boundary', () => {
    expect(sumCents([Number.MAX_SAFE_INTEGER, 1, -1])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
});
