import { useState, useMemo } from 'react';
import {
  History,
  Search,
  ArrowLeftRight,
  Wallet,
  CreditCard,
  Tag,
  Hash,
  Repeat,
  PiggyBank,
  CalendarDays,
  User,
  ShieldCheck,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Archive,
  RotateCcw,
  Clock,
  UserCheck,
  Cpu,
  X,
  Layers,
  ChevronDown
} from 'lucide-react';
import type { LedgerWorkspace, WorkspaceMetadata } from '../lib/ledgerRepository';

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

type ActionCategory = 'create' | 'edit' | 'delete' | 'archive' | 'system';

interface ActionMetadata {
  label: string;
  category: ActionCategory;
  description?: string;
}

const ACTION_MAP: Record<string, ActionMetadata> = {
  created: { label: 'Cadastro criado', category: 'create' },
  edited: { label: 'Lançamento editado', category: 'edit' },
  cancelled: { label: 'Cancelamento', category: 'delete' },
  deleted: { label: 'Exclusão', category: 'delete' },
  delete: { label: 'Exclusão', category: 'delete' },
  archive: { label: 'Arquivamento', category: 'archive' },
  restore: { label: 'Restauração', category: 'edit' },
  updated: { label: 'Atualização', category: 'edit' },
  tags_changed: { label: 'Tags alteradas', category: 'edit' },
  rename: { label: 'Tag renomeada', category: 'edit' },
  merge: { label: 'Tags mescladas', category: 'edit' },
  charges_confirmed: { label: 'Encargos confirmados', category: 'edit' },
  version_created: { label: 'Recorrência atualizada', category: 'create' },
  ended: { label: 'Recorrência encerrada', category: 'delete' },
  cycle_changed: { label: 'Ciclo de fatura alterado', category: 'edit' },
  reserve_plan_changed: { label: 'Plano da meta alterado', category: 'edit' },
  reserve_funding_processed: { label: 'Aporte de meta processado', category: 'edit' },
  reserve_funding_confirmed: { label: 'Aporte de meta confirmado', category: 'create' },
  statement_dates_changed: { label: 'Datas da fatura alteradas', category: 'edit' },
  card_created: { label: 'Cartão criado', category: 'create' },
  card_updated: { label: 'Cartão atualizado', category: 'edit' },
  card_opening_configured: { label: 'Fatura inicial configurada', category: 'create' },
  budget_plan_changed: { label: 'Orçamento alterado', category: 'edit' },
  balance_checked: { label: 'Saldo conferido', category: 'edit' },
  foreign_purchase_created: { label: 'Compra internacional criada', category: 'create' },
  foreign_purchase_confirmed: { label: 'Compra internacional confirmada', category: 'edit' },
  foreign_purchase_reestimated: { label: 'Cotação cambial reestimada', category: 'edit' },
  adjustment_explained: { label: 'Ajuste de saldo explicado', category: 'edit' },
  default_role_initialized: { label: 'Regra padrão inicializada', category: 'system' }
};

const ENTITY_CONFIG: Record<
  string,
  { label: string; icon: typeof ArrowLeftRight; badgeClass: string }
> = {
  ledger_transaction: {
    label: 'Lançamento',
    icon: ArrowLeftRight,
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
  },
  financial_account: {
    label: 'Conta bancária',
    icon: Wallet,
    badgeClass:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
  },
  credit_card: {
    label: 'Cartão de crédito',
    icon: CreditCard,
    badgeClass:
      'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
  },
  card_statement: {
    label: 'Fatura de cartão',
    icon: CreditCard,
    badgeClass:
      'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
  },
  category: {
    label: 'Categoria',
    icon: Tag,
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
  },
  tag: {
    label: 'Tag',
    icon: Hash,
    badgeClass:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  },
  recurrence_rule: {
    label: 'Recorrência',
    icon: Repeat,
    badgeClass:
      'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800'
  },
  reserve: {
    label: 'Meta ou provisão',
    icon: PiggyBank,
    badgeClass:
      'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800'
  },
  reserve_funding_event: {
    label: 'Aporte de meta',
    icon: PiggyBank,
    badgeClass:
      'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800'
  },
  budget: {
    label: 'Orçamento',
    icon: CalendarDays,
    badgeClass:
      'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800'
  },
  person: {
    label: 'Pessoa',
    icon: User,
    badgeClass:
      'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/60 dark:text-pink-300 dark:border-pink-800'
  },
  financial_space: {
    label: 'Espaço financeiro',
    icon: ShieldCheck,
    badgeClass:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  },
  account_balance_check: {
    label: 'Conferência de saldo',
    icon: CheckCircle2,
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
  }
};

function resolveEntityName(
  entityType: string,
  entityId: string,
  workspace: LedgerWorkspace,
  metadata: WorkspaceMetadata | null
): string | null {
  if (entityType === 'ledger_transaction') {
    return workspace.transactions.find(t => t.id === entityId)?.description ?? null;
  }
  if (entityType === 'financial_account') {
    return workspace.accounts.find(a => a.id === entityId)?.name ?? null;
  }
  if (entityType === 'credit_card') {
    return workspace.cards.find(c => c.id === entityId)?.name ?? null;
  }
  if (entityType === 'category') {
    return workspace.categories.find(c => c.id === entityId)?.name ?? null;
  }
  if (entityType === 'tag') {
    return metadata?.tags.find(t => t.id === entityId)?.name ?? null;
  }
  if (entityType === 'recurrence_rule') {
    return metadata?.recurrences.find(r => r.id === entityId)?.title ?? null;
  }
  if (entityType === 'financial_space') {
    return workspace.space.name;
  }
  return null;
}

function formatDayHeader(dateStr: string, todayIso: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  const [tYear, tMonth, tDay] = todayIso.split('-').map(Number);
  const todayDate = new Date(tYear, tMonth - 1, tDay);

  const diffTime = todayDate.getTime() - targetDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const dateFormatted = `${String(day).padStart(2, '0')} de ${monthNames[month - 1]} de ${year}`;

  if (diffDays === 0) return `Hoje · ${dateFormatted}`;
  if (diffDays === 1) return `Ontem · ${dateFormatted}`;
  if (diffDays >= 2 && diffDays <= 6) return `Esta semana · ${dateFormatted}`;
  return dateFormatted;
}

export default function LedgerAuditHistory({
  workspace,
  metadata
}: {
  workspace: LedgerWorkspace;
  metadata: WorkspaceMetadata | null;
}) {
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [actionCategoryFilter, setActionCategoryFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [displayLimit, setDisplayLimit] = useState(30);

  const rawAudit = metadata?.audit ?? [];

  // Summary stats
  const stats = useMemo(() => {
    let creates = 0;
    let edits = 0;
    let deletes = 0;
    for (const item of rawAudit) {
      const meta = ACTION_MAP[item.action];
      if (meta?.category === 'create') creates++;
      else if (meta?.category === 'delete') deletes++;
      else edits++;
    }
    return { total: rawAudit.length, creates, edits, deletes };
  }, [rawAudit]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    const today = new Date(workspace.space.today + 'T23:59:59');
    const term = search.trim().toLowerCase();

    return rawAudit.filter(item => {
      // Entity filter
      if (entityFilter !== 'all' && item.entity_type !== entityFilter) {
        return false;
      }

      // Action category filter
      const actionMeta = ACTION_MAP[item.action];
      const category = actionMeta?.category ?? 'edit';
      if (actionCategoryFilter !== 'all' && category !== actionCategoryFilter) {
        return false;
      }

      // Period filter
      if (periodFilter !== 'all') {
        const itemDate = new Date(item.created_at);
        const diffMs = today.getTime() - itemDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (periodFilter === 'today' && item.created_at.slice(0, 10) !== workspace.space.today) return false;
        if (periodFilter === '7days' && diffDays > 7) return false;
        if (periodFilter === '30days' && diffDays > 30) return false;
      }

      // Text search
      if (term) {
        const actionLabel = actionMeta?.label.toLowerCase() ?? item.action.toLowerCase();
        const entityLabel = (ENTITY_CONFIG[item.entity_type]?.label ?? item.entity_type).toLowerCase();
        const resolvedName = resolveEntityName(item.entity_type, item.entity_id, workspace, metadata)?.toLowerCase() ?? '';
        const match =
          actionLabel.includes(term) ||
          entityLabel.includes(term) ||
          resolvedName.includes(term) ||
          item.id.toLowerCase().includes(term);
        if (!match) return false;
      }

      return true;
    });
  }, [rawAudit, search, entityFilter, actionCategoryFilter, periodFilter, workspace, metadata]);

  // Group filtered entries by date (YYYY-MM-DD)
  const groupedEntries = useMemo(() => {
    const visible = filteredEntries.slice(0, displayLimit);
    const groups: { dateKey: string; items: AuditEntry[] }[] = [];
    const dateMap = new Map<string, AuditEntry[]>();

    for (const entry of visible) {
      const dateKey = entry.created_at.slice(0, 10);
      if (!dateMap.has(dateKey)) {
        const list: AuditEntry[] = [];
        dateMap.set(dateKey, list);
        groups.push({ dateKey, items: list });
      }
      dateMap.get(dateKey)!.push(entry);
    }

    return groups;
  }, [filteredEntries, displayLimit]);

  const hasActiveFilters = search || entityFilter !== 'all' || actionCategoryFilter !== 'all' || periodFilter !== 'all';

  function resetFilters() {
    setSearch('');
    setEntityFilter('all');
    setActionCategoryFilter('all');
    setPeriodFilter('all');
    setDisplayLimit(30);
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards Header */}
      <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
              <History size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Histórico de Alterações e Auditoria
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Registro seguro e cronológico de movimentações e edições no espaço {workspace.space.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {stats.total} alterações salvas
            </span>
          </div>
        </div>

        {/* Quick summary badges */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Total de registros</span>
            <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Criações & Inclusões</span>
            <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300">{stats.creates}</p>
          </div>
          <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
            <span className="text-[11px] font-medium text-blue-700 dark:text-blue-400">Edições & Ajustes</span>
            <p className="mt-1 text-xl font-bold text-blue-700 dark:text-blue-300">{stats.edits}</p>
          </div>
          <div className="rounded-xl border border-rose-200/80 bg-rose-50/40 p-3 dark:border-rose-900/40 dark:bg-rose-950/20">
            <span className="text-[11px] font-medium text-rose-700 dark:text-rose-400">Exclusões & Baixas</span>
            <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-300">{stats.deletes}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Search box */}
          <div className="relative flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
            <label htmlFor="audit-search" className="field-label">Buscar no histórico</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="audit-search"
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Ex: Nubank, Mercado, Salário..."
                className="field-input w-full pl-9 pr-8"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Entity filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="audit-entity-filter" className="field-label">Tipo de item</label>
            <select
              id="audit-entity-filter"
              value={entityFilter}
              onChange={e => setEntityFilter(e.target.value)}
              className="field-input w-full"
            >
              <option value="all">Todos os tipos de item</option>
              <option value="ledger_transaction">Lançamentos</option>
              <option value="financial_account">Contas bancárias</option>
              <option value="credit_card">Cartões de crédito</option>
              <option value="card_statement">Faturas de cartão</option>
              <option value="category">Categorias</option>
              <option value="recurrence_rule">Recorrências</option>
              <option value="reserve">Metas e provisões</option>
              <option value="tag">Tags</option>
              <option value="person">Pessoas</option>
              <option value="financial_space">Configurações do espaço</option>
            </select>
          </div>

          {/* Action kind filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="audit-action-filter" className="field-label">Tipo de ação</label>
            <select
              id="audit-action-filter"
              value={actionCategoryFilter}
              onChange={e => setActionCategoryFilter(e.target.value)}
              className="field-input w-full"
            >
              <option value="all">Todas as ações</option>
              <option value="create">Criações e Inclusões</option>
              <option value="edit">Edições e Atualizações</option>
              <option value="delete">Cancelamentos e Exclusões</option>
              <option value="archive">Arquivamentos</option>
            </select>
          </div>

          {/* Period filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="audit-period-filter" className="field-label">Período</label>
            <select
              id="audit-period-filter"
              value={periodFilter}
              onChange={e => setPeriodFilter(e.target.value as typeof periodFilter)}
              className="field-input w-full"
            >
              <option value="all">Todo o período</option>
              <option value="today">Apenas hoje</option>
              <option value="7days">Últimos 7 dias</option>
              <option value="30days">Últimos 30 dias</option>
            </select>
          </div>
        </div>

        {/* Filter status row */}
        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">
              Mostrando <strong>{filteredEntries.length}</strong> de {stats.total} alterações registradas
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              <RotateCcw size={12} />
              Limpar todos os filtros
            </button>
          </div>
        )}
      </div>

      {/* Timeline List */}
      {groupedEntries.length === 0 ? (
        <div className="card p-12 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <History className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={36} />
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            Nenhuma alteração encontrada
          </h3>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {hasActiveFilters
              ? 'Tente remover os filtros ou buscar por outro termo.'
              : 'As alterações efetuadas em contas, lançamentos e configurações aparecerão aqui.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="btn-primary mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white"
            >
              <RotateCcw size={14} />
              Restaurar visão completa
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groupedEntries.map(group => (
            <div key={group.dateKey} className="space-y-3">
              {/* Day header sticky tag */}
              <div className="sticky top-2 z-10 flex items-center gap-2">
                <span className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-700 shadow-xs dark:bg-slate-800 dark:text-slate-200">
                  {formatDayHeader(group.dateKey, workspace.space.today)}
                </span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>

              {/* Items in day */}
              <div className="relative space-y-3 pl-4 sm:pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-0.5 before:bg-slate-200 sm:before:left-3 dark:before:bg-slate-800">
                {group.items.map(entry => {
                  const actionMeta = ACTION_MAP[entry.action] ?? {
                    label: entry.action,
                    category: 'edit' as ActionCategory
                  };
                  const entityConfig = ENTITY_CONFIG[entry.entity_type] ?? {
                    label: entry.entity_type,
                    icon: ArrowLeftRight,
                    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400'
                  };
                  const EntityIcon = entityConfig.icon;
                  const resolvedName = resolveEntityName(
                    entry.entity_type,
                    entry.entity_id,
                    workspace,
                    metadata
                  );

                  // Bullet icon and colors
                  let bulletClass = 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400 ring-blue-50';
                  let ActionIcon = Pencil;
                  if (actionMeta.category === 'create') {
                    bulletClass = 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 ring-emerald-50';
                    ActionIcon = Plus;
                  } else if (actionMeta.category === 'delete') {
                    bulletClass = 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 ring-rose-50';
                    ActionIcon = Trash2;
                  } else if (actionMeta.category === 'archive') {
                    bulletClass = 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400 ring-amber-50';
                    ActionIcon = Archive;
                  }

                  const timeStr = new Date(entry.created_at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  const loadedUserId = (workspace as unknown as { loadedForUserId?: string }).loadedForUserId;
                  const isCurrentUser = Boolean(entry.actor_id && loadedUserId && entry.actor_id === loadedUserId);
                  const actorLabel = entry.actor_id
                    ? isCurrentUser
                      ? 'Você'
                      : 'Membro do espaço'
                    : 'Sistema automático';

                  return (
                    <div
                      key={entry.id}
                      className="group relative flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      {/* Timeline node bullet */}
                      <span
                        className={`absolute -left-[23px] top-4 flex h-5 w-5 items-center justify-center rounded-full ring-4 dark:ring-slate-950 sm:-left-[31px] ${bulletClass}`}
                        title={actionMeta.label}
                      >
                        <ActionIcon size={11} strokeWidth={2.5} />
                      </span>

                      {/* Main item body */}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                              {actionMeta.label}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border ${entityConfig.badgeClass}`}
                            >
                              <EntityIcon size={11} />
                              {entityConfig.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={12} />
                              {timeStr}
                            </span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
                              {entry.actor_id ? <UserCheck size={12} /> : <Cpu size={12} />}
                              {actorLabel}
                            </span>
                          </div>
                        </div>

                        {/* Resolved entity title if available */}
                        {resolvedName && (
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Item afetado: <strong className="font-semibold text-slate-900 dark:text-slate-100">{resolvedName}</strong>
                          </p>
                        )}

                        {/* ID reference footnote */}
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                          <span title={`ID: ${entry.entity_id}`}>
                            ID: #{entry.entity_id.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Load More Button */}
          {filteredEntries.length > displayLimit && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setDisplayLimit(prev => prev + 30)}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Carregar mais {Math.min(30, filteredEntries.length - displayLimit)} alterações (restam {filteredEntries.length - displayLimit})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
