import { cloneElement, isValidElement, useEffect, useState, type ReactElement, type FormEvent, type ReactNode } from 'react';
import { accountDisplayColor, saveAccountDisplayColor, ledgerRpc, selectFinancialSpace, type FinancialSpace, type LedgerWorkspace, type UserSettings } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import AccountTable, { accountKindLabels } from '../components/AccountTable';
import CategoryPanels from '../components/CategoryPanels';
import ColorInput from '../components/ColorInput';
import CurrencyInput from '../components/CurrencyInput';
import { ALL_APP_PAGES } from '../lib/modules';
import { useAppStore } from '../store/useAppStore';
import {
  Boxes,
  CheckCircle2,
  RotateCcw,
  Info,
  Sliders,
  Building2,
  History,
  FolderPlus,
  Save,
  Plus,
  Trash2,
  Calendar,
  CalendarDays
} from 'lucide-react';
import LedgerExtras from './LedgerExtras';

function formatHolidayDate(dateStr: string) {
  try {
    const [year, month, day] = dateStr.split('-');
    if (!year || !month || !day) return dateStr;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

interface ManagedAccount { id: string; name: string; kind: string; color?: string | null; institution_name: string | null; liquidity: string; is_emergency_reserve: boolean; archived_at: string | null; version: number }
interface ManagedCategory { id: string; name: string; kind: string; parent_id: string | null; icon: string | null; color: string | null; is_essential: boolean; fixity: string | null; income_class: string | null; is_tax_deductible: boolean; archived_at: string | null; system_role: string | null; version: number }
interface Management { space: FinancialSpace; accounts: ManagedAccount[]; categories: ManagedCategory[]; holidays: { id: string; holiday_on: string; name: string }[] }
interface BalanceCheck { id: string; checked_on: string; application_balance_cents: number; statement_balance_cents: number; difference_cents: number }
const input = 'w-full field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
const panel = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
const primary = 'btn-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50';
const field = (name: string, content: ReactNode) => <label className="grid gap-2 text-sm"><span>{name}</span>{isValidElement(content) ? cloneElement(content as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': name }) : content}</label>;

export default function LedgerManagement({ section, workspace, money, onChanged }: { section: 'accounts' | 'categories' | 'settings'; workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Management | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null), [adjusting, setAdjusting] = useState<string | null>(null), [retry, setRetry] = useState(() => crypto.randomUUID()), [showArchived, setShowArchived] = useState(false), [liquidity, setLiquidity] = useState('cash');
  const [balanceCheck,setBalanceCheck]=useState<BalanceCheck | null>(null),[adjustmentId,setAdjustmentId]=useState(() => crypto.randomUUID());
  const [categoryName, setCategoryName] = useState(''), [categoryKind, setCategoryKind] = useState('expense'), [categoryColor, setCategoryColor] = useState('#64748b');
  const [categoryParent, setCategoryParent] = useState('');
  const [accountName, setAccountName] = useState(''), [accountKind, setAccountKind] = useState('checking'), [accountOpening, setAccountOpening] = useState('0,00'), [accountColor, setAccountColor] = useState('#0ea5e9');
  const [settingsTab, setSettingsTab] = useState<'modules' | 'preferences' | 'space' | 'audit'>('modules');
  const disabledPages = useAppStore(s => s.disabledPages);
  const togglePage = useAppStore(s => s.togglePage);
  const enableAllPages = useAppStore(s => s.enableAllPages);
  const resetPages = useAppStore(s => s.resetPages);
  const canManage = ['owner', 'admin'].includes(workspace.role), canWrite = workspace.role !== 'viewer';
  async function load() {
    const next = await ledgerRpc<Management>('management_data', { p_space: workspace.space.id });
    if (section === 'accounts') {
      const settings = await ledgerRpc<UserSettings>('get_user_settings', {});
      next.accounts = next.accounts.map(account => ({ ...account, color: accountDisplayColor(account, settings.preferences) }));
    }
    setData(next);
  }
  useEffect(() => { void load().catch(failure => setError(failure.message)); }, [workspace]);
  async function run(name: string, args: Record<string, unknown>, global = false) {
    setBusy(true); setError(''); setNotice('');
    try { await ledgerRpc(name, global ? args : { p_space: workspace.space.id, ...args }); await load(); await onChanged(); setEditing(null); setAdjusting(null); setNotice('Alterações salvas.'); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); return false; }
    finally { setBusy(false); }
  }
  async function saveAccount(event: FormEvent<HTMLFormElement>, account: ManagedAccount) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (busy) return;
    setBusy(true); setError('');
    try { if (String(form.get('color')) !== account.color) await saveAccountDisplayColor(account.id, String(form.get('color'))); }
    catch (failure) { setBusy(false); setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a cor.'); return; }
    await run('manage_financial_account', { p_account: account.id, p_version: account.version, p_action: 'update', p_changes: { name: String(form.get('name')).trim(), institution_name: String(form.get('institution')).trim() || null, liquidity, is_emergency_reserve: form.get('emergency') === 'on' } });
  }
  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountName.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    let created = false;
    try {
      const id = await ledgerRpc<string>('create_financial_account', { p_space: workspace.space.id, p_name: accountName.trim(), p_kind: accountKind, p_opening_cents: parseBrlCents(accountOpening), p_opening_on: workspace.space.today });
      created = true; setAccountName(''); setAccountOpening('0,00');
      await saveAccountDisplayColor(id, accountColor);
      await load(); await onChanged(); setNotice('Conta adicionada.');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Não foi possível salvar.';
      setError(created ? `A conta foi adicionada, mas não foi possível concluir a atualização: ${message}` : message);
      if (created) await Promise.all([load(), onChanged()]).catch(() => {});
    } finally { setBusy(false); }
  }
  async function saveCategory(event: FormEvent<HTMLFormElement>, category: ManagedCategory) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await run('manage_category', { p_category: category.id, p_version: category.version, p_action: 'update', p_changes: { name: String(form.get('name')).trim(), icon: String(form.get('icon')).trim() || null, color: String(form.get('color')), ...(category.kind === 'expense' ? { is_essential: form.get('essential') === 'on', fixity: String(form.get('fixity')), is_tax_deductible: form.get('tax') === 'on' } : { income_class: String(form.get('income_class')) }) } });
  }
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryName.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    let created = false;
    try {
      const id = await ledgerRpc<string>('create_category', {
        p_space: workspace.space.id, p_name: categoryName.trim(), p_kind: categoryKind,
        p_parent: categoryParent || null,
        p_income_class: categoryKind === 'income' ? 'recurring' : null,
        p_fixity: categoryKind === 'expense' ? 'variable' : null
      });
      created = true;
      setCategoryName('');
      const next = await ledgerRpc<Management>('management_data', { p_space: workspace.space.id });
      const category = next.categories.find(item => item.id === id);
      if (!category) throw new Error('Atualize a tela para conferir a categoria adicionada.');
      await ledgerRpc('manage_category', {
        p_space: workspace.space.id, p_category: id, p_version: category.version,
        p_action: 'update', p_changes: { color: categoryColor }
      });
      await load(); await onChanged(); setNotice('Categoria adicionada.');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Não foi possível salvar.';
      setError(created ? `A categoria foi adicionada, mas não foi possível concluir a atualização: ${message}` : message);
      if (created) await Promise.all([load(), onChanged()]).catch(() => {});
    } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {!data && section !== 'settings' && <p className={panel}>Carregando cadastros…</p>}
    {section === 'accounts' && <>
      {canManage && <form aria-label="Adicionar conta" onSubmit={createAccount} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-account-name" className="field-label">Nome</label>
          <input id="new-account-name" disabled={busy} value={accountName} onChange={event => setAccountName(event.target.value)} maxLength={100} required placeholder="Ex: Nubank" className="field-input" />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-account-kind" className="field-label">Tipo</label>
          <select id="new-account-kind" disabled={busy} value={accountKind} onChange={event => setAccountKind(event.target.value)} className="field-input">{Object.entries(accountKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-account-opening" className="field-label">Saldo inicial</label>
          <CurrencyInput id="new-account-opening" disabled={busy} value={accountOpening} onChange={event => setAccountOpening(event.target.value)} placeholder="0,00" required className="w-full sm:w-36" />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-account-color" className="field-label">Cor</label>
          <ColorInput id="new-account-color" disabled={busy} value={accountColor} onChange={setAccountColor} />
        </div>
        <button disabled={busy} className="btn-primary">Adicionar conta</button>
      </form>}
      {data && <AccountTable
        accounts={data.accounts.filter(account => showArchived || !account.archived_at).map(account => ({ ...account, type: accountKindLabels[account.kind] ?? account.kind, balance: workspace.accounts.find(item => item.id === account.id) ? money(workspace.accounts.find(item => item.id === account.id)!.balance_cents) : 'Saldo preservado no histórico' }))}
        renderName={account => canWrite && !account.archived_at ? <button type="button" disabled={busy} onClick={() => { setEditing(account.id); setAdjusting(null); setLiquidity(account.liquidity); }} aria-label={`${canManage ? 'Editar' : 'Conferir'} conta ${account.name}`} title="Detalhes da conta" className="min-w-0 break-words text-left">{account.name}</button> : <span className="break-words">{account.name}{account.archived_at && <span className="ml-2 text-xs text-slate-400">Arquivada</span>}</span>}
        renderActions={account => canManage ? <button type="button" disabled={busy} onClick={() => void run('manage_financial_account', { p_account: account.id, p_version: account.version, p_action: account.archived_at ? 'restore' : 'archive' })} title={account.archived_at ? undefined : 'Retirar das contas ativas e preservar o histórico'} className={account.archived_at ? 'text-xs text-brand-600 dark:text-brand-400' : 'btn-danger-text'}>{account.archived_at ? 'Restaurar' : 'Excluir'}</button> : null}
        renderEditor={account => editing === account.id || adjusting === account.id ? <section aria-label={`Detalhes da conta ${account.name}`} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm text-brand-700 dark:text-brand-300">
            {canManage && adjusting === account.id && <button disabled={busy} onClick={() => { setEditing(account.id); setAdjusting(null); setLiquidity(account.liquidity); }}>Editar conta</button>}
            {canWrite && !account.archived_at && account.liquidity === 'cash' && <button disabled={busy} onClick={() => { setAdjusting(account.id); setEditing(null); setBalanceCheck(null); setRetry(crypto.randomUUID()); }}>Conferir saldo com o extrato</button>}
            <button type="button" onClick={() => { setEditing(null); setAdjusting(null); }}>Fechar detalhes</button>
          </div>
          {canManage && editing === account.id && <form onSubmit={event => void saveAccount(event, account)} className="grid gap-4 sm:grid-cols-2">
        {field('Nome da conta', <input name="name" defaultValue={account.name} required maxLength={100} className={input}/>)}{field('Instituição', <input name="institution" defaultValue={account.institution_name ?? ''} maxLength={100} className={input}/>)}{field('Cor da conta', <ColorInput name="color" defaultValue={account.color ?? '#0ea5e9'} disabled={busy}/>)}
        {field('Disponibilidade do dinheiro', <select value={liquidity} onChange={event => setLiquidity(event.target.value)} disabled={['wallet', 'benefit', 'property'].includes(account.kind)} className={input}>{['benefit', 'property'].includes(account.kind) ? <option value={account.kind}>{account.kind === 'benefit' ? 'Benefício VR/VA' : 'Bem'}</option> : <><option value="cash">Disponível para gastar em contas</option><option value="investment">Investimento, fora do Livre para gastar</option></>}</select>)}
        <label className="flex gap-2 text-sm"><input name="emergency" type="checkbox" defaultChecked={account.is_emergency_reserve} disabled={liquidity !== 'investment'}/>Usar como reserva de emergência</label>
        <p className="text-xs text-slate-500 sm:col-span-2">A disponibilidade altera os números atuais. Os retratos de meses fechados preservam a classificação da época.</p><div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>Salvar conta</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form>}
      {canWrite && adjusting === account.id && <><form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(''); try { const check=await ledgerRpc<BalanceCheck>('check_account_balance',{p_space:workspace.space.id,p_account:account.id,p_on:String(form.get('date')),p_statement_balance_cents:parseBrlCents(String(form.get('balance'))),p_client_uuid:retry}); setBalanceCheck(check); setAdjustmentId(crypto.randomUUID()); setNotice('Conferência salva.'); } catch (failure) { setError((failure as Error).message); } finally {setBusy(false);} }} onChange={() => {setBalanceCheck(null); setRetry(crypto.randomUUID());}} className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-slate-500 sm:col-span-2">Informe o saldo do extrato para comparar com o saldo registrado na mesma data.</p>
        {field('Data do extrato', <input name="date" type="date" defaultValue={workspace.space.today} max={workspace.space.today} required className={input}/>)}{field('Saldo do extrato', <CurrencyInput name="balance" required className={input}/>)}<div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>Comparar saldos</button><button type="button" onClick={() => setAdjusting(null)}>Cancelar</button></div>
      </form>{balanceCheck && <div className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-sm">Saldo no aplicativo: {money(balanceCheck.application_balance_cents)} · Extrato: {money(balanceCheck.statement_balance_cents)}</p>{balanceCheck.difference_cents===0 ? <p role="status" className="text-sm font-semibold text-brand-700 dark:text-brand-300">Os saldos conferem.</p> : <><p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Diferença: {money(balanceCheck.difference_cents)}</p><p className="text-xs text-slate-500">Confira se falta algum lançamento ou importe o extrato. Se a diferença permanecer sem explicação, você pode registrá-la como ajuste de patrimônio.</p><form onSubmit={event => {event.preventDefault(); void run('account_adjustment',{p_account:account.id,p_on:balanceCheck.checked_on,p_statement_balance_cents:balanceCheck.statement_balance_cents,p_reason:String(new FormData(event.currentTarget).get('reason')),p_client_uuid:adjustmentId});}} className="grid gap-3">{field('Motivo para registrar o ajuste',<input name="reason" minLength={5} maxLength={1000} required className={input}/>)}<div><button disabled={busy} className={primary}>Registrar diferença não identificada</button></div></form></>}</div>}</>}
        </section> : null}
      />}
      {data?.accounts.some(account => account.archived_at) && <details className="text-sm text-slate-500 dark:text-slate-400"><summary className="cursor-pointer">Contas excluídas</summary><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Mostrar contas excluídas para restaurar</label></details>}
    </>}
    {section === 'categories' && <>
      {canManage && <form aria-label="Adicionar categoria" onSubmit={createCategory} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-category-name" className="field-label">Nome</label>
          <input id="new-category-name" disabled={busy} value={categoryName} onChange={event => setCategoryName(event.target.value)} maxLength={100} required placeholder="Ex: Assinaturas" className="field-input" />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-category-kind" className="field-label">Tipo</label>
          <select id="new-category-kind" disabled={busy} value={categoryKind} onChange={event => { setCategoryKind(event.target.value); setCategoryParent(''); }} className="field-input"><option value="expense">Despesa</option><option value="income">Receita</option></select>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="new-category-color" className="field-label">Cor</label>
          <ColorInput id="new-category-color" disabled={busy} value={categoryColor} onChange={setCategoryColor} />
        </div>
        <button disabled={busy} className="btn-primary">Adicionar categoria</button>
      </form>}
      {data && <CategoryPanels
        categories={data.categories.filter(category => showArchived || !category.archived_at)}
        renderName={category => canManage && !category.archived_at ? <button type="button" disabled={busy} onClick={() => setEditing(category.id)} aria-label={`Editar categoria ${category.name}`} title="Editar categoria" className="min-w-0 break-words text-left">{category.name}</button> : <span className="break-words">{category.name}{category.archived_at && <span className="ml-2 text-xs text-slate-400">Arquivada</span>}</span>}
        renderActions={category => canManage && !category.system_role && !data.categories.some(child => child.parent_id === category.id) ? <button type="button" disabled={busy} onClick={() => void run('manage_category', { p_category: category.id, p_version: category.version, p_action: category.archived_at ? 'restore' : 'archive' })} title={category.archived_at ? undefined : 'Retirar das categorias ativas e preservar o histórico'} className={category.archived_at ? 'shrink-0 text-xs text-brand-600 dark:text-brand-400' : 'btn-danger-text shrink-0'}>{category.archived_at ? 'Restaurar' : 'Excluir'}</button> : null}
        renderEditor={category => canManage && editing === category.id ? <div className="mt-4 space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><form onSubmit={event => void saveCategory(event, category)} className="grid gap-4 sm:grid-cols-2">
        {field('Nome da categoria', <input name="name" defaultValue={category.name} required maxLength={100} className={input}/>)}{field('Ícone (texto curto)', <input name="icon" defaultValue={category.icon ?? ''} maxLength={40} className={input}/>)}{field('Cor', <ColorInput name="color" defaultValue={category.color ?? '#0d9488'} disabled={busy}/>)}
        {category.kind === 'expense' ? <>{field('Comportamento', <select name="fixity" defaultValue={category.fixity ?? 'variable'} className={input}><option value="variable">Variável</option><option value="fixed">Fixa</option></select>)}<label className="flex gap-2 text-sm"><input name="essential" type="checkbox" defaultChecked={category.is_essential}/>Despesa essencial</label><label className="flex gap-2 text-sm"><input name="tax" type="checkbox" defaultChecked={category.is_tax_deductible}/>Dedutível no imposto de renda</label></> : field('Classe da renda', <select name="income_class" defaultValue={category.income_class ?? 'recurring'} className={input}><option value="recurring">Recorrente</option><option value="extraordinary">Extraordinária</option><option value="benefit">Benefício</option><option value="cashback">Cashback</option><option value="financial">Financeira</option></select>)}
        <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>Salvar categoria</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form><form onSubmit={event => { event.preventDefault(); void run('manage_category', { p_category: category.id, p_version: category.version, p_action: 'move', p_changes: { parent_id: String(new FormData(event.currentTarget).get('parent')) || null } }); }} className="flex flex-wrap items-end gap-3">{field('Mover para outro grupo', <select name="parent" defaultValue={category.parent_id ?? ''} className={input}><option value="">Categoria principal</option>{data.categories.filter(parent => parent.id !== category.id && parent.kind === category.kind && !parent.archived_at && data.categories.some(child => child.parent_id === parent.id)).map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select>)}<button disabled={busy} className={primary}>Mover categoria</button></form></div> : null}
      />}
      {data?.categories.some(category => category.archived_at) && <details className="text-sm text-slate-500 dark:text-slate-400"><summary className="cursor-pointer">Categorias excluídas</summary><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Mostrar categorias excluídas para restaurar</label></details>}
      {canManage && data && <details className="text-sm text-slate-500 dark:text-slate-400"><summary className="cursor-pointer">Organizar em grupos</summary><div className="mt-3 max-w-sm">{field('Grupo da nova categoria', <select value={categoryParent} onChange={event => setCategoryParent(event.target.value)} className="field-input w-full"><option value="">Categoria principal</option>{data.categories.filter(category => category.kind === categoryKind && !category.archived_at).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>)}</div></details>}
    </>}
    {section === 'settings' && (
      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'modules'}
            onClick={() => setSettingsTab('modules')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              settingsTab === 'modules'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Boxes size={17} />
            Páginas e Módulos
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                settingsTab === 'modules'
                  ? 'bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {ALL_APP_PAGES.filter(p => !disabledPages.includes(p.id)).length}/{ALL_APP_PAGES.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'preferences'}
            onClick={() => setSettingsTab('preferences')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              settingsTab === 'preferences'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Sliders size={17} />
            Preferências da Conta
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'space'}
            onClick={() => setSettingsTab('space')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              settingsTab === 'space'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Building2 size={17} />
            Espaço e Feriados
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'audit'}
            onClick={() => setSettingsTab('audit')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              settingsTab === 'audit'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <History size={17} />
            Histórico de Alterações
          </button>
        </div>

        {settingsTab === 'modules' && (
          <div className="space-y-6">
            <div className="card p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                    Habilitar ou Desabilitar Páginas no App
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Ligue ou desligue as páginas que deseja exibir no menu do aplicativo. Por exemplo, desative <strong>Orçamentos</strong> se você não o utiliza no momento. Suas informações salvas permanecem protegidas e intactas.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      enableAllPages();
                      setNotice('Todas as páginas foram ativadas no menu lateral.');
                      setTimeout(() => setNotice(''), 3000);
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    <CheckCircle2 size={14} />
                    Ativar todas
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      resetPages();
                      setNotice('Configuração padrão de páginas restaurada.');
                      setTimeout(() => setNotice(''), 3000);
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
                  >
                    <RotateCcw size={14} />
                    Restaurar padrão
                  </button>
                </div>
              </div>
            </div>

            {Array.from(new Set(ALL_APP_PAGES.map(p => p.group))).map(groupName => {
              const groupPages = ALL_APP_PAGES.filter(p => p.group === groupName);
              return (
                <section key={groupName} aria-label={`Páginas do grupo ${groupName}`} className="space-y-3">
                  <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {groupName}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {groupPages.map(page => {
                      const Icon = page.icon;
                      const isEnabled = !disabledPages.includes(page.id);
                      return (
                        <div
                          key={page.id}
                          className={`card flex flex-col justify-between p-4 transition-all ${
                            isEnabled
                              ? 'border-slate-200 dark:border-slate-800 dark:bg-slate-900'
                              : 'border-slate-200/60 bg-slate-50/60 opacity-60 dark:border-slate-800/60 dark:bg-slate-900/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                                  isEnabled
                                    ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400'
                                    : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                                }`}
                              >
                                <Icon size={18} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {page.label}
                                  </h4>
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      isEnabled
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                    }`}
                                  >
                                    {isEnabled ? 'Visível' : 'Oculta'}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                  {page.description}
                                </p>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isEnabled}
                                aria-label={`${isEnabled ? 'Desativar página' : 'Ativar página'} ${page.label}`}
                                onClick={() => togglePage(page.id)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-brand-500 ${
                                  isEnabled ? 'bg-brand-600 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                    isEnabled ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
              <span>
                A página de <strong>Configurações</strong> permanece sempre visível no menu para você poder gerenciar e reativar suas páginas a qualquer momento. Suas transações e dados financeiros nunca são apagados ao desativar uma página.
              </span>
            </div>
          </div>
        )}

        {settingsTab === 'preferences' && (
          <LedgerExtras section="settings" workspace={workspace} money={money} onChanged={onChanged} />
        )}

        {settingsTab === 'space' && (
          data ? (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Espaço Ativo */}
                <div className={`${panel} flex flex-col justify-between gap-5`}>
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                          <Building2 size={18} />
                        </div>
                        <div>
                          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Espaço financeiro ativo</h2>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Identificação e fuso horário do ambiente atual</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {data.space.kind === 'shared' ? 'Compartilhado' : 'Pessoal'}
                        </span>
                        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                          {workspace.role === 'owner' ? 'Proprietário' : workspace.role === 'admin' ? 'Administrador' : 'Membro'}
                        </span>
                      </div>
                    </div>

                    {canManage ? (
                      <form
                        key={data.space.version}
                        onSubmit={event => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void run('update_space', {
                            p_version: data.space.version,
                            p_name: String(form.get('name')).trim(),
                            p_timezone: String(form.get('timezone')).trim()
                          });
                        }}
                        className="space-y-4"
                      >
                        <div className="grid gap-1.5">
                          <label htmlFor="space-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Nome do espaço
                          </label>
                          <input
                            id="space-name"
                            name="name"
                            defaultValue={data.space.name}
                            required
                            maxLength={100}
                            className={input}
                            placeholder="Ex: Finanças Pessoais"
                          />
                        </div>

                        <div className="grid gap-1.5">
                          <label htmlFor="space-timezone" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Fuso horário (Timezone)
                          </label>
                          <input
                            id="space-timezone"
                            name="timezone"
                            defaultValue={data.space.timezone}
                            list="timezones-list"
                            required
                            className={input}
                            placeholder="America/Sao_Paulo"
                          />
                          <datalist id="timezones-list">
                            <option value="America/Sao_Paulo">Brasília (America/Sao_Paulo)</option>
                            <option value="America/Manaus">Manaus (America/Manaus)</option>
                            <option value="America/Cuiaba">Cuiabá (America/Cuiaba)</option>
                            <option value="America/Fortaleza">Fortaleza (America/Fortaleza)</option>
                            <option value="America/Belem">Belém (America/Belem)</option>
                            <option value="America/Recife">Recife (America/Recife)</option>
                            <option value="America/Porto_Velho">Porto Velho (America/Porto_Velho)</option>
                            <option value="America/Boa_Vista">Boa Vista (America/Boa_Vista)</option>
                            <option value="America/Rio_Branco">Rio Branco (America/Rio_Branco)</option>
                            <option value="UTC">UTC Universal</option>
                          </datalist>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Usado para definir a data de hoje, horários de vencimento e alertas.
                          </p>
                        </div>

                        <div className="pt-2">
                          <button
                            type="submit"
                            disabled={busy}
                            className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 font-semibold text-white disabled:opacity-50"
                          >
                            <Save size={16} />
                            <span>Salvar alterações do espaço</span>
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
                        <p><strong>Nome:</strong> {data.space.name}</p>
                        <p><strong>Fuso horário:</strong> {data.space.timezone}</p>
                        <p className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
                          Apenas administradores e o proprietário podem alterar as configurações deste espaço.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Criar Outro Espaço */}
                <div className={`${panel} flex flex-col justify-between gap-5`}>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                        <FolderPlus size={18} />
                      </div>
                      <div>
                        <h2 className="font-semibold text-slate-800 dark:text-slate-100">Criar outro espaço</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Ambientes totalmente independentes para suas finanças</p>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      Cada espaço financeiro possui seu próprio saldo, contas bancárias, cartões e lançamentos 100% isolados.
                    </p>

                    <form
                      onSubmit={async event => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        setBusy(true);
                        setError('');
                        try {
                          const id = await ledgerRpc<string>('create_space', {
                            p_name: String(form.get('name')).trim(),
                            p_kind: String(form.get('kind')),
                            p_timezone: String(form.get('timezone')).trim()
                          });
                          await selectFinancialSpace(id);
                          await onChanged();
                          setNotice('Novo espaço criado com sucesso!');
                        } catch (failure) {
                          setError((failure as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="space-y-4"
                    >
                      <div className="grid gap-1.5">
                        <label htmlFor="new-space-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Nome do novo espaço
                        </label>
                        <input
                          id="new-space-name"
                          name="name"
                          required
                          maxLength={100}
                          className={input}
                          placeholder="Ex: Empresa, Família ou Casa de Praia"
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label htmlFor="new-space-kind" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Tipo do espaço
                          </label>
                          <select id="new-space-kind" name="kind" defaultValue="personal" className={input}>
                            <option value="personal">Pessoal (Individual)</option>
                            <option value="shared">Compartilhado</option>
                          </select>
                        </div>

                        <div className="grid gap-1.5">
                          <label htmlFor="new-space-timezone" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Fuso horário
                          </label>
                          <input
                            id="new-space-timezone"
                            name="timezone"
                            defaultValue={data.space.timezone}
                            list="timezones-list"
                            required
                            className={input}
                          />
                        </div>
                      </div>

                      <div className="pt-2">
                        <button
                          type="submit"
                          disabled={busy}
                          className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 font-semibold text-white disabled:opacity-50"
                        >
                          <Plus size={16} />
                          <span>Criar e abrir este espaço</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>

              {/* Feriados Locais */}
              <div className={`${panel} space-y-5`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <CalendarDays size={18} />
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-800 dark:text-slate-100">Feriados municipais e regionais</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Feriados da sua localidade usados no cálculo automático de vencimentos e dias úteis
                      </p>
                    </div>
                  </div>
                  <span className="self-start sm:self-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {data.holidays.length} {data.holidays.length === 1 ? 'feriado cadastrado' : 'feriados cadastrados'}
                  </span>
                </div>

                {canManage && (
                  <form
                    onSubmit={async event => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const date = String(form.get('date')).trim();
                      const name = String(form.get('name')).trim();
                      if (!date || !name) return;
                      const ok = await run('manage_local_holiday', { p_on: date, p_name: name });
                      if (ok) event.currentTarget.reset();
                    }}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30"
                  >
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Adicionar feriado local
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] items-end">
                      <div className="grid gap-1.5">
                        <label htmlFor="holiday-date" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          Data do feriado
                        </label>
                        <input
                          id="holiday-date"
                          name="date"
                          type="date"
                          required
                          className={input}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label htmlFor="holiday-name" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          Nome ou celebração
                        </label>
                        <input
                          id="holiday-name"
                          name="name"
                          required
                          maxLength={100}
                          placeholder="Ex: Aniversário da Cidade, Padroeira, Consciência Negra"
                          className={input}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="btn-primary flex items-center justify-center gap-1.5 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                      >
                        <Plus size={16} />
                        <span>Adicionar</span>
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-3">
                  {data.holidays.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                        <Calendar size={24} />
                      </div>
                      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Nenhum feriado municipal ou regional cadastrado
                      </p>
                      <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
                        Os feriados nacionais comuns já são calculados pelo calendário bancário. Adicione aqui feriados específicos da sua cidade ou estado.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {[...data.holidays]
                        .sort((a, b) => a.holiday_on.localeCompare(b.holiday_on))
                        .map(holiday => (
                          <div
                            key={holiday.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 transition hover:border-slate-300 hover:bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-700 dark:hover:bg-slate-800/70"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-indigo-50 font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                                <span className="text-[9px] font-semibold uppercase leading-none">
                                  {new Date(holiday.holiday_on + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                                </span>
                                <span className="text-sm font-extrabold leading-none mt-0.5">
                                  {holiday.holiday_on.split('-')[2]}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={holiday.name}>
                                  {holiday.name}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatHolidayDate(holiday.holiday_on)}
                                </p>
                              </div>
                            </div>
                            {canManage && (
                              <button
                                type="button"
                                disabled={busy}
                                title={`Remover feriado ${holiday.name}`}
                                aria-label={`Remover feriado ${holiday.name}`}
                                onClick={() => void run('manage_local_holiday', { p_on: holiday.holiday_on, p_name: '', p_remove: true })}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                  <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
                  <span>
                    Quando uma conta ou compromisso com vencimento bancário cai em um final de semana ou feriado registrado aqui, o vencimento é postergado automaticamente para o próximo dia útil.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className={panel}>Carregando configurações do espaço…</p>
          )
        )}

        {settingsTab === 'audit' && (
          <LedgerExtras section="audit" workspace={workspace} money={money} onChanged={onChanged} />
        )}
      </div>
    )}
  </div>;
}
