import { supabase } from './supabaseClient';

export interface LedgerAccount { id: string; name: string; ledger_account_id: string; balance_cents: number; kind: string; liquidity: 'cash' | 'benefit' | 'investment' | 'property' }
export interface LedgerCategory { id: string; name: string; kind: 'income' | 'expense'; ledger_account_id: string | null; parent_id: string | null }
export interface LedgerCard { id: string; name: string; granted_cents: number; used_cents: number; free_cents: number }
export interface LedgerCommitment { id: string; title: string; direction: 'inflow' | 'outflow' | null; effective_due_on: string; remaining_cents: number | null; settlement_status: string; kind: string; version: number }
export interface LedgerTransaction { id: string; description: string; occurred_on: string; kind: string; status: string; version: number }
export interface LedgerBudget { id: string; category_id: string; amount_cents: number; consumed_cents: number; predicted_cents: number; remaining_cents: number }
export interface LedgerWorkspace {
  totals: { cash_cents: number; benefit_cents: number; investment_cents: number; property_cents: number; card_used_cents: number; commitment_outflows_cents: number };
  space: { id: string; name: string; today: string; timezone?: string }; role: 'owner' | 'admin' | 'member' | 'viewer';
  accounts: LedgerAccount[]; categories: LedgerCategory[]; cards: LedgerCard[]; commitments: LedgerCommitment[];
  people: { id: string; nickname: string; balance_cents: number }[];
  statements: { id: string; credit_card_id: string; effective_due_on: string; remaining_cents: number; status: string }[];
  transactions: LedgerTransaction[]; budgets: LedgerBudget[];
}

export interface UserSettings { theme: 'system' | 'light' | 'dark'; privacy_mode: boolean; active_financial_space_id: string | null; notification_preferences: Record<string, boolean>; preferences: Record<string, unknown>; version: number }
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
export async function loadLedgerWorkspace(): Promise<LedgerWorkspace> {
  const space = await ledgerRpc<string>('create_personal_space', {});
  return ledgerRpc<LedgerWorkspace>('workspace_snapshot', { p_space: space });
}
