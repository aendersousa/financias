-- Section 7.6.2: an edit may retain an archived account already in that transaction.
begin;
create table private.ledger_edit_accounts (
  backend_pid integer not null,
  transaction_number bigint not null,
  ledger_transaction_id uuid not null,
  ledger_account_id uuid not null,
  primary key(backend_pid,transaction_number,ledger_transaction_id,ledger_account_id)
);
revoke all on private.ledger_edit_accounts from public,anon,authenticated;

-- Patch the insertion guard without changing closed-period or cancelled protections.
do $$ declare definition text; begin
  definition := pg_get_functiondef('private.protect_ledger_mutation()'::regprocedure);
  if position('if tg_op = ''INSERT'' and not posting_account.allows_posting then' in definition) = 0 then raise exception 'Expected archive guard not found'; end if;
  definition := replace(definition,
    'if tg_op = ''INSERT'' and not posting_account.allows_posting then',
    'if tg_op = ''INSERT'' and not posting_account.allows_posting and not exists(select 1 from private.ledger_edit_accounts ctx where ctx.backend_pid = pg_backend_pid() and ctx.transaction_number = txid_current() and ctx.ledger_transaction_id = new.ledger_transaction_id and ctx.ledger_account_id = new.ledger_account_id) then');
  execute definition;
end $$;

-- The context can only be established inside the writer RPC. A client-controlled
-- session flag is deliberately not used as an authorization mechanism.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  if position('delete from finance.ledger_entries where ledger_transaction_id = tx.id;' in definition) = 0 then raise exception 'Expected edit operation not found'; end if;
  definition := replace(definition,'delete from finance.ledger_entries where ledger_transaction_id = tx.id;',
    'insert into private.ledger_edit_accounts(backend_pid,transaction_number,ledger_transaction_id,ledger_account_id) select distinct pg_backend_pid(),txid_current(),tx.id,e.ledger_account_id from finance.ledger_entries e where e.ledger_transaction_id = tx.id;
     delete from finance.ledger_entries where ledger_transaction_id = tx.id;');
  definition := replace(definition,'return tx.id;',
    'delete from private.ledger_edit_accounts where backend_pid = pg_backend_pid() and transaction_number = txid_current() and ledger_transaction_id = tx.id;
     return tx.id;');
  execute definition;
end $$;
commit;
