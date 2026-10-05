$ErrorActionPreference = 'Stop'
$env:PGOPTIONS = '-c client_min_messages=warning'
$databaseName = 'financias_verify_' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$adminConnection = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
& psql $adminConnection -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE $databaseName"
if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated verification database' }
$connection = "postgresql://postgres:postgres@127.0.0.1:54322/$databaseName"
$bootstrap = @'
create schema auth;
create schema extensions;
create extension pgtap with schema extensions;
grant usage on schema extensions to authenticated,anon,service_role;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
grant usage on schema public to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
'@
$bootstrap | & psql $connection -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Verification bootstrap failed' }
foreach ($migration in (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'migrations') -Filter '*.sql' | Sort-Object Name)) {
  $result = & psql $connection -X -q -v ON_ERROR_STOP=1 -f $migration.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { $result | Write-Output; throw "Migration failed: $($migration.Name)" }
  Write-Output "Applied $($migration.Name)"
}
foreach ($test in (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'tests/database') -Filter '*.test.sql' | Sort-Object Name)) {
  $result = & psql $connection -X -q -v ON_ERROR_STOP=1 -f $test.FullName 2>&1
  if ($LASTEXITCODE -ne 0 -or ($result -match 'not ok|Looks like you')) { $result | Write-Output; throw "Test failed: $($test.Name)" }
  Write-Output "Passed $($test.Name)"
}
Write-Output "Verified fresh migrations and database tests in $databaseName. Database retained for inspection."
