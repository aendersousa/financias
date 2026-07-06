import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'

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
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="text-xs text-slate-500">Mês</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2 text-right">Planejado</th>
              <th className="px-4 py-2 text-right">Realizado</th>
              <th className="px-4 py-2">Progresso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {budgets.map((b) => {
              const pct = b.valor_planejado > 0 ? Math.min(100, (b.valor_realizado / b.valor_planejado) * 100) : 0
              const over = b.valor_planejado > 0 && b.valor_realizado > b.valor_planejado
              return (
                <tr key={b.categoria_id}>
                  <td className="px-4 py-2">{b.categoria_nome}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={b.valor_planejado || ''}
                      onBlur={(e) => setBudget(b.categoria_id, month, Number(e.target.value) || 0)}
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                  </td>
                  <td className={`px-4 py-2 text-right font-medium ${over ? 'text-red-500' : ''}`}>
                    {formatCurrency(b.valor_realizado)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-2 rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
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
