-- Usuário só de leitura para o dump do esquema (ANALISE_E_PLANO.md, decisão 2).
--
-- Quem roda: você, no SQL Editor do Supabase (papel postgres).
-- Antes de rodar: troque <SENHA_FORTE> por uma senha gerada no seu gerenciador
-- de senhas. Não salve este arquivo com a senha preenchida.
--
-- O que o usuário pode fazer:
--   - conectar (no máximo 2 conexões, até 31/12/2026);
--   - ler o catálogo (estrutura das tabelas, políticas, funções, gatilhos);
--   - SELECT nas tabelas comuns e particionadas de public (relkind 'r' e 'p'),
--     concedido tabela a tabela. O pg_dump exige esse privilégio para travar as
--     tabelas, mesmo num dump só de esquema. Os dados continuam invisíveis: o
--     usuário não tem BYPASSRLS e as políticas comparam auth.uid() (vazio para
--     ele) com user_id, então toda consulta volta vazia.
--
-- A garantia de que ele não grava é não ter nenhum privilégio de escrita: só
-- recebe USAGE no esquema e SELECT nas tabelas, e o bloco final confere que ele
-- não tem INSERT, UPDATE, DELETE, TRUNCATE, nem CREATE no esquema ou no banco.
-- O default_transaction_read_only abaixo é só um padrão de sessão, que o próprio
-- usuário pode desligar; serve de proteção extra, não de garantia.
--
-- O script inteiro é desfeito, sem criar nada, se:
--   - alguma tabela de public estiver sem RLS;
--   - alguma política permissiva de leitura não conferir auth.uid();
--   - existir visão ou visão materializada em public (relkind 'v' ou 'm'): visão
--     sem security_invoker roda com o dono e ignora a RLS de quem consulta, e
--     visão materializada não tem RLS;
--   - o usuário criado acabar com algum privilégio de escrita.
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

  -- 3. Nenhuma visão nem visão materializada em public.
  for r in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('v', 'm')
  loop
    raise exception 'Existe % public.% (relkind %). Nada foi criado.',
      case r.relkind when 'v' then 'a visão' else 'a visão materializada' end, r.relname, r.relkind;
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

-- SELECT só nas tabelas comuns e particionadas (nunca em visões, visões
-- materializadas ou tabelas estrangeiras).
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
  loop
    execute format('grant select on table public.%I to schema_reader', r.relname);
  end loop;
end
$$;

grant select on all sequences in schema public to schema_reader;

-- 4. O usuário criado não tem nenhum privilégio de escrita, nem direto nem
--    herdado de PUBLIC.
do $$
declare
  r record;
begin
  if has_schema_privilege('schema_reader', 'public', 'CREATE') then
    raise exception 'schema_reader pode criar objetos em public. Nada foi criado.';
  end if;

  if has_database_privilege('schema_reader', current_database(), 'CREATE') then
    raise exception 'schema_reader pode criar esquemas no banco. Nada foi criado.';
  end if;

  for r in
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if has_table_privilege('schema_reader', r.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'schema_reader tem privilégio de escrita em public.%. Nada foi criado.', r.relname;
    end if;
  end loop;
end
$$;

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
