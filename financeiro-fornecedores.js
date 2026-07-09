// ===== Financeiro — Fornecedores de milhas — Lolek Viagens =====
(function () {
  "use strict";

  const LS_AI_MODEL = "lolek_anthropic_model";
  const SHEET_ID     = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
  const SHEET_URL    = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv";
  const COL_SITUACAO = 1;  // B
  const COL_MILHEIRO = 10; // K

  let fornecedores  = [];
  let aliasesPendentes = [];
  let editando      = null; // fornecedor em edição no modal
  let grupos        = [];   // grupos sugeridos pela IA, aguardando revisão
  let contagemBruta = new Map(); // alias original -> nº de vendas (pro passo de revisão)
  let pendenciaAtual = null; // alias pendente selecionado no modal de atribuição
  let pagamentos    = []; // pagamentos do fornecedor em edição
  let saldoDevedor  = 0;

  function gel(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }

  function fBRL(v) {
    return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseData(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }
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

  // A senha só é digitada uma vez, na trava do financeiro.js — lê o valor direto do campo
  // (continua no DOM depois do desbloqueio; é o mesmo canal de comunicação via DOM do resto do app).
  async function chamar(action, data) {
    const senha = (gel("fin-lock-senha") || {}).value || "";
    const resp = await fetch("/.netlify/functions/financeiro-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senha, action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  function normalizarTexto(s) {
    return String(s || "").normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase().trim().replace(/\s+/g, " ");
  }

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

  // ===== Fornecedores (CRUD) =====
  async function carregarFornecedores() {
    fornecedores = await chamar("listar_fornecedores");
  }

  function renderFornecedores() {
    const body  = gel("forn-tabela-body");
    const vazio = gel("forn-vazio");
    const lista = fornecedores.filter(f => f.ativo !== false);

    if (lista.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum fornecedor cadastrado ainda</p></div>';
    } else {
      vazio.innerHTML = "";
      body.innerHTML = lista.map(f => `
        <tr data-id="${escHtml(f.id)}">
          <td class="table__client">${escHtml(f.nome)}</td>
          <td class="table__muted">${escHtml(f.pix || "—")}</td>
          <td class="table__muted">${escHtml(f.contato || "—")}</td>
          <td class="table__actions-col">
            <div class="table__actions">
              <button class="btn btn--ghost btn--icon forn-editar" title="Editar">✏</button>
            </div>
          </td>
        </tr>`).join("");

      body.querySelectorAll(".forn-editar").forEach(btn => {
        btn.addEventListener("click", () => {
          abrirForm(fornecedores.find(f => f.id === btn.closest("tr").dataset.id));
        });
      });
    }

    gel("forn-updated").textContent = lista.length + " fornecedor" + (lista.length !== 1 ? "es" : "") + " no total";
    renderAvisoPendentes();
  }

  function abrirForm(f) {
    editando = f || null;
    gel("forn-modal-titulo").textContent = f ? "Editar fornecedor" : "Novo fornecedor";
    gel("forn-f-nome").value        = f ? f.nome : "";
    gel("forn-f-pix").value         = f ? (f.pix || "") : "";
    gel("forn-f-contato").value     = f ? (f.contato || "") : "";
    gel("forn-f-observacoes").value = f ? (f.observacoes || "") : "";
    gel("forn-f-excluir").hidden    = !f;
    gel("forn-pagamentos-secao").hidden = !f;
    gel("forn-modal").hidden = false;
    gel("forn-f-nome").focus();
    if (f) carregarPagamentos(f.id);
  }

  function fecharForm() { gel("forn-modal").hidden = true; editando = null; pagamentos = []; }

  // ===== Pagamentos a fornecedores =====
  async function carregarPagamentos(fornecedorId) {
    gel("forn-saldo-devedor").textContent = "…";
    gel("forn-pag-tabela-body").innerHTML = "";
    try {
      const [vendas, pagos] = await Promise.all([
        chamar("listar_lancamentos_fornecedor", { fornecedor_id: fornecedorId }),
        chamar("listar_pagamentos_fornecedor", { fornecedor_id: fornecedorId }),
      ]);
      const custoMilhas = vendas.reduce((soma, l) => {
        const m = l.sheet_meta || {};
        return soma + (parseFloat(m.valor_milha) || 0) * (parseFloat(m.qtd_milhas) || 0) / 1000;
      }, 0);
      const totalPago = pagos.reduce((soma, p) => soma + (parseFloat(p.valor_pago) || 0), 0);
      pagamentos = pagos;
      saldoDevedor = custoMilhas - totalPago;
      renderPagamentos();
    } catch (err) {
      gel("forn-saldo-devedor").textContent = "erro";
      console.error("Erro ao carregar pagamentos:", err);
    }
  }

  function renderPagamentos() {
    gel("forn-saldo-devedor").textContent = fBRL(saldoDevedor);
    const body  = gel("forn-pag-tabela-body");
    const vazio = gel("forn-pag-vazio");

    if (pagamentos.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum pagamento registrado ainda</p></div>';
    } else {
      vazio.innerHTML = "";
      body.innerHTML = pagamentos.map(p => `
        <tr data-id="${escHtml(p.id)}" data-lancamento-id="${escHtml(p.lancamento_id || "")}">
          <td>${escHtml(paraBR(p.data))}</td>
          <td>${fBRL(p.valor_pago)}</td>
          <td class="table__muted">${p.milhas_recebidas ? Number(p.milhas_recebidas).toLocaleString("pt-BR") : "—"}</td>
          <td class="table__muted">${p.valor_por_milha ? fBRL(p.valor_por_milha) : "—"}</td>
          <td class="table__actions-col">
            <div class="table__actions">
              <button class="btn btn--ghost btn--icon forn-pag-excluir" title="Excluir">✕</button>
            </div>
          </td>
        </tr>`).join("");

      body.querySelectorAll(".forn-pag-excluir").forEach(btn => {
        btn.addEventListener("click", () => excluirPagamento(btn.closest("tr").dataset.id, btn.closest("tr").dataset.lancamentoId));
      });
    }
  }

  function abrirModalPagamento() {
    gel("forn-pag-data").value = "";
    gel("forn-pag-valor").value = "";
    gel("forn-pag-milhas").value = "";
    gel("forn-pag-valor-milha").value = "";
    gel("forn-pag-observacoes").value = "";
    gel("forn-modal-pagamento").hidden = false;
    gel("forn-pag-data").focus();
  }

  function fecharModalPagamento() { gel("forn-modal-pagamento").hidden = true; }

  async function salvarPagamento() {
    if (!editando) return;
    const dados = {
      fornecedor_id: editando.id,
      data: paraISO(gel("forn-pag-data").value.trim()),
      valor_pago: parseFloat(gel("forn-pag-valor").value) || 0,
      milhas_recebidas: parseFloat(gel("forn-pag-milhas").value) || null,
      valor_por_milha: parseFloat(gel("forn-pag-valor-milha").value) || null,
      observacoes: gel("forn-pag-observacoes").value.trim() || null,
    };
    if (!dados.data)       { alert("Informe a data do pagamento (DD/MM/AAAA)."); return; }
    if (!dados.valor_pago) { alert("Informe o valor pago."); return; }

    const btn = gel("forn-pag-salvar");
    btn.disabled = true;
    try {
      await chamar("criar_pagamento_fornecedor", dados);
      fecharModalPagamento();
      await carregarPagamentos(editando.id);
    } catch (err) {
      alert("Erro ao registrar pagamento: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirPagamento(id, lancamentoId) {
    if (!confirm("Excluir esse pagamento?")) return;
    try {
      await chamar("excluir_pagamento_fornecedor", { id, lancamento_id: lancamentoId || undefined });
      await carregarPagamentos(editando.id);
    } catch (err) {
      alert("Erro ao excluir pagamento: " + err.message);
    }
  }

  async function salvarForm() {
    const dados = {
      nome: gel("forn-f-nome").value.trim(),
      pix: gel("forn-f-pix").value.trim() || null,
      contato: gel("forn-f-contato").value.trim() || null,
      observacoes: gel("forn-f-observacoes").value.trim() || null,
    };
    if (!dados.nome) { alert("Nome obrigatório."); return; }

    const btn = gel("forn-f-salvar");
    btn.disabled = true;
    try {
      if (editando) {
        await chamar("atualizar_fornecedor", { id: editando.id, ...dados });
        Object.assign(editando, dados);
      } else {
        const [criado] = await chamar("criar_fornecedor", dados);
        fornecedores.push(criado);
      }
      fecharForm();
      renderFornecedores();
    } catch (err) {
      alert("Erro ao salvar fornecedor: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirFornecedor() {
    if (!editando) return;
    if (!confirm('Remover "' + editando.nome + '" da lista? (o histórico de vendas/pagamentos dele continua guardado)')) return;
    try {
      await chamar("atualizar_fornecedor", { id: editando.id, ativo: false });
      editando.ativo = false;
      fecharForm();
      renderFornecedores();
    } catch (err) {
      alert("Erro ao remover fornecedor: " + err.message);
    }
  }

  // ===== Fila de aliases pendentes (nomes da planilha ainda não vinculados) =====
  async function carregarPendentes() {
    const todos = await chamar("listar_aliases");
    aliasesPendentes = todos.filter(a => a.status === "pendente");
  }

  function renderAvisoPendentes() {
    const el = gel("forn-pendentes-aviso");
    if (aliasesPendentes.length === 0) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="notice" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span>⚠ ${aliasesPendentes.length} nome${aliasesPendentes.length !== 1 ? "s" : ""} da planilha ainda não identificado${aliasesPendentes.length !== 1 ? "s" : ""} — pode ser fornecedor novo ou variação de um já cadastrado.</span>
        <button type="button" class="btn btn--ghost" id="forn-resolver-pendentes-btn">Resolver agora</button>
      </div>`;
    gel("forn-resolver-pendentes-btn").addEventListener("click", () => abrirProximaPendencia());
  }

  function abrirProximaPendencia() {
    if (aliasesPendentes.length === 0) return;
    pendenciaAtual = aliasesPendentes[0];
    gel("forn-pend-nome").textContent = pendenciaAtual.alias_original;
    gel("forn-pend-select").innerHTML = '<option value="">— selecione —</option>' +
      fornecedores.filter(f => f.ativo !== false).map(f => `<option value="${escHtml(f.id)}">${escHtml(f.nome)}</option>`).join("");
    gel("forn-pend-novo").value = "";
    gel("forn-modal-pendencia").hidden = false;
  }

  function fecharPendencia() { gel("forn-modal-pendencia").hidden = true; pendenciaAtual = null; }

  async function salvarPendencia() {
    if (!pendenciaAtual) return;
    const fornecedorId = gel("forn-pend-select").value;
    const nomeNovo      = gel("forn-pend-novo").value.trim();
    if (!fornecedorId && !nomeNovo) { alert("Selecione um fornecedor ou digite um nome novo."); return; }

    const btn = gel("forn-pend-salvar");
    btn.disabled = true;
    try {
      await chamar("resolver_pendencia_alias", { id: pendenciaAtual.id, fornecedor_id: fornecedorId || undefined, nome_novo: fornecedorId ? undefined : nomeNovo });
      aliasesPendentes = aliasesPendentes.filter(a => a.id !== pendenciaAtual.id);
      fecharPendencia();
      await carregarFornecedores();
      renderFornecedores();
      if (aliasesPendentes.length > 0) abrirProximaPendencia();
    } catch (err) {
      alert("Erro ao resolver: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Identificar fornecedores da planilha (agrupamento por IA) =====
  async function identificarFornecedores() {
    const btn = gel("forn-identificar-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Lendo planilha...";

    try {
      const resp = await fetch(SHEET_URL + "&t=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      const rows = parseCsvPlanilha(text);

      // Só considera nomes ainda sem alias confirmado — assim dá pra rodar de novo quantas vezes
      // precisar (por ex. depois de resolver as pendências) sem re-agrupar quem já foi confirmado.
      const aliasesExistentes = await chamar("listar_aliases");
      const jaConfirmados = new Set(aliasesExistentes.filter(a => a.status === "confirmado").map(a => a.alias_normalizado));

      contagemBruta = new Map();
      rows.forEach((cols) => {
        const situacao = (cols[COL_SITUACAO] || "").trim();
        if (!situacao) return;
        const raw = (cols[COL_MILHEIRO] || "").trim();
        if (!raw) return;
        const norm = normalizarTexto(raw);
        if (norm === "-" || norm === "tarifado" || jaConfirmados.has(norm)) return;
        contagemBruta.set(raw, (contagemBruta.get(raw) || 0) + 1);
      });

      const nomes = Array.from(contagemBruta.keys());
      if (nomes.length === 0) { alert("Todos os fornecedores da planilha já foram identificados."); return; }

      btn.textContent = "⏳ Agrupando com IA...";

      const listaTexto = nomes.map(n => `- "${n}" (${contagemBruta.get(n)}x)`).join("\n");
      const aiResp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 8192,
          messages: [{
            role: "user",
            content: `Os nomes abaixo vêm da coluna "fornecedor de milhas" de uma planilha de vendas de agência de viagens, digitados manualmente por várias pessoas ao longo do tempo. Muitos são a MESMA pessoa/empresa escrita de formas diferentes (typo, sem acento, apelido, nome completo vs. parcial, com/sem espaço). Agrupe os nomes que são claramente a mesma pessoa ou empresa.

Para cada grupo retorne:
- nome_sugerido: o nome mais completo/correto do grupo (capitalização normal, não tudo maiúsculo)
- aliases: lista com TODOS os nomes originais (exatamente como escrito abaixo) que pertencem a esse grupo
- ambiguo: true se você não tem certeza que os nomes do grupo são a mesma pessoa (nomes parecidos mas podem ser pessoas diferentes)
- motivo: quando ambiguo=true, explique brevemente a dúvida; quando false, deixe ""

Cada nome da lista deve aparecer em exatamente um grupo. Não invente nomes.

Retorne SOMENTE um JSON válido, sem texto adicional, no formato:
{"grupos":[{"nome_sugerido":"","aliases":[""],"ambiguo":false,"motivo":""}]}

NOMES:
${listaTexto}`,
          }],
        }),
      });

      if (!aiResp.ok) { const e = await aiResp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + aiResp.status); }

      const aiData = await aiResp.json();
      const jsonStr = extractJson(aiData.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const parsed = JSON.parse(jsonStr);
      grupos = Array.isArray(parsed.grupos) ? parsed.grupos : [];
      if (grupos.length === 0) { alert("A IA não retornou nenhum grupo."); return; }

      renderRevisao();
      gel("forn-modal-revisao").hidden = false;
    } catch (err) {
      alert("Erro ao identificar fornecedores: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "🤖 Identificar fornecedores da planilha";
    }
  }

  function renderRevisao() {
    const wrap = gel("forn-revisao-lista");
    wrap.innerHTML = grupos.map((g, i) => {
      const totalVendas = g.aliases.reduce((soma, a) => soma + (contagemBruta.get(a) || 0), 0);
      // Se a IA esqueceu de sugerir um nome, usa o alias mais frequente do grupo como respaldo
      // (nunca deixa o campo em branco — um grupo sem nome vira "silenciosamente ignorado" na hora de confirmar).
      const nomeSugerido = g.nome_sugerido || g.aliases.slice().sort((a, b) => (contagemBruta.get(b) || 0) - (contagemBruta.get(a) || 0))[0] || "";
      return `
      <div class="card forn-revisao-card" data-i="${i}" style="padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <input type="checkbox" class="forn-rev-incluir" checked />
          <input type="text" class="input forn-rev-nome" value="${escHtml(nomeSugerido)}" style="flex:1;font-weight:600" />
          <span class="table__muted" style="white-space:nowrap">${totalVendas} venda${totalVendas !== 1 ? "s" : ""}</span>
          ${g.ambiguo ? `<span class="badge badge--pendente" title="${escHtml(g.motivo || "")}">⚠ Ambíguo</span>` : ""}
        </div>
        <div style="font-size:12px;color:var(--text-muted)">
          ${g.aliases.map(a => escHtml(a) + " (" + (contagemBruta.get(a) || 0) + "x)").join(" · ")}
        </div>
        ${g.ambiguo && g.motivo ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">${escHtml(g.motivo)}</div>` : ""}
      </div>`;
    }).join("");
  }

  async function confirmarRevisao() {
    const cards = gel("forn-revisao-lista").querySelectorAll(".forn-revisao-card");
    const gruposConfirmados = [];

    cards.forEach(card => {
      if (!card.querySelector(".forn-rev-incluir").checked) return;
      const i = Number(card.dataset.i);
      const nome = card.querySelector(".forn-rev-nome").value.trim();
      if (!nome) return;
      gruposConfirmados.push({
        nome_novo: nome,
        aliases: grupos[i].aliases.map(a => ({ alias_normalizado: normalizarTexto(a), alias_original: a })),
      });
    });

    if (gruposConfirmados.length === 0) { gel("forn-modal-revisao").hidden = true; return; }

    const btn = gel("forn-revisao-confirmar-btn");
    btn.disabled = true;
    try {
      await chamar("confirmar_grupos_ia", { grupos: gruposConfirmados });
      gel("forn-modal-revisao").hidden = true;
      await carregarFornecedores();
      await carregarPendentes();
      renderFornecedores();
      alert(gruposConfirmados.length + " fornecedor" + (gruposConfirmados.length !== 1 ? "es criados" : " criado") + " com sucesso.");
    } catch (err) {
      alert("Erro ao confirmar fornecedores: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Init =====
  async function carregarTudo() {
    try {
      await Promise.all([carregarFornecedores(), carregarPendentes()]);
      renderFornecedores();
    } catch (err) {
      alert("Erro ao carregar fornecedores: " + err.message);
    }
  }

  function init() {
    gel("fin-subtab-fornecedores").addEventListener("click", () => {
      gel("fin-subtab-fornecedores").classList.add("is-active");
      gel("fin-subtab-lancamentos").classList.remove("is-active");
      gel("fin-sub-fornecedores").hidden = false;
      gel("fin-sub-lancamentos").hidden = true;
    });

    gel("forn-novo-btn").addEventListener("click", () => abrirForm(null));
    gel("forn-modal-fechar").addEventListener("click", fecharForm);
    gel("forn-f-cancelar").addEventListener("click", fecharForm);
    gel("forn-f-salvar").addEventListener("click", salvarForm);
    gel("forn-f-excluir").addEventListener("click", excluirFornecedor);
    gel("forn-modal").addEventListener("click", e => { if (e.target === gel("forn-modal")) fecharForm(); });

    gel("forn-identificar-btn").addEventListener("click", identificarFornecedores);
    gel("forn-revisao-fechar").addEventListener("click", () => { gel("forn-modal-revisao").hidden = true; });
    gel("forn-revisao-cancelar").addEventListener("click", () => { gel("forn-modal-revisao").hidden = true; });
    gel("forn-revisao-confirmar-btn").addEventListener("click", confirmarRevisao);

    gel("forn-pend-fechar").addEventListener("click", fecharPendencia);
    gel("forn-pend-cancelar").addEventListener("click", fecharPendencia);
    gel("forn-pend-salvar").addEventListener("click", salvarPendencia);
    gel("forn-modal-pendencia").addEventListener("click", e => { if (e.target === gel("forn-modal-pendencia")) fecharPendencia(); });

    gel("forn-pag-novo-btn").addEventListener("click", abrirModalPagamento);
    gel("forn-pag-fechar").addEventListener("click", fecharModalPagamento);
    gel("forn-pag-cancelar").addEventListener("click", fecharModalPagamento);
    gel("forn-pag-salvar").addEventListener("click", salvarPagamento);
    gel("forn-modal-pagamento").addEventListener("click", e => { if (e.target === gel("forn-modal-pagamento")) fecharModalPagamento(); });

    // financeiro.js cuida da senha/desbloqueio; só carrega os dados quando #fin-conteudo
    // deixar de estar escondido (comunicação só via DOM, sem chamar função de outro arquivo).
    let carregado = false;
    new MutationObserver(() => {
      const desbloqueado = !gel("fin-conteudo").hidden;
      if (desbloqueado && !carregado) { carregado = true; carregarTudo(); }
      if (!desbloqueado) carregado = false;
    }).observe(gel("fin-conteudo"), { attributes: true, attributeFilter: ["hidden"] });
  }

  init();
})();
