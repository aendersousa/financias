import { describe, it, expect } from 'vitest';
import { syncPeopleAgenda, formatPersonReminderTitle } from './agendaPeople';

const item = { id: 'reminder', type: 'reminder', person_id: 'person', title: 'Cobrar Madu: Parcela 1/2 (R$ 120,00)', settlement_status: 'pending', remaining_cents: null };
const person = { id: 'person', balance_cents: 12000, received_cents: 12000, notes: '2 parcelas mensais de R$ 120,00' };

describe('Agenda linked to person payments', () => {
  it('completes the paid installment and leaves the next pending', () => {
    const next = { ...item, id: 'next', title: 'Cobrar Madu: Parcela 2/2 (R$ 120,00)' };
    expect(syncPeopleAgenda([item, next], [person], '2026-10-08').map(i => i.settlement_status)).toEqual(['settled', 'pending']);
  });

  it('keeps a partially paid installment pending and reopens after cancellation', () => {
    expect(syncPeopleAgenda([item], [{ ...person, received_cents: 6000 }], '2026-10-08')[0].settlement_status).toBe('pending');
    expect(syncPeopleAgenda([item], [{ ...person, received_cents: 0, balance_cents: 24000 }], '2026-10-08')[0].settlement_status).toBe('pending');
  });

  it('recognizes payments to people and does not complete unrelated reminders', () => {
    const payment = { ...item, title: 'Pagar Madu: Parcela 1/2 (R$ 120,00)' };
    expect(syncPeopleAgenda([payment], [{ ...person, balance_cents: -12000, received_cents: 0, paid_cents: 12000 }], '2026-10-08')[0].settlement_status).toBe('settled');
    expect(syncPeopleAgenda([{ ...item, title: 'Ligar para Madu' }], [person], '2026-10-08')[0].settlement_status).toBe('pending');
  });

  it('preserves manual completion, cancelled items and other installment agreements', () => {
    for (const status of ['settled', 'cancelled']) expect(syncPeopleAgenda([{ ...item, settlement_status: status }], [person], '2026-10-08')[0].settlement_status).toBe(status);
    expect(syncPeopleAgenda([item], [{ ...person, notes: '3 parcelas mensais de R$ 120,00' }], '2026-10-08')[0].settlement_status).toBe('pending');
  });

  it('transforms monthly interest charge reminder to monthly accrued interest reminder', () => {
    const interestReminder = {
      id: 'rem-regina',
      type: 'reminder',
      person_id: 'regina-id',
      title: 'Cobrar juros de Regina: R$ 75,00 (Vencimento mensal)',
      settlement_status: 'pending',
      remaining_cents: null
    };
    const regina = { id: 'regina-id', nickname: 'Regina', balance_cents: 150000, received_cents: 0 };
    const result = syncPeopleAgenda([interestReminder], [regina], '2026-10-08');
    expect(result[0].title).toBe('Juros acumulados de Regina: +R$ 75,00 neste mês');
  });

  it('formats person reminder title helper accurately', () => {
    expect(formatPersonReminderTitle('Cobrar juros de Regina: R$ 75,00 (Vencimento mensal)')).toBe('Juros acumulados de Regina: +R$ 75,00 neste mês');
    expect(formatPersonReminderTitle('Pagar juros de Banco: R$ 50,00 (Vencimento mensal)')).toBe('Juros acumulados com Banco: +R$ 50,00 neste mês');
    expect(formatPersonReminderTitle('Cobrar Regina: Parcela 1/2 (R$ 100,00)')).toBe('Cobrar Regina: Parcela 1/2 (R$ 100,00)');
  });
});
