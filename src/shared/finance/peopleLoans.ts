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
  let startDate: string | null = person.opening_on || null;

  if (!startDate && person.notes) {
    const matchStart = person.notes.match(/(?:iniciado em|\[Empréstimo[^\]]*?\bem)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (matchStart) {
      startDate = `${matchStart[3]}-${matchStart[2]}-${matchStart[1]}`;
    }
  }

  let nextDueDate: string | null = null;

  // 1. Pending reminder in Agenda linked to the person
  if (person.reminders && person.reminders.length > 0) {
    const pendingReminder = person.reminders.find(r => !r.completed_at);
    if (pendingReminder) {
      nextDueDate = pendingReminder.due_on;
    }
  }

  // 2. Extracted from notes if no reminder found
  if (!nextDueDate && person.notes) {
    const matchDue = person.notes.match(/(?:próximo vencimento em|pagamento único[^.\n]*?em|devolução em[^.\n]*?em)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (matchDue) {
      nextDueDate = `${matchDue[3]}-${matchDue[2]}-${matchDue[1]}`;
    }
  }

  // 3. Fallback: if there is an active balance and known start date, calculate next monthly due date
  if (!nextDueDate && startDate && person.balance_cents !== 0) {
    nextDueDate = calculateNextMonthlyDueDate(startDate, todayIso);
  }

  // Installment parsing
  let payMode: PeopleLoanPayMode | null = null;
  let frequency: PeopleLoanFrequency | null = null;
  let totalInstallments: number | null = null;
  let currentInstallment: number | null = null;
  let remainingInstallments: number | null = null;
  let installmentAmountCents: number | null = null;

  // A. Check reminders
  if (person.reminders && person.reminders.length > 0) {
    const installmentReminders: {
      instNum: number;
      total: number;
      amountCents: number | null;
      completed: boolean;
      dueOn: string;
    }[] = [];

    let hasIndefiniteReminder = false;

    for (const r of person.reminders) {
      if (/vencimento mensal/i.test(r.title) || /juros de .*\(vencimento mensal\)/i.test(r.title)) {
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
        installmentReminders.push({
          instNum: num,
          total: tot,
          amountCents: amt,
          completed: Boolean(r.completed_at),
          dueOn: r.due_on
        });
      }
    }

    if (hasIndefiniteReminder) {
      payMode = 'indefinite';
      frequency = 'monthly';
    } else if (installmentReminders.length > 0) {
      installmentReminders.sort((a, b) => a.instNum - b.instNum);
      totalInstallments = installmentReminders[0].total || installmentReminders.length;
      payMode = totalInstallments === 1 ? 'single' : 'installments';
      frequency = 'monthly';

      const pending = installmentReminders.filter(r => !r.completed);
      remainingInstallments = pending.length;
      currentInstallment = pending.length > 0 ? pending[0].instNum : totalInstallments;
      installmentAmountCents = pending.length > 0 && pending[0].amountCents !== null
        ? pending[0].amountCents
        : (installmentReminders[0].amountCents ?? null);
    }
  }

  // B. Check notes if payMode not established from reminders
  if (!payMode && person.notes) {
    const notes = person.notes;

    if (/(?:prazo indefinido|data indefinida|sem data final)/i.test(notes)) {
      payMode = 'indefinite';
      frequency = /(?:di[aá]ri[ao]|por dia)/i.test(notes) ? 'daily' : 'monthly';
    } else if (/(?:pagamento [uú]nico|parcela [uú]nica|[aà] vista)/i.test(notes)) {
      payMode = 'single';
      totalInstallments = 1;
      currentInstallment = 1;
      remainingInstallments = 1;
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
        totalInstallments = count;
        currentInstallment = 1;
        remainingInstallments = count;
        payMode = count === 1 ? 'single' : 'installments';

        if (freqStr) {
          if (/di[aá]ri/i.test(freqStr) || /dias?/i.test(freqStr)) frequency = 'daily';
          else if (/semana/i.test(freqStr)) frequency = 'weekly';
          else frequency = 'monthly';
        } else {
          frequency = 'monthly';
        }

        if (amtStr) {
          try {
            installmentAmountCents = parseBrlCents(amtStr);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  // Fallback for installmentAmountCents from balance if not parsed directly
  if (installmentAmountCents === null && totalInstallments && totalInstallments > 0 && person.balance_cents !== 0) {
    const paid = person.balance_cents < 0 ? person.paid_cents : person.received_cents;
    const interest = person.balance_cents < 0 ? person.interest_paid_cents : person.interest_received_cents;
    installmentAmountCents = paid !== undefined
      ? Math.round((Math.abs(person.balance_cents) + paid - (interest ?? 0)) / totalInstallments)
      : Math.round(Math.abs(person.balance_cents) / (remainingInstallments || totalInstallments));
  }

  // Payments update the installment progress even when Agenda reminders have not
  // been manually checked off. Partial payments must keep the same due date.
  if (payMode === 'installments' && totalInstallments && installmentAmountCents && installmentAmountCents > 0) {
    const paidCents = person.balance_cents < 0 ? person.paid_cents : person.balance_cents > 0 ? person.received_cents : Math.max(person.paid_cents ?? 0, person.received_cents ?? 0);
    const paidCount = Math.min(totalInstallments, Math.floor((paidCents ?? 0) / installmentAmountCents));
    const completedCount = totalInstallments - (remainingInstallments ?? totalInstallments);
    const settledCount = person.balance_cents === 0 ? totalInstallments : Math.max(paidCount, completedCount);
    remainingInstallments = totalInstallments - settledCount;
    currentInstallment = Math.min(settledCount + 1, totalInstallments);
    if (remainingInstallments === 0) {
      nextDueDate = null;
    } else if (paidCount > completedCount) {
      const nextReminder = person.reminders?.find(r => {
        const match = r.title.match(/parcela\s+(\d+)\/(\d+)/i);
        return !r.completed_at && match && Number(match[1]) === currentInstallment && Number(match[2]) === totalInstallments;
      });
      if (nextReminder) {
        nextDueDate = nextReminder.due_on;
      } else if (!person.reminders?.length && startDate) {
        nextDueDate = frequency === 'daily'
          ? addDays(startDate, currentInstallment)
          : frequency === 'weekly'
            ? addDays(startDate, currentInstallment * 7)
            : addMonthsClamped(startDate, currentInstallment);
      } else if (nextDueDate) {
        nextDueDate = frequency === 'daily'
          ? addDays(nextDueDate, paidCount - completedCount)
          : frequency === 'weekly'
            ? addDays(nextDueDate, (paidCount - completedCount) * 7)
            : addMonthsClamped(nextDueDate, paidCount - completedCount);
      }
    }
  }
  const isOverdue = !!(nextDueDate && nextDueDate < todayIso && person.balance_cents !== 0);
  const isToday = !!(nextDueDate && nextDueDate === todayIso && person.balance_cents !== 0);

  // Format display labels
  let installmentsBadge: string | null = null;
  let installmentsText: string | null = null;
  let installmentDetail: string | null = null;

  if (payMode === 'indefinite') {
    installmentsBadge = 'Indefinido';
    installmentsText = 'Prazo indefinido';
    installmentDetail = frequency === 'daily' ? 'Juros diários' : 'Juros mensais';
  } else if (payMode === 'single' || totalInstallments === 1) {
    installmentsBadge = '1x';
    installmentsText = '1x (à vista)';
    installmentDetail = 'Pagamento único';
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
    installmentDetail
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
