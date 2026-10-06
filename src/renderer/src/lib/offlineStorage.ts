import { shiftDays } from '../../../shared/finance/calendar';
import { flushQuickEntries,quickEntryRequest,type QueueItem,type QueueStore } from '../../../shared/finance/offlineQueue';
import { supabase } from './supabaseClient';
import type { LedgerWorkspace } from './ledgerRepository';

export interface WorkspaceCache { userId: string; updatedAt: string; workspace: LedgerWorkspace; projection?: unknown; personalPreferences?: unknown }
const databaseName='financias-offline';
let opening: Promise<IDBDatabase> | undefined;
let flushing: Promise<void> | undefined;
let cacheRevision = 0;
let workspaceCaching: Promise<void> | undefined;
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
const itemKey=(item: QueueItem) => `${item.userId}:${item.spaceId}:${item.clientUuid}`;
async function ownedWrite(userId: string, storeName: 'queue' | 'identity', operation: (store: IDBObjectStore) => void): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve,reject) => {
    const transaction = db.transaction(Array.from(new Set([storeName,'identity'])),'readwrite');
    const owner = transaction.objectStore('identity').get('owner');
    let failure: Error | undefined;
    owner.onsuccess = () => {
      if (owner.result !== userId) { failure = new Error('O usuário deste aparelho mudou. Confirme o acesso antes de gravar dados locais.'); transaction.abort(); return; }
      operation(transaction.objectStore(storeName));
    };
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Gravação local cancelada.'));
  });
}
export const offlineQueue: QueueStore = {
  list:async user => (await read<(QueueItem & { id: string })[]>('queue')).filter(row => row.userId===user),
  put:async item => ownedWrite(item.userId,'queue',store => store.put({ ...item,id:itemKey(item) })),
  remove:async item => ownedWrite(item.userId,'queue',store => store.delete(itemKey(item)))
};
export async function localIdentityCheck(userId: string): Promise<{ changed: boolean; pending: number }> {
  const db=await database();
  return new Promise((resolve,reject) => {
    // Initial access and logout share this transaction boundary. Two documents
    // cannot both claim an empty database or overwrite a newly selected owner.
    const transaction=db.transaction(['identity','queue'],'readwrite');
    const identity=transaction.objectStore('identity'),owner=identity.get('owner');
    let result={ changed:false,pending:0 };
    owner.onsuccess=() => {
      if (!owner.result) { identity.put(userId,'owner'); return; }
      if (owner.result===userId) return;
      result.changed=true;
      const rows=transaction.objectStore('queue').getAll();
      rows.onsuccess=() => { result.pending=(rows.result as QueueItem[]).filter(row=>row.userId===owner.result).length; };
    };
    transaction.oncomplete=() => resolve(result); transaction.onerror=() => reject(transaction.error);
    transaction.onabort=() => reject(transaction.error ?? new Error('A verificação do usuário local foi cancelada.'));
  });
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
  // Invalidate cache writers already waiting on authentication or IndexedDB.
  cacheRevision++;
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
export async function cachedPersonalPreferences<T>(spaceId: string): Promise<T | undefined> {
  const user = await activeUserId(), cache = await read<WorkspaceCache | undefined>('cache', 'active');
  return cache?.userId === user && cache.workspace.space.id === spaceId ? cache.personalPreferences as T | undefined : undefined;
}
async function updateActiveCache(userId: string, operation: (cache: WorkspaceCache | undefined, store: IDBObjectStore) => void, writer?: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['cache', 'identity'], 'readwrite');
    const store = transaction.objectStore('cache');
    const owner = transaction.objectStore('identity').get('owner'), previous = store.get('active');
    const currentWriter = writer ? transaction.objectStore('identity').get('cache-writer') : undefined;
    let loaded = 0, failure: Error | undefined;
    function update() {
      if (++loaded < (currentWriter ? 3 : 2)) return;
      if (owner.result !== userId) { failure = new Error('O usuário deste aparelho mudou. Entre novamente antes de guardar uma cópia.'); transaction.abort(); return; }
      if (currentWriter && currentWriter.result !== writer) return;
      operation(previous.result as WorkspaceCache | undefined, store);
    }
    owner.onsuccess = update; previous.onsuccess = update;
    if (currentWriter) currentWriter.onsuccess = update;
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('A gravação da cópia local foi cancelada.'));
  });
}
export async function cachePersonalPreferences(spaceId: string, value: unknown, expectedUserId: string): Promise<void> {
  const user = await activeUserId();
  if (user !== expectedUserId) throw new Error('O usuário mudou enquanto os modelos eram carregados.');
  // A freshly selected space can render before its initial cache write finishes.
  while (workspaceCaching) await workspaceCaching.catch(() => undefined);
  await updateActiveCache(user, (cache, store) => {
    if (cache?.userId === user && cache.workspace.space.id === spaceId) store.put({ ...cache, personalPreferences: value }, 'active');
  });
}
export function cacheWorkspace(workspace: LedgerWorkspace, expectedUserId: string): Promise<void> {
  const revision = ++cacheRevision;
  const saving = saveWorkspaceCache(workspace, revision, expectedUserId);
  const tracked = saving.finally(() => { if (workspaceCaching === tracked) workspaceCaching = undefined; });
  workspaceCaching = tracked;
  return tracked;
}
async function saveWorkspaceCache(workspace: LedgerWorkspace, revision: number, expectedUserId: string): Promise<void> {
  // Reserve an intent in the shared database before awaiting authentication.
  // Newer documents and logout revoke it atomically, without relying on clocks.
  const writer = crypto.randomUUID();
  await ownedWrite(expectedUserId,'identity',store => store.put(writer,'cache-writer'));
  const userId=await activeUserId(),from=shiftDays(workspace.space.today,-30),until=shiftDays(workspace.space.today,30);
  if (userId !== expectedUserId) throw new Error('O usuário mudou enquanto os dados eram carregados. Atualize o espaço antes de guardar uma cópia.');
  const limited={ ...workspace,transactions:workspace.transactions.filter(row => row.occurred_on>=from).slice(0,200),commitments:workspace.commitments.filter(row => row.effective_due_on>=workspace.space.today && row.effective_due_on<=until),statements:workspace.statements.filter(row => row.status==='open' || row.status==='closed' && row.remaining_cents>0) };
  await updateActiveCache(userId, (previous, store) => {
    if (revision !== cacheRevision) return;
    const same = previous?.userId === userId && previous.workspace.space.id === workspace.space.id;
    // Also removes obsolete personal:<user>:<space> records from older clients.
    store.clear();
    store.put({ userId, updatedAt: new Date().toISOString(), workspace: limited,
      projection: same ? previous.projection : undefined,
      personalPreferences: same ? previous.personalPreferences : undefined } satisfies WorkspaceCache, 'active');
  }, writer);
}
export async function cacheProjection(spaceId: string,projection: unknown,expectedUserId: string): Promise<void> {
  const userId=await activeUserId();
  if (userId !== expectedUserId) throw new Error('O usuário mudou enquanto o cálculo era carregado.');
  await updateActiveCache(userId, (cache, store) => {
    if (cache?.userId === userId && cache.workspace.space.id === spaceId) store.put({ ...cache, projection }, 'active');
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
