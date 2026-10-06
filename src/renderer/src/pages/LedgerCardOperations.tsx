import { useState, type FormEvent } from 'react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents, sumCents } from '../../../shared/finance/money';

const input = 'w-full field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
export default function LedgerCardOperations({ workspace,money,onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [operation,setOperation] = useState('charges');
  const [card,setCard] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [clientId,setClientId] = useState(() => crypto.randomUUID());
  if (workspace.role === 'viewer' || workspace.cards.length === 0) return null;
  const statements = workspace.statements.filter(s => s.credit_card_id === card && s.status === 'closed');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget),text = (name: string) => String(data.get(name) ?? '').trim();
    setBusy(true); setError(''); setNotice('');
    try {
      let name: string,args: Record<string,unknown>;
      if (operation === 'charges') {
        const components = Object.fromEntries(['revolving_interest','late_fee','late_interest','iof'].map(key => [key,parseBrlCents(text(key) || '0')]));
        if (Object.values(components).some(value => value < 0)) throw new Error('Encargos não podem ser negativos.');
        name = 'confirm_card_charges'; args = { p_statement:text('statement'),p_components:components,p_client_uuid:clientId };
      } else if (operation === 'plan') {
        const total = parseBrlCents(text('amount')),count = Number(text('count'));
        const parts = text('parts') ? text('parts').split(/\r?\n/).filter(Boolean).map(parseBrlCents) : null;
        if (total <= 0 || !Number.isInteger(count) || count < 1 || count > 600) throw new Error('Confira o valor total e a quantidade de parcelas.');
        if (parts && (parts.length !== count || sumCents(parts) !== total)) throw new Error('As parcelas informadas precisam somar o total e corresponder à quantidade.');
        name = 'install_card_statement'; args = { p_statement:text('statement'),p_on:text('date'),p_total_cents:total,p_count:count,p_parts:parts,p_client_uuid:clientId };
      } else {
        if (!/^\d+(?:\s*,\s*\d+)*$/.test(text('numbers'))) throw new Error('Informe números de parcelas separados por vírgula, como 5,6,7.');
        name = 'prepay_card_installments'; args = { p_original:text('purchase'),p_numbers:text('numbers').split(',').map(Number),p_discount_cents:parseBrlCents(text('discount') || '0'),p_on:text('date'),p_client_uuid:clientId };
      }
      await ledgerRpc(name,{ p_space:workspace.space.id,...args });
      await onChanged(); setClientId(crypto.randomUUID()); setNotice('Operação registrada. Os saldos foram atualizados.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar.'); }
    finally { setBusy(false); }
  }
  const field = (title: string,id: string) => <label htmlFor={id} className="text-sm font-medium">{title}</label>;
  return <section className="space-y-4 card p-5 dark:border-slate-800 dark:bg-slate-900">
    <h2 className="font-semibold">Encargos e parcelamentos</h2>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    <div className="grid gap-2">{field('O que deseja registrar?','card-operation')}<select id="card-operation" value={operation} onChange={event => { setOperation(event.target.value); setClientId(crypto.randomUUID()); setError(''); setNotice(''); }} className={input}><option value="charges">Confirmar encargos da fatura</option><option value="plan">Parcelar saldo de fatura</option><option value="prepay">Antecipar parcelas de compra</option></select></div>
    <form key={`${operation}-${card}`} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {operation !== 'prepay' && <><div className="grid gap-2">{field('Cartão da operação','operation-card')}<select id="operation-card" value={card} onChange={event => { setCard(event.target.value); setClientId(crypto.randomUUID()); }} required className={input}><option value="">Selecione</option>{workspace.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="grid gap-2">{field('Fatura fechada','operation-statement')}<select id="operation-statement" name="statement" required className={input}><option value="">Selecione</option>{statements.filter(s => operation === 'charges' || s.remaining_cents > 0).map(s => <option key={s.id} value={s.id}>{s.effective_due_on} · {money(s.remaining_cents)}</option>)}</select></div></>}
      {operation === 'charges' && <>{[['revolving_interest','Juros do rotativo (R$)'],['late_fee','Multa (R$)'],['late_interest','Juros de mora (R$)'],['iof','IOF do crédito (R$)']].map(([key,title]) => <div key={key} className="grid gap-2">{field(title,`charge-${key}`)}<input id={`charge-${key}`} name={key} inputMode="decimal" defaultValue="0,00" className={input}/></div>)}<p className="text-sm text-slate-500 sm:col-span-2">Informe os valores efetivamente cobrados pelo banco. A estimativa não é um gasto registrado.</p></>}
      {operation === 'plan' && <><div className="grid gap-2">{field('Total parcelado (R$)','plan-total')}<input id="plan-total" name="amount" required inputMode="decimal" className={input}/></div><div className="grid gap-2">{field('Quantidade de parcelas','plan-count')}<input id="plan-count" name="count" type="number" min={1} max={600} required className={input}/></div><div className="grid gap-2 sm:col-span-2">{field('Valores das parcelas, um por linha (opcional)','plan-parts')}<textarea id="plan-parts" name="parts" rows={3} placeholder={'520,00\n520,00'} className={input}/><p className="text-xs text-slate-500">Se ficar vazio, o total será dividido. Registre a entrada como pagamento do cartão antes de parcelar o restante.</p></div></>}
      {operation === 'prepay' && <><div className="grid gap-2 sm:col-span-2">{field('Compra original','prepay-purchase')}<select id="prepay-purchase" name="purchase" required className={input}><option value="">Selecione</option>{workspace.transactions.filter(t => t.kind === 'card_purchase' && t.status === 'posted').map(t => <option key={t.id} value={t.id}>{t.occurred_on} · {t.description}</option>)}</select></div><div className="grid gap-2">{field('Parcelas que deseja antecipar','prepay-numbers')}<input id="prepay-numbers" name="numbers" placeholder="5,6,7" required className={input}/></div><div className="grid gap-2">{field('Desconto informado pelo banco (R$)','prepay-discount')}<input id="prepay-discount" name="discount" inputMode="decimal" defaultValue="0,00" className={input}/></div><p className="text-xs text-slate-500 sm:col-span-2">As parcelas futuras serão transferidas para a fatura aberta da compra original.</p></>}
      {operation !== 'charges' && <div className="grid gap-2">{field('Data da contratação','operation-date')}<input id="operation-date" name="date" type="date" defaultValue={workspace.space.today} required className={input}/></div>}
      <div className="sm:col-span-2"><button disabled={busy} className="btn-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Registrando…' : 'Registrar operação'}</button></div>
    </form>
  </section>;
}
