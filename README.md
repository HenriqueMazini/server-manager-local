# Server Manager

Painel local para ligar e desligar seus ambientes de desenvolvimento em Docker com um clique,
acompanhando quanta memória cada um consome.

A ideia é simples: projeto em que você não está trabalhando não precisa ficar ocupando memória.
O painel junta tudo o que um projeto usa, bancos, filas, containers e servidores de
desenvolvimento como `npm run dev`, e liga ou desliga o conjunto de uma vez.

**http://localhost:9090**

## O que ele faz

- **Liga e desliga projetos inteiros.** Um botão sobe os bancos, espera eles ficarem saudáveis
  e só então sobe os apps. Desligar faz o caminho inverso.
- **Roda seus apps de desenvolvimento.** Cada app (`npm run dev`, `npm run start:dev`...) roda
  num container Node com a pasta do projeto montada. O hot reload continua funcionando e o app
  responde em `localhost`, na porta de sempre.
- **Reinicia para liberar memória.** Servidores de desenvolvimento acumulam memória com o tempo.
  O botão de reiniciar mata a árvore inteira de processos e mostra quanto foi liberado.
- **Mostra a memória em tempo real.** Quanto cada projeto consome, atualizado a cada 2 segundos.
- **Mostra quem mais usa a memória da máquina.** Ao lado da memória dos ambientes, um cartão
  mostra o uso total do computador e os aplicativos acima de 1 GB, como navegador e editor.
- **Acompanha as sessões do Claude Code.** O primeiro item da lista mostra cada sessão aberta, com
  pasta, estado e memória, incluindo os servidores MCP e os comandos que ela está rodando.
- **Analisa projetos novos.** O botão "Criar server" lista as pastas de `~/projetos`, analisa a
  escolhida e aponta o que falta, com um prompt pronto para o Claude Code do projeto resolver.
- **Gerencia portas.** Lista todas as portas em uso e, quando dois projetos disputam a mesma,
  sugere uma porta livre e gera o prompt para corrigir.
- **Mostra URLs e logs.** Links de acesso de cada app e container, e os logs ao vivo de cada um.

## Requisitos

- **Linux.** O painel usa a rede e o `/proc` da máquina, então não funciona no Docker Desktop
  do macOS ou do Windows.
- **Docker Engine** com **Docker Compose v2** (o comando `docker compose`).
- Seu usuário no grupo `docker`, para usar o Docker sem `sudo`:

  ```bash
  sudo usermod -aG docker $USER   # depois, saia e entre de novo na sessão
  ```

- **Seus projetos em `~/projetos`.** É a pasta padrão, uma subpasta por projeto. Se ela não
  existir, o painel funciona do mesmo jeito, só não lista pastas no "Criar server".

Node e Go não são necessários para usar o painel: tudo é compilado dentro do Docker.

## Instalação

```bash
git clone https://github.com/HenriqueMazini/server-manager-local.git ~/projetos/server-manager-local
cd ~/projetos/server-manager-local
scripts/install.sh
```

O script confere os requisitos, grava no `.env` o seu usuário e o grupo do Docker, constrói a
imagem e sobe o painel. Ao terminar, abra **http://localhost:9090**.

O painel sobe sozinho quando o computador liga (`restart: unless-stopped`) e usa cerca de 10 MB
de memória.

<details>
<summary>Instalação manual, sem o script</summary>

```bash
cat > .env <<ENV
HOST_UID=$(id -u)
HOST_GID=$(id -g)
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
ENV
docker compose up -d --build
```

</details>

## Primeiros passos

Assim que abre, o painel já mostra cada projeto Docker Compose e cada container da máquina,
agrupados por projeto. Você já pode ligar, desligar e ver a memória deles.

Para juntar num só projeto os containers e os apps de desenvolvimento, cadastre o projeto de um
destes jeitos:

1. **Pelo botão "Criar server".** Escolha a pasta na lista. O painel analisa o projeto, só lendo
   arquivos, e mostra cada requisito numa linha:
   - **ok**: atendido.
   - **pendente**: impede a criação. Traz um prompt para colar no Claude Code do projeto.
   - **atenção**: funciona, mas merece revisão, como chaves de pagamento preenchidas no `.env`.
   - **informação**: contexto, como migrations a rodar depois.

   Sem pendências, o modal mostra o bloco pronto para o `services.yml`. Copie e cole no arquivo.

2. **Pelo Claude Code do projeto.** Abra o Claude Code na pasta do projeto e peça:

   ```
   Leia ~/projetos/server-manager-local/docs/ADICIONAR-PROJETO.md e siga as instruções para adicionar este projeto ao Server Manager.
   ```

3. **À mão.** Copie o exemplo e edite:

   ```bash
   cp services.example.yml services.yml
   ```

O painel relê o `services.yml` sozinho, sem reiniciar.

## Uso no dia a dia

| Quero | Como |
|---|---|
| Ligar ou desligar um projeto | Interruptor à direita do projeto |
| Liberar memória de um projeto ligado | Botão de reiniciar, ao lado do interruptor |
| Ver apps, containers, portas e logs | Clique no nome do projeto: os detalhes abrem à direita |
| Abrir o sistema no navegador | Links abaixo do nome do projeto |
| Copiar a URL de um banco ou cache | Clique no endereço do container nos detalhes |
| Ver as sessões do Claude Code | Primeiro item da lista |
| Ver todas as portas em uso | Seção "Portas", no fim da lista |
| Resolver conflito de porta | "Copiar prompt" no aviso de conflito e cole no Claude Code do projeto |
| Trocar o tema | Botão ao lado de "ao vivo". Claro das 6h às 18h e escuro no resto do dia; a troca manual vale até a próxima virada |

**Estados das sessões do Claude:** verde é trabalhando, amarelo é aguardando você e cinza é
ociosa. O painel só lê as sessões, não abre nem fecha nenhuma.

**Se um app não subir**, abra os logs dele nos detalhes do projeto. Os erros mais comuns:

| No log | Causa provável |
|---|---|
| `EADDRINUSE` | A porta já está em uso, geralmente pelo mesmo app aberto num terminal. Feche o terminal. |
| `Cannot find module` ou erro de binário nativo | Falta `npm install` no projeto, ou a versão do Node é outra. Use `image:` no app. |
| `ECONNREFUSED` para banco ou Redis | O `.env` aponta para outra porta, ou o banco não está no projeto. |

## Configuração

### services.yml

Opcional. Sem ele, cada projeto compose e cada container avulso aparece sozinho. Os campos
estão comentados em [services.example.yml](services.example.yml). Resumo:

```yaml
projects:
  loja:                          # chave curta
    name: Loja                   # nome no painel
    dir: ~/projetos/loja         # pasta do projeto
    compose: [loja]              # projetos docker compose que fazem parte
    containers: []               # containers avulsos que fazem parte
    apps:                        # servidores de desenvolvimento
      - key: web
        name: Sistema
        dir: frontend            # relativo ao dir do projeto
        command: npm run dev
        port: 5173
hide: []                         # o que não deve aparecer
ports:
  reserved: []                   # portas que nunca serão sugeridas como livres
```

Os apps rodam na imagem `node:24-bookworm-slim`, com o seu usuário e a rede da máquina, usando o
`node_modules` que já está na pasta. Para outra versão do Node, use `image: node:20-bookworm-slim`.

### Variáveis de ambiente

Ficam no `docker-compose.yml` e no `.env`.

| Variável | Padrão | Para quê |
|---|---|---|
| `SM_ADDR` | `127.0.0.1:9090` | Endereço do painel |
| `SM_CONFIG` | `/config/services.yml` | Arquivo de configuração |
| `SM_PROJECTS_ROOT` | `~/projetos` | Pasta listada no "Criar server" |
| `SM_APP_IMAGE` | `node:24-bookworm-slim` | Imagem padrão dos apps |
| `HOST_UID`, `HOST_GID` | gravados pelo instalador | Usuário que roda o painel e os apps |
| `DOCKER_GID` | gravado pelo instalador | Grupo com acesso ao Docker |

## Segurança

- O painel escuta só em `127.0.0.1`, e recusa acessos que não venham de `localhost`.
- Ações como ligar e desligar exigem um header próprio, então outro site aberto no navegador
  não consegue mexer nos seus containers.
- **Acesso ao Docker equivale a acesso de administrador.** O painel usa o socket do Docker para
  ligar e desligar containers. Não exponha a porta 9090 na rede.
- A sua home e o `/proc` são montados **somente para leitura**: o painel lê projetos e sessões,
  mas não altera arquivos. As análises do "Criar server" também só leem.
- Os prompts gerados nunca incluem valores de senhas ou chaves, só os nomes das variáveis.

## Atualizar

```bash
cd ~/projetos/server-manager-local
git pull
scripts/install.sh
```

Uma aba aberta numa versão antiga avisa no rodapé que o painel foi atualizado.

## Desinstalar

```bash
cd ~/projetos/server-manager-local
docker compose down --rmi all
docker rm -f $(docker ps -aq --filter label=server-manager.project) 2>/dev/null
```

O segundo comando remove os containers de apps que o painel criou (`sm-<projeto>-<app>`). Seus
projetos, bancos e volumes não são tocados. Depois, apague a pasta.

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `defina DOCKER_GID no .env` ao subir | Rode `scripts/install.sh`, que cria o `.env`. |
| Painel mostra "Docker indisponível" | O GID do Docker mudou. Rode `scripts/install.sh` de novo. |
| "Criar server" sem pastas | Confira se `~/projetos` existe e tem projetos. |
| "Sessões do Claude" indisponível | Suba pelo `docker compose` deste repositório, que monta o `/proc`. |
| Algo diferente | `docker compose logs -f server-manager` |

## Desenvolver

Stack: backend em **Go** com o SDK oficial do Docker, painel em **React 19**, **Vite 8** e
**Tailwind 4**, embutido no binário. Atualização ao vivo por Server-Sent Events.

```bash
go test ./...                                           # testes do backend
SM_ADDR=127.0.0.1:9091 SM_CONFIG=services.yml go run .  # backend fora do Docker
cd web && npm install && SM_BACKEND=http://localhost:9091 npm run dev   # painel com hot reload
cd web && npm run typecheck && npm run build            # build embutido no binário Go
```

| Caminho | Conteúdo |
|---|---|
| `main.go` | configuração e servidor HTTP |
| `internal/dockerx` | cliente Docker: listar, ligar, desligar, memória, eventos, logs |
| `internal/projects` | projetos, apps, `services.yml` e URLs por tipo de imagem |
| `internal/control` | ordem de ligar, desligar e reiniciar um projeto |
| `internal/analyze` | análise do "Criar server" e os prompts de cada pendência |
| `internal/claude` | sessões do Claude Code e a memória de cada uma |
| `internal/procfs` | leitura dos processos da máquina e agrupamento por aplicativo |
| `internal/ports` | conflitos de porta e porta livre sugerida |
| `internal/hostinfo` | memória e portas em uso da máquina |
| `internal/state` | estado em memória, atualizado por eventos do Docker e a cada 2 s |
| `internal/httpapi` | API JSON, stream SSE e o painel embutido |
| `web/` | o painel |

API: `GET /api/snapshot`, `GET /api/events` (SSE), `GET /api/ports`, `GET /api/folders`,
`GET /api/version`, `POST /api/projects/{chave}/start|stop|restart`, `POST /api/analyze`,
`GET /api/containers/{id}/logs` e `GET /healthz`. Ações exigem o header `X-Server-Manager: 1`.

## Versões

A versão fica no arquivo `VERSION` e aparece no rodapé do painel. O histórico está no
[CHANGELOG](CHANGELOG.md).

Para lançar uma versão, anote as mudanças em **Não lançado** no changelog e rode:

```bash
scripts/release.sh patch   # correção: 0.5.0 -> 0.5.1
scripts/release.sh minor   # novidade: 0.5.0 -> 0.6.0
scripts/release.sh major   # mudança incompatível: 0.5.0 -> 1.0.0
git push origin main --follow-tags
```

## Licença

[MIT](LICENSE). Use, modifique e compartilhe à vontade.
