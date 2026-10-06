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
                    {renderName ? renderName(card) : <span>{card.name}</span>}
                    {card.status && card.status!=='active' && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{card.status==='cancelled' ? 'Cancelado' : card.status==='archived' ? 'Arquivado' : card.status}</p>}
                    <div className="mt-1 space-y-0.5 break-normal text-xs text-slate-500 dark:text-slate-400 sm:hidden">
                      <p>Limite<br />{card.limit}</p>
                      <p>Utilizado<br />{card.used}</p>
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden break-normal whitespace-normal px-4 py-2.5 text-right [overflow-wrap:anywhere] sm:table-cell">{card.limit}</td>
              <td className="hidden break-normal whitespace-normal px-4 py-2.5 text-right [overflow-wrap:anywhere] sm:table-cell">{card.used}</td>
              <td className="break-normal whitespace-normal px-4 py-2.5 text-right font-medium [overflow-wrap:anywhere]">{card.available}</td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">{card.closingDay == null ? '—' : `Dia ${card.closingDay}`}</td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">{card.dueDay == null ? '—' : `Dia ${card.dueDay}`}</td>
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
