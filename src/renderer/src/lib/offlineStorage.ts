import { shiftDays } from '../../../shared/finance/calendar';
import { flushQuickEntries,quickEntryRequest,type QueueItem,type QueueStore } from '../../../shared/finance/offlineQueue';
import { supabase } from './supabaseClient';
import type { LedgerWorkspace } from './ledgerRepository';

export interface WorkspaceCache { userId: string; updatedAt: string; workspace: LedgerWorkspace; projection?: unknown }
const databaseName='financias-offline';
let opening: Promise<IDBDatabase> | undefined;
let flushing: Promise<void> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening=new Promise((resolve,reject) => {
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=() => {
      request.result.createObjectStore('queue',{ keyPath:'id' });
      request.result.createObjectStore('cache');
      request.result.createObjectStore('identity');
    };
    request.onsuccess=() => { request.result.onversionchange=() => { request.result.close(); opening=undefined; }; resolve(request.result); };
    request.onerror=() => { opening=undefined; reject(request.error); };
    request.onblocked=() => reject(new Error('Feche outra aba antiga do app para habilitar o armazenamento local.'));
  });
  return opening;
}
async function read<T>(store: string,key?: IDBValidKey): Promise<T> {
  const db=await database();
  return new Promise((resolve,reject) => {
    const request=key===undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
    request.onsuccess=() => resolve(request.result as T); request.onerror=() => reject(request.error);
  });
}
async function write(store: string,operation: (target: IDBObjectStore) => void): Promise<void> {
  const db=await database();
  await new Promise<void>((resolve,reject) => {
    const transaction=db.transaction(store,'readwrite'); operation(transaction.objectStore(store));
    transaction.oncomplete=() => resolve(); transaction.onerror=() => reject(transaction.error); transaction.onabort=() => reject(transaction.error ?? new Error('Gravação local cancelada.'));
  });
}
const itemKey=(item: QueueItem) => `${item.userId}:${item.spaceId}:${item.clientUuid}`;
export const offlineQueue: QueueStore = {
  list:async user => (await read<(QueueItem & { id: string })[]>('queue')).filter(row => row.userId===user),
  put:async item => { await requireLocalOwner(item.userId); await write('queue',store => store.put({ ...item,id:itemKey(item) })); },
  remove:async item => write('queue',store => store.delete(itemKey(item)))
};
export async function localIdentityCheck(userId: string): Promise<{ changed: boolean; pending: number }> {
  const owner=await read<string | undefined>('identity','owner');
  if (!owner) { await write('identity',store => store.put(userId,'owner')); return { changed:false,pending:0 }; }
  return { changed:owner!==userId,pending:owner!==userId ? (await offlineQueue.list(owner)).length : 0 };
}
async function requireLocalOwner(userId: string): Promise<void> {
  const owner=await read<string | undefined>('identity','owner');
  if (owner!==userId) throw new Error('Confirme a troca de usuário antes de acessar os dados deste aparelho.');
}
export async function activeUserId(): Promise<string> {
  const { data }=await supabase.auth.getSession();
  if (!data.session) throw new Error('Entre novamente para enviar seus lançamentos.');
  await requireLocalOwner(data.session.user.id);
  return data.session.user.id;
}
async function locked<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('financias-offline-sync',task) : task();
}
export async function clearLocalData(nextUserId?: string): Promise<void> {
  await locked(async () => {
    const db=await database();
    await new Promise<void>((resolve,reject) => {
      const transaction=db.transaction(['queue','cache','identity'],'readwrite');
      for (const name of ['queue','cache','identity']) transaction.objectStore(name).clear();
      if (nextUserId) transaction.objectStore('identity').put(nextUserId,'owner');
      transaction.oncomplete=() => resolve(); transaction.onerror=() => reject(transaction.error);
    });
  });
}
export async function cachedWorkspace(): Promise<WorkspaceCache | undefined> {
  const user=await activeUserId(),cache=await read<WorkspaceCache | undefined>('cache','active');
  return cache?.userId===user ? cache : undefined;
}
export async function cacheWorkspace(workspace: LedgerWorkspace): Promise<void> {
  const userId=await activeUserId(),from=shiftDays(workspace.space.today,-30),until=shiftDays(workspace.space.today,30);
  const limited={ ...workspace,transactions:workspace.transactions.filter(row => row.occurred_on>=from).slice(0,200),commitments:workspace.commitments.filter(row => row.effective_due_on>=workspace.space.today && row.effective_due_on<=until),statements:workspace.statements.filter(row => row.status==='open' || row.status==='closed' && row.remaining_cents>0) };
  await write('cache',store => {
    const previous=store.get('active');
    previous.onsuccess=() => store.put({ userId,updatedAt:new Date().toISOString(),workspace:limited,projection:previous.result?.workspace.space.id===workspace.space.id ? previous.result.projection : undefined } satisfies WorkspaceCache,'active');
  });
}
export async function cacheProjection(spaceId: string,projection: unknown): Promise<void> {
  const userId=await activeUserId();
  await write('cache',store => {
    const previous=store.get('active');
    previous.onsuccess=() => {
      const cache=previous.result as WorkspaceCache | undefined;
      if (cache?.userId===userId && cache.workspace.space.id===spaceId) store.put({ ...cache,projection },'active');
    };
  });
}
export async function sendLocalQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing=locked(async () => {
    if (!navigator.onLine) return;
    const userId=await activeUserId();
    await flushQuickEntries(offlineQueue,userId,async item => {
      const { data:session }=await supabase.auth.getSession();
      if (session.session?.user.id!==userId) return { status:401,message:'Entre novamente com o mesmo usuário para enviar.' };
      const request=quickEntryRequest(item);
      const { error,status }=await supabase.schema('api').rpc(request.name,request.args);
      return error ? { message:error.message,code:error.code,status } : null;
    });
  }).finally(() => { flushing=undefined; window.dispatchEvent(new Event('financias-queue-changed')); });
  return flushing;
}
export function queueChanged(): void { window.dispatchEvent(new Event('financias-queue-changed')); }
