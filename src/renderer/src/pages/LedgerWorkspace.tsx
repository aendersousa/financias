import Brand from '../components/Brand';
import AccountTable, { accountKindLabels } from '../components/AccountTable';
import CardTable from '../components/CardTable';
import PeopleTable from '../components/PeopleTable';
import CategoryPanels from '../components/CategoryPanels';
import PageHeader from '../components/PageHeader';
import { cloneElement, Fragment, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeftRight, Bell, CalendarDays, CreditCard, Eye, EyeOff, History, LayoutDashboard, LogOut, Plus, RefreshCw, Repeat, Settings, Tags, Users, Wallet } from 'lucide-react';
import { formatBrlCents, parseBrlCents } from '../../../shared/finance/money';
import { ledgerRpc, loadLedgerWorkspace, selectFinancialSpace, type FinancialSpace, type LedgerWorkspace as Workspace, type UserSettings } from '../lib/ledgerRepository';
import LedgerExtras, { type ExtraSection } from './LedgerExtras';
import LedgerCardOperations from './LedgerCardOperations';
import LedgerPortfolio from './LedgerPortfolio';
import LedgerClosing from './LedgerClosing';
import LedgerTransactions from './LedgerTransactions';
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
    const change=() => { setOnline(navigator.onLine); setFormOpen(false); if (navigator.onLine) void refresh(); };
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
  function navigate(next: Section) { setSection(next); setFormOpen(false); setNotice(''); setKind('expense'); }
  function openForm() { setAgendaKind('one_off'); setAgendaMethod('account'); setFormOpen(true); setNotice(''); setError(''); }
  async function switchSpace(id: string) {
    ++workspaceLoadSequence.current;
    setBusy(true); setError(''); setFormOpen(false);
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
      if (section === 'budgets') await execute('create_budget', { p_payload: { category_id: text('category'), amount_cents: amount(), effective_from_month: `${text('month')}-01` } });
      else if (section === 'agenda') await execute('create_commitment', { p_payload: agendaKind==='reminder' ? {kind:'reminder',title:text('name'),due_on:text('date'),person_id:text('person')} : { title: text('name'), direction: text('kind'), certainty: text('certainty'), amount_cents: amount(), due_on: text('date'),competence_month:`${text('competence')}-01`, category_id: text('category'), payment_method: text('kind')==='inflow'?'account':agendaMethod, payment_financial_account_id: text('kind')==='inflow'||agendaMethod==='account'?account?.id:null,payment_credit_card_id:text('kind')!=='inflow'&&agendaMethod==='card'?text('card'):null } });
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
  return <div className="walletup-app min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="app-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <Brand />
        {workspace && spaces.length > 1 ? (
          <select
            aria-label="Espaço financeiro ativo"
            value={workspace.space.id}
            disabled={busy || !online || usingCache}
            onChange={event => void switchSpace(event.target.value)}
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span>{workspace?.space.name ?? 'Carregando seu espaço'}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={togglePrivacy}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {privacy ? <EyeOff size={15} /> : <Eye size={15} />}
          <span>{privacy ? 'Mostrar valores' : 'Ocultar valores'}</span>
        </button>
        <button
          onClick={() => void refresh()}
          disabled={busy}
          aria-label="Atualizar"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => void logout()}
          aria-label="Sair"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-red-900/50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
    {(!online || usingCache) && <div role="status" className="sticky top-0 z-20 bg-amber-100 px-5 py-3 text-sm text-amber-950">Sem conexão{cacheTime ? ` · atualizado em ${new Date(cacheTime).toLocaleString('pt-BR')}` : ''}. Os valores são os últimos recebidos do servidor.</div>}
    {logoutCount!==null && <div role="dialog" aria-label="Sair com lançamentos não enviados" className="mx-auto mt-4 max-w-3xl space-y-3 rounded-xl border border-amber-300 bg-white p-5 dark:bg-slate-900"><p>Você tem {logoutCount} lançamentos não enviados. Se sair agora, eles serão apagados deste aparelho.</p><div className="flex flex-wrap gap-4 text-sm font-semibold"><button disabled={!online} onClick={() => { void sendLocalQueue().then(async () => { setLogoutCount((await offlineQueue.list(await activeUserId())).length); }).catch(failure => setError(failure.message)); }}>Enviar antes de sair</button><button onClick={() => { void clearLocalData().then(() => supabase.auth.signOut()).catch(failure => setError(failure.message)); }}>Sair e apagar do aparelho</button><button onClick={() => setLogoutCount(null)}>Cancelar saída</button></div></div>}
    <div className="grid w-full gap-6 p-4 md:grid-cols-[210px_minmax(0,1fr)] md:p-6">
      <nav className="flex gap-1 overflow-x-auto md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:flex-col md:self-start md:overflow-y-auto" aria-label="Navegação principal">{navigation.map(item => <Fragment key={item.id}>{navigationGroups[item.id] && <p className="hidden px-4 pb-1 pt-3 text-xs font-medium text-slate-500 md:block">{navigationGroups[item.id]}</p>}<button onClick={() => navigate(item.id)} aria-current={section === item.id ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm font-medium ${section === item.id ? 'nav-active' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}><item.icon size={18} className="shrink-0"/>{item.label}</button></Fragment>)}</nav>
      <main className="min-w-0 space-y-5">
        <div className="workspace-header flex flex-wrap items-center justify-between gap-3"><PageHeader icon={navigation.find(n => n.id === section)?.icon ?? LayoutDashboard} title={navigation.find(n => n.id === section)?.label.replace(/^\d\. /,'') ?? 'WalletUp'} subtitle={section === 'categories' ? 'Organize receitas e despesas por categoria' : section === 'accounts' ? 'Suas contas bancárias, carteiras e investimentos' : section === 'cards' ? 'Seus cartões de crédito, limites e faturas' : section === 'people' ? 'Contatos, valores a receber e pagamentos' : section === 'sharing' ? 'Membros, permissões e divisão das despesas' : section === 'transactions' ? 'Receitas, despesas e transferências do seu espaço' : section === 'foreign_currency' ? 'Compras em outras moedas e confirmação do valor em reais' : section === 'imports' ? 'Importe, revise e confira os lançamentos do extrato' : undefined} />{canWrite && workspace && !['dashboard','categories','accounts','cards','people','transactions'].includes(section) && (!extraSection || ['agenda','budgets'].includes(section)) && (!['accounts','categories','cards','budgets'].includes(section) || canManage) && <button onClick={openForm} className="flex items-center gap-2 btn-primary px-4 py-2.5 text-sm font-semibold text-white"><Plus size={18}/>Cadastrar</button>}</div>
        {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
        {!workspace && <div className={panelClass}>{busy ? 'Carregando…' : 'Não foi possível abrir seus dados. Use Atualizar para tentar novamente.'}</div>}
        {workspace && !['categories','accounts','cards','people','sharing','transactions','foreign_currency','imports'].includes(section) && <LedgerQuickEntry key={workspace.space.id} workspace={workspace} money={money} onChanged={reloadData}/>}
        {workspace && !['categories','accounts','cards','people','sharing','transactions','foreign_currency','imports'].includes(section) && formOpen && <form onSubmit={submit} className={`${panelClass} grid gap-4 sm:grid-cols-2`}>
          {section === 'agenda' && !['card_payment'].includes(kind) && field('Nome ou descrição',<input name="name" required maxLength={100} className={inputClass}/>)}
          {section === 'agenda' && <>{field('Tipo de item da Agenda',<select value={agendaKind} onChange={e=>setAgendaKind(e.target.value)} className={inputClass}><option value="one_off">Compromisso a pagar ou receber</option><option value="reminder">Lembrete ligado a uma pessoa</option></select>)}{agendaKind==='reminder'?field('Pessoa do lembrete',<select name="person" required defaultValue="" className={inputClass}><option value="">Selecione uma pessoa</option>{workspace.people.map(person=><option key={person.id} value={person.id}>{person.nickname}</option>)}</select>):<>{field('Direção',<select name="kind" value={kind === 'inflow' ? 'inflow' : 'outflow'} onChange={e => setKind(e.target.value)} className={inputClass}><option value="outflow">A pagar</option><option value="inflow">A receber</option></select>)}{field('Valor previsto',<select name="certainty" className={inputClass}><option value="confirmed">Confirmado</option><option value="estimated">Estimado</option>{kind === 'inflow' && <option value="conditional">Condicional</option>}</select>)}{kind!=='inflow'&&field('Meio de pagamento do compromisso',<select value={agendaMethod} onChange={event=>setAgendaMethod(event.target.value)} className={inputClass}><option value="account">Conta</option><option value="card">Cartão</option></select>)}{field('Competência do compromisso',<input name="competence" type="month" defaultValue={workspace.space.today.slice(0,7)} required className={inputClass}/>)}{agendaMethod==='card'&&kind!=='inflow'&&field('Cartão do compromisso',<select name="card" required className={inputClass}><option value="">Selecione</option>{workspace.cards.map(card=><option key={card.id} value={card.id}>{card.name}</option>)}</select>)}</>}</>}
          {section === 'agenda' && kind !== 'card_purchase' && (section!=='agenda'||agendaKind!=='reminder'&&(agendaMethod==='account'||kind==='inflow')) && accountField()}
          {(section === 'agenda'&&agendaKind!=='reminder' || section === 'budgets') && categoryField()}
          {['agenda','budgets'].includes(section) && (section!=='agenda'||agendaKind!=='reminder') && field('Valor (R$)',<input name="amount" inputMode="decimal" placeholder="0,00" required className={inputClass}/>)}
          {section === 'agenda' && field(section === 'agenda' ? 'Vencimento' : 'Data',<input name="date" type="date" defaultValue={workspace.space.today} required className={inputClass}/>)}
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
        {workspace && (!online || usingCache) && extraSection && <p className={panelClass}>{['sharing','foreign_currency','imports'].includes(section) ? 'Sem conexão. Esta tela precisa de internet. Consulte os lançamentos salvos ou registre um lançamento rápido na aba Lançamentos.' : 'Sem conexão. Esta tela precisa de internet. Você pode cadastrar um lançamento rápido acima.'}</p>}
        {workspace && section === 'transactions' && <LedgerTransactions key={workspace.space.id} workspace={workspace} money={money} reserves={reserveSummary} online={online&&!usingCache} onChanged={reloadData}/>}
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
          {section === 'cards' && <><LedgerCardManagement key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/><LedgerCardOperations workspace={workspace} money={money} onChanged={refresh}/></>}
        </>}
        {workspace && section === 'accounts' && (!online || usingCache) && <AccountTable accounts={workspace.accounts.map(account => ({ ...account, type: accountKindLabels[account.kind] ?? account.kind, balance: money(account.balance_cents) }))} />}
        {workspace && section === 'cards' && (!online || usingCache) && <CardTable cards={workspace.cards.map(card => ({ ...card, limit: money(card.granted_cents), used: money(card.used_cents), available: money(card.free_cents) }))} />}
        {workspace && section === 'people' && (!online || usingCache) && <PeopleTable people={workspace.people.filter(person => !person.archived_at)} money={money} />}
        {workspace && section === 'categories' && (!online || usingCache) && <CategoryPanels categories={workspace.categories} />}
        {workspace && !['dashboard','categories','accounts','cards','people','transactions'].includes(section) && !extraSection && (!online || usingCache || !['accounts','categories'].includes(section)) && <div className={`${panelClass} space-y-3`}>
          {section === 'agenda' && workspace.commitments.map(c => <div key={c.id}><Row title={c.title} detail={c.effective_due_on} value={c.settlement_status === 'settled' ? 'Pago' : c.settlement_status === 'cancelled' ? 'Cancelado' : money(c.remaining_cents ?? 0)}/>{canWrite && c.kind !== 'reminder' && ['pending','partial'].includes(c.settlement_status) && <button disabled={busy} onClick={() => void execute('settle_commitment',{ p_commitment:c.id,p_amount_cents:c.remaining_cents,p_on:workspace.space.today,p_client_uuid:crypto.randomUUID() })} className="mt-2 text-sm font-semibold text-brand-600">Registrar pagamento integral</button>}</div>)}
          {section === 'budgets' && workspace.budgets.map(b => <Row key={b.id} title={workspace.categories.find(c => c.id === b.category_id)?.name ?? 'Orçamento'} detail={`Gasto: ${money(b.consumed_cents)} · Previsto: ${money(b.predicted_cents)}`} value={`Restante: ${money(b.remaining_cents)}`}/>)}
          {(section === 'agenda' ? workspace.commitments : workspace.budgets).length === 0 && <p className="text-sm text-slate-500">Nenhum registro. Use Cadastrar para começar.</p>}
        </div>}
      </main>
    </div>
  </div>;
}
function Row({ title, detail, value }: { title: string; detail: string; value: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800"><div><p className="font-medium">{title}</p><p className="text-sm text-slate-500">{detail}</p></div><span className="text-sm font-semibold">{value}</span></div>;
}
