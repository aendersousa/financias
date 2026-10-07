import { parseBrlCents } from './money';

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

export function getPersonLoanDates(
  person: {
    notes?: string | null;
    opening_on?: string | null;
    balance_cents: number;
    reminders?: { id: string; title: string; due_on: string; completed_at: string | null }[];
  },
  todayIso: string
): PersonLoanDates {
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

  const isOverdue = !!(nextDueDate && nextDueDate < todayIso && person.balance_cents !== 0);
  const isToday = !!(nextDueDate && nextDueDate === todayIso && person.balance_cents !== 0);

  return {
    startDate,
    nextDueDate,
    isOverdue,
    isToday
  };
}
