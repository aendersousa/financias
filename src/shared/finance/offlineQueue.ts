import { assertCents } from './money';
import { shiftDays } from './calendar';

export interface QuickEntry {
  kind: 'expense' | 'income' | 'card_purchase';
  amountCents: number;
  description: string;
  occurredOn: string;
  categoryId: string;
  categoryLedgerId: string;
  accountId?: string;
  accountLedgerId?: string;
  cardId?: string;
}
export interface QueueItem {
  clientUuid: string;
  userId: string;
  spaceId: string;
  createdAt: string;
  state: 'pending' | 'sending' | 'rejected';
  attempts: number;
  nextAttemptAt: string | null;
  lastReason: string | null;
  content: QuickEntry;
}
export interface QueueStore {
  list(userId: string): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  remove(item: QueueItem): Promise<void>;
}
export interface SendFailure { message: string; code?: string; status?: number }
export interface QueueRun { sent: number; rejected: number; waitingForLogin: boolean }

export function validateQuickEntry(content: QuickEntry): void {
  if (!['expense','income','card_purchase'].includes(content.kind) || assertCents(content.amountCents)<1 || !content.categoryId || !content.categoryLedgerId || content.description.length>100) throw new Error('Valor, categoria ou descrição inválidos.');
  shiftDays(content.occurredOn,0);
  if (content.kind==='card_purchase' ? !content.cardId : !content.accountId || !content.accountLedgerId) throw new Error('Escolha uma conta ou cartão ativo.');
}
export function quickEntryRequest(item: QueueItem): { name: string; args: Record<string,unknown> } {
  const value = item.content;
  validateQuickEntry(value);
  if (value.kind==='card_purchase') return { name:'record_card_purchase',args:{ p_space:item.spaceId,p_card:value.cardId,p_category:value.categoryId,p_total_cents:value.amountCents,p_installments:1,p_on:value.occurredOn,p_description:value.description || 'Compra rápida',p_client_uuid:item.clientUuid } };
  const sign = value.kind==='income' ? -1 : 1;
  return { name:'post_transaction',args:{ p_space:item.spaceId,p_payload:{ kind:value.kind,occurred_on:value.occurredOn,competence_month:`${value.occurredOn.slice(0,7)}-01`,description:value.description || (sign===1 ? 'Despesa rápida' : 'Receita rápida'),client_uuid:item.clientUuid,entries:[{ ledger_account_id:value.categoryLedgerId,amount_cents:sign*value.amountCents },{ ledger_account_id:value.accountLedgerId,amount_cents:-sign*value.amountCents }] } } };
}
export function retryDelay(attempts: number): number {
  return Math.min(300_000,5_000*2**Math.min(Math.max(attempts-1,0),6));
}
export function failureKind(failure: SendFailure): 'login' | 'temporary' | 'rejected' {
  if (failure.status===401 || ['PGRST301','PGRST302','PGRST303'].includes(failure.code ?? '')) return 'login';
  if (!failure.code || failure.status!==undefined && failure.status>=500 || failure.code.startsWith('08') || ['57014','53300','57P01'].includes(failure.code)) return 'temporary';
  return 'rejected';
}
/** Stable requests survive a lost response. One refusal never blocks later items.
 * Caller serializes runs across tabs and verifies the active user before sending. */
export async function flushQuickEntries(store: QueueStore,userId: string,send: (item: QueueItem) => Promise<SendFailure | null>,now = new Date()): Promise<QueueRun> {
  const result: QueueRun = { sent:0,rejected:0,waitingForLogin:false };
  const rows = (await store.list(userId)).filter(row => row.userId===userId && row.state!=='rejected').sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.clientUuid.localeCompare(b.clientUuid));
  for (const original of rows) {
    if (original.nextAttemptAt && original.nextAttemptAt>now.toISOString()) continue;
    const item: QueueItem = { ...original,state:'sending',attempts:original.attempts+1 };
    await store.put(item);
    let failure: SendFailure | null;
    try { failure = await send(item); }
    catch (error) { failure = { message:error instanceof Error ? error.message : 'Falha de conexão.' }; }
    if (!failure) { await store.remove(item); result.sent++; continue; }
    const kind = failureKind(failure);
    await store.put({ ...item,state:kind==='rejected' ? 'rejected' : 'pending',lastReason:failure.message,nextAttemptAt:kind==='temporary' ? new Date(now.getTime()+retryDelay(item.attempts)).toISOString() : null });
    if (kind==='login') { result.waitingForLogin=true; break; }
    if (kind==='rejected') result.rejected++;
  }
  return result;
}
