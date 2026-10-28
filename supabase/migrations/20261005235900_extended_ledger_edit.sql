begin;
-- Preserve the same metadata accepted by the posting service when replacing
-- entries. Closed-statement and period guards continue to run on every row.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  if position('line_number,competence_month,created_by)' in definition) = 0 then raise exception 'Expected edit insertion not found'; end if;
  definition := replace(definition,'line_number,competence_month,created_by)',
    'line_number,competence_month,original_competence_month,card_statement_id,installment_number,installment_count,commitment_id,reserve_id,created_by)');
  definition := replace(definition,'(entry->>''competence_month'')::date,auth.uid());',
    '(entry->>''competence_month'')::date,(entry->>''original_competence_month'')::date,(entry->>''card_statement_id'')::uuid,(entry->>''installment_number'')::smallint,(entry->>''installment_count'')::smallint,(entry->>''commitment_id'')::uuid,(entry->>''reserve_id'')::uuid,auth.uid());');
  definition := replace(definition,'perform private.require_writer(p_space);',
    'perform private.require_writer(p_space);
     if exists(select 1 from finance.ledger_transactions where id = p_transaction and financial_space_id = p_space and kind in (''refund'',''card_payment'',''card_rollover'',''card_credit_carry'',''card_charges'',''card_installment_plan'',''card_correction'',''card_prepayment'')) then
       raise exception ''Operation must be corrected through its dedicated service'' using errcode = ''23514'';
     end if;');
  execute definition;
end $$;
commit;
