import { Fragment, type ReactNode } from 'react';

export interface ForecastEvent {
  id: string;
  label: string;
  kind: string;
  on: string;
  conservativeCents: number;
  expectedCents: number;
  projected?: boolean;
  estimatedChargesCents?: number;
  occurrences?: { label: string; projected?: boolean }[];
}

export default function ForecastEventTable({ events, money, renderActions, renderEditor }: {
  events: ForecastEvent[];
  money: (value: number) => string;
  renderActions: (event: ForecastEvent) => ReactNode;
  renderEditor: (event: ForecastEvent) => ReactNode;
}) {
  return <div className="table-shell">
    <table aria-label="Eventos do dia da previsão" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50"><tr>
        <th scope="col" className="w-[45%] px-3 py-2.5 sm:w-[42%] sm:px-4">Descrição</th>
        <th scope="col" className="w-[34%] px-2 py-2.5 text-right sm:w-[24%] sm:px-4">Conservador</th>
        <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Se as receitas entrarem</th>
        <th scope="col" className="w-[21%] px-1 py-2.5 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {events.map(event => {
          const editor = renderEditor(event);
          return <Fragment key={`${event.kind}-${event.id}`}>
            <tr className="table-row-hover transition-[background-color]">
              <td className="px-3 py-2.5 sm:px-4"><div className="min-w-0 [overflow-wrap:anywhere]">{event.label}
                {event.projected && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Recorrência projetada</p>}
                {Boolean(event.estimatedChargesCents) && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Encargos estimados</p>}
              </div></td>
              <td className="px-2 py-2.5 text-right font-medium [overflow-wrap:anywhere] sm:px-4">{money(event.conservativeCents)}
                {event.expectedCents !== event.conservativeCents && <p className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-400 sm:hidden">Se entrar: {money(event.expectedCents)}</p>}
              </td>
              <td className="hidden px-4 py-2.5 text-right text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400 sm:table-cell">{money(event.expectedCents)}</td>
              <td className="px-1 py-2.5 text-right sm:px-4">{renderActions(event)}</td>
            </tr>
            {editor && <tr><td colSpan={4} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>;
        })}
        {!events.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma entrada ou pagamento previsto para este dia.</td></tr>}
      </tbody>
    </table>
  </div>;
}
