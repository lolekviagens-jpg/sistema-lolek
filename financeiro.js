// ===== Financeiro — Lolek Viagens =====
(function () {
  "use strict";

  const LS_KEY_ANTIGO   = "lolek_financeiro";           // localStorage antigo, só lido uma vez pra migrar
  const LS_KEY_MIGRADO  = "lolek_financeiro_migrado";
  const LS_AI_MODEL     = "lolek_anthropic_model";

  let lancamentos   = [];
  let filtroAtual   = "todos";
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

  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }

  // ===== Chamada à function do Financeiro (Supabase) =====
  async function chamar(action, data) {
    const resp = await fetch("/.netlify/functions/financeiro-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    const dedupeKey = reserva
      ? normalizarTexto(reserva) + "|" + normalizarTexto(dataEmissao)
      : normalizarTexto(dataEmissao) + "|" + normalizarTexto(cliente) + "|" + normalizarTexto(destino) + "|" + valorTotal;

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

      const novos = [];
      rows.forEach((cols) => {
        const l = montarLancamentoDaLinha(cols);
        if (l) novos.push(l);
      });
      if (novos.length === 0) return;

      await chamar("upsert_sheet_lancamentos", { lancamentos: novos });
      await carregarLancamentos();
      render();
    } catch (err) {
      console.error("Erro ao puxar planilha de vendas:", err);
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
    } catch (err) {
      alert("Erro ao carregar lançamentos: " + err.message);
    }
    render();
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

  // ===== Lançamentos =====
  function lancamentosFiltrados() {
    let lista = lancamentos.slice();
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
    renderTabela();
    gel("fin-updated").textContent = lancamentos.length + " lançamento" + (lancamentos.length !== 1 ? "s" : "") + " no total";
  }

  function renderStats() {
    let saldo = 0, receber = 0, pagar = 0;
    lancamentos.forEach(l => {
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

  // ===== Importar extrato (IA) =====
  function abrirImportar() {
    gel("fin-imp-origem").value = "";
    gel("fin-imp-texto").value  = "";
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

  async function extrairExtrato() {
    const origem = gel("fin-imp-origem").value.trim();
    const texto  = gel("fin-imp-texto").value.trim();
    if (!texto) { alert("Cole o texto do extrato antes de extrair."); return; }

    const btn = gel("fin-imp-extrair-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Extraindo...";

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: `Extraia todas as transações do extrato bancário ou fatura de cartão de crédito abaixo. Ignore linhas de saldo, resumo, limite ou totalizadores — só transações individuais.

Para cada transação retorne:
- data: DD/MM/AAAA
- descricao: resumida, mantendo o que identifica a transação
- valor: número positivo, sem sinal
- tipo: "entrada" para receita/crédito/estorno, "saida" para despesa/débito/compra
- confianca: "alta" se o tipo de gasto é claro pelo texto (ex: tarifa bancária, PIX identificado, pagamento de fatura, juros, anuidade), ou "baixa" se for uma compra genérica sem contexto do que foi (ex: "COMPRA CARTAO ESTABELECIMENTO X", nome de maquininha, código numérico)
- categoria: sugestão curta de categoria quando confianca for "alta"; deixe "" (vazio) quando for "baixa"

Retorne SOMENTE um JSON válido, sem texto adicional, no formato:
{"transacoes":[{"data":"","descricao":"","valor":0,"tipo":"","confianca":"","categoria":""}]}

EXTRATO:
${texto}`,
          }],
        }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const parsed = JSON.parse(jsonStr);
      const transacoes = Array.isArray(parsed.transacoes) ? parsed.transacoes : [];
      if (transacoes.length === 0) { alert("Nenhuma transação encontrada nesse texto."); return; }

      importados = transacoes.map(t => ({
        data:      t.data || "",
        descricao: t.descricao || "",
        valor:     parseFloat(t.valor) || 0,
        tipo:      t.tipo === "entrada" ? "entrada" : "saida",
        categoria: t.categoria || "",
        confianca: t.confianca === "alta" ? "alta" : "baixa",
        origem,
      }));

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
        <td><input type="text" class="input fin-imp-categoria" value="${escHtml(t.categoria)}" placeholder="${t.confianca === "baixa" ? "O que é isso?" : ""}" /></td>
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

    gel("fin-novo-btn").addEventListener("click", () => abrirForm(null));
    gel("fin-modal-fechar").addEventListener("click", fecharForm);
    gel("fin-f-cancelar").addEventListener("click", fecharForm);
    gel("fin-f-salvar").addEventListener("click", salvarForm);
    gel("fin-f-excluir").addEventListener("click", excluirLancamento);
    gel("fin-modal-lanc").addEventListener("click", e => { if (e.target === gel("fin-modal-lanc")) fecharForm(); });

    gel("fin-importar-btn").addEventListener("click", abrirImportar);
    gel("fin-imp-fechar").addEventListener("click", fecharImportar);
    gel("fin-imp-cancelar").addEventListener("click", fecharImportar);
    gel("fin-imp-extrair-btn").addEventListener("click", extrairExtrato);
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

    if (estaDesbloqueado()) mostrarConteudo();
    else mostrarLock();
  }

  init();
})();
