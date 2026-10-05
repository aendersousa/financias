begin;
-- Deferred triggers run after the writer RPC has returned. Their owner must
-- perform the invariant check and row locks, independently of the caller's RLS.
-- All functions keep search_path = '' and cannot be called directly by clients.
alter function private.check_balanced_transaction() security definer;
alter function private.category_leaf_has_account() security definer;
alter function private.space_has_owner() security definer;
alter function private.card_holder_same_card() security definer;
alter function private.refund_within_original() security definer;
alter function private.commitment_settlement_within_due() security definer;
revoke all on function private.check_balanced_transaction(),private.category_leaf_has_account(),private.space_has_owner(),private.card_holder_same_card(),private.refund_within_original(),private.commitment_settlement_within_due() from public,anon,authenticated;
commit;
