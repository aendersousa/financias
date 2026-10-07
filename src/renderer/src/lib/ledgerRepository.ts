import { supabase } from './supabaseClient';

export interface LedgerAccount { id: string; name: string; ledger_account_id: string; balance_cents: number; kind: string; color?: string | null; liquidity: 'cash' | 'benefit' | 'investment' | 'property' }
export interface LedgerCategory { id: string; name: string; kind: 'income' | 'expense'; ledger_account_id: string | null; parent_id: string | null }
export interface LedgerCard { id: string; name: string; granted_cents: number; used_cents: number; free_cents: number }
export interface LedgerCommitment { id: string; title: string; direction: 'inflow' | 'outflow' | null; effective_due_on: string; remaining_cents: number | null; settlement_status: string; kind: string; version: number }
export interface LedgerTransactionEntry { account_name: string; owner_type: string; account_class: string; amount_cents: number }
export interface LedgerTransaction { id: string; description: string; occurred_on: string; kind: string; status: string; version: number; amount_cents?: number; entries?: LedgerTransactionEntry[]; notes?: string | null }
export interface LedgerBudget { id: string; category_id: string; amount_cents: number; consumed_cents: number; predicted_cents: number; remaining_cents: number }
export interface LedgerWorkspace {
  totals: { cash_cents: number; benefit_cents: number; investment_cents: number; property_cents: number; card_used_cents: number; commitment_outflows_cents: number };
  space: { id: string; name: string; today: string; timezone?: string }; role: 'owner' | 'admin' | 'member' | 'viewer';
  accounts: LedgerAccount[]; categories: LedgerCategory[]; cards: LedgerCard[]; commitments: LedgerCommitment[];
  people: { id: string; nickname: string; balance_cents: number; archived_at?: string | null; notes?: string | null }[];
  statements: { id: string; credit_card_id: string; effective_due_on: string; remaining_cents: number; status: string }[];
  transactions: LedgerTransaction[]; budgets: LedgerBudget[];
}

export interface UserSettings { user_id: string; theme: 'system' | 'light' | 'dark'; privacy_mode: boolean; active_financial_space_id: string | null; notification_preferences: Record<string, boolean>; preferences: Record<string, unknown>; version: number }
export function accountDisplayColor(account: { id: string; color?: string | null }, preferences: Record<string, unknown>): string {
  const preferred = preferences[`account_color:${account.id}`];
  return typeof preferred === 'string' && /^#[0-9a-f]{6}$/i.test(preferred) ? preferred : account.color ?? '#0ea5e9';
}

export async function saveAccountDisplayColor(accountId: string, color: string): Promise<void> {
  // Keep appearance in the user's existing preferences. The account RPCs
  // manage financial data and currently do not accept color changes.
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Escolha uma cor válida.');
  const { data: identity } = await supabase.auth.getUser();
  if (!identity.user) throw new Error('Entre novamente para salvar a cor da conta.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const settings = await ledgerRpc<UserSettings>('get_user_settings', {});
    const { data: current } = await supabase.auth.getSession();
    if (settings.user_id !== identity.user.id || current.session?.user.id !== identity.user.id) throw new Error('O usuário mudou durante a atualização.');
    try {
      await ledgerRpc('update_user_settings', { p_version: settings.version, p_changes: { preferences: { [`account_color:${accountId}`]: color } } });
      return;
    } catch (failure) {
      if (attempt === 2 || !(failure instanceof Error) || !/Settings changed/i.test(failure.message)) throw failure;
    }
  }
}
export interface FinancialSpace { id: string; name: string; timezone: string; kind: 'personal' | 'shared'; version: number; role: LedgerWorkspace['role'] }
export interface WorkspaceMetadata {
  tags: { id: string; name: string; version: number; archived_at: string | null }[];
  transaction_tags: { ledger_transaction_id: string; tag_id: string }[];
  recurrences: { id: string; title: string; direction: 'inflow' | 'outflow'; unit: 'week' | 'month' | 'year'; starts_on: string; ends_on: string | null; version: number; is_main_income: boolean; is_subscription: boolean; current_version: { amount_cents: number; category_id: string | null; payment_financial_account_id: string | null; certainty: string; day_of_month: number | null; weekday: number | null; month_of_year: number | null } }[];
  audit: { id: string; actor_id: string | null; action: string; entity_type: string; entity_id: string; created_at: string }[];
}

export async function ledgerRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine) throw new Error('Sem conexão. Esta ação precisa de internet.');
  const { data, error } = await supabase.schema('api').rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function loadLedgerWorkspace(): Promise<LedgerWorkspace & { loadedForUserId: string }> {
  const settings = await ledgerRpc<UserSettings>('get_user_settings', {});
  const spaces = await ledgerRpc<FinancialSpace[]>('my_spaces', {});
  const selected = spaces.find(item => item.id === settings.active_financial_space_id) ?? spaces.find(item => item.kind === 'personal');
  const space = selected?.id ?? await ledgerRpc<string>('create_personal_space', {});
  if (selected && ['owner','admin'].includes(selected.role)) await ledgerRpc('initialize_space_defaults', {p_space:space});
  const workspace = await ledgerRpc<LedgerWorkspace>('workspace_snapshot', { p_space: space });
  return { ...workspace, accounts: workspace.accounts.map(account => ({ ...account, color: accountDisplayColor(account, settings.preferences) })), loadedForUserId: settings.user_id };
}

export async function selectFinancialSpace(spaceId: string): Promise<void> {
  const settings = await ledgerRpc<UserSettings>('get_user_settings', {});
  await ledgerRpc('update_user_settings', { p_version: settings.version, p_changes: { active_financial_space_id: spaceId } });
}
