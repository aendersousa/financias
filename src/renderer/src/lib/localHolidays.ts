import calendar from './local-holidays.json';

export interface LocationHoliday { date: string; name: string; scope: 'Estadual' | 'Municipal' }
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
type Area = { name: string; holidays: Record<string, { date: string; name: string }[]> };
type State = Area & { cities: Record<string, Area> };
export const holidayYears = calendar.years;
export const holidayStates = calendar.states as Record<string, State>;
export function localHolidayPreview(uf: string, city: string, year: number) {
  const state = holidayStates[uf];
  const municipality = Object.values(state?.cities ?? {}).find(item => normalize(item.name) === normalize(city));
  const holidays: LocationHoliday[] = [
    ...(state?.holidays[String(year)] ?? []).map(item => ({ ...item, scope: 'Estadual' as const })),
    ...(municipality?.holidays[String(year)] ?? []).map(item => ({ ...item, scope: 'Municipal' as const }))
  ];
  // One local date per space; retain both celebration names if they coincide.
  const dates = new Map<string, LocationHoliday>();
  for (const item of holidays) {
    const existing = dates.get(item.date);
    dates.set(item.date, existing ? { ...existing, name: `${existing.name} / ${item.name}` } : item);
  }
  return { municipalCoverage: Boolean(municipality), holidays: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function lookupHolidayLocation(cep: string, signal?: AbortSignal) {
  const digits = cep.replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) throw new Error('Informe um CEP com 8 números.');
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal });
  if (!response.ok) throw new Error('Não foi possível consultar o CEP. Tente novamente.');
  const data = await response.json();
  if (data.erro || typeof data.localidade !== 'string' || !holidayStates[data.uf]) throw new Error('CEP não encontrado. Confira os números ou preencha a cidade e o estado.');
  return { cep: digits, city: data.localidade as string, uf: data.uf as string, ibge: String(data.ibge ?? ''), street: String(data.logradouro ?? ''), district: String(data.bairro ?? '') };
}
