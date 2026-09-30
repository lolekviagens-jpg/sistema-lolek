// ===== Kanban (CRM) — Vendas e Suporte, integrado ao Digisac — Lolek Viagens =====
// FASE 2: quadros completos com criação/classificação/encerramento manuais, transferência,
// Agenda de retomada e alerta de card parado. Digisac entra na Fase 3, sobre esta mesma base.
(function () {
  "use strict";

  const KB_FN = "/.netlify/functions/kanban";
  const AUTH_FN = "/.netlify/functions/auth";

  function gel(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fBRL(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fData(iso) { return iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—"; }
  function fDataHora(iso) { return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }

  const ETAPAS_QUADRO = {
    vendas:   [{ v: "em_cotacao", l: "Em cotação" }, { v: "proposta_enviada", l: "Proposta enviada" }],
    suporte:  [{ v: "em_atendimento", l: "Em atendimento" }, { v: "aguardando_fornecedor", l: "Aguardando fornecedor" }, { v: "aguardando_cliente", l: "Aguardando cliente" }],
  };
  const ETAPA_ENCERRAMENTO = { vendas: "encerrado", suporte: "resolvido" };
  const ETAPA_LABEL_ENCERRAMENTO = { vendas: "✅ Encerrados", suporte: "✅ Resolvidos" };

  const PRODUTOS_VENDA = [
    { v: "passagem_aerea", l: "Passagem aérea" }, { v: "hospedagem", l: "Hospedagem" },
    { v: "seguro", l: "Seguro viagem" }, { v: "aluguel_carro", l: "Aluguel de carro" },
    { v: "passeio", l: "Ingressos/passeios" }, { v: "assessoria_visto", l: "Assessoria de visto" },
    { v: "pacote", l: "Pacote" },
  ];
  const MOTIVOS_PERDA = [
    { v: "preco_alto", l: "Preço acima do esperado" },
    { v: "comprou_outra_agencia", l: "Comprou com outra agência ou por conta própria" },
    { v: "desistiu_sem_data", l: "Desistiu ou adiou sem data definida" },
    { v: "parou_responder", l: "Cliente parou de responder" },
    { v: "sem_disponibilidade", l: "Sem disponibilidade (voo, hotel ou datas)" },
    { v: "documentacao", l: "Documentação (visto ou passaporte)" },
    { v: "outro", l: "Outro" },
  ];

  // ===== Estado =====
  let quadroAtivo = "vendas"; // "vendas" | "suporte" | "agenda"
  let fila = [];
  let cards = [];
  let agenda = [];
  let colegas = []; // [{id, nome}] — usuários ativos
  let configAlertas = { dias_alerta_amarelo: 2, dias_alerta_vermelho: 5 };
  let cardAtual = null; // card aberto no modal de detalhe/classificação/encerramento

  function souAdmin() { return !!(window.LolekAuth && window.LolekAuth.admin()); }
  function meuId() {
    // O token não carrega o id do usuário no front — resolve pelo login (único) batendo
    // com "colegas" (lista leve de usuárias ativas que o próprio back-end expõe).
    const usuario = window.LolekAuth && window.LolekAuth.usuario();
    const eu = colegas.find((c) => c.usuario === usuario);
    return eu ? eu.id : null;
  }

  async function chamarKanban(action, data) {
    const resp = await fetch(KB_FN, {
      method: "POST",
      headers: { "content-type": "application/json", ...(window.LolekAuth ? window.LolekAuth.headers() : {}) },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  async function chamarAuth(action, data) {
    const resp = await fetch(AUTH_FN, {
      method: "POST",
      headers: { "content-type": "application/json", ...(window.LolekAuth ? window.LolekAuth.headers() : {}) },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  function mostrarErro(msg) {
    gel("kb-status").innerHTML = `<div class="notice notice--error"><strong>Erro</strong> ${escHtml(msg)}</div>`;
    setTimeout(() => { gel("kb-status").innerHTML = ""; }, 6000);
  }

  // ===== Alerta de card parado (dias na ETAPA atual, não desde a última edição) =====
  function diasParado(card) {
    const base = card.etapa_desde || card.criado_em;
    return Math.floor((Date.now() - new Date(base).getTime()) / 86400000);
  }
  function corAlerta(card) {
    if (card.etapa === "encerrado" || card.etapa === "resolvido") return "";
    const dias = diasParado(card);
    if (dias >= configAlertas.dias_alerta_vermelho) return "kb-card--vermelho";
    if (dias >= configAlertas.dias_alerta_amarelo) return "kb-card--amarelo";
    return "";
  }

  // ===== Carregamentos =====
  async function carregarColegas() {
    try { colegas = await chamarAuth("listar_colegas"); } catch { colegas = []; }
  }

  async function carregarConfig() {
    try { configAlertas = await chamarKanban("obter_config"); } catch { /* mantém padrão */ }
  }

  async function carregarFila() {
    try { fila = await chamarKanban("listar_fila"); } catch (err) { mostrarErro(err.message); fila = []; }
  }

  async function carregarCards() {
    const data = { quadro: quadroAtivo };
    if (souAdmin()) {
      const sel = gel("kb-filtro-funcionaria");
      if (sel.value) data.funcionaria_id = sel.value;
    }
    try { cards = await chamarKanban("listar_cards", data); } catch (err) { mostrarErro(err.message); cards = []; }
  }

  async function carregarAgenda() {
    const data = {};
    if (souAdmin()) {
      const sel = gel("kb-filtro-funcionaria");
      if (sel.value) data.funcionaria_id = sel.value;
    }
    try { agenda = await chamarKanban("listar_agenda_retomada", data); } catch (err) { mostrarErro(err.message); agenda = []; }
  }

  // ===== Render =====
  function popularFiltroFuncionaria() {
    const sel = gel("kb-filtro-funcionaria");
    sel.hidden = !souAdmin();
    gel("kb-config-btn").hidden = !souAdmin();
    if (!souAdmin()) return;
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todas as vendedoras</option>' +
      colegas.map((c) => `<option value="${c.id}">${escHtml(c.nome)}</option>`).join("");
    sel.value = atual;
  }

  function cardChipHtml(card, opts) {
    opts = opts || {};
    const linha2 = card.destino || card.motivo_suporte || card.cliente_telefone || "";
    const valorTag = card.valor_estimado ? `<span class="badge">${fBRL(card.valor_estimado)}</span>` : "";
    const prioridadeTag = card.prioridade && card.prioridade !== "normal"
      ? `<span class="badge badge--erro">${card.prioridade === "emergencia" ? "🚨 Emergência" : "⚠ Urgente"}</span>` : "";
    const respNome = card.responsavel_id ? (colegas.find((c) => c.id === card.responsavel_id) || {}).nome : null;
    const respTag = (souAdmin() && respNome) ? `<div class="table__muted" style="font-size:0.72rem">${escHtml(respNome)}</div>` : "";
    const dias = card.etapa !== "encerrado" && card.etapa !== "resolvido" ? diasParado(card) : null;
    const diasTag = dias != null && dias > 0 ? `<span class="table__muted" style="font-size:0.7rem">${dias}d parado</span>` : "";
    return `
      <div class="kb-card ${corAlerta(card)}" data-kb-card="${card.id}" ${opts.draggable ? 'draggable="true"' : ""}>
        <div style="font-weight:600;font-size:0.86rem">${escHtml(card.cliente_nome || "Sem nome")}</div>
        ${linha2 ? `<div class="table__muted" style="font-size:0.78rem">${escHtml(linha2)}</div>` : ""}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${valorTag}${prioridadeTag}${diasTag}</div>
        ${respTag}
      </div>`;
  }

  function renderFila() {
    gel("kb-fila-count").textContent = fila.length;
    gel("kb-fila-lista").innerHTML = fila.length
      ? fila.map((c) => cardChipHtml(c, { draggable: true })).join("")
      : '<div class="empty-state empty-state--compact"><p>Ninguém esperando — tudo em dia 🎉</p></div>';

    gel("kb-fila-lista").querySelectorAll("[data-kb-card]").forEach((el) => {
      el.addEventListener("click", () => abrirClassificar(el.dataset.kbCard));
      el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", el.dataset.kbCard));
    });
  }

  function renderBoard() {
    const wrap = gel("kb-board");
    if (quadroAtivo === "agenda") { wrap.innerHTML = ""; return; }

    const etapas = ETAPAS_QUADRO[quadroAtivo];
    const etapaFinal = ETAPA_ENCERRAMENTO[quadroAtivo];
    const colunas = etapas.map((e) => ({ ...e, cards: cards.filter((c) => c.etapa === e.v) }));
    const encerrados = cards.filter((c) => c.etapa === etapaFinal).slice(0, 30);

    const colunaHtml = (col, dropavel) => `
      <div class="kb-coluna" data-kb-coluna="${col.v}">
        <div class="kb-coluna__header">${escHtml(col.l)} <span class="ci-section__count">${col.cards.length}</span></div>
        <div class="kb-coluna__lista" data-kb-drop="${dropavel ? col.v : ""}">
          ${col.cards.length ? col.cards.map((c) => cardChipHtml(c, { draggable: dropavel })).join("") : '<div class="table__muted" style="font-size:0.78rem;padding:8px">Vazio</div>'}
        </div>
      </div>`;

    wrap.innerHTML =
      colunas.map((c) => colunaHtml(c, true)).join("") +
      colunaHtml({ v: etapaFinal, l: ETAPA_LABEL_ENCERRAMENTO[quadroAtivo], cards: encerrados }, false);

    wrap.querySelectorAll("[data-kb-card]").forEach((el) => {
      el.addEventListener("click", () => abrirDetalhe(el.dataset.kbCard));
      el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", el.dataset.kbCard));
    });
    wrap.querySelectorAll("[data-kb-drop]").forEach((zona) => {
      const etapaAlvo = zona.dataset.kbDrop;
      if (!etapaAlvo) return;
      zona.addEventListener("dragover", (e) => e.preventDefault());
      zona.addEventListener("drop", async (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        await moverCardPara(id, etapaAlvo);
      });
    });
  }

  async function moverCardPara(id, etapaAlvo) {
    const doFila = fila.find((c) => c.id === id);
    if (doFila) { abrirClassificar(id); return; } // vindo da fila sempre exige classificar
    const card = cards.find((c) => c.id === id);
    if (!card || card.etapa === etapaAlvo) return;
    try {
      await chamarKanban("atualizar_card", { id, etapa: etapaAlvo });
      await recarregarTudo();
    } catch (err) { mostrarErro(err.message); }
  }

  async function recarregarTudo() {
    if (quadroAtivo === "agenda") { await carregarAgenda(); renderAgenda(); return; }
    await Promise.all([carregarFila(), carregarCards()]);
    renderFila();
    renderBoard();
  }

  function renderAgenda() {
    const tbody = gel("kb-agenda-tbody");
    if (agenda.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="table__muted">Nenhuma oportunidade futura agendada</td></tr>`;
      return;
    }
    tbody.innerHTML = agenda.map((c) => `
      <tr>
        <td>${fData(c.encerramento_data_retomada)}</td>
        <td>${escHtml(c.cliente_nome || "—")}</td>
        <td class="table__muted">${escHtml(c.destino || "—")}</td>
        <td class="table__muted">${escHtml(c.encerramento_obs || "—")}</td>
        <td class="table__muted">${escHtml((colegas.find((u) => u.id === c.responsavel_id) || {}).nome || "—")}</td>
        <td><button type="button" class="btn btn--ghost btn--sm" data-kb-card="${c.id}">Abrir</button></td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-kb-card]").forEach((btn) => btn.addEventListener("click", () => abrirDetalhe(btn.dataset.kbCard, true)));
  }

  // ===== Trocar de quadro/visão =====
  async function trocarQuadro(novo) {
    quadroAtivo = novo;
    document.querySelectorAll("[data-kb-quadro]").forEach((b) => {
      b.classList.toggle("btn--gold", b.dataset.kbQuadro === novo);
      b.classList.toggle("btn--ghost", b.dataset.kbQuadro !== novo);
    });
    gel("kb-fila-wrap").hidden = novo === "agenda";
    gel("kb-board").hidden = novo === "agenda";
    gel("kb-agenda-wrap").hidden = novo !== "agenda";
    await recarregarTudo();
  }

  // ===== Modal: Classificar (card da fila) =====
  let clienteVinculadoId = null; // preenchido se a busca por telefone achar um cadastro

  async function sugerirClienteCadastrado(card) {
    const box = gel("kb-classificar-cliente-sugestao");
    box.innerHTML = "";
    clienteVinculadoId = card.cliente_id || null;
    if (clienteVinculadoId || !card.cliente_telefone) return;
    try {
      const achados = await chamarKanban("buscar_cliente_telefone", { telefone: card.cliente_telefone });
      if (achados.length === 0) return;
      box.innerHTML = achados.map((c) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <span>📇 Já é cliente: <strong>${escHtml(c.nome)}</strong></span>
          <button type="button" class="btn btn--ghost btn--sm" data-kb-vincular="${c.id}">Vincular</button>
        </div>`).join("");
      box.querySelectorAll("[data-kb-vincular]").forEach((btn) => btn.addEventListener("click", () => {
        clienteVinculadoId = btn.dataset.kbVincular;
        box.innerHTML = `<span class="table__muted">Vinculado ✅</span>`;
      }));
    } catch { /* busca é só uma ajuda — falha silenciosa não pode travar a classificação */ }
  }

  function abrirClassificar(id) {
    const card = fila.find((c) => c.id === id);
    if (!card) return;
    cardAtual = card;
    gel("kb-classificar-cliente").textContent = (card.cliente_nome || "Sem nome") + (card.cliente_telefone ? " · " + card.cliente_telefone : "");
    sugerirClienteCadastrado(card);
    gel("kb-classificacao").value = "";
    ["kb-c-destino", "kb-c-pax", "kb-c-data-ida", "kb-c-data-volta", "kb-c-valor", "kb-c-descricao", "kb-c-obs-outros"].forEach((i) => gel(i).value = "");
    gel("kb-c-segmento").value = ""; gel("kb-c-origem").value = ""; gel("kb-c-motivo").value = "";
    gel("kb-c-momento").value = ""; gel("kb-c-prioridade").value = "normal";
    gel("kb-campos-vendas").hidden = true; gel("kb-campos-suporte").hidden = true; gel("kb-campos-outros").hidden = true;
    gel("kb-classificar-erro").hidden = true;
    gel("kb-modal-classificar").hidden = false;
  }

  gel("kb-classificacao").addEventListener("change", () => {
    const v = gel("kb-classificacao").value;
    gel("kb-campos-vendas").hidden = !(v === "nova_viagem" || v === "complemento");
    gel("kb-campos-suporte").hidden = v !== "suporte";
    gel("kb-campos-outros").hidden = v !== "outros";
  });

  gel("kb-classificar-salvar").addEventListener("click", async () => {
    const erroEl = gel("kb-classificar-erro");
    erroEl.hidden = true;
    const classificacao = gel("kb-classificacao").value;
    if (!classificacao) { erroEl.textContent = "Selecione o tipo de atendimento."; erroEl.hidden = false; return; }
    const dados = { id: cardAtual.id, classificacao, cliente_id: clienteVinculadoId };
    if (classificacao === "nova_viagem" || classificacao === "complemento") {
      Object.assign(dados, {
        destino: gel("kb-c-destino").value.trim(), num_passageiros: gel("kb-c-pax").value || null,
        data_ida: gel("kb-c-data-ida").value || null, data_volta: gel("kb-c-data-volta").value || null,
        valor_estimado: gel("kb-c-valor").value || null, segmento: gel("kb-c-segmento").value || null,
        origem_lead: gel("kb-c-origem").value || null,
      });
    } else if (classificacao === "suporte") {
      if (!gel("kb-c-motivo").value) { erroEl.textContent = "Selecione o motivo do suporte."; erroEl.hidden = false; return; }
      Object.assign(dados, {
        motivo_suporte: gel("kb-c-motivo").value, momento_viagem: gel("kb-c-momento").value || null,
        prioridade: gel("kb-c-prioridade").value, descricao_caso: gel("kb-c-descricao").value.trim(),
      });
    } else if (classificacao === "outros") {
      dados.observacao = gel("kb-c-obs-outros").value.trim();
    }
    try {
      await chamarKanban("classificar_card", dados);
      gel("kb-modal-classificar").hidden = true;
      await recarregarTudo();
    } catch (err) { erroEl.textContent = err.message; erroEl.hidden = false; }
  });

  // ===== Modal: Detalhe / edição do card =====
  async function abrirDetalhe(id, doOutroQuadro) {
    let card = cards.find((c) => c.id === id);
    if (!card && doOutroQuadro) {
      // Agenda pode abrir um card de vendas mesmo sem estar no quadro carregado agora.
      try { card = (await chamarKanban("listar_cards", { quadro: "vendas" })).find((c) => c.id === id); } catch { /* ignore */ }
    }
    if (!card) return;
    cardAtual = card;

    gel("kb-card-titulo").textContent = card.cliente_nome || "Sem nome";
    const encerrado = card.etapa === "encerrado" || card.etapa === "resolvido";
    const resumoLinhas = [
      card.cliente_telefone ? "📞 " + card.cliente_telefone : "",
      card.destino ? "📍 " + card.destino : "",
      card.motivo_suporte ? "🛟 " + card.motivo_suporte : "",
      card.valor_estimado ? "💰 " + fBRL(card.valor_estimado) : "",
      card.origem_lead ? "Lead: " + card.origem_lead : "",
      card.segmento ? "Segmento: " + card.segmento : "",
    ].filter(Boolean);
    gel("kb-card-resumo").innerHTML = resumoLinhas.map((l) => `<div class="table__muted" style="font-size:0.85rem">${escHtml(l)}</div>`).join("");

    const etapas = ETAPAS_QUADRO[card.quadro] || [];
    gel("kb-card-etapas").innerHTML = encerrado ? "" : etapas.map((e) => `
      <button type="button" class="btn ${e.v === card.etapa ? "btn--gold" : "btn--ghost"} btn--sm" data-kb-mover="${e.v}">${escHtml(e.l)}</button>`).join("");
    gel("kb-card-etapas").querySelectorAll("[data-kb-mover]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await chamarKanban("atualizar_card", { id: card.id, etapa: btn.dataset.kbMover }); gel("kb-modal-card").hidden = true; await recarregarTudo(); }
      catch (err) { mostrarErro(err.message); }
    }));

    gel("kb-card-transferir-btn").hidden = encerrado;
    gel("kb-card-encerrar-btn").hidden = encerrado;
    gel("kb-card-proxima-acao").value = card.proxima_acao_texto || "";
    gel("kb-card-proxima-data").value = card.proxima_acao_data || "";
    gel("kb-card-anotacoes").value = card.anotacoes || "";

    try {
      const eventos = await chamarKanban("listar_eventos", { card_id: card.id });
      gel("kb-card-historico").innerHTML = eventos.length
        ? eventos.slice().reverse().map((ev) => `<div>${fDataHora(ev.criado_em)} — ${escHtml(ev.usuario_nome || "—")}: ${escHtml(ev.tipo)}${ev.de_etapa || ev.para_etapa ? " (" + escHtml(ev.de_etapa || "") + " → " + escHtml(ev.para_etapa || "") + ")" : ""}${ev.motivo ? " — " + escHtml(ev.motivo) : ""}</div>`).join("")
        : "Sem eventos ainda.";
    } catch { gel("kb-card-historico").textContent = "—"; }

    gel("kb-modal-card").hidden = false;
  }

  gel("kb-card-salvar-btn").addEventListener("click", async () => {
    try {
      await chamarKanban("atualizar_card", {
        id: cardAtual.id,
        proxima_acao_texto: gel("kb-card-proxima-acao").value.trim(),
        proxima_acao_data: gel("kb-card-proxima-data").value || null,
        anotacoes: gel("kb-card-anotacoes").value.trim(),
      });
      gel("kb-modal-card").hidden = true;
      await recarregarTudo();
    } catch (err) { mostrarErro(err.message); }
  });

  // ===== Modal: Transferir =====
  gel("kb-card-transferir-btn").addEventListener("click", () => {
    const sel = gel("kb-transferir-para");
    sel.innerHTML = colegas.filter((c) => c.id !== meuId()).map((c) => `<option value="${c.id}">${escHtml(c.nome)}</option>`).join("");
    gel("kb-transferir-motivo").value = "";
    gel("kb-transferir-erro").hidden = true;
    gel("kb-modal-transferir").hidden = false;
  });
  gel("kb-transferir-salvar").addEventListener("click", async () => {
    const erroEl = gel("kb-transferir-erro");
    const motivo = gel("kb-transferir-motivo").value.trim();
    if (!motivo) { erroEl.textContent = "Informe o motivo."; erroEl.hidden = false; return; }
    try {
      await chamarKanban("transferir_card", { id: cardAtual.id, para_usuario_id: gel("kb-transferir-para").value, motivo });
      gel("kb-modal-transferir").hidden = true;
      gel("kb-modal-card").hidden = true;
      await recarregarTudo();
    } catch (err) { erroEl.textContent = err.message; erroEl.hidden = false; }
  });

  // ===== Modal: Encerrar =====
  function montarEncerrarHtml(card) {
    if (card.quadro === "vendas") {
      return `
        <label class="field field--full"><span class="field__label">Resultado *</span>
          <select id="kb-enc-tipo" class="input">
            <option value="">Selecione...</option>
            <option value="venda_concluida">Venda concluída</option>
            <option value="oportunidade_futura">Oportunidade futura</option>
            <option value="venda_nao_realizada">Venda não realizada</option>
          </select>
        </label>
        <div id="kb-enc-bloco-venda" hidden>
          <label class="field field--full"><span class="field__label">Valor total (R$) *</span><input type="number" step="0.01" id="kb-enc-valor" class="input" /></label>
          <div class="field__label" style="margin-bottom:4px">Produtos vendidos *</div>
          <div id="kb-enc-produtos" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            ${PRODUTOS_VENDA.map((p) => `<label style="display:inline-flex;gap:5px;align-items:center;font-size:0.85rem"><input type="checkbox" value="${p.v}" class="kb-enc-produto" />${escHtml(p.l)}</label>`).join("")}
          </div>
        </div>
        <div id="kb-enc-bloco-retomada" hidden>
          <label class="field field--full"><span class="field__label">Data de retomada *</span><input type="date" id="kb-enc-data-retomada" class="input" /></label>
          <label class="field field--full"><span class="field__label">Observação *</span><textarea id="kb-enc-obs" class="input" rows="2"></textarea></label>
        </div>
        <div id="kb-enc-bloco-perda" hidden>
          <label class="field field--full"><span class="field__label">Motivo *</span>
            <select id="kb-enc-motivo-perda" class="input"><option value="">Selecione...</option>${MOTIVOS_PERDA.map((m) => `<option value="${m.v}">${escHtml(m.l)}</option>`).join("")}</select>
          </label>
          <label class="field field--full"><span class="field__label">Observação (obrigatória se "Outro")</span><textarea id="kb-enc-obs-perda" class="input" rows="2"></textarea></label>
        </div>
        <div class="kb-modal-erro" id="kb-encerrar-erro" hidden style="color:#c0392b;font-size:0.82rem"></div>`;
    }
    return `
      <label class="field field--full"><span class="field__label">Como foi resolvido? *</span><textarea id="kb-enc-resolucao" class="input" rows="2"></textarea></label>
      <label class="field field--full"><span class="field__label">Gerou custo? *</span>
        <select id="kb-enc-gerou-custo" class="input"><option value="">Selecione...</option><option value="1">Sim</option><option value="0">Não</option></select>
      </label>
      <label class="field field--full" id="kb-enc-custo-valor-wrap" hidden><span class="field__label">Valor do custo (R$) *</span><input type="number" step="0.01" id="kb-enc-custo-valor" class="input" /></label>
      <label class="field field--full"><span class="field__label">Gerou nova venda? *</span>
        <select id="kb-enc-gerou-venda" class="input"><option value="">Selecione...</option><option value="1">Sim (cria card em Vendas como Complemento)</option><option value="0">Não</option></select>
      </label>
      <div class="kb-modal-erro" id="kb-encerrar-erro" hidden style="color:#c0392b;font-size:0.82rem"></div>`;
  }

  gel("kb-card-encerrar-btn").addEventListener("click", () => {
    gel("kb-encerrar-corpo").innerHTML = montarEncerrarHtml(cardAtual);
    if (cardAtual.quadro === "vendas") {
      gel("kb-enc-tipo").addEventListener("change", () => {
        const v = gel("kb-enc-tipo").value;
        gel("kb-enc-bloco-venda").hidden = v !== "venda_concluida";
        gel("kb-enc-bloco-retomada").hidden = v !== "oportunidade_futura";
        gel("kb-enc-bloco-perda").hidden = v !== "venda_nao_realizada";
      });
    } else {
      gel("kb-enc-gerou-custo").addEventListener("change", () => {
        gel("kb-enc-custo-valor-wrap").hidden = gel("kb-enc-gerou-custo").value !== "1";
      });
    }
    gel("kb-modal-encerrar").hidden = false;
  });

  gel("kb-encerrar-salvar").addEventListener("click", async () => {
    const erroEl = gel("kb-encerrar-erro");
    const dados = { id: cardAtual.id };
    if (cardAtual.quadro === "vendas") {
      const tipo = gel("kb-enc-tipo").value;
      if (!tipo) { erroEl.textContent = "Selecione o resultado."; erroEl.hidden = false; return; }
      dados.encerramento_tipo = tipo;
      if (tipo === "venda_concluida") {
        dados.encerramento_valor_total = gel("kb-enc-valor").value;
        dados.encerramento_produtos = [...document.querySelectorAll(".kb-enc-produto:checked")].map((c) => c.value);
      } else if (tipo === "oportunidade_futura") {
        dados.encerramento_data_retomada = gel("kb-enc-data-retomada").value;
        dados.encerramento_obs = gel("kb-enc-obs").value.trim();
      } else if (tipo === "venda_nao_realizada") {
        dados.encerramento_motivo_perda = gel("kb-enc-motivo-perda").value;
        dados.encerramento_obs = gel("kb-enc-obs-perda").value.trim();
      }
    } else {
      dados.resolucao_texto = gel("kb-enc-resolucao").value.trim();
      const gerouCusto = gel("kb-enc-gerou-custo").value;
      const gerouVenda = gel("kb-enc-gerou-venda").value;
      if (gerouCusto === "" || gerouVenda === "") { erroEl.textContent = "Responda custo e nova venda."; erroEl.hidden = false; return; }
      dados.resolucao_gerou_custo = gerouCusto === "1";
      dados.resolucao_valor_custo = gel("kb-enc-custo-valor") ? gel("kb-enc-custo-valor").value : null;
      dados.resolucao_gerou_venda = gerouVenda === "1";
    }
    try {
      await chamarKanban("encerrar_card", dados);
      gel("kb-modal-encerrar").hidden = true;
      gel("kb-modal-card").hidden = true;
      await recarregarTudo();
    } catch (err) { erroEl.textContent = err.message; erroEl.hidden = false; }
  });

  // ===== Modal: Novo contato manual (entra na fila) =====
  gel("kb-novo-btn").addEventListener("click", () => {
    gel("kb-novo-nome").value = ""; gel("kb-novo-telefone").value = "";
    gel("kb-novo-erro").hidden = true;
    gel("kb-modal-novo").hidden = false;
  });
  gel("kb-novo-salvar").addEventListener("click", async () => {
    const erroEl = gel("kb-novo-erro");
    const nome = gel("kb-novo-nome").value.trim();
    if (!nome) { erroEl.textContent = "Informe o nome."; erroEl.hidden = false; return; }
    try {
      await chamarKanban("criar_card", { cliente_nome: nome, cliente_telefone: gel("kb-novo-telefone").value.trim() });
      gel("kb-modal-novo").hidden = true;
      await recarregarTudo();
    } catch (err) { erroEl.textContent = err.message; erroEl.hidden = false; }
  });

  // ===== Modal: Configurar alertas (admin) =====
  gel("kb-config-btn").addEventListener("click", () => {
    gel("kb-config-amarelo").value = configAlertas.dias_alerta_amarelo;
    gel("kb-config-vermelho").value = configAlertas.dias_alerta_vermelho;
    gel("kb-modal-config").hidden = false;
  });
  gel("kb-config-salvar").addEventListener("click", async () => {
    try {
      configAlertas = await chamarKanban("salvar_config", {
        dias_alerta_amarelo: gel("kb-config-amarelo").value,
        dias_alerta_vermelho: gel("kb-config-vermelho").value,
      });
      gel("kb-modal-config").hidden = true;
      renderBoard();
    } catch (err) { mostrarErro(err.message); }
  });

  // ===== Fechar modais =====
  document.querySelectorAll("[data-kb-fechar]").forEach((btn) => {
    btn.addEventListener("click", () => { gel(btn.dataset.kbFechar).hidden = true; });
  });

  // ===== Wiring geral =====
  document.querySelectorAll("[data-kb-quadro]").forEach((btn) => {
    btn.addEventListener("click", () => trocarQuadro(btn.dataset.kbQuadro));
  });
  gel("kb-filtro-funcionaria").addEventListener("change", recarregarTudo);

  let carregouUmaVez = false;
  document.querySelector('[data-tab="kanban"]').addEventListener("click", async () => {
    if (carregouUmaVez) return;
    carregouUmaVez = true;
    await carregarColegas();
    await carregarConfig();
    popularFiltroFuncionaria();
    await trocarQuadro("vendas");
  });
})();
