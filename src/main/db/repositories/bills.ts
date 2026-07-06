import { getDb } from '../index'
import type { Bill, NewBill } from '../../../shared/types'

export function listBills(): Bill[] {
  return getDb().prepare('SELECT * FROM bills ORDER BY vencimento').all() as unknown as Bill[]
}

export function createBill(data: NewBill): Bill {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO bills (descricao, valor, vencimento, tipo, status, recorrencia, conta_id)
       VALUES (@descricao, @valor, @vencimento, @tipo, @status, @recorrencia, @conta_id)`
    )
    .run(data)
  return db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid) as unknown as Bill
}

export function updateBill(id: number, data: Partial<NewBill>): Bill {
  const db = getDb()
  const current = db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as unknown as Bill
  const merged = { ...current, ...data, id }
  db.prepare(
    `UPDATE bills
     SET descricao=@descricao, valor=@valor, vencimento=@vencimento, tipo=@tipo,
         status=@status, recorrencia=@recorrencia, conta_id=@conta_id
     WHERE id=@id`
  ).run(merged)
  return db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as unknown as Bill
}

export function deleteBill(id: number): void {
  getDb().prepare('DELETE FROM bills WHERE id = ?').run(id)
}
