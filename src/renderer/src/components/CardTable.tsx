import { Fragment, type ReactNode } from 'react'
import { CreditCard } from 'lucide-react'

export interface CardItem {
  id: string | number
  name: string
  limit: ReactNode
  used: ReactNode
  available: ReactNode
  closingDay?: number | null
  dueDay?: number | null
  status?: string
  cardType?: 'both' | 'credit' | 'debit' | null
}

export default function CardTable<T extends CardItem>({ cards, renderName, renderActions, renderEditor }: {
  cards: T[]
  renderName?: (card: T) => ReactNode
  renderActions?: (card: T) => ReactNode
  renderEditor?: (card: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Cartões" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr>
          <th scope="col" className="w-[42%] px-4 py-2.5 sm:w-1/4">Cartão</th>
          <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Limite</th>
          <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Utilizado</th>
          <th scope="col" className="w-[34%] px-4 py-2.5 text-right sm:w-auto">Disponível</th>
          <th scope="col" className="hidden px-4 py-2.5 lg:table-cell">Fechamento</th>
          <th scope="col" className="hidden px-4 py-2.5 lg:table-cell">Vencimento</th>
          <th scope="col" className="w-[24%] sm:w-20"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {cards.map(card => {
          const editor = renderEditor?.(card)
          return <Fragment key={card.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="px-4 py-2.5">
                <div className="flex items-start gap-2">
                  <CreditCard aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {renderName ? renderName(card) : <span>{card.name}</span>}
                      {card.cardType === 'debit' && (
                        <span className="rounded-md border border-sky-200/80 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/50 dark:text-sky-300">
                          Débito
                        </span>
                      )}
                      {card.cardType === 'credit' && (
                        <span className="rounded-md border border-purple-200/80 bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:border-purple-800/60 dark:bg-purple-950/50 dark:text-purple-300">
                          Crédito
                        </span>
                      )}
                      {card.cardType === 'both' && (
                        <span className="rounded-md border border-emerald-200/80 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                          Débito e Crédito
                        </span>
                      )}
                    </div>
                    {card.status && card.status!=='active' && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{card.status==='cancelled' ? 'Cancelado' : card.status==='archived' ? 'Arquivado' : card.status}</p>}
                    <div className="mt-1 space-y-0.5 break-normal text-xs text-slate-500 dark:text-slate-400 sm:hidden">
                      {card.cardType === 'debit' ? (
                        <p className="text-[11px] text-sky-600 dark:text-sky-400 font-medium">Débito em conta bancária</p>
                      ) : (
                        <>
                          <p>Limite<br />{card.limit}</p>
                          <p>Utilizado<br />{card.used}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden break-normal whitespace-normal px-4 py-2.5 text-right [overflow-wrap:anywhere] sm:table-cell">
                {card.cardType === 'debit' ? <span className="text-xs text-slate-400 dark:text-slate-500">Débito em conta</span> : card.limit}
              </td>
              <td className="hidden break-normal whitespace-normal px-4 py-2.5 text-right [overflow-wrap:anywhere] sm:table-cell">
                {card.cardType === 'debit' ? <span className="text-slate-400 dark:text-slate-500">—</span> : card.used}
              </td>
              <td className="break-normal whitespace-normal px-4 py-2.5 text-right font-medium [overflow-wrap:anywhere]">
                {card.cardType === 'debit' ? <span className="text-xs font-normal text-slate-400 dark:text-slate-500">Saldo da conta</span> : card.available}
              </td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">
                {card.cardType === 'debit' ? '—' : card.closingDay == null ? '—' : `Dia ${card.closingDay}`}
              </td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">
                {card.cardType === 'debit' ? '—' : card.dueDay == null ? '—' : `Dia ${card.dueDay}`}
              </td>
              <td className="px-4 py-2.5 text-right">{renderActions?.(card)}</td>
            </tr>
            {editor && <tr><td colSpan={7} className="p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!cards.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Nenhum cartão cadastrado.</td></tr>}
      </tbody>
    </table>
  </div>
}
