import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDisplayedCurrency, persistPrivacyMode, readPrivacyMode } from './privacy';
import { buildTransactionsCsv } from './download';

afterEach(() => vi.unstubAllGlobals());

describe('Privacy mode', () => {
  it('uses a fixed mask regardless of monetary magnitude or sign', () => {
    for (const amount of [0, 1, -500, 99999999]) {
      expect(formatDisplayedCurrency(amount, true)).toBe('R$ ••••');
    }
  });
  it('keeps exports complete while on-screen values are hidden', () => {
    const record = { data: '2026-10-05', descricao: 'Salário', conta_nome: 'Banco', categoria_nome: 'Renda', cartao_nome: null, tipo: 'receita', status: 'pago', valor: 1234.56 };
    expect(formatDisplayedCurrency(record.valor, true)).toBe('R$ ••••');
    expect(buildTransactionsCsv([record])).toContain('1234,56');
    expect(record.valor).toBe(1234.56);
    expect(formatDisplayedCurrency(record.valor, false)).toContain('1.234,56');
  });
  it('retains current device state across reloads', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
    persistPrivacyMode(true);
    expect(readPrivacyMode()).toBe(true);
    persistPrivacyMode(false);
    expect(readPrivacyMode()).toBe(false);
  });
  it('continues working when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); } });
    expect(readPrivacyMode()).toBe(false);
    expect(() => persistPrivacyMode(true)).not.toThrow();
  });
});
