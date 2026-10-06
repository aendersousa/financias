import { useEffect, useState, type FormEvent } from 'react';
import { ledgerRpc, type LedgerWorkspace, type UserSettings, type WorkspaceMetadata } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import { useAppStore } from '../store/useAppStore';

export type ExtraSection = 'tags' | 'recurrences' | 'settings' | 'audit';
interface PlanningSettings { minimum_safety_reserve_cents: number; fallback_cycle_day: number; version: number; categories: { id: string; name: string; version: number; benefit_financial_account_id: string | null }[] }
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950';
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
export default function LedgerExtras({ section, workspace, money, onChanged }: { section: ExtraSection; workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [metadata,setMetadata] = useState<WorkspaceMetadata | null>(null);
  const [settings,setSettings] = useState<UserSettings | null>(null);
  const [planning,setPlanning] = useState<PlanningSettings | null>(null),[benefitCategory,setBenefitCategory] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [transaction,setTransaction] = useState('');
  const [selectedTags,setSelectedTags] = useState<string[]>([]);
  const [editingRule,setEditingRule] = useState<string | null>(null);
  const [direction,setDirection] = useState('outflow');
  const [unit,setUnit] = useState('month');
  const canWrite = workspace.role !== 'viewer';
  async function load() {
    const [m,s,p] = await Promise.all([ledgerRpc<WorkspaceMetadata>('workspace_metadata',{ p_space:workspace.space.id }),ledgerRpc<UserSettings>('get_user_settings',{}),section === 'settings' ? ledgerRpc<PlanningSettings>('planning_settings',{ p_space:workspace.space.id }) : Promise.resolve(null)]);
    setMetadata(m); setSettings(s); setPlanning(p);
  }
  useEffect(() => { let active = true; void load().catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; },[workspace.space.id]);
  useEffect(() => {
    setSelectedTags(metadata?.transaction_tags.filter(t => t.ledger_transaction_id === transaction).map(t => t.tag_id) ?? []);
  },[transaction,metadata]);
  async function run(name: string,args: Record<string,unknown>,global = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      await ledgerRpc(name,global ? args : { p_space:workspace.space.id,...args });
      await load(); await onChanged(); setNotice('Alterações salvas.');
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); return false; }
    finally { setBusy(false); }
  }
  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    if (await run('create_tag',{ p_name:String(new FormData(form).get('name')) })) form.reset();
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!settings) return;
    const data = new FormData(event.currentTarget),theme = String(data.get('theme'));
    const changes = { theme,privacy_mode:data.get('privacy') === 'on',notification_preferences:{ ...settings.notification_preferences,...Object.fromEntries(['agenda','cards','budgets','goals','reserves'].map(category => [category,data.get(`notify_${category}`) === 'on'])) } };
    if (await run('update_user_settings',{ p_version:settings.version,p_changes:changes },true)) {
      useAppStore.getState().setTheme(theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme as 'dark' | 'light');
    }
  }
  async function savePlanning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!planning) return;
    try { const data=new FormData(event.currentTarget); await run('update_planning_settings',{ p_version:planning.version,p_safety_cents:parseBrlCents(String(data.get('safety'))),p_cycle_day:Number(data.get('cycle')) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Verifique a reserva mínima.'); }
  }
  async function saveRecurrence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget),text = (key: string) => String(data.get(key) ?? '');
    try {
      const amount = parseBrlCents(text('amount'));
      if (amount <= 0) throw new Error('Informe um valor maior que zero.');
      const [year,month,day] = text('date').split('-').map(Number);
      const weekday = new Date(Date.UTC(year,month-1,day,12)).getUTCDay() || 7;
      const payload = { title:text('name'),direction,unit,amount_cents:amount,starts_on:text('date'),category_id:text('category'),payment_method:'account',payment_financial_account_id:text('account'),
        certainty:text('certainty'),day_of_month:unit === 'week' ? null : day,month_of_year:unit === 'year' ? month : null,weekday:unit === 'week' ? weekday : null,
        is_main_income:direction === 'inflow' && data.get('main_income') === 'on',is_subscription:data.get('subscription') === 'on' };
      const rule = metadata?.recurrences.find(r => r.id === editingRule);
      const saved = rule ? await run('change_recurrence_rule',{ p_rule:rule.id,p_version:rule.version,p_from_period:text('date'),p_scope:text('scope'),p_changes:{ amount_cents:amount,category_id:text('category'),payment_financial_account_id:text('account'),certainty:text('certainty'),day_of_month:payload.day_of_month,weekday:payload.weekday,month_of_year:payload.month_of_year } }) : await run('create_recurrence_rule',{ p_payload:payload });
      if (saved) setEditingRule(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verifique os campos.'); }
  }
  const rule = metadata?.recurrences.find(r => r.id === editingRule);
  const label = (name: string,id: string) => <label htmlFor={id} className="text-sm font-medium">{name}</label>;
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
    {!metadata && <p>Carregando…</p>}
    {section === 'settings' && settings && <form onSubmit={saveSettings} key={settings.version} className={`${panel} grid max-w-xl gap-4`}>
      <h2 className="font-semibold">Preferências da sua conta</h2>
      {label('Aparência','settings-theme')}<select id="settings-theme" name="theme" defaultValue={settings.theme} className={input}><option value="system">Acompanhar o aparelho</option><option value="light">Claro</option><option value="dark">Escuro</option></select>
      <label className="flex items-center gap-3"><input name="privacy" type="checkbox" defaultChecked={settings.privacy_mode}/>Começar com os valores ocultos</label>
      <p className="text-sm text-slate-500">A preferência de privacidade será aplicada no próximo acesso. Você pode mostrar ou ocultar os valores a qualquer momento no cabeçalho.</p>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">Avisos na Central de notificações</legend>{[{ id:'agenda',label:'Agenda e vencimentos' },{ id:'cards',label:'Cartões e faturas' },{ id:'budgets',label:'Orçamentos' },{ id:'goals',label:'Progresso das metas' },{ id:'reserves',label:'Cobertura das reservas' }].map(category => <label key={category.id} className="flex items-center gap-2 text-sm"><input name={`notify_${category.id}`} type="checkbox" defaultChecked={settings.notification_preferences[category.id] ?? workspace.role !== 'viewer'}/>{category.label}</label>)}<p className="text-xs text-slate-500">Avisos urgentes permanecem na Central para os responsáveis pelo espaço.</p></fieldset>
      <button disabled={busy} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white">Salvar preferências</button>
    </form>}
    {section === 'settings' && planning && <>
      <form key={`planning-${planning.version}`} onSubmit={savePlanning} className={`${panel} grid max-w-xl gap-4`}><h2 className="font-semibold">Ciclo e reserva de segurança</h2><p className="text-sm text-slate-500">A reserva mínima protege uma parte do dinheiro em conta. Sem renda principal, o ciclo começa no dia escolhido.</p>{label('Reserva mínima de segurança (R$)','planning-safety')}<input id="planning-safety" name="safety" inputMode="decimal" required defaultValue={`${Math.floor(planning.minimum_safety_reserve_cents/100)},${String(planning.minimum_safety_reserve_cents%100).padStart(2,'0')}`} disabled={!['owner','admin'].includes(workspace.role)} className={input}/>{label('Dia de início do ciclo padrão','planning-cycle')}<input id="planning-cycle" name="cycle" type="number" min={1} max={31} required defaultValue={planning.fallback_cycle_day} disabled={!['owner','admin'].includes(workspace.role)} className={input}/>{['owner','admin'].includes(workspace.role) && <button disabled={busy} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white">Salvar planejamento</button>}</form>
      <form onSubmit={event => { event.preventDefault(); const category=planning.categories.find(c => c.id === benefitCategory); if (category) void run('set_category_benefit',{ p_category:category.id,p_version:category.version,p_benefit:String(new FormData(event.currentTarget).get('benefit')) || null }); }} className={`${panel} grid max-w-xl gap-4`}><h2 className="font-semibold">O que seu benefício paga</h2><p className="text-sm text-slate-500">Vincule o VR/VA à categoria de despesas coberta por ele. O vínculo também se aplica às categorias dentro dela.</p>{label('Categoria coberta pelo benefício','benefit-category')}<select id="benefit-category" value={benefitCategory} onChange={event => setBenefitCategory(event.target.value)} required className={input}><option value="">Selecione</option>{planning.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{label('Conta de benefício','benefit-account')}<select id="benefit-account" name="benefit" key={benefitCategory} defaultValue={planning.categories.find(c => c.id === benefitCategory)?.benefit_financial_account_id ?? ''} disabled={!canWrite} className={input}><option value="">Sem vínculo</option>{workspace.accounts.filter(account => account.liquidity === 'benefit').map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{canWrite && <button disabled={busy || !benefitCategory} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white">Salvar vínculo do benefício</button>}</form>
    </>}
    {section === 'tags' && metadata && <>
      {canWrite && <form onSubmit={submitTag} className={`${panel} flex flex-wrap items-end gap-3`}><div className="grid flex-1 gap-2">{label('Nome da tag','tag-name')}<input id="tag-name" name="name" maxLength={100} required className={input}/></div><button disabled={busy} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white">Criar tag</button></form>}
      <div className={`${panel} space-y-4`}>{metadata.tags.length === 0 && <p className="text-sm text-slate-500">Nenhuma tag cadastrada.</p>}{metadata.tags.map(tag => <form key={`${tag.id}-${tag.version}`} onSubmit={event => { event.preventDefault(); void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:'rename',p_name:String(new FormData(event.currentTarget).get('name')) }); }} className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-4 last:border-0 dark:border-slate-800">
        <input name="name" aria-label={`Nome da tag ${tag.name}`} defaultValue={tag.name} disabled={!canWrite} maxLength={100} required className={`${input} max-w-xs`}/><span className="text-xs text-slate-500">{tag.archived_at ? 'Arquivada' : 'Ativa'}</span>
        {canWrite && <><button disabled={busy} className="text-sm text-teal-600">Renomear</button><button type="button" disabled={busy} onClick={() => void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:tag.archived_at ? 'restore' : 'archive' })} className="text-sm">{tag.archived_at ? 'Restaurar' : 'Arquivar'}</button><button type="button" disabled={busy} onClick={() => void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:'delete' })} className="text-sm text-red-600">Excluir</button>
          <select aria-label={`Mesclar ${tag.name} em outra tag`} defaultValue="" className={`${input} max-w-xs`} disabled={busy} onChange={event => { if (event.target.value) void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:'merge',p_destination:event.target.value }); }}><option value="">Mesclar em…</option>{metadata.tags.filter(t => t.id !== tag.id && !t.archived_at).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></>}
      </form>)}</div>
      {canWrite && <div className={`${panel} space-y-4`}><h2 className="font-semibold">Marcar um lançamento</h2>{label('Lançamento','tag-transaction')}<select id="tag-transaction" value={transaction} onChange={event => setTransaction(event.target.value)} className={input}><option value="">Selecione</option>{workspace.transactions.map(t => <option key={t.id} value={t.id}>{t.occurred_on} · {t.description}</option>)}</select>
        {transaction && <><div className="flex flex-wrap gap-4">{metadata.tags.filter(t => !t.archived_at || selectedTags.includes(t.id)).map(tag => <label key={tag.id} className="flex gap-2"><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={event => setSelectedTags(event.target.checked ? [...selectedTags,tag.id] : selectedTags.filter(id => id !== tag.id))}/>{tag.name}</label>)}</div><button disabled={busy} onClick={() => void run('set_transaction_tags',{ p_transaction:transaction,p_tags:selectedTags,p_expected_tags:metadata.transaction_tags.filter(t => t.ledger_transaction_id === transaction).map(t => t.tag_id) })} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white">Salvar tags do lançamento</button></>}
      </div>}
    </>}
    {section === 'recurrences' && metadata && <>
      {canWrite && <form onSubmit={saveRecurrence} key={editingRule ?? 'new'} className={`${panel} grid gap-4 sm:grid-cols-2`}>
        <h2 className="font-semibold sm:col-span-2">{rule ? `Editar: ${rule.title}` : 'Nova recorrência'}</h2>
        {!rule && <><div className="grid gap-2">{label('Descrição','recurrence-name')}<input id="recurrence-name" name="name" maxLength={100} required className={input}/></div><div className="grid gap-2">{label('Direção','recurrence-direction')}<select id="recurrence-direction" value={direction} onChange={event => setDirection(event.target.value)} className={input}><option value="outflow">A pagar</option><option value="inflow">A receber</option></select></div></>}
        <div className="grid gap-2">{label('Frequência','recurrence-unit')}<select id="recurrence-unit" value={unit} disabled={!!rule} onChange={event => setUnit(event.target.value)} className={input}><option value="month">Mensal</option><option value="week">Semanal</option><option value="year">Anual</option></select></div>
        <div className="grid gap-2">{label(rule ? 'A partir de' : 'Primeiro vencimento','recurrence-date')}<input id="recurrence-date" type="date" name="date" defaultValue={workspace.space.today} required className={input}/></div>
        <div className="grid gap-2">{label('Valor (R$)','recurrence-amount')}<input id="recurrence-amount" name="amount" inputMode="decimal" required defaultValue={rule ? `${Math.floor(rule.current_version.amount_cents/100)},${String(rule.current_version.amount_cents%100).padStart(2,'0')}` : undefined} className={input}/></div>
        <div className="grid gap-2">{label('Certeza','recurrence-certainty')}<select id="recurrence-certainty" name="certainty" defaultValue={rule?.current_version.certainty ?? 'confirmed'} className={input}><option value="confirmed">Confirmado</option><option value="estimated">Estimado</option>{direction === 'inflow' && <option value="conditional">Condicional</option>}</select></div>
        <div className="grid gap-2">{label('Categoria','recurrence-category')}<select id="recurrence-category" name="category" required defaultValue={rule?.current_version.category_id ?? ''} className={input}><option value="">Selecione</option>{workspace.categories.filter(c => c.ledger_account_id && c.kind === (direction === 'inflow' ? 'income' : 'expense')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="grid gap-2">{label('Conta','recurrence-account')}<select id="recurrence-account" name="account" required defaultValue={rule?.current_version.payment_financial_account_id ?? ''} className={input}><option value="">Selecione</option>{workspace.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        {!rule && <><label className="flex gap-2"><input type="checkbox" name="main_income" disabled={direction !== 'inflow'}/>Esta é minha renda principal</label><label className="flex gap-2"><input type="checkbox" name="subscription"/>É uma assinatura</label></>}
        {rule && <div className="grid gap-2">{label('Aplicar alteração','recurrence-scope')}<select id="recurrence-scope" name="scope" className={input}><option value="this_and_following">Esta e as próximas</option><option value="entire_series">Toda a série em aberto</option></select></div>}
        <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white">Salvar recorrência</button>{rule && <button type="button" onClick={() => { setEditingRule(null); setDirection('outflow'); setUnit('month'); }}>Cancelar edição</button>}</div>
      </form>}
      <div className={`${panel} space-y-4`}>{metadata.recurrences.length === 0 && <p className="text-sm text-slate-500">Nenhuma recorrência cadastrada.</p>}{metadata.recurrences.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{r.title}</p><p className="text-sm text-slate-500">{money(r.current_version.amount_cents)} · {r.ends_on ? `Encerrada em ${r.ends_on}` : r.unit === 'month' ? 'Mensal' : r.unit === 'week' ? 'Semanal' : 'Anual'}</p></div>{canWrite && !r.ends_on && <div className="flex gap-3"><button disabled={busy} onClick={() => { setEditingRule(r.id); setDirection(r.direction); setUnit(r.unit); }} className="text-sm text-teal-600">Editar série</button><button disabled={busy} onClick={() => void run('end_recurrence_rule',{ p_rule:r.id,p_version:r.version,p_ends_on:workspace.space.today })} className="text-sm text-red-600">Encerrar hoje</button></div>}</div>)}</div>
    </>}
    {section === 'audit' && metadata && <div className={`${panel} space-y-4`}><p className="text-sm text-slate-500">Últimas 200 alterações do espaço. Os registros são preservados.</p>{metadata.audit.map(a => <div key={a.id} className="grid gap-1 border-b border-slate-100 pb-3 dark:border-slate-800"><p className="text-sm font-medium">{({ created:'Cadastro criado',edited:'Lançamento editado',cancelled:'Cancelamento',tags_changed:'Tags alteradas',rename:'Tag renomeada',merge:'Tags mescladas',archive:'Arquivamento',restore:'Restauração',delete:'Tag excluída',charges_confirmed:'Encargos confirmados',version_created:'Recorrência atualizada',ended:'Recorrência encerrada',updated:'Atualização',cycle_changed:'Ciclo de fatura atualizado' } as Record<string,string>)[a.action] ?? 'Alteração registrada'}</p><p className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString('pt-BR')} · {a.actor_id ? 'Membro do espaço' : 'Sistema'}</p></div>)}</div>}
  </div>;
}
