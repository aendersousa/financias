import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  RefreshCw,
  Activity,
  Heart,
  TrendingUp,
  Receipt,
  CreditCard,
  ShieldCheck,
  Scale,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  Search,
  Sparkles,
  Info,
  Wallet,
  PiggyBank,
  Layers,
  ArrowRight,
  PieChart as PieChartIcon
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { ledgerRpc } from '../lib/ledgerRepository';
import { useAppStore } from '../store/useAppStore';
import {
  FutureInstallmentList,
  reportMonth,
  reportPercent,
  reportDate,
  type FutureInstallments,
  type ReportItem,
  type ReportProps
} from './LedgerReports';

interface Health {
  on: string;
  window: {
    from_month: string | null;
    to_month: string;
    months: number;
    estimated: boolean;
    sufficient: boolean;
    reason: string | null;
    unclosed_months: string[];
  };
  metrics: {
    monthly_cost_cents: number | null;
    total_income_cents: number | null;
    recurring_income_average_cents: number | null;
    savings_percent: number | null;
    income_commitment_percent: number | null;
    emergency_months: number | null;
    credit_cost_cents: number | null;
    credit_cost_average_cents: number | null;
    credit_cost_income_percent: number | null;
  };
  expense_groups: Record<string, number> | null;
  expense_items: (ReportItem & { group: string; credit_cost: boolean })[];
  income_items: (ReportItem & { recurring: boolean })[];
  next_month: string;
  next_month_obligations_cents: number;
  next_month_amortization_cents: number;
  emergency_reserve_cents: number;
  next_month_obligations: {
    id: string;
    label: string;
    due_on: string;
    amount_cents: number;
    principal_cents: number;
    kind: string;
  }[];
  future_installments: FutureInstallments;
}

const groupLabels: Record<string, string> = {
  fixed: 'Despesas fixas',
  variable: 'Despesas variáveis',
  installments_and_debts: 'Parcelas e encargos financeiros',
  unidentified_adjustments: 'Diferenças não identificadas'
};

const groupColors: Record<string, string> = {
  fixed: '#0284c7', // Sky-600
  variable: '#f59e0b', // Amber-500
  installments_and_debts: '#ef4444', // Red-500
  unidentified_adjustments: '#8b5cf6' // Violet-500
};

const obligationLabels: Record<string, string> = {
  fixed_recurrence: 'Despesa fixa recorrente',
  loan_recurrence: 'Dívida sem cronograma',
  loan: 'Empréstimo ou financiamento',
  card: 'Parcelas do cartão'
};

function getSavingsStatus(savingsPct: number | null) {
  if (savingsPct === null) return { label: 'Indefinido', color: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300' };
  if (savingsPct >= 20) return { label: 'Excelente', color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300' };
  if (savingsPct >= 10) return { label: 'Boa', color: 'text-teal-700 bg-teal-100 dark:bg-teal-950/70 dark:text-teal-300' };
  if (savingsPct > 0) return { label: 'Atenção', color: 'text-amber-700 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300' };
  return { label: 'Alerta', color: 'text-rose-700 bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300' };
}

function getCommitmentStatus(commitmentPct: number | null) {
  if (commitmentPct === null) return { label: 'Indefinido', color: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300' };
  if (commitmentPct <= 30) return { label: 'Saudável', color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300' };
  if (commitmentPct <= 50) return { label: 'Moderado', color: 'text-amber-700 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300' };
  return { label: 'Elevado', color: 'text-rose-700 bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300' };
}

function getEmergencyStatus(months: number | null) {
  if (months === null) return { label: 'Indefinido', color: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300' };
  if (months >= 6) return { label: 'Ideal', color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300' };
  if (months >= 3) return { label: 'Adequada', color: 'text-teal-700 bg-teal-100 dark:bg-teal-950/70 dark:text-teal-300' };
  if (months >= 1) return { label: 'Em formação', color: 'text-amber-700 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300' };
  return { label: 'Vulnerável', color: 'text-rose-700 bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300' };
}

function getCreditCostStatus(costPct: number | null) {
  if (costPct === null || costPct === 0) return { label: 'Sem encargos', color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300' };
  if (costPct <= 5) return { label: 'Baixo', color: 'text-teal-700 bg-teal-100 dark:bg-teal-950/70 dark:text-teal-300' };
  if (costPct <= 15) return { label: 'Moderado', color: 'text-amber-700 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300' };
  return { label: 'Alto', color: 'text-rose-700 bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300' };
}

export default function LedgerFinancialHealth({ workspace, money, privacy }: ReportProps) {
  const theme = useAppStore((s) => s.theme);
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  // UI state
  const [itemsTab, setItemsTab] = useState<'expenses' | 'incomes'>('expenses');
  const [itemsSearch, setItemsSearch] = useState('');
  const [displayLimit, setDisplayLimit] = useState(25);
  const [showUnclosedModal, setShowUnclosedModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    void ledgerRpc<Health>('financial_health', { p_space: workspace.space.id })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, retry]);

  async function download() {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const csv = await ledgerRpc<string>('export_financial_report', {
        p_space: workspace.space.id,
        p_report: 'financial_health',
        p_month: `${workspace.space.today.slice(0, 7)}-01`
      });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `financas-saude-${workspace.space.today}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('Não foi possível gerar o arquivo. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  const currency = (value: number | null) => (value === null ? '—' : money(value));

  // Expense groups chart data
  const isDark = theme === 'dark';
  const expenseChartData = useMemo(() => {
    if (!data?.expense_groups) return [];
    return Object.entries(data.expense_groups)
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => ({
        key,
        name: groupLabels[key] ?? key,
        value: privacy ? 0 : amount / 100,
        cents: amount,
        color: groupColors[key] ?? '#64748b'
      }));
  }, [data?.expense_groups, privacy]);

  const totalExpenseGroupCents = useMemo(() => {
    if (!data?.expense_groups) return 0;
    return Object.values(data.expense_groups).reduce((acc, v) => acc + v, 0);
  }, [data?.expense_groups]);

  // Overall Diagnosis calculation
  const overallDiagnosis = useMemo(() => {
    if (!data || !data.window.sufficient) return null;
    const { metrics } = data;
    const savings = metrics.savings_percent ?? 0;
    const commitment = metrics.income_commitment_percent ?? 0;
    const emergency = metrics.emergency_months ?? 0;

    let score = 0;
    if (savings >= 20) score += 2;
    else if (savings >= 10) score += 1;
    else if (savings <= 0) score -= 1;

    if (commitment <= 30) score += 2;
    else if (commitment <= 50) score += 1;
    else score -= 1;

    if (emergency >= 6) score += 2;
    else if (emergency >= 3) score += 1;
    else if (emergency < 1) score -= 1;

    if (score >= 4) {
      return {
        title: 'Saúde Financeira Forte',
        summary: 'Excelente equilíbrio entre poupança, controle de compromissos e proteção de emergência.',
        badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        borderColor: 'border-emerald-200 dark:border-emerald-800/60',
        icon: Sparkles
      };
    }
    if (score >= 2) {
      return {
        title: 'Saúde Financeira Equilibrada',
        summary: 'Suas finanças estão estáveis, com boa margem operacional. Manter a reserva ativa garante ainda mais tranquilidade.',
        badgeColor: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
        borderColor: 'border-teal-200 dark:border-teal-800/60',
        icon: Activity
      };
    }
    if (score >= 0) {
      return {
        title: 'Atenção aos Indicadores',
        summary: 'Comprometimento de renda ou reserva de emergência merecem acompanhamento próximo para evitar imprevistos.',
        badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        borderColor: 'border-amber-200 dark:border-amber-800/60',
        icon: AlertCircle
      };
    }
    return {
      title: 'Necessita Atenção & Ajustes',
      summary: 'Os gastos e compromissos futuros estão pressionando a renda disponível. Avalie redução de despesas fixas ou renegociações.',
      badgeColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
      borderColor: 'border-rose-200 dark:border-rose-800/60',
      icon: AlertCircle
    };
  }, [data]);

  // Filtered breakdown items
  const filteredExpenseItems = useMemo(() => {
    if (!data?.expense_items) return [];
    if (!itemsSearch.trim()) return data.expense_items;
    const term = itemsSearch.toLowerCase();
    return data.expense_items.filter((item) => {
      const label = (item.label ?? item.description ?? '').toLowerCase();
      const group = (groupLabels[item.group] ?? '').toLowerCase();
      return label.includes(term) || group.includes(term);
    });
  }, [data?.expense_items, itemsSearch]);

  const filteredIncomeItems = useMemo(() => {
    if (!data?.income_items) return [];
    if (!itemsSearch.trim()) return data.income_items;
    const term = itemsSearch.toLowerCase();
    return data.income_items.filter((item) => {
      const label = (item.label ?? item.description ?? '').toLowerCase();
      return label.includes(term);
    });
  }, [data?.income_items, itemsSearch]);

  if (error) {
    return (
      <section className="card p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
          <AlertCircle size={24} />
          <h1 className="text-xl font-bold">Saúde financeira</h1>
        </div>
        <p role="alert" className="text-sm text-slate-600 dark:text-slate-400">
          Não foi possível consultar seus indicadores. Verifique a conexão com o servidor e atualize.
        </p>
        <button
          type="button"
          onClick={() => setRetry((v) => v + 1)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <RefreshCw size={15} />
          Tentar novamente
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="card p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <div className="inline-block animate-spin text-brand-600 dark:text-brand-400 mb-3">
          <RefreshCw size={28} />
        </div>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Saúde financeira</h1>
        <p role="status" className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Consultando seu histórico e calculando indicadores financeiros…
        </p>
      </section>
    );
  }

  const metrics = data.metrics;
  const savingsStatus = getSavingsStatus(metrics.savings_percent);
  const commitmentStatus = getCommitmentStatus(metrics.income_commitment_percent);
  const emergencyStatus = getEmergencyStatus(metrics.emergency_months);
  const creditCostStatus = getCreditCostStatus(metrics.credit_cost_income_percent);

  const cards = [
    {
      label: 'Custo Médio Mensal',
      value: currency(metrics.monthly_cost_cents),
      note: 'Despesas líquidas, com compras parceladas por vencimento.',
      icon: Receipt,
      status: null,
      iconColor: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
    },
    {
      label: 'Taxa de Poupança',
      value: reportPercent(metrics.savings_percent, privacy),
      note: 'Parte da renda que restou depois das despesas da janela.',
      icon: TrendingUp,
      status: savingsStatus,
      iconColor: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
    },
    {
      label: 'Renda Recorrente Média',
      value: currency(metrics.recurring_income_average_cents),
      note: 'Receitas previsíveis, sem benefícios, renda extra ou cashback.',
      icon: Wallet,
      status: null,
      iconColor: 'bg-brand-100 text-brand-600 dark:bg-brand-950 dark:text-brand-400'
    },
    {
      label: 'Renda Comprometida no Próximo Mês',
      value: reportPercent(metrics.income_commitment_percent, privacy),
      note: 'Despesas fixas recorrentes, faturas de cartão e parcelas de dívidas.',
      icon: CreditCard,
      status: commitmentStatus,
      iconColor: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400'
    },
    {
      label: 'Reserva de Emergência',
      value: privacy ? '••••' : metrics.emergency_months === null ? '—' : `${metrics.emergency_months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`,
      note: 'Cobre custo mensal habitual e amortização das dívidas em vigor.',
      icon: ShieldCheck,
      status: emergencyStatus,
      iconColor: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400'
    },
    {
      label: 'Custo de Crédito na Janela',
      value: currency(metrics.credit_cost_cents),
      note: `Média: ${currency(metrics.credit_cost_average_cents)}/mês (${reportPercent(metrics.credit_cost_income_percent, privacy)} da renda).`,
      icon: Scale,
      status: creditCostStatus,
      iconColor: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header section with window info and action buttons */}
      <section className="card p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
              <Activity className="text-brand-600 dark:text-brand-400" size={26} />
              Saúde Financeira
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Acompanhe o custo da sua rotina, o comprometimento da renda e sua proteção para imprevistos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={exporting}
              onClick={() => void download()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 transition-colors dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Download size={15} />
              {exporting ? 'Gerando arquivo…' : 'Baixar CSV'}
            </button>

            <button
              type="button"
              onClick={() => setRetry((v) => v + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 transition-colors"
            >
              <RefreshCw size={15} />
              Atualizar
            </button>
          </div>
        </div>

        {privacy && (
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Nota: O arquivo CSV exportado contém os valores financeiros completos.
          </p>
        )}

        {exportError && (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {exportError}
          </p>
        )}

        {/* Window status banner */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          {data.window.sufficient ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-slate-400" />
                <span>
                  Janela analisada: <strong>{reportMonth(data.window.from_month!)}</strong> a <strong>{reportMonth(data.window.to_month)}</strong> ·{' '}
                  <strong>{data.window.months} meses completos</strong>
                  {data.window.estimated ? ' (estimativa com o histórico disponível)' : ''}.
                </span>
              </div>

              {data.window.unclosed_months.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle size={14} />
                  <span>
                    {data.window.unclosed_months.length} {data.window.unclosed_months.length === 1 ? 'mês não fechado' : 'meses não fechados'}:{' '}
                    {data.window.unclosed_months.map(reportMonth).join(', ')}.
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs sm:text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-semibold flex items-center gap-2">
                <AlertCircle size={16} />
                Ainda falta histórico completo para calcular todos os indicadores.
              </p>
              <p className="mt-1">
                São necessários pelo menos três meses completos de movimentações registradas. Você possui {data.window.months}.
                O mês atual e o primeiro mês parcial ficam fora da janela de análise.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Overall Health Diagnosis Card */}
      {overallDiagnosis && (
        <section className={`card p-5 sm:p-6 border-l-4 ${overallDiagnosis.borderColor} dark:border-slate-800 dark:bg-slate-900`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${overallDiagnosis.badgeColor}`}>
                  <overallDiagnosis.icon size={14} />
                  {overallDiagnosis.title}
                </span>
              </div>
              <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
                {overallDiagnosis.summary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs shrink-0">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-center dark:border-slate-800 dark:bg-slate-800/60">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Poupança</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{savingsStatus.label}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-center dark:border-slate-800 dark:bg-slate-800/60">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Comprometimento</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{commitmentStatus.label}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-center dark:border-slate-800 dark:bg-slate-800/60">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Reserva</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{emergencyStatus.label}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 6 Metric KPI Cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Indicadores de saúde financeira">
        {cards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="card p-5 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {item.label}
                  </span>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.iconColor}`}>
                    <Icon size={16} />
                  </span>
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {item.value}
                  </p>
                  {item.status && (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${item.status.color}`}>
                      {item.status.label}
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 pt-2.5 dark:border-slate-800/60">
                {item.note}
              </p>
            </div>
          );
        })}
      </section>

      {/* Emergency Reserve Protection & Progress Visual */}
      <section className="card p-5 sm:p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Proteção para imprevistos">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck size={20} className="text-brand-600 dark:text-brand-400" />
              Proteção para Imprevistos (Reserva de Emergência)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Cobertura do custo de vida mensal e amortização das dívidas em vigor.
            </p>
          </div>

          <div className="text-right sm:text-right">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Cobertura atual</span>
            <strong className="text-lg font-bold text-brand-700 dark:text-brand-300">
              {privacy ? '••••' : metrics.emergency_months === null ? '—' : `${metrics.emergency_months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`}
            </strong>
          </div>
        </div>

        {/* Visual Milestone Progress Bar */}
        {!privacy && metrics.emergency_months !== null && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
            <div className="flex justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span>0 meses</span>
              <span>3 meses (Mínimo recomendado)</span>
              <span>6 meses (Ideal)</span>
              <span>12+ meses</span>
            </div>

            <div className="relative h-3 w-full rounded-full bg-slate-200/80 dark:bg-slate-700 overflow-hidden">
              {/* Reference markers */}
              <div className="absolute left-1/4 top-0 bottom-0 w-0.5 bg-white/70 dark:bg-slate-900/70 z-10" />
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/70 dark:bg-slate-900/70 z-10" />

              {/* Progress fill (scale 0-12 months = 0-100%) */}
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  metrics.emergency_months >= 6
                    ? 'bg-emerald-500'
                    : metrics.emergency_months >= 3
                    ? 'bg-brand-500'
                    : metrics.emergency_months >= 1
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, (metrics.emergency_months / 12) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Breakdown sub-cards */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Total acumulado na reserva</span>
            <p className="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">
              {money(data.emergency_reserve_cents)}
            </p>
            <span className="mt-1 text-[11px] text-slate-400 block">Investimentos e metas de emergência</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Custo médio mensal habitual</span>
            <p className="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">
              {currency(metrics.monthly_cost_cents)}
            </p>
            <span className="mt-1 text-[11px] text-slate-400 block">Despesas líquidas da rotina</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Principal das dívidas no próximo mês</span>
            <p className="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">
              {money(data.next_month_amortization_cents)}
            </p>
            <span className="mt-1 text-[11px] text-slate-400 block">Amortização de parcelas ativas</span>
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Nota: Uma conta de investimento marcada diretamente e também vinculada a uma meta entra apenas uma vez. Benefícios alimentícios/refeição ficam fora dessa reserva.
        </p>
      </section>

      {/* Next Month Obligations Section */}
      <section className="card p-5 sm:p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Obrigações do próximo mês">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar size={20} className="text-brand-600 dark:text-brand-400" />
              Obrigações de {reportMonth(data.next_month)}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Compromissos essenciais fixados para o início do próximo ciclo.
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Total do próximo mês</span>
            <strong className="text-xl font-bold text-rose-700 dark:text-rose-400">
              {money(data.next_month_obligations_cents)}
            </strong>
          </div>
        </div>

        {data.next_month_obligations.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhuma obrigação prevista nesta base para o próximo mês.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.next_month_obligations.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/40 rounded-lg px-2 transition-colors"
              >
                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {obligationLabels[item.kind] ?? 'Compromisso'}
                    </span>
                    <span>Vence em {reportDate(item.due_on)}</span>
                  </p>
                </div>

                <div className="text-right">
                  <strong className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {money(item.amount_cents)}
                  </strong>
                  {item.principal_cents > 0 && item.principal_cents !== item.amount_cents && (
                    <span className="block text-[11px] text-slate-400">
                      Principal: {money(item.principal_cents)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Expense Groups Composition Chart & Breakdown */}
      {data.window.sufficient && data.expense_groups && (
        <section className="card p-5 sm:p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Composição dos custos da janela">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <PieChartIcon size={20} className="text-brand-600 dark:text-brand-400" />
                Composição do Custo na Janela
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Divisão dos gastos entre custos fixos, variáveis, parcelas e financiamentos
              </p>
            </div>

            <div className="text-right">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Renda total da janela</span>
              <strong className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                {currency(metrics.total_income_cents)}
              </strong>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12 items-center">
            {/* Donut Chart */}
            <div className="lg:col-span-5 relative flex items-center justify-center">
              {privacy ? (
                <div className="h-48 w-full flex items-center justify-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                  Gráfico oculto pelo modo de privacidade.
                </div>
              ) : (
                <>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={expenseChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={62}
                          outerRadius={90}
                          paddingAngle={3}
                          stroke={isDark ? '#0f172a' : '#ffffff'}
                          strokeWidth={2}
                        >
                          {expenseChartData.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => [money(Number(value) * 100)]}
                          contentStyle={{
                            backgroundColor: isDark ? '#0f172a' : '#ffffff',
                            borderColor: isDark ? '#334155' : '#e2e8f0',
                            borderRadius: 12,
                            color: isDark ? '#f8fafc' : '#0f172a',
                            fontSize: 13,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Total</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {money(totalExpenseGroupCents)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Groups Progress Bars Breakdown */}
            <div className="lg:col-span-7 space-y-3">
              {Object.entries(data.expense_groups).map(([group, amount]) => {
                const pct = totalExpenseGroupCents > 0 ? (amount / totalExpenseGroupCents) * 100 : 0;
                const color = groupColors[group] ?? '#64748b';
                return (
                  <div key={group} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {groupLabels[group] ?? group}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <strong className="text-slate-900 dark:text-slate-100">{money(amount)}</strong>
                        <span className="text-xs text-slate-400 font-medium w-12 text-right">
                          {reportPercent(pct, privacy)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Detailed Window Items (Expenses vs Incomes) */}
      {data.window.sufficient && (
        <section className="card p-5 sm:p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900" aria-label="Detalhes de despesas e receitas da janela">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setItemsTab('expenses');
                  setDisplayLimit(25);
                }}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  itemsTab === 'expenses'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Despesas da janela ({data.expense_items.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setItemsTab('incomes');
                  setDisplayLimit(25);
                }}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  itemsTab === 'incomes'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Receitas da janela ({data.income_items.length})
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar lançamento..."
                value={itemsSearch}
                onChange={(e) => setItemsSearch(e.target.value)}
                className="field-input pl-8 py-1.5 text-xs w-full"
              />
            </div>
          </div>

          {itemsTab === 'expenses' ? (
            filteredExpenseItems.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Nenhuma despesa encontrada para esta busca.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredExpenseItems.slice(0, displayLimit).map((item, index) => (
                  <div
                    key={`${item.transaction_id}-${index}`}
                    className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/40 rounded-lg px-2 transition-colors"
                  >
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                        <span>{reportMonth(item.month!)}</span>
                        <span>·</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {groupLabels[item.group] ?? 'Despesa'}
                        </span>
                        {item.credit_cost && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            Custo de crédito
                          </span>
                        )}
                        {item.original_competence_month && <span>· ref. {reportMonth(item.original_competence_month)}</span>}
                      </p>
                    </div>
                    <strong className="text-slate-900 dark:text-slate-100">{money(item.amount_cents)}</strong>
                  </div>
                ))}
              </div>
            )
          ) : filteredIncomeItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhuma receita encontrada para esta busca.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredIncomeItems.slice(0, displayLimit).map((item, index) => (
                <div
                  key={`${item.transaction_id}-${index}`}
                  className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/40 rounded-lg px-2 transition-colors"
                >
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <span>{reportMonth(item.month!)}</span>
                      <span>·</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          item.recurring
                            ? 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {item.recurring ? 'Renda recorrente' : 'Outras receitas'}
                      </span>
                    </p>
                  </div>
                  <strong className="text-emerald-700 dark:text-emerald-400">{money(item.amount_cents)}</strong>
                </div>
              ))}
            </div>
          )}

          {((itemsTab === 'expenses' && filteredExpenseItems.length > displayLimit) ||
            (itemsTab === 'incomes' && filteredIncomeItems.length > displayLimit)) && (
            <div className="pt-2 text-center border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDisplayLimit((prev) => prev + 50)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Carregar mais itens
              </button>
            </div>
          )}
        </section>
      )}

      {/* Future Installments Card */}
      <FutureInstallmentList value={data.future_installments} money={money} privacy={privacy} />
    </div>
  );
}
