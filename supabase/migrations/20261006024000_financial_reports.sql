begin;
-- Read-only, canonical report models. Amounts are integer cents; percentages
-- have one decimal. Private helpers cannot be invoked with client-supplied data.
create function private.report_merge(p_rows jsonb,p_more jsonb) returns jsonb
language sql immutable set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'source_id',source_id,'priority',priority,'installment',installment,'amount_cents',amount) order by priority,account_id,source_id),'[]')
from (select value->>'account_id' account_id,value->>'source_id' source_id,(value->>'priority')::integer priority,coalesce((value->>'installment')::boolean,false) installment,sum((value->>'amount_cents')::bigint)::bigint amount
 from jsonb_array_elements(p_rows||p_more) group by 1,2,3,4) q where amount<>0;
$$;
create function private.report_allocate(p_rows jsonb,p_value bigint) returns jsonb
language plpgsql immutable set search_path='' as $$
declare remaining jsonb:=p_rows; allocation jsonb:='[]'; group_rows jsonb; weights bigint[]; parts bigint[]; total bigint; take bigint; left_value bigint:=p_value; item jsonb; i integer; priority integer;
begin
 if p_value<0 then raise exception 'Allocation requires nonnegative payment' using errcode='23514'; end if;
 for priority in select distinct (value->>'priority')::integer from jsonb_array_elements(p_rows) order by 1 loop
  select jsonb_agg(value order by value->>'account_id',value->>'source_id'),array_agg((value->>'amount_cents')::bigint order by value->>'account_id',value->>'source_id'),sum((value->>'amount_cents')::bigint)::bigint
   into group_rows,weights,total from jsonb_array_elements(remaining) where (value->>'priority')::integer=priority;
  if coalesce(total,0)<=0 or left_value=0 then continue; end if;
  take:=least(left_value,total); parts:=private.divide_cents(take,weights); i:=0;
  for item in select value from jsonb_array_elements(group_rows) loop
   i:=i+1; allocation:=allocation||jsonb_build_array(item||jsonb_build_object('amount_cents',parts[i]));
   remaining:=private.report_merge(remaining,jsonb_build_array(item||jsonb_build_object('amount_cents',-parts[i])));
  end loop;
  left_value:=left_value-take;
 end loop;
 if left_value>0 then
  item:=jsonb_build_object('account_id',null,'source_id',null,'priority',2,'installment',false,'amount_cents',left_value);
  allocation:=allocation||jsonb_build_array(item);
  remaining:=private.report_merge(remaining,jsonb_build_array(item||jsonb_build_object('amount_cents',-left_value)));
 end if;
 return jsonb_build_object('remaining',remaining,'allocation',private.report_merge('[]',allocation));
end;
$$;

create function private.report_consumption(p_space uuid,p_month date,p_on date,p_account uuid default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare rows jsonb; photo jsonb;
begin
 if p_account is null then
  select s.controls into photo from finance.period_closings c join finance.month_snapshots s on s.id=c.snapshot_id where c.financial_space_id=p_space and c.month=p_month and c.reopened_at is null;
 end if;
 if photo is not null then rows:=photo->'consumption';
 else
  select coalesce(jsonb_agg(jsonb_build_object('account_id',q.ledger_account_id,'class',q.account_class,'original_competence_month',q.original_competence_month,'amount_cents',q.amount) order by q.ledger_account_id,q.original_competence_month),'[]') into rows
  from (select e.ledger_account_id,a.account_class,e.original_competence_month,sum(e.amount_cents)::bigint amount from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.financial_space_id=p_space and e.effective_competence_month=p_month and e.occurred_on<=p_on and a.account_class in('income','expense') and (p_account is null or exists(select 1 from finance.ledger_entries ce join finance.financial_accounts f on f.ledger_account_id=ce.ledger_account_id where ce.ledger_transaction_id=e.ledger_transaction_id and f.id=p_account)) group by 1,2,3) q;
 end if;
 select rows||coalesce(jsonb_agg(jsonb_build_object('account_id',q.id,'class','expense','original_competence_month',q.original_competence_month,'amount_cents',q.amount)),'[]') into rows from (select a.id,e.original_competence_month,sum(e.amount_cents)::bigint amount from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.system_role='balance_adjustment' where e.financial_space_id=p_space and e.effective_competence_month=p_month and e.occurred_on<=p_on and (p_account is null or exists(select 1 from finance.ledger_entries ce join finance.financial_accounts f on f.ledger_account_id=ce.ledger_account_id where ce.ledger_transaction_id=e.ledger_transaction_id and f.id=p_account)) group by a.id,e.original_competence_month) q;
 select coalesce(jsonb_agg(value||jsonb_build_object('label',case when value->>'original_competence_month' is not null then 'De meses anteriores' when a.system_role='balance_adjustment' then 'Diferença não identificada' else a.name end,'category_id',c.id,'parent_id',c.parent_id,'income_class',c.income_class,'display_amount_cents',case when value->>'class'='income' then -(value->>'amount_cents')::bigint else (value->>'amount_cents')::bigint end) order by value->>'class',value->>'account_id',value->>'original_competence_month'),'[]') into rows from jsonb_array_elements(rows) q(value) join finance.ledger_accounts a on a.id=(value->>'account_id')::uuid left join finance.categories c on c.ledger_account_id=a.id;
 return jsonb_build_object('base','competence','snapshot',photo is not null,'items',rows,'income_cents',coalesce((select -sum((value->>'amount_cents')::bigint) from jsonb_array_elements(rows) where value->>'class'='income'),0),'expense_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(rows) where value->>'class'='expense'),0));
end;
$$;

create function api.reports_summary(p_space uuid,p_month date,p_account uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date:=private.space_today(p_space); consumption jsonb; installments jsonb; cash_rows jsonb; benefits jsonb; sections jsonb; benefit_sections jsonb; comparison jsonb:='[]'; worth jsonb:='[]'; control jsonb; previous_control jsonb; report_month date; month_on date; monthly jsonb; previous_expense bigint; current_expense bigint; change bigint; growth bigint; opening bigint; equity_rows jsonb; health jsonb; i integer; available_accounts jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 or p_month>date_trunc('month',day)::date then raise exception 'Report month must be a current or past month beginning on day one' using errcode='23514'; end if;
 if p_account is not null and not exists(select 1 from finance.financial_accounts f where f.id=p_account and f.financial_space_id=p_space and f.deleted_at is null) then raise exception 'Report account not found in space' using errcode='23514'; end if;
 consumption:=private.report_consumption(p_space,p_month,day,p_account);
 select coalesce(jsonb_agg(value||jsonb_build_object('label',a.name) order by value->>'transaction_id'),'[]') into installments from jsonb_array_elements(private.report_health_expenses(p_space,day)) q(value) join finance.ledger_accounts a on a.id=(value->>'account_id')::uuid where (value->>'month')::date=p_month and (p_account is null or exists(select 1 from finance.ledger_entries e join finance.financial_accounts f on f.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id=(value->>'transaction_id')::uuid and f.id=p_account));
 cash_rows:=private.report_cash_rows(p_space,p_month,(p_month+interval '1 month')::date,day,'cash',p_account);
 benefits:=private.report_cash_rows(p_space,p_month,(p_month+interval '1 month')::date,day,'benefit',p_account);
 select jsonb_object_agg(section,coalesce(amount,0)) into sections from unnest(array['operational','debts','investments','people']) names(section) left join lateral(select sum((value->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(cash_rows) where value->>'section'=section) q on true;
 select jsonb_object_agg(section,coalesce(amount,0)) into benefit_sections from unnest(array['operational','debts','investments','people']) names(section) left join lateral(select sum((value->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(benefits) where value->>'section'=section) q on true;
 for i in reverse 5..0 loop
  report_month:=(p_month-make_interval(months=>i))::date; month_on:=least(day,(report_month+interval '1 month'-interval '1 day')::date);
  monthly:=private.report_consumption(p_space,report_month,day,p_account); current_expense:=(monthly->>'expense_cents')::bigint;
  comparison:=comparison||jsonb_build_array(jsonb_build_object('month',report_month,'income_cents',(monthly->>'income_cents')::bigint,'expense_cents',current_expense,'snapshot',(monthly->>'snapshot')::boolean,'expense_change_percent',case when previous_expense<>0 then round((current_expense-previous_expense)::numeric/abs(previous_expense)*100,1) end));
  previous_expense:=current_expense;
  select s.controls into control from finance.period_closings c join finance.month_snapshots s on s.id=c.snapshot_id where c.financial_space_id=p_space and c.month=report_month and c.reopened_at is null;
  if control is null then
   select jsonb_build_object('net_worth_cents',coalesce(sum(q.balance) filter(where q.account_class in('asset','liability')),0),'balances',coalesce(jsonb_agg(jsonb_build_object('account_id',q.id,'balance_cents',q.balance)),'[]')) into control from (select a.id,a.account_class,private.account_balance_on(p_space,a.id,month_on) as balance from finance.ledger_accounts a where a.financial_space_id=p_space) q;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'label',a.name,'class',a.account_class,'liquidity',a.liquidity,'balance_cents',(value->>'balance_cents')::bigint)),'[]') into equity_rows from jsonb_array_elements(control->'balances') q(value) join finance.ledger_accounts a on a.id=(value->>'account_id')::uuid where a.account_class in('asset','liability');
  select coalesce(-sum(e.amount_cents) filter(where a.system_role='opening'),0)::bigint,coalesce(-sum(e.amount_cents) filter(where a.account_class in('income','expense') or a.system_role in('investment_result','balance_adjustment')),0)::bigint into opening,growth from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.financial_space_id=p_space and e.occurred_on>=report_month and e.occurred_on<=month_on;
  worth:=worth||jsonb_build_array(jsonb_build_object('month',report_month,'base','financial_date','net_worth_cents',(control->>'net_worth_cents')::bigint,'snapshot',exists(select 1 from finance.period_closings c where c.financial_space_id=p_space and c.month=report_month and c.reopened_at is null),'opening_cents',opening,'growth_cents',growth,'items',equity_rows));
 end loop;
 health:=api.financial_health(p_space,day);
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'archived',f.archived_at is not null) order by f.name,f.id),'[]') into available_accounts from finance.financial_accounts f where f.financial_space_id=p_space and f.deleted_at is null;
 return jsonb_build_object('month',p_month,'as_of',day,'account_id',p_account,'available_accounts',available_accounts,'consumption',consumption,'installment_consumption',jsonb_build_object('base','effective_statement_due_month','expense_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(installments)),0),'items',installments),'cash_flow',jsonb_build_object('base','financial_date_cash','sections',sections,'net_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(cash_rows) where value->>'section'<>'opening'),0),'opening_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(cash_rows) where value->>'section'='opening'),0),'items',cash_rows),'benefit_flow',jsonb_build_object('base','financial_date_benefit','sections',benefit_sections,'net_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(benefits) where value->>'section'<>'opening'),0),'items',benefits),'comparison',comparison,'net_worth',worth,'future_installments',health->'future_installments');
end;
$$;

create function private.report_csv_cell(p_value text,p_safe boolean default true) returns text
language sql immutable set search_path='' as $$
select '"'||replace(case when p_safe and coalesce(p_value,'')~'^[=+@\-\t\r]' then ''''||p_value else coalesce(p_value,'') end,'"','""')||'"';
$$;
create function api.export_financial_report(p_space uuid,p_report text,p_month date,p_format text default 'spreadsheet',p_account uuid default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare data jsonb; rows jsonb; item jsonb; output text; separator text; spreadsheet boolean; date_value date; amount numeric; label text; metric record; unit text; rendered text;
begin
 if p_format not in('spreadsheet','technical') or p_report not in('consumption','installment_consumption','cash_flow','benefit_flow','net_worth','future_installments','financial_health') then raise exception 'Unsupported export report or format' using errcode='23514'; end if;
 spreadsheet:=p_format='spreadsheet'; separator:=case when spreadsheet then ';' else ',' end;
 if p_report='financial_health' then
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 or p_month>date_trunc('month',private.space_today(p_space))::date then raise exception 'Report month must be a current or past month beginning on day one' using errcode='23514'; end if;
  data:=api.financial_health(p_space,least(private.space_today(p_space),(p_month+interval '1 month'-interval '1 day')::date));
  output:=case when spreadsheet then chr(65279)||'Indicador;Valor;Unidade;Janela inicial;Janela final' else 'indicator,value,unit,from_month,to_month' end||chr(10);
  for metric in select key,value from jsonb_each(data->'metrics') order by key loop
   unit:=case when metric.key like '%_cents' then case when spreadsheet then 'R$' else 'cents' end when metric.key='emergency_months' then 'months' else 'percent' end;
   amount:=case when metric.value='null'::jsonb then null else metric.value::text::numeric end;
   label:=case metric.key when 'monthly_cost_cents' then 'Custo médio mensal' when 'total_income_cents' then 'Renda total' when 'recurring_income_average_cents' then 'Renda recorrente média' when 'savings_percent' then 'Taxa de poupança' when 'income_commitment_percent' then 'Comprometimento da renda' when 'emergency_months' then 'Reserva de emergência em meses' when 'credit_cost_cents' then 'Custo de crédito total' when 'credit_cost_average_cents' then 'Custo de crédito médio mensal' when 'credit_cost_income_percent' then 'Custo de crédito em relação à renda' end;
   rendered:=case when amount is null then case when spreadsheet then '—' else '' end when spreadsheet and unit='R$' then replace(to_char(amount/100,'FM999999999999999990.00'),'.',',') when spreadsheet then replace(amount::text,'.',',') else amount::text end;
   output:=output||private.report_csv_cell(case when spreadsheet then label else metric.key end)||separator||private.report_csv_cell(rendered,false)||separator||private.report_csv_cell(unit)||separator||private.report_csv_cell(data#>>'{window,from_month}')||separator||private.report_csv_cell(data#>>'{window,to_month}')||chr(10);
  end loop;
  return output;
 end if;
 data:=api.reports_summary(p_space,p_month,p_account);
 rows:=case when p_report='net_worth' then data->'net_worth' else data->p_report->'items' end;
 output:=case when spreadsheet then chr(65279) else '' end||case when spreadsheet then 'Data;Descrição;Valor (R$)' else 'date,label,amount_cents,transaction_id,account_id,source_id' end||chr(10);
 for item in select value from jsonb_array_elements(rows) loop
  date_value:=coalesce((item->>'on')::date,(item->>'month')::date,(item->>'due_on')::date,p_month);
  amount:=coalesce((item->>'amount_cents')::numeric,(item->>'net_worth_cents')::numeric);
  if p_report='consumption' and item->>'class'='income' then amount:=-amount; end if;
  label:=coalesce(item->>'label',item->>'description',case when p_report='net_worth' then 'Patrimônio líquido' else 'Sem identificação' end);
  output:=output||private.report_csv_cell(case when spreadsheet then to_char(date_value,'DD/MM/YYYY') else date_value::text end)||separator||private.report_csv_cell(label)||separator||private.report_csv_cell(case when spreadsheet then replace(to_char(amount/100,'FM999999999999999990.00'),'.',',') else amount::text end,false);
  if not spreadsheet then output:=output||separator||private.report_csv_cell(item->>'transaction_id')||separator||private.report_csv_cell(item->>'account_id')||separator||private.report_csv_cell(item->>'source_id'); end if;
  output:=output||chr(10);
 end loop;
 return output;
end;
$$;

-- Composition of an ordinary card event, cumulatively divided between parts.
-- Negative counterweights (refund/cashback) retain their economic sign.
create function private.report_card_part(p_space uuid,p_entry uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare entry finance.ledger_entries; tx finance.ledger_transactions; weights bigint[]; accounts uuid[]; parts bigint[]; before_parts bigint[]; total bigint; previous bigint; sum_weights bigint; result jsonb:='[]'; i integer; source uuid; installment boolean;
begin
 select * into entry from finance.ledger_entries where id=p_entry and financial_space_id=p_space;
 select * into tx from finance.ledger_transactions where id=entry.ledger_transaction_id;
 source:=case when tx.kind='refund' then tx.related_transaction_id else tx.id end;
 select coalesce(bool_or(installment_count>=2),false) into installment from finance.ledger_entries where ledger_transaction_id=source;
 select array_agg(e.amount_cents order by e.line_number),array_agg(e.ledger_account_id order by e.line_number),sum(e.amount_cents)::bigint into weights,accounts,sum_weights
  from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id
  where e.ledger_transaction_id=tx.id and e.card_statement_id is null and a.liquidity is distinct from 'cash';
 total:=-entry.amount_cents;
 if weights is null or sum_weights=0 then return jsonb_build_array(jsonb_build_object('account_id',null,'source_id',tx.id,'priority',2,'installment',coalesce(entry.installment_count>=2,false),'amount_cents',total)); end if;
 if sum_weights<0 then select array_agg(-w order by ordinal) into weights from unnest(weights) with ordinality q(w,ordinal); end if;
 select coalesce(-sum(amount_cents),0)::bigint into previous from finance.ledger_entries where ledger_transaction_id=tx.id and card_statement_id is not null and line_number<entry.line_number;
 parts:=private.divide_cents(previous+total,weights); before_parts:=private.divide_cents(previous,weights);
 for i in 1..array_length(weights,1) loop
  result:=result||jsonb_build_array(jsonb_build_object('account_id',accounts[i],'source_id',source,'priority',2,'installment',installment,'amount_cents',parts[i]-before_parts[i]));
 end loop;
 return private.report_merge('[]',result);
end;
$$;

-- Replay only payment allocation; economic composition is finalized at p_on.
-- Carry/financing recursively inherit the unpaid source, before that transfer.
create function private.report_statement_composition(p_space uuid,p_statement uuid,p_on date,p_before bigint default null,p_depth integer default 0) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb:='[]'; rows jsonb; source_rows jsonb; event record; source_statement uuid; weights bigint[]; parts bigint[]; before_parts bigint[]; accumulated bigint; source_total bigint; account uuid; item jsonb; idx integer; gross bigint; discount bigint; original_entry uuid; allocation jsonb; cursor_on date;
begin
 if p_depth>600 then raise exception 'Card composition recursion limit' using errcode='23514'; end if;
 select t.occurred_on into cursor_on from finance.ledger_transactions t where t.financial_space_id=p_space and t.registration_order=p_before;
 for event in select e.*,t.kind,t.related_transaction_id,t.registration_order,t.occurred_on from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and t.occurred_on<=p_on
  where e.financial_space_id=p_space and e.card_statement_id=p_statement and t.kind<>'card_payment' order by t.occurred_on,t.registration_order,e.line_number loop
  if event.kind in('card_rollover','card_installment_plan','card_credit_carry') then
   select e.card_statement_id into source_statement from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=event.ledger_transaction_id order by s.reference_month,e.line_number limit 1;
   if source_statement=p_statement then continue; end if;
   if event.kind='card_credit_carry' then
    rows:=jsonb_build_array(jsonb_build_object('account_id',null,'source_id',event.ledger_transaction_id,'priority',2,'installment',false,'amount_cents',-event.amount_cents));
   else
    source_rows:=private.report_statement_composition(p_space,source_statement,event.occurred_on,event.registration_order,p_depth+1);
    if event.kind='card_installment_plan' then
     -- Financing retains principal categories; only its incremental charges
     -- are new consumption. The whole financed debt is an installment group.
     select private.report_merge(source_rows,coalesce(jsonb_agg(jsonb_build_object('account_id',e.ledger_account_id,'source_id',event.ledger_transaction_id,'priority',2,'installment',true,'amount_cents',e.amount_cents)),'[]')) into source_rows
      from finance.ledger_entries e where e.ledger_transaction_id=event.ledger_transaction_id and e.card_statement_id is null;
    end if;
    select array_agg((value->>'amount_cents')::bigint order by ordinal),sum((value->>'amount_cents')::bigint)::bigint into weights,source_total from jsonb_array_elements(source_rows) with ordinality q(value,ordinal);
    select coalesce(-sum(e.amount_cents),0)::bigint into accumulated from finance.ledger_entries e where e.ledger_transaction_id=event.ledger_transaction_id and e.amount_cents<0 and e.card_statement_id is not null and e.line_number<event.line_number;
    rows:='[]';
    if coalesce(source_total,0)>0 then
     parts:=private.divide_cents(accumulated-event.amount_cents,weights); before_parts:=private.divide_cents(accumulated,weights); idx:=0;
     for item in select value from jsonb_array_elements(source_rows) loop
      idx:=idx+1; rows:=rows||jsonb_build_array(item||jsonb_build_object('priority',case when event.kind='card_rollover' then 1 else 2 end,'installment',event.kind='card_installment_plan' or coalesce((item->>'installment')::boolean,false),'amount_cents',parts[idx]-before_parts[idx]));
     end loop;
    else rows:=jsonb_build_array(jsonb_build_object('account_id',null,'source_id',event.ledger_transaction_id,'priority',2,'installment',event.kind='card_installment_plan','amount_cents',-event.amount_cents)); end if;
   end if;
  elsif event.kind='card_prepayment' then
   -- Technical source credits remove the original purchase composition;
   -- its destination inherits that composition and the explicit discount.
   source_rows:='[]';
   for original_entry in select oe.id from finance.ledger_entries oe join finance.ledger_entries pe on pe.card_statement_id=oe.card_statement_id and pe.ledger_transaction_id=event.ledger_transaction_id and pe.amount_cents>0 where oe.ledger_transaction_id=event.related_transaction_id and oe.card_statement_id is not null loop
    rows:=private.report_card_part(p_space,original_entry);
    select -oe.amount_cents,pe.amount_cents into source_total,gross from finance.ledger_entries oe join finance.ledger_entries pe on pe.card_statement_id=oe.card_statement_id and pe.ledger_transaction_id=event.ledger_transaction_id and pe.amount_cents>0 where oe.id=original_entry;
    select array_agg((value->>'amount_cents')::bigint order by ordinal) into weights from jsonb_array_elements(rows) with ordinality q(value,ordinal);
    if source_total>0 then
     parts:=private.divide_cents(gross,weights); idx:=0;
     for item in select value from jsonb_array_elements(rows) loop idx:=idx+1;
      source_rows:=source_rows||jsonb_build_array(item||jsonb_build_object('amount_cents',parts[idx]));
     end loop;
    end if;
   end loop;
   if event.amount_cents>0 then
    select oe.id into original_entry from finance.ledger_entries oe where oe.ledger_transaction_id=event.related_transaction_id and oe.card_statement_id=event.card_statement_id limit 1;
    rows:=private.report_card_part(p_space,original_entry);
    select array_agg((value->>'amount_cents')::bigint order by ordinal) into weights from jsonb_array_elements(rows) with ordinality q(value,ordinal);
    parts:=private.divide_cents(-event.amount_cents,weights); idx:=0; source_rows:='[]';
    for item in select value from jsonb_array_elements(rows) loop idx:=idx+1; source_rows:=source_rows||jsonb_build_array(item||jsonb_build_object('amount_cents',parts[idx])); end loop;
    rows:=source_rows;
   else
    select private.report_merge(source_rows,coalesce(jsonb_agg(jsonb_build_object('account_id',e.ledger_account_id,'source_id',event.related_transaction_id,'priority',2,'installment',true,'amount_cents',e.amount_cents)),'[]')) into rows from finance.ledger_entries e where e.ledger_transaction_id=event.ledger_transaction_id and e.card_statement_id is null;
   end if;
  else rows:=private.report_card_part(p_space,event.id); end if;
  result:=private.report_merge(result,rows);
 end loop;
 for event in select e.amount_cents,t.kind,t.registration_order from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and t.occurred_on<=p_on
  where e.financial_space_id=p_space and e.card_statement_id=p_statement and (p_before is null or (t.occurred_on,t.registration_order)<(cursor_on,p_before))
   and (t.kind='card_payment' or t.kind in('card_rollover','card_installment_plan','card_credit_carry') and e.card_statement_id=(select e2.card_statement_id from finance.ledger_entries e2 join finance.card_statements s2 on s2.id=e2.card_statement_id where e2.ledger_transaction_id=e.ledger_transaction_id order by s2.reference_month,e2.line_number limit 1)) order by t.occurred_on,t.registration_order loop
  if event.amount_cents>0 then result:=private.report_allocate(result,event.amount_cents)->'remaining'; end if;
 end loop;
 return result;
end;
$$;

create function private.report_section(p_account uuid) returns text
language sql stable set search_path='' as $$
select coalesce((select case when account_class in('income','expense') or system_role='balance_adjustment' then 'operational' when owner_type='loan' then 'debts' when owner_type='person' then 'people' when liquidity in('investment','property') or system_role='investment_result' then 'investments' when liquidity='benefit' then 'operational' when system_role='opening' then 'opening' else 'operational' end from finance.ledger_accounts where id=p_account),'operational');
$$;

create function private.report_cash_rows(p_space uuid,p_from date,p_until date,p_on date,p_liquidity text default 'cash',p_account uuid default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb:='[]'; tx record; entry record; cash_total bigint; selected_total bigint; weights bigint[]; account_ids uuid[]; parts bigint[]; composition jsonb; allocation jsonb; item jsonb; i integer; sum_weights bigint; card_weights bigint[]; card_parts bigint[]; card_index integer;
begin
 for tx in select t.* from finance.ledger_transactions t where t.financial_space_id=p_space and t.status='posted' and t.occurred_on>=p_from and t.occurred_on<p_until and t.occurred_on<=p_on order by t.occurred_on,t.registration_order loop
  select coalesce(sum(e.amount_cents),0)::bigint,coalesce(sum(e.amount_cents) filter(where p_account is null or f.id=p_account),0)::bigint into cash_total,selected_total
   from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.liquidity=p_liquidity left join finance.financial_accounts f on f.ledger_account_id=a.id where e.ledger_transaction_id=tx.id;
  if cash_total=0 or selected_total=0 then continue; end if;
  select array_agg(e.amount_cents order by e.line_number),array_agg(e.ledger_account_id order by e.line_number),sum(e.amount_cents)::bigint into weights,account_ids,sum_weights
   from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.ledger_transaction_id=tx.id and a.liquidity is distinct from p_liquidity and a.owner_type<>'credit_card';
  if coalesce(sum_weights,0)<>0 then
   if sum_weights<0 then select array_agg(-w order by ordinal) into weights from unnest(weights) with ordinality q(w,ordinal); end if;
   parts:=private.divide_cents(selected_total,weights);
   for i in 1..array_length(weights,1) loop
    result:=result||jsonb_build_array(jsonb_build_object('transaction_id',tx.id,'on',tx.occurred_on,'description',tx.description,'account_id',account_ids[i],'section',private.report_section(account_ids[i]),'amount_cents',parts[i]));
   end loop;
  else
   select array_agg(e.amount_cents order by e.line_number) into card_weights from finance.ledger_entries e where e.ledger_transaction_id=tx.id and e.card_statement_id is not null;
   if card_weights is null then continue; end if;
   if (select sum(w) from unnest(card_weights) w)<0 then select array_agg(-w order by ordinal) into card_weights from unnest(card_weights) with ordinality q(w,ordinal); end if;
   card_parts:=private.divide_cents(selected_total,card_weights); card_index:=0;
   for entry in select e.* from finance.ledger_entries e where e.ledger_transaction_id=tx.id and e.card_statement_id is not null order by e.line_number loop
    card_index:=card_index+1;
    if entry.amount_cents>0 then
     composition:=private.report_statement_composition(p_space,entry.card_statement_id,p_on,tx.registration_order);
     allocation:=private.report_allocate(composition,entry.amount_cents)->'allocation';
     select array_agg((value->>'amount_cents')::bigint order by ordinal) into weights from jsonb_array_elements(allocation) with ordinality q(value,ordinal);
     parts:=private.divide_cents(card_parts[card_index],weights); i:=0;
     for item in select value from jsonb_array_elements(allocation) loop
      i:=i+1; result:=result||jsonb_build_array(jsonb_build_object('transaction_id',tx.id,'source_id',item->>'source_id','on',tx.occurred_on,'description',tx.description,'statement_id',entry.card_statement_id,'account_id',item->>'account_id','section',case when private.report_section((item->>'account_id')::uuid)='opening' then 'operational' else private.report_section((item->>'account_id')::uuid) end,'amount_cents',parts[i]));
     end loop;
    else result:=result||jsonb_build_array(jsonb_build_object('transaction_id',tx.id,'on',tx.occurred_on,'description',tx.description,'statement_id',entry.card_statement_id,'account_id',null,'section','operational','amount_cents',card_parts[card_index])); end if;
   end loop;
  end if;
 end loop;
 select coalesce(jsonb_agg(value||jsonb_build_object('label',coalesce(a.name,case when value ? 'statement_id' then 'Cartão: não alocado' else 'Sem identificação' end))),'[]') into result from jsonb_array_elements(result) q(value) left join finance.ledger_accounts a on a.id=(value->>'account_id')::uuid;
 return result;
end;
$$;

-- Expense items by the alternate installment basis. Refund weights are those
-- of the original purchase, even when the bank credits a different statement.
create function private.report_health_expenses(p_space uuid,p_on date) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb:='[]'; entry record; original uuid; weights bigint[]; dates date[]; statement_ids uuid[]; parts bigint[]; i integer; is_installment boolean; moved record; item record; destination date; redirected date; prior_refund record; original_ids uuid[]; net_component bigint;
begin
 for entry in select e.*,a.account_class,coalesce(c.system_role,a.system_role) as system_role,c.fixity,t.related_transaction_id,t.registration_order from finance.posted_ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.ledger_accounts a on a.id=e.ledger_account_id left join finance.categories c on c.ledger_account_id=a.id
  where e.financial_space_id=p_space and e.occurred_on<=p_on and (a.account_class='expense' or a.system_role='balance_adjustment') order by e.occurred_on,t.registration_order,e.line_number loop
  original:=case when entry.kind='refund' then entry.related_transaction_id else entry.ledger_transaction_id end;
  select array_agg(-e.amount_cents order by e.installment_number,e.line_number),array_agg(date_trunc('month',s.effective_due_on)::date order by e.installment_number,e.line_number),array_agg(s.id order by e.installment_number,e.line_number),bool_or(e.installment_count>=2) into weights,dates,statement_ids,is_installment
   from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=original and e.amount_cents<0;
  if entry.kind='card_prepayment' and exists(select 1 from finance.ledger_entries pe where pe.ledger_transaction_id=entry.related_transaction_id and pe.installment_count>=2) then is_installment:=true; end if;
  if coalesce(is_installment,false) then
   parts:=private.divide_cents(entry.amount_cents,weights);
   for i in 1..array_length(weights,1) loop
    redirected:=null;
    if entry.kind='refund' then
     select date_trunc('month',ds.effective_due_on)::date into redirected from finance.ledger_transactions pt join finance.ledger_entries source on source.ledger_transaction_id=pt.id and source.card_statement_id=statement_ids[i] and source.amount_cents>0 join finance.ledger_entries destination_entry on destination_entry.ledger_transaction_id=pt.id and destination_entry.card_statement_id is not null and destination_entry.amount_cents<0 join finance.card_statements ds on ds.id=destination_entry.card_statement_id where pt.financial_space_id=p_space and pt.status='posted' and pt.kind='card_prepayment' and pt.related_transaction_id=original and (pt.occurred_on,pt.registration_order)<(entry.occurred_on,entry.registration_order) order by pt.occurred_on,pt.registration_order limit 1;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('transaction_id',entry.ledger_transaction_id,'account_id',entry.ledger_account_id,'month',coalesce(redirected,dates[i]),'amount_cents',parts[i],'group','installments_and_debts','credit_cost',entry.system_role='financial_charges','original_competence_month',entry.original_competence_month));
   end loop;
  else
   result:=result||jsonb_build_array(jsonb_build_object('transaction_id',entry.ledger_transaction_id,'account_id',entry.ledger_account_id,'month',entry.effective_competence_month,'amount_cents',entry.amount_cents,'group',case when entry.system_role='balance_adjustment' then 'unidentified_adjustments' when entry.system_role='financial_charges' then 'installments_and_debts' when entry.fixity='fixed' then 'fixed' else 'variable' end,'credit_cost',entry.system_role='financial_charges','original_competence_month',entry.original_competence_month));
  end if;
 end loop;
 -- Prepaid installments move the purchase's still-outstanding economic
 -- components to the destination due month, without creating new consumption.
 for moved in select t.* from finance.ledger_transactions t where t.financial_space_id=p_space and t.status='posted' and t.kind='card_prepayment' and t.occurred_on<=p_on order by t.occurred_on,t.registration_order loop
  select date_trunc('month',s.effective_due_on)::date into destination from finance.ledger_entries pe join finance.card_statements s on s.id=pe.card_statement_id where pe.ledger_transaction_id=moved.id and pe.amount_cents<0 limit 1;
  select array_agg(-oe.amount_cents order by oe.installment_number,oe.line_number),array_agg(oe.id order by oe.installment_number,oe.line_number) into weights,original_ids from finance.ledger_entries oe where oe.ledger_transaction_id=moved.related_transaction_id and oe.card_statement_id is not null and oe.amount_cents<0;
  for item in select oe.*,date_trunc('month',s.effective_due_on)::date as source_month from finance.ledger_entries oe join finance.card_statements s on s.id=oe.card_statement_id join finance.ledger_entries pe on pe.ledger_transaction_id=moved.id and pe.card_statement_id=oe.card_statement_id and pe.amount_cents>0 where oe.ledger_transaction_id=moved.related_transaction_id and oe.amount_cents<0 order by oe.installment_number loop
   i:=array_position(original_ids,item.id);
   for entry in select oe.ledger_account_id,oe.amount_cents,c.system_role from finance.ledger_entries oe join finance.ledger_accounts a on a.id=oe.ledger_account_id and a.account_class='expense' left join finance.categories c on c.ledger_account_id=a.id where oe.ledger_transaction_id=moved.related_transaction_id order by oe.line_number loop
    parts:=private.divide_cents(entry.amount_cents,weights); net_component:=parts[i];
    for prior_refund in select re.amount_cents from finance.ledger_transactions rt join finance.ledger_entries re on re.ledger_transaction_id=rt.id and re.ledger_account_id=entry.ledger_account_id where rt.financial_space_id=p_space and rt.status='posted' and rt.kind='refund' and rt.related_transaction_id=moved.related_transaction_id and (rt.occurred_on,rt.registration_order)<(moved.occurred_on,moved.registration_order) loop
     parts:=private.divide_cents(prior_refund.amount_cents,weights); net_component:=net_component+parts[i];
    end loop;
    result:=result||jsonb_build_array(jsonb_build_object('transaction_id',moved.id,'account_id',entry.ledger_account_id,'month',item.source_month,'amount_cents',-net_component,'group','installments_and_debts','credit_cost',entry.system_role='financial_charges'),jsonb_build_object('transaction_id',moved.id,'account_id',entry.ledger_account_id,'month',destination,'amount_cents',net_component,'group','installments_and_debts','credit_cost',entry.system_role='financial_charges'));
   end loop;
  end loop;
 end loop;
 return result;
end;
$$;

create function private.report_window(p_space uuid,p_on date) returns jsonb
language plpgsql stable set search_path='' as $$
declare first_day date; first_month date; last_month date:=(date_trunc('month',p_on)-interval '1 month')::date; from_month date; months integer; unclosed jsonb;
begin
 select min(occurred_on) into first_day from finance.ledger_transactions where financial_space_id=p_space and status='posted' and kind<>'opening' and occurred_on<=p_on;
 first_month:=date_trunc('month',first_day)::date;
 if first_day>first_month then first_month:=(first_month+interval '1 month')::date; end if;
 from_month:=greatest((last_month-interval '11 months')::date,first_month);
 months:=case when first_day is null or first_month>last_month then 0 else (extract(year from age(last_month,from_month))*12+extract(month from age(last_month,from_month))+1)::integer end;
 select coalesce(jsonb_agg(d::date order by d),'[]') into unclosed from generate_series(from_month::timestamp,last_month::timestamp,interval '1 month') d where months>0 and not exists(select 1 from finance.period_closings c where c.financial_space_id=p_space and c.month=d::date and c.reopened_at is null);
 return jsonb_build_object('from_month',case when months>0 then from_month end,'to_month',last_month,'months',months,'estimated',months between 3 and 11,'sufficient',months>=3,'reason',case when months<3 then 'insufficient_complete_months' end,'unclosed_months',unclosed);
end;
$$;

create function private.report_future_installments(p_space uuid,p_on date,p_recurring_average numeric) returns jsonb
language plpgsql stable set search_path='' as $$
declare input jsonb; horizon date; boundaries date[]; cycle_day integer; items jsonb:='[]'; series jsonb:='[]'; row record; composition jsonb; item jsonb; i integer; amount bigint; total bigint; cycle_amount bigint; six_total bigint:=0; due date;
begin
 input:=api.free_to_spend_input(p_space,p_on); horizon:=(input->>'horizonEnd')::date;
 select fallback_cycle_day into cycle_day from finance.space_settings where financial_space_id=p_space;
 select array_agg(d order by d) into boundaries from (select distinct (value->>'effectiveDueOn')::date d from jsonb_array_elements(input->'commitments') where coalesce((value->>'mainIncome')::boolean,false) and not (value->>'cancelled')::boolean and (value->>'effectiveDueOn')::date>=horizon order by d limit 7) q;
 boundaries:=coalesce(boundaries,array[horizon]);
 if boundaries[1]<>horizon then boundaries:=array_prepend(horizon,boundaries); end if;
 while cardinality(boundaries)<7 loop
  boundaries:=array_append(boundaries,private.clamped_day((date_trunc('month',boundaries[cardinality(boundaries)])+interval '1 month')::date,cycle_day));
 end loop;
 for row in select s.*,c.name from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id where s.financial_space_id=p_space and s.period_start>p_on order by s.effective_due_on,s.id loop
  composition:=private.report_statement_composition(p_space,row.id,p_on);
  for item in select value from jsonb_array_elements(composition) where (value->>'priority')::integer=2 and (value->>'installment')::boolean loop
   amount:=(item->>'amount_cents')::bigint;
   if amount=0 then continue; end if;
   items:=items||jsonb_build_array(jsonb_build_object('kind','card','statement_id',row.id,'card_id',row.credit_card_id,'source_id',item->>'source_id','account_id',item->>'account_id','label',row.name,'due_on',row.effective_due_on,'amount_cents',amount));
  end loop;
 end loop;
 for row in select l.*,p.effective_due_on,p.remaining_cents,loan.name from finance.loan_installments l join finance.loan_installment_progress p on p.id=l.id join finance.loans loan on loan.id=l.loan_id where l.financial_space_id=p_space and l.superseded_at is null and p.remaining_cents>0 and p.effective_due_on>=horizon order by p.effective_due_on,l.id loop
  items:=items||jsonb_build_array(jsonb_build_object('kind','loan','loan_id',row.loan_id,'installment_id',row.id,'label',row.name,'due_on',row.effective_due_on,'amount_cents',row.remaining_cents));
 end loop;
 select greatest(0,coalesce(sum((value->>'amount_cents')::bigint),0))::bigint into total from jsonb_array_elements(items);
 for i in 1..6 loop
  select greatest(0,coalesce(sum((value->>'amount_cents')::bigint),0))::bigint into cycle_amount from jsonb_array_elements(items) where (value->>'due_on')::date>=boundaries[i] and (value->>'due_on')::date<boundaries[i+1];
  six_total:=six_total+cycle_amount;
  series:=series||jsonb_build_array(jsonb_build_object('from',boundaries[i],'until',boundaries[i+1],'amount_cents',cycle_amount));
 end loop;
 return jsonb_build_object('base','effective_due_date_income_cycle','total_cents',total,'next_cycle_cents',(series->0->>'amount_cents')::bigint,'average_cents',round(six_total::numeric/6),'income_percent',case when p_recurring_average>0 then round((six_total::numeric/6)/p_recurring_average*100,1) end,'cycles',series,'items',items);
end;
$$;

create function api.financial_health(p_space uuid,p_on date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date:=coalesce(p_on,private.space_today(p_space)); health_window jsonb; expense_rows jsonb; income_rows jsonb; input jsonb; months integer; first_month date; last_month date; next_month date; next_until date; expense bigint; income bigint; recurring bigint; credit bigint; cost numeric; average numeric; groups jsonb; obligations jsonb:='[]'; obligation bigint:=0; amortization bigint:=0; emergency bigint:=0; row record; item jsonb; amount bigint; principal bigint; source_exists boolean; future jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 if not isfinite(day) or day>private.space_today(p_space) then raise exception 'Health date must be finite and not future' using errcode='23514'; end if;
 health_window:=private.report_window(p_space,day); months:=(health_window->>'months')::integer; first_month:=(health_window->>'from_month')::date; last_month:=(health_window->>'to_month')::date;
 next_month:=(date_trunc('month',day)+interval '1 month')::date; next_until:=(next_month+interval '1 month')::date;
 expense_rows:=private.report_health_expenses(p_space,day);
 select coalesce(jsonb_agg(value||jsonb_build_object('label',a.name) order by value->>'month',value->>'transaction_id'),'[]') into expense_rows from jsonb_array_elements(expense_rows) q(value) join finance.ledger_accounts a on a.id=(value->>'account_id')::uuid where (value->>'month')::date between first_month and last_month;
 select coalesce(jsonb_agg(jsonb_build_object('transaction_id',e.ledger_transaction_id,'account_id',a.id,'label',a.name,'month',e.effective_competence_month,'amount_cents',-e.amount_cents,'recurring',c.income_class='recurring') order by e.effective_competence_month,e.id),'[]') into income_rows
  from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='income' join finance.categories c on c.ledger_account_id=a.id where e.financial_space_id=p_space and e.occurred_on<=day and e.effective_competence_month between first_month and last_month and c.system_role is distinct from 'discounts_obtained';
 select coalesce(sum((value->>'amount_cents')::bigint),0)::bigint,coalesce(sum((value->>'amount_cents')::bigint) filter(where (value->>'credit_cost')::boolean),0)::bigint into expense,credit from jsonb_array_elements(expense_rows);
 select coalesce(sum((value->>'amount_cents')::bigint),0)::bigint,coalesce(sum((value->>'amount_cents')::bigint) filter(where (value->>'recurring')::boolean),0)::bigint into income,recurring from jsonb_array_elements(income_rows);
 if months>=3 then cost:=expense::numeric/months; average:=recurring::numeric/months; end if;
 select jsonb_object_agg(name,coalesce(q.amount,0)) into groups from unnest(array['fixed','variable','installments_and_debts','unidentified_adjustments']) names(name) left join lateral(select sum((value->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(expense_rows) where value->>'group'=name) q on true;
 input:=api.free_to_spend_input(p_space,day);
 for row in select c.*,cat.fixity,a.owner_type from finance.commitments c left join finance.categories cat on cat.id=c.category_id left join finance.ledger_accounts a on a.id=c.counterpart_account_id where c.financial_space_id=p_space and c.direction='outflow' and c.effective_due_on>=next_month and c.effective_due_on<next_until and c.deleted_at is null and c.cancelled_at is null loop
  if exists(select 1 from finance.loan_installments l where l.commitment_id=row.id and l.superseded_at is null) then continue; end if;
  if row.recurrence_rule_id is null or not (row.fixity='fixed' or row.owner_type='loan') then continue; end if;
  select value into item from jsonb_array_elements(input->'commitments') where value->>'id'=row.id::text;
  amount:=private.free_considered(item,false); if amount=0 then continue; end if;
  obligation:=obligation+amount;
  if row.owner_type='loan' then amortization:=amortization+amount; end if;
  obligations:=obligations||jsonb_build_array(jsonb_build_object('kind',case when row.owner_type='loan' then 'loan_recurrence' else 'fixed_recurrence' end,'id',row.id,'label',row.title,'due_on',row.effective_due_on,'amount_cents',amount,'principal_cents',case when row.owner_type='loan' then amount else 0 end));
 end loop;
 for row in select l.*,p.remaining_cents,p.principal_paid_cents,p.effective_due_on,loan.name from finance.loan_installments l join finance.loan_installment_progress p on p.id=l.id join finance.loans loan on loan.id=l.loan_id where l.financial_space_id=p_space and l.superseded_at is null and p.remaining_cents>0 and p.effective_due_on>=next_month and p.effective_due_on<next_until loop
  amount:=row.remaining_cents; principal:=greatest(0,row.principal_cents-row.principal_paid_cents); obligation:=obligation+amount; amortization:=amortization+principal;
  obligations:=obligations||jsonb_build_array(jsonb_build_object('kind','loan','id',row.id,'label',row.name,'due_on',row.effective_due_on,'amount_cents',amount,'principal_cents',principal));
 end loop;
 for row in select s.*,c.name from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id where s.financial_space_id=p_space and s.effective_due_on>=next_month and s.effective_due_on<next_until loop
  select greatest(0,coalesce(sum((value->>'amount_cents')::bigint),0))::bigint into amount from jsonb_array_elements(private.report_statement_composition(p_space,row.id,day)) where (value->>'installment')::boolean;
  if amount>0 then obligation:=obligation+amount; obligations:=obligations||jsonb_build_array(jsonb_build_object('kind','card','id',row.id,'label',row.name,'due_on',row.effective_due_on,'amount_cents',amount,'principal_cents',0)); end if;
 end loop;
 -- An investment account marked directly and through an account goal counts
 -- once. Virtual goals are added separately; benefit balances never qualify.
 select coalesce(sum(greatest(0,private.account_balance_on(p_space,f.ledger_account_id,day))),0)::bigint into emergency from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id and a.liquidity='investment' where f.financial_space_id=p_space and f.deleted_at is null and (f.is_emergency_reserve or exists(select 1 from finance.reserves r where r.financial_space_id=p_space and r.financial_account_id=f.id and r.holding_mode='account' and r.is_emergency_reserve and (r.terminal_on is null or r.terminal_on>day) and r.archived_at is null));
 select emergency+coalesce(sum((private.reserve_balance(p_space,r.id,day)->>'balance_cents')::bigint),0)::bigint into emergency from finance.reserves r where r.financial_space_id=p_space and r.holding_mode='virtual' and r.is_emergency_reserve and (r.terminal_on is null or r.terminal_on>day) and r.archived_at is null;
 future:=private.report_future_installments(p_space,day,average);
 return jsonb_build_object('on',day,'window',health_window,'metrics',jsonb_build_object('monthly_cost_cents',round(cost),'total_income_cents',case when months>=3 then income end,'recurring_income_average_cents',round(average),'savings_percent',case when months>=3 and income<>0 then round((income-expense)::numeric/income*100,1) end,'income_commitment_percent',case when average>0 then round(obligation::numeric/average*100,1) end,'emergency_months',case when cost+amortization>0 then round(emergency::numeric/(cost+amortization),2) end,'credit_cost_cents',case when months>=3 then credit end,'credit_cost_average_cents',case when months>=3 then round(credit::numeric/months) end,'credit_cost_income_percent',case when months>=3 and income<>0 then round(credit::numeric/income*100,1) end),'expense_groups',case when months>=3 then groups else null end,'expense_items',expense_rows,'income_items',income_rows,'next_month',next_month,'next_month_obligations',obligations,'next_month_obligations_cents',obligation,'next_month_amortization_cents',amortization,'emergency_reserve_cents',emergency,'future_installments',future);
end;
$$;

revoke all on function private.report_merge(jsonb,jsonb),private.report_allocate(jsonb,bigint),private.report_card_part(uuid,uuid),private.report_statement_composition(uuid,uuid,date,bigint,integer),private.report_section(uuid),private.report_cash_rows(uuid,date,date,date,text,uuid),private.report_health_expenses(uuid,date),private.report_window(uuid,date),private.report_future_installments(uuid,date,numeric),private.report_consumption(uuid,date,date,uuid),private.report_csv_cell(text,boolean) from public,anon,authenticated;
revoke all on function api.financial_health(uuid,date),api.reports_summary(uuid,date,uuid),api.export_financial_report(uuid,text,date,text,uuid) from public,anon,authenticated;
grant execute on function api.financial_health(uuid,date),api.reports_summary(uuid,date,uuid),api.export_financial_report(uuid,text,date,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
