import { useEffect, useState, type FormEvent } from 'react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';

interface Portfolio { net_worth_cents: number; loans: { id: string; name: string; debt_cents: number }[]; accounts: { id: string; name: string; liquidity: string; balance_cents: number }[]; valuations: { id: string; financial_account_id: string; valued_on: string; value_cents: number; version: number }[] }
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950';
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
export default function LedgerPortfolio({ workspace,money,onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [portfolio,setPortfolio] = useState<Portfolio | null>(null);
  const [operation,setOperation] = useState('value');
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[notice,setNotice] = useState('');
  const [clientId,setClientId] = useState(() => crypto.randomUUID());
  const [cancelValuationId,setCancelValuationId] = useState<string | null>(null);
  const canWrite = workspace.role !== 'viewer';
  async function load() { setPortfolio(await ledgerRpc<Portfolio>('portfolio_summary',{ p_space:workspace.space.id })); }
  useEffect(() => { void load().catch(failure => setError(failure.message)); },[workspace.space.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget),text = (key: string) => String(data.get(key) ?? '').trim(),amount = (key: string) => parseBrlCents(text(key) || '0');
    setBusy(true); setError(''); setNotice('');
    try {
      let name: string,args: Record<string,unknown>;
      if (operation === 'value') { name = 'value_asset'; args = { p_account:text('asset'),p_on:text('date'),p_value_cents:amount('amount'),p_client_uuid:clientId }; }
      else if (operation === 'redeem') { name = 'redeem_investment'; args = { p_investment:text('asset'),p_destination:text('account'),p_on:text('date'),p_gross_cents:amount('amount'),p_tax_cents:amount('tax'),p_remaining_position_cents:text('remaining') ? amount('remaining') : null,p_client_uuid:clientId }; }
      else if (operation === 'create_loan') { name = 'create_loan'; args = { p_name:text('name'),p_kind:text('kind'),p_opening_cents:amount('amount'),p_on:text('date'),p_lender:text('lender') || null }; }
      else { name = 'loan_movement'; args = { p_loan:text('loan'),p_account:text('account'),p_on:text('date'),p_direction:text('direction'),p_principal_cents:amount('amount'),p_charges_cents:amount('charges'),p_client_uuid:clientId }; }
      await ledgerRpc(name,{ p_space:workspace.space.id,...args });
      await load(); await onChanged(); setClientId(crypto.randomUUID()); setNotice('Operação registrada.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível registrar.'); }
    finally { setBusy(false); }
  }
  async function cancelValuation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const valuation = portfolio?.valuations.find(item => item.id === cancelValuationId);
    if (!valuation) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    setBusy(true); setError(''); setNotice('');
    try {
      if (!reason) throw new Error('Informe o motivo do cancelamento.');
      await ledgerRpc('cancel_asset_valuation',{ p_space:workspace.space.id,p_valuation:valuation.id,p_version:valuation.version,p_reason:reason });
      setCancelValuationId(null); setClientId(crypto.randomUUID());
      await load(); await onChanged(); setNotice('Valor informado cancelado.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível cancelar o valor informado.'); }
    finally { setBusy(false); }
  }
  const cancelling = portfolio?.valuations.find(item => item.id === cancelValuationId);
  const field = (title: string,id: string) => <label htmlFor={id} className="text-sm font-medium">{title}</label>;
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
    {portfolio && <><div className={panel}><p className="text-sm text-slate-500">Patrimônio líquido</p><p className="mt-2 text-3xl font-semibold">{money(portfolio.net_worth_cents)}</p></div>
      <div className={`${panel} space-y-3`}><h2 className="font-semibold">Investimentos e bens</h2>{portfolio.accounts.filter(a => ['investment','property'].includes(a.liquidity)).map(a => <div key={a.id} className="flex justify-between gap-3"><span>{a.name}</span><strong>{money(a.balance_cents)}</strong></div>)}{!portfolio.accounts.some(a => ['investment','property'].includes(a.liquidity)) && <p className="text-sm text-slate-500">Cadastre uma conta de investimento ou um bem na tela Contas.</p>}</div>
      <div className={`${panel} space-y-3`}><h2 className="font-semibold">Empréstimos e financiamentos</h2>{portfolio.loans.map(l => <div key={l.id} className="flex justify-between gap-3"><span>{l.name}</span><strong>{money(l.debt_cents)}</strong></div>)}{portfolio.loans.length === 0 && <p className="text-sm text-slate-500">Nenhuma dívida cadastrada.</p>}</div>
      {canWrite && <section className={`${panel} space-y-4`}><h2 className="font-semibold">Registrar operação</h2>{field('Operação patrimonial','portfolio-operation')}<select id="portfolio-operation" value={operation} onChange={event => { setOperation(event.target.value); setClientId(crypto.randomUUID()); setError(''); setNotice(''); }} className={input}><option value="value">Informar valor de investimento ou bem</option><option value="redeem">Resgatar investimento</option><option value="create_loan">Cadastrar empréstimo ou financiamento</option><option value="loan_movement">Receber ou pagar empréstimo</option></select>
        <form onSubmit={submit} key={operation} className="grid gap-4 sm:grid-cols-2">
          {['value','redeem'].includes(operation) && <div className="grid gap-2">{field('Investimento ou bem','portfolio-asset')}<select id="portfolio-asset" name="asset" required className={input}><option value="">Selecione</option>{portfolio.accounts.filter(a => operation === 'redeem' ? a.liquidity === 'investment' : ['investment','property'].includes(a.liquidity)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
          {operation === 'create_loan' && <><div className="grid gap-2">{field('Nome da dívida','loan-name')}<input id="loan-name" name="name" maxLength={100} required className={input}/></div><div className="grid gap-2">{field('Tipo da dívida','loan-kind')}<select id="loan-kind" name="kind" className={input}><option value="loan">Empréstimo</option><option value="financing">Financiamento</option></select></div><div className="grid gap-2">{field('Credor (opcional)','loan-lender')}<input id="loan-lender" name="lender" className={input}/></div><p className="text-sm text-slate-500">O saldo inicial representa uma dívida já existente. Para um novo crédito, cadastre com zero e depois registre o recebimento.</p></>}
          {operation === 'loan_movement' && <><div className="grid gap-2">{field('Dívida','loan-select')}<select id="loan-select" name="loan" required className={input}><option value="">Selecione</option>{portfolio.loans.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div><div className="grid gap-2">{field('Movimentação','loan-direction')}<select id="loan-direction" name="direction" className={input}><option value="pay">Pagar / amortizar</option><option value="receive">Receber crédito</option></select></div><div className="grid gap-2">{field('Juros e encargos (R$)','loan-charges')}<input id="loan-charges" name="charges" inputMode="decimal" defaultValue="0,00" className={input}/></div></>}
          {['redeem','loan_movement'].includes(operation) && <div className="grid gap-2">{field('Conta de recebimento ou pagamento','portfolio-account')}<select id="portfolio-account" name="account" required className={input}><option value="">Selecione</option>{portfolio.accounts.filter(a => a.liquidity === 'cash').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
          <div className="grid gap-2">{field(operation === 'value' ? 'Valor da posição (R$)' : operation === 'redeem' ? 'Valor bruto resgatado (R$)' : operation === 'create_loan' ? 'Saldo devedor inicial (R$)' : 'Principal (R$)','portfolio-amount')}<input id="portfolio-amount" name="amount" inputMode="decimal" required className={input}/></div>
          {operation === 'redeem' && <><div className="grid gap-2">{field('Imposto retido (R$)','redeem-tax')}<input id="redeem-tax" name="tax" inputMode="decimal" defaultValue="0,00" className={input}/></div><div className="grid gap-2">{field('Valor da posição após resgate (R$, opcional)','redeem-remaining')}<input id="redeem-remaining" name="remaining" inputMode="decimal" className={input}/></div></>}
          <div className="grid gap-2">{field('Data','portfolio-date')}<input id="portfolio-date" name="date" type="date" defaultValue={workspace.space.today} required className={input}/></div>
          <div className="sm:col-span-2"><button disabled={busy} className="rounded-xl bg-teal-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">Registrar operação patrimonial</button></div>
        </form>
      </section>}
      <div className={`${panel} space-y-3`}><h2 className="font-semibold">Valores informados</h2>{portfolio.valuations.map(v => <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm last:border-0 dark:border-slate-800"><div><p>{portfolio.accounts.find(a => a.id === v.financial_account_id)?.name ?? 'Conta'} · {v.valued_on}</p><strong>{money(v.value_cents)}</strong></div>{canWrite && <button disabled={busy} onClick={() => { setCancelValuationId(v.id); setError(''); setNotice(''); }} className="font-semibold text-teal-700 dark:text-teal-300">Cancelar valor informado</button>}</div>)}{portfolio.valuations.length === 0 && <p className="text-sm text-slate-500">Nenhum valor informado ativo.</p>}</div>
      {canWrite && cancelling && <form onSubmit={cancelValuation} className={`${panel} space-y-4`}><h2 className="font-semibold">Cancelar valor informado de {portfolio.accounts.find(account => account.id === cancelling.financial_account_id)?.name ?? 'Conta'}</h2><p className="text-sm text-slate-500">Será desfeito o valor de {money(cancelling.value_cents)} informado em {cancelling.valued_on}, incluindo a valorização ou desvalorização registrada. Depois, você poderá informar o valor correto na mesma data.</p><div className="grid gap-2">{field('Motivo do cancelamento do valor','valuation-cancellation-reason')}<textarea id="valuation-cancellation-reason" name="reason" required maxLength={1000} className={input}/></div><div className="flex gap-3"><button disabled={busy} className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Cancelando…' : 'Confirmar cancelamento'}</button><button type="button" disabled={busy} onClick={() => setCancelValuationId(null)} className="text-sm">Voltar</button></div></form>}
    </>}
  </div>;
}
