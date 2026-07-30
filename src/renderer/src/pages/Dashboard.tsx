import { useMemo } from 'react'
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
import { LayoutDashboard, ListOrdered, Wallet } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency, formatDate } from '../lib/format'
import { computeMonthlySummary } from '../lib/computations'
import { categoricalPaletteDark, categoricalPaletteLight, statusCritical, statusGood } from '../lib/palette'
import PageHeader from '../components/PageHeader'

export default function Dashboard() {
  const accounts = useAppStore((s) => s.accounts)
  const transactions = useAppStore((s) => s.transactions)
  const theme = useAppStore((s) => s.theme)
  const palette = theme === 'dark' ? categoricalPaletteDark : categoricalPaletteLight
  const tickColor = theme === 'dark' ? '#94a3b8' : '#64748b'
  const legendStyle = { color: tickColor, fontSize: 13 }
  const tooltipContentStyle = {
    backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
    border: `1px solid ${theme === 'dark' ? '#334155' : '#e2e8f0'}`,
    borderRadius: 8,
    fontSize: 13
  }
  const tooltipLabelStyle = { color: theme === 'dark' ? '#f1f5f9' : '#1e293b' }

  const summary = useMemo(() => computeMonthlySummary(accounts, transactions, 6), [accounts, transactions])

  const saldoTotal = useMemo(() => accounts.reduce((sum, a) => sum + a.saldo_atual, 0), [accounts])

  const gastosPorCategoria = useMemo(() => {
    const mesAtual = new Date().toISOString().slice(0, 7)
    const totals = new Map<string, number>()
    for (const t of transactions) {
      if (t.tipo !== 'despesa' || !t.data.startsWith(mesAtual)) continue
      totals.set(t.categoria_nome, (totals.get(t.categoria_nome) ?? 0) + t.valor)
    }
    return Array.from(totals.entries()).map(([nome, valor]) => ({ nome, valor }))
  }, [transactions])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={LayoutDashboard} title="Dashboard" subtitle="Visão geral das suas finanças" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card flex items-center gap-4 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Wallet size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Saldo total</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(saldoTotal)}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Wallet size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Contas cadastradas</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">{accounts.length}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <ListOrdered size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Lançamentos</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">{transactions.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Receitas x despesas (últimos 6 meses)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summary}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: tickColor }} />
              <YAxis
                tick={{ fontSize: 12, fill: tickColor }}
                width={80}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
              />
              <Legend wrapperStyle={legendStyle} />
              <Bar dataKey="receitas" name="Receitas" fill={statusGood} radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesas" name="Despesas" fill={statusCritical} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Evolução do saldo (últimos 6 meses)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={summary}>
              <defs>
                <linearGradient id="saldoGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette[0]} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={palette[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: tickColor }} />
              <YAxis
                tick={{ fontSize: 12, fill: tickColor }}
                width={80}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
              />
              <Area
                type="monotone"
                dataKey="saldo_acumulado"
                name="Saldo"
                stroke={palette[0]}
                fill="url(#saldoGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
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
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                />
                <Legend wrapperStyle={legendStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-4">
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
                <span
                  className="font-medium"
                  style={{ color: t.tipo === 'receita' ? statusGood : statusCritical }}
                >
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
