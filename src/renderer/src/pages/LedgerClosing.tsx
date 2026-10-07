import { useEffect, useMemo, useState } from 'react';
import {
  History,
  Lock,
  LockOpen,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Scale,
  Wallet,
  ShieldCheck,
  Search,
  Sparkles,
  Info,
  Clock,
  Layers,
  ArrowRight,
  Tag
} from 'lucide-react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { sumCents } from '../../../shared/finance/money';
import { useAppStore } from '../store/useAppStore';
import { reportMonth, reportPercent } from './LedgerReports';

interface MonthReport {
  month: string;
  closed: boolean;
  version: number | null;
  balances_require_recalculation: boolean;
  controls: {
    net_worth_cents: number;
    consumption: {
      account_id: string;
      class: string;
      original_competence_month: string | null;
      amount_cents: number;
    }[];
    reserves?: {
      reserved_cents: number;
      reserves: {
        id: string;
        name: string;
        balance_cents: number;
        holding_mode: string;
      }[];
    };
  };
}

interface Warning {
  type: string;
  id: string;
  title: string;
}

const panel = 'card p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900';
const input = 'field-input px-3.5 py-2 text-xs sm:text-sm dark:border-slate-700 dark:bg-slate-800';

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export default function LedgerClosing({
  workspace,
  money,
  onChanged,
  privacy: privacyProp
}: {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  onChanged: () => Promise<void>;
  privacy?: boolean;
}) {
  const storePrivacy = useAppStore((s) => s.privacyMode);
  const privacy = privacyProp ?? storePrivacy;

  const currentMonth = workspace.space.today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState<MonthReport | null>(null);
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showReopenForm, setShowReopenForm] = useState(false);

  // Filters for consumption items
  const [consumptionTab, setConsumptionTab] = useState<'all' | 'expense' | 'income'>('all');
  const [searchFilter, setSearchFilter] = useState('');

  const canClose = ['owner', 'admin'].includes(workspace.role);

  async function load() {
    setReport(
      await ledgerRpc<MonthReport>('month_report', {
        p_space: workspace.space.id,
        p_month: `${month}-01`
      })
    );
  }

  useEffect(() => {
    setReport(null);
    setWarnings(null);
    setAcknowledge(false);
    setError('');
    setShowReopenForm(false);
    if (month) void load().catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  }, [month, workspace.space.id]);

  async function action(name: string, args: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await ledgerRpc(name, {
        p_space: workspace.space.id,
        p_month: `${month}-01`,
        ...args
      });
      setWarnings(null);
      setReason('');
      setShowReopenForm(false);
      await load();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    setError('');
    try {
      const result = await ledgerRpc<{ warnings: Warning[] }>('preview_month_closing', {
        p_space: workspace.space.id,
        p_month: `${month}-01`
      });
      setWarnings(result.warnings);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível revisar as pendências.');
    } finally {
      setBusy(false);
    }
  }

  // Calculations for consumption items
  const consumptionItems = report?.controls.consumption ?? [];
  const totalIncome = useMemo(() => {
    return sumCents(consumptionItems.filter((c) => c.class === 'income').map((c) => -c.amount_cents));
  }, [consumptionItems]);

  const totalExpense = useMemo(() => {
    return sumCents(consumptionItems.filter((c) => c.class === 'expense').map((c) => c.amount_cents));
  }, [consumptionItems]);

  const netResult = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? (netResult / totalIncome) * 100 : null;

  // Filtered consumption items
  const filteredConsumption = useMemo(() => {
    return consumptionItems.filter((c) => {
      if (consumptionTab === 'expense' && c.class !== 'expense') return false;
      if (consumptionTab === 'income' && c.class !== 'income') return false;
      if (searchFilter.trim()) {
        const catName = workspace.categories.find((cat) => cat.ledger_account_id === c.account_id)?.name ?? 'Categoria histórica';
        return catName.toLowerCase().includes(searchFilter.toLowerCase());
      }
      return true;
    });
  }, [consumptionItems, consumptionTab, searchFilter, workspace.categories]);

  const isPastMonth = month < currentMonth;

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <section className={panel}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
              <History className="text-brand-600 dark:text-brand-400" size={26} />
              Relatório Mensal e Fechamento
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Preserve a integridade dos seus dados contábeis, bloqueie edições e gere retratos consolidados dos períodos.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 transition-colors dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw size={15} />
              Atualizar
            </button>
          </div>
        </div>

        {/* Month Navigation & Status Bar */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              title="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
              <Calendar size={15} className="text-slate-400" />
              <span>Mês:</span>
              <input
                id="report-month"
                type="month"
                value={month}
                onChange={(e) => {
                  if (e.target.value) setMonth(e.target.value);
                }}
                className={input}
              />
            </label>

            <button
              type="button"
              onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              title="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>

            {month !== currentMonth && (
              <button
                type="button"
                onClick={() => setMonth(currentMonth)}
                className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-400 ml-2"
              >
                Ir para o mês atual
              </button>
            )}
          </div>

          {/* Current Month Status Pill */}
          {report && (
            <div className="flex flex-wrap items-center gap-2">
              {report.closed ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <Lock size={13} />
                  Mês fechado · versão {report.version ?? 'inicial'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <LockOpen size={13} />
                  Mês aberto · valores provisórios
                </span>
              )}

              {report.balances_require_recalculation && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-200">
                  <AlertTriangle size={13} />
                  Saldos a recalcular
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Error alert */}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200 flex items-start gap-2.5">
          <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
          <p>{error}</p>
        </div>
      )}

      {/* Loading state */}
      {!report && !error && (
        <div className="card p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="inline-block animate-spin text-brand-600 dark:text-brand-400 mb-3">
            <RefreshCw size={26} />
          </div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Consultando controles de fechamento do mês {reportMonth(month)}…
          </p>
        </div>
      )}

      {report && (
        <>
          {/* Month Status & Integrity Info Card */}
          <section
            className={`card p-5 sm:p-6 border-l-4 ${
              report.closed
                ? 'border-emerald-500 bg-emerald-50/30 dark:border-emerald-600 dark:bg-emerald-950/20'
                : 'border-amber-500 bg-amber-50/30 dark:border-amber-600 dark:bg-amber-950/20'
            } dark:border-slate-800 dark:bg-slate-900`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {report.closed ? (
                    <Lock size={18} className="text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <LockOpen size={18} className="text-amber-600 dark:text-amber-400" />
                  )}
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {report.closed
                      ? `Controles Fixados · Versão ${report.version ?? 'inicial'}`
                      : 'Mês Aberto para Lançamentos'}
                  </h2>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
                  {report.closed
                    ? 'Este mês está oficialmente protegido. Lançamentos, orçamentos e saldos não podem ser alterados acidentalmente. Para fazer alterações retroativas, utilize a opção de reabertura.'
                    : isPastMonth
                    ? 'Este mês já encerrou seu ciclo no calendário e está pronto para ser fechado. O fechamento preserva os controles históricos e trava os saldos.'
                    : 'Este é o mês corrente ou futuro. Lançamentos e orçamentos continuam provisórios até o término do período.'}
                </p>
                {report.balances_require_recalculation && (
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 mt-2">
                    <AlertTriangle size={14} />
                    Saldos a recalcular: um mês anterior foi reaberto e modificado.
                  </p>
                )}
              </div>

              {canClose && report.closed && !showReopenForm && (
                <button
                  type="button"
                  onClick={() => setShowReopenForm(true)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Reabrir mês para edição
                </button>
              )}
            </div>
          </section>

          {/* Financial KPI Cards */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Patrimônio Preservado
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <Wallet size={16} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                {money(report.controls.net_worth_cents)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Retrato patrimonial no controle mensal</p>
            </div>

            <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Receitas por Competência
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <TrendingUp size={16} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
                {money(totalIncome)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Entradas reconhecidas no mês</p>
            </div>

            <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Despesas por Competência
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                  <TrendingDown size={16} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-rose-700 dark:text-rose-300">
                {money(totalExpense)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Gastos totais do período</p>
            </div>

            <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Resultado Operacional
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                  <Scale size={16} />
                </span>
              </div>
              <p
                className={`mt-2 text-2xl font-bold tracking-tight ${
                  netResult >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
                }`}
              >
                {money(netResult)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {savingsRate !== null ? `Poupança: ${reportPercent(savingsRate, privacy)}` : 'Saldo da atividade'}
              </p>
            </div>
          </section>

          {/* Consumo e Receitas por Categoria */}
          <section className="card p-5 sm:p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900" aria-label="Consumo e receitas por categoria">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Layers size={18} className="text-brand-600 dark:text-brand-400" />
                  Consumo e Receitas por Categoria
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Valores computados no controle do mês de {reportMonth(month)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Tab switch */}
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setConsumptionTab('all')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      consumptionTab === 'all'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Todas ({consumptionItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsumptionTab('expense')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      consumptionTab === 'expense'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Despesas
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsumptionTab('income')}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      consumptionTab === 'income'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Receitas
                  </button>
                </div>

                {/* Search input */}
                {consumptionItems.length > 5 && (
                  <div className="relative w-full sm:w-48">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filtrar categoria..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="field-input pl-8 py-1 text-xs w-full"
                    />
                  </div>
                )}
              </div>
            </div>

            {filteredConsumption.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Nenhuma receita ou despesa encontrada para os critérios selecionados.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredConsumption.map((c, index) => {
                  const isIncome = c.class === 'income';
                  const amount = isIncome ? -c.amount_cents : c.amount_cents;
                  const categoryName =
                    workspace.categories.find((cat) => cat.ledger_account_id === c.account_id)?.name ??
                    'Categoria histórica';

                  return (
                    <div
                      key={`${c.account_id}-${index}`}
                      className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/40 rounded-lg px-2 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{categoryName}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              isIncome
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {isIncome ? 'Receita' : 'Despesa'}
                          </span>
                        </div>

                        {c.original_competence_month && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            De meses anteriores · ref. {reportMonth(c.original_competence_month)}
                          </p>
                        )}
                      </div>

                      <strong
                        className={`text-base ${
                          isIncome ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        {money(amount)}
                      </strong>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Reservas no Fim do Mês */}
          {report.controls.reserves && (
            <section className="card p-5 sm:p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900" aria-label="Reservas no fim do mês">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <ShieldCheck size={18} className="text-brand-600 dark:text-brand-400" />
                    Reservas Financeiras no Fim do Mês
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Posição consolidada das reservas e metas financeiras
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Total reservado</span>
                  <strong className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {money(report.controls.reserves.reserved_cents)}
                  </strong>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-2">
                {report.controls.reserves.reserves.map((reserve) => (
                  <div
                    key={reserve.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40 space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{reserve.name}</span>
                      <span className="rounded bg-white px-1.5 py-0.5 text-[10px] dark:bg-slate-900 font-medium">
                        {reserve.holding_mode === 'account' ? 'Investimento' : 'Conta'}
                      </span>
                    </div>
                    <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {money(reserve.balance_cents)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Fechar Mês Action Card */}
          {canClose && !report.closed && isPastMonth && (
            <section className="card p-5 sm:p-6 space-y-4 border-l-4 border-brand-600 dark:border-slate-800 dark:bg-slate-900" aria-label="Fechar mês">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Lock size={18} className="text-brand-600 dark:text-brand-400" />
                  Fechar Mês de {reportMonth(month)}
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  O fechamento preserva os controles do mês e exige reabertura para alterar valores.
                  Antes de confirmar, revisamos compromissos em aberto e valores de fim de mês.
                </p>
              </div>

              {warnings === null ? (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void preview()}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle2 size={16} />
                    {busy ? 'Revisando pendências…' : 'Revisar antes de fechar'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  {warnings.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 size={16} />
                      <span>Nenhum aviso encontrado na Agenda ou valores de patrimônio. Tudo pronto para fechar!</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-amber-800 dark:text-amber-300">
                        <AlertTriangle size={16} />
                        <span>Revise os avisos abaixo antes de confirmar o fechamento:</span>
                      </div>

                      <ul className="space-y-2 text-xs sm:text-sm pl-4 list-disc text-slate-700 dark:text-slate-300">
                        {warnings.map((w) => (
                          <li key={`${w.type}-${w.id}`}>
                            <strong>{w.title}</strong> ·{' '}
                            {w.type === 'open_commitment'
                              ? 'Compromisso ainda aberto na Agenda'
                              : 'Valor de fim do mês não informado'}
                          </li>
                        ))}
                      </ul>

                      <label className="flex items-center gap-2.5 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 pt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acknowledge}
                          onChange={(e) => setAcknowledge(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span>Revisei os avisos e quero fechar o mês mesmo assim</span>
                      </label>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      disabled={busy || (warnings.length > 0 && !acknowledge)}
                      onClick={() => void action('close_month', { p_acknowledge_warnings: acknowledge })}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      <Lock size={15} />
                      {busy ? 'Fechando mês…' : 'Confirmar fechamento'}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setWarnings(null)}
                      className="text-xs sm:text-sm font-semibold text-slate-500 hover:underline dark:text-slate-400"
                    >
                      Cancelar revisão
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Reabrir Mês Form */}
          {canClose && report.closed && showReopenForm && (
            <section className="card p-5 sm:p-6 space-y-4 border-l-4 border-amber-500 dark:border-slate-800 dark:bg-slate-900" aria-label="Reabertura do mês">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <LockOpen size={18} className="text-amber-600 dark:text-amber-400" />
                    Reabrir Mês de {reportMonth(month)}
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    A versão fechada continua guardada para auditoria. Ao fechar novamente, os controles alterados ganharão uma nova versão.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowReopenForm(false)}
                  className="text-xs text-slate-500 hover:underline dark:text-slate-400"
                >
                  Fechar formulário
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action('reopen_month', { p_reason: reason });
                }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <label htmlFor="reopen-reason" className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Motivo da reabertura (obrigatório, mín. 10 caracteres)
                  </label>
                  <textarea
                    id="reopen-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    minLength={10}
                    placeholder="Ex.: Ajuste retroativo na categoria de condomínio e conciliação de comprovante."
                    rows={3}
                    className="field-input w-full p-3 text-xs sm:text-sm"
                  />
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Mínimo de 10 caracteres</span>
                    <span>{reason.length} caracteres</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={busy || reason.trim().length < 10}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-600 bg-amber-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    <LockOpen size={15} />
                    {busy ? 'Reabrindo mês…' : 'Confirmar Reabertura'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowReopenForm(false)}
                    className="text-xs sm:text-sm text-slate-500 hover:underline dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
