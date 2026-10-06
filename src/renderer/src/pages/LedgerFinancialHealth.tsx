import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { ledgerRpc } from '../lib/ledgerRepository';
import { FutureInstallmentList, reportMonth, reportPercent, reportDate, type FutureInstallments, type ReportItem, type ReportProps } from './LedgerReports';

interface Health {
  on: string;
  window: { from_month: string | null; to_month: string; months: number; estimated: boolean; sufficient: boolean; reason: string | null; unclosed_months: string[] };
  metrics: { monthly_cost_cents: number | null; total_income_cents: number | null; recurring_income_average_cents: number | null; savings_percent: number | null; income_commitment_percent: number | null; emergency_months: number | null; credit_cost_cents: number | null; credit_cost_average_cents: number | null; credit_cost_income_percent: number | null };
  expense_groups: Record<string,number> | null;
  expense_items: (ReportItem & { group: string; credit_cost: boolean })[];
  income_items: (ReportItem & { recurring: boolean })[];
  next_month: string; next_month_obligations_cents: number; next_month_amortization_cents: number; emergency_reserve_cents: number;
  next_month_obligations: { id: string; label: string; due_on: string; amount_cents: number; principal_cents: number; kind: string }[];
  future_installments: FutureInstallments;
}
const panel = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
const groupLabels: Record<string,string> = { fixed:'Despesas fixas',variable:'Despesas variáveis',installments_and_debts:'Parcelas e encargos financeiros',unidentified_adjustments:'Diferenças não identificadas' };
const obligationLabels: Record<string,string> = { fixed_recurrence:'Despesa fixa recorrente',loan_recurrence:'Dívida sem cronograma',loan:'Empréstimo ou financiamento',card:'Parcelas do cartão' };

export default function LedgerFinancialHealth({ workspace,money,privacy }: ReportProps) {
  const [data,setData] = useState<Health | null>(null);
  const [error,setError] = useState(false);
  const [retry,setRetry] = useState(0);
  const [exporting,setExporting] = useState(false);
  const [exportError,setExportError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(false);
    void ledgerRpc<Health>('financial_health',{ p_space:workspace.space.id }).then(response => { if (!cancelled) setData(response); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  },[workspace,retry]);
  async function download() {
    if (exporting) return;
    setExporting(true); setExportError('');
    try {
      const csv = await ledgerRpc<string>('export_financial_report',{ p_space:workspace.space.id,p_report:'financial_health',p_month:`${workspace.space.today.slice(0,7)}-01` });
      const url = URL.createObjectURL(new Blob([csv],{ type:'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href=url; link.download=`financas-saude-${workspace.space.today}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch { setExportError('Não foi possível gerar o arquivo. Tente novamente.'); }
    finally { setExporting(false); }
  }
  const currency = (value: number | null) => value === null ? '—' : money(value);
  if (error) return <section className={panel}><h1 className="text-xl font-semibold">Saúde financeira</h1><p role="alert" className="mt-3 text-sm text-amber-800 dark:text-amber-300">Não foi possível consultar seus indicadores. Verifique a conexão e atualize.</p><button onClick={() => setRetry(value => value+1)} className="mt-3 text-sm font-semibold text-brand-700 dark:text-brand-300">Tentar novamente</button></section>;
  if (!data) return <section className={panel}><h1 className="text-xl font-semibold">Saúde financeira</h1><p role="status" className="mt-3 text-sm text-slate-500">Consultando seu histórico financeiro…</p></section>;
  const metrics = data.metrics;
  const cards = [
    { label:'Custo médio mensal',value:currency(metrics.monthly_cost_cents),note:'Despesas líquidas, com compras parceladas por mês de vencimento.' },
    { label:'Taxa de poupança',value:reportPercent(metrics.savings_percent,privacy),note:'Parte da renda que restou depois das despesas da janela.' },
    { label:'Renda recorrente média',value:currency(metrics.recurring_income_average_cents),note:'Receitas recorrentes, sem benefícios, renda extra e cashback.' },
    { label:'Renda comprometida no próximo mês',value:reportPercent(metrics.income_commitment_percent,privacy),note:'Despesas fixas recorrentes, parcelas do cartão e das dívidas.' },
    { label:'Reserva de emergência',value:privacy ? '••••' : metrics.emergency_months === null ? '—' : `${metrics.emergency_months.toLocaleString('pt-BR',{ maximumFractionDigits:2 })} meses`,note:'Considera o custo mensal e a amortização das dívidas em vigor.' },
    { label:'Custo de crédito na janela',value:currency(metrics.credit_cost_cents),note:`Média mensal: ${currency(metrics.credit_cost_average_cents)} · ${reportPercent(metrics.credit_cost_income_percent,privacy)} da renda.` }
  ];
  return <div className="space-y-5">
    <section className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Saúde financeira</h1><p className="mt-2 max-w-prose text-sm text-slate-500">Acompanhe o custo da sua rotina, a renda comprometida e sua proteção para imprevistos.</p></div><div className="flex flex-wrap gap-4"><button disabled={exporting} onClick={() => void download()} className="flex items-center gap-2 text-sm font-semibold text-brand-700 disabled:opacity-50 dark:text-brand-300"><Download size={16}/>{exporting ? 'Gerando arquivo…' : 'Baixar CSV'}</button><button onClick={() => setRetry(value => value+1)} className="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300"><RefreshCw size={16}/>Atualizar</button></div></div>
      {privacy && <p className="mt-3 text-xs text-slate-500">O arquivo CSV contém os valores completos.</p>}
      {exportError && <p role="alert" className="mt-3 text-sm text-amber-800 dark:text-amber-300">{exportError}</p>}
      {data.window.sufficient ? <p className="mt-4 text-sm text-slate-500">Janela: {reportMonth(data.window.from_month!)} a {reportMonth(data.window.to_month)} · {data.window.months} meses completos{data.window.estimated ? ' · Estimativa com o histórico disponível' : ''}.</p> : <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"><p className="font-semibold">Ainda falta histórico para calcular os indicadores.</p><p className="mt-1">São necessários pelo menos três meses completos de uso. Você tem {data.window.months}. O mês atual e o primeiro mês parcial ficam fora da janela.</p></div>}
      {data.window.sufficient && data.window.unclosed_months.length>0 && <details className="mt-3 text-sm text-slate-500"><summary className="cursor-pointer">Há meses ainda não fechados na janela</summary><p className="mt-2">{data.window.unclosed_months.map(reportMonth).join(', ')}. Novos lançamentos e correções podem alterar esses indicadores.</p></details>}
    </section>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(item => <section key={item.label} className={panel}><h2 className="text-sm font-medium text-slate-500">{item.label}</h2><p className="mt-2 text-3xl font-semibold">{item.value}</p><p className="mt-3 text-sm text-slate-500">{item.note}</p></section>)}</div>
    {data.window.sufficient && (metrics.savings_percent === null || metrics.income_commitment_percent === null || metrics.emergency_months === null) && <p className="text-sm text-slate-500">“—” indica que a renda ou o custo usados como base são zero. Um percentual indefinido não significa comprometimento zero.</p>}
    <section className={`${panel} space-y-4`}><h2 className="font-semibold">Obrigações de {reportMonth(data.next_month)}</h2><p className="text-2xl font-semibold">{money(data.next_month_obligations_cents)}</p><p className="text-sm text-slate-500">Cada obrigação entra uma vez. O principal das dívidas participa do comprometimento da renda e da proteção da reserva.</p>
      {data.next_month_obligations.length === 0 ? <p className="text-sm text-slate-500">Nenhuma obrigação dessa base no próximo mês.</p> : data.next_month_obligations.map(item => <div key={`${item.kind}-${item.id}`} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800"><div><p className="font-medium">{item.label}</p><p className="mt-1 text-xs text-slate-500">{obligationLabels[item.kind] ?? 'Compromisso'} · Vence {reportDate(item.due_on)}</p></div><strong>{money(item.amount_cents)}</strong></div>)}
    </section>
    <section className={`${panel} space-y-4`}><h2 className="font-semibold">Proteção para imprevistos</h2><dl className="space-y-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">Investimentos e metas marcados como emergência</dt><dd className="font-semibold">{money(data.emergency_reserve_cents)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">Custo médio mensal</dt><dd className="font-semibold">{currency(metrics.monthly_cost_cents)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">Principal das dívidas no próximo mês</dt><dd className="font-semibold">{money(data.next_month_amortization_cents)}</dd></div></dl><p className="text-xs text-slate-500">Uma conta marcada diretamente e também vinculada a uma meta entra uma vez. Benefícios ficam fora dessa reserva.</p></section>
    {data.window.sufficient && <section className={`${panel} space-y-4`}><h2 className="font-semibold">O que compõe o custo e a renda</h2><dl className="grid gap-4 sm:grid-cols-2">{Object.entries(data.expense_groups ?? {}).map(([group,amount]) => <div key={group}><dt className="text-sm text-slate-500">{groupLabels[group] ?? group}</dt><dd className="mt-1 text-xl font-semibold">{money(amount)}</dd></div>)}<div><dt className="text-sm text-slate-500">Renda total da janela</dt><dd className="mt-1 text-xl font-semibold">{currency(metrics.total_income_cents)}</dd></div></dl>
      <details className="border-t border-slate-200 pt-3 dark:border-slate-800"><summary className="cursor-pointer text-sm font-semibold">Ver despesas que compõem os indicadores</summary><div className="mt-3">{data.expense_items.length===0 ? <p className="text-sm text-slate-500">Nenhuma despesa nesta janela.</p> : data.expense_items.map((item,index) => <div key={`${item.transaction_id}-${index}`} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-3 text-sm last:border-0 dark:border-slate-800"><div><p>{item.label}</p><p className="mt-1 text-xs text-slate-500">{reportMonth(item.month!)} · {groupLabels[item.group] ?? 'Despesa'}{item.original_competence_month ? ` · ref. ${reportMonth(item.original_competence_month)}` : ''}</p></div><strong>{money(item.amount_cents)}</strong></div>)}</div></details>
      <details className="border-t border-slate-200 pt-3 dark:border-slate-800"><summary className="cursor-pointer text-sm font-semibold">Ver receitas que compõem a renda</summary><div className="mt-3">{data.income_items.length===0 ? <p className="text-sm text-slate-500">Nenhuma receita nesta janela.</p> : data.income_items.map((item,index) => <div key={`${item.transaction_id}-${index}`} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-3 text-sm last:border-0 dark:border-slate-800"><div><p>{item.label}</p><p className="mt-1 text-xs text-slate-500">{reportMonth(item.month!)} · {item.recurring ? 'Renda recorrente' : 'Outras receitas'}</p></div><strong>{money(item.amount_cents)}</strong></div>)}</div></details>
    </section>}
    <FutureInstallmentList value={data.future_installments} money={money} privacy={privacy}/>
  </div>;
}
