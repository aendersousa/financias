import { parseBrlCents } from './money';

export type PeopleLoanFrequency = 'monthly' | 'daily' | 'weekly';

export interface PeopleLoanCalculationInput {
  principalInput: string;
  interestType: 'percent' | 'fixed' | 'none';
  interestRate: string;
  interestFixedInput: string;
  interestPeriod: 'total' | 'monthly' | 'daily';
  months?: number;
  installmentsCount?: number;
  frequency?: PeopleLoanFrequency;
  payMode: 'installments' | 'single';
  firstDueDate: string;
  today: string;
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
  baseInstallmentCents: number;
  effectiveRate: number;
  schedule: PeopleLoanScheduleItem[];
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
    baseInstallmentCents,
    effectiveRate,
    schedule
  };
}
