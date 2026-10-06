import { useEffect, useState } from 'react';
import { ledgerRpc } from '../lib/ledgerRepository';
import { reportMonth, reportPercent, type FutureInstallments, type ReportProps } from './LedgerReports';

interface Summary {
  month:string; category_total_cents:number;
  categories:{ id:string | null; label:string; amount_cents:number; percent:number | null }[];
  future_installments:FutureInstallments;
  net_worth:{ month:string; net_worth_cents:number; growth_cents:number; opening_cents:number };
}
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const colors = ['bg-teal-600','bg-cyan-600','bg-indigo-500','bg-violet-500','bg-amber-500','bg-slate-400'];

export default function LedgerDashboardSummary({ workspace,money,privacy }: ReportProps) {
  const [data,setData] = useState<Summary | null>(null);
  const [error,setError] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let cancelled=false; setData(null); setError(false);
    void ledgerRpc<Summary>('dashboard_summary',{ p_space:workspace.space.id }).then(response => { if(!cancelled) setData(response); }).catch(() => { if(!cancelled) setError(true); });
    return () => { cancelled=true; };
  },[workspace,retry]);
  if (error) return <section className={panel}><h2 className="font-semibold">Resumo do mês</h2><p role="alert" className="mt-2 text-sm text-slate-500">Não foi possível consultar categorias, parcelas e patrimônio agora.</p><button onClick={() => setRetry(value => value+1)} className="mt-3 text-sm font-semibold text-teal-700 dark:text-teal-300">Atualizar resumo</button></section>;
  if (!data) return <section className={panel}><h2 className="font-semibold">Resumo do mês</h2><p role="status" className="mt-2 text-sm text-slate-500">Carregando categorias, parcelas e patrimônio…</p></section>;
  return <div className="grid gap-4 xl:grid-cols-3">
    <section className={`${panel} xl:row-span-2`} aria-label="Gastos por categoria"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Gastos por categoria</h2><span className="text-xs text-slate-500">{reportMonth(data.month)}</span></div><p className="mt-2 text-xs text-slate-500">Consumo por competência, agrupado por categoria principal.</p>
      {data.categories.length===0 ? <p className="mt-5 text-sm text-slate-500">Você ainda não registrou despesas neste mês.</p> : <div className="mt-5 space-y-5">{data.categories.map((item,index) => <div key={item.id ?? 'others'}><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{item.label}</span><strong>{money(item.amount_cents)}</strong></div><div className="mt-1 flex items-center gap-3">{!privacy && <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${colors[index]}`} style={{ width:`${Math.max(0,Math.min(100,item.percent ?? 0))}%` }}/></div>}<span className="text-xs text-slate-500">{reportPercent(item.percent,privacy)}</span></div></div>)}<div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800"><span>Total por categoria</span><strong>{money(data.category_total_cents)}</strong></div></div>}
    </section>
    <section className={`${panel} xl:col-span-2`} aria-label="Comprometimento com parcelas futuras"><h2 className="font-semibold">Parcelas futuras</h2><p className="mt-2 text-xs text-slate-500">Faturas que ainda não abriram e parcelas de empréstimos com cronograma.</p><dl className="mt-4 grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Total futuro</dt><dd className="mt-1 text-2xl font-semibold">{money(data.future_installments.total_cents)}</dd></div><div><dt className="text-xs text-slate-500">Próximo ciclo de renda</dt><dd className="mt-1 text-2xl font-semibold">{money(data.future_installments.next_cycle_cents)}</dd></div><div><dt className="text-xs text-slate-500">Média dos próximos seis ciclos</dt><dd className="mt-1 text-2xl font-semibold">{money(data.future_installments.average_cents)}</dd><p className="mt-1 text-xs text-slate-500">{data.future_installments.income_percent===null ? 'Percentual indisponível: faltam renda recorrente ou meses completos.' : `${reportPercent(data.future_installments.income_percent,privacy)} da renda recorrente`}</p></div></dl></section>
    <section className={`${panel} xl:col-span-2`} aria-label="Resumo do patrimônio"><h2 className="font-semibold">Patrimônio</h2><p className="mt-2 text-xs text-slate-500">Bens e direitos menos dívidas, na posição atual do mês.</p><dl className="mt-4 grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Patrimônio líquido</dt><dd className="mt-1 text-2xl font-semibold">{money(data.net_worth.net_worth_cents)}</dd></div><div><dt className="text-xs text-slate-500">Variação da atividade no mês</dt><dd className="mt-1 text-xl font-semibold">{money(data.net_worth.growth_cents)}</dd></div><div><dt className="text-xs text-slate-500">Saldos iniciais cadastrados</dt><dd className="mt-1 text-xl font-semibold">{money(data.net_worth.opening_cents)}</dd></div></dl></section>
  </div>;
}
