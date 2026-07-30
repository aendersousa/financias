import { useEffect, useState } from 'react'
import { PiggyBank } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'
import PageHeader from '../components/PageHeader'

export default function Budget() {
  const budgets = useAppStore((s) => s.budgets)
  const budgetMonth = useAppStore((s) => s.budgetMonth)
  const loadBudgets = useAppStore((s) => s.loadBudgets)
  const setBudget = useAppStore((s) => s.setBudget)

  const [month, setMonth] = useState(budgetMonth)

  useEffect(() => {
    loadBudgets(month)
  }, [month, loadBudgets])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={PiggyBank} title="Orçamento" subtitle="Planejado x realizado por categoria" />

      <div className="card flex items-center gap-3 p-4">
        <label className="field-label">Mês</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="field-input" />
      </div>

      <div className="table-shell">
        <table className="w-full text-sm sm:min-w-[640px]">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2.5">Categoria</th>
              <th className="px-4 py-2.5 text-right">Planejado</th>
              <th className="px-4 py-2.5 text-right">Realizado</th>
              <th className="hidden px-4 py-2.5 sm:table-cell">Progresso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {budgets.map((b) => {
              const pct = b.valor_planejado > 0 ? Math.min(100, (b.valor_realizado / b.valor_planejado) * 100) : 0
              const over = b.valor_planejado > 0 && b.valor_realizado > b.valor_planejado
              return (
                <tr key={b.categoria_id} className="table-row-hover">
                  <td className="px-4 py-2.5">{b.categoria_nome}</td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={b.valor_planejado || ''}
                      onBlur={(e) => setBudget(b.categoria_id, month, Number(e.target.value) || 0)}
                      className="field-input w-24 py-1 text-right sm:w-28"
                    />
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${over ? 'text-red-500' : ''}`}>
                    {formatCurrency(b.valor_realizado)}
                  </td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-2 rounded-full ${over ? 'bg-red-500' : 'bg-gradient-to-r from-sky-500 to-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
            {budgets.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma categoria de despesa cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
