# Teste de restauração de um backup num Supabase local TEMPORÁRIO (decisão 17).
#
# Uso (PowerShell, na raiz do repositório, com Rancher Desktop rodando):
#   .\ops\backup\restore-test.ps1 -Backup C:\caminho\2026-10-07T060000Z.tar.gz.age -Identity C:\caminho\financias-backup.key
#
# O que faz:
#   1. sobe um Supabase local separado (projeto financias_restore, portas 55xxx),
#      só com o banco, sem tocar no Supabase local de desenvolvimento;
#   2. abre o backup com a chave age e restaura papéis, esquema e dados;
#   3. compara a quantidade de linhas de cada tabela com o manifesto do backup;
#   4. para o Supabase temporário e apaga a pasta temporária e os arquivos abertos.
# Os dados restaurados só existem enquanto o script roda.

param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][string]$Identity,
  [string]$Age = 'C:\Users\hzs\tools\age\age.exe',
  [string]$Psql = 'psql'
)

$ErrorActionPreference = 'Continue'  # erros reais são conferidos por $LASTEXITCODE e throw
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
# Supabase CLI do projeto, se instalado; senão a mesma versão fixa pelo npx.
$localCli = Join-Path $repo 'node_modules\.bin\supabase.cmd'
if (Test-Path $localCli) { $sbExe = $localCli; $sbPre = @() } else { $sbExe = 'npx'; $sbPre = @('--yes', 'supabase@2.119.0') }
$work = Join-Path $env:TEMP ('financias-restore-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
$dbUrl = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
$failed = 0

New-Item -ItemType Directory -Path $work | Out-Null
try {
  Write-Output "Abrindo o backup em $work"
  & $Age -d -i $Identity -o (Join-Path $work 'backup.tar.gz') $Backup
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível abrir o backup com essa chave' }
  & tar -xzf (Join-Path $work 'backup.tar.gz') -C $work
  if ($LASTEXITCODE -ne 0) { throw 'Arquivo do backup corrompido' }

  Push-Location $work
  try {
    & $sbExe @sbPre init --force | Out-Null
    $config = Get-Content 'supabase\config.toml' -Raw
    $config = $config -replace 'project_id = "[^"]*"', 'project_id = "financias_restore"'
    $config = $config -replace '= 543(\d\d)', '= 553$1'
    Set-Content 'supabase\config.toml' $config -Encoding utf8
    Write-Output 'Subindo o Supabase temporário (só o banco)'
    & $sbExe @sbPre start -x 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
    if ($LASTEXITCODE -ne 0) { throw 'O Supabase temporário não subiu' }

    # Dois ajustes para restaurar num Supabase novo, ambos do próprio Supabase e
    # não do app: (1) a permissão interna "GRANT SET ON PARAMETER" do papel do
    # Realtime já existe e o papel postgres não pode concedê-la; (2) as tabelas do
    # esquema storage pertencem ao serviço de Storage. O Storage só guarda
    # metadados no banco (os arquivos não entram no dump), e o app ainda não o usa.
    $utf8 = [Text.UTF8Encoding]::new($false)
    $roles = [IO.File]::ReadAllLines((Join-Path $work 'roles.sql'), $utf8) | Where-Object { $_ -notmatch '^GRANT SET ON PARAMETER ' }
    [IO.File]::WriteAllLines((Join-Path $work 'roles.restore.sql'), [string[]]$roles, $utf8)
    $reader = [IO.StreamReader]::new((Join-Path $work 'data.sql'), $utf8)
    $writer = [IO.StreamWriter]::new((Join-Path $work 'data.restore.sql'), $false, $utf8)
    $skipping = $false
    $skippedTables = @()
    try {
      while ($null -ne ($row = $reader.ReadLine())) {
        if (-not $skipping -and $row -match '^COPY "storage"\.("[^"]+")') { $skipping = $true; $skippedTables += "storage.$($Matches[1])"; continue }
        if ($skipping) { if ($row -eq '\.') { $skipping = $false }; continue }
        $writer.WriteLine($row)
      }
    } finally { $reader.Close(); $writer.Close() }

    Write-Output 'Restaurando papéis, esquema e dados'
    & $Psql $dbUrl -X -q --single-transaction -v ON_ERROR_STOP=1 `
      -f (Join-Path $work 'roles.restore.sql') `
      -f (Join-Path $work 'schema.sql') `
      -c 'SET session_replication_role = replica' `
      -f (Join-Path $work 'data.restore.sql')
    if ($LASTEXITCODE -ne 0) { throw 'A restauração falhou' }

    Write-Output 'Conferindo a quantidade de linhas de cada tabela'
    $checked = 0
    foreach ($line in Get-Content (Join-Path $work 'manifest.tsv')) {
      $table, $expected = $line -split "`t"
      if ($table -like '"storage".*') { continue }
      $checked++
      $actual = (& $Psql $dbUrl -X -t -A -c "select count(*) from $table" | Out-String).Trim()
      if ($actual -ne $expected) {
        $failed++
        Write-Output "DIFERENÇA $table : backup $expected, restaurado $actual"
      }
    }
    $users = (& $Psql $dbUrl -X -t -A -c 'select count(*) from auth.users' | Out-String).Trim()
    $ledger = (& $Psql $dbUrl -X -t -A -c 'select count(*) from finance.ledger_transactions' 2>$null | Out-String).Trim()
    Write-Output "Tabelas conferidas: $checked. Diferenças: $failed. Usuários restaurados: $users. Lançamentos do modelo novo: $ledger."
    if ($skippedTables.Count -gt 0) { Write-Output "Não restauradas (Storage): $($skippedTables -join ', ')" }
  }
  finally {
    & $sbExe @sbPre stop --no-backup | Out-Null
    Pop-Location
  }
}
finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

if ($failed -gt 0) { throw "Restauração com $failed diferença(s)" }
Write-Output 'RESTAURAÇÃO OK'
