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
  pasta, estado e memória, incluindo os servidores MCP e os comandos que ela está rodando. As
  sessões fechadas aparecem no fim, agrupadas por projeto, com o comando para retomar a conversa.
- **Avisa quando o Claude termina.** Um sino no topo, com som, avisa quando uma sessão sai de
  "trabalhando" e fica esperando a sua resposta. Dá para silenciar uma sessão específica.
- **Apaga sessões do Claude.** Uma lixeira encerra a sessão e apaga a conversa, depois de uma
  confirmação. Funciona também para conversas já fechadas.
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
- **Python 3 e systemd do usuário**, para o ajudante que apaga sessões do Claude. Já vêm no
  Ubuntu e na maioria das distribuições. Sem eles, o painel funciona e só a lixeira não aparece.

Node e Go não são necessários para usar o painel: tudo é compilado dentro do Docker.

## Instalação

```bash
git clone https://github.com/HenriqueMazini/server-manager-local.git ~/projetos/server-manager-local
cd ~/projetos/server-manager-local
scripts/install.sh
```

O script confere os requisitos, grava no `.env` o seu usuário e o grupo do Docker, cria a pasta
`data/`, instala o ajudante (veja [Segurança](#segurança)), constrói a imagem e sobe o painel. Ao
terminar, abra **http://localhost:9090**.

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
Containers temporários, criados por testes (Testcontainers) ou com `docker run --rm`, ficam fora
da lista; uma linha no fim diz quantos estão ocultos.

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

O painel tem quatro telas, na barra lateral (no celular, embaixo): **Visão geral** (números-chave,
o que precisa de você e o que está ligado), **Projetos**, **Sessões do Claude** e **Sistema e limpeza**
(conflitos, worktrees, sobras, memória do computador e portas). A tela fica no endereço (`#projetos`,
`#sessoes`...), então recarregar e o botão voltar do navegador funcionam. Na visão geral, Ctrl K abre a busca de projetos,
sessões e portas.

| Quero | Como |
|---|---|
| Ligar ou desligar um projeto | Interruptor à direita do projeto |
| Liberar memória de um projeto ligado | "Reiniciar" no painel do projeto, ou o botão ao lado do interruptor em "Ligados agora" |
| Ver apps, containers, portas e logs | Projetos → clique no projeto: o painel ao lado tem as abas Visão, Logs e Portas |
| Abrir o sistema no navegador | Links em "Ligados agora" ou "Abrir" no painel do projeto |
| Copiar a URL de um banco ou cache | Clique no endereço do container nos detalhes |
| Ver as sessões do Claude Code | Tela Sessões do Claude. "Por status" ou "Por projeto" muda o agrupamento; os filtros mostram só um projeto ou um status |
| Saber quando o Claude terminou | Sino no topo, com som e o número no título da aba. Ligue ou desligue na engrenagem (configurações), no pé da barra lateral |
| Receber o aviso no computador, fora do painel | Engrenagem → "Notificação no computador". O navegador pede permissão uma vez; a aba do painel precisa estar aberta, mesmo minimizada |
| Silenciar uma sessão que está em conversa | Sino pequeno antes do nome da sessão |
| Retomar uma conversa fechada | Abra "Fechadas" no fim da lista de sessões e use o botão de terminal: copia o `claude --resume` |
| Apagar uma sessão do Claude | Lixeira na sessão, aberta ou fechada. Confirma numa janela; encerra e apaga a conversa |
| Achar sessões esquecidas em worktrees apagadas | Aparecem em "Precisa da sua atenção" e com a marca "pasta apagada". Encerre pela lixeira |
| Ver todas as portas em uso | Sistema e limpeza → "Portas" |
| Resolver conflito de porta | Aparece em "Precisa da sua atenção". Em Sistema e limpeza, "Copiar prompt" e cole no Claude Code do projeto |
| Limpar os servidores das worktrees de feature | Sistema e limpeza → "Worktrees de …". Remova uma, as já removidas do git ou todas; os volumes só saem se marcar |
| Dar um apelido ao projeto (ex.: o nome antigo) | Lápis ao lado do nome, no painel do projeto. Grava ao sair do campo; fica em `data/apelidos.json` |
| Trocar o tema | Botão ao lado de "ao vivo". Claro das 6h às 18h e escuro no resto do dia; a troca manual vale até a próxima virada |

**Estados das sessões do Claude**, na ordem da lista (o ícone "i" ao lado do título explica cada um):

| Estado | Cor | Quando |
|---|---|---|
| trabalhando | verde | o Claude está executando |
| aguardando você | amarelo | o Claude Code pediu sua ação, como uma permissão |
| aguardando resposta | azul | saiu de trabalhando há até 30 minutos: a vez é sua |
| ociosa | vermelho | sem atualização há 7 dias ou mais |
| parada | cinza | entre 3 e 7 dias, ou sem data |
| recente | amarelo | atualizada há até 3 dias |
| fechada | cinza, no fim | conversa guardada sem sessão aberta |

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
- A única pasta gravável do painel é `data/`, com os apelidos dos projetos.
- **Apagar sessões do Claude passa por um ajudante fora do Docker** (`helper/ajudante.py`), um
  serviço do seu usuário instalado pelo `scripts/install.sh`. Ele só sabe fazer isso e confere
  antes de agir: o processo é mesmo um `claude` daquela conversa e tudo o que apaga fica dentro de
  `~/.claude`. O painel fala com ele por `data/ajudante.sock`, acessível só pelo seu usuário. Assim
  o container nunca tem escrita na `~/.claude`, onde ficam as credenciais do Claude Code.
- Os prompts gerados nunca incluem valores de senhas ou chaves, só os nomes das variáveis.

## Atualizar

```bash
cd ~/projetos/server-manager-local
git pull
scripts/install.sh
```

Uma aba aberta numa versão antiga avisa no pé da barra lateral que o painel foi atualizado.

## Desinstalar

```bash
cd ~/projetos/server-manager-local
docker compose down --rmi all
docker rm -f $(docker ps -aq --filter label=server-manager.project) 2>/dev/null
systemctl --user disable --now server-manager-ajudante.service
rm ~/.config/systemd/user/server-manager-ajudante.service
```

O segundo comando remove os containers de apps que o painel criou (`sm-<projeto>-<app>`). Os dois
últimos removem o ajudante. Seus projetos, bancos, volumes e conversas do Claude não são tocados.
Depois, apague a pasta.

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `defina DOCKER_GID no .env` ao subir | Rode `scripts/install.sh`, que cria o `.env`. |
| Painel mostra "Docker indisponível" | O GID do Docker mudou. Rode `scripts/install.sh` de novo. |
| "Criar server" sem pastas | Confira se `~/projetos` existe e tem projetos. |
| "Sessões do Claude" indisponível | Suba pelo `docker compose` deste repositório, que monta o `/proc`. |
| Lixeira das sessões não aparece | O ajudante não está rodando: `systemctl --user status server-manager-ajudante`. Rode `scripts/install.sh` de novo. |
| Sem som nos alertas | O navegador só toca som depois de um clique na página. Teste em configurações (engrenagem) → "Testar som". |
| Algo diferente | `docker compose logs -f server-manager` |

## Desenvolver

Stack: backend em **Go** com o SDK oficial do Docker, painel em **React 19**, **Vite 8** e
**Tailwind 4**, embutido no binário. Atualização ao vivo por Server-Sent Events.

```bash
go test ./...                                           # testes do backend
python3 -m unittest helper/test_ajudante.py             # testes do ajudante
SM_DOCKER_TEST=1 go test ./internal/dockerx/            # integração com o Docker real
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
| `internal/claude` | sessões do Claude Code (abertas e fechadas), memória e conversa com o ajudante |
| `internal/labels` | apelidos dos projetos, em `data/apelidos.json` |
| `internal/procfs` | leitura dos processos da máquina e agrupamento por aplicativo |
| `internal/ports` | conflitos de porta e porta livre sugerida |
| `internal/hostinfo` | memória e portas em uso da máquina |
| `internal/state` | estado em memória, atualizado por eventos do Docker e a cada 2 s |
| `internal/httpapi` | API JSON, stream SSE e o painel embutido |
| `helper/` | ajudante fora do Docker que encerra e apaga sessões do Claude |
| `scripts/` | `install.sh` (instalar e atualizar) e `release.sh` (lançar versão) |
| `web/` | o painel (alertas e som em `web/src/alerts.ts`) |

API:

| Rota | Para quê |
|---|---|
| `GET /api/snapshot`, `GET /api/events` (SSE) | estado completo, e ao vivo |
| `GET /api/ports`, `GET /api/folders`, `GET /api/version`, `GET /healthz` | portas, pastas de projetos, versão, saúde |
| `POST /api/projects/{chave}/start\|stop\|restart` | ligar, desligar, reiniciar projeto |
| `PUT /api/projects/{chave}/alias` | apelido do projeto |
| `POST /api/analyze` | análise do "Criar server" |
| `POST /api/orphans/remove` | remover containers antigos sem projeto |
| `POST /api/worktrees/remove` | remover containers, redes e, se pedido, volumes de worktrees |
| `POST /api/claude/sessions/{pid}/delete`, `POST /api/claude/closed/{id}/delete` | apagar sessão aberta ou fechada |
| `GET /api/containers/{id}/logs` | logs de um container |

Ações (`POST` e `PUT`) exigem o header `X-Server-Manager: 1`.

## Versões

A versão fica no arquivo `VERSION` e aparece no rodapé do painel. O histórico está no
[CHANGELOG](CHANGELOG.md).

Para lançar uma versão, anote as mudanças em **Não lançado** no changelog e rode:

```bash
scripts/release.sh patch   # correção: 1.3.0 -> 1.3.1
scripts/release.sh minor   # novidade: 1.3.0 -> 1.4.0
scripts/release.sh major   # mudança incompatível: 1.3.0 -> 2.0.0
scripts/release.sh 1.5.0   # número exato
git push origin main --follow-tags
```

## Licença

[MIT](LICENSE). Use, modifique e compartilhe à vontade.
