import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  Goal as GoalIcon,
  LayoutDashboard,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency, formatDate, todayIso } from '../lib/format'
import { computeMonthlySummary } from '../lib/computations'
import {
  categoricalPaletteDark,
  categoricalPaletteLight,
  colorForKey,
  statusCritical,
  statusGood,
  statusWarning
} from '../lib/palette'
import PageHeader from '../components/PageHeader'

type Delta = { pct: number; isUp: boolean; isGood: boolean }

function computeDelta(curr: number, prev: number | undefined, invert = false): Delta | null {
  if (prev === undefined || prev === 0) return null
  const diff = curr - prev
  const pct = (diff / Math.abs(prev)) * 100
  if (Math.abs(pct) < 0.5) return null
  const isUp = diff > 0
  return { pct, isUp, isGood: invert ? !isUp : isUp }
}

function daysUntil(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number)
  const target = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86400000)
}

function billUrgency(vencimento: string): { label: string; color: string } {
  const diff = daysUntil(vencimento)
  if (diff < 0) return { label: `Atrasada há ${Math.abs(diff)}d`, color: statusCritical }
  if (diff === 0) return { label: 'Vence hoje', color: statusCritical }
  if (diff <= 3) return { label: `Vence em ${diff}d`, color: statusWarning }
  return { label: `Vence em ${formatDate(vencimento)}`, color: '#94a3b8' }
}

export default function Dashboard() {
  const accounts = useAppStore((s) => s.accounts)
  const transactions = useAppStore((s) => s.transactions)
  const creditCards = useAppStore((s) => s.creditCards)
  const bills = useAppStore((s) => s.bills)
  const goals = useAppStore((s) => s.goals)
  const theme = useAppStore((s) => s.theme)
  const palette = theme === 'dark' ? categoricalPaletteDark : categoricalPaletteLight
  const tickColor = theme === 'dark' ? '#94a3b8' : '#64748b'
  const tooltipContentStyle = {
    backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
    border: `1px solid ${theme === 'dark' ? '#334155' : '#e2e8f0'}`,
    borderRadius: 8,
    fontSize: 13
  }
  const tooltipLabelStyle = { color: theme === 'dark' ? '#f1f5f9' : '#1e293b' }
  const surfaceColor = theme === 'dark' ? '#0f172a' : '#ffffff'
  const mutedColor = theme === 'dark' ? '#475569' : '#cbd5e1'

  const monthLabel = useMemo(() => {
    const s = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return s.charAt(0).toUpperCase() + s.slice(1)
  }, [])

  const summary = useMemo(() => computeMonthlySummary(accounts, transactions, 6), [accounts, transactions])
  const current = summary[summary.length - 1]
  const previous = summary[summary.length - 2]

  const saldoTotal = useMemo(() => accounts.reduce((sum, a) => sum + a.saldo_atual, 0), [accounts])
  const receitasMes = current?.receitas ?? 0
  const despesasMes = current?.despesas ?? 0
  const resultadoMes = receitasMes - despesasMes
  const resultadoAnterior = previous ? previous.receitas - previous.despesas : undefined

  const saldoDelta = computeDelta(saldoTotal, previous?.saldo_acumulado)
  const receitasDelta = computeDelta(receitasMes, previous?.receitas)
  const despesasDelta = computeDelta(despesasMes, previous?.despesas, true)
  const resultadoDelta = computeDelta(resultadoMes, resultadoAnterior)

  const gastosPorCategoria = useMemo(() => {
    const mesAtual = new Date().toISOString().slice(0, 7)
    const totals = new Map<number, { nome: string; valor: number }>()
    for (const t of transactions) {
      if (t.tipo !== 'despesa' || !t.data.startsWith(mesAtual)) continue
      const entry = totals.get(t.category_id) ?? { nome: t.categoria_nome, valor: 0 }
      entry.valor += t.valor
      totals.set(t.category_id, entry)
    }
    const sorted = Array.from(totals.entries())
      .map(([id, v]) => ({ id, nome: v.nome, valor: v.valor }))
      .sort((a, b) => b.valor - a.valor)

    if (sorted.length <= 8) return sorted
    const outros = sorted.slice(7).reduce((sum, c) => sum + c.valor, 0)
    return [...sorted.slice(0, 7), { id: -1, nome: 'Outros', valor: outros }]
  }, [transactions])

  const totalGastos = useMemo(() => gastosPorCategoria.reduce((sum, c) => sum + c.valor, 0), [gastosPorCategoria])

  const proximasContas = useMemo(
    () =>
      bills
        .filter((b) => b.status === 'pendente')
        .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1))
        .slice(0, 5),
    [bills]
  )

  const cardsWithUsage = useMemo(
    () =>
      creditCards.map((c) => ({
        ...c,
        pct: c.limite > 0 ? Math.min(100, (c.fatura_atual / c.limite) * 100) : 0
      })),
    [creditCards]
  )

  function meterColor(pct: number): string {
    if (pct >= 90) return statusCritical
    if (pct >= 70) return statusWarning
    return palette[0]
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={LayoutDashboard} title="Dashboard" subtitle={`Resumo de ${monthLabel}`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={Wallet}
          iconBg="bg-sky-500/10"
          iconColor="text-sky-600 dark:text-sky-400"
          label="Saldo total"
          value={formatCurrency(saldoTotal)}
          delta={saldoDelta}
        />
        <StatTile
          icon={TrendingUp}
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-600 dark:text-emerald-400"
          label="Receitas do mês"
          value={formatCurrency(receitasMes)}
          delta={receitasDelta}
        />
        <StatTile
          icon={TrendingDown}
          iconBg="bg-rose-500/10"
          iconColor="text-rose-600 dark:text-rose-400"
          label="Despesas do mês"
          value={formatCurrency(despesasMes)}
          delta={despesasDelta}
        />
        <StatTile
          icon={Scale}
          iconBg="bg-violet-500/10"
          iconColor="text-violet-600 dark:text-violet-400"
          label="Resultado do mês"
          value={formatCurrency(resultadoMes)}
          delta={resultadoDelta}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Receitas x despesas (últimos 6 meses)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summary} barGap={4} barCategoryGap="24%">
              <CartesianGrid vertical={false} className="stroke-slate-200 dark:stroke-slate-800" />
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
              <Bar dataKey="receitas" name="Receitas" fill={statusGood} radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="despesas" name="Despesas" fill={statusCritical} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Receitas', color: statusGood }, { label: 'Despesas', color: statusCritical }]} />
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Evolução do saldo (últimos 6 meses)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={summary}>
              <defs>
                <linearGradient id="saldoGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette[0]} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={palette[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} className="stroke-slate-200 dark:stroke-slate-800" />
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
                strokeWidth={2}
                fill="url(#saldoGradient)"
                dot={(props: { cx?: number; cy?: number; index?: number }) => {
                  const isLast = props.index === summary.length - 1
                  return (
                    <circle
                      key={`saldo-dot-${props.index}`}
                      cx={props.cx}
                      cy={props.cy}
                      r={isLast ? 4 : 0}
                      fill={palette[0]}
                      stroke={surfaceColor}
                      strokeWidth={isLast ? 2 : 0}
                    />
                  )
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Gastos por categoria ({monthLabel})
        </h2>
        {gastosPorCategoria.length === 0 ? (
          <p className="text-sm text-slate-400">Sem despesas registradas este mês.</p>
        ) : (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="relative mx-auto w-full max-w-[240px] shrink-0 lg:mx-0">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={gastosPorCategoria}
                    dataKey="valor"
                    nameKey="nome"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={gastosPorCategoria.length > 1 ? 2 : 0}
                    stroke={surfaceColor}
                    strokeWidth={2}
                  >
                    {gastosPorCategoria.map((c) => (
                      <Cell key={c.id} fill={c.id === -1 ? mutedColor : colorForKey(c.id, palette)} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={tooltipContentStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="text-xs text-slate-400">Total</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {formatCurrency(totalGastos)}
                </span>
              </div>
            </div>
            <div className="flex-1 divide-y divide-slate-100 dark:divide-slate-800">
              {gastosPorCategoria.map((c) => {
                const pct = totalGastos > 0 ? (c.valor / totalGastos) * 100 : 0
                return (
                  <div key={c.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c.id === -1 ? mutedColor : colorForKey(c.id, palette) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{c.nome}</span>
                    <span className="shrink-0 text-xs text-slate-400">{pct.toFixed(0)}%</span>
                    <span className="shrink-0 text-right font-medium text-slate-800 dark:text-slate-100">
                      {formatCurrency(c.valor)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Receipt size={15} className="text-slate-400" />
            Próximos vencimentos
          </h2>
          <ul className="flex flex-col gap-3">
            {proximasContas.map((b) => {
              const urgency = billUrgency(b.vencimento)
              return (
                <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-100">{b.descricao}</p>
                    <p className="text-xs" style={{ color: urgency.color }}>
                      {urgency.label}
                    </p>
                  </div>
                  <span
                    className="shrink-0 font-medium"
                    style={{ color: b.tipo === 'receber' ? statusGood : undefined }}
                  >
                    {b.tipo === 'receber' ? '+' : ''}
                    {formatCurrency(b.valor)}
                  </span>
                </li>
              )
            })}
            {proximasContas.length === 0 && <p className="text-sm text-slate-400">Nada pendente. Tudo em dia!</p>}
          </ul>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <CreditCard size={15} className="text-slate-400" />
            Cartões de crédito
          </h2>
          <ul className="flex flex-col gap-3.5">
            {cardsWithUsage.map((c) => (
              <li key={c.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-slate-800 dark:text-slate-100">{c.nome}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatCurrency(c.fatura_atual)} / {formatCurrency(c.limite)}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-2 rounded-full transition-[width]"
                    style={{ width: `${c.pct}%`, backgroundColor: meterColor(c.pct) }}
                  />
                </div>
              </li>
            ))}
            {cardsWithUsage.length === 0 && <p className="text-sm text-slate-400">Nenhum cartão cadastrado.</p>}
          </ul>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <GoalIcon size={15} className="text-slate-400" />
            Metas
          </h2>
          <ul className="flex flex-col gap-3.5">
            {goals.slice(0, 4).map((g) => {
              const pct = g.valor_alvo > 0 ? Math.min(100, (g.valor_atual / g.valor_alvo) * 100) : 0
              return (
                <li key={g.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-slate-800 dark:text-slate-100">{g.nome}</span>
                    <span className="shrink-0 text-xs text-slate-400">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-sky-500 to-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
            {goals.length === 0 && <p className="text-sm text-slate-400">Nenhuma meta cadastrada.</p>}
          </ul>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Últimos lançamentos</h2>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {transactions.slice(0, 6).map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorForKey(t.category_id, palette) }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                  {t.descricao || t.categoria_nome}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {formatDate(t.data)} · {t.conta_nome}
                  {t.cartao_nome ? ` · ${t.cartao_nome}` : ''}
                </p>
              </div>
              <span className="shrink-0 font-medium" style={{ color: t.tipo === 'receita' ? statusGood : statusCritical }}>
                {t.tipo === 'receita' ? '+' : '-'}
                {formatCurrency(t.valor)}
              </span>
            </li>
          ))}
          {transactions.length === 0 && <p className="py-2 text-sm text-slate-400">Nenhum lançamento ainda.</p>}
        </ul>
      </div>
    </div>
  )
}

function StatTile({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  delta
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  value: string
  delta: Delta | null
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 sm:text-xl">{value}</p>
          {delta && (
            <span
              className="flex items-center gap-0.5 text-xs font-semibold"
              style={{ color: delta.isGood ? statusGood : statusCritical }}
            >
              {delta.isUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {Math.abs(delta.pct).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
