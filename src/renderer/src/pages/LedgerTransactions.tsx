import LedgerForeignCurrency from './LedgerForeignCurrency'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Plus, Search, X, ArrowLeftRight, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { transactionFlow } from '../lib/transactionFlow'
import { parseBrlCents } from '../../../shared/finance/money'
import { todayInSpace } from '../../../shared/finance/calendar'
import { paymentMethods, paymentNote, type PaymentMethod } from '../../../shared/finance/paymentMethod'
import TransactionTable, { transactionKindLabels } from '../components/TransactionTable'
import CurrencyInput from '../components/CurrencyInput'
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository'
import type { ReserveSummary } from './LedgerReserves'
import LedgerEntryManagement, { type EntrySelection } from './LedgerEntryManagement'
import type { EntryPreset } from '../lib/entryPreferences'
import { activeUserId, offlineQueue, queueChanged, sendLocalQueue } from '../lib/offlineStorage'
import { validateQuickEntry, type QueueItem } from '../../../shared/finance/offlineQueue'
import LedgerTransactionActions from './LedgerTransactionActions'

type Kind='expense'|'income'|'transfer'|'card_purchase'|'card_payment'
const input='field-input w-full'
const labelClass='flex w-full flex-col gap-1.5'
const pageSize=7
export default function LedgerTransactions({workspace,money,reserves,online,onChanged,initialOpen=false}:{
  workspace:LedgerWorkspace
  money:(cents:number)=>string
  reserves:ReserveSummary|null
  online:boolean
  onChanged:()=>Promise<void>
  initialOpen?:boolean
}) {
  const [kind,setKind]=useState<Kind>('expense'),[nonce,setNonce]=useState(0)
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod|''>('')
  const [selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState(''),[status,setStatus]=useState('all')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [page,setPage]=useState(1)
  const [filtersOpen,setFiltersOpen]=useState(false)
  const [foreignOpen,setForeignOpen]=useState(false)
  const [foreignManagement,setForeignManagement]=useState(false)
  const [foreignTransactions,setForeignTransactions]=useState<Record<string,string>>({})
  useEffect(()=>{
    let cancelled=false;setForeignTransactions({});if(!online)return;
    void ledgerRpc<{purchases:{ledger_transaction_id:string;original_currency:string}[]}>('foreign_currency_summary',{p_space:workspace.space.id}).then(summary=>{if(!cancelled)setForeignTransactions(Object.fromEntries(summary.purchases.map(purchase=>[purchase.ledger_transaction_id,purchase.original_currency])))}).catch(()=>{});
    return ()=>{cancelled=true};
  },[workspace,online])
  const [entryOpen,setEntryOpen]=useState(()=>initialOpen||new URLSearchParams(location.search).get('quick')==='expense')
  const [flowFilter,setFlowFilter]=useState('all'),[accountFilter,setAccountFilter]=useState(''),[monthFilter,setMonthFilter]=useState('')
  const [entrySelection,setEntrySelection]=useState<EntrySelection|null>(null)
  const [preferencesRevision,setPreferencesRevision]=useState(0)
  const [suggestions,setSuggestions]=useState<{categoryId:string;name:string}[]>([])
  const suggestionRequest=useRef(0)
  const formRef=useRef<HTMLFormElement>(null)
  const preset=entrySelection?.preset
  const supportsPreferences=['expense','income','card_purchase'].includes(kind)
  const pending=useRef(false),requests=useRef(new Map<string,string>())
  const writer=workspace.role!=='viewer'
  const categories=workspace.categories.filter(category=>category.ledger_account_id&&category.kind===(kind==='income'?'income':'expense'))
  const goals=reserves?.reserves.filter(reserve=>reserve.reserve_type==='goal'&&['active','achieved'].includes(reserve.status))??[]
  const visible=workspace.transactions.filter(transaction=>{
    const entries=transaction.entries??[],flow=transactionFlow(entries)
    const matchesFlow=flowFilter==='all'||flowFilter==='foreign'&&Boolean(foreignTransactions[transaction.id])||flowFilter==='income'&&(flow==='Entrada'||transaction.kind==='income')||flowFilter==='expense'&&(flow==='Saída'||transaction.kind==='expense')||flowFilter==='transfer'&&(flow==='Transferência'||transaction.kind==='transfer')||flowFilter==='card'&&transaction.kind.startsWith('card_')
    const account=workspace.accounts.find(item=>item.id===accountFilter),card=workspace.cards.find(item=>item.id===accountFilter)
    const matchesAccount=!accountFilter||entries.some(entry=>entry.account_name===(account?.name??card?.name)&&['financial_account','credit_card'].includes(entry.owner_type))
    const content=[transaction.description,transactionKindLabels[transaction.kind]??'',...entries.map(entry=>entry.account_name)].join(' ').toLocaleLowerCase('pt-BR')
    return (status==='all'||transaction.status===status)&&matchesFlow&&matchesAccount&&(!monthFilter||transaction.occurred_on.startsWith(monthFilter))&&content.includes(search.trim().toLocaleLowerCase('pt-BR'))
  }).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on))
  const pageCount=Math.max(1,Math.ceil(visible.length/pageSize))
  const currentPage=Math.min(page,pageCount)
  const pageStart=(currentPage-1)*pageSize
  const pageTransactions=visible.slice(pageStart,pageStart+pageSize)
  useEffect(()=>{setPage(value=>Math.min(value,pageCount))},[pageCount])
  useEffect(()=>{if(!online)setSelected(null)},[online])
  useEffect(()=>{setPage(1);setSelected(null)},[flowFilter,accountFilter,monthFilter])
  function closeEntry(){if(pending.current)return;setEntryOpen(false);setError('')}
  function newEntry(operation:Kind='expense'){if(pending.current)return;resetEntry();setKind(operation);setPaymentMethod(operation==='card_purchase'?'credit_card':'');setError('');setNotice('');setEntryOpen(true)}
  useEffect(()=>{
    if(!entryOpen)return
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    formRef.current?.querySelector<HTMLElement>('input[name="name"], select')?.focus()
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape')closeEntry()
      if(event.key!=='Tab')return
      const fields=formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')
      const items=fields?[...fields].filter(field=>field.getClientRects().length):[]
      if(!items.length)return
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus()}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus()}
    }
    document.addEventListener('keydown',keydown)
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus()}
  },[entryOpen])
  function openDetails(id:string) {if(busy)return;setSelected(selected===id?null:id)}
  function useEntry(selection:EntrySelection) {
    if(pending.current||!writer)return
    setPaymentMethod(selection.preset.paymentMethod??(selection.preset.kind==='card_purchase'?'credit_card':''))
    setEntryOpen(true);setEntrySelection(selection);setKind(selection.preset.kind??'expense');setNonce(value=>value+1);setError('');setNotice('');setSelected(null);setSuggestions([]);suggestionRequest.current++
    requestAnimationFrame(()=>{formRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});formRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus({preventScroll:true})})
  }
  function resetEntry() {setEntrySelection(null);setNonce(value=>value+1);setSelected(null);setPage(1);setSuggestions([]);suggestionRequest.current++}
  async function suggest(description:string) {
    const request=++suggestionRequest.current
    if(!online||!supportsPreferences||description.trim().length<3){setSuggestions([]);return}
    try {const result=await ledgerRpc<{categoryId:string;name:string}[]>('suggest_entry_category',{p_space:workspace.space.id,p_description:description,p_kind:kind});if(request===suggestionRequest.current)setSuggestions(result)}
    catch {if(request===suggestionRequest.current)setSuggestions([])}
  }
  function entryPreset(values:FormData):EntryPreset {
    const text=(key:string)=>String(values.get(key)??'').trim()
    return {kind:kind as EntryPreset['kind'],description:text('name'),occurredOn:text('date'),paymentMethod:kind==='card_purchase'?'credit_card':paymentMethod||undefined,
      ...(text('amount')?{amountCents:parseBrlCents(text('amount'))}:{}),categoryId:text('category')||undefined,
      ...(kind==='card_purchase'?{cardId:text('card')||undefined,installments:Number(text('installments'))}:{accountId:text('account')||undefined}),reserveId:text('reserve')||undefined}
  }
  async function saveDraft() {
    if(!formRef.current||pending.current||!writer||!online||!supportsPreferences||entrySelection?.item)return
    pending.current=true;setBusy(true);setError('');setNotice('')
    try {
      const payload=entryPreset(new FormData(formRef.current)),key=JSON.stringify({draft:payload,space:workspace.space.id})
      if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID())
      await ledgerRpc('save_transaction_draft',{p_space:workspace.space.id,p_title:payload.description||'Lançamento por completar',p_payload:payload,p_draft:entrySelection?.draft?.id??null,p_version:entrySelection?.draft?.version??null,p_client_uuid:entrySelection?.draft?null:requests.current.get(key)})
      requests.current.delete(key);resetEntry();setEntryOpen(false);setPreferencesRevision(value=>value+1);setNotice('Rascunho salvo. Ele não altera saldos.')
    }catch(failure){setError(failure instanceof Error?failure.message:'Não foi possível salvar o rascunho.')}
    finally{pending.current=false;setBusy(false)}
  }
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(pending.current||!writer)return
    const values=new FormData(event.currentTarget),text=(key:string)=>String(values.get(key)??'').trim()
    pending.current=true;setBusy(true);setError('');setNotice('')
    try {
      const cents=parseBrlCents(text('amount'))
      if(cents<=0)throw new Error('O valor deve ser maior que zero.')
      const account=workspace.accounts.find(item=>item.id===text('account'))
      const category=categories.find(item=>item.id===text('category'))
      const date=text('date')
      if(!online||entrySelection?.item) {
        if(!supportsPreferences||text('reserve')||kind==='card_purchase'&&Number(text('installments'))!==1)throw new Error('Sem conexão, registre despesas e receitas à vista ou compras no cartão em 1x, sem vínculo com metas. As outras operações precisam de internet.')
        if(kind!=='card_purchase'&&!['cash','benefit'].includes(account?.liquidity??''))throw new Error('Escolha uma conta à vista ou de benefícios para salvar no aparelho.')
        const content={kind:kind as EntryPreset['kind'],amountCents:cents,description:text('name'),occurredOn:date,paymentMethod:kind==='card_purchase'?'credit_card' as const:paymentMethod||undefined,categoryId:category?.id??'',categoryLedgerId:category?.ledger_account_id??'',...(kind==='card_purchase'?{cardId:text('card')}:{accountId:account?.id,accountLedgerId:account?.ledger_account_id})}
        validateQuickEntry(content)
        const userId=await activeUserId()
        if(entrySelection?.item&&entrySelection.item.userId!==userId)throw new Error('O usuário mudou. Abra novamente o lançamento pendente.')
        const key=JSON.stringify({space:workspace.space.id,content})
        if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID())
        const item:QueueItem={clientUuid:entrySelection?.item?.clientUuid??requests.current.get(key)!,userId,spaceId:workspace.space.id,createdAt:entrySelection?.item?.createdAt??new Date().toISOString(),state:'pending',attempts:0,nextAttemptAt:null,lastReason:null,content}
        await offlineQueue.put(item);queueChanged();requests.current.delete(key);resetEntry();setEntryOpen(false)
        setNotice('Lançamento salvo no aparelho. Será enviado quando a conexão voltar.')
        if(online) {
          try {await sendLocalQueue();await onChanged();const remaining=await offlineQueue.list(userId);if(!remaining.some(row=>row.clientUuid===item.clientUuid&&row.spaceId===item.spaceId))setNotice('Salvo. Os saldos foram atualizados.')}
          catch {setNotice('Lançamento salvo no aparelho. Confira o envio na área de pendências.')}
        }
        return
      }
      if(values.get('save_model')==='on'&&(text('reserve')||kind==='card_purchase'&&Number(text('installments'))!==1||kind!=='card_purchase'&&!['cash','benefit'].includes(account?.liquidity??'')))throw new Error('Os modelos permitem despesas e receitas à vista ou compras no cartão em 1x, sem vínculo com metas. Desmarque a opção de modelo para registrar esta operação.')
      let name:string,args:Record<string,unknown>
      if(kind==='card_purchase') {
        name='record_card_purchase'
        args={p_card:text('card'),p_category:category?.id,p_total_cents:cents,p_installments:Number(text('installments')),p_on:date,p_description:text('name'),p_reserve:text('reserve')||null}
      } else if(kind==='card_payment') {
        name='pay_card'
        args={p_card:text('card'),p_origin_ledger:account?.ledger_account_id,p_amount_cents:cents,p_on:date,p_channel:text('channel')}
      } else if(kind==='transfer') {
        name='transfer_between_accounts'
        args={p_from:account?.id,p_to:text('destination'),p_amount_cents:cents,p_occurred_on:date}
      } else {
        if(!category?.ledger_account_id||!account)throw new Error('Escolha uma conta e uma categoria final.')
        const sign=kind==='income'?-1:1
        name='post_transaction'
        args={p_payload:{kind,occurred_on:date,competence_month:date.slice(0,7)+'-01',description:text('name'),notes:paymentNote(paymentMethod||undefined),
          entries:[{ledger_account_id:category.ledger_account_id,amount_cents:sign*cents,reserve_id:kind==='expense'?text('reserve')||null:null},{ledger_account_id:account.ledger_account_id,amount_cents:-sign*cents}]}}
      }
      const key=JSON.stringify({space:workspace.space.id,name,args})
      if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID())
      const uuid=requests.current.get(key)
      if(name==='post_transaction')args={p_payload:{...(args.p_payload as Record<string,unknown>),client_uuid:uuid}}
      else args={...args,p_client_uuid:uuid}
      await ledgerRpc(name,{p_space:workspace.space.id,...args})
      requests.current.delete(key);resetEntry();setEntryOpen(false)
      try {await onChanged();setNotice('Salvo. Os saldos foram atualizados.')}
      catch {setNotice('Lançamento registrado. Use Atualizar para consultar os saldos.')}
      if(values.get('save_model')==='on'&&supportsPreferences) {
        const payload=entryPreset(values)
        const {occurredOn,installments,reserveId,...model}=payload
        try {await ledgerRpc('save_entry_model',{p_space:workspace.space.id,p_name:text('model_name')||text('name')||'Meu lançamento',p_payload:model,p_client_uuid:crypto.randomUUID()});setPreferencesRevision(value=>value+1)}
        catch {setError('O lançamento foi registrado, mas o modelo não foi salvo. Crie o modelo na área de gerenciamento.')}
      }
      if(entrySelection?.draft) {
        try {await ledgerRpc('delete_entry_preference',{p_space:workspace.space.id,p_id:entrySelection.draft.id,p_version:entrySelection.draft.version,p_kind:'draft'});setPreferencesRevision(value=>value+1)}
        catch {setError('O lançamento foi registrado, mas o rascunho permanece salvo. Exclua o rascunho na área de gerenciamento para evitar usá-lo novamente.')}
      }
    } catch(failure) {setError(failure instanceof Error?failure.message:'Confira os campos e tente novamente.')}
    finally {pending.current=false;setBusy(false)}
  }
  const closeForeign=useCallback(()=>setForeignOpen(false),[])
  return <div className="space-y-6">
    {foreignOpen&&online&&<LedgerForeignCurrency mode="create" workspace={workspace} money={money} onChanged={onChanged} onClose={closeForeign}/>}
    {writer&&entryOpen&&<div role="dialog" aria-modal="true" aria-label="Novo lançamento" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-4" onClick={event=>{if(event.target===event.currentTarget)closeEntry()}}>
    <form ref={formRef} aria-label="Adicionar lançamento" onSubmit={save} key={nonce} className="grid max-h-[92vh] w-full max-w-2xl grid-cols-1 gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:col-span-2"><div className="flex items-center gap-3"><span className="rounded-xl bg-brand-100 p-2.5 text-brand-600 dark:bg-brand-950 dark:text-brand-400"><ArrowLeftRight size={20}/></span><div><h2 className="font-semibold">{entrySelection?.draft?'Completar rascunho':entrySelection?.item?'Editar lançamento pendente':'Novo lançamento'}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Preencha os dados e confira antes de salvar.</p></div></div><button type="button" aria-label="Fechar lançamento" disabled={busy} onClick={closeEntry} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button></div>
      {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200 sm:col-span-2">{error}</p>}
      <fieldset disabled={busy} className="contents">
        {!online&&<p className="w-full sm:col-span-2 text-xs text-amber-700 dark:text-amber-300">Sem conexão: despesas e receitas à vista ou compras no cartão em 1x ficam salvas neste aparelho até o envio. Transferências, parcelamentos e metas precisam de internet.</p>}
        {entrySelection&&<div className="flex w-full sm:col-span-2 flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{entrySelection.item?'Editando lançamento não enviado':entrySelection.draft?'Completando rascunho':'Modelo preenchido. Confira os campos antes de adicionar.'}</span><button type="button" onClick={resetEntry} className="font-semibold text-brand-700 dark:text-brand-300">Limpar formulário</button></div>}
        <label className={labelClass}><span className="field-label">Operação</span><select aria-label="Operação" value={kind} onChange={event=>{if(event.target.value==='foreign_purchase'){setEntryOpen(false);setForeignOpen(true);return}setKind(event.target.value as Kind);setSuggestions([]);suggestionRequest.current++}} className={input}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer" disabled={!online||Boolean(entrySelection?.item)}>Transferência</option><option value="card_purchase">Compra no cartão</option><option value="card_payment" disabled={!online||Boolean(entrySelection?.item)}>Pagamento do cartão</option><option value="foreign_purchase" disabled={!online||Boolean(entrySelection)}>Compra internacional</option></select></label>
        {!['transfer','card_payment'].includes(kind)&&<label className="flex w-full flex-col gap-1.5"><span className="field-label">Nome ou descrição</span><input name="name" required maxLength={100} defaultValue={preset?.description??''} onBlur={event=>void suggest(event.target.value)} placeholder="Ex: Mercado" className={input}/></label>}
        {['expense','income','card_purchase'].includes(kind)&&<label className="flex w-full flex-col gap-1.5"><span className="field-label">Forma de pagamento</span><select aria-label="Forma de pagamento" value={kind==='card_purchase'?'credit_card':paymentMethod==='credit_card'?'':paymentMethod} onChange={event=>{const method=event.target.value as PaymentMethod|'';setPaymentMethod(method);if(method==='credit_card')setKind('card_purchase');else if(kind==='card_purchase')setKind('expense')}} className={input}><option value="">Não informado</option>{Object.entries(paymentMethods).filter(([method])=>kind!=='income'||method!=='credit_card').map(([method,label])=><option key={method} value={method}>{label}</option>)}</select></label>}
        {kind!=='card_purchase'&&<label className={labelClass}><span className="field-label">Conta</span><select aria-label="Conta" key={'account-'+kind} name="account" required defaultValue={preset?.accountId??''} className={input}><option value="" disabled>Selecione uma conta</option>{workspace.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        {kind==='transfer'&&<label className={labelClass}><span className="field-label">Conta de destino</span><select aria-label="Conta de destino" name="destination" required defaultValue="" className={input}><option value="" disabled>Selecione uma conta</option>{workspace.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        {!['transfer','card_payment'].includes(kind)&&<label className={labelClass}><span className="field-label">Categoria</span><select aria-label="Categoria" key={'category-'+kind} name="category" required defaultValue={preset?.kind===kind?preset.categoryId??'':''} className={input}><option value="" disabled>Selecione uma categoria</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
        {['card_purchase','card_payment'].includes(kind)&&<label className={labelClass}><span className="field-label">Cartão</span><select aria-label="Cartão" name="card" required defaultValue={preset?.cardId??''} className={input}><option value="">Selecione</option>{workspace.cards.filter(c => kind === 'card_payment' ? true : c.card_type !== 'debit').map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
        {kind==='card_purchase'&&<label className="flex w-full flex-col gap-1.5"><span className="field-label">Parcelas</span><input name="installments" type="number" min="1" max={!online||entrySelection?.item?1:600} defaultValue={preset?.installments??1} required className={input}/></label>}
        {kind==='card_payment'&&<label className={labelClass}><span className="field-label">Meio de pagamento</span><select aria-label="Meio de pagamento" name="channel" className={input}><option value="pix">Pix</option><option value="boleto">Boleto</option></select></label>}
        <label className="flex w-full flex-col gap-1.5"><span className="field-label">Valor</span><CurrencyInput name="amount" required defaultValue={preset?.amountCents!==undefined?preset.amountCents/100:''} placeholder="0,00" className={input}/></label>
        <label className="flex w-full flex-col gap-1.5"><span className="field-label">Data</span><input name="date" type="date" required defaultValue={preset?.occurredOn??(online?workspace.space.today:todayInSpace(workspace.space.timezone))} className={input}/></label>
        {['expense','card_purchase'].includes(kind)&&goals.length>0&&<label className="flex w-full flex-col gap-1.5"><span className="field-label">Usar uma meta (opcional)</span><select aria-label="Usar uma meta (opcional)" name="reserve" defaultValue={preset?.reserveId??''} className={input}><option value="">Gasto sem vínculo com uma meta</option>{goals.map(goal=><option disabled={!online||Boolean(entrySelection?.item)} key={goal.id} value={goal.id}>{goal.name} · {money(goal.balance_cents)}</option>)}</select></label>}
        
        {suggestions.length>0&&<div className="flex w-full sm:col-span-2 flex-wrap items-center gap-2 text-xs"><span className="text-slate-500">Categorias sugeridas pelo histórico:</span>{suggestions.map(category=><button type="button" key={category.categoryId} onClick={()=>{const target=formRef.current?.elements.namedItem('category');if(target instanceof HTMLSelectElement)target.value=category.categoryId;setSuggestions([])}} className="rounded-full border border-brand-300 px-3 py-1 font-semibold text-brand-700 dark:text-brand-300">{category.name}</button>)}</div>}
        {supportsPreferences&&!entrySelection?.item&&<details className="w-full sm:col-span-2 border-t border-slate-200 pt-3 dark:border-slate-800"><summary className="cursor-pointer text-xs font-medium text-slate-500 dark:text-slate-400">Modelo e rascunho</summary><div className="mt-3 flex flex-wrap items-end gap-3"><label className="flex items-center gap-2 text-sm"><input name="save_model" type="checkbox" disabled={!online}/>Salvar também como meu modelo</label><label className="flex w-full flex-col gap-1.5"><span className="field-label">Nome do modelo (opcional)</span><input name="model_name" maxLength={100} disabled={!online} className={input}/></label><button type="button" disabled={!online} onClick={()=>void saveDraft()} className="text-sm font-semibold text-brand-700 disabled:opacity-50 dark:text-brand-300">Salvar como rascunho</button>{!entrySelection&&<button type="button" onClick={resetEntry} className="text-xs text-slate-500">Limpar formulário</button>}{!online&&<p className="w-full text-xs text-slate-500">Você pode usar modelos já carregados. Salvar novos modelos e rascunhos precisa de internet.</p>}</div></details>}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 sm:col-span-2"><button type="button" onClick={closeEntry} className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancelar</button><button disabled={busy||!online&&!supportsPreferences} className="btn-primary disabled:opacity-50">{entrySelection?.item?'Salvar e reenviar':online?'Adicionar lançamento':'Salvar para enviar depois'}</button></div>
      </fieldset>
    </form></div>}
    {error&&!entryOpen&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice&&<p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}

    <section aria-label="Histórico de lançamentos" className="card overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4"><div><h2 className="text-base font-semibold">Movimentações</h2><p className="mt-1 text-xs text-slate-500">{visible.length} registros · 7 por página</p></div>{writer&&<button type="button" onClick={()=>newEntry()} className="btn-primary inline-flex items-center gap-2"><Plus size={16}/>Novo lançamento</button>}</div>
    <div className="px-5 pb-4">    <LedgerEntryManagement workspace={workspace} money={money} onChanged={onChanged} onUse={useEntry} refreshKey={preferencesRevision} disabled={busy}/></div>
    <div className="space-y-3 border-t border-slate-200 bg-slate-50/50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/20">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1" aria-label="Filtrar movimentações">{[['all','Todos'],['income','Entradas'],['expense','Saídas'],['transfer','Transferências'],['card','Cartão'],['foreign','Internacionais']].map(([value,label])=><button type="button" key={value} aria-pressed={flowFilter===value} onClick={()=>setFlowFilter(value)} className={`rounded-lg px-3 py-2 text-sm font-medium ${flowFilter===value?'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300':'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>{label}</button>)}</div>
      <button type="button" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(!filtersOpen)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"><SlidersHorizontal size={14}/>Filtros{(accountFilter||monthFilter||status!=='all')&&<span className="h-1.5 w-1.5 rounded-full bg-brand-500"/>}</button>
    </div>
      <label className={labelClass}><div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400"/><input aria-label="Buscar lançamento" value={search} onChange={event=>{setSearch(event.target.value);setSelected(null);setPage(1)}} placeholder="Descrição, conta ou categoria" className={input+' pl-9'}/></div></label>
    {filtersOpen&&    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">

      <label className={labelClass}><span className="field-label">Conta ou cartão</span><select aria-label="Filtrar por conta ou cartão" value={accountFilter} onChange={event=>setAccountFilter(event.target.value)} className={input}><option value="">Todos</option><optgroup label="Contas">{workspace.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</optgroup><optgroup label="Cartões">{workspace.cards.map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</optgroup></select></label>
      <label className={labelClass}><span className="field-label">Mês</span><input aria-label="Filtrar por mês" type="month" value={monthFilter} onChange={event=>setMonthFilter(event.target.value)} className={input}/></label>
      <label className={labelClass}><span className="field-label">Situação do lançamento</span><select aria-label="Situação do lançamento" value={status} onChange={event=>{setStatus(event.target.value);setSelected(null);setPage(1)}} className={input}><option value="all">Todos</option><option value="posted">Registrados</option><option value="cancelled">Cancelados</option></select></label>
    </div>}
    {(search||flowFilter!=='all'||accountFilter||monthFilter||status!=='all')&&<button type="button" onClick={()=>{setSearch('');setFlowFilter('all');setAccountFilter('');setMonthFilter('');setStatus('all');setPage(1);setSelected(null)}} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-600"><X size={13}/>Limpar filtros</button>}
    </div>
    <TransactionTable transactions={pageTransactions} money={money}
      renderName={transaction=><><span>{foreignTransactions[transaction.id]&&<span className="mr-2 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">Internacional · {foreignTransactions[transaction.id]}</span>}</span>{online?<button type="button" disabled={busy} onClick={()=>openDetails(transaction.id)} aria-label={'Abrir lançamento '+transaction.description} className="block max-w-full text-left [overflow-wrap:anywhere]">{transaction.description}</button>:transaction.description}</>}
      renderActions={transaction=>online?<button type="button" disabled={busy} onClick={()=>openDetails(transaction.id)} aria-label={'Ver detalhes de '+transaction.description} aria-expanded={selected===transaction.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button>:null}
      renderEditor={transaction=>online&&selected===transaction.id?<LedgerTransactionActions key={transaction.id} workspace={workspace} transactionId={transaction.id} money={money} onChanged={onChanged} onClose={()=>setSelected(null)} mutationPending={pending} externalBusy={busy} onBusyChange={setBusy}/>:null}/>
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{visible.length?`Exibindo ${pageStart+1}–${pageStart+pageTransactions.length} de ${visible.length} lançamentos.`:'Nenhum lançamento encontrado.'}{workspace.transactions.length>=200&&' Histórico limitado aos 200 mais recentes.'}</p>
      <nav aria-label="Páginas dos lançamentos" className="flex flex-wrap items-center gap-1">
        <button type="button" aria-label="Página anterior" disabled={busy||currentPage===1} onClick={()=>{setPage(currentPage-1);setSelected(null)}} className="rounded-lg p-2 text-slate-500 disabled:opacity-30"><ChevronLeft size={18}/></button>
        {Array.from({length:pageCount},(_,index)=>index+1).map(number=><button key={number} type="button" disabled={busy} aria-label={`Página ${number}`} aria-current={currentPage===number?'page':undefined} onClick={()=>{setPage(number);setSelected(null)}} className={`min-h-9 min-w-9 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${currentPage===number?'bg-brand-500 text-slate-950':'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>{number}</button>)}
        <button type="button" aria-label="Próxima página" disabled={busy||currentPage===pageCount} onClick={()=>{setPage(currentPage+1);setSelected(null)}} className="rounded-lg p-2 text-slate-500 disabled:opacity-30"><ChevronRight size={18}/></button>
      </nav>
    </div>
    </section>
    {online&&<details className="card p-4" onToggle={event=>setForeignManagement(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Compras internacionais · conversões e IOF</summary><div className="mt-4">{foreignManagement&&<LedgerForeignCurrency mode="manage" workspace={workspace} money={money} onChanged={onChanged}/>}</div></details>}
  </div>
}
