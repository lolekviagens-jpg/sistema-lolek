# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Toda a comunicação com o usuário, comentários de código e textos de interface devem ser em **português brasileiro**.

## O que é

Sistema web interno da agência **Lolek Viagens**. HTML + CSS + JavaScript puro (sem frameworks, sem build, sem dependências npm). Hospedado no Netlify. Prioridade desktop.

## Como rodar

Não há build nem testes. Abrir `index.html` direto no navegador:

```powershell
Start-Process "index.html"
```

Após editar qualquer arquivo, recarregar a página no navegador para ver as mudanças.

## Arquitetura

App de página única com navegação por abas, sem roteamento de URL. Estrutura em `index.html`:

- **Sidebar fixa** (`.sidebar`) com a marca e os botões de navegação (`.nav__item`, cada um com `data-tab`).
- **Conteúdo** (`.content`) com uma topbar (título + data) e um `<section class="panel">` por aba, identificado por `data-panel`. Apenas o painel com `.is-active` fica visível.

Cada aba do planejamento é um par botão↔painel ligado pelos atributos `data-tab` / `data-panel` (valores: `checkin`, `orcamentos`). Para adicionar uma aba: criar o `.nav__item` na sidebar, o `.panel` correspondente no conteúdo, e registrar o título em `TITLES` dentro de `navigation.js`.

### JavaScript

Cada arquivo `.js` é uma IIFE isolada (`(function(){ "use strict"; ... })()`), sem exports nem variáveis globais compartilhadas. A comunicação entre scripts é feita apenas pelo DOM (IDs/atributos `data-*`).

- `navigation.js` — troca de aba (alterna `.is-active`), atualiza o título da topbar via `TITLES` e renderiza a data de hoje.
- `checkin.js` — aba Check-in do dia (somente leitura, sem cadastro manual). Lê as emissões via `/.netlify/functions/emissoes-data` (GET) + nomes via `/.netlify/functions/clientes-data`, transformando em passageiros por perna com `emissoesParaPassageiros` — produtos `passagem` usam o campo `dados.perna` ("Ida"/"Volta", cadastrado em Nova Emissão) pra saber se usam `data_ida` ou `data_volta` da emissão; produtos `hospedagem` usam `dados.checkin`/`dados.checkout` do próprio produto. Organiza os passageiros em 4 seções por data relativa (ida/volta × hoje/amanhã). Cada passageiro tem botão de confirmar que grava o horário via a Netlify Function `checkins.js` (tabela `checkins` no Supabase, mesmo projeto do Portal Corporativo) — assim o check-in feito em um computador aparece em todos os outros; reconsulta as confirmações a cada 20s (`CONFIRMS_POLL_MS`) além de ao clicar "Atualizar". A `confirmKey` combina localizador/nome + perna + data. Todo texto passa por `escapeHtml` antes do `innerHTML`.

Padrão para uma nova aba com dados: criar `<aba>.js` como IIFE, usar uma chave própria em `localStorage` (`lolek_<aba>`), e incluí-lo com `<script>` ao final de `index.html` depois de `navigation.js`.

### CSS

Arquivo único `style.css`. Identidade visual fica em variáveis no `:root` — **sempre reutilizar essas variáveis** em vez de cores/medidas literais:

- `--navy: #0a1f3d`, `--gold: #c9a84c` (cores da marca) e variações
- Tipografia: `--font-title` (Cormorant Garamond, títulos) e `--font-body` (Montserrat, corpo)
- `--sidebar-w`, `--radius`, `--shadow` para layout

Componentes reutilizáveis já existentes: `.btn` (`.btn--gold`, `.btn--ghost`, `.btn--icon`), `.input`, `.field`, `.card`, `.table`, `.badge` (`.badge--<status>`), `.stat`, `.modal`, `.empty-state`. Preferir compor com essas classes ao criar novas telas.

## Estrutura do projeto (resumo — não precisa re-explorar a cada sessão)

- `index.html` — casca da aplicação (sidebar + um `.panel` por aba) + lista de `<script>` no final.
- Um `<aba>.js` na raiz por aba (IIFE isolada) — ex.: `checkin.js`, `kanban.js`, `orcamentos.js`, `emissoes.js`, `clientes.js`, `vendas.js`, `financeiro.js`, `financeiro-fornecedores.js`, `contratos.js`, `empresas.js`, `usuarios.js`, `followup.js`, `roteiro.js`, `convencao-roma.js`, `auth.js`, `navigation.js`.
- `style.css` — CSS único, variáveis de marca no `:root`. `sw.js`/`manifest.json` — PWA/cache do navegador.
- `portal.html` + `portal.js` — Portal Corporativo (tela separada do `index.html`).
- `netlify/functions/*.js` — backend (Node puro, sem framework), um arquivo por endpoint; navegador nunca acessa o Supabase direto. `_auth.js` tem os helpers compartilhados (`supabaseRest`, `validarSessao`, `registrarAtividade`). `anthropic.js` concentra as chamadas à API da Anthropic.
- Supabase (Postgres) é o banco único, mesmo projeto do Portal Corporativo.
- `netlify.toml` define os cron jobs (`*-cron.js`): `zapsign-reconciliar`, `orcamentos-recentes-limpeza`, `kanban-retomada`.

## Regras para você (Claude Code) economizar tokens nesta sessão

- Antes de abrir um arquivo, usar busca (grep/glob) pra achar só o trecho relevante — não ler arquivo grande inteiro sem necessidade.
- Não reler um arquivo já lido na mesma conversa, a não ser que tenha mudado.
- Ignorar `node_modules`, `dist`, `build`, `.netlify`, arquivos de log e lockfiles.
- Respostas curtas e diretas, em português. Sem resumos longos do que foi feito.
- Tarefa grande: mostrar um plano curto antes de sair executando.
- Ao terminar uma tarefa, lembrar o usuário de rodar `/clear` antes da próxima.
