import { getPersonLoanTerms } from './peopleLoans';

type Person = Parameters<typeof getPersonLoanTerms>[0] & { id: string; nickname?: string };
interface Reminder { type: string; person_id?: string | null; title: string; settlement_status: string; remaining_cents: number | null }

export function formatPersonReminderTitle(title: string, personName?: string): string {
  const interestMatch = title.match(/^(Cobrar|Pagar)\s+juros\s+(?:de|com)?\s*(.*?):\s*(R\$\s*[\d.,]+)(?:\s*\(Vencimento mensal\))?/i);
  if (interestMatch) {
    const verb = interestMatch[1].toLowerCase();
    const name = personName || interestMatch[2].trim() || 'pessoa';
    const amountStr = interestMatch[3].trim();
    return verb === 'cobrar'
      ? `Juros acumulados de ${name}: +${amountStr} neste mês`
      : `Juros acumulados com ${name}: +${amountStr} neste mês`;
  }
  return title;
}

// Derive installment completion from current ledger totals, so cancellation
// of a payment also restores the reminder without changing its stored state.
export function syncPeopleAgenda<T extends Reminder>(items: T[], people: Person[], today: string): T[] {
  const contacts = new Map(people.map(person => [person.id, person]));
  return items.map(item => {
    if (item.type !== 'reminder' || !item.person_id) return item;
    const person = contacts.get(item.person_id);
    let updatedItem = item;
    const formattedTitle = formatPersonReminderTitle(item.title, person?.nickname);
    if (formattedTitle !== item.title) {
      updatedItem = { ...updatedItem, title: formattedTitle };
    }
    if (!['pending', 'partial'].includes(item.settlement_status)) return updatedItem;
    const installment = item.title.match(/^(Cobrar|Pagar) .*?: Parcela (\d+)\/(\d+) \(R\$\s*([\d.,]+)\)/i);
    if (!installment || !person) return updatedItem;
    const amount = Math.round(Number(installment[4].replace(/\./g, '').replace(',', '.')) * 100);
    const number = Number(installment[2]), total = Number(installment[3]);
    if (!Number.isSafeInteger(amount) || amount <= 0 || number < 1 || number > total) return updatedItem;
    const terms = getPersonLoanTerms(person, today);
    if (terms.totalInstallments !== total) return updatedItem;
    const paid = installment[1].toLowerCase() === 'cobrar' ? person.received_cents : person.paid_cents;
    if (paid === undefined || paid < amount * number) return updatedItem;
    return { ...updatedItem, settlement_status: 'settled', remaining_cents: 0 };
  });
}
