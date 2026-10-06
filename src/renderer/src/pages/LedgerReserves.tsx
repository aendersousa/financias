import { useEffect, useState, type FormEvent } from 'react';
import { parseBrlCents } from '../../../shared/finance/money';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { useAppStore } from '../store/useAppStore';

interface ReserveEvent {
  id: string; on: string; kind: 'contribution' | 'release' | 'consume' | 'refund' | 'terminal_release';
  amount_cents: number; actual_cents: number; consumed_cents: number; common_cents: number;
  restored_cents: number; balance_cents: number; transaction_id: string | null;
}
export interface LedgerReserve {
  id: string; name: string; reserve_type: 'goal' | 'provision'; holding_mode: 'virtual' | 'account';
  financial_account_id: string; account_name: string; target_amount_cents: number; target_date: string | null;
  category_id: string | null; status: 'active' | 'achieved' | 'settled' | 'closed';
  progress_status: 'active' | 'achieved' | 'settled' | 'closed'; version: number;
  balance_cents: number; release_shortfall_cents: number; is_emergency_reserve: boolean; events: ReserveEvent[];
}
export interface ReserveSummary {
  on: string; reserves: LedgerReserve[]; reserved_cents: number;
  uncovered_accounts: { id: string; name: string; uncovered_cents: number }[];
}
export interface ContributionPreview { requiresWarning: boolean; conservativeBeforeCents?: number; conservativeAfterCents?: number; approvalToken: string | null; projectionOn?: string; reserveVersion: number }
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950';
const primary = 'rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const statusLabels = { active:'Em andamento',achieved:'Meta atingida',settled:'Quitada',closed:'Encerrada' };
const eventLabels = { contribution:'Aporte',release:'Liberação',consume:'Gasto vinculado',refund:'Devolução',terminal_release:'Encerramento' };

export default function LedgerReserves({ workspace,money,onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [summary,setSummary] = useState<ReserveSummary | null>(null);
  const [newOpen,setNewOpen] = useState(false);
  const [reserveType,setReserveType] = useState<'goal' | 'provision'>('goal');
  const [holdingMode,setHoldingMode] = useState<'virtual' | 'account'>('virtual');
  const [action,setAction] = useState<{ reserve: string; kind: 'contribution' | 'release' | 'close' } | null>(null);
  const [clientId,setClientId] = useState(() => crypto.randomUUID());
  const [preview,setPreview] = useState<ContributionPreview | null>(null);
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[notice,setNotice] = useState('');
  const privacy = useAppStore(state => state.privacyMode);
  const canWrite = workspace.role !== 'viewer';
  const canManage = ['owner','admin'].includes(workspace.role);
  async function load() { setSummary(await ledgerRpc<ReserveSummary>('reserve_summary',{ p_space:workspace.space.id })); }
  useEffect(() => { setPreview(null); void load().catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as reservas.')); },[workspace]);
  async function save(event: FormEvent<HTMLFormElement>,creating: boolean) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget),text = (key: string) => String(data.get(key) ?? '').trim();
    setBusy(true); setError(''); setNotice('');
    try {
      if (creating) {
        const amount = parseBrlCents(text('amount'));
        if (amount < 1) throw new Error('Informe um valor-alvo maior que zero.');
        await ledgerRpc('create_reserve',{ p_space:workspace.space.id,p_payload:{
          reserve_type:reserveType,name:text('name'),holding_mode:reserveType === 'provision' ? 'virtual' : holdingMode,
          financial_account_id:text('account'),target_amount_cents:amount,target_date:text('date') || null,
          category_id:reserveType === 'provision' ? text('category') : null,is_emergency_reserve:data.get('emergency') === 'on'
          ,contribution_mode: text('mode') || (reserveType === 'provision' ? 'automatic' : 'manual')
        } });
      } else if (action) {
        const reserve = summary?.reserves.find(item => item.id === action.reserve);
        if (!reserve) throw new Error('Atualize a lista e selecione a reserva novamente.');
        if (action.kind === 'close') await ledgerRpc('manage_reserve',{ p_space:workspace.space.id,p_reserve:reserve.id,p_version:reserve.version,p_action:'close',p_payload:{ on:text('date'),reason:text('reason') } });
        else {
          const amount = parseBrlCents(text('amount'));
          if (amount < 1) throw new Error('Informe um valor maior que zero.');
          const args = { p_space:workspace.space.id,p_reserve:reserve.id,p_kind:action.kind,p_amount_cents:amount,p_on:text('date'),p_note:text('note') || null };
          if (action.kind === 'contribution' && reserve.reserve_type === 'goal' && !preview) {
            const result = await ledgerRpc<ContributionPreview>('preview_reserve_contribution', args);
            setPreview(result);
            if (result.requiresWarning) return;
          }
          await ledgerRpc('reserve_contribution',{ ...args,p_client_uuid:clientId,p_approval_token:preview?.requiresWarning && data.get('negative_ack') === 'on' ? preview.approvalToken : null });
        }
      }
      setNewOpen(false); setAction(null); setPreview(null); setClientId(crypto.randomUUID());
      await load(); await onChanged(); setNotice(creating ? 'Reserva cadastrada.' : 'Reserva atualizada.');
    } catch (failure) { const message = failure instanceof Error ? failure.message : 'Não foi possível salvar a reserva.'; if (message.includes('preview changed') || message.includes('free balance negative')) { setPreview(null); setError('O valor disponível mudou. Confira novamente o aporte antes de confirmar.'); } else setError(message); }
    finally { setBusy(false); }
  }
  function chooseAction(reserve: string,kind: 'contribution' | 'release' | 'close') { setAction({ reserve,kind }); setPreview(null); setNewOpen(false); setClientId(crypto.randomUUID()); setError(''); setNotice(''); }
  const selected = summary?.reserves.find(item => item.id === action?.reserve);
  const accounts = workspace.accounts.filter(item => item.liquidity === (reserveType === 'goal' && holdingMode === 'account' ? 'investment' : 'cash') && !(holdingMode === 'account' && summary?.reserves.some(reserve => reserve.holding_mode === 'account' && reserve.financial_account_id === item.id)));
  const expenseCategories = workspace.categories.filter(item => item.kind === 'expense' && item.ledger_account_id);
  const field = (title: string,id: string) => <label htmlFor={id} className="text-sm font-medium">{title}</label>;
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Dinheiro separado para seus planos</h2><p className="mt-1 max-w-prose text-sm text-slate-500">Guarde para um objetivo ou prepare o pagamento de uma despesa futura. Uma provisão também cria a conta a pagar na Agenda.</p></div>{canManage && <button onClick={() => { setNewOpen(true); setAction(null); setError(''); setNotice(''); }} disabled={busy} className={primary}>Cadastrar meta ou provisão</button>}</div>
      {summary && <div className="border-l-4 border-teal-600 pl-4"><p className="text-sm text-slate-500">Reservado dentro das contas</p><p className="mt-1 text-2xl font-semibold">{money(summary.reserved_cents)}</p><p className="mt-1 text-xs text-slate-500">O saldo das contas continua o mesmo. Metas em investimentos acompanham o saldo da própria conta.</p></div>}
    </section>
    {summary?.uncovered_accounts.map(account => <div key={account.id} role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"><strong>{account.name}: faltam {money(account.uncovered_cents)} para cobrir as reservas.</strong><p className="mt-1">Reservas nesta conta: {summary.reserves.filter(reserve => reserve.financial_account_id === account.id && reserve.holding_mode === 'virtual' && ['active','achieved'].includes(reserve.status)).map(reserve => reserve.name).join(', ')}.</p><p className="mt-1">Reponha o saldo da conta ou libere parte das reservas para ajustar seus planos.</p></div>)}
    {canManage && newOpen && <form onSubmit={event => void save(event,true)} className={`${panel} grid gap-4 sm:grid-cols-2`}>
      <h2 className="font-semibold sm:col-span-2">Nova meta ou provisão</h2>
      <div className="grid gap-2">{field('Tipo de reserva','reserve-type')}<select id="reserve-type" value={reserveType} onChange={event => { setReserveType(event.target.value as 'goal' | 'provision'); if (event.target.value === 'provision') setHoldingMode('virtual'); }} disabled={busy} className={input}><option value="goal">Meta: guardar para um objetivo</option><option value="provision">Provisão: preparar uma despesa</option></select></div>
      <div className="grid gap-2">{field('Nome da reserva','reserve-name')}<input id="reserve-name" name="name" maxLength={100} required className={input}/></div>
      <div className="grid gap-2">{field('Modo de aporte','reserve-mode')}<select id="reserve-mode" name="mode" key={reserveType} defaultValue={reserveType === 'provision' ? 'automatic' : 'manual'} className={input}><option value="manual">Manual: confirmar cada aporte</option><option value="automatic">Automático: nas datas do plano</option></select></div>
      {reserveType === 'goal' && <div className="grid gap-2">{field('Onde guardar','reserve-holding')}<select id="reserve-holding" value={holdingMode} onChange={event => setHoldingMode(event.target.value as 'virtual' | 'account')} disabled={busy} className={input}><option value="virtual">Separar dentro de uma conta</option><option value="account">Acompanhar uma conta de investimento</option></select></div>}
      <div className="grid gap-2">{field('Conta da reserva','reserve-account')}<select id="reserve-account" name="account" key={`${reserveType}-${holdingMode}`} required className={input}><option value="">Selecione uma conta</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{accounts.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-300">{holdingMode === 'account' ? 'Cadastre uma conta de investimento que ainda não esteja vinculada a uma meta.' : 'Cadastre primeiro uma conta corrente, de pagamento ou carteira.'}</p>}</div>
      <div className="grid gap-2">{field(reserveType === 'goal' ? 'Valor-alvo (R$)' : 'Valor previsto (R$)','reserve-target')}<input id="reserve-target" name="amount" inputMode="decimal" required className={input}/></div>
      <div className="grid gap-2">{field(reserveType === 'goal' ? 'Data-alvo (opcional)' : 'Vencimento da provisão','reserve-date')}<input id="reserve-date" name="date" type="date" required={reserveType === 'provision'} className={input}/></div>
      {reserveType === 'provision' && <div className="grid gap-2">{field('Categoria da provisão','reserve-category')}<select id="reserve-category" name="category" required className={input}><option value="">Selecione uma categoria de despesa</option>{expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{expenseCategories.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Cadastre uma categoria de despesa antes de criar a provisão.</p>}</div>}
      {reserveType === 'goal' && <label className="flex items-center gap-2 text-sm"><input name="emergency" type="checkbox"/>Reserva de emergência</label>}
      <p className="text-sm text-slate-500 sm:col-span-2">{holdingMode === 'account' ? 'A meta acompanha o saldo do investimento. Registre as aplicações e os resgates em Lançamentos ou Patrimônio.' : 'Depois de cadastrar, registre o valor que deseja separar. Aportes e liberações organizam seu dinheiro sem movimentar a conta.'}</p>
      <div className="flex gap-3 sm:col-span-2"><button disabled={busy || accounts.length === 0 || reserveType === 'provision' && expenseCategories.length === 0} className={primary}>{busy ? 'Salvando…' : 'Cadastrar reserva'}</button><button type="button" disabled={busy} onClick={() => setNewOpen(false)} className="text-sm">Cancelar</button></div>
    </form>}
    {canWrite && action && selected && <form key={`${selected.id}-${action.kind}`} onSubmit={event => void save(event,false)} onChange={event => { const target = event.target; if (!(target instanceof HTMLInputElement) || target.name !== 'negative_ack') { setPreview(null); setClientId(crypto.randomUUID()); } }} className={`${panel} grid gap-4 sm:grid-cols-2`}>
      <h2 className="font-semibold sm:col-span-2">{action.kind === 'contribution' ? 'Separar dinheiro' : action.kind === 'release' ? 'Liberar dinheiro' : 'Encerrar reserva'}: {selected.name}</h2>
      <p className="text-sm text-slate-500 sm:col-span-2">{action.kind === 'close' ? selected.holding_mode === 'virtual' ? 'O saldo restante será liberado. Novos gastos não poderão ser vinculados; devoluções posteriores voltarão como dinheiro comum.' : 'A meta será encerrada e o saldo continuará no investimento.' : action.kind === 'contribution' ? 'Este valor fica separado para a reserva dentro da conta, sem transferência bancária.' : 'Este valor volta a ficar livre na conta, sem transferência bancária.'}{action.kind === 'close' && selected.reserve_type === 'provision' ? ' Quite ou cancele os compromissos vinculados na Agenda antes de encerrar.' : ''}</p>
      {action.kind !== 'close' && <div className="grid gap-2">{field('Valor da movimentação (R$)','reserve-action-amount')}<input id="reserve-action-amount" name="amount" inputMode="decimal" required disabled={busy} className={input}/></div>}
      <div className="grid gap-2">{field('Data da movimentação','reserve-action-date')}<input id="reserve-action-date" name="date" type="date" defaultValue={workspace.space.today} max={action.kind === 'close' ? workspace.space.today : undefined} required disabled={busy} className={input}/></div>
      <div className="grid gap-2 sm:col-span-2">{field(action.kind === 'close' ? 'Motivo do encerramento' : 'Observação (opcional)','reserve-action-note')}<textarea id="reserve-action-note" name={action.kind === 'close' ? 'reason' : 'note'} required={action.kind === 'close'} maxLength={1000} disabled={busy} className={input}/></div>
      {preview?.requiresWarning && <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 sm:col-span-2"><p className="font-semibold">Este aporte deixa o Livre para gastar conservador negativo.</p><p>Antes do aporte: {money(preview.conservativeBeforeCents!)}. Após o aporte: {money(preview.conservativeAfterCents!)}.</p><p>Você pode reduzir o valor para preservar o dinheiro disponível para os próximos pagamentos.</p><label className="flex gap-2"><input key={preview.approvalToken} name="negative_ack" type="checkbox" required disabled={busy}/>Conferi o aviso e quero manter este aporte.</label></div>}
      <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className={primary}>{busy ? 'Salvando…' : action.kind === 'contribution' ? preview?.requiresWarning ? 'Confirmar aporte mesmo assim' : 'Registrar aporte' : action.kind === 'release' ? 'Registrar liberação' : 'Encerrar reserva'}</button><button type="button" disabled={busy} onClick={() => { setAction(null); setPreview(null); }} className="text-sm">Cancelar</button></div>
    </form>}
    {!summary && !error && <p className="text-sm text-slate-500">Carregando reservas…</p>}
    {summary?.reserves.length === 0 && <p className={`${panel} text-sm text-slate-500`}>Nenhuma meta ou provisão. Cadastre sua primeira reserva para começar a separar dinheiro.</p>}
    {summary?.reserves.map(reserve => <section key={reserve.id} className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{reserve.name}</h2><p className="mt-1 text-sm text-slate-500">{reserve.reserve_type === 'goal' ? 'Meta' : 'Provisão'} em {reserve.account_name}{reserve.is_emergency_reserve ? ' · Reserva de emergência' : ''}</p>{reserve.target_date && <p className="mt-1 text-xs text-slate-500">{reserve.reserve_type === 'goal' ? 'Data-alvo' : 'Vencimento'}: {reserve.target_date}</p>}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium dark:bg-slate-800">{statusLabels[reserve.progress_status]}</span></div>
      <div><p className="text-lg font-semibold">{money(reserve.balance_cents)} <span className="text-sm font-normal text-slate-500">de {money(reserve.target_amount_cents)}</span></p>{!privacy && <progress aria-label={`Progresso de ${reserve.name}`} value={Math.min(reserve.balance_cents,reserve.target_amount_cents)} max={reserve.target_amount_cents} className="mt-2 h-2 w-full accent-teal-600"/>}</div>
      {reserve.release_shortfall_cents > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Uma mudança no histórico deixou {money(reserve.release_shortfall_cents)} de liberação sem saldo disponível. Confira as movimentações anteriores.</p>}
      {canWrite && ['active','achieved'].includes(reserve.status) && <div className="flex flex-wrap gap-4 text-sm font-semibold text-teal-700 dark:text-teal-300">{reserve.holding_mode === 'virtual' && <><button disabled={busy} onClick={() => chooseAction(reserve.id,'contribution')}>Separar dinheiro</button><button disabled={busy || reserve.balance_cents <= 0} onClick={() => chooseAction(reserve.id,'release')}>Liberar dinheiro</button></>}{canManage && <button disabled={busy} onClick={() => chooseAction(reserve.id,'close')}>Encerrar reserva</button>}</div>}
      {reserve.holding_mode === 'account' && <p className="text-sm text-slate-500">O progresso acompanha o saldo da conta de investimento. Registre aportes e resgates nas movimentações da conta.</p>}
      {reserve.holding_mode === 'virtual' && <details className="border-t border-slate-200 pt-3 text-sm dark:border-slate-800"><summary className="cursor-pointer font-medium">Histórico da reserva</summary><div className="mt-3 space-y-3">{reserve.events.slice().reverse().map((event,index) => <div key={`${event.id}-${index}`} className="border-b border-slate-100 pb-3 last:border-0 dark:border-slate-800"><div className="flex flex-wrap justify-between gap-2"><span>{event.on} · {eventLabels[event.kind]}</span><strong>{money(event.amount_cents)}</strong></div><p className="mt-1 text-xs text-slate-500">Saldo após movimentação: {money(event.balance_cents)}</p>{event.kind === 'consume' && <p className="mt-1 text-xs text-slate-500">Da reserva: {money(event.consumed_cents)} · Gasto comum: {money(event.common_cents)}</p>}{event.kind === 'refund' && <p className="mt-1 text-xs text-slate-500">Restaurado na reserva: {money(event.restored_cents)} · Dinheiro comum: {money(event.amount_cents-event.restored_cents)}</p>}</div>)}{reserve.events.length === 0 && <p className="text-slate-500">Nenhuma movimentação na reserva.</p>}</div></details>}
    </section>)}
  </div>;
}
