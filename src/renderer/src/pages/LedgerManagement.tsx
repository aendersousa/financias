import { cloneElement, isValidElement, useEffect, useState, type ReactElement, type FormEvent, type ReactNode } from 'react';
import { accountDisplayColor, saveAccountDisplayColor, ledgerRpc, selectFinancialSpace, type FinancialSpace, type LedgerWorkspace, type UserSettings } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import CategoryPanels from '../components/CategoryPanels';
import AccountTable, { accountKindLabels } from '../components/AccountTable';

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
  const [accountName, setAccountName] = useState(''), [accountKind, setAccountKind] = useState('checking'), [accountOpening, setAccountOpening] = useState('0'), [accountColor, setAccountColor] = useState('#0ea5e9');
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
      created = true; setAccountName(''); setAccountOpening('0');
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
    {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
    {!data && <p className={panel}>Carregando cadastros…</p>}
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
          <input id="new-account-opening" disabled={busy} value={accountOpening} onChange={event => setAccountOpening(event.target.value)} inputMode="decimal" placeholder="0" required className="field-input w-full sm:w-32" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-account-color" className="field-label">Cor</label>
          <input id="new-account-color" disabled={busy} type="color" value={accountColor} onChange={event => setAccountColor(event.target.value)} className="h-9 w-12 rounded-lg border border-slate-300 dark:border-slate-700" />
        </div>
        <button disabled={busy} className="btn-primary">Adicionar conta</button>
      </form>}
      {data && <AccountTable
        accounts={data.accounts.filter(account => showArchived || !account.archived_at).map(account => ({ ...account, type: accountKindLabels[account.kind] ?? account.kind, balance: workspace.accounts.find(item => item.id === account.id) ? money(workspace.accounts.find(item => item.id === account.id)!.balance_cents) : 'Saldo preservado no histórico' }))}
        renderName={account => canWrite && !account.archived_at ? <button type="button" disabled={busy} onClick={() => { setEditing(account.id); setAdjusting(null); setLiquidity(account.liquidity); }} aria-label={`${canManage ? 'Editar' : 'Conferir'} conta ${account.name}`} title="Detalhes da conta" className="min-w-0 break-words text-left">{account.name}</button> : <span className="break-words">{account.name}{account.archived_at && <span className="ml-2 text-xs text-slate-400">Arquivada</span>}</span>}
        renderActions={account => canManage ? <button type="button" disabled={busy} onClick={() => void run('manage_financial_account', { p_account: account.id, p_version: account.version, p_action: account.archived_at ? 'restore' : 'archive' })} title={account.archived_at ? undefined : 'Retirar das contas ativas e preservar o histórico'} className={account.archived_at ? 'text-xs text-sky-600 dark:text-sky-400' : 'btn-danger-text'}>{account.archived_at ? 'Restaurar' : 'Excluir'}</button> : null}
        renderEditor={account => editing === account.id || adjusting === account.id ? <section aria-label={`Detalhes da conta ${account.name}`} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm text-teal-700 dark:text-teal-300">
            {canManage && adjusting === account.id && <button disabled={busy} onClick={() => { setEditing(account.id); setAdjusting(null); setLiquidity(account.liquidity); }}>Editar conta</button>}
            {canWrite && !account.archived_at && account.liquidity === 'cash' && <button disabled={busy} onClick={() => { setAdjusting(account.id); setEditing(null); setBalanceCheck(null); setRetry(crypto.randomUUID()); }}>Conferir saldo com o extrato</button>}
            <button type="button" onClick={() => { setEditing(null); setAdjusting(null); }}>Fechar detalhes</button>
          </div>
          {canManage && editing === account.id && <form onSubmit={event => void saveAccount(event, account)} className="grid gap-4 sm:grid-cols-2">
        {field('Nome da conta', <input name="name" defaultValue={account.name} required maxLength={100} className={input}/>)}{field('Instituição', <input name="institution" defaultValue={account.institution_name ?? ''} maxLength={100} className={input}/>)}{field('Cor da conta', <input name="color" type="color" defaultValue={account.color ?? '#0ea5e9'} className="h-9 w-12 rounded-lg border border-slate-300 dark:border-slate-700"/>)}
        {field('Disponibilidade do dinheiro', <select value={liquidity} onChange={event => setLiquidity(event.target.value)} disabled={['wallet', 'benefit', 'property'].includes(account.kind)} className={input}>{['benefit', 'property'].includes(account.kind) ? <option value={account.kind}>{account.kind === 'benefit' ? 'Benefício VR/VA' : 'Bem'}</option> : <><option value="cash">Disponível para gastar em contas</option><option value="investment">Investimento, fora do Livre para gastar</option></>}</select>)}
        <label className="flex gap-2 text-sm"><input name="emergency" type="checkbox" defaultChecked={account.is_emergency_reserve} disabled={liquidity !== 'investment'}/>Usar como reserva de emergência</label>
        <p className="text-xs text-slate-500 sm:col-span-2">A disponibilidade altera os números atuais. Os retratos de meses fechados preservam a classificação da época.</p><div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>Salvar conta</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form>}
      {canWrite && adjusting === account.id && <><form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(''); try { const check=await ledgerRpc<BalanceCheck>('check_account_balance',{p_space:workspace.space.id,p_account:account.id,p_on:String(form.get('date')),p_statement_balance_cents:parseBrlCents(String(form.get('balance'))),p_client_uuid:retry}); setBalanceCheck(check); setAdjustmentId(crypto.randomUUID()); setNotice('Conferência salva.'); } catch (failure) { setError((failure as Error).message); } finally {setBusy(false);} }} onChange={() => {setBalanceCheck(null); setRetry(crypto.randomUUID());}} className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-slate-500 sm:col-span-2">Informe o saldo do extrato para comparar com o saldo registrado na mesma data.</p>
        {field('Data do extrato', <input name="date" type="date" defaultValue={workspace.space.today} max={workspace.space.today} required className={input}/>)}{field('Saldo do extrato (R$)', <input name="balance" inputMode="decimal" required className={input}/>)}<div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>Comparar saldos</button><button type="button" onClick={() => setAdjusting(null)}>Cancelar</button></div>
      </form>{balanceCheck && <div className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-sm">Saldo no aplicativo: {money(balanceCheck.application_balance_cents)} · Extrato: {money(balanceCheck.statement_balance_cents)}</p>{balanceCheck.difference_cents===0 ? <p role="status" className="text-sm font-semibold text-teal-700 dark:text-teal-300">Os saldos conferem.</p> : <><p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Diferença: {money(balanceCheck.difference_cents)}</p><p className="text-xs text-slate-500">Confira se falta algum lançamento ou importe o extrato. Se a diferença permanecer sem explicação, você pode registrá-la como ajuste de patrimônio.</p><form onSubmit={event => {event.preventDefault(); void run('account_adjustment',{p_account:account.id,p_on:balanceCheck.checked_on,p_statement_balance_cents:balanceCheck.statement_balance_cents,p_reason:String(new FormData(event.currentTarget).get('reason')),p_client_uuid:adjustmentId});}} className="grid gap-3">{field('Motivo para registrar o ajuste',<input name="reason" minLength={5} maxLength={1000} required className={input}/>)}<div><button disabled={busy} className={primary}>Registrar diferença não identificada</button></div></form></>}</div>}</>}
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
        <div className="flex flex-col gap-1">
          <label htmlFor="new-category-color" className="field-label">Cor</label>
          <input id="new-category-color" disabled={busy} type="color" value={categoryColor} onChange={event => setCategoryColor(event.target.value)} className="h-9 w-12 rounded-lg border border-slate-300 dark:border-slate-700" />
        </div>
        <button disabled={busy} className="btn-primary">Adicionar categoria</button>
      </form>}
      {data && <CategoryPanels
        categories={data.categories.filter(category => showArchived || !category.archived_at)}
        renderName={category => canManage && !category.archived_at ? <button type="button" disabled={busy} onClick={() => setEditing(category.id)} aria-label={`Editar categoria ${category.name}`} title="Editar categoria" className="min-w-0 break-words text-left">{category.name}</button> : <span className="break-words">{category.name}{category.archived_at && <span className="ml-2 text-xs text-slate-400">Arquivada</span>}</span>}
        renderActions={category => canManage && !category.system_role && !data.categories.some(child => child.parent_id === category.id) ? <button type="button" disabled={busy} onClick={() => void run('manage_category', { p_category: category.id, p_version: category.version, p_action: category.archived_at ? 'restore' : 'archive' })} title={category.archived_at ? undefined : 'Retirar das categorias ativas e preservar o histórico'} className={category.archived_at ? 'shrink-0 text-xs text-sky-600 dark:text-sky-400' : 'btn-danger-text shrink-0'}>{category.archived_at ? 'Restaurar' : 'Excluir'}</button> : null}
        renderEditor={category => canManage && editing === category.id ? <div className="mt-4 space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><form onSubmit={event => void saveCategory(event, category)} className="grid gap-4 sm:grid-cols-2">
        {field('Nome da categoria', <input name="name" defaultValue={category.name} required maxLength={100} className={input}/>)}{field('Ícone (texto curto)', <input name="icon" defaultValue={category.icon ?? ''} maxLength={40} className={input}/>)}{field('Cor', <input name="color" type="color" defaultValue={category.color ?? '#0d9488'} className={input}/>)}
        {category.kind === 'expense' ? <>{field('Comportamento', <select name="fixity" defaultValue={category.fixity ?? 'variable'} className={input}><option value="variable">Variável</option><option value="fixed">Fixa</option></select>)}<label className="flex gap-2 text-sm"><input name="essential" type="checkbox" defaultChecked={category.is_essential}/>Despesa essencial</label><label className="flex gap-2 text-sm"><input name="tax" type="checkbox" defaultChecked={category.is_tax_deductible}/>Dedutível no imposto de renda</label></> : field('Classe da renda', <select name="income_class" defaultValue={category.income_class ?? 'recurring'} className={input}><option value="recurring">Recorrente</option><option value="extraordinary">Extraordinária</option><option value="benefit">Benefício</option><option value="cashback">Cashback</option><option value="financial">Financeira</option></select>)}
        <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>Salvar categoria</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form><form onSubmit={event => { event.preventDefault(); void run('manage_category', { p_category: category.id, p_version: category.version, p_action: 'move', p_changes: { parent_id: String(new FormData(event.currentTarget).get('parent')) || null } }); }} className="flex flex-wrap items-end gap-3">{field('Mover para outro grupo', <select name="parent" defaultValue={category.parent_id ?? ''} className={input}><option value="">Categoria principal</option>{data.categories.filter(parent => parent.id !== category.id && parent.kind === category.kind && !parent.archived_at && data.categories.some(child => child.parent_id === parent.id)).map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select>)}<button disabled={busy} className={primary}>Mover categoria</button></form></div> : null}
      />}
      {data?.categories.some(category => category.archived_at) && <details className="text-sm text-slate-500 dark:text-slate-400"><summary className="cursor-pointer">Categorias excluídas</summary><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Mostrar categorias excluídas para restaurar</label></details>}
      {canManage && data && <details className="text-sm text-slate-500 dark:text-slate-400"><summary className="cursor-pointer">Organizar em grupos</summary><div className="mt-3 max-w-sm">{field('Grupo da nova categoria', <select value={categoryParent} onChange={event => setCategoryParent(event.target.value)} className="field-input w-full"><option value="">Categoria principal</option>{data.categories.filter(category => category.kind === categoryKind && !category.archived_at).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>)}</div></details>}
    </>}
    {section === 'settings' && data && <>
      {canManage && <form key={data.space.version} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run('update_space', { p_version: data.space.version, p_name: String(form.get('name')), p_timezone: String(form.get('timezone')) }); }} className={`${panel} grid gap-4 sm:grid-cols-2`}><h2 className="font-semibold sm:col-span-2">Seu espaço financeiro</h2>{field('Nome do espaço', <input name="name" defaultValue={data.space.name} required maxLength={100} className={input}/>)}{field('Fuso horário', <input name="timezone" defaultValue={data.space.timezone} placeholder="America/Sao_Paulo" required className={input}/>)}<div><button disabled={busy} className={primary}>Salvar espaço</button></div></form>}
      <form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(''); try { const id = await ledgerRpc<string>('create_space', { p_name: String(form.get('name')), p_kind: String(form.get('kind')), p_timezone: String(form.get('timezone')) }); await selectFinancialSpace(id); await onChanged(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }} className={`${panel} grid gap-4 sm:grid-cols-2`}><h2 className="font-semibold sm:col-span-2">Criar outro espaço</h2><p className="text-sm text-slate-500 sm:col-span-2">Cada espaço tem suas próprias contas, categorias, saldos e histórico.</p>{field('Nome do novo espaço', <input name="name" required maxLength={100} className={input}/>)}{field('Tipo do espaço', <select name="kind" className={input}><option value="personal">Pessoal</option><option value="shared">Compartilhado</option></select>)}{field('Fuso horário do novo espaço', <input name="timezone" defaultValue={data.space.timezone} required className={input}/>)}<div className="sm:col-span-2"><button disabled={busy} className={primary}>Criar e abrir espaço</button></div></form>
      {canManage && <div className={`${panel} space-y-4`}><h2 className="font-semibold">Feriados locais</h2><p className="text-sm text-slate-500">Feriados da sua cidade usados no cálculo do vencimento bancário.</p><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run('manage_local_holiday', { p_on: String(form.get('date')), p_name: String(form.get('name')) }); }} className="flex flex-wrap items-end gap-3">{field('Data do feriado', <input name="date" type="date" required className={input}/>)}{field('Nome do feriado', <input name="name" required maxLength={100} className={input}/>)}<button disabled={busy} className={primary}>Salvar feriado</button></form>{data.holidays.map(holiday => <div key={holiday.id} className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{holiday.holiday_on} · {holiday.name}</span><button disabled={busy} onClick={() => void run('manage_local_holiday', { p_on: holiday.holiday_on, p_name: '', p_remove: true })} className="text-red-600">Remover feriado</button></div>)}</div>}
    </>}
  </div>;
}
