import { useEffect, useState } from 'react';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { sumCents } from '../../../shared/finance/money';

interface MonthReport { month: string; closed: boolean; version: number | null; balances_require_recalculation: boolean; controls: { net_worth_cents: number; consumption: { account_id: string; class: string; original_competence_month: string | null; amount_cents: number }[]; reserves?: { reserved_cents: number; reserves: { id: string; name: string; balance_cents: number; holding_mode: string }[] } } }
interface Warning { type: string; id: string; title: string }
const panel = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
export default function LedgerClosing({ workspace,money,onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [month,setMonth] = useState(workspace.space.today.slice(0,7));
  const [report,setReport] = useState<MonthReport | null>(null);
  const [warnings,setWarnings] = useState<Warning[] | null>(null);
  const [acknowledge,setAcknowledge] = useState(false),[reason,setReason] = useState('');
  const [busy,setBusy] = useState(false),[error,setError] = useState('');
  const canClose = ['owner','admin'].includes(workspace.role);
  async function load() { setReport(await ledgerRpc<MonthReport>('month_report',{ p_space:workspace.space.id,p_month:`${month}-01` })); }
  useEffect(() => {
    setReport(null); setWarnings(null); setAcknowledge(false); setError('');
    if (month) void load().catch(failure => setError(failure.message));
  },[month,workspace.space.id]);
  async function action(name: string,args: Record<string,unknown>) {
    setBusy(true); setError('');
    try {
      await ledgerRpc(name,{ p_space:workspace.space.id,p_month:`${month}-01`,...args });
      setWarnings(null); setReason(''); await load(); await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  }
  async function preview() {
    setBusy(true); setError('');
    try { const result = await ledgerRpc<{ warnings: Warning[] }>('preview_month_closing',{ p_space:workspace.space.id,p_month:`${month}-01` }); setWarnings(result.warnings); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível revisar.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <div className="flex items-center gap-3"><label htmlFor="report-month" className="text-sm font-medium">Mês</label><input id="report-month" type="month" value={month} onChange={event => setMonth(event.target.value)} className={input}/></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {report && <>
      <div className={`${panel} space-y-2`}><p className="font-semibold">{report.closed ? `Mês fechado · versão ${report.version ?? 'inicial'}` : 'Mês aberto · valores provisórios'}</p><p className="text-sm text-slate-500">O fechamento preserva os controles do mês e exige reabertura para alterar valores.</p>{report.balances_require_recalculation && <p className="text-sm text-amber-700 dark:text-amber-300">Saldos a recalcular: um mês anterior foi reaberto.</p>}</div>
      <div className="grid gap-4 sm:grid-cols-3">{[{ title:'Patrimônio no controle mensal',amount:report.controls.net_worth_cents },{ title:'Receitas por competência',amount:-sumCents(report.controls.consumption.filter(c => c.class === 'income').map(c => c.amount_cents)) },{ title:'Despesas por competência',amount:sumCents(report.controls.consumption.filter(c => c.class === 'expense').map(c => c.amount_cents)) }].map(item => <div key={item.title} className={panel}><p className="text-sm text-slate-500">{item.title}</p><p className="mt-2 text-2xl font-semibold">{money(item.amount)}</p></div>)}</div>
      <div className={`${panel} space-y-3`}><h2 className="font-semibold">Consumo e receitas</h2>{report.controls.consumption.map((c,index) => <div key={`${c.account_id}-${index}`} className="flex flex-wrap justify-between gap-3 text-sm"><span>{c.original_competence_month ? `De meses anteriores · ref. ${c.original_competence_month.slice(0,7)} · ` : ''}{workspace.categories.find(category => category.ledger_account_id === c.account_id)?.name ?? 'Categoria histórica'}</span><strong>{money(c.class === 'income' ? -c.amount_cents : c.amount_cents)}</strong></div>)}{report.controls.consumption.length === 0 && <p className="text-sm text-slate-500">Nenhuma receita ou despesa neste mês.</p>}</div>
      {report.controls.reserves && <div className={`${panel} space-y-3`}><h2 className="font-semibold">Reservas no fim do mês</h2><p className="text-sm text-slate-500">Reservado nas contas: {money(report.controls.reserves.reserved_cents)}</p>{report.controls.reserves.reserves.map(reserve => <div key={reserve.id} className="flex flex-wrap justify-between gap-3 text-sm"><span>{reserve.name}{reserve.holding_mode === 'account' ? ' · investimento' : ''}</span><strong>{money(reserve.balance_cents)}</strong></div>)}</div>}
      {canClose && !report.closed && month < workspace.space.today.slice(0,7) && <div className={`${panel} space-y-4`}><h2 className="font-semibold">Fechar mês</h2>{warnings === null ? <button disabled={busy} onClick={() => void preview()} className="btn-primary px-4 py-2.5 font-semibold text-white">Revisar antes de fechar</button> : <>
        {warnings.length === 0 ? <p className="text-sm text-slate-500">Nenhum aviso nos módulos de Agenda e valores de patrimônio.</p> : <><p className="text-sm">Revise estes itens. Você pode resolvê-los ou confirmar o fechamento.</p><ul className="list-inside list-disc space-y-2 text-sm">{warnings.map(w => <li key={`${w.type}-${w.id}`}>{w.title} · {w.type === 'open_commitment' ? 'Compromisso ainda aberto' : 'Valor de fim do mês não informado'}</li>)}</ul><label className="flex items-center gap-2"><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)}/>Revisei os avisos e quero fechar mesmo assim</label></>}
        <button disabled={busy || warnings.length > 0 && !acknowledge} onClick={() => void action('close_month',{ p_acknowledge_warnings:acknowledge })} className="btn-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50">Confirmar fechamento</button>
      </>}</div>}
      {canClose && report.closed && <form onSubmit={event => { event.preventDefault(); void action('reopen_month',{ p_reason:reason }); }} className={`${panel} grid gap-3`}><label htmlFor="reopen-reason" className="font-semibold">Motivo da reabertura</label><textarea id="reopen-reason" value={reason} onChange={event => setReason(event.target.value)} required minLength={10} className={input}/><p className="text-sm text-slate-500">A versão fechada continua guardada. Ao fechar novamente, os controles alterados ganham uma nova versão.</p><button disabled={busy} className="w-fit rounded-xl border border-slate-300 px-4 py-2.5 font-semibold dark:border-slate-700">Reabrir mês</button></form>}
    </>}
  </div>;
}
