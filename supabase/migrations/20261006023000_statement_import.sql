begin;
create extension if not exists pgcrypto with schema extensions;

-- Original bytes are encrypted at rest. The secret and operation context are
-- private tables, never client-set GUCs. Storage buckets/signed links are a
-- separate infrastructure concern; this RPC supports bank/benefit imports.
create table private.import_secrets(financial_space_id uuid primary key references finance.financial_spaces(id),secret text not null);
create table private.import_context(backend_pid integer not null,transaction_number bigint not null,batch_id uuid not null,account_id uuid not null,mode text not null check(mode in('confirm','undo')),primary key(backend_pid,transaction_number));
revoke all on private.import_secrets,private.import_context from public,anon,authenticated;
alter table finance.financial_accounts add column external_institution text,add column external_account_fingerprint text,add column external_account_last_digits text,
  add column import_profile jsonb,add column fitids_unreliable boolean not null default false,add column last_balance_check_on date,add column last_balance_check_cents bigint;
create table finance.import_files(
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),file_name text not null,
  encrypted_bytes bytea not null,byte_count integer not null check(byte_count between 1 and 10485760),file_sha256 bytea not null check(octet_length(file_sha256)=32),created_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id)
);
create table finance.import_batches(
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),financial_account_id uuid not null,ledger_account_id uuid not null,
  attachment_id uuid not null,format text not null check(format in('ofx','csv')),file_name text not null,file_sha256 bytea not null check(octet_length(file_sha256)=32),
  external_institution text,external_account_fingerprint text,external_account_last_digits text,other_account_reason text,period_start date,period_end date,generated_on date,
  statement_balance_cents bigint,balance_on date,identification_mode text not null check(identification_mode in('fitid','fingerprint')),fitids_regenerated boolean not null default false,
  lines_read integer not null default 0,lines_new integer not null default 0,lines_duplicate integer not null default 0,lines_pending integer not null default 0,lines_informational integer not null default 0,lines_invalid integer not null default 0,
  status text not null default 'in_review' check(status in('in_review','completed','undone')),version integer not null default 1,confirmed_at timestamptz,confirmed_by uuid references auth.users(id),undone_at timestamptz,undone_by uuid references auth.users(id),undo_reason text,before_balance_check jsonb,
  client_uuid uuid,request_hash bytea,created_at timestamptz not null default now(),created_by uuid references auth.users(id),updated_at timestamptz not null default now(),unique(financial_space_id,id),
  foreign key(financial_space_id,financial_account_id) references finance.financial_accounts(financial_space_id,id),foreign key(financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id),foreign key(financial_space_id,attachment_id) references finance.import_files(financial_space_id,id),
  check(period_start is null or period_end is null or period_start<=period_end),check((statement_balance_cents is null)=(balance_on is null)),check((status='undone')=(undone_at is not null)),check((client_uuid is null)=(request_hash is null))
);
create unique index import_file_once on finance.import_batches(financial_space_id,file_sha256) where status<>'undone';
create unique index import_read_request_once on finance.import_batches(financial_space_id,client_uuid) where client_uuid is not null;
create table finance.import_candidates(
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null,import_batch_id uuid not null,ledger_account_id uuid not null,line_number integer not null check(line_number between 1 and 10000),
  posted_on date,amount_cents bigint check(amount_cents<>0 and amount_cents between -9007199254740991 and 9007199254740991),description text not null,normalized_description text not null,document_number text,external_id text,error text,
  fingerprint_key text,duplicate_ordinal integer,fitid_reserved boolean not null default false,key_reserved_at timestamptz,key_released_at timestamptz,
  status text not null check(status in('pending_review','suggested','matched','created','blocked_closed_period','ignored','duplicate','pending_authorization','informational','invalid','undone')),
  duplicate_of_candidate_id uuid,absent_in_import_batch_id uuid,absent_previous_status text,rejected_matches jsonb not null default '[]',
  created_transaction_id uuid,matched_transaction_id uuid,matched_entry_id uuid,before_transaction jsonb,before_entries jsonb,applied_version integer,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(financial_space_id,id),unique(import_batch_id,line_number),
  foreign key(financial_space_id,import_batch_id) references finance.import_batches(financial_space_id,id),foreign key(financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id),
  foreign key(financial_space_id,duplicate_of_candidate_id) references finance.import_candidates(financial_space_id,id),foreign key(financial_space_id,absent_in_import_batch_id) references finance.import_batches(financial_space_id,id),
  foreign key(financial_space_id,created_transaction_id) references finance.ledger_transactions(financial_space_id,id),foreign key(financial_space_id,matched_transaction_id) references finance.ledger_transactions(financial_space_id,id),
  check(key_reserved_at is null or (fingerprint_key is not null and duplicate_ordinal>0 and posted_on is not null and amount_cents is not null)),check(not fitid_reserved or (external_id is not null and key_reserved_at is not null)),check(key_released_at is null or status='undone')
);
create unique index import_fitid_once on finance.import_candidates(financial_space_id,ledger_account_id,external_id) where fitid_reserved and key_reserved_at is not null and key_released_at is null;
create unique index import_fingerprint_once on finance.import_candidates(financial_space_id,ledger_account_id,fingerprint_key,duplicate_ordinal) where key_reserved_at is not null and key_released_at is null;
create index import_candidate_batch on finance.import_candidates(import_batch_id,line_number);
alter table finance.ledger_entries add constraint entry_import_candidate_same_space foreign key(financial_space_id,import_candidate_id) references finance.import_candidates(financial_space_id,id);
alter table finance.ledger_transactions add column import_batch_id uuid,add constraint transaction_import_batch_same_space foreign key(financial_space_id,import_batch_id) references finance.import_batches(financial_space_id,id);
create table finance.import_commitment_effects(
  financial_space_id uuid not null,import_batch_id uuid not null,commitment_id uuid not null,before_due_cents bigint not null,before_version integer not null,after_version integer not null,
  primary key(import_batch_id,commitment_id),foreign key(financial_space_id,import_batch_id) references finance.import_batches(financial_space_id,id),foreign key(financial_space_id,commitment_id) references finance.commitments(financial_space_id,id)
);
create table finance.import_transaction_effects(
  financial_space_id uuid not null,import_batch_id uuid not null,ledger_transaction_id uuid not null,before_transaction jsonb,before_entries jsonb,applied_version integer not null,
  primary key(import_batch_id,ledger_transaction_id),foreign key(financial_space_id,import_batch_id) references finance.import_batches(financial_space_id,id),foreign key(financial_space_id,ledger_transaction_id) references finance.ledger_transactions(financial_space_id,id)
);
do $$ declare tbl text; begin
  foreach tbl in array array['import_batches','import_candidates','import_commitment_effects','import_transaction_effects'] loop
    execute format('alter table finance.%I enable row level security',tbl);
    execute format('create policy member_read on finance.%I for select to authenticated using(private.is_member(financial_space_id))',tbl);
    execute format('revoke all on finance.%I from public,anon,authenticated',tbl);execute format('grant select on finance.%I to authenticated',tbl);
  end loop;
end $$;
alter table finance.import_files enable row level security;
revoke all on finance.import_files from public,anon,authenticated;

create function private.import_normalize_description(p_text text) returns text language sql immutable set search_path='' as $$
  select trim(regexp_replace(regexp_replace(translate(upper(coalesce(p_text,'')),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'),'(^|\s)(PIX|PAG\*|COMPRA CARTAO)(\s|$)',' ','g'),'[0-9]{6,}|[^A-Z0-9]+',' ','g'));
$$;
create function private.import_refresh_batch(p_batch uuid,p_bump boolean default false) returns void language sql set search_path='' as $$
  update finance.import_batches b set status=case when exists(select 1 from finance.import_candidates c where c.import_batch_id=b.id and c.status in('pending_review','suggested','blocked_closed_period')) then 'in_review' else 'completed' end,
    version=version+case when p_bump then 1 else 0 end,updated_at=now() where b.id=p_batch and b.status<>'undone';
$$;

-- Reuse canonical posting, settlement and cancellation bodies. Only this
-- private, transaction-scoped context supplies import origin/account/kind.
do $$ declare def text; needle text; begin
  def:=pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  needle:='card_holder_id,created_by)';if position(needle in def)=0 then raise exception 'Import posting insertion point missing';end if;
  def:=replace(def,needle,'card_holder_id,import_batch_id,created_by)');
  def:=replace(def,'coalesce(p_payload->>''source'',''manual'')','case when coalesce(p_payload->>''source'',''manual'')<>''system'' and exists(select 1 from private.import_context where backend_pid=pg_backend_pid() and transaction_number=txid_current() and mode=''confirm'') then ''import'' else coalesce(p_payload->>''source'',''manual'') end');
  def:=replace(def,'(p_payload->>''card_holder_id'')::uuid,p_actor)','(p_payload->>''card_holder_id'')::uuid,(select batch_id from private.import_context where backend_pid=pg_backend_pid() and transaction_number=txid_current() and mode=''confirm'' and coalesce(p_payload->>''source'',''manual'')<>''system''),p_actor)');execute def;
  def:=pg_get_functiondef('api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)'::regprocedure);
  needle:='f.id = commitment.payment_financial_account_id';if position(needle in def)=0 then raise exception 'Import settlement account point missing';end if;
  execute replace(def,needle,'f.id = coalesce((select account_id from private.import_context where backend_pid=pg_backend_pid() and transaction_number=txid_current() and mode=''confirm''),commitment.payment_financial_account_id)');
  def:=pg_get_functiondef('api.cancel_transaction(uuid,uuid,integer,text)'::regprocedure);
  needle:='cancellation_kind = ''user_cancelled''';if position(needle in def)=0 then raise exception 'Import cancellation point missing';end if;
  execute replace(def,needle,'cancellation_kind = case when exists(select 1 from private.import_context where backend_pid=pg_backend_pid() and transaction_number=txid_current() and mode=''undo'') then ''import_undone'' else ''user_cancelled'' end');
end $$;

create function private.import_suggestions(p_space uuid,p_candidate uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare c finance.import_candidates; matches jsonb;begin
  select * into c from finance.import_candidates where id=p_candidate and financial_space_id=p_space;
  if c.key_reserved_at is null or c.status not in('pending_review','suggested','blocked_closed_period') then return '[]';end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind','transaction','entryId',e.id,'transactionId',t.id,'transactionVersion',t.version,'description',t.description,'amountCents',e.amount_cents,'on',t.occurred_on,
    'confidence',case when e.amount_cents=c.amount_cents and abs(t.occurred_on-c.posted_on)<=3 and (t.occurred_on=c.posted_on or private.import_normalize_description(t.description)=c.normalized_description) then 'high' else 'medium' end) order by abs(t.occurred_on-c.posted_on),t.registration_order,e.line_number),'[]') into matches
  from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id
  where e.financial_space_id=p_space and e.ledger_account_id=c.ledger_account_id and t.status='posted' and e.reconciliation_status<>'reconciled' and sign(e.amount_cents)=sign(c.amount_cents) and abs(t.occurred_on-c.posted_on)<=7
    and (e.amount_cents=c.amount_cents or (abs(e.amount_cents-c.amount_cents)::numeric<=abs(e.amount_cents)::numeric/10 and exists(select 1 from finance.ledger_entries linked join finance.commitments agenda on agenda.id=linked.commitment_id where linked.ledger_transaction_id=t.id and agenda.certainty='estimated')))
    and not c.rejected_matches @> jsonb_build_array(jsonb_build_object('kind','transaction','id',e.id));
  if jsonb_array_length(matches)>0 then return matches;end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind','commitment','commitmentId',a.id,'commitmentVersion',a.version,'description',a.title,'amountCents',case a.direction when 'outflow' then -a.remaining_cents else a.remaining_cents end,'on',a.effective_due_on,'confidence','medium') order by a.effective_due_on,a.id),'[]') into matches
  from finance.commitment_settlements a join finance.commitments original on original.id=a.id
  where a.financial_space_id=p_space and a.kind<>'reminder' and a.settlement_status in('pending','partial') and a.payment_method<>'card' and (a.direction='outflow')=(c.amount_cents<0)
    and ((c.posted_on between a.effective_due_on-10 and a.effective_due_on+5 and (abs(c.amount_cents)=a.remaining_cents or (a.certainty='estimated' and (abs(abs(c.amount_cents)-a.remaining_cents)::numeric<=a.remaining_cents::numeric/10 or exists(select 1 from finance.import_candidates old join finance.ledger_entries oldentry on oldentry.import_candidate_id=old.id join finance.ledger_entries history_link on history_link.ledger_transaction_id=oldentry.ledger_transaction_id join finance.commitments oldagenda on oldagenda.id=history_link.commitment_id where old.financial_space_id=p_space and old.status in('created','matched') and old.normalized_description=c.normalized_description and original.recurrence_rule_id is not null and oldagenda.recurrence_rule_id=original.recurrence_rule_id))))) or (a.effective_due_on<c.posted_on and abs(c.amount_cents)=a.remaining_cents))
    and not c.rejected_matches @> jsonb_build_array(jsonb_build_object('kind','commitment','id',a.id));
  return matches;
end $$;

create function private.import_validate_row(p_row jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare day date;cents bigint;state text:=coalesce(p_row->>'status','posted');begin
  if state in('informational','invalid') then return p_row||jsonb_build_object('postedOn',null,'amountCents',null);end if;
  if p_row->>'postedOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_row->>'amountCents' !~ '^-?[0-9]+$' then raise exception 'Data ou valor ilegível';end if;
  day:=(p_row->>'postedOn')::date;cents:=(p_row->>'amountCents')::bigint;
  if day is null or cents is null or cents=0 or abs(cents::numeric)>9007199254740991 then raise exception 'Data ou valor ilegível';end if;
  return p_row||jsonb_build_object('postedOn',day,'amountCents',cents,'status',state);
exception when others then return p_row||jsonb_build_object('postedOn',null,'amountCents',null,'status','invalid','error',coalesce(p_row->>'error','Data ou valor ilegível'));end $$;

create function api.import_statement_read(p_space uuid,p_account uuid,p_payload jsonb,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare account finance.financial_accounts; ledger finance.ledger_accounts; bytes bytea; digest bytea; reqhash bytea; batch finance.import_batches; attachment uuid; secret text; identity text; institution text; identity_hash text;
  mode text; regenerated boolean:=false; row jsonb; candidate uuid; dup uuid; fp text; ord integer; file_ord integer; previous_count integer; state text; day date; cents bigint; read_rows jsonb; groups jsonb:='{}'; lines integer:=0; suggestions jsonb;
begin
  perform private.require_writer(p_space);perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  reqhash:=sha256(convert_to(jsonb_build_object('account',p_account,'payload',p_payload)::text,'UTF8'));
  if p_client_uuid is not null then
    select * into batch from finance.import_batches where financial_space_id=p_space and client_uuid=p_client_uuid;
    if found then if batch.request_hash is distinct from reqhash then raise exception 'Client UUID reused with different import' using errcode='23505';end if;return batch.id;end if;
    if exists(select 1 from finance.ledger_transactions where financial_space_id=p_space and client_uuid=p_client_uuid) or exists(select 1 from finance.operation_requests where financial_space_id=p_space and client_uuid=p_client_uuid) then raise exception 'Client UUID reused with different operation' using errcode='23505';end if;
  end if;
  select * into account from finance.financial_accounts where id=p_account and financial_space_id=p_space and archived_at is null and deleted_at is null for update;
  if not found then raise exception 'Active financial account not found; card imports are not supported yet' using errcode='P0002';end if;
  select * into ledger from finance.ledger_accounts where id=account.ledger_account_id;
  if ledger.liquidity not in('cash','benefit') then raise exception 'Statement imports currently support bank and benefit accounts' using errcode='23514';end if;
  if p_payload->>'accountType'='card' then raise exception 'Card statement imports are not supported yet' using errcode='23514';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->>'format' not in('ofx','csv') or nullif(trim(p_payload->>'fileName'),'') is null or jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')>10000 or p_payload->>'fileSha256' !~ '^[a-fA-F0-9]{64}$' then raise exception 'Invalid statement import payload' using errcode='23514';end if;
  bytes:=decode(p_payload->>'fileBytesBase64','base64');digest:=sha256(bytes);
  if bytes is null or octet_length(bytes) not between 1 and 10485760 then raise exception 'Statement file must contain 1 byte to 10 MB' using errcode='23514';end if;
  if digest is distinct from decode(p_payload->>'fileSha256','hex') then raise exception 'Statement file hash does not match original bytes' using errcode='23514';end if;
  select * into batch from finance.import_batches where financial_space_id=p_space and file_sha256=digest and status<>'undone';
  if found then raise exception 'This file was already imported at % by %',batch.created_at,batch.created_by using errcode='23505';end if;
  insert into private.import_secrets values(p_space,encode(extensions.gen_random_bytes(32),'hex')) on conflict do nothing;
  select s.secret into secret from private.import_secrets s where financial_space_id=p_space;
  identity:=nullif(trim(p_payload->>'externalAccountIdentity'),'');institution:=nullif(trim(p_payload->>'externalInstitution'),'');
  if identity is not null then
    identity_hash:=encode(extensions.hmac(convert_to(coalesce(institution,'')||':'||identity,'UTF8'),decode(secret,'hex'),'sha256'),'hex');
    if account.external_account_fingerprint is not null and account.external_account_fingerprint<>identity_hash and nullif(trim(p_payload->>'otherAccountReason'),'') is null then raise exception 'Este arquivo parece ser de outra conta' using errcode='23514';end if;
    update finance.financial_accounts set external_institution=institution,external_account_fingerprint=identity_hash,external_account_last_digits=right(regexp_replace(identity,'[^0-9]','','g'),4),updated_at=now(),version=version+1 where id=account.id;
  end if;
  if p_payload ? 'profile' then update finance.financial_accounts set import_profile=p_payload->'profile',updated_at=now() where id=account.id;end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'rows') x where coalesce(x->>'status','posted') not in('posted','pending','informational','invalid')) then raise exception 'Invalid import row status' using errcode='23514';end if;
  select coalesce(jsonb_agg(private.import_validate_row(value) order by ordinality),'[]') into read_rows from jsonb_array_elements(p_payload->'rows') with ordinality;
  select coalesce(jsonb_agg(case when value->>'status'='posted' and (value->>'postedOn')::date>coalesce((p_payload->>'generatedOn')::date,private.space_today(p_space)) then value||'{"status":"pending"}'::jsonb else value end order by ordinality),'[]') into read_rows from jsonb_array_elements(read_rows) with ordinality;
  mode:=case when not account.fitids_unreliable and not exists(select 1 from jsonb_array_elements(read_rows) x where coalesce(x->>'status','posted')='posted' and nullif(trim(x->>'externalId'),'') is null)
    and not exists(select 1 from jsonb_array_elements(read_rows) x where coalesce(x->>'status','posted')='posted' group by x->>'externalId' having count(*)>1) then 'fitid' else 'fingerprint' end;
  if mode='fitid' and exists(select 1 from jsonb_array_elements(read_rows) x join finance.import_batches old on old.financial_space_id=p_space and old.ledger_account_id=account.ledger_account_id and old.status<>'undone' and (x->>'postedOn')::date between old.period_start and old.period_end where coalesce(x->>'status','posted')='posted') then
    if not exists(select 1 from jsonb_array_elements(read_rows) x join finance.import_candidates old on old.financial_space_id=p_space and old.ledger_account_id=account.ledger_account_id and old.fitid_reserved and old.key_released_at is null and old.external_id=x->>'externalId'
      where coalesce(x->>'status','posted')='posted' and exists(select 1 from finance.import_batches cover where cover.financial_space_id=p_space and cover.ledger_account_id=account.ledger_account_id and cover.status<>'undone' and (x->>'postedOn')::date between cover.period_start and cover.period_end))
      and exists(select 1 from jsonb_array_elements(read_rows) x join finance.import_candidates old on old.financial_space_id=p_space and old.ledger_account_id=account.ledger_account_id and old.fitid_reserved and old.key_released_at is null and old.fingerprint_key=(x->>'postedOn')||':'||(x->>'amountCents')
        where coalesce(x->>'status','posted')='posted' and exists(select 1 from finance.import_batches cover where cover.financial_space_id=p_space and cover.ledger_account_id=account.ledger_account_id and cover.status<>'undone' and (x->>'postedOn')::date between cover.period_start and cover.period_end)) then
      mode:='fingerprint';regenerated:=true;update finance.financial_accounts set fitids_unreliable=true where id=account.id;
    end if;
  end if;
  insert into finance.import_files(financial_space_id,file_name,encrypted_bytes,byte_count,file_sha256,created_by) values(p_space,p_payload->>'fileName',extensions.pgp_sym_encrypt_bytea(bytes,secret,'cipher-algo=aes256,compress-algo=1'),octet_length(bytes),digest,auth.uid()) returning id into attachment;
  insert into finance.import_batches(financial_space_id,financial_account_id,ledger_account_id,attachment_id,format,file_name,file_sha256,external_institution,external_account_fingerprint,external_account_last_digits,other_account_reason,period_start,period_end,generated_on,statement_balance_cents,balance_on,identification_mode,fitids_regenerated,client_uuid,request_hash,created_by)
    values(p_space,account.id,account.ledger_account_id,attachment,p_payload->>'format',p_payload->>'fileName',digest,institution,identity_hash,case when identity is not null then right(regexp_replace(identity,'[^0-9]','','g'),4) end,p_payload->>'otherAccountReason',
    coalesce((p_payload->>'periodStart')::date,(select min((value->>'postedOn')::date) from jsonb_array_elements(read_rows))),coalesce((p_payload->>'periodEnd')::date,(select max((value->>'postedOn')::date) from jsonb_array_elements(read_rows))),coalesce((p_payload->>'generatedOn')::date,private.space_today(p_space)),(p_payload->>'statementBalanceCents')::bigint,(p_payload->>'balanceOn')::date,mode,regenerated,p_client_uuid,case when p_client_uuid is not null then reqhash end,auth.uid()) returning * into batch;
  for row in select value from jsonb_array_elements(read_rows) loop
    lines:=lines+1;state:=coalesce(row->>'status','posted');day:=null;cents:=null;fp:=null;ord:=null;dup:=null;
    begin
      day:=(row->>'postedOn')::date;
      if row->>'amountCents' !~ '^-?[0-9]+$' then raise exception 'Invalid integer cents';end if;cents:=(row->>'amountCents')::bigint;
      if state in('posted','pending') and (day is null or cents is null or cents=0 or abs(cents::numeric)>9007199254740991) then raise exception 'Invalid date or amount';end if;
    exception when others then if state not in('informational','invalid') then state:='invalid';end if;day:=null;cents:=null;end;
    if state='posted' and day>batch.generated_on then state:='pending';end if;
    if state='posted' then
      fp:=day::text||':'||cents::text;file_ord:=coalesce((groups->>fp)::integer,0)+1;groups:=jsonb_set(groups,array[fp],to_jsonb(file_ord));
      if mode='fitid' then
        select id into dup from finance.import_candidates where financial_space_id=p_space and ledger_account_id=account.ledger_account_id and fitid_reserved and key_released_at is null and external_id=row->>'externalId' and import_batch_id<>batch.id;
        if dup is null then
          -- Count only the FITID-new lines for comparison with prior untrusted keys.
          file_ord:=coalesce((groups->>(fp||':untrusted'))::integer,0)+1;groups:=jsonb_set(groups,array[fp||':untrusted'],to_jsonb(file_ord));
          select id into dup from finance.import_candidates where financial_space_id=p_space and ledger_account_id=account.ledger_account_id and fingerprint_key=fp and key_reserved_at is not null and key_released_at is null and not fitid_reserved and import_batch_id<>batch.id order by duplicate_ordinal offset file_ord-1 limit 1;
        end if;
      else
        select id into dup from finance.import_candidates where financial_space_id=p_space and ledger_account_id=account.ledger_account_id and fingerprint_key=fp and key_reserved_at is not null and key_released_at is null and import_batch_id<>batch.id order by duplicate_ordinal offset file_ord-1 limit 1;
      end if;
      if dup is not null then state:='duplicate';ord:=file_ord;
      else
        select n into ord from generate_series(1,coalesce((select max(duplicate_ordinal) from finance.import_candidates where financial_space_id=p_space and ledger_account_id=account.ledger_account_id and fingerprint_key=fp and key_reserved_at is not null and key_released_at is null),0)+1) n where not exists(select 1 from finance.import_candidates old where old.financial_space_id=p_space and old.ledger_account_id=account.ledger_account_id and old.fingerprint_key=fp and old.duplicate_ordinal=n and old.key_reserved_at is not null and old.key_released_at is null) order by n limit 1;
        state:=case when exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',day)::date and reopened_at is null) then 'blocked_closed_period' else 'pending_review' end;
      end if;
    elsif state='pending' then state:='pending_authorization';end if;
    if cents=0 or abs(cents::numeric)>9007199254740991 then cents:=null;end if;
    insert into finance.import_candidates(financial_space_id,import_batch_id,ledger_account_id,line_number,posted_on,amount_cents,description,normalized_description,document_number,external_id,error,fingerprint_key,duplicate_ordinal,fitid_reserved,key_reserved_at,status,duplicate_of_candidate_id)
      values(p_space,batch.id,account.ledger_account_id,lines,day,cents,coalesce(row->>'description',''),private.import_normalize_description(row->>'description'),row->>'documentNumber',nullif(trim(row->>'externalId'),''),row->>'error',fp,ord,mode='fitid' and dup is null and fp is not null,case when dup is null and fp is not null then now() end,state,dup) returning id into candidate;
    if state in('pending_review','blocked_closed_period') then suggestions:=private.import_suggestions(p_space,candidate);if jsonb_array_length(suggestions)>0 then update finance.import_candidates set status='suggested' where id=candidate;end if;end if;
  end loop;
  update finance.import_batches b set lines_read=lines,lines_new=(select count(*) from finance.import_candidates where import_batch_id=b.id and key_reserved_at is not null),lines_duplicate=(select count(*) from finance.import_candidates where import_batch_id=b.id and status='duplicate'),lines_pending=(select count(*) from finance.import_candidates where import_batch_id=b.id and status='pending_authorization'),lines_informational=(select count(*) from finance.import_candidates where import_batch_id=b.id and status='informational'),lines_invalid=(select count(*) from finance.import_candidates where import_batch_id=b.id and status='invalid') where id=batch.id;
  -- A missing multiplicity is reviewed as a group; never guess which identical
  -- movement disappeared, and never cancel a Ledger fact while reading.
  update finance.import_candidates old set absent_in_import_batch_id=batch.id,absent_previous_status=coalesce(old.absent_previous_status,old.status),status='pending_review',updated_at=now()
    where old.financial_space_id=p_space and old.ledger_account_id=account.ledger_account_id and old.import_batch_id<>batch.id and old.key_reserved_at is not null and old.key_released_at is null and old.posted_on between batch.period_start and batch.period_end
      and not exists(select 1 from finance.import_candidates fresh where fresh.import_batch_id=batch.id and fresh.external_id=old.external_id and mode='fitid')
      and (select count(*) from finance.import_candidates fresh where fresh.import_batch_id=batch.id and fresh.fingerprint_key=old.fingerprint_key)<(select count(*) from finance.import_candidates sibling where sibling.financial_space_id=p_space and sibling.ledger_account_id=account.ledger_account_id and sibling.fingerprint_key=old.fingerprint_key and sibling.key_reserved_at is not null and sibling.key_released_at is null and sibling.import_batch_id<>batch.id);
  perform private.import_refresh_batch(batch.id);
  perform private.import_refresh_batch(id,true) from finance.import_batches where id in(select import_batch_id from finance.import_candidates where absent_in_import_batch_id=batch.id);
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'import_read','import_batch',batch.id,jsonb_build_object('lines',lines,'identification_mode',mode,'fitids_regenerated',regenerated));
  return batch.id;
end $$;

create function private.import_sync_reconciliation(p_transaction uuid,p_before jsonb) returns void language plpgsql set search_path='' as $$
declare candidate uuid;batch uuid;begin
  for candidate in select distinct (value->>'import_candidate_id')::uuid from jsonb_array_elements(p_before) where value->>'import_candidate_id' is not null loop
    if not exists(select 1 from finance.ledger_entries where ledger_transaction_id=p_transaction and import_candidate_id=candidate and reconciliation_status='reconciled') then
      update finance.import_candidates set status='pending_review',matched_entry_id=null,updated_at=now() where id=candidate and status<>'undone' returning import_batch_id into batch;
      perform private.import_refresh_batch(batch,true);
    else update finance.import_candidates set matched_entry_id=(select id from finance.ledger_entries where ledger_transaction_id=p_transaction and import_candidate_id=candidate limit 1) where id=candidate;end if;
  end loop;
end $$;
do $$ declare def text;begin
  def:=pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  execute replace(def,'return tx.id;','perform private.import_sync_reconciliation(tx.id,before_entries);return tx.id;');
end $$;

create function api.import_original_file(p_space uuid,p_batch uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501';end if;
  select jsonb_build_object('fileName',f.file_name,'fileSha256',encode(f.file_sha256,'hex'),'fileBytesBase64',encode(extensions.pgp_sym_decrypt_bytea(f.encrypted_bytes,s.secret),'base64')) into result
    from finance.import_batches b join finance.import_files f on f.id=b.attachment_id join private.import_secrets s on s.financial_space_id=b.financial_space_id where b.id=p_batch and b.financial_space_id=p_space;
  if result is null then raise exception 'Import batch not found' using errcode='P0002';end if;return result;
end $$;

create function api.import_review(p_space uuid,p_batch uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare batch finance.import_batches;rows jsonb;bal bigint;begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501';end if;
  select * into batch from finance.import_batches where id=p_batch and financial_space_id=p_space;if not found then raise exception 'Import batch not found' using errcode='P0002';end if;
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('currentTransactionVersion',(select version from finance.ledger_transactions where id=c.matched_transaction_id),'suggestions',private.import_suggestions(p_space,c.id),'autoSelected',
    jsonb_array_length(private.import_suggestions(p_space,c.id))=1 and private.import_suggestions(p_space,c.id)->0->>'confidence'='high'
      and not exists(select 1 from finance.import_candidates sibling cross join lateral jsonb_array_elements(private.import_suggestions(p_space,sibling.id)) proposed where sibling.import_batch_id=p_batch and sibling.id<>c.id and proposed->>'entryId'=private.import_suggestions(p_space,c.id)->0->>'entryId')) order by c.line_number),'[]') into rows from finance.import_candidates c where c.import_batch_id=p_batch;
  select coalesce(sum(e.amount_cents),0)::bigint into bal from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.financial_space_id=p_space and e.ledger_account_id=batch.ledger_account_id and t.status='posted' and t.occurred_on<=batch.balance_on;
  return jsonb_build_object('batch',to_jsonb(batch)-'request_hash','candidates',rows,'undoChoices',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'kind','transaction','description',t.description)) from finance.import_transaction_effects effect join finance.ledger_transactions t on t.id=effect.ledger_transaction_id where effect.import_batch_id=batch.id and effect.before_transaction is not null and t.status='posted' and t.version<>effect.applied_version),'[]')||coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind','commitment','description',a.title)) from finance.import_commitment_effects effect join finance.commitments a on a.id=effect.commitment_id where effect.import_batch_id=batch.id and a.due_amount_cents<>effect.before_due_cents and a.version<>effect.after_version),'[]'),
    'balanceCheck',case when batch.balance_on is not null then jsonb_build_object('on',batch.balance_on,'statementCents',batch.statement_balance_cents,'ledgerCents',bal,'differenceCents',batch.statement_balance_cents-bal,'matches',batch.statement_balance_cents=bal) end,
    'absentGroups',coalesce((select jsonb_agg(jsonb_build_object('fingerprintKey',g.fingerprint_key,'postedOn',g.posted_on,'amountCents',g.amount_cents,'existingCount',g.existing_count,'fileCount',g.file_count,'candidates',g.candidates)) from (select old.fingerprint_key,old.posted_on,old.amount_cents,count(*) as existing_count,(select count(*) from finance.import_candidates fresh where fresh.import_batch_id=p_batch and fresh.fingerprint_key=old.fingerprint_key) as file_count,jsonb_agg(jsonb_build_object('candidateId',old.id,'batchId',old.import_batch_id,'description',old.description,'createdTransactionId',old.created_transaction_id,'matchedTransactionId',old.matched_transaction_id)) as candidates from finance.import_candidates old where old.absent_in_import_batch_id=p_batch group by old.fingerprint_key,old.posted_on,old.amount_cents) g),'[]'));
end $$;

create function api.import_overview(p_space uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501';end if;
  select jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'liquidity',a.liquidity,'importProfile',f.import_profile,'fitidsUnreliable',f.fitids_unreliable,'institution',f.external_institution,'lastDigits',f.external_account_last_digits) order by f.sort_order,f.name) from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.financial_space_id=p_space and a.liquidity in('cash','benefit') and f.archived_at is null and f.deleted_at is null),'[]'),
    'counterparts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'accountClass',a.account_class,'ownerType',a.owner_type,'liquidity',a.liquidity) order by a.owner_type,a.name) from finance.ledger_accounts a where a.financial_space_id=p_space and a.allows_posting and a.archived_at is null and (a.owner_type in('category','person') or a.owner_type='financial_account' and a.liquidity in('cash','benefit'))),'[]'),
    'batches',coalesce((select jsonb_agg((to_jsonb(b)-'request_hash'-'before_balance_check')||jsonb_build_object('accountName',f.name,'canUndo',b.status<>'undone' and exists(select 1 from finance.financial_space_members m where m.financial_space_id=p_space and m.user_id=auth.uid() and m.status='active' and (m.role in('owner','admin') or m.role='member' and b.created_by=auth.uid()))) order by b.created_at desc,b.id desc) from finance.import_batches b join finance.financial_accounts f on f.id=b.financial_account_id where b.financial_space_id=p_space),'[]')) into result;return result;
end $$;

create function private.import_remember_commitment(p_space uuid,p_batch uuid,p_commitment uuid) returns void language sql set search_path='' as $$
  insert into finance.import_commitment_effects(financial_space_id,import_batch_id,commitment_id,before_due_cents,before_version,after_version)
    select p_space,p_batch,id,due_amount_cents,version,version from finance.commitments where id=p_commitment and financial_space_id=p_space on conflict do nothing;
$$;
create function private.import_reconcile(p_space uuid,p_candidate uuid,p_entry uuid) returns integer language plpgsql set search_path='' as $$
declare entry finance.ledger_entries;v integer;begin
  select * into entry from finance.ledger_entries where id=p_entry and financial_space_id=p_space;
  if not found or entry.ledger_account_id<>(select ledger_account_id from finance.import_candidates where id=p_candidate) or entry.amount_cents<>(select amount_cents from finance.import_candidates where id=p_candidate) or entry.reconciliation_status='reconciled' then raise exception 'Import correspondence is no longer available' using errcode='40001';end if;
  update finance.ledger_entries set reconciliation_status='reconciled',reconciliation_source='import',reconciled_at=now(),import_candidate_id=p_candidate,updated_at=now() where id=entry.id;
  update finance.ledger_transactions set version=version+1,updated_at=now(),updated_by=auth.uid() where id=entry.ledger_transaction_id returning version into v;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'import_reconciled','ledger_entry',entry.id,to_jsonb(entry),jsonb_build_object('candidate_id',p_candidate,'batch_id',(select import_batch_id from finance.import_candidates where id=p_candidate)));
  return v;
end $$;

create function api.confirm_import(p_space uuid,p_batch uuid,p_version integer,p_decisions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare batch finance.import_batches;c finance.import_candidates;decision jsonb;tx finance.ledger_transactions;entry finance.ledger_entries;other finance.ledger_accounts;agenda finance.commitments;
  entries jsonb;new_entries jsonb;part jsonb;weights bigint[];allocation bigint[];idx integer;amount bigint;txid uuid;entryid uuid;v integer;kind text;reason text;linked record;oldpaid bigint;newpaid bigint;
begin
  perform private.require_writer(p_space);perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into batch from finance.import_batches where id=p_batch and financial_space_id=p_space for update;
  if not found then raise exception 'Import batch not found' using errcode='P0002';end if;
  if batch.status='undone' then raise exception 'Undone import is immutable' using errcode='23514';end if;
  if batch.version is distinct from p_version then raise exception 'Import batch changed; reload before confirming' using errcode='40001';end if;
  if jsonb_typeof(p_decisions) is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_decisions) x group by x->>'candidateId' having count(*)>1) then raise exception 'Import decisions must name each candidate at most once' using errcode='23514';end if;
  if not exists(select 1 from finance.financial_accounts where id=batch.financial_account_id and archived_at is null and deleted_at is null) then raise exception 'Import account is archived' using errcode='23514';end if;
  insert into private.import_context values(pg_backend_pid(),txid_current(),batch.id,batch.financial_account_id,'confirm');
  reason:='Conciliação com o extrato, lote '||batch.id;
  for decision in select value from jsonb_array_elements(p_decisions) loop
    select * into c from finance.import_candidates where id=(decision->>'candidateId')::uuid and import_batch_id=batch.id for update;
    if not found or c.status not in('pending_review','suggested','blocked_closed_period') then raise exception 'Candidate is not awaiting review' using errcode='23514';end if;
    if decision->>'action'='keep_absent' and c.absent_in_import_batch_id is not null then
      update finance.import_candidates set status=coalesce(absent_previous_status,'pending_review'),absent_in_import_batch_id=null,absent_previous_status=null,updated_at=now() where id=c.id;continue;
    elsif decision->>'action'='ignore' then update finance.import_candidates set status='ignored',updated_at=now() where id=c.id;continue;
    elsif decision->>'action'='reject' then
      if decision->>'entryId' is not null then part:=jsonb_build_object('kind','transaction','id',(decision->>'entryId')::uuid);
      elsif decision->>'commitmentId' is not null then part:=jsonb_build_object('kind','commitment','id',(decision->>'commitmentId')::uuid);
      else raise exception 'Choose the correspondence to reject' using errcode='23514';end if;
      update finance.import_candidates set rejected_matches=rejected_matches||jsonb_build_array(part),status='pending_review',updated_at=now() where id=c.id;continue;
    end if;
    if c.absent_in_import_batch_id is not null then raise exception 'Resolve the absent statement line before applying a new decision' using errcode='23514';end if;
    if decision->>'action'='match_transaction' then
      select e.* into entry from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.id=(decision->>'entryId')::uuid and e.financial_space_id=p_space and e.ledger_account_id=batch.ledger_account_id and e.reconciliation_status<>'reconciled' and t.status='posted';
      if not found or sign(entry.amount_cents)<>sign(c.amount_cents) then raise exception 'Matching transaction entry is unavailable' using errcode='23514';end if;
      select * into tx from finance.ledger_transactions where id=entry.ledger_transaction_id for update;
      if tx.version is distinct from (decision->>'transactionVersion')::integer then raise exception 'Transaction changed; reload before matching' using errcode='40001';end if;
      if abs(tx.occurred_on-c.posted_on)>7 and not coalesce((decision->>'manual')::boolean,false) then raise exception 'Matching transaction is outside the import date window' using errcode='23514';end if;
      select jsonb_agg(to_jsonb(e) order by line_number) into entries from finance.ledger_entries e where ledger_transaction_id=tx.id;
      if entry.amount_cents<>c.amount_cents then
        if not exists(select 1 from finance.ledger_entries e join finance.commitments a on a.id=e.commitment_id where e.ledger_transaction_id=tx.id and a.certainty='estimated') or abs(entry.amount_cents-c.amount_cents)::numeric>abs(entry.amount_cents)::numeric/10 then raise exception 'Only estimated values within ten percent can be matched at a different amount' using errcode='23514';end if;
        if exists(select 1 from jsonb_array_elements(entries) x where (x->>'id')::uuid<>entry.id and sign((x->>'amount_cents')::bigint)=sign(entry.amount_cents)) then raise exception 'Split transaction requires manual correction before matching' using errcode='23514';end if;
        select array_agg(abs((x->>'amount_cents')::bigint) order by (x->>'line_number')::integer) into weights from jsonb_array_elements(entries) x where (x->>'id')::uuid<>entry.id;
        allocation:=private.divide_cents(abs(c.amount_cents),weights);new_entries:='[]';idx:=0;
        for part in select value from jsonb_array_elements(entries) order by (value->>'line_number')::integer loop
          if (part->>'id')::uuid=entry.id then amount:=c.amount_cents;else idx:=idx+1;amount:=-sign(c.amount_cents)*allocation[idx];end if;
          if amount=0 then raise exception 'Matching would erase a split; correct the transaction manually' using errcode='23514';end if;
          new_entries:=new_entries||jsonb_build_array(jsonb_set(part,'{amount_cents}',to_jsonb(amount)));
        end loop;
        for linked in select distinct a.id,a.due_amount_cents from finance.ledger_entries e join finance.commitments a on a.id=e.commitment_id where e.ledger_transaction_id=tx.id and a.certainty='estimated' loop
          select paid_cents into oldpaid from finance.commitment_settlements where id=linked.id;
          select oldpaid-coalesce(sum(abs((x->>'amount_cents')::bigint)),0) into oldpaid from jsonb_array_elements(entries) x where (x->>'commitment_id')::uuid=linked.id;
          select coalesce(sum(abs((x->>'amount_cents')::bigint)),0) into newpaid from jsonb_array_elements(new_entries) x where (x->>'commitment_id')::uuid=linked.id;
          if newpaid::numeric >= (linked.due_amount_cents-oldpaid)::numeric*0.9 then
            perform private.import_remember_commitment(p_space,batch.id,linked.id);
            update finance.commitments set due_amount_cents=oldpaid+newpaid,version=version+1,updated_at=now() where id=linked.id;
          end if;
        end loop;
        perform api.edit_transaction(p_space,tx.id,tx.version,to_jsonb(tx)||jsonb_build_object('entries',new_entries,'acknowledge_reconciliation_change',true),reason);
        update finance.import_candidates set before_transaction=coalesce(before_transaction,to_jsonb(tx)),before_entries=coalesce(before_entries,entries) where id=c.id;
        select id into entryid from finance.ledger_entries where ledger_transaction_id=tx.id and line_number=entry.line_number;
      else entryid:=entry.id;end if;
      v:=private.import_reconcile(p_space,c.id,entryid);
      if tx.import_batch_id is distinct from batch.id then
        insert into finance.import_transaction_effects(financial_space_id,import_batch_id,ledger_transaction_id,before_transaction,before_entries,applied_version)
          values(p_space,batch.id,tx.id,case when entry.amount_cents<>c.amount_cents then to_jsonb(tx) end,case when entry.amount_cents<>c.amount_cents then entries end,v)
          on conflict(import_batch_id,ledger_transaction_id) do update set before_transaction=coalesce(finance.import_transaction_effects.before_transaction,excluded.before_transaction),before_entries=coalesce(finance.import_transaction_effects.before_entries,excluded.before_entries),applied_version=excluded.applied_version;
      end if;
      update finance.import_commitment_effects effect set after_version=a.version from finance.commitments a where effect.import_batch_id=batch.id and effect.commitment_id=a.id and a.id in(select commitment_id from finance.ledger_entries where ledger_transaction_id=tx.id);
      update finance.import_candidates set status='matched',matched_transaction_id=tx.id,matched_entry_id=entryid,applied_version=v,updated_at=now() where id=c.id;
    elsif decision->>'action'='match_commitment' then
      select * into agenda from finance.commitments where id=(decision->>'commitmentId')::uuid and financial_space_id=p_space and payment_method<>'card' and cancelled_at is null and deleted_at is null for update;
      if not found or agenda.version is distinct from (decision->>'commitmentVersion')::integer then raise exception 'Commitment changed; reload before matching' using errcode='40001';end if;
      if not private.import_suggestions(p_space,c.id) @> jsonb_build_array(jsonb_build_object('kind','commitment','commitmentId',agenda.id)) and not coalesce((decision->>'manual')::boolean,false) then raise exception 'Commitment is outside the import matching rules' using errcode='23514';end if;
      if (agenda.direction='outflow')<>(c.amount_cents<0) then raise exception 'Commitment has a different direction' using errcode='23514';end if;
      perform private.import_remember_commitment(p_space,batch.id,agenda.id);
      txid:=api.settle_commitment(p_space,agenda.id,abs(c.amount_cents),c.posted_on,'automatic',(decision->>'categoryId')::uuid,null);
      select id into entryid from finance.ledger_entries where ledger_transaction_id=txid and ledger_account_id=batch.ledger_account_id;
      v:=private.import_reconcile(p_space,c.id,entryid);
      update finance.import_commitment_effects effect set after_version=a.version from finance.commitments a where effect.import_batch_id=batch.id and effect.commitment_id=a.id and a.id=agenda.id;
      update finance.import_candidates set status='created',created_transaction_id=txid,matched_transaction_id=txid,matched_entry_id=entryid,applied_version=v,updated_at=now() where id=c.id;
    elsif decision->>'action'='create' then
      if c.created_transaction_id is not null and exists(select 1 from finance.ledger_transactions where id=c.created_transaction_id and status='posted') then raise exception 'The imported transaction still exists; match it or cancel it before creating another' using errcode='23514';end if;
      select * into other from finance.ledger_accounts where id=(decision->>'counterpartAccountId')::uuid and financial_space_id=p_space and archived_at is null and allows_posting and id<>batch.ledger_account_id;
      if not found or other.owner_type not in('category','person','financial_account') or other.liquidity in('investment','property') then raise exception 'Choose a category, person or bank counterpart' using errcode='23514';end if;
      kind:=case when other.account_class='expense' and c.amount_cents<0 then 'expense' when other.account_class='income' and c.amount_cents>0 then 'income' when other.owner_type='person' then 'person_settlement' when other.owner_type='financial_account' then 'transfer' end;
      if kind is null then raise exception 'Counterpart has a different direction' using errcode='23514';end if;
      txid:=private.post_transaction_internal(p_space,jsonb_build_object('kind',kind,'occurred_on',c.posted_on,'competence_month',date_trunc('month',c.posted_on)::date,'description',left(c.description,200),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',batch.ledger_account_id,'amount_cents',c.amount_cents),jsonb_build_object('ledger_account_id',other.id,'amount_cents',-c.amount_cents))),auth.uid());
      select id into entryid from finance.ledger_entries where ledger_transaction_id=txid and ledger_account_id=batch.ledger_account_id;
      v:=private.import_reconcile(p_space,c.id,entryid);
      update finance.import_candidates set status='created',created_transaction_id=txid,matched_transaction_id=txid,matched_entry_id=entryid,applied_version=v,updated_at=now() where id=c.id;
    else raise exception 'Invalid import decision' using errcode='23514';end if;
  end loop;
  delete from private.import_context where backend_pid=pg_backend_pid() and transaction_number=txid_current();
  update finance.import_batches set confirmed_at=now(),confirmed_by=auth.uid(),before_balance_check=coalesce(before_balance_check,(select jsonb_build_object('on',last_balance_check_on,'cents',last_balance_check_cents) from finance.financial_accounts where id=batch.financial_account_id)) where id=batch.id;
  if batch.balance_on is not null then update finance.financial_accounts set last_balance_check_on=batch.balance_on,last_balance_check_cents=batch.statement_balance_cents where id=batch.financial_account_id;end if;
  perform private.import_refresh_batch(batch.id,true);
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'import_confirmed','import_batch',batch.id,p_decisions);
  return api.import_review(p_space,batch.id);
end $$;

create function private.import_unreconcile_transaction(p_transaction uuid) returns void language plpgsql set search_path='' as $$
declare before_entries jsonb;begin
  select jsonb_agg(to_jsonb(e)) into before_entries from finance.ledger_entries e where ledger_transaction_id=p_transaction;
  update finance.ledger_entries set reconciliation_status='unreconciled',reconciliation_source=null,reconciled_at=null,import_candidate_id=null,updated_at=now() where ledger_transaction_id=p_transaction and reconciliation_status is not null;
  perform private.import_sync_reconciliation(p_transaction,before_entries);
end $$;
create function api.unmatch_import(p_space uuid,p_candidate uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c finance.import_candidates;tx finance.ledger_transactions;begin
  perform private.require_writer(p_space);perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into c from finance.import_candidates where id=p_candidate and financial_space_id=p_space and key_released_at is null for update;
  if not found or not exists(select 1 from finance.ledger_entries where import_candidate_id=c.id and reconciliation_status='reconciled') then raise exception 'Imported reconciliation not found' using errcode='P0002';end if;
  select * into tx from finance.ledger_transactions where id=c.matched_transaction_id for update;
  if tx.version is distinct from p_version then raise exception 'Transaction changed; reload before undoing reconciliation' using errcode='40001';end if;
  update finance.ledger_entries set reconciliation_status='unreconciled',reconciliation_source=null,reconciled_at=null,import_candidate_id=null,updated_at=now() where import_candidate_id=c.id;
  update finance.ledger_transactions set version=version+1,updated_at=now(),updated_by=auth.uid() where id=tx.id;
  update finance.import_candidates set status='pending_review',matched_entry_id=null,updated_at=now() where id=c.id;
  perform private.import_refresh_batch(c.import_batch_id,true);
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'import_unmatched','import_candidate',c.id,to_jsonb(c),jsonb_build_object('transaction_id',tx.id));return c.id;
end $$;

create function api.undo_import(p_space uuid,p_batch uuid,p_version integer,p_reason text,p_restore_choices jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare batch finance.import_batches;tx finance.ledger_transactions;c finance.import_candidates;effect finance.import_commitment_effects;agenda finance.commitments;role text;snapshot jsonb;entries jsonb;expected_version integer;choice text;promoted finance.import_candidates;target_batch finance.import_batches;before_entries jsonb;v integer;
begin
  perform private.require_writer(p_space);perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into batch from finance.import_batches where id=p_batch and financial_space_id=p_space for update;if not found then raise exception 'Import batch not found' using errcode='P0002';end if;
  select m.role into role from finance.financial_space_members m where financial_space_id=p_space and user_id=auth.uid() and status='active';
  if role='member' and batch.created_by<>auth.uid() then raise exception 'Members may undo only their own imports' using errcode='42501';end if;
  if batch.status='undone' then return batch.id;end if;
  if batch.version is distinct from p_version then raise exception 'Import batch changed; reload before undoing' using errcode='40001';end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Import undo reason required' using errcode='23514';end if;
  if jsonb_typeof(p_restore_choices) is distinct from 'object' then raise exception 'Import restore choices must be an object' using errcode='23514';end if;
  if exists(select 1 from finance.ledger_transactions imported join finance.ledger_transactions related on related.related_transaction_id=imported.id where imported.import_batch_id=batch.id and related.status='posted' and related.relation_type in('refund_of','payment_returned_of','correction_of','fx_confirmation_of','prepayment_of')) then
    raise exception 'Cannot undo import: later transactions are linked to imported transactions' using errcode='23514';end if;
  insert into private.import_context values(pg_backend_pid(),txid_current(),batch.id,batch.financial_account_id,'undo');
  for tx in select * from finance.ledger_transactions where import_batch_id=batch.id order by created_at,id loop
    if tx.status='posted' then
      perform private.import_unreconcile_transaction(tx.id);
      select version into v from finance.ledger_transactions where id=tx.id;
      perform api.cancel_transaction(p_space,tx.id,v,p_reason);
    end if;
  end loop;
  for tx in select t.* from finance.import_transaction_effects effects join finance.ledger_transactions t on t.id=effects.ledger_transaction_id where effects.import_batch_id=batch.id and t.status='posted' order by t.created_at,t.id loop
    select effects.before_transaction,effects.before_entries,effects.applied_version into snapshot,entries,expected_version from finance.import_transaction_effects effects where effects.import_batch_id=batch.id and effects.ledger_transaction_id=tx.id;
    choice:=p_restore_choices->>tx.id::text;
    if snapshot is not null and tx.version<>expected_version and choice is null then raise exception 'Transaction % was edited after import; choose restore or keep',tx.id using errcode='40001';end if;
    if choice is not null and choice not in('restore','keep') then raise exception 'Invalid import restore choice' using errcode='23514';end if;
    select jsonb_agg(to_jsonb(e)) into before_entries from finance.ledger_entries e where ledger_transaction_id=tx.id;
    update finance.ledger_entries set reconciliation_status='unreconciled',reconciliation_source=null,reconciled_at=null,import_candidate_id=null,updated_at=now() where import_candidate_id in(select id from finance.import_candidates where import_batch_id=batch.id) and ledger_transaction_id=tx.id;
    if snapshot is not null and coalesce(choice,'restore')='restore' then
      perform api.edit_transaction(p_space,tx.id,tx.version,snapshot||jsonb_build_object('entries',entries,'acknowledge_reconciliation_change',true),'Desfazer conciliação do lote '||batch.id||': '||p_reason);
      perform private.restore_reconciliation(tx.id,entries);
    else update finance.ledger_transactions set version=version+1,updated_at=now(),updated_by=auth.uid() where id=tx.id;end if;
    perform private.import_sync_reconciliation(tx.id,before_entries);
  end loop;
  for effect in select * from finance.import_commitment_effects where import_batch_id=batch.id loop
    select * into agenda from finance.commitments where id=effect.commitment_id for update;
    if agenda.due_amount_cents<>effect.before_due_cents then
      choice:=p_restore_choices->>agenda.id::text;
      if agenda.version<>effect.after_version and choice is null then raise exception 'Commitment % was edited after import; choose restore or keep',agenda.id using errcode='40001';end if;
      if choice is not null and choice not in('restore','keep') then raise exception 'Invalid import restore choice' using errcode='23514';end if;
      if coalesce(choice,'restore')='restore' then
        if (select paid_cents from finance.commitment_settlements where id=agenda.id)>effect.before_due_cents then raise exception 'Cannot restore commitment amount while later settlements exceed it' using errcode='23514';end if;
        update finance.commitments set due_amount_cents=effect.before_due_cents,version=version+1,updated_at=now() where id=agenda.id;
        insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'import_amount_restored','commitment',agenda.id,to_jsonb(agenda),jsonb_build_object('due_amount_cents',effect.before_due_cents,'batch_id',batch.id));
      end if;
    end if;
  end loop;
  -- Release then transfer each key to the oldest surviving later duplicate.
  -- Other duplicates now point to that new holder rather than becoming facts.
  for c in select * from finance.import_candidates where import_batch_id=batch.id order by line_number loop
    update finance.import_candidates set status='undone',key_released_at=case when key_reserved_at is not null then now() end,updated_at=now() where id=c.id;
    if c.key_reserved_at is not null then
      select later.* into promoted from finance.import_candidates later join finance.import_batches b on b.id=later.import_batch_id where later.duplicate_of_candidate_id=c.id and later.status='duplicate' and b.status<>'undone' order by b.created_at,later.line_number,later.id limit 1;
      if found then
        select * into target_batch from finance.import_batches where id=promoted.import_batch_id;
        update finance.import_candidates set status=case when exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',posted_on)::date and reopened_at is null) then 'blocked_closed_period' else 'pending_review' end,
          duplicate_of_candidate_id=null,duplicate_ordinal=c.duplicate_ordinal,key_reserved_at=now(),fitid_reserved=target_batch.identification_mode='fitid',updated_at=now() where id=promoted.id;
        update finance.import_candidates set duplicate_of_candidate_id=promoted.id where duplicate_of_candidate_id=c.id and status='duplicate';
        perform private.import_refresh_batch(target_batch.id,true);
      end if;
    end if;
  end loop;
  if batch.before_balance_check is not null then update finance.financial_accounts set last_balance_check_on=(batch.before_balance_check->>'on')::date,last_balance_check_cents=(batch.before_balance_check->>'cents')::bigint where id=batch.financial_account_id and last_balance_check_on is not distinct from batch.balance_on and last_balance_check_cents is not distinct from batch.statement_balance_cents;end if;
  update finance.import_batches set status='undone',undone_at=now(),undone_by=auth.uid(),undo_reason=p_reason,version=version+1,updated_at=now() where id=batch.id;
  delete from private.import_context where backend_pid=pg_backend_pid() and transaction_number=txid_current();
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'import_undone','import_batch',batch.id,to_jsonb(batch),jsonb_build_object('reason',p_reason,'restore_choices',p_restore_choices));return batch.id;
end $$;

-- Share the existing global client UUID namespace with import read receipts.
do $$ declare def text;signature text;needle text;begin
  def:=pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  needle:='payload_hash := sha256(convert_to(p_payload::text,''UTF8''));';
  execute replace(def,needle,'if exists(select 1 from finance.import_batches where financial_space_id=p_space and client_uuid=(p_payload->>''client_uuid'')::uuid) then raise exception ''Client UUID reused with different operation'' using errcode=''23505'';end if;'||needle);
  foreach signature in array array['private.replay_operation(uuid,uuid,text,jsonb)','private.replay_nonledger_operation(uuid,uuid,text,jsonb)'] loop
    def:=pg_get_functiondef(signature::regprocedure);needle:='if p_client is null then return null; end if;';
    execute replace(def,needle,needle||'if exists(select 1 from finance.import_batches where financial_space_id=p_space and client_uuid=p_client) then raise exception ''Client UUID reused with different operation'' using errcode=''23505'';end if;');
  end loop;
  foreach signature in array array['api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid)','api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)','api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)'] loop
    def:=pg_get_functiondef(signature::regprocedure);needle:='perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));';
    execute replace(def,needle,needle||'if exists(select 1 from finance.import_batches where financial_space_id=p_space and client_uuid=p_client_uuid) then raise exception ''Client UUID reused with different operation'' using errcode=''23505'';end if;');
  end loop;
end $$;
revoke all on function private.import_normalize_description(text),private.import_refresh_batch(uuid,boolean),private.import_validate_row(jsonb),private.import_suggestions(uuid,uuid),private.import_sync_reconciliation(uuid,jsonb),private.import_remember_commitment(uuid,uuid,uuid),private.import_reconcile(uuid,uuid,uuid),private.import_unreconcile_transaction(uuid) from public,anon,authenticated;
revoke all on function api.import_statement_read(uuid,uuid,jsonb,uuid),api.import_original_file(uuid,uuid),api.import_review(uuid,uuid),api.import_overview(uuid),api.confirm_import(uuid,uuid,integer,jsonb),api.unmatch_import(uuid,uuid,integer),api.undo_import(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function api.import_statement_read(uuid,uuid,jsonb,uuid),api.import_original_file(uuid,uuid),api.import_review(uuid,uuid),api.import_overview(uuid),api.confirm_import(uuid,uuid,integer,jsonb),api.unmatch_import(uuid,uuid,integer),api.undo_import(uuid,uuid,integer,text,jsonb) to authenticated;
commit;
