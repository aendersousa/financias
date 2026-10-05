-- Usuário só de leitura para o dump do esquema (ANALISE_E_PLANO.md, decisão 2).
--
-- Quem roda: você, no SQL Editor do Supabase (papel postgres).
-- Antes de rodar: troque <SENHA_FORTE> por uma senha gerada no seu gerenciador
-- de senhas. Não salve este arquivo com a senha preenchida.
--
-- O que o usuário pode fazer:
--   - conectar (no máximo 2 conexões, até 31/12/2026);
--   - ler o catálogo (estrutura das tabelas, políticas, funções, gatilhos);
--   - SELECT nas tabelas de public. O pg_dump exige esse privilégio para travar
--     as tabelas, mesmo num dump só de esquema. Os dados continuam invisíveis:
--     o usuário não tem BYPASSRLS e as políticas "own rows" comparam
--     auth.uid() (vazio para ele) com user_id, então toda consulta volta vazia.
--     O bloco abaixo aborta tudo se alguma tabela de public estiver sem RLS ou
--     se alguma política de leitura não conferir auth.uid().
--   - nada mais: toda transação dele é somente leitura.
--
-- Conferência final, feita por mim já conectado como schema_reader, antes do
-- dump: contar as linhas de cada tabela de public. Qualquer contagem diferente
-- de zero interrompe o dump, e eu aviso.

begin;

do $$
declare
  r record;
begin
  -- 1. Toda tabela de public tem RLS ligada.
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
  loop
    raise exception 'A tabela public.% está sem RLS. Nada foi criado.', r.relname;
  end loop;

  -- 2. Nenhuma política permissiva de leitura (SELECT ou ALL) libera linhas sem
  --    conferir auth.uid(): pega using (true), USING vazio e qualquer expressão
  --    que não cite auth.uid(), para qualquer papel (inclusive public e anon).
  for r in
    select p.tablename, p.policyname, p.cmd, p.roles, p.qual
      from pg_policies p
     where p.schemaname = 'public'
       and p.permissive = 'PERMISSIVE'
       and p.cmd in ('SELECT', 'ALL')
       and (p.qual is null or p.qual !~ 'auth\.uid\(\)')
  loop
    raise exception 'A política "%" de public.% (%, papéis %) libera leitura sem conferir auth.uid(): %. Nada foi criado.',
      r.policyname, r.tablename, r.cmd, r.roles, coalesce(r.qual, '(sem USING)');
  end loop;
end
$$;

create role schema_reader
  with login
       nosuperuser nocreatedb nocreaterole noinherit
       connection limit 2
       valid until '2026-12-31'
       password '<SENHA_FORTE>';

alter role schema_reader set default_transaction_read_only = on;
alter role schema_reader set statement_timeout = '60s';

grant usage on schema public to schema_reader;
grant select on all tables in schema public to schema_reader;
grant select on all sequences in schema public to schema_reader;

commit;

-- Conferência (rode depois do commit):
select rolname, rolcanlogin, rolsuper, rolbypassrls, rolconnlimit, rolvaliduntil, rolconfig
  from pg_roles where rolname = 'schema_reader';

select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'schema_reader'
 order by 1;

-- Políticas de public, para registro (o bloco acima já abortaria se alguma
-- liberasse leitura sem auth.uid()):
select tablename, policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by 1, 2;

-- Para remover o acesso quando não for mais necessário:
--   revoke select on all sequences in schema public from schema_reader;
--   revoke select on all tables in schema public from schema_reader;
--   revoke usage on schema public from schema_reader;
--   drop role schema_reader;
