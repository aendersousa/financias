import { getPersonLoanTerms } from './peopleLoans';

type Person = Parameters<typeof getPersonLoanTerms>[0] & { id:string };
interface Reminder { type:string; person_id?:string|null; title:string; settlement_status:string; remaining_cents:number|null }

// Derive installment completion from current ledger totals, so cancellation
// of a payment also restores the reminder without changing its stored state.
export function syncPeopleAgenda<T extends Reminder>(items:T[],people:Person[],today:string):T[]{
  const contacts=new Map(people.map(person=>[person.id,person]));
  return items.map(item=>{
    if(item.type!=='reminder'||!item.person_id||!['pending','partial'].includes(item.settlement_status))return item;
    const installment=item.title.match(/^(Cobrar|Pagar) .*?: Parcela (\d+)\/(\d+) \(R\$\s*([\d.,]+)\)/i);
    const person=contacts.get(item.person_id);
    if(!installment||!person)return item;
    const amount=Math.round(Number(installment[4].replace(/\./g,'').replace(',','.'))*100);
    const number=Number(installment[2]),total=Number(installment[3]);
    if(!Number.isSafeInteger(amount)||amount<=0||number<1||number>total)return item;
    const terms=getPersonLoanTerms(person,today);
    if(terms.totalInstallments!==total)return item;
    const paid=installment[1].toLowerCase()==='cobrar'?person.received_cents:person.paid_cents;
    if(paid===undefined||paid<amount*number)return item;
    return {...item,settlement_status:'settled',remaining_cents:0};
  });
}
