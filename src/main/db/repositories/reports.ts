import { getDb } from '../index'
import type { MonthlySummary } from '../../../shared/types'

export function getMonthlySummary(months: number): MonthlySummary[] {
  const db = getDb()

  const { total: saldoInicialTotal } = db
    .prepare('SELECT COALESCE(SUM(saldo_inicial), 0) as total FROM accounts')
    .get() as unknown as { total: number }

  const rows = db
    .prepare(
      `SELECT substr(data, 1, 7) as mes,
         SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) as receitas,
         SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) as despesas
       FROM transactions
       WHERE status = 'pago'
       GROUP BY mes`
    )
    .all() as unknown as { mes: string; receitas: number; despesas: number }[]

  const byMonth = new Map(rows.map((r) => [r.mes, r]))

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
