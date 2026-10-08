import { describe, expect, it, vi, afterEach } from 'vitest';
import { localHolidayPreview, lookupHolidayLocation } from './localHolidays';

afterEach(() => vi.unstubAllGlobals());
describe('regional holidays', () => {
  it('combines state and supported city holidays without national duplicates', () => {
    const result = localHolidayPreview('SP', 'Sao Paulo', 2026);
    expect(result.municipalCoverage).toBe(true);
    expect(result.holidays).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-01-25', scope: 'Municipal' }),
      expect.objectContaining({ date: '2026-07-09', scope: 'Estadual' })
    ]));
    expect(result.holidays.some(item => item.date === '2026-12-25')).toBe(false);
    expect(new Set(result.holidays.map(item => item.date)).size).toBe(result.holidays.length);
  });
  it('reports missing municipal coverage while retaining state dates', () => {
    const result = localHolidayPreview('SP', 'Cidade sem cobertura', 2027);
    expect(result.municipalCoverage).toBe(false);
    expect(result.holidays.some(item => item.date === '2027-07-09')).toBe(true);
    expect(result.holidays.every(item => item.scope === 'Estadual')).toBe(true);
    expect(localHolidayPreview('XX', 'Cidade', 2026).holidays).toEqual([]);
  });
  it('validates CEP before sending a request and handles unknown addresses', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(lookupHolidayLocation('123')).rejects.toThrow('8 números');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(lookupHolidayLocation('00000-000')).rejects.toThrow('CEP não encontrado');
  });
  it('returns the actual city and UF from a formatted CEP', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localidade: 'São Paulo', uf: 'SP', ibge: '3550308', logradouro: 'Praça da Sé', bairro: 'Sé' }) });
    vi.stubGlobal('fetch', fetcher);
    expect(await lookupHolidayLocation('01001-000')).toMatchObject({ cep: '01001000', city: 'São Paulo', uf: 'SP', ibge: '3550308' });
    expect(fetcher.mock.calls[0][0]).toBe('https://viacep.com.br/ws/01001000/json/');
  });
});
