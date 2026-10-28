import { AlertTriangle } from 'lucide-react';

interface UncoveredItem {
  id: string;
  label: string;
  uncoveredCents: number;
  totalCents: number;
}

export type FreeToSpendDiagnostics =
  | { kind: 'none' }
  | { kind: 'commitments'; shortageCents: number; firstNegativeOn: string; uncoveredItem: UncoveredItem; reservesAlsoUncovered: boolean; timelineExtendsBeyondHorizon: boolean }
  | { kind: 'reserves'; shortageCents: number; uncoveredReserves: UncoveredItem[] };

// Format from structured cents using the workspace's privacy-aware money
// function. The server's unmasked canonical message is never rendered here.
export default function LedgerFreeWarnings({ diagnostics,money }: { diagnostics?: FreeToSpendDiagnostics; money: (value: number) => string }) {
  if (diagnostics?.kind === 'none') return null;
  let message = 'Os compromissos e reservas superam o dinheiro previsto para este período. Revise as contas a pagar e seus planos antes de assumir novos gastos.';
  if (diagnostics?.kind === 'commitments') {
    const [,month,day] = diagnostics.firstNegativeOn.split('-');
    message = `Faltam ${money(diagnostics.shortageCents)} até ${day}/${month}. Item descoberto: ${diagnostics.uncoveredItem.label} (${money(diagnostics.uncoveredItem.uncoveredCents)} de ${money(diagnostics.uncoveredItem.totalCents)}).`;
    if (diagnostics.reservesAlsoUncovered) message += ' Suas reservas também ficam descobertas.';
  } else if (diagnostics?.kind === 'reserves') {
    message = `Suas reservas superam em ${money(diagnostics.shortageCents)} o que sobra depois dos compromissos e dos essenciais.`;
    if (diagnostics.uncoveredReserves.length) {
      message += ` Descoberta: ${diagnostics.uncoveredReserves.map(item => `${item.label} — ${money(item.uncoveredCents)} de ${money(item.totalCents)}`).join('; ')}.`;
    }
  }
  return <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
    <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
    <div className="space-y-2"><p>{message}</p>
      {diagnostics?.kind === 'commitments' && diagnostics.timelineExtendsBeyondHorizon && <p className="text-xs">Este diagnóstico inclui obrigações já consideradas no Livre com pagamento depois do fim do período.</p>}
    </div>
  </div>;
}
