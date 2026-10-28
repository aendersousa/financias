import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, Wallet } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ledgerRpc, type LedgerWorkspace, type UserSettings } from '../lib/ledgerRepository';
import ForecastEventTable, { type ForecastEvent } from '../components/ForecastEventTable';

type Horizon='month'|'30_days'|'90_days'|'6_months'|'custom';
type Choice={horizon:Horizon;until:string};
type Day={on:string;conservativeCents:number;expectedCents:number};
interface Forecast {
  today:string;until:string;horizon:Horizon;cashBalanceCents:number;series:Day[];
  conservative:{minimumCents:number;minimumOn:string;firstNegativeOn:string|null};
  expected:{minimumCents:number;minimumOn:string};nextMainIncomeOn:string|null;
  events:ForecastEvent[];
}
const panel='card min-w-0 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const input='field-input w-full min-w-0';
const horizons:{value:Horizon;label:string}[]=[{value:'month',label:'Fim do mês'},{value:'30_days',label:'30 dias'},{value:'90_days',label:'90 dias'},{value:'6_months',label:'6 meses'},{value:'custom',label:'Data personalizada'}];
const date=(value:string)=>value.slice(0,10).split('-').reverse().join('/');
const shortDate=(value:string)=>date(value).slice(0,5);

export default function LedgerCashForecast({workspace,money,privacy}:{workspace:LedgerWorkspace;money:(value:number)=>string;privacy:boolean}) {
  const [choice,setChoice]=useState<Choice>({horizon:'month',until:workspace.space.today});
  const [active,setActive]=useState<Choice|null>(null),[forecast,setForecast]=useState<Forecast|null>(null);
  const [selectedOn,setSelectedOn]=useState(workspace.space.today);
  const [expandedEvent,setExpandedEvent]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const pending=useRef(false);
  useEffect(()=>{
    let stopped=false;setActive(null);setForecast(null);setError('');
    void ledgerRpc<UserSettings>('get_user_settings',{}).then(settings=>{
      const saved=settings.preferences.cash_forecast as Partial<Choice>|undefined;
      const valid=saved&&horizons.some(item=>item.value===saved.horizon)&&(!saved.until||/^\d{4}-\d{2}-\d{2}$/.test(saved.until));
      const selection:Choice=valid&&!(saved.horizon==='custom'&&(!saved.until||saved.until<workspace.space.today))?{horizon:saved.horizon as Horizon,until:saved.until||workspace.space.today}:{horizon:'month',until:workspace.space.today};
      if(!stopped){setChoice(selection);setActive(selection);}
    }).catch(()=>{if(!stopped)setError('Não foi possível carregar a preferência de período. Atualize a página para tentar novamente.');});
    return()=>{stopped=true;};
  },[workspace.space.id]);
  useEffect(()=>{
    if(!active)return;
    let stopped=false;setBusy(true);setError('');setForecast(null);
    void ledgerRpc<Forecast>('cash_forecast',{p_space:workspace.space.id,p_horizon:active.horizon,p_until:active.horizon==='custom'?active.until:null}).then(result=>{
      if(!stopped){setForecast(result);setSelectedOn(result.today);}
    }).catch(()=>{if(!stopped)setError('Não foi possível carregar a previsão. Escolha uma data válida, até 24 meses à frente, e tente novamente.');}).finally(()=>{if(!stopped)setBusy(false);});
    return()=>{stopped=true;};
  },[workspace,active]);
  async function selectHorizon(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending.current||busy)return;
    pending.current=true;setBusy(true);setError('');setNotice('');
    try {
      // Validate before remembering an invalid custom date; this read has no
      // financial side effect and the server alone calculates every total.
      const result=await ledgerRpc<Forecast>('cash_forecast',{p_space:workspace.space.id,p_horizon:choice.horizon,p_until:choice.horizon==='custom'?choice.until:null});
      const settings=await ledgerRpc<UserSettings>('get_user_settings',{});
      await ledgerRpc('update_user_settings',{p_version:settings.version,p_changes:{preferences:{cash_forecast:choice}}});
      setActive({...choice});setForecast(result);setSelectedOn(result.today);setNotice('Período da previsão salvo.');
    } catch(failure) {setError(failure instanceof Error&&failure.message.includes('changed; reload')?'Sua preferência mudou em outra sessão. Tente salvar novamente.':'Confira o período e tente novamente. A data personalizada deve estar entre hoje e os próximos 24 meses.');}
    finally {pending.current=false;setBusy(false);}
  }
  const selected=forecast?.series.find(item=>item.on===selectedOn);
  const events=forecast?.events.filter(item=>item.on===selectedOn)??[];
  useEffect(()=>{setExpandedEvent(null);},[selectedOn,forecast]);
  return <div className="min-w-0 space-y-6">
    <section className={`${panel} space-y-4`}>
      <div className="flex items-center gap-3"><span className="rounded-xl bg-brand-100 p-2.5 text-brand-600 dark:bg-brand-950 dark:text-brand-400"><Wallet size={20}/></span><div><h2 className="text-lg font-semibold">Seu saldo nos próximos dias</h2><p className="mt-1 text-sm text-slate-500">Veja como entradas e pagamentos podem mudar o dinheiro nas contas.</p></div></div>
      <form aria-label="Período da previsão" onSubmit={selectHorizon} className="flex flex-wrap items-end gap-3">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-56"><label htmlFor="forecast-horizon" className="field-label">Período da previsão</label><select id="forecast-horizon" aria-label="Período da previsão" value={choice.horizon} disabled={busy} onChange={event=>setChoice(previous=>({...previous,horizon:event.target.value as Horizon}))} className={input}>{horizons.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        {choice.horizon==='custom'&&<div className="flex w-full min-w-0 flex-col gap-1 sm:w-44"><label htmlFor="forecast-until" className="field-label">Até a data</label><input id="forecast-until" aria-label="Data final da previsão" type="date" min={workspace.space.today} value={choice.until} disabled={busy} required onChange={event=>setChoice(previous=>({...previous,until:event.target.value}))} className={input}/></div>}
        <button disabled={busy||!active} className="btn-primary disabled:opacity-50">{busy?'Carregando…':'Atualizar previsão'}</button>
      </form>
      <details className="text-xs text-slate-500"><summary className="cursor-pointer">O que entra nesta previsão?</summary><p className="mt-2 max-w-prose leading-relaxed">Inclui entradas, pagamentos e faturas previstos, inclusive os de hoje. Metas, provisões e orçamentos não alteram a curva. Benefícios e investimentos ficam separados. Para decidir quanto consumir, consulte o Livre para gastar.</p></details>
      {notice&&<p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
      {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    </section>
    {!forecast&&!error&&<p className="text-sm text-slate-500">Carregando a previsão diária…</p>}
    {forecast&&<>
      <section aria-label="Resumo da previsão" className="card grid overflow-hidden divide-y divide-slate-200 dark:divide-slate-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5"><p className="flex items-center gap-2 text-xs text-slate-500"><Wallet size={15}/>Saldo nas contas hoje</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(forecast.cashBalanceCents)}</p><p className="mt-1 text-xs text-slate-500">{date(forecast.today)}</p></div>
        <div className="p-5"><p className="flex items-center gap-2 text-xs text-slate-500"><ArrowDownRight size={15}/>Menor saldo conservador</p><p className={'mt-2 text-2xl font-semibold tabular-nums '+(forecast.conservative.minimumCents<0?'text-red-500':'text-brand-600 dark:text-brand-400')}>{money(forecast.conservative.minimumCents)}</p><p className="mt-1 text-xs text-slate-500">Em {date(forecast.conservative.minimumOn)}</p></div>
        <div className="p-5"><p className="flex items-center gap-2 text-xs text-slate-500"><ArrowUpRight size={15}/>Saldo previsto no fim do período</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(forecast.series.at(-1)?.expectedCents??forecast.cashBalanceCents)}</p><p className="mt-1 text-xs text-slate-500">Se as receitas previstas entrarem</p></div>
      </section>
      <section className={`${panel} space-y-5`} aria-label="Curva diária de saldo">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">De {date(forecast.today)} até {date(forecast.until)}</h2><p className="mt-1 text-sm text-slate-500">Saldo em contas hoje: {money(forecast.cashBalanceCents)}</p></div><div className="flex flex-wrap gap-4 text-xs"><span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-brand-600"/>Conservador</span><span className="inline-flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-indigo-500"/>Se as receitas previstas entrarem</span></div></div>
        {forecast.conservative.firstNegativeOn&&<p className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Saldo projetado negativo em {shortDate(forecast.conservative.firstNegativeOn)}. Confira os pagamentos e as entradas desse período.</p>}
        {privacy?<div className="flex min-h-64 items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-800">Valores e curva ocultos. Use Mostrar valores para consultar.</div>:<div className="min-w-0 max-w-full overflow-hidden" style={{containerType:'inline-size'}} role="img" aria-label="Saldos projetados diários nos cenários conservador e esperado">
          <ResponsiveContainer width="100%" height={260} minWidth={0}><LineChart data={forecast.series} margin={{top:20,right:15,left:0,bottom:5}}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.1}/>
            <XAxis dataKey="on" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={45} tick={{fontSize:12,fill:'#94a3b8'}}/>
            <YAxis width={85} tickFormatter={value=>money(Number(value))} tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#94a3b8'}}/>
            <Tooltip isAnimationActive={false} content={({active,label})=>{
              if(!active||!label)return null;
              const on=String(label),point=forecast.series.find(day=>day.on===on);
              const income=forecast.events.filter(event=>event.on===on&&(event.conservativeCents>0||event.expectedCents>0));
              const expenses=forecast.events.filter(event=>event.on===on&&(event.conservativeCents<0||event.expectedCents<0));
              return <div className="max-w-[min(20rem,calc(100cqw-30px))] rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-100 shadow-xl [overflow-wrap:anywhere]">
                <p className="mb-2 font-semibold">{date(on)}</p>
                {point&&<div className="space-y-1"><p className="text-emerald-400">Conservador: {money(point.conservativeCents)}</p><p className="text-indigo-400">Se as receitas entrarem: {money(point.expectedCents)}</p></div>}
                <div className="mt-3 space-y-2 border-t border-slate-700 pt-2"><p className="font-semibold">Receitas previstas neste dia</p>
                  {income.length?income.map(event=><div key={event.kind+'-'+event.id}><p className="flex justify-between gap-3"><span>{event.label}</span><span className="shrink-0 text-emerald-400">{money(Math.max(event.conservativeCents,event.expectedCents))}</span></p>{event.occurrences?.map((item,index)=><p key={index} className="mt-1 text-slate-400">{item.label}</p>)}</div>):<p className="text-slate-400">Nenhuma receita prevista.</p>}
                </div>
                <div className="mt-3 space-y-2 border-t border-slate-700 pt-2"><p className="font-semibold">Despesas previstas neste dia</p>
                  {expenses.length?expenses.map(event=><div key={event.kind+'-'+event.id}><p className="flex justify-between gap-3"><span>{event.label}</span><span className="shrink-0 text-red-400">{money(Math.abs(event.conservativeCents<0?event.conservativeCents:event.expectedCents))}</span></p>{event.occurrences?.map((item,index)=><p key={index} className="mt-1 text-slate-400">{item.label}</p>)}</div>):<p className="text-slate-400">Nenhuma despesa prevista.</p>}
                </div>
              </div>;
            }}/>

            <ReferenceLine y={0} stroke="#f59e0b" strokeDasharray="3 4"/>
            {forecast.nextMainIncomeOn&&forecast.nextMainIncomeOn<=forecast.until&&<ReferenceLine x={forecast.nextMainIncomeOn} stroke="#94a3b8" strokeDasharray="3 4" label={{value:'Próxima renda',position:'insideTopRight',fill:'#94a3b8',fontSize:11}}/>}
            <Line type="stepAfter" dataKey="conservativeCents" name="Conservador" stroke="#10b981" strokeWidth={2.5} dot={false} isAnimationActive={false}/>
            <Line type="stepAfter" dataKey="expectedCents" name="Se as receitas previstas entrarem" stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}/>
          </LineChart></ResponsiveContainer>
        </div>}
        <dl className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 dark:border-slate-800"><div><dt className="text-sm text-slate-500">Menor saldo conservador</dt><dd className="mt-1 text-xl font-semibold">{money(forecast.conservative.minimumCents)}</dd><dd className="mt-1 text-xs text-slate-500">Em {date(forecast.conservative.minimumOn)}</dd></div><div><dt className="text-sm text-slate-500">Menor saldo se as receitas entrarem</dt><dd className="mt-1 text-xl font-semibold">{money(forecast.expected.minimumCents)}</dd><dd className="mt-1 text-xs text-slate-500">Em {date(forecast.expected.minimumOn)}</dd></div></dl>
      </section>
      <section className="card min-w-0 overflow-hidden" aria-label="Detalhes de um dia da previsão">
        <div className="space-y-4 border-b border-slate-200 p-4 dark:border-slate-800 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-brand-500"/>Movimentos do dia</h2><div className="flex w-full min-w-0 flex-col gap-1 sm:w-44"><label htmlFor="forecast-day" className="field-label">Data a consultar</label><input id="forecast-day" aria-label="Dia da previsão" type="date" min={forecast.today} max={forecast.until} value={selectedOn} onChange={event=>setSelectedOn(event.target.value)} className={input}/></div></div>
          {selected&&<p className="text-sm">Conservador: <strong>{money(selected.conservativeCents)}</strong><span className="block text-slate-500 dark:text-slate-400 sm:ml-4 sm:inline">Se as receitas entrarem: <strong>{money(selected.expectedCents)}</strong></span></p>}
        </div>
        <ForecastEventTable events={events} money={money}
          renderActions={item=><button type="button" onClick={()=>setExpandedEvent(expandedEvent===`${item.kind}-${item.id}`?null:`${item.kind}-${item.id}`)} aria-label={`Detalhes do evento ${item.label}`} aria-expanded={expandedEvent===`${item.kind}-${item.id}`} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button>}
          renderEditor={item=>expandedEvent===`${item.kind}-${item.id}`?<section aria-label={`Detalhes do evento ${item.label}`} className={`${panel} space-y-3`}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><h3 className="font-semibold">{item.label}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{date(item.on)}</p></div><button type="button" onClick={()=>setExpandedEvent(null)} className="text-sm text-slate-500 dark:text-slate-400">Fechar</button></div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="field-label">Conservador</dt><dd className="mt-1 font-medium">{money(item.conservativeCents)}</dd></div><div><dt className="field-label">Se as receitas entrarem</dt><dd className="mt-1 font-medium">{money(item.expectedCents)}</dd></div></dl>
            {item.projected&&<p className="text-sm text-slate-500 dark:text-slate-400">Projeção da recorrência. Ainda não foi criada na Agenda.</p>}
            {Boolean(item.estimatedChargesCents)&&<p className="text-sm text-amber-700 dark:text-amber-300">Inclui {money(item.estimatedChargesCents!)} de encargos estimados, ainda não confirmados.</p>}
            {Boolean(item.occurrences?.length)&&<div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800"><h4 className="text-sm font-medium">Itens incluídos</h4>{item.occurrences?.map((occurrence,index)=><p key={index} className="text-sm text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">Inclui: {occurrence.label}{occurrence.projected?' · recorrência projetada':''}</p>)}</div>}
          </section>:null}/>
      </section>
    </>}
  </div>;
}
