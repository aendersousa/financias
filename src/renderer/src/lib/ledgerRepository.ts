import { supabase } from './supabaseClient';

export interface LedgerAccount { id: string; name: string; ledger_account_id: string; balance_cents: number; kind: string }
export interface LedgerCategory { id: string; name: string; kind: 'income' | 'expense'; ledger_account_id: string | null; parent_id: string | null }
export interface LedgerCard { id: string; name: string; granted_cents: number; used_cents: number; free_cents: number }
export interface LedgerCommitment { id: string; title: string; direction: 'inflow' | 'outflow' | null; effective_due_on: string; remaining_cents: number | null; settlement_status: string; kind: string; version: number }
export interface LedgerTransaction { id: string; description: string; occurred_on: string; kind: string; status: string; version: number }
export interface LedgerBudget { id: string; category_id: string; amount_cents: number; consumed_cents: number; predicted_cents: number; remaining_cents: number }
export interface LedgerWorkspace {
  space: { id: string; name: string; today: string }; role: 'owner' | 'editor' | 'viewer';
  accounts: LedgerAccount[]; categories: LedgerCategory[]; cards: LedgerCard[]; commitments: LedgerCommitment[];
  people: { id: string; nickname: string; balance_cents: number }[];
  statements: { id: string; credit_card_id: string; effective_due_on: string; remaining_cents: number; status: string }[];
  transactions: LedgerTransaction[]; budgets: LedgerBudget[];
}

export async function ledgerRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.schema('api').rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function loadLedgerWorkspace(): Promise<LedgerWorkspace> {
  const space = await ledgerRpc<string>('create_personal_space', {});
  return ledgerRpc<LedgerWorkspace>('workspace_snapshot', { p_space: space });
}
