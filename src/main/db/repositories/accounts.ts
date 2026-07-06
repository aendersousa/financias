import { getDb } from '../index'
import type { Account, AccountWithBalance, NewAccount } from '../../../shared/types'

export function listAccounts(): AccountWithBalance[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT a.*,
        a.saldo_inicial + COALESCE(SUM(
          CASE WHEN t.status = 'pago' THEN
            CASE WHEN t.tipo = 'receita' THEN t.valor ELSE -t.valor END
          ELSE 0 END
        ), 0) AS saldo_atual
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      GROUP BY a.id
      ORDER BY a.nome`
    )
    .all() as unknown as AccountWithBalance[]
}

export function createAccount(data: NewAccount): Account {
  const db = getDb()
  const info = db
    .prepare('INSERT INTO accounts (nome, tipo, saldo_inicial, cor) VALUES (@nome, @tipo, @saldo_inicial, @cor)')
    .run(data)
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid) as unknown as Account
}

export function updateAccount(id: number, data: Partial<NewAccount>): Account {
  const db = getDb()
  const current = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as Account
  const merged = { ...current, ...data, id }
  db.prepare('UPDATE accounts SET nome=@nome, tipo=@tipo, saldo_inicial=@saldo_inicial, cor=@cor WHERE id=@id').run(merged)
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as Account
}

export function deleteAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
