begin;
-- ISO4217 minor-unit registry (BRL is excluded from foreign purchases).
-- https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html
create table private.foreign_currencies(code char(3) primary key,minor_unit smallint not null check(minor_unit between 0 and 4));
insert into private.foreign_currencies(code,minor_unit) values ('AED',2),('AFN',2),('ALL',2),('AMD',2),('ANG',2),('AOA',2),('ARS',2),('AUD',2),('AWG',2),('AZN',2),('BAM',2),('BBD',2),('BDT',2),('BGN',2),('BHD',3),('BIF',0),('BMD',2),('BND',2),('BOB',2),('BOV',2),('BRL',2),('BSD',2),('BTN',2),('BWP',2),('BYN',2),('BZD',2),('CAD',2),('CDF',2),('CHE',2),('CHF',2),('CHW',2),('CLF',4),('CLP',0),('CNY',2),('COP',2),('COU',2),('CRC',2),('CUP',2),('CVE',2),('CZK',2),('DJF',0),('DKK',2),('DOP',2),('DZD',2),('EGP',2),('ERN',2),('ETB',2),('EUR',2),('FJD',2),('FKP',2),('GBP',2),('GEL',2),('GHS',2),('GIP',2),('GMD',2),('GNF',0),('GTQ',2),('GYD',2),('HKD',2),('HNL',2),('HTG',2),('HUF',2),('IDR',2),('ILS',2),('INR',2),('IQD',3),('IRR',2),('ISK',0),('JMD',2),('JOD',3),('JPY',0),('KES',2),('KGS',2),('KHR',2),('KMF',0),('KPW',2),('KRW',0),('KWD',3),('KYD',2),('KZT',2),('LAK',2),('LBP',2),('LKR',2),('LRD',2),('LSL',2),('LYD',3),('MAD',2),('MDL',2),('MGA',2),('MKD',2),('MMK',2),('MNT',2),('MOP',2),('MRU',2),('MUR',2),('MVR',2),('MWK',2),('MXN',2),('MXV',2),('MYR',2),('MZN',2),('NAD',2),('NGN',2),('NIO',2),('NOK',2),('NPR',2),('NZD',2),('OMR',3),('PAB',2),('PEN',2),('PGK',2),('PHP',2),('PKR',2),('PLN',2),('PYG',0),('QAR',2),('RON',2),('RSD',2),('RUB',2),('RWF',0),('SAR',2),('SBD',2),('SCR',2),('SDG',2),('SEK',2),('SGD',2),('SHP',2),('SLE',2),('SLL',2),('SOS',2),('SRD',2),('SSP',2),('STN',2),('SVC',2),('SYP',2),('SZL',2),('THB',2),('TJS',2),('TMT',2),('TND',3),('TOP',2),('TRY',2),('TTD',2),('TWD',2),('TZS',2),('UAH',2),('UGX',0),('USD',2),('USN',2),('UYI',0),('UYU',2),('UYW',4),('UZS',2),('VED',2),('VES',2),('VND',0),('VUV',0),('WST',2),('XAF',0),('XCD',2),('XCG',2),('XOF',0),('XPF',0),('YER',2),('ZAR',2),('ZMW',2),('ZWG',2);
revoke all on private.foreign_currencies from public,anon,authenticated;

alter table finance.space_settings add column foreign_iof_percent numeric(8,4) check(foreign_iof_percent between 0 and 100);
create table finance.foreign_currency_purchases (
 id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),ledger_transaction_id uuid not null,
 original_currency char(3) not null references private.foreign_currencies(code),original_minor bigint not null check(original_minor between 1 and 9007199254740991),minor_unit smallint not null check(minor_unit between 0 and 4),
 exchange_rate numeric(24,10) not null check(exchange_rate>0),rate_source text not null check(rate_source in('user','invoice','statement','import')),
 conversion_status text not null check(conversion_status in('estimated','confirmed')),current_brl_cents bigint not null check(current_brl_cents between 1 and 9007199254740991),
 iof_transaction_id uuid,iof_conversion_status text check(iof_conversion_status in('estimated','confirmed')),confirmed_at timestamptz,confirmed_by uuid references auth.users(id),
 confirmation_transaction_id uuid,category_original_parts jsonb not null default '[]' check(jsonb_typeof(category_original_parts)='array'),installment_remainder text not null default 'first' check(installment_remainder in('first','last')),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),
 unique(financial_space_id,id),unique(ledger_transaction_id),foreign key(financial_space_id,ledger_transaction_id) references finance.ledger_transactions(financial_space_id,id),
 foreign key(financial_space_id,iof_transaction_id) references finance.ledger_transactions(financial_space_id,id),foreign key(financial_space_id,confirmation_transaction_id) references finance.ledger_transactions(financial_space_id,id),
 check(original_currency<>'BRL'),check((conversion_status='confirmed')=(confirmed_at is not null) and (conversion_status='confirmed')=(confirmed_by is not null))
);
alter table finance.foreign_currency_purchases enable row level security;
create policy member_read on finance.foreign_currency_purchases for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.foreign_currency_purchases from public,anon,authenticated;
grant select on finance.foreign_currency_purchases to authenticated;
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='finance.operation_requests'::regclass and conname='operation_requests_operation_check';
 alter table finance.operation_requests drop constraint operation_requests_operation_check;
 execute 'alter table finance.operation_requests add constraint operation_requests_operation_check check ('||substring(definition from 7)||' or operation in(''foreign_purchase'',''foreign_confirmation'',''foreign_reestimate''))';
end $$;

create function api.quote_foreign_currency(p_space uuid,p_currency text,p_original_amount numeric,p_rate numeric default null,p_brl_cents bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare digits integer; original_minor numeric; applied_rate numeric; total numeric; suggestion boolean:=false; iof_rate numeric;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 select minor_unit into digits from private.foreign_currencies where code=upper(p_currency) and code<>'BRL';
 if not found or p_original_amount is null or p_original_amount::text in('NaN','Infinity','-Infinity') or p_original_amount<=0 then raise exception 'Valid foreign currency and positive original amount required' using errcode='23514'; end if;
 original_minor:=p_original_amount*power(10::numeric,digits);
 if original_minor<>trunc(original_minor) or original_minor not between 1 and 9007199254740991 then raise exception 'Original amount has invalid currency minor units' using errcode='23514'; end if;
 if p_brl_cents is not null then
  if p_brl_cents not between 1 and 9007199254740991 then raise exception 'Invalid BRL total' using errcode='23514'; end if;
  total:=p_brl_cents; applied_rate:=round(total/100/p_original_amount,10);
  if applied_rate<=0 or applied_rate>=power(10::numeric,14) then raise exception 'Effective exchange rate out of range' using errcode='23514'; end if;
 else
  applied_rate:=p_rate;
  if applied_rate is null then select exchange_rate into applied_rate from finance.foreign_currency_purchases f join finance.ledger_transactions t on t.id=f.ledger_transaction_id and t.status='posted' where f.financial_space_id=p_space and f.original_currency=upper(p_currency) order by f.updated_at desc,f.created_at desc,f.id desc limit 1; suggestion:=true; end if;
  if applied_rate is null then return jsonb_build_object('currency',upper(p_currency),'minor_unit',digits,'original_minor',original_minor::bigint,'original_amount',p_original_amount::text,'rate',null,'total_cents',null,'suggested',true,'iof_suggestion_cents',null); end if;
  if applied_rate::text in('NaN','Infinity','-Infinity') or applied_rate<=0 or applied_rate>=power(10::numeric,14) or applied_rate<>round(applied_rate,10) then raise exception 'Positive decimal exchange rate with at most ten decimals required' using errcode='23514'; end if;
  total:=round(p_original_amount*applied_rate*100);
  if total not between 1 and 9007199254740991 then raise exception 'Converted BRL total out of range' using errcode='23514'; end if;
 end if;
 select foreign_iof_percent into iof_rate from finance.space_settings where financial_space_id=p_space;
 return jsonb_build_object('currency',upper(p_currency),'minor_unit',digits,'original_minor',original_minor::bigint,'original_amount',p_original_amount::text,'rate',applied_rate::text,'total_cents',total,'suggested',suggestion,'iof_percent',iof_rate,'iof_suggestion_cents',case when iof_rate is not null then round(total*iof_rate/100) end);
end;
$$;

create function api.foreign_currency_summary(p_space uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 return jsonb_build_object(
  'currencies',(select jsonb_agg(jsonb_build_object('code',code,'minor_unit',minor_unit) order by code) from private.foreign_currencies where code<>'BRL'),
  'settings_version',(select version from finance.space_settings where financial_space_id=p_space),
  'iof_percent',(select foreign_iof_percent from finance.space_settings where financial_space_id=p_space),
  'purchases',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object(
   'exchange_rate',f.exchange_rate::text,'original_amount',(f.original_minor/power(10::numeric,f.minor_unit))::text,
   'description',t.description,'on',t.occurred_on,'transaction_version',t.version,'transaction_status',t.status,
   'card_id',(select c.id from finance.ledger_entries e join finance.credit_cards c on c.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id=t.id limit 1),
   'account_id',(select a.id from finance.ledger_entries e join finance.financial_accounts a on a.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id=t.id limit 1),
   'installments',coalesce((select max(e.installment_count) from finance.ledger_entries e where e.ledger_transaction_id=t.id),1),
   'iof_cents',coalesce((select sum(e.amount_cents)::bigint from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id=e.ledger_account_id and c.system_role='taxes_fees' where e.ledger_transaction_id=f.iof_transaction_id or exists(select 1 from finance.ledger_transactions correction where correction.id=e.ledger_transaction_id and correction.related_transaction_id=f.iof_transaction_id and correction.relation_type='fx_confirmation_of')),0),
   'can_reestimate',t.status='posted' and f.conversion_status='estimated' and not private.foreign_locked(p_space,t.id),
   'closed_statement',exists(select 1 from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id and s.status='closed' where e.ledger_transaction_id=t.id),
   'events',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'at',a.created_at) order by a.created_at,a.id) from finance.audit_logs a where a.financial_space_id=p_space and a.entity_id=f.id and a.entity_type='foreign_currency_purchase'),'[]')
  ) order by t.occurred_on desc,f.created_at desc,f.id) from finance.foreign_currency_purchases f join finance.ledger_transactions t on t.id=f.ledger_transaction_id where f.financial_space_id=p_space),'[]'));
end;
$$;

create function private.foreign_iof(p_space uuid,p_original uuid,p_on date,p_amount bigint,p_description text) returns uuid
language plpgsql set search_path='' as $$
declare original finance.ledger_transactions; financial uuid; statement uuid; category uuid; card uuid; competence date; related uuid; entries jsonb;
begin
 if p_amount=0 then return null; end if;
 if p_amount is null or abs(p_amount::numeric)>9007199254740991 then raise exception 'Invalid foreign IOF amount' using errcode='23514'; end if;
 select * into original from finance.ledger_transactions where financial_space_id=p_space and id=p_original and status='posted';
 if not found then raise exception 'Original purchase unavailable' using errcode='23514'; end if;
 select e.ledger_account_id,e.card_statement_id,c.id into financial,statement,card from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.owner_type in('financial_account','credit_card') left join finance.credit_cards c on c.ledger_account_id=a.id where e.ledger_transaction_id=original.id order by e.line_number limit 1;
 if statement is not null and exists(select 1 from finance.card_statements s where s.id=statement and (s.effective_due_on<p_on or (select coalesce(-sum(e.amount_cents),0) from finance.posted_ledger_entries e where e.card_statement_id=s.id and e.occurred_on<=p_on)<=0)) then statement:=private.foreign_destination(p_space,card,p_on); end if;
 competence:=private.next_open_competence(p_space,original.competence_month); category:=private.ensure_system_category(p_space,'taxes_fees');
 entries:=jsonb_build_array(jsonb_build_object('ledger_account_id',category,'amount_cents',p_amount,'competence_month',competence,'original_competence_month',case when competence<>original.competence_month then original.competence_month end),jsonb_build_object('ledger_account_id',financial,'amount_cents',-p_amount,'card_statement_id',statement));
 return private.post_transaction_internal(p_space,jsonb_build_object('kind',case when statement is null then 'expense' else 'card_correction' end,'occurred_on',p_on,'competence_month',competence,'description',p_description,'related_transaction_id',original.id,'relation_type','fx_confirmation_of','entries',entries),auth.uid());
end;
$$;

create function api.record_foreign_purchase(p_space uuid,p_payload jsonb,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; quote jsonb; transaction_id uuid; category uuid; financial uuid; amount bigint; iof bigint; status text; on_day date; entries jsonb; iof_id uuid; count_parts integer; remainder text:='first'; original_parts jsonb:='[]'; item jsonb; minor numeric; weights bigint[]; portions bigint[]; idx integer; transaction_version integer; header finance.ledger_transactions;
begin
 perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.replay_nonledger_operation(p_space,p_client_uuid,'foreign_purchase',p_payload); if result is not null then return result; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) key where key not in('currency','original_amount','rate','brl_cents','on','category_id','category_parts','card_id','account_id','installments','description','confirmed','iof_cents','iof_on')) then raise exception 'Invalid foreign purchase fields' using errcode='23514'; end if;
 if p_payload->>'rate' is null and p_payload->>'brl_cents' is null then raise exception 'Inform the exchange rate or the BRL total' using errcode='23514'; end if;
 on_day:=(p_payload->>'on')::date; status:=case when coalesce((p_payload->>'confirmed')::boolean,false) then 'confirmed' else 'estimated' end;
 if on_day is null or not isfinite(on_day) then raise exception 'Invalid foreign purchase date' using errcode='23514'; end if;
 quote:=api.quote_foreign_currency(p_space,p_payload->>'currency',(p_payload->>'original_amount')::numeric,(p_payload->>'rate')::numeric,(p_payload->>'brl_cents')::bigint); amount:=(quote->>'total_cents')::bigint; iof:=coalesce((p_payload->>'iof_cents')::bigint,0);
 if iof<0 then raise exception 'Foreign IOF cannot be negative' using errcode='23514'; end if;
 if num_nonnulls(p_payload->>'card_id',p_payload->>'account_id')<>1 then raise exception 'Choose exactly one account or card' using errcode='23514'; end if;
 count_parts:=coalesce((p_payload->>'installments')::integer,1);
 if count_parts not between 1 and 600 or p_payload->>'account_id' is not null and count_parts<>1 then raise exception 'Cash purchases require one installment' using errcode='23514'; end if;
 if p_payload ? 'category_parts' then
  if jsonb_typeof(p_payload->'category_parts') is distinct from 'array' or jsonb_array_length(p_payload->'category_parts') not between 1 and 100 or p_payload->>'category_id' is not null then raise exception 'Choose one category or foreign category parts' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(p_payload->'category_parts') loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) key where key not in('category_id','original_amount')) then raise exception 'Invalid foreign category part' using errcode='23514'; end if;
   minor:=(item->>'original_amount')::numeric*power(10::numeric,(quote->>'minor_unit')::integer);
   if minor is null or minor::text in('NaN','Infinity','-Infinity') or minor not between 1 and 9007199254740991 or minor<>trunc(minor) then raise exception 'Original amount has invalid currency minor units' using errcode='23514'; end if;
   select ledger_account_id into category from finance.categories where financial_space_id=p_space and id=(item->>'category_id')::uuid and kind='expense' and ledger_account_id is not null and archived_at is null and deleted_at is null;
   if category is null or exists(select 1 from jsonb_array_elements(original_parts) part where part->>'ledger_account_id'=category::text) then raise exception 'Distinct active expense categories required' using errcode='23514'; end if;
   original_parts:=original_parts||jsonb_build_array(jsonb_build_object('ledger_account_id',category,'original_minor',minor::bigint));
  end loop;
  if (select sum((part->>'original_minor')::numeric) from jsonb_array_elements(original_parts) part)<>(quote->>'original_minor')::numeric then raise exception 'Foreign category parts must equal the original amount' using errcode='23514'; end if;
  select id into category from finance.categories where ledger_account_id=(original_parts->0->>'ledger_account_id')::uuid;
 else category:=(p_payload->>'category_id')::uuid;
 end if;
 select ledger_account_id into financial from finance.categories where financial_space_id=p_space and id=category and kind='expense' and ledger_account_id is not null and archived_at is null and deleted_at is null;
 if financial is null then raise exception 'Active expense category required' using errcode='23514'; end if;
 if original_parts='[]'::jsonb then original_parts:=jsonb_build_array(jsonb_build_object('ledger_account_id',financial,'original_minor',(quote->>'original_minor')::bigint)); end if;
 if p_payload->>'card_id' is not null then
  select installment_remainder into remainder from finance.credit_cards where financial_space_id=p_space and id=(p_payload->>'card_id')::uuid;
  transaction_id:=api.record_card_purchase(p_space,(p_payload->>'card_id')::uuid,category,amount,count_parts,on_day,p_payload->>'description');
 else
  category:=financial;
  select f.ledger_account_id into financial from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.financial_space_id=p_space and f.id=(p_payload->>'account_id')::uuid and f.archived_at is null and f.deleted_at is null and a.liquidity='cash';
  if financial is null then raise exception 'Active cash account required' using errcode='23514'; end if;
  entries:=jsonb_build_array(jsonb_build_object('ledger_account_id',category,'amount_cents',amount),jsonb_build_object('ledger_account_id',financial,'amount_cents',-amount));
  transaction_id:=private.post_transaction_internal(p_space,jsonb_build_object('kind','expense','occurred_on',on_day,'competence_month',date_trunc('month',on_day)::date,'description',p_payload->>'description','entries',entries),auth.uid());
 end if;
 if jsonb_array_length(original_parts)>1 then
  select array_agg((parts.part->>'original_minor')::bigint order by parts.ord) into weights from jsonb_array_elements(original_parts) with ordinality parts(part,ord);
  portions:=private.divide_cents(amount,weights); entries:='[]';
  for idx in 1..jsonb_array_length(original_parts) loop
   if portions[idx]<>0 then entries:=entries||jsonb_build_array(jsonb_build_object('ledger_account_id',original_parts->(idx-1)->>'ledger_account_id','amount_cents',portions[idx])); end if;
  end loop;
  entries:=entries||(select jsonb_agg(to_jsonb(e) order by line_number) from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.owner_type in('financial_account','credit_card') where e.ledger_transaction_id=transaction_id);
  select * into header from finance.ledger_transactions where id=transaction_id;
  perform api.edit_transaction(p_space,transaction_id,header.version,to_jsonb(header)||jsonb_build_object('entries',entries),'Rateio pelo valor original em moeda estrangeira');
 end if;
 if iof>0 then iof_id:=private.foreign_iof(p_space,transaction_id,coalesce((p_payload->>'iof_on')::date,on_day),iof,'IOF: '||coalesce(p_payload->>'description','compra internacional')); end if;
 insert into finance.foreign_currency_purchases(financial_space_id,ledger_transaction_id,original_currency,original_minor,minor_unit,exchange_rate,rate_source,conversion_status,current_brl_cents,iof_transaction_id,iof_conversion_status,confirmed_at,confirmed_by,created_by,category_original_parts,installment_remainder) values(p_space,transaction_id,quote->>'currency',(quote->>'original_minor')::bigint,(quote->>'minor_unit')::smallint,(quote->>'rate')::numeric,'user',status,amount,iof_id,case when iof_id is not null then status end,case when status='confirmed' then now() end,case when status='confirmed' then auth.uid() end,auth.uid(),original_parts,remainder) returning id into result;
 if p_client_uuid is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by) values(p_space,p_client_uuid,'foreign_purchase',p_payload,result,auth.uid()); end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'foreign_purchase_created','foreign_currency_purchase',result,p_payload||jsonb_build_object('transaction_id',transaction_id)); return result;
end;
$$;

-- Estimated amounts are already ledger facts. Confirmation only changes BRL;
-- the original foreign amount never participates in balances or forecasts.
create function private.foreign_destination(p_space uuid,p_card uuid,p_on date) returns uuid language plpgsql set search_path='' as $$
declare result uuid; offset_index integer:=0;
begin
 loop
  result:=private.ensure_card_statement(p_space,p_card,p_on,offset_index);
  if exists(select 1 from finance.card_statements where id=result and status<>'closed') then return result; end if;
  offset_index:=offset_index+1;
  if offset_index>600 then raise exception 'Open statement destination unavailable' using errcode='23514'; end if;
 end loop;
end;
$$;
create function private.foreign_locked(p_space uuid,p_transaction uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from finance.ledger_transactions t where t.financial_space_id=p_space and t.id=p_transaction and (
  exists(select 1 from finance.period_closings c where c.financial_space_id=p_space and c.reopened_at is null and c.month in(date_trunc('month',t.occurred_on)::date,t.competence_month)) or
  exists(select 1 from finance.ledger_entries e left join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=t.id and (s.status='closed' or exists(select 1 from finance.period_closings c where c.financial_space_id=p_space and c.reopened_at is null and c.month=coalesce(e.competence_month,t.competence_month))))));
$$;
create function private.adjust_foreign_purchase(p_space uuid,p_original uuid,p_total bigint,p_on date,p_force_correction boolean default false) returns uuid language plpgsql set search_path='' as $$
declare original finance.ledger_transactions; metadata finance.foreign_currency_purchases; row record; part jsonb; categories jsonb; weights bigint[]; financials uuid[]; financial_weights bigint[]; amounts bigint[]; financial_amounts bigint[]; order_indices integer[]; idx integer; amount bigint; previous bigint; entries jsonb:='[]'; month date; source_month date; corrected boolean; card uuid; statement uuid; original_financial bigint; output uuid;
begin
 select * into original from finance.ledger_transactions where financial_space_id=p_space and id=p_original and status='posted' for update;
 if not found then raise exception 'Original purchase unavailable' using errcode='23514'; end if;
 if p_total is null or p_total not between 0 and 9007199254740991 or p_on is null or not isfinite(p_on) or p_on<original.occurred_on then raise exception 'Invalid confirmation total or date' using errcode='23514'; end if;
 select * into metadata from finance.foreign_currency_purchases where ledger_transaction_id=p_original;
 categories:=metadata.category_original_parts;
 if categories is null or categories='[]'::jsonb then
  select jsonb_agg(jsonb_build_object('ledger_account_id',e.ledger_account_id,'original_minor',e.amount_cents) order by e.line_number) into categories from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense' where e.ledger_transaction_id=p_original;
 end if;
 select array_agg((parts.part->>'original_minor')::bigint order by parts.ord) into weights from jsonb_array_elements(categories) with ordinality parts(part,ord);
 select array_agg(e.id order by e.line_number),array_agg(-e.amount_cents order by e.line_number),sum(-e.amount_cents)::bigint into financials,financial_weights,original_financial from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.owner_type in('financial_account','credit_card') where e.ledger_transaction_id=p_original;
 if weights is null or financials is null or original_financial<=0 then raise exception 'Original foreign purchase entries unavailable' using errcode='23514'; end if;
 if p_total=original_financial then return null; end if;
 corrected:=p_force_correction or private.foreign_locked(p_space,p_original);
 if p_total=0 and not corrected then raise exception 'Zero conversion requires cancellation' using errcode='23514'; end if;
 amounts:=private.divide_cents(p_total,weights);
 if array_length(financials,1)>1 then
  if p_total<array_length(financials,1) then raise exception 'Converted total is smaller than installment count' using errcode='23514'; end if;
  select array_agg(i order by case when metadata.installment_remainder='last' then -i else i end) into order_indices from generate_series(1,array_length(financials,1)) i;
  financial_amounts:=private.divide_cents(p_total,array_fill(1::bigint,array[array_length(financials,1)]),order_indices);
 else financial_amounts:=array[p_total]; end if;
 for idx in 1..jsonb_array_length(categories) loop
  part:=categories->(idx-1);
  select coalesce(sum(e.amount_cents),0)::bigint,min(coalesce(e.competence_month,original.competence_month)) into previous,source_month from finance.ledger_entries e where e.ledger_transaction_id=p_original and e.ledger_account_id=(part->>'ledger_account_id')::uuid;
  source_month:=coalesce(source_month,original.competence_month); month:=case when corrected then private.next_open_competence(p_space,source_month) else source_month end;
  amount:=amounts[idx]-case when corrected then previous else 0 end;
  if amount<>0 then entries:=entries||jsonb_build_array(jsonb_build_object('ledger_account_id',part->>'ledger_account_id','amount_cents',amount,'competence_month',month,'original_competence_month',case when month<>source_month then source_month end)); end if;
 end loop;
 for idx in 1..array_length(financials,1) loop
  select e.*,c.id as card_id into row from finance.ledger_entries e left join finance.credit_cards c on c.ledger_account_id=e.ledger_account_id where e.id=financials[idx];
  amount:=-financial_amounts[idx]-case when corrected then row.amount_cents else 0 end;
  statement:=row.card_statement_id; card:=row.card_id;
  if corrected and statement is not null and exists(select 1 from finance.card_statements s where s.id=statement and (s.effective_due_on<p_on or (select coalesce(-sum(e.amount_cents),0) from finance.posted_ledger_entries e where e.card_statement_id=s.id and e.occurred_on<=p_on)<=0)) then statement:=private.foreign_destination(p_space,card,p_on); end if;
  if amount<>0 then
   if corrected then entries:=entries||jsonb_build_array(jsonb_build_object('ledger_account_id',row.ledger_account_id,'amount_cents',amount,'card_statement_id',statement));
   else entries:=entries||jsonb_build_array(to_jsonb(row)-'card_id'||jsonb_build_object('amount_cents',amount)); end if;
  end if;
 end loop;
 if corrected then
  month:=private.next_open_competence(p_space,original.competence_month);
  output:=private.post_transaction_internal(p_space,jsonb_build_object('kind',case when card is null then 'expense' else 'card_correction' end,'occurred_on',p_on,'competence_month',month,'description',left('Confirmação cambial: '||original.description,200),'related_transaction_id',original.id,'relation_type','fx_confirmation_of','entries',entries),auth.uid());
 else
  output:=api.edit_transaction(p_space,p_original,original.version,to_jsonb(original)||jsonb_build_object('entries',entries,'acknowledge_reconciliation_change',true),'Confirmação do valor em reais da compra internacional');
 end if;
 return output;
end;
$$;
create function api.confirm_foreign_purchase(p_space uuid,p_purchase uuid,p_version integer,p_confirmed_cents bigint,p_on date,p_iof_cents bigint default 0,p_source text default 'invoice',p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.foreign_currency_purchases; request jsonb; result uuid; adjustment uuid; iof_adjustment uuid; iof_id uuid; old_iof bigint; quote jsonb;
begin
 perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 request:=jsonb_build_object('purchase',p_purchase,'version',p_version,'confirmed_cents',p_confirmed_cents,'on',p_on,'iof_cents',p_iof_cents,'source',p_source);
 result:=private.replay_nonledger_operation(p_space,p_client_uuid,'foreign_confirmation',request); if result is not null then return result; end if;
 select * into previous from finance.foreign_currency_purchases where financial_space_id=p_space and id=p_purchase for update;
 if not found then raise exception 'Foreign purchase not found' using errcode='P0002'; end if;
 if previous.version is distinct from p_version then raise exception 'Foreign purchase changed; reload before editing' using errcode='40001'; end if;
 if previous.conversion_status='confirmed' then raise exception 'Confirmed conversion cannot be recalculated' using errcode='23514'; end if;
 if p_source is null or p_source not in('user','invoice','statement','import') or p_iof_cents is null or p_iof_cents not between 0 and 9007199254740991 then raise exception 'Invalid conversion source or IOF' using errcode='23514'; end if;
 quote:=api.quote_foreign_currency(p_space,previous.original_currency,previous.original_minor/power(10::numeric,previous.minor_unit),p_brl_cents=>p_confirmed_cents);
 adjustment:=private.adjust_foreign_purchase(p_space,previous.ledger_transaction_id,p_confirmed_cents,p_on);
 iof_id:=previous.iof_transaction_id;
 if iof_id is null then
  if p_iof_cents>0 then iof_id:=private.foreign_iof(p_space,previous.ledger_transaction_id,p_on,p_iof_cents,left('IOF confirmado: '||(select description from finance.ledger_transactions where id=previous.ledger_transaction_id),200)); end if;
 else
  select sum(e.amount_cents)::bigint into old_iof from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense' where e.ledger_transaction_id=iof_id;
  if old_iof is null then raise exception 'Original IOF unavailable; correct its transaction first' using errcode='23514'; end if;
  iof_adjustment:=private.adjust_foreign_purchase(p_space,iof_id,p_iof_cents,p_on,true);
 end if;
 update finance.foreign_currency_purchases set conversion_status='confirmed',current_brl_cents=p_confirmed_cents,exchange_rate=(quote->>'rate')::numeric,rate_source=p_source,confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),confirmation_transaction_id=case when adjustment<>previous.ledger_transaction_id then adjustment end,iof_transaction_id=iof_id,iof_conversion_status=case when iof_id is not null then 'confirmed' end,version=version+1,updated_at=clock_timestamp() where id=p_purchase;
 if p_client_uuid is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by) values(p_space,p_client_uuid,'foreign_confirmation',request,p_purchase,auth.uid()); end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'foreign_purchase_confirmed','foreign_currency_purchase',p_purchase,to_jsonb(previous),request||jsonb_build_object('adjustment_transaction_id',adjustment,'iof_transaction_id',iof_id,'iof_adjustment_transaction_id',iof_adjustment));
 return p_purchase;
end;
$$;
create function api.reestimate_foreign_purchase(p_space uuid,p_purchase uuid,p_version integer,p_rate numeric,p_on date,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.foreign_currency_purchases; quote jsonb; request jsonb; result uuid;
begin
 perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 request:=jsonb_build_object('purchase',p_purchase,'version',p_version,'rate',p_rate,'on',p_on);
 result:=private.replay_nonledger_operation(p_space,p_client_uuid,'foreign_reestimate',request); if result is not null then return result; end if;
 select * into previous from finance.foreign_currency_purchases where financial_space_id=p_space and id=p_purchase for update;
 if not found then raise exception 'Foreign purchase not found' using errcode='P0002'; end if;
 if previous.version is distinct from p_version then raise exception 'Foreign purchase changed; reload before editing' using errcode='40001'; end if;
 if previous.conversion_status='confirmed' then raise exception 'Confirmed conversion cannot be recalculated' using errcode='23514'; end if;
 if private.foreign_locked(p_space,previous.ledger_transaction_id) then raise exception 'Closed foreign purchase requires confirmation instead of reestimation' using errcode='23514'; end if;
 if p_rate is null then raise exception 'Explicit estimated exchange rate required' using errcode='23514'; end if;
 quote:=api.quote_foreign_currency(p_space,previous.original_currency,previous.original_minor/power(10::numeric,previous.minor_unit),p_rate);
 perform private.adjust_foreign_purchase(p_space,previous.ledger_transaction_id,(quote->>'total_cents')::bigint,p_on);
 update finance.foreign_currency_purchases set current_brl_cents=(quote->>'total_cents')::bigint,exchange_rate=p_rate,rate_source='user',version=version+1,updated_at=clock_timestamp() where id=p_purchase;
 if p_client_uuid is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by) values(p_space,p_client_uuid,'foreign_reestimate',request,p_purchase,auth.uid()); end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'foreign_purchase_reestimated','foreign_currency_purchase',p_purchase,to_jsonb(previous),request||quote); return p_purchase;
end;
$$;
create function api.set_foreign_iof_percent(p_space uuid,p_version integer,p_percent numeric default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous finance.space_settings; result jsonb;
begin
 perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 select * into previous from finance.space_settings where financial_space_id=p_space for update;
 if previous.version is distinct from p_version then raise exception 'Planning settings changed; reload before editing' using errcode='40001'; end if;
 if p_percent is not null and (p_percent::text in('NaN','Infinity','-Infinity') or p_percent not between 0 and 100 or p_percent<>round(p_percent,4)) then raise exception 'IOF suggestion must be between zero and one hundred with four decimals' using errcode='23514'; end if;
 update finance.space_settings set foreign_iof_percent=p_percent,version=version+1 where financial_space_id=p_space returning to_jsonb(space_settings) into result;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'foreign_iof_suggestion_changed','financial_space',p_space,to_jsonb(previous),result); return result;
end;
$$;
-- This writer only enables the linked FX correction, preserving all other
-- module availability checks and the generic client's dedicated-operation guard.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('private.reject_unimplemented_operations()'::regprocedure);
 needle:='if new.kind not in';
 if position(needle in definition)=0 then raise exception 'FX ledger availability guard not found'; end if;
 execute replace(definition,needle,'if new.kind=''card_correction'' and new.relation_type=''fx_confirmation_of'' then return new; end if; '||needle);
 -- Add N21 inside the current collector, including extensions from340.
 definition:=pg_get_functiondef('private.collect_notifications(uuid,uuid,boolean,timestamptz)'::regprocedure);
 needle:='select ''card_charges'',''cards'',''card_statement''';
 if position(needle in definition)=0 then raise exception 'FX notification collection point not found'; end if;
 execute replace(definition,needle,'select ''foreign_conversion_pending'',''cards'',''card_statement'',s.id,''state'',''attention'',''Confirme as compras internacionais de ''||c.name,
  jsonb_build_object(''title'',c.name,''reference_month'',s.reference_month,''destination'',''foreign_currency'',''purchases'',jsonb_agg(distinct jsonb_build_object(''id'',f.id,''description'',t.description))),true,true
  from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id join finance.ledger_entries e on e.card_statement_id=s.id join finance.foreign_currency_purchases f on f.ledger_transaction_id=e.ledger_transaction_id join finance.ledger_transactions t on t.id=f.ledger_transaction_id and t.status=''posted''
  where s.financial_space_id=p_space and s.status=''closed'' and c.status<>''archived'' and (f.conversion_status=''estimated'' or f.iof_conversion_status=''estimated'') group by s.id,c.name
 union all
 '||needle);
end $$;
create constraint trigger notify_foreign_purchase after insert or update on finance.foreign_currency_purchases deferrable initially deferred for each row execute function private.notifications_after_event();
revoke all on function private.foreign_iof(uuid,uuid,date,bigint,text),private.foreign_destination(uuid,uuid,date),private.foreign_locked(uuid,uuid),private.adjust_foreign_purchase(uuid,uuid,bigint,date,boolean) from public,anon,authenticated;
revoke all on function api.quote_foreign_currency(uuid,text,numeric,numeric,bigint),api.foreign_currency_summary(uuid),api.record_foreign_purchase(uuid,jsonb,uuid),api.confirm_foreign_purchase(uuid,uuid,integer,bigint,date,bigint,text,uuid),api.reestimate_foreign_purchase(uuid,uuid,integer,numeric,date,uuid),api.set_foreign_iof_percent(uuid,integer,numeric) from public,anon,authenticated;
grant execute on function api.quote_foreign_currency(uuid,text,numeric,numeric,bigint),api.foreign_currency_summary(uuid),api.record_foreign_purchase(uuid,jsonb,uuid),api.confirm_foreign_purchase(uuid,uuid,integer,bigint,date,bigint,text,uuid),api.reestimate_foreign_purchase(uuid,uuid,integer,numeric,date,uuid),api.set_foreign_iof_percent(uuid,integer,numeric) to authenticated;
notify pgrst,'reload schema';
commit;




