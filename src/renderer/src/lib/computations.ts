import type {
  Account,
  AccountWithBalance,
  Budget,
  BudgetView,
  Category,
  CreditCard,
  CreditCardWithFatura,
  MonthlySummary,
  Transaction,
  TransactionView
} from '../../../shared/types'

export function computeAccountsWithBalance(accounts: Account[], transactions: Transaction[]): AccountWithBalance[] {
  return accounts.map((a) => {
    const saldo = transactions
      .filter((t) => t.account_id === a.id && t.status === 'pago')
      .reduce((sum, t) => sum + (t.tipo === 'receita' ? t.valor : -t.valor), 0)
    return { ...a, saldo_atual: a.saldo_inicial + saldo }
  })
}

export function computeTransactionsView(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
  creditCards: CreditCard[]
): TransactionView[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a.nome]))
  const categoryMap = new Map(categories.map((c) => [c.id, c.nome]))
  const cardMap = new Map(creditCards.map((c) => [c.id, c.nome]))

  return [...transactions]
    .map((t) => ({
      ...t,
      conta_nome: accountMap.get(t.account_id) ?? '',
      categoria_nome: categoryMap.get(t.category_id) ?? '',
      cartao_nome: t.cartao_id ? (cardMap.get(t.cartao_id) ?? null) : null
    }))
    .sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1))
}

function clampDay(year: number, monthIndexZeroBased: number, day: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, monthIndexZeroBased, Math.min(day, lastDayOfMonth)))
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function computeFaturaCycle(diaFechamento: number, today: Date): { inicio: string; fim: string } {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const day = today.getUTCDate()

  let fimMonth = month
  let fimYear = year
  if (day > diaFechamento) {
    fimMonth += 1
    if (fimMonth > 11) {
      fimMonth = 0
      fimYear += 1
    }
  }

  const fimDate = clampDay(fimYear, fimMonth, diaFechamento)
  const inicioBase = new Date(Date.UTC(fimYear, fimMonth - 1, 1))
  const inicioDate = clampDay(inicioBase.getUTCFullYear(), inicioBase.getUTCMonth(), diaFechamento + 1)

  return { inicio: toIso(inicioDate), fim: toIso(fimDate) }
}

export function computeCreditCardsWithFatura(
  cards: CreditCard[],
  transactions: Transaction[]
): CreditCardWithFatura[] {
  const today = new Date()
  return cards.map((card) => {
    const { inicio, fim } = computeFaturaCycle(card.dia_fechamento, today)
    const total = transactions
      .filter((t) => t.cartao_id === card.id && t.tipo === 'despesa' && t.data >= inicio && t.data <= fim)
      .reduce((sum, t) => sum + t.valor, 0)
    return { ...card, fatura_atual: total, fatura_inicio: inicio, fatura_fim: fim }
  })
}

export function computeBudgetView(categories: Category[], budgets: Budget[], transactions: Transaction[], mesAno: string): BudgetView[] {
  return categories
    .filter((c) => c.tipo === 'despesa')
    .map((c) => {
      const budget = budgets.find((b) => b.categoria_id === c.id && b.mes_ano === mesAno)
      const realizado = transactions
        .filter((t) => t.category_id === c.id && t.tipo === 'despesa' && t.data.startsWith(mesAno))
        .reduce((sum, t) => sum + t.valor, 0)
      return {
        id: budget?.id ?? 0,
        categoria_id: c.id,
        categoria_nome: c.nome,
        mes_ano: mesAno,
        valor_planejado: budget?.valor_planejado ?? 0,
        valor_realizado: realizado
      }
    })
    .sort((a, b) => a.categoria_nome.localeCompare(b.categoria_nome))
}

export function computeMonthlySummary(accounts: Account[], transactions: Transaction[], months: number): MonthlySummary[] {
  const saldoInicialTotal = accounts.reduce((sum, a) => sum + a.saldo_inicial, 0)

  const byMonth = new Map<string, { receitas: number; despesas: number }>()
  for (const t of transactions) {
    if (t.status !== 'pago') continue
    const mes = t.data.slice(0, 7)
    const entry = byMonth.get(mes) ?? { receitas: 0, despesas: 0 }
    if (t.tipo === 'receita') entry.receitas += t.valor
    else entry.despesas += t.valor
    byMonth.set(mes, entry)
  }

  const now = new Date()
  const mesesList: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    mesesList.push(d.toISOString().slice(0, 7))
  }

  const firstMonth = mesesList[0]
  let saldoAcumulado = saldoInicialTotal
  for (const [mes, r] of byMonth) {
    if (mes < firstMonth) saldoAcumulado += r.receitas - r.despesas
  }

  return mesesList.map((mes) => {
    const r = byMonth.get(mes) ?? { receitas: 0, despesas: 0 }
    saldoAcumulado += r.receitas - r.despesas
    return { mes, receitas: r.receitas, despesas: r.despesas, saldo_acumulado: saldoAcumulado }
  })
}
