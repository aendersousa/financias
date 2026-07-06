import { getDb } from '../index'
import type { CreditCard, CreditCardWithFatura, NewCreditCard } from '../../../shared/types'

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

export function listCreditCards(): CreditCardWithFatura[] {
  const db = getDb()
  const cards = db.prepare('SELECT * FROM credit_cards ORDER BY nome').all() as unknown as CreditCard[]
  const today = new Date()

  const faturaStmt = db.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM transactions
     WHERE cartao_id = @cartao_id AND tipo = 'despesa' AND data BETWEEN @inicio AND @fim`
  )

  return cards.map((card) => {
    const { inicio, fim } = computeFaturaCycle(card.dia_fechamento, today)
    const { total } = faturaStmt.get({ cartao_id: card.id, inicio, fim }) as unknown as { total: number }
    return { ...card, fatura_atual: total, fatura_inicio: inicio, fatura_fim: fim }
  })
}

export function createCreditCard(data: NewCreditCard): CreditCard {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO credit_cards (nome, limite, dia_fechamento, dia_vencimento, conta_pagamento_id)
       VALUES (@nome, @limite, @dia_fechamento, @dia_vencimento, @conta_pagamento_id)`
    )
    .run(data)
  return db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(info.lastInsertRowid) as unknown as CreditCard
}

export function updateCreditCard(id: number, data: Partial<NewCreditCard>): CreditCard {
  const db = getDb()
  const current = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(id) as unknown as CreditCard
  const merged = { ...current, ...data, id }
  db.prepare(
    `UPDATE credit_cards
     SET nome=@nome, limite=@limite, dia_fechamento=@dia_fechamento,
         dia_vencimento=@dia_vencimento, conta_pagamento_id=@conta_pagamento_id
     WHERE id=@id`
  ).run(merged)
  return db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(id) as unknown as CreditCard
}

export function deleteCreditCard(id: number): void {
  getDb().prepare('DELETE FROM credit_cards WHERE id = ?').run(id)
}
