import Brand from '../components/Brand';
import AccountTable, { accountKindLabels } from '../components/AccountTable';
import CardTable from '../components/CardTable';
import PeopleTable from '../components/PeopleTable';
import CategoryPanels from '../components/CategoryPanels';
import PageHeader from '../components/PageHeader';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Bell, CalendarDays, CreditCard, Eye, EyeOff, History, LayoutDashboard, LogOut, RefreshCw, Repeat, Settings, Tags, Users, Wallet } from 'lucide-react';
import { formatBrlCents } from '../../../shared/finance/money';
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
  { id: 'settings', label: 'Configurações', icon: Settings }
] as const;
const panelClass = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
const itemGroupMap: Partial<Record<Section, string>> = {
  accounts: 'Cadastre nesta ordem',
  categories: 'Cadastre nesta ordem',
  cards: 'Cadastre nesta ordem',
  people: 'Cadastre nesta ordem',
  sharing: 'Cadastre nesta ordem',
  transactions: 'Movimentações',
  foreign_currency: 'Movimentações',
  imports: 'Movimentações',
  agenda: 'Planejamento',
  forecast: 'Planejamento',
  budgets: 'Planejamento',
  reserves: 'Planejamento',
  recurrences: 'Planejamento',
  portfolio: 'Planejamento',
  reports: 'Acompanhamento',
  health: 'Acompanhamento',
  closing: 'Acompanhamento',
  tags: 'Organização'
};
const planningSections: Section[] = ['agenda','forecast','budgets','reserves','recurrences','portfolio'];
const sectionDescriptions: Partial<Record<Section,string>> = {
  categories:'Organize receitas e despesas por categoria', accounts:'Suas contas bancárias, carteiras e investimentos',
  cards:'Seus cartões de crédito, limites e faturas', people:'Contatos, valores a receber e pagamentos',
  sharing:'Membros, permissões e divisão das despesas', transactions:'Receitas, despesas e transferências do seu espaço',
  foreign_currency:'Compras em outras moedas e confirmação do valor em reais', imports:'Importe, revise e confira os lançamentos do extrato',
  agenda:'Compromissos, vencimentos e lembretes do seu espaço', forecast:'Acompanhe o saldo previsto nas suas contas',
  budgets:'Limites de gastos por categoria e mês', reserves:'Organize suas metas, provisões e aportes',
  recurrences:'Receitas e despesas que se repetem', portfolio:'Investimentos, bens, empréstimos e financiamentos',
  notifications:'Alertas e avisos importantes sobre suas finanças',
  settings:'Personalização do app, preferências de conta e espaço financeiro',
  tags:'Tags e etiquetas para classificar lançamentos'
};

export default function LedgerWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [spaces, setSpaces] = useState<FinancialSpace[]>([]);
  const [reserveSummary,setReserveSummary] = useState<ReserveSummary | null>(null);
  const [section, setSection] = useState<Section>(() => location.hash.startsWith('#invite=') ? 'sharing' : 'dashboard');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [online,setOnline]=useState(navigator.onLine),[cacheTime,setCacheTime]=useState<string | null>(null),[usingCache,setUsingCache]=useState(false);
  const [logoutCount,setLogoutCount]=useState<number | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const preferencesInitialized = useRef(false);
  const workspaceLoadSequence = useRef(0);
  const privacy = useAppStore(s => s.privacyMode);
  const togglePrivacy = useAppStore(s => s.togglePrivacyMode);
  const money = (value: number) => privacy ? 'R$ ••••' : formatBrlCents(value);
  const disabledPages = useAppStore(s => s.disabledPages);
  const isPageEnabled = useAppStore(s => s.isPageEnabled);
  const isPageActive = (id: string) => id === 'settings' || isPageEnabled(id);
  const visibleNavigation = navigation.filter(item => isPageActive(item.id));

  const groupFirstId = new Set<string>();
  const seenGroups = new Set<string>();
  for (const item of visibleNavigation) {
    const grp = itemGroupMap[item.id];
    if (grp && !seenGroups.has(grp)) {
      groupFirstId.add(item.id);
      seenGroups.add(grp);
    }
  }

  useEffect(() => {
    if (section !== 'settings' && section !== 'notifications' && !isPageActive(section)) {
      const fallback = visibleNavigation.find(n => n.id !== 'settings')?.id ?? 'dashboard';
      setSection(fallback as Section);
    }
  }, [section, disabledPages]);

  async function reloadData() {
    const sequence=++workspaceLoadSequence.current;
    const next = await loadLedgerWorkspace();
    const [reserves, allSpaces, alerts] = await Promise.all([
      ledgerRpc<ReserveSummary>('reserve_summary',{ p_space:next.space.id }),
      ledgerRpc<FinancialSpace[]>('my_spaces', {}),
      ledgerRpc<{ unread_count: number }>('daily_alerts', { p_space: next.space.id }).catch(() => ({ unread_count: 0 }))
    ]);
    if(sequence!==workspaceLoadSequence.current) return;
    setWorkspace(next); setReserveSummary(reserves); setSpaces(allSpaces);
    setUnreadNotifications(alerts.unread_count);
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
    const change=() => { setOnline(navigator.onLine); if (navigator.onLine) void refresh(); };
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
  function navigate(next: Section) { setSection(next); setNotice(''); }
  async function switchSpace(id: string) {
    ++workspaceLoadSequence.current;
    setBusy(true); setError('');
    try { await selectFinancialSpace(id); await reloadData(); setNotice('Espaço alterado.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível alterar o espaço.'); }
    finally { setBusy(false); }
  }
  const extraSection = ['tags','recurrences','settings','audit','portfolio','closing','reserves','notifications','reports','health','imports','agenda','sharing','budgets','foreign_currency','forecast'].includes(section);
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
          type="button"
          onClick={() => navigate('notifications')}
          aria-label={`Notificações${unreadNotifications > 0 ? ` (${unreadNotifications} não lidas)` : ''}`}
          title="Central de notificações"
          className={`relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800 ${
            section === 'notifications'
              ? 'border-brand-500 text-brand-600 dark:border-brand-400 dark:text-brand-400'
              : ''
          }`}
        >
          <Bell size={15} />
          {unreadNotifications > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow ring-1 ring-white dark:ring-slate-900">
              {unreadNotifications > 99 ? '99+' : unreadNotifications}
            </span>
          )}
        </button>
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
      <nav className="flex gap-1 overflow-x-auto md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:flex-col md:self-start md:overflow-y-auto" aria-label="Navegação principal">{visibleNavigation.map(item => <Fragment key={item.id}>{groupFirstId.has(item.id) && itemGroupMap[item.id] && <p className="hidden px-4 pb-1 pt-3 text-xs font-medium text-slate-500 md:block">{itemGroupMap[item.id]}</p>}<button onClick={() => navigate(item.id)} aria-current={section === item.id ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm font-medium ${section === item.id ? 'nav-active' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}><item.icon size={18} className="shrink-0"/>{item.label}</button></Fragment>)}</nav>
      <main className="min-w-0 space-y-5">
        <div className="workspace-header flex flex-wrap items-center justify-between gap-3"><PageHeader icon={navigation.find(n => n.id === section)?.icon ?? (section === 'notifications' ? Bell : LayoutDashboard)} title={navigation.find(n => n.id === section)?.label.replace(/^\d\. /,'') ?? (section === 'notifications' ? 'Notificações' : 'WalletUp')} subtitle={sectionDescriptions[section]} /></div>
        {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
        {!workspace && <div className={panelClass}>{busy ? 'Carregando…' : 'Não foi possível abrir seus dados. Use Atualizar para tentar novamente.'}</div>}
        {workspace && !['categories','accounts','cards','people','sharing','transactions','foreign_currency','imports',...planningSections].includes(section) && <LedgerQuickEntry key={workspace.space.id} workspace={workspace} money={money} onChanged={reloadData}/>}
        {workspace && section === 'dashboard' && <>
          <LedgerFreeToSpend workspace={workspace} money={money} offline={!online || usingCache}/>
          {online && !usingCache && <LedgerDashboardSummary workspace={workspace} money={money} privacy={privacy}/>}
          <div className="grid gap-4 sm:grid-cols-3">{[{ label:'Saldo em contas',value:workspace.totals.cash_cents, detail:'Contas corrente, de pagamento e carteiras, até hoje.' },{ label:'Limite utilizado',value:workspace.totals.card_used_cents, detail:'Dívidas e autorizações pendentes dos cartões.' },{ label:'Contas a pagar',value:workspace.totals.commitment_outflows_cents, detail:'Compromissos pendentes e parcialmente pagos.' }].map(item => <div key={item.label} className={panelClass}><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-2xl font-semibold">{money(item.value)}</p><p className="mt-2 text-xs text-slate-500">{item.detail}</p></div>)}</div>
          {workspace.accounts.some(a => a.liquidity !== 'cash') && <div className={panelClass}><h2 className="font-semibold">Outros saldos</h2><p className="mt-1 text-sm text-slate-500">Benefícios, investimentos e bens são acompanhados separadamente do saldo em contas.</p><div className="mt-4 grid gap-4 sm:grid-cols-3">{[{ liquidity:'benefit',label:'Benefícios VR/VA',value:workspace.totals.benefit_cents },{ liquidity:'investment',label:'Investimentos e poupança',value:workspace.totals.investment_cents },{ liquidity:'property',label:'Bens',value:workspace.totals.property_cents }].filter(item => workspace.accounts.some(a => a.liquidity === item.liquidity)).map(item => <div key={item.liquidity}><p className="text-sm text-slate-500">{item.label}</p><p className="mt-1 text-xl font-semibold">{money(item.value)}</p></div>)}</div></div>}
          <div className={panelClass}><h2 className="font-semibold">Comece pelos cadastros</h2><p className="mt-2 text-sm text-slate-500">Cadastre suas contas e os saldos atuais. Depois organize as categorias, adicione seus cartões e registre as movimentações.</p><button onClick={() => navigate('accounts')} className="mt-4 btn-primary px-4 py-2 text-sm font-semibold text-white">Cadastrar uma conta</button></div>
        </>}
        {workspace && (!online || usingCache) && extraSection && <p className={panelClass}>{['sharing','foreign_currency','imports',...planningSections].includes(section) ? 'Sem conexão. Esta tela precisa de internet. Consulte os lançamentos salvos ou registre um lançamento rápido na aba Lançamentos.' : 'Sem conexão. Esta tela precisa de internet. Você pode cadastrar um lançamento rápido acima.'}</p>}
        {workspace && section === 'transactions' && <LedgerTransactions key={workspace.space.id} workspace={workspace} money={money} reserves={reserveSummary} online={online&&!usingCache} onChanged={reloadData}/>}
        {workspace && online && !usingCache && <>
          {['accounts','categories','settings'].includes(section) && <LedgerManagement key={`management-${workspace.space.id}-${section}`} section={section as 'accounts' | 'categories' | 'settings'} workspace={workspace} money={money} onChanged={refresh}/>}
          {['tags', 'recurrences'].includes(section) && <LedgerExtras key={`${workspace.space.id}-${section}`} section={section as ExtraSection} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'budgets' && <LedgerBudgets key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'people' && <LedgerPeople key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh} onAgenda={()=>navigate('agenda')}/>}
          {section === 'foreign_currency' && <LedgerForeignCurrency key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'sharing' && <LedgerSharing key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'agenda' && <LedgerAgenda key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'imports' && <LedgerImports key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'reports' && <LedgerReports key={workspace.space.id} workspace={workspace} money={money} privacy={privacy}/>}
          {section === 'health' && <LedgerFinancialHealth key={workspace.space.id} workspace={workspace} money={money} privacy={privacy}/>}
          {section === 'forecast' && <LedgerCashForecast key={workspace.space.id} workspace={workspace} money={money} privacy={privacy}/>}
          {section === 'reserves' && <><LedgerReserves key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/><LedgerReservePlan key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/></>}
          {section === 'notifications' && <LedgerNotifications key={workspace.space.id} workspace={workspace} money={money} onNavigate={navigate} onUpdateUnread={setUnreadNotifications}/>}
          {section === 'portfolio' && <LedgerPortfolio key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'closing' && <LedgerClosing workspace={workspace} money={money} onChanged={refresh}/>}
          {section === 'cards' && <><LedgerCardManagement key={workspace.space.id} workspace={workspace} money={money} onChanged={refresh}/><LedgerCardOperations workspace={workspace} money={money} onChanged={refresh}/></>}
        </>}
        {workspace && section === 'accounts' && (!online || usingCache) && <AccountTable accounts={workspace.accounts.map(account => ({ ...account, type: accountKindLabels[account.kind] ?? account.kind, balance: money(account.balance_cents) }))} />}
        {workspace && section === 'cards' && (!online || usingCache) && <CardTable cards={workspace.cards.map(card => ({ ...card, limit: money(card.granted_cents), used: money(card.used_cents), available: money(card.free_cents) }))} />}
        {workspace && section === 'people' && (!online || usingCache) && <PeopleTable people={workspace.people.filter(person => !person.archived_at)} money={money} />}
        {workspace && section === 'categories' && (!online || usingCache) && <CategoryPanels categories={workspace.categories} />}
      </main>
    </div>
  </div>;
}
