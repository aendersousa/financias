import { useEffect, useRef, useState } from 'react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';

interface Notification {
  id: string; type: string; severity: 'urgent' | 'attention' | 'informational'; source_type: string; source_id: string;
  title: string; payload: Record<string, unknown>; read_at: string | null; archived_at: string | null;
  resolved_at: string | null; version: number; created_at: string;
}
interface Inbox { notifications: Notification[]; unread_count: number }
type Destination = 'agenda' | 'cards' | 'budgets' | 'reserves' | 'dashboard' | 'accounts' | 'transactions' | 'imports' | 'sharing' | 'reports' | 'foreign_currency';
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const severity = { urgent:'Urgente',attention:'Atenção',informational:'Informativo' };
const destinations: Record<string, { section: Destination; label: string }> = {
  commitment:{ section:'agenda',label:'Ver na Agenda' },card_statement:{ section:'cards',label:'Ver cartões' },
  budget:{ section:'budgets',label:'Ver orçamento' },reserve:{ section:'reserves',label:'Ver meta' },
  financial_account:{ section:'reserves',label:'Ver reservas' },financial_space:{ section:'reserves',label:'Ver reservas' },
  account_balance_check:{ section:'accounts',label:'Conferir conta' },space_member:{ section:'sharing',label:'Ver membros' },
  free_to_spend:{ section:'dashboard',label:'Ver Livre para gastar' },ledger_transaction:{ section:'transactions',label:'Conferir lançamento' },
  import_batch:{ section:'imports',label:'Revisar extrato' },category:{ section:'reports',label:'Comparar consumo' }
};
const destinationLabels: Record<Destination,string> = { agenda:'Ver na Agenda',cards:'Ver cartões',budgets:'Ver orçamento',reserves:'Ver metas e provisões',dashboard:'Ver Livre para gastar',accounts:'Conferir conta',transactions:'Conferir lançamento',imports:'Revisar extrato',sharing:'Ver membros',reports:'Comparar consumo',foreign_currency:'Confirmar conversões' };
export default function LedgerNotifications({ workspace,money,onNavigate }: { workspace: LedgerWorkspace; money: (value: number) => string; onNavigate: (section: Destination) => void }) {
  const [inbox,setInbox] = useState<Inbox | null>(null);
  const [filter,setFilter] = useState('unread');
  const [busy,setBusy] = useState(false),[error,setError] = useState('');
  const pending = useRef(false);
  async function load() { setInbox(await ledgerRpc<Inbox>('daily_alerts',{ p_space:workspace.space.id })); }
  async function run(task: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await task(); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar as notificações.'); }
    finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => { void run(async () => undefined); },[workspace.space.id]);
  const unread = inbox?.notifications.filter(item => !item.read_at && !item.archived_at && !item.resolved_at) ?? [];
  const visible = inbox?.notifications.filter(item => filter === 'archived' ? Boolean(item.archived_at) : !item.archived_at && (filter === 'all' || filter === 'read' ? filter === 'all' || Boolean(item.read_at) || Boolean(item.resolved_at) : !item.read_at && !item.resolved_at)) ?? [];
  function mark(item: Notification,action: string) { return run(() => ledgerRpc('manage_notification',{ p_space:workspace.space.id,p_notification:item.id,p_version:item.version,p_action:action })); }
  function moneyLine(item: Notification,key: string,label: string) {
    const value = item.payload[key];
    return typeof value === 'number' && Number.isSafeInteger(value) ? <p key={key} className="text-sm text-slate-600 dark:text-slate-400">{label}: {money(value)}</p> : null;
  }
  function destination(item: Notification) {
    const target = item.payload.destination;
    if (typeof target === 'string' && target in destinationLabels) return { section:target as Destination,label:destinationLabels[target as Destination] };
    return destinations[item.source_type];
  }
  return <div className="space-y-5">
    <section className={`${panel} space-y-4`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Central de notificações</h2><p className="mt-1 text-sm text-slate-500">{inbox ? `${inbox.unread_count} ${inbox.unread_count === 1 ? 'notificação não lida' : 'notificações não lidas'}` : 'Carregando notificações…'}</p></div><button disabled={busy} onClick={() => void run(async () => undefined)} className="text-sm font-semibold text-teal-700 disabled:opacity-50 dark:text-teal-300">Atualizar notificações</button></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="grid gap-1"><label htmlFor="notification-filter" className="text-sm font-medium">Mostrar notificações</label><select id="notification-filter" value={filter} onChange={event => setFilter(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="unread">Não lidas</option><option value="all">Todas</option><option value="read">Lidas e resolvidas</option><option value="archived">Arquivadas</option></select></div><button disabled={busy || unread.length === 0} onClick={() => void run(() => ledgerRpc('read_notifications',{ p_space:workspace.space.id,p_versions:unread.map(item => ({ id:item.id,version:item.version })) }))} className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Marcar todas como lidas</button></div>
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {inbox && visible.length === 0 && <p className={`${panel} text-sm text-slate-500`}>Nenhuma notificação nesta lista. Use Todas para consultar o histórico.</p>}
    {visible.map(item => <article key={item.id} className={`${panel} space-y-3`} aria-label={item.title}>
      <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="font-semibold">{item.title}</h2><div className="flex gap-2 text-xs"><span className={item.severity === 'urgent' && !item.resolved_at ? 'text-red-700 dark:text-red-300' : 'text-slate-500'}>{severity[item.severity]}</span><span>{item.resolved_at ? 'Resolvida' : item.read_at ? 'Lida' : 'Não lida'}{item.archived_at ? ' · Arquivada' : ''}</span></div></div>
      <div className="space-y-1">{moneyLine(item,'remaining_cents','Falta pagar')}{moneyLine(item,'consumed_cents','Consumo no mês')}{moneyLine(item,'amount_cents',item.type === 'budget_threshold' ? 'Limite do orçamento' : 'Valor da fatura')}{moneyLine(item,'balance_cents','Saldo da meta')}{moneyLine(item,'target_cents','Valor-alvo')}{moneyLine(item,'uncovered_cents','Saldo sem cobertura')}{moneyLine(item,'value_cents','Livre conservador')}{moneyLine(item,'difference_cents','Diferença para o extrato')}{moneyLine(item,'shortfall_cents','Aporte pendente')}{moneyLine(item,'previous_cents','Consumo no mês anterior')}
        {typeof item.payload.due_on === 'string' && <p className="text-sm text-slate-500">Vencimento: {item.payload.due_on}</p>}{typeof item.payload.closing_on === 'string' && <p className="text-sm text-slate-500">Fechamento: {item.payload.closing_on}</p>}{typeof item.payload.month === 'string' && <p className="text-sm text-slate-500">Mês: {item.payload.month.slice(0,7)}</p>}{Array.isArray(item.payload.reserves) && <p className="text-sm text-slate-500">Reservas afetadas: {item.payload.reserves.filter(value => typeof value === 'string').join(', ')}</p>}
      </div>
      {item.type === 'reserve_uncovered' && <p className="text-sm text-slate-500">Reponha o saldo da conta ou libere parte das reservas para ajustar seus planos.</p>}
      {item.type === 'card_charges' && <p className="text-sm text-slate-500">Confira juros, multas e IOF cobrados pelo banco antes de confirmar os encargos.</p>}
      {item.type === 'statement_closes_today' && typeof item.payload.purchases_go_next === 'boolean' && <p className="text-sm text-slate-500">{item.payload.purchases_go_next ? 'As compras de hoje entram na próxima fatura.' : 'As compras de hoje ainda entram na fatura que está fechando.'}</p>}
      <div className="flex flex-wrap gap-4 text-sm font-semibold text-teal-700 dark:text-teal-300">{destination(item) && <button disabled={busy} onClick={() => onNavigate(destination(item).section)}>{destination(item).label}</button>}{item.type === 'main_income_confirm' && workspace.role !== 'viewer' && <><button disabled={busy} onClick={() => onNavigate('agenda')}>Sim / registrar outro valor</button><button disabled={busy} onClick={() => void run(() => ledgerRpc('defer_income_notification',{ p_space:workspace.space.id,p_commitment:item.source_id }))}>Ainda n?o, lembrar amanh?</button></>}<button disabled={busy} onClick={() => void mark(item,item.read_at ? 'unread' : 'read')}>{item.read_at ? 'Marcar como não lida' : 'Marcar como lida'}</button><button disabled={busy} onClick={() => void mark(item,item.archived_at ? 'restore' : 'archive')}>{item.archived_at ? 'Restaurar notificação' : 'Arquivar notificação'}</button></div>
    </article>)}
  </div>;
}
