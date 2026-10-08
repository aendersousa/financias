import { Fragment, type ReactNode } from 'react';
import { Repeat2 } from 'lucide-react';
import type { WorkspaceMetadata } from '../lib/ledgerRepository';

export type RecurrenceRule = WorkspaceMetadata['recurrences'][number];
export const recurrenceFrequency = (rule: RecurrenceRule | RecurrenceRule['unit']) => {
  if (typeof rule === 'string') {
    return rule === 'month' ? 'Mensal' : rule === 'week' ? 'Semanal' : 'Anual';
  }
  if (rule.unit === 'month' && rule.current_version.timing_mode === 'business_day') {
    const day = rule.current_version.day_of_month;
    return day === -1 ? 'Mensal · Último dia útil' : `Mensal · ${day}º dia útil`;
  }
  return rule.unit === 'month' ? 'Mensal' : rule.unit === 'week' ? 'Semanal' : 'Anual';
};

export default function RecurrenceTable({ rules, money, renderActions, renderEditor }: {
  rules: RecurrenceRule[];
  money: (value: number) => string;
  renderActions: (rule: RecurrenceRule) => ReactNode;
  renderEditor: (rule: RecurrenceRule) => ReactNode;
}) {
  return <div className="table-shell">
    <table aria-label="Recorrências" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50"><tr>
        <th scope="col" className="w-[49%] px-3 py-2.5 sm:w-[34%] sm:px-4">Descrição</th>
        <th scope="col" className="hidden w-[16%] px-4 py-2.5 sm:table-cell">Frequência</th>
        <th scope="col" className="w-[30%] px-2 py-2.5 text-right sm:w-[18%] sm:px-4">Valor</th>
        <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th>
        <th scope="col" className="w-[21%] px-2 py-2.5 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rules.map(rule => {
          const editor = renderEditor(rule);
          return <Fragment key={rule.id}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="px-3 py-2.5 sm:px-4"><div className="flex items-start gap-2">
                <Repeat2 size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"/>
                <div className="min-w-0 [overflow-wrap:anywhere]"><span>{rule.title}</span>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{rule.direction === 'inflow' ? 'A receber' : (rule.current_version.payment_method === 'card' || rule.current_version.payment_credit_card_id ? 'A pagar · Cartão' : 'A pagar')}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:hidden">{recurrenceFrequency(rule)} · {rule.ends_on ? 'Encerrada' : 'Ativa'}</p>
                </div>
              </div></td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 sm:table-cell">{recurrenceFrequency(rule)}</td>
              <td className="px-2 py-2.5 text-right font-medium [overflow-wrap:anywhere] sm:px-4">{money(rule.current_version.amount_cents)}</td>
              <td className="hidden px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 sm:table-cell">{rule.ends_on ? 'Encerrada' : 'Ativa'}</td>
              <td className="px-2 py-2.5 text-right sm:px-4">{renderActions(rule)}</td>
            </tr>
            {editor && <tr><td colSpan={5} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>;
        })}
        {!rules.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma recorrência cadastrada.</td></tr>}
      </tbody>
    </table>
  </div>;
}
