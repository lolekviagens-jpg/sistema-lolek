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
- `checkin.js` — aba Check-in do dia (somente leitura, sem cadastro manual). Lê uma planilha do Google Sheets via endpoint público CSV (`/gviz/tq?tqx=out:csv`) — a planilha precisa estar compartilhada como "Qualquer pessoa com o link — Leitor". Constantes no topo: `SHEET_ID`, mapa `COL` (índices 0-based das colunas: B=situação, E=nome, F=data ida, G=data volta, H=saída, I=destino, J=companhia, L=localizador). Ignora linhas canceladas (regex em `situacao`). Organiza os passageiros em 4 seções por data relativa (ida/volta × hoje/amanhã). Cada passageiro tem botão de confirmar que grava o horário em `localStorage` (chave `lolek_checkins_confirm`, mapa `key → ISO timestamp`); a `confirmKey` combina localizador/nome + perna + data. Inclui parser de CSV próprio (`parseCsv`) e `parseDate` que aceita formatos `Date(a,m,d)`, DD/MM/AAAA e ISO. Todo texto da planilha passa por `escapeHtml` antes do `innerHTML`.

Padrão para uma nova aba com dados: criar `<aba>.js` como IIFE, usar uma chave própria em `localStorage` (`lolek_<aba>`), e incluí-lo com `<script>` ao final de `index.html` depois de `navigation.js`.

### CSS

Arquivo único `style.css`. Identidade visual fica em variáveis no `:root` — **sempre reutilizar essas variáveis** em vez de cores/medidas literais:

- `--navy: #0a1f3d`, `--gold: #c9a84c` (cores da marca) e variações
- Tipografia: `--font-title` (Cormorant Garamond, títulos) e `--font-body` (Montserrat, corpo)
- `--sidebar-w`, `--radius`, `--shadow` para layout

Componentes reutilizáveis já existentes: `.btn` (`.btn--gold`, `.btn--ghost`, `.btn--icon`), `.input`, `.field`, `.card`, `.table`, `.badge` (`.badge--<status>`), `.stat`, `.modal`, `.empty-state`. Preferir compor com essas classes ao criar novas telas.
