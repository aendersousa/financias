import { Fragment, type ReactNode } from 'react'
import { UserRound } from 'lucide-react'

export interface PersonItem {
  id: string
  nickname: string
  balance_cents: number
  archived_at?: string | null
  notes?: string | null
}

export default function PeopleTable<T extends PersonItem>({ people, money, renderName, renderActions, renderEditor }: {
  people: T[]
  money: (cents: number) => string
  renderName?: (person: T) => ReactNode
  renderActions?: (person: T) => ReactNode
  renderEditor?: (person: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Pessoas" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr>
          <th scope="col" className="w-[48%] px-3 py-2.5 sm:w-[40%] sm:px-4">Pessoa</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th>
          <th scope="col" className="w-[30%] px-3 py-2.5 text-right sm:w-[26%] sm:px-4">Saldo</th>
          <th scope="col" className="w-[22%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {people.map(person => {
          const editor = renderEditor?.(person)
          const situation = person.balance_cents > 0 ? 'A receber' : person.balance_cents < 0 ? 'A pagar' : 'Acertado'
          const situationClass = person.balance_cents > 0
            ? 'text-brand-600 dark:text-brand-400'
            : person.balance_cents < 0
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-500 dark:text-slate-400'
          return <Fragment key={person.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="px-3 py-2.5 sm:px-4">
                <div className="flex items-start gap-2">
                  <UserRound aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {renderName ? renderName(person) : <span>{person.nickname}</span>}
                    {person.archived_at && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Arquivada</p>}
                    <p className={`mt-1 text-xs sm:hidden ${situationClass}`}>{situation}</p>
                  </div>
                </div>
              </td>
              <td className={`hidden px-4 py-2.5 sm:table-cell ${situationClass}`}>{situation}</td>
              <td className="break-normal whitespace-normal px-3 py-2.5 text-right font-medium [overflow-wrap:anywhere] sm:px-4">{money(Math.abs(person.balance_cents))}</td>
              <td className="px-3 py-2.5 text-right sm:px-4">{renderActions?.(person)}</td>
            </tr>
            {editor && <tr><td colSpan={4} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!people.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma pessoa cadastrada.</td></tr>}
      </tbody>
    </table>
  </div>
}
