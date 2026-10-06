import { describe,it,expect } from 'vitest';
import fc from 'fast-check';
import { generateLoanSchedule,validateCreditorSchedule } from './loanSchedule';
import { sumCents } from './money';

describe('Loan amortization suggestions',() => {
  it('Price splits principal and interest and adjusts the final cent',() => {
    const rows=generateLoanSchedule({ principalCents:1_000_000,count:2,monthlyRatePercent:'10',system:'price',firstDueOn:'2026-11-05' });
    expect(rows.map(row => [row.principalCents,row.interestCents,row.amountCents,row.outstandingAfterCents])).toEqual([[476190,100000,576190,523810],[523810,52381,576191,0]]);
    expect(() => validateCreditorSchedule(1_000_000,rows)).not.toThrow();
  });
  it('SAC preserves full principal and uses interest on the remaining balance',() => {
    const rows=generateLoanSchedule({ principalCents:10000,count:3,monthlyRatePercent:'1,3',system:'sac',firstDueOn:'2026-10-05' });
    expect(rows.map(row => row.principalCents)).toEqual([3334,3333,3333]);
    expect(rows.map(row => row.interestCents)).toEqual([130,87,43]);
    expect(sumCents(rows.map(row => row.principalCents))).toBe(10000);
  });
  it.each(['sac','price'] as const)('%s supports zero monthly interest',system => {
    const rows=generateLoanSchedule({ principalCents:10000,count:3,monthlyRatePercent:'0',system,firstDueOn:'2026-10-05' });
    expect(rows.map(row => row.interestCents)).toEqual([0,0,0]);
    expect(sumCents(rows.map(row => row.amountCents))).toBe(10000);
  });
  it('clamps month day without drifting after February and adjusts bank holidays',() => {
    const rows=generateLoanSchedule({ principalCents:90000,count:3,monthlyRatePercent:'0',system:'sac',firstDueOn:'2027-01-31' });
    expect(rows.map(row => row.nominalDueOn)).toEqual(['2027-01-31','2027-02-28','2027-03-31']);
    expect(rows[0].effectiveDueOn).toBe('2027-02-01');
  });
  it('accepts corrected creditor values with exact outstanding principal',() => {
    const rows=generateLoanSchedule({ principalCents:1_000_000,count:2,monthlyRatePercent:'10',system:'price',firstDueOn:'2026-11-05' });
    rows[0].interestCents=99900; rows[0].amountCents=576090;
    expect(() => validateCreditorSchedule(1_000_000,rows)).not.toThrow();
    rows[0].outstandingAfterCents+=1;
    expect(() => validateCreditorSchedule(1_000_000,rows)).toThrow();
  });
  it('does not accept a creditor schedule that silently drops principal',() => {
    const rows=generateLoanSchedule({ principalCents:10000,count:2,monthlyRatePercent:'0',system:'sac',firstDueOn:'2026-11-05' });
    expect(() => validateCreditorSchedule(10000,rows.slice(0,1))).toThrow();
  });
  it.each(['-1','1,00001','1e2','1.234,56'])('rejects ambiguous or unsupported rate %s',monthlyRatePercent => {
    expect(() => generateLoanSchedule({ principalCents:10000,count:2,monthlyRatePercent,system:'price',firstDueOn:'2026-11-05' })).toThrow();
  });
  it('keeps principal and balances exact over random rates and terms',() => {
    fc.assert(fc.property(fc.integer({ min:10000,max:100000000 }),fc.integer({ min:1,max:120 }),fc.integer({ min:0,max:50000 }),fc.constantFrom('price','sac'),(principalCents,count,rate,system) => {
      const rows=generateLoanSchedule({ principalCents,count,monthlyRatePercent:`${Math.floor(rate/10000)},${String(rate%10000).padStart(4,'0')}`,system,firstDueOn:'2026-11-05' });
      expect(sumCents(rows.map(row => row.principalCents))).toBe(principalCents);
      expect(rows.at(-1)?.outstandingAfterCents).toBe(0);
      expect(() => validateCreditorSchedule(principalCents,rows)).not.toThrow();
    }),{ numRuns:300 });
  });
  it('does not repay early after accumulating monthly rounding at a small principal',() => {
    const rows=generateLoanSchedule({ principalCents:10003,count:102,monthlyRatePercent:'4,1049',system:'price',firstDueOn:'2026-11-05' });
    expect(rows).toHaveLength(102);
    expect(rows.at(-2)!.outstandingAfterCents).toBeGreaterThan(0);
    expect(() => validateCreditorSchedule(10003,rows)).not.toThrow();
  });
});
