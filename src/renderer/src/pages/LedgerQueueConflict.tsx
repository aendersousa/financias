import { useId, useState, type FormEvent } from 'react';
import { parseBrlCents } from '../../../shared/finance/money';
import type { QueueItem, QuickEntry } from '../../../shared/finance/offlineQueue';
import { activeUserId, sendLocalQueue } from '../lib/offlineStorage';
import { keepServerEntry, recoverQueuedEntry } from '../lib/offlineQueueRecovery';
import { ledgerRpc, type FinancialSpace } from '../lib/ledgerRepository';

interface Summary { kind: string; description: string; occurredOn: string; amountCents: number | null; entries: { name: string; amountCents: number }[] }
interface Comparison { comparison: 'missing' | 'same' | 'different' | 'operation'; server: (Summary & { id: string; status: string; version: number }) | null; original: Summary | null; reservedOperation: string | null }
interface Choices { space: { id: string; name: string }; accounts: { id: string; name: string; ledgerAccountId: string }[]; cards: { id: string; name: string }[]; categories: { id: string; name: string; ledgerAccountId: string }[] }
const input = 'w-full field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
const decimal = (value: number) => `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;
const operationName = (value: string | null) => ({ value_asset: 'avaliação de patrimônio', account_balance_check: 'conferência de saldo', import_statement_read: 'importação de extrato', confirm_card_charges: 'encargos da fatura', create_loan: 'cadastro de empréstimo' } as Record<string, string>)[value ?? ''] ?? 'operação já registrada';

export default function LedgerQueueConflict({ item, money, onResolved }: { item: QueueItem; money: (cents: number) => string; onResolved: () => Promise<void> }) {
  const id = useId();
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'compare' | 'new' | 'move'>('compare');
  const [comparison, setComparison] = useState<Comparison | null>(null), [spaces, setSpaces] = useState<FinancialSpace[]>([]), [destination, setDestination] = useState('');
  const [choices, setChoices] = useState<Choices | null>(null), [error, setError] = useState(''), [comparisonError, setComparisonError] = useState(''), [busy, setBusy] = useState(false);
  async function assertOwner() { if (await activeUserId() !== item.userId) throw new Error('Entre com o mesmo usuário para recuperar este lançamento.'); }
  async function load() {
    setOpen(true); setMode('compare'); setBusy(true); setError(''); setComparisonError(''); setComparison(null); setSpaces([]); setChoices(null); setDestination('');
    try {
      await assertOwner();
      const [result, accessible] = await Promise.allSettled([
        ledgerRpc<Comparison>('queue_conflict_summary', { p_space: item.spaceId, p_client_uuid: item.clientUuid, p_content: item.content }),
        ledgerRpc<FinancialSpace[]>('my_spaces', {})
      ]);
      await assertOwner();
      if (result.status === 'fulfilled') setComparison(result.value);
      else setComparisonError(result.reason instanceof Error ? result.reason.message : 'Não foi possível consultar o espaço original.');
      if (accessible.status === 'fulfilled') setSpaces(accessible.value.filter(space => space.id !== item.spaceId && space.role !== 'viewer'));
      else throw accessible.reason;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível abrir a recuperação.'); }
    finally { setBusy(false); }
  }
  async function chooseSpace(value: string) {
    setDestination(value); setChoices(null); setError(''); if (!value) return; setBusy(true);
    try { await assertOwner(); const result = await ledgerRpc<Choices>('queue_reassignment_options', { p_space: value, p_kind: item.content.kind }); await assertOwner(); setChoices(result); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o destino.'); }
    finally { setBusy(false); }
  }
  async function keep() {
    setBusy(true); setError('');
    try { await keepServerEntry(item); setOpen(false); await onResolved(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível recuperar o lançamento.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      await assertOwner();
      let content: QuickEntry = { ...item.content, amountCents: parseBrlCents(String(form.get('amount'))), description: String(form.get('description')).trim(), occurredOn: String(form.get('date')) };
      const target = mode === 'move' ? destination : item.spaceId;
      if (mode === 'move') {
        if (!choices || choices.space.id !== target || target === item.spaceId) throw new Error('Escolha outro espaço e os cadastros dele.');
        const category = choices.categories.find(row => row.id === form.get('category'));
        if (!category) throw new Error('Escolha a categoria do espaço de destino.');
        // Rebuild references instead of carrying original-space account UUIDs.
        content = { kind: item.content.kind, description: content.description, amountCents: content.amountCents, occurredOn: content.occurredOn, categoryId: category.id, categoryLedgerId: category.ledgerAccountId };
        if (content.kind === 'card_purchase') {
          const card = choices.cards.find(row => row.id === form.get('account'));
          if (!card) throw new Error('Escolha um cartão ativo do destino.'); content.cardId = card.id;
        } else {
          const account = choices.accounts.find(row => row.id === form.get('account'));
          if (!account) throw new Error('Escolha uma conta ativa do destino.'); content.accountId = account.id; content.accountLedgerId = account.ledgerAccountId;
        }
      } else if (!comparison) throw new Error('Consulte o registro do servidor antes de enviar como novo.');
      await recoverQueuedEntry(item, content, target, true);
      setOpen(false); await onResolved();
      // A later network/auth error leaves the replacement safely in the queue.
      if (navigator.onLine) await sendLocalQueue().then(onResolved).catch(() => undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a recuperação.'); }
    finally { setBusy(false); }
  }
  const view = (title: string, value: Summary) => <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><h4 className="font-semibold">{title}</h4><p>{value.description || 'Lançamento rápido'} · {value.occurredOn}</p>{value.amountCents !== null && <strong>{money(value.amountCents)}</strong>}<ul className="space-y-1 text-xs text-slate-500">{value.entries.map((entry, index) => <li key={index}>{entry.name}: {money(entry.amountCents)}</li>)}</ul></div>;
  return <div className="space-y-3">
    <button disabled={busy || !navigator.onLine} onClick={() => void load()} className="text-xs font-semibold text-brand-700 disabled:opacity-50 dark:text-brand-300">Comparar e recuperar</button>
    {open && <section role="dialog" aria-label="Recuperar lançamento não enviado" className="space-y-4 rounded-xl border border-amber-300 p-4">
      <h3 className="font-semibold">Recuperar lançamento não enviado</h3>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {comparisonError && <p className="text-sm text-amber-800 dark:text-amber-300">{comparisonError} Você pode enviar para outro espaço ao qual ainda tem acesso.</p>}
      {busy && <p role="status" className="text-sm text-slate-500">Conferindo os dados…</p>}
      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><h4 className="font-semibold">Neste aparelho</h4><p>{item.content.description || 'Lançamento rápido'} · {item.content.occurredOn}</p><strong>{money(item.content.amountCents)}</strong><p className="mt-1 text-xs text-slate-500">{item.lastReason}</p></div>
      {comparison?.server && <>{view('No servidor', comparison.server)}<p className="text-xs text-slate-500">{comparison.server.status === 'cancelled' ? 'O registro no servidor está cancelado.' : 'O registro no servidor foi recebido.'} Versão {comparison.server.version}.</p></>}
      {comparison?.original && comparison.server && (comparison.original.description !== comparison.server.description || comparison.original.amountCents !== comparison.server.amountCents || comparison.original.occurredOn !== comparison.server.occurredOn) && view('Como foi recebido originalmente', comparison.original)}
      {comparison?.comparison === 'same' && <p className="text-sm">O servidor já recebeu este identificador com o mesmo conteúdo. Você pode manter o registro que está lá.</p>}
      {comparison?.comparison === 'different' && <p className="text-sm">O mesmo identificador já foi recebido com outro conteúdo. Confira os registros antes de escolher.</p>}
      {comparison?.comparison === 'operation' && <p className="text-sm">O identificador pertence a outra {operationName(comparison.reservedOperation)}.</p>}
      {comparison?.comparison === 'missing' && <p className="text-sm">Este identificador ainda não foi recebido pelo servidor. Você pode fechar esta tela, editar o item e reenviar com o mesmo identificador.</p>}
      <div className="flex flex-wrap gap-3 text-xs font-semibold">
        {comparison && comparison.comparison !== 'missing' && <button disabled={busy} onClick={() => void keep()}>Manter o que está no servidor</button>}
        {comparison && <button disabled={busy} onClick={() => { setMode('new'); setChoices(null); }}>Enviar como novo</button>}
        {spaces.length > 0 && <button disabled={busy} onClick={() => { setMode('move'); setChoices(null); setDestination(''); }}>Enviar para outro espaço</button>}
        <button disabled={busy} onClick={() => setOpen(false)}>Fechar recuperação</button>
      </div>
      {mode !== 'compare' && <form onSubmit={event => void submit(event)} className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-amber-800 dark:text-amber-300 sm:col-span-2">Será criado um novo identificador. O registro que já existe no servidor será preservado. Confira se isso representa outro gasto ou receita.</p>
        {mode === 'move' && <><div className="grid gap-1"><label htmlFor={`${id}-space`}>Espaço de destino do lançamento</label><select id={`${id}-space`} required value={destination} disabled={busy} onChange={event => void chooseSpace(event.target.value)} className={input}><option value="">Selecione outro espaço</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></div>{choices && <><div className="grid gap-1"><label htmlFor={`${id}-category`}>Categoria no espaço de destino</label><select id={`${id}-category`} name="category" required className={input}><option value="">Selecione a categoria</option>{choices.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="grid gap-1"><label htmlFor={`${id}-account`}>Conta ou cartão no espaço de destino</label><select id={`${id}-account`} name="account" required className={input}><option value="">Selecione a conta ou cartão</option>{(item.content.kind === 'card_purchase' ? choices.cards : choices.accounts).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div></>}</>}
        <div className="grid gap-1"><label htmlFor={`${id}-amount`}>Valor do novo envio (R$)</label><input id={`${id}-amount`} name="amount" required inputMode="decimal" defaultValue={decimal(item.content.amountCents)} className={input}/></div>
        <div className="grid gap-1"><label htmlFor={`${id}-description`}>Descrição do novo envio</label><input id={`${id}-description`} name="description" maxLength={100} defaultValue={item.content.description} className={input}/></div>
        <div className="grid gap-1"><label htmlFor={`${id}-date`}>Data do novo envio</label><input id={`${id}-date`} name="date" type="date" required defaultValue={item.content.occurredOn} className={input}/></div>
        <label className="flex gap-2 text-xs sm:col-span-2"><input type="checkbox" required/>Conferi e quero enviar este conteúdo com um novo identificador.</label>
        <div className="flex gap-3 sm:col-span-2"><button disabled={busy || mode === 'move' && !choices} className="btn-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirmar novo envio</button><button type="button" disabled={busy} onClick={() => setMode('compare')}>Cancelar novo envio</button></div>
      </form>}
    </section>}
  </div>;
}
