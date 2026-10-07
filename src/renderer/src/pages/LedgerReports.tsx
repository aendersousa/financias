import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  RefreshCw,
  ShoppingBag,
  CreditCard,
  ArrowLeftRight,
  Wallet,
  Repeat,
  FileText,
  TrendingUp,
  TrendingDown,
  Scale,
  Calendar,
  Filter,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Search,
  CheckCircle2,
  Info,
  Layers,
  Sparkles,
  PieChart as PieChartIcon,
  Tag,
  User,
  Building2,
  Lock,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { useAppStore } from '../store/useAppStore';

export interface ReportItem {
  account_id?: string | null;
  transaction_id?: string;
  label?: string;
  description?: string;
  on?: string;
  month?: string;
  due_on?: string;
  original_competence_month?: string | null;
  class?: 'income' | 'expense';
  amount_cents: number;
  display_amount_cents?: number;
  gross_cents?: number;
  refund_cents?: number;
  notes?: string;
  payment_names?: string[];
  tags?: string[];
  annual_cents?: number;
  next_due_on?: string | null;
  category?: string;
  payment_name?: string;
  unit?: string;
  interval_count?: number;
  starts_on?: string;
  ends_on?: string | null;
  versions?: { from: string; amount_cents: number; interval_count: number }[];
}

export interface FutureInstallments {
  total_cents: number;
  next_cycle_cents: number;
  average_cents: number;
  income_percent: number | null;
  cycles: { from: string; until: string; amount_cents: number }[];
  items: (ReportItem & { kind: 'card' | 'loan' })[];
}

interface Reports {
  month: string;
  as_of: string;
  available_accounts: { id: string; name: string; archived: boolean }[];
  consumption: { income_cents: number; expense_cents: number; snapshot: boolean; items: ReportItem[] };
  installment_consumption: { expense_cents: number; items: ReportItem[] };
  cash_flow: Flow;
  benefit_flow: Flow;
  comparison: {
    month: string;
    income_cents: number;
    expense_cents: number;
    expense_change_percent: number | null;
    new?: boolean;
    snapshot: boolean;
  }[];
  net_worth: {
    month: string;
    net_worth_cents: number;
    opening_cents: number;
    growth_cents: number;
    snapshot: boolean;
  }[];
  future_installments: FutureInstallments;
}

interface Flow {
  net_cents: number;
  opening_cents?: number;
  sections: Record<string, number>;
  items: ReportItem[];
}

export interface ReportProps {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  privacy: boolean;
}

const sectionLabels: Record<string, string> = {
  operational: 'Operacional',
  debts: 'Empréstimos e financiamentos',
  investments: 'Investimentos e bens',
  people: 'Valores com pessoas'
};

export const reportDate = (value: string) => value.split('-').reverse().join('/');
export const reportMonth = (value: string) => `${value.slice(5, 7)}/${value.slice(0, 4)}`;
export function reportPercent(value: number | null, privacy: boolean) {
  return privacy ? '••••' : value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function FutureInstallmentList({
  value,
  money,
  privacy
}: {
  value: FutureInstallments;
  money: ReportProps['money'];
  privacy: boolean;
}) {
  const [showCycles, setShowCycles] = useState(false);

  return (
    <section className="card p-5 sm:p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Parcelas futuras">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <CreditCard size={18} className="text-brand-600 dark:text-brand-400" />
            Parcelas futuras
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Compromissos dos próximos ciclos de renda. A parcela da fatura aberta já entra no Livre para gastar.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total futuro</span>
          <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{money(value.total_cents)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Próximo ciclo</span>
          <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{money(value.next_cycle_cents)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Média de seis ciclos</span>
          <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{money(value.average_cents)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Da renda recorrente</span>
          <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{reportPercent(value.income_percent, privacy)}</p>
        </div>
      </div>

      {value.income_percent === null && (
        <p className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          O percentual precisa de pelo menos três meses completos de renda recorrente e de uma média maior que zero.
        </p>
      )}

      <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setShowCycles((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
        >
          {showCycles ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Próximos seis ciclos e suas parcelas ({value.cycles.length} ciclos, {value.items.length} itens)
        </button>

        {showCycles && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {value.cycles.map((cycle) => (
                <div key={cycle.from} className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <span className="text-slate-500 dark:text-slate-400">De {reportDate(cycle.from)} até {reportDate(cycle.until)}</span>
                  <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{money(cycle.amount_cents)}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
              {value.items.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma parcela futura neste momento.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {value.items.map((item, index) => (
                    <div key={`${item.transaction_id ?? item.account_id}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-100">{item.label ?? 'Parcela'}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 mr-2">
                            {item.kind === 'card' ? 'Cartão' : 'Empréstimo ou financiamento'}
                          </span>
                          Vence em {reportDate(item.due_on!)}
                        </p>
                      </div>
                      <strong className="text-slate-800 dark:text-slate-100">{money(item.amount_cents)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type View = 'consumption' | 'installment_consumption' | 'cash_flow' | 'benefit_flow' | 'subscriptions' | 'tax_deductible';
type Option = { id: string; name: string; archived: boolean };
type FilterOptions = Record<'accounts' | 'cards' | 'categories' | 'tags' | 'people', Option[]>;
interface CategorySummary {
  id: string;
  label: string;
  amount_cents: number;
  percent: number | null;
  transaction_count: number;
  children: Omit<CategorySummary, 'children'>[];
}
interface ReportQuery extends Flow {
  report: View;
  from_month: string;
  until_month: string;
  partial: boolean;
  year?: number;
  income_cents: number;
  expense_cents: number;
  total_cents?: number;
  annual_cents?: number;
  monthly_cents?: number;
  categories?: { label: string; amount_cents: number }[];
  category_summary?: CategorySummary[];
}

const monthShift = (value: string, count: number) => {
  const [year, month] = value.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + count, 1)).toISOString().slice(0, 10);
};

const viewNavItems: { id: View; label: string; icon: typeof ShoppingBag; badgeLabel: string }[] = [
  { id: 'consumption', label: 'Consumo por Competência', icon: ShoppingBag, badgeLabel: 'Competência' },
  { id: 'installment_consumption', label: 'Despesas por Parcelas', icon: CreditCard, badgeLabel: 'Parcelas' },
  { id: 'cash_flow', label: 'Fluxo de Caixa', icon: ArrowLeftRight, badgeLabel: 'Caixa' },
  { id: 'benefit_flow', label: 'Benefícios', icon: Wallet, badgeLabel: 'Benefícios' },
  { id: 'subscriptions', label: 'Assinaturas', icon: Repeat, badgeLabel: 'Assinaturas' },
  { id: 'tax_deductible', label: 'Dedutíveis IR', icon: FileText, badgeLabel: 'Imposto de Renda' }
];

export default function LedgerReports({ workspace, money, privacy }: ReportProps) {
  const theme = useAppStore((s) => s.theme);
  const [month, setMonth] = useState(workspace.space.today.slice(0, 7));
  const [account, setAccount] = useState('');
  const [view, setView] = useState<View>('consumption');
  const [data, setData] = useState<Reports | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<'spreadsheet' | 'technical'>('spreadsheet');
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState(workspace.space.today.slice(0, 7));
  const [until, setUntil] = useState(workspace.space.today.slice(0, 7));
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [query, setQuery] = useState<ReportQuery | null>(null);

  // UI state
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [comparisonTab, setComparisonTab] = useState<'chart' | 'table'>('chart');
  const [netWorthTab, setNetWorthTab] = useState<'chart' | 'table'>('chart');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [searchFilter, setSearchFilter] = useState('');
  const [displayLimit, setDisplayLimit] = useState(25);

  const currentMonth = `${workspace.space.today.slice(0, 7)}-01`;
  const filterPayload: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
    account: account || null,
    year: Number(month.slice(0, 4))
  };

  if (period === 'custom') {
    filterPayload.from_month = `${from}-01`;
    filterPayload.until_month = monthShift(until, 1);
  } else if (period === 'previous') {
    filterPayload.from_month = monthShift(currentMonth, -1);
    filterPayload.until_month = currentMonth;
  } else if (['3', '6', '12'].includes(period)) {
    filterPayload.from_month = monthShift(currentMonth, -Number(period) + 1);
    filterPayload.until_month = monthShift(currentMonth, 1);
  } else if (period === 'year' || period === 'previous_year') {
    const year = Number(currentMonth.slice(0, 4)) - (period === 'previous_year' ? 1 : 0);
    filterPayload.from_month = `${year}-01-01`;
    filterPayload.until_month = `${year + 1}-01-01`;
    filterPayload.year = year;
  }

  const filterKey = JSON.stringify(filterPayload);

  useEffect(() => {
    setMonth(workspace.space.today.slice(0, 7));
    setAccount('');
    setFilters({});
    setOptions(null);
    setPeriod('month');
  }, [workspace.space.id]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setQuery(null);
    setError('');
    setDisplayLimit(25);

    void Promise.all([
      ledgerRpc<Reports>('reports_summary', {
        p_space: workspace.space.id,
        p_month: `${month}-01`,
        p_account: account || null
      }),
      ledgerRpc<ReportQuery>('reports_query', {
        p_space: workspace.space.id,
        p_report: view,
        p_month: `${month}-01`,
        p_filters: JSON.parse(filterKey)
      }),
      ledgerRpc<FilterOptions>('report_filter_options', { p_space: workspace.space.id }),
      ledgerRpc<Reports['comparison']>('report_comparison', {
        p_space: workspace.space.id,
        p_month: `${month}-01`,
        p_filters: JSON.parse(filterKey)
      })
    ])
      .then(([summary, result, available, comparison]) => {
        if (!cancelled) {
          setData({ ...summary, comparison });
          setQuery(result);
          setOptions(available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Não foi possível carregar os relatórios. Verifique o período, a conexão e tente novamente.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace, month, account, retry, view, filterKey]);

  async function download(report: string) {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      const csv =
        report === 'net_worth'
          ? await ledgerRpc<string>('export_financial_report', {
              p_space: workspace.space.id,
              p_report: report,
              p_month: `${month}-01`,
              p_format: format,
              p_account: account || null
            })
          : await ledgerRpc<string>('export_filtered_report', {
              p_space: workspace.space.id,
              p_report: report,
              p_month: `${month}-01`,
              p_format: format,
              p_filters: JSON.parse(filterKey)
            });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `financas-${report}-${month}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Não foi possível gerar o arquivo. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  const allRows = query?.items ?? [];
  const rows = useMemo(() => {
    if (!searchFilter.trim()) return allRows;
    const term = searchFilter.toLowerCase();
    return allRows.filter((item) => {
      const label = (item.label ?? item.description ?? '').toLowerCase();
      const cat = (item.category ?? '').toLowerCase();
      const tags = (item.tags ?? []).join(' ').toLowerCase();
      const notes = (item.notes ?? '').toLowerCase();
      return label.includes(term) || cat.includes(term) || tags.includes(term) || notes.includes(term);
    });
  }, [allRows, searchFilter]);

  const visibleRows = useMemo(() => rows.slice(0, displayLimit), [rows, displayLimit]);

  const accounts = options?.accounts ?? data?.available_accounts ?? workspace.accounts.map((item) => ({ id: item.id, name: item.name, archived: false }));
  const titles: Record<View, string> = {
    consumption: 'Consumo por competência',
    installment_consumption: 'Despesas por vencimento das parcelas',
    cash_flow: 'Fluxo de caixa',
    benefit_flow: 'Movimentação de benefícios',
    subscriptions: 'Assinaturas',
    tax_deductible: 'Despesas dedutíveis no IR'
  };
  const notes: Record<View, string> = {
    consumption: 'Receitas e despesas pertencem ao mês de competência. Compras parceladas entram pelo total da compra.',
    installment_consumption: 'Cada parcela de cartão pertence ao mês do vencimento efetivo da fatura. Essa consulta preserva o consumo usado no orçamento.',
    cash_flow: 'Movimentações de dinheiro por data financeira, classificadas pela outra ponta. Inclui o pagamento da fatura e separa investimentos, dívidas e pessoas.',
    benefit_flow: 'Entradas e saídas de benefício por data financeira, apresentadas separadamente do dinheiro em contas.',
    subscriptions: 'Regras de saída marcadas como assinatura, ativas ou encerradas no período. O total mensal corresponde ao total anual dividido por doze.',
    tax_deductible: 'Lista de apoio por ano-calendário, com despesas marcadas como dedutíveis e seus reembolsos ligados. Não calcula imposto nem aplica limites legais de dedução.'
  };

  const flow = view === 'cash_flow' || view === 'benefit_flow' ? query : null;
  const changeFilter = (key: string, value: string) => setFilters((previous) => ({ ...previous, [key]: value }));

  const activeFiltersCount = Object.values(filters).filter(Boolean).length + (account ? 1 : 0);

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Recharts styling helpers
  const isDark = theme === 'dark';
  const gridStroke = isDark ? '#334155' : '#e2e8f0';
  const axisTickColor = isDark ? '#94a3b8' : '#64748b';
  const tooltipBg = isDark ? '#0f172a' : '#ffffff';
  const tooltipBorder = isDark ? '#334155' : '#e2e8f0';
  const tooltipText = isDark ? '#f8fafc' : '#0f172a';

  // Comparison chart data
  const comparisonChartData = useMemo(() => {
    return (data?.comparison ?? []).map((c) => ({
      name: reportMonth(c.month),
      rawMonth: c.month,
      receitas: privacy ? 0 : c.income_cents / 100,
      despesas: privacy ? 0 : c.expense_cents / 100,
      saldo: privacy ? 0 : (c.income_cents - c.expense_cents) / 100,
      incomeCents: c.income_cents,
      expenseCents: c.expense_cents,
      snapshot: c.snapshot,
      changePercent: c.expense_change_percent,
      isNew: c.new
    }));
  }, [data?.comparison, privacy]);

  // Net worth chart data
  const netWorthChartData = useMemo(() => {
    return (data?.net_worth ?? []).map((nw) => ({
      name: reportMonth(nw.month),
      rawMonth: nw.month,
      patrimonio: privacy ? 0 : nw.net_worth_cents / 100,
      variacao: privacy ? 0 : nw.growth_cents / 100,
      netWorthCents: nw.net_worth_cents,
      growthCents: nw.growth_cents,
      openingCents: nw.opening_cents,
      snapshot: nw.snapshot
    }));
  }, [data?.net_worth, privacy]);

  return (
    <div className="space-y-6">
      {/* Header card with quick actions */}
      <section className="card p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
              <BarChart3 className="text-brand-600 dark:text-brand-400" size={26} />
              Relatórios Financeiros
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Analise seu consumo, fluxo de caixa, evolução patrimonial e deduções fiscais.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setRetry((v) => v + 1)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw size={15} />
              Atualizar
            </button>

            <button
              type="button"
              disabled={exporting}
              onClick={() => void download(view)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <Download size={15} />
              {exporting ? 'Exportando…' : 'Baixar CSV'}
            </button>
          </div>
        </div>

        {/* View Switcher Pills */}
        <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800/80">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2.5 block">
            Escolha a visão do relatório
          </label>
          <div className="flex flex-wrap gap-2">
            {viewNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-500'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Filter panel */}
      <section className="card p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-500 dark:text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Filtros e Período</h2>
            {activeFiltersCount > 0 && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800 dark:bg-brand-950 dark:text-brand-300">
                {activeFiltersCount} ativo{activeFiltersCount > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAccount('');
                  setFilters({});
                }}
                className="text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
              >
                Limpar filtros
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <SlidersHorizontal size={13} />
              {showAdvancedFilters ? 'Ocultar filtros extras' : 'Filtros extras'}
              <ChevronDown size={13} className={`transform transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
            Mês de referência
            <input
              aria-label="Mês do relatório"
              type="month"
              required
              max={workspace.space.today.slice(0, 7)}
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
              className="field-input text-xs sm:text-sm py-2"
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
            Conta dos lançamentos
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="field-input text-xs sm:text-sm py-2"
            >
              <option value="">Todas as contas</option>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.archived ? ' · arquivada' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
            Janela de período
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="field-input text-xs sm:text-sm py-2"
            >
              <option value="month">Mês escolhido</option>
              <option value="previous">Mês anterior</option>
              <option value="3">Últimos três meses</option>
              <option value="6">Últimos seis meses</option>
              <option value="12">Últimos doze meses</option>
              <option value="year">Este ano</option>
              <option value="previous_year">Ano anterior</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
        </div>

        {period === 'custom' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
            <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Mês de início (De)
              <input
                type="month"
                value={from}
                onChange={(e) => {
                  if (e.target.value) setFrom(e.target.value);
                }}
                className="field-input text-xs sm:text-sm py-2"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Mês final (Até)
              <input
                type="month"
                value={until}
                onChange={(e) => {
                  if (e.target.value) setUntil(e.target.value);
                }}
                className="field-input text-xs sm:text-sm py-2"
              />
            </label>
          </div>
        )}

        {/* Expandable Advanced Filters Drawer */}
        {showAdvancedFilters && (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ['card', 'Cartão de crédito', 'cards'],
                  ['category', 'Categoria principal', 'categories'],
                  ['tag', 'Tag', 'tags'],
                  ['person', 'Pessoa', 'people']
                ] as const
              ).map(([key, label, source]) => (
                <label key={key} className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  {label}
                  <select
                    value={filters[key] ?? ''}
                    onChange={(e) => changeFilter(key, e.target.value)}
                    className="field-input text-xs sm:text-sm py-2"
                  >
                    <option value="">Todos</option>
                    {(options?.[source] ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.archived ? ' · arquivado' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                Essenciais
                <select
                  value={filters.essential ?? ''}
                  onChange={(e) => changeFilter('essential', e.target.value)}
                  className="field-input text-xs sm:text-sm py-2"
                >
                  <option value="">Todas as categorias</option>
                  <option value="true">Essenciais</option>
                  <option value="false">Não essenciais</option>
                </select>
              </label>

              <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                Fixidade da despesa
                <select
                  value={filters.fixity ?? ''}
                  onChange={(e) => changeFilter('fixity', e.target.value)}
                  className="field-input text-xs sm:text-sm py-2"
                >
                  <option value="">Fixas e variáveis</option>
                  <option value="fixed">Fixas</option>
                  <option value="variable">Variáveis</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </section>

      {/* Error and loading banners */}
      {error && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">{error}</p>
          <button
            type="button"
            onClick={() => setRetry((v) => v + 1)}
            className="mt-2 text-xs font-semibold text-amber-900 underline hover:no-underline dark:text-amber-100"
          >
            Tentar carregar novamente
          </button>
        </div>
      )}

      {!data && !error && (
        <div className="card p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="inline-block animate-spin text-brand-600 dark:text-brand-400 mb-2">
            <RefreshCw size={24} />
          </div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Carregando relatórios e indicadores…</p>
        </div>
      )}

      {data && query && (
        <>
          {/* View Explanation & Context Banner */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-xs sm:text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200 flex items-start gap-3">
            <Info size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-blue-950 dark:text-blue-100">
                  {titles[view]} · {view === 'tax_deductible' ? query.year : `${reportMonth(query.from_month)} a ${reportMonth(monthShift(query.until_month, -1))}`}
                </span>
                {query.partial && (
                  <span className="rounded-md bg-blue-200/80 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    Período parcial
                  </span>
                )}
              </div>
              <p className="text-blue-800 dark:text-blue-300">{notes[view]}</p>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view === 'consumption' ? (
              <>
                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Receitas</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                      <TrendingUp size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
                    {money(query.income_cents)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Entradas totais do período</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Despesas</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                      <TrendingDown size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-rose-700 dark:text-rose-300">
                    {money(query.expense_cents)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Gastos totais no período</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Saldo Líquido</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <Scale size={16} />
                    </span>
                  </div>
                  {(() => {
                    const diff = query.income_cents - query.expense_cents;
                    return (
                      <p className={`mt-2 text-2xl font-bold tracking-tight ${diff >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                        {money(diff)}
                      </p>
                    );
                  })()}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Resultado operacional</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Taxa de Poupança</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                      <Sparkles size={16} />
                    </span>
                  </div>
                  {(() => {
                    const pct = query.income_cents > 0 ? ((query.income_cents - query.expense_cents) / query.income_cents) * 100 : null;
                    return (
                      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                        {reportPercent(pct, privacy)}
                      </p>
                    );
                  })()}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Percentual poupado da renda</p>
                </div>
              </>
            ) : view === 'installment_consumption' ? (
              <>
                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Despesas por Vencimento</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                      <CreditCard size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-rose-700 dark:text-rose-300">
                    {money(query.expense_cents)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Vencimento das faturas no período</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Lançamentos</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <Layers size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {privacy ? '••••' : rows.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Parcelas e lançamentos listados</p>
                </div>
              </>
            ) : view === 'subscriptions' ? (
              <>
                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Mensal Equivalente</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                      <Repeat size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {money(query.monthly_cents ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Média mensal de assinaturas</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Anual Estimado</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <Calendar size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {money(query.annual_cents ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Custo anual projetado</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Assinaturas Ativas</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <Layers size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {privacy ? '••••' : rows.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Serviços e planos monitorados</p>
                </div>
              </>
            ) : view === 'tax_deductible' ? (
              <>
                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Líquido de Reembolso</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                      <FileText size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {money(query.total_cents ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Dedutível no ano {query.year}</p>
                </div>

                <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Comprovantes</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <CheckCircle2 size={16} />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                    {privacy ? '••••' : rows.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Lançamentos dedutíveis no ano</p>
                </div>
              </>
            ) : (
              flow && (
                <>
                  <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Movimentação Líquida</span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                        <ArrowLeftRight size={16} />
                      </span>
                    </div>
                    <p className={`mt-2 text-2xl font-bold tracking-tight ${flow.net_cents >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {money(flow.net_cents)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Resultado do período</p>
                  </div>

                  {Object.entries(flow.sections).map(([section, amount]) => (
                    <div key={section} className="card p-5 dark:border-slate-800 dark:bg-slate-900">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {sectionLabels[section] ?? section}
                      </span>
                      <p className={`mt-2 text-xl font-bold tracking-tight ${amount >= 0 ? 'text-slate-800 dark:text-slate-100' : 'text-rose-700 dark:text-rose-300'}`}>
                        {money(amount)}
                      </p>
                    </div>
                  ))}
                </>
              )
            )}
          </section>

          {flow?.opening_cents !== undefined && flow.opening_cents !== 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs sm:text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Saldos iniciais cadastrados no período: <strong>{money(flow.opening_cents)}</strong>.
            </div>
          )}

          {/* Category Breakdown with Visual Progress Bars (Consumption View) */}
          {view === 'consumption' && !!query.category_summary?.length && (
            <section className="card p-5 sm:p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900" aria-label="Despesas por categoria">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <PieChartIcon size={18} className="text-brand-600 dark:text-brand-400" />
                    Despesas por categoria principal
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Distribuição percentual do consumo no período
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {query.category_summary.length} categorias encontradas
                </span>
              </div>

              <div className="space-y-3 pt-2">
                {query.category_summary.map((category) => {
                  const isExpanded = !!expandedCategories[category.id];
                  const pct = category.percent ?? 0;
                  return (
                    <div
                      key={category.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => category.children?.length && toggleCategory(category.id)}
                          className="flex items-center gap-2 text-left font-semibold text-sm text-slate-800 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          {category.children?.length ? (
                            isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                          ) : (
                            <span className="w-4" />
                          )}
                          <span>{category.label}</span>
                          {!privacy && (
                            <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              {category.transaction_count} {category.transaction_count === 1 ? 'lançamento' : 'lançamentos'}
                            </span>
                          )}
                        </button>

                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            {money(category.amount_cents)}
                          </span>
                          <span className="inline-block w-14 text-right text-xs font-semibold text-brand-700 dark:text-brand-300">
                            {reportPercent(category.percent, privacy)}
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                        />
                      </div>

                      {/* Subcategories */}
                      {isExpanded && category.children?.length > 0 && (
                        <div className="mt-3.5 space-y-2 border-t border-slate-200/70 pt-3 pl-6 dark:border-slate-700/50">
                          {category.children.map((child) => (
                            <div key={child.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="text-slate-600 dark:text-slate-400">{child.label}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  {money(child.amount_cents)}
                                </span>
                                <span className="text-slate-400 dark:text-slate-500">
                                  ({reportPercent(child.percent, privacy)})
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Tax Deductible Category Breakdown */}
          {view === 'tax_deductible' && !!query.categories?.length && (
            <section className="card p-5 sm:p-6 space-y-3 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <FileText size={18} className="text-brand-600 dark:text-brand-400" />
                Despesas dedutíveis por categoria
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {query.categories.map((category) => (
                  <div
                    key={category.label}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-sm dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <span className="text-slate-700 dark:text-slate-300">{category.label}</span>
                    <strong className="text-slate-900 dark:text-slate-100">{money(category.amount_cents)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Transaction items list / table */}
          <section className="card p-5 sm:p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900" aria-label="Lançamentos do relatório">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Lançamentos e Movimentações
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {rows.length} {rows.length === 1 ? 'registro encontrado' : 'registros encontrados'}
                </p>
              </div>

              {allRows.length > 5 && (
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filtrar por nome, tag..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="field-input pl-8 py-1.5 text-xs w-full"
                  />
                </div>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Nenhuma movimentação nesta visão para o período e os filtros selecionados.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleRows.map((item, index) => {
                  const isIncome = item.class === 'income';
                  const amount = item.display_amount_cents ?? item.amount_cents;

                  return (
                    <div
                      key={`${item.transaction_id ?? item.account_id}-${index}`}
                      className="py-3.5 text-sm hover:bg-slate-50/60 dark:hover:bg-slate-800/40 rounded-lg px-2 transition-colors"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                              {item.label ?? item.description ?? 'Movimentação'}
                            </span>

                            {item.class && (
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                                  isIncome
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                }`}
                              >
                                {isIncome ? 'Receita' : 'Despesa'}
                              </span>
                            )}

                            {item.on && (
                              <span className="text-xs text-slate-400 dark:text-slate-500">
                                {reportDate(item.on)}
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {view === 'subscriptions'
                              ? `${item.category ?? 'Sem categoria'} · A cada ${item.interval_count} ${
                                  item.unit === 'month' ? 'mês(es)' : item.unit === 'week' ? 'semana(s)' : 'ano(s)'
                                } · ${item.payment_name ?? 'Meio de pagamento'}`
                              : item.original_competence_month
                              ? `Competência: ${reportMonth(item.original_competence_month)}`
                              : ''}
                            {item.description && item.description !== item.label ? ` · ${item.description}` : ''}
                          </p>
                        </div>

                        <div className="text-right">
                          <strong
                            className={`text-base font-semibold ${
                              isIncome ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'
                            }`}
                          >
                            {money(amount)}
                          </strong>
                        </div>
                      </div>

                      {/* Extra details for Tax Deductible */}
                      {view === 'tax_deductible' && (
                        <div className="mt-2.5 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 space-y-1">
                          <p>
                            Valor original: <strong>{money(item.gross_cents ?? 0)}</strong> · Reembolso:{' '}
                            <strong>{money(item.refund_cents ?? 0)}</strong> · Líquido:{' '}
                            <strong>{money(item.amount_cents)}</strong>
                          </p>
                          <p>
                            {item.payment_names?.join(', ')}
                            {item.tags?.length ? ` · Tags: ${item.tags.join(', ')}` : ''}
                          </p>
                          {item.notes && <p className="italic text-slate-500">Observação: {item.notes}</p>}
                        </div>
                      )}

                      {/* Extra details for Subscriptions */}
                      {view === 'subscriptions' && (
                        <div className="mt-2.5 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 space-y-1">
                          <p>
                            Anual: <strong>{money(item.annual_cents ?? 0)}</strong> · Início: {reportDate(item.starts_on!)}
                            {item.ends_on ? ` · Encerramento: ${reportDate(item.ends_on)}` : ''} ·{' '}
                            {item.next_due_on ? `Próxima cobrança: ${reportDate(item.next_due_on)}` : 'Sem próxima cobrança em aberto'}
                          </p>
                          {Boolean(item.versions?.length) && (
                            <details className="mt-1">
                              <summary className="cursor-pointer font-medium text-brand-700 dark:text-brand-400">
                                Histórico de valores ({item.versions!.length})
                              </summary>
                              <div className="mt-1.5 space-y-1 pl-3 text-slate-500 dark:text-slate-400">
                                {item.versions!.map((version) => (
                                  <p key={version.from}>
                                    A partir de {reportDate(version.from)}: {money(version.amount_cents)}
                                  </p>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {rows.length > displayLimit && (
              <div className="pt-3 text-center border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setDisplayLimit((prev) => prev + 50)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Carregar mais ({rows.length - displayLimit} restantes)
                </button>
              </div>
            )}
          </section>

          {/* 6-Month Comparison Section with BarChart */}
          <section className="card p-5 sm:p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Comparação dos últimos seis meses">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <BarChart3 size={20} className="text-brand-600 dark:text-brand-400" />
                  Comparação dos últimos seis meses
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Evolução de receitas vs. despesas mês a mês
                </p>
              </div>

              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setComparisonTab('chart')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    comparisonTab === 'chart'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Gráfico
                </button>
                <button
                  type="button"
                  onClick={() => setComparisonTab('table')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    comparisonTab === 'table'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Tabela
                </button>
              </div>
            </div>

            {comparisonTab === 'chart' ? (
              privacy ? (
                <div className="flex min-h-64 items-center justify-center rounded-xl bg-slate-50 p-6 text-sm text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                  Valores e gráficos ocultos pelo modo de privacidade.
                </div>
              ) : (
                <div className="w-full min-w-0" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={comparisonChartData} margin={{ top: 20, right: 15, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} strokeOpacity={0.6} />
                      <XAxis dataKey="name" stroke={axisTickColor} tick={{ fontSize: 12, fill: axisTickColor }} tickLine={false} axisLine={false} />
                      <YAxis
                        stroke={axisTickColor}
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => money(Number(v) * 100)}
                      />
                      <Tooltip
                        cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                        formatter={(value) => [money(Number(value) * 100)]}
                        labelFormatter={(label) => `Mês: ${label}`}
                        contentStyle={{
                          backgroundColor: tooltipBg,
                          borderColor: tooltipBorder,
                          borderRadius: 12,
                          color: tooltipText,
                          fontSize: 13,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                      <Bar dataKey="receitas" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="despesas" name="Despesas" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                    <tr className="text-left text-xs font-semibold">
                      <th className="py-3 px-4">Mês</th>
                      <th className="py-3 px-4">Receitas</th>
                      <th className="py-3 px-4">Despesas</th>
                      <th className="py-3 px-4">Saldo</th>
                      <th className="py-3 px-4">Variação das despesas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.comparison.map((item) => {
                      const saldo = item.income_cents - item.expense_cents;
                      return (
                        <tr key={item.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="whitespace-nowrap py-3 px-4 font-medium text-slate-800 dark:text-slate-100">
                            {reportMonth(item.month)}
                            {item.snapshot && (
                              <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                <Lock size={10} /> Fechado
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 text-emerald-700 dark:text-emerald-400 font-medium">
                            {money(item.income_cents)}
                          </td>
                          <td className="whitespace-nowrap px-4 text-rose-700 dark:text-rose-400 font-medium">
                            {money(item.expense_cents)}
                          </td>
                          <td className={`whitespace-nowrap px-4 font-semibold ${saldo >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                            {money(saldo)}
                          </td>
                          <td className="whitespace-nowrap px-4 text-slate-600 dark:text-slate-300">
                            {!privacy && item.new ? (
                              <span className="text-xs text-brand-600 dark:text-brand-400 font-semibold">Novo</span>
                            ) : (
                              reportPercent(item.expense_change_percent, privacy)
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Space Net Worth Section with AreaChart */}
          <section className="card p-5 sm:p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Patrimônio do espaço">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Wallet size={20} className="text-brand-600 dark:text-brand-400" />
                  Patrimônio do Espaço
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Valores no fim de cada mês. Meses fechados usam seu retrato preservado.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void download('net_worth')}
                  className="text-xs sm:text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300 inline-flex items-center gap-1.5"
                >
                  <Download size={14} />
                  Baixar CSV
                </button>

                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setNetWorthTab('chart')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      netWorthTab === 'chart'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Gráfico
                  </button>
                  <button
                    type="button"
                    onClick={() => setNetWorthTab('table')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      netWorthTab === 'table'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Tabela
                  </button>
                </div>
              </div>
            </div>

            {netWorthTab === 'chart' ? (
              privacy ? (
                <div className="flex min-h-64 items-center justify-center rounded-xl bg-slate-50 p-6 text-sm text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                  Valores e gráficos ocultos pelo modo de privacidade.
                </div>
              ) : (
                <div className="w-full min-w-0" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <AreaChart data={netWorthChartData} margin={{ top: 20, right: 15, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#087a43" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#087a43" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStroke} strokeOpacity={0.6} />
                      <XAxis dataKey="name" stroke={axisTickColor} tick={{ fontSize: 12, fill: axisTickColor }} tickLine={false} axisLine={false} />
                      <YAxis
                        stroke={axisTickColor}
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => money(Number(v) * 100)}
                      />
                      <Tooltip
                        formatter={(value) => [money(Number(value) * 100), 'Patrimônio Líquido']}
                        labelFormatter={(label) => `Mês: ${label}`}
                        contentStyle={{
                          backgroundColor: tooltipBg,
                          borderColor: tooltipBorder,
                          borderRadius: 12,
                          color: tooltipText,
                          fontSize: 13,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="patrimonio"
                        name="Patrimônio Líquido"
                        stroke="#087a43"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#netWorthGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                    <tr className="text-left text-xs font-semibold">
                      <th className="py-3 px-4">Mês</th>
                      <th className="py-3 px-4">Patrimônio líquido</th>
                      <th className="py-3 px-4">Variação da atividade</th>
                      <th className="py-3 px-4">Saldos iniciais cadastrados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.net_worth.map((item) => (
                      <tr key={item.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="whitespace-nowrap py-3 px-4 font-medium text-slate-800 dark:text-slate-100">
                          {reportMonth(item.month)}
                          {item.snapshot && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              <Lock size={10} /> Fechado
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 font-bold text-slate-900 dark:text-slate-100">
                          {money(item.net_worth_cents)}
                        </td>
                        <td className={`whitespace-nowrap px-4 font-medium ${item.growth_cents >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                          {money(item.growth_cents)}
                        </td>
                        <td className="whitespace-nowrap px-4 text-slate-600 dark:text-slate-400">
                          {money(item.opening_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Future Installments Card */}
          <FutureInstallmentList value={data.future_installments} money={money} privacy={privacy} />

          {/* Bottom Export Options Panel */}
          <section className="card p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-4">
                <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Formato da exportação CSV
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as typeof format)}
                    className="field-input text-xs sm:text-sm py-1.5"
                  >
                    <option value="spreadsheet">Planilha · valores em reais (R$)</option>
                    <option value="technical">Dados · valores brutos em centavos</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void download(view)}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  <Download size={16} />
                  {exporting ? 'Exportando relatório…' : `Baixar CSV (${titles[view]})`}
                </button>
              </div>
            </div>
            {privacy && (
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Nota: O arquivo CSV exportado contém os valores financeiros completos desmascarados.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
