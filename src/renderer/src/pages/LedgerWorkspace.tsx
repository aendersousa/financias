import { cloneElement, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeftRight, CalendarDays, CreditCard, LayoutDashboard, LogOut, Plus, RefreshCw, Tags, Users, Wallet } from 'lucide-react';
import { formatBrlCents, parseBrlCents, sumCents } from '../../../shared/finance/money';
import { ledgerRpc, loadLedgerWorkspace, type LedgerWorkspace as Workspace } from '../lib/ledgerRepository';
import { supabase } from '../lib/supabaseClient';
import { useAppStore } from '../store/useAppStore';

type Section = 'dashboard' | 'accounts' | 'categories' | 'cards' | 'people' | 'transactions' | 'agenda' | 'budgets';
const navigation = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'accounts', label: '1. Contas', icon: Wallet },
  { id: 'categories', label: '2. Categorias', icon: Tags },
  { id: 'cards', label: '3. Cartões', icon: CreditCard },
  { id: 'people', label: 'Pessoas', icon: Users },
  { id: 'transactions', label: 'Lançamentos', icon: ArrowLeftRight },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'budgets', label: 'Orçamentos', icon: Wallet }
] as const;
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const panelClass = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';

export default function LedgerWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [section, setSection] = useState<Section>('dashboard');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState('expense');
  const [retryId, setRetryId] = useState(() => crypto.randomUUID());
  const privacy = useAppStore(s => s.privacyMode);
  const togglePrivacy = useAppStore(s => s.togglePrivacyMode);
  const money = (value: number) => privacy ? 'R$ ••••' : formatBrlCents(value);

  async function refresh() {
    setBusy(true); setError('');
    try { setWorkspace(await loadLedgerWorkspace()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar seus dados.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  function navigate(next: Section) { setSection(next); setFormOpen(false); setNotice(''); setKind('expense'); }
  function openForm() { setRetryId(crypto.randomUUID()); setFormOpen(true); setNotice(''); setError(''); }
  async function execute(name: string, args: Record<string, unknown>) {
    if (!workspace) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await ledgerRpc(name, { p_space: workspace.space.id, ...args });
      setFormOpen(false); setNotice('Salvo. Os saldos foram atualizados.');
      setWorkspace(await loadLedgerWorkspace());
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
      else if (section === 'categories') await execute('create_category', { p_name: text('name'), p_kind: text('kind'), p_parent: text('parent') || null, p_income_class: text('kind') === 'income' ? 'recurring' : null });
      else if (section === 'people') await execute('create_person', { p_nickname: text('name') });
      else if (section === 'cards') await execute('create_credit_card', { p_name: text('name'), p_limit_cents: amount(), p_closing_day: Number(text('closing')), p_due_day: Number(text('due')), p_payment_account: account?.id ?? null });
      else if (section === 'budgets') await execute('create_budget', { p_payload: { category_id: text('category'), amount_cents: amount(), effective_from_month: `${text('month')}-01` } });
      else if (section === 'agenda') await execute('create_commitment', { p_payload: { title: text('name'), direction: text('kind'), certainty: text('certainty'), amount_cents: amount(), due_on: text('date'), category_id: text('category'), payment_method: 'account', payment_financial_account_id: account?.id } });
      else if (section === 'transactions') {
        const category = workspace.categories.find(item => item.id === text('category'));
        if (kind === 'card_purchase') await execute('record_card_purchase', { p_card: text('card'), p_category: category?.id, p_total_cents: amount(), p_installments: Number(text('installments')), p_on: text('date'), p_description: text('name'), p_client_uuid: retryId });
        else if (kind === 'card_payment') await execute('pay_card', { p_card: text('card'), p_origin_ledger: account?.ledger_account_id, p_amount_cents: amount(), p_on: text('date'), p_channel: text('channel'), p_client_uuid: retryId });
        else if (kind === 'transfer') await execute('transfer_between_accounts', { p_from: account?.id, p_to: text('destination'), p_amount_cents: amount(), p_occurred_on: text('date'), p_client_uuid: retryId });
        else {
          if (!category?.ledger_account_id || !account) throw new Error('Escolha uma conta e uma categoria final.');
          const cents = amount(), sign = kind === 'income' ? -1 : 1;
          await execute('post_transaction', { p_payload: { kind, occurred_on: text('date'), competence_month: `${text('date').slice(0,7)}-01`, description: text('name'), client_uuid: retryId,
            entries: [{ ledger_account_id: category.ledger_account_id, amount_cents: sign*cents }, { ledger_account_id: account.ledger_account_id, amount_cents: -sign*cents }] } });
        }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verifique os campos.'); }
  }
  const canWrite = workspace?.role !== 'viewer';
  const categoryOptions = workspace?.categories.filter(c => c.ledger_account_id && c.kind === (section === 'agenda' ? kind === 'inflow' ? 'income' : 'expense' : kind === 'income' ? 'income' : 'expense')) ?? [];
  const field = (label: string, content: ReactElement<{ id?: string }>) => {
    const id = `${section}-${label.replace(/[^a-zA-Z0-9]/g,'-')}`;
    return <div className="grid gap-1.5 text-sm font-medium"><label htmlFor={id}>{label}</label>{cloneElement(content,{ id })}</div>;
  };
  const accountField = (name = 'account', label = 'Conta') => field(label,<select name={name} required className={inputClass} defaultValue=""><option value="" disabled>Selecione uma conta</option>{workspace?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>);
  const categoryField = () => field('Categoria',<select name="category" required className={inputClass} defaultValue=""><option value="" disabled>Selecione uma categoria</option>{categoryOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>);
  return <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <div><p className="font-bold">Finanças</p><p className="text-xs text-slate-500">{workspace?.space.name ?? 'Carregando seu espaço'}</p></div>
      <div className="flex gap-3"><button onClick={togglePrivacy} className="text-sm">{privacy ? 'Mostrar valores' : 'Ocultar valores'}</button><button onClick={() => void refresh()} disabled={busy} aria-label="Atualizar"><RefreshCw size={18}/></button><button onClick={() => void supabase.auth.signOut()} aria-label="Sair"><LogOut size={18}/></button></div>
    </header>
    <div className="mx-auto grid max-w-7xl gap-6 p-4 md:grid-cols-[210px_1fr] md:p-6">
      <nav className="flex gap-2 overflow-x-auto md:flex-col" aria-label="Navegação principal">{navigation.map(item => <button key={item.id} onClick={() => navigate(item.id)} aria-current={section === item.id ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ${section === item.id ? 'bg-teal-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}><item.icon size={18}/>{item.label}</button>)}</nav>
      <main className="min-w-0 space-y-5">
        <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{navigation.find(n => n.id === section)?.label.replace(/^\d\. /,'')}</h1>{canWrite && workspace && section !== 'dashboard' && <button onClick={openForm} className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={18}/>Cadastrar</button>}</div>
        {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
        {!workspace && <div className={panelClass}>{busy ? 'Carregando…' : 'Não foi possível abrir seus dados. Use Atualizar para tentar novamente.'}</div>}
        {workspace && formOpen && <form onSubmit={submit} className={`${panelClass} grid gap-4 sm:grid-cols-2`}>
          {['accounts','categories','cards','people','transactions','agenda'].includes(section) && !['card_payment'].includes(kind) && field('Nome ou descrição',<input name="name" required maxLength={100} className={inputClass}/>)}
          {section === 'accounts' && field('Tipo',<select name="type" className={inputClass}><option value="checking">Conta corrente</option><option value="wallet">Carteira</option><option value="savings">Poupança</option><option value="investment">Investimento</option></select>)}
          {section === 'categories' && <>{field('Tipo',<select name="kind" className={inputClass}><option value="expense">Despesa</option><option value="income">Receita</option></select>)}{field('Dentro de outra categoria',<select name="parent" className={inputClass}><option value="">Categoria principal</option>{workspace.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}</>}
          {section === 'transactions' && field('Operação',<select value={kind} onChange={e => setKind(e.target.value)} className={inputClass}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option><option value="card_purchase">Compra no cartão</option><option value="card_payment">Pagamento do cartão</option></select>)}
          {section === 'agenda' && <>{field('Direção',<select name="kind" value={kind === 'inflow' ? 'inflow' : 'outflow'} onChange={e => setKind(e.target.value)} className={inputClass}><option value="outflow">A pagar</option><option value="inflow">A receber</option></select>)}{field('Valor previsto',<select name="certainty" className={inputClass}><option value="confirmed">Confirmado</option><option value="estimated">Estimado</option>{kind === 'inflow' && <option value="conditional">Condicional</option>}</select>)}</>}
          {['cards','transactions','agenda'].includes(section) && kind !== 'card_purchase' && accountField()}
          {section === 'transactions' && kind === 'transfer' && accountField('destination','Conta de destino')}
          {(section === 'agenda' || section === 'budgets' || section === 'transactions' && !['transfer','card_payment'].includes(kind)) && categoryField()}
          {section === 'transactions' && ['card_purchase','card_payment'].includes(kind) && field('Cartão',<select name="card" required className={inputClass}><option value="">Selecione</option>{workspace.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
          {section === 'transactions' && kind === 'card_purchase' && field('Parcelas',<input name="installments" type="number" min="1" max="600" defaultValue="1" required className={inputClass}/>)}
          {section === 'transactions' && kind === 'card_payment' && field('Meio de pagamento',<select name="channel" className={inputClass}><option value="pix">Pix</option><option value="boleto">Boleto</option></select>)}
          {['accounts','cards','transactions','agenda','budgets'].includes(section) && field(section === 'accounts' ? 'Saldo inicial (R$)' : section === 'cards' ? 'Limite (R$)' : 'Valor (R$)',<input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={section === 'accounts' ? '0,00' : undefined} required className={inputClass}/>)}
          {['accounts','transactions','agenda'].includes(section) && field(section === 'agenda' ? 'Vencimento' : 'Data',<input name="date" type="date" defaultValue={workspace.space.today} required className={inputClass}/>)}
          {section === 'cards' && <>{field('Dia de fechamento',<input name="closing" type="number" min="1" max="31" required className={inputClass}/>)}{field('Dia de vencimento',<input name="due" type="number" min="1" max="31" required className={inputClass}/>)}</>}
          {section === 'budgets' && field('A partir do mês',<input name="month" type="month" defaultValue={workspace.space.today.slice(0,7)} required className={inputClass}/>)}
          <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className="rounded-xl bg-teal-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button><button type="button" onClick={() => setFormOpen(false)}>Cancelar</button></div>
        </form>}
        {workspace && section === 'dashboard' && <>
          <div className="grid gap-4 sm:grid-cols-3">{[{ label:'Saldo das contas',value:sumCents(workspace.accounts.map(a => a.balance_cents)) },{ label:'Limite utilizado',value:sumCents(workspace.cards.map(c => c.used_cents)) },{ label:'Contas a pagar',value:sumCents(workspace.commitments.filter(c => c.direction === 'outflow' && ['pending','partial'].includes(c.settlement_status)).map(c => c.remaining_cents ?? 0)) }].map(item => <div key={item.label} className={panelClass}><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-2xl font-semibold">{money(item.value)}</p></div>)}</div>
          <div className={panelClass}><h2 className="font-semibold">Comece pelos cadastros</h2><p className="mt-2 text-sm text-slate-500">Cadastre suas contas e os saldos atuais. Depois organize as categorias, adicione seus cartões e registre as movimentações.</p><button onClick={() => navigate('accounts')} className="mt-4 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">Cadastrar uma conta</button></div>
        </>}
        {workspace && section !== 'dashboard' && <div className={`${panelClass} space-y-3`}>
          {section === 'accounts' && workspace.accounts.map(a => <Row key={a.id} title={a.name} detail="Saldo atual" value={money(a.balance_cents)}/>)}
          {section === 'categories' && workspace.categories.map(c => <Row key={c.id} title={c.name} detail={c.kind === 'expense' ? 'Despesa' : 'Receita'} value={c.ledger_account_id ? 'Categoria final' : 'Grupo'}/>)}
          {section === 'cards' && workspace.cards.map(c => <Row key={c.id} title={c.name} detail={`Utilizado: ${money(c.used_cents)}`} value={`Disponível: ${money(c.free_cents)}`}/>)}
          {section === 'people' && workspace.people.map(p => <Row key={p.id} title={p.nickname} detail={p.balance_cents >= 0 ? 'A receber' : 'A pagar'} value={money(Math.abs(p.balance_cents))}/>)}
          {section === 'transactions' && workspace.transactions.map(t => <Row key={t.id} title={t.description} detail={t.occurred_on} value={t.status === 'cancelled' ? 'Cancelado' : 'Registrado'}/>)}
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
