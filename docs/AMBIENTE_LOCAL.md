# Ambiente local

O `supabase start` sobe o Supabase inteiro em contêineres. Ele precisa de um motor de contêineres compatível com a API do Docker. Este guia cobre três opções para Windows. Escolha uma.

## Requisito comum: WSL2

As três opções rodam os contêineres dentro do WSL2. Instalar o WSL2 exige **administrador e um reinício**, qualquer que seja a opção.

```powershell
# PowerShell como administrador
wsl --install --no-distribution
# reiniciar o Windows
wsl --status   # depois do reinício: "Versão padrão: 2"
```

## Opção 1 — Docker Desktop

- Licença: gratuito para uso pessoal, educação, projetos open source e empresas com menos de 250 funcionários **e** menos de US$ 10 milhões de receita anual. Fora disso, exige assinatura paga.
- Instalação (administrador), com o instalador já baixado e com a assinatura da Docker Inc conferida:

```powershell
& 'C:\Users\hzs\tools\DockerDesktopInstaller.exe' install --quiet --accept-license --backend=wsl-2
```

## Opção 2 — Rancher Desktop

- Licença: Apache 2.0, gratuito em qualquer caso.
- Instalador MSI em https://rancherdesktop.io (GitHub `rancher-sandbox/rancher-desktop`, releases). Oferece instalação só para o usuário atual; o WSL2 continua exigindo administrador.
- Configuração: em **Preferences → Container Engine**, escolher **dockerd (moby)**, não `containerd`. O Supabase CLI fala com a API do Docker; com `containerd` não funciona.
- Kubernetes pode ficar desligado (**Preferences → Kubernetes**), para economizar memória.

## Opção 3 — Podman Desktop

- Licença: Apache 2.0, gratuito em qualquer caso.
- Instalador em https://podman-desktop.io. Na primeira execução, criar a máquina Podman (usa WSL2) e ligar a **compatibilidade com Docker** (**Settings → Docker Compatibility**), que publica a API no pipe `\\.\pipe\docker_engine`.
- Ponto de atenção: o serviço de analytics do Supabase local monta o socket do Docker e costuma falhar com Podman. Se o `supabase start` falhar nele, desligar em `supabase/config.toml`:

```toml
[analytics]
enabled = false
```

  Isso só afeta os logs do Studio local; banco, autenticação, API e testes continuam iguais.

## Conferência, qualquer que seja a opção

```powershell
docker version                 # cliente e servidor respondem
npx supabase start             # sobe o Supabase local
npx supabase test db           # roda os testes pgTAP de supabase/tests
npx supabase stop
```

## Cliente PostgreSQL

`pg_dump` e `psql` 18.4 ficam em `C:\Users\hzs\tools\pgsql\bin` (binários oficiais da EDB, sem instalador), já no PATH do usuário. Servem para o dump do esquema com o usuário só de leitura e para os backups.
