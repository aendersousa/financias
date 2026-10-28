import { Fragment, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Calendar, Check, Clock } from 'lucide-react'
import { getPersonLoanTerms } from '../../../shared/finance/peopleLoans'

export interface PersonItem {
  id: string
  nickname: string
  balance_cents: number
  received_cents?: number
  paid_cents?: number
  lent_cents?: number
  borrowed_cents?: number
  interest_received_cents?: number
  interest_paid_cents?: number
  archived_at?: string | null
  notes?: string | null
  opening_on?: string | null
  reminders?: {
    id: string
    title: string
    due_on: string
    completed_at: string | null
  }[]
}

const displayDate = (value: string) => value.split('-').reverse().join('/')

export default function PeopleTable<T extends PersonItem>({ people, money, today, renderName, renderActions, renderEditor, onConfigureLoan }: {
  people: T[]
  money: (cents: number) => string
  today?: string
  renderName?: (person: T) => ReactNode
  renderActions?: (person: T) => ReactNode
  renderEditor?: (person: T) => ReactNode
  onConfigureLoan?: (person: T) => void
}) {
  const effectiveToday = today || new Date().toISOString().split('T')[0]

  return <div className="table-shell">
    <table aria-label="Pessoas" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr>
          <th scope="col" className="w-[34%] px-3 py-2.5 sm:w-[20%] sm:px-4">Pessoa</th>
          <th scope="col" className="hidden lg:table-cell lg:w-[11%] px-3 py-2.5">Início</th>
          <th scope="col" className="hidden sm:table-cell sm:w-[15%] px-3 py-2.5">Próx. Pagamento</th>
          <th scope="col" className="hidden sm:table-cell sm:w-[13%] px-3 py-2.5">Parcelas</th>
          <th scope="col" className="hidden md:table-cell md:w-[11%] px-3 py-2.5">Situação</th>
          <th scope="col" className="hidden w-[13%] px-3 py-2.5 text-right xl:table-cell">Emprestado / pago</th>
          <th scope="col" className="w-[33%] px-3 py-2.5 text-right sm:w-[15%] sm:px-4">Falta pagar</th>
          <th scope="col" className="w-[33%] px-3 text-right sm:w-[15%] sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {people.map(person => {
          const editor = renderEditor?.(person)
          const isReceivable = person.balance_cents > 0
          const isPayable = person.balance_cents < 0
          const initial = (person.nickname.trim()[0] || 'P').toUpperCase()
          const loanTerms = getPersonLoanTerms(person, effectiveToday)
          const hasDebt = loanTerms.totalRemainingCents !== 0
          const loanDates = loanTerms

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
                    <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400 xl:hidden"><p>Total emprestado: {person.lent_cents===undefined?'—':money(isPayable?person.borrowed_cents??0:person.lent_cents)}</p><p>Juros pagos: {person.interest_received_cents===undefined?'—':money(isPayable?person.interest_paid_cents??0:person.interest_received_cents)}</p></div>

                    {/* Mobile: badges e datas resumidas */}
                    <div className="mt-1 sm:hidden flex flex-wrap items-center gap-1.5">
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

                      {(loanDates.startDate || (hasDebt && loanDates.nextDueDate) || (hasDebt && loanTerms.installmentsBadge)) && (
                        <div className="w-full flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                          {loanDates.startDate && <span>Início: {displayDate(loanDates.startDate)}</span>}
                          {loanDates.startDate && hasDebt && loanDates.nextDueDate && <span>•</span>}
                          {hasDebt && loanDates.nextDueDate && (
                            <span className={loanDates.isOverdue ? 'font-semibold text-rose-600 dark:text-rose-400' : loanDates.isToday ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
                              Próx: {displayDate(loanDates.nextDueDate)}
                            </span>
                          )}
                          {hasDebt && loanTerms.installmentsBadge && (
                            <>
                              <span>•</span>
                              <span className="font-semibold text-brand-700 dark:text-brand-300">
                                {loanTerms.installmentsText || loanTerms.installmentsBadge}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </td>

              {/* Data inicial do empréstimo */}
              <td className="hidden lg:table-cell px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                {loanDates.startDate ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                    <Calendar size={13} className="shrink-0 text-slate-400 dark:text-slate-500" />
                    <span>{displayDate(loanDates.startDate)}</span>
                  </span>
                ) : (
                  <span className="text-slate-300 dark:text-slate-600">—</span>
                )}
              </td>

              {/* Data do próximo pagamento */}
              <td className="hidden sm:table-cell px-3 py-3 text-xs">
                {hasDebt && loanDates.nextDueDate ? (
                  loanDates.isOverdue ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                      <Clock size={12} className="shrink-0" />
                      <span>Venceu ({displayDate(loanDates.nextDueDate)})</span>
                    </span>
                  ) : loanDates.isToday ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                      <Clock size={12} className="shrink-0" />
                      <span>Vence hoje ({displayDate(loanDates.nextDueDate)})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                      <Clock size={13} className="shrink-0 text-brand-600 dark:text-brand-400" />
                      <span>{displayDate(loanDates.nextDueDate)}</span>
                    </span>
                  )
                ) : !hasDebt && loanTerms.totalInstallments && loanTerms.totalInstallments > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                    <Check size={13} className="shrink-0" />
                    <span>Quitado</span>
                  </span>
                ) : (
                  <span className="text-slate-300 dark:text-slate-600">—</span>
                )}
              </td>

              {/* Parcelas (quantas vezes vai pagar) */}
              <td className="hidden sm:table-cell px-3 py-3 text-xs">
                {hasDebt ? (
                  loanTerms.installmentsBadge ? (
                    <div className="flex flex-col items-start gap-0.5">
                      {onConfigureLoan ? (
                        <button
                          type="button"
                          onClick={() => onConfigureLoan(person)}
                          className="group flex flex-col items-start gap-0.5 text-left transition hover:opacity-85"
                          title="Clique para ver ou alterar as condições de parcelamento e juros"
                        >
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold transition group-hover:ring-2 group-hover:ring-brand-500/30 ${
                            loanTerms.payMode === 'indefinite'
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                              : loanTerms.payMode === 'single'
                                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                          }`}>
                            {loanTerms.payMode === 'indefinite' && <Clock size={11} className="shrink-0" />}
                            <span>{loanTerms.installmentsBadge}</span>
                          </span>
                          {loanTerms.installmentDetail && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {loanTerms.installmentDetail}
                            </span>
                          )}
                          {loanTerms.payMode === 'installments' && loanTerms.installmentsText && <span className="text-[11px] text-slate-500 dark:text-slate-400">{loanTerms.installmentsText}</span>}
                        </button>
                      ) : (
                        <>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                            loanTerms.payMode === 'indefinite'
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                              : loanTerms.payMode === 'single'
                                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                          }`}>
                            {loanTerms.payMode === 'indefinite' && <Clock size={11} className="shrink-0" />}
                            <span>{loanTerms.installmentsBadge}</span>
                          </span>
                          {loanTerms.installmentDetail && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {loanTerms.installmentDetail}
                            </span>
                          )}
                          {loanTerms.payMode === 'installments' && loanTerms.installmentsText && <span className="text-[11px] text-slate-500 dark:text-slate-400">{loanTerms.installmentsText}</span>}
                        </>
                      )}
                    </div>
                  ) : onConfigureLoan ? (
                    <button
                      type="button"
                      onClick={() => onConfigureLoan(person)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400"
                      title="Definir quantas parcelas e juros para esta dívida"
                    >
                      <span>Não informado · Definir</span>
                    </button>
                  ) : (
                    <span className="text-slate-300 dark:text-slate-600">—</span>
                  )
                ) : loanTerms.totalInstallments && loanTerms.totalInstallments > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <Check size={11} className="shrink-0" />
                    <span>Quitado {loanTerms.totalInstallments > 1 ? `(${loanTerms.totalInstallments}x)` : ''}</span>
                  </span>
                ) : (
                  <span className="text-slate-300 dark:text-slate-600">—</span>
                )}
              </td>

              {/* Situação */}
              <td className="hidden md:table-cell px-3 py-3">
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

              <td className="hidden px-3 py-3 text-right tabular-nums xl:table-cell"><p className="text-xs text-slate-500">Total emprestado</p><p className="font-semibold">{person.lent_cents===undefined?'—':money(isPayable?person.borrowed_cents??0:person.lent_cents)}</p><p className="mt-1 text-xs text-slate-500">Já pago: {person.received_cents===undefined?'—':money(isPayable?person.paid_cents??0:hasDebt?person.received_cents:person.received_cents+(person.paid_cents??0))}</p><p title="Soma dos pagamentos em que os juros foram informados separadamente. Juros previstos não entram neste total." className="mt-1 text-xs text-slate-500">Juros pagos: {person.interest_received_cents===undefined?'—':money(isPayable?person.interest_paid_cents??0:person.interest_received_cents)}</p></td>
              {/* Saldo */}
              <td className="px-3 py-3 text-right font-medium sm:px-4">
                <span className={`block font-semibold ${
                  isReceivable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isPayable
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                }`}>
                  {money(loanTerms.totalRemainingCents)}
                </span>
                {hasDebt && <span className="mt-1 block text-[11px] font-normal text-slate-500 dark:text-slate-400">Principal: {money(loanTerms.principalRemainingCents)}<br/>Juros a pagar: {loanTerms.interestKnown ? money(loanTerms.interestRemainingCents) : 'Não informado'}{loanTerms.payMode === 'indefinite' && loanTerms.interestKnown && <><br/>Acumulados até {displayDate(effectiveToday)}</>}</span>}
                <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400 xl:hidden">Já pago: {person.received_cents===undefined?'—':money(isPayable?person.paid_cents??0:hasDebt?person.received_cents:person.received_cents+(person.paid_cents??0))}</span>
                {isPayable&&<span className="mt-1 block text-xs font-normal text-slate-500">Por você</span>}
              </td>

              {/* Ações */}
              <td className="px-3 py-3 text-right sm:px-4">
                {renderActions?.(person)}
              </td>
            </tr>
            {editor && <tr><td colSpan={8} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!people.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">Nenhuma pessoa encontrada com os filtros atuais.</td></tr>}
      </tbody>
    </table>
  </div>
}
