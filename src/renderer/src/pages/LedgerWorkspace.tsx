import CategoryPanels from '../components/CategoryPanels';
import PageHeader from '../components/PageHeader';
import { cloneElement, Fragment, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeftRight, Bell, CalendarDays, CreditCard, History, LayoutDashboard, LogOut, Plus, RefreshCw, Repeat, Settings, Tags, Users, Wallet } from 'lucide-react';
import { formatBrlCents, parseBrlCents } from '../../../shared/finance/money';
import { ledgerRpc, loadLedgerWorkspace, selectFinancialSpace, type FinancialSpace, type LedgerWorkspace as Workspace, type UserSettings } from '../lib/ledgerRepository';
import LedgerExtras, { type ExtraSection } from './LedgerExtras';
import LedgerCardOperations from './LedgerCardOperations';
import LedgerPortfolio from './LedgerPortfolio';
import LedgerClosing from './LedgerClosing';
import LedgerTransactionActions from './LedgerTransactionActions';
import LedgerReserves, { type ReserveSummary } from './LedgerReserves';
import LedgerNotifications from './LedgerNotifications';
import LedgerFreeToSpend from './LedgerFreeToSpend';
import LedgerQuickEntry from './LedgerQuickEntry';
import LedgerManagement from './LedgerManagement';
import LedgerReports from './LedgerReports';
import LedgerFinancialHealth from './LedgerFinancialHealth';
import LedgerImports from './LedgerImports';
import LedgerAgenda from './LedgerAgenda';
import LedgerReservePlan from './LedgerReservePlan';
import LedgerDashboardSummary from './LedgerDashboardSummary';
import LedgerSharing from './LedgerSharing';
import LedgerBudgets from './LedgerBudgets';
import LedgerPeople from './LedgerPeople';
import LedgerCardManagement from './LedgerCardManagement';
import LedgerForeignCurrency from './LedgerForeignCurrency';
import LedgerCashForecast from './LedgerCashForecast';
import { activeUserId,cacheWorkspace,cachedWorkspace,clearLocalData,offlineQueue,sendLocalQueue } from '../lib/offlineStorage';
import { supabase } from '../lib/supabaseClient';
import { useAppStore } from '../store/useAppStore';

type Section = 'dashboard' | 'accounts' | 'categories' | 'cards' | 'people' | 'transactions' | 'foreign_currency' | 'agenda' | 'forecast' | 'budgets' | 'reserves' | 'notifications' | 'portfolio' | 'closing' | 'reports' | 'health' | 'imports' | 'sharing' | ExtraSection;
const navigation = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'accounts', label: '1. Contas', icon: Wallet },
  { id: 'categories', label: '2. Categorias', icon: Tags },
  { id: 'cards', label: '3. Cartões', icon: CreditCard },
  { id: 'people', label: 'Pessoas', icon: Users },
  { id: 'sharing', label: 'Compartilhamento', icon: Users },
  { id: 'transactions', label: 'Lançamentos', icon: ArrowLeftRight },
  { id: 'foreign_currency', label: 'Compras internacionais', icon: ArrowLeftRight },
  { id: 'imports', label: 'Importar extrato', icon: ArrowLeftRight },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'forecast', label: 'Previsão de saldo', icon: CalendarDays },
  { id: 'budgets', label: 'Orçamentos', icon: Wallet },
  { id: 'reserves', label: 'Metas e provisões', icon: Wallet },
  { id: 'recurrences', label: 'Recorrências', icon: Repeat },
  { id: 'portfolio', label: 'Patrimônio', icon: Wallet },
  { id: 'reports', label: 'Relatórios', icon: History },
  { id: 'health', label: 'Saúde financeira', icon: Wallet },
  { id: 'closing', label: 'Relatório mensal e fechamento', icon: History },
  { id: 'tags', label: 'Tags', icon: Tags },
  { id: 'audit', label: 'Histórico de alterações', icon: History },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'settings', label: 'Configurações', icon: Settings }
] as const;
const inputClass = 'w-full field-input px-3 py-2.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const panelClass = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
const navigationGroups: Partial<Record<Section,string>> = {accounts:'Cadastre nesta ordem',transactions:'Movimentações',agenda:'Planejamento',reports:'Acompanhamento',tags:'Organização'};

export default function LedgerWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [spaces, setSpaces] = useState<FinancialSpace[]>([]);
  const [reserveSummary,setReserveSummary] = useState<ReserveSummary | null>(null);
  const [section, setSection] = useState<Section>(() => location.hash.startsWith('#invite=') ? 'sharing' : 'dashboard');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState('expense');
  const [agendaKind,setAgendaKind]=useState('one_off'),[agendaMethod,setAgendaMethod]=useState('account');
  const [retryId, setRetryId] = useState(() => crypto.randomUUID());
  const [selectedTransaction,setSelectedTransaction] = useState<string | null>(null);
  const [online,setOnline]=useState(navigator.onLine),[cacheTime,setCacheTime]=useState<string | null>(null),[usingCache,setUsingCache]=useState(false);
  const [logoutCount,setLogoutCount]=useState<number | null>(null);
  const preferencesInitialized = useRef(false);
  const workspaceLoadSequence = useRef(0);
  const privacy = useAppStore(s => s.privacyMode);
  const togglePrivacy = useAppStore(s => s.togglePrivacyMode);
  const money = (value: number) => privacy ? 'R$ ••••' : formatBrlCents(value);

  async function reloadData() {
    const sequence=++workspaceLoadSequence.current;
    const next = await loadLedgerWorkspace();
    const [reserves, allSpaces] = await Promise.all([ledgerRpc<ReserveSummary>('reserve_summary',{ p_space:next.space.id }), ledgerRpc<FinancialSpace[]>('my_spaces', {})]);
    if(sequence!==workspaceLoadSequence.current) return;
    setWorkspace(next); setReserveSummary(reserves); setSpaces(allSpaces);
    setUsingCache(false); setCacheTime(new Date().toISOString());
    await cacheWorkspace(next,next.loadedForUserId).catch(() => setError('Os dados foram carregados, mas não foi possível salvar uma cópia neste aparelho.'));
  }

  async function refresh() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!preferencesInitialized.current) {
        const settings = await ledgerRpc<UserSettings>('get_user_settings',{});
        useAppStore.getState().setPrivacyMode(settings.privacy_mode);
        useAppStore.getState().setTheme(settings.theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : settings.theme);
        preferencesInitialized.current = true;
      }
      await reloadData();
    }
    catch (failure) {
      if (!navigator.onLine || failure instanceof Error && /fetch|network|conexão/i.test(failure.message)) {
        const cache=await cachedWorkspace().catch(() => undefined);
        if (cache) { setWorkspace(cache.workspace); setCacheTime(cache.updatedAt); setUsingCache(true); setError(''); }
        else setError('Sem conexão e sem dados salvos neste aparelho. Conecte-se para abrir seu espaço.');
      } else setError(failure instanceof Error ? failure.message : 'Não foi possível carregar seus dados.');
    }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const change=() => { setOnline(navigator.onLine); setFormOpen(false); setSelectedTransaction(null); if (navigator.onLine) void refresh(); };
    window.addEventListener('online',change); window.addEventListener('offline',change);
    return () => { window.removeEventListener('online',change); window.removeEventListener('offline',change); };
  },[]);
  async function logout() {
    try {
      const rows=await offlineQueue.list(await activeUserId());
      if (rows.length) { setLogoutCount(rows.length); return; }
      await clearLocalData(); await supabase.auth.signOut();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível sair.'); }
  }
  function navigate(next: Section) { setSection(next); setFormOpen(false); setNotice(''); setKind('expense'); setSelectedTransaction(null); }
  function openForm() { setRetryId(crypto.randomUUID()); setAgendaKind('one_off'); setAgendaMethod('account'); setFormOpen(true); setNotice(''); setError(''); }
  async function switchSpace(id: string) {
    ++workspaceLoadSequence.current;
    setBusy(true); setError(''); setFormOpen(false); setSelectedTransaction(null);
    try { await selectFinancialSpace(id); await reloadData(); setNotice('Espaço alterado.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível alterar o espaço.'); }
    finally { setBusy(false); }
  }
  async function execute(name: string, args: Record<string, unknown>) {
    if (!workspace) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await ledgerRpc(name, { p_space: workspace.space.id, ...args });
      setFormOpen(false); setNotice('Salvo. Os saldos foram atualizados.');
      await reloadData();
      setRetryId(crypto.randomUUID());
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || busy) return;
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? '').trim();
    const amount = () => { const cents = parseBrlCents(text('amount')); if (cents <= 0) throw new Error('O valor deve ser maior que zero.'); return cents; };
    const account = workspace.accounts.find(item => item.id === text('account'));
    try {
      if (section === 'accounts') await execute('create_financial_account', { p_name: text('name'), p_kind: text('type'), p_opening_cents: parseBrlCents(text('amount') || '0'), p_opening_on: text('date') });
      else if (section === 'people') await execute('create_person', { p_nickname: text('name') });
      else if (section === 'cards') await execute('create_credit_card', { p_name: text('name'), p_limit_cents: amount(), p_closing_day: Number(text('closing')), p_due_day: Number(text('due')), p_payment_account: account?.id ?? null });
      else if (section === 'budgets') await execute('create_budget', { p_payload: { category_id: text('category'), amount_cents: amount(), effective_from_month: `${text('month')}-01` } });
      else if (section === 'agenda') await execute('create_commitment', { p_payload: agendaKind==='reminder' ? {kind:'reminder',title:text('name'),due_on:text('date'),person_id:text('person')} : { title: text('name'), direction: text('kind'), certainty: text('certainty'), amount_cents: amount(), due_on: text('date'),competence_month:`${text('competence')}-01`, category_id: text('category'), payment_method: text('kind')==='inflow'?'account':agendaMethod, payment_financial_account_id: text('kind')==='inflow'||agendaMethod==='account'?account?.id:null,payment_credit_card_id:text('kind')!=='inflow'&&agendaMethod==='card'?text('card'):null } });
      else if (section === 'transactions') {
        const category = workspace.categories.find(item => item.id === text('category'));
        if (kind === 'card_purchase') await execute('record_card_purchase', { p_card: text('card'), p_category: category?.id, p_total_cents: amount(), p_installments: Number(text('installments')), p_on: text('date'), p_description: text('name'), p_client_uuid: retryId, p_reserve:text('reserve') || null });
        else if (kind === 'card_payment') await execute('pay_card', { p_card: text('card'), p_origin_ledger: account?.ledger_account_id, p_amount_cents: amount(), p_on: text('date'), p_channel: text('channel'), p_client_uuid: retryId });
        else if (kind === 'transfer') await execute('transfer_between_accounts', { p_from: account?.id, p_to: text('destination'), p_amount_cents: amount(), p_occurred_on: text('date'), p_client_uuid: retryId });
        else {
          if (!category?.ledger_account_id || !account) throw new Error('Escolha uma conta e uma categoria final.');
          const cents = amount(), sign = kind === 'income' ? -1 : 1;
          await execute('post_transaction', { p_payload: { kind, occurred_on: text('date'), competence_month: `${text('date').slice(0,7)}-01`, description: text('name'), client_uuid: retryId,
            entries: [{ ledger_account_id: category.ledger_account_id, amount_cents: sign*cents,reserve_id:kind === 'expense' ? text('reserve') || null : null }, { ledger_account_id: account.ledger_account_id, amount_cents: -sign*cents }] } });
        }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verifique os campos.'); }
  }
  const canWrite = workspace?.role !== 'viewer' && online && !usingCache;
  const canManage = !!workspace && ['owner','admin'].includes(workspace.role) && online && !usingCache;
  const extraSection = ['tags','recurrences','settings','audit','portfolio','closing','reserves','notifications','reports','health','imports','agenda','sharing','budgets','foreign_currency','forecast'].includes(section);
  const categoryOptions = workspace?.categories.filter(c => (section === 'budgets' || c.ledger_account_id) && c.kind === (section === 'agenda' ? kind === 'inflow' ? 'income' : 'expense' : kind === 'income' ? 'income' : 'expense')) ?? [];
  const field = (label: string, content: ReactElement<{ id?: string }>) => {
    const id = `${section}-${label.replace(/[^a-zA-Z0-9]/g,'-')}`;
    return <div className="grid gap-1.5 text-sm font-medium"><label htmlFor={id}>{label}</label>{cloneElement(content,{ id })}</div>;
  };
  const accountField = (name = 'account', label = 'Conta') => field(label,<select name={name} required className={inputClass} defaultValue=""><option value="" disabled>Selecione uma conta</option>{workspace?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>);
  const categoryField = () => field('Categoria',<select name="category" required className={inputClass} defaultValue=""><option value="" disabled>Selecione uma categoria</option>{categoryOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>);
  return <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <div><p className="font-bold">Finanças</p>{workspace && spaces.length > 1 ? <select aria-label="Espaço financeiro ativo" value={workspace.space.id} disabled={busy || !online || usingCache} onChange={event => void switchSpace(event.target.value)} className="mt-1 max-w-64 rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700">{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select> : <p className="text-xs text-slate-500">{workspace?.space.name ?? 'Carregando seu espaço'}</p>}</div>
      <div className="flex gap-3"><button onClick={togglePrivacy} className="text-sm">{privacy ? 'Mostrar valores' : 'Ocultar valores'}</button><button onClick={() => void refresh()} disabled={busy} aria-label="Atualizar"><RefreshCw size={18}/></button><button onClick={() => void logout()} aria-label="Sair"><LogOut size={18}/></button></div>
    </header>
    {(!online || usingCache) && <div role="status" className="sticky top-0 z-20 bg-amber-100 px-5 py-3 text-sm text-amber-950">Sem conexão{cacheTime ? ` · atualizado em ${new Date(cacheTime).toLocaleString('pt-BR')}` : ''}. Os valores são os últimos recebidos do servidor.</div>}
    {logoutCount!==null && <div role="dialog" aria-label="Sair com lançamentos não enviados" className="mx-auto mt-4 max-w-3xl space-y-3 rounded-xl border border-amber-300 bg-white p-5 dark:bg-slate-900"><p>Você tem {logoutCount} lançamentos não enviados. Se sair agora, eles serão apagados deste aparelho.</p><div className="flex flex-wrap gap-4 text-sm font-semibold"><button disabled={!online} onClick={() => { void sendLocalQueue().then(async () => { setLogoutCount((await offlineQueue.list(await activeUserId())).length); }).catch(failure => setError(failure.message)); }}>Enviar antes de sair</button><button onClick={() => { void clearLocalData().then(() => supabase.auth.signOut()).catch(failure => setError(failure.message)); }}>Sair e apagar do aparelho</button><button onClick={() => setLogoutCount(null)}>Cancelar saída</button></div></div>}
    <div className="grid w-full gap-6 p-4 md:grid-cols-[210px_minmax(0,1fr)] md:p-6">
      <nav className="flex gap-1 overflow-x-auto md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:flex-col md:self-start md:overflow-y-auto" aria-label="Navegação principal">{navigation.map(item => <Fragment key={item.id}>{navigationGroups[item.id] && <p className="hidden px-4 pb-1 pt-3 text-xs font-medium text-slate-500 md:block">{navigationGroups[item.id]}</p>}<button onClick={() => navigate(item.id)} aria-current={section === item.id ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm font-medium ${section === item.id ? 'bg-teal-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}><item.icon size={18} className="shrink-0"/>{item.label}</button></Fragment>)}</nav>
      <main className="min-w-0 space-y-5">
        <div className="workspace-header flex flex-wrap items-center justify-between gap-3"><PageHeader icon={navigation.find(n => n.id === section)?.icon ?? LayoutDashboard} title={navigation.find(n => n.id === section)?.label.replace(/^\d\. /,'') ?? 'Finanças'} subtitle={section === 'categories' ? 'Organize receitas e despesas por categoria' : undefined} />{canWrite && workspace && !['dashboard','categories'].includes(section) && (!extraSection || ['agenda','budgets'].includes(section)) && (!['accounts','categories','cards','budgets'].includes(section) || canManage) && <button onClick={openForm} className="flex items-center gap-2 btn-primary px-4 py-2.5 text-sm font-semibold text-white"><Plus size={18}/>Cadastrar</button>}</div>
        {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
        {!workspace && <div className={panelClass}>{busy ? 'Carregando…' : 'Não foi possível abrir seus dados. Use Atualizar para tentar novamente.'}</div>}
        {workspace && section !== 'categories' && <LedgerQuickEntry key={workspace.space.id} workspace={workspace} money={money} onChanged={reloadData}/>}
        {workspace && section !== 'categories' && formOpen && <form onSubmit={submit} className={`${panelClass} grid gap-4 sm:grid-cols-2`}>
          {['accounts','cards','people','transactions','agenda'].includes(section) && !['card_payment'].includes(kind) && field('Nome ou descrição',<input name="name" required maxLength={100} className={inputClass}/>)}
          {section === 'accounts' && field('Tipo',<select name="type" className={inputClass}><option value="checking">Conta corrente</option><option value="payment">Conta de pagamento</option><option value="wallet">Carteira</option><option value="savings">Poupança</option><option value="benefit">Benefício VR/VA</option><option value="investment">Investimento</option><option value="property">Bem</option></select>)}
          {section === 'transactions' && field('Operação',<select value={kind} onChange={e => setKind(e.target.value)} className={inputClass}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option><option value="card_purchase">Compra no cartão</option><option value="card_payment">Pagamento do cartão</option></select>)}
          {section === 'agenda' && <>{field('Tipo de item da Agenda',<select value={agendaKind} onChange={e=>setAgendaKind(e.target.value)} className={inputClass}><option value="one_off">Compromisso a pagar ou receber</option><option value="reminder">Lembrete ligado a uma pessoa</option></select>)}{agendaKind==='reminder'?field('Pessoa do lembrete',<select name="person" required defaultValue="" className={inputClass}><option value="">Selecione uma pessoa</option>{workspace.people.map(person=><option key={person.id} value={person.id}>{person.nickname}</option>)}</select>):<>{field('Direção',<select name="kind" value={kind === 'inflow' ? 'inflow' : 'outflow'} onChange={e => setKind(e.target.value)} className={inputClass}><option value="outflow">A pagar</option><option value="inflow">A receber</option></select>)}{field('Valor previsto',<select name="certainty" className={inputClass}><option value="confirmed">Confirmado</option><option value="estimated">Estimado</option>{kind === 'inflow' && <option value="conditional">Condicional</option>}</select>)}{kind!=='inflow'&&field('Meio de pagamento do compromisso',<select value={agendaMethod} onChange={event=>setAgendaMethod(event.target.value)} className={inputClass}><option value="account">Conta</option><option value="card">Cartão</option></select>)}{field('Competência do compromisso',<input name="competence" type="month" defaultValue={workspace.space.today.slice(0,7)} required className={inputClass}/>)}{agendaMethod==='card'&&kind!=='inflow'&&field('Cartão do compromisso',<select name="card" required className={inputClass}><option value="">Selecione</option>{workspace.cards.map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select>)}</>}</>}
          {['cards','transactions','agenda'].includes(section) && kind !== 'card_purchase' && (section!=='agenda'||agendaKind!=='reminder'&&(agendaMethod==='account'||kind==='inflow')) && accountField()}
          {section === 'transactions' && kind === 'transfer' && accountField('destination','Conta de destino')}
          {(section === 'agenda'&&agendaKind!=='reminder' || section === 'budgets' || section === 'transactions' && !['transfer','card_payment'].includes(kind)) && categoryField()}
          {section === 'transactions' && ['expense','card_purchase'].includes(kind) && field('Usar uma meta (opcional)',<select name="reserve" className={inputClass}><option value="">Gasto sem vínculo com uma meta</option>{reserveSummary?.reserves.filter(reserve => reserve.reserve_type === 'goal' && ['active','achieved'].includes(reserve.status)).map(reserve => <option key={reserve.id} value={reserve.id}>{reserve.name} · {money(reserve.balance_cents)}</option>)}</select>)}
          {section === 'transactions' && ['card_purchase','card_payment'].includes(kind) && field('Cartão',<select name="card" required className={inputClass}><option value="">Selecione</option>{workspace.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
          {section === 'transactions' && kind === 'card_purchase' && field('Parcelas',<input name="installments" type="number" min="1" max="600" defaultValue="1" required className={inputClass}/>)}
          {section === 'transactions' && kind === 'card_payment' && field('Meio de pagamento',<select name="channel" className={inputClass}><option value="pix">Pix</option><option value="boleto">Boleto</option></select>)}
          {['accounts','cards','transactions','agenda','budgets'].includes(section) && (section!=='agenda'||agendaKind!=='reminder') && field(section === 'accounts' ? 'Saldo inicial (R$)' : section === 'cards' ? 'Limite (R$)' : 'Valor (R$)',<input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={section === 'accounts' ? '0,00' : undefined} required className={inputClass}/>)}
          {['accounts','transactions','agenda'].includes(section) && field(section === 'agenda' ? 'Vencimento' : 'Data',<input name="date" type="date" defaultValue={workspace.space.today} required className={inputClass}/>)}
          {section === 'cards' && <>{field('Dia de fechamento',<input name="closing" type="number" min="1" max="31" required className={inputClass}/>)}{field('Dia de vencimento',<input name="due" type="number" min="1" max="31" required className={inputClass}/>)}</>}
          {section === 'budgets' && field('A partir do mês',<input name="month" type="month" defaultValue={workspace.space.today.slice(0,7)} required className={inputClass}/>)}
          <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className="btn-primary px-5 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button><button type="button" onClick={() => setFormOpen(false)}>Cancelar</button></div>
        </form>}
        {workspace && section === 'dashboard' && <>
          <LedgerFreeToSpend workspace={workspace} money={money} offline={!online || usingCache}/>
          {online && !usingCache && <LedgerDashboardSummary workspace={workspace} money={money} privacy={privacy}/>}
          <div className="grid gap-4 sm:grid-cols-3">{[{ label:'Saldo em contas',value:workspace.totals.cash_cents, detail:'Contas corrente, de pagamento e carteiras, até hoje.' },{ label:'Limite utilizado',value:workspace.totals.card_used_cents, detail:'Dívidas e autorizações pendentes dos cartões.' },{ label:'Contas a pagar',value:workspace.totals.commitment_outflows_cents, detail:'Compromissos pendentes e parcialmente pagos.' }].map(item => <div key={item.label} className={panelClass}><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-2xl font-semibold">{money(item.value)}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></div>)}</div>
          {workspace.accounts.some(a => a.liquidity !== 'cash') && <div className={panelClass}><h2 className="font-semibold">Outros saldos</h2><p className="mt-1 text-sm text-slate-500">Benefícios, investimentos e bens são acompanhados separadamente do saldo em contas.</p><div className="mt-4 grid gap-4 sm:grid-cols-3">{[{ liquidity:'benefit',label:'Benefícios VR/VA',value:workspace.totals.benefit_cents },{ liquidity:'investment',label:'Investimentos e poupança',value:workspace.totals.investment_cents },{ liquidity:'property',label:'Bens',value:workspace.totals.property_cents }].filter(item => workspace.accounts.some(a => a.liquidity === item.liquidity)).map(item => <div key={item.liquidity}><p className="text-sm text-slate-500">{item.label}</p><p className="mt-1 text-xl font-semibold">{money(item.value)}</p></div>)}</div></div>}
          <div className={panelClass}><h2 className="font-semibold">Comece pelos cadastros</h2><p className="mt-2 text-sm text-slate-500">Cadastre suas contas e os saldos atuais. Depois organize as categorias, adicione seus cartões e registre as movimentações.</p><button onClick={() => navigate('accounts')} className="mt-4 btn-primary px-4 py-2 text-sm font-semibold text-white">Cadastrar uma conta</button></div>
        </>}
        {workspace && (!online || usingCache) && extraSection && <p className={panelClass}>Sem conexão. Esta tela precisa de internet. Você pode cadastrar um lançamento rápido acima.</p>}
        {workspace && online && !usingCache && <>
          {['accounts','categories','settings'].includes(section) && <LedgerManagement key={`management-${workspace.space.id}-${section}`} section={section as 'accounts' | 'categories' | 'settings'} workspace={workspace} money={money} onChanged={refresh}/>}
          {extraSection && !['portfolio','closing','reserves','notifications','reports','health','imports','agenda','sharing','budgets','foreign_currency','forecast'].includes(section) && <LedgerExtras key={`${workspace.space.id}-${section}`} section={section as ExtraSection} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'budgets' && <LedgerBudgets key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'people' && <LedgerPeople key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh} onAgenda={()=>navigate('agenda')}/>}
          {section === 'foreign_currency' && <LedgerForeignCurrency key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'sharing' && <LedgerSharing key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'agenda' && <LedgerAgenda key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'imports' && <LedgerImports key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'reports' && <LedgerReports key={workspace.space.id} workspace={workspace} money={money} privacy={privacy}/>}
          {section === 'health' && <LedgerFinancialHealth key={workspace.space.id} workspace={workspace} money={money} privacy={privacy}/>}
          {section === 'forecast' && <LedgerCashForecast key={workspace.space.id} workspace={workspace} money={money} privacy={privacy}/>}
          {section === 'reserves' && <><LedgerReserves workspace={workspace} money={money} onChanged={refresh}/><LedgerReservePlan workspace={workspace} money={money} onChanged={refresh}/></>}
          {section === 'notifications' && <LedgerNotifications key={workspace.space.id} workspace={workspace} money={money} onNavigate={navigate}/>}
          {section === 'portfolio' && <LedgerPortfolio workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'closing' && <LedgerClosing workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'transactions' && selectedTransaction && <LedgerTransactionActions key={selectedTransaction} workspace={workspace} transactionId={selectedTransaction} money={money} onChanged={refresh} onClose={() => setSelectedTransaction(null)}/>}
          {section === 'cards' && <><LedgerCardManagement key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/><LedgerCardOperations workspace={workspace} money={money} onChanged={refresh}/></>}
        </>}
        {workspace && section === 'categories' && (!online || usingCache) && <CategoryPanels categories={workspace.categories} />}
        {workspace && !['dashboard','categories'].includes(section) && !extraSection && (!online || usingCache || !['accounts','categories','people'].includes(section)) && <div className={`${panelClass} space-y-3`}>
          {section === 'accounts' && workspace.accounts.map(a => <Row key={a.id} title={a.name} detail="Saldo atual" value={money(a.balance_cents)}/>)}
          {section === 'cards' && workspace.cards.map(c => <Row key={c.id} title={c.name} detail={`Utilizado: ${money(c.used_cents)}`} value={`Disponível: ${money(c.free_cents)}`}/>)}
          {section === 'people' && workspace.people.map(p => <Row key={p.id} title={p.nickname} detail={p.balance_cents >= 0 ? 'A receber' : 'A pagar'} value={money(Math.abs(p.balance_cents))}/>)}
          {section === 'transactions' && workspace.transactions.map(t => <div key={t.id}><Row title={t.description} detail={t.occurred_on} value={t.status === 'cancelled' ? 'Cancelado' : 'Registrado'}/>{online && !usingCache && <button onClick={() => setSelectedTransaction(t.id)} className="text-sm font-semibold text-teal-600" aria-label={`Ver detalhes de ${t.description}`}>Detalhes e ações</button>}</div>)}
          {section === 'agenda' && workspace.commitments.map(c => <div key={c.id}><Row title={c.title} detail={c.effective_due_on} value={c.settlement_status === 'settled' ? 'Pago' : c.settlement_status === 'cancelled' ? 'Cancelado' : money(c.remaining_cents ?? 0)}/>{canWrite && c.kind !== 'reminder' && ['pending','partial'].includes(c.settlement_status) && <button disabled={busy} onClick={() => void execute('settle_commitment',{ p_commitment:c.id,p_amount_cents:c.remaining_cents,p_on:workspace.space.today,p_client_uuid:crypto.randomUUID() })} className="mt-2 text-sm font-semibold text-teal-600">Registrar pagamento integral</button>}</div>)}
          {section === 'budgets' && workspace.budgets.map(b => <Row key={b.id} title={workspace.categories.find(c => c.id === b.category_id)?.name ?? 'Orçamento'} detail={`Gasto: ${money(b.consumed_cents)} · Previsto: ${money(b.predicted_cents)}`} value={`Restante: ${money(b.remaining_cents)}`}/>)}
          {(section === 'accounts' ? workspace.accounts : section === 'categories' ? workspace.categories : section === 'cards' ? workspace.cards : section === 'people' ? workspace.people : section === 'transactions' ? workspace.transactions : section === 'agenda' ? workspace.commitments : workspace.budgets).length === 0 && <p className="text-sm text-slate-500">Nenhum registro. Use Cadastrar para começar.</p>}
        </div>}
      </main>
    </div>
  </div>;
}
function Row({ title, detail, value }: { title: string; detail: string; value: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800"><div><p className="font-medium">{title}</p><p className="text-sm text-slate-500">{detail}</p></div><span className="text-sm font-semibold">{value}</span></div>;
}
