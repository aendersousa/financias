begin;
create function private.report_matches(p_space uuid,p_transaction uuid,p_ledger uuid,p_filters jsonb) returns boolean
language sql stable set search_path='' as $$
with recursive category_ids(id) as (
 select (p_filters->>'category')::uuid where p_filters->>'category' is not null
 union all select c.id from finance.categories c join category_ids parent on c.parent_id=parent.id where c.financial_space_id=p_space
), source as (
 select t.id,t.related_transaction_id from finance.ledger_transactions t where t.id=p_transaction and t.financial_space_id=p_space and t.status='posted'
)
select exists(select 1 from source s where
 (p_filters->>'account' is null or exists(select 1 from finance.ledger_entries e join finance.financial_accounts f on f.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id in(s.id,s.related_transaction_id) and f.financial_space_id=p_space and f.id=(p_filters->>'account')::uuid))
 and (p_filters->>'card' is null or exists(select 1 from finance.ledger_entries e join finance.credit_cards c on c.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id in(s.id,s.related_transaction_id) and c.financial_space_id=p_space and c.id=(p_filters->>'card')::uuid))
 and (p_filters->>'person' is null or exists(select 1 from finance.ledger_entries e join finance.people p on p.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id in(s.id,s.related_transaction_id) and p.financial_space_id=p_space and p.id=(p_filters->>'person')::uuid))
 and (p_filters->>'tag' is null or exists(select 1 from finance.ledger_transaction_tags tag where tag.ledger_transaction_id in(s.id,s.related_transaction_id) and tag.financial_space_id=p_space and tag.tag_id=(p_filters->>'tag')::uuid))
 and (p_filters->>'category' is null or exists(select 1 from finance.categories c where c.ledger_account_id=p_ledger and c.id in(select id from category_ids)))
 and (p_filters->>'essential' is null or exists(select 1 from finance.categories c where c.ledger_account_id=p_ledger and c.financial_space_id=p_space and c.is_essential=(p_filters->>'essential')::boolean))
 and (p_filters->>'fixity' is null or exists(select 1 from finance.categories c where c.ledger_account_id=p_ledger and c.financial_space_id=p_space and c.fixity=p_filters->>'fixity')));
$$;
create function private.validate_report_filters(p_space uuid,p_filters jsonb) returns void
language plpgsql stable set search_path='' as $$
declare filter_key text; filter_id uuid; accepted boolean;
begin
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) key where key not in('account','card','person','tag','category','essential','fixity','from_month','until_month','year')) then raise exception 'Invalid report filters' using errcode='23514'; end if;
 if p_filters->>'fixity' is not null and p_filters->>'fixity' not in('fixed','variable') then raise exception 'Invalid report fixity' using errcode='23514'; end if;
 if p_filters->>'essential' is not null and p_filters->>'essential' not in('true','false') then raise exception 'Invalid essential filter' using errcode='23514'; end if;
 foreach filter_key in array array['account','card','person','tag','category'] loop
  filter_id:=(p_filters->>filter_key)::uuid; if filter_id is null then continue; end if;
  accepted:=case filter_key when 'account' then exists(select 1 from finance.financial_accounts where id=filter_id and financial_space_id=p_space and deleted_at is null) when 'card' then exists(select 1 from finance.credit_cards where id=filter_id and financial_space_id=p_space) when 'person' then exists(select 1 from finance.people where id=filter_id and financial_space_id=p_space and deleted_at is null) when 'tag' then exists(select 1 from finance.tags where id=filter_id and financial_space_id=p_space) else exists(select 1 from finance.categories where id=filter_id and financial_space_id=p_space and deleted_at is null) end;
  if not accepted then raise exception 'Report filter is not in this space' using errcode='23514'; end if;
 end loop;
end;
$$;
create function api.report_filter_options(p_space uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 return jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'archived',archived_at is not null) order by name,id) from finance.financial_accounts where financial_space_id=p_space and deleted_at is null),'[]'),'cards',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'archived',status='archived') order by name,id) from finance.credit_cards where financial_space_id=p_space),'[]'),'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nickname,'archived',archived_at is not null) order by nickname,id) from finance.people where financial_space_id=p_space and deleted_at is null),'[]'),'tags',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'archived',archived_at is not null) order by name,id) from finance.tags where financial_space_id=p_space),'[]'),'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'parent_id',parent_id,'archived',archived_at is not null) order by name,id) from finance.categories where financial_space_id=p_space and deleted_at is null),'[]'));
end;
$$;

create function api.reports_query(p_space uuid,p_report text,p_month date,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date:=private.space_today(p_space); from_month date:=coalesce((p_filters->>'from_month')::date,p_month); until_month date:=coalesce((p_filters->>'until_month')::date,(p_month+interval '1 month')::date); rows jsonb:='[]'; grouped jsonb; income bigint; expenses bigint; original_amount bigint; refunds bigint; report_year integer; category uuid; record record; version finance.recurrence_rule_versions; annual bigint; annual_total bigint:=0; next_due date; metadata jsonb; filtered jsonb; summary jsonb; sections jsonb; opening bigint; category_summary jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 perform private.validate_report_filters(p_space,p_filters);
 if p_report not in('consumption','installment_consumption','cash_flow','benefit_flow','subscriptions','tax_deductible') then raise exception 'Unsupported report' using errcode='23514'; end if;
 if from_month is null or until_month is null or not isfinite(from_month) or not isfinite(until_month) or extract(day from from_month)<>1 or extract(day from until_month)<>1 or until_month<=from_month or until_month>from_month+interval '10 years' then raise exception 'Invalid report period' using errcode='23514'; end if;
 if p_report='subscriptions' then
  for record in select r.* from finance.recurrence_rules r where r.financial_space_id=p_space and r.direction='outflow' and r.is_subscription and r.starts_on<until_month and coalesce(r.ends_on,'infinity'::date)>=from_month and (r.archived_at is null or (r.archived_at at time zone (select timezone from finance.financial_spaces where id=p_space))::date>=from_month) order by r.title,r.id loop
   select * into version from finance.recurrence_rule_versions v where v.recurrence_rule_id=record.id and v.effective_from_period<=private.recurrence_period(until_month-1,record.unit) order by v.version_number desc limit 1;
   if version.id is null then continue; end if;
   if p_filters->>'category' is not null and not exists(with recursive cats(id) as (select (p_filters->>'category')::uuid union all select c.id from finance.categories c join cats on c.parent_id=cats.id where c.financial_space_id=p_space) select 1 from cats where id=version.category_id) then continue; end if;
   if p_filters->>'account' is not null and version.payment_financial_account_id is distinct from (p_filters->>'account')::uuid then continue; end if;
   if p_filters->>'card' is not null and version.payment_credit_card_id is distinct from (p_filters->>'card')::uuid then continue; end if;
   if p_filters->>'essential' is not null and not exists(select 1 from finance.categories c where c.id=version.category_id and c.is_essential=(p_filters->>'essential')::boolean) then continue; end if;
   if p_filters->>'fixity' is not null and not exists(select 1 from finance.categories c where c.id=version.category_id and c.fixity=p_filters->>'fixity') then continue; end if;
   if (p_filters->>'tag' is not null or p_filters->>'person' is not null) and not exists(select 1 from finance.commitments c join finance.ledger_entries e on e.commitment_id=c.id where c.recurrence_rule_id=record.id and private.report_matches(p_space,e.ledger_transaction_id,e.ledger_account_id,p_filters)) then continue; end if;
   annual:=round(version.amount_cents::numeric*case record.unit when 'month' then 12 when 'week' then 52 else 1 end/version.interval_count); annual_total:=annual_total+annual;
   select min(c.effective_due_on) into next_due from finance.commitment_settlements c join finance.commitments raw on raw.id=c.id where c.recurrence_rule_id=record.id and c.effective_due_on>=day and c.settlement_status in('pending','partial') and raw.deleted_at is null and raw.cancelled_at is null;
   select jsonb_build_object('category',(select name from finance.categories where id=version.category_id),'payment_name',coalesce((select name from finance.financial_accounts where id=version.payment_financial_account_id),(select name from finance.credit_cards where id=version.payment_credit_card_id)),'versions',coalesce((select jsonb_agg(jsonb_build_object('from',v.effective_from_period,'amount_cents',v.amount_cents,'interval_count',v.interval_count) order by v.version_number) from finance.recurrence_rule_versions v where v.recurrence_rule_id=record.id),'[]')) into metadata;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',record.id,'label',record.title,'category_id',version.category_id,'amount_cents',version.amount_cents,'annual_cents',annual,'unit',record.unit,'interval_count',version.interval_count,'starts_on',record.starts_on,'ends_on',record.ends_on,'next_due_on',next_due,'payment_method',version.payment_method)||metadata);
  end loop;
  return jsonb_build_object('report',p_report,'base','recurrence_rules','from_month',from_month,'until_month',until_month,'partial',until_month>date_trunc('month',day)::date,'items',rows,'annual_cents',annual_total,'monthly_cents',round(annual_total::numeric/12));
 elsif p_report='tax_deductible' then
  report_year:=coalesce((p_filters->>'year')::integer,extract(year from p_month)::integer);
  if report_year not between 1900 and 9998 then raise exception 'Invalid report year' using errcode='23514'; end if;
  for record in select e.ledger_transaction_id,e.ledger_account_id,e.occurred_on,e.description,t.notes,c.id as category_id,c.name as category_name,sum(e.amount_cents)::bigint amount_cents from finance.posted_ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.categories c on c.ledger_account_id=e.ledger_account_id and c.is_tax_deductible where e.financial_space_id=p_space and e.occurred_on>=make_date(report_year,1,1) and e.occurred_on<make_date(report_year+1,1,1) and e.occurred_on<=day and e.amount_cents>0 and e.kind<>'refund' and private.report_matches(p_space,e.ledger_transaction_id,e.ledger_account_id,p_filters) group by 1,2,3,4,5,6,7 order by e.occurred_on,e.ledger_transaction_id,e.ledger_account_id loop
   select coalesce(-sum(re.amount_cents),0)::bigint into refunds from finance.posted_ledger_entries re join finance.ledger_transactions rt on rt.id=re.ledger_transaction_id where rt.related_transaction_id=record.ledger_transaction_id and rt.kind='refund' and re.ledger_account_id=record.ledger_account_id and re.occurred_on<=day;
   select jsonb_build_object('payment_names',coalesce((select jsonb_agg(distinct a.name) from finance.ledger_entries payment join finance.ledger_accounts a on a.id=payment.ledger_account_id and a.owner_type in('financial_account','credit_card') where payment.ledger_transaction_id=record.ledger_transaction_id),'[]'),'tags',coalesce((select jsonb_agg(t.name order by t.name) from finance.ledger_transaction_tags lt join finance.tags t on t.id=lt.tag_id where lt.ledger_transaction_id=record.ledger_transaction_id),'[]')) into metadata;
   rows:=rows||jsonb_build_array(jsonb_build_object('transaction_id',record.ledger_transaction_id,'account_id',record.ledger_account_id,'category_id',record.category_id,'label',record.category_name,'description',record.description,'on',record.occurred_on,'gross_cents',record.amount_cents,'refund_cents',refunds,'amount_cents',record.amount_cents-refunds,'notes',record.notes)||metadata);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('category_id',q.id,'label',q.label,'amount_cents',q.amount)),'[]') into grouped from (select value->>'category_id' id,value->>'label' label,sum((value->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(rows) group by 1,2) q;
  return jsonb_build_object('report',p_report,'base','financial_date_calendar_year','year',report_year,'partial',report_year=extract(year from day)::integer,'items',rows,'categories',grouped,'total_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(rows)),0));
 elsif p_report='consumption' then
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id',e.ledger_transaction_id,'account_id',e.ledger_account_id,'class',case when a.system_role='balance_adjustment' then 'expense' else a.account_class end,'label',case when e.original_competence_month is not null then 'De meses anteriores' when a.system_role='balance_adjustment' then 'Diferença não identificada' else a.name end,'description',e.description,'on',e.occurred_on,'month',e.effective_competence_month,'category_id',c.id,'parent_id',c.parent_id,'original_competence_month',e.original_competence_month,'amount_cents',e.amount_cents,'display_amount_cents',case when a.account_class='income' then -e.amount_cents else e.amount_cents end) order by e.effective_competence_month,e.occurred_on,e.id),'[]') into rows from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and (a.account_class in('expense','income') or a.system_role='balance_adjustment') left join finance.categories c on c.ledger_account_id=a.id where e.financial_space_id=p_space and e.effective_competence_month>=from_month and e.effective_competence_month<until_month and e.occurred_on<=day and private.report_matches(p_space,e.ledger_transaction_id,e.ledger_account_id,p_filters);
 elsif p_report='installment_consumption' then
  select coalesce(jsonb_agg(value||jsonb_build_object('label',a.name,'description',t.description) order by value->>'month',value->>'transaction_id'),'[]') into rows from jsonb_array_elements(private.report_health_expenses(p_space,day)) q(value) join finance.ledger_accounts a on a.id=(value->>'account_id')::uuid join finance.ledger_transactions t on t.id=(value->>'transaction_id')::uuid where (value->>'month')::date>=from_month and (value->>'month')::date<until_month and private.report_matches(p_space,t.id,a.id,p_filters);
 else
  rows:=private.report_cash_rows(p_space,from_month,until_month,day,case when p_report='cash_flow' then 'cash' else 'benefit' end,(p_filters->>'account')::uuid);
  select coalesce(jsonb_agg(value),'[]') into rows from jsonb_array_elements(rows) q(value) where private.report_matches(p_space,(value->>'transaction_id')::uuid,(value->>'account_id')::uuid,p_filters) or value->>'source_id' is not null and private.report_matches(p_space,(value->>'source_id')::uuid,(value->>'account_id')::uuid,p_filters-'account');
 end if;
 select coalesce(-sum((value->>'amount_cents')::bigint) filter(where value->>'class'='income'),0)::bigint,coalesce(sum((value->>'amount_cents')::bigint) filter(where value->>'class'='expense' or p_report='installment_consumption'),0)::bigint into income,expenses from jsonb_array_elements(rows);
 if p_report='consumption' then
  with recursive roots(id,root_id) as (select id,id from finance.categories where financial_space_id=p_space and parent_id is null union all select c.id,r.root_id from finance.categories c join roots r on c.parent_id=r.id where c.financial_space_id=p_space), leaves as (select c.id,c.name,r.root_id,sum((item->>'amount_cents')::bigint)::bigint amount,count(distinct item->>'transaction_id') count from jsonb_array_elements(rows) item join finance.categories c on c.ledger_account_id=(item->>'account_id')::uuid join roots r on r.id=c.id where item->>'class'='expense' and item->>'original_competence_month' is null group by c.id,c.name,r.root_id), totals as (select root_id,sum(amount)::bigint amount,sum(count)::bigint entry_count,jsonb_agg(jsonb_build_object('id',id,'label',name,'amount_cents',amount,'transaction_count',count,'percent',case when expenses<>0 then round(amount::numeric/expenses*100,1) end) order by amount desc,name) children from leaves group by root_id)
  select coalesce(jsonb_agg(jsonb_build_object('id',t.root_id,'label',c.name,'amount_cents',t.amount,'transaction_count',(select count(distinct item->>'transaction_id') from jsonb_array_elements(rows) item join finance.categories leaf on leaf.ledger_account_id=(item->>'account_id')::uuid join roots r on r.id=leaf.id where r.root_id=t.root_id and item->>'class'='expense' and item->>'original_competence_month' is null),'percent',case when expenses<>0 then round(t.amount::numeric/expenses*100,1) end,'children',t.children) order by t.amount desc,c.name),'[]') into category_summary from totals t join finance.categories c on c.id=t.root_id;
 end if;
 select jsonb_object_agg(section,coalesce(q.amount,0)) into sections from unnest(array['operational','debts','investments','people']) names(section) left join lateral(select sum((value->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(rows) where value->>'section'=section) q on true;
 return jsonb_build_object('report',p_report,'base',case p_report when 'consumption' then 'competence' when 'installment_consumption' then 'effective_statement_due_month' else 'financial_date' end,'from_month',from_month,'until_month',until_month,'partial',until_month>date_trunc('month',day)::date,'income_cents',income,'expense_cents',expenses,'category_summary',category_summary,'net_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(rows) where value->>'section'<>'opening'),0),'opening_cents',coalesce((select sum((value->>'amount_cents')::bigint) from jsonb_array_elements(rows) where value->>'section'='opening'),0),'sections',sections,'items',rows);
end;
$$;

create function api.export_filtered_report(p_space uuid,p_report text,p_month date,p_filters jsonb default '{}',p_format text default 'spreadsheet') returns text
language plpgsql stable security definer set search_path='' as $$
declare data jsonb; item jsonb; output text; sep text; spreadsheet boolean:=p_format='spreadsheet'; d date; amount bigint;
begin
 if p_format not in('spreadsheet','technical') then raise exception 'Invalid export format' using errcode='23514'; end if;
 data:=api.reports_query(p_space,p_report,p_month,p_filters); sep:=case when spreadsheet then ';' else ',' end;
 output:=case when spreadsheet then chr(65279)||'Data;Descrição;Categoria;Valor (R$);Reembolsos (R$);Valor líquido (R$);Conta ou cartão;Tags;Observação;Anual (R$);Frequência;Próxima cobrança;Início;Encerramento;Histórico de valores' else 'date,description,category,gross_cents,refund_cents,net_cents,payment,tags,notes,annual_cents,frequency,next_due_on,starts_on,ends_on,versions,transaction_id,account_id' end||chr(10);
 for item in select value from jsonb_array_elements(data->'items') loop
  d:=coalesce((item->>'on')::date,(item->>'month')::date,(item->>'next_due_on')::date,(item->>'starts_on')::date,p_month);
  amount:=coalesce((item->>'display_amount_cents')::bigint,(item->>'amount_cents')::bigint);
  output:=output||private.report_csv_cell(case when spreadsheet then to_char(d,'DD/MM/YYYY') else d::text end)||sep||private.report_csv_cell(coalesce(item->>'description',item->>'label'))||sep||private.report_csv_cell(coalesce(item->>'category',item->>'label'))||sep||private.report_csv_cell(case when spreadsheet then replace(to_char(coalesce((item->>'gross_cents')::bigint,amount)::numeric/100,'FM999999999999999990.00'),'.',',') else coalesce(item->>'gross_cents',amount::text) end,false)||sep||private.report_csv_cell(case when spreadsheet then replace(to_char(coalesce((item->>'refund_cents')::bigint,0)::numeric/100,'FM999999999999999990.00'),'.',',') else coalesce(item->>'refund_cents','0') end,false)||sep||private.report_csv_cell(case when spreadsheet then replace(to_char(amount::numeric/100,'FM999999999999999990.00'),'.',',') else amount::text end,false)||sep||private.report_csv_cell(coalesce(item->>'payment_name',(select string_agg(value,', ') from jsonb_array_elements_text(coalesce(item->'payment_names','[]')))))||sep||private.report_csv_cell((select string_agg(value,', ') from jsonb_array_elements_text(coalesce(item->'tags','[]'))))||sep||private.report_csv_cell(item->>'notes');
  output:=output||sep||private.report_csv_cell(case when item->>'annual_cents' is null then '' when spreadsheet then replace(to_char((item->>'annual_cents')::numeric/100,'FM999999999999999990.00'),'.',',') else item->>'annual_cents' end,false)||sep||private.report_csv_cell(case when item->>'unit' is not null then (item->>'interval_count')||' '||(item->>'unit') end)||sep||private.report_csv_cell(case when spreadsheet then to_char((item->>'next_due_on')::date,'DD/MM/YYYY') else item->>'next_due_on' end)||sep||private.report_csv_cell(case when spreadsheet then to_char((item->>'starts_on')::date,'DD/MM/YYYY') else item->>'starts_on' end)||sep||private.report_csv_cell(case when spreadsheet then to_char((item->>'ends_on')::date,'DD/MM/YYYY') else item->>'ends_on' end)||sep||private.report_csv_cell(case when spreadsheet then (select string_agg(to_char((value->>'from')::date,'DD/MM/YYYY')||': '||replace(to_char((value->>'amount_cents')::numeric/100,'FM999999999999999990.00'),'.',','),' | ') from jsonb_array_elements(coalesce(item->'versions','[]'))) else item->>'versions' end);
  if not spreadsheet then output:=output||sep||private.report_csv_cell(item->>'transaction_id')||sep||private.report_csv_cell(item->>'account_id'); end if;
  output:=output||chr(10);
 end loop;
 return output;
end;
$$;

create function api.report_comparison(p_space uuid,p_month date,p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'; current jsonb; previous bigint; expense bigint; m date; i integer;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 perform private.validate_report_filters(p_space,p_filters);
 if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Invalid comparison month' using errcode='23514'; end if;
 for i in reverse 6..0 loop
  m:=(p_month-make_interval(months=>i))::date;
  current:=api.reports_query(p_space,'consumption',m,p_filters-array['from_month','until_month']); expense:=(current->>'expense_cents')::bigint;
  if i<6 then result:=result||jsonb_build_array(jsonb_build_object('month',m,'income_cents',(current->>'income_cents')::bigint,'expense_cents',expense,'expense_change_cents',expense-previous,'expense_change_percent',case when previous<>0 then round((expense-previous)::numeric/abs(previous)*100,1) end,'new',previous=0 and expense<>0,'snapshot',exists(select 1 from finance.period_closings c where c.financial_space_id=p_space and c.month=m and c.reopened_at is null))); end if;
  previous:=expense;
 end loop;
 return result;
end;
$$;

create function api.dashboard_summary(p_space uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare month date:=date_trunc('month',private.space_today(p_space))::date; report jsonb; categories jsonb; total bigint; top_rows jsonb; other_amount bigint; all_rows jsonb; worth jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 report:=api.reports_summary(p_space,month);
 with recursive roots(id,root_id) as (select id,id from finance.categories where financial_space_id=p_space and parent_id is null union all select c.id,r.root_id from finance.categories c join roots r on c.parent_id=r.id where c.financial_space_id=p_space), sums as (select r.root_id,c.name,sum((item->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(report#>'{consumption,items}') item join finance.categories leaf on leaf.ledger_account_id=(item->>'account_id')::uuid join roots r on r.id=leaf.id join finance.categories c on c.id=r.root_id where item->>'class'='expense' and item->>'original_competence_month' is null group by r.root_id,c.name)
 select coalesce(jsonb_agg(jsonb_build_object('id',root_id,'label',name,'amount_cents',amount) order by amount desc,name,root_id),'[]'),coalesce(sum(amount),0)::bigint into all_rows,total from sums;
 select coalesce(jsonb_agg(value||jsonb_build_object('percent',case when total<>0 then round((value->>'amount_cents')::numeric/total*100,1) end) order by ordinal),'[]') into top_rows from jsonb_array_elements(all_rows) with ordinality q(value,ordinal) where ordinal<=5;
 select coalesce(sum((value->>'amount_cents')::bigint),0)::bigint into other_amount from jsonb_array_elements(all_rows) with ordinality q(value,ordinal) where ordinal>5;
 if jsonb_array_length(all_rows)>5 then top_rows:=top_rows||jsonb_build_array(jsonb_build_object('id',null,'label','Outros','amount_cents',other_amount,'percent',case when total<>0 then round(other_amount::numeric/total*100,1) end)); end if;
 worth:=report->'net_worth'->(jsonb_array_length(report->'net_worth')-1);
 return jsonb_build_object('month',month,'categories',top_rows,'category_total_cents',total,'future_installments',report->'future_installments','net_worth',worth);
end;
$$;
revoke all on function private.report_matches(uuid,uuid,uuid,jsonb),private.validate_report_filters(uuid,jsonb) from public,anon,authenticated;
revoke all on function api.report_filter_options(uuid),api.reports_query(uuid,text,date,jsonb),api.export_filtered_report(uuid,text,date,jsonb,text),api.dashboard_summary(uuid),api.report_comparison(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function api.report_filter_options(uuid),api.reports_query(uuid,text,date,jsonb),api.export_filtered_report(uuid,text,date,jsonb,text),api.dashboard_summary(uuid),api.report_comparison(uuid,date,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
