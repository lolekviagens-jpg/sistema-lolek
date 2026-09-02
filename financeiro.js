// ===== Financeiro — Lolek Viagens =====
(function () {
  "use strict";

  const LS_KEY_ANTIGO   = "lolek_financeiro";           // localStorage antigo, só lido uma vez pra migrar
  const LS_KEY_MIGRADO  = "lolek_financeiro_migrado";
  const LS_AI_MODEL     = "lolek_anthropic_model";

  let lancamentos   = [];
  let filtroAtual   = "todos";
  let periodoAtual  = "mes";
  let editando      = null;
  let desbloqueado  = false; // só em memória: recarregar a página (F5) sempre pede a senha de novo
  let senhaAtual    = "";    // guardada em memória pra autenticar cada chamada à function
  let importados    = [];    // linhas extraídas do extrato, aguardando revisão

  function gel(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fBRL(v) {
    return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-sonnet-4-6"; }

  // ===== Chamada à function do Financeiro (Supabase) =====
  async function chamar(action, data) {
    const resp = await fetch("/.netlify/functions/financeiro-data", {
      method: "POST",
      headers: { "content-type": "application/json", ...(window.LolekAuth ? window.LolekAuth.headers() : {}) },
      body: JSON.stringify({ senha: senhaAtual, action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  // ===== Datas: input continua DD/MM/AAAA, banco guarda ISO (date) =====
  function paraISO(strBR) {
    const d = parseData(strBR);
    if (!d) return null;
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function paraBR(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  // Extrai o primeiro objeto JSON balanceado da resposta da IA, ignorando qualquer
  // texto antes/depois (a IA às vezes não obedece "só JSON, sem texto adicional").
  function extractJson(text) {
    const start = String(text || "").indexOf("{");
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
      }
    }
    return null;
  }

  function parseData(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  async function carregarLancamentos() {
    lancamentos = await chamar("listar_lancamentos");
  }

  // Migra o localStorage antigo (usado antes do Financeiro virar Supabase) uma única vez.
  async function migrarLocalStorageAntigo() {
    if (localStorage.getItem(LS_KEY_MIGRADO)) return;
    let antigos = [];
    try { antigos = JSON.parse(localStorage.getItem(LS_KEY_ANTIGO) || "[]"); } catch { antigos = []; }
    if (antigos.length > 0) {
      const convertidos = antigos.map(l => ({
        tipo: l.tipo, status: l.status, descricao: l.descricao, categoria: l.categoria || null,
        origem: l.origem || null, valor: parseFloat(l.valor) || 0,
        vencimento: paraISO(l.vencimento), fonte: "manual",
      }));
      await chamar("importar_lancamentos", { lancamentos: convertidos });
    }
    localStorage.setItem(LS_KEY_MIGRADO, "1");
  }

  // ===== Planilha de vendas (pull automático) =====
  const SHEET_ID  = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv";

  const COL_DATA_EMISSAO = 0;  // A
  const COL_SITUACAO     = 1;  // B
  const COL_NOME         = 4;  // E (nome do cliente; também usada como separador de mês, mas essas linhas têm B vazio)
  const COL_DESTINO      = 8;  // I
  const COL_COMPANHIA    = 9;  // J
  const COL_MILHEIRO     = 10; // K — fornecedor de milhas, ou "TARIFADO"/"-" (compra direta, sem milhas)
  const COL_RESERVA      = 11; // L
  const COL_CARTAO_TAXA  = 13; // N — cartão da agência que pagou a taxa, ou "MILHEIRO" quando não foi no cartão
  const COL_VALOR_TOTAL  = 14; // O
  const COL_LUCRO        = 15; // P
  const COL_VALOR_MILHA  = 17; // R
  const COL_QTD_MILHAS   = 19; // T

  // Mesmo parser usado em vendas.js/checkin.js (copiado — cada script é independente, sem imports).
  function parseCsvPlanilha(text) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseNumPlanilha(s) {
    const str = String(s || "").replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  // Minúsculo, sem acento, espaços colapsados — usado pra chave de dedupe e pra comparar valores da planilha.
  function normalizarTexto(s) {
    return String(s || "").normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase().trim().replace(/\s+/g, " ");
  }

  // Monta um lançamento de entrada a partir de uma linha de venda da planilha, ou null se a linha
  // for subtotal/separador de mês (situação vazia) ou não tiver valor.
  function montarLancamentoDaLinha(cols) {
    const situacao = (cols[COL_SITUACAO] || "").trim();
    if (!situacao) return null;

    const dataEmissao = (cols[COL_DATA_EMISSAO] || "").trim();
    const cliente      = (cols[COL_NOME] || "").trim() || "Cliente";
    const destino      = (cols[COL_DESTINO] || "").trim();
    const companhia    = (cols[COL_COMPANHIA] || "").trim();
    const milheiroRaw  = (cols[COL_MILHEIRO] || "").trim();
    const reserva      = (cols[COL_RESERVA] || "").trim();
    const cartaoRaw    = (cols[COL_CARTAO_TAXA] || "").trim();
    const valorTotal   = parseNumPlanilha(cols[COL_VALOR_TOTAL]);
    const lucro        = parseNumPlanilha(cols[COL_LUCRO]);
    const valorMilha   = parseNumPlanilha(cols[COL_VALOR_MILHA]);
    const qtdMilhas    = parseNumPlanilha(cols[COL_QTD_MILHAS]);

    if (!valorTotal) return null;

    // Inclui situação/cliente/valor além da reserva: uma mesma reserva costuma ter várias linhas
    // (passagem, hospedagem, seguro...) ou vários passageiros no mesmo dia, e só reserva+data colidiria.
    const dedupeKey = normalizarTexto(dataEmissao) + "|" + normalizarTexto(cliente) + "|" + normalizarTexto(situacao) + "|" +
      (reserva ? normalizarTexto(reserva) : normalizarTexto(destino)) + "|" + valorTotal;

    // Origem da taxa de embarque: cartão da agência (guarda o nome) ou "milheiro" quando não foi no cartão.
    // "MÊS ATUAL"/"ANUAL" são resumo de fechamento de mês — nunca deveriam vir com situação preenchida,
    // mas descarta de qualquer forma por segurança.
    let taxaEmbarqueOrigem = null, cartaoNome = null;
    const cartaoNorm = normalizarTexto(cartaoRaw);
    if (cartaoRaw && cartaoNorm !== "mes atual" && cartaoNorm !== "anual") {
      if (/milhe?iro/.test(cartaoNorm)) taxaEmbarqueOrigem = "milheiro";
      else { taxaEmbarqueOrigem = "cartao_agencia"; cartaoNome = cartaoRaw; }
    }

    // "TARIFADO"/"-"/vazio = comprado direto pelo valor do site, sem fornecedor de milhas.
    const milheiroNorm  = normalizarTexto(milheiroRaw);
    const temFornecedor = milheiroRaw && milheiroNorm !== "-" && milheiroNorm !== "tarifado";

    return {
      tipo: "entrada",
      status: "pago",
      descricao: cliente,
      categoria: destino || null,
      origem: companhia || null,
      valor: valorTotal,
      vencimento: paraISO(dataEmissao),
      fonte: "planilha_venda",
      dedupe_key: dedupeKey,
      fornecedor_id: null, // preenchido depois, se a coluna K já estiver vinculada a um fornecedor conhecido
      sheet_meta: {
        reserva: reserva || null,
        companhia: companhia || null,
        lucro,
        valor_milha: valorMilha || null,
        qtd_milhas: qtdMilhas || null,
        milheiro_raw: temFornecedor ? milheiroRaw : null,
        cartao_taxa_raw: cartaoRaw || null,
        taxa_embarque_origem: taxaEmbarqueOrigem,
        cartao_nome: cartaoNome,
      },
    };
  }

  async function puxarPlanilha() {
    try {
      const resp = await fetch(SHEET_URL + "&t=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      const rows = parseCsvPlanilha(text);

      // Uma linha por dedupe_key: o upsert não aceita duas linhas com a mesma chave no mesmo lote
      // (raríssimo, mas acontece quando duas cobranças ficam idênticas — mesmo dia/cliente/valor/serviço).
      const vistos = new Set();
      const novos = [];
      rows.forEach((cols) => {
        const l = montarLancamentoDaLinha(cols);
        if (l && !vistos.has(l.dedupe_key)) { vistos.add(l.dedupe_key); novos.push(l); }
      });
      if (novos.length === 0) return;

      await vincularFornecedoresConhecidos(novos);

      await chamar("upsert_sheet_lancamentos", { lancamentos: novos });
      await carregarLancamentos();
      render();
    } catch (err) {
      console.error("Erro ao puxar planilha de vendas:", err);
    }
  }

  // Vincula cada lançamento a um fornecedor já cadastrado (por alias conhecido) e enfileira
  // pra revisão os nomes da coluna K que ainda não foram vistos nenhuma vez.
  async function vincularFornecedoresConhecidos(novos) {
    let aliasesConhecidos = [];
    try { aliasesConhecidos = await chamar("listar_aliases"); }
    catch { return; } // sem tabela de fornecedores ainda (ou erro pontual) — segue sem vincular

    const porAlias = new Map(aliasesConhecidos.map(a => [a.alias_normalizado, a]));
    const pendentesNovos = new Map(); // alias_normalizado -> alias_original

    novos.forEach((l) => {
      const raw = l.sheet_meta.milheiro_raw;
      if (!raw) return;
      const norm = normalizarTexto(raw);
      const existente = porAlias.get(norm);
      if (existente && existente.fornecedor_id) {
        l.fornecedor_id = existente.fornecedor_id;
      } else if (!existente) {
        pendentesNovos.set(norm, raw);
      }
    });

    if (pendentesNovos.size > 0) {
      const lista = Array.from(pendentesNovos, ([alias_normalizado, alias_original]) => ({ alias_normalizado, alias_original }));
      try { await chamar("registrar_pendencias_alias", { aliases: lista }); } catch { /* tenta de novo no próximo pull */ }
    }
  }

  // ===== Senha (verificada no servidor — FINANCEIRO_SENHA no Netlify, nunca no navegador) =====
  function estaDesbloqueado() { return desbloqueado; }

  function mostrarErroLock(msg) {
    const el = gel("fin-lock-erro");
    el.textContent = msg;
    el.hidden = false;
  }

  function mostrarLock() {
    gel("fin-conteudo").hidden = true;
    gel("fin-lock").hidden = false;
    gel("fin-lock-senha").value = "";
    gel("fin-lock-erro").hidden = true;
    gel("fin-lock-senha").focus();
  }

  async function mostrarConteudo() {
    gel("fin-lock").hidden = true;
    gel("fin-conteudo").hidden = false;
    try {
      await migrarLocalStorageAntigo();
      await carregarLancamentos();
      await carregarContasFixas();
    } catch (err) {
      alert("Erro ao carregar lançamentos: " + err.message);
    }
    render();
    renderVencimentosProximos();
    puxarPlanilha();
  }

  async function tentarEntrar() {
    const senha = gel("fin-lock-senha").value;
    if (!senha) return;

    const btn = gel("fin-lock-btn");
    btn.disabled = true;
    gel("fin-lock-erro").hidden = true;

    try {
      const resp = await fetch("/.netlify/functions/financeiro-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const data = await resp.json();

      if (data.ok) {
        desbloqueado = true;
        senhaAtual = senha;
        mostrarConteudo();
      } else if (resp.status === 500) {
        mostrarErroLock("Senha ainda não configurada no Netlify (variável FINANCEIRO_SENHA).");
      } else {
        mostrarErroLock("Senha incorreta.");
      }
    } catch (err) {
      mostrarErroLock("Erro ao verificar a senha: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function bloquear() {
    desbloqueado = false;
    senhaAtual = "";
    mostrarLock();
  }

  // ===== Filtro de período =====
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dataISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  // Retorna [inicioISO, fimISO] (ambos inclusive) do período selecionado, ou null pra "tudo".
  function intervaloPeriodo() {
    const hoje = new Date();
    const y = hoje.getFullYear(), m = hoje.getMonth();
    switch (periodoAtual) {
      case "tudo": return null;
      case "hoje": { const iso = dataISO(hoje); return [iso, iso]; }
      case "mes": return [dataISO(new Date(y, m, 1)), dataISO(new Date(y, m + 1, 0))];
      case "mes_anterior": return [dataISO(new Date(y, m - 1, 1)), dataISO(new Date(y, m, 0))];
      case "mes_especifico": {
        const valor = gel("fin-periodo-mes").value; // "AAAA-MM"
        if (!valor) return null;
        const [ay, am] = valor.split("-").map(Number);
        return [dataISO(new Date(ay, am - 1, 1)), dataISO(new Date(ay, am, 0))];
      }
      case "trimestre": { const q = Math.floor(m / 3); return [dataISO(new Date(y, q * 3, 1)), dataISO(new Date(y, q * 3 + 3, 0))]; }
      case "ano": return [dataISO(new Date(y, 0, 1)), dataISO(new Date(y, 11, 31))];
      case "personalizado": {
        const ini = gel("fin-periodo-inicio").value, fim = gel("fin-periodo-fim").value;
        return (ini && fim) ? [ini, fim] : null;
      }
      default: return null;
    }
  }

  function lancamentosNoPeriodo() {
    const intervalo = intervaloPeriodo();
    if (!intervalo) return lancamentos.slice();
    const [ini, fim] = intervalo;
    return lancamentos.filter(l => l.vencimento && l.vencimento >= ini && l.vencimento <= fim);
  }

  // ===== Lançamentos =====
  function lancamentosFiltrados() {
    let lista = lancamentosNoPeriodo();
    if (filtroAtual === "entrada")  lista = lista.filter(l => l.tipo === "entrada");
    if (filtroAtual === "saida")    lista = lista.filter(l => l.tipo === "saida");
    if (filtroAtual === "pendente") lista = lista.filter(l => l.status === "pendente");
    lista.sort((a, b) => {
      if (a.vencimento && b.vencimento) return a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0;
      if (a.vencimento) return -1;
      if (b.vencimento) return 1;
      return 0;
    });
    return lista;
  }

  function render() {
    renderStats();
    renderDashboard();
    renderTabela();
    gel("fin-updated").textContent = lancamentos.length + " lançamento" + (lancamentos.length !== 1 ? "s" : "") + " no total";
  }

  function renderStats() {
    let saldo = 0, receber = 0, pagar = 0;
    lancamentosNoPeriodo().forEach(l => {
      const v = parseFloat(l.valor) || 0;
      if (l.status === "pago") {
        saldo += l.tipo === "entrada" ? v : -v;
      } else if (l.tipo === "entrada") {
        receber += v;
      } else {
        pagar += v;
      }
    });
    gel("fin-stat-saldo").textContent   = fBRL(saldo);
    gel("fin-stat-receber").textContent = fBRL(receber);
    gel("fin-stat-pagar").textContent   = fBRL(pagar);
  }

  // ===== Dashboard (cards de receita/custo/lucro + gráficos) =====

  const COR_ENTRADA = "#1f8a4c";
  const COR_SAIDA   = "#c0392b";
  const MES_ABREV   = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const DONUT_CORES = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];

  // Retorna [inicioISO, fimISO] do período imediatamente anterior e equivalente ao selecionado (pra comparar crescimento).
  function intervaloPeriodoAnterior() {
    const hoje = new Date();
    const y = hoje.getFullYear(), m = hoje.getMonth();
    switch (periodoAtual) {
      case "tudo": return null;
      case "hoje": { const ontem = new Date(y, m, hoje.getDate() - 1); const iso = dataISO(ontem); return [iso, iso]; }
      case "mes": return [dataISO(new Date(y, m - 1, 1)), dataISO(new Date(y, m, 0))];
      case "mes_anterior": return [dataISO(new Date(y, m - 2, 1)), dataISO(new Date(y, m - 1, 0))];
      case "mes_especifico": {
        const valor = gel("fin-periodo-mes").value;
        if (!valor) return null;
        const [ay, am] = valor.split("-").map(Number);
        return [dataISO(new Date(ay, am - 2, 1)), dataISO(new Date(ay, am - 1, 0))];
      }
      case "trimestre": { const q = Math.floor(m / 3); return [dataISO(new Date(y, q * 3 - 3, 1)), dataISO(new Date(y, q * 3, 0))]; }
      case "ano": return [dataISO(new Date(y - 1, 0, 1)), dataISO(new Date(y - 1, 11, 31))];
      case "personalizado": {
        const ini = gel("fin-periodo-inicio").value, fim = gel("fin-periodo-fim").value;
        if (!ini || !fim) return null;
        const dIni = new Date(ini + "T00:00:00"), dFim = new Date(fim + "T00:00:00");
        const dias = Math.round((dFim - dIni) / 86400000) + 1;
        const iniAnterior = new Date(dIni); iniAnterior.setDate(iniAnterior.getDate() - dias);
        const fimAnterior = new Date(dIni); fimAnterior.setDate(fimAnterior.getDate() - 1);
        return [dataISO(iniAnterior), dataISO(fimAnterior)];
      }
      default: return null;
    }
  }

  function lancamentosNoIntervalo(intervalo) {
    if (!intervalo) return [];
    const [ini, fim] = intervalo;
    return lancamentos.filter(l => l.vencimento && l.vencimento >= ini && l.vencimento <= fim);
  }

  function somaReceitaCusto(lista) {
    let receita = 0, custo = 0;
    lista.forEach(l => {
      if (l.status !== "pago") return;
      const v = parseFloat(l.valor) || 0;
      if (l.tipo === "entrada") receita += v; else custo += v;
    });
    return { receita, custo };
  }

  // Mostra/esconde uma tooltip compartilhada (usada pelas barras do gráfico) perto do elemento hovered/focado.
  function ativarTooltips(root) {
    const tip = gel("fin-chart-tooltip");
    root.querySelectorAll("[data-tip]").forEach(el => {
      const mostrar = () => {
        tip.textContent = el.dataset.tip;
        tip.hidden = false;
        const rect = el.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();
        let x = rect.left + rect.width / 2 - tipRect.width / 2;
        x = Math.max(8, Math.min(x, window.innerWidth - tipRect.width - 8));
        tip.style.left = x + "px";
        tip.style.top = (rect.top - tipRect.height - 8) + "px";
      };
      const esconder = () => { tip.hidden = true; };
      el.addEventListener("mouseenter", mostrar);
      el.addEventListener("mousemove", mostrar);
      el.addEventListener("mouseleave", esconder);
      el.addEventListener("focus", mostrar);
      el.addEventListener("blur", esconder);
    });
  }

  function renderBarChart() {
    const hoje = new Date();
    const meses = [];
    for (let i = 5; i >= 0; i--) meses.push(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1));

    const dados = meses.map(d => {
      const iniISO = dataISO(new Date(d.getFullYear(), d.getMonth(), 1));
      const fimISO = dataISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const { receita, custo } = somaReceitaCusto(lancamentosNoIntervalo([iniISO, fimISO]));
      return { label: MES_ABREV[d.getMonth()] + "/" + String(d.getFullYear()).slice(2), entrada: receita, saida: custo };
    });

    const max = Math.max(1, ...dados.map(d => Math.max(d.entrada, d.saida)));
    const ALTURA = 150;

    const container = gel("fin-bar-chart");
    container.innerHTML = dados.map(d => {
      const hEntrada = Math.round((d.entrada / max) * ALTURA);
      const hSaida   = Math.round((d.saida   / max) * ALTURA);
      return `
        <div class="fin-bar-group">
          <div class="fin-bar-cols" style="height:${ALTURA}px">
            <div class="fin-bar fin-bar--entrada" style="height:${hEntrada}px" tabindex="0" data-tip="Entradas — ${escHtml(d.label)}: ${fBRL(d.entrada)}"></div>
            <div class="fin-bar fin-bar--saida" style="height:${hSaida}px" tabindex="0" data-tip="Saídas — ${escHtml(d.label)}: ${fBRL(d.saida)}"></div>
          </div>
          <div class="fin-bar-month-label">${escHtml(d.label)}</div>
        </div>`;
    }).join("");

    gel("fin-bar-legend").innerHTML = `
      <span class="fin-legend-item"><span class="fin-legend-dot" style="background:${COR_ENTRADA}"></span>Entradas</span>
      <span class="fin-legend-item"><span class="fin-legend-dot" style="background:${COR_SAIDA}"></span>Saídas</span>`;

    ativarTooltips(container);
  }

  function renderDonutChart() {
    const totais = new Map();
    lancamentosNoPeriodo().forEach(l => {
      if (l.tipo !== "saida" || l.status !== "pago") return;
      const v = parseFloat(l.valor) || 0;
      const cat = (l.categoria || "").trim() || "Outros";
      totais.set(cat, (totais.get(cat) || 0) + v);
    });

    let entradas = Array.from(totais.entries()).sort((a, b) => b[1] - a[1]);

    // Dobra categorias além da 7ª dentro de "Outros" — nunca gera um 9º slot de cor.
    if (entradas.length > 8) {
      const principais = entradas.slice(0, 7);
      const resto = entradas.slice(7).reduce((s, [, v]) => s + v, 0);
      const outrosExistente = principais.find(([cat]) => cat === "Outros");
      if (outrosExistente) outrosExistente[1] += resto;
      else principais.push(["Outros", resto]);
      entradas = principais;
    }

    const total = entradas.reduce((s, [, v]) => s + v, 0);
    const donut  = gel("fin-donut");
    const legend = gel("fin-donut-legend");

    if (total <= 0) {
      donut.style.background = "var(--border)";
      legend.innerHTML = '<span class="fin-chart-vazio">Sem saídas pagas no período</span>';
      return;
    }

    let acumulado = 0;
    const stops = entradas.map(([, v], i) => {
      const cor = DONUT_CORES[i % DONUT_CORES.length];
      const inicio = (acumulado / total) * 360;
      acumulado += v;
      const fim = (acumulado / total) * 360;
      return `${cor} ${inicio}deg ${fim}deg`;
    }).join(", ");
    donut.style.background = `conic-gradient(${stops})`;

    legend.innerHTML = entradas.map(([cat, v], i) => {
      const pct = (v / total * 100).toFixed(1).replace(".", ",");
      const cor = DONUT_CORES[i % DONUT_CORES.length];
      return `
        <div class="fin-legend-item fin-legend-item--block">
          <span class="fin-legend-dot" style="background:${cor}"></span>
          <span class="fin-legend-label">${escHtml(cat)}</span>
          <span class="fin-legend-value">${fBRL(v)} · ${pct}%</span>
        </div>`;
    }).join("");
  }

  function renderDashboard() {
    const { receita, custo } = somaReceitaCusto(lancamentosNoPeriodo());
    const lucro = receita - custo;
    gel("fin-stat-receita").textContent = fBRL(receita);
    gel("fin-stat-custo").textContent   = fBRL(custo);
    gel("fin-stat-lucro").textContent   = fBRL(lucro);

    const elCrescimento = gel("fin-stat-crescimento");
    const intervaloAnterior = periodoAtual === "tudo" ? null : intervaloPeriodoAnterior();
    const anterior = somaReceitaCusto(lancamentosNoIntervalo(intervaloAnterior));

    if (!intervaloAnterior || (anterior.receita === 0 && receita === 0)) {
      elCrescimento.textContent = "—";
      elCrescimento.style.color = "";
    } else if (anterior.receita === 0) {
      elCrescimento.textContent = "▲ novo";
      elCrescimento.style.color = COR_ENTRADA;
    } else {
      const pct = ((receita - anterior.receita) / anterior.receita) * 100;
      const seta = pct >= 0 ? "▲" : "▼";
      elCrescimento.textContent = seta + " " + Math.abs(pct).toFixed(1).replace(".", ",") + "%";
      elCrescimento.style.color = pct >= 0 ? COR_ENTRADA : COR_SAIDA;
    }

    renderBarChart();
    renderDonutChart();
  }

  function renderTabela() {
    const body  = gel("fin-tabela-body");
    const vazio = gel("fin-vazio");
    const lista = lancamentosFiltrados();

    if (lista.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum lançamento encontrado</p></div>';
      return;
    }
    vazio.innerHTML = "";

    body.innerHTML = lista.map(l => {
      const v = parseFloat(l.valor) || 0;
      const corValor = l.tipo === "entrada" ? "#1f8a4c" : "#c0392b";
      return `
        <tr data-id="${escHtml(l.id)}">
          <td>${escHtml(paraBR(l.vencimento) || "—")}</td>
          <td class="table__client">${escHtml(l.descricao)}</td>
          <td class="table__muted">${escHtml(l.categoria || "—")}</td>
          <td class="table__muted">${escHtml(l.origem || "—")}</td>
          <td>${l.tipo === "entrada" ? "Entrada" : "Saída"}</td>
          <td style="color:${corValor};font-weight:600">${fBRL(v)}</td>
          <td><span class="badge badge--${l.status === "pago" ? "concluido" : "pendente"} fin-status-toggle">${l.status === "pago" ? "Pago" : "Pendente"}</span></td>
          <td class="table__actions-col">
            <div class="table__actions">
              <button class="btn btn--ghost btn--icon fin-editar" title="Editar">✏</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".fin-status-toggle").forEach(el => {
      el.addEventListener("click", async () => {
        const l = lancamentos.find(x => x.id === el.closest("tr").dataset.id);
        if (!l) return;
        const statusNovo = l.status === "pago" ? "pendente" : "pago";
        try {
          await chamar("atualizar_lancamento", { id: l.id, status: statusNovo });
          l.status = statusNovo;
          render();
        } catch (err) {
          alert("Erro ao atualizar status: " + err.message);
        }
      });
    });

    body.querySelectorAll(".fin-editar").forEach(btn => {
      btn.addEventListener("click", () => {
        abrirForm(lancamentos.find(x => x.id === btn.closest("tr").dataset.id));
      });
    });
  }

  // ===== Modal de lançamento =====
  function abrirForm(l) {
    editando = l || null;
    gel("fin-modal-titulo").textContent = l ? "Editar lançamento" : "Novo lançamento";
    gel("fin-f-tipo").value       = l ? l.tipo       : "entrada";
    gel("fin-f-status").value     = l ? l.status     : "pendente";
    gel("fin-f-descricao").value  = l ? l.descricao  : "";
    gel("fin-f-categoria").value  = l ? l.categoria  : "";
    gel("fin-f-origem").value     = l ? (l.origem || "") : "";
    gel("fin-f-valor").value      = l ? l.valor      : "";
    gel("fin-f-vencimento").value = l ? paraBR(l.vencimento) : "";
    gel("fin-f-excluir").hidden   = !l;
    gel("fin-modal-lanc").hidden  = false;
    gel("fin-f-descricao").focus();
  }

  function fecharForm() { gel("fin-modal-lanc").hidden = true; editando = null; }

  async function salvarForm() {
    const dados = {
      tipo:       gel("fin-f-tipo").value,
      status:     gel("fin-f-status").value,
      descricao:  gel("fin-f-descricao").value.trim(),
      categoria:  gel("fin-f-categoria").value.trim() || null,
      origem:     gel("fin-f-origem").value.trim() || null,
      valor:      parseFloat(gel("fin-f-valor").value) || 0,
      vencimento: paraISO(gel("fin-f-vencimento").value.trim()),
    };
    if (!dados.descricao) { alert("Descrição obrigatória."); return; }
    if (!dados.valor)     { alert("Informe um valor."); return; }

    const btn = gel("fin-f-salvar");
    btn.disabled = true;
    try {
      if (editando) {
        await chamar("atualizar_lancamento", { id: editando.id, ...dados });
        Object.assign(editando, dados);
      } else {
        dados.fonte = "manual";
        const [criado] = await chamar("criar_lancamento", dados);
        lancamentos.push(criado);
      }
      fecharForm();
      render();
    } catch (err) {
      alert("Erro ao salvar lançamento: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirLancamento() {
    if (!editando) return;
    if (!confirm('Excluir "' + editando.descricao + '"?')) return;
    try {
      await chamar("excluir_lancamento", { id: editando.id });
      lancamentos = lancamentos.filter(l => l.id !== editando.id);
      fecharForm();
      render();
    } catch (err) {
      alert("Erro ao excluir lançamento: " + err.message);
    }
  }

  // ===== Lançamento rápido por texto livre (IA) =====
  // Modelo Haiku (mais rápido/barato) — extrai só 1 lançamento de uma frase curta, então
  // não precisa da precisão do Sonnet usado no extrato (que lê várias transações de uma vez).
  function contextoDataAtualFin() {
    const hoje = new Date();
    return `Hoje é ${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}.`;
  }

  function montarPromptLancamentoRapido(texto) {
    return `${contextoDataAtualFin()} Extraia um único lançamento financeiro do texto abaixo, escrito livremente por uma funcionária de uma agência de viagens (ex: "paguei 150 de internet hoje", "gastei 80 no mercado no pix", "recebi 300 de comissão da Fulana").

Retorne SOMENTE um JSON válido, sem texto adicional, no formato:
{
  "tipo": "entrada" ou "saida" (entrada = recebimento/receita; saida = pagamento/despesa — a maioria dos casos é saida),
  "descricao": "resumo curto do que foi pago/recebido",
  "categoria": uma destas opções, a mais parecida com o gasto (ou "" se nenhuma encaixar bem): ${CATEGORIAS_EXTRATO.join(", ")},
  "valor": número positivo, sem sinal,
  "data": "DD/MM/AAAA" — use hoje se nenhuma data for mencionada, calcule "ontem"/"anteontem" etc. a partir de hoje,
  "origem": "forma de pagamento ou conta/cartão mencionada (ex: Pix, Cartão, Dinheiro, BTG), ou "" se não for mencionada"
}

Texto: "${texto}"`;
  }

  async function analisarLancamentoTexto() {
    const texto = gel("fin-ia-texto").value.trim();
    if (!texto) return;
    const btn = gel("fin-ia-lancar-btn");
    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = "⏳ Analisando...";
    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          messages: [{ role: "user", content: montarPromptLancamentoRapido(texto) }],
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }
      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");
      const ex = JSON.parse(jsonStr);

      // Abre o modal normal de "Novo lançamento" (editando=null, então salvar cria um
      // registro novo) só pré-preenchido — nunca salva sozinho, sempre passa por revisão.
      abrirForm(null);
      gel("fin-f-tipo").value       = ex.tipo === "entrada" ? "entrada" : "saida";
      gel("fin-f-status").value     = "pago"; // "paguei/gastei hoje" já aconteceu — ajustável no modal
      gel("fin-f-descricao").value  = ex.descricao || texto;
      gel("fin-f-categoria").value  = ex.categoria || "";
      gel("fin-f-origem").value     = ex.origem || "";
      gel("fin-f-valor").value      = ex.valor || "";
      gel("fin-f-vencimento").value = ex.data || "";
      gel("fin-ia-texto").value = "";
    } catch (err) {
      alert("Erro ao analisar: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }

  // ===== Contas fixas =====
  let contasFixas   = [];
  let editandoConta = null;
  let pagandoConta  = null;

  async function carregarContasFixas() {
    contasFixas = await chamar("listar_contas_fixas");
  }

  // Quantos dias faltam pro próximo vencimento (hoje mesmo conta como 0) — sempre olha pra
  // frente: se o dia já passou nesse mês, é o dia desse número no mês que vem.
  function diasAteProximoVencimento(diaVencimento) {
    if (!diaVencimento) return null;
    const hoje = new Date();
    const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    let proximo = new Date(hoje.getFullYear(), hoje.getMonth(), diaVencimento);
    if (proximo < hojeSemHora) proximo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, diaVencimento);
    return Math.round((proximo - hojeSemHora) / 86400000);
  }

  function labelDiasRestantes(dias) {
    if (dias === 0) return "vence hoje";
    if (dias === 1) return "vence amanhã";
    return "em " + dias + " dias";
  }

  const DIAS_AVISO_VENCIMENTO = 5;

  function renderVencimentosProximos() {
    const wrap = gel("fin-cf-vencimentos-wrap");
    if (!wrap) return;
    const proximos = contasFixas
      .map(c => ({ ...c, diasRestantes: diasAteProximoVencimento(c.dia_vencimento) }))
      .filter(c => c.diasRestantes != null && c.diasRestantes <= DIAS_AVISO_VENCIMENTO)
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    if (proximos.length === 0) { wrap.hidden = true; wrap.innerHTML = ""; return; }
    wrap.hidden = false;
    wrap.innerHTML = `
      <div class="card" style="padding:14px 16px;border-left:4px solid var(--gold)">
        <div style="font-weight:600;margin-bottom:8px">⏰ Vencimentos próximos</div>
        ${proximos.map(c => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem">
            <span>${escHtml(c.nome)}${c.valor ? " — " + fBRL(c.valor) : ""}</span>
            <span style="color:${c.diasRestantes === 0 ? "#c0392b" : "var(--text-muted)"}">${labelDiasRestantes(c.diasRestantes)}</span>
          </div>`).join("")}
      </div>`;
  }

  function ordenarContasFixas() {
    contasFixas.sort((a, b) => (a.dia_vencimento || 99) - (b.dia_vencimento || 99) || a.nome.localeCompare(b.nome, "pt-BR"));
  }

  function badgeRecorrenciaConta(c) {
    if (c.recorrencia === "parcela") {
      const restantes = c.parcelas_restantes;
      const total = c.parcelas_total;
      // Com o total salvo dá pra mostrar "3/12" (parcela atual/total); contas antigas, criadas
      // antes desse campo existir, só têm o "restantes" mesmo — cai pro formato antigo.
      if (total != null && restantes != null) {
        const atual = Math.min(total, Math.max(1, total - restantes + 1));
        return "Parcela " + atual + "/" + total;
      }
      return "Parcela — " + (restantes != null ? restantes + " restante" + (restantes === 1 ? "" : "s") : "?");
    }
    return "Mensal";
  }

  function renderContasFixas() {
    const body  = gel("fin-cf-tabela-body");
    const vazio = gel("fin-cf-vazio");
    if (!body) return;

    if (contasFixas.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhuma conta fixa cadastrada</p></div>';
      return;
    }
    vazio.innerHTML = "";

    body.innerHTML = contasFixas.map(c => `
      <tr data-id="${escHtml(c.id)}">
        <td>${c.dia_vencimento ? "Dia " + c.dia_vencimento : "—"}</td>
        <td class="table__client">${escHtml(c.nome)}</td>
        <td class="table__muted">${badgeRecorrenciaConta(c)}</td>
        <td class="table__muted">${escHtml(c.banco_cartao || "—")}</td>
        <td>${c.valor ? fBRL(c.valor) : "—"}</td>
        <td class="table__muted">${c.ultima_vez_paga_em ? fBRL(c.ultimo_valor_pago) + " em " + paraBR(c.ultima_vez_paga_em) : "—"}</td>
        <td class="table__actions-col">
          <div class="table__actions">
            <button class="btn btn--ghost btn--icon fin-cf-pagar" title="Marcar como paga">✓</button>
            <button class="btn btn--ghost btn--icon fin-cf-editar" title="Editar">✏</button>
          </div>
        </td>
      </tr>`).join("");

    body.querySelectorAll(".fin-cf-pagar").forEach(btn => {
      btn.addEventListener("click", () => abrirPagarConta(contasFixas.find(c => c.id === btn.closest("tr").dataset.id)));
    });
    body.querySelectorAll(".fin-cf-editar").forEach(btn => {
      btn.addEventListener("click", () => abrirFormConta(contasFixas.find(c => c.id === btn.closest("tr").dataset.id)));
    });
  }

  function abrirFormConta(c) {
    editandoConta = c || null;
    gel("fin-cf-modal-titulo").textContent = c ? "Editar conta fixa" : "Nova conta fixa";
    gel("fin-cf-nome").value        = c ? c.nome : "";
    gel("fin-cf-valor").value       = c && c.valor != null ? c.valor : "";
    gel("fin-cf-dia").value         = c && c.dia_vencimento != null ? c.dia_vencimento : "";
    gel("fin-cf-banco").value       = c ? (c.banco_cartao || "") : "";

    const categoria = c ? (c.categoria || "") : "";
    const categoriaEhPreset = !categoria || CATEGORIAS_CONTA_FIXA.includes(categoria);
    gel("fin-cf-categoria").value = categoriaEhPreset ? categoria : "__outro__";
    gel("fin-cf-categoria-outro").value = categoriaEhPreset ? "" : categoria;
    gel("fin-cf-categoria-outro-wrap").hidden = categoriaEhPreset;

    gel("fin-cf-recorrencia").value = c ? c.recorrencia : "mensal";
    gel("fin-cf-parcelas-total").value = c && c.parcelas_total != null ? c.parcelas_total : "";
    gel("fin-cf-parcelas").value    = c && c.parcelas_restantes != null ? c.parcelas_restantes : "";
    const ehParcela = gel("fin-cf-recorrencia").value === "parcela";
    gel("fin-cf-parcelas-total-wrap").hidden = !ehParcela;
    gel("fin-cf-parcelas-wrap").hidden = !ehParcela;
    gel("fin-cf-excluir").hidden    = !c;
    gel("fin-modal-cf").hidden = false;
    gel("fin-cf-nome").focus();
  }

  function fecharFormConta() { gel("fin-modal-cf").hidden = true; editandoConta = null; }

  async function salvarFormConta() {
    const recorrencia = gel("fin-cf-recorrencia").value;
    const categoriaSel = gel("fin-cf-categoria").value;
    const categoria = categoriaSel === "__outro__" ? gel("fin-cf-categoria-outro").value.trim() : categoriaSel;
    const dados = {
      nome:               gel("fin-cf-nome").value.trim(),
      valor:              parseFloat(gel("fin-cf-valor").value) || null,
      dia_vencimento:     parseInt(gel("fin-cf-dia").value, 10) || null,
      banco_cartao:       gel("fin-cf-banco").value.trim() || null,
      categoria:          categoria || null,
      recorrencia,
      parcelas_total:     recorrencia === "parcela" ? (parseInt(gel("fin-cf-parcelas-total").value, 10) || null) : null,
      parcelas_restantes: recorrencia === "parcela" ? (parseInt(gel("fin-cf-parcelas").value, 10) ?? null) : null,
    };
    if (!dados.nome) { alert("Nome é obrigatório."); return; }

    const btn = gel("fin-cf-salvar");
    btn.disabled = true;
    try {
      if (editandoConta) {
        await chamar("atualizar_conta_fixa", { id: editandoConta.id, ...dados });
        Object.assign(editandoConta, dados);
      } else {
        const [criada] = await chamar("criar_conta_fixa", dados);
        contasFixas.push(criada);
      }
      fecharFormConta();
      ordenarContasFixas();
      renderContasFixas();
      renderVencimentosProximos();
    } catch (err) {
      alert("Erro ao salvar conta fixa: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirContaFixa() {
    if (!editandoConta) return;
    if (!confirm('Remover "' + editandoConta.nome + '" das contas fixas?')) return;
    try {
      await chamar("excluir_conta_fixa", { id: editandoConta.id });
      contasFixas = contasFixas.filter(c => c.id !== editandoConta.id);
      fecharFormConta();
      renderContasFixas();
      renderVencimentosProximos();
    } catch (err) {
      alert("Erro ao excluir conta fixa: " + err.message);
    }
  }

  // ===== Marcar conta fixa como paga (gera o lançamento automaticamente) =====
  function abrirPagarConta(c) {
    pagandoConta = c;
    gel("fin-cf-pagar-titulo").textContent = 'Marcar "' + c.nome + '" como paga';
    gel("fin-cf-pagar-valor").value = c.valor != null ? c.valor : (c.ultimo_valor_pago != null ? c.ultimo_valor_pago : "");
    const hoje = new Date();
    gel("fin-cf-pagar-data").value = String(hoje.getDate()).padStart(2, "0") + "/" + String(hoje.getMonth() + 1).padStart(2, "0") + "/" + hoje.getFullYear();
    gel("fin-modal-cf-pagar").hidden = false;
    gel("fin-cf-pagar-valor").focus();
  }

  function fecharPagarConta() { gel("fin-modal-cf-pagar").hidden = true; pagandoConta = null; }

  async function confirmarPagarConta() {
    if (!pagandoConta) return;
    const valor = parseFloat(gel("fin-cf-pagar-valor").value) || 0;
    if (!valor) { alert("Informe o valor pago."); return; }
    const dataPagamento = paraISO(gel("fin-cf-pagar-data").value.trim()) || new Date().toISOString().slice(0, 10);

    const btn = gel("fin-cf-pagar-confirmar");
    btn.disabled = true;
    try {
      const resultado = await chamar("marcar_conta_paga", { id: pagandoConta.id, valor, data_pagamento: dataPagamento });
      const idx = contasFixas.findIndex(c => c.id === pagandoConta.id);
      if (idx !== -1) Object.assign(contasFixas[idx], resultado.conta);
      lancamentos.push(resultado.lancamento);
      fecharPagarConta();
      renderContasFixas();
      renderVencimentosProximos();
      render(); // atualiza também os totais/tabela da aba Lançamentos
    } catch (err) {
      alert("Erro ao confirmar pagamento: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Importar extrato (IA) =====
  function abrirImportar() {
    gel("fin-imp-origem").value = "";
    gel("fin-imp-texto").value  = "";
    gel("fin-imp-arquivo").value = "";
    gel("fin-imp-arquivo-nome").textContent = "";
    gel("fin-imp-passo1").hidden = false;
    gel("fin-imp-passo2").hidden = true;
    importados = [];
    gel("fin-modal-importar").hidden = false;
    gel("fin-imp-texto").focus();
  }

  function fecharImportar() {
    gel("fin-modal-importar").hidden = true;
    importados = [];
  }

  const CATEGORIAS_EXTRATO = [
    "Milheiro/Fornecedor", "Taxa de embarque cartão", "Aluguel", "Salário/Comissão", "Pró-labore/Distribuição de lucro",
    "Adiantamento de cartão", "Marketing", "Ferramentas/Sistemas", "Imposto", "Transporte", "Utilidades/Energia",
    "Tarifa bancária", "Alimentação", "Interno/Estorno", "Outros",
  ];

  // Mesma lista do extrato — mantém a categoria de uma conta fixa comparável com a de um
  // lançamento importado/manual no gráfico "Custo por categoria".
  const CATEGORIAS_CONTA_FIXA = CATEGORIAS_EXTRATO;

  function montarPromptExtrato(texto) {
    return `Extraia todas as transações do extrato bancário ou fatura de cartão de crédito abaixo. Ignore linhas de saldo, resumo, limite ou totalizadores — só transações individuais.

Para cada transação retorne:
- data: DD/MM/AAAA
- descricao: resumida, mantendo o que identifica a transação
- valor: número positivo, sem sinal
- tipo: "entrada" para receita/crédito/estorno, "saida" para despesa/débito/compra
- confianca: "alta" se o tipo de gasto é claro pelo texto (ex: tarifa bancária, PIX identificado, pagamento de fatura, juros, anuidade), ou "baixa" se for uma compra genérica sem contexto do que foi (ex: "COMPRA CARTAO ESTABELECIMENTO X", nome de maquininha, código numérico)
- categoria: uma das opções a seguir quando confianca for "alta" (escolha a mais parecida): ${CATEGORIAS_EXTRATO.join(", ")}; deixe "" (vazio) quando for "baixa"

Retorne SOMENTE um JSON válido, sem texto adicional, no formato:
{"transacoes":[{"data":"","descricao":"","valor":0,"tipo":"","confianca":"","categoria":""}]}

EXTRATO:
${texto}`;
  }

  async function extrairViaIA(content) {
    const resp = await fetch("/.netlify/functions/anthropic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: getModel(), max_tokens: 4096, messages: [{ role: "user", content }] }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

    const data = await resp.json();
    const jsonStr = extractJson(data.content?.[0]?.text || "");
    if (!jsonStr) throw new Error("Resposta inesperada da IA");

    const parsed = JSON.parse(jsonStr);
    const transacoes = Array.isArray(parsed.transacoes) ? parsed.transacoes : [];
    return transacoes.map(t => ({
      data:      t.data || "",
      descricao: t.descricao || "",
      valor:     parseFloat(t.valor) || 0,
      tipo:      t.tipo === "entrada" ? "entrada" : "saida",
      categoria: t.categoria || "",
      confianca: t.confianca === "alta" ? "alta" : "baixa",
    }));
  }

  function lerArquivoComoTexto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Não consegui ler o arquivo"));
      reader.readAsText(file);
    });
  }

  function lerArquivoComoBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Não consegui ler o arquivo"));
      reader.readAsDataURL(file);
    });
  }

  // ===== OFX (client-side, sem IA) =====
  // Aceita OFX 1.x (SGML, tags sem fechamento) e OFX 2.x (XML, com fechamento) com o mesmo
  // parser: cada linha "<TAG>valor" ou "<TAG>valor</TAG>" vira uma chave dentro da transação
  // atual, delimitada por <STMTTRN>...</STMTTRN>.
  function parseOfxTransacoes(texto) {
    const linhas = texto.split(/\r?\n/);
    const transacoes = [];
    let atual = null;
    for (const linhaRaw of linhas) {
      const linha = linhaRaw.trim();
      if (!linha.startsWith("<")) continue;
      if (/^<\/STMTTRN>$/i.test(linha)) { if (atual) transacoes.push(atual); atual = null; continue; }
      if (/^<STMTTRN>$/i.test(linha))   { atual = {}; continue; }
      if (!atual) continue;
      const comFechamento = linha.match(/^<([A-Z0-9.]+)>(.*)<\/\1>$/i);
      if (comFechamento) { atual[comFechamento[1].toUpperCase()] = comFechamento[2]; continue; }
      const semFechamento = linha.match(/^<([A-Z0-9.]+)>(.*)$/i);
      if (semFechamento) { atual[semFechamento[1].toUpperCase()] = semFechamento[2]; }
    }
    return transacoes;
  }

  const OFX_TIPOS_SAIDA = ["DEBIT", "PAYMENT", "CHECK", "FEE", "SRVCHG", "CASH", "ATM", "POS", "DIRECTDEBIT", "REPEATPMT"];

  function mapearOfx(transacoes) {
    return transacoes.map(t => {
      const valorNum = parseFloat(String(t.TRNAMT || "0").replace(",", ".")) || 0;
      const dataRaw  = String(t.DTPOSTED || "").slice(0, 8);
      const data = dataRaw.length === 8 ? `${dataRaw.slice(6, 8)}/${dataRaw.slice(4, 6)}/${dataRaw.slice(0, 4)}` : "";
      const tipo = valorNum < 0 || OFX_TIPOS_SAIDA.includes(String(t.TRNTYPE || "").toUpperCase()) ? "saida" : "entrada";
      return { data, descricao: t.MEMO || t.NAME || "Transação OFX", valor: Math.abs(valorNum), tipo, categoria: "", confianca: "alta" };
    }).filter(t => t.valor > 0);
  }

  // ===== CSV de extrato bancário (heurístico, sem IA — diferente do CSV da planilha de vendas) =====
  // Extratos de banco podem vir em qualquer formato de número ("2500.00" americano ou "2.500,00"
  // brasileiro) — parseNumPlanilha assume sempre o formato brasileiro e erra o americano.
  function parseNumExtrato(s) {
    let str = String(s || "").trim().replace(/[R$\s]/g, "");
    if (!str) return 0;
    const temVirgula = str.includes(","), temPonto = str.includes(".");
    if (temVirgula && temPonto) {
      // O separador que aparece por último é o decimal.
      if (str.lastIndexOf(",") > str.lastIndexOf(".")) str = str.replace(/\./g, "").replace(",", ".");
      else str = str.replace(/,/g, "");
    } else if (temVirgula) {
      str = str.replace(",", ".");
    } else if (temPonto) {
      // Só ponto: 2 dígitos depois dele é decimal ("150.30"), senão é milhar ("1.234").
      const partes = str.split(".");
      if (partes.length > 1 && partes[partes.length - 1].length !== 2) str = str.replace(/\./g, "");
    }
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  function detectarColunasCsv(header) {
    const norm = header.map(h => normalizarTexto(h));
    const usados = new Set();
    // Cada coluna só pode ser usada uma vez — sem isso, um cabeçalho tipo "Data Lançamento" batia
    // tanto no regex de data quanto no de descrição (por causa de "lancamento"), e a descrição
    // acabava virando a própria data.
    function achar(regex) {
      const i = norm.findIndex((h, idx) => !usados.has(idx) && regex.test(h));
      if (i >= 0) usados.add(i);
      return i;
    }
    const idxData    = achar(/\bdata\b|date/);
    const idxDesc    = achar(/descri|historic|memo|lancamento|description/);
    const idxValor   = achar(/^valor|amount|value/);
    const idxCredito = achar(/credito|credit/);
    const idxDebito  = achar(/debito|debit/);
    const reconhecido = idxData >= 0 && idxDesc >= 0 && (idxValor >= 0 || (idxCredito >= 0 && idxDebito >= 0));
    return { idxData, idxDesc, idxValor, idxCredito, idxDebito, reconhecido };
  }

  function mapearLinhaCsv(cols, colunas) {
    let valor = 0, tipo = "saida";
    if (colunas.idxValor >= 0) {
      valor = parseNumExtrato(cols[colunas.idxValor]);
      tipo = valor < 0 ? "saida" : "entrada";
      valor = Math.abs(valor);
    } else {
      const credito = parseNumExtrato(cols[colunas.idxCredito] || "0");
      const debito  = parseNumExtrato(cols[colunas.idxDebito] || "0");
      if (credito > 0) { valor = credito; tipo = "entrada"; } else { valor = debito; tipo = "saida"; }
    }
    return {
      data: (cols[colunas.idxData] || "").trim(),
      descricao: (cols[colunas.idxDesc] || "Transação").trim(),
      valor, tipo, categoria: "", confianca: "alta",
    };
  }

  async function extrairExtrato() {
    const arquivo = gel("fin-imp-arquivo").files[0];
    const texto   = gel("fin-imp-texto").value.trim();

    const btn = gel("fin-imp-extrair-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Extraindo...";

    try {
      let extraidos;

      if (arquivo) {
        const nome = arquivo.name.toLowerCase();
        if (nome.endsWith(".ofx") || nome.endsWith(".qfx")) {
          extraidos = mapearOfx(parseOfxTransacoes(await lerArquivoComoTexto(arquivo)));
          if (extraidos.length === 0) throw new Error("Nenhuma transação encontrada no arquivo OFX.");
        } else if (nome.endsWith(".csv")) {
          const linhas = parseCsvPlanilha(await lerArquivoComoTexto(arquivo)).filter(l => l.some(c => c.trim()));
          const colunas = linhas[0] ? detectarColunasCsv(linhas[0]) : null;
          if (colunas && colunas.reconhecido) {
            extraidos = linhas.slice(1).map(cols => mapearLinhaCsv(cols, colunas));
            if (extraidos.length === 0) throw new Error("Nenhuma transação encontrada no CSV.");
          } else {
            // Layout não reconhecido — cai pro caminho de IA com o texto cru, em vez de dar erro.
            extraidos = await extrairViaIA([{ type: "text", text: montarPromptExtrato(await lerArquivoComoTexto(arquivo)) }]);
          }
        } else if (nome.endsWith(".pdf")) {
          const base64 = await lerArquivoComoBase64(arquivo);
          extraidos = await extrairViaIA([
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: montarPromptExtrato("(o extrato está no arquivo PDF anexado a esta mensagem)") },
          ]);
        } else {
          throw new Error("Formato de arquivo não suportado — envie .ofx, .csv ou .pdf.");
        }
      } else {
        if (!texto) { alert("Cole o texto do extrato ou envie um arquivo antes de extrair."); return; }
        extraidos = await extrairViaIA([{ type: "text", text: montarPromptExtrato(texto) }]);
      }

      if (extraidos.length === 0) { alert("Nenhuma transação encontrada."); return; }

      importados = extraidos;
      renderImportRevisao();
      gel("fin-imp-passo1").hidden = true;
      gel("fin-imp-passo2").hidden = false;
    } catch (err) {
      alert("Erro ao extrair lançamentos: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "🤖 Extrair lançamentos";
    }
  }

  function renderImportRevisao() {
    const tbody = gel("fin-imp-tbody");
    tbody.innerHTML = importados.map((t, i) => `
      <tr class="${t.confianca === "baixa" ? "fin-imp-row--atencao" : ""}" data-i="${i}">
        <td><input type="checkbox" class="fin-imp-check" checked /></td>
        <td><input type="text" class="input fin-imp-data" value="${escHtml(t.data)}" style="width:95px" /></td>
        <td><input type="text" class="input fin-imp-desc" value="${escHtml(t.descricao)}" style="min-width:180px" /></td>
        <td><input type="number" class="input fin-imp-valor" value="${t.valor}" step="0.01" style="width:95px" /></td>
        <td>
          <select class="input fin-imp-tipo">
            <option value="entrada"${t.tipo === "entrada" ? " selected" : ""}>Entrada</option>
            <option value="saida"${t.tipo === "saida" ? " selected" : ""}>Saída</option>
          </select>
        </td>
        <td>
          <select class="input fin-imp-categoria">
            <option value="">${t.confianca === "baixa" ? "— o que é isso? —" : "— selecione —"}</option>
            ${CATEGORIAS_EXTRATO.map(c => `<option value="${escHtml(c)}"${t.categoria === c ? " selected" : ""}>${escHtml(c)}</option>`).join("")}
          </select>
        </td>
      </tr>`).join("");
  }

  async function confirmarImportacao() {
    const origem = gel("fin-imp-origem").value.trim() || null;
    const linhas = gel("fin-imp-tbody").querySelectorAll("tr");
    const novos = [];

    linhas.forEach(tr => {
      if (!tr.querySelector(".fin-imp-check").checked) return;

      const dados = {
        tipo:       tr.querySelector(".fin-imp-tipo").value,
        status:     "pendente",
        descricao:  tr.querySelector(".fin-imp-desc").value.trim(),
        categoria:  tr.querySelector(".fin-imp-categoria").value.trim() || null,
        origem,
        valor:      parseFloat(tr.querySelector(".fin-imp-valor").value) || 0,
        vencimento: paraISO(tr.querySelector(".fin-imp-data").value.trim()),
        fonte:      "extrato_texto",
      };
      if (!dados.descricao || !dados.valor) return;
      novos.push(dados);
    });

    if (novos.length === 0) { fecharImportar(); return; }

    const btn = gel("fin-imp-confirmar-btn");
    btn.disabled = true;
    try {
      const criados = await chamar("importar_lancamentos", { lancamentos: novos });
      lancamentos.push(...criados);
      fecharImportar();
      render();
      alert(criados.length + " lançamento" + (criados.length !== 1 ? "s importados" : " importado") + " com sucesso.");
    } catch (err) {
      alert("Erro ao importar lançamentos: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Init =====
  function init() {
    gel("fin-lock-btn").addEventListener("click", tentarEntrar);
    gel("fin-lock-senha").addEventListener("keydown", e => { if (e.key === "Enter") tentarEntrar(); });
    gel("fin-lock-btn2").addEventListener("click", bloquear);

    gel("fin-subtab-lancamentos").addEventListener("click", () => {
      gel("fin-subtab-lancamentos").classList.add("is-active");
      gel("fin-subtab-fornecedores").classList.remove("is-active");
      gel("fin-subtab-contas-fixas").classList.remove("is-active");
      gel("fin-sub-lancamentos").hidden = false;
      gel("fin-sub-fornecedores").hidden = true;
      gel("fin-sub-contas-fixas").hidden = true;
    });

    gel("fin-subtab-contas-fixas").addEventListener("click", () => {
      gel("fin-subtab-contas-fixas").classList.add("is-active");
      gel("fin-subtab-lancamentos").classList.remove("is-active");
      gel("fin-subtab-fornecedores").classList.remove("is-active");
      gel("fin-sub-contas-fixas").hidden = false;
      gel("fin-sub-lancamentos").hidden = true;
      gel("fin-sub-fornecedores").hidden = true;
      renderContasFixas();
    });

    gel("fin-novo-btn").addEventListener("click", () => abrirForm(null));
    gel("fin-ia-lancar-btn").addEventListener("click", analisarLancamentoTexto);
    gel("fin-ia-texto").addEventListener("keydown", e => { if (e.key === "Enter") analisarLancamentoTexto(); });
    gel("fin-modal-fechar").addEventListener("click", fecharForm);
    gel("fin-f-cancelar").addEventListener("click", fecharForm);
    gel("fin-f-salvar").addEventListener("click", salvarForm);
    gel("fin-f-excluir").addEventListener("click", excluirLancamento);
    gel("fin-modal-lanc").addEventListener("click", e => { if (e.target === gel("fin-modal-lanc")) fecharForm(); });

    gel("fin-cf-categoria").innerHTML =
      '<option value="">Selecione...</option>' +
      CATEGORIAS_CONTA_FIXA.map(cat => `<option value="${escHtml(cat)}">${escHtml(cat)}</option>`).join("") +
      '<option value="__outro__">Outra (digitar)...</option>';

    gel("fin-cf-novo-btn").addEventListener("click", () => abrirFormConta(null));
    gel("fin-cf-modal-fechar").addEventListener("click", fecharFormConta);
    gel("fin-cf-cancelar").addEventListener("click", fecharFormConta);
    gel("fin-cf-salvar").addEventListener("click", salvarFormConta);
    gel("fin-cf-excluir").addEventListener("click", excluirContaFixa);
    gel("fin-cf-recorrencia").addEventListener("change", () => {
      const ehParcela = gel("fin-cf-recorrencia").value === "parcela";
      gel("fin-cf-parcelas-total-wrap").hidden = !ehParcela;
      gel("fin-cf-parcelas-wrap").hidden = !ehParcela;
    });
    gel("fin-cf-categoria").addEventListener("change", () => {
      gel("fin-cf-categoria-outro-wrap").hidden = gel("fin-cf-categoria").value !== "__outro__";
    });
    gel("fin-modal-cf").addEventListener("click", e => { if (e.target === gel("fin-modal-cf")) fecharFormConta(); });

    gel("fin-cf-pagar-fechar").addEventListener("click", fecharPagarConta);
    gel("fin-cf-pagar-cancelar").addEventListener("click", fecharPagarConta);
    gel("fin-cf-pagar-confirmar").addEventListener("click", confirmarPagarConta);
    gel("fin-modal-cf-pagar").addEventListener("click", e => { if (e.target === gel("fin-modal-cf-pagar")) fecharPagarConta(); });

    gel("fin-importar-btn").addEventListener("click", abrirImportar);
    gel("fin-imp-fechar").addEventListener("click", fecharImportar);
    gel("fin-imp-cancelar").addEventListener("click", fecharImportar);
    gel("fin-imp-extrair-btn").addEventListener("click", extrairExtrato);
    gel("fin-imp-arquivo").addEventListener("change", () => {
      const f = gel("fin-imp-arquivo").files[0];
      gel("fin-imp-arquivo-nome").textContent = f ? "Selecionado: " + f.name : "";
    });
    gel("fin-imp-voltar").addEventListener("click", () => {
      gel("fin-imp-passo1").hidden = false;
      gel("fin-imp-passo2").hidden = true;
    });
    gel("fin-imp-confirmar-btn").addEventListener("click", confirmarImportacao);
    gel("fin-modal-importar").addEventListener("click", e => { if (e.target === gel("fin-modal-importar")) fecharImportar(); });

    document.querySelectorAll(".fin-filtro").forEach(btn => {
      btn.addEventListener("click", () => {
        filtroAtual = btn.dataset.filtro;
        document.querySelectorAll(".fin-filtro").forEach(b => b.classList.toggle("is-active", b === btn));
        renderTabela();
      });
    });

    gel("fin-periodo-select").addEventListener("change", () => {
      periodoAtual = gel("fin-periodo-select").value;
      const personalizado = periodoAtual === "personalizado";
      const mesEspecifico = periodoAtual === "mes_especifico";
      gel("fin-periodo-inicio").hidden = !personalizado;
      gel("fin-periodo-ate-lbl").hidden = !personalizado;
      gel("fin-periodo-fim").hidden = !personalizado;
      gel("fin-periodo-mes").hidden = !mesEspecifico;
      if (!personalizado && !mesEspecifico) render();
    });
    gel("fin-periodo-inicio").addEventListener("change", () => { if (gel("fin-periodo-fim").value) render(); });
    gel("fin-periodo-fim").addEventListener("change", () => { if (gel("fin-periodo-inicio").value) render(); });
    gel("fin-periodo-mes").addEventListener("change", () => { if (gel("fin-periodo-mes").value) render(); });

    if (estaDesbloqueado()) mostrarConteudo();
    else mostrarLock();
  }

  init();
})();
