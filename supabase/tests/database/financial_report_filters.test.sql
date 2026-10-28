begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000391','report-filters@test.local'),('aaaaaaaa-0000-4000-8000-000000000392','report-filters-other@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000391","role":"authenticated"}',true);
select api.create_personal_space('Consultas filtradas') as space \gset
select api.create_financial_account(:'space','Banco','checking',1000000,'2026-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Saúde','expense') as health \gset
select api.create_category(:'space','Consultas','expense',:'health',null,true,'fixed') as medical \gset
select ledger_account_id as medical_ledger from finance.categories where id=:'medical' \gset
select api.create_category(:'space','Vídeo','expense') as video \gset
select api.create_category(:'space','Música','expense') as music \gset
select api.create_category(:'space','Antivírus','expense') as antivirus \gset
select api.create_tag(:'space','Consulta anual') as tag \gset
select api.create_person(:'space','Fulano') as person \gset
select ledger_account_id as person_ledger from finance.people where id=:'person' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Consulta médica','notes','Dra. Teste','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'medical_ledger','amount_cents',35000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-35000)))) as consultation \gset
select api.set_transaction_tags(:'space',:'consultation',array[:'tag'::uuid],'{}');
select api.refund_transaction(:'space',:'consultation',20000,'2026-10-03',:'bank');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('tag',:'tag'))->>'expense_cents')::bigint,15000::bigint,'Tag filter includes linked refund and reports net expense');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('category',:'health'))->>'expense_cents')::bigint,15000::bigint,'Parent category filter includes its leaf postings');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('category',:'health'))#>>'{category_summary,0,amount_cents}')::bigint,15000::bigint,'Parent category summary sums its descendant leaves');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('category',:'health'))#>>'{category_summary,0,transaction_count}')::bigint,2::bigint,'Category summary exposes actual expense and refund transactions');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('essential',true,'fixity','fixed'))->>'expense_cents')::bigint,15000::bigint,'Essential and fixed filters use category attributes');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('essential',false))->>'expense_cents')::bigint,0::bigint,'Opposite essential filter omits these expenses');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-04','competence_month','2026-10-01','description','Compartilhada','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'medical_ledger','amount_cents',5000),jsonb_build_object('ledger_account_id',:'person_ledger','amount_cents',5000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-10000))));
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('person',:'person'))->>'expense_cents')::bigint,5000::bigint,'Person filter includes only category part of a shared expense');
select is((api.reports_query(:'space','cash_flow','2026-10-01',jsonb_build_object('person',:'person'))->>'net_cents')::bigint,-10000::bigint,'Person-filtered cash view still reconciles all selected cash transaction counterparts');
select api.create_credit_card(:'space','Cartão',1000000,1,10,:'bank') as card \gset
select api.record_card_purchase(:'space',:'card',:'video',10000,2,'2026-10-02','Vídeo parcelado') as tagged_card \gset
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('card',:'card'))->>'expense_cents')::bigint,10000::bigint,'Card filter preserves total purchase competence');
select is((api.reports_query(:'space','installment_consumption','2026-11-01',jsonb_build_object('card',:'card'))->>'expense_cents')::bigint,5000::bigint,'Card alternate query uses first effective due month');
select api.set_transaction_tags(:'space',:'tagged_card',array[:'tag'::uuid],'{}');
select api.pay_card(:'space',:'card',:'bank_ledger',2500,'2026-10-04');
select is((api.reports_query(:'space','cash_flow','2026-10-01',jsonb_build_object('tag',:'tag','card',:'card'))->>'net_cents')::bigint,-2500::bigint,'Cash category allocation follows the purchase tag through a card payment');
reset role;
update finance.categories set is_tax_deductible=true where id=:'medical';
update finance.tags set archived_at=now() where id=:'tag';
set local role authenticated;
select is((api.reports_query(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag'))->>'total_cents')::bigint,15000::bigint,'Tax support list reports consultation net of linked refund');
select is(api.reports_query(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag'))#>>'{items,0,notes}','Dra. Teste','Tax support includes provider note');
select is(api.reports_query(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag'))#>>'{items,0,tags,0}','Consulta anual','Archived tag remains in tax report');
select is((api.reports_query(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag'))#>>'{items,0,gross_cents}')::bigint,35000::bigint,'Tax list retains gross expense');
select is((api.reports_query(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag'))#>>'{items,0,refund_cents}')::bigint,20000::bigint,'Tax list retains linked reimbursement separately');
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Vídeo','direction','outflow','unit','month','is_subscription',true,'starts_on','2026-10-01','day_of_month',15,'amount_cents',5590,'category_id',:'video','payment_method','account','payment_financial_account_id',:'bank')) as video_rule \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Música','direction','outflow','unit','month','is_subscription',true,'starts_on','2026-10-01','day_of_month',15,'amount_cents',2190,'category_id',:'music','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Antivírus','direction','outflow','unit','year','is_subscription',true,'starts_on','2026-10-01','day_of_month',15,'month_of_year',10,'amount_cents',17900,'category_id',:'antivirus','payment_method','account','payment_financial_account_id',:'bank'));
select is((api.reports_query(:'space','subscriptions','2026-10-01')->>'annual_cents')::bigint,111260::bigint,'Section25.6 subscriptions annualize monthly and annual charges');
select is((api.reports_query(:'space','subscriptions','2026-10-01')->>'monthly_cents')::bigint,9272::bigint,'Subscriptions monthly total rounds annual sum only once');
select is(jsonb_array_length(api.reports_query(:'space','subscriptions','2026-10-01')->'items'),3,'Three subscription rules included');
select is((api.reports_query(:'space','subscriptions','2026-10-01',jsonb_build_object('category',:'video'))->>'annual_cents')::bigint,67080::bigint,'Subscriptions support category filter');
select is(api.reports_query(:'space','subscriptions','2026-10-01')#>>'{items,0,versions,0,amount_cents}','17900','Subscription report exposes value history');
select ok((select (value->>'archived')::boolean from jsonb_array_elements(api.report_filter_options(:'space')->'tags') where value->>'id'=:'tag'),'Filter options include archived tag');
select is((api.dashboard_summary(:'space')->>'category_total_cents')::bigint,30000::bigint,'Dashboard categories reconcile current net category expense');
select ok(api.dashboard_summary(:'space')->'future_installments' is not null,'Dashboard receives canonical future installments');
select ok(left(api.export_filtered_report(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag')),1)=chr(65279),'Filtered spreadsheet export preserves BOM');
select ok(position('150,00' in api.export_filtered_report(:'space','tax_deductible','2026-10-01',jsonb_build_object('tag',:'tag')))>0,'Tax CSV exports net amount in reais');
select ok(position('670,80' in api.export_filtered_report(:'space','subscriptions','2026-10-01',jsonb_build_object('category',:'video')))>0,'Subscription CSV includes annual equivalent and value history');
select is((api.reports_query(:'space','consumption','2026-10-01',jsonb_build_object('from_month','2026-01-01','until_month','2026-11-01'))->>'expense_cents')::bigint,30000::bigint,'Custom month range applies server-side');
select is((api.report_comparison(:'space','2026-10-01',jsonb_build_object('person',:'person'))->5->>'expense_cents')::bigint,5000::bigint,'Comparison applies the same person filter as report');
select ok((api.report_comparison(:'space','2026-10-01',jsonb_build_object('person',:'person'))->5->>'new')::boolean,'Comparison labels a new nonzero category when previous base is zero');
select api.create_category(:'space','Categoria 1','expense') as c1 \gset
select api.create_category(:'space','Categoria 2','expense') as c2 \gset
select api.create_category(:'space','Categoria 3','expense') as c3 \gset
select api.create_category(:'space','Categoria 4','expense') as c4 \gset
select api.create_category(:'space','Categoria 5','expense') as c5 \gset
select api.record_card_purchase(:'space',:'card',id,1000,1,'2026-10-04','Despesa adicional') from unnest(array[:'c1'::uuid,:'c2'::uuid,:'c3'::uuid,:'c4'::uuid,:'c5'::uuid]) id;
select is(jsonb_array_length(api.dashboard_summary(:'space')->'categories'),6,'Dashboard limits categories to top five plus Others');
select is(api.dashboard_summary(:'space')#>>'{categories,5,label}','Outros','Last dashboard row is Others');
select is((api.dashboard_summary(:'space')#>>'{categories,5,amount_cents}')::bigint,2000::bigint,'Others contains the two smallest category groups');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.dashboard_summary(:'space')->'categories')),35000::bigint,'Top five plus Others reconciles complete category consumption');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-04','competence_month','2026-10-01','description','Mesma categoria em duas partidas','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'medical_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'medical_ledger','amount_cents',20000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-30000)))) as split_medical \gset
select api.refund_transaction(:'space',:'split_medical',10000,'2026-10-04',:'bank');
select is((select (value->>'amount_cents')::bigint from jsonb_array_elements(api.reports_query(:'space','tax_deductible','2026-10-01')->'items') where value->>'transaction_id'=:'split_medical'),20000::bigint,'Deductible report aggregates same-category parts before subtracting linked refund once');
select throws_ok(format('select api.reports_query(%L,''consumption'',''2026-10-01'',''{"fixity":"sometimes"}'')',:'space'),'23514','Invalid report fixity','Unknown category filter value rejected');
select throws_ok(format('select api.reports_query(%L,''consumption'',''2026-10-01'',''{"extra":"bad"}'')',:'space'),'23514','Invalid report filters','Unknown filter keys rejected');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000392","role":"authenticated"}',true);
select api.create_personal_space('Outro espaço') as other_space \gset
select api.create_tag(:'other_space','Outro tag') as other_tag \gset
select throws_ok(format('select api.reports_query(%L,''consumption'',''2026-10-01'')',:'space'),'42501','Space permission required','Query cannot cross tenants');
select throws_ok(format('select api.report_filter_options(%L)',:'space'),'42501','Space permission required','Metadata cannot cross tenants');
select throws_ok(format('select api.export_filtered_report(%L,''tax_deductible'',''2026-10-01'')',:'space'),'42501','Space permission required','Filtered export cannot cross tenants');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000391","role":"authenticated"}',true);
select throws_ok(format('select api.reports_query(%L,''consumption'',''2026-10-01'',jsonb_build_object(''tag'',%L))',:'space',:'other_tag'),'23514','Report filter is not in this space','Foreign tenant filter rejected instead of misleading zero');
select ok(not has_function_privilege('authenticated','private.report_matches(uuid,uuid,uuid,jsonb)','EXECUTE'),'Unscoped private filter helper cannot be called by client');
set constraints all immediate;
select * from finish();
rollback;
