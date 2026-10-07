import { cloneElement, Fragment, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type FormEvent } from 'react';
import { ledgerRpc, type LedgerBudget, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';

interface BudgetPlan { id: string; category_name: string; amount_cents: number; effective_from_month: string; effective_until_month: string | null; is_essential_override: boolean | null; version: number }
interface BudgetManagement { budgets: BudgetPlan[]; summary: LedgerBudget[] }
const panel = 'card p-4 sm:p-5', input = 'w-full min-w-0 field-input', secondary = 'text-slate-500 dark:text-slate-400';
const field = (title: string, content: ReactNode, width = 'sm:w-44') => <label key={title} className={`grid w-full min-w-0 gap-1.5 ${width}`}><span className="field-label">{title}</span>{isValidElement(content) ? cloneElement(content as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': title }) : content}</label>;
const decimal = (value: number) => `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;

export default function LedgerBudgets({ workspace, money, onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [month, setMonth] = useState(workspace.space.today.slice(0, 7)), [data, setData] = useState<BudgetManagement | null>(null), [details, setDetails] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null), [action, setAction] = useState('month');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [history, setHistory] = useState(false);
  const pending = useRef(false);
  const canManage = ['owner', 'admin'].includes(workspace.role);
  async function load() { setData(await ledgerRpc<BudgetManagement>('budget_management_summary', { p_space: workspace.space.id, p_month: `${month}-01` })); }
  useEffect(() => { let active = true; setData(null); void ledgerRpc<BudgetManagement>('budget_management_summary', { p_space: workspace.space.id, p_month: `${month}-01` }).then(next => { if (active) setData(next); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [workspace, month]);
  async function mutate(name: string, args: Record<string, unknown>, onSaved?: () => void) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); let saved = false;
    try {
      await ledgerRpc(name, { p_space: workspace.space.id, ...args }); saved = true;
      setEditing(null); onSaved?.(); setNotice(name === 'create_budget' ? 'Orçamento adicionado.' : 'Orçamento atualizado.');
      await load(); await onChanged();
    } catch (failure) { setError(saved ? 'A alteração foi salva. Use Atualizar para recarregar os orçamentos.' : failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const element = event.currentTarget, form = new FormData(element);
    try {
      const amount = parseBrlCents(String(form.get('amount') ?? '').trim());
      if (amount <= 0) throw new Error('O valor deve ser maior que zero.');
      await mutate('create_budget', { p_payload: { category_id: String(form.get('category') ?? '').trim(), amount_cents: amount, effective_from_month: `${String(form.get('month') ?? '').trim()}-01` } }, () => element.reset());
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Confira os campos.'); }
  }
  async function saveAdjustment(event: FormEvent<HTMLFormElement>, budget: BudgetPlan) {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget);
    try {
      await mutate('manage_budget', { p_budget: budget.id, p_version: budget.version, p_action: action, p_month: `${String(form.get('month'))}-01`, p_amount_cents: action === 'end' ? null : parseBrlCents(String(form.get('amount'))), p_essential: form.get('essential') === 'inherit' ? null : form.get('essential') === 'yes' });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
  }
  const budgets = data?.budgets.filter(budget => history || budget.effective_from_month <= `${month}-01` && (!budget.effective_until_month || budget.effective_until_month >= `${month}-01`)) ?? [];
  return <div className="min-w-0 space-y-4">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}{notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {canManage && <form aria-label="Adicionar orçamento" onSubmit={event => void create(event)} className={panel}><fieldset disabled={busy} className="flex min-w-0 flex-wrap items-end gap-3">
      {field('Categoria', <select name="category" required defaultValue="" className={input}><option value="" disabled>Selecione uma categoria ou grupo</option>{workspace.categories.filter(category => category.kind === 'expense').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>, 'sm:w-64')}
      {field('Valor (R$)', <input name="amount" inputMode="decimal" placeholder="0,00" required className={input}/>, 'sm:w-32')}
      {field('A partir do mês', <input name="month" type="month" defaultValue={workspace.space.today.slice(0, 7)} required className={input}/>, 'sm:w-48')}
      <button className="btn-primary w-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50 sm:w-auto">{busy ? 'Salvando…' : 'Adicionar orçamento'}</button>
    </fieldset><p className={`mt-3 text-xs ${secondary}`}>Defina um limite para uma categoria de despesa ou um grupo.</p></form>}
    <section aria-label="Filtros dos orçamentos" className={panel}><div className="flex min-w-0 flex-wrap items-end gap-3">
      {field('Mês dos orçamentos', <input type="month" value={month} disabled={busy} onChange={event => { if (event.target.value) { setMonth(event.target.value); setEditing(null); setDetails(null); setError(''); } }} required className={input}/>, 'sm:w-48')}
      <label className="flex min-w-0 items-center gap-2 py-2.5 text-sm"><input type="checkbox" checked={history} disabled={busy} onChange={event => setHistory(event.target.checked)}/>Mostrar todos os planos, incluindo encerrados</label>
    </div></section>
    <div className="table-shell"><table aria-label="Orçamentos" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide"><tr><th scope="col" className="w-[42%] px-3 py-2.5 sm:w-[20%] sm:px-4">Categoria</th><th scope="col" className="hidden w-[16%] px-4 py-2.5 text-right sm:table-cell">Limite</th><th scope="col" className="hidden w-[16%] px-4 py-2.5 text-right sm:table-cell">Gasto</th><th scope="col" className="hidden w-[16%] px-4 py-2.5 text-right sm:table-cell">Previsto</th><th scope="col" className="w-[32%] px-2 py-2.5 text-right sm:w-[16%] sm:px-4">Restante</th><th scope="col" className="w-[26%] px-2 py-2.5 sm:w-[16%] sm:px-4"><span className="sr-only">Ações</span></th></tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{budgets.map(budget => { const summary = data?.summary.find(item => item.id === budget.id); return <Fragment key={`${budget.id}-${budget.version}`}>
        <tr className="table-row-hover"><td className="px-3 py-2.5 [overflow-wrap:anywhere] sm:px-4"><span className="font-medium">{budget.category_name ?? 'Fluxo mensal'}</span><p className={`mt-1 text-xs ${secondary}`}>Desde {budget.effective_from_month.slice(0, 7)}{budget.effective_until_month ? ` até ${budget.effective_until_month.slice(0, 7)}` : ' · Em andamento'}</p><div className={`mt-2 space-y-1 text-xs ${secondary} sm:hidden`}><p>Limite: {money(summary?.amount_cents ?? budget.amount_cents)}</p>{summary && <><p>Gasto: {money(summary.consumed_cents)}</p><p>Previsto: {money(summary.predicted_cents)}</p></>}</div></td><td className="hidden px-4 py-2.5 text-right [overflow-wrap:anywhere] sm:table-cell">{money(summary?.amount_cents ?? budget.amount_cents)}</td><td className={`hidden px-4 py-2.5 text-right ${secondary} [overflow-wrap:anywhere] sm:table-cell`}>{summary ? money(summary.consumed_cents) : '—'}</td><td className={`hidden px-4 py-2.5 text-right ${secondary} [overflow-wrap:anywhere] sm:table-cell`}>{summary ? money(summary.predicted_cents) : '—'}</td><td className="px-2 py-2.5 text-right font-semibold [overflow-wrap:anywhere] sm:px-4">{summary ? money(summary.remaining_cents) : <span className={`text-xs font-normal ${secondary}`}>Sem resumo neste mês</span>}</td><td className="px-2 py-2.5 text-right sm:px-4"><button type="button" disabled={busy} aria-label={`Detalhes do orçamento ${budget.category_name ?? 'Fluxo mensal'}`} aria-expanded={details === budget.id} onClick={() => { setDetails(details === budget.id ? null : budget.id); setEditing(null); setError(''); }} className="text-xs font-semibold text-brand-700 dark:text-brand-400">{details === budget.id ? 'Fechar' : 'Detalhes'}</button></td></tr>
        {details === budget.id && <tr><td colSpan={6} className="p-3 sm:p-4"><section aria-label={`Detalhes do orçamento ${budget.category_name ?? 'Fluxo mensal'}`} className={`${panel} min-w-0 space-y-4 [overflow-wrap:anywhere]`}><div><h2 className="font-semibold">{budget.category_name ?? 'Fluxo mensal'}</h2><p className={`mt-1 text-xs ${secondary}`}>Desde {budget.effective_from_month.slice(0, 7)}{budget.effective_until_month ? ` até ${budget.effective_until_month.slice(0, 7)}` : ' · Em andamento'}</p><p className={`mt-2 text-sm ${secondary}`}>Limite: {money(summary?.amount_cents ?? budget.amount_cents)}{summary ? ` · Gasto: ${money(summary.consumed_cents)} · Previsto: ${money(summary.predicted_cents)} · Restante: ${money(summary.remaining_cents)}` : ''}</p></div>
          {canManage && <button disabled={busy} onClick={() => { setEditing(editing === budget.id ? null : budget.id); setAction('month'); setError(''); }} className="text-sm font-semibold text-brand-700 dark:text-brand-300">Ajustar ou encerrar orçamento</button>}
          {canManage && editing === budget.id && <form aria-label={`Ajustar orçamento ${budget.category_name ?? 'Fluxo mensal'}`} onSubmit={event => void saveAdjustment(event, budget)}><fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field('Como aplicar o ajuste', <select value={action} onChange={event => setAction(event.target.value)} className={input}><option value="month">Apenas um mês</option><option value="following">Este mês e os seguintes</option><option value="end">Encerrar após o mês escolhido</option></select>, '')}
            {field('Mês do ajuste', <input name="month" type="month" defaultValue={month < budget.effective_from_month.slice(0, 7) ? budget.effective_from_month.slice(0, 7) : month} min={budget.effective_from_month.slice(0, 7)} max={budget.effective_until_month?.slice(0, 7)} required className={input}/>, '')}
            {action !== 'end' && field('Novo limite (R$)', <input name="amount" inputMode="decimal" defaultValue={decimal(summary?.amount_cents ?? budget.amount_cents)} required className={input}/>, '')}
            {action === 'following' && field('Essencial neste plano', <select name="essential" defaultValue={budget.is_essential_override === null ? 'inherit' : budget.is_essential_override ? 'yes' : 'no'} className={input}><option value="inherit">Seguir a categoria</option><option value="yes">Sim</option><option value="no">Não</option></select>, '')}
            <p className={`text-xs ${secondary} sm:col-span-2`}>O ajuste contínuo preserva os meses anteriores. Ajustes específicos de um mês continuam valendo até você substituí-los. Meses fechados afetados precisam ser reabertos.</p>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button className="btn-primary px-4 py-2.5 text-sm font-semibold">{busy ? 'Salvando…' : 'Salvar ajuste do orçamento'}</button><button type="button" onClick={() => setEditing(null)} className={`text-sm ${secondary}`}>Cancelar</button></div>
          </fieldset></form>}
        </section></td></tr>}
      </Fragment>; })}{!budgets.length && <tr><td colSpan={6} className={`px-4 py-6 text-center ${secondary}`}>{!data ? error ? 'Não foi possível carregar os orçamentos. Use Atualizar para tentar novamente.' : 'Carregando orçamentos…' : 'Nenhum orçamento para este período.'}</td></tr>}</tbody>
    </table></div>
  </div>;
}
