# Changelog

Versões do Server Manager, da mais nova para a mais antiga. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a numeração segue
[versionamento semântico](https://semver.org/lang/pt-BR/): `MAIOR.MENOR.CORREÇÃO`.

A 0.5.0 é a primeira versão pública; as anteriores ficam registradas aqui, sem tag.

Anote cada mudança em **Não lançado** no mesmo commit que a faz. O script
`scripts/release.sh` transforma essa seção na próxima versão.

## [Não lançado]

### Adicionado
- Cartão "Memória do computador" no topo, ao lado da memória dos ambientes: uso total da máquina,
  cache, memória disponível e os aplicativos acima de 1 GB, com os processos de cada um somados.

### Alterado
- Sessões do Claude ordenadas por quem está trabalhando e, depois, pela última atualização, que
  aparece em cada linha.
- No celular, "Criar server" e "ao vivo" viram só ícone para o cabeçalho caber numa linha.
- Sessões do Claude e aplicativos da máquina usam uma única leitura do `/proc` por atualização.

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

[Não lançado]: https://github.com/HenriqueMazini/server-manager-local/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/HenriqueMazini/server-manager-local/releases/tag/v0.5.0
