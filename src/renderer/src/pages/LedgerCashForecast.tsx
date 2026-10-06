import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ledgerRpc, type LedgerWorkspace, type UserSettings } from '../lib/ledgerRepository';

type Horizon='month'|'30_days'|'90_days'|'6_months'|'custom';
type Choice={horizon:Horizon;until:string};
type Day={on:string;conservativeCents:number;expectedCents:number};
interface Forecast {
  today:string;until:string;horizon:Horizon;cashBalanceCents:number;series:Day[];
  conservative:{minimumCents:number;minimumOn:string;firstNegativeOn:string|null};
  expected:{minimumCents:number;minimumOn:string};nextMainIncomeOn:string|null;
  events:{id:string;label:string;kind:string;on:string;conservativeCents:number;expectedCents:number;projected?:boolean;estimatedChargesCents?:number;occurrences?:{label:string;projected?:boolean}[]}[];
}
const panel='card p-5 dark:border-slate-800 dark:bg-slate-900';
const input='field-input px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800';
const horizons:{value:Horizon;label:string}[]=[{value:'month',label:'Fim do mês'},{value:'30_days',label:'30 dias'},{value:'90_days',label:'90 dias'},{value:'6_months',label:'6 meses'},{value:'custom',label:'Data personalizada'}];
const date=(value:string)=>value.slice(0,10).split('-').reverse().join('/');
const shortDate=(value:string)=>date(value).slice(0,5);

export default function LedgerCashForecast({workspace,money,privacy}:{workspace:LedgerWorkspace;money:(value:number)=>string;privacy:boolean}) {
  const [choice,setChoice]=useState<Choice>({horizon:'month',until:workspace.space.today});
  const [active,setActive]=useState<Choice|null>(null),[forecast,setForecast]=useState<Forecast|null>(null);
  const [selectedOn,setSelectedOn]=useState(workspace.space.today);
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
  return <div className="space-y-5">
    <section className={`${panel} space-y-4`}>
      <div><h2 className="font-semibold">Quanto haverá nas contas em cada dia</h2><p className="mt-1 max-w-prose text-sm text-slate-500">Acompanhe as entradas e os pagamentos previstos, inclusive o vencimento das faturas. A projeção de hoje já considera o que ainda está previsto para hoje.</p></div>
      <form onSubmit={selectHorizon} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm">Período da previsão<select aria-label="Período da previsão" value={choice.horizon} disabled={busy} onChange={event=>setChoice(previous=>({...previous,horizon:event.target.value as Horizon}))} className={input}>{horizons.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {choice.horizon==='custom'&&<label className="grid gap-1.5 text-sm">Até a data<input aria-label="Data final da previsão" type="date" min={workspace.space.today} value={choice.until} disabled={busy} required onChange={event=>setChoice(previous=>({...previous,until:event.target.value}))} className={input}/></label>}
        <button disabled={busy||!active} className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy?'Carregando…':'Atualizar previsão'}</button>
      </form>
      <p className="max-w-prose text-xs text-slate-500">Metas, provisões, orçamentos e a reserva mínima organizam seu dinheiro sem alterar essa curva. Benefícios e investimentos são acompanhados separadamente. Para decidir quanto consumir, consulte o Livre para gastar.</p>
      {notice&&<p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
      {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    </section>
    {!forecast&&!error&&<p className="text-sm text-slate-500">Carregando a previsão diária…</p>}
    {forecast&&<>
      <section className={`${panel} space-y-5`} aria-label="Curva diária de saldo">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">De {date(forecast.today)} até {date(forecast.until)}</h2><p className="mt-1 text-sm text-slate-500">Saldo em contas hoje: {money(forecast.cashBalanceCents)}</p></div><div className="flex flex-wrap gap-4 text-xs"><span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-brand-600"/>Conservador</span><span className="inline-flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-indigo-500"/>Se as receitas previstas entrarem</span></div></div>
        {forecast.conservative.firstNegativeOn&&<p className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Saldo projetado negativo em {shortDate(forecast.conservative.firstNegativeOn)}. Confira os pagamentos e as entradas desse período.</p>}
        {privacy?<div className="flex min-h-64 items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-800">Valores e curva ocultos. Use Mostrar valores para consultar.</div>:<div className="min-w-0 max-w-full overflow-hidden" style={{containerType:'inline-size'}} role="img" aria-label="Saldos projetados diários nos cenários conservador e esperado">
          <ResponsiveContainer width="100%" height={300} minWidth={0}><LineChart data={forecast.series} margin={{top:20,right:15,left:0,bottom:5}}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.1}/>
            <XAxis dataKey="on" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={45} tick={{fontSize:12,fill:'#94a3b8'}}/>
            <YAxis width={85} tickFormatter={value=>money(Number(value))} tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#94a3b8'}}/>
            <Tooltip isAnimationActive={false} labelFormatter={value=>date(String(value))} formatter={value=>money(Number(value))} contentStyle={{background:'#0f172a',border:'1px solid #334155',borderRadius:12,color:'#f8fafc',maxWidth:'min(16rem, calc(100cqw - 100px))',whiteSpace:'normal',overflowWrap:'anywhere'}}/>
            <ReferenceLine y={0} stroke="#f59e0b" strokeDasharray="3 4"/>
            {forecast.nextMainIncomeOn&&forecast.nextMainIncomeOn<=forecast.until&&<ReferenceLine x={forecast.nextMainIncomeOn} stroke="#94a3b8" strokeDasharray="3 4" label={{value:'Próxima renda',position:'insideTopRight',fill:'#94a3b8',fontSize:11}}/>}
            <Line type="stepAfter" dataKey="conservativeCents" name="Conservador" stroke="#0d9488" strokeWidth={2.5} dot={false} isAnimationActive={false}/>
            <Line type="stepAfter" dataKey="expectedCents" name="Se as receitas previstas entrarem" stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}/>
          </LineChart></ResponsiveContainer>
        </div>}
        <dl className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 dark:border-slate-800"><div><dt className="text-sm text-slate-500">Menor saldo conservador</dt><dd className="mt-1 text-xl font-semibold">{money(forecast.conservative.minimumCents)}</dd><dd className="mt-1 text-xs text-slate-500">Em {date(forecast.conservative.minimumOn)}</dd></div><div><dt className="text-sm text-slate-500">Menor saldo se as receitas entrarem</dt><dd className="mt-1 text-xl font-semibold">{money(forecast.expected.minimumCents)}</dd><dd className="mt-1 text-xs text-slate-500">Em {date(forecast.expected.minimumOn)}</dd></div></dl>
      </section>
      <section className={`${panel} space-y-4`} aria-label="Detalhes de um dia da previsão">
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-semibold">Confira um dia</h2><label className="grid gap-1.5 text-sm">Data a consultar<input aria-label="Dia da previsão" type="date" min={forecast.today} max={forecast.until} value={selectedOn} onChange={event=>setSelectedOn(event.target.value)} className={input}/></label></div>
        {selected&&<p className="text-sm">Conservador: <strong>{money(selected.conservativeCents)}</strong><span className="block text-slate-500 sm:ml-4 sm:inline">Se as receitas entrarem: <strong>{money(selected.expectedCents)}</strong></span></p>}
        {events.length===0?<p className="text-sm text-slate-500">Nenhuma entrada ou pagamento previsto para este dia.</p>:<div className="space-y-3">{events.map(item=><article key={`${item.kind}-${item.id}`} className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800"><div className="min-w-0"><h3 className="font-medium">{item.label}</h3>{item.projected&&<p className="mt-1 text-xs text-slate-500">Projeção da recorrência. Ainda não foi criada na Agenda.</p>}{Boolean(item.estimatedChargesCents)&&<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Inclui {money(item.estimatedChargesCents!)} de encargos estimados, ainda não confirmados.</p>}{item.occurrences?.map((occurrence,index)=><p key={index} className="mt-1 text-xs text-slate-500">Inclui: {occurrence.label}{occurrence.projected?' · recorrência projetada':''}</p>)}</div><div className="text-right"><p>{money(item.conservativeCents)}</p>{item.expectedCents!==item.conservativeCents&&<p className="mt-1 text-xs text-slate-500">Se entrar: {money(item.expectedCents)}</p>}</div></article>)}</div>}
      </section>
    </>}
  </div>;
}
