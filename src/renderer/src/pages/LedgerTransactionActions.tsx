import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import CurrencyInput from '../components/CurrencyInput';

interface Entry { id: string; ledger_account_id: string; amount_cents: number; line_number: number; account_name: string; account_class: string; owner_type: string; reconciliation_status: string | null; statement_status: string | null }
interface Detail { transaction: { id: string; version: number; kind: string; status: string; description: string; notes: string | null; occurred_on: string; competence_month: string }; entries: Entry[]; financially_locked: boolean; remaining_consumption_cents: number; unidentified_adjustment_cents: number }
const input = 'w-full field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
const textCents = (value: number) => `${BigInt(Math.abs(value))/100n},${String(BigInt(Math.abs(value))%100n).padStart(2,'0')}`;
export default function LedgerTransactionActions({ workspace,transactionId,money,onChanged,onClose,mutationPending,externalBusy=false,onBusyChange }: { workspace: LedgerWorkspace; transactionId: string; money: (value: number) => string; onChanged: () => Promise<void>; onClose: () => void; mutationPending?:{current:boolean}; externalBusy?:boolean; onBusyChange?:(busy:boolean)=>void }) {
  const [detail,setDetail] = useState<Detail | null>(null),[error,setError] = useState(''),[notice,setNotice] = useState(''),[busy,setBusy] = useState(false);
  const [operation,setOperation] = useState('notes'),[clientId,setClientId] = useState(() => crypto.randomUUID());
  const localPending=useRef(false),pending=mutationPending??localPending,disabled=busy||externalBusy;
  async function load() { setDetail(await ledgerRpc<Detail>('transaction_detail',{ p_space:workspace.space.id,p_transaction:transactionId })); }
  useEffect(() => { void load().catch(failure => setError(failure.message)); },[workspace.space.id,transactionId]);
  useEffect(() => { if (operation === 'refund' && detail && detail.remaining_consumption_cents <= 0) setOperation('notes'); },[operation,detail]);
  async function run(name: string,args: Record<string,unknown>) {
    if(pending.current||externalBusy||workspace.role==='viewer')return;
    pending.current=true;setBusy(true);onBusyChange?.(true); setError(''); setNotice('');
    try { await ledgerRpc(name,{ p_space:workspace.space.id,...args }); await load(); await onChanged(); setClientId(crypto.randomUUID()); setNotice('Alteração registrada.'); }
    catch (failure) {
      const message=failure instanceof Error ? failure.message : 'Não foi possível salvar.';
      setError(message.includes('Cancel the foreign conversion adjustment before its original purchase')
        ? 'Cancele primeiro o ajuste cambial ligado a esta compra. Depois, cancele a compra original.'
        : message.includes('Cancel the IOF adjustment before its original transaction')
          ? 'Cancele primeiro o ajuste ligado ao IOF. Depois, cancele a cobrança original de IOF.'
          : message);
    }
    finally { pending.current=false;setBusy(false);onBusyChange?.(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail || disabled) return;
    const data = new FormData(event.currentTarget),text = (key: string) => String(data.get(key) ?? '').trim(),tx = detail.transaction;
    try {
      if (operation === 'notes') await run('annotate_transaction',{ p_transaction:tx.id,p_version:tx.version,p_changes:{ description:text('description'),notes:text('notes') || null } });
      else if (operation === 'cancel') await run('cancel_transaction',{ p_transaction:tx.id,p_version:tx.version,p_reason:text('reason') });
      else if (operation === 'refund') await run('refund_transaction',{ p_original:tx.id,p_amount_cents:parseBrlCents(text('amount')),p_on:text('date'),p_destination_account:tx.kind === 'card_purchase' ? null : text('account'),p_model:tx.kind === 'card_purchase' ? text('model') : null,p_client_uuid:clientId });
      else if (operation === 'explain') await run('explain_account_adjustment',{p_transaction:tx.id,p_version:tx.version,p_amount_cents:parseBrlCents(text('amount')),p_category:text('category') || null,p_competence:`${text('month')}-01`,p_reason:text('reason'),p_client_uuid:clientId});
      else {
        const amount = parseBrlCents(text('amount')); if (amount <= 0) throw new Error('O valor deve ser maior que zero.');
        const category = workspace.categories.find(c => c.id === text('category'));
        const entries = detail.entries.map(e => ({ ...e,ledger_account_id:category?.ledger_account_id && ['income','expense'].includes(e.account_class) ? category.ledger_account_id : e.ledger_account_id,amount_cents:e.amount_cents < 0 ? -amount : amount }));
        await run('edit_transaction',{ p_transaction:tx.id,p_version:tx.version,p_reason:text('reason'),p_payload:{ kind:tx.kind,description:text('description'),notes:text('notes') || null,occurred_on:text('date'),competence_month:`${text('month')}-01`,entries,acknowledge_reconciliation_change:data.get('acknowledge') === 'on' } });
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verifique os campos.'); }
  }
  const canWrite = workspace.role !== 'viewer' && detail?.transaction.status === 'posted';
  const canEdit = canWrite && detail && !detail.financially_locked && !detail.entries.some(e => e.statement_status === 'closed') && detail.entries.length === 2 && ['expense','income','transfer','card_purchase'].includes(detail.transaction.kind);
  const canRefund = canWrite && detail && ['expense','card_purchase'].includes(detail.transaction.kind) && detail.remaining_consumption_cents > 0;
  const canExplain = canWrite && detail && !detail.financially_locked && detail.transaction.kind==='balance_adjustment' && detail.unidentified_adjustment_cents!==0;
  const field = (title: string,id: string) => <label htmlFor={id} className="field-label">{title}</label>;
  return <section className="card min-w-0 space-y-4 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Detalhes do lançamento">
    <div className="flex justify-between gap-3"><h2 className="font-semibold">Detalhes do lançamento</h2><button disabled={disabled} onClick={onClose} className="text-sm text-slate-500 dark:text-slate-400">Fechar detalhes</button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {detail && <><p className="font-medium [overflow-wrap:anywhere]">{detail.transaction.description}</p><p className="text-sm text-slate-500 dark:text-slate-400">{detail.transaction.occurred_on} · referência {detail.transaction.competence_month.slice(0,7)} · {detail.transaction.status === 'cancelled' ? 'Cancelado' : 'Registrado'}</p>
      {detail.entries.map(e => <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-2 dark:border-slate-800"><div><p className="text-sm [overflow-wrap:anywhere]">{e.account_name}</p>{e.reconciliation_status && <p className="text-xs text-slate-500 dark:text-slate-400">{e.reconciliation_status === 'reconciled' ? 'Conferido no extrato' : 'Não conferido'}</p>}</div><div className="flex flex-wrap items-center gap-3"><strong className="text-sm">{money(e.amount_cents)}</strong>{canWrite && e.reconciliation_status && <button disabled={disabled} onClick={() => void run('reconcile_entry',{ p_entry:e.id,p_version:detail.transaction.version,p_reconciled:e.reconciliation_status !== 'reconciled' })} className="text-sm text-brand-600 dark:text-brand-400">{e.reconciliation_status === 'reconciled' ? 'Desfazer conferência' : 'Marcar como conferido'}</button>}</div></div>)}
      {detail.financially_locked && <p className="text-sm text-amber-700 dark:text-amber-300">Os valores estão protegidos pelo fechamento mensal. Anotações e conferência no extrato continuam disponíveis.</p>}
      {canWrite && <form key={`${detail.transaction.version}-${operation}`} onSubmit={submit} className="min-w-0"><fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">{field('Ação sobre o lançamento','transaction-action')}<select id="transaction-action" value={operation} onChange={event => { setOperation(event.target.value); setClientId(crypto.randomUUID()); setError(''); setNotice(''); }} className={input}><option value="notes">Editar descrição e observações</option>{canEdit && <option value="edit">Corrigir valor, categoria ou data</option>}{canRefund && <option value="refund">Registrar estorno ou reembolso</option>}{canExplain && <option value="explain">Explicar diferença de saldo</option>}<option value="cancel">Cancelar lançamento</option></select></div>
        {['notes','edit'].includes(operation) && <><div className="grid gap-2">{field('Descrição','transaction-description')}<input id="transaction-description" name="description" required maxLength={200} defaultValue={detail.transaction.description} className={input}/></div><div className="grid gap-2">{field('Observações','transaction-notes')}<input id="transaction-notes" name="notes" defaultValue={detail.transaction.notes ?? ''} className={input}/></div></>}
        {['edit','refund'].includes(operation) && <><div className="grid gap-2">{field(operation === 'refund' ? 'Valor devolvido' : 'Valor corrigido','transaction-amount')}<CurrencyInput id="transaction-amount" name="amount" required defaultValue={operation === 'edit' ? textCents(detail.entries[0].amount_cents) : undefined} className={input}/></div><div className="grid gap-2">{field('Data do fato','transaction-date')}<input id="transaction-date" name="date" type="date" required defaultValue={operation === 'edit' ? detail.transaction.occurred_on : workspace.space.today} className={input}/></div></>}
        {operation === 'edit' && <><div className="grid gap-2">{field('Mês de referência','transaction-month')}<input id="transaction-month" name="month" type="month" required defaultValue={detail.transaction.competence_month.slice(0,7)} className={input}/></div>{detail.entries.some(e => ['income','expense'].includes(e.account_class)) && <div className="grid gap-2">{field('Categoria corrigida','transaction-category')}<select id="transaction-category" name="category" required defaultValue={workspace.categories.find(c => c.ledger_account_id === detail.entries.find(e => ['income','expense'].includes(e.account_class))?.ledger_account_id)?.id ?? ''} className={input}>{workspace.categories.filter(c => c.ledger_account_id && c.kind === (detail.transaction.kind === 'income' ? 'income' : 'expense')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}{detail.entries.some(e => e.reconciliation_status === 'reconciled') && <label className="flex gap-2 sm:col-span-2"><input type="checkbox" name="acknowledge"/>Confirmo que alterar valores ou contas desfaz a conferência com o extrato.</label>}</>}
        {operation === 'refund' && <><p className="text-sm text-slate-500 dark:text-slate-400 sm:col-span-2">Disponível para estorno ou reembolso: {money(detail.remaining_consumption_cents)}.</p><div className="grid gap-2">{detail.transaction.kind === 'card_purchase' ? <>{field('Tratamento das parcelas','transaction-refund-model')}<select id="transaction-refund-model" name="model" className={input}><option value="cancel_remaining">Reduzir parcelas e creditar o restante</option><option value="credit_open_statement">Creditar na fatura aberta e manter parcelas</option></select></> : <>{field('Conta que recebeu a devolução','transaction-refund-account')}<select id="transaction-refund-account" name="account" required className={input}><option value="">Selecione</option>{workspace.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></>}</div></>}
        {operation === 'explain' && <><p className="text-sm text-slate-500 dark:text-slate-400 sm:col-span-2">Ainda não identificado: {money(Math.abs(detail.unidentified_adjustment_cents))}. Classifique uma parte ou o total. O saldo bancário e a conferência do extrato serão preservados.</p><div className="grid gap-2">{field('Valor a explicar','explanation-amount')}<CurrencyInput id="explanation-amount" name="amount" required defaultValue={textCents(detail.unidentified_adjustment_cents)} className={input}/></div><div className="grid gap-2">{field('Classificar a diferença como','explanation-category')}<select id="explanation-category" name="category" className={input}><option value="">Correção do saldo inicial</option>{workspace.categories.filter(category=>category.ledger_account_id && category.kind===(detail.unidentified_adjustment_cents>0?'expense':'income')).map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="grid gap-2">{field('Competência da parte explicada','explanation-month')}<input id="explanation-month" name="month" type="month" defaultValue={detail.transaction.competence_month.slice(0,7)} required className={input}/></div></>}
        {['cancel','edit','explain'].includes(operation) && <div className="grid gap-2 sm:col-span-2">{field('Motivo da alteração','transaction-reason')}<input id="transaction-reason" name="reason" required className={input}/></div>}
        <div className="sm:col-span-2"><button disabled={disabled} className="btn-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50">Salvar alteração</button></div>
      </fieldset></form>}
    </>}
  </section>;
}
