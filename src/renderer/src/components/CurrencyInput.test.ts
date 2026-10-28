import { describe, it, expect } from 'vitest';
import {
  cleanCurrencyInput,
  formatCurrencyString,
  parseCurrencyToNumber,
  parseCurrencyToCents,
  parseCurrencyParts
} from './CurrencyInput';
import { parseBrlCents } from '../../../shared/finance/money';

describe('CurrencyInput logic', () => {
  it('cleans leading zeros and pasted R$ symbols correctly', () => {
    expect(cleanCurrencyInput('01870')).toBe('1870');
    expect(cleanCurrencyInput('007')).toBe('7');
    expect(cleanCurrencyInput('R$ 1.870,50')).toBe('1.870,50');
    expect(cleanCurrencyInput('R$1870')).toBe('1870');
    expect(cleanCurrencyInput('0')).toBe('0');
    expect(cleanCurrencyInput('0,50')).toBe('0,50');
    expect(cleanCurrencyInput('0.50')).toBe('0.50');
    expect(cleanCurrencyInput('abc123xyz')).toBe('123');
  });

  it('correctly parses currency parts', () => {
    expect(parseCurrencyParts('01870')).toEqual({ isNegative: false, integer: '1870', fraction: '00' });
    expect(parseCurrencyParts('1870')).toEqual({ isNegative: false, integer: '1870', fraction: '00' });
    expect(parseCurrencyParts('1870,5')).toEqual({ isNegative: false, integer: '1870', fraction: '50' });
    expect(parseCurrencyParts('1.870,50')).toEqual({ isNegative: false, integer: '1870', fraction: '50' });
    expect(parseCurrencyParts('1870.50')).toEqual({ isNegative: false, integer: '1870', fraction: '50' });
    expect(parseCurrencyParts('0')).toEqual({ isNegative: false, integer: '0', fraction: '00' });
    expect(parseCurrencyParts('-250,75')).toEqual({ isNegative: true, integer: '250', fraction: '75' });
  });

  it('formats to standard BRL currency string', () => {
    expect(formatCurrencyString('01870')).toBe('1.870,00');
    expect(formatCurrencyString('1870')).toBe('1.870,00');
    expect(formatCurrencyString('1870,5')).toBe('1.870,50');
    expect(formatCurrencyString('1.870,00')).toBe('1.870,00');
    expect(formatCurrencyString('0')).toBe('0,00');
    expect(formatCurrencyString('0,50')).toBe('0,50');
    expect(formatCurrencyString('0.99')).toBe('0,99');
    expect(formatCurrencyString(1870)).toBe('1.870,00');
    expect(formatCurrencyString(1870.5)).toBe('1.870,50');
    expect(formatCurrencyString('-500,00', true)).toBe('-500,00');
    expect(formatCurrencyString('')).toBe('');
  });

  it('is fully compatible with parseBrlCents', () => {
    const formatted1 = formatCurrencyString('01870');
    expect(parseBrlCents(formatted1)).toBe(187000);

    const formatted2 = formatCurrencyString('1870,5');
    expect(parseBrlCents(formatted2)).toBe(187050);

    const formatted3 = formatCurrencyString('0');
    expect(parseBrlCents(formatted3)).toBe(0);

    const formatted4 = formatCurrencyString('1.234.567,89');
    expect(parseBrlCents(formatted4)).toBe(123456789);
  });

  it('converts to numeric float accurately', () => {
    expect(parseCurrencyToNumber('01870')).toBe(1870);
    expect(parseCurrencyToNumber('1.870,50')).toBe(1870.5);
    expect(parseCurrencyToNumber('1870,50')).toBe(1870.5);
    expect(parseCurrencyToNumber('0')).toBe(0);
    expect(parseCurrencyToNumber(2500)).toBe(2500);
    expect(parseCurrencyToNumber('-150,25')).toBe(-150.25);
  });

  it('converts to integer cents accurately', () => {
    expect(parseCurrencyToCents('01870')).toBe(187000);
    expect(parseCurrencyToCents('1.870,50')).toBe(187050);
    expect(parseCurrencyToCents('0')).toBe(0);
    expect(parseCurrencyToCents(1870.5)).toBe(187050);
  });
});

