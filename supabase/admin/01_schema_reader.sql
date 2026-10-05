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
--     O bloco abaixo aborta tudo se alguma tabela de public estiver sem RLS.
--   - nada mais: toda transação dele é somente leitura.

begin;

do $$
declare
  r record;
begin
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

-- Para remover o acesso quando não for mais necessário:
--   revoke select on all sequences in schema public from schema_reader;
--   revoke select on all tables in schema public from schema_reader;
--   revoke usage on schema public from schema_reader;
--   drop role schema_reader;
