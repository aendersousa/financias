import { getDb } from '../index'
import type { BudgetView } from '../../../shared/types'

export function listBudgets(mesAno: string): BudgetView[] {
  return getDb()
    .prepare(
      `SELECT c.id as categoria_id, c.nome as categoria_nome, @mesAno as mes_ano,
         COALESCE(b.id, 0) as id,
         COALESCE(b.valor_planejado, 0) as valor_planejado,
         COALESCE((
           SELECT SUM(t.valor) FROM transactions t
           WHERE t.category_id = c.id AND t.tipo = 'despesa' AND t.data LIKE @mesAno || '%'
         ), 0) as valor_realizado
       FROM categories c
       LEFT JOIN budgets b ON b.categoria_id = c.id AND b.mes_ano = @mesAno
       WHERE c.tipo = 'despesa'
       ORDER BY c.nome`
    )
    .all({ mesAno }) as unknown as BudgetView[]
}

export function setBudget(categoriaId: number, mesAno: string, valorPlanejado: number): void {
  getDb()
    .prepare(
      `INSERT INTO budgets (categoria_id, mes_ano, valor_planejado)
       VALUES (@categoria_id, @mes_ano, @valor_planejado)
       ON CONFLICT(categoria_id, mes_ano) DO UPDATE SET valor_planejado = excluded.valor_planejado`
    )
    .run({ categoria_id: categoriaId, mes_ano: mesAno, valor_planejado: valorPlanejado })
}
