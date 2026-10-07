import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseBrlCents } from '../../../shared/finance/money';
import { ledgerRpc, type LedgerWorkspace, type WorkspaceMetadata } from '../lib/ledgerRepository';
import RecurrenceTable, { recurrenceFrequency, type RecurrenceRule } from '../components/RecurrenceTable';

const panel = 'card min-w-0 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'field-input w-full min-w-0';
const primary = 'btn-primary disabled:opacity-50';
const secondary = 'text-sm font-semibold text-brand-700 dark:text-brand-400 disabled:opacity-50';
const date = (value: string) => value.split('-').reverse().join('/');

function RecurrenceForm({ workspace, rule, busy, onSave, onCancel }: {
  workspace: LedgerWorkspace;
  rule?: RecurrenceRule;
  busy: boolean;
  onSave: (event: FormEvent<HTMLFormElement>, direction: string, unit: string, rule?: RecurrenceRule) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [direction, setDirection] = useState<string>(rule?.direction ?? 'outflow');
  const [unit, setUnit] = useState<string>(rule?.unit ?? 'month');
  const prefix = rule ? `recurrence-edit-${rule.id}` : 'recurrence';
  const field = 'flex w-full min-w-0 flex-col gap-1 sm:w-40';
  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (await onSave(event, direction, unit, rule) && !rule) { form.reset(); setDirection('outflow'); setUnit('month'); }
  }
  return <form aria-label={rule ? `Editar recorrência ${rule.title}` : 'Adicionar recorrência'} onSubmit={event => void submit(event)} className={rule ? 'min-w-0 space-y-4' : `${panel} space-y-4`}>
    <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-end gap-3">
      {!rule && <>
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-56"><label htmlFor={`${prefix}-name`} className="field-label">Descrição</label><input id={`${prefix}-name`} name="name" maxLength={100} required placeholder="Ex: Assinatura de internet" className={input}/></div>
        <div className={field}><label htmlFor={`${prefix}-direction`} className="field-label">Direção</label><select id={`${prefix}-direction`} aria-label="Direção" value={direction} onChange={event => setDirection(event.target.value)} className={input}><option value="outflow">A pagar</option><option value="inflow">A receber</option></select></div>
      </>}
      <div className={field}><label htmlFor={`${prefix}-unit`} className="field-label">Frequência</label><select id={`${prefix}-unit`} aria-label="Frequência" value={unit} disabled={!!rule} onChange={event => setUnit(event.target.value)} className={input}><option value="month">Mensal</option><option value="week">Semanal</option><option value="year">Anual</option></select></div>
      <div className={field}><label htmlFor={`${prefix}-date`} className="field-label">{rule ? 'A partir de' : 'Primeiro vencimento'}</label><input id={`${prefix}-date`} type="date" name="date" defaultValue={workspace.space.today} required className={input}/></div>
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-36"><label htmlFor={`${prefix}-amount`} className="field-label">Valor (R$)</label><input id={`${prefix}-amount`} name="amount" inputMode="decimal" required defaultValue={rule ? `${Math.floor(rule.current_version.amount_cents/100)},${String(rule.current_version.amount_cents%100).padStart(2,'0')}` : undefined} placeholder="0,00" className={input}/></div>
      <div className={field}><label htmlFor={`${prefix}-certainty`} className="field-label">Certeza</label><select id={`${prefix}-certainty`} aria-label="Certeza" name="certainty" defaultValue={rule?.current_version.certainty ?? 'confirmed'} className={input}><option value="confirmed">Confirmado</option><option value="estimated">Estimado</option>{direction === 'inflow' && <option value="conditional">Condicional</option>}</select></div>
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-48"><label htmlFor={`${prefix}-category`} className="field-label">Categoria</label><select id={`${prefix}-category`} aria-label="Categoria" name="category" required defaultValue={rule?.current_version.category_id ?? ''} className={input}><option value="">Selecione</option>{workspace.categories.filter(c => c.ledger_account_id && c.kind === (direction === 'inflow' ? 'income' : 'expense')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-48"><label htmlFor={`${prefix}-account`} className="field-label">Conta</label><select id={`${prefix}-account`} aria-label="Conta" name="account" required defaultValue={rule?.current_version.payment_financial_account_id ?? ''} className={input}><option value="">Selecione</option>{workspace.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      {rule && <div className="flex w-full min-w-0 flex-col gap-1 sm:w-56"><label htmlFor={`${prefix}-scope`} className="field-label">Aplicar alteração</label><select id={`${prefix}-scope`} aria-label="Aplicar alteração" name="scope" className={input}><option value="this_and_following">Esta e as próximas</option><option value="entire_series">Toda a série em aberto</option></select></div>}
      <button disabled={busy} className={primary}>{busy ? 'Salvando…' : rule ? 'Salvar recorrência' : 'Adicionar recorrência'}</button>
      {rule && <button type="button" onClick={onCancel} className={secondary}>Cancelar edição</button>}
      {!rule && <div className="flex w-full flex-wrap gap-x-5 gap-y-2 pt-1 text-sm"><label className="inline-flex items-center gap-2"><input type="checkbox" name="main_income" disabled={direction !== 'inflow'}/>Esta é minha renda principal</label><label className="inline-flex items-center gap-2"><input type="checkbox" name="subscription"/>É uma assinatura</label></div>}
    </fieldset>
  </form>;
}

export default function LedgerRecurrences({ workspace, money, onChanged }: {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  onChanged: () => Promise<void>;
}) {
  const [metadata, setMetadata] = useState<WorkspaceMetadata | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [expandedRule, setExpandedRule] = useState<string | null>(null), [editingRule, setEditingRule] = useState<string | null>(null);
  const pending = useRef(false);
  const canWrite = workspace.role !== 'viewer';
  async function load() { setMetadata(await ledgerRpc<WorkspaceMetadata>('workspace_metadata', { p_space: workspace.space.id })); }
  useEffect(() => {
    let active = true; setMetadata(null); setExpandedRule(null); setEditingRule(null); setError(''); setNotice('');
    void ledgerRpc<WorkspaceMetadata>('workspace_metadata', { p_space: workspace.space.id }).then(data => { if (active) setMetadata(data); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as recorrências.'); });
    return () => { active = false; };
  }, [workspace.space.id]);
  async function run(name: string, args: Record<string, unknown>) {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await ledgerRpc(name, { p_space: workspace.space.id, ...args });
      await load(); await onChanged(); setNotice('Alterações salvas.');
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); return false; }
    finally { pending.current = false; setBusy(false); }
  }
  async function saveRecurrence(event: FormEvent<HTMLFormElement>, direction: string, unit: string, rule?: RecurrenceRule) {
    event.preventDefault(); const data = new FormData(event.currentTarget), text = (key: string) => String(data.get(key) ?? '');
    try {
      const amount = parseBrlCents(text('amount'));
      if (amount <= 0) throw new Error('Informe um valor maior que zero.');
      const [year, month, day] = text('date').split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() || 7;
      const payload = { title: text('name'), direction, unit, amount_cents: amount, starts_on: text('date'), category_id: text('category'), payment_method: 'account', payment_financial_account_id: text('account'),
        certainty: text('certainty'), day_of_month: unit === 'week' ? null : day, month_of_year: unit === 'year' ? month : null, weekday: unit === 'week' ? weekday : null,
        is_main_income: direction === 'inflow' && data.get('main_income') === 'on', is_subscription: data.get('subscription') === 'on' };
      const saved = rule ? await run('change_recurrence_rule', { p_rule: rule.id, p_version: rule.version, p_from_period: text('date'), p_scope: text('scope'), p_changes: { amount_cents: amount, category_id: text('category'), payment_financial_account_id: text('account'), certainty: text('certainty'), day_of_month: payload.day_of_month, weekday: payload.weekday, month_of_year: payload.month_of_year } }) : await run('create_recurrence_rule', { p_payload: payload });
      if (saved && rule) setEditingRule(null);
      return saved;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verifique os campos.'); return false; }
  }
  return <div className="min-w-0 space-y-6">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {canWrite && <RecurrenceForm key={workspace.space.id} workspace={workspace} busy={busy || !metadata} onSave={saveRecurrence}/>}
    {!metadata && !error && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando recorrências…</p>}
    {metadata && <RecurrenceTable rules={metadata.recurrences} money={money}
      renderActions={rule => <button type="button" disabled={busy} onClick={() => { setExpandedRule(expandedRule === rule.id ? null : rule.id); setEditingRule(null); }} aria-label={`Ver detalhes de ${rule.title}`} aria-expanded={expandedRule === rule.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400 disabled:opacity-50">Detalhes</button>}
      renderEditor={rule => expandedRule === rule.id ? <section aria-label={`Detalhes da recorrência ${rule.title}`} className={`${panel} space-y-4`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><h2 className="font-semibold">{rule.title}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rule.direction === 'inflow' ? 'A receber' : 'A pagar'} · {recurrenceFrequency(rule.unit)}</p></div><button type="button" disabled={busy} onClick={() => { setExpandedRule(null); setEditingRule(null); }} className="text-sm text-slate-500 dark:text-slate-400">Fechar</button></div>
        <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="field-label">Primeiro vencimento</dt><dd className="mt-1">{date(rule.starts_on)}</dd></div>
          <div><dt className="field-label">Categoria</dt><dd className="mt-1 [overflow-wrap:anywhere]">{workspace.categories.find(item => item.id === rule.current_version.category_id)?.name ?? 'Sem categoria'}</dd></div>
          <div><dt className="field-label">Conta</dt><dd className="mt-1 [overflow-wrap:anywhere]">{workspace.accounts.find(item => item.id === rule.current_version.payment_financial_account_id)?.name ?? 'Sem conta'}</dd></div>
          <div><dt className="field-label">Certeza</dt><dd className="mt-1">{({ confirmed: 'Confirmado', estimated: 'Estimado', conditional: 'Condicional' } as Record<string, string>)[rule.current_version.certainty] ?? rule.current_version.certainty}</dd></div>
          <div><dt className="field-label">Situação</dt><dd className="mt-1">{rule.ends_on ? `Encerrada em ${date(rule.ends_on)}` : 'Ativa'}</dd></div>
          <div><dt className="field-label">Valor</dt><dd className="mt-1">{money(rule.current_version.amount_cents)}</dd></div>
          {rule.is_main_income && <div><dt className="field-label">Renda principal</dt><dd className="mt-1">Sim</dd></div>}
          {rule.is_subscription && <div><dt className="field-label">Assinatura</dt><dd className="mt-1">Sim</dd></div>}
        </dl>
        {canWrite && !rule.ends_on && (editingRule === rule.id ? <div className="border-t border-slate-200 pt-4 dark:border-slate-800"><RecurrenceForm key={`${rule.id}-${rule.version}`} workspace={workspace} rule={rule} busy={busy} onSave={saveRecurrence} onCancel={() => setEditingRule(null)}/></div> : <div className="flex flex-wrap gap-4 border-t border-slate-200 pt-4 dark:border-slate-800"><button type="button" disabled={busy} onClick={() => setEditingRule(rule.id)} className={secondary}>Editar série</button><button type="button" disabled={busy} onClick={() => void run('end_recurrence_rule', { p_rule: rule.id, p_version: rule.version, p_ends_on: workspace.space.today })} className="text-sm font-semibold text-red-600 dark:text-red-400 disabled:opacity-50">Encerrar hoje</button></div>)}
      </section> : null}/>}
  </div>;
}
