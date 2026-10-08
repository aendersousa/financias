import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MapPin, Search } from 'lucide-react';
import { ledgerRpc, type UserSettings } from '../lib/ledgerRepository';
import { holidayStates, holidayYears, localHolidayPreview, lookupHolidayLocation } from '../lib/localHolidays';

interface Locality { cep: string; city: string; uf: string; ibge?: string }
const empty: Locality = { cep: '', city: '', uf: '' };
const input = 'field-input w-full min-w-0';

export default function HolidayLocation({ spaceId, today, canManage, holidays, onSaved }: {
  spaceId: string; today: string; canManage: boolean;
  holidays: { holiday_on: string; name: string }[]; onSaved: () => Promise<void>;
}) {
  const [location, setLocation] = useState<Locality>(empty);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [address, setAddress] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const pending = useRef(false);
  const preview = localHolidayPreview(location.uf, location.city, year);
  const existing = new Set(holidays.map(item => item.holiday_on));
  useEffect(() => {
    let active = true;
    setLoaded(false); setLocation(empty); setNotice(''); setError(''); setAddress('');
    void ledgerRpc<UserSettings>('get_user_settings', {}).then(settings => {
      if (!active) return;
      const saved = settings.preferences[`holiday_location:${spaceId}`] as Locality | undefined;
      if (saved && typeof saved.city === 'string' && holidayStates[saved.uf]) setLocation(saved);
      setLoaded(true);
    }).catch(() => { if (active) setError('Não foi possível carregar sua localização. Reabra esta tela para tentar novamente.'); });
    return () => { active = false; };
  }, [spaceId]);
  useEffect(() => { setSelected(localHolidayPreview(location.uf, location.city, year).holidays.map(item => item.date)); }, [location.uf, location.city, year]);
  async function searchCep() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const found = await lookupHolidayLocation(location.cep, AbortSignal.timeout(12000));
      setLocation({ cep: found.cep, city: found.city, uf: found.uf, ibge: found.ibge });
      setAddress([found.street, found.district].filter(Boolean).join(' · '));
    } catch (failure) { setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'A consulta demorou demais. Tente novamente ou preencha cidade e estado.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current || !loaded) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    let added = 0;
    try {
      const settings = await ledgerRpc<UserSettings>('get_user_settings', {});
      await ledgerRpc('update_user_settings', { p_version: settings.version, p_changes: { preferences: { [`holiday_location:${spaceId}`]: { ...location, city: location.city.trim() } } } });
      for (const holiday of preview.holidays.filter(item => selected.includes(item.date) && !existing.has(item.date))) {
        await ledgerRpc('manage_local_holiday', { p_space: spaceId, p_on: holiday.date, p_name: holiday.name.slice(0, 100) });
        added++;
      }
      await onSaved();
      setNotice(`Localização salva. ${added === 0 ? 'Nenhum feriado novo para adicionar.' : `${added} ${added === 1 ? 'feriado adicionado' : 'feriados adicionados'}.`}`);
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Não foi possível concluir.'}${added > 0 ? ` ${added} feriado(s) já foram salvos. Tente novamente para concluir.` : ''}`);
      await onSaved().catch(() => {});
    } finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="Localização para feriados" className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/30">
    <div className="flex items-start gap-2"><MapPin size={19} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"/><div><h3 className="font-semibold">Feriados da sua região</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Informe seu CEP ou preencha cidade e estado para encontrar as datas disponíveis.</p></div></div>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    <form onSubmit={event => void save(event)} className="space-y-4">
      <fieldset disabled={busy || !loaded || !canManage} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr]">
        <div><label htmlFor="holiday-cep" className="field-label">CEP</label><div className="mt-1 flex gap-2"><input id="holiday-cep" inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" value={location.cep} onChange={event => { setLocation({ ...empty, cep: event.target.value }); setAddress(''); setNotice(''); }} className={input}/><button type="button" onClick={() => void searchCep()} aria-label="Buscar endereço pelo CEP" className="rounded-lg border border-slate-300 p-2.5 text-brand-700 dark:border-slate-600 dark:text-brand-400"><Search size={18}/></button></div></div>
        <div><label htmlFor="holiday-city" className="field-label">Cidade</label><input id="holiday-city" autoComplete="address-level2" required maxLength={100} value={location.city} onChange={event => { setLocation({ ...location, city: event.target.value, ibge: '' }); setAddress(''); setNotice(''); }} className={`${input} mt-1`}/></div>
        <div><label htmlFor="holiday-state" className="field-label">Estado</label><select id="holiday-state" required value={location.uf} onChange={event => { setLocation({ ...location, uf: event.target.value, ibge: '' }); setAddress(''); setNotice(''); }} className={`${input} mt-1`}><option value="">Selecione</option>{Object.entries(holidayStates).map(([uf, state]) => <option key={uf} value={uf}>{uf} · {state.name}</option>)}</select></div>
      </fieldset>
      {address && <p className="text-xs text-slate-500 dark:text-slate-400">{address} · {location.city}/{location.uf}</p>}
      {location.uf && location.city.trim() && <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Feriados encontrados</h4><label className="flex items-center gap-2 text-xs">Ano<select aria-label="Ano dos feriados" value={year} onChange={event => setYear(Number(event.target.value))} disabled={busy} className="field-input py-1">{holidayYears.map(item => <option key={item}>{item}</option>)}</select></label></div>
        {!preview.municipalCoverage && <p className="text-xs text-slate-500 dark:text-slate-400">A base ainda não cobre os feriados municipais de {location.city}. Os estaduais disponíveis aparecem abaixo; inclua os municipais no cadastro manual.</p>}
        {preview.holidays.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum feriado regional encontrado nessa base para {year}. Os nacionais continuam no calendário bancário.</p> : <div className="grid gap-2 sm:grid-cols-2">{preview.holidays.map(item => <label key={item.date} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" disabled={busy || !canManage || existing.has(item.date)} checked={existing.has(item.date) || selected.includes(item.date)} onChange={event => setSelected(event.target.checked ? [...selected, item.date] : selected.filter(date => date !== item.date))} className="mt-1"/><span className="min-w-0 break-words">{item.name}<span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{item.date.split('-').reverse().join('/')} · {item.scope}{existing.has(item.date) ? ' · Já cadastrado' : ''}</span></span></label>)}</div>}
        <p className="text-xs text-slate-500 dark:text-slate-400">Somente as datas selecionadas serão adicionadas. Pontos facultativos ficam de fora. Para importar outro ano, selecione-o acima e salve novamente.</p>
      </div>}
      {canManage && <button disabled={busy || !loaded} className="btn-primary disabled:opacity-50">{busy ? 'Consultando ou salvando…' : 'Salvar localização e feriados'}</button>}
    </form>
    <p className="text-xs text-slate-500 dark:text-slate-400">CEP: <a href="https://viacep.com.br/" target="_blank" rel="noreferrer" className="underline">ViaCEP</a>. Calendário regional: <a href="https://github.com/commenthol/date-holidays" target="_blank" rel="noreferrer" className="underline">date-holidays</a>, com cobertura municipal limitada.</p>
  </section>;
}
