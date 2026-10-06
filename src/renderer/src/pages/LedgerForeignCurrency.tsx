import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatBrlCents, parseBrlCents } from '../../../shared/finance/money';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { useAppStore } from '../store/useAppStore';

interface Quote {
  currency:string; minor_unit:number; original_minor:number; original_amount:string; rate:string | null;
  total_cents:number | null; suggested:boolean; iof_percent:number | null; iof_suggestion_cents:number | null;
}
interface ForeignPurchase {
  id:string; ledger_transaction_id:string; original_currency:string; original_minor:number; minor_unit:number; original_amount:string;
  exchange_rate:string; rate_source:'user' | 'invoice' | 'statement' | 'import'; conversion_status:'estimated' | 'confirmed';
  current_brl_cents:number; recorded_brl_cents?:number; changed_after_conversion?:boolean; iof_cents:number; iof_conversion_status:'estimated' | 'confirmed' | null; version:number;
  description:string; on:string; transaction_status:'posted' | 'cancelled'; card_id:string | null; account_id:string | null;
  installments:number; closed_statement:boolean; can_reestimate:boolean; confirmation_transaction_id:string | null;
  events:{ action:string; at:string }[];
}
interface ForeignSummary {
  currencies:{ code:string; minor_unit:number }[]; settings_version:number; iof_percent:number | null; purchases:ForeignPurchase[];
}
type Action={ kind:'create' } | { kind:'confirm' | 'reestimate'; purchase:string };
const panel='card p-5 dark:border-slate-800 dark:bg-slate-900';
const input='w-full field-input px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800';
const button='rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const decimal=(value:string) => {
  const cleaned=value.trim().replace(',', '.');
  if(!/^\d+(?:\.\d+)?$/.test(cleaned)) throw new Error('Informe um número decimal, como 100,00.');
  return cleaned;
};
function decimalLabel(value:string,minimumDecimals=0) {
  const [whole,fraction='']=value.split('.');
  const digits=fraction.replace(/0+$/,'').padEnd(minimumDecimals,'0');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')}${digits ? `,${digits}` : ''}`;
}
const amountInput=(cents:number) => formatBrlCents(cents).replace('R$ ','');
const day=(value:string) => value.slice(0,10).split('-').reverse().join('/');
const sourceLabels={ user:'Informado manualmente',invoice:'Fatura do cartão',statement:'Extrato bancário',import:'Importação' };
const eventLabels:Record<string,string>={ foreign_purchase_created:'Compra registrada',foreign_purchase_reestimated:'Estimativa atualizada',foreign_purchase_confirmed:'Valor em reais confirmado',edited:'Lançamento corrigido posteriormente',cancelled:'Lançamento cancelado' };
function failureMessage(failure:unknown) {
  const message=failure instanceof Error ? failure.message : '';
  if(message.includes('changed; reload')) return 'Este registro mudou. Atualize os dados antes de salvar novamente.';
  if(message.includes('permission') || message.includes('Space access denied')) return 'Sua permissão para este espaço mudou. Atualize a página para continuar.';
  if(message.includes('minor units')) return 'A quantidade de casas decimais não corresponde à moeda escolhida.';
  if(message.includes('equal the original amount')) return 'A soma dos valores nas categorias precisa corresponder ao total na moeda estrangeira.';
  if(message.includes('Distinct active expense')) return 'Escolha categorias ativas diferentes para cada parte.';
  if(message.includes('ten decimals')) return 'Informe uma taxa positiva com até dez casas decimais.';
  if(message.includes('Confirmed conversion')) return 'Esta conversão já foi confirmada. Para corrigir depois, use as ações do lançamento.';
  if(message.includes('Closed foreign purchase')) return 'O período está fechado. Confirme o valor final cobrado em reais.';
  if(message.includes('closed') || message.includes('Closed')) return 'O período informado está fechado. Use uma data de confirmação em um mês aberto.';
  if(message.includes('Original purchase unavailable')) return 'A compra foi cancelada ou alterada. Atualize os dados e confira o lançamento.';
  if(message.includes('Active card')) return 'O cartão está cancelado ou arquivado. Escolha um cartão ativo.';
  if(message.includes('Sem conexão')) return message;
  return 'Não foi possível salvar. Confira as datas, os valores e a categoria antes de tentar novamente.';
}

export default function LedgerForeignCurrency({ workspace,money,onChanged }: { workspace:LedgerWorkspace; money:(cents:number) => string; onChanged:() => Promise<void> }) {
  const privacy=useAppStore(state => state.privacyMode);
  const [summary,setSummary]=useState<ForeignSummary | null>(null);
  const [action,setAction]=useState<Action | null>(null);
  const [filter,setFilter]=useState('pending');
  const [currency,setCurrency]=useState('USD'),[original,setOriginal]=useState(''),[rate,setRate]=useState(''),[brl,setBrl]=useState('');
  const [entryMode,setEntryMode]=useState<'rate' | 'brl'>('rate'),[method,setMethod]=useState<'card' | 'cash'>('card');
  const [quote,setQuote]=useState<Quote | null>(null),[quoteError,setQuoteError]=useState('');
  const [iof,setIof]=useState(''),[split,setSplit]=useState(false),[parts,setParts]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const pending=useRef(false),request=useRef<{ key:string; id:string } | null>(null);
  const activeSpace=useRef(workspace.space.id); activeSpace.current=workspace.space.id;
  const writer=workspace.role!=='viewer',administrator=['owner','admin'].includes(workspace.role);
  const categories=workspace.categories.filter(item => item.kind==='expense' && item.ledger_account_id);
  const selected=action && action.kind!=='create' ? summary?.purchases.find(item => item.id===action.purchase) : undefined;
  useEffect(() => {
    let cancelled=false; setSummary(null); setError('');
    void ledgerRpc<ForeignSummary>('foreign_currency_summary',{p_space:workspace.space.id}).then(result => { if(!cancelled) setSummary(result); }).catch(() => { if(!cancelled) setError('Não foi possível carregar as compras em moeda estrangeira.'); });
    return () => {cancelled=true;};
  },[workspace]);
  useEffect(() => {setAction(null);setQuote(null);request.current=null;},[workspace.space.id]);
  useEffect(() => {
    let cancelled=false; setQuote(null); setQuoteError('');
    if(!action || !original.trim()) return;
    const timer=window.setTimeout(() => {
      try {
        const originalValue=decimal(original),rateValue=entryMode==='rate' && rate.trim() ? decimal(rate) : null;
        const brlValue=entryMode==='brl' && brl.trim() ? parseBrlCents(brl) : null;
        void ledgerRpc<Quote>('quote_foreign_currency',{p_space:workspace.space.id,p_currency:currency,p_original_amount:originalValue,p_rate:rateValue,p_brl_cents:brlValue}).then(result => {if(!cancelled) setQuote(result);}).catch(failure => {if(!cancelled) setQuoteError(failureMessage(failure));});
      } catch(failure) {if(!cancelled) setQuoteError(failure instanceof Error ? failure.message : 'Confira os valores.');}
    },300);
    return () => {cancelled=true;window.clearTimeout(timer);};
  },[workspace.space.id,action,currency,original,entryMode,rate,brl]);
  function choose(next:Action) {
    const purchase=next.kind==='create' ? undefined : summary?.purchases.find(item => item.id===next.purchase);
    setAction(next);setError('');setNotice('');setQuote(null);setQuoteError('');request.current=null;
    setCurrency(purchase?.original_currency ?? 'USD');setOriginal(purchase ? purchase.original_amount : '');
    setRate(next.kind==='reestimate' && purchase && !privacy ? purchase.exchange_rate : '');
    setBrl(next.kind==='confirm' && purchase && !privacy ? amountInput(purchase.current_brl_cents) : '');
    setEntryMode(next.kind==='confirm' ? 'brl' : 'rate');setIof(next.kind==='confirm' && purchase && !privacy ? amountInput(purchase.iof_cents) : '');
    setMethod(purchase?.account_id ? 'cash' : 'card');setSplit(false);setParts([]);
  }
  async function refresh() {
    if(pending.current) return;
    const space=workspace.space.id; pending.current=true;setBusy(true);setError('');
    try {
      const result=await ledgerRpc<ForeignSummary>('foreign_currency_summary',{p_space:space});
      if(activeSpace.current===space) setSummary(result);
    } catch {if(activeSpace.current===space) setError('Não foi possível carregar as compras em moeda estrangeira.');}
    finally {pending.current=false;setBusy(false);}
  }
  async function mutate(name:string,args:Record<string,unknown>,message:string,withNonce=true) {
    if(pending.current) return;
    pending.current=true;setBusy(true);setError('');setNotice('');
    const space=workspace.space.id,key=JSON.stringify({name,space,...args});
    if(request.current?.key!==key) request.current={key,id:crypto.randomUUID()};
    try {
      await ledgerRpc(name,{p_space:space,...args,...(withNonce ? {p_client_uuid:request.current.id} : {})});
      if(activeSpace.current!==space) return;
      setAction(null);setQuote(null);request.current=null;
      const result=await ledgerRpc<ForeignSummary>('foreign_currency_summary',{p_space:space});
      if(activeSpace.current!==space) return;
      setSummary(result);await onChanged();setNotice(message);
    } catch(failure) {if(activeSpace.current===space) setError(failureMessage(failure));}
    finally {pending.current=false;setBusy(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!action || pending.current) return;
    const data=new FormData(event.currentTarget),text=(name:string) => String(data.get(name) ?? '').trim();
    try {
      if(action.kind==='create') {
        const payload:Record<string,unknown>={currency,original_amount:decimal(original),on:text('date'),description:text('description'),confirmed:data.has('confirmed'),iof_cents:iof.trim() ? parseBrlCents(iof) : 0,iof_on:text('iof_date') || null};
        if(entryMode==='rate') {if(!rate.trim()) throw new Error('Informe uma taxa ou aceite a última taxa sugerida.');payload.rate=decimal(rate);}
        else {payload.brl_cents=parseBrlCents(brl);}
        if(method==='card') {payload.card_id=text('card');payload.installments=Number(text('installments'));} else payload.account_id=text('account');
        if(split) payload.category_parts=parts.map(id => ({category_id:text(`category-${id}`),original_amount:decimal(text(`part-${id}`))}));
        else payload.category_id=text('category');
        await mutate('record_foreign_purchase',{p_payload:payload},'Compra registrada com o valor em reais. O IOF ficou em um lançamento separado.');
      } else {
        if(!selected) throw new Error('Atualize os dados e selecione a compra novamente.');
        if(action.kind==='confirm') await mutate('confirm_foreign_purchase',{p_purchase:selected.id,p_version:selected.version,p_confirmed_cents:parseBrlCents(brl),p_on:text('date'),p_iof_cents:parseBrlCents(iof),p_source:text('source')},'Conversão confirmada. Períodos fechados preservaram a compra e receberam um ajuste ligado a ela.');
        else await mutate('reestimate_foreign_purchase',{p_purchase:selected.id,p_version:selected.version,p_rate:decimal(rate),p_on:text('date')},'Estimativa atualizada com a taxa informada.');
      }
    } catch(failure) {setError(failure instanceof Error ? failure.message : 'Confira os campos.');}
  }
  async function saveIof(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!summary || pending.current) return;
    const value=String(new FormData(event.currentTarget).get('percent') ?? '').trim();
    try {await mutate('set_foreign_iof_percent',{p_version:summary.settings_version,p_percent:value ? decimal(value) : null},'Percentual de sugestão atualizado.',false);}
    catch(failure) {setError(failure instanceof Error ? failure.message : 'Confira o percentual.');}
  }
  const visible=summary?.purchases.filter(item => filter==='pending' ? item.transaction_status==='posted' && item.conversion_status==='estimated' : filter==='confirmed' ? item.transaction_status==='posted' && item.conversion_status==='confirmed' : true) ?? [];
  const field=(label:string,id:string,content:ReactNode) => <label htmlFor={id} className="grid gap-1.5 text-sm">{label}{content}</label>;
  const currencyOptions=[...(summary?.currencies.filter(item => ['USD','EUR','GBP','JPY'].includes(item.code)) ?? []),...(summary?.currencies.filter(item => !['USD','EUR','GBP','JPY'].includes(item.code)) ?? [])];
  return <div className="space-y-5">
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Compras em moeda estrangeira</h2><p className="mt-1 max-w-prose text-sm text-slate-500">Informe a taxa usada ou o valor em reais. Depois, confira a cobrança no extrato ou na fatura.</p></div><div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={() => void refresh()} className="text-sm font-semibold text-brand-700 disabled:opacity-50 dark:text-brand-300">Atualizar compras</button>{writer && <button className={button} disabled={busy || !summary} onClick={() => choose({kind:'create'})}>Cadastrar compra internacional</button>}</div></div>
      <p className="text-sm text-slate-500">Uma conversão estimada já entra no saldo e nas previsões. A confirmação usa o valor efetivamente cobrado. O IOF fica separado na categoria Impostos e taxas.</p>
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}{notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {writer && action && <form key={`${action.kind}-${selected?.id ?? 'new'}`} onSubmit={submit} className={`${panel} grid gap-4 sm:grid-cols-2`} aria-label={action.kind==='create' ? 'Nova compra internacional' : action.kind==='confirm' ? 'Confirmar conversão' : 'Atualizar estimativa cambial'}>
      <h2 className="font-semibold sm:col-span-2">{action.kind==='create' ? 'Nova compra internacional' : action.kind==='confirm' ? `Confirmar: ${selected?.description ?? ''}` : `Atualizar estimativa: ${selected?.description ?? ''}`}</h2>
      {action.kind==='create' && <>
        {field('Descrição','fx-description',<input id="fx-description" name="description" maxLength={200} required className={input}/>)}
        {field('Moeda','fx-currency',<select id="fx-currency" aria-label="Moeda" value={currency} onChange={event => setCurrency(event.target.value)} className={input}>{currencyOptions.map(item => <option key={item.code} value={item.code}>{item.code}</option>)}</select>)}
        {field(`Valor original (${currency})`,'fx-original',<input id="fx-original" value={original} onChange={event => setOriginal(event.target.value)} inputMode="decimal" required className={input}/>)}
        {field('Pagamento','fx-method',<select id="fx-method" aria-label="Pagamento" value={method} onChange={event => setMethod(event.target.value as 'card' | 'cash')} className={input}><option value="card">Cartão de crédito</option><option value="cash">Conta à vista</option></select>)}
        {method==='card' ? <>{field('Cartão','fx-card',<select id="fx-card" aria-label="Cartão" name="card" required className={input}><option value="">Selecione</option>{workspace.cards.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>)}{field('Parcelas','fx-installments',<input id="fx-installments" name="installments" type="number" min={1} max={600} step={1} defaultValue={1} required className={input}/>)}</> : field('Conta à vista','fx-account',<select id="fx-account" aria-label="Conta à vista" name="account" required className={input}><option value="">Selecione</option>{workspace.accounts.filter(item => item.liquidity==='cash').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>)}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={split} onChange={event => {setSplit(event.target.checked);if(event.target.checked && parts.length===0) setParts([crypto.randomUUID(),crypto.randomUUID()]);}}/>Dividir entre categorias pelo valor na moeda estrangeira</label>
        {!split ? field('Categoria','fx-category',<select id="fx-category" aria-label="Categoria" name="category" required className={input}><option value="">Selecione</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>) : <div className="space-y-3 sm:col-span-2">{parts.map((id,index) => <div key={id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">{field(`Categoria ${index+1}`,`fx-category-${id}`,<select id={`fx-category-${id}`} aria-label={`Categoria ${index+1}`} name={`category-${id}`} required className={input}><option value="">Selecione</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>)}{field(`Valor ${index+1} (${currency})`,`fx-part-${id}`,<input id={`fx-part-${id}`} name={`part-${id}`} inputMode="decimal" required className={input}/>)}<button type="button" disabled={busy || parts.length<=1} onClick={() => setParts(current => current.filter(item => item!==id))} className="py-2 text-sm">Remover categoria {index+1}</button></div>)}<button type="button" disabled={busy || parts.length>=100} onClick={() => setParts(current => [...current,crypto.randomUUID()])} className="text-sm font-semibold text-brand-700 dark:text-brand-300">Adicionar categoria</button><p className="text-xs text-slate-500">Os valores por categoria devem somar o valor original. A divisão em reais mantém o total cobrado.</p></div>}
      </>}
      {field(action.kind==='create' ? 'Data da compra' : 'Data da confirmação / atualização','fx-date',<input id="fx-date" name="date" type="date" defaultValue={workspace.space.today} min={selected?.on} required className={input}/>)}
      {action.kind==='create' && field('Conversão informada','fx-entry-mode',<select id="fx-entry-mode" aria-label="Conversão informada" value={entryMode} onChange={event => setEntryMode(event.target.value as 'rate' | 'brl')} className={input}><option value="rate">Taxa de câmbio</option><option value="brl">Valor cobrado em reais</option></select>)}
      {entryMode==='rate' ? field('Taxa: reais por unidade da moeda','fx-rate',<input id="fx-rate" value={rate} onChange={event => setRate(event.target.value)} inputMode="decimal" required className={input}/>) : field('Valor da compra em reais (sem IOF)','fx-brl',<input id="fx-brl" value={brl} onChange={event => setBrl(event.target.value)} inputMode="decimal" required className={input}/>)}
      {action.kind!=='reestimate' && <>
        {field(action.kind==='confirm' ? 'IOF final em reais (informe 0 se não houve)' : 'IOF em reais (opcional)','fx-iof',<input id="fx-iof" value={iof} onChange={event => setIof(event.target.value)} inputMode="decimal" required={action.kind==='confirm'} className={input}/>)}
        {action.kind==='create' ? <>{field('Data do IOF (se diferente)','fx-iof-date',<input id="fx-iof-date" name="iof_date" type="date" className={input}/>)}<label className="flex items-center gap-2 text-sm"><input name="confirmed" type="checkbox"/>Este já é o valor final cobrado em reais</label></> : field('Origem do valor confirmado','fx-source',<select id="fx-source" aria-label="Origem do valor confirmado" name="source" defaultValue={selected?.card_id ? 'invoice' : 'statement'} className={input}><option value="invoice">Fatura do cartão</option><option value="statement">Extrato bancário</option><option value="user">Informado manualmente</option></select>)}
      </>}
      {(quote || quoteError) && <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800 sm:col-span-2" aria-live="polite">{quoteError ? <p className="text-red-700 dark:text-red-300">{quoteError}</p> : quote && <>
        <p className="font-semibold">{quote.total_cents===null ? 'Informe uma taxa ou o valor em reais para converter.' : `${quote.suggested ? 'Com a última taxa registrada: ' : 'Valor em reais: '}${money(quote.total_cents)}`}</p>
        {quote.rate && <p className="text-slate-500">Taxa aplicada: {privacy ? '••••' : decimalLabel(quote.rate)} reais por unidade de {currency}.</p>}
        {quote.suggested && quote.rate && <><p className="text-slate-500">Esta é uma sugestão baseada no último registro deste espaço. Confira a taxa que deseja usar.</p>{action.kind!=='confirm' && <button type="button" onClick={() => {setRate(quote.rate!);setEntryMode('rate');}} className="font-semibold text-brand-700 dark:text-brand-300">Usar última taxa registrada</button>}</>}
        {action.kind!=='reestimate' && quote.iof_suggestion_cents!==null && quote.iof_suggestion_cents!==undefined && <p className="text-slate-500">Sugestão de IOF: {money(quote.iof_suggestion_cents)}. <button type="button" onClick={() => setIof(amountInput(quote.iof_suggestion_cents!))} className="font-semibold text-brand-700 dark:text-brand-300">Usar sugestão de IOF</button></p>}
      </>}</div>}
      {selected && <p className="text-sm text-slate-500 sm:col-span-2">{selected.closed_statement ? 'Uma fatura desta compra está fechada. O valor original será preservado; a diferença será ligada à compra. Se a fatura já foi paga ou passou do vencimento, o ajuste entra no próximo ciclo disponível.' : 'Uma compra em período aberto pode ter seu valor em reais atualizado. A confirmação ficará registrada no histórico.'}</p>}
      <div className="flex gap-3 sm:col-span-2"><button disabled={busy || quote?.total_cents==null || Boolean(quoteError)} className={button}>{busy ? 'Salvando…' : action.kind==='create' ? 'Registrar compra' : action.kind==='confirm' ? 'Confirmar valor cobrado' : 'Salvar estimativa'}</button><button type="button" disabled={busy} onClick={() => setAction(null)} className="text-sm">Cancelar</button></div>
    </form>}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-semibold">Compras registradas</h2>{field('Mostrar compras','fx-filter',<select id="fx-filter" aria-label="Mostrar compras" value={filter} onChange={event => setFilter(event.target.value)} className={input}><option value="pending">Conversões pendentes</option><option value="confirmed">Confirmadas</option><option value="all">Todas, incluindo canceladas</option></select>)}</div>
      {!summary && !error ? <p className="text-sm text-slate-500">Carregando…</p> : summary && visible.length===0 && <p className="text-sm text-slate-500">Nenhuma compra nesta lista. Registre uma compra ou escolha outro filtro para consultar o histórico.</p>}
      {visible.map(purchase => <article key={purchase.id} className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" aria-label={purchase.description}>
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{purchase.description}</h3><span className={`text-xs ${purchase.conversion_status==='estimated' && purchase.transaction_status==='posted' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>{purchase.transaction_status==='cancelled' ? 'Compra cancelada' : purchase.conversion_status==='confirmed' ? 'Conversão confirmada' : 'Conversão estimada'}</span></div>
        <p className="text-xs text-slate-500">{day(purchase.on)} · {workspace.cards.find(item => item.id===purchase.card_id)?.name ?? workspace.accounts.find(item => item.id===purchase.account_id)?.name ?? (purchase.card_id ? 'Cartão' : 'Conta')}{purchase.installments>1 ? ` · ${purchase.installments} parcelas` : ''}</p>
        <dl className="grid gap-3 sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Valor original ({purchase.original_currency})</dt><dd className="mt-1 font-semibold">{privacy ? '••••' : decimalLabel(purchase.original_amount,purchase.minor_unit)}</dd></div><div><dt className="text-xs text-slate-500">Compra em reais</dt><dd className="mt-1 font-semibold">{money(purchase.current_brl_cents)}</dd></div><div><dt className="text-xs text-slate-500">IOF separado</dt><dd className="mt-1 font-semibold">{money(purchase.iof_cents)}</dd></div><div><dt className="text-xs text-slate-500">Taxa registrada</dt><dd className="mt-1 font-semibold">{privacy ? '••••' : decimalLabel(purchase.exchange_rate)}</dd></div></dl>
        <p className="text-xs text-slate-500">{sourceLabels[purchase.rate_source]}{purchase.confirmation_transaction_id ? ' · Diferença registrada em um ajuste ligado à compra.' : ''}</p>
        {purchase.changed_after_conversion && <p className="text-xs text-slate-500">O valor em reais foi corrigido depois da conversão. Consulte o histórico para ver o valor e a taxa registrados naquele momento.</p>}
        {purchase.transaction_status==='cancelled' && purchase.iof_cents>0 && <p className="text-xs text-slate-500">A compra foi cancelada. A cobrança de IOF continua registrada separadamente.</p>}
        {writer && purchase.transaction_status==='posted' && purchase.conversion_status==='estimated' && <div className="flex flex-wrap gap-4 text-sm font-semibold text-brand-700 dark:text-brand-300"><button disabled={busy} onClick={() => choose({kind:'confirm',purchase:purchase.id})}>Confirmar conversão</button>{purchase.can_reestimate && <button disabled={busy} onClick={() => choose({kind:'reestimate',purchase:purchase.id})}>Atualizar taxa estimada</button>}</div>}
        <details className="text-xs text-slate-500"><summary className="cursor-pointer">Histórico da conversão</summary>{(purchase.changed_after_conversion || purchase.transaction_status==='cancelled') && purchase.recorded_brl_cents!==undefined && <p className="mt-2">Valor registrado na conversão: {money(purchase.recorded_brl_cents)}. A taxa registrada foi preservada; o valor atual em reais acompanha as correções e cancelamentos do lançamento.</p>}<ul className="mt-2 space-y-1">{purchase.events.map((item,index) => <li key={`${item.at}-${index}`}>{day(item.at)} · {eventLabels[item.action] ?? 'Conversão atualizada'}</li>)}</ul></details>
      </article>)}
    </section>
    {administrator && summary && <details className={panel}><summary className="cursor-pointer text-sm font-semibold">Sugestão de IOF deste espaço</summary><form key={summary.settings_version} onSubmit={saveIof} className="mt-4 grid items-end gap-4 sm:grid-cols-[1fr_auto]">{field('Percentual sugerido de IOF (%)','fx-iof-percent',<input id="fx-iof-percent" name="percent" inputMode="decimal" defaultValue={privacy || summary.iof_percent===null ? '' : String(summary.iof_percent).replace('.',',')} className={input}/>)}<button disabled={busy} className={button}>Salvar percentual</button><p className="text-xs text-slate-500 sm:col-span-2">Informe o percentual que deseja usar nas sugestões. Deixe vazio para desativar. O valor cobrado deve ser confirmado no extrato ou na fatura.</p></form></details>}
  </div>;
}
