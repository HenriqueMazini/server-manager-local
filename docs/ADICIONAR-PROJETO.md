# Adicionar um projeto ao Server Manager

Instruções para um agente (Claude Code) rodando **dentro do projeto que será adicionado**.
Siga as etapas na ordem. Cada etapa diz o que descobrir, o que escrever e como conferir.

O Server Manager é um painel local em **http://localhost:9090** que liga e desliga ambientes de
desenvolvimento para economizar memória. Ele roda em Docker, a partir de
`~/projetos/server-manager-local`. Todo projeto que ele conhece está em um único arquivo:

```
~/projetos/server-manager-local/services.yml
```

O painel relê esse arquivo sozinho a cada 2 segundos. Não é preciso reiniciar nada.

## Regras

- **Edite só o bloco deste projeto** dentro de `projects:` no `services.yml`. Não altere outros
  projetos, o `hide`, o `ports.reserved` nem qualquer outro arquivo do Server Manager.
- **Não mude portas deste projeto** para caber no painel. Se houver conflito, pare e relate (etapa 6).
- **Não ligue o projeto pelo painel sem pedir ao usuário.** Ligar sobe os apps de verdade (etapa 8).
- **Não invente valores.** Se não encontrar a porta ou o comando de um app, pergunte ao usuário.

## Etapa 1: confirmar que o painel está no ar

```bash
curl -s localhost:9090/healthz
```

A resposta esperada é `{"status":"ok"}`. Se não responder, peça ao usuário para subir o painel:

```bash
cd ~/projetos/server-manager-local && docker compose up -d --build
```

## Etapa 2: ler o formato e o exemplo

Leia o `services.yml` inteiro. Se ele não existir, crie a partir do `services.example.yml`
(`cp services.example.yml services.yml`). O topo tem o formato comentado, e o projeto `loja` do
exemplo é a referência: um monorepo com banco em compose e dois apps (frontend e API).

Resumo dos campos:

| Campo | Obrigatório | Significado |
|---|---|---|
| `projects.<chave>` | sim | Identificador curto, minúsculo, sem espaços (ex.: `loja`). Vira parte do nome dos containers dos apps. |
| `name` | sim | Nome exibido no painel. |
| `dir` | sim | Pasta raiz do projeto. Aceita `~`. Essa pasta é montada nos containers dos apps. |
| `compose` | não | Nomes de projetos Docker Compose que pertencem a este projeto. |
| `containers` | não | Containers avulsos (criados com `docker run`) que pertencem a este projeto. |
| `apps` | não | Processos de desenvolvimento que o painel roda. Um item por processo. |
| `apps[].key` | sim | Identificador curto do app (ex.: `web`, `api`). O container se chama `sm-<projeto>-<key>`. |
| `apps[].name` | sim | Nome exibido (ex.: `Sistema`, `API`). |
| `apps[].dir` | sim | Pasta do app, relativa ao `dir` do projeto. Use `.` quando for a própria raiz. |
| `apps[].command` | sim | Comando de desenvolvimento, exatamente como o usuário roda no terminal. |
| `apps[].port` | recomendado | Porta em que o app escuta. O painel também injeta `PORT=<port>`. |
| `apps[].url` | não | Link de acesso. O padrão é `http://localhost:<port>`. Use para apontar uma rota, como `/docs`. |
| `apps[].image` | não | Imagem do container. O padrão é `node:24-bookworm-slim`. |
| `apps[].env` | não | Variáveis extras. Não repita o que já está no `.env` do app, porque ele já é lido. |

Como o painel roda cada app:
- O app roda num container da imagem escolhida, com a pasta `dir` do projeto montada **no mesmo
  caminho** e com a **rede da máquina**. `localhost` dentro do app é a própria máquina, então os
  bancos continuam em `localhost:<porta>` e o app responde em `localhost:<port>`.
- O `node_modules` usado é o que já está na pasta. Nada é instalado.
- O processo roda com o usuário do dono da máquina. Arquivos gerados continuam dele.
- Ao ligar o projeto, os containers de `compose` e `containers` sobem primeiro. O painel espera os
  healthchecks e então sobe os apps na ordem da lista. Ao desligar, o caminho é o inverso.

## Etapa 3: descobrir a infraestrutura

Liste os containers e projetos compose existentes:

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}'
docker compose ls -a
```

- Um projeto compose pertence a este projeto quando o `working_dir` dele fica dentro da pasta deste
  projeto. Anote o nome do projeto compose, que é a coluna do label `com.docker.compose.project`.
- Containers sem label de compose pertencem a este projeto quando o `.env` ou a documentação daqui
  apontam para as portas deles. Anote os nomes.
- Leia os arquivos `.env` e `docker-compose*.yml` deste projeto para saber quais bancos e portas os
  apps usam. Confira que as portas batem com os containers que você anotou.

**Atenção:** o painel só liga e desliga containers que **já existem**. Se um serviço do compose deste
projeto nunca foi criado, ele não aparece em `docker ps -a`. Nesse caso, diga ao usuário quais
serviços faltam e sugira criá-los uma vez, sem deixá-los ligados:

```bash
docker compose up -d <serviços> && docker compose stop <serviços>
```

Não rode isso sem a confirmação do usuário.

## Etapa 4: descobrir os apps

Para cada pacote com servidor de desenvolvimento (monorepos costumam ter mais de um):

1. Leia o `package.json` e identifique o script de desenvolvimento (`dev`, `start:dev`, `serve`...).
   O `command` fica como `npm run <script>`, ou `pnpm`/`yarn` se o projeto usa esse gerenciador.
2. Descubra a porta em que ele escuta. Procure nesta ordem: `PORT` no `.env` do pacote, flag `-p` ou
   `--port` no script, configuração do framework (`vite.config`, `next.config`, `main.ts`), e o padrão
   do framework (Next 3000, Vite 5173, Nest 3000, Angular 4200).
3. Confira se o `node_modules` existe no pacote. Se não existir, diga ao usuário para rodar a instalação
   antes. O painel não instala dependências.
4. Confira a versão do Node exigida (`engines` no `package.json`, `.nvmrc`, `.node-version`). Se não for
   Node 24, use `image: node:<versão>-bookworm-slim` no app. Use imagens **bookworm** (Debian), nunca
   `alpine`: o `node_modules` foi instalado na máquina e seus binários nativos não rodam em Alpine.
5. Coloque primeiro na lista o app que é a tela principal. O primeiro link aparece em destaque no painel.

**Atenção à variável `PORT`:** o painel injeta `PORT=<port>`. Se o app usa `PORT` para outra coisa,
não defina `port` para ele e avise o usuário.

**Apps que não são Node** (Python, Go, Ruby...): só configure se a imagem tiver o mesmo toolchain usado
na máquina e as dependências estiverem dentro da pasta do projeto. Ambientes virtuais que apontam para
o Python da máquina não funcionam no container. Na dúvida, deixe o app fora e explique ao usuário.

## Etapa 5: checar se é seguro rodar

Antes de adicionar apps, leia os `.env` que eles usam, sem copiar valores secretos para a conversa.
Pare e avise o usuário se encontrar qualquer um destes sinais:

- Banco, Redis ou fila apontando para produção ou para um servidor fora da máquina.
- Chaves reais de envio (WhatsApp, e-mail, SMS, push) ou de cobrança (gateways de pagamento).
- Agendadores, crons ou workers ligados por padrão que disparam ações externas.

O usuário decide se o app entra assim mesmo.

## Etapa 6: conferir portas

```bash
curl -s localhost:9090/api/ports
```

A resposta traz `ports`, que é tudo que está em uso, e `conflicts`. Verifique se as portas dos apps
deste projeto já aparecem usadas por **outro** projeto ou por um processo da máquina (`"kind": "host"`).

- Se a porta aparece como `host` só porque o próprio app está rodando agora num terminal, tudo bem.
  Avise o usuário para fechar esse terminal antes de ligar pelo painel.
- Se a porta pertence a outro projeto, **não troque portas**. Relate o conflito ao usuário. Depois de
  salvar o bloco, o painel detecta o conflito sozinho e oferece um prompt pronto para resolver.

## Etapa 7: escrever o bloco

Acrescente o bloco dentro de `projects:` no `services.yml`, com a mesma indentação dos outros projetos.
Modelo:

```yaml
  loja:
    name: Loja
    dir: ~/projetos/loja
    compose: [loja]
    containers: []
    apps:
      - key: web
        name: Sistema
        dir: frontend
        command: npm run dev
        port: 5173
      - key: api
        name: API
        dir: backend
        command: npm run start:dev
        port: 3010
        url: http://localhost:3010/docs
```

## Etapa 8: verificar no painel

Espere 3 segundos e consulte o estado:

```bash
curl -s localhost:9090/api/snapshot | python3 -c '
import json, sys
s = json.load(sys.stdin)
print("erro:", s.get("error"))
for p in s["projects"]:
    print(p["key"], p["name"], p["state"], p["warnings"])
    for c in p["apps"] + p["infra"]:
        print("   ", c["role"], c["label"], c["name"], c["state"], [pt["hostPort"] for pt in c["ports"]])
'
```

Confira:

- `erro` precisa ser `None`. A mensagem `services.yml inválido` significa YAML quebrado. Corrija a
  indentação e verifique de novo.
- O projeto aparece com a chave escolhida, com todos os apps e containers esperados.
- Nenhum container deste projeto aparece solto em outro projeto. Se aparecer, faltou o nome dele em
  `compose` ou `containers`.
- `warnings` vazio. Um aviso de porta ocupada significa que algo já usa a porta de um app.
- Nenhum conflito novo em `curl -s localhost:9090/api/ports`.

Só então pergunte ao usuário se ele quer testar ligando o projeto. Se ele autorizar:

```bash
curl -s -X POST -H 'X-Server-Manager: 1' localhost:9090/api/projects/<chave>/start
```

Acompanhe até `state` virar `on`, repetindo o comando de estado acima. Se um app não subir, leia o log:

```bash
docker logs --tail 80 sm-<chave>-<key>
```

Erros comuns nos logs:

| Sintoma | Causa provável |
|---|---|
| `EADDRINUSE` logo ao subir | Porta já em uso, geralmente o mesmo app aberto num terminal. |
| `Cannot find module` ou erro de binário nativo | `node_modules` ausente, ou versão do Node diferente da imagem. |
| `ECONNREFUSED` para banco ou Redis | Porta errada no `.env`, ou o container do banco não está no bloco. |
| Permissão negada ao escrever arquivos | Pasta do projeto com dono diferente do usuário da máquina. |

Para desligar depois do teste:

```bash
curl -s -X POST -H 'X-Server-Manager: 1' localhost:9090/api/projects/<chave>/stop
```

## Etapa 9: relatar ao usuário

Termine com um resumo curto:

- O bloco adicionado, com os apps, portas e containers.
- Links de acesso de cada app.
- Pendências: serviços compose nunca criados, `node_modules` ausente, conflitos de porta, avisos da etapa 5.
- O painel está em http://localhost:9090.
