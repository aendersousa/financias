import type { StatementResultingChanges } from 'node:sqlite'
import { getDb } from '../index'
import type { NewInstallmentPurchase, NewTransaction, Transaction, TransactionView } from '../../../shared/types'

function addMonths(dateIso: string, months: number): string {
  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, day))
  return date.toISOString().slice(0, 10)
}

export function listTransactions(): TransactionView[] {
  return getDb()
    .prepare(
      `SELECT t.*, a.nome as conta_nome, c.nome as categoria_nome, cc.nome as cartao_nome
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN credit_cards cc ON cc.id = t.cartao_id
       ORDER BY t.data DESC, t.id DESC`
    )
    .all() as unknown as TransactionView[]
}

export function createTransaction(data: NewTransaction): Transaction {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO transactions (account_id, category_id, tipo, valor, data, descricao, status, cartao_id)
       VALUES (@account_id, @category_id, @tipo, @valor, @data, @descricao, @status, @cartao_id)`
    )
    .run(data)
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid) as unknown as Transaction
}

export function updateTransaction(id: number, data: Partial<NewTransaction>): Transaction {
  const db = getDb()
  const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as unknown as Transaction
  const merged = { ...current, ...data, id }
  db.prepare(
    `UPDATE transactions
     SET account_id=@account_id, category_id=@category_id, tipo=@tipo, valor=@valor,
         data=@data, descricao=@descricao, status=@status, cartao_id=@cartao_id
     WHERE id=@id`
  ).run(merged)
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as unknown as Transaction
}

export function deleteTransaction(id: number): void {
  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(id)
}

export function createInstallmentPurchase(data: NewInstallmentPurchase): Transaction[] {
  const db = getDb()
  const { parcelas, valor_total, ...base } = data
  const valorParcela = Math.round((valor_total / parcelas) * 100) / 100
  const ajusteUltima = Math.round((valor_total - valorParcela * parcelas) * 100) / 100

  const results: Transaction[] = []

  db.exec('BEGIN')
  try {
    let grupoId: number | null = null
    for (let i = 0; i < parcelas; i++) {
      const valorParcelaAtual = i === parcelas - 1 ? valorParcela + ajusteUltima : valorParcela
      const info: StatementResultingChanges = db
        .prepare(
          `INSERT INTO transactions
             (account_id, category_id, tipo, valor, data, descricao, status, cartao_id, recorrencia_id)
           VALUES
             (@account_id, @category_id, 'despesa', @valor, @data, @descricao, @status, @cartao_id, @recorrencia_id)`
        )
        .run({
          account_id: base.account_id,
          category_id: base.category_id,
          valor: valorParcelaAtual,
          data: addMonths(base.data, i),
          descricao: parcelas > 1 ? `${base.descricao} (${i + 1}/${parcelas})` : base.descricao,
          status: i === 0 ? base.status : 'pendente',
          cartao_id: base.cartao_id,
          recorrencia_id: grupoId
        })
      if (i === 0) {
        grupoId = Number(info.lastInsertRowid)
        db.prepare('UPDATE transactions SET recorrencia_id = ? WHERE id = ?').run(grupoId, grupoId)
      }
      results.push(
        db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid) as unknown as Transaction
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return results
}
