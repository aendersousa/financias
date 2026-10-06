# Backup diário do Supabase

Decisões 2, 12 e 17 de `docs/ANALISE_E_PLANO.md`. Passo T7 da seção 11.

- Roda todo dia às 03:00 de Brasília num **repositório privado separado**, nunca neste repositório, que é público.
- Guarda três arquivos do Supabase CLI: papéis, esquema e dados. Os dados incluem `auth.users`, as tabelas antigas, `finance` e as demais.
- Junta um manifesto com a quantidade de linhas de cada tabela.
- Tudo é criptografado com [age](https://age-encryption.org). O GitHub só conhece a chave **pública**. A chave que abre o backup fica fora do GitHub.

## Preparação (uma vez)

1. **Gerar o par de chaves**, no seu computador:
   ```
   C:\Users\hzs\tools\age\age-keygen.exe -o financias-backup.key
   ```
   - Guarde `financias-backup.key` no gerenciador de senhas e em uma cópia fora do computador.
   - Sem ela, nenhum backup pode ser aberto.
   - Nunca commite essa chave nem a envie para o GitHub.
   - O comando mostra a chave pública (`age1...`), que é a única que vai para o GitHub.
2. **Criar o repositório privado** `aendersousa/financias-backups`.
3. **Configurar no repositório privado**, em Settings → Secrets and variables → Actions:
   - em *Secrets*, criar `SUPABASE_DB_URL` com a conexão do Session pooler e a senha completa do banco (Connect → Session pooler no painel do Supabase);
   - em *Variables*, criar `AGE_RECIPIENT` com a chave pública `age1...`.
4. **Copiar o workflow:** `ops/backup/backup.yml` deste repositório vai para `.github/workflows/backup.yml` do repositório privado.
5. **Rodar a primeira vez à mão:** Actions → "Backup diário do Supabase" → *Run workflow*. O arquivo aparece em `backups/AAAA-MM-DDTHHMMSSZ.tar.gz.age`, e o SHA-256 dele em `backups/SHA256SUMS`.

## Teste de restauração (decisão 17)

Com o Rancher Desktop rodando, na raiz deste repositório:

```powershell
.\ops\backup\restore-test.ps1 -Backup C:\caminho\AAAA-MM-DDTHHMMSSZ.tar.gz.age -Identity C:\caminho\financias-backup.key
```

O script faz isto:
1. Sobe um Supabase **temporário** e separado (projeto `financias_restore`, portas 553xx, só o banco). O Supabase local de desenvolvimento não é tocado.
2. Abre o backup e restaura papéis, esquema e dados.
3. Confere a quantidade de linhas de cada tabela com o manifesto.
4. Desliga o Supabase temporário e apaga os arquivos abertos.

O resultado esperado termina em `RESTAURAÇÃO OK`, com 0 diferenças.

Dois ajustes são feitos só na restauração de teste. Os dois vêm do próprio Supabase, não do app:
- **Permissão interna do Realtime:** a linha `GRANT SET ON PARAMETER ... TO supabase_realtime_admin` é ignorada. Ela já existe em todo Supabase novo, e o papel `postgres` não pode concedê-la.
- **Dados do esquema `storage`:** não são restaurados e aparecem listados no fim. Essas tabelas pertencem ao serviço de Storage e guardam só metadados; os arquivos em si não entram em dump de banco. O app ainda não usa Storage. Quando passar a usar (anexos, Fase 6), o backup dos arquivos precisa de um passo próprio.

O script foi validado em 06/10/2026 com um dump do Supabase local: 92 tabelas conferidas, 0 diferenças, 73 usuários e 408 lançamentos restaurados. O teste com um backup real da produção ainda falta e deve ser feito antes da troca (passo T10).
