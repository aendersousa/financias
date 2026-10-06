import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import { shiftDays } from '../../../shared/finance/calendar';

type Holder = { id:string; name:string; kind:string; last_digits:string | null; person_id:string | null; is_active:boolean; version:number };
type Authorization = { id:string; description:string; amount_cents:number; authorized_on:string; expires_on:string | null; release_on:string | null; kind:string; status:string; version:number };
type Statement = { id:string; reference_month:string; period_start:string; closing_on:string; due_on:string; effective_due_on:string; status:string; remaining_cents:number; version:number };
interface Card {
  id:string; name:string; issuer_name:string | null; brand:string | null; last_digits:string | null; status:'active' | 'cancelled' | 'archived'; version:number; started_on:string | null;
  closing_day:number; due_day:number; closing_day_purchase_goes_next:boolean; installment_remainder:string; default_payment_financial_account_id:string | null; default_refund_model:string;
  limit_release_days_pix:number; limit_release_days_debit:number; limit_release_days_boleto:number; revolving_interest_monthly_percent:number | null; late_fee_percent:number; late_interest_monthly_percent:number;
  balance_cents:number; granted_cents:number; used_cents:number; free_cents:number; opening_bank_used_cents:number | null; opening_difference_cents:number | null; holders:Holder[]; authorizations:Authorization[]; statements:Statement[];
  limit_history:{ id:string; valid_from:string; limit_cents:number; reason:string | null }[]; recurrences:{ id:string; title:string }[]; commitments:{ id:string; title:string; due_on:string }[]; out_of_period_purchases:{ transaction_id:string; description:string; on:string }[];
}
const panel='card p-5 dark:border-slate-800 dark:bg-slate-900';
const input='w-full field-input px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800';
const button='rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const date=(value:string) => value.split('-').reverse().join('/');
type Mode='settings' | 'holder' | 'authorization' | 'limit' | 'opening' | 'statement';

export default function LedgerCardManagement({ workspace,money,onChanged }: { workspace:LedgerWorkspace; money:(value:number) => string; onChanged:() => Promise<void> }) {
  const [cards,setCards]=useState<Card[] | null>(null);
  const [selected,setSelected]=useState('');
  const [mode,setMode]=useState<Mode>('settings');
  const [holderId,setHolderId]=useState('');
  const [authorizationId,setAuthorizationId]=useState('');
  const [statementId,setStatementId]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [closedRows,setClosedRows]=useState<string[]>([]);
  const [installmentRows,setInstallmentRows]=useState<string[]>([]);
  const pending=useRef(false);
  const request=useRef<{ key:string; id:string } | null>(null);
  const [bankUsed,setBankUsed]=useState('');
  async function load() { const result=await ledgerRpc<{cards:Card[]}>('card_management_summary',{p_space:workspace.space.id}); setCards(result.cards); }
  useEffect(() => {
    let cancelled=false; setCards(null); setError('');
    void ledgerRpc<{cards:Card[]}>('card_management_summary',{p_space:workspace.space.id}).then(result => { if(!cancelled) setCards(result.cards); }).catch(() => { if(!cancelled) setError('Não foi possível carregar a gestão dos cartões.'); });
    return () => { cancelled=true; };
  },[workspace]);
  const card=cards?.find(item => item.id===selected) ?? cards?.[0];
  const holder=card?.holders.find(item => item.id===holderId);
  const authorization=card?.authorizations.find(item => item.id===authorizationId);
  const statement=card?.statements.find(item => item.id===statementId);
  const writer=workspace.role!=='viewer';
  const administrator=workspace.role==='owner' || workspace.role==='admin';
  useEffect(() => { if(!administrator) setMode('authorization'); },[administrator]);
  const changeMode=(value:Mode) => { if(pending.current) return; setMode(value); request.current=null; setError(''); setNotice(''); };
  async function mutate(name:string,args:Record<string,unknown>,message:string) {
    if(pending.current) return;
    pending.current=true; setBusy(true); setError(''); setNotice('');
    const key=JSON.stringify({name,...args}); if(request.current?.key!==key) request.current={key,id:crypto.randomUUID()};
    try {
      await ledgerRpc(name,{p_space:workspace.space.id,...args,p_client_uuid:request.current.id});
      await load(); await onChanged(); request.current=null; setNotice(message);
    } catch(failure) {
      const text=failure instanceof Error ? failure.message : '';
      const translated=text.includes('Administrator permission') ? 'Somente proprietários e administradores podem alterar este cadastro.' : text.includes('changed; reload') ? 'Esse cadastro mudou. Atualize os dados antes de tentar novamente.' : text.includes('future entries, authorizations or payment plans') ? 'Antes de arquivar, zere a dívida ou crédito, resolva autorizações e redirecione compromissos e recorrências. Parcelas futuras também precisam terminar.' : text.includes('collide') || text.includes('already exists') ? 'Essa data coincide com um registro existente. Confira as faturas ou o histórico do limite.' : text.includes('month is closed') ? 'Reabra o mês antes de alterar a abertura inicial.' : text.includes('Closed statement') ? 'O período de uma fatura fechada está protegido.' : text.includes('Paid statement') ? 'A fatura já está quitada e seu vencimento está protegido.' : text.includes('unused active card') ? 'A abertura inicial exige um cartão ativo que ainda não tenha lançamentos.' : 'Não foi possível salvar. Confira os dados e tente novamente.';
      setError(translated);
    } finally { pending.current=false; setBusy(false); }
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!card || pending.current) return;
    const form=new FormData(event.currentTarget),text=(name:string) => String(form.get(name) ?? '').trim(),amount=(name:string) => parseBrlCents(text(name) || '0');
    try {
      if(mode==='settings') {
        const payload:Record<string,unknown>={name:text('name'),issuer_name:text('issuer_name') || null,brand:text('brand') || null,last_digits:text('last_digits') || null,closing_day:Number(text('closing_day')),due_day:Number(text('due_day')),closing_day_purchase_goes_next:form.has('goes_next'),installment_remainder:text('remainder'),default_payment_financial_account_id:text('account') || null,default_refund_model:text('refund_model'),limit_release_days_pix:Number(text('release_pix')),limit_release_days_debit:Number(text('release_debit')),limit_release_days_boleto:Number(text('release_boleto')),revolving_interest_monthly_percent:text('revolving') ? Number(text('revolving').replace(',','.')) : null,late_fee_percent:Number(text('late_fee').replace(',','.')),late_interest_monthly_percent:Number(text('late_interest').replace(',','.'))};
        if(Object.values(payload).some(value => typeof value==='number' && !Number.isFinite(value))) throw new Error('Informe números válidos nas datas, prazos e taxas.');
        await mutate('manage_card',{p_card:card.id,p_version:card.version,p_action:'settings',p_payload:payload},'Regras atualizadas. As parcelas mantiveram suas faturas e valores.');
      } else if(mode==='limit') await mutate('manage_card',{p_card:card.id,p_version:card.version,p_action:'limit',p_payload:{amount_cents:amount('amount'),valid_from:text('date'),reason:text('reason')}},'Novo limite registrado no histórico.');
      else if(mode==='holder') await mutate('manage_card_holder',{p_card:card.id,p_holder:holder?.id ?? null,p_version:holder?.version ?? null,p_action:holder ? 'edit' : 'create',p_payload:{name:text('name'),kind:holder?.kind==='main' ? 'main' : text('kind'),last_digits:text('digits') || null,person_id:text('person') || null}},'Portador salvo.');
      else if(mode==='authorization') await mutate('manage_card_authorization',{p_card:card.id,p_authorization:authorization?.id ?? null,p_version:authorization?.version ?? null,p_action:authorization ? 'edit' : 'create',p_payload:{description:text('description'),amount_cents:amount('amount'),on:text('date'),expires_on:text('expires') || null}},'Autorização salva. Ela afeta apenas o limite até virar uma compra.');
      else if(mode==='statement') {
        if(!statement) throw new Error('Selecione a fatura.');
        await mutate('edit_card_statement_dates',{p_statement:statement.id,p_version:statement.version,p_payload:{period_start:text('period_start'),closing_on:text('closing_on'),due_on:text('due_on'),effective_due_on:text('effective_due_on')}},'Datas da fatura atualizadas. Confira as compras fora do período.');
      } else {
        const closed_statements=closedRows.map(id => ({period_start:text(`start-${id}`),closing_on:text(`close-${id}`),due_on:text(`due-${id}`),amount_cents:amount(`amount-${id}`)}));
        const installments=installmentRows.map(id => ({description:text(`description-${id}`),from:Number(text(`from-${id}`)),count:Number(text(`count-${id}`)),amount_cents:amount(`part-${id}`)}));
        await mutate('configure_card_opening',{p_card:card.id,p_on:text('date'),p_payload:{closed_statements,open_amount_cents:amount('open_amount'),installments,bank_used_cents:bankUsed ? parseBrlCents(bankUsed) : null}},'Dívida inicial registrada. Compare o limite utilizado abaixo com o valor informado pelo banco.');
      }
    } catch(failure) { setError(failure instanceof Error ? failure.message : 'Confira os campos.'); }
  }
  const field=(label:string,name:string,defaultValue:string | number='',type='text',required=false) => <label className="grid gap-1.5 text-sm">{label}<input aria-label={label} name={name} type={type} defaultValue={defaultValue} required={required} className={input} {...(type==='number' ? {min:['closing_day','due_day'].includes(name) || name.startsWith('from-') || name.startsWith('count-') ? 1 : 0,step:1,...(['closing_day','due_day'].includes(name) ? {max:31} : {})} : {})}/></label>;
  if(!cards && !error) return <section className={panel}><h2 className="font-semibold">Gestão dos cartões</h2><p className="mt-3 text-sm text-slate-500">Carregando…</p></section>;
  if(!card) return <section className={panel}><h2 className="font-semibold">Gestão dos cartões</h2><p className="mt-3 text-sm text-slate-500">{error || 'Cadastre um cartão para configurar suas regras e seu saldo inicial.'}</p></section>;
  return <section className={`${panel} space-y-5`} aria-label="Gestão dos cartões">
    <div><h2 className="font-semibold">Gestão dos cartões</h2><p className="mt-1 text-sm text-slate-500">Configure portadores, datas, limite e compras em processamento.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}{notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
    <label className="grid gap-1.5 text-sm">Cartão<select aria-label="Cartão" value={card.id} onChange={event => {setSelected(event.target.value);setHolderId('');setAuthorizationId('');setStatementId('');setClosedRows([]);setInstallmentRows([]);setBankUsed('');request.current=null;}} className={input}>{cards?.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status==='active' ? 'ativo' : item.status==='cancelled' ? 'cancelado' : 'arquivado'}</option>)}</select></label>
    <dl className="grid gap-3 sm:grid-cols-3">{[['Limite concedido',card.granted_cents],['Limite utilizado',card.used_cents],['Limite livre',card.free_cents]].map(([label,value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{money(value as number)}</dd></div>)}</dl>
    {card.status==='cancelled' && (card.recurrences.length>0 || card.commitments.length>0) && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"><p className="font-semibold">Redirecione os pagamentos deste cartão na Agenda e nas recorrências.</p>{[...card.recurrences,...card.commitments].map((item,index) => <p key={`${item.id}-${index}`} className="mt-1">{item.title}</p>)}</div>}
    {card.out_of_period_purchases.length>0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"><p className="font-semibold">Confira as compras fora do novo período da fatura.</p>{card.out_of_period_purchases.map(item => <p key={item.transaction_id} className="mt-1">{date(item.on)} · {item.description}</p>)}<p className="mt-2">Ajuste a fatura do lançamento enquanto as faturas de origem e destino estiverem abertas.</p></div>}
    {writer && <>
      <div className="flex flex-wrap gap-2">{card.status!=='archived' && ([['settings','Regras'],['holder','Portadores'],['authorization','Autorizações'],['limit','Limite'],['statement','Datas de fatura']] as const).filter(([value]) => administrator || value==='authorization').map(([value,label]) => <button key={value} disabled={busy} onClick={() => changeMode(value)} className={`rounded-xl px-3 py-2 text-sm disabled:opacity-50 ${mode===value ? 'bg-teal-700 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{label}</button>)}{administrator && card.status==='active' && card.started_on===null && card.balance_cents===0 && <button disabled={busy} onClick={() => changeMode('opening')} className={`rounded-xl px-3 py-2 text-sm disabled:opacity-50 ${mode==='opening' ? 'bg-teal-700 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>Cartão já em uso</button>}</div>
      {(administrator || mode==='authorization') && card.status!=='archived' && !(mode==='opening' && card.started_on!==null) && <form key={`${card.id}-${mode}-${holderId}-${authorizationId}-${statementId}-${card.version}`} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {mode==='settings' && <>
          {field('Nome','name',card.name,'text',true)}{field('Emissor','issuer_name',card.issuer_name ?? '')}{field('Bandeira','brand',card.brand ?? '')}{field('Últimos quatro dígitos','last_digits',card.last_digits ?? '')}{field('Dia de fechamento','closing_day',card.closing_day,'number',true)}{field('Dia de vencimento','due_day',card.due_day,'number',true)}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="goes_next" defaultChecked={card.closing_day_purchase_goes_next}/>Compra no dia do fechamento vai para a fatura seguinte</label>
          <label className="grid gap-1.5 text-sm">Centavo restante nas parcelas<select aria-label="Centavo restante nas parcelas" name="remainder" defaultValue={card.installment_remainder} className={input}><option value="first">Primeira parcela</option><option value="last">Última parcela</option></select></label>
          <label className="grid gap-1.5 text-sm">Conta de pagamento padrão<select aria-label="Conta de pagamento padrão" name="account" defaultValue={card.default_payment_financial_account_id ?? ''} className={input}><option value="">Selecionar ao pagar</option>{workspace.accounts.filter(item => ['cash','investment'].includes(item.liquidity)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm sm:col-span-2">Modelo padrão de estorno<select aria-label="Modelo padrão de estorno" name="refund_model" defaultValue={card.default_refund_model} className={input}><option value="cancel_remaining">Cancelar parcelas restantes primeiro</option><option value="credit_open_statement">Crédito integral na fatura aberta</option></select></label>
          {field('Liberação do limite após Pix (dias úteis)','release_pix',card.limit_release_days_pix,'number')}{field('Após débito (dias úteis)','release_debit',card.limit_release_days_debit,'number')}{field('Após boleto (dias úteis)','release_boleto',card.limit_release_days_boleto,'number')}{field('Juros do rotativo estimados (% ao mês)','revolving',card.revolving_interest_monthly_percent ?? '')}{field('Multa estimada (%)','late_fee',card.late_fee_percent)}{field('Juros de mora estimados (% ao mês)','late_interest',card.late_interest_monthly_percent)}
          <p className="text-xs text-slate-500 sm:col-span-2">Datas novas afetam somente faturas abertas e futuras. As parcelas mantêm seus valores e seus registros de fatura. Taxas servem apenas para estimar os encargos.</p>
        </>}
        {mode==='limit' && <>{field('Novo limite (R$)','amount','','text',true)}{field('Início da vigência','date',shiftDays(workspace.space.today,1),'date',true)}{field('Motivo da alteração (mínimo 10 caracteres)','reason','','text',true)}<p className="text-xs text-slate-500">Escolha uma data ainda sem registro no histórico. Um limite futuro passa a valer naquela data.</p></>}
        {mode==='holder' && <>
          <label className="grid gap-1.5 text-sm sm:col-span-2">Portador<select aria-label="Portador" value={holderId} onChange={event => setHolderId(event.target.value)} className={input}><option value="">Novo portador</option>{card.holders.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_active ? '' : ' · desativado'}</option>)}</select></label>
          {field('Nome ou apelido','name',holder?.name ?? '','text',true)}{field('Últimos quatro dígitos','digits',holder?.last_digits ?? '')}
          <label className="grid gap-1.5 text-sm">Tipo<select aria-label="Tipo" name="kind" defaultValue={holder?.kind ?? 'additional'} disabled={holder?.kind==='main'} className={input}>{holder?.kind==='main' && <option value="main">Titular</option>}<option value="additional">Adicional</option><option value="virtual">Virtual</option></select></label>
          <label className="grid gap-1.5 text-sm">Pessoa ligada (opcional)<select aria-label="Pessoa ligada (opcional)" name="person" defaultValue={holder?.person_id ?? ''} className={input}><option value="">Nenhuma</option>{workspace.people.map(item => <option key={item.id} value={item.id}>{item.nickname}</option>)}</select></label><p className="text-xs text-slate-500 sm:col-span-2">A pessoa identifica o portador. Um valor que ela precisa devolver deve ser registrado como parte de pessoa no lançamento.</p>
        </>}
        {mode==='authorization' && <>
          <label className="grid gap-1.5 text-sm sm:col-span-2">Compra em processamento<select aria-label="Compra em processamento" value={authorizationId} onChange={event => setAuthorizationId(event.target.value)} className={input}><option value="">Nova autorização</option>{card.authorizations.filter(item => item.kind==='purchase' && item.status==='pending').map(item => <option key={item.id} value={item.id}>{item.description} · {money(item.amount_cents)}</option>)}</select></label>
          {field('Descrição','description',authorization?.description ?? '','text',true)}{field('Valor reservado (R$)','amount',authorization ? (authorization.amount_cents/100).toFixed(2).replace('.',',') : '','text',true)}{field('Data da autorização','date',authorization?.authorized_on ?? workspace.space.today,'date',true)}{field('Validade','expires',authorization?.expires_on ?? shiftDays(workspace.space.today,30),'date',true)}<p className="text-xs text-slate-500 sm:col-span-2">Autorizações afetam apenas o limite. Vincule a autorização à compra quando o banco confirmar o valor efetivo.</p>
        </>}
        {mode==='statement' && <>
          <label className="grid gap-1.5 text-sm sm:col-span-2">Fatura<select aria-label="Fatura" value={statementId} required onChange={event => setStatementId(event.target.value)} className={input}><option value="">Selecione</option>{card.statements.map(item => <option key={item.id} value={item.id}>{item.reference_month.slice(0,7)} · {item.status==='closed' ? 'fechada' : item.status==='open' ? 'aberta' : 'futura'} · {money(item.remaining_cents)}</option>)}</select></label>
          {statement && <>{field('Início do período','period_start',statement.period_start,'date',true)}{field('Fechamento','closing_on',statement.closing_on,'date',true)}{field('Vencimento nominal','due_on',statement.due_on,'date',true)}{field('Vencimento efetivo','effective_due_on',statement.effective_due_on,'date',true)}<p className="text-xs text-slate-500 sm:col-span-2">O período de uma fatura fechada permanece protegido. Seu vencimento só pode mudar enquanto houver saldo.</p></>}
        </>}
        {mode==='opening' && <>
          {field('Data de início no app','date',workspace.space.today,'date',true)}{field('Saldo da fatura aberta (R$)','open_amount','0,00','text',true)}
          <p className="text-sm text-slate-500 sm:col-span-2">O saldo da fatura aberta já deve incluir as parcelas que caem nela. Abaixo cadastre só as parcelas seguintes.</p>
          {closedRows.map((id,index) => <fieldset key={id} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2 dark:border-slate-800"><legend className="text-sm font-semibold">Fatura fechada não paga {index+1}</legend>{field('Início do período',`start-${id}`,'','date',true)}{field('Fechamento',`close-${id}`,'','date',true)}{field('Vencimento nominal',`due-${id}`,'','date',true)}{field('Saldo restante (R$)',`amount-${id}`,'','text',true)}<button type="button" onClick={() => setClosedRows(rows => rows.filter(value => value!==id))} className="text-left text-sm text-red-700 dark:text-red-300">Remover fatura</button></fieldset>)}
          <button type="button" onClick={() => setClosedRows(rows => [...rows,crypto.randomUUID()])} className="text-left text-sm font-semibold text-teal-700 dark:text-teal-300">Adicionar fatura fechada não paga</button>
          {installmentRows.map((id,index) => <fieldset key={id} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2 dark:border-slate-800"><legend className="text-sm font-semibold">Compra antiga parcelada {index+1}</legend>{field('Descrição',`description-${id}`,'','text',true)}{field('Valor da parcela (R$)',`part-${id}`,'','text',true)}{field('Próxima parcela depois da aberta (k)',`from-${id}`,'','number',true)}{field('Total de parcelas (N)',`count-${id}`,'','number',true)}<button type="button" onClick={() => setInstallmentRows(rows => rows.filter(value => value!==id))} className="text-left text-sm text-red-700 dark:text-red-300">Remover compra</button></fieldset>)}
          <button type="button" onClick={() => setInstallmentRows(rows => [...rows,crypto.randomUUID()])} className="text-left text-sm font-semibold text-teal-700 dark:text-teal-300">Adicionar parcelamento em andamento</button><p className="text-xs text-slate-500 sm:col-span-2">A dívida inicial entra contra o saldo inicial e preserva seu consumo. Depois de salvar, compare o limite utilizado com o banco.</p>
        </>}
        <div className="sm:col-span-2"><button disabled={busy || mode==='statement' && !statement || mode==='authorization' && card.status==='cancelled' && !authorization} className={button}>{busy ? 'Salvando…' : mode==='opening' ? 'Registrar dívida inicial' : 'Salvar'}</button></div>
      </form>}
      {holder && mode==='holder' && holder.kind!=='main' && <button disabled={busy} onClick={() => void mutate('manage_card_holder',{p_card:card.id,p_holder:holder.id,p_version:holder.version,p_action:holder.is_active ? 'deactivate' : 'activate'},holder.is_active ? 'Portador desativado. O histórico foi preservado.' : 'Portador reativado.')} className="text-sm font-semibold text-teal-700 disabled:opacity-50 dark:text-teal-300">{holder.is_active ? 'Desativar portador' : 'Reativar portador'}</button>}
      {authorization && mode==='authorization' && <button disabled={busy} onClick={() => void mutate('manage_card_authorization',{p_card:card.id,p_authorization:authorization.id,p_version:authorization.version,p_action:'cancel'},'Autorização cancelada. O limite foi atualizado.')} className="text-sm font-semibold text-red-700 disabled:opacity-50 dark:text-red-300">Cancelar autorização</button>}
      {administrator && <div className="flex flex-wrap gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">{(card.status==='active' ? [['cancel','Cancelar cartão']] : card.status==='cancelled' ? [['reactivate','Reativar cartão'],['archive','Arquivar cartão']] : [['restore','Desarquivar cartão']]).map(([action,label]) => <button key={action} disabled={busy} onClick={() => void mutate('manage_card',{p_card:card.id,p_version:card.version,p_action:action},action==='cancel' ? 'Cartão cancelado. Redirecione as recorrências e contas da Agenda que o utilizam.' : action==='restore' ? 'Cartão desarquivado no estado cancelado.' : 'Estado do cartão atualizado.')} className="text-sm font-semibold text-teal-700 disabled:opacity-50 dark:text-teal-300">{label}</button>)}</div>}
    </>}
    {mode==='opening' && <label className="grid gap-1.5 text-sm">Limite utilizado informado pelo banco, sem compras em processamento (para conferir)<input value={bankUsed} onChange={event => setBankUsed(event.target.value)} inputMode="decimal" className={input}/><span className="text-xs text-slate-500">No app: {money(card.used_cents)}. Compare os valores após registrar a dívida inicial.</span></label>}
    {card.opening_bank_used_cents!==null && <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800"><p>Limite utilizado informado na abertura: {money(card.opening_bank_used_cents)}.</p><p className="mt-1">Diferença em relação à posição atual: {money(card.opening_difference_cents!)}.</p><p className="mt-2 text-xs text-slate-500">Depois da abertura, compras e pagamentos alteram a posição atual.</p></div>}
    <details className="border-t border-slate-200 pt-3 dark:border-slate-800"><summary className="cursor-pointer text-sm font-semibold">Histórico de limites e autorizações</summary><div className="mt-4 space-y-3">{card.limit_history.map(item => <div key={item.id} className="flex flex-wrap justify-between gap-2 text-sm"><div>{date(item.valid_from)}{item.reason && <p className="mt-1 text-xs text-slate-500">{item.reason}</p>}</div><strong>{money(item.limit_cents)}</strong></div>)}{card.authorizations.map(item => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800"><div><p>{item.description}</p><p className="mt-1 text-xs text-slate-500">{item.kind==='payment_hold' ? 'Retenção por pagamento' : 'Compra em processamento'} · {item.status}{item.release_on ? ` · Liberação ${date(item.release_on)}` : item.expires_on ? ` · Validade ${date(item.expires_on)}` : ''}</p></div><strong>{money(item.amount_cents)}</strong></div>)}</div></details>
  </section>;
}
