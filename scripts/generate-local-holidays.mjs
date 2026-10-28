import Holidays from 'date-holidays';
import { writeFile } from 'node:fs/promises';

// Build only Brazilian regional additions; never treat optional dates as holidays.
const source = new Holidays();
const years = Array.from({ length: 6 }, (_, i) => 2026 + i);
const data = { source: 'date-holidays', version: '3.37.0', license: 'CC-BY-SA-3.0', sourceUrl: 'https://github.com/commenthol/date-holidays/blob/master/data/countries/BR.yaml', years, states: {} };
for (const [uf, name] of Object.entries(source.getStates('BR'))) {
  const regions = source.getRegions('BR', uf) ?? {};
  const state = { name, holidays: {}, cities: {} };
  for (const year of years) {
    const national = new Set(new Holidays('BR').getHolidays(year).filter(h => h.type === 'public' || h.type === 'bank').map(h => h.date.slice(0, 10)));
    // Already included nationally in WalletUp since the 2024 calendar.
    national.add(`${year}-11-20`);
    const additions = (calendar, excluded) => calendar.getHolidays(year)
      .filter(h => h.type === 'public' && !excluded.has(h.date.slice(0, 10)))
      .map(h => ({ date: h.date.slice(0, 10), name: h.name }));
    state.holidays[year] = additions(new Holidays('BR', uf), national);
    const stateDates = new Set([...national, ...state.holidays[year].map(h => h.date)]);
    for (const [code, city] of Object.entries(regions)) {
      state.cities[code] ??= { name: city, holidays: {} };
      state.cities[code].holidays[year] = additions(new Holidays('BR', uf, code), stateDates);
    }
  }
  data.states[uf] = state;
}
await writeFile('src/renderer/src/lib/local-holidays.json', JSON.stringify(data, null, 2) + '\n');
console.log('Brazilian regional calendar generated for ' + years.join(', '));
