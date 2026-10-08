export interface Holiday { date: string; name: string; kind: 'national' | 'bank' | 'local' }

function dateFromIso(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data inválida.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Data inválida.');
  return date;
}

export function shiftDays(value: string, count: number): string {
  if (!Number.isSafeInteger(count)) throw new Error('Quantidade de dias inválida.');
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function easter(year: number): string {
  // Gregorian computus; dates remain independent of the device timezone.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function bankingHolidays(year: number): Holiday[] {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('Ano inválido.');
  const fixed = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['11-20', 'Consciência Negra'], ['12-25', 'Natal']
  ];
  const pascoa = easter(year);
  return [
    ...fixed.map(([date, name]): Holiday => ({ date: `${year}-${date}`, name, kind: 'national' })),
    { date: shiftDays(pascoa, -2), name: 'Sexta-feira da Paixão', kind: 'national' as const },
    { date: shiftDays(pascoa, -48), name: 'Segunda-feira de Carnaval', kind: 'bank' as const },
    { date: shiftDays(pascoa, -47), name: 'Terça-feira de Carnaval', kind: 'bank' as const }
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function isBankingDay(value: string, localHolidays: readonly Holiday[] = []): boolean {
  const date = dateFromIso(value);
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && ![...bankingHolidays(date.getUTCFullYear()), ...localHolidays].some((holiday) => holiday.date === value);
}

export function effectiveDueDate(value: string, adjustment: 'next' | 'previous' = 'next', localHolidays: readonly Holiday[] = []): string {
  let result = value;
  for (let index = 0; index < 366; index++) {
    if (isBankingDay(result, localHolidays)) return result;
    result = shiftDays(result, adjustment === 'next' ? 1 : -1);
  }
  throw new Error('Não foi encontrado um dia útil no intervalo de um ano.');
}

export function addBankingDays(value: string, count: number, localHolidays: readonly Holiday[] = []): string {
  if (!Number.isInteger(count) || count < 0 || count > 365) throw new Error('Prazo inválido.');
  dateFromIso(value);
  let result = value;
  for (let index = 0; index < count; index++) result = effectiveDueDate(shiftDays(result, 1), 'next', localHolidays);
  return result;
}

export function nthBankingDay(monthIso: string, count: number, localHolidays: readonly Holiday[] = []): string {
  if (!Number.isInteger(count) || count === 0 || count < -31 || count > 31) throw new Error('Dia útil inválido.');
  const [year, month] = monthIso.slice(0, 7).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (count > 0) {
    let bankingCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isBankingDay(dateStr, localHolidays)) {
        bankingCount++;
        if (bankingCount === count) return dateStr;
      }
    }
    return effectiveDueDate(`${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`, 'previous', localHolidays);
  } else {
    let bankingCount = 0;
    for (let day = daysInMonth; day >= 1; day--) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isBankingDay(dateStr, localHolidays)) {
        bankingCount--;
        if (bankingCount === count) return dateStr;
      }
    }
    return effectiveDueDate(`${year}-${String(month).padStart(2, '0')}-01`, 'next', localHolidays);
  }
}

export function todayInSpace(timezone = 'America/Sao_Paulo', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
