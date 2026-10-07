import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Edit3,
  HandCoins,
  History,
  Percent,
  Plus,
  Receipt,
  Scale,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  X
} from 'lucide-react';
import PeopleTable from '../components/PeopleTable';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import { addMonthsClamped, calculatePeopleLoan } from '../../../shared/finance/peopleLoans';
import CurrencyInput from '../components/CurrencyInput';

const panel = 'card p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full field-input';
const displayDate = (value: string) => value.split('-').reverse().join('/');

type Direction = 'receive' | 'pay' | 'lend' | 'borrow';

interface Contact {
  id: string;
  nickname: string;
  notes: string | null;
  kind: string;
  version: number;
  archived_at: string | null;
  opening_on: string | null;
  balance_cents: number;
  scheduled_balance_cents: number;
}

interface PersonDetail {
  person: Contact;
  balance_cents: number;
  movements: {
    id: string;
    occurred_on: string;
    description: string;
    status: string;
    person_amount_cents: number;
    running_balance_cents: number;
  }[];
  reminders: {
    id: string;
    title: string;
    effective_due_on: string;
    completed_at: string | null;
    version: number;
  }[];
}

export default function LedgerPeople({
  workspace,
  money,
  onChanged,
  onAgenda
}: {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  onChanged: () => Promise<void>;
  onAgenda: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [movementPersonId, setMovementPersonId] = useState<string | null>(null);
  const [movementDirection, setMovementDirection] = useState<Direction>('receive');
  const [movementAmount, setMovementAmount] = useState<string>('');
  const [movementDate, setMovementDate] = useState<string>(workspace.space.today);

  // Add person with initial debt state
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [addPersonDebt, setAddPersonDebt] = useState<'none' | 'receivable' | 'payable'>('none');
  const [addPersonDebtAmount, setAddPersonDebtAmount] = useState('');
  const [addPersonDebtDate, setAddPersonDebtDate] = useState(workspace.space.today);

  // Loan with interest and installments state
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanPersonId, setLoanPersonId] = useState('');
  const [loanDirection, setLoanDirection] = useState<'lend' | 'borrow'>('lend');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanInterestType, setLoanInterestType] = useState<'percent' | 'fixed' | 'none'>('none');
  const [loanInterestRate, setLoanInterestRate] = useState('5');
  const [loanInterestFixed, setLoanInterestFixed] = useState('');
  const [loanInterestPeriod, setLoanInterestPeriod] = useState<'total' | 'monthly'>('total');
  const [loanMonths, setLoanMonths] = useState(1);
  const [loanPayMode, setLoanPayMode] = useState<'installments' | 'single'>('installments');
  const [loanFirstDueDate, setLoanFirstDueDate] = useState(() => addMonthsClamped(workspace.space.today, 1));
  const [loanMoveCash, setLoanMoveCash] = useState(true);
  const [loanAccountId, setLoanAccountId] = useState('');
  const [loanCreateReminders, setLoanCreateReminders] = useState(true);
  const [loanSaveNotes, setLoanSaveNotes] = useState(true);

  // Shared expense
  const [showSharedExpense, setShowSharedExpense] = useState(false);
  const [sharedSelectedPeople, setSharedSelectedPeople] = useState<string[]>([]);
  const [sharedTotalInput, setSharedTotalInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'receivable' | 'payable' | 'settled'>('all');
  const [includeArchived, setIncludeArchived] = useState(false);

  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'edit' | 'opening'>('view');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const requestKey = useRef<{ key: string; id: string } | null>(null);

  const canWrite = workspace.role !== 'viewer';
  const cashAccounts = workspace.accounts.filter(account => account.liquidity === 'cash');

  // Initialize account for loan if needed
  useEffect(() => {
    if (!loanAccountId && cashAccounts.length > 0) {
      setLoanAccountId(cashAccounts[0].id);
    }
  }, [cashAccounts, loanAccountId]);

  // Load contacts
  async function loadContacts() {
    try {
      const result = await ledgerRpc<{ people: Contact[] }>('people_management_summary', {
        p_space: workspace.space.id,
        p_include_archived: true
      });
      setContacts(result.people);
    } catch {
      // ignore or show non-blocking
    }
  }

  // Load single person detail
  async function loadPersonDetail(personId: string) {
    try {
      const result = await ledgerRpc<PersonDetail>('person_detail', {
        p_space: workspace.space.id,
        p_person: personId
      });
      setDetail(result);
    } catch {
      // non-blocking
    }
  }

  useEffect(() => {
    let active = true;
    void ledgerRpc<{ people: Contact[] }>('people_management_summary', {
      p_space: workspace.space.id,
      p_include_archived: true
    })
      .then(result => {
        if (active) setContacts(result.people);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os cadastros de pessoas.');
      });
    return () => {
      active = false;
    };
  }, [workspace]);

  // Load selected person detail
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selectedPersonId) {
      void ledgerRpc<PersonDetail>('person_detail', {
        p_space: workspace.space.id,
        p_person: selectedPersonId
      })
        .then(result => {
          if (active) setDetail(result);
        })
        .catch(() => {
          if (active) setError('Não foi possível carregar o histórico da pessoa.');
        });
    }
    return () => {
      active = false;
    };
  }, [workspace, selectedPersonId]);

  // Calculations for summary cards
  const activeContacts = useMemo(() => contacts.filter(item => !item.archived_at), [contacts]);
  const totalReceivable = useMemo(
    () => activeContacts.filter(c => c.balance_cents > 0).reduce((acc, c) => acc + c.balance_cents, 0),
    [activeContacts]
  );
  const countReceivable = useMemo(
    () => activeContacts.filter(c => c.balance_cents > 0).length,
    [activeContacts]
  );
  const totalPayable = useMemo(
    () => activeContacts.filter(c => c.balance_cents < 0).reduce((acc, c) => acc + Math.abs(c.balance_cents), 0),
    [activeContacts]
  );
  const countPayable = useMemo(
    () => activeContacts.filter(c => c.balance_cents < 0).length,
    [activeContacts]
  );
  const netBalance = totalReceivable - totalPayable;

  // Filtered contacts
  const visibleContacts = useMemo(() => {
    return contacts.filter(contact => {
      if (!includeArchived && contact.archived_at) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = contact.nickname.toLowerCase().includes(query);
        const matchesNotes = contact.notes?.toLowerCase().includes(query);
        if (!matchesName && !matchesNotes) return false;
      }
      if (filterTab === 'receivable' && contact.balance_cents <= 0) return false;
      if (filterTab === 'payable' && contact.balance_cents >= 0) return false;
      if (filterTab === 'settled' && contact.balance_cents !== 0) return false;
      return true;
    });
  }, [contacts, includeArchived, searchQuery, filterTab]);

  // Helper to run movements
  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !canWrite) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();

    try {
      const amount = parseBrlCents(text('amount'));
      if (amount <= 0) throw new Error('Informe um valor maior que zero.');
      const targetPerson = text('person') || movementPersonId;
      if (!targetPerson) throw new Error('Selecione uma pessoa.');

      pending.current = true;
      setBusy(true);
      setError('');
      setNotice('');

      await ledgerRpc('settle_person', {
        p_space: workspace.space.id,
        p_person: targetPerson,
        p_account: text('account'),
        p_direction: movementDirection,
        p_amount_cents: amount,
        p_occurred_on: text('date'),
        p_client_uuid: crypto.randomUUID()
      });

      await onChanged();
      await loadContacts();
      setMovementPersonId(null);
      setMovementAmount('');
      setNotice('Movimentação registrada com sucesso!');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Helper to submit shared expense
  async function submitSharedExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !canWrite) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();

    try {
      const amount = parseBrlCents(text('amount'));
      if (amount <= 0) throw new Error('Informe um valor maior que zero.');
      if (sharedSelectedPeople.length === 0) throw new Error('Selecione ao menos uma pessoa para dividir.');

      pending.current = true;
      setBusy(true);
      setError('');
      setNotice('');

      await ledgerRpc('record_shared_expense', {
        p_space: workspace.space.id,
        p_account: text('account'),
        p_category: text('category'),
        p_people: sharedSelectedPeople,
        p_total_cents: amount,
        p_occurred_on: text('date'),
        p_description: text('description'),
        p_client_uuid: crypto.randomUUID()
      });

      await onChanged();
      await loadContacts();
      setShowSharedExpense(false);
      setSharedSelectedPeople([]);
      setSharedTotalInput('');
      setNotice('Despesa dividida registrada com sucesso!');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a divisão.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Manage person (create, update, opening, archive, etc.)
  async function managePerson(action: string, changes: Record<string, unknown> = {}, targetPerson?: Contact) {
    if (pending.current || !canWrite) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');

    const personItem = targetPerson ?? contacts.find(c => c.id === selectedPersonId);
    const args = {
      p_space: workspace.space.id,
      p_person: action === 'create' ? null : personItem?.id,
      p_version: action === 'create' ? null : personItem?.version,
      p_action: action,
      p_changes: changes
    };
    const key = JSON.stringify(args);
    if (requestKey.current?.key !== key) requestKey.current = { key, id: crypto.randomUUID() };

    try {
      const id = await ledgerRpc<string>('manage_person', { ...args, p_client_uuid: requestKey.current.id });
      setDetailMode('view');
      if (action === 'create') {
        setShowAddPerson(false);
        setSelectedPersonId(id);
      } else if (action === 'delete' || (action === 'archive' && !includeArchived)) {
        setSelectedPersonId(null);
      } else {
        setSelectedPersonId(id);
      }
      await loadContacts();
      await onChanged();
      requestKey.current = null;
      setNotice(
        action === 'create'
          ? 'Pessoa adicionada com sucesso!'
          : action === 'archive'
            ? 'Pessoa arquivada. O histórico foi preservado.'
            : action === 'restore'
              ? 'Pessoa desarquivada.'
              : action === 'delete'
                ? 'Contato excluído.'
                : action === 'opening'
                  ? 'Saldo inicial registrado!'
                  : 'Cadastro salvo.'
      );
      return true;
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : '';
      setError(
        text.includes('changed; reload')
          ? 'Esse cadastro mudou. Atualize a página antes de tentar novamente.'
          : text.includes('including scheduled')
            ? 'Acerte o saldo atual e os movimentos agendados antes de arquivar.'
            : text.includes('unused and unlinked')
              ? 'A pessoa tem histórico ou vínculos. Use arquivar depois de acertar o saldo.'
              : text.includes('unused contact')
                ? 'O saldo inicial só pode ser informado para um contato sem movimentos.'
                : text.includes('month is closed')
                  ? 'Reabra o mês antes de registrar o saldo inicial.'
                  : text.includes('Active member')
                    ? 'A pessoa representa um membro ativo. Gerencie a saída em Compartilhamento.'
                    : 'Não foi possível salvar. Confira os dados e tente novamente.'
      );
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Open direct movement for a specific contact
  function openMovementForPerson(
    personId: string,
    preferredAmount?: string,
    preferredDirection?: Direction,
    preferredDate?: string
  ) {
    const target = contacts.find(c => c.id === personId);
    setMovementPersonId(personId);
    setShowSharedExpense(false);
    setShowAddPerson(false);
    setShowLoanForm(false);
    setError('');
    setNotice('');

    if (preferredDirection) {
      setMovementDirection(preferredDirection);
    } else if (target) {
      if (target.balance_cents > 0) {
        setMovementDirection('receive');
      } else if (target.balance_cents < 0) {
        setMovementDirection('pay');
      } else {
        setMovementDirection('lend');
      }
    }

    if (preferredAmount !== undefined) {
      setMovementAmount(preferredAmount);
    } else if (target && target.balance_cents !== 0) {
      setMovementAmount((Math.abs(target.balance_cents) / 100).toFixed(2).replace('.', ','));
    } else {
      setMovementAmount('');
    }

    if (preferredDate) {
      setMovementDate(preferredDate);
    } else {
      setMovementDate(workspace.space.today);
    }
  }

  // Open loan form
  function openLoanForPerson(personId?: string) {
    if (personId) {
      setLoanPersonId(personId);
    } else if (activeContacts.length > 0 && !loanPersonId) {
      setLoanPersonId(activeContacts[0].id);
    }
    setShowLoanForm(true);
    setShowAddPerson(false);
    setShowSharedExpense(false);
    setMovementPersonId(null);
    setError('');
    setNotice('');
  }

  // Calculate loan simulation in real-time
  const loanCalc = useMemo(() => {
    return calculatePeopleLoan({
      principalInput: loanPrincipal,
      interestType: loanInterestType,
      interestRate: loanInterestRate,
      interestFixedInput: loanInterestFixed,
      interestPeriod: loanInterestPeriod,
      months: loanMonths,
      payMode: loanPayMode,
      firstDueDate: loanFirstDueDate,
      today: workspace.space.today
    });
  }, [
    loanPrincipal,
    loanInterestType,
    loanInterestRate,
    loanInterestFixed,
    loanInterestPeriod,
    loanMonths,
    loanPayMode,
    loanFirstDueDate,
    workspace.space.today
  ]);

  // Submit Loan with interest, schedule, and reminders
  async function submitLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !canWrite) return;

    const targetPerson = contacts.find(c => c.id === loanPersonId);
    if (!targetPerson) {
      setError('Selecione uma pessoa para o empréstimo.');
      return;
    }
    if (loanCalc.principalCents <= 0) {
      setError('Informe um valor de empréstimo maior que zero.');
      return;
    }
    if (loanMoveCash && !loanAccountId) {
      setError('Selecione uma conta bancária para a saída/entrada do dinheiro.');
      return;
    }

    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      // 1. If moving cash, settle with person
      if (loanMoveCash && loanAccountId) {
        await ledgerRpc('settle_person', {
          p_space: workspace.space.id,
          p_person: targetPerson.id,
          p_account: loanAccountId,
          p_direction: loanDirection === 'lend' ? 'lend' : 'borrow',
          p_amount_cents: loanCalc.principalCents,
          p_occurred_on: workspace.space.today,
          p_client_uuid: crypto.randomUUID()
        });
      }

      // 2. If saving notes, append summary
      if (loanSaveNotes) {
        const conditionDesc = loanPayMode === 'single'
          ? `pagamento único de ${money(loanCalc.totalCents)} em ${displayDate(loanCalc.schedule[0]?.dueDate || '')}`
          : `${loanCalc.count} parcelas mensais de ~${money(loanCalc.baseInstallmentCents)} (total ${money(loanCalc.totalCents)})`;

        const interestDesc = loanCalc.interestCents > 0
          ? `+ Juros: ${money(loanCalc.interestCents)} (${loanCalc.effectiveRate.toFixed(1)}%)`
          : 'sem juros adicionais';

        const noteEntry = `📌 [Empréstimo em ${displayDate(workspace.space.today)}] ${
          loanDirection === 'lend' ? 'Emprestado para' : 'Pegou emprestado de'
        } ${targetPerson.nickname}: Principal ${money(loanCalc.principalCents)} (${interestDesc}) | Devolução em ${loanCalc.months} ${
          loanCalc.months === 1 ? 'mês' : 'meses'
        } (${conditionDesc}).`;

        const updatedNotes = targetPerson.notes ? `${targetPerson.notes}\n\n${noteEntry}` : noteEntry;

        await ledgerRpc('manage_person', {
          p_space: workspace.space.id,
          p_person: targetPerson.id,
          p_version: targetPerson.version,
          p_action: 'update',
          p_changes: { notes: updatedNotes },
          p_client_uuid: crypto.randomUUID()
        });
      }

      // 3. If creating reminders, create Agenda commitments
      if (loanCreateReminders && loanCalc.schedule.length > 0) {
        for (const item of loanCalc.schedule) {
          const title = `${loanDirection === 'lend' ? 'Cobrar' : 'Pagar'} ${targetPerson.nickname}: Parcela ${item.installmentNumber}/${item.totalCount} (${money(item.amountCents)})`;
          await ledgerRpc('create_commitment', {
            p_space: workspace.space.id,
            p_payload: {
              kind: 'reminder',
              person_id: targetPerson.id,
              title,
              due_on: item.dueDate
            }
          });
        }
      }

      await onChanged();
      await loadContacts();
      setSelectedPersonId(targetPerson.id);
      setShowLoanForm(false);
      setLoanPrincipal('');
      setLoanInterestFixed('');
      setNotice(
        `Empréstimo com ${targetPerson.nickname} registrado com sucesso! ${
          loanCreateReminders ? `${loanCalc.schedule.length} lembrete(s) criado(s) na Agenda.` : ''
        }`
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar o empréstimo.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Toggle reminder completion in Agenda
  async function toggleReminder(reminderId: string, version: number, completed: boolean) {
    if (pending.current || !canWrite) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await ledgerRpc('complete_reminder', {
        p_space: workspace.space.id,
        p_commitment: reminderId,
        p_version: version,
        p_completed: completed
      });
      if (selectedPersonId) await loadPersonDetail(selectedPersonId);
      await onChanged();
      setNotice(completed ? 'Lembrete marcado como concluído!' : 'Lembrete reaberto.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o lembrete.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Add ad-hoc reminder linked to this person
  async function addPersonReminder(title: string, dueOn: string) {
    if (pending.current || !canWrite || !selectedPersonId) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await ledgerRpc('create_commitment', {
        p_space: workspace.space.id,
        p_payload: {
          kind: 'reminder',
          person_id: selectedPersonId,
          title,
          due_on: dueOn
        }
      });
      await loadPersonDetail(selectedPersonId);
      await onChanged();
      setNotice('Lembrete adicionado à Agenda com sucesso!');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível criar o lembrete.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // Settle specific reminder
  function handleSettleReminder(reminder: { title: string; effective_due_on: string }) {
    if (!selectedPersonId) return;
    const match = reminder.title.match(/(?:R\$\s*|valor:?\s*)([\d.,]+)/i);
    const amountStr = match ? match[1] : '';
    const isPay = reminder.title.toLowerCase().startsWith('pagar');
    openMovementForPerson(
      selectedPersonId,
      amountStr,
      isPay ? 'pay' : 'receive',
      reminder.effective_due_on
    );
  }

  // Calculate shared expense simulation
  const sharedCalc = useMemo(() => {
    try {
      const cents = parseBrlCents(sharedTotalInput || '0');
      const totalPeople = sharedSelectedPeople.length + 1; // user + friends
      if (cents <= 0 || totalPeople <= 1) return null;
      const perPersonCents = Math.round(cents / totalPeople);
      const friendsTotalCents = perPersonCents * sharedSelectedPeople.length;
      const myShareCents = cents - friendsTotalCents;
      return {
        totalCents: cents,
        totalPeople,
        perPersonCents,
        myShareCents,
        friendsTotalCents
      };
    } catch {
      return null;
    }
  }, [sharedTotalInput, sharedSelectedPeople]);

  const activeMovementPerson = contacts.find(c => c.id === movementPersonId);
  const activeSelectedPerson = contacts.find(c => c.id === selectedPersonId);

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="flex-1">{error}</p>
          <button type="button" onClick={() => setError('')} className="text-red-600 hover:opacity-80">
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="flex-1 font-medium">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className="text-emerald-600 hover:opacity-80">
            <X size={16} />
          </button>
        </div>
      )}

      {/* 1. Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-white p-4.5 shadow-sm dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-slate-900">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              A receber de pessoas
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <ArrowDownLeft size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-900 dark:text-emerald-200">
            {money(totalReceivable)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {countReceivable === 0
              ? 'Ninguém te deve nada no momento'
              : `${countReceivable} ${countReceivable === 1 ? 'pessoa te deve' : 'pessoas te devem'}`}
          </p>
        </div>

        <div className="rounded-2xl border border-rose-200/70 bg-gradient-to-br from-rose-50/80 to-white p-4.5 shadow-sm dark:border-rose-900/50 dark:from-rose-950/30 dark:to-slate-900">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
              A pagar para pessoas
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
              <ArrowUpRight size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-rose-900 dark:text-rose-200">
            {money(totalPayable)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {countPayable === 0
              ? 'Você não deve para ninguém'
              : `Você deve para ${countPayable} ${countPayable === 1 ? 'pessoa' : 'pessoas'}`}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Balanço com pessoas
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Scale size={16} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {money(Math.abs(netBalance))}
          </p>
          <div className="mt-1">
            {netBalance > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <Check size={13} /> Saldo a seu favor
              </span>
            ) : netBalance < 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400">
                Saldo devedor total
              </span>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">Tudo em dia com todos</span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Quick Action Bar */}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setShowAddPerson(!showAddPerson);
              setShowSharedExpense(false);
              setShowLoanForm(false);
              setMovementPersonId(null);
            }}
            className={`btn-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold transition ${
              showAddPerson ? 'ring-2 ring-brand-500 ring-offset-2' : ''
            }`}
          >
            <UserPlus size={16} />
            <span>Nova pessoa</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (showLoanForm) {
                setShowLoanForm(false);
              } else {
                openLoanForPerson();
              }
            }}
            className={`flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50/70 px-4 py-2 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-brand-100 hover:text-brand-900 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200 dark:hover:bg-brand-900/60 ${
              showLoanForm ? 'border-brand-500 ring-2 ring-brand-500/30' : ''
            }`}
          >
            <Coins size={16} className="text-brand-600 dark:text-brand-400" />
            <span>Empréstimo com juros & prazos</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeContacts.length === 0) {
                setError('Cadastre pelo menos uma pessoa antes de registrar movimentações.');
                return;
              }
              if (movementPersonId) {
                setMovementPersonId(null);
              } else {
                openMovementForPerson(activeContacts[0].id);
              }
            }}
            className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${
              movementPersonId ? 'border-brand-500 ring-2 ring-brand-500/20' : ''
            }`}
          >
            <HandCoins size={16} className="text-brand-600 dark:text-brand-400" />
            <span>Registrar acerto simples</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeContacts.length === 0) {
                setError('Cadastre pessoas para poder dividir despesas.');
                return;
              }
              setShowSharedExpense(!showSharedExpense);
              setShowAddPerson(false);
              setShowLoanForm(false);
              setMovementPersonId(null);
              setSharedSelectedPeople(activeContacts.map(c => c.id));
            }}
            className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${
              showSharedExpense ? 'border-brand-500 ring-2 ring-brand-500/20' : ''
            }`}
          >
            <Receipt size={16} className="text-brand-600 dark:text-brand-400" />
            <span>Dividir uma despesa</span>
            <span className="hidden rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 md:inline">
              Conta compartilhada
            </span>
          </button>
        </div>
      )}

      {/* 3. Add Person Form (com opção de quem deve para quem) */}
      {canWrite && showAddPerson && (
        <form
          aria-label="Adicionar pessoa"
          onSubmit={async event => {
            event.preventDefault();
            if (pending.current || !canWrite) return;
            const form = event.currentTarget;
            const values = new FormData(form);
            const nickname = String(values.get('nickname') ?? '').trim();
            const notes = String(values.get('notes') ?? '').trim() || null;
            if (!nickname) return;

            pending.current = true;
            setBusy(true);
            setError('');
            setNotice('');

            try {
              // 1. Create person
              const id = await ledgerRpc<string>('manage_person', {
                p_space: workspace.space.id,
                p_person: null,
                p_version: null,
                p_action: 'create',
                p_changes: { nickname, notes },
                p_client_uuid: crypto.randomUUID()
              });

              // 2. If initial debt was specified, set opening balance
              if (addPersonDebt !== 'none') {
                const cents = parseBrlCents(addPersonDebtAmount);
                if (cents > 0) {
                  await ledgerRpc<string>('manage_person', {
                    p_space: workspace.space.id,
                    p_person: id,
                    p_version: 1,
                    p_action: 'opening',
                    p_changes: {
                      balance_cents: addPersonDebt === 'payable' ? -cents : cents,
                      on: addPersonDebtDate || workspace.space.today
                    },
                    p_client_uuid: crypto.randomUUID()
                  });
                }
              }

              form.reset();
              setAddPersonDebt('none');
              setAddPersonDebtAmount('');
              setAddPersonDebtDate(workspace.space.today);
              setShowAddPerson(false);
              setSelectedPersonId(id);
              await loadContacts();
              await onChanged();
              setNotice(
                addPersonDebt !== 'none' && parseBrlCents(addPersonDebtAmount) > 0
                  ? `Pessoa "${nickname}" adicionada com saldo inicial de ${money(parseBrlCents(addPersonDebtAmount))} (${
                      addPersonDebt === 'receivable' ? 'a receber' : 'a pagar'
                    })!`
                  : `Pessoa "${nickname}" adicionada com sucesso!`
              );
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Não foi possível cadastrar a pessoa.');
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
          className={`${panel} space-y-4 border-2 border-brand-200 dark:border-brand-900/60`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                <UserPlus size={16} />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Adicionar nova pessoa</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowAddPerson(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="new-person-nickname" className="font-medium text-slate-700 dark:text-slate-300">
                Nome ou apelido *
              </label>
              <input
                id="new-person-nickname"
                aria-label="Apelido da pessoa"
                name="nickname"
                disabled={busy}
                required
                maxLength={100}
                placeholder="Ex: João Silva, Ana Paula, Mãe..."
                className={input}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="new-person-notes" className="font-medium text-slate-700 dark:text-slate-300">
                Observações (opcionais)
              </label>
              <input
                id="new-person-notes"
                aria-label="Observações da pessoa"
                name="notes"
                disabled={busy}
                maxLength={2000}
                placeholder="Ex: Amigo da faculdade, vizinho, trabalho..."
                className={input}
              />
            </div>
          </div>

          {/* Situação inicial: Quem deve para quem */}
          <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Situação da dívida inicial:
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setAddPersonDebt('none')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  addPersonDebt === 'none'
                    ? 'border-brand-500 bg-brand-50/80 font-semibold text-brand-950 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <Check size={16} />
                  <span className="text-sm font-bold">Começar em dia</span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Não há dívida inicial (R$ 0,00)
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAddPersonDebt('receivable')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  addPersonDebt === 'receivable'
                    ? 'border-emerald-500 bg-emerald-50/80 font-semibold text-emerald-950 ring-2 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <ArrowDownLeft size={16} />
                  <span className="text-sm font-bold">Ela já me deve</span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Saldo que tenho a receber
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAddPersonDebt('payable')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  addPersonDebt === 'payable'
                    ? 'border-rose-500 bg-rose-50/80 font-semibold text-rose-950 ring-2 ring-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                  <ArrowUpRight size={16} />
                  <span className="text-sm font-bold">Eu já devo para ela</span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Saldo que tenho a pagar
                </span>
              </button>
            </div>

            {addPersonDebt !== 'none' && (
              <div className="mt-2 grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="grid gap-1.5 text-sm">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Valor da dívida existente *
                  </label>
                  <CurrencyInput
                    value={addPersonDebtAmount}
                    onChange={e => setAddPersonDebtAmount(e.target.value)}
                    required
                    placeholder="0,00"
                    className={input}
                  />
                </div>

                <div className="grid gap-1.5 text-sm">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Desde quando? (data da dívida) *
                  </label>
                  <input
                    type="date"
                    value={addPersonDebtDate}
                    onChange={e => setAddPersonDebtDate(e.target.value)}
                    max={workspace.space.today}
                    required
                    className={input}
                  />
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Esse valor será lançado como saldo inicial desta pessoa sem afetar as despesas ou receitas correntes.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button disabled={busy} className="btn-primary px-5 py-2 text-sm font-semibold">
              {busy ? 'Salvando…' : 'Salvar pessoa'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowAddPerson(false)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* 4. Loan Form: Empréstimo com juros, prazos e simulação */}
      {canWrite && showLoanForm && (
        <form
          aria-label="Registrar empréstimo com juros e prazos"
          onSubmit={submitLoan}
          className={`${panel} space-y-4 border-2 border-brand-500 shadow-lg dark:border-brand-600`}
        >
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                <Coins size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Empréstimo com juros e prazos
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Defina juros combinados, quantidade de meses, forma de devolução e crie lembretes de cobrança na Agenda.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowLoanForm(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>

          {/* Contact selector & Direction */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="loan-person-select" className="font-medium text-slate-700 dark:text-slate-300">
                Pessoa do empréstimo *
              </label>
              <select
                id="loan-person-select"
                value={loanPersonId}
                onChange={e => setLoanPersonId(e.target.value)}
                required
                className={input}
              >
                <option value="">Selecione uma pessoa</option>
                {activeContacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nickname} {c.balance_cents > 0 ? `(te deve ${money(c.balance_cents)})` : c.balance_cents < 0 ? `(você deve ${money(Math.abs(c.balance_cents))})` : '(em dia)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                Quem emprestou para quem? *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLoanDirection('lend')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                    loanDirection === 'lend'
                      ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                  }`}
                >
                  <ArrowUpRight size={14} className="text-brand-600 dark:text-brand-400" />
                  <span>Eu emprestei (vou receber)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLoanDirection('borrow')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition ${
                    loanDirection === 'borrow'
                      ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                  }`}
                >
                  <ArrowDownLeft size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>Peguei emprestado (vou pagar)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Principal Amount & Term in Months */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="loan-principal-input" className="font-medium text-slate-700 dark:text-slate-300">
                Valor principal emprestado (R$) *
              </label>
              <CurrencyInput
                id="loan-principal-input"
                value={loanPrincipal}
                onChange={e => setLoanPrincipal(e.target.value)}
                required
                placeholder="0,00"
                className={input}
              />
            </div>

            <div className="grid gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                Prazo: quantos meses ficará com o dinheiro? *
              </label>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {[1, 2, 3, 6, 12].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setLoanMonths(m)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                        loanMonths === m
                          ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {m} {m === 1 ? 'mês' : 'm'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={loanMonths}
                    onChange={e => setLoanMonths(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                    className="field-input w-20 text-center text-xs"
                  />
                  <span className="text-xs text-slate-500">meses</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interest definition */}
          <div className="space-y-2 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/40">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Juros acordados / Rendimento:
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setLoanInterestType('none')}
                className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                  loanInterestType === 'none'
                    ? 'border-brand-500 bg-white text-brand-900 ring-2 ring-brand-500/30 dark:bg-slate-800 dark:text-brand-200'
                    : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                }`}
              >
                <Check size={15} />
                <span>Sem juros (0%)</span>
              </button>

              <button
                type="button"
                onClick={() => setLoanInterestType('percent')}
                className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                  loanInterestType === 'percent'
                    ? 'border-brand-500 bg-white text-brand-900 ring-2 ring-brand-500/30 dark:bg-slate-800 dark:text-brand-200'
                    : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                }`}
              >
                <Percent size={15} />
                <span>Taxa em porcentagem (%)</span>
              </button>

              <button
                type="button"
                onClick={() => setLoanInterestType('fixed')}
                className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                  loanInterestType === 'fixed'
                    ? 'border-brand-500 bg-white text-brand-900 ring-2 ring-brand-500/30 dark:bg-slate-800 dark:text-brand-200'
                    : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                }`}
              >
                <Coins size={15} />
                <span>Valor fixo em reais (R$)</span>
              </button>
            </div>

            {loanInterestType === 'percent' && (
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <div className="grid gap-1 text-xs">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Taxa de juros (%) *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={loanInterestRate}
                      onChange={e => setLoanInterestRate(e.target.value)}
                      placeholder="Ex: 5"
                      className="field-input w-full pr-8 text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                  </div>
                </div>
                <div className="grid gap-1 text-xs">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Período de aplicação
                  </label>
                  <select
                    value={loanInterestPeriod}
                    onChange={e => setLoanInterestPeriod(e.target.value as 'total' | 'monthly')}
                    className={input}
                  >
                    <option value="total">No total de todo o período</option>
                    <option value="monthly">Ao mês ({loanInterestRate}% a cada mês decorrido)</option>
                  </select>
                </div>
              </div>
            )}

            {loanInterestType === 'fixed' && (
              <div className="pt-2 sm:w-1/2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Valor adicional de juros (R$) *
                </label>
                <CurrencyInput
                  value={loanInterestFixed}
                  onChange={e => setLoanInterestFixed(e.target.value)}
                  placeholder="0,00"
                  className={input}
                />
              </div>
            )}
          </div>

          {/* Repayment mode & Due Date */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                Forma de devolução / pagamento *
              </label>
              <select
                value={loanPayMode}
                onChange={e => setLoanPayMode(e.target.value as 'installments' | 'single')}
                className={input}
              >
                <option value="installments">
                  Parcelado mês a mês (em {loanMonths} {loanMonths === 1 ? 'parcela' : 'parcelas'})
                </option>
                <option value="single">Tudo de uma vez no final do prazo (parcela única)</option>
              </select>
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="loan-due-date" className="font-medium text-slate-700 dark:text-slate-300">
                {loanPayMode === 'single' ? 'Data do vencimento único *' : 'Data do 1º vencimento *'}
              </label>
              <input
                id="loan-due-date"
                type="date"
                value={loanFirstDueDate}
                onChange={e => setLoanFirstDueDate(e.target.value)}
                required
                className={input}
              />
            </div>
          </div>

          {/* Real-time simulation preview card */}
          {loanCalc.principalCents > 0 && (
            <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/70 via-white to-brand-50/30 p-4 shadow-sm dark:border-brand-900/50 dark:from-brand-950/40 dark:via-slate-900 dark:to-brand-950/20">
              <div className="flex items-center justify-between gap-2 border-b border-brand-100 pb-2.5 dark:border-brand-900/50">
                <span className="text-xs font-bold uppercase tracking-wider text-brand-800 dark:text-brand-300">
                  Simulação do Empréstimo
                </span>
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-300">
                  {loanCalc.months} {loanCalc.months === 1 ? 'mês' : 'meses'} • {loanCalc.count} {loanCalc.count === 1 ? 'parcela' : 'parcelas'}
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white p-2.5 shadow-sm dark:bg-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Valor emprestado</span>
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {money(loanCalc.principalCents)}
                  </p>
                </div>

                <div className="rounded-xl bg-white p-2.5 shadow-sm dark:bg-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Juros a {loanDirection === 'lend' ? 'receber' : 'pagar'}
                  </span>
                  <p className="text-base font-bold text-amber-700 dark:text-amber-400">
                    +{money(loanCalc.interestCents)}
                    {loanCalc.interestCents > 0 && (
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        ({loanCalc.effectiveRate.toFixed(1)}%)
                      </span>
                    )}
                  </p>
                </div>

                <div className="rounded-xl bg-white p-2.5 shadow-sm dark:bg-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Total a {loanDirection === 'lend' ? 'receber' : 'pagar'}
                  </span>
                  <p className="text-base font-bold text-brand-700 dark:text-brand-300">
                    {money(loanCalc.totalCents)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 p-3 dark:bg-slate-800/80">
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Como será devolvido:</span>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {loanPayMode === 'single'
                      ? `Pagamento único de ${money(loanCalc.totalCents)} em ${displayDate(loanCalc.schedule[0]?.dueDate || '')}`
                      : `${loanCalc.count}x de ~${money(loanCalc.baseInstallmentCents)}`}
                  </p>
                </div>
                {loanCalc.schedule.length > 0 && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    1º vencimento em {displayDate(loanCalc.schedule[0].dueDate)}
                  </span>
                )}
              </div>

              {loanCalc.schedule.length > 1 && (
                <div className="mt-3">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Cronograma das parcelas:
                  </span>
                  <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1">
                    {loanCalc.schedule.map(item => (
                      <div
                        key={item.installmentNumber}
                        className="flex items-center justify-between rounded-lg bg-white/60 px-2.5 py-1.5 text-xs dark:bg-slate-800/50"
                      >
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          Parcela {item.installmentNumber}/{item.totalCount}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500 dark:text-slate-400">
                            Vence em {displayDate(item.dueDate)}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {money(item.amountCents)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bank Account and Agenda Options */}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={loanMoveCash}
                  onChange={e => setLoanMoveCash(e.target.checked)}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                <span>Movimentar minha conta bancária agora</span>
              </label>
              {loanMoveCash && (
                <div className="pl-6 grid gap-1 text-xs">
                  <label className="text-slate-500 dark:text-slate-400">
                    Conta bancária de onde o dinheiro {loanDirection === 'lend' ? 'saiu' : 'entrou'}:
                  </label>
                  <select
                    value={loanAccountId}
                    onChange={e => setLoanAccountId(e.target.value)}
                    required
                    className="field-input w-full text-xs sm:w-1/2"
                  >
                    <option value="">Selecione uma conta</option>
                    {cashAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={loanCreateReminders}
                onChange={e => setLoanCreateReminders(e.target.checked)}
                className="rounded text-brand-600 focus:ring-brand-500"
              />
              <span>Criar lembretes de cobrança na Agenda para cada vencimento</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={loanSaveNotes}
                onChange={e => setLoanSaveNotes(e.target.checked)}
                className="rounded text-brand-600 focus:ring-brand-500"
              />
              <span>Salvar resumo das condições combinadas nas observações da pessoa</span>
            </label>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              disabled={busy || !loanPersonId || loanCalc.principalCents <= 0 || (loanMoveCash && !loanAccountId)}
              className="btn-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Registrando empréstimo…' : 'Confirmar empréstimo'}
            </button>
            <button
              type="button"
              onClick={() => setShowLoanForm(false)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* 4. Movement Form (Acerto, Empréstimo, Pagamento, Recebimento) */}
      {canWrite && movementPersonId && (
        <form
          aria-label="Movimentação com pessoa"
          onSubmit={submitMovement}
          className={`${panel} space-y-4 border-2 border-brand-400/80 shadow-md dark:border-brand-700`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                <HandCoins size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Movimentação com {activeMovementPerson?.nickname || 'pessoa'}
                </h2>
                {activeMovementPerson && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeMovementPerson.balance_cents > 0
                      ? `Situação atual: ${activeMovementPerson.nickname} te deve ${money(activeMovementPerson.balance_cents)}`
                      : activeMovementPerson.balance_cents < 0
                        ? `Situação atual: Você deve ${money(Math.abs(activeMovementPerson.balance_cents))} para ${activeMovementPerson.nickname}`
                        : 'Situação atual: As contas estão em dia'}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMovementPersonId(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>

          {/* Person Selector (if user clicked from top bar without a person) */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="movement-person" className="font-medium">
                Pessoa da movimentação
              </label>
              <select
                id="movement-person"
                name="person"
                value={movementPersonId}
                onChange={e => openMovementForPerson(e.target.value)}
                className={input}
              >
                {activeContacts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nickname} {p.balance_cents > 0 ? `(te deve ${money(p.balance_cents)})` : p.balance_cents < 0 ? `(você deve ${money(Math.abs(p.balance_cents))})` : '(em dia)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Direction selector: 4 intuitive visual options */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              O que você deseja registrar?
            </label>
            <div className="grid gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setMovementDirection('receive')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  movementDirection === 'receive'
                    ? 'border-emerald-500 bg-emerald-50/80 font-semibold text-emerald-950 ring-2 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <ArrowDownLeft size={16} />
                  <span className="text-sm font-bold">Receber</span>
                </div>
                <span className="text-xs font-normal text-slate-600 dark:text-slate-400">
                  A pessoa me pagou / devolveu
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMovementDirection('pay')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  movementDirection === 'pay'
                    ? 'border-rose-500 bg-rose-50/80 font-semibold text-rose-950 ring-2 ring-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                  <ArrowUpRight size={16} />
                  <span className="text-sm font-bold">Pagar</span>
                </div>
                <span className="text-xs font-normal text-slate-600 dark:text-slate-400">
                  Paguei o que devia à pessoa
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMovementDirection('lend')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  movementDirection === 'lend'
                    ? 'border-brand-500 bg-brand-50/80 font-semibold text-brand-950 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-brand-700 dark:text-brand-400">
                  <ArrowUpRight size={16} />
                  <span className="text-sm font-bold">Emprestar</span>
                </div>
                <span className="text-xs font-normal text-slate-600 dark:text-slate-400">
                  Emprestei dinheiro à pessoa
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMovementDirection('borrow')}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                  movementDirection === 'borrow'
                    ? 'border-amber-500 bg-amber-50/80 font-semibold text-amber-950 ring-2 ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <ArrowDownLeft size={16} />
                  <span className="text-sm font-bold">Pegar emprestado</span>
                </div>
                <span className="text-xs font-normal text-slate-600 dark:text-slate-400">
                  Recebi emprestado da pessoa
                </span>
              </button>
            </div>
            {/* Context explanation */}
            <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
              {movementDirection === 'receive' && 'O dinheiro entra na sua conta bancária e reduz o valor que esta pessoa te devia.'}
              {movementDirection === 'pay' && 'O dinheiro sai da sua conta bancária e reduz o valor que você devia para esta pessoa.'}
              {movementDirection === 'lend' && 'O dinheiro sai da sua conta bancária e cria uma dívida que a pessoa terá a te pagar.'}
              {movementDirection === 'borrow' && 'O dinheiro entra na sua conta bancária e cria uma dívida que você terá a pagar à pessoa.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="movement-account" className="font-medium">
                Conta bancária da movimentação *
              </label>
              <select
                id="movement-account"
                name="account"
                aria-label="Conta da movimentação com pessoa"
                required
                className={input}
              >
                <option value="">Selecione uma conta</option>
                {cashAccounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <label htmlFor="movement-amount" className="font-medium">
                  Valor *
                </label>
                {activeMovementPerson && activeMovementPerson.balance_cents !== 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const cents = Math.abs(activeMovementPerson.balance_cents);
                      setMovementAmount((cents / 100).toFixed(2).replace('.', ','));
                    }}
                    className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Usar saldo total ({money(Math.abs(activeMovementPerson.balance_cents))})
                  </button>
                )}
              </div>
              <CurrencyInput
                id="movement-amount"
                name="amount"
                aria-label="Valor com pessoas"
                value={movementAmount}
                onChange={e => setMovementAmount(e.target.value)}
                required
                placeholder="0,00"
                className={input}
              />
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="movement-date" className="font-medium">
                Data do pagamento/acerto *
              </label>
              <input
                id="movement-date"
                name="date"
                aria-label="Data da movimentação com pessoa"
                type="date"
                required
                value={movementDate}
                onChange={e => setMovementDate(e.target.value)}
                className={input}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              disabled={busy || cashAccounts.length === 0}
              className="btn-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Salvando…' : 'Confirmar movimentação'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMovementPersonId(null);
                setMovementAmount('');
              }}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* 5. Shared Expense Form (Dividir despesa paga por você) */}
      {canWrite && showSharedExpense && (
        <form
          aria-label="Despesa dividida em partes iguais"
          onSubmit={submitSharedExpense}
          className={`${panel} space-y-4 border-2 border-brand-300 dark:border-brand-800`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                <Receipt size={16} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Dividir uma despesa paga por você
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Você pagou a conta inteira e quer registrar a dívida para cada amigo te reembolsar.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSharedExpense(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="shared-description" className="font-medium">
                Descrição da despesa *
              </label>
              <input
                id="shared-description"
                name="description"
                aria-label="Descrição da despesa dividida"
                required
                maxLength={100}
                placeholder="Ex: Almoço no Outback, Churrasco, Compras..."
                className={input}
                autoFocus
              />
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="shared-total" className="font-medium">
                Valor total pago por você (R$) *
              </label>
              <CurrencyInput
                id="shared-total"
                name="amount"
                aria-label="Valor com pessoas"
                value={sharedTotalInput}
                onChange={e => setSharedTotalInput(e.target.value)}
                required
                placeholder="0,00"
                className={input}
              />
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="shared-account" className="font-medium">
                Conta de onde você pagou *
              </label>
              <select
                id="shared-account"
                name="account"
                aria-label="Conta da movimentação com pessoa"
                required
                className={input}
              >
                <option value="">Selecione a conta</option>
                {cashAccounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="shared-category" className="font-medium">
                Categoria da sua parte da despesa *
              </label>
              <select
                id="shared-category"
                name="category"
                aria-label="Categoria da despesa dividida"
                required
                className={input}
              >
                <option value="">Selecione a categoria</option>
                {workspace.categories
                  .filter(c => c.kind === 'expense' && c.ledger_account_id)
                  .map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-1.5 text-sm sm:col-span-2">
              <label htmlFor="shared-date" className="font-medium">
                Data do pagamento *
              </label>
              <input
                id="shared-date"
                name="date"
                aria-label="Data da movimentação com pessoa"
                type="date"
                required
                defaultValue={workspace.space.today}
                className={input}
              />
            </div>
          </div>

          {/* People Selection */}
          <div className="space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Pessoas que vão dividir com você ({sharedSelectedPeople.length} selecionadas):
              </span>
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setSharedSelectedPeople(activeContacts.map(c => c.id))}
                  className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  Selecionar todas
                </button>
                <button
                  type="button"
                  onClick={() => setSharedSelectedPeople([])}
                  className="font-semibold text-slate-500 hover:underline"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {activeContacts.map(p => {
                const isChecked = sharedSelectedPeople.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                      isChecked
                        ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-950/60 dark:text-brand-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={e => {
                        setSharedSelectedPeople(prev =>
                          e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id)
                        );
                      }}
                      className="rounded text-brand-600 focus:ring-brand-500"
                    />
                    <span>{p.nickname}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Você também é incluído automaticamente na conta. A sua parte vira gasto comum; a parte dos amigos vira saldo a receber.
            </p>
          </div>

          {/* Division preview */}
          {sharedCalc && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm dark:border-brand-900/60 dark:bg-brand-950/30">
              <p className="font-semibold text-brand-900 dark:text-brand-200">
                Divisão calculada ({sharedCalc.totalPeople} pessoas: você + {sharedSelectedPeople.length} amigos)
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-white p-2.5 shadow-sm dark:bg-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Sua despesa pessoal</span>
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {money(sharedCalc.myShareCents)}
                  </p>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-sm dark:bg-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">A receber de amigos</span>
                  <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                    {money(sharedCalc.friendsTotalCents)}{' '}
                    <span className="text-xs font-normal text-slate-500">
                      ({money(sharedCalc.perPersonCents)} de cada)
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              disabled={busy || cashAccounts.length === 0 || sharedSelectedPeople.length === 0}
              className="btn-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Registrando…' : 'Confirmar divisão'}
            </button>
            <button
              type="button"
              onClick={() => setShowSharedExpense(false)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* 6. Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome..."
            className="field-input w-full !pl-9 text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterTab === 'all'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            Todas ({contacts.filter(c => includeArchived || !c.archived_at).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('receivable')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterTab === 'receivable'
                ? 'bg-emerald-700 text-white dark:bg-emerald-500 dark:text-slate-950'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            A receber ({contacts.filter(c => (includeArchived || !c.archived_at) && c.balance_cents > 0).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('payable')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterTab === 'payable'
                ? 'bg-rose-700 text-white dark:bg-rose-500 dark:text-slate-950'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            A pagar ({contacts.filter(c => (includeArchived || !c.archived_at) && c.balance_cents < 0).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('settled')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterTab === 'settled'
                ? 'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-950'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            Em dia ({contacts.filter(c => (includeArchived || !c.archived_at) && c.balance_cents === 0).length})
          </button>
        </div>
      </div>

      {/* 7. People Table with Actions */}
      <PeopleTable
        people={visibleContacts}
        money={money}
        renderName={item => (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSelectedPersonId(selectedPersonId === item.id ? null : item.id);
              setDetailMode('view');
            }}
            aria-label={'Editar pessoa ' + item.nickname}
            aria-expanded={selectedPersonId === item.id}
            className="block max-w-full text-left font-semibold text-slate-900 hover:underline [overflow-wrap:anywhere] dark:text-slate-100"
          >
            {item.nickname}
          </button>
        )}
        renderActions={item => (
          <div className="flex items-center justify-end gap-1.5">
            {canWrite && !item.archived_at && (
              <button
                type="button"
                disabled={busy}
                onClick={() => openMovementForPerson(item.id)}
                className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-900/60"
                title="Registrar acerto com esta pessoa"
              >
                <HandCoins size={13} className="shrink-0" />
                <span>Acertar</span>
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSelectedPersonId(selectedPersonId === item.id ? null : item.id);
                setDetailMode('view');
              }}
              aria-label={'Ver detalhes da pessoa ' + item.nickname}
              aria-expanded={selectedPersonId === item.id}
              className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                selectedPersonId === item.id
                  ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {selectedPersonId === item.id ? 'Fechar' : 'Detalhes'}
            </button>
          </div>
        )}
        renderEditor={item =>
          selectedPersonId === item.id ? (
            <PersonDetailPanel
              person={item}
              detail={detail}
              mode={detailMode}
              setMode={setDetailMode}
              money={money}
              onAgenda={onAgenda}
              onMovement={() => openMovementForPerson(item.id)}
              onOpenLoan={() => openLoanForPerson(item.id)}
              onClose={() => setSelectedPersonId(null)}
              onManage={(action, changes) => managePerson(action, changes, item)}
              onToggleReminder={toggleReminder}
              onAddReminder={addPersonReminder}
              onSettleReminder={handleSettleReminder}
              busy={busy}
              today={workspace.space.today}
            />
          ) : null
        }
      />

      {/* 8. Archived section toggle */}
      {contacts.some(item => item.archived_at) && (
        <details className="text-sm text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer font-medium hover:text-slate-800 dark:hover:text-slate-200">
            Pessoas arquivadas ({contacts.filter(c => c.archived_at).length})
          </summary>
          <div className="mt-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={busy}
                checked={includeArchived}
                onChange={event => setIncludeArchived(event.target.checked)}
                className="rounded text-brand-600 focus:ring-brand-500"
              />
              Mostrar pessoas arquivadas na listagem
            </label>
          </div>
        </details>
      )}
    </div>
  );
}

// Subcomponent: Person Detail Panel
function PersonDetailPanel({
  person,
  detail,
  mode,
  setMode,
  money,
  onAgenda,
  onMovement,
  onOpenLoan,
  onClose,
  onManage,
  onToggleReminder,
  onAddReminder,
  onSettleReminder,
  busy,
  today
}: {
  person: Contact;
  detail: PersonDetail | null;
  mode: 'view' | 'edit' | 'opening';
  setMode: (mode: 'view' | 'edit' | 'opening') => void;
  money: (value: number) => string;
  onAgenda: () => void;
  onMovement: () => void;
  onOpenLoan: () => void;
  onClose: () => void;
  onManage: (action: string, changes?: Record<string, unknown>) => Promise<boolean>;
  onToggleReminder: (reminderId: string, version: number, completed: boolean) => Promise<void>;
  onAddReminder: (title: string, dueOn: string) => Promise<void>;
  onSettleReminder: (reminder: { title: string; effective_due_on: string }) => void;
  busy: boolean;
  today: string;
}) {
  const [showAddReminder, setShowAddReminder] = useState(false);
  return (
    <section
      aria-label={'Detalhes da pessoa ' + person.nickname}
      className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/60"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{person.nickname}</h3>
            {person.archived_at && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Arquivada
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {person.kind === 'member'
              ? 'Membro do espaço compartilhado'
              : person.kind === 'former_member'
                ? 'Ex-membro do espaço'
                : person.kind === 'space'
                  ? 'Espaço financeiro'
                  : 'Contato particular'}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-xs font-semibold text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Fechar
        </button>
      </div>

      {/* Balance Highlight */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800">
        <div>
          <span className="text-xs text-slate-500 dark:text-slate-400">Saldo atual</span>
          <p
            className={`text-lg font-bold ${
              person.balance_cents > 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : person.balance_cents < 0
                  ? 'text-rose-700 dark:text-rose-400'
                  : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {person.balance_cents > 0
              ? `${person.nickname} te deve ${money(person.balance_cents)}`
              : person.balance_cents < 0
                ? `Você deve ${money(Math.abs(person.balance_cents))} a ${person.nickname}`
                : 'Contas em dia'}
          </p>
        </div>

        {person.scheduled_balance_cents !== 0 && (
          <div className="text-right">
            <span className="text-xs text-slate-500 dark:text-slate-400">Movimentos futuros</span>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {money(person.scheduled_balance_cents)}
            </p>
          </div>
        )}
      </div>

      {/* Notes */}
      {person.notes && (
        <div className="rounded-lg bg-white p-3 text-sm text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-300">
          <span className="text-xs font-medium text-slate-400">Observações:</span>
          <p className="mt-1 whitespace-pre-wrap">{person.notes}</p>
        </div>
      )}

      {/* Actions toolbar */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!person.archived_at ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onMovement}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600"
            >
              <HandCoins size={14} />
              <span>Registrar acerto / pagamento</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={onOpenLoan}
              className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
            >
              <Coins size={13} />
              <span>Novo empréstimo com juros</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <Edit3 size={13} />
              <span>Editar apelido</span>
            </button>

            {person.kind === 'contact' && person.opening_on === null && detail?.movements.length === 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode(mode === 'opening' ? 'view' : 'opening')}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <span>Informar saldo inicial</span>
              </button>
            )}

            {person.kind !== 'member' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onManage('archive')}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                Arquivar
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onManage('restore')}
            className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300"
          >
            Desarquivar pessoa
          </button>
        )}

        {person.kind === 'contact' && detail?.movements.length === 0 && detail?.reminders.length === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onManage('delete')}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 size={13} />
            <span>Excluir contato</span>
          </button>
        )}
      </div>

      {/* Edit Form */}
      {mode === 'edit' && !person.archived_at && (
        <form
          aria-label="Editar pessoa"
          onSubmit={async event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await onManage('update', {
              nickname: String(form.get('nickname') ?? '').trim(),
              notes: String(form.get('notes') ?? '').trim() || null
            });
          }}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="grid gap-1 text-sm">
            <label className="font-medium">Apelido</label>
            <input
              aria-label="Apelido da pessoa"
              name="nickname"
              required
              maxLength={100}
              defaultValue={person.nickname}
              className={input}
            />
          </div>
          <div className="grid gap-1 text-sm">
            <label className="font-medium">Observações</label>
            <textarea
              aria-label="Observações da pessoa"
              name="notes"
              maxLength={2000}
              rows={2}
              defaultValue={person.notes ?? ''}
              className={input}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy} className="btn-primary px-4 py-2 text-xs font-semibold">
              Salvar alterações
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className="px-3 py-2 text-xs font-medium text-slate-600 hover:underline"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Opening Balance Form */}
      {mode === 'opening' && !person.archived_at && (
        <form
          onSubmit={async event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const amount = parseBrlCents(String(form.get('amount') ?? ''));
            if (amount <= 0) return;
            await onManage('opening', {
              balance_cents: form.get('direction') === 'pay' ? -amount : amount,
              on: String(form.get('date'))
            });
          }}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="grid gap-1 text-sm">
            <label className="font-medium">Quem deve no início?</label>
            <select
              aria-label="Direção do saldo inicial da pessoa"
              name="direction"
              className={input}
            >
              <option value="receive">A pessoa me deve</option>
              <option value="pay">Eu devo à pessoa</option>
            </select>
          </div>
          <div className="grid gap-1 text-sm">
            <label className="font-medium">Saldo inicial</label>
            <CurrencyInput
              aria-label="Saldo inicial da pessoa"
              name="amount"
              required
              placeholder="0,00"
              className={input}
            />
          </div>
          <div className="grid gap-1 text-sm sm:col-span-2">
            <label className="font-medium">Data do início</label>
            <input
              aria-label="Data do saldo inicial da pessoa"
              name="date"
              type="date"
              required
              defaultValue={today}
              max={today}
              className={input}
            />
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Esse valor representa uma dívida antiga que já existia. Fica fora de receitas e despesas atuais.
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy} className="btn-primary px-4 py-2 text-xs font-semibold">
              Registrar saldo inicial
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className="px-3 py-2 text-xs font-medium text-slate-600 hover:underline"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Movements list */}
      <div className="space-y-2 pt-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <History size={15} />
          <span>Histórico de movimentos</span>
        </h4>
        {!detail ? (
          <p className="text-xs text-slate-500">Carregando histórico…</p>
        ) : detail.movements.length === 0 ? (
          <p className="rounded-lg bg-white p-3 text-xs text-slate-500 shadow-sm dark:bg-slate-800">
            Nenhum movimento registrado com esta pessoa.
          </p>
        ) : (
          <div className="space-y-1.5">
            {detail.movements.map(item => {
              const isPositive = item.person_amount_cents > 0;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 text-sm shadow-sm dark:bg-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {item.description}
                      {item.status === 'cancelled' && <span className="ml-2 text-xs text-red-500">(cancelado)</span>}
                      {item.occurred_on > today && <span className="ml-2 text-xs text-amber-500">(agendado)</span>}
                    </p>
                    <p className="text-xs text-slate-400">{displayDate(item.occurred_on)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {isPositive ? '+' : ''}{money(item.person_amount_cents)}
                    </p>
                    <p className="text-xs text-slate-400">
                      Saldo após: {money(item.running_balance_cents)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Agenda reminders */}
      {detail && (
        <div className="space-y-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Calendar size={15} />
              <span>Lembretes na Agenda ({detail.reminders.length})</span>
            </h4>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddReminder(!showAddReminder)}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
              >
                <Plus size={13} />
                <span>Novo lembrete</span>
              </button>
              <button
                type="button"
                onClick={onAgenda}
                className="text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
              >
                Abrir Agenda
              </button>
            </div>
          </div>

          {/* Quick inline add reminder */}
          {showAddReminder && (
            <form
              onSubmit={async e => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const title = String(form.get('title') ?? '').trim();
                const dueOn = String(form.get('due_on') ?? '').trim();
                if (title && dueOn) {
                  await onAddReminder(title, dueOn);
                  setShowAddReminder(false);
                }
              }}
              className="grid gap-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3 sm:grid-cols-3 dark:border-brand-900/40 dark:bg-brand-950/20"
            >
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Título do lembrete *
                </label>
                <input
                  name="title"
                  required
                  placeholder={`Ex: Cobrar parcela de ${person.nickname}...`}
                  className="field-input w-full text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Data de vencimento *
                </label>
                <input
                  name="due_on"
                  type="date"
                  required
                  defaultValue={today}
                  className="field-input w-full text-xs"
                />
              </div>
              <div className="flex gap-2 sm:col-span-3 pt-1">
                <button disabled={busy} className="btn-primary px-3 py-1 text-xs font-semibold">
                  {busy ? 'Salvando…' : 'Salvar lembrete'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddReminder(false)}
                  className="px-2 py-1 text-xs font-medium text-slate-500 hover:underline"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {detail.reminders.length === 0 ? (
            <p className="rounded-lg bg-white p-3 text-xs text-slate-500 shadow-sm dark:bg-slate-800">
              Nenhum lembrete na Agenda ligado a esta pessoa.
            </p>
          ) : (
            <div className="space-y-1.5">
              {detail.reminders.map(item => {
                const isCompleted = !!item.completed_at;
                const isOverdue = !isCompleted && item.effective_due_on < today;
                const isToday = !isCompleted && item.effective_due_on === today;

                return (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-xs transition ${
                      isCompleted
                        ? 'border-slate-200 bg-slate-50/60 opacity-70 dark:border-slate-800 dark:bg-slate-800/40'
                        : isOverdue
                          ? 'border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20'
                          : isToday
                            ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20'
                            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onToggleReminder(item.id, item.version, !isCompleted)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                          isCompleted
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-slate-300 bg-white hover:border-slate-400 dark:border-slate-600 dark:bg-slate-700'
                        }`}
                        title={isCompleted ? 'Reabrir lembrete' : 'Marcar como concluído'}
                      >
                        {isCompleted && <Check size={12} strokeWidth={3} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p className={`font-medium ${isCompleted ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 pt-0.5">
                          <span
                            className={`inline-flex items-center gap-0.5 font-semibold ${
                              isCompleted
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : isOverdue
                                  ? 'text-red-600 dark:text-red-400'
                                  : isToday
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {displayDate(item.effective_due_on)}
                            {isCompleted && ' • Concluído'}
                            {!isCompleted && isOverdue && ' • Vencido'}
                            {!isCompleted && isToday && ' • Vence hoje'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!isCompleted && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSettleReminder(item)}
                        className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 font-semibold text-brand-700 transition hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-900/60"
                        title="Registrar pagamento ou recebimento desta parcela"
                      >
                        <HandCoins size={12} />
                        <span>Dar baixa</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
