import { effectiveDueDate, shiftDays, type Holiday } from './calendar';
import { assertCents, sumCents } from './money';

/** An ongoing income calendar. anchorOn fixes the weekday, month day and interval phase.
 * Use Agenda occurrences instead when a rule has overrides, versions or an end date. */
export interface RecurringIncomeCalendar {
  kind: 'recurrence';
  frequency: 'weekly' | 'monthly' | 'yearly';
  anchorOn: string;
  interval?: number;
  businessDayAdjustment?: 'next' | 'previous';
}

/** Include the last income on/before creation and at least one on/after the target.
 * These dates are already effective dates: they must not be adjusted a second time. */
export interface OccurrenceIncomeCalendar {
  kind: 'occurrences';
  effectiveDates: readonly string[];
}

export interface ReserveScheduleInput {
  createdOn: string;
  targetOn: string;
  mainIncome?: RecurringIncomeCalendar | OccurrenceIncomeCalendar;
  fallbackCycleDay?: number;
  localHolidays?: readonly Holiday[];
}

export interface ReserveContributionSchedule {
  dates: string[];
  immediate: boolean;
  cycle: { lastOn: string; nextOn: string; durationDays: number; elapsedDays: number };
}

function validDate(value: string): string {
  return shiftDays(value, 0);
}

function dayNumber(value: string): number {
  validDate(value);
  return new Date(`${value}T12:00:00Z`).getTime() / 86_400_000;
}

function sortedDates(values: readonly string[]): string[] {
  return [...new Set(values.map(validDate))].sort();
}

function dateInMonth(year: number, monthIndex: number, day: number): string | null {
  const date = new Date(Date.UTC(year, monthIndex, 1, 12));
  if (date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999) return null;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function recurringDates(calendar: RecurringIncomeCalendar, from: string, through: string, holidays: readonly Holiday[]): string[] {
  const anchor = validDate(calendar.anchorOn);
  const interval = calendar.interval ?? 1;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 1200) throw new RangeError('Intervalo de renda inválido.');
  if (!['weekly', 'monthly', 'yearly'].includes(calendar.frequency)) throw new RangeError('Frequência de renda inválida.');
  if (calendar.businessDayAdjustment !== undefined && !['next', 'previous'].includes(calendar.businessDayAdjustment)) throw new RangeError('Ajuste de dia útil inválido.');
  const [year, month, day] = anchor.split('-').map(Number);
  if (year < 1900) throw new RangeError('Ano da renda inválido.');
  const position = (value: string): number => {
    const [candidateYear, candidateMonth] = value.split('-').map(Number);
    if (calendar.frequency === 'weekly') return (dayNumber(value) - dayNumber(anchor)) / (7 * interval);
    if (calendar.frequency === 'monthly') return ((candidateYear - year) * 12 + candidateMonth - month) / interval;
    return (candidateYear - year) / interval;
  };
  // Banking adjustments can move a nominal date by up to a year. Include that
  // margin on both sides so long local closures cannot misidentify the cycle.
  const start = Math.floor(position(from)) - Math.ceil(366 / (calendar.frequency === 'weekly' ? 7 * interval : calendar.frequency === 'monthly' ? 28 * interval : 365 * interval)) - 2;
  const end = Math.ceil(position(through)) + Math.ceil(366 / (calendar.frequency === 'weekly' ? 7 * interval : calendar.frequency === 'monthly' ? 28 * interval : 365 * interval)) + 2;
  if (end - start > 100_000) throw new RangeError('Intervalo de planejamento muito longo.');
  const dates: string[] = [];
  for (let index = start; index <= end; index++) {
    let nominal: string | null;
    if (calendar.frequency === 'weekly') {
      const date = new Date((dayNumber(anchor) + index * 7 * interval) * 86_400_000);
      nominal = date.getUTCFullYear() >= 1900 && date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : null;
    } else {
      nominal = calendar.frequency === 'monthly'
        ? dateInMonth(year, month - 1 + index * interval, day)
        : dateInMonth(year + index * interval, month - 1, day);
    }
    if (nominal) dates.push(effectiveDueDate(nominal, calendar.businessDayAdjustment ?? 'next', holidays));
  }
  return sortedDates(dates);
}

function fallbackDates(from: string, through: string, day: number): string[] {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError('Dia do ciclo inválido.');
  const [year, month] = from.split('-').map(Number);
  const [lastYear, lastMonth] = through.split('-').map(Number);
  const end = (lastYear - year) * 12 + lastMonth - month + 1;
  const dates: string[] = [];
  for (let index = -1; index <= end; index++) {
    const date = dateInMonth(year, month - 1 + index, day);
    if (date) dates.push(date);
  }
  return dates;
}

/** Sections 14.5.1–2: dates are strictly before the target, with one immediate
 * contribution when creation falls within the first half of the current cycle.
 * A fallback financial cycle is a calendar date, even on weekends or holidays. */
export function reserveContributionSchedule(input: ReserveScheduleInput): ReserveContributionSchedule {
  const createdOn = validDate(input.createdOn);
  const targetOn = validDate(input.targetOn);
  const through = targetOn > createdOn ? targetOn : createdOn;
  const incomeDates = input.mainIncome?.kind === 'occurrences'
    ? sortedDates(input.mainIncome.effectiveDates)
    : input.mainIncome
      ? recurringDates(input.mainIncome, createdOn, through, input.localHolidays ?? [])
      : fallbackDates(createdOn, through, input.fallbackCycleDay ?? 1);
  const lastOn = incomeDates.filter((date) => date <= createdOn).at(-1);
  const nextOn = incomeDates.find((date) => date > createdOn);
  if (!lastOn || !nextOn || !incomeDates.some((date) => date >= through)) {
    throw new RangeError('O calendário precisa cobrir o ciclo da criação e todo o prazo da reserva.');
  }
  const durationDays = dayNumber(nextOn) - dayNumber(lastOn);
  const elapsedDays = dayNumber(createdOn) - dayNumber(lastOn);
  const immediate = createdOn < targetOn && elapsedDays <= Math.floor(durationDays / 2);
  const dates = incomeDates.filter((date) => date >= createdOn && date < targetOn);
  if (immediate) dates.push(createdOn);
  return { dates: sortedDates(dates), immediate, cycle: { lastOn, nextOn, durationDays, elapsedDays } };
}

export interface ReserveTarget {
  dueOn: string;
  /** Remaining unpaid amount, not the original amount of a settled quota. */
  remainingCents: number;
}

export interface ReserveContributionInput {
  asOf: string;
  reservedCents: number;
  contributionDates: readonly string[];
  completedContributionDates?: readonly string[];
  /** One target for a provision or dated goal; one per unpaid quota for installments.
   * An empty array represents a goal without a target date. */
  targets: readonly ReserveTarget[];
  /** Section 14.5.6 capacity, supplied by the common conservative LFG computation.
   * Negative capacity permits no contribution. Omit to obtain an uncapped suggestion. */
  capacityCents?: number;
}

export interface ReserveContributionSuggestion {
  suggestedCents: number | null;
  contributionCents: number | null;
  capacityShortfallCents: number;
  overdueCents: number;
  behindSchedule: boolean;
  targets: { dueOn: string; cumulativeRemainingCents: number; remainingDates: number; suggestedCents: number }[];
}

/** Section 14.5.6 uses the already computed conservative LFG; no income scenario
 * is selected here. Safety and virtual goals follow provisions in coverage order. */
export function provisionContributionCapacity(input: {
  conservativeFreeCents: number;
  safetyReserveCents: number;
  virtualGoalBalancesCents: readonly number[];
}): number {
  const safety = assertCents(input.safetyReserveCents);
  const goals = input.virtualGoalBalancesCents.map(assertCents);
  if (safety < 0 || goals.some((value) => value < 0)) throw new RangeError('Reservas de segurança e metas não podem ser negativas.');
  return Math.max(0, sumCents([assertCents(input.conservativeFreeCents), safety, ...goals]));
}

/** Sections 14.5.3–7 and 14.6: ceil in integer cents, recalculated from the actual
 * reserved balance. It never mutates a reserve or assumes a future contribution. */
export function suggestReserveContribution(input: ReserveContributionInput): ReserveContributionSuggestion {
  const asOf = validDate(input.asOf);
  const reserved = assertCents(input.reservedCents);
  if (reserved < 0) throw new RangeError('O saldo reservado não pode ser negativo.');
  const capacity = input.capacityCents === undefined ? null : Math.max(0, assertCents(input.capacityCents));
  const completed = new Set(sortedDates(input.completedContributionDates ?? []));
  const dates = sortedDates(input.contributionDates).filter((date) => date >= asOf && !completed.has(date));
  const targets = input.targets.map((target) => {
    const remaining = assertCents(target.remainingCents);
    if (remaining < 0) throw new RangeError('O saldo restante da cota não pode ser negativo.');
    return { dueOn: validDate(target.dueOn), remainingCents: remaining };
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  let cumulative = 0;
  let suggested = 0;
  let overdue = 0;
  const details = targets.map((target) => {
    cumulative = sumCents([cumulative, target.remainingCents]);
    const remainingDates = dates.filter((date) => date < target.dueOn).length;
    const need = Math.max(0, cumulative - reserved);
    const cents = remainingDates > 0 ? assertCents(Number((BigInt(need) + BigInt(remainingDates) - 1n) / BigInt(remainingDates))) : 0;
    if (remainingDates === 0) overdue = Math.max(overdue, need);
    suggested = Math.max(suggested, cents);
    return { dueOn: target.dueOn, cumulativeRemainingCents: cumulative, remainingDates, suggestedCents: cents };
  });
  const contribution = capacity === null ? suggested : Math.min(suggested, capacity);
  return {
    suggestedCents: targets.length > 0 ? suggested : null,
    contributionCents: targets.length > 0 ? contribution : null,
    capacityShortfallCents: suggested - contribution,
    overdueCents: overdue,
    behindSchedule: overdue > 0 || contribution < suggested,
    targets: details
  };
}

/** Section 14.5.5: an unpaid income occurrence cannot trigger its automatic
 * contribution. A dated future receipt also waits until the space's local today. */
export function automaticContributionOn(input: {
  scheduledOn: string;
  today: string;
  source: 'income' | 'cycle' | 'creation';
  incomeReceivedOn?: string | null;
}): string | null {
  const scheduledOn = validDate(input.scheduledOn);
  const today = validDate(input.today);
  const actualOn = input.source === 'income'
    ? input.incomeReceivedOn ? validDate(input.incomeReceivedOn) : null
    : scheduledOn;
  return actualOn && actualOn <= today ? actualOn : null;
}
