import { Fragment, type ReactNode } from 'react';
import type { LedgerReserve } from '../pages/LedgerReserves';

const statusLabels = { active: 'Em andamento', achieved: 'Meta atingida', settled: 'Quitada', closed: 'Encerrada' };

export default function ReserveTable({ reserves, money, expanded, busy, onDetails, renderDetails }: {
  reserves: LedgerReserve[]; money: (value: number) => string; expanded: string | null; busy: boolean;
  onDetails: (reserve: LedgerReserve) => void; renderDetails: (reserve: LedgerReserve) => ReactNode;
}) {
  return <div className="table-shell"><table aria-label="Metas e provisões" className="w-full table-fixed text-sm">
    <colgroup><col className="w-[43%] sm:w-[28%]"/><col className="hidden sm:table-column sm:w-[17%]"/><col className="w-[33%] sm:w-[18%]"/><col className="hidden sm:table-column sm:w-[16%]"/><col className="hidden sm:table-column sm:w-[11%]"/><col className="w-[24%] sm:w-[10%]"/></colgroup>
    <thead className="table-head"><tr><th scope="col" className="px-3 py-2.5 sm:px-4">Nome</th><th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Tipo</th><th scope="col" className="px-2 py-2.5 text-right sm:px-4">Separado</th><th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Meta</th><th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{reserves.map(reserve => <Fragment key={reserve.id}>
      <tr className="table-row-hover"><td className="break-words px-3 py-3 sm:px-4"><span className="font-medium">{reserve.name}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{reserve.account_name}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400 sm:hidden">{reserve.reserve_type === 'goal' ? 'Meta' : 'Provisão'} · {statusLabels[reserve.progress_status]}</span>{reserve.release_shortfall_cents > 0 && <p role="alert" className="mt-1 text-xs text-amber-700 dark:text-amber-300">Liberação sem cobertura: {money(reserve.release_shortfall_cents)}. Confira o histórico.</p>}</td>
      <td className="hidden break-words px-4 py-3 text-slate-500 dark:text-slate-400 sm:table-cell">{reserve.reserve_type === 'goal' ? 'Meta' : 'Provisão'}</td><td className="break-words px-2 py-3 text-right font-medium sm:px-4">{money(reserve.balance_cents)}<span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400 sm:hidden">de {money(reserve.target_amount_cents)}</span></td><td className="hidden break-words px-4 py-3 text-right sm:table-cell">{money(reserve.target_amount_cents)}</td><td className="hidden break-words px-4 py-3 text-xs text-slate-500 dark:text-slate-400 sm:table-cell">{statusLabels[reserve.progress_status]}</td>
      <td className="px-2 py-3 text-right sm:px-4"><button type="button" aria-label={`Ver detalhes de ${reserve.name}`} aria-expanded={expanded === reserve.id} disabled={busy} onClick={() => onDetails(reserve)} className="text-xs font-semibold text-brand-700 dark:text-brand-300">{expanded === reserve.id ? 'Fechar' : 'Detalhes'}</button></td></tr>
      {expanded === reserve.id && <tr><td colSpan={6} className="p-3 sm:p-4">{renderDetails(reserve)}</td></tr>}
    </Fragment>)}{!reserves.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma meta ou provisão neste filtro.</td></tr>}</tbody>
  </table></div>;
}
