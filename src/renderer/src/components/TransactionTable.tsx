import { Fragment, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CreditCard } from 'lucide-react'
import type { LedgerTransaction } from '../lib/ledgerRepository'
import { transactionFlow } from '../lib/transactionFlow'

export const transactionKindLabels: Record<string, string> = {
  opening:'Saldo inicial', expense:'Despesa', income:'Receita', transfer:'Transferência',
  card_purchase:'Compra no cartão', card_payment:'Pagamento do cartão', card_rollover:'Saldo de fatura',
  card_credit_carry:'Crédito de fatura', card_installment_plan:'Parcelamento de fatura', card_charges:'Encargos do cartão',
  card_correction:'Correção do cartão', card_prepayment:'Antecipação de parcelas', refund:'Estorno ou reembolso',
  payment_returned:'Pagamento devolvido', balance_adjustment:'Ajuste de saldo', investment_contribution:'Aporte em investimento',
  investment_redemption:'Resgate de investimento', investment_result:'Resultado de investimento', loan_disbursement:'Empréstimo recebido',
  loan_payment:'Pagamento de empréstimo', person_settlement:'Acerto com pessoa', space_transfer:'Repasse entre espaços',
  member_settlement:'Acerto entre membros', member_exit:'Saída de membro', shared_expense:'Despesa compartilhada',
  foreign_purchase:'Compra internacional', fx_confirmation:'Ajuste de câmbio', foreign_conversion:'Ajuste de câmbio',
}
export default function TransactionTable<T extends LedgerTransaction>({transactions,money,renderName,renderActions,renderEditor}:{
  transactions:T[]
  money:(cents:number)=>string
  renderName?:(transaction:T)=>ReactNode
  renderActions?:(transaction:T)=>ReactNode
  renderEditor?:(transaction:T)=>ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Lançamentos" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50"><tr>
        <th scope="col" className="hidden w-28 px-4 py-2.5 lg:table-cell">Data</th>
        <th scope="col" className="px-3 py-2.5 sm:px-4">Descrição</th>
        <th scope="col" className="hidden w-[20%] px-4 py-2.5 lg:table-cell">Conta / cartão</th>
        <th scope="col" className="hidden w-[16%] px-4 py-2.5 lg:table-cell">Categoria</th>
        <th scope="col" className="w-[32%] px-3 py-2.5 text-right sm:w-40 sm:px-4">Valor</th>
        <th scope="col" className="hidden w-28 px-4 py-2.5 sm:table-cell">Situação</th>
        <th scope="col" className="w-20 px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {transactions.map(transaction=>{
          const editor=renderEditor?.(transaction)
          const kind=transactionKindLabels[transaction.kind]??'Movimentação'
          const date=transaction.occurred_on.split('-').reverse().join('/')
          const entries=transaction.entries??[]
          const accounts=entries.filter(entry=>['financial_account','credit_card'].includes(entry.owner_type)).filter((entry,index,rows)=>rows.findIndex(other=>other.account_name===entry.account_name&&other.owner_type===entry.owner_type&&(transaction.kind!=='transfer'||other.amount_cents===entry.amount_cents))===index)
          const accountNames=transaction.kind==='transfer'
            ? [...accounts].sort((a,b)=>a.amount_cents-b.amount_cents).map(entry=>entry.account_name).join(' → ')
            : [...new Set(accounts.map(entry=>entry.account_name))].join(' · ')
          const categories=[...new Set(entries.filter(entry=>entry.owner_type==='category').map(entry=>entry.account_name))].join(' · ')
          const amount=transaction.amount_cents??(entries.length?entries.reduce((sum,entry)=>sum+Math.max(0,entry.amount_cents),0):null)
          const cancelled=transaction.status==='cancelled'
          const flow=transactionFlow(entries)??(transaction.kind==='income'?'Entrada':transaction.kind==='expense'?'Saída':null)
          const expense=flow==='Saída'
          const income=flow==='Entrada'
          const Icon=expense?ArrowUpRight:income?ArrowDownLeft:transaction.kind.startsWith('card_')?CreditCard:ArrowLeftRight
          const accountDetails=accounts.map((entry,index)=><div key={index} className="mb-1 last:mb-0">
            <span>{entry.account_name}</span>
            {entry.owner_type==='financial_account'&&flow==='Transferência'&&<span className={`block text-xs tabular-nums ${cancelled?'text-slate-500':entry.amount_cents>0?'text-brand-700 dark:text-brand-400':'text-red-600 dark:text-red-400'}`}>
              {entry.amount_cents>0?'Entrada + ':'Saída − '}{money(Math.abs(entry.amount_cents))}
            </span>}
          </div>)
          return <Fragment key={transaction.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">{date}</td>
              <td className="px-3 py-2.5 sm:px-4"><div className="flex items-start gap-2">
                <Icon aria-hidden="true" size={14} className={`mt-0.5 shrink-0 ${expense?'text-red-500':income?'text-brand-500':'text-slate-400'}`}/>
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {renderName?renderName(transaction):transaction.description}
                  {(transaction.kind==='card_purchase'||transaction.notes?.startsWith('Forma de pagamento: '))&&<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{transaction.kind==='card_purchase'?'Cartão de crédito':transaction.notes?.split('\n')[0]}</p>}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{kind}<span className="lg:hidden"> · {date}</span></p>
                  {accountNames&&<div className="mt-2 text-xs text-slate-500 dark:text-slate-400 lg:hidden">{accountDetails}</div>}
                  {categories&&<p className="mt-1 text-xs text-slate-500 dark:text-slate-400 lg:hidden">{categories}</p>}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:hidden">{cancelled?'Cancelado':'Registrado'}</p>
                </div>
              </div></td>
              <td className="hidden px-4 py-2.5 text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400 lg:table-cell">{accountDetails.length?accountDetails:'—'}</td>
              <td className="hidden px-4 py-2.5 text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400 lg:table-cell">{categories||'—'}</td>
              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums [overflow-wrap:anywhere] sm:px-4 ${cancelled?'text-slate-500 line-through':expense?'text-red-600 dark:text-red-400':income?'text-brand-700 dark:text-brand-400':''}`}>{amount===null?<span className="text-xs font-normal text-slate-500">Valor indisponível</span>:<>{expense?'− ':income?'+ ':''}{money(amount)}{flow&&<span className="mt-1 block text-xs font-normal">{flow}{cancelled?' (cancelada)':''}</span>}</>}</td>
              <td className="hidden px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 sm:table-cell"><span className={`rounded-full px-2 py-1 ${cancelled?'bg-slate-100 dark:bg-slate-800':'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400'}`}>{cancelled?'Cancelado':'Registrado'}</span></td>
              <td className="px-3 py-2.5 text-right sm:px-4">{renderActions?.(transaction)}</td>
            </tr>
            {editor&&<tr><td colSpan={7} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!transactions.length&&<tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhum lançamento encontrado.</td></tr>}
      </tbody>
    </table>
  </div>
}
