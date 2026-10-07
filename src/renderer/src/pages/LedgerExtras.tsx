import { useEffect, useState, type FormEvent } from 'react';
import { ledgerRpc, type LedgerWorkspace, type UserSettings, type WorkspaceMetadata } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import { useAppStore } from '../store/useAppStore';
import LedgerRecurrences from './LedgerRecurrences';
import { Sliders, ShieldCheck, Wallet } from 'lucide-react';

export type ExtraSection = 'tags' | 'recurrences' | 'settings' | 'audit';
interface PlanningSettings { minimum_safety_reserve_cents: number; fallback_cycle_day: number; version: number; categories: { id: string; name: string; version: number; benefit_financial_account_id: string | null }[] }
const input = 'w-full field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
const panel = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
type ExtrasProps = { section: ExtraSection; workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> };
export default function LedgerExtras(props: ExtrasProps) {
  return props.section === 'recurrences' ? <LedgerRecurrences workspace={props.workspace} money={props.money} onChanged={props.onChanged}/> : <LedgerExtraTools {...props}/>;
}
function LedgerExtraTools({ section, workspace, money, onChanged }: ExtrasProps) {
  const [metadata,setMetadata] = useState<WorkspaceMetadata | null>(null);
  const [settings,setSettings] = useState<UserSettings | null>(null);
  const [planning,setPlanning] = useState<PlanningSettings | null>(null),[benefitCategory,setBenefitCategory] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [transaction,setTransaction] = useState('');
  const [selectedTags,setSelectedTags] = useState<string[]>([]);
  const canWrite = workspace.role !== 'viewer';
  const canManage = ['owner','admin'].includes(workspace.role);
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
  const label = (name: string,id: string) => <label htmlFor={id} className="text-sm font-medium">{name}</label>;
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {!metadata && <p>Carregando…</p>}
    {section === 'settings' && (
      <div className="grid gap-6 lg:grid-cols-2">
        {settings && (
          <form onSubmit={saveSettings} key={settings.version} className={`${panel} flex flex-col justify-between gap-5`}>
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                  <Sliders size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-800 dark:text-slate-100">Preferências da sua conta</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Personalize a exibição, tema e alertas</p>
                </div>
              </div>

              <div className="grid gap-1.5">
                {label('Aparência', 'settings-theme')}
                <select id="settings-theme" name="theme" defaultValue={settings.theme} className={input}>
                  <option value="system">Acompanhar o aparelho (automático)</option>
                  <option value="light">Modo claro</option>
                  <option value="dark">Modo escuro</option>
                </select>
              </div>

              <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <input
                    name="privacy"
                    type="checkbox"
                    defaultChecked={settings.privacy_mode}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>Começar com os valores ocultos</span>
                </label>
                <p className="mt-1 pl-7 text-xs text-slate-500 dark:text-slate-400">
                  A preferência de privacidade será aplicada no próximo acesso. Você pode mostrar ou ocultar a qualquer momento no cabeçalho.
                </p>
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Avisos na Central de notificações
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { id: 'agenda', label: 'Agenda e vencimentos' },
                    { id: 'cards', label: 'Cartões e faturas' },
                    { id: 'budgets', label: 'Orçamentos' },
                    { id: 'goals', label: 'Progresso das metas' },
                    { id: 'reserves', label: 'Cobertura das reservas' }
                  ].map(category => (
                    <label
                      key={category.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/40 p-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-300 dark:hover:bg-slate-800/70"
                    >
                      <input
                        name={`notify_${category.id}`}
                        type="checkbox"
                        defaultChecked={settings.notification_preferences[category.id] ?? workspace.role !== 'viewer'}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span>{category.label}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Avisos urgentes permanecem na Central para os responsáveis pelo espaço.
                </p>
              </fieldset>
            </div>

            <div className="pt-2">
              <button disabled={busy} className="btn-primary w-full py-2.5 font-semibold text-white">
                Salvar preferências
              </button>
            </div>
          </form>
        )}

        {planning && (
          <div className="flex flex-col gap-6">
            <form key={`planning-${planning.version}`} onSubmit={savePlanning} className={`${panel} flex flex-col justify-between gap-4`}>
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-800 dark:text-slate-100">Ciclo e reserva de segurança</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Proteção de saldo mínimo e início do ciclo mensal</p>
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  A reserva mínima protege uma parte do dinheiro em conta. Sem renda principal, o ciclo começa no dia escolhido.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    {label('Reserva mínima (R$)', 'planning-safety')}
                    <input
                      id="planning-safety"
                      name="safety"
                      inputMode="decimal"
                      required
                      defaultValue={`${Math.floor(planning.minimum_safety_reserve_cents / 100)},${String(planning.minimum_safety_reserve_cents % 100).padStart(2, '0')}`}
                      disabled={!['owner', 'admin'].includes(workspace.role)}
                      className={input}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    {label('Dia de início do ciclo', 'planning-cycle')}
                    <input
                      id="planning-cycle"
                      name="cycle"
                      type="number"
                      min={1}
                      max={31}
                      required
                      defaultValue={planning.fallback_cycle_day}
                      disabled={!['owner', 'admin'].includes(workspace.role)}
                      className={input}
                    />
                  </div>
                </div>
              </div>

              {['owner', 'admin'].includes(workspace.role) && (
                <div className="pt-1">
                  <button disabled={busy} className="btn-primary w-full py-2.5 font-semibold text-white">
                    Salvar planejamento
                  </button>
                </div>
              )}
            </form>

            <form
              onSubmit={event => {
                event.preventDefault();
                const category = planning.categories.find(c => c.id === benefitCategory);
                if (category) {
                  void run('set_category_benefit', {
                    p_category: category.id,
                    p_version: category.version,
                    p_benefit: String(new FormData(event.currentTarget).get('benefit')) || null
                  });
                }
              }}
              className={`${panel} flex flex-col justify-between gap-4`}
            >
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                    <Wallet size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-800 dark:text-slate-100">O que seu benefício paga</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Vincule contas VR/VA às categorias de alimentação</p>
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Vincule o VR/VA à categoria de despesas coberta por ele. O vínculo também se aplica às categorias filhas.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    {label('Categoria coberta', 'benefit-category')}
                    <select
                      id="benefit-category"
                      value={benefitCategory}
                      onChange={event => setBenefitCategory(event.target.value)}
                      required
                      className={input}
                    >
                      <option value="">Selecione</option>
                      {planning.categories.map(category => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    {label('Conta de benefício', 'benefit-account')}
                    <select
                      id="benefit-account"
                      name="benefit"
                      key={benefitCategory}
                      defaultValue={planning.categories.find(c => c.id === benefitCategory)?.benefit_financial_account_id ?? ''}
                      disabled={!canWrite}
                      className={input}
                    >
                      <option value="">Sem vínculo</option>
                      {workspace.accounts.filter(account => account.liquidity === 'benefit').map(account => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {canWrite && (
                <div className="pt-1">
                  <button disabled={busy || !benefitCategory} className="btn-primary w-full py-2.5 font-semibold text-white">
                    Salvar vínculo do benefício
                  </button>
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    )}
    {section === 'tags' && metadata && <>
      {canWrite && <form onSubmit={submitTag} className={`${panel} flex flex-wrap items-end gap-3`}><div className="grid flex-1 gap-2">{label('Nome da tag','tag-name')}<input id="tag-name" name="name" maxLength={100} required className={input}/></div><button disabled={busy} className="btn-primary px-4 py-2.5 font-semibold text-white">Criar tag</button></form>}
      <div className={`${panel} space-y-4`}>{metadata.tags.length === 0 && <p className="text-sm text-slate-500">Nenhuma tag cadastrada.</p>}{metadata.tags.map(tag => <form key={`${tag.id}-${tag.version}`} onSubmit={event => { event.preventDefault(); void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:'rename',p_name:String(new FormData(event.currentTarget).get('name')) }); }} className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-4 last:border-0 dark:border-slate-800">
        <input name="name" aria-label={`Nome da tag ${tag.name}`} defaultValue={tag.name} disabled={!canManage} maxLength={100} required className={`${input} max-w-xs`}/><span className="text-xs text-slate-500">{tag.archived_at ? 'Arquivada' : 'Ativa'}</span>
        {canManage && <><button disabled={busy} className="text-sm text-brand-600">Renomear</button><button type="button" disabled={busy} onClick={() => void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:tag.archived_at ? 'restore' : 'archive' })} className="text-sm">{tag.archived_at ? 'Restaurar' : 'Arquivar'}</button><button type="button" disabled={busy} onClick={() => void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:'delete' })} className="text-sm text-red-600">Excluir</button>
          <select aria-label={`Mesclar ${tag.name} em outra tag`} defaultValue="" className={`${input} max-w-xs`} disabled={busy} onChange={event => { if (event.target.value) void run('manage_tag',{ p_tag:tag.id,p_version:tag.version,p_action:'merge',p_destination:event.target.value }); }}><option value="">Mesclar em…</option>{metadata.tags.filter(t => t.id !== tag.id && !t.archived_at).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></>}
      </form>)}</div>
      {canWrite && <div className={`${panel} space-y-4`}><h2 className="font-semibold">Marcar um lançamento</h2>{label('Lançamento','tag-transaction')}<select id="tag-transaction" value={transaction} onChange={event => setTransaction(event.target.value)} className={input}><option value="">Selecione</option>{workspace.transactions.map(t => <option key={t.id} value={t.id}>{t.occurred_on} · {t.description}</option>)}</select>
        {transaction && <><div className="flex flex-wrap gap-4">{metadata.tags.filter(t => !t.archived_at || selectedTags.includes(t.id)).map(tag => <label key={tag.id} className="flex gap-2"><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={event => setSelectedTags(event.target.checked ? [...selectedTags,tag.id] : selectedTags.filter(id => id !== tag.id))}/>{tag.name}</label>)}</div><button disabled={busy} onClick={() => void run('set_transaction_tags',{ p_transaction:transaction,p_tags:selectedTags,p_expected_tags:metadata.transaction_tags.filter(t => t.ledger_transaction_id === transaction).map(t => t.tag_id) })} className="btn-primary px-4 py-2.5 font-semibold text-white">Salvar tags do lançamento</button></>}
      </div>}
    </>}
    {section === 'audit' && metadata && <div className={`${panel} space-y-4`}><p className="text-sm text-slate-500">Últimas 200 alterações do espaço. Os registros são preservados.</p>{metadata.audit.map(a => <div key={a.id} className="grid gap-1 border-b border-slate-100 pb-3 dark:border-slate-800"><p className="text-sm font-medium">{({ created:'Cadastro criado',edited:'Lançamento editado',cancelled:'Cancelamento',tags_changed:'Tags alteradas',rename:'Tag renomeada',merge:'Tags mescladas',archive:'Arquivamento',restore:'Restauração',delete:'Tag excluída',charges_confirmed:'Encargos confirmados',version_created:'Recorrência atualizada',ended:'Recorrência encerrada',updated:'Atualização',cycle_changed:'Ciclo de fatura atualizado' } as Record<string,string>)[a.action] ?? 'Alteração registrada'}</p><p className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString('pt-BR')} · {a.actor_id ? 'Membro do espaço' : 'Sistema'}</p></div>)}</div>}
  </div>;
}
