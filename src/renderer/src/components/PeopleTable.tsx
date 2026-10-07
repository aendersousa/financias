import { Fragment, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, UserRound } from 'lucide-react'

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
          <th scope="col" className="w-[42%] px-3 py-2.5 sm:w-[35%] sm:px-4">Pessoa</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell sm:w-[22%]">Situação</th>
          <th scope="col" className="w-[30%] px-3 py-2.5 text-right sm:w-[23%] sm:px-4">Saldo</th>
          <th scope="col" className="w-[28%] px-3 sm:w-[20%] sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {people.map(person => {
          const editor = renderEditor?.(person)
          const isReceivable = person.balance_cents > 0
          const isPayable = person.balance_cents < 0
          const initial = (person.nickname.trim()[0] || 'P').toUpperCase()

          return <Fragment key={person.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="px-3 py-3 sm:px-4">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-transform ${
                    isReceivable
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : isPayable
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {renderName ? renderName(person) : <span>{person.nickname}</span>}
                    </div>
                    {person.archived_at && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Arquivada</p>}
                    <div className="mt-1 sm:hidden">
                      {isReceivable ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <ArrowDownLeft size={11} className="shrink-0" />
                          Te deve
                        </span>
                      ) : isPayable ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                          <ArrowUpRight size={11} className="shrink-0" />
                          Você deve
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          <Check size={11} className="shrink-0" />
                          Em dia
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                {isReceivable ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <ArrowDownLeft size={13} className="shrink-0" />
                    Te deve
                  </span>
                ) : isPayable ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    <ArrowUpRight size={13} className="shrink-0" />
                    Você deve
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    <Check size={13} className="shrink-0" />
                    Em dia
                  </span>
                )}
              </td>
              <td className="px-3 py-3 text-right font-medium sm:px-4">
                <span className={`block font-semibold ${
                  isReceivable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isPayable
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                }`}>
                  {money(Math.abs(person.balance_cents))}
                </span>
              </td>
              <td className="px-3 py-3 text-right sm:px-4">
                {renderActions?.(person)}
              </td>
            </tr>
            {editor && <tr><td colSpan={4} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!people.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">Nenhuma pessoa encontrada com os filtros atuais.</td></tr>}
      </tbody>
    </table>
  </div>
}
