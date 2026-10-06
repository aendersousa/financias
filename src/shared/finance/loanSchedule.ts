import { effectiveDueDate, shiftDays, type Holiday } from './calendar';
import { assertCents, divideCents, sumCents } from './money';

export interface LoanScheduleRow {
  number: number;
  nominalDueOn: string;
  effectiveDueOn: string;
  principalCents: number;
  interestCents: number;
  otherChargesCents: number;
  amountCents: number;
  outstandingAfterCents: number;
}
export interface LoanScheduleInput {
  principalCents: number;
  count: number;
  monthlyRatePercent: string;
  system: 'price' | 'sac';
  firstDueOn: string;
  localHolidays?: readonly Holiday[];
}
const rateDenominator = 1_000_000n;
function rateFromText(text: string): bigint {
  if (!/^\d{1,3}(?:[,.]\d{1,4})?$/.test(text.trim())) throw new RangeError('Informe a taxa mensal com até quatro casas decimais.');
  const [whole,fraction = ''] = text.trim().split(/[,.]/);
  return BigInt(whole)*10_000n+BigInt(fraction.padEnd(4,'0'));
}
function rounded(numerator: bigint,denominator: bigint): bigint {
  return (2n*numerator+denominator)/(2n*denominator);
}
function monthlyDate(first: string,offset: number): string {
  const [year,month,day] = first.split('-').map(Number);
  const date = new Date(Date.UTC(year,month-1+offset,1,12));
  const last = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12)).getUTCDate();
  date.setUTCDate(Math.min(day,last));
  return date.toISOString().slice(0,10);
}

/** Section 17.5.2: generated suggestions use a fixed monthly rate and exact
 * integer arithmetic. Creditor statements can replace any generated row.
 * Principal is rounded cumulatively from the exact amortization curve, avoiding
 * early repayment caused by repeating a rounded monthly payment. */
export function generateLoanSchedule(input: LoanScheduleInput): LoanScheduleRow[] {
  assertCents(input.principalCents);
  shiftDays(input.firstDueOn,0);
  if (input.principalCents<1 || !Number.isInteger(input.count) || input.count<1 || input.count>600 || input.count>input.principalCents || !['price','sac'].includes(input.system)) throw new RangeError('Principal, prazo ou sistema de amortização inválido.');
  const rate = rateFromText(input.monthlyRatePercent),principal = BigInt(input.principalCents);
  const amortizations = divideCents(input.principalCents,input.count);
  let priceAmortizations: bigint[] | null = null;
  if (input.system==='price' && rate>0n) {
    const growth = rateDenominator+rate;
    let weight = rateDenominator**BigInt(input.count-1);
    const weights = Array.from({ length:input.count },(_,index) => {
      const current=weight;
      if (index<input.count-1) weight=weight/rateDenominator*growth;
      return current;
    });
    const total=weights.reduce((sum,value) => sum+value,0n);
    let accumulated=0n,previous=0n;
    priceAmortizations=weights.map(value => {
      accumulated+=value;
      const cumulative=rounded(principal*accumulated,total),amortization=cumulative-previous;
      previous=cumulative;
      return amortization;
    });
  }
  let remaining = principal;
  return Array.from({ length:input.count },(_,index) => {
    const interest = rounded(remaining*rate,rateDenominator);
    const amortization = priceAmortizations?.[index] ?? BigInt(amortizations[index]);
    if (amortization<0n || amortization>remaining) throw new RangeError('A taxa e o prazo não permitem amortização válida em centavos.');
    remaining-=amortization;
    const nominalDueOn = monthlyDate(input.firstDueOn,index);
    return { number:index+1,nominalDueOn,effectiveDueOn:effectiveDueDate(nominalDueOn,'next',input.localHolidays),principalCents:assertCents(Number(amortization)),interestCents:assertCents(Number(interest)),otherChargesCents:0,amountCents:assertCents(Number(amortization+interest)),outstandingAfterCents:assertCents(Number(remaining)) };
  });
}

/** Validates a creditor's actual detailed schedule rather than treating a
 * generated Price/SAC suggestion as authoritative. No ledger is changed. */
export function validateCreditorSchedule(principalCents: number,rows: readonly LoanScheduleRow[]): void {
  assertCents(principalCents);
  if (principalCents<1 || rows.length<1 || rows.length>600) throw new RangeError('Cronograma inválido.');
  let remaining = principalCents;
  for (let index=0;index<rows.length;index++) {
    const row = rows[index];
    shiftDays(row.nominalDueOn,0); shiftDays(row.effectiveDueOn,0);
    const amounts = [row.principalCents,row.interestCents,row.otherChargesCents,row.amountCents,row.outstandingAfterCents].map(assertCents);
    if (row.number!==index+1 || amounts.some(amount => amount<0) || row.amountCents<1 || row.principalCents>remaining || sumCents(amounts.slice(0,3))!==row.amountCents || row.outstandingAfterCents!==sumCents([remaining,-row.principalCents]) || row.effectiveDueOn<row.nominalDueOn || index>0 && row.nominalDueOn<=rows[index-1].nominalDueOn) throw new RangeError('Parcela ou saldo devedor não confere com o cronograma.');
    remaining=row.outstandingAfterCents;
  }
  if (remaining!==0) throw new RangeError('O cronograma deve amortizar todo o saldo informado.');
}
