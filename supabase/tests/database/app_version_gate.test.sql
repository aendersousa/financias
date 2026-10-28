-- Testes da migração 20261005130000_app_version_gate (decisão 15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(public.app_version_policy()->>'min_version', '0.0.0',
  'começa com versão mínima 0.0.0: ninguém é bloqueado');

select is(has_function_privilege('anon', 'public.app_version_policy()', 'execute'), true,
  'anon lê a regra de versão (a tela de login também precisa)');
select is(has_function_privilege('authenticated', 'public.app_version_policy()', 'execute'), true,
  'authenticated lê a regra de versão');
select is(has_function_privilege('public', 'public.app_version_policy()', 'execute'), false,
  'PUBLIC não executa a função');
select is(has_table_privilege('anon', 'app_meta.config', 'SELECT'), false,
  'anon não lê a tabela de configuração diretamente');
select is(has_table_privilege('authenticated', 'app_meta.config', 'UPDATE'), false,
  'authenticated não altera a versão mínima');

select throws_ok($$ insert into app_meta.config (id) values (true) $$, '23505', null,
  'existe uma única linha de configuração');

update app_meta.config set min_version = '2.0.0', download_url = 'https://github.com/aendersousa/financias/releases/latest';
select is(public.app_version_policy(),
  '{"min_version": "2.0.0", "message": null, "download_url": "https://github.com/aendersousa/financias/releases/latest"}'::jsonb,
  'a função devolve a versão mínima e o link de download configurados');

select * from finish();
rollback;
