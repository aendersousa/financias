import { getDb } from '../index'
import type { Category, NewCategory } from '../../../shared/types'

export function listCategories(): Category[] {
  return getDb().prepare('SELECT * FROM categories ORDER BY tipo, nome').all() as unknown as Category[]
}

export function createCategory(data: NewCategory): Category {
  const db = getDb()
  const info = db
    .prepare('INSERT INTO categories (nome, tipo, cor, icone) VALUES (@nome, @tipo, @cor, @icone)')
    .run(data)
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) as unknown as Category
}

export function updateCategory(id: number, data: Partial<NewCategory>): Category {
  const db = getDb()
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as unknown as Category
  const merged = { ...current, ...data, id }
  db.prepare('UPDATE categories SET nome=@nome, tipo=@tipo, cor=@cor, icone=@icone WHERE id=@id').run(merged)
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as unknown as Category
}

export function deleteCategory(id: number): void {
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
}
