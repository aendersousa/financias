begin;
create function private.sync_provisions(p_space uuid) returns void language plpgsql set search_path = '' as $$
declare reserve finance.reserves; final_on date; available bigint; complete boolean; begin
  for reserve in select * from finance.reserves where financial_space_id=p_space and reserve_type='provision' and status<>'closed' and archived_at is null order by id for update loop
    select count(*)>0 and bool_and(settlement_status='settled') into complete from finance.commitment_settlements where reserve_id=reserve.id and settlement_status<>'cancelled';
    if coalesce(complete,false) then
      select max(t.occurred_on) into final_on from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id join finance.commitments c on c.id=e.commitment_id where c.reserve_id=reserve.id and t.status='posted';
      -- Scheduled settlements do not release protected money before their date.
      if final_on>private.space_today(p_space) then continue; end if;
      if reserve.status<>'settled' then
        available:=(private.reserve_balance(p_space,reserve.id,final_on)->>'balance_cents')::bigint;
        if available>0 then insert into finance.reserve_contributions(financial_space_id,reserve_id,kind,origin,amount_cents,occurred_on,note) values(p_space,reserve.id,'release','release_on_settlement',available,final_on,'Sobra liberada após quitação da provisão'); end if;
        update finance.reserves set status='settled',terminal_on=final_on,terminal_at=clock_timestamp(),terminal_order=nextval('finance.planning_event_order'),version=version+1,updated_at=now() where id=reserve.id;
        insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'provision_settled','reserve',reserve.id,jsonb_build_object('on',final_on,'released_cents',available));
      end if;
    elsif reserve.status='settled' then
      update finance.reserve_contributions set cancelled_at=now(),updated_at=now() where reserve_id=reserve.id and origin='release_on_settlement' and cancelled_at is null;
      update finance.reserves set status='active',terminal_on=null,terminal_at=null,terminal_order=null,version=version+1,updated_at=now() where id=reserve.id;
      insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id) values(p_space,auth.uid(),'provision_reopened','reserve',reserve.id);
    end if;
  end loop;
end;
$$;
create function private.provision_settlement_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare space uuid; begin
  space:=coalesce(new.financial_space_id,old.financial_space_id);
  perform private.sync_provisions(space);
  return null;
end;
$$;
create constraint trigger provision_entries after insert or update or delete on finance.ledger_entries deferrable initially deferred for each row execute function private.provision_settlement_changed();
create constraint trigger provision_transactions after update on finance.ledger_transactions deferrable initially deferred for each row execute function private.provision_settlement_changed();
revoke all on function private.sync_provisions(uuid),private.provision_settlement_changed() from public,anon,authenticated;
commit;
