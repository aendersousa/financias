import { useEffect, useState } from 'react';
import type { FreeToSpendInput, FreeToSpendScenario } from '../../../shared/finance/freeToSpend';
import { shiftDays } from '../../../shared/finance/calendar';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { activeUserId,cachedWorkspace,cacheProjection } from '../lib/offlineStorage';
import LedgerFreeWarnings, { type FreeToSpendDiagnostics } from './LedgerFreeWarnings';

interface EssentialDetails {
  essentialNeedCents: number; grossNeedCents: number;
  benefits: { accountId: string; name: string; balanceCents: number; offsetCents: number; freeCents: number }[];
  quotas: { budgetId: string; categoryName: string; month: string; needCents: number; benefitOffsetCents: number }[];
}
interface SpendReadModel extends FreeToSpendInput {
  horizonEnd: string; essentialDetails: EssentialDetails;
  commitments: readonly (FreeToSpendInput['commitments'][number] & { label?: string })[];
  statements: readonly (FreeToSpendInput['statements'][number] & { label?: string })[];
  people: readonly (FreeToSpendInput['people'][number] & { label?: string })[];
  reserves: readonly (FreeToSpendInput['reserves'][number] & { label?: string })[];
  scheduled: readonly (FreeToSpendInput['scheduled'][number] & { label?: string })[];
}
type Projection = { input: SpendReadModel; calculation: { horizonEnd: string; conservative: FreeToSpendScenario; expected: FreeToSpendScenario }; diagnostics?: FreeToSpendDiagnostics };
const panel = 'card p-5 dark:border-slate-800 dark:bg-slate-900';
const dateLabel = (value: string) => value.split('-').reverse().join('/');
const itemGroups: Record<string,string> = { income:'Entrada prevista',agenda:'Conta a pagar',card:'Fatura',card_reserve:'Fatura vinculada à reserva',person:'Valor com pessoa',scheduled:'Movimentação agendada',scheduled_reserve:'Gasto agendado com reserva' };

export default function LedgerFreeToSpend({ workspace,money,offline=false }: { workspace: LedgerWorkspace; money: (value: number) => string; offline?: boolean }) {
  const [projection,setProjection] = useState<Projection | null>(null);
  const [error,setError] = useState(false);
  const [retry,setRetry] = useState(0);
  const [scenario,setScenario] = useState<'conservative' | 'expected'>('conservative');
  useEffect(() => {
    let cancelled = false;
    setProjection(null); setError(false);
    const load=async () => {
      if (offline || !navigator.onLine) {
        const cache=await cachedWorkspace();
        if (cache?.workspace.space.id!==workspace.space.id || !cache.projection) throw new Error('Nenhum cálculo salvo.');
        return cache.projection as Projection;
      }
      const userId=await activeUserId();
      const response=await ledgerRpc<Projection>('free_to_spend_summary',{ p_space:workspace.space.id });
      if (await activeUserId() !== userId) throw new Error('O usuário mudou enquanto o cálculo era carregado.');
      await cacheProjection(workspace.space.id,response,userId).catch(() => undefined);
      return response;
    };
    void load().then(response => {
      if (response.calculation.horizonEnd !== response.input.horizonEnd) throw new Error('O período do cálculo mudou.');
      if (!cancelled) setProjection(response);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  },[workspace,retry,offline]);
  if (error) return <section className={panel} aria-label="Livre para gastar"><h2 className="font-semibold">Livre para gastar</h2><p role="alert" className="mt-2 text-sm text-amber-800 dark:text-amber-300">Não foi possível calcular o valor agora. Atualize para tentar novamente.</p><button onClick={() => setRetry(value => value+1)} className="mt-3 text-sm font-semibold text-teal-700 dark:text-teal-300">Atualizar cálculo</button></section>;
  if (!projection) return <section className={panel} aria-label="Livre para gastar"><h2 className="font-semibold">Livre para gastar</h2><p className="mt-2 text-sm text-slate-500">Calculando quanto você pode gastar…</p></section>;
  const { input,calculation:result } = projection;
  const detail = result[scenario];
  const labels = new Map([...input.commitments,...input.statements,...input.people,...input.reserves,...input.scheduled].map(item => [item.id,item.label]));
  const rows = [
    { label:'Saldo em contas',amount:detail.cashCents },
    { label:'Entradas previstas',amount:detail.expectedInflowsCents },
    { label:'Contas, faturas e outros compromissos',amount:-detail.committedCents },
    { label:'Reservado para metas e provisões',amount:-detail.reservedCents },
    { label:'Reserva mínima de segurança',amount:-detail.safetyCents },
    { label:'Ainda necessário para essenciais',amount:-detail.essentialCents }
  ];
  return <section className={`${panel} space-y-5`} aria-label="Livre para gastar">
    <div className="grid gap-5 sm:grid-cols-2"><div className="border-l-4 border-teal-600 pl-4"><h2 className="font-semibold">Livre para gastar</h2><p className="mt-1 text-xs text-slate-500">Cenário conservador</p><p aria-label="Livre para gastar conservador" className="mt-2 text-3xl font-semibold">{money(result.conservative.valueCents)}</p><p className="mt-2 text-sm text-slate-500">Até {dateLabel(shiftDays(result.horizonEnd,-1))}, incluindo as obrigações deste período.</p></div><div><h3 className="text-sm font-medium">Se as receitas previstas entrarem</h3><p aria-label="Livre para gastar esperado" className="mt-2 text-2xl font-semibold">{money(result.expected.valueCents)}</p><p className="mt-2 max-w-prose text-sm text-slate-500">Considera também os valores estimados, condicionais e atrasados que você espera receber.</p></div></div>
    {result.conservative.valueCents<0 && <LedgerFreeWarnings diagnostics={projection.diagnostics} money={money} />}
    <details className="border-t border-slate-200 pt-4 dark:border-slate-800"><summary className="cursor-pointer text-sm font-semibold">Como esse valor foi calculado</summary><div className="mt-4 space-y-5">
      <div className="grid gap-1.5"><label htmlFor="spend-scenario" className="text-sm font-medium">Detalhar cenário</label><select id="spend-scenario" value={scenario} onChange={event => setScenario(event.target.value as 'conservative' | 'expected')} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="conservative">Conservador</option><option value="expected">Se as receitas previstas entrarem</option></select></div>
      <dl className="space-y-3">{rows.map(row => <div key={row.label} className="flex flex-wrap items-center justify-between gap-2 text-sm"><dt className="max-w-prose text-slate-500">{row.label}</dt><dd className="font-semibold">{money(row.amount)}</dd></div>)}<div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800"><dt className="font-semibold">Livre para gastar</dt><dd className="font-semibold">{money(detail.valueCents)}</dd></div></dl>
      {detail.uncoveredReserveCents>0 && <p className="text-sm text-slate-500">Dos gastos vinculados, {money(detail.uncoveredReserveCents)} excedem o saldo das reservas e entram como dinheiro comprometido.</p>}
      {detail.items.length>0 && <div className="space-y-3"><h3 className="text-sm font-semibold">Entradas e compromissos considerados</h3>{detail.items.filter(item => item.amountCents!==0 || item.reserveId).map((item,index) => <div key={`${item.id}-${index}`} className="border-b border-slate-100 pb-3 text-sm last:border-0 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><p>{labels.get(item.id) ?? labels.get(item.id.split(':')[0]) ?? itemGroups[item.group] ?? 'Compromisso'}</p><p className="mt-1 text-xs text-slate-500">{itemGroups[item.group] ?? 'Compromisso'}{item.reserveId && labels.get(item.reserveId) ? ` · ${labels.get(item.reserveId)}` : ''}</p></div><strong>{money(item.amountCents)}</strong></div>{item.reserveId && item.consideredCents!==undefined && item.coveredCents!==undefined && <p className="mt-2 text-xs text-slate-500">Valor considerado: {money(item.consideredCents)}. Coberto pela reserva: {money(item.coveredCents)}. A parte coberta já está no valor reservado.</p>}</div>)}</div>}
      {input.essentialDetails.quotas.length>0 && <div className="space-y-3"><h3 className="text-sm font-semibold">Essenciais protegidos até {dateLabel(shiftDays(result.horizonEnd,-1))}</h3>{input.essentialDetails.quotas.map(quota => <div key={`${quota.budgetId}-${quota.month}`} className="flex flex-wrap justify-between gap-2 text-sm"><div><p>{quota.categoryName}</p><p className="mt-1 text-xs text-slate-500">{quota.month.slice(0,7)}{quota.benefitOffsetCents>0 ? ` · Coberto por benefício: ${money(quota.benefitOffsetCents)}` : ''}</p></div><strong>{money(quota.needCents)}</strong></div>)}</div>}
    </div></details>
    {input.essentialDetails.benefits.length>0 && <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"><h3 className="text-sm font-semibold">Livre nos benefícios</h3><p className="max-w-prose text-xs text-slate-500">Saldo de VR/VA que sobra depois dos essenciais previstos. Este dinheiro continua separado do Livre para gastar.</p>{input.essentialDetails.benefits.map(benefit => <div key={benefit.accountId} className="flex flex-wrap justify-between gap-2 text-sm"><div><p>{benefit.name}</p><p className="mt-1 text-xs text-slate-500">Separado para essenciais: {money(benefit.offsetCents)}</p></div><strong>{money(benefit.freeCents)}</strong></div>)}</div>}
  </section>;
}
