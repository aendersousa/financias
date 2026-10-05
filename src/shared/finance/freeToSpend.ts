import { assertCents, sumCents } from './money';

export interface ForecastCommitment {
  id: string;
  direction: 'inflow' | 'outflow';
  certainty: 'confirmed' | 'estimated' | 'conditional';
  effectiveDueOn: string;
  dueCents: number;
  paidCents: number;
  paymentLiquidity: 'cash' | 'benefit' | 'investment' | 'card';
  cancelled?: boolean;
  mainIncome?: boolean;
  actualHistoryCents?: readonly number[];
  reserveId?: string;
}
export interface ForecastStatement {
  id: string;
  status: 'closed' | 'open' | 'future';
  effectiveDueOn: string;
  remainingIncludingScheduledCents: number;
  firstInstallmentCents?: number;
  essentialFractionCents?: number;
  estimatedChargesCents?: number;
}
export interface ForecastPerson {
  id: string;
  balanceCents: number;
  openReminderDates: readonly string[];
}
export interface ForecastReserve {
  id: string;
  holdingMode: 'virtual' | 'account';
  balanceCents: number;
  active: boolean;
}
export interface ScheduledCashMovement {
  id: string;
  occurredOn: string;
  netCashCents: number;
  reservedOutflows?: readonly { reserveId: string; amountCents: number }[];
}
export interface FreeToSpendInput {
  today: string;
  fallbackCycleDay: number;
  cashBalanceCents: number;
  safetyReserveCents: number;
  commitments: readonly ForecastCommitment[];
  statements: readonly ForecastStatement[];
  people: readonly ForecastPerson[];
  reserves: readonly ForecastReserve[];
  scheduled: readonly ScheduledCashMovement[];
  essentialNeedCents: number;
}
export interface FreeToSpendScenario {
  valueCents: number;
  cashCents: number;
  expectedInflowsCents: number;
  committedCents: number;
  reservedCents: number;
  uncoveredReserveCents: number;
  safetyCents: number;
  essentialCents: number;
  items: { id: string; group: string; amountCents: number }[];
}

function nextCycle(today: string, day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError('Dia do ciclo inválido.');
  const [year, month] = today.split('-').map(Number);
  const candidate = (offset: number) => {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    return first.toISOString().slice(0, 10);
  };
  return candidate(0) > today ? candidate(0) : candidate(1);
}

export function freeToSpendHorizon(input: Pick<FreeToSpendInput, 'today' | 'fallbackCycleDay' | 'commitments'>): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.today) || new Date(`${input.today}T12:00:00Z`).toISOString().slice(0, 10) !== input.today) throw new RangeError('Data inválida.');
  return input.commitments.filter((item) => item.mainIncome && !item.cancelled && item.direction === 'inflow' && item.paymentLiquidity === 'cash' && item.effectiveDueOn > input.today && item.paidCents < item.dueCents)
    .map((item) => item.effectiveDueOn).sort()[0] ?? nextCycle(input.today, input.fallbackCycleDay);
}

function consideredAmount(item: ForecastCommitment, expected: boolean): number {
  const history = (item.actualHistoryCents ?? []).slice(0, 3).map(assertCents);
  let due = assertCents(item.dueCents);
  if (!expected && item.certainty === 'estimated' && history.length > 0) {
    if (item.direction === 'inflow') due = Math.min(...history);
    else {
      const total = history.reduce((sum, value) => sum + BigInt(value), 0n);
      const count = BigInt(history.length);
      const mean = assertCents(Number((total * 2n + count) / (2n * count)));
      due = Math.max(due, mean);
    }
  }
  return Math.max(0, sumCents([due, -assertCents(item.paidCents)]));
}

/** Section 15: one deterministic computation shared by the UI and alerts.
 * Inputs are read-model projections from Ledger, Agenda and Planning, never
 * totals independently assembled by screen components.
 */
export function calculateFreeToSpend(input: FreeToSpendInput): { horizonEnd: string; conservative: FreeToSpendScenario; expected: FreeToSpendScenario } {
  const horizonEnd = freeToSpendHorizon(input);
  const cash = assertCents(input.cashBalanceCents);
  const safety = assertCents(input.safetyReserveCents);
  const essential = assertCents(input.essentialNeedCents);
  if (safety < 0 || essential < 0) throw new RangeError('Reservas e necessidades não podem ser negativas.');
  const reserves = new Map(input.reserves.filter((item) => item.active && item.holdingMode === 'virtual').map((item) => [item.id, Math.max(0, assertCents(item.balanceCents))]));
  const reserved = sumCents([...reserves.values()]);
  const scenario = (expected: boolean): FreeToSpendScenario => {
    const inflows: number[] = [], obligations: number[] = [];
    const reserveObligations = new Map<string, number[]>();
    const items: FreeToSpendScenario['items'] = [];
    const addObligation = (id: string, group: string, value: number, reserveId?: string) => {
      assertCents(value);
      if (value < 0) throw new RangeError('Obrigação negativa.');
      items.push({ id, group, amountCents: -value });
      if (reserveId && reserves.has(reserveId)) reserveObligations.set(reserveId, [...(reserveObligations.get(reserveId) ?? []), value]);
      else obligations.push(value);
    };
    for (const item of input.commitments) {
      if (item.cancelled || item.paidCents >= item.dueCents || item.effectiveDueOn >= horizonEnd) continue;
      if (item.direction === 'inflow') {
        if (item.paymentLiquidity !== 'cash' || (!expected && (item.certainty === 'conditional' || item.effectiveDueOn < input.today))) continue;
        const value = consideredAmount(item, expected);
        inflows.push(value); items.push({ id: item.id, group: 'income', amountCents: value });
      } else if (item.paymentLiquidity === 'cash' || item.paymentLiquidity === 'card') {
        addObligation(item.id, 'agenda', consideredAmount(item, expected), item.reserveId);
      }
    }
    for (const statement of input.statements) {
      const remaining = Math.max(0, assertCents(statement.remainingIncludingScheduledCents));
      const whole = statement.status !== 'future' || statement.effectiveDueOn < horizonEnd;
      const counted = whole ? remaining : Math.min(remaining, sumCents([statement.firstInstallmentCents ?? 0, statement.essentialFractionCents ?? 0]));
      addObligation(statement.id, 'card', sumCents([counted, whole ? statement.estimatedChargesCents ?? 0 : 0]));
    }
    for (const person of input.people) {
      if (person.openReminderDates.length > 0 && !person.openReminderDates.some((date) => date < horizonEnd)) continue;
      const balance = assertCents(person.balanceCents);
      if (balance < 0) addObligation(person.id, 'person', -balance);
      else if (expected) { inflows.push(balance); items.push({ id: person.id, group: 'person', amountCents: balance }); }
    }
    for (const movement of input.scheduled) {
      if (movement.occurredOn <= input.today || movement.occurredOn >= horizonEnd) continue;
      const value = assertCents(movement.netCashCents);
      if (value > 0) { inflows.push(value); items.push({ id: movement.id, group: 'scheduled', amountCents: value }); }
      else if (value < 0) {
        const reservedParts = movement.reservedOutflows ?? [];
        const linked = sumCents(reservedParts.map((part) => part.amountCents));
        if (linked > -value) throw new RangeError('Vínculo de reserva excede a saída agendada.');
        addObligation(movement.id, 'scheduled', -value - linked);
        for (const part of reservedParts) addObligation(`${movement.id}:${part.reserveId}`, 'scheduled_reserve', part.amountCents, part.reserveId);
      }
    }
    const uncovered = sumCents([...reserveObligations.entries()].map(([id, values]) => Math.max(0, sumCents(values) - reserves.get(id)!)));
    const expectedInflows = sumCents(inflows);
    const committed = sumCents([...obligations, uncovered]);
    return { valueCents: sumCents([cash, expectedInflows, -committed, -reserved, -safety, -essential]), cashCents: cash, expectedInflowsCents: expectedInflows,
      committedCents: committed, reservedCents: reserved, uncoveredReserveCents: uncovered, safetyCents: safety, essentialCents: essential, items };
  };
  const conservative = scenario(false), expected = scenario(true);
  if (expected.valueCents < conservative.valueCents) throw new Error('O cenário esperado não pode ficar abaixo do conservador.');
  return { horizonEnd, conservative, expected };
}

/** Section 15.9: essential quota uses remaining days, and today's spend is
 * deducted after proration so essential purchases preserve free-to-spend.
 */
export function essentialQuotaCents(budgetCents: number, spentBeforeCents: number, predictedCents: number, spentTodayAndScheduledCents: number, horizonDays: number, remainingMonthDays: number): number {
  if (!Number.isInteger(horizonDays) || !Number.isInteger(remainingMonthDays) || horizonDays < 0 || remainingMonthDays < 1 || horizonDays > remainingMonthDays) throw new RangeError('Intervalo essencial inválido.');
  const base = Math.max(0, sumCents([budgetCents, -spentBeforeCents, -predictedCents]));
  const numerator = BigInt(base) * BigInt(horizonDays), denominator = BigInt(remainingMonthDays);
  const quota = assertCents(Number((numerator + denominator - 1n) / denominator));
  return Math.max(0, sumCents([quota, -spentTodayAndScheduledCents]));
}
