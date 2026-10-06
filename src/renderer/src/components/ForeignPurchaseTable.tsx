import { Fragment, type ReactNode } from 'react'
import { Globe2 } from 'lucide-react'

export interface ForeignPurchaseItem {
  id: string
  description: string
  on: string
  original_currency: string
  current_brl_cents: number
  conversion_status: 'estimated' | 'confirmed'
  transaction_status: 'posted' | 'cancelled'
}

export function foreignPurchaseStatus(purchase: ForeignPurchaseItem) {
  return purchase.transaction_status === 'cancelled'
    ? 'Compra cancelada'
    : purchase.conversion_status === 'confirmed' ? 'Conversão confirmada' : 'Conversão estimada'
}

function statusClass(purchase: ForeignPurchaseItem) {
  return purchase.transaction_status === 'posted' && purchase.conversion_status === 'estimated'
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-slate-500 dark:text-slate-400'
}

const day = (value: string) => value.slice(0, 10).split('-').reverse().join('/')

export default function ForeignPurchaseTable<T extends ForeignPurchaseItem>({ purchases, money, originalAmount, renderActions, renderEditor }: {
  purchases: T[]
  money: (cents: number) => string
  originalAmount: (purchase: T) => string
  renderActions?: (purchase: T) => ReactNode
  renderEditor?: (purchase: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Compras internacionais" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr>
          <th scope="col" className="hidden w-[12%] px-4 py-2.5 lg:table-cell">Data</th>
          <th scope="col" className="w-[46%] px-3 py-2.5 sm:w-[48%] lg:w-[25%] sm:px-4">Descrição</th>
          <th scope="col" className="hidden w-[9%] px-4 py-2.5 lg:table-cell">Moeda</th>
          <th scope="col" className="hidden w-[14%] px-4 py-2.5 text-right lg:table-cell">Valor original</th>
          <th scope="col" className="w-[32%] px-3 py-2.5 text-right sm:w-[24%] lg:w-[16%] sm:px-4">Valor em reais</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th>
          <th scope="col" className="w-[22%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {purchases.map(purchase => {
          const editor = renderEditor?.(purchase)
          return <Fragment key={purchase.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">{day(purchase.on)}</td>
              <td className="px-3 py-2.5 sm:px-4">
                <div className="flex items-start gap-2">
                  <Globe2 aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span>{purchase.description}</span>
                    <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400 lg:hidden">
                      <p>{day(purchase.on)}</p>
                      <p>{purchase.original_currency} {originalAmount(purchase)}</p>
                    </div>
                    <p className={`mt-1 text-xs sm:hidden ${statusClass(purchase)}`}>{foreignPurchaseStatus(purchase)}</p>
                  </div>
                </div>
              </td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 lg:table-cell">{purchase.original_currency}</td>
              <td className="hidden break-normal whitespace-normal px-4 py-2.5 text-right [overflow-wrap:anywhere] lg:table-cell">{originalAmount(purchase)}</td>
              <td className="break-normal whitespace-normal px-3 py-2.5 text-right font-medium [overflow-wrap:anywhere] sm:px-4">{money(purchase.current_brl_cents)}</td>
              <td className={`hidden px-4 py-2.5 [overflow-wrap:anywhere] sm:table-cell ${statusClass(purchase)}`}>{foreignPurchaseStatus(purchase)}</td>
              <td className="px-3 py-2.5 text-right sm:px-4">{renderActions?.(purchase)}</td>
            </tr>
            {editor && <tr><td colSpan={7} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!purchases.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma compra nesta lista. Registre uma compra ou escolha outro filtro para consultar o histórico.</td></tr>}
      </tbody>
    </table>
  </div>
}
