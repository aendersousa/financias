import { Fragment, type ReactNode } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import type { LedgerTransaction } from '../lib/ledgerRepository'

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
export default function TransactionTable<T extends LedgerTransaction>({transactions,renderName,renderActions,renderEditor}:{
  transactions:T[]
  renderName?:(transaction:T)=>ReactNode
  renderActions?:(transaction:T)=>ReactNode
  renderEditor?:(transaction:T)=>ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Lançamentos" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50"><tr>
        <th scope="col" className="hidden w-[14%] px-4 py-2.5 sm:table-cell">Data</th>
        <th scope="col" className="w-[52%] px-3 py-2.5 sm:w-[38%] sm:px-4">Descrição</th>
        <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Tipo</th>
        <th scope="col" className="w-[24%] px-3 py-2.5 sm:w-[18%] sm:px-4">Situação</th>
        <th scope="col" className="w-[24%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {transactions.map(transaction=>{
          const editor=renderEditor?.(transaction)
          const kind=transactionKindLabels[transaction.kind]??'Movimentação'
          const date=transaction.occurred_on.split('-').reverse().join('/')
          return <Fragment key={transaction.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 sm:table-cell">{date}</td>
              <td className="px-3 py-2.5 sm:px-4"><div className="flex items-start gap-2">
                <ArrowLeftRight aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"/>
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {renderName?renderName(transaction):transaction.description}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:hidden">{date} · {kind}</p>
                </div>
              </div></td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 sm:table-cell">{kind}</td>
              <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 sm:px-4">{transaction.status==='cancelled'?'Cancelado':'Registrado'}</td>
              <td className="px-3 py-2.5 text-right sm:px-4">{renderActions?.(transaction)}</td>
            </tr>
            {editor&&<tr><td colSpan={5} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!transactions.length&&<tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhum lançamento encontrado.</td></tr>}
      </tbody>
    </table>
  </div>
}
