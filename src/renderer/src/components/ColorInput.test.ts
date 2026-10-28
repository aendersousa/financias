import { describe, expect, it } from 'vitest';
import { parseColorToHex, hexToRgbString } from './ColorInput';

describe('ColorInput helpers', () => {
  it('parses raw RGB separated by comma or space', () => {
    expect(parseColorToHex('130, 10, 209')).toBe('#820ad1');
    expect(parseColorToHex('130,10,209')).toBe('#820ad1');
    expect(parseColorToHex('130 10 209')).toBe('#820ad1');
    expect(parseColorToHex('  130 ,  10 ,  209  ')).toBe('#820ad1');
  });

  it('parses rgb() and rgba() function formats', () => {
    expect(parseColorToHex('rgb(130, 10, 209)')).toBe('#820ad1');
    expect(parseColorToHex('RGB(130, 10, 209)')).toBe('#820ad1');
    expect(parseColorToHex('rgba(130, 10, 209, 1)')).toBe('#820ad1');
    expect(parseColorToHex('rgba(130, 10, 209, 0.5)')).toBe('#820ad1');
  });

  it('parses labeled r/g/b formats', () => {
    expect(parseColorToHex('r: 130, g: 10, b: 209')).toBe('#820ad1');
    expect(parseColorToHex('R=130 G=10 B=209')).toBe('#820ad1');
  });

  it('parses hex formats with or without hash and 3 or 6 chars', () => {
    expect(parseColorToHex('#820ad1')).toBe('#820ad1');
    expect(parseColorToHex('820ad1')).toBe('#820ad1');
    expect(parseColorToHex('#820AD1')).toBe('#820ad1');
    expect(parseColorToHex('#fff')).toBe('#ffffff');
    expect(parseColorToHex('fff')).toBe('#ffffff');
  });

  it('returns null for invalid strings', () => {
    expect(parseColorToHex('')).toBeNull();
    expect(parseColorToHex('not a color')).toBeNull();
  });

  it('converts hex to rgb string', () => {
    expect(hexToRgbString('#820ad1')).toBe('130, 10, 209');
    expect(hexToRgbString('#ffffff')).toBe('255, 255, 255');
    expect(hexToRgbString('#000000')).toBe('0, 0, 0');
  });
});

