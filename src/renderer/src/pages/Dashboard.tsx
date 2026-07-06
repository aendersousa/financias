import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency, formatDate } from '../lib/format'
import type { MonthlySummary } from '../../../shared/types'

export default function Dashboard() {
  const accounts = useAppStore((s) => s.accounts)
  const transactions = useAppStore((s) => s.transactions)
  const [summary, setSummary] = useState<MonthlySummary[]>([])

  useEffect(() => {
    window.api.reports.monthlySummary(6).then(setSummary)
  }, [transactions, accounts])

  const saldoTotal = useMemo(() => accounts.reduce((sum, a) => sum + a.saldo_atual, 0), [accounts])

  const gastosPorCategoria = useMemo(() => {
    const mesAtual = new Date().toISOString().slice(0, 7)
    const totals = new Map<string, { nome: string; valor: number; cor: string }>()
    for (const t of transactions) {
      if (t.tipo !== 'despesa' || !t.data.startsWith(mesAtual)) continue
      const existing = totals.get(t.categoria_nome)
      if (existing) {
        existing.valor += t.valor
      } else {
        totals.set(t.categoria_nome, { nome: t.categoria_nome, valor: t.valor, cor: '#64748b' })
      }
    }
    return Array.from(totals.values())
  }, [transactions])

  const palette = ['#0ea5e9', '#f97316', '#a855f7', '#22c55e', '#ef4444', '#eab308', '#ec4899', '#64748b']

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">Saldo total</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {formatCurrency(saldoTotal)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">Contas cadastradas</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{accounts.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">Lançamentos</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{transactions.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Receitas x despesas (últimos 6 meses)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summary}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={80} tickFormatter={(v) => formatCurrency(Number(v))} />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Legend />
              <Bar dataKey="receitas" name="Receitas" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesas" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Evolução do saldo (últimos 6 meses)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={summary}>
              <defs>
                <linearGradient id="saldoGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={80} tickFormatter={(v) => formatCurrency(Number(v))} />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Area
                type="monotone"
                dataKey="saldo_acumulado"
                name="Saldo"
                stroke="#0ea5e9"
                fill="url(#saldoGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Gastos por categoria (mês atual)
          </h2>
          {gastosPorCategoria.length === 0 ? (
            <p className="text-sm text-slate-400">Sem despesas registradas este mês.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={gastosPorCategoria} dataKey="valor" nameKey="nome" innerRadius={50} outerRadius={90}>
                  {gastosPorCategoria.map((_, index) => (
                    <Cell key={index} fill={palette[index % palette.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Últimos lançamentos</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {transactions.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{t.descricao || t.categoria_nome}</p>
                  <p className="text-xs text-slate-400">
                    {formatDate(t.data)} · {t.conta_nome}
                  </p>
                </div>
                <span className={t.tipo === 'receita' ? 'text-green-600' : 'text-red-500'}>
                  {t.tipo === 'receita' ? '+' : '-'}
                  {formatCurrency(t.valor)}
                </span>
              </li>
            ))}
            {transactions.length === 0 && <p className="py-2 text-sm text-slate-400">Nenhum lançamento ainda.</p>}
          </ul>
        </div>
      </div>
    </div>
  )
}
