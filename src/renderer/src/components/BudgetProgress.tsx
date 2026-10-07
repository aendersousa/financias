import type { LedgerBudget } from '../lib/ledgerRepository';

const percentage = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export default function BudgetProgress({ budget, name, privacy }: { budget?: LedgerBudget; name: string; privacy: boolean }) {
  if (!budget) return null;
  if (privacy) return <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Progresso oculto</p>;

  const spent = Math.max(0, budget.consumed_cents);
  if (budget.amount_cents <= 0) return <p className={`mt-3 text-xs ${spent > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>{spent > 0 ? 'Gasto com limite zero' : 'Limite zero neste mês'}</p>;

  const used = spent / budget.amount_cents * 100;
  const fill = Math.min(100, used);
  const exceeded = spent > budget.amount_cents;
  const full = spent === budget.amount_cents;
  const near = used >= 80;
  const status = exceeded ? 'Limite ultrapassado' : full ? 'Limite atingido' : near ? 'Perto do limite' : '';
  const text = `${percentage.format(used)}%`;
  const color = exceeded ? 'bg-red-500 dark:bg-red-400' : near ? 'bg-amber-500 dark:bg-amber-400' : 'bg-brand-500 dark:bg-brand-400';
  const statusColor = exceeded ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400';

  return <div className="mt-3 min-w-0 space-y-1.5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-slate-500 dark:text-slate-400"><span>Utilizado</span><span className="font-semibold tabular-nums [overflow-wrap:anywhere]">{text}</span></div>
    <div role="progressbar" aria-label={`Uso do orçamento de ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-valuetext={`${text} do limite gasto${status ? `, ${status.toLowerCase()}` : ''}`} className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div aria-hidden="true" className={`h-full rounded-full ${color}`} style={{ width: `${fill}%` }}/>
    </div>
    {status && <p className={`text-xs ${statusColor}`}>{status}</p>}
  </div>;
}
