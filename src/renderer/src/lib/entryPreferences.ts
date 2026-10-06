import { activeUserId, cachedPersonalPreferences, cachePersonalPreferences } from './offlineStorage';
import { ledgerRpc } from './ledgerRepository';

export interface EntryPreset { kind: 'expense' | 'income' | 'card_purchase'; description?: string; amountCents?: number; categoryId?: string; accountId?: string; cardId?: string; occurredOn?: string }
export interface EntryPreferences { models: { id: string; name: string; version: number; payload: EntryPreset }[]; drafts: { id: string; title: string; version: number; payload: EntryPreset }[] }
export async function loadEntryPreferences(space: string): Promise<EntryPreferences> {
  const userId = await activeUserId();
  if (!navigator.onLine) return await cachedPersonalPreferences<EntryPreferences>(space) ?? { models: [], drafts: [] };
  try { const data = await ledgerRpc<EntryPreferences>('entry_preferences', { p_space: space }); if (await activeUserId() !== userId) throw new Error('O usuário mudou enquanto os modelos eram carregados.'); await cachePersonalPreferences(space, data, userId).catch(() => undefined); return data; }
  catch (failure) { if (failure instanceof Error && /fetch|network|conexão/i.test(failure.message)) { const cached = await cachedPersonalPreferences<EntryPreferences>(space); if (cached) return cached; } throw failure; }
}
