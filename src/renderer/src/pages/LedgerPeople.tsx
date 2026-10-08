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
  FileText,
  HandCoins,
  History,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
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
import { addDays, addMonthsClamped, calculateNextMonthlyDueDate, calculatePeopleLoan, getPersonLoanDates, getPersonLoanTerms, type PeopleLoanFrequency, type PeopleLoanPayMode } from '../../../shared/finance/peopleLoans';
import CurrencyInput from '../components/CurrencyInput';

const panel = 'card p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full field-input';
const displayDate = (value: string) => value.split('-').reverse().join('/');

function safeParseBrlCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value);
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  try {
    return parseBrlCents(trimmed);
  } catch {
    return 0;
  }
}

type Direction = 'receive' | 'pay' | 'lend' | 'borrow';
const movementActions = [
  { direction: 'receive', label: 'Receber', Icon: ArrowDownLeft },
  { direction: 'pay', label: 'Pagar', Icon: ArrowUpRight },
  { direction: 'lend', label: 'Emprestar', Icon: ArrowUpRight },
  { direction: 'borrow', label: 'Pegar emprestado', Icon: ArrowDownLeft }
] as const;

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
  received_cents?: number;
  paid_cents?: number;
  lent_cents?: number;
  borrowed_cents?: number;
  interest_received_cents?: number;
  interest_paid_cents?: number;
  reminders?: { id: string; title: string; due_on: string; completed_at: string | null; version?: number }[];
}

interface PersonDetail {
  person: Contact;
  balance_cents: number;
  movements: {
    id: string;
    version?: number;
    notes?: string | null;
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
  const [movementInterest, setMovementInterest] = useState('');
  const [movementDate, setMovementDate] = useState<string>(workspace.space.today);

  // Add person with initial debt state
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [addPersonDebt, setAddPersonDebt] = useState<'none' | 'receivable' | 'payable'>('none');
  const [addPersonDebtAmount, setAddPersonDebtAmount] = useState('');
  const [addPersonDebtDate, setAddPersonDebtDate] = useState(workspace.space.today);
  const [addPersonConfigureLoan, setAddPersonConfigureLoan] = useState(true);
  const [addPersonLoanInterestType, setAddPersonLoanInterestType] = useState<'percent' | 'fixed' | 'none'>('none');
  const [addPersonLoanInterestRate, setAddPersonLoanInterestRate] = useState('5');
  const [addPersonLoanInterestFixed, setAddPersonLoanInterestFixed] = useState('');
  const [addPersonLoanInterestPeriod, setAddPersonLoanInterestPeriod] = useState<'total' | 'monthly' | 'daily'>('monthly');
  const [addPersonLoanFrequency, setAddPersonLoanFrequency] = useState<PeopleLoanFrequency>('monthly');
  const [addPersonLoanCount, setAddPersonLoanCount] = useState(1);
  const [addPersonLoanPayMode, setAddPersonLoanPayMode] = useState<PeopleLoanPayMode>('installments');
  const [addPersonLoanFirstDue, setAddPersonLoanFirstDue] = useState(() => addMonthsClamped(workspace.space.today, 1));
  const [addPersonLoanCreateReminders, setAddPersonLoanCreateReminders] = useState(true);

  // Loan with interest and installments state
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanPersonId, setLoanPersonId] = useState('');
  const [loanDirection, setLoanDirection] = useState<'lend' | 'borrow'>('lend');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanInterestType, setLoanInterestType] = useState<'percent' | 'fixed' | 'none'>('none');
  const [loanInterestRate, setLoanInterestRate] = useState('5');
  const [loanInterestFixed, setLoanInterestFixed] = useState('');
  const [loanInterestPeriod, setLoanInterestPeriod] = useState<'total' | 'monthly' | 'daily'>('monthly');
  const [loanFrequency, setLoanFrequency] = useState<PeopleLoanFrequency>('monthly');
  const [loanInstallmentsCount, setLoanInstallmentsCount] = useState(1);
  const [loanMonths, setLoanMonths] = useState(1);
  const [loanPayMode, setLoanPayMode] = useState<PeopleLoanPayMode>('installments');
  const [loanStartDate, setLoanStartDate] = useState(workspace.space.today);
  const [loanFirstDueDate, setLoanFirstDueDate] = useState(() => addMonthsClamped(workspace.space.today, 1));
  const [loanElapsedMonthsOverride, setLoanElapsedMonthsOverride] = useState<number | null>(null);
  const [loanMoveCash, setLoanMoveCash] = useState(true);
  const [loanAccountId, setLoanAccountId] = useState('');
  const [loanCreateReminders, setLoanCreateReminders] = useState(true);

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
  const movementDialog = useRef<HTMLDivElement>(null);
  const sharedDialog = useRef<HTMLDivElement>(null);
  const loanDialog = useRef<HTMLDivElement>(null);
  const requestKey = useRef<{ key: string; id: string } | null>(null);

  const canWrite = workspace.role !== 'viewer';
  const cashAccounts = workspace.accounts.filter(account => account.liquidity === 'cash');

  useEffect(() => {
    if (!movementPersonId && !showSharedExpense && !showLoanForm) return;
    const activeDialog = showLoanForm ? loanDialog : showSharedExpense ? sharedDialog : movementDialog;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    activeDialog.current?.querySelector<HTMLElement>('input:not([type="hidden"]),select')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) {
        setMovementPersonId(null);
        setShowSharedExpense(false);
        setShowLoanForm(false);
      }
      if (event.key !== 'Tab') return;
      const elements = activeDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [movementPersonId, showSharedExpense, showLoanForm]);

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
    () => activeContacts.filter(c => c.balance_cents > 0).reduce((acc, c) => acc + getPersonLoanTerms(c, workspace.space.today).totalRemainingCents, 0),
    [activeContacts, workspace.space.today]
  );
  const countReceivable = useMemo(
    () => activeContacts.filter(c => c.balance_cents > 0).length,
    [activeContacts]
  );
  const totalPayable = useMemo(
    () => activeContacts.filter(c => c.balance_cents < 0).reduce((acc, c) => acc + getPersonLoanTerms(c, workspace.space.today).totalRemainingCents, 0),
    [activeContacts, workspace.space.today]
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
      const amount = safeParseBrlCents(text('amount'));
      const interest = text('interest') ? safeParseBrlCents(text('interest')) : 0;
      if (amount <= 0) throw new Error('Informe um valor maior que zero.');
      if (interest < 0 || interest > amount) throw new Error('Os juros devem estar entre zero e o valor total pago.');
      if (interest > 0 && !text('interest_category')) throw new Error('Selecione a categoria dos juros antes de confirmar o pagamento.');
      const targetPerson = text('person') || movementPersonId;
      if (!targetPerson) throw new Error('Selecione uma pessoa.');
      const accountId = text('account') || cashAccounts[0]?.id;
      if (!accountId) throw new Error('Selecione uma conta bancária.');

      const targetContact = contacts.find(c => c.id === targetPerson);
      const customDesc = text('description');
      const defaultDesc = movementDirection === 'lend'
        ? `Empréstimo para ${targetContact?.nickname || 'pessoa'}`
        : movementDirection === 'borrow'
        ? `Empréstimo de ${targetContact?.nickname || 'pessoa'}`
        : movementDirection === 'receive'
        ? `Recebimento de ${targetContact?.nickname || 'pessoa'}`
        : `Pagamento para ${targetContact?.nickname || 'pessoa'}`;
      const finalDesc = customDesc || defaultDesc;

      pending.current = true;
      setBusy(true);
      setError('');
      setNotice('');

      await ledgerRpc(interest>0?'settle_person_with_interest':'settle_person', {
        p_space: workspace.space.id,
        p_person: targetPerson,
        p_account: accountId,
        p_direction: movementDirection,
        p_amount_cents: amount,
        p_occurred_on: text('date'),
        p_client_uuid: crypto.randomUUID(),
        p_description: finalDesc,
        ...(interest>0?{p_interest_cents:interest,p_category:text('interest_category')}: {})
      });

      // Auto-complete Agenda reminder(s) when payment/settlement is made
      if (movementDirection === 'pay' || movementDirection === 'receive') {
        try {
          const pendingReminders = targetContact?.reminders?.filter(r => !r.completed_at) || [];
          if (pendingReminders.length > 0) {
            const netDelta = movementDirection === 'pay' ? amount : -amount;
            const newBal = (targetContact?.balance_cents ?? 0) + netDelta;
            const isFullPayoff = newBal === 0;
            const toComplete = isFullPayoff ? pendingReminders : [pendingReminders[0]];
            for (const rem of toComplete) {
              const remVer = rem.version ?? 1;
              await ledgerRpc('complete_reminder', {
                p_space: workspace.space.id,
                p_commitment: rem.id,
                p_version: remVer,
                p_completed: true
              }).catch(() => {});
            }
          }
        } catch (autoErr) {
          console.warn('Auto-complete reminder failed:', autoErr);
        }
      }

      await onChanged();
      await loadContacts();
      if (selectedPersonId === targetPerson) {
        await loadPersonDetail(targetPerson);
      }
      setMovementPersonId(null);
      setMovementAmount('');
      setNotice(
        movementDirection === 'lend'
          ? `Empréstimo para ${targetContact?.nickname || 'pessoa'} registrado com sucesso!`
          : movementDirection === 'borrow'
          ? `Empréstimo de ${targetContact?.nickname || 'pessoa'} registrado com sucesso!`
          : movementDirection === 'receive'
          ? `Recebimento de ${money(amount)} de ${targetContact?.nickname || 'pessoa'} registrado com sucesso!`
          : `Pagamento de ${money(amount)} para ${targetContact?.nickname || 'pessoa'} registrado com sucesso!`
      );
    } catch (failure) {
      const rawMsg = failure instanceof Error ? failure.message : 'Não foi possível registrar.';
      const friendlyMsg = rawMsg.includes('Cash account not found')
        ? 'Conta bancária não encontrada. Selecione uma conta válida.'
        : rawMsg.includes('month is closed')
        ? 'O mês da movimentação está fechado no sistema. Reabra o mês em Fechamentos ou escolha uma data no mês atual.'
        : rawMsg.includes('Could not find the function') || rawMsg.includes('schema cache')
        ? 'O serviço de acertos está desatualizado. Atualize a página e tente novamente.'
        : rawMsg;
      setError(friendlyMsg);
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

    const terms = target ? getPersonLoanTerms(target, workspace.space.today) : null;
    const isSettlement = !preferredDirection || preferredDirection === 'receive' || preferredDirection === 'pay';
    if (preferredAmount !== undefined) {
      setMovementAmount(preferredAmount);
    } else if (isSettlement && target && target.balance_cents !== 0) {
      const installment = terms?.payMode === 'installments' && terms.remainingInstallments !== 0
        ? terms.installmentAmountCents
        : terms?.payMode === 'indefinite' ? terms.recurringInterestCents
        : null;
      const cents = isSettlement && installment && installment > 0
        ? Math.min(installment, terms?.totalRemainingCents ?? installment)
        : isSettlement ? terms?.totalRemainingCents ?? Math.abs(target.balance_cents) : Math.abs(target.balance_cents);
      setMovementAmount((cents / 100).toFixed(2).replace('.', ','));
    } else {
      setMovementAmount('');
    }
    const suggestedInterest = isSettlement && terms
      ? terms.payMode === 'installments'
        ? Math.round(terms.interestRemainingCents / Math.max(1, terms.remainingInstallments ?? 1))
        : terms.payMode === 'indefinite' ? Math.min(terms.recurringInterestCents ?? 0, terms.interestRemainingCents)
          : terms.interestRemainingCents
      : 0;
    const interest = preferredAmount !== undefined ? Math.min(safeParseBrlCents(preferredAmount), suggestedInterest) : suggestedInterest;
    setMovementInterest(interest > 0 ? (interest / 100).toFixed(2).replace('.', ',') : '');

    if (preferredDate) {
      setMovementDate(preferredDate);
    } else {
      setMovementDate(workspace.space.today);
    }
  }

  // Open loan form
  function openLoanForPerson(personId?: string, useExistingBalance = false) {
    if (personId) {
      setLoanPersonId(personId);
      const target = contacts.find(c => c.id === personId);
      if (target) {
        if (target.balance_cents !== 0) {
          if (useExistingBalance || !loanPrincipal) {
            const cents = Math.abs(target.balance_cents);
            setLoanPrincipal((cents / 100).toFixed(2).replace('.', ','));
            setLoanDirection(target.balance_cents > 0 ? 'lend' : 'borrow');
            setLoanMoveCash(false);
          }
        }
        const effectiveStartDate = target.opening_on || workspace.space.today;
        setLoanStartDate(effectiveStartDate);
        setLoanFirstDueDate(calculateNextMonthlyDueDate(effectiveStartDate, workspace.space.today));
        setLoanElapsedMonthsOverride(null);

        // Prefill from existing loan terms so previous configuration is preserved
        const terms = getPersonLoanTerms(target, workspace.space.today);
        if (terms.payMode) setLoanPayMode(terms.payMode);
        if (terms.frequency) setLoanFrequency(terms.frequency);
        if (terms.totalInstallments && terms.totalInstallments > 0) {
          setLoanMonths(terms.totalInstallments);
          setLoanInstallmentsCount(terms.totalInstallments);
        } else if (terms.payMode === 'single') {
          setLoanMonths(1);
          setLoanInstallmentsCount(1);
        }
        if (terms.startDate) setLoanStartDate(terms.startDate);
        if (terms.nextDueDate) setLoanFirstDueDate(terms.nextDueDate);
        if (terms.interestType) {
          setLoanInterestType(terms.interestType);
        } else {
          setLoanInterestType('none');
        }
        if (terms.interestRate) setLoanInterestRate(terms.interestRate);
        if (terms.interestFixed) setLoanInterestFixed(terms.interestFixed);
        if (terms.interestPeriod) setLoanInterestPeriod(terms.interestPeriod);
      }
    } else if (activeContacts.length > 0 && !loanPersonId) {
      const first = activeContacts[0];
      setLoanPersonId(first.id);
      const effectiveStartDate = first.opening_on || workspace.space.today;
      setLoanStartDate(effectiveStartDate);
      setLoanFirstDueDate(calculateNextMonthlyDueDate(effectiveStartDate, workspace.space.today));
      setLoanElapsedMonthsOverride(null);
    }
    setShowLoanForm(true);
    setShowAddPerson(false);
    setShowSharedExpense(false);
    setMovementPersonId(null);
    setError('');
    setNotice('');
  }

  // Calculate loan simulation for adding person
  const addPersonLoanCalc = useMemo(() => {
    if (!addPersonConfigureLoan || addPersonDebt === 'none') return null;
    return calculatePeopleLoan({
      principalInput: addPersonDebtAmount,
      interestType: addPersonLoanInterestType,
      interestRate: addPersonLoanInterestRate,
      interestFixedInput: addPersonLoanInterestFixed,
      interestPeriod: addPersonLoanInterestPeriod,
      installmentsCount: addPersonLoanCount,
      frequency: addPersonLoanFrequency,
      payMode: addPersonLoanPayMode,
      startDate: addPersonDebtDate,
      firstDueDate: addPersonLoanFirstDue,
      today: workspace.space.today
    });
  }, [
    addPersonConfigureLoan,
    addPersonDebt,
    addPersonDebtAmount,
    addPersonDebtDate,
    addPersonLoanInterestType,
    addPersonLoanInterestRate,
    addPersonLoanInterestFixed,
    addPersonLoanInterestPeriod,
    addPersonLoanCount,
    addPersonLoanFrequency,
    addPersonLoanPayMode,
    addPersonLoanFirstDue,
    workspace.space.today
  ]);

  // Calculate loan simulation in real-time
  const loanCalc = useMemo(() => {
    return calculatePeopleLoan({
      principalInput: loanPrincipal,
      interestType: loanInterestType,
      interestRate: loanInterestRate,
      interestFixedInput: loanInterestFixed,
      interestPeriod: loanInterestPeriod,
      installmentsCount: loanFrequency === 'monthly' ? loanMonths : loanInstallmentsCount,
      frequency: loanFrequency,
      payMode: loanPayMode,
      startDate: loanStartDate,
      firstDueDate: loanFirstDueDate,
      today: workspace.space.today,
      customElapsedMonths: loanElapsedMonthsOverride ?? undefined
    });
  }, [
    loanPrincipal,
    loanInterestType,
    loanInterestRate,
    loanInterestFixed,
    loanInterestPeriod,
    loanMonths,
    loanInstallmentsCount,
    loanFrequency,
    loanPayMode,
    loanStartDate,
    loanFirstDueDate,
    workspace.space.today,
    loanElapsedMonthsOverride
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
        const loanDesc = loanDirection === 'lend'
          ? `Empréstimo para ${targetPerson.nickname}`
          : `Empréstimo de ${targetPerson.nickname}`;

        await ledgerRpc('settle_person', {
          p_space: workspace.space.id,
          p_person: targetPerson.id,
          p_account: loanAccountId,
          p_direction: loanDirection === 'lend' ? 'lend' : 'borrow',
          p_amount_cents: loanCalc.principalCents,
          p_occurred_on: workspace.space.today,
          p_client_uuid: crypto.randomUUID(),
          p_description: loanDesc
        });
      }

      // 2. Always persist the agreement: the balance display needs these terms.
      {
        const isIndefinite = loanPayMode === 'indefinite';
        const freqLabel = loanCalc.frequency === 'daily'
          ? (loanCalc.count === 1 ? 'dia' : 'dias')
          : loanCalc.frequency === 'weekly'
          ? (loanCalc.count === 1 ? 'semana' : 'semanas')
          : (loanCalc.months === 1 ? 'mês' : 'meses');

        const freqAdj = loanCalc.frequency === 'daily'
          ? 'diárias'
          : loanCalc.frequency === 'weekly'
          ? 'semanais'
          : 'mensais';

        const periodLabel = loanInterestPeriod === 'daily' ? '/dia' : loanInterestPeriod === 'monthly' ? '/mês' : 'total';
        const interestRateOrFixed = loanInterestType === 'percent'
          ? `${loanInterestRate}% ${periodLabel}`
          : loanInterestType === 'fixed'
          ? `${money(safeParseBrlCents(loanInterestFixed))} ${periodLabel}`
          : 'sem juros';

        const conditionDesc = isIndefinite
          ? `prazo indefinido (sem data final), juro de ${interestRateOrFixed} correndo todo mês com próximo vencimento em ${displayDate(loanCalc.nextDueDate || '')}`
          : loanPayMode === 'single'
          ? `pagamento único de ${money(loanCalc.totalCents)} em ${displayDate(loanCalc.schedule[0]?.dueDate || '')}`
          : `${loanCalc.count} parcelas ${freqAdj} de ~${money(loanCalc.baseInstallmentCents)} (total ${money(loanCalc.totalCents)})`;

        const interestDesc = loanCalc.interestCents > 0
          ? `+ Juros acumulados: ${money(loanCalc.interestCents)} (${interestRateOrFixed} - taxa efetiva de ${loanCalc.effectiveRate.toFixed(1)}%)`
          : loanInterestType !== 'none'
          ? `+ Juros: ${interestRateOrFixed}`
          : 'sem juros adicionais';

        const noteEntry = isIndefinite
          ? `📌 [Empréstimo por Prazo Indefinido iniciado em ${displayDate(loanStartDate)}] ${
              loanDirection === 'lend' ? 'Emprestado para' : 'Pegou emprestado de'
            } ${targetPerson.nickname}: Principal ${money(loanCalc.principalCents)} (${interestDesc}) | ${conditionDesc}.`
          : `📌 [Empréstimo iniciado em ${displayDate(loanStartDate)}] ${
              loanDirection === 'lend' ? 'Emprestado para' : 'Pegou emprestado de'
            } ${targetPerson.nickname}: Principal ${money(loanCalc.principalCents)} (${interestDesc}) | Devolução em ${loanCalc.count} ${freqLabel} (${conditionDesc}).`;

        // Replace previous loan notes instead of appending conflicting blocks
        let baseNotes = targetPerson.notes || '';
        baseNotes = baseNotes
          .replace(/📌\s*\[Empréstimo[^\]]*\].*?(?=(?:\n\n📌|$))/gis, '')
          .replace(/📌[^\n]*?\|\s*Devolução em[^\n]*/gis, '')
          .trim();
        const updatedNotes = baseNotes ? `${baseNotes}\n\n${noteEntry}` : noteEntry;

        await ledgerRpc('manage_person', {
          p_space: workspace.space.id,
          p_person: targetPerson.id,
          p_version: targetPerson.version,
          p_action: 'update',
          p_changes: { notes: updatedNotes },
          p_client_uuid: crypto.randomUUID()
        });
      }

      // 3. If creating reminders, cancel old uncompleted ones first so they don't pile up, then create Agenda commitments
      if (loanCreateReminders && loanCalc.schedule.length > 0) {
        if (targetPerson.reminders && targetPerson.reminders.length > 0) {
          for (const rem of targetPerson.reminders) {
            if (!rem.completed_at) {
              await ledgerRpc('cancel_commitment', {
                p_space: workspace.space.id,
                p_commitment: rem.id,
                p_version: rem.version ?? 1,
                p_reason: 'Condições do empréstimo redefinidas'
              }).catch(() => {});
            }
          }
        }
        for (const item of loanCalc.schedule) {
          const title = loanPayMode === 'indefinite'
            ? `${loanDirection === 'lend' ? 'Cobrar' : 'Pagar'} juros de ${targetPerson.nickname}: ${money(loanCalc.monthlyInterestCents || item.amountCents)} (Vencimento mensal)`
            : `${loanDirection === 'lend' ? 'Cobrar' : 'Pagar'} ${targetPerson.nickname}: Parcela ${item.installmentNumber}/${item.totalCount} (${money(item.amountCents)})`;
          await ledgerRpc('create_commitment', {
            p_space: workspace.space.id,
            p_payload: {
              kind: 'reminder',
              person_id: targetPerson.id,
              title,
              due_on: loanPayMode === 'indefinite' ? (loanFirstDueDate || item.dueDate) : item.dueDate
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
        !loanMoveCash
          ? `Condições de parcelas e juros configuradas com sucesso para ${targetPerson.nickname}! ${
              loanCreateReminders ? `${loanCalc.schedule.length} lembrete(s) criado(s) na Agenda.` : ''
            }`
          : `Empréstimo com ${targetPerson.nickname} registrado com sucesso! ${
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

  // Annotate / rename movement transaction
  async function handleAnnotateMovement(transactionId: string, version: number, description: string) {
    if (pending.current || !canWrite) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await ledgerRpc('annotate_transaction', {
        p_space: workspace.space.id,
        p_transaction: transactionId,
        p_version: version,
        p_changes: { description: description.trim() }
      });
      await onChanged();
      if (selectedPersonId) {
        await loadPersonDetail(selectedPersonId);
      }
      setNotice('Descrição do lançamento atualizada com sucesso!');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o lançamento.');
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
  const activeMovementTerms = activeMovementPerson ? getPersonLoanTerms(activeMovementPerson, workspace.space.today) : null;
  const activeSelectedPerson = contacts.find(c => c.id === selectedPersonId);

  return (
    <div className="space-y-6">
      {/* Header section with page title, description, and primary action buttons */}
      <section className="card p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
              <Users className="text-brand-600 dark:text-brand-400" size={26} />
              Pessoas e Empréstimos
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Gerencie contatos, quem deve para quem, empréstimos com juros e prazos, e divisão de contas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddPerson(!showAddPerson);
                    setShowSharedExpense(false);
                    setShowLoanForm(false);
                    setMovementPersonId(null);
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 transition-colors ${
                    showAddPerson ? 'ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-slate-900' : ''
                  }`}
                >
                  <UserPlus size={15} />
                  <span>Nova pessoa</span>
                </button>

                {movementActions.map(({ direction, label, Icon }) => (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => {
                      if (activeContacts.length === 0) {
                        setError('Cadastre pelo menos uma pessoa antes de registrar uma movimentação.');
                        return;
                      }
                      openMovementForPerson(activeContacts.find(person => person.id === selectedPersonId)?.id || activeContacts[0].id, undefined, direction);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Icon size={15} className={direction === 'pay' ? 'text-rose-500' : direction === 'borrow' ? 'text-amber-500' : 'text-brand-600 dark:text-brand-400'} />
                    <span>{label}</span>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    if (activeContacts.length === 0) {
                      setError('Cadastre pessoas para poder dividir despesas.');
                      return;
                    }
                    setError('');setShowSharedExpense(true);
                    setShowAddPerson(false);
                    setShowLoanForm(false);
                    setMovementPersonId(null);
                    setSharedSelectedPeople(activeContacts.map(c => c.id));
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${
                    showSharedExpense ? 'border-brand-500 ring-2 ring-brand-500/20' : ''
                  }`}
                >
                  <Receipt size={15} className="text-brand-600 dark:text-brand-400" />
                  <span>Dividir despesa</span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void loadContacts()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>
      </section>

      {/* Notifications */}
      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-200">
          <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={() => setError('')} className="text-rose-600 hover:opacity-80">
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <p className="flex-1 font-medium">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className="text-emerald-600 hover:opacity-80">
            <X size={16} />
          </button>
        </div>
      )}

      {/* 1. Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-5 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              A receber de pessoas
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              <ArrowDownLeft size={20} />
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {money(totalReceivable)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {countReceivable === 0
              ? 'Ninguém te deve nada no momento'
              : `${countReceivable} ${countReceivable === 1 ? 'pessoa te deve' : 'pessoas te devem'}`}
          </p>
        </div>

        <div className="card p-5 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              A pagar para pessoas
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
              <ArrowUpRight size={20} />
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
            {money(totalPayable)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {countPayable === 0
              ? 'Você não deve para ninguém'
              : `Você deve para ${countPayable} ${countPayable === 1 ? 'pessoa' : 'pessoas'}`}
          </p>
        </div>

        <div className="card p-5 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Balanço com pessoas
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-400">
              <Scale size={20} />
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {money(Math.abs(netBalance))}
          </p>
          <div className="mt-1">
            {netBalance > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Check size={13} /> Saldo a seu favor
              </span>
            ) : netBalance < 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                Saldo devedor total
              </span>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">Tudo em dia com todos</span>
            )}
          </div>
        </div>
      </div>

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
              // 1. Prepare notes with loan terms if configured
              let initialNotes = notes;
              if (addPersonDebt !== 'none' && addPersonConfigureLoan && addPersonLoanCalc) {
                const isIndefinite = addPersonLoanPayMode === 'indefinite';
                const freqLabel = addPersonLoanFrequency === 'daily'
                  ? (addPersonLoanCalc.count === 1 ? 'dia' : 'dias')
                  : addPersonLoanFrequency === 'weekly'
                  ? (addPersonLoanCalc.count === 1 ? 'semana' : 'semanas')
                  : (addPersonLoanCalc.count === 1 ? 'mês' : 'meses');

                const freqAdj = addPersonLoanFrequency === 'daily'
                  ? 'diárias'
                  : addPersonLoanFrequency === 'weekly'
                  ? 'semanais'
                  : 'mensais';

                const periodLabel = addPersonLoanInterestPeriod === 'daily' ? '/dia' : addPersonLoanInterestPeriod === 'monthly' ? '/mês' : 'total';
                const interestRateOrFixed = addPersonLoanInterestType === 'percent'
                  ? `${addPersonLoanInterestRate}% ${periodLabel}`
                  : addPersonLoanInterestType === 'fixed'
                  ? `${money(safeParseBrlCents(addPersonLoanInterestFixed))} ${periodLabel}`
                  : 'sem juros';

                const conditionDesc = isIndefinite
                  ? `prazo indefinido (sem data final), juro de ${interestRateOrFixed} correndo todo mês com próximo vencimento em ${displayDate(addPersonLoanCalc.nextDueDate || '')}`
                  : addPersonLoanPayMode === 'single'
                  ? `pagamento único de ${money(addPersonLoanCalc.totalCents)} em ${displayDate(addPersonLoanCalc.schedule[0]?.dueDate || '')}`
                  : `${addPersonLoanCalc.count} parcelas ${freqAdj} de ~${money(addPersonLoanCalc.baseInstallmentCents)} (total ${money(addPersonLoanCalc.totalCents)})`;

                const interestDesc = addPersonLoanCalc.interestCents > 0
                  ? `+ Juros acumulados: ${money(addPersonLoanCalc.interestCents)} (${interestRateOrFixed} - taxa efetiva de ${addPersonLoanCalc.effectiveRate.toFixed(1)}%)`
                  : addPersonLoanInterestType !== 'none'
                  ? `+ Juros: ${interestRateOrFixed}`
                  : 'sem juros adicionais';

                const loanNote = isIndefinite
                  ? `📌 [Empréstimo por Prazo Indefinido em ${displayDate(addPersonDebtDate || workspace.space.today)}] ${
                      addPersonDebt === 'receivable' ? 'Emprestado para' : 'Pegou emprestado de'
                    } ${nickname}: Principal ${money(addPersonLoanCalc.principalCents)} (${interestDesc}) | ${conditionDesc}.`
                  : `📌 [Empréstimo em ${displayDate(addPersonDebtDate || workspace.space.today)}] ${
                      addPersonDebt === 'receivable' ? 'Emprestado para' : 'Pegou emprestado de'
                    } ${nickname}: Principal ${money(addPersonLoanCalc.principalCents)} (${interestDesc}) | Devolução em ${addPersonLoanCalc.count} ${freqLabel} (${conditionDesc}).`;

                initialNotes = initialNotes ? `${initialNotes}\n\n${loanNote}` : loanNote;
              }

              // 1. Create person
              const id = await ledgerRpc<string>('manage_person', {
                p_space: workspace.space.id,
                p_person: null,
                p_version: null,
                p_action: 'create',
                p_changes: { nickname, notes: initialNotes },
                p_client_uuid: crypto.randomUUID()
              });

              // 2. If initial debt was specified, set opening balance
              if (addPersonDebt !== 'none') {
                const cents = safeParseBrlCents(addPersonDebtAmount);
                if (cents > 0) {
                  try {
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
                  } catch (openingErr) {
                    const msg = openingErr instanceof Error ? openingErr.message : '';
                    if (msg.includes('month is closed')) {
                      throw new Error('A pessoa foi cadastrada, mas o saldo inicial não pôde ser lançado porque o mês da data informada está fechado no sistema. Reabra o mês em Fechamentos ou informe uma data no mês atual.');
                    }
                    if (msg.includes('opening balance or date')) {
                      throw new Error('A data da dívida inicial não pode ser futura.');
                    }
                    throw openingErr;
                  }
                }
              }

              // 3. If loan reminders are enabled, create Agenda commitments
              let createdRemindersCount = 0;
              if (
                addPersonDebt !== 'none' &&
                addPersonConfigureLoan &&
                addPersonLoanCreateReminders &&
                addPersonLoanCalc &&
                addPersonLoanCalc.schedule.length > 0
              ) {
                for (const item of addPersonLoanCalc.schedule) {
                  const title = addPersonLoanPayMode === 'indefinite'
                    ? `${addPersonDebt === 'receivable' ? 'Cobrar' : 'Pagar'} juros de ${nickname}: ${money(addPersonLoanCalc.monthlyInterestCents || item.amountCents)} (Vencimento mensal)`
                    : `${addPersonDebt === 'receivable' ? 'Cobrar' : 'Pagar'} ${nickname}: Parcela ${item.installmentNumber}/${item.totalCount} (${money(item.amountCents)})`;
                  try {
                    await ledgerRpc('create_commitment', {
                      p_space: workspace.space.id,
                      p_payload: {
                        kind: 'reminder',
                        person_id: id,
                        title,
                        due_on: item.dueDate
                      }
                    });
                    createdRemindersCount++;
                  } catch (reminderErr) {
                    console.warn('Erro ao criar lembrete na Agenda:', reminderErr);
                  }
                }
              }

              const finalCents = safeParseBrlCents(addPersonDebtAmount);
              form.reset();
              setAddPersonDebt('none');
              setAddPersonDebtAmount('');
              setAddPersonDebtDate(workspace.space.today);
              setAddPersonConfigureLoan(false);
              setAddPersonLoanInterestFixed('');
              setShowAddPerson(false);
              setSelectedPersonId(id);
              await loadContacts();
              await onChanged();
              setNotice(
                addPersonDebt !== 'none' && finalCents > 0
                  ? addPersonConfigureLoan && addPersonLoanCalc
                    ? `Pessoa "${nickname}" adicionada com saldo de ${money(finalCents)}${createdRemindersCount > 0 ? ` e ${createdRemindersCount} lembrete(s) criado(s) na Agenda` : ''}!`
                    : `Pessoa "${nickname}" adicionada com saldo inicial de ${money(finalCents)} (${
                        addPersonDebt === 'receivable' ? 'a receber' : 'a pagar'
                      })!`
                  : `Pessoa "${nickname}" adicionada com sucesso!`
              );
            } catch (failure) {
              const rawMsg = failure instanceof Error ? failure.message : 'Não foi possível cadastrar a pessoa.';
              const friendlyMsg = rawMsg.includes('month is closed')
                ? 'A pessoa não pôde ser cadastrada com o saldo inicial porque o mês da data informada está fechado no sistema. Reabra o mês em Fechamentos ou informe uma data no mês atual.'
                : rawMsg.includes('opening balance or date')
                ? 'A data da dívida inicial não pode ser futura.'
                : rawMsg.includes('Informe um valor')
                ? 'Confira os valores monetários informados.'
                : rawMsg;
              setError(friendlyMsg);
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

          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs sm:text-sm font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-200">
              <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <p className="flex-1">{error}</p>
              <button type="button" onClick={() => setError('')} className="text-rose-600 hover:opacity-80">
                <X size={16} />
              </button>
            </div>
          )}

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
                onClick={() => {
                  setAddPersonDebt('receivable');
                  setAddPersonConfigureLoan(true);
                }}
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
                onClick={() => {
                  setAddPersonDebt('payable');
                  setAddPersonConfigureLoan(true);
                }}
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
                    onChange={e => {
                      const val = e.target.value;
                      setAddPersonDebtDate(val);
                      if (addPersonLoanPayMode === 'indefinite') {
                        setAddPersonLoanFirstDue(calculateNextMonthlyDueDate(val, workspace.space.today));
                      }
                    }}
                    max={workspace.space.today}
                    required
                    className={input}
                  />
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Esse valor será lançado como saldo inicial desta pessoa sem afetar as despesas ou receitas correntes.
                </p>

                {/* Loan conditions card */}
                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900/60 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Coins size={16} className="text-amber-600 dark:text-amber-400" />
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Condições do empréstimo (juros, parcelas e prazos)
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-brand-600 dark:text-brand-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addPersonConfigureLoan}
                        onChange={e => setAddPersonConfigureLoan(e.target.checked)}
                        className="rounded text-brand-600 focus:ring-brand-500"
                      />
                      <span>{addPersonConfigureLoan ? 'Configurando condições' : 'Definir juros / parcelas'}</span>
                    </label>
                  </div>

                  {!addPersonConfigureLoan ? (
                    <p className="pt-2 text-xs text-slate-500 dark:text-slate-400">
                      Marque acima se você combinou juros (por mês ou diário), quantidade de parcelas ou quer criar lembretes de cobrança na Agenda.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {/* Periodicidade */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          Como será feito o pagamento?
                        </label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                          <button
                            type="button"
                            onClick={() => {
                              setAddPersonLoanFrequency('monthly');
                              setAddPersonLoanPayMode('installments');
                            }}
                            className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                              addPersonLoanFrequency === 'monthly' && addPersonLoanPayMode === 'installments'
                                ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                            }`}
                          >
                            <span>Mensal (por mês)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddPersonLoanFrequency('daily');
                              setAddPersonLoanPayMode('installments');
                            }}
                            className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                              addPersonLoanFrequency === 'daily' && addPersonLoanPayMode === 'installments'
                                ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                            }`}
                          >
                            <span>Diário (por dia)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddPersonLoanFrequency('weekly');
                              setAddPersonLoanPayMode('installments');
                            }}
                            className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                              addPersonLoanFrequency === 'weekly' && addPersonLoanPayMode === 'installments'
                                ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                            }`}
                          >
                            <span>Semanal</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddPersonLoanPayMode('single')}
                            className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                              addPersonLoanPayMode === 'single'
                                ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                            }`}
                          >
                            <span>Pagamento único</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddPersonLoanFrequency('monthly');
                              setAddPersonLoanPayMode('indefinite');
                              setAddPersonLoanFirstDue(calculateNextMonthlyDueDate(addPersonDebtDate, workspace.space.today));
                            }}
                            className={`col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                              addPersonLoanPayMode === 'indefinite'
                                ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                            }`}
                          >
                            <Clock size={13} className="shrink-0 text-brand-600 dark:text-brand-400" />
                            <span>Data indefinida</span>
                          </button>
                        </div>
                      </div>

                      {/* Prazo e Primeiro Vencimento */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {addPersonLoanPayMode === 'installments' && (
                          <div className="grid gap-1.5 text-xs">
                            <label className="font-medium text-slate-700 dark:text-slate-300">
                              {addPersonLoanFrequency === 'daily'
                                ? 'Quantidade de dias (parcelas diárias) *'
                                : addPersonLoanFrequency === 'weekly'
                                ? 'Quantidade de semanas *'
                                : 'Quantidade de meses (parcelas mensais) *'}
                            </label>
                            <div className="flex items-center gap-2">
                              <div className="flex flex-wrap gap-1">
                                {(addPersonLoanFrequency === 'daily'
                                  ? [7, 15, 30, 60]
                                  : addPersonLoanFrequency === 'weekly'
                                  ? [2, 4, 8, 12]
                                  : [1, 2, 3, 6, 12]
                                ).map(n => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setAddPersonLoanCount(n)}
                                    className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                                      addPersonLoanCount === n
                                        ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
                                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                                    }`}
                                  >
                                    {n}
                                    {addPersonLoanFrequency === 'daily' ? 'd' : addPersonLoanFrequency === 'weekly' ? 'sem' : 'm'}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="number"
                                min={1}
                                max={addPersonLoanFrequency === 'daily' ? 365 : 60}
                                value={addPersonLoanCount}
                                onChange={e =>
                                  setAddPersonLoanCount(
                                    Math.max(1, Math.min(addPersonLoanFrequency === 'daily' ? 365 : 60, Number(e.target.value) || 1))
                                  )
                                }
                                className="field-input w-16 text-center text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {addPersonLoanPayMode === 'installments' && (
                          <div className="grid gap-1.5 text-xs">
                            <label className="font-medium text-slate-700 dark:text-slate-300">
                              Data do 1º vencimento *
                            </label>
                            <input
                              type="date"
                              value={addPersonLoanFirstDue}
                              onChange={e => setAddPersonLoanFirstDue(e.target.value)}
                              required
                              className="field-input text-xs"
                            />
                          </div>
                        )}

                        {addPersonLoanPayMode === 'single' && (
                          <div className="grid gap-1.5 text-xs sm:col-span-2">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <label className="font-medium text-slate-700 dark:text-slate-300">
                                Data do pagamento único *
                              </label>
                              <button
                                type="button"
                                onClick={() => setAddPersonLoanPayMode('indefinite')}
                                className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                              >
                                Não tem data fixa? Mudar para Data Indefinida
                              </button>
                            </div>
                            <input
                              type="date"
                              value={addPersonLoanFirstDue}
                              onChange={e => setAddPersonLoanFirstDue(e.target.value)}
                              required
                              className="field-input text-xs sm:w-1/2"
                            />
                          </div>
                        )}

                        {addPersonLoanPayMode === 'indefinite' && (
                          <div className="grid gap-1.5 text-xs sm:col-span-2">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <label className="font-semibold text-slate-700 dark:text-slate-300">
                                Data do próximo vencimento do juro mensal *
                              </label>
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                                Prazo indefinido • Juros correm todo mês
                              </span>
                            </div>
                            <input
                              type="date"
                              value={addPersonLoanFirstDue}
                              onChange={e => setAddPersonLoanFirstDue(e.target.value)}
                              required
                              className="field-input text-xs sm:w-1/2"
                            />
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              O empréstimo fica em aberto sem data final. A cada mês, o juro combinado é contabilizado até o acerto da dívida.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Juros */}
                      <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/40">
                        <label className="font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                          Juros combinados:
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setAddPersonLoanInterestType('none')}
                            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold transition ${
                              addPersonLoanInterestType === 'none'
                                ? 'border-brand-500 bg-white text-brand-900 ring-2 ring-brand-500/30 dark:bg-slate-800 dark:text-brand-200'
                                : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                            }`}
                          >
                            <Check size={14} />
                            <span>Sem juros</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddPersonLoanInterestType('fixed')}
                            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold transition ${
                              addPersonLoanInterestType === 'fixed'
                                ? 'border-brand-500 bg-white text-brand-900 ring-2 ring-brand-500/30 dark:bg-slate-800 dark:text-brand-200'
                                : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                            }`}
                          >
                            <Coins size={14} />
                            <span>Valor fixo em R$</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddPersonLoanInterestType('percent')}
                            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs font-semibold transition ${
                              addPersonLoanInterestType === 'percent'
                                ? 'border-brand-500 bg-white text-brand-900 ring-2 ring-brand-500/30 dark:bg-slate-800 dark:text-brand-200'
                                : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                            }`}
                          >
                            <Percent size={14} />
                            <span>Taxa em %</span>
                          </button>
                        </div>

                        {addPersonLoanInterestType === 'fixed' && (
                          <div className="grid gap-2 sm:grid-cols-2 pt-1">
                            <div className="grid gap-1">
                              <label className="font-medium text-slate-700 dark:text-slate-300">Valor do juro (R$)</label>
                              <CurrencyInput
                                value={addPersonLoanInterestFixed}
                                onChange={e => setAddPersonLoanInterestFixed(e.target.value)}
                                placeholder="0,00"
                                className="field-input text-xs"
                              />
                            </div>
                            <div className="grid gap-1">
                              <label className="font-medium text-slate-700 dark:text-slate-300">Cobrança do juro</label>
                              <select
                                value={addPersonLoanInterestPeriod}
                                onChange={e => setAddPersonLoanInterestPeriod(e.target.value as any)}
                                className="field-input text-xs"
                              >
                                {addPersonLoanFrequency === 'daily' && <option value="daily">Por dia (diário)</option>}
                                <option value="monthly">Por mês (mensal)</option>
                                {addPersonLoanPayMode !== 'indefinite' && <option value="total">Valor fixo no total</option>}
                              </select>
                            </div>
                          </div>
                        )}

                        {addPersonLoanInterestType === 'percent' && (
                          <div className="grid gap-2 sm:grid-cols-2 pt-1">
                            <div className="grid gap-1">
                              <label className="font-medium text-slate-700 dark:text-slate-300">Taxa (%)</label>
                              <input
                                type="text"
                                value={addPersonLoanInterestRate}
                                onChange={e => setAddPersonLoanInterestRate(e.target.value)}
                                placeholder="Ex: 5"
                                className="field-input text-xs"
                              />
                            </div>
                            <div className="grid gap-1">
                              <label className="font-medium text-slate-700 dark:text-slate-300">Período da taxa</label>
                              <select
                                value={addPersonLoanInterestPeriod}
                                onChange={e => setAddPersonLoanInterestPeriod(e.target.value as any)}
                                className="field-input text-xs"
                              >
                                {addPersonLoanFrequency === 'daily' && <option value="daily">% ao dia</option>}
                                <option value="monthly">% ao mês</option>
                                {addPersonLoanPayMode !== 'indefinite' && <option value="total">% no total</option>}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Resumo da simulação */}
                      {addPersonLoanCalc && (
                        addPersonLoanCalc.isIndefinite ? (
                          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/30">
                            <div className="flex items-center justify-between gap-2 pb-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                                Prazo indefinido • Juros mensais contínuos
                              </span>
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                {(addPersonLoanCalc.elapsedMonths || 0) > 0
                                  ? `${addPersonLoanCalc.elapsedMonths} mês(es) decorridos`
                                  : 'Início recente'}
                              </span>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-3 text-xs">
                              <div className="rounded-lg bg-white p-2 shadow-2xs dark:bg-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">Principal</span>
                                <p className="font-bold text-slate-900 dark:text-slate-100">{money(addPersonLoanCalc.principalCents)}</p>
                              </div>
                              <div className="rounded-lg bg-white p-2 shadow-2xs dark:bg-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">
                                  {(addPersonLoanCalc.elapsedMonths || 0) > 0 ? 'Juros acumulados' : 'Juro a cada mês'}
                                </span>
                                <p className="font-bold text-amber-700 dark:text-amber-400">
                                  {(addPersonLoanCalc.elapsedMonths || 0) > 0
                                    ? `+${money(addPersonLoanCalc.interestCents)}`
                                    : `+${money(addPersonLoanCalc.monthlyInterestCents || 0)}/mês`}
                                </p>
                              </div>
                              <div className="rounded-lg bg-white p-2 shadow-2xs dark:bg-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">Total atual a {addPersonDebt === 'receivable' ? 'receber' : 'pagar'}</span>
                                <p className="font-bold text-brand-700 dark:text-brand-300">{money(addPersonLoanCalc.totalCents)}</p>
                              </div>
                            </div>
                            <div className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                              <p>
                                📅 Juro acordado: <strong>{money(addPersonLoanCalc.monthlyInterestCents || 0)} por mês</strong>
                                {addPersonLoanCalc.nextDueDate && (
                                  <span> • Próximo vencimento do juro em <strong>{displayDate(addPersonLoanCalc.nextDueDate)}</strong></span>
                                )}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                O juro continuará sendo somado mês a mês enquanto a dívida não for quitada.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-900/60 dark:bg-brand-950/30">
                            <div className="grid gap-2 sm:grid-cols-3 text-xs">
                              <div className="rounded-lg bg-white p-2 shadow-2xs dark:bg-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">Principal</span>
                                <p className="font-bold text-slate-900 dark:text-slate-100">{money(addPersonLoanCalc.principalCents)}</p>
                              </div>
                              <div className="rounded-lg bg-white p-2 shadow-2xs dark:bg-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">Juros</span>
                                <p className="font-bold text-amber-700 dark:text-amber-400">+{money(addPersonLoanCalc.interestCents)}</p>
                              </div>
                              <div className="rounded-lg bg-white p-2 shadow-2xs dark:bg-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">Total a {addPersonDebt === 'receivable' ? 'receber' : 'pagar'}</span>
                                <p className="font-bold text-brand-700 dark:text-brand-300">{money(addPersonLoanCalc.totalCents)}</p>
                              </div>
                            </div>
                            <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                              Devolução: {addPersonLoanPayMode === 'single'
                                ? `1x pagamento único de ${money(addPersonLoanCalc.totalCents)} em ${displayDate(addPersonLoanCalc.schedule[0]?.dueDate || '')}`
                                : `${addPersonLoanCalc.count}x de ~${money(addPersonLoanCalc.baseInstallmentCents)} (${addPersonLoanFrequency === 'daily' ? 'diárias' : addPersonLoanFrequency === 'weekly' ? 'semanais' : 'mensais'})`}
                            </p>
                          </div>
                        )
                      )}

                      {/* Checkbox de lembretes */}
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={addPersonLoanCreateReminders}
                          onChange={e => setAddPersonLoanCreateReminders(e.target.checked)}
                          className="rounded text-brand-600 focus:ring-brand-500"
                        />
                        <span>Criar lembretes de {addPersonDebt === 'receivable' ? 'cobrança' : 'pagamento'} na Agenda para cada vencimento</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 sm:-mx-5 sm:-mb-5 sm:px-5 rounded-b-xl shadow-lg">
            {error && (
              <div className="w-full pb-1">
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertCircle size={14} className="shrink-0" /> {error}
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {busy ? (
                <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-medium">
                  <RefreshCw size={14} className="animate-spin" /> Salvando cadastro...
                </span>
              ) : (
                <span>Campos com * são obrigatórios</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowAddPerson(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary flex items-center gap-2 px-5 py-2 text-sm font-semibold shadow-md"
              >
                {busy ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Salvando…</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={16} />
                    <span>Salvar pessoa</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 4. Loan Form: Empréstimo com juros, prazos e simulação - Modal Dialog */}
      {canWrite && showLoanForm && (
        <div
          ref={loanDialog}
          role="dialog"
          aria-modal="true"
          aria-label="Condições do empréstimo (juros, parcelas e prazos)"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-4"
          onClick={event => {
            if (event.target === event.currentTarget && !busy) setShowLoanForm(false);
          }}
        >
          <form
            aria-label="Registrar empréstimo com juros e prazos"
            onSubmit={submitLoan}
            className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4"
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

            {error && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs sm:text-sm font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-200">
                <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <p className="flex-1">{error}</p>
                <button type="button" onClick={() => setError('')} className="text-rose-600 hover:opacity-80">
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Contact selector & Direction */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 text-sm">
                <label htmlFor="loan-person-select" className="font-medium text-slate-700 dark:text-slate-300">
                  Pessoa do empréstimo *
                </label>
                <select
                  id="loan-person-select"
                  value={loanPersonId}
                  onChange={e => {
                    const selectedId = e.target.value;
                    setLoanPersonId(selectedId);
                    if (selectedId) {
                      openLoanForPerson(selectedId, true);
                    }
                  }}
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

            {/* Prompt se a pessoa selecionada já tiver dívida existente */}
            {(() => {
              const currentContact = contacts.find(c => c.id === loanPersonId);
              if (!currentContact || currentContact.balance_cents === 0) return null;
              const owesYou = currentContact.balance_cents > 0;
              const balanceAbs = Math.abs(currentContact.balance_cents);
              const isUsingExisting = !loanMoveCash && safeParseBrlCents(loanPrincipal) === balanceAbs;
              if (isUsingExisting) {
                return (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
                      <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        Usando saldo existente de {money(balanceAbs)} ({owesYou ? 'a receber' : 'a pagar'}) sem movimentar o banco.
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-amber-900 dark:text-amber-200">
                        Saldo pendente existente: {currentContact.nickname} {owesYou ? `já te deve ${money(balanceAbs)}` : `você já deve ${money(balanceAbs)}`}.
                      </span>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        Deseja parcelar ou adicionar juros a este saldo existente sem movimentar o banco novamente?
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLoanPrincipal((balanceAbs / 100).toFixed(2).replace('.', ','));
                        setLoanDirection(owesYou ? 'lend' : 'borrow');
                        setLoanMoveCash(false);
                        const sDate = currentContact.opening_on || workspace.space.today;
                        setLoanStartDate(sDate);
                        setLoanFirstDueDate(calculateNextMonthlyDueDate(sDate, workspace.space.today));
                        setLoanElapsedMonthsOverride(null);
                      }}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 transition"
                    >
                      Usar saldo de {money(balanceAbs)}
                    </button>
                  </div>
                </div>
              );
            })()}

          {/* Periodicidade de pagamento */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Como será feito o pagamento / devolução? *
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <button
                type="button"
                onClick={() => {
                  setLoanFrequency('monthly');
                  setLoanPayMode('installments');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                  loanFrequency === 'monthly' && loanPayMode === 'installments'
                    ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                }`}
              >
                <span>Mensal (por mês)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoanFrequency('daily');
                  setLoanPayMode('installments');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                  loanFrequency === 'daily' && loanPayMode === 'installments'
                    ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                }`}
              >
                <span>Diário (por dia)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoanFrequency('weekly');
                  setLoanPayMode('installments');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                  loanFrequency === 'weekly' && loanPayMode === 'installments'
                    ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                }`}
              >
                <span>Semanal</span>
              </button>
              <button
                type="button"
                onClick={() => setLoanPayMode('single')}
                className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                  loanPayMode === 'single'
                    ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                }`}
              >
                <span>Pagamento único</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoanFrequency('monthly');
                  setLoanPayMode('indefinite');
                  setLoanFirstDueDate(calculateNextMonthlyDueDate(loanStartDate, workspace.space.today));
                  setLoanElapsedMonthsOverride(null);
                }}
                className={`col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-bold transition ${
                  loanPayMode === 'indefinite'
                    ? 'border-brand-500 bg-brand-50 text-brand-900 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
                }`}
              >
                <Clock size={13} className="shrink-0 text-brand-600 dark:text-brand-400" />
                <span>Data indefinida</span>
              </button>
            </div>
          </div>

          {/* Principal Amount & Prazo */}
          <div className={`grid gap-3 ${loanPayMode === 'indefinite' ? 'sm:grid-cols-1' : 'sm:grid-cols-2'}`}>
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

            {loanPayMode !== 'indefinite' && (
              <div className="grid gap-1.5 text-sm">
                <label className="font-medium text-slate-700 dark:text-slate-300">
                  {loanFrequency === 'daily'
                    ? `Prazo: quantos dias ${loanPayMode === 'single' ? 'até pagar' : '(parcelas diárias)'}? *`
                    : loanFrequency === 'weekly'
                    ? `Prazo: quantas semanas ${loanPayMode === 'single' ? 'até pagar' : '(parcelas semanais)'}? *`
                    : `Prazo: quantos meses ${loanPayMode === 'single' ? 'até pagar' : '(parcelas mensais)'}? *`}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1">
                    {(loanFrequency === 'daily'
                      ? [7, 15, 30, 60]
                      : loanFrequency === 'weekly'
                      ? [2, 4, 8, 12]
                      : [1, 2, 3, 6, 12]
                    ).map(n => {
                      const isSelected = loanFrequency === 'monthly' ? loanMonths === n : loanInstallmentsCount === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            if (loanFrequency === 'monthly') {
                              setLoanMonths(n);
                            } else {
                              setLoanInstallmentsCount(n);
                            }
                          }}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                            isSelected
                              ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {n} {loanFrequency === 'daily' ? 'd' : loanFrequency === 'weekly' ? 'sem' : (n === 1 ? 'mês' : 'm')}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={loanFrequency === 'daily' ? 365 : 60}
                      value={loanFrequency === 'monthly' ? loanMonths : loanInstallmentsCount}
                      onChange={e => {
                        const val = Math.max(1, Math.min(loanFrequency === 'daily' ? 365 : 60, Number(e.target.value) || 1));
                        if (loanFrequency === 'monthly') {
                          setLoanMonths(val);
                        } else {
                          setLoanInstallmentsCount(val);
                        }
                      }}
                      className="field-input w-20 text-center text-xs"
                    />
                    <span className="text-xs text-slate-500">
                      {loanFrequency === 'daily' ? 'dias' : loanFrequency === 'weekly' ? 'sem' : 'meses'}
                    </span>
                  </div>
                </div>
              </div>
            )}
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
                    onChange={e => setLoanInterestPeriod(e.target.value as 'total' | 'monthly' | 'daily')}
                    className={input}
                  >
                    {loanFrequency === 'daily' ? (
                      <>
                        <option value="daily">Ao dia ({loanInterestRate}% a cada dia)</option>
                        <option value="monthly">Ao mês ({loanInterestRate}% ao mês proporcional)</option>
                        {loanPayMode !== 'indefinite' && <option value="total">No total de todo o período</option>}
                      </>
                    ) : (
                      <>
                        <option value="monthly">Ao mês ({loanInterestRate}% a cada mês decorrido)</option>
                        {loanPayMode !== 'indefinite' && <option value="total">No total de todo o período</option>}
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}

            {loanInterestType === 'fixed' && (
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <div className="grid gap-1 text-xs">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Valor fixo de juros (R$) *
                  </label>
                  <CurrencyInput
                    value={loanInterestFixed}
                    onChange={e => setLoanInterestFixed(e.target.value)}
                    placeholder="0,00"
                    className={input}
                  />
                </div>
                <div className="grid gap-1 text-xs">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Período de aplicação
                  </label>
                  <select
                    value={loanInterestPeriod}
                    onChange={e => setLoanInterestPeriod(e.target.value as 'total' | 'monthly' | 'daily')}
                    className={input}
                  >
                    {loanFrequency === 'daily' ? (
                      <>
                        <option value="daily">
                          Por dia {loanInterestFixed ? `(${money(safeParseBrlCents(loanInterestFixed))} por dia)` : '(a cada dia)'}
                        </option>
                        <option value="monthly">
                          Por mês {loanInterestFixed ? `(${money(safeParseBrlCents(loanInterestFixed))} por mês proporcional)` : '(ao mês)'}
                        </option>
                        {loanPayMode !== 'indefinite' && <option value="total">No total do empréstimo (valor fixo único)</option>}
                      </>
                    ) : (
                      <>
                        <option value="monthly">
                          Por mês {loanInterestFixed ? `(${money(safeParseBrlCents(loanInterestFixed))} por mês)` : '(a cada mês)'}
                        </option>
                        {loanPayMode !== 'indefinite' && <option value="total">No total do empréstimo (valor fixo único)</option>}
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Repayment mode & Due Date */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="loan-start-date" className="font-semibold text-slate-700 dark:text-slate-300">
                Data do empréstimo (quando pegou o dinheiro) *
              </label>
              <input
                id="loan-start-date"
                type="date"
                value={loanStartDate}
                onChange={e => {
                  const val = e.target.value;
                  setLoanStartDate(val);
                  if (loanPayMode === 'indefinite') {
                    setLoanFirstDueDate(calculateNextMonthlyDueDate(val, workspace.space.today));
                  }
                  setLoanElapsedMonthsOverride(null);
                }}
                required
                className={input}
              />
              {contacts.find(c => c.id === loanPersonId)?.opening_on && (
                <p className="text-[11px] text-brand-600 dark:text-brand-400">
                  Preenchido com a data informada no cadastro ({displayDate(contacts.find(c => c.id === loanPersonId)!.opening_on!)}).
                </p>
              )}
            </div>

            <div className="grid gap-1.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <label htmlFor="loan-due-date" className="font-semibold text-slate-700 dark:text-slate-300">
                  {loanPayMode === 'indefinite'
                    ? 'Data do próximo vencimento do juro mensal *'
                    : loanPayMode === 'single'
                    ? 'Data do pagamento único *'
                    : 'Data do 1º vencimento *'}
                </label>
                {loanPayMode === 'indefinite' && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                    Dia {loanStartDate ? Number(loanStartDate.split('-')[2]) : ''} de cada mês
                  </span>
                )}
              </div>
              <input
                id="loan-due-date"
                type="date"
                value={loanFirstDueDate}
                onChange={e => setLoanFirstDueDate(e.target.value)}
                required
                className={input}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {loanPayMode === 'indefinite'
                  ? 'Calculado para o próximo vencimento no mesmo dia do mês em que o empréstimo começou.'
                  : 'Data prevista para a primeira parcela ou liquidação.'}
              </p>
            </div>
          </div>

          {loanPayMode !== 'indefinite' && (
            <div className="grid gap-1.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <label className="font-medium text-slate-700 dark:text-slate-300">
                  Forma de devolução / parcelamento *
                </label>
                {loanPayMode === 'single' && (
                  <button
                    type="button"
                    onClick={() => {
                      setLoanPayMode('indefinite');
                      setLoanFirstDueDate(calculateNextMonthlyDueDate(loanStartDate, workspace.space.today));
                    }}
                    className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Mudar para Data Indefinida
                  </button>
                )}
              </div>
              <select
                value={loanPayMode}
                onChange={e => setLoanPayMode(e.target.value as any)}
                className={input}
              >
                <option value="installments">
                  {loanFrequency === 'daily'
                    ? `Parcelado dia a dia (em ${loanInstallmentsCount} parcelas diárias)`
                    : loanFrequency === 'weekly'
                    ? `Parcelado semana a semana (em ${loanInstallmentsCount} parcelas semanais)`
                    : `Parcelado mês a mês (em ${loanMonths} parcelas mensais)`}
                </option>
                <option value="single">Tudo de uma vez no final do prazo (parcela única)</option>
              </select>
            </div>
          )}

          {/* Real-time simulation preview card */}
          {loanCalc.principalCents > 0 && (
            loanCalc.isIndefinite ? (
              <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-blue-50/30 p-4 shadow-sm dark:border-blue-900/50 dark:from-blue-950/40 dark:via-slate-900 dark:to-blue-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 pb-2.5 dark:border-blue-900/50">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
                    Prazo indefinido • Juros mensais contínuos
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Meses decorridos:</span>
                    <div className="inline-flex items-center rounded-lg border border-blue-200 bg-white shadow-2xs dark:border-blue-900/70 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setLoanElapsedMonthsOverride(Math.max(0, (loanCalc.elapsedMonths || 0) - 1))}
                        className="px-2 py-0.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                        title="Diminuir 1 mês de juros acumulados"
                      >
                        -
                      </button>
                      <span className="px-2 text-xs font-bold text-blue-900 dark:text-blue-200">
                        {loanCalc.elapsedMonths || 0} {loanCalc.elapsedMonths === 1 ? 'mês' : 'meses'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLoanElapsedMonthsOverride((loanCalc.elapsedMonths || 0) + 1)}
                        className="px-2 py-0.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                        title="Aumentar 1 mês de juros acumulados"
                      >
                        +
                      </button>
                    </div>
                  </div>
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
                      {(loanCalc.elapsedMonths || 0) > 0 ? 'Juros acumulados' : 'Juro a cada mês'}
                    </span>
                    <p className="text-base font-bold text-amber-700 dark:text-amber-400">
                      {(loanCalc.elapsedMonths || 0) > 0
                        ? `+${money(loanCalc.interestCents)}`
                        : `+${money(loanCalc.monthlyInterestCents || 0)}/mês`}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white p-2.5 shadow-sm dark:bg-slate-800">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Total atual a {loanDirection === 'lend' ? 'receber' : 'pagar'}
                    </span>
                    <p className="text-base font-bold text-brand-700 dark:text-brand-300">
                      {money(loanCalc.totalCents)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 p-3 dark:bg-slate-800/80">
                  <div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Condições do acordo:</span>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      Juro de {money(loanCalc.monthlyInterestCents || 0)} por mês decorrido (sem data final)
                    </p>
                  </div>
                  {loanCalc.nextDueDate && (
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Próximo vencimento em {displayDate(loanCalc.nextDueDate)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
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
                          {loanInterestType === 'fixed' && loanInterestPeriod === 'monthly'
                            ? `(${money(safeParseBrlCents(loanInterestFixed))}/mês • ${loanCalc.effectiveRate.toFixed(1)}% total)`
                            : loanInterestType === 'percent' && loanInterestPeriod === 'monthly'
                              ? `(${loanInterestRate}%/mês • ${loanCalc.effectiveRate.toFixed(1)}% total)`
                              : `(${loanCalc.effectiveRate.toFixed(1)}%)`}
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
            )
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
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    O lançamento será registrado no extrato como <strong>&quot;{loanDirection === 'lend' ? 'Empréstimo para' : 'Empréstimo de'} {contacts.find(c => c.id === loanPersonId)?.nickname || 'pessoa'}&quot;</strong>.
                  </p>
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

            <p className="text-xs text-slate-600 dark:text-slate-400">
              As condições combinadas, incluindo taxa de juros e prazo, serão salvas com a pessoa.
            </p>
          </div>

          {/* Submit */}
          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 sm:-mx-5 sm:-mb-5 sm:px-5 rounded-b-xl shadow-lg">
            {error && (
              <div className="w-full pb-1">
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertCircle size={14} className="shrink-0" /> {error}
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {busy && (
                <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-medium">
                  <RefreshCw size={14} className="animate-spin" /> Processando empréstimo...
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowLoanForm(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !loanPersonId || loanCalc.principalCents <= 0 || (loanMoveCash && !loanAccountId)}
                className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Registrando empréstimo…</span>
                  </>
                ) : (
                  <>
                    <Coins size={16} />
                    <span>Confirmar empréstimo</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    )}

      {/* 4. Movement Form (Acerto, Empréstimo, Pagamento, Recebimento) - Modal Dialog */}
      {canWrite && movementPersonId && (
        <div
          ref={movementDialog}
          role="dialog"
          aria-modal="true"
          aria-label={`Movimentação com ${activeMovementPerson?.nickname || 'pessoa'}`}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={e => {
            if (e.target === e.currentTarget && !busy) {
              setMovementPersonId(null);
              setMovementAmount('');
            }
          }}
        >
          <form
            aria-label="Movimentação com pessoa"
            onSubmit={submitMovement}
            className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                  <HandCoins size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {movementDirection === 'lend' ? 'Emprestar para ' : movementDirection === 'borrow' ? 'Pegar emprestado de ' : 'Acertar contas com '}{activeMovementPerson?.nickname || 'pessoa'}
                  </h2>
                  {activeMovementPerson && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {activeMovementPerson.balance_cents > 0
                        ? `Situação: ${activeMovementPerson.nickname} te deve ${money(activeMovementTerms?.totalRemainingCents ?? activeMovementPerson.balance_cents)}`
                        : activeMovementPerson.balance_cents < 0
                          ? `Situação: Você deve ${money(activeMovementTerms?.totalRemainingCents ?? Math.abs(activeMovementPerson.balance_cents))} para ${activeMovementPerson.nickname}`
                          : 'Situação: As contas estão em dia (R$ 0,00)'}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMovementPersonId(null);
                  setMovementAmount('');
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 transition"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs sm:text-sm font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-200">
                <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <p className="flex-1">{error}</p>
                <button type="button" onClick={() => setError('')} className="text-rose-600 hover:opacity-80">
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Person Selector */}
            <div className="grid gap-1.5 text-sm">
              <label htmlFor="movement-person" className="font-semibold text-slate-700 dark:text-slate-300 text-xs">
                Pessoa selecionada:
              </label>
              <select
                id="movement-person"
                name="person"
                value={movementPersonId}
                onChange={e => openMovementForPerson(e.target.value, undefined, movementDirection)}
                className={input}
              >
                {activeContacts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nickname} {p.balance_cents > 0 ? `(te deve ${money(p.balance_cents)})` : p.balance_cents < 0 ? `(você deve ${money(Math.abs(p.balance_cents))})` : '(em dia)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Direction selector: 4 intuitive visual options */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Tipo do acerto / movimentação:
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => openMovementForPerson(movementPersonId, undefined, 'receive')}
                  aria-pressed={movementDirection === 'receive'}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition ${
                    movementDirection === 'receive'
                      ? 'border-emerald-500 bg-emerald-50/90 font-semibold text-emerald-950 ring-2 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <ArrowDownLeft size={16} />
                    <span className="text-xs font-bold">Receber</span>
                  </div>
                  <span className="text-[11px] font-normal text-slate-600 dark:text-slate-400">
                    A pessoa me pagou
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openMovementForPerson(movementPersonId, undefined, 'pay')}
                  aria-pressed={movementDirection === 'pay'}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition ${
                    movementDirection === 'pay'
                      ? 'border-rose-500 bg-rose-50/90 font-semibold text-rose-950 ring-2 ring-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                    <ArrowUpRight size={16} />
                    <span className="text-xs font-bold">Pagar</span>
                  </div>
                  <span className="text-[11px] font-normal text-slate-600 dark:text-slate-400">
                    Paguei à pessoa
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openMovementForPerson(movementPersonId, undefined, 'lend')}
                  aria-pressed={movementDirection === 'lend'}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition ${
                    movementDirection === 'lend'
                      ? 'border-brand-500 bg-brand-50/90 font-semibold text-brand-950 ring-2 ring-brand-500/30 dark:bg-brand-950/40 dark:text-brand-200'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-brand-700 dark:text-brand-400">
                    <ArrowUpRight size={16} />
                    <span className="text-xs font-bold">Emprestar</span>
                  </div>
                  <span className="text-[11px] font-normal text-slate-600 dark:text-slate-400">
                    Emprestei dinheiro
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openMovementForPerson(movementPersonId, undefined, 'borrow')}
                  aria-pressed={movementDirection === 'borrow'}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition ${
                    movementDirection === 'borrow'
                      ? 'border-amber-500 bg-amber-50/90 font-semibold text-amber-950 ring-2 ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <ArrowDownLeft size={16} />
                    <span className="text-xs font-bold">Pegar emprestado</span>
                  </div>
                  <span className="text-[11px] font-normal text-slate-600 dark:text-slate-400">
                    Recebi emprestado
                  </span>
                </button>
              </div>
              <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
                {movementDirection === 'receive' && 'O dinheiro entra na sua conta bancária e reduz o valor que esta pessoa te devia.'}
                {movementDirection === 'pay' && 'O dinheiro sai da sua conta bancária e reduz o valor que você devia para esta pessoa.'}
                {movementDirection === 'lend' && 'O dinheiro sai da sua conta bancária e cria uma dívida que a pessoa terá a te pagar.'}
                {movementDirection === 'borrow' && 'O dinheiro entra na sua conta bancária e cria uma dívida que você terá a pagar à pessoa.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5 text-sm">
                <label htmlFor="movement-account" className="font-medium text-xs text-slate-700 dark:text-slate-300">
                  Conta bancária *
                </label>
                <select
                  id="movement-account"
                  name="account"
                  aria-label="Conta da movimentação com pessoa"
                  required
                  defaultValue={cashAccounts[0]?.id}
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
                  <label htmlFor="movement-amount" className="font-medium text-xs text-slate-700 dark:text-slate-300">
                    Valor *
                  </label>
                  {activeMovementPerson && activeMovementPerson.balance_cents !== 0 && ['receive', 'pay'].includes(movementDirection) && (
                    <button
                      type="button"
                      onClick={() => {
                        const cents = activeMovementTerms?.totalRemainingCents ?? Math.abs(activeMovementPerson.balance_cents);
                        setMovementAmount((cents / 100).toFixed(2).replace('.', ','));
                        setMovementInterest(((activeMovementTerms?.interestRemainingCents ?? 0) / 100).toFixed(2).replace('.', ','));
                      }}
                      className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Saldo total ({money(activeMovementTerms?.totalRemainingCents ?? Math.abs(activeMovementPerson.balance_cents))})
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
                <label htmlFor="movement-date" className="font-medium text-xs text-slate-700 dark:text-slate-300">
                  Data do acerto *
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

            {['receive','pay'].includes(movementDirection) && (
              <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
                <label className="grid gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Desse valor, quanto é juros?</span>
                  <CurrencyInput name="interest" aria-label="Juros incluídos no pagamento" value={movementInterest} onChange={e => setMovementInterest(e.target.value)} placeholder="0,00" className={input}/>
                  <span className="text-[10px] text-slate-500">O valor total acima é o total pago. Só a parte sem juros reduz o principal da dívida.</span>
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Categoria dos juros</span>
                  <select name="interest_category" aria-label="Categoria dos juros" className={input}>
                    <option value="">Selecione se houver juros</option>
                    {workspace.categories.filter(category => category.ledger_account_id && category.kind === (movementDirection === 'receive' ? 'income' : 'expense')).map(category => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-500">Juros recebidos contam como receita; juros pagos contam como despesa.</span>
                </label>
              </div>
            )}

            <div className="grid gap-1.5 text-sm">
              <label htmlFor="movement-description" className="font-medium text-xs text-slate-700 dark:text-slate-300">
                Descrição no extrato (opcional)
              </label>
              <input
                id="movement-description"
                name="description"
                aria-label="Descrição da movimentação com pessoa"
                maxLength={100}
                placeholder={
                  movementDirection === 'lend'
                    ? `Padrão: Empréstimo para ${activeMovementPerson?.nickname || 'pessoa'}`
                    : movementDirection === 'borrow'
                    ? `Padrão: Empréstimo de ${activeMovementPerson?.nickname || 'pessoa'}`
                    : movementDirection === 'receive'
                    ? `Padrão: Recebimento de ${activeMovementPerson?.nickname || 'pessoa'}`
                    : `Padrão: Pagamento para ${activeMovementPerson?.nickname || 'pessoa'}`
                }
                className={input}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMovementPersonId(null);
                  setMovementAmount('');
                }}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || cashAccounts.length === 0}
                className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Salvando…</span>
                  </>
                ) : (
                  <>
                    <HandCoins size={16} />
                    <span>Confirmar movimentação</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. Shared Expense Form (Dividir despesa paga por você) */}
      {canWrite && showSharedExpense && (
        <div ref={sharedDialog} role="dialog" aria-modal="true" aria-label="Dividir despesa" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-4" onClick={event=>{if(event.target===event.currentTarget&&!busy)setShowSharedExpense(false);}}>
        <form
          aria-label="Despesa dividida em partes iguais"
          onSubmit={submitSharedExpense}
          className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4"
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
              aria-label="Fechar divisão de despesa"
              disabled={busy}
              onClick={() => setShowSharedExpense(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>
          {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

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
              disabled={busy}
              onClick={() => setShowSharedExpense(false)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        </form></div>
      )}

      {/* Search and Filters Card */}
      <section className="card p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome ou notas…"
              className="field-input w-full !pl-9 text-xs sm:text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-medium transition-all ${
                  filterTab === 'all'
                    ? 'bg-brand-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span>Todas</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterTab === 'all'
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {contacts.filter(c => includeArchived || !c.archived_at).length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('receivable')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-medium transition-all ${
                  filterTab === 'receivable'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60'
                }`}
              >
                <span>A receber</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterTab === 'receivable'
                      ? 'bg-white/20 text-white'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                  }`}
                >
                  {contacts.filter(c => (includeArchived || !c.archived_at) && c.balance_cents > 0).length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('payable')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-medium transition-all ${
                  filterTab === 'payable'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60'
                }`}
              >
                <span>A pagar</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterTab === 'payable'
                      ? 'bg-white/20 text-white'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300'
                  }`}
                >
                  {contacts.filter(c => (includeArchived || !c.archived_at) && c.balance_cents < 0).length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('settled')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-medium transition-all ${
                  filterTab === 'settled'
                    ? 'bg-slate-700 text-white shadow-xs dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span>Em dia</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterTab === 'settled'
                      ? 'bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {contacts.filter(c => (includeArchived || !c.archived_at) && c.balance_cents === 0).length}
                </span>
              </button>
            </div>

            {contacts.some(item => item.archived_at) && (
              <label className="ml-auto sm:ml-2 inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={includeArchived}
                  onChange={event => setIncludeArchived(event.target.checked)}
                  className="rounded text-brand-600 focus:ring-brand-500"
                />
                <span>Arquivadas ({contacts.filter(c => c.archived_at).length})</span>
              </label>
            )}
          </div>
        </div>
      </section>

      {/* People Table or Empty State Card */}
      {contacts.length === 0 ? (
        <section className="card p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400 mb-3">
            <UserRound size={28} />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Nenhuma pessoa cadastrada</h3>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Cadastre contatos para acompanhar quem te deve, quem você deve, empréstimos com juros ou dividir despesas compartilhadas.
          </p>
          {canWrite && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAddPerson(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-brand-700 transition-colors"
              >
                <UserPlus size={16} />
                <span>Cadastrar primeira pessoa</span>
              </button>
            </div>
          )}
        </section>
      ) : visibleContacts.length === 0 ? (
        <section className="card p-8 sm:p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 mb-3">
            <Search size={22} />
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
            Nenhuma pessoa encontrada com os filtros atuais
          </h3>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Tente limpar o termo de busca ou selecionar outra aba de situação.
          </p>
          <div className="mt-3.5">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterTab('all');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Limpar filtros
            </button>
          </div>
        </section>
      ) : (
        <PeopleTable
          people={visibleContacts}
          money={money}
          today={workspace.space.today}
          onConfigureLoan={item => openLoanForPerson(item.id, true)}
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
                onMovement={direction => openMovementForPerson(item.id, undefined, direction)}
                onOpenLoan={() => openLoanForPerson(item.id)}
                onOpenLoanWithBalance={() => openLoanForPerson(item.id, true)}
                onClose={() => setSelectedPersonId(null)}
                onManage={(action, changes) => managePerson(action, changes, item)}
                onToggleReminder={toggleReminder}
                onAddReminder={addPersonReminder}
                onSettleReminder={handleSettleReminder}
                busy={busy}
                today={workspace.space.today}
                onAnnotateMovement={handleAnnotateMovement}
                workspaceTransactions={workspace.transactions}
              />
            ) : null
          }
        />
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
  onOpenLoanWithBalance,
  onClose,
  onManage,
  onToggleReminder,
  onAddReminder,
  onSettleReminder,
  onAnnotateMovement,
  workspaceTransactions,
  busy,
  today
}: {
  person: Contact;
  detail: PersonDetail | null;
  mode: 'view' | 'edit' | 'opening';
  setMode: (mode: 'view' | 'edit' | 'opening') => void;
  money: (value: number) => string;
  onAgenda: () => void;
  onMovement: (direction?: Direction) => void;
  onOpenLoan: () => void;
  onOpenLoanWithBalance?: () => void;
  onClose: () => void;
  onManage: (action: string, changes?: Record<string, unknown>) => Promise<boolean>;
  onToggleReminder: (reminderId: string, version: number, completed: boolean) => Promise<void>;
  onAddReminder: (title: string, dueOn: string) => Promise<void>;
  onSettleReminder: (reminder: { title: string; effective_due_on: string }) => void;
  onAnnotateMovement?: (transactionId: string, version: number, description: string) => Promise<void>;
  workspaceTransactions?: LedgerWorkspace['transactions'];
  busy: boolean;
  today: string;
}) {
  const [activeTab, setActiveTab] = useState<'movements' | 'reminders' | 'notes'>('movements');
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editingTxDesc, setEditingTxDesc] = useState('');

  const pendingRemindersCount = detail?.reminders.filter(r => !r.completed_at).length ?? 0;
  const loanTerms = useMemo(() => {
    return getPersonLoanTerms(
      {
        ...person,
        reminders: detail?.reminders.map(reminder => ({ ...reminder, due_on: reminder.effective_due_on })) ?? person.reminders
      },
      today
    );
  }, [person, detail?.reminders, today]);
  const loanDates = loanTerms;

  return (
    <section
      aria-label={'Detalhes da pessoa ' + person.nickname}
      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900/95"
    >
      {/* 1. Profile Header */}
      <div className="flex flex-col gap-3.5 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-slate-800">
        <div className="flex items-center gap-3.5">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold shadow-xs ${
              person.balance_cents > 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                : person.balance_cents < 0
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {(person.nickname.trim()[0] || 'P').toUpperCase()}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {person.nickname}
              </h3>
              {person.archived_at && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  Arquivada
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">
                {person.kind === 'member'
                  ? 'Membro compartilhado'
                  : person.kind === 'former_member'
                    ? 'Ex-membro'
                    : person.kind === 'space'
                      ? 'Espaço financeiro'
                      : 'Contato particular'}
              </span>
              <span>•</span>
              <span
                className={`font-semibold ${
                  person.balance_cents > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : person.balance_cents < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {person.balance_cents > 0
                  ? `Te deve ${money(loanTerms.totalRemainingCents)}`
                  : person.balance_cents < 0
                    ? `Você deve ${money(loanTerms.totalRemainingCents)}`
                    : 'Contas em dia'}
              </span>
              {loanDates.startDate && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={12} className="text-slate-400" />
                    Início: <strong className="font-semibold text-slate-700 dark:text-slate-200">{displayDate(loanDates.startDate)}</strong>
                  </span>
                </>
              )}
              {loanDates.nextDueDate && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={12} className={loanDates.isOverdue ? 'text-rose-500' : loanDates.isToday ? 'text-amber-500' : 'text-blue-500'} />
                    Próx. pagamento:{' '}
                    <strong className={`font-semibold ${loanDates.isOverdue ? 'text-rose-600 dark:text-rose-400' : loanDates.isToday ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                      {displayDate(loanDates.nextDueDate)}
                    </strong>
                    {loanDates.isOverdue && (
                      <span className="ml-0.5 rounded-full bg-rose-100 px-1.5 py-0.2 text-[9px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                        Venceu
                      </span>
                    )}
                    {loanDates.isToday && (
                      <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 py-0.2 text-[9px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                        Hoje
                      </span>
                    )}
                  </span>
                </>
              )}
              {loanTerms.installmentsText && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <Coins size={12} className="text-slate-400" />
                    Parcelas:{' '}
                    <strong className="font-semibold text-slate-700 dark:text-slate-200">
                      {loanTerms.installmentsText}
                    </strong>
                  </span>
                </>
              )}
              <span>Principal restante: {money(loanTerms.principalRemainingCents)}</span>
              <span>Juros a pagar: {loanTerms.interestKnown ? money(loanTerms.interestRemainingCents) : 'Não informado'}</span>
              {person.scheduled_balance_cents !== 0 && (
                <>
                  <span>•</span>
                  <span>Agendado: {money(person.scheduled_balance_cents)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {!person.archived_at && (
            <>
              {movementActions.map(({ direction, label, Icon }) => (
                <button
                  key={direction}
                  type="button"
                  disabled={busy}
                  onClick={() => onMovement(direction)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Icon size={14} className={direction === 'pay' ? 'text-rose-500' : direction === 'borrow' ? 'text-amber-500' : 'text-brand-600 dark:text-brand-400'} />
                  <span>{label}</span>
                </button>
              ))}

              {person.balance_cents !== 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (onOpenLoanWithBalance ? onOpenLoanWithBalance() : onOpenLoan())}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50/80 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-xs hover:bg-amber-100 transition-colors dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                  title="Configurar parcelamento (diário/mensal), juros e lembretes para este saldo existente"
                >
                  <Calendar size={14} className="text-amber-700 dark:text-amber-400" />
                  <span>Parcelas e juros</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            title="Fechar detalhes"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Indefinite agreement banner */}
      {person.notes && person.notes.includes('Prazo Indefinido') && person.balance_cents !== 0 && (
        <div className="mx-4 my-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs sm:mx-5 dark:border-blue-900/60 dark:bg-blue-950/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-blue-950 dark:text-blue-200">
              <Clock size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />
              <span>
                Empréstimo por prazo indefinido • Juros mensais contínuos
                {loanDates.nextDueDate ? ` (Próximo vencimento: ${displayDate(loanDates.nextDueDate)})` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('notes')}
              className="text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-300"
            >
              Ver condições nas notas →
            </button>
          </div>
        </div>
      )}

      {/* 2. Clean Navigation Tabs */}
      <div className="flex items-center border-b border-slate-100 px-4 sm:px-5 dark:border-slate-800">
        <div className="flex gap-1 -mb-px">
          <button
            type="button"
            onClick={() => {
              setActiveTab('movements');
              setMode('view');
            }}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'movements'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <History size={15} />
            <span>Histórico</span>
            {detail?.movements && detail.movements.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  activeTab === 'movements'
                    ? 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {detail.movements.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('reminders');
              setMode('view');
            }}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'reminders'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Calendar size={15} />
            <span>Lembretes na Agenda</span>
            {detail?.reminders && detail.reminders.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  activeTab === 'reminders'
                    ? 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {pendingRemindersCount > 0 ? `${pendingRemindersCount} pendentes` : detail.reminders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'notes'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <FileText size={15} />
            <span>Notas e Cadastro</span>
            {person.notes && (
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500"></span>
            )}
          </button>
        </div>
      </div>

      {/* 3. Tab Contents */}
      <div className="p-4 sm:p-5">
        {/* TAB 1: MOVEMENTS */}
        {activeTab === 'movements' && (
          <div className="space-y-3">
            {!detail ? (
              <p className="text-xs text-slate-400 py-3 text-center">Carregando histórico…</p>
            ) : detail.movements.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
                <History size={20} className="mx-auto text-slate-400 mb-1.5" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nenhum movimento registrado com esta pessoa ainda.
                </p>
                {!person.archived_at && (
                  <button
                    type="button"
                    onClick={() => onMovement()}
                    className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    <HandCoins size={13} />
                    <span>Registrar primeiro acerto</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {detail.movements.map(item => {
                  const isPositive = item.person_amount_cents > 0;
                  const isLoan = item.description.toLowerCase().includes('empréstimo');
                  const isReceive = item.description.toLowerCase().startsWith('recebimento');
                  const isPay = item.description.toLowerCase().startsWith('pagamento');
                  const isAcerto = item.description.startsWith('Acerto com');

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs sm:text-sm transition-colors hover:bg-slate-100/70 dark:border-slate-800/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/70"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {item.description}
                            </span>
                            {isLoan && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 shrink-0">
                                Empréstimo
                              </span>
                            )}
                            {isReceive && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 shrink-0">
                                Recebimento
                              </span>
                            )}
                            {isPay && (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300 shrink-0">
                                Pagamento
                              </span>
                            )}
                            {item.status === 'cancelled' && (
                              <span className="rounded-full bg-red-100 px-1.5 py-0.2 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300 shrink-0">
                                Cancelado
                              </span>
                            )}
                            {item.occurred_on > today && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0">
                                Agendado
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>{displayDate(item.occurred_on)}</span>
                            {onAnnotateMovement && item.status !== 'cancelled' && (
                              <>
                                <span>•</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (editingTxId === item.id) {
                                      setEditingTxId(null);
                                    } else {
                                      setEditingTxId(item.id);
                                      setEditingTxDesc(item.description);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
                                >
                                  <Edit3 size={11} />
                                  <span>Renomear</span>
                                </button>
                                {isAcerto && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const suggested = item.person_amount_cents > 0
                                        ? `Empréstimo para ${person.nickname}`
                                        : `Recebimento de ${person.nickname}`;
                                      setEditingTxId(item.id);
                                      setEditingTxDesc(suggested);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/60 transition shrink-0"
                                    title="Mudar o nome para Empréstimo"
                                  >
                                    <Coins size={10} />
                                    <span>Mudar para Empréstimo</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`font-bold ${
                              isPositive
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {isPositive ? '+' : ''}{money(item.person_amount_cents)}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Saldo após: {money(item.running_balance_cents)}
                          </p>
                        </div>
                      </div>

                      {/* Inline Renaming Box */}
                      {editingTxId === item.id && (
                        <div className="mt-2.5 rounded-xl border border-brand-200 bg-brand-50/50 p-3 text-xs dark:border-brand-900/60 dark:bg-brand-950/30">
                          <div className="space-y-2">
                            <label className="font-semibold text-slate-800 dark:text-slate-200">
                              Editar descrição do lançamento:
                            </label>
                            <input
                              type="text"
                              value={editingTxDesc}
                              onChange={e => setEditingTxDesc(e.target.value)}
                              maxLength={100}
                              placeholder={`Ex: Empréstimo para ${person.nickname}`}
                              className="field-input w-full text-xs"
                              autoFocus
                            />
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">Sugestões rápidas:</span>
                              <button
                                type="button"
                                onClick={() => setEditingTxDesc(`Empréstimo para ${person.nickname}`)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                Empréstimo para {person.nickname}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTxDesc(`Empréstimo de ${person.nickname}`)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                Empréstimo de {person.nickname}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTxDesc(`Recebimento de ${person.nickname}`)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                Recebimento de {person.nickname}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTxDesc(`Pagamento para ${person.nickname}`)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                Pagamento para {person.nickname}
                              </button>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={busy || !editingTxDesc.trim()}
                                onClick={async () => {
                                  const v = item.version ?? workspaceTransactions?.find(t => t.id === item.id)?.version ?? 1;
                                  await onAnnotateMovement?.(item.id, v, editingTxDesc.trim());
                                  setEditingTxId(null);
                                }}
                                className="btn-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                Salvar descrição
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTxId(null)}
                                className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REMINDERS IN AGENDA */}
        {activeTab === 'reminders' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Lembretes integrados ao calendário da Agenda
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddReminder(!showAddReminder)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  <Plus size={13} />
                  <span>{showAddReminder ? 'Fechar formulário' : 'Novo lembrete'}</span>
                </button>
                <button
                  type="button"
                  onClick={onAgenda}
                  className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                >
                  Ver Agenda completa
                </button>
              </div>
            </div>

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
                className="grid gap-2.5 rounded-xl border border-brand-200 bg-brand-50/40 p-3 sm:grid-cols-3 dark:border-brand-900/40 dark:bg-brand-950/20"
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
                    autoFocus
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

            {!detail ? (
              <p className="text-xs text-slate-400 py-3 text-center">Carregando lembretes…</p>
            ) : detail.reminders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
                <Calendar size={20} className="mx-auto text-slate-400 mb-1.5" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nenhum lembrete na Agenda vinculado a esta pessoa.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddReminder(true)}
                  className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  <Plus size={13} />
                  <span>Criar lembrete de cobrança</span>
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {detail.reminders.map(item => {
                  const isCompleted = !!item.completed_at;
                  const isOverdue = !isCompleted && item.effective_due_on < today;
                  const isToday = !isCompleted && item.effective_due_on === today;

                  return (
                    <div
                      key={item.id}
                      className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl border p-2.5 text-xs transition-colors ${
                        isCompleted
                          ? 'border-slate-200 bg-slate-50/50 opacity-60 dark:border-slate-800 dark:bg-slate-800/30'
                          : isOverdue
                            ? 'border-red-200 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20'
                            : isToday
                              ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20'
                              : 'border-slate-100 bg-slate-50/70 dark:border-slate-800/80 dark:bg-slate-800/40'
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
                          <p
                            className={`font-medium ${
                              isCompleted
                                ? 'line-through text-slate-400'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
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
                          className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-900/60"
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

        {/* TAB 3: NOTES & MANAGEMENT */}
        {activeTab === 'notes' && (
          <div className="space-y-4">
            {/* Notes display or Edit mode */}
            {mode === 'edit' && !person.archived_at ? (
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
                className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1 text-xs">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Apelido / Nome *
                    </label>
                    <input
                      aria-label="Apelido da pessoa"
                      name="nickname"
                      required
                      maxLength={100}
                      defaultValue={person.nickname}
                      className={input}
                    />
                  </div>
                  <div className="grid gap-1 text-xs">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Observações e acordos
                    </label>
                    <textarea
                      aria-label="Observações da pessoa"
                      name="notes"
                      maxLength={2000}
                      rows={3}
                      defaultValue={person.notes ?? ''}
                      placeholder="Anote aqui acordos combinados, dados de pagamento..."
                      className={input}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button disabled={busy} className="btn-primary px-4 py-2 text-xs font-semibold">
                    {busy ? 'Salvando…' : 'Salvar alterações'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('view')}
                    className="px-3 py-2 text-xs font-medium text-slate-600 hover:underline dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-xs sm:text-sm dark:border-slate-800/80 dark:bg-slate-800/40">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Observações e Notas:
                  </span>
                  {!person.archived_at && (
                    <button
                      type="button"
                      onClick={() => setMode('edit')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      <Edit3 size={13} />
                      <span>Editar</span>
                    </button>
                  )}
                </div>
                {person.notes ? (
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                    {person.notes}
                  </p>
                ) : (
                  <p className="italic text-slate-400">
                    Nenhuma observação anotada. Clique em editar para registrar dados de pix ou acordos.
                  </p>
                )}
              </div>
            )}

            {/* Opening Balance Form if requested */}
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
                className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/30 p-4 dark:border-brand-900/40 dark:bg-brand-950/20"
              >
                <h4 className="text-xs font-bold uppercase tracking-wider text-brand-900 dark:text-brand-300">
                  Definir saldo inicial antigo
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1 text-xs">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Quem devia no início?
                    </label>
                    <select
                      aria-label="Direção do saldo inicial da pessoa"
                      name="direction"
                      className={input}
                    >
                      <option value="receive">A pessoa me devia</option>
                      <option value="pay">Eu devia à pessoa</option>
                    </select>
                  </div>
                  <div className="grid gap-1 text-xs">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Valor do saldo inicial (R$)
                    </label>
                    <CurrencyInput
                      aria-label="Saldo inicial da pessoa"
                      name="amount"
                      required
                      placeholder="0,00"
                      className={input}
                    />
                  </div>
                  <div className="grid gap-1 text-xs sm:col-span-2">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Data de início
                    </label>
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
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Esse valor representa uma dívida antiga que já existia antes do uso do app.
                </p>
                <div className="flex gap-2">
                  <button disabled={busy} className="btn-primary px-4 py-2 text-xs font-semibold">
                    Registrar saldo inicial
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('view')}
                    className="px-3 py-2 text-xs font-medium text-slate-600 hover:underline dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {/* Management actions footer */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {mode !== 'edit' && !person.archived_at && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode('edit')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                >
                  <Edit3 size={13} />
                  <span>Editar apelido e notas</span>
                </button>
              )}

              {person.kind === 'contact' && person.opening_on === null && detail?.movements.length === 0 && mode !== 'opening' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode('opening')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                >
                  <span>Informar saldo inicial</span>
                </button>
              )}

              {!person.archived_at && person.kind !== 'member' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onManage('archive')}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                >
                  <span>Arquivar</span>
                </button>
              )}

              {person.archived_at && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onManage('restore')}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 transition-colors"
                >
                  <span>Desarquivar pessoa</span>
                </button>
              )}

              {person.kind === 'contact' && detail?.movements.length === 0 && detail?.reminders.length === 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onManage('delete')}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
                >
                  <Trash2 size={13} />
                  <span>Excluir</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
