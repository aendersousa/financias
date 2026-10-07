import { parseBrlCents } from './money';

export interface PeopleLoanCalculationInput {
  principalInput: string;
  interestType: 'percent' | 'fixed' | 'none';
  interestRate: string;
  interestFixedInput: string;
  interestPeriod: 'total' | 'monthly';
  months: number;
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
  baseInstallmentCents: number;
  effectiveRate: number;
  schedule: PeopleLoanScheduleItem[];
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
  const months = Math.max(1, Math.min(60, Number(input.months) || 1));
  let interestCents = 0;

  if (input.interestType === 'fixed') {
    interestCents = parseBrlCents(input.interestFixedInput || '0');
  } else if (input.interestType === 'percent') {
    const rate = parseFloat(input.interestRate.replace(',', '.')) || 0;
    if (input.interestPeriod === 'monthly') {
      interestCents = Math.round(principalCents * (rate / 100) * months);
    } else {
      interestCents = Math.round(principalCents * (rate / 100));
    }
  }

  const totalCents = principalCents + interestCents;
  const count = input.payMode === 'single' ? 1 : months;
  const baseInstallmentCents = count > 0 ? Math.floor(totalCents / count) : 0;
  const remainderCents = count > 0 ? totalCents % count : 0;

  const baseDate = input.firstDueDate || addMonthsClamped(input.today, 1);
  const schedule: PeopleLoanScheduleItem[] = [];

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const amountCents = isLast ? baseInstallmentCents + remainderCents : baseInstallmentCents;
    const dueDate = input.payMode === 'single'
      ? (input.firstDueDate || addMonthsClamped(input.today, months))
      : addMonthsClamped(baseDate, i);

    schedule.push({
      installmentNumber: i + 1,
      totalCount: count,
      amountCents,
      dueDate
    });
  }

  const effectiveRate = principalCents > 0 ? (interestCents / principalCents) * 100 : 0;

  return {
    principalCents,
    interestCents,
    totalCents,
    months,
    count,
    baseInstallmentCents,
    effectiveRate,
    schedule
  };
}

