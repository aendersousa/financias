import { validateQuickEntry, type QueueItem, type QuickEntry } from '../../../shared/finance/offlineQueue';
import { activeUserId, offlineQueue, queueChanged } from './offlineStorage';
import { supabase } from './supabaseClient';

const key = (item: QueueItem) => `${item.userId}:${item.spaceId}:${item.clientUuid}`;

/** Replace both keys in one IndexedDB transaction: interruption cannot leave
 * the original and its new UUID available for two separate financial sends.
 * The existing synchronization lock also serializes logout and other tabs. */
async function changeRejectedItem(original: QueueItem, replacement: QueueItem | null): Promise<void> {
  const run = async () => {
    let activeTransaction: IDBTransaction | null = null, sessionChanged = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== original.userId) {
        sessionChanged = true;
        if (activeTransaction) { try { activeTransaction.abort(); } catch { /* A completed transaction cannot be undone by a later session event. */ } }
      }
    });
    try {
    if (await activeUserId() !== original.userId) throw new Error('Entre com o mesmo usuário para recuperar este lançamento.');
    // Initialize the existing database through its owner-aware storage module.
    await offlineQueue.list(original.userId);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('financias-offline', 1);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => reject(new Error('Feche outra aba antiga antes de recuperar este lançamento.'));
    });
    try {
      const session = await supabase.auth.getSession();
      if (sessionChanged || session.data.session?.user.id !== original.userId) throw new Error('A sessão mudou. Entre novamente com o mesmo usuário.');
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['queue', 'identity'], 'readwrite');
        activeTransaction = transaction;
        const queue = transaction.objectStore('queue');
        const ownerRequest = transaction.objectStore('identity').get('owner');
        const itemRequest = queue.get(key(original));
        let failure: Error | null = null, loaded = 0;
        function apply() {
          if (++loaded < 2) return;
          const stored = itemRequest.result as QueueItem | undefined;
          if (sessionChanged || ownerRequest.result !== original.userId || !stored || stored.state !== 'rejected'
            || JSON.stringify(stored.content) !== JSON.stringify(original.content)) {
            failure = new Error('O usuário ou o lançamento da fila mudou. Reabra a recuperação antes de continuar.');
            transaction.abort(); return;
          }
          queue.delete(key(original));
          if (replacement) queue.add({ ...replacement, id: key(replacement) });
        }
        ownerRequest.onsuccess = apply; itemRequest.onsuccess = apply;
        transaction.oncomplete = () => { activeTransaction = null; resolve(); };
        transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar a recuperação no aparelho.'));
        transaction.onabort = () => { activeTransaction = null; reject(failure ?? transaction.error ?? new Error('A recuperação foi cancelada; o lançamento original foi preservado.')); };
      });
    } finally { db.close(); }
    queueChanged();
    } finally { subscription.unsubscribe(); }
  };
  if (navigator.locks) await navigator.locks.request('financias-offline-sync', run);
  else await run();
}

export async function keepServerEntry(original: QueueItem): Promise<void> {
  await changeRejectedItem(original, null);
}

export async function recoverQueuedEntry(original: QueueItem, content: QuickEntry, destination = original.spaceId, asNew = false): Promise<QueueItem> {
  validateQuickEntry(content);
  const replacement: QueueItem = { ...original, spaceId: destination,
    clientUuid: asNew || destination !== original.spaceId ? crypto.randomUUID() : original.clientUuid,
    content, state: 'pending', attempts: 0, lastReason: null, nextAttemptAt: null };
  await changeRejectedItem(original, replacement);
  return replacement;
}
