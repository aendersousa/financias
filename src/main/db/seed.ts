import type { DatabaseSync } from 'node:sqlite'

const defaultCategories: { nome: string; tipo: 'receita' | 'despesa'; cor: string }[] = [
  { nome: 'Salário', tipo: 'receita', cor: '#22c55e' },
  { nome: 'Freelance', tipo: 'receita', cor: '#16a34a' },
  { nome: 'Investimentos', tipo: 'receita', cor: '#0ea5e9' },
  { nome: 'Outras receitas', tipo: 'receita', cor: '#64748b' },
  { nome: 'Alimentação', tipo: 'despesa', cor: '#f97316' },
  { nome: 'Transporte', tipo: 'despesa', cor: '#eab308' },
  { nome: 'Moradia', tipo: 'despesa', cor: '#a855f7' },
  { nome: 'Saúde', tipo: 'despesa', cor: '#ef4444' },
  { nome: 'Educação', tipo: 'despesa', cor: '#3b82f6' },
  { nome: 'Lazer', tipo: 'despesa', cor: '#ec4899' },
  { nome: 'Compras', tipo: 'despesa', cor: '#f43f5e' },
  { nome: 'Outras despesas', tipo: 'despesa', cor: '#64748b' }
]

export function seedDefaultCategories(db: DatabaseSync): void {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM categories').get() as unknown as { count: number }
  if (count > 0) return

  const insert = db.prepare('INSERT INTO categories (nome, tipo, cor, icone) VALUES (@nome, @tipo, @cor, NULL)')
  db.exec('BEGIN')
  try {
    for (const row of defaultCategories) insert.run(row)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
