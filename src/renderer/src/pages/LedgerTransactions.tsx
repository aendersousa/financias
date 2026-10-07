import { useEffect, useRef, useState, type FormEvent } from 'react'
import { parseBrlCents } from '../../../shared/finance/money'
import TransactionTable from '../components/TransactionTable'
import CurrencyInput from '../components/CurrencyInput'
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository'
import type { ReserveSummary } from './LedgerReserves'
import LedgerQuickEntry from './LedgerQuickEntry'
import LedgerTransactionActions from './LedgerTransactionActions'

type Kind='expense'|'income'|'transfer'|'card_purchase'|'card_payment'
const input='field-input w-full'
const labelClass='flex w-full flex-col gap-1 sm:w-44'
export default function LedgerTransactions({workspace,money,reserves,online,onChanged}:{
  workspace:LedgerWorkspace
  money:(cents:number)=>string
  reserves:ReserveSummary|null
  online:boolean
  onChanged:()=>Promise<void>
}) {
  const [kind,setKind]=useState<Kind>('expense'),[nonce,setNonce]=useState(0)
  const [selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState(''),[status,setStatus]=useState('all')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const pending=useRef(false),requests=useRef(new Map<string,string>())
  const writer=workspace.role!=='viewer'
  const categories=workspace.categories.filter(category=>category.ledger_account_id&&category.kind===(kind==='income'?'income':'expense'))
  const goals=reserves?.reserves.filter(reserve=>reserve.reserve_type==='goal'&&['active','achieved'].includes(reserve.status))??[]
  const visible=workspace.transactions.filter(transaction=>(status==='all'||transaction.status===status)&&transaction.description.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
  useEffect(()=>{if(!online)setSelected(null)},[online])
  function openDetails(id:string) {if(busy)return;setSelected(selected===id?null:id)}
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(pending.current||!writer||!online)return
    const values=new FormData(event.currentTarget),text=(key:string)=>String(values.get(key)??'').trim()
    pending.current=true;setBusy(true);setError('');setNotice('')
    try {
      const cents=parseBrlCents(text('amount'))
      if(cents<=0)throw new Error('O valor deve ser maior que zero.')
      const account=workspace.accounts.find(item=>item.id===text('account'))
      const category=categories.find(item=>item.id===text('category'))
      const date=text('date')
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
        args={p_payload:{kind,occurred_on:date,competence_month:date.slice(0,7)+'-01',description:text('name'),
          entries:[{ledger_account_id:category.ledger_account_id,amount_cents:sign*cents,reserve_id:kind==='expense'?text('reserve')||null:null},{ledger_account_id:account.ledger_account_id,amount_cents:-sign*cents}]}}
      }
      const key=JSON.stringify({space:workspace.space.id,name,args})
      if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID())
      const uuid=requests.current.get(key)
      if(name==='post_transaction')args={p_payload:{...(args.p_payload as Record<string,unknown>),client_uuid:uuid}}
      else args={...args,p_client_uuid:uuid}
      await ledgerRpc(name,{p_space:workspace.space.id,...args})
      requests.current.delete(key);setNonce(value=>value+1);setSelected(null)
      try {await onChanged();setNotice('Salvo. Os saldos foram atualizados.')}
      catch {setNotice('Lançamento registrado. Use Atualizar para consultar os saldos.')}
    } catch(failure) {setError(failure instanceof Error?failure.message:'Confira os campos e tente novamente.')}
    finally {pending.current=false;setBusy(false)}
  }
  return <div className="space-y-6">
    {writer&&online&&<form aria-label="Adicionar lançamento" onSubmit={save} key={nonce} className="card flex flex-wrap items-end gap-3 p-4">
      <fieldset disabled={busy} className="contents">
        <label className={labelClass}><span className="field-label">Operação</span><select aria-label="Operação" value={kind} onChange={event=>setKind(event.target.value as Kind)} className={input}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option><option value="card_purchase">Compra no cartão</option><option value="card_payment">Pagamento do cartão</option></select></label>
        {!['transfer','card_payment'].includes(kind)&&<label className="flex w-full flex-col gap-1 sm:w-60"><span className="field-label">Nome ou descrição</span><input name="name" required maxLength={100} placeholder="Ex: Mercado" className={input}/></label>}
        {kind!=='card_purchase'&&<label className={labelClass}><span className="field-label">Conta</span><select aria-label="Conta" key={'account-'+kind} name="account" required defaultValue="" className={input}><option value="" disabled>Selecione uma conta</option>{workspace.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        {kind==='transfer'&&<label className={labelClass}><span className="field-label">Conta de destino</span><select aria-label="Conta de destino" name="destination" required defaultValue="" className={input}><option value="" disabled>Selecione uma conta</option>{workspace.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        {!['transfer','card_payment'].includes(kind)&&<label className={labelClass}><span className="field-label">Categoria</span><select aria-label="Categoria" key={'category-'+kind} name="category" required defaultValue="" className={input}><option value="" disabled>Selecione uma categoria</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
        {['card_purchase','card_payment'].includes(kind)&&<label className={labelClass}><span className="field-label">Cartão</span><select aria-label="Cartão" name="card" required defaultValue="" className={input}><option value="">Selecione</option>{workspace.cards.map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
        {kind==='card_purchase'&&<label className="flex w-full flex-col gap-1 sm:w-24"><span className="field-label">Parcelas</span><input name="installments" type="number" min="1" max="600" defaultValue="1" required className={input}/></label>}
        {kind==='card_payment'&&<label className={labelClass}><span className="field-label">Meio de pagamento</span><select aria-label="Meio de pagamento" name="channel" className={input}><option value="pix">Pix</option><option value="boleto">Boleto</option></select></label>}
        <label className="flex w-full flex-col gap-1 sm:w-36"><span className="field-label">Valor</span><CurrencyInput name="amount" required placeholder="0,00" className={input}/></label>
        <label className="flex w-full flex-col gap-1 sm:w-40"><span className="field-label">Data</span><input name="date" type="date" required defaultValue={workspace.space.today} className={input}/></label>
        {['expense','card_purchase'].includes(kind)&&goals.length>0&&<label className="flex w-full flex-col gap-1 sm:w-52"><span className="field-label">Usar uma meta (opcional)</span><select aria-label="Usar uma meta (opcional)" name="reserve" className={input}><option value="">Gasto sem vínculo com uma meta</option>{goals.map(goal=><option key={goal.id} value={goal.id}>{goal.name} · {money(goal.balance_cents)}</option>)}</select></label>}
        <button disabled={busy} className="btn-primary disabled:opacity-50">Adicionar lançamento</button>
      </fieldset>
    </form>}
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice&&<p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    <LedgerQuickEntry compact workspace={workspace} money={money} onChanged={onChanged}/>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex w-full flex-col gap-1 sm:w-72"><span className="field-label">Buscar lançamento</span><input value={search} onChange={event=>{setSearch(event.target.value);setSelected(null)}} placeholder="Descrição" className={input}/></label>
      <label className={labelClass}><span className="field-label">Situação do lançamento</span><select aria-label="Situação do lançamento" value={status} onChange={event=>{setStatus(event.target.value);setSelected(null)}} className={input}><option value="all">Todos</option><option value="posted">Registrados</option><option value="cancelled">Cancelados</option></select></label>
    </div>
    <TransactionTable transactions={visible} money={money}
      renderName={transaction=>online?<button type="button" disabled={busy} onClick={()=>openDetails(transaction.id)} aria-label={'Abrir lançamento '+transaction.description} className="block max-w-full text-left [overflow-wrap:anywhere]">{transaction.description}</button>:transaction.description}
      renderActions={transaction=>online?<button type="button" disabled={busy} onClick={()=>openDetails(transaction.id)} aria-label={'Ver detalhes de '+transaction.description} aria-expanded={selected===transaction.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button>:null}
      renderEditor={transaction=>online&&selected===transaction.id?<LedgerTransactionActions key={transaction.id} workspace={workspace} transactionId={transaction.id} money={money} onChanged={onChanged} onClose={()=>setSelected(null)} mutationPending={pending} externalBusy={busy} onBusyChange={setBusy}/>:null}/>
    <p className="text-xs text-slate-500 dark:text-slate-400">Exibindo {visible.length} de {workspace.transactions.length} lançamentos recebidos do espaço (até os 200 mais recentes).</p>
  </div>
}
