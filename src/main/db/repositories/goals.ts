import { getDb } from '../index'
import type { Goal, NewGoal } from '../../../shared/types'

export function listGoals(): Goal[] {
  return getDb().prepare('SELECT * FROM goals ORDER BY nome').all() as unknown as Goal[]
}

export function createGoal(data: NewGoal): Goal {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO goals (nome, valor_alvo, valor_atual, prazo)
       VALUES (@nome, @valor_alvo, @valor_atual, @prazo)`
    )
    .run(data)
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid) as unknown as Goal
}

export function updateGoal(id: number, data: Partial<NewGoal>): Goal {
  const db = getDb()
  const current = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as unknown as Goal
  const merged = { ...current, ...data, id }
  db.prepare(
    `UPDATE goals SET nome=@nome, valor_alvo=@valor_alvo, valor_atual=@valor_atual, prazo=@prazo WHERE id=@id`
  ).run(merged)
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as unknown as Goal
}

export function deleteGoal(id: number): void {
  getDb().prepare('DELETE FROM goals WHERE id = ?').run(id)
}
