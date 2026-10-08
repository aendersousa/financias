import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  ArrowRight,
  Archive,
  RotateCcw,
  RefreshCw,
  Check,
  Inbox as InboxIcon
} from 'lucide-react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';

export interface NotificationItem {
  id: string;
  type: string;
  severity: 'urgent' | 'attention' | 'informational';
  source_type: string;
  source_id: string;
  title: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  archived_at: string | null;
  resolved_at: string | null;
  version: number;
  created_at: string;
}

interface Inbox {
  notifications: NotificationItem[];
  unread_count: number;
}

export type Destination =
  | 'agenda'
  | 'cards'
  | 'budgets'
  | 'reserves'
  | 'dashboard'
  | 'accounts'
  | 'transactions'
  | 'imports'
  | 'sharing'
  | 'reports'
  | 'foreign_currency';

const severityConfig = {
  urgent: {
    label: 'Urgente',
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-900',
    icon: AlertCircle,
    iconColor: 'text-rose-500'
  },
  attention: {
    label: 'Atenção',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900',
    icon: AlertTriangle,
    iconColor: 'text-amber-500'
  },
  informational: {
    label: 'Informativo',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-900',
    icon: Info,
    iconColor: 'text-blue-500'
  }
};

const destinations: Record<string, { section: Destination; label: string }> = {
  commitment: { section: 'agenda', label: 'Ver na Agenda' },
  card_statement: { section: 'cards', label: 'Ver cartões' },
  budget: { section: 'budgets', label: 'Ver orçamento' },
  reserve: { section: 'reserves', label: 'Ver meta' },
  financial_account: { section: 'reserves', label: 'Ver reservas' },
  financial_space: { section: 'reserves', label: 'Ver reservas' },
  account_balance_check: { section: 'accounts', label: 'Conferir conta' },
  space_member: { section: 'sharing', label: 'Ver membros' },
  free_to_spend: { section: 'dashboard', label: 'Ver Livre para gastar' },
  ledger_transaction: { section: 'transactions', label: 'Conferir lançamento' },
  import_batch: { section: 'imports', label: 'Revisar extrato' },
  category: { section: 'reports', label: 'Comparar consumo' }
};

const destinationLabels: Record<Destination, string> = {
  agenda: 'Ver na Agenda',
  cards: 'Ver cartões',
  budgets: 'Ver orçamento',
  reserves: 'Ver metas e provisões',
  dashboard: 'Ver Livre para gastar',
  accounts: 'Conferir conta',
  transactions: 'Conferir lançamento',
  imports: 'Revisar extrato',
  sharing: 'Ver membros',
  reports: 'Comparar consumo',
  foreign_currency: 'Confirmar conversões'
};

export default function LedgerNotificationPopup({
  workspace,
  money,
  onNavigate,
  onClose,
  onUpdateUnread
}: {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  onNavigate: (section: Destination) => void;
  onClose: () => void;
  onUpdateUnread?: (count: number) => void;
}) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [filter, setFilter] = useState<'unread' | 'all' | 'archived'>('unread');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  async function load() {
    const next = await ledgerRpc<Inbox>('daily_alerts', { p_space: workspace.space.id });
    setInbox(next);
    onUpdateUnread?.(next.unread_count);
  }

  async function run(task: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar as notificações.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(async () => undefined);
  }, [workspace.space.id]);

  const unread = inbox?.notifications.filter(item => !item.read_at && !item.archived_at && !item.resolved_at) ?? [];
  const archived = inbox?.notifications.filter(item => Boolean(item.archived_at)) ?? [];
  const activeAll = inbox?.notifications.filter(item => !item.archived_at) ?? [];

  const visible = inbox?.notifications.filter(item => {
    if (filter === 'archived') return Boolean(item.archived_at);
    if (item.archived_at) return false;
    if (filter === 'unread') return !item.read_at && !item.resolved_at;
    return true; // 'all'
  }) ?? [];

  function mark(item: NotificationItem, action: string) {
    return run(() =>
      ledgerRpc('manage_notification', {
        p_space: workspace.space.id,
        p_notification: item.id,
        p_version: item.version,
        p_action: action
      })
    );
  }

  function markAllRead() {
    if (unread.length === 0) return;
    return run(() =>
      ledgerRpc('read_notifications', {
        p_space: workspace.space.id,
        p_versions: unread.map(item => ({ id: item.id, version: item.version }))
      })
    );
  }

  function destination(item: NotificationItem) {
    const target = item.payload.destination;
    if (typeof target === 'string' && target in destinationLabels) {
      return { section: target as Destination, label: destinationLabels[target as Destination] };
    }
    return destinations[item.source_type];
  }

  function moneyLine(item: NotificationItem, key: string, label: string) {
    const value = item.payload[key];
    return typeof value === 'number' && Number.isSafeInteger(value) ? (
      <span key={key} className="inline-block text-xs text-slate-600 dark:text-slate-400">
        <strong className="font-medium text-slate-700 dark:text-slate-300">{label}:</strong> {money(value)}
      </span>
    ) : null;
  }

  return (
    <>
      {/* Semi-transparent backdrop for mobile click-outside */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-xs sm:bg-transparent"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Floating Popup Card */}
      <div
        ref={popupRef}
        role="dialog"
        aria-modal="true"
        aria-label="Central de notificações"
        className="fixed inset-x-3 top-14 z-50 flex max-h-[85vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[460px] sm:max-h-[600px] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
              <Bell size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notificações</h2>
                {unread.length > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/80 dark:text-red-300">
                    {unread.length} nova{unread.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => undefined)}
              aria-label="Atualizar notificações"
              title="Atualizar"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar notificações"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Filter pills & Mark all as read */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/30">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filter === 'unread'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Não lidas {unread.length > 0 ? `(${unread.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Todas {activeAll.length > 0 ? `(${activeAll.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setFilter('archived')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filter === 'archived'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Arquivadas {archived.length > 0 ? `(${archived.length})` : ''}
            </button>
          </div>

          {filter !== 'archived' && unread.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void markAllRead()}
              className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
            >
              <CheckCheck size={13} />
              <span>Ler todas</span>
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <p role="alert" className="m-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-3 space-y-2.5 dark:divide-slate-800/80">
          {!inbox && !error && (
            <div className="py-12 text-center text-xs text-slate-400">Carregando notificações…</div>
          )}

          {inbox && visible.length === 0 && (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500">
              <InboxIcon className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {filter === 'unread' ? 'Tudo em dia!' : 'Nenhuma notificação encontrada'}
              </p>
              <p className="mt-1 text-xs">
                {filter === 'unread'
                  ? 'Você não tem alertas pendentes no momento.'
                  : 'Nenhum item corresponde ao filtro selecionado.'}
              </p>
            </div>
          )}

          {visible.map(item => {
            const sev = severityConfig[item.severity] ?? severityConfig.informational;
            const SevIcon = sev.icon;
            const dest = destination(item);
            const isUnread = !item.read_at && !item.resolved_at && !item.archived_at;

            return (
              <article
                key={item.id}
                className={`group rounded-xl border p-3 transition space-y-2 ${
                  isUnread
                    ? 'border-brand-200/80 bg-brand-50/20 dark:border-brand-900/50 dark:bg-brand-950/20'
                    : 'border-slate-100 bg-white dark:border-slate-800/80 dark:bg-slate-900'
                }`}
                aria-label={item.title}
              >
                {/* Top line: severity + status */}
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium border ${sev.badge}`}>
                      <SevIcon size={11} className={sev.iconColor} />
                      {sev.label}
                    </span>
                    <span className="text-slate-400">
                      {item.resolved_at ? 'Resolvida' : item.read_at ? 'Lida' : 'Não lida'}
                      {item.archived_at ? ' · Arquivada' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mark(item, item.read_at ? 'unread' : 'read')}
                      title={item.read_at ? 'Marcar como não lida' : 'Marcar como lida'}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                    >
                      <Check size={13} className={item.read_at ? 'text-slate-400' : 'text-brand-600 dark:text-brand-400'} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mark(item, item.archived_at ? 'restore' : 'archive')}
                      title={item.archived_at ? 'Restaurar' : 'Arquivar'}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                    >
                      <Archive size={13} />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <h3 className={`text-sm ${isUnread ? 'font-semibold text-slate-900 dark:text-slate-100' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
                  {item.title}
                </h3>

                {/* Financial details pills */}
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {moneyLine(item, 'remaining_cents', 'Falta pagar')}
                  {moneyLine(item, 'consumed_cents', 'Consumo no mês')}
                  {moneyLine(item, 'amount_cents', item.type === 'budget_threshold' ? 'Limite' : 'Valor da fatura')}
                  {moneyLine(item, 'balance_cents', 'Saldo da meta')}
                  {moneyLine(item, 'target_cents', 'Valor-alvo')}
                  {moneyLine(item, 'uncovered_cents', 'Saldo sem cobertura')}
                  {moneyLine(item, 'value_cents', 'Livre conservador')}
                  {moneyLine(item, 'difference_cents', 'Diferença')}
                  {moneyLine(item, 'shortfall_cents', 'Aporte pendente')}
                  {moneyLine(item, 'previous_cents', 'Consumo anterior')}

                  {typeof item.payload.due_on === 'string' && (
                    <span className="text-xs text-slate-500">
                      <strong>Vencimento:</strong> {item.payload.due_on.split('-').reverse().join('/')}
                    </span>
                  )}
                  {typeof item.payload.closing_on === 'string' && (
                    <span className="text-xs text-slate-500">
                      <strong>Fechamento:</strong> {item.payload.closing_on.split('-').reverse().join('/')}
                    </span>
                  )}
                  {typeof item.payload.month === 'string' && (
                    <span className="text-xs text-slate-500">
                      <strong>Mês:</strong> {item.payload.month.slice(0, 7)}
                    </span>
                  )}
                </div>

                {/* Explanatory notes */}
                {item.type === 'reserve_uncovered' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Reponha o saldo da conta ou libere parte das reservas para ajustar seus planos.
                  </p>
                )}
                {item.type === 'card_charges' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Confira juros, multas e IOF cobrados pelo banco antes de confirmar os encargos.
                  </p>
                )}
                {item.type === 'statement_closes_today' && typeof item.payload.purchases_go_next === 'boolean' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {item.payload.purchases_go_next
                      ? 'As compras de hoje entram na próxima fatura.'
                      : 'As compras de hoje ainda entram na fatura que está fechando.'}
                  </p>
                )}

                {/* Actions row */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {dest && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onClose();
                        onNavigate(dest.section);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-900/60"
                    >
                      <span>{dest.label}</span>
                      <ArrowRight size={12} />
                    </button>
                  )}

                  {item.type === 'main_income_confirm' && workspace.role !== 'viewer' && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onClose();
                          onNavigate('agenda');
                        }}
                        className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        Sim / registrar valor
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            ledgerRpc('defer_income_notification', {
                              p_space: workspace.space.id,
                              p_commitment: item.source_id
                            })
                          )
                        }
                        className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Ainda não, lembrar amanhã
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
          <span>{workspace.space.name}</span>
          <button
            type="button"
            onClick={onClose}
            className="font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Fechar
          </button>
        </div>
      </div>
    </>
  );
}
