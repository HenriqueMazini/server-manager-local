# Changelog

Versões do Server Manager, da mais nova para a mais antiga. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a numeração segue
[versionamento semântico](https://semver.org/lang/pt-BR/): `MAIOR.MENOR.CORREÇÃO`.

A 0.5.0 é a primeira versão pública; as anteriores ficam registradas aqui, sem tag.

Anote cada mudança em **Não lançado** no mesmo commit que a faz. O script
`scripts/release.sh` transforma essa seção na próxima versão.

## [Não lançado]

## [1.4.0] - 2026-10-18

### Adicionado
- Notificação no computador (a do sistema, como as outras da área de trabalho) quando uma sessão do
  Claude sai de trabalhando e o painel não está em foco. Liga nas configurações, que pedem a permissão
  do navegador, com botão para testar. Uma notificação por parada, respeitando o silêncio por sessão;
  clicar nela traz o painel e abre as sessões. A aba do painel precisa estar aberta.

## [1.3.1] - 2026-10-17

### Documentação
- README atualizado: alertas com som e silêncio por sessão, sessões fechadas e como retomar, apagar
  sessões pelo ajudante, tabela dos estados das sessões, pasta `data/`, segurança do ajudante,
  desinstalação do serviço, novos problemas comuns e todas as rotas da API.

## [1.3.0] - 2026-10-17

### Adicionado
- Botão de lixeira em cada sessão do Claude: encerra a sessão (se aberta) e apaga a conversa, o
  histórico de arquivos e o ambiente dela, depois de uma janela de confirmação.
- `helper/ajudante.py`: serviço do usuário, fora do Docker, que faz só essa remoção, conferindo que o
  processo é um `claude` da mesma conversa e que tudo apagado fica em `~/.claude`. O painel conversa
  com ele por `data/ajudante.sock` e continua só lendo a home. `scripts/install.sh` instala o serviço.

- Sessões do Claude fechadas no fim da lista, em cinza: conversas guardadas em `~/.claude/projects` sem
  processo aberto, com nome, pasta, última atualização e tamanho. Cada uma copia o comando para retomar
  (`claude --resume`) e pode ser apagada. Agrupadas por projeto (nome do projeto do painel ou da pasta),
  grupos pela conversa mais recente e, dentro, da mais recente para a mais antiga; até 5 por grupo, com
  opção de ver o resto. O painel lê
  só o começo e o fim de cada conversa e guarda o resultado até o arquivo mudar.

### Corrigido
- O serviço de fundo do Claude Code (`claude daemon`) não aparece mais como sessão.

## [1.2.0] - 2026-10-17

### Alterado
- Sino de cada sessão do Claude antes do nome, alinhado em todas as linhas.
- Legenda dos status das sessões dentro de um tooltip, no ícone "i" ao lado de "Sessões do Claude".

## [1.0.0] - 2026-10-17

Primeira versão estável: projetos, sessões do Claude, memória, portas e alertas.

### Adicionado
- Status "aguardando resposta" (azul) nas sessões do Claude: sessões que saíram de trabalhando há até
  30 minutos, ou seja, o Claude terminou e a vez é sua. Fica logo depois de "aguardando você" na ordem
  e entra no resumo e na legenda.
- Sino de alertas no topo: quando uma sessão do Claude entra em "aguardando resposta", o sino ganha
  contador e balança, o título da aba mostra o número e toca um som curto gerado no navegador. Um
  alerta por sessão, sem duplicar; cada um pode ser fechado (ou todos de uma vez) e um alerta fechado
  não volta ao recarregar. O alerta some sozinho quando a sessão volta a trabalhar ou é encerrada.
- Configurações (engrenagem no topo): exibir alertas e tocar som, com botão para testar o som.
- Sino pequeno em cada sessão do Claude para silenciar só aquela sessão: sem alerta e som, útil
  quando a conversa está em andamento. Silenciar tira o alerta que ela já tinha. Vale enquanto a sessão
  estiver aberta e continua ao recarregar o painel.

## [0.7.0] - 2026-10-16

### Alterado
- Gráfico dos últimos 3 minutos com zoom: a escala vai do mínimo ao máximo do período (faixa mínima de
  64 MB ou 2%), com linhas guia, legenda "de X a Y" e valor de cada ponto ao passar o mouse.
- Espaço entre os cartões e a barra de rolagem das colunas, com o lugar da barra sempre reservado.
- Projetos ligados e a linha das sessões do Claude ganham borda leve e um brilho sutil por dentro da borda, na
  cor do projeto no gráfico de memória, mais fortes quando selecionados. A bolinha de cor ficou maior.

## [0.6.0] - 2026-10-16

### Adicionado
- Aviso de containers antigos sem projeto: apps que o painel criou para um projeto ou app renomeado no
  services.yml saem da lista de projetos e aparecem num aviso com botão de remover, que pede confirmação.
  `POST /api/orphans/remove` recalcula a lista no servidor.
- Apelido por projeto, mostrado entre parênteses depois do nome, como "Loja (Vendas)". Serve para
  projetos que mudaram de nome enquanto o repositório e os containers mantêm o antigo. Clique para
  editar; grava ao sair do campo ou com Enter, Esc desfaz e apagar o texto remove o apelido.
- Pasta `data/`, a única gravável do painel, onde ficam os apelidos (`data/apelidos.json`). O
  `scripts/install.sh` cria a pasta. `PUT /api/projects/{chave}/alias`.

### Adicionado
- Cartão "Memória do computador" no topo, ao lado da memória dos ambientes: uso total da máquina,
  cache, memória disponível e os aplicativos acima de 1 GB, com os processos de cada um somados.

### Alterado
- Sessões do Claude classificadas pela última atualização: trabalhando (verde), recente até 3 dias
  (amarelo), parada entre 3 e 7 dias (cinza) e ociosa com 7 dias ou mais (vermelho). Aguardando você
  continua em amarelo. Legenda no cabeçalho das sessões. Ordem: trabalhando, aguardando você, ociosa,
  parada e recente; em cada grupo, por nome.
- Projetos listados por status (ligados, parcialmente ligados, desligados) e, em cada grupo, por nome.
  A cor de cada projeto segue a ordem alfabética da chave, então mudar o status não repinta os outros.
- Sessões do Claude ordenadas por quem está trabalhando e, depois, pela última atualização, que
  aparece em cada linha.
- No celular, "Criar server" e "ao vivo" viram só ícone para o cabeçalho caber numa linha.
- Sessões do Claude e aplicativos da máquina usam uma única leitura do `/proc` por atualização.

### Corrigido
- Cartão de conflito de porta quebrado na coluna estreita: o texto ficava espremido com uma palavra
  por linha. Agora a porta e os botões ficam numa linha e a explicação embaixo, em largura total.

## [0.5.0] - 2026-09-26

### Adicionado
- `scripts/install.sh`: confere requisitos, grava UID, GID e o grupo do Docker no `.env` e sobe o painel.
- README completo, com instalação, uso, configuração, segurança e solução de problemas.
- Sistema de versão: arquivo `VERSION`, este changelog e `scripts/release.sh`.
- Versão do painel no rodapé, com aviso para recarregar quando o servidor foi atualizado.
- Versão em `GET /api/version`, no `GET /healthz` e no snapshot.
- Botão "Criar server": modal que analisa a pasta de um projeto, só lendo arquivos, e lista
  cada requisito com status (ok, pendente, atenção, informação) antes da criação.
- Verificações de compose (arquivo de desenvolvimento em uso, variáveis sem valor, env_file),
  apps Node (script, dependências, porta, versão do Node), .env, serviços citados nos .env,
  conflitos de porta com outros projetos, segurança dos .env e preparação do banco.
- Prompt pronto para o Claude Code do projeto em cada pendência, e um prompt com todas.
- Configuração proposta para o services.yml quando não há pendência obrigatória.
- Lista das pastas de `~/projetos` no modal, com filtro pelo campo e marcação de quem já está
  no painel, tem compose ou tem app Node. Um clique analisa a pasta.
- `~/projetos` é a pasta padrão de projetos (`SM_PROJECTS_ROOT` muda). Se ela não existir,
  o painel não lista nada e não a cria.
- "Sessões do Claude" como primeiro item da lista: cada sessão aberta do Claude Code com nome,
  pasta, estado (trabalhando, aguardando você, ociosa), tempo aberta e memória, somando os
  processos filhos (servidores MCP, comandos em execução). Entra também no gráfico de memória.
  Só leitura: o painel monta o `/proc` do computador em modo somente leitura.
- `POST /api/analyze` e `GET /api/folders`. O painel monta a home em modo somente leitura.

### Alterado
- O painel roda com o usuário e o grupo do Docker de quem instala, e não mais com valores fixos.
- `services.yml` passa a ser local de cada máquina e fica fora do git. O repositório traz
  `services.example.yml`. O compose monta a pasta do painel, então o arquivo é opcional.
- Fora do Docker, `~` é a home de quem roda o painel.
- Testes e documentação sem nomes de projetos reais.
- Cores de status: verde `#4ADE80` para sucesso e amarelo `#FACC15` para neutro, nos dois temas.
  Textos de status no tema claro usam tons mais escuros das mesmas cores para ficar legíveis.
- Cursor de mãozinha em tudo que é clicável, e cursor de bloqueado em botões desativados.

## 0.4.0 - 2026-09-25

### Adicionado
- Tema automático por horário: claro das 6h às 18h, escuro das 18h às 6h.

### Alterado
- A troca manual de tema vale até a próxima virada de horário.

## 0.3.0 - 2026-09-24

### Alterado
- Layout em duas colunas com rolagem independente: projetos à esquerda, detalhes à direita.
- Cabeçalho e cartão de memória mais compactos.
- Fundo do tema escuro em `#0B0D11`.

## 0.2.0 - 2026-09-24

### Adicionado
- Botão para alternar entre tema claro e escuro.
- Mais projetos de exemplo na configuração local.

## 0.1.0 - 2026-09-23

### Adicionado
- Painel local em Docker para ligar, desligar e reiniciar projetos de desenvolvimento.
- Projetos com containers, projetos compose e apps de desenvolvimento.
- Memória dos ambientes em tempo real.
- Inventário e conflitos de porta, com prompt para o Claude Code.
- Guia `docs/ADICIONAR-PROJETO.md`.

[Não lançado]: https://github.com/HenriqueMazini/server-manager-local/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/HenriqueMazini/server-manager-local/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/HenriqueMazini/server-manager-local/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/HenriqueMazini/server-manager-local/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/HenriqueMazini/server-manager-local/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/HenriqueMazini/server-manager-local/compare/v0.7.0...v1.0.0
[0.7.0]: https://github.com/HenriqueMazini/server-manager-local/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/HenriqueMazini/server-manager-local/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/HenriqueMazini/server-manager-local/releases/tag/v0.5.0
