import { formatBrlCents, parseBrlCents } from './money';

export type PeopleLoanFrequency = 'monthly' | 'daily' | 'weekly';
export type PeopleLoanPayMode = 'installments' | 'single' | 'indefinite';

export interface PeopleLoanCalculationInput {
  principalInput: string;
  interestType: 'percent' | 'fixed' | 'none';
  interestRate: string;
  interestFixedInput: string;
  interestPeriod: 'total' | 'monthly' | 'daily';
  months?: number;
  installmentsCount?: number;
  frequency?: PeopleLoanFrequency;
  payMode: PeopleLoanPayMode;
  startDate?: string;
  firstDueDate: string;
  today: string;
  customElapsedMonths?: number;
}

export interface PeopleLoanScheduleItem {
  installmentNumber: number;
  totalCount: number;
  amountCents: number;
  dueDate: string;
}

export interface PeopleLoanCalculationResult {
  principalCents: number;
  interestCents: number;
  totalCents: number;
  months: number;
  count: number;
  frequency: PeopleLoanFrequency;
  payMode: PeopleLoanPayMode;
  baseInstallmentCents: number;
  effectiveRate: number;
  schedule: PeopleLoanScheduleItem[];
  isIndefinite?: boolean;
  elapsedMonths?: number;
  elapsedDays?: number;
  monthlyInterestCents?: number;
  dailyInterestCents?: number;
  accumulatedInterestCents?: number;
  nextDueDate?: string;
}

export function calculateMonthsElapsed(startDateIso: string, currentDateIso: string): number {
  if (!startDateIso || !currentDateIso) return 0;
  const partsStart = startDateIso.split('-').map(Number);
  const partsCur = currentDateIso.split('-').map(Number);
  if (partsStart.length !== 3 || partsCur.length !== 3 || partsStart.some(isNaN) || partsCur.some(isNaN)) return 0;
  const [startY, startM] = partsStart;
  const [curY, curM] = partsCur;

  const months = (curY - startY) * 12 + (curM - startM);
  if (months <= 0) return 0;

  return Math.max(0, months);
}

export function calculateNextMonthlyDueDate(startDateIso: string, todayIso: string): string {
  if (!startDateIso) return todayIso ? addMonthsClamped(todayIso, 1) : '';
  const partsStart = startDateIso.split('-').map(Number);
  const partsCur = (todayIso || startDateIso).split('-').map(Number);
  if (partsStart.length !== 3 || partsCur.length !== 3 || partsStart.some(isNaN) || partsCur.some(isNaN)) {
    return addMonthsClamped(todayIso || startDateIso, 1);
  }
  const [startY, startM, startD] = partsStart;
  const [curY, curM] = partsCur;

  if (startDateIso >= todayIso) {
    return addMonthsClamped(startDateIso, 1);
  }

  const maxDaysThisMonth = new Date(curY, curM, 0).getDate();
  const clampedDayThisMonth = Math.min(startD, maxDaysThisMonth);
  const thisMonthDue = `${curY}-${String(curM).padStart(2, '0')}-${String(clampedDayThisMonth).padStart(2, '0')}`;

  if (thisMonthDue >= todayIso) {
    return thisMonthDue;
  }

  return addMonthsClamped(thisMonthDue, 1);
}

export function calculateDaysElapsed(startDateIso: string, currentDateIso: string): number {
  if (!startDateIso || !currentDateIso) return 0;
  const d1 = new Date(startDateIso + 'T00:00:00Z').getTime();
  const d2 = new Date(currentDateIso + 'T00:00:00Z').getTime();
  if (isNaN(d1) || isNaN(d2) || d2 <= d1) return 0;
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function addDays(baseDateIso: string, daysToAdd: number): string {
  if (!baseDateIso) return '';
  const parts = baseDateIso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return baseDateIso;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + daysToAdd);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addMonthsClamped(baseDateIso: string, monthsToAdd: number): string {
  if (!baseDateIso) return '';
  const parts = baseDateIso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return baseDateIso;
  const [y, m, d] = parts;
  const totalMonths = y * 12 + (m - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(d, maxDays);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function calculatePeopleLoan(input: PeopleLoanCalculationInput): PeopleLoanCalculationResult {
  const principalCents = parseBrlCents(input.principalInput || '0');
  const frequency: PeopleLoanFrequency = input.frequency || 'monthly';

  if (input.payMode === 'indefinite') {
    const startDate = input.startDate || input.today;
    const defaultElapsedMonths = calculateMonthsElapsed(startDate, input.today);
    const elapsedMonths = input.customElapsedMonths !== undefined
      ? Math.max(0, input.customElapsedMonths)
      : defaultElapsedMonths;
    const elapsedDays = calculateDaysElapsed(startDate, input.today);

    let monthlyInterestCents = 0;
    let dailyInterestCents = 0;

    if (input.interestType === 'fixed') {
      const fixedCents = parseBrlCents(input.interestFixedInput || '0');
      if (input.interestPeriod === 'daily') {
        dailyInterestCents = fixedCents;
        monthlyInterestCents = fixedCents * 30;
      } else {
        monthlyInterestCents = fixedCents;
        dailyInterestCents = Math.round(fixedCents / 30);
      }
    } else if (input.interestType === 'percent') {
      const rate = parseFloat(input.interestRate.replace(',', '.')) || 0;
      if (input.interestPeriod === 'daily') {
        dailyInterestCents = Math.round(principalCents * (rate / 100));
        monthlyInterestCents = dailyInterestCents * 30;
      } else {
        monthlyInterestCents = Math.round(principalCents * (rate / 100));
        dailyInterestCents = Math.round(monthlyInterestCents / 30);
      }
    }

    const isDaily = frequency === 'daily' || input.interestPeriod === 'daily';
    const accumulatedInterestCents = isDaily
      ? dailyInterestCents * elapsedDays
      : monthlyInterestCents * elapsedMonths;

    const totalCents = principalCents + accumulatedInterestCents;
    const nextDueDate = input.firstDueDate || (
      isDaily
        ? addDays(input.today, 1)
        : calculateNextMonthlyDueDate(startDate, input.today)
    );

    const schedule: PeopleLoanScheduleItem[] = [];
    if (monthlyInterestCents > 0 || principalCents > 0) {
      schedule.push({
        installmentNumber: 1,
        totalCount: 1,
        amountCents: monthlyInterestCents > 0 ? monthlyInterestCents : principalCents,
        dueDate: nextDueDate
      });
    }

    const effectiveRate = principalCents > 0
      ? ((isDaily ? dailyInterestCents * 30 : monthlyInterestCents) / principalCents) * 100
      : 0;

    return {
      principalCents,
      interestCents: accumulatedInterestCents,
      totalCents,
      months: elapsedMonths,
      count: 1,
      frequency,
      payMode: 'indefinite',
      baseInstallmentCents: isDaily ? dailyInterestCents : monthlyInterestCents,
      effectiveRate,
      schedule,
      isIndefinite: true,
      elapsedMonths,
      elapsedDays,
      monthlyInterestCents,
      dailyInterestCents,
      accumulatedInterestCents,
      nextDueDate
    };
  }

  const rawCount = Number(input.installmentsCount ?? input.months) || 1;
  const maxLimit = frequency === 'daily' ? 365 : 60;
  const countPeriods = Math.max(1, Math.min(maxLimit, rawCount));

  let interestCents = 0;

  if (input.interestType === 'fixed') {
    const fixedCents = parseBrlCents(input.interestFixedInput || '0');
    if (input.interestPeriod === 'daily') {
      const days = frequency === 'daily' ? countPeriods : countPeriods * 30;
      interestCents = fixedCents * days;
    } else if (input.interestPeriod === 'monthly') {
      if (frequency === 'daily') {
        interestCents = Math.round(fixedCents * (countPeriods / 30));
      } else if (frequency === 'weekly') {
        interestCents = Math.round(fixedCents * (countPeriods / 4));
      } else {
        interestCents = fixedCents * countPeriods;
      }
    } else {
      interestCents = fixedCents;
    }
  } else if (input.interestType === 'percent') {
    const rate = parseFloat(input.interestRate.replace(',', '.')) || 0;
    if (input.interestPeriod === 'daily') {
      const days = frequency === 'daily' ? countPeriods : countPeriods * 30;
      interestCents = Math.round(principalCents * (rate / 100) * days);
    } else if (input.interestPeriod === 'monthly') {
      if (frequency === 'daily') {
        interestCents = Math.round(principalCents * (rate / 100) * (countPeriods / 30));
      } else if (frequency === 'weekly') {
        interestCents = Math.round(principalCents * (rate / 100) * (countPeriods / 4));
      } else {
        interestCents = Math.round(principalCents * (rate / 100) * countPeriods);
      }
    } else {
      interestCents = Math.round(principalCents * (rate / 100));
    }
  }

  const totalCents = principalCents + interestCents;
  const count = input.payMode === 'single' ? 1 : countPeriods;
  const baseInstallmentCents = count > 0 ? Math.floor(totalCents / count) : 0;
  const remainderCents = count > 0 ? totalCents % count : 0;

  const defaultFirstDue = frequency === 'daily'
    ? addDays(input.today, 1)
    : frequency === 'weekly'
    ? addDays(input.today, 7)
    : addMonthsClamped(input.today, 1);

  const baseDate = input.firstDueDate || defaultFirstDue;
  const schedule: PeopleLoanScheduleItem[] = [];

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const amountCents = isLast ? baseInstallmentCents + remainderCents : baseInstallmentCents;

    let dueDate = baseDate;
    if (input.payMode === 'single') {
      if (input.firstDueDate) {
        dueDate = input.firstDueDate;
      } else if (frequency === 'daily') {
        dueDate = addDays(input.today, countPeriods);
      } else if (frequency === 'weekly') {
        dueDate = addDays(input.today, countPeriods * 7);
      } else {
        dueDate = addMonthsClamped(input.today, countPeriods);
      }
    } else {
      if (frequency === 'daily') {
        dueDate = addDays(baseDate, i);
      } else if (frequency === 'weekly') {
        dueDate = addDays(baseDate, i * 7);
      } else {
        dueDate = addMonthsClamped(baseDate, i);
      }
    }

    schedule.push({
      installmentNumber: i + 1,
      totalCount: count,
      amountCents,
      dueDate
    });
  }

  const effectiveRate = principalCents > 0 ? (interestCents / principalCents) * 100 : 0;
  const months = frequency === 'monthly' ? countPeriods : Math.max(1, Math.round(countPeriods / 30));

  return {
    principalCents,
    interestCents,
    totalCents,
    months,
    count,
    frequency,
    payMode: input.payMode,
    baseInstallmentCents,
    effectiveRate,
    schedule
  };
}

export interface PersonLoanDates {
  startDate: string | null;
  nextDueDate: string | null;
  isOverdue?: boolean;
  isToday?: boolean;
}

export interface PersonLoanTerms extends PersonLoanDates {
  payMode: PeopleLoanPayMode | null;
  frequency: PeopleLoanFrequency | null;
  totalInstallments: number | null;
  currentInstallment: number | null;
  remainingInstallments: number | null;
  installmentAmountCents: number | null;
  installmentsBadge: string | null;
  installmentsText: string | null;
  installmentDetail: string | null;
  principalRemainingCents: number;
  interestRemainingCents: number;
  totalRemainingCents: number;
  recurringInterestCents: number | null;
  interestKnown: boolean;
  interestType?: 'percent' | 'fixed' | 'none' | null;
  interestRate?: string | null;
  interestFixed?: string | null;
  interestPeriod?: 'daily' | 'monthly' | 'total' | null;
}

export function getPersonLoanTerms(
  person: {
    notes?: string | null;
    opening_on?: string | null;
    balance_cents: number;
    received_cents?: number;
    paid_cents?: number;
    interest_received_cents?: number;
    interest_paid_cents?: number;
    reminders?: { id: string; title: string; due_on: string; completed_at: string | null }[];
  },
  todayIso: string
): PersonLoanTerms {
  // New configurations are appended to the notes; the latest agreement wins.
  const agreements = person.notes?.split(/(?=\[Empréstimo)/i);
  if (agreements && agreements.length > 1) person = { ...person, notes: agreements[agreements.length - 1] };
  let startDate: string | null = person.opening_on || null;

  if (!startDate && person.notes) {
    const matchStart = person.notes.match(/(?:iniciado em|\[Empréstimo[^\]]*?\bem)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (matchStart) {
      startDate = `${matchStart[3]}-${matchStart[2]}-${matchStart[1]}`;
    }
  }

  // 1. Parse terms from notes first (the authoritative agreement)
  let notesPayMode: PeopleLoanPayMode | null = null;
  let notesFrequency: PeopleLoanFrequency | null = null;
  let notesTotalInstallments: number | null = null;
  let notesInstallmentAmountCents: number | null = null;
  let interestType: 'percent' | 'fixed' | 'none' | null = null;
  let interestRate: string | null = null;
  let interestFixed: string | null = null;
  let interestPeriod: 'daily' | 'monthly' | 'total' | null = null;

  if (person.notes) {
    const notes = person.notes;
    // Check single payment first: "pagamento único", "parcela única", "à vista", "pagar só no final", "no final"
    if (/(?:pagamento\s+[uú]nico|parcela\s+[uú]nica|[aà]\s*vista|pagar\s+s[oó]\s+no\s+final|s[oó]\s+no\s+final|no\s+final)/i.test(notes)) {
      notesPayMode = 'single';
      notesTotalInstallments = 1;
      const matchDevolucao = notes.match(/devolu[cç][aã]o em\s+(\d+)\s+(m[eê]s(?:es)?|dias?|semanas?)/i);
      if (matchDevolucao) {
        const count = parseInt(matchDevolucao[1], 10);
        if (count && count > 0) notesTotalInstallments = count;
        const freq = matchDevolucao[2].toLowerCase();
        if (/di[aá]ri|dia/i.test(freq)) notesFrequency = 'daily';
        else if (/semana/i.test(freq)) notesFrequency = 'weekly';
        else notesFrequency = 'monthly';
      } else {
        notesFrequency = /di[aá]ri/i.test(notes) ? 'daily' : /semana/i.test(notes) ? 'weekly' : 'monthly';
      }
    } else if (/(?:prazo indefinido|data indefinida|sem data final|juro[s]?[^\n]*correndo todo mês)/i.test(notes)
      || (!/\d+\s*(?:parcelas?|x|m[eê]s(?:es)?|dias?|semanas?)/i.test(notes) && /(?:%|R\$\s*[\d.,]+)\s*\/(?:mês|mes|dia)/i.test(notes))) {
      notesPayMode = 'indefinite';
      notesFrequency = /(?:di[aá]ri[ao]|por dia)/i.test(notes) ? 'daily' : 'monthly';
    } else {
      const matchParcelas = notes.match(/(\d+)\s+parcelas(?:\s+(mensais|di[aá]rias|semanais))?(?:\s+de\s+~?(?:r\$\s*)?([\d.,]+))?/i);
      const matchX = notes.match(/(?:em|de\s+)?(\d+)\s*x(?:\s+de\s+~?(?:r\$\s*)?([\d.,]+))?/i);
      const matchDevolucao = notes.match(/devolu[cç][aã]o em\s+(\d+)\s+(m[eê]s(?:es)?|dias?|semanas?)/i);
      const matchVezes = notes.match(/(?:em|de)\s+(\d+)\s+(?:vezes|parcelas)/i);

      let count: number | null = null;
      let freqStr: string | null = null;
      let amtStr: string | null = null;

      if (matchParcelas) {
        count = parseInt(matchParcelas[1], 10);
        freqStr = matchParcelas[2] || null;
        amtStr = matchParcelas[3] || null;
      } else if (matchX) {
        count = parseInt(matchX[1], 10);
        amtStr = matchX[2] || null;
      } else if (matchDevolucao) {
        count = parseInt(matchDevolucao[1], 10);
        freqStr = matchDevolucao[2] || null;
      } else if (matchVezes) {
        count = parseInt(matchVezes[1], 10);
      }

      if (count && count > 0) {
        notesTotalInstallments = count;
        notesPayMode = count === 1 ? 'single' : 'installments';
        if (freqStr) {
          if (/di[aá]ri/i.test(freqStr) || /dias?/i.test(freqStr)) notesFrequency = 'daily';
          else if (/semana/i.test(freqStr)) notesFrequency = 'weekly';
          else notesFrequency = 'monthly';
        } else {
          notesFrequency = 'monthly';
        }
        if (amtStr) {
          try {
            notesInstallmentAmountCents = parseBrlCents(amtStr);
          } catch {
            // ignore
          }
        }
      }
    }

    // Parse interest details from notes
    if (/sem juros/i.test(notes)) {
      interestType = 'none';
    } else {
      const matchPercent = notes.match(/([\d.,]+)\s*%(?:\s+de\s+juros?)?\s*(?:\/|\s+(?:por|ao)\s+)?(m[eê]s|dia|ano|total)?/i);
      const matchFixed = notes.match(/(?:\+?\s*Juros:|\bjuro\s+de)\s*R\$\s*([\d.,]+)\s*(?:\/|\s+(?:por|ao)\s+)?(m[eê]s|dia|ano|total)?/i);

      if (matchPercent) {
        interestType = 'percent';
        interestRate = matchPercent[1];
        const p = (matchPercent[2] || '').toLowerCase();
        if (p.includes('dia')) interestPeriod = 'daily';
        else if (p.includes('total')) interestPeriod = 'total';
        else interestPeriod = 'monthly';
      } else if (matchFixed) {
        interestType = 'fixed';
        interestFixed = matchFixed[1];
        const p = (matchFixed[2] || '').toLowerCase();
        if (p.includes('dia')) interestPeriod = 'daily';
        else if (p.includes('total')) interestPeriod = 'total';
        else interestPeriod = 'monthly';
      }
    }
  }

  // 2. Parse reminders linked to person
  const parsedReminders: {
    id?: string;
    instNum: number;
    total: number;
    amountCents: number | null;
    completed: boolean;
    dueOn: string;
  }[] = [];
  let hasIndefiniteReminder = false;

  if (person.reminders && person.reminders.length > 0) {
    for (const r of person.reminders) {
      if (/vencimento mensal/i.test(r.title) || /juros de .*\(vencimento mensal\)/i.test(r.title) || /juros acumulados/i.test(r.title)) {
        hasIndefiniteReminder = true;
      }
      const match = r.title.match(/parcela\s+(\d+)\/(\d+)(?:\s*\((?:r\$\s*)?([\d.,]+)\))?/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const tot = parseInt(match[2], 10);
        let amt: number | null = null;
        if (match[3]) {
          try {
            amt = parseBrlCents(match[3]);
          } catch {
            amt = null;
          }
        }
        parsedReminders.push({
          id: r.id,
          instNum: num,
          total: tot,
          amountCents: amt,
          completed: Boolean(r.completed_at),
          dueOn: r.due_on
        });
      }
    }
  }

  // Filter reminders to only include the active series matching notes, ignoring orphan reminders
  let validReminders = parsedReminders;
  if (parsedReminders.length > 0) {
    if (notesTotalInstallments) {
      const matching = parsedReminders.filter(r => r.total === notesTotalInstallments);
      if (matching.length > 0) validReminders = matching;
    } else {
      const maxTotal = Math.max(...parsedReminders.map(r => r.total));
      const matching = parsedReminders.filter(r => r.total === maxTotal);
      if (matching.length > 0) validReminders = matching;
    }
    validReminders.sort((a, b) => a.instNum - b.instNum || a.dueOn.localeCompare(b.dueOn));
  }

  let payMode: PeopleLoanPayMode | null = null;
  let frequency: PeopleLoanFrequency | null = null;
  let totalInstallments: number | null = null;
  let currentInstallment: number | null = null;
  let remainingInstallments: number | null = null;
  let installmentAmountCents: number | null = null;

  if (hasIndefiniteReminder || notesPayMode === 'indefinite') {
    payMode = 'indefinite';
    frequency = notesFrequency || 'monthly';
  } else if (validReminders.length > 0) {
    totalInstallments = notesTotalInstallments || validReminders[0].total || validReminders.length;
    payMode = totalInstallments === 1 ? 'single' : 'installments';
    frequency = notesFrequency || 'monthly';
    installmentAmountCents = notesInstallmentAmountCents
      || validReminders.find(r => r.amountCents !== null)?.amountCents
      || null;
  } else {
    payMode = notesPayMode;
    frequency = notesFrequency || (notesPayMode ? 'monthly' : null);
    totalInstallments = notesTotalInstallments;
    installmentAmountCents = notesInstallmentAmountCents;
  }

  const readMoney = (match: RegExpMatchArray | null) => match ? parseBrlCents(match[1]) : null;
  const principalRemainingCents = Math.abs(person.balance_cents);
  const isBorrowed = person.balance_cents < 0
    || (person.balance_cents === 0 && (/pegou emprestado de/i.test(person.notes ?? '') || (person.paid_cents ?? 0) > (person.received_cents ?? 0)));
  const received = isBorrowed ? person.paid_cents ?? 0 : person.received_cents ?? 0;
  const interestPaid = isBorrowed ? person.interest_paid_cents ?? 0 : person.interest_received_cents ?? 0;
  const originalPrincipal = readMoney(person.notes?.match(/principal\s+R\$\s*([\d.,]+)/i) ?? null)
    ?? principalRemainingCents + received - interestPaid;
  let agreedTotal = readMoney(person.notes?.match(/\btotal\s+R\$\s*([\d.,]+)/i) ?? null)
    ?? readMoney(person.notes?.match(/pagamento\s+[uú]nico\s+de\s+R\$\s*([\d.,]+)/i) ?? null);
  if (agreedTotal === null && totalInstallments && installmentAmountCents) agreedTotal = totalInstallments * installmentAmountCents;
  let recurringInterestCents: number | null = null;
  let interestDue = agreedTotal === null ? 0 : Math.max(0, agreedTotal - originalPrincipal);
  if (payMode === 'indefinite') {
    const rate = person.notes?.match(/([\d.,]+)%\s*\/(mês|mes|dia)/i);
    const fixed = person.notes?.match(/R\$\s*([\d.,]+)\s*\/(mês|mes|dia)/i);
    if (rate || fixed) {
      frequency = (rate?.[2] ?? fixed?.[2]) === 'dia' ? 'daily' : 'monthly';
      recurringInterestCents = rate
        ? Math.round(originalPrincipal * Number(rate[1].replace(',', '.')) / 100)
        : readMoney(fixed ?? null);
    } else {
      const reminder = person.reminders?.find(r => /juros|juro/i.test(r.title));
      recurringInterestCents = readMoney(reminder?.title.match(/R\$\s*([\d.,]+)/i) ?? null);
    }
    if (recurringInterestCents !== null && startDate) {
      const elapsed = frequency === 'daily' ? calculateDaysElapsed(startDate, todayIso) : calculateMonthsElapsed(startDate, todayIso);
      interestDue = recurringInterestCents * elapsed;
    }
    if (principalRemainingCents === 0) interestDue = interestPaid;
  }
  const interestRemainingCents = Math.max(0, interestDue - interestPaid);
  const totalRemainingCents = principalRemainingCents + interestRemainingCents;
  const interestKnown = agreedTotal !== null || recurringInterestCents !== null || /sem juros/i.test(person.notes ?? '') || principalRemainingCents === 0;

  // Fallback for installmentAmountCents from balance if not parsed directly
  if (installmentAmountCents === null && totalInstallments && totalInstallments > 0 && person.balance_cents !== 0) {
    const paid = person.balance_cents < 0 ? person.paid_cents : person.received_cents;
    const interest = person.balance_cents < 0 ? person.interest_paid_cents : person.interest_received_cents;
    installmentAmountCents = paid !== undefined
      ? Math.round((Math.abs(person.balance_cents) + paid - (interest ?? 0)) / totalInstallments)
      : Math.round(Math.abs(person.balance_cents) / totalInstallments);
  }

  let nextDueDate: string | null = null;

  if (totalRemainingCents === 0) {
    nextDueDate = null;
    remainingInstallments = 0;
    currentInstallment = totalInstallments || 1;
  } else if (payMode === 'installments' && totalInstallments && totalInstallments > 1) {
    const baseAmount = installmentAmountCents || (totalInstallments > 0 ? Math.round(originalPrincipal / totalInstallments) : 0);
    const paidCount = baseAmount > 0
      ? Math.min(totalInstallments, Math.floor(received / baseAmount))
      : 0;
    const completedRemindersCount = validReminders.filter(r => r.completed).length;
    const settledCount = Math.max(paidCount, completedRemindersCount);

    remainingInstallments = Math.max(0, totalInstallments - settledCount);
    currentInstallment = Math.min(settledCount + 1, totalInstallments);

    if (remainingInstallments === 0) {
      nextDueDate = null;
    } else {
      // Find reminder for currentInstallment
      const targetReminder = validReminders.find(r => r.instNum === currentInstallment);
      if (targetReminder) {
        nextDueDate = targetReminder.dueOn;
      } else if (validReminders.length > 0) {
        const base = validReminders[0].dueOn;
        const offset = currentInstallment - validReminders[0].instNum;
        nextDueDate = frequency === 'daily'
          ? addDays(base, offset)
          : frequency === 'weekly'
            ? addDays(base, offset * 7)
            : addMonthsClamped(base, offset);
      } else if (startDate) {
        nextDueDate = frequency === 'daily'
          ? addDays(startDate, currentInstallment)
          : frequency === 'weekly'
            ? addDays(startDate, currentInstallment * 7)
            : addMonthsClamped(startDate, currentInstallment);
      } else {
        nextDueDate = frequency === 'daily'
          ? addDays(todayIso, 1)
          : frequency === 'weekly'
            ? addDays(todayIso, 7)
            : addMonthsClamped(todayIso, 1);
      }
    }
  } else if (payMode === 'indefinite') {
    const pendingReminder = person.reminders?.find(r => !r.completed_at);
    if (pendingReminder) {
      nextDueDate = pendingReminder.due_on;
    } else if (startDate) {
      nextDueDate = calculateNextMonthlyDueDate(startDate, todayIso);
    }
  } else {
    // Single payment
    remainingInstallments = totalRemainingCents === 0 ? 0 : 1;
    currentInstallment = 1;
    const pendingReminder = person.reminders?.find(r => !r.completed_at);
    if (pendingReminder) {
      nextDueDate = pendingReminder.due_on;
    } else if (person.notes) {
      const matchDue = person.notes.match(/(?:próximo vencimento em|pagamento único[^.\n]*?em|devolução em[^.\n]*?em)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
      if (matchDue) {
        nextDueDate = `${matchDue[3]}-${matchDue[2]}-${matchDue[1]}`;
      }
    }
    if (!nextDueDate && startDate && person.balance_cents !== 0) {
      nextDueDate = calculateNextMonthlyDueDate(startDate, todayIso);
    }
  }

  if (totalRemainingCents === 0) nextDueDate = null;
  const isOverdue = !!(nextDueDate && nextDueDate < todayIso && totalRemainingCents !== 0);
  const isToday = !!(nextDueDate && nextDueDate === todayIso && totalRemainingCents !== 0);

  // Format display labels
  let installmentsBadge: string | null = null;
  let installmentsText: string | null = null;
  let installmentDetail: string | null = null;

  if (totalRemainingCents === 0) {
    installmentsBadge = 'Quitado';
    installmentsText = totalInstallments && totalInstallments > 1
      ? `${totalInstallments}x (${totalInstallments}/${totalInstallments} quitada)`
      : 'Quitado';
    installmentDetail = 'Quitado';
  } else if (payMode === 'indefinite') {
    installmentsBadge = 'Indefinido';
    installmentsText = 'Prazo indefinido';
    installmentDetail = recurringInterestCents === null
      ? (frequency === 'daily' ? 'Juros diários: não informados' : 'Juros mensais: não informados')
      : `${formatBrlCents(recurringInterestCents)} ${frequency === 'daily' ? '/dia' : '/mês'}`;
  } else if (payMode === 'single' || totalInstallments === 1) {
    installmentsBadge = '1x';
    installmentsText = received > 0 ? '1x (parcialmente pago)' : '1x (à vista)';
    installmentDetail = received > 0 ? `Restante: ${formatBrlCents(totalRemainingCents)}` : 'Pagamento único';
  } else if (payMode === 'installments' && totalInstallments && totalInstallments > 1) {
    installmentsBadge = `${totalInstallments}x`;

    const freqSuffix = frequency === 'daily' ? '/dia' : frequency === 'weekly' ? '/sem' : '/mês';
    if (installmentAmountCents) {
      installmentsText = `${totalInstallments}x de ${formatBrlCents(installmentAmountCents)}`;
    } else {
      installmentsText = `${totalInstallments} parcelas`;
    }

    if (remainingInstallments !== null && currentInstallment !== null && remainingInstallments < totalInstallments) {
      installmentDetail = `Parcela ${currentInstallment} de ${totalInstallments}`;
    } else if (installmentAmountCents) {
      installmentDetail = `~${formatBrlCents(installmentAmountCents)} ${freqSuffix}`;
    } else {
      installmentDetail = frequency === 'daily' ? 'diárias' : frequency === 'weekly' ? 'semanais' : 'mensais';
    }
  }

  return {
    startDate,
    nextDueDate,
    isOverdue,
    isToday,
    payMode,
    frequency,
    totalInstallments,
    currentInstallment,
    remainingInstallments,
    installmentAmountCents,
    installmentsBadge,
    installmentsText,
    installmentDetail,
    principalRemainingCents,
    interestRemainingCents,
    totalRemainingCents,
    recurringInterestCents,
    interestKnown,
    interestType,
    interestRate,
    interestFixed,
    interestPeriod
  };
}

export function getPersonLoanDates(
  person: {
    notes?: string | null;
    opening_on?: string | null;
    balance_cents: number;
    reminders?: { id: string; title: string; due_on: string; completed_at: string | null }[];
  },
  todayIso: string
): PersonLoanDates {
  return getPersonLoanTerms(person, todayIso);
}
