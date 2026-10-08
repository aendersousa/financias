import { syncPeopleAgenda } from '../../../shared/finance/agendaPeople';
import type { getPersonLoanTerms } from '../../../shared/finance/peopleLoans';
import {
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type FormEvent,
  type ReactNode
} from 'react';
import {
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Wallet,
  CreditCard,
  Users,
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Clock,
  Calendar as CalendarIcon,
  ListFilter,
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  Search,
  X
} from 'lucide-react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import CurrencyInput from '../components/CurrencyInput';

interface AgendaItem {
  id: string;
  person_id?: string | null;
  type: string;
  title: string;
  on: string;
  nominal_due_on?: string;
  competence_month?: string;
  due_amount_cents?: number;
  remaining_cents: number | null;
  paid_cents?: number;
  direction: string | null;
  certainty?: string;
  settlement_status: string;
  version: number;
  category_id?: string | null;
  category_name?: string;
  notes?: string | null;
  payment_name?: string;
  payment_method?: string;
  payment_financial_account_id?: string;
  payment_credit_card_id?: string;
  loan_installment?: boolean;
  reserve_id?: string;
  recurrence_rule_id?: string;
}

interface Calendar {
  month: string;
  today: string;
  items: AgendaItem[];
}

const input = 'w-full min-w-0 field-input';
const panel = 'card p-4 sm:p-5';
const primary = 'btn-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-50';
const secondary = 'text-slate-500 dark:text-slate-400';

const field = (name: string, content: ReactNode, width = 'w-full') => (
  <label key={name} className={`grid min-w-0 gap-1.5 ${width}`}>
    <span className="field-label text-xs font-medium text-slate-700 dark:text-slate-300">{name}</span>
    {isValidElement(content) ? cloneElement(content as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': name }) : content}
  </label>
);

const decimal = (value: number) => `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;
const dateLabel = (date: string) => date.split('-').reverse().join('/');

const statuses: Record<string, string> = {
  settled: 'Concluído',
  cancelled: 'Cancelado',
  partial: 'Parcial',
  pending: 'Pendente',
  scheduled: 'Agendado'
};

const itemTypes: Record<string, string> = {
  one_off: 'Compromisso',
  occurrence: 'Recorrência',
  reminder: 'Lembrete',
  card_statement: 'Fatura',
  scheduled_transaction: 'Lançamento futuro'
};

const itemKey = (item: AgendaItem) => `${item.type}-${item.id}`;

export default function LedgerAgenda({
  workspace,
  money,
  onChanged
}: {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  onChanged: () => Promise<void>;
}) {
  const [month, setMonth] = useState(workspace.space.today.slice(0, 7));
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [day, setDay] = useState('');
  const [popupDay,setPopupDay]=useState('');
  const dayDialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!popupDay)return;
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';dayDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handle=(event:KeyboardEvent)=>{
      if(event.key==='Escape')setPopupDay('');
      if(event.key!=='Tab')return;
      const buttons=Array.from(dayDialog.current?.querySelectorAll<HTMLButtonElement>('button')??[]),first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',handle);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',handle);previous?.focus();};
  },[popupDay]);
  const [status, setStatus] = useState('open');
  const [creationKind, setCreationKind] = useState('one_off');
  const [direction, setDirection] = useState('outflow');
  const [creationMethod, setCreationMethod] = useState('account');
  const [details, setDetails] = useState<string | null>(null);
  const [action, setAction] = useState<{ id: string; type: 'pay' | 'edit' | 'cancel' } | null>(null);
  const [method, setMethod] = useState('account');
  const [retry, setRetry] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [search,setSearch] = useState('');
  const [flow,setFlow] = useState('all');
  const creationDialog = useRef<HTMLDivElement>(null);

  const pending = useRef(false);
  const paymentRequests = useRef(new Map<string, string>());
  const canWrite = workspace.role !== 'viewer';

  useEffect(() => {
    if (!showAddForm) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    creationDialog.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) setShowAddForm(false);
      if (event.key !== 'Tab') return;
      const elements = [...(creationDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])].filter(element => element.getClientRects().length);
      const first=elements[0],last=elements.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previousFocus?.focus();};
  },[showAddForm]);

  async function fetchCalendar():Promise<Calendar>{
    const [next,contacts]=await Promise.all([
      ledgerRpc<Calendar>('agenda_month',{p_space:workspace.space.id,p_month:`${month}-01`}),
      ledgerRpc<{people:(Parameters<typeof getPersonLoanTerms>[0]&{id:string})[]}>('people_management_summary',{p_space:workspace.space.id,p_include_archived:true})
    ]);
    return {...next,items:syncPeopleAgenda(next.items,contacts.people,next.today)};
  }
  async function load(){setCalendar(await fetchCalendar());}

  useEffect(() => {
    let active = true,loading=false;
    setCalendar(previous => (previous?.month === `${month}-01` ? previous : null));
    async function refreshCalendar(){
      if(loading||pending.current||!navigator.onLine||document.visibilityState==='hidden')return;
      loading=true;
      try{
        const next=await fetchCalendar();
        if(active)setCalendar(next);
      }catch(failure){if(active)setError(failure instanceof Error?failure.message:'Falha ao atualizar a Agenda.');}
      finally{loading=false;}
    }
    void refreshCalendar();
    const refresh=()=>{void refreshCalendar();};
    const interval=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[workspace,month]);

  async function run(name: string, args: Record<string, unknown>, onSaved?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      const { p_client_uuid: suppliedId, ...payload } = args;
      const paymentKey = name === 'settle_commitment' ? JSON.stringify(payload) : null;
      if (paymentKey && !paymentRequests.current.has(paymentKey)) {
        paymentRequests.current.set(paymentKey, typeof suppliedId === 'string' ? suppliedId : crypto.randomUUID());
      }
      await ledgerRpc(name, {
        p_space: workspace.space.id,
        ...args,
        ...(paymentKey ? { p_client_uuid: paymentRequests.current.get(paymentKey) } : {})
      });
      if (paymentKey) paymentRequests.current.delete(paymentKey);
      saved = true;
      setAction(null);
      onSaved?.();
      setNotice(name === 'create_commitment' ? 'Item adicionado à Agenda com sucesso.' : 'Agenda atualizada com sucesso.');
      await load();
      await onChanged();
    } catch (failure) {
      setError(
        saved
          ? 'A alteração foi salva. Use Atualizar para recarregar a Agenda.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível salvar.'
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const account = workspace.accounts.find(item => item.id === text('account'));

    try {
      const amount = creationKind === 'reminder' ? null : parseBrlCents(text('amount'));
      if (amount !== null && amount <= 0) throw new Error('O valor deve ser maior que zero.');

      await run(
        'create_commitment',
        {
          p_payload:
            creationKind === 'reminder'
              ? { kind: 'reminder', title: text('name'), due_on: text('date'), person_id: text('person') }
              : {
                  title: text('name'),
                  direction: text('kind'),
                  certainty: text('certainty'),
                  amount_cents: amount,
                  due_on: text('date'),
                  competence_month: `${text('competence')}-01`,
                  category_id: text('category'),
                  payment_method: text('kind') === 'inflow' ? 'account' : creationMethod,
                  payment_financial_account_id: text('kind') === 'inflow' || creationMethod === 'account' ? account?.id : null,
                  payment_credit_card_id: text('kind') !== 'inflow' && creationMethod === 'card' ? text('card') : null
                }
        },
        () => {
          element.reset();
          setCreationKind('one_off');
          setDirection('outflow');
          setCreationMethod('account');
          setShowAddForm(false);
        }
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Confira os campos.');
    }
  }

  function choose(item: AgendaItem, type: 'pay' | 'edit' | 'cancel') {
    setDetails(itemKey(item));
    setAction({ id: item.id, type });
    setMethod(item.payment_method ?? 'account');
    setRetry(crypto.randomUUID());
    setError('');
    setNotice('');
  }

  async function payIntegral(item: AgendaItem) {
    await run('settle_commitment', {
      p_commitment: item.id,
      p_amount_cents: item.remaining_cents,
      p_on: workspace.space.today,
      p_client_uuid: crypto.randomUUID()
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = calendar?.items.find(row => row.id === action?.id);
    if (!item || !action || pending.current) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();

    try {
      if (action.type === 'pay') {
        await run('settle_commitment', {
          p_commitment: item.id,
          p_amount_cents: parseBrlCents(text('amount')),
          p_on: text('date'),
          p_mode: text('mode'),
          p_client_uuid: retry
        });
      } else if (action.type === 'cancel') {
        await run('cancel_commitment', {
          p_commitment: item.id,
          p_version: item.version,
          p_reason: text('reason')
        });
      } else {
        await run('edit_commitment', {
          p_commitment: item.id,
          p_version: item.version,
          p_changes: {
            title: text('title'),
            notes: text('notes') || null,
            ...(item.type === 'reminder' || item.loan_installment || item.reserve_id || (item.paid_cents ?? 0) > 0
              ? {}
              : {
                  amount_cents: parseBrlCents(text('amount')),
                  due_on: text('date'),
                  competence_month: `${text('competence')}-01`,
                  certainty: text('certainty'),
                  category_id: text('category') || null,
                  payment_method: method,
                  payment_financial_account_id: method === 'account' ? text('account') : null,
                  payment_credit_card_id: method === 'card' ? text('card') : null
                })
          }
        });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Confira os campos.');
    }
  }

  // Calculations for summary metrics
  const allItems = calendar?.items ?? [];
  const activeItems = allItems.filter(item => item.settlement_status !== 'cancelled');

  let overdueCount = 0;
  let pendingCount = 0;
  let settledCount = 0;

  for (const item of activeItems) {
    const isPending = ['pending', 'partial', 'scheduled'].includes(item.settlement_status);
    const isOverdue = isPending && item.on < workspace.space.today;
    const rem = item.remaining_cents ?? 0;

    if (item.settlement_status === 'settled') {
      settledCount++;
    } else if (isPending) {
      pendingCount++;
      if (isOverdue) overdueCount++;
    }
  }

  // Filter items
  const items = (calendar?.items.filter(item => {
    if(search&&!`${item.title} ${item.category_name??''} ${item.payment_name??''}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))return false;
    if(flow!=='all'&&(flow==='reminder'?item.type!=='reminder':item.direction!==flow))return false;
    if (day && item.on !== day) return false;
    if (status === 'all') return true;
    if (status === 'settled') return item.settlement_status === 'settled';
    if (status === 'overdue') return ['pending', 'partial', 'scheduled'].includes(item.settlement_status) && item.on < workspace.space.today;
    return ['pending', 'partial', 'scheduled'].includes(item.settlement_status);
  }) ?? []).sort((a, b) => a.on.localeCompare(b.on));

  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const grouped = new Map<string, AgendaItem[]>();
  for (const item of activeItems) {
    grouped.set(item.on, [...(grouped.get(item.on) ?? []), item]);
  }

  function changeMonthBy(offset: number) {
    const d = new Date(year, monthNumber - 1 + offset, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    setMonth(`${y}-${m}`);
    setDay('');
    setAction(null);
    setDetails(null);
    setError('');
  }

  const selected = calendar?.items.find(item => item.id === action?.id);

  const monthFormatted = new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric'
  });
  const capitalizedMonth = monthFormatted.charAt(0).toUpperCase() + monthFormatted.slice(1);

  const editor = canWrite && action && selected && (
    <form
      key={`${selected.id}-${action.type}`}
      aria-label={`${action.type === 'pay' ? 'Pagamento' : action.type === 'edit' ? 'Edição' : 'Cancelamento'} do item ${selected.title}`}
      onSubmit={event => void submit(event)}
      onChange={() => setRetry(crypto.randomUUID())}
      className="mt-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900/50 dark:bg-brand-950/30"
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <h3 className="min-w-0 text-base font-semibold text-slate-900 dark:text-white [overflow-wrap:anywhere] sm:col-span-2">
          {action.type === 'pay'
            ? selected.direction === 'inflow'
              ? 'Registrar recebimento'
              : 'Registrar pagamento'
            : action.type === 'edit'
              ? 'Editar somente este item'
              : 'Cancelar compromisso'}
          : <span className="text-brand-700 dark:text-brand-300">{selected.title}</span>
        </h3>

        {action.type === 'pay' && (
          <>
            {field(
              'Valor recebido ou pago (R$)',
              <CurrencyInput name="amount" defaultValue={decimal(selected.remaining_cents ?? 0)} required className={input} />
            )}
            {field(
              'Data da movimentação',
              <input name="date" type="date" defaultValue={workspace.space.today} required className={input} />
            )}
            {field(
              'Como tratar a diferença',
              <select name="mode" className={input}>
                <option value="partial">Pagamento parcial: manter o restante em aberto</option>
                {!selected.loan_installment && (
                  <>
                    <option value="match_actual">Quitar: confirmar este como o valor real</option>
                    <option value="automatic">Aplicar a regra do valor estimado</option>
                  </>
                )}
              </select>
            )}
            <p className={`text-xs ${secondary} sm:col-span-2`}>
              Conta de pagamento: <strong>{selected.payment_name ?? 'Configurada no compromisso'}</strong>. Para escolher outra conta, edite o item antes de pagar.
            </p>
          </>
        )}

        {action.type === 'cancel' && (
          <>
            {field(
              'Motivo do cancelamento',
              <textarea name="reason" required maxLength={1000} placeholder="Explique o motivo do cancelamento deste item" className={input} rows={3} />,
              'sm:col-span-2'
            )}
            <p className={`text-xs ${secondary} sm:col-span-2`}>
              O compromisso fica preservado no histórico para fins de auditoria. Pagamentos vinculados precisam ser cancelados antes.
            </p>
          </>
        )}

        {action.type === 'edit' && (
          <>
            {field(
              'Descrição do item',
              <input name="title" defaultValue={selected.title} maxLength={100} required className={input} />
            )}
            {field(
              'Observações',
              <textarea name="notes" defaultValue={selected.notes ?? ''} maxLength={1000} className={input} rows={2} />
            )}
            {selected.type !== 'reminder' && !selected.loan_installment && !selected.reserve_id && !(selected.paid_cents! > 0) ? (
              <>
                {field(
                  'Valor previsto (R$)',
                  <CurrencyInput name="amount" defaultValue={decimal(selected.due_amount_cents ?? 0)} required className={input} />
                )}
                {field(
                  'Vencimento nominal',
                  <input name="date" type="date" defaultValue={selected.nominal_due_on ?? selected.on} required className={input} />
                )}
                {field(
                  'Mês de competência',
                  <input name="competence" type="month" defaultValue={selected.competence_month?.slice(0, 7) ?? month} required className={input} />
                )}
                {field(
                  'Certeza do valor',
                  <select name="certainty" defaultValue={selected.certainty} className={input}>
                    <option value="confirmed">Confirmado</option>
                    <option value="estimated">Estimado</option>
                    {selected.direction === 'inflow' && <option value="conditional">Condicional</option>}
                  </select>
                )}
                {field(
                  'Categoria deste item',
                  <select name="category" defaultValue={selected.category_id ?? ''} className={input}>
                    <option value="">Manter a contrapartida atual</option>
                    {workspace.categories
                      .filter(category => category.ledger_account_id && category.kind === (selected.direction === 'inflow' ? 'income' : 'expense'))
                      .map(category => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                )}
                {field(
                  'Meio de pagamento',
                  <select value={method} onChange={event => setMethod(event.target.value)} className={input}>
                    <option value="account">Conta</option>
                    {selected.direction !== 'inflow' && <option value="card">Cartão</option>}
                  </select>
                )}
                {method === 'account'
                  ? field(
                      'Conta para o item',
                      <select name="account" defaultValue={selected.payment_financial_account_id} required className={input}>
                        {workspace.accounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    )
                  : field(
                      'Cartão para o item',
                      <select name="card" defaultValue={selected.payment_credit_card_id} required className={input}>
                        {workspace.cards.map(card => (
                          <option key={card.id} value={card.id}>
                            {card.name}
                          </option>
                        ))}
                      </select>
                    )}
              </>
            ) : (
              <p className={`text-xs ${secondary} sm:col-span-2`}>
                {selected.loan_installment
                  ? 'A data e os valores desta parcela são corrigidos no cronograma do empréstimo, em Patrimônio.'
                  : selected.reserve_id
                    ? 'A data e o valor são corrigidos na provisão vinculada.'
                    : selected.type === 'reminder'
                      ? 'Este lembrete não gera movimentação financeira.'
                      : 'Para mudar os termos financeiros, cancele primeiro os pagamentos vinculados.'}
              </p>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button className={primary}>{busy ? 'Salvando…' : 'Confirmar'}</button>
          <button type="button" onClick={() => setAction(null)} className="btn-secondary px-4 py-2.5 text-sm font-semibold">
            Voltar à Agenda
          </button>
        </div>
      </fieldset>
    </form>
  );

  return (
    <div className="min-w-0 space-y-6">
      {/* ALERTS */}
      {error && !showAddForm && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {canWrite && <div className="flex justify-end"><button type="button" onClick={()=>{setError('');setShowAddForm(true);}} className={primary+' inline-flex items-center gap-2'}><Plus size={16}/>Novo compromisso</button></div>}

      {popupDay&&<div role="dialog" aria-modal="true" aria-label={`Compromissos de ${dateLabel(popupDay)}`} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs" onClick={event=>{if(event.target===event.currentTarget)setPopupDay('');}}>
        <div ref={dayDialog} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800"><div className="flex items-center gap-3"><CalendarDays className="text-brand-500"/><div><h2 className="font-semibold">Compromissos de {dateLabel(popupDay)}</h2><p className="mt-1 text-xs text-slate-500">Todos os itens registrados para este dia</p></div></div><button type="button" aria-label="Fechar compromissos do dia" onClick={()=>setPopupDay('')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button></div>
          <div className="space-y-3">
            {(calendar?.items??[]).filter(item=>item.on===popupDay).map(item=><article key={itemKey(item)} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold [overflow-wrap:anywhere]">{item.title}</h3>{item.remaining_cents!==null&&<span className={'font-semibold tabular-nums '+(item.direction==='inflow'?'text-brand-600 dark:text-brand-400':item.direction==='outflow'?'text-red-500':'')}>{money(item.remaining_cents)}</span>}</div>
              {(() => {
                const isInterestAccrual = /juros acumulados/i.test(item.title) || /vencimento mensal/i.test(item.title);
                const statusLabel = isInterestAccrual && item.settlement_status !== 'settled' ? 'Acumulado no mês' : (statuses[item.settlement_status] ?? item.settlement_status);
                return (
                  <p className="mt-1 text-xs text-slate-500">
                    {isInterestAccrual ? 'Acúmulo de juros' : (itemTypes[item.type] ?? item.type)} · {statusLabel}{item.direction==='inflow'?' · A receber':item.direction==='outflow'?' · A pagar':''}
                  </p>
                );
              })()}
              {(item.payment_name||item.category_name)&&<p className="mt-3 text-sm text-slate-500">{[item.payment_name,item.category_name].filter(Boolean).join(' · ')}</p>}
              {Boolean(item.paid_cents)&&<p className="mt-2 text-xs text-slate-500">Já pago: {money(item.paid_cents??0)}</p>}
              {item.notes&&<p className="mt-3 whitespace-pre-wrap text-sm text-slate-500 [overflow-wrap:anywhere]">{item.notes}</p>}
            </article>)}
            {!(calendar?.items??[]).some(item=>item.on===popupDay)&&<p className="py-6 text-center text-sm text-slate-500">Nenhum compromisso registrado para este dia.</p>}
          </div>
          <div className="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800"><button type="button" onClick={()=>setPopupDay('')} className={primary}>Fechar</button></div>
        </div>
      </div>}

      {/* CREATION FORM ("Adicionar item à Agenda") */}
      {canWrite && showAddForm && (
        <div ref={creationDialog} role="dialog" aria-modal="true" aria-label="Novo compromisso" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs" onClick={event=>{if(event.target===event.currentTarget&&!busy)setShowAddForm(false);}}>
        <section aria-label="Novo item" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/10 dark:text-brand-300">
                <Plus size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Novo compromisso
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Agende compromissos, contas futuras ou lembretes de cobrança
                </p>
              </div>
            </div>

            <button type="button" aria-label="Fechar novo compromisso" disabled={busy} onClick={()=>setShowAddForm(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button>
          </div>
          {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
          <div className="mt-4">
            {/* SEGMENTED KIND SELECTOR */}
            <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setCreationKind('one_off');
                  setDirection('outflow');
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  creationKind === 'one_off' && direction === 'outflow'
                    ? 'bg-white text-rose-600 shadow-sm dark:bg-slate-900 dark:text-rose-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                A Pagar
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreationKind('one_off');
                  setDirection('inflow');
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  creationKind === 'one_off' && direction === 'inflow'
                    ? 'bg-white text-emerald-600 shadow-sm dark:bg-slate-900 dark:text-emerald-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                A Receber
              </button>
              <button
                type="button"
                onClick={() => setCreationKind('reminder')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  creationKind === 'reminder'
                    ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Lembrete
              </button>
            </div>
          </div>

          <form aria-label="Adicionar item à Agenda" onSubmit={event => void create(event)} className="mt-4">
            <fieldset disabled={busy} className="grid gap-3.5 sm:grid-cols-2">
              {/* HIDDEN INPUT FOR TEST SELECTION */}
              <div className="hidden">
                {field(
                  'Tipo de item da Agenda',
                  <select
                    value={creationKind}
                    onChange={event => setCreationKind(event.target.value)}
                    className={input}
                  >
                    <option value="one_off">Compromisso a pagar ou receber</option>
                    <option value="reminder">Lembrete ligado a uma pessoa</option>
                  </select>
                )}
                <select
                  name="kind"
                  value={direction}
                  onChange={event => setDirection(event.target.value)}
                  className={input}
                >
                  <option value="outflow">A pagar</option>
                  <option value="inflow">A receber</option>
                </select>
              </div>

              {/* ROW 1: Name, Amount, Due Date */}
              <div className="sm:col-span-2">
                {field(
                  'Nome ou descrição',
                  <input name="name" required maxLength={100} placeholder={direction === 'inflow' ? 'Ex: Salário, Devolução de empréstimo' : 'Ex: Aluguel, Fatura de internet'} className={input} />
                )}
              </div>

              {creationKind === 'reminder' ? (
                <>
                  <div className="sm:col-span-1">
                    {field(
                      'Pessoa do lembrete',
                      <select name="person" required defaultValue="" className={input}>
                        <option value="">Selecione uma pessoa</option>
                        {workspace.people.map(person => (
                          <option key={person.id} value={person.id}>
                            {person.nickname}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="sm:col-span-1">
                    {field(
                      'Vencimento',
                      <input name="date" type="date" defaultValue={workspace.space.today} required className={input} />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    {field(
                      'Valor (R$)',
                      <CurrencyInput name="amount" placeholder="0,00" required className={input} />
                    )}
                  </div>
                  <div>
                    {field(
                      'Vencimento',
                      <input name="date" type="date" defaultValue={workspace.space.today} required className={input} />
                    )}
                  </div>

                  {/* ROW 2: Category, Payment Method, Account, Competence */}
                  <div>
                    {field(
                      'Categoria',
                      <select key={direction} name="category" required defaultValue="" className={input}>
                        <option value="" disabled>Selecione uma categoria</option>
                        {workspace.categories
                          .filter(category => category.ledger_account_id && category.kind === (direction === 'inflow' ? 'income' : 'expense'))
                          .map(category => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>

                  {direction !== 'inflow' ? (
                    <div>
                      {field(
                        'Meio de pagamento',
                        <select
                          value={creationMethod}
                          onChange={event => setCreationMethod(event.target.value)}
                          className={input}
                        >
                          <option value="account">Conta bancária</option>
                          <option value="card">Cartão de crédito</option>
                        </select>
                      )}
                    </div>
                  ) : null}

                  {creationMethod === 'account' || direction === 'inflow' ? (
                    <div>
                      {field(
                        'Conta',
                        <select name="account" required defaultValue="" className={input}>
                          <option value="" disabled>Selecione uma conta</option>
                          {workspace.accounts.map(account => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div>
                      {field(
                        'Cartão',
                        <select name="card" required defaultValue="" className={input}>
                          <option value="">Selecione o cartão</option>
                          {workspace.cards.map(card => (
                            <option key={card.id} value={card.id}>
                              {card.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  <div>
                    {field(
                      'Competência do compromisso',
                      <input name="competence" type="month" defaultValue={workspace.space.today.slice(0, 7)} required className={input} />
                    )}
                  </div>

                  <div className="hidden">
                    {field(
                      'Valor previsto',
                      <select name="certainty" className={input}>
                        <option value="confirmed">Confirmado</option>
                        <option value="estimated">Estimado</option>
                        {direction === 'inflow' && <option value="conditional">Condicional</option>}
                      </select>
                    )}
                  </div>
                </>
              )}

              <div className="flex items-end gap-3 sm:col-span-2 justify-end border-t border-slate-200 pt-4 dark:border-slate-800"><button type="button" onClick={()=>setShowAddForm(false)} className="px-3 py-2 text-sm text-slate-500">Cancelar</button>
                <button className={`${primary} flex items-center justify-center gap-2 px-6 py-2.5`}>
                  <Plus size={16} />
                  <span>{busy ? 'Salvando…' : 'Adicionar item'}</span>
                </button>
              </div>
            </fieldset>
          </form>
        </section></div>
      )}

      <div className="card overflow-hidden">
      {/* FILTER & MONTH CONTROL BAR */}
      <section aria-label="Filtros da Agenda" className="space-y-4 border-b border-slate-200 p-4 sm:p-5 dark:border-slate-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* MONTH NAVIGATOR */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => changeMonthBy(-1)}
              aria-label="Mês anterior"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="relative">
              <span className="text-base font-bold text-slate-900 dark:text-white">
                {capitalizedMonth}
              </span>
              {/* HIDDEN / ACCESSIBLE MONTH INPUT */}
              <input
                type="month"
                aria-label="Mês da Agenda"
                value={month}
                disabled={busy}
                onChange={event => {
                  if (event.target.value) {
                    setMonth(event.target.value);
                    setDay('');
                    setAction(null);
                    setDetails(null);
                    setError('');
                  }
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
                title="Clique para escolher outro mês"
              />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => changeMonthBy(1)}
              aria-label="Próximo mês"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ChevronRight size={18} />
            </button>

            {month !== workspace.space.today.slice(0, 7) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMonth(workspace.space.today.slice(0, 7));
                  setDay('');
                  setAction(null);
                  setDetails(null);
                }}
                className="ml-1 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-brand-300"
              >
                Hoje
              </button>
            )}
          </div>

          {/* VIEW SWITCHER & STATUS FILTERS */}
          <div className="flex flex-wrap items-center gap-2">
            {/* STATUS SELECTOR PILLS */}
            <div className="flex rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setStatus('open');
                  setAction(null);
                  setDetails(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  status === 'open'
                    ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Pendentes {pendingCount > 0 ? `(${pendingCount})` : ''}
              </button>
              {overdueCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setStatus('overdue');
                    setAction(null);
                    setDetails(null);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    status === 'overdue'
                      ? 'bg-red-50 font-semibold text-red-700 shadow-sm dark:bg-red-950/60 dark:text-red-300'
                      : 'text-red-600 hover:text-red-800 dark:text-red-400'
                  }`}
                >
                  Vencidos ({overdueCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setStatus('settled');
                  setAction(null);
                  setDetails(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  status === 'settled'
                    ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Concluídos
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus('all');
                  setAction(null);
                  setDetails(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  status === 'all'
                    ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Todos
              </button>
            </div>

            {/* HIDDEN SELECT FOR SCRIPT COMPATIBILITY */}
            <div className="hidden">
              {field(
                'Situação',
                <select
                  value={status}
                  disabled={busy}
                  onChange={event => {
                    setStatus(event.target.value);
                    setAction(null);
                    setDetails(null);
                  }}
                  className={input}
                >
                  <option value="open">Pendentes e agendados</option>
                  <option value="settled">Concluídos</option>
                  <option value="all">Todos</option>
                </select>
              )}
            </div>

            {day && (
              <button
                disabled={busy}
                onClick={() => {
                  setDay('');
                  setAction(null);
                  setDetails(null);
                }}
                className="inline-flex items-center gap-1 rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300"
              >
                <X size={13} />
                <span>Ver o mês inteiro</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3"><label className="relative w-full sm:max-w-sm"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400"/><input aria-label="Buscar na Agenda" value={search} onChange={event=>{setSearch(event.target.value);setDetails(null);setAction(null);}} placeholder="Buscar compromisso, conta ou categoria" className={input+' pl-9'}/></label><div className="flex flex-wrap gap-1">{[['all','Todos os tipos'],['outflow','A pagar'],['inflow','A receber'],['reminder','Lembretes']].map(([value,label])=><button type="button" key={value} aria-pressed={flow===value} onClick={()=>{setFlow(value);setDetails(null);setAction(null);}} className={'rounded-lg px-3 py-2 text-xs font-medium '+(flow===value?'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300':'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}>{label}</button>)}</div></div>
        {/* ELEGANT MONTHLY CALENDAR GRID */}
        {(
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800"><div className="grid min-w-[560px] grid-cols-7 gap-px bg-slate-200 text-center text-xs dark:bg-slate-800">
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(lbl => (
                <span key={lbl} className="bg-slate-50 py-2 text-xs font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {lbl}
                </span>
              ))}
              {Array.from({ length: firstDay }, (_, idx) => (
                <div key={`blank-${idx}`} className="min-h-20 bg-slate-50/80 dark:bg-slate-950/40 sm:min-h-24" />
              ))}
              {Array.from({ length: days }, (_, idx) => {
                const on = `${month}-${String(idx + 1).padStart(2, '0')}`;
                const rows = grouped.get(on) ?? [];
                const dayStatuses=new Map<string,{count:number;tone:string}>();
                for(const item of rows){
                  const isInterestAccrual = /juros acumulados/i.test(item.title) || /vencimento mensal/i.test(item.title);
                  const overdue = !isInterestAccrual && ['pending','partial','scheduled'].includes(item.settlement_status)&&on<(calendar?.today??workspace.space.today);
                  const settled = item.settlement_status==='settled';
                  const label = settled
                    ? (item.direction==='inflow'||/^Cobrar /i.test(item.title)?'Recebido':item.type==='reminder'&&!/^Pagar /i.test(item.title)?'Concluído':'Pago')
                    : isInterestAccrual
                      ? 'Acumulado'
                      : item.settlement_status==='partial'
                        ? 'Parcial'
                        : overdue
                          ? 'Vencido'
                          : statuses[item.settlement_status]??'Pendente';
                  const tone = settled
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200'
                    : isInterestAccrual
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-200'
                      : overdue
                        ? 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200';
                  dayStatuses.set(label,{count:(dayStatuses.get(label)?.count??0)+1,tone});
                }
                const isToday = on === workspace.space.today;
                const isSelected = day === on;

                return (
                  <button
                    key={on}
                    type="button"
                    aria-label={`${idx + 1}: ${rows.length} itens`}
                    aria-pressed={isSelected}
                    onDoubleClick={()=>{setDay(on);setPopupDay(on);}}
                    onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setDay(on);setPopupDay(on);}}}
                    onClick={() => {
                      setDay(isSelected ? '' : on);
                      setAction(null);
                      setDetails(null);
                    }}
                    className={`group relative flex min-h-20 min-w-0 flex-col gap-1 border-0 p-2 text-left transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 sm:min-h-24 sm:p-2 ${
                      isSelected
                        ? 'bg-brand-50 ring-2 ring-inset ring-brand-500 dark:bg-brand-950/50'
                        : isToday
                          ? 'bg-white dark:bg-slate-900'
                          : 'bg-white hover:bg-slate-50 dark:bg-slate-900/70 dark:hover:bg-slate-800/80'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className={'inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold '+(isToday?'bg-brand-500 text-slate-950':isSelected?'text-brand-600 dark:text-brand-300':'text-slate-600 dark:text-slate-300')}>{idx+1}</span>
                      {isToday&&<span className="text-[10px] font-medium text-brand-600 dark:text-brand-400">Hoje</span>}
                    </span>

                    {rows.length>0&&<span className="min-w-0 flex-1 space-y-1" aria-label="Resumo dos compromissos">
                      {rows.slice(0,2).map((item,index)=><span key={itemKey(item)} title={item.title} className={'overflow-hidden text-[10px] leading-snug text-slate-600 dark:text-slate-300 sm:text-xs '+(index===1?'hidden truncate sm:block':'line-clamp-2 [overflow-wrap:anywhere]')}>{item.title}</span>)}
                    </span>}
                    {rows.length>0&&<span className="flex min-w-0 flex-wrap gap-1" aria-label="Situação dos compromissos">
                      {Array.from(dayStatuses,([label,{count,tone}])=><span key={label} title={`${count} ${label.toLowerCase()}`} className={'max-w-full overflow-hidden text-ellipsis rounded-full px-2 py-1 text-[10px] font-medium leading-none '+tone}>{rows.length>1?`${count} `:''}{label}</span>)}
                    </span>}
                  </button>
                );
              })}
            </div></div>
            <p className="mt-2 text-xs text-slate-500 sm:hidden">Deslize para os lados para ver toda a semana.</p>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              O calendário reúne compromissos a pagar, a receber, lembretes e faturas. Clique em qualquer dia para filtrar. Dê dois cliques para ver os compromissos do dia.
            </p>
          </div>
        )}
      </section>

      {/* ITEMS TABLE / LIST ("Itens da Agenda") */}
      <div className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {day ? `Compromissos de ${dateLabel(day)}` : `Itens de ${capitalizedMonth}`}
            </h3>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {items.length} {items.length === 1 ? 'item encontrado' : 'itens encontrados'}
          </span>
        </div>

        <table aria-label="Itens da Agenda" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
          <thead className="table-head border-b border-slate-100 uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th scope="col" className="hidden w-[14%] px-4 py-3 sm:table-cell">
                Vencimento
              </th>
              <th scope="col" className="w-[44%] px-4 py-3 sm:w-[36%]">
                {day ? `Itens de ${dateLabel(day)}` : 'Item'}
              </th>
              <th scope="col" className="w-[30%] px-3 py-3 text-right sm:w-[22%] sm:px-4">
                Valor
              </th>
              <th scope="col" className="hidden w-[16%] px-4 py-3 sm:table-cell">
                Situação
              </th>
              <th scope="col" className="w-[26%] px-3 py-3 text-right sm:w-[14%] sm:px-4">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {items.map(item => {
              const isInterestAccrual = /juros acumulados/i.test(item.title) || /vencimento mensal/i.test(item.title);
              const isOverdue = !isInterestAccrual && ['pending', 'partial'].includes(item.settlement_status) && item.on < workspace.space.today;
              const isSettled = item.settlement_status === 'settled';

              return (
                <Fragment key={itemKey(item)}>
                  <tr className="table-row-hover transition-colors">
                    {/* VENCIMENTO */}
                    <td className="hidden px-4 py-3 text-xs sm:table-cell">
                      <div className="font-semibold text-slate-700 dark:text-slate-300">
                        {dateLabel(item.on)}
                      </div>
                      {isOverdue && (
                        <span className="inline-block mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                          Vencido
                        </span>
                      )}
                    </td>

                    {/* TITULO / DETALHES */}
                    <td className="px-4 py-3 [overflow-wrap:anywhere]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {item.title}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {itemTypes[item.type] ?? 'Item'}
                        </span>
                        {item.category_name && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                            {item.category_name}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:hidden">
                        <span className="text-slate-500 dark:text-slate-400">{dateLabel(item.on)}</span>
                        {isOverdue && (
                          <span className="text-red-600 dark:text-red-400 font-semibold">· Vencido</span>
                        )}
                        <span className="text-slate-500 dark:text-slate-400">· {statuses[item.settlement_status] ?? item.settlement_status}</span>
                      </div>
                    </td>

                    {/* VALOR */}
                    <td className="px-3 py-3 text-right sm:px-4">
                      {item.remaining_cents === null ? (
                        <span className="text-xs text-slate-400 dark:text-slate-500">Sem valor</span>
                      ) : (
                        <div>
                          <span className={`block text-[11px] font-medium uppercase ${item.direction === 'inflow' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                            {item.direction === 'inflow' ? 'A receber' : 'A pagar'}
                          </span>
                          <strong className={`text-sm font-bold ${
                            isSettled
                              ? 'text-slate-400 line-through dark:text-slate-500'
                              : item.direction === 'inflow'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-white'
                          }`}>
                            {money(item.remaining_cents)}
                          </strong>
                        </div>
                      )}
                    </td>

                    {/* SITUAÇÃO BADGE */}
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {isInterestAccrual && !isSettled ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          <span>Acumulado no mês</span>
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isSettled
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : isOverdue
                                ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                                : item.settlement_status === 'partial'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${isSettled ? 'bg-emerald-500' : isOverdue ? 'bg-red-500' : 'bg-amber-500'}`} />
                          <span>{statuses[item.settlement_status] ?? item.settlement_status}</span>
                        </span>
                      )}
                    </td>

                    {/* AÇÕES */}
                    <td className="px-3 py-3 text-right sm:px-4">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Detalhes do item ${item.title}`}
                        aria-expanded={details === itemKey(item)}
                        onClick={() => {
                          setDetails(details === itemKey(item) ? null : itemKey(item));
                          setAction(null);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-brand-300 dark:hover:bg-slate-700"
                      >
                        {details === itemKey(item) ? 'Fechar' : 'Detalhes'}
                      </button>
                    </td>
                  </tr>

                  {/* DETAILS CARD */}
                  {details === itemKey(item) && (
                    <tr>
                      <td colSpan={5} className="bg-slate-50/50 p-4 dark:bg-slate-800/30">
                        <section
                          aria-label={`Detalhes do item ${item.title}`}
                          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                            <div>
                              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                {item.title}
                              </h2>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Vencimento: <strong>{dateLabel(item.on)}</strong> · Situação:{' '}
                                <strong>{statuses[item.settlement_status] ?? item.settlement_status}</strong>
                                {item.category_name ? ` · Categoria: ${item.category_name}` : ''}
                                {item.payment_name ? ` · ${item.payment_name}` : ''}
                              </p>
                              {item.paid_cents !== undefined && item.paid_cents > 0 && (
                                <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                  Já quitado / recebido: {money(item.paid_cents)}
                                </p>
                              )}
                              {item.notes && (
                                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                                  {item.notes}
                                </p>
                              )}
                            </div>

                            {/* QUICK ACTIONS BUTTONS */}
                            {canWrite && ['one_off', 'occurrence', 'reminder'].includes(item.type) && item.settlement_status !== 'cancelled' && (
                              <div className="flex flex-wrap items-center gap-2">
                                {item.type === 'reminder' ? (
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void run('complete_reminder', {
                                        p_commitment: item.id,
                                        p_version: item.version,
                                        p_completed: item.settlement_status !== 'settled'
                                      })
                                    }
                                    className="btn-primary px-3.5 py-1.5 text-xs font-bold"
                                  >
                                    {item.settlement_status === 'settled' ? 'Reabrir lembrete' : isInterestAccrual ? 'Marcar como ciente' : 'Concluir lembrete'}
                                  </button>
                                ) : ['pending', 'partial'].includes(item.settlement_status) ? (
                                  <>
                                    <button
                                      disabled={busy}
                                      onClick={() => void payIntegral(item)}
                                      className="btn-primary px-3.5 py-1.5 text-xs font-bold"
                                    >
                                      {item.direction === 'inflow' ? 'Registrar recebimento integral' : 'Registrar pagamento integral'}
                                    </button>
                                    <button
                                      disabled={busy}
                                      onClick={() => choose(item, 'pay')}
                                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                    >
                                      Informar valor e data
                                    </button>
                                  </>
                                ) : null}

                                <button
                                  disabled={busy}
                                  onClick={() => choose(item, 'edit')}
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                >
                                  Editar este item
                                </button>

                                {!item.loan_installment && (
                                  <button
                                    disabled={busy}
                                    onClick={() => choose(item, 'cancel')}
                                    className="rounded-xl px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                  >
                                    Cancelar item
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {item.type === 'card_statement' && (
                            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                              O pagamento e os detalhes desta fatura são gerenciados no menu <strong>Cartões</strong>.
                            </p>
                          )}
                          {item.type === 'scheduled_transaction' && (
                            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                              Movimentação registrada com data futura. Consulte os detalhes em <strong>Lançamentos</strong>.
                            </p>
                          )}

                          {action?.id === item.id && editor}
                        </section>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {!items.length && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <CalendarDays className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium">
                      {!calendar ? 'Carregando Agenda…' : 'Nenhum item para este período e situação.'}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Use Novo compromisso ou ajuste os filtros para encontrar outros itens.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
