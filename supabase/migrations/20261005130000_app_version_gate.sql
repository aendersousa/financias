-- Versão mínima aceita do app (ANALISE_E_PLANO.md, decisão 15; passo T6 da seção 11).
-- O app chama public.app_version_policy() ao abrir. Se a versão dele for menor que
-- min_version, mostra "Atualize o app" e não deixa usar até atualizar.
--
-- Nasce com min_version = '0.0.0' (ninguém é bloqueado). Na janela de troca, quem
-- administra a produção sobe o valor, por exemplo:
--   update app_meta.config
--      set min_version = '2.0.0',
--          message = 'O Finanças mudou. Atualize para continuar.',
--          download_url = 'https://github.com/aendersousa/financias/releases/latest',
--          updated_at = now();
--
-- A tabela fica fora de public e fora da API; não há política de leitura aberta.
-- A função devolve só a regra de versão.

begin;

create schema app_meta;
revoke all on schema app_meta from public, anon, authenticated, service_role;

create table app_meta.config (
  id boolean primary key default true check (id),
  min_version text not null default '0.0.0' check (min_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  message text,
  download_url text check (download_url is null or download_url ~ '^https://'),
  updated_at timestamptz not null default now()
);
insert into app_meta.config default values;
revoke all on app_meta.config from public, anon, authenticated, service_role;

create function public.app_version_policy()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'min_version', c.min_version,
    'message', c.message,
    'download_url', c.download_url)
    from app_meta.config c
   where c.id;
$$;

revoke all on function public.app_version_policy() from public, anon, authenticated, service_role;
grant execute on function public.app_version_policy() to anon, authenticated;

commit;
