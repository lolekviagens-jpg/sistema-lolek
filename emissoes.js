// ===== Emissões — Lolek Viagens =====
// Cadastro estruturado de vendas confirmadas: passageiros (existentes ou novos, lidos por
// IA), produtos da viagem (passagem/hospedagem/seguro/carro/passeio/transfer/mala, com
// leitura de print por IA pra passagem e hospedagem) e dados financeiros (milhas, milheiro,
// fornecedor, forma de pagamento, faturamento futuro). Ao salvar, cada produto gera
// automaticamente um lançamento de entrada no Financeiro (netlify/functions/emissoes-data.js).
(function () {
  "use strict";

  const LS_AI_MODEL = "lolek_anthropic_model";
  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }
  function gel(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fBRL(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fData(iso) {
    if (!iso) return "—";
    const [y, m, d] = String(iso).split("-");
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }
  function mesLabel(chaveAnoMes) {
    if (!chaveAnoMes || chaveAnoMes === "sem-data") return "Sem data";
    const [y, m] = chaveAnoMes.split("-");
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }

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

  function contextoDataAtual() {
    const hoje = new Date();
    const dd = String(hoje.getDate()).padStart(2, "0");
    const mm = String(hoje.getMonth() + 1).padStart(2, "0");
    const yyyy = hoje.getFullYear();
    return `Hoje é ${dd}/${mm}/${yyyy}. Datas de viagem são sempre no presente ou futuro a partir de hoje — nunca deduza um ano passado.`;
  }

  function novoId(prefixo) { return prefixo + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  // ===== Config =====
  const CLIENTE_CAMPOS = ["nome", "nascimento", "rg", "cpf", "passaporte", "venc_passaporte", "email", "telefone"];
  const CLIENTE_LABELS = {
    nome: "Nome completo", nascimento: "Nascimento", rg: "RG", cpf: "CPF",
    passaporte: "Passaporte", venc_passaporte: "Venc. passaporte", email: "E-mail", telefone: "Telefone",
  };

  const PROD_TIPOS = [
    { tipo: "passagem",   label: "Passagem aérea",     icon: "✈️" },
    { tipo: "hospedagem", label: "Hospedagem",         icon: "🏨" },
    { tipo: "seguro",     label: "Seguro viagem",      icon: "🛡️" },
    { tipo: "carro",      label: "Aluguel de carro",   icon: "🚗" },
    { tipo: "passeio",    label: "Passeio / Ingresso", icon: "🗺️" },
    { tipo: "transfer",   label: "Transfer",           icon: "🚌" },
    { tipo: "mala",       label: "Adicional de mala",  icon: "🧳" },
  ];
  const PROD_LABEL = Object.fromEntries(PROD_TIPOS.map((p) => [p.tipo, p.label]));
  const PROD_ICON  = Object.fromEntries(PROD_TIPOS.map((p) => [p.tipo, p.icon]));

  const DADOS_CFG = {
    passagem: [
      { id: "trecho", label: "Trecho", placeholder: "Ex: FOR → LIS" },
      { id: "companhia", label: "Companhia aérea" },
      { id: "voo", label: "Nº do voo" },
      { id: "horario_partida", label: "Horário de partida" },
      { id: "horario_chegada", label: "Horário de chegada" },
      { id: "conexoes", label: "Paradas / escalas" },
      { id: "taxa_embarque", label: "Taxa de embarque / pax (R$, informativo)", type: "number", step: "0.01" },
    ],
    hospedagem: [
      { id: "hotel", label: "Hotel / Pousada" },
      { id: "regime", label: "Regime", type: "select", options: ["Sem café", "Café incluso", "Meia pensão", "Pensão completa", "All inclusive"] },
      { id: "checkin", label: "Check-in", type: "date" },
      { id: "checkout", label: "Check-out", type: "date" },
    ],
    seguro: [
      { id: "seguradora", label: "Seguradora" },
      { id: "plano", label: "Plano" },
      { id: "cobertura", label: "Cobertura" },
    ],
    carro: [
      { id: "locadora", label: "Locadora" },
      { id: "categoria", label: "Categoria" },
    ],
    passeio: [
      { id: "descricao", label: "Descrição" },
      { id: "data_passeio", label: "Data", type: "date" },
    ],
    transfer: [
      { id: "trecho", label: "Trecho" },
      { id: "tipo_transfer", label: "Tipo", type: "select", options: ["Privativo", "Compartilhado", "Executivo"] },
    ],
    mala: [
      { id: "descricao", label: "Descrição", placeholder: "Ex: 1 mala extra 23kg" },
    ],
  };

  const FORMAS_PAGAMENTO = [
    { v: "pix", l: "Pix" }, { v: "sumup", l: "Sumup" }, { v: "valepay", l: "Valepay" }, { v: "faturado", l: "Faturado (cobrar depois)" },
  ];
  const ORIGENS_LEAD = ["Shalom", "Orgânico", "Corporativo", "Convenção", "Indicação", "Outro"];

  // ===== Estado =====
  let clientesCache = [];
  let fornecedoresCache = [];
  let passageiros = [];              // [{ id, cliente_id: string|null, nome }]
  let produtos = [];                 // [{ id, tipo }]
  const paxSelecionados = {};        // produtoId -> Set(paxId) — sobrevive a re-render das checkboxes
  let emissoesSalvas = null;
  let filtroListaEmi = "data"; // "data" (padrão, lista cronológica como na planilha) ou "viagem" (agrupado)

  // ===== Rede =====
  async function chamarEmissoes(action, data) {
    const resp = await fetch("/.netlify/functions/emissoes-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  async function carregarClientes() {
    try {
      const resp = await fetch("/.netlify/functions/clientes-data");
      clientesCache = resp.ok ? await resp.json() : [];
    } catch { clientesCache = []; }
  }

  async function carregarFornecedores() {
    try { fornecedoresCache = await chamarEmissoes("listar_fornecedores"); }
    catch { fornecedoresCache = []; }
  }

  // ===== Passageiros =====
  function addPassageiroExistente(cliente) {
    const id = novoId("pax");
    passageiros.push({ id, cliente_id: cliente.id, nome: cliente.nome });
    renderPassageiros();
    produtos.forEach((p) => { paxSelecionados[p.id] = paxSelecionados[p.id] || new Set(); paxSelecionados[p.id].add(id); renderProdutoPaxChecks(p.id); });
  }

  function addPassageiroNovo() {
    const id = novoId("pax");
    passageiros.push({ id, cliente_id: null, nome: "" });
    renderPassageiros();
    produtos.forEach((p) => { paxSelecionados[p.id] = paxSelecionados[p.id] || new Set(); paxSelecionados[p.id].add(id); renderProdutoPaxChecks(p.id); });
  }

  function removePassageiro(id) {
    passageiros = passageiros.filter((p) => p.id !== id);
    Object.values(paxSelecionados).forEach((set) => set.delete(id));
    renderPassageiros();
    produtos.forEach((p) => renderProdutoPaxChecks(p.id));
  }

  function renderPassageiros() {
    const wrap = gel("emi-passageiros-list");
    if (!wrap) return;
    if (passageiros.length === 0) {
      wrap.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum passageiro adicionado ainda</p></div>';
      return;
    }
    wrap.innerHTML = passageiros.map((p, i) => `
      <div class="orc-produto-item">
        <div class="orc-produto-header">
          <span class="orc-produto-icon">🧑</span>
          <span>Passageiro ${i + 1}${p.cliente_id ? " — " + escHtml(p.nome) : " (novo)"}</span>
          <button type="button" class="orc-produto-remove" data-remove-pax="${p.id}">✕ Remover</button>
        </div>
        <div class="orc-produto-body">
          ${p.cliente_id ? "" : `
            <div class="form__grid" style="margin-bottom:10px">
              <label class="field field--full">
                <span class="field__label">Colar dados do passageiro</span>
                <textarea class="input" rows="2" id="emi-pax-${p.id}-paste" placeholder="Cole aqui nome, CPF, passaporte etc."></textarea>
              </label>
            </div>
            <button type="button" class="btn btn--ghost btn--icon" data-pax-extrair="${p.id}" style="margin-bottom:10px">🤖 Extrair dados</button>
            <div class="form__grid">
              ${CLIENTE_CAMPOS.map((c) => `
                <label class="field"><span class="field__label">${CLIENTE_LABELS[c]}</span>
                  <input type="text" class="input" id="emi-pax-${p.id}-${c}" />
                </label>`).join("")}
            </div>
          `}
          <div class="form__grid" style="margin-top:10px">
            <label class="field"><span class="field__label">Tamanho da mala</span>
              <input type="text" class="input" id="emi-pax-${p.id}-mala" placeholder="Ex: 1 mala 23kg + bagagem de mão" />
            </label>
            <label class="field field--full"><span class="field__label">Observações / lembretes</span>
              <textarea class="input" rows="2" id="emi-pax-${p.id}-obs" placeholder="Ex: quer assento na janela, vai levar pet, refeição sem glúten..."></textarea>
            </label>
          </div>
        </div>
      </div>`).join("");

    wrap.querySelectorAll("[data-remove-pax]").forEach((btn) =>
      btn.addEventListener("click", () => removePassageiro(btn.dataset.removePax)));
    wrap.querySelectorAll("[data-pax-extrair]").forEach((btn) =>
      btn.addEventListener("click", () => extrairPassageiroIA(btn.dataset.paxExtrair)));
  }

  async function extrairPassageiroIA(paxId) {
    const btn = document.querySelector(`[data-pax-extrair="${paxId}"]`);
    const texto = (gel(`emi-pax-${paxId}-paste`) || {}).value || "";
    if (!texto.trim()) { alert("Cole os dados do passageiro antes de extrair."); return; }
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Extraindo..."; }
    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 512,
          messages: [{
            role: "user",
            content: `Extraia os dados do passageiro abaixo e retorne SOMENTE um JSON válido, sem texto adicional:\n\n${texto}\n\n{"nome":"","nascimento":"","rg":"","cpf":"","passaporte":"","venc_passaporte":"","email":"","telefone":""}`,
          }],
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }
      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");
      const ex = JSON.parse(jsonStr);
      CLIENTE_CAMPOS.forEach((c) => { const el = gel(`emi-pax-${paxId}-${c}`); if (el && ex[c]) el.value = ex[c]; });
      if (btn) { btn.disabled = false; btn.textContent = "✓ Extraído!"; setTimeout(() => { btn.textContent = "🤖 Extrair dados"; }, 2000); }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "🤖 Extrair dados"; }
      alert("Erro ao extrair: " + err.message);
    }
  }

  // ===== Busca de cliente existente =====
  function setupBuscaCliente() {
    gel("emi-add-passageiro-existente").addEventListener("click", () => {
      const wrap = gel("emi-busca-cliente-wrap");
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) { gel("emi-busca-cliente").value = ""; gel("emi-busca-cliente-resultados").innerHTML = ""; gel("emi-busca-cliente").focus(); }
    });
    gel("emi-add-passageiro-novo").addEventListener("click", addPassageiroNovo);
    gel("emi-busca-cliente").addEventListener("input", renderBuscaResultados);
  }

  function renderBuscaResultados() {
    const termo = norm(gel("emi-busca-cliente").value.trim());
    const box = gel("emi-busca-cliente-resultados");
    if (!termo) { box.innerHTML = ""; return; }
    const encontrados = clientesCache.filter((c) => norm(c.nome).includes(termo)).slice(0, 15);
    if (encontrados.length === 0) {
      box.innerHTML = '<div class="emi-busca-item" style="cursor:default;color:var(--text-muted)">Nenhum cliente encontrado</div>';
      return;
    }
    box.innerHTML = encontrados.map((c) => `<button type="button" class="emi-busca-item" data-id="${escHtml(c.id)}">${escHtml(c.nome)}</button>`).join("");
    box.querySelectorAll(".emi-busca-item[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cliente = clientesCache.find((c) => c.id === btn.dataset.id);
        if (cliente) addPassageiroExistente(cliente);
        gel("emi-busca-cliente-wrap").hidden = true;
      });
    });
  }

  // ===== Produtos =====
  function addProduto(tipo) {
    const id = novoId("prod");
    produtos.push({ id, tipo });
    paxSelecionados[id] = new Set(passageiros.map((p) => p.id));
    renderProdutos();
  }

  function removeProduto(id) {
    produtos = produtos.filter((p) => p.id !== id);
    delete paxSelecionados[id];
    renderProdutos();
  }

  function montarOptionsFornecedor(selectedId) {
    return '<option value="">— Nenhum —</option>' +
      fornecedoresCache.map((f) => `<option value="${escHtml(f.id)}" ${f.id === selectedId ? "selected" : ""}>${escHtml(f.nome)}</option>`).join("") +
      '<option value="__novo__">+ Novo fornecedor...</option>';
  }

  function campoDados(prodId, f) {
    const idAttr = `emi-prod-${prodId}-dados-${f.id}`;
    if (f.type === "select") {
      return `<label class="field"><span class="field__label">${f.label}</span>
        <select class="input" id="${idAttr}"><option value="">—</option>${f.options.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}</select>
      </label>`;
    }
    return `<label class="field"><span class="field__label">${f.label}</span>
      <input type="${f.type || "text"}" class="input" id="${idAttr}" ${f.step ? `step="${f.step}"` : ""} placeholder="${f.placeholder || ""}" />
    </label>`;
  }

  function renderProdutoPaxChecks(prodId) {
    const box = gel(`emi-prod-${prodId}-pax-checks`);
    if (!box) return;
    const selecionados = paxSelecionados[prodId] || new Set();
    if (passageiros.length === 0) {
      box.innerHTML = '<span class="table__muted">Adicione passageiros acima primeiro</span>';
      return;
    }
    box.innerHTML = passageiros.map((p, i) => `
      <label style="display:inline-flex;align-items:center;gap:5px;margin:0 14px 6px 0;font-size:0.85rem">
        <input type="checkbox" id="emi-prod-${prodId}-pax-${p.id}" ${selecionados.has(p.id) ? "checked" : ""} />
        ${p.cliente_id ? escHtml(p.nome) : "Passageiro " + (i + 1) + " (novo)"}
      </label>`).join("");
    box.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const paxId = cb.id.replace(`emi-prod-${prodId}-pax-`, "");
        if (!paxSelecionados[prodId]) paxSelecionados[prodId] = new Set();
        if (cb.checked) paxSelecionados[prodId].add(paxId); else paxSelecionados[prodId].delete(paxId);
      });
    });
  }

  function renderProdutos() {
    const wrap = gel("emi-produtos-list");
    if (!wrap) return;
    if (produtos.length === 0) {
      wrap.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum produto adicionado ainda</p></div>';
      return;
    }

    wrap.innerHTML = produtos.map((prod) => {
      const isPassagem = prod.tipo === "passagem";
      const camposDados = (DADOS_CFG[prod.tipo] || []).map((f) => campoDados(prod.id, f)).join("");

      return `
      <div class="orc-produto-item">
        <div class="orc-produto-header">
          <span class="orc-produto-icon">${PROD_ICON[prod.tipo]}</span>
          <span>${PROD_LABEL[prod.tipo]}</span>
          <button type="button" class="orc-produto-remove" data-remove-prod="${prod.id}">✕ Remover</button>
        </div>
        <div class="orc-produto-body">

          <div class="orc-extras-label">Passageiros cobertos por esta linha</div>
          <div id="emi-prod-${prod.id}-pax-checks" style="margin-bottom:12px"></div>

          <div class="form__grid">${camposDados}</div>

          ${isPassagem ? `<div class="orc-foto-zone" id="emi-prod-${prod.id}-fotozone" tabindex="0">
            <div class="orc-foto-hint">📎 Cole aqui (Ctrl+V) um print da passagem/reserva pra IA ler os dados</div>
          </div>` : ""}
          ${prod.tipo === "hospedagem" ? `<div class="orc-foto-zone" id="emi-prod-${prod.id}-fotozone" tabindex="0">
            <div class="orc-foto-hint">📎 Cole aqui (Ctrl+V) um print da reserva do hotel pra IA ler os dados</div>
          </div>` : ""}

          <div class="orc-milhas-box">
            <div class="orc-milhas-title">Financeiro</div>
            <div class="form__grid">
              ${isPassagem ? `
                <label class="field"><span class="field__label">Como foi comprada</span>
                  <select class="input" id="emi-prod-${prod.id}-compra_tipo">
                    <option value="milhas">Milhas</option>
                    <option value="tarifado">Tarifado / operadora (dinheiro)</option>
                  </select>
                </label>
                <label class="field" id="emi-prod-${prod.id}-wrap-milhas"><span class="field__label">Qtd. milhas</span>
                  <input type="number" class="input" id="emi-prod-${prod.id}-qtd_milhas" />
                </label>
                <label class="field" id="emi-prod-${prod.id}-wrap-milheiro"><span class="field__label">Valor do milheiro (R$)</span>
                  <input type="number" class="input" id="emi-prod-${prod.id}-valor_milha" step="0.01" />
                </label>
                <label class="field" id="emi-prod-${prod.id}-wrap-custo" hidden><span class="field__label">Custo (R$)</span>
                  <input type="number" class="input" id="emi-prod-${prod.id}-custo" step="0.01" />
                </label>
              ` : `
                <label class="field"><span class="field__label">Custo (R$)</span>
                  <input type="number" class="input" id="emi-prod-${prod.id}-custo" step="0.01" />
                </label>
              `}
              <label class="field"><span class="field__label">Fornecedor (milheiro / site / operadora)</span>
                <select class="input emi-sel-fornecedor" id="emi-prod-${prod.id}-fornecedor">${montarOptionsFornecedor(null)}</select>
              </label>
              <label class="field orc-field--highlight"><span class="field__label">Valor total cobrado do cliente (R$) ★</span>
                <input type="number" class="input" id="emi-prod-${prod.id}-valor_venda" step="0.01" />
              </label>
              <label class="field"><span class="field__label">Forma de pagamento</span>
                <select class="input" id="emi-prod-${prod.id}-forma_pagamento">
                  ${FORMAS_PAGAMENTO.map((f) => `<option value="${f.v}">${f.l}</option>`).join("")}
                </select>
              </label>
              <label class="field" id="emi-prod-${prod.id}-wrap-faturamento" hidden><span class="field__label">Cobrar em (data)</span>
                <input type="date" class="input" id="emi-prod-${prod.id}-data_faturamento" />
              </label>
              <label class="field"><span class="field__label">Funcionária responsável</span>
                <input type="text" class="input" id="emi-prod-${prod.id}-funcionaria" placeholder="Ex: Letícia ou Letícia/Emily" />
              </label>
              ${isPassagem ? `<label class="field"><span class="field__label">Origem do lead</span>
                <select class="input" id="emi-prod-${prod.id}-origem_lead">
                  <option value="">—</option>
                  ${ORIGENS_LEAD.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}
                </select>
              </label>` : ""}
            </div>
          </div>
        </div>
      </div>`;
    }).join("");

    produtos.forEach((prod) => {
      renderProdutoPaxChecks(prod.id);

      const removeBtn = document.querySelector(`[data-remove-prod="${prod.id}"]`);
      if (removeBtn) removeBtn.addEventListener("click", () => removeProduto(prod.id));

      const compraTipoEl = gel(`emi-prod-${prod.id}-compra_tipo`);
      if (compraTipoEl) {
        const atualizarCompraTipo = () => {
          const milhas = compraTipoEl.value === "milhas";
          gel(`emi-prod-${prod.id}-wrap-milhas`).hidden = !milhas;
          gel(`emi-prod-${prod.id}-wrap-milheiro`).hidden = !milhas;
          gel(`emi-prod-${prod.id}-wrap-custo`).hidden = milhas;
        };
        compraTipoEl.addEventListener("change", atualizarCompraTipo);
        atualizarCompraTipo();
      }

      const formaPagEl = gel(`emi-prod-${prod.id}-forma_pagamento`);
      if (formaPagEl) {
        formaPagEl.addEventListener("change", () => {
          gel(`emi-prod-${prod.id}-wrap-faturamento`).hidden = formaPagEl.value !== "faturado";
        });
      }

      const fornecedorEl = gel(`emi-prod-${prod.id}-fornecedor`);
      if (fornecedorEl) {
        fornecedorEl.addEventListener("change", async () => {
          if (fornecedorEl.value !== "__novo__") return;
          const nome = prompt("Nome do novo fornecedor (milheiro/site/operadora):");
          if (!nome || !nome.trim()) { fornecedorEl.value = ""; return; }
          try {
            const [criado] = await chamarEmissoes("criar_fornecedor", { nome: nome.trim() });
            fornecedoresCache.push(criado);
            document.querySelectorAll(".emi-sel-fornecedor").forEach((sel) => {
              const valorAtual = sel === fornecedorEl ? criado.id : sel.value;
              sel.innerHTML = montarOptionsFornecedor(valorAtual);
            });
          } catch (err) {
            alert("Erro ao criar fornecedor: " + err.message);
            fornecedorEl.value = "";
          }
        });
      }

      if (prod.tipo === "passagem" || prod.tipo === "hospedagem") {
        const zone = gel(`emi-prod-${prod.id}-fotozone`);
        if (zone) {
          zone.addEventListener("paste", (e) => {
            for (const item of (e.clipboardData?.items || [])) {
              if (item.type.startsWith("image/")) {
                const r = new FileReader();
                r.onload = (ev) => analisarDocumento(prod.id, prod.tipo, ev.target.result, zone);
                r.readAsDataURL(item.getAsFile());
              }
            }
          });
        }
      }
    });
  }

  // ===== Leitura de print por IA (passagem / hospedagem) =====
  async function analisarDocumento(prodId, tipo, imageSrc, zone) {
    const match = imageSrc.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    const [, mime, b64] = match;
    const hintEl = zone.querySelector(".orc-foto-hint");
    if (hintEl) hintEl.textContent = "⏳ Analisando...";

    const prompt = tipo === "passagem"
      ? `${contextoDataAtual()}\n\nAnalise este print de passagem/reserva aérea. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO",\n  "companhia": "nome da companhia aérea",\n  "voo": "número do voo",\n  "horario_partida": "HH:MM",\n  "horario_chegada": "HH:MM ou HH:MM (+1)",\n  "conexoes": "Voo direto OU ex: 1 escala em GRU",\n  "milhas": número_inteiro_ou_null,\n  "taxa_embarque": valor_numerico_em_reais_ou_null\n}`
      : `${contextoDataAtual()}\n\nAnalise este print de reserva/confirmação de hotel ou pousada. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "hotel": "nome do hotel/pousada",\n  "regime": "uma destas opções, exatamente como escrito: ${DADOS_CFG.hospedagem[1].options.map((o) => `\"${o}\"`).join(", ")} — ou null se não estiver claro",\n  "checkin": "AAAA-MM-DD ou null",\n  "checkout": "AAAA-MM-DD ou null",\n  "custo": valor_numerico_total_em_reais_ou_null\n}`;

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime || "image/png", data: b64 } }, { type: "text", text: prompt }] }],
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }
      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");
      const ex = JSON.parse(jsonStr);

      if (tipo === "passagem") {
        const fill = (campo, val) => { const el = gel(`emi-prod-${prodId}-dados-${campo}`); if (el && val != null && val !== "") el.value = val; };
        fill("trecho", ex.trecho); fill("companhia", ex.companhia); fill("voo", ex.voo);
        fill("horario_partida", ex.horario_partida); fill("horario_chegada", ex.horario_chegada);
        fill("conexoes", ex.conexoes); fill("taxa_embarque", ex.taxa_embarque);
        if (ex.milhas != null) { const el = gel(`emi-prod-${prodId}-qtd_milhas`); if (el) el.value = ex.milhas; }
      } else {
        const fill = (campo, val) => { const el = gel(`emi-prod-${prodId}-dados-${campo}`); if (el && val != null && val !== "") el.value = val; };
        fill("hotel", ex.hotel);
        if (ex.regime && DADOS_CFG.hospedagem[1].options.includes(ex.regime)) fill("regime", ex.regime);
        fill("checkin", ex.checkin); fill("checkout", ex.checkout);
        if (ex.custo != null) { const el = gel(`emi-prod-${prodId}-custo`); if (el) el.value = ex.custo; }
      }
      if (hintEl) hintEl.textContent = "✓ Dados extraídos! Cole outro print pra tentar de novo.";
    } catch (err) {
      if (hintEl) hintEl.textContent = "Erro ao analisar: " + err.message + " — tente colar novamente.";
    }
  }

  // ===== Salvar =====
  function coletarPayload() {
    const emissao = {
      destino: gel("emi-destino").value.trim(),
      data_ida: gel("emi-data-ida").value || null,
      data_volta: gel("emi-data-volta").value || null,
      tipo_viagem: gel("emi-tipo-viagem").value || null,
      observacoes_gerais: gel("emi-obs-gerais").value.trim(),
    };

    const idxPorPaxId = new Map(passageiros.map((p, i) => [p.id, i]));

    const passageirosPayload = passageiros.map((p) => {
      const tamanho_mala = (gel(`emi-pax-${p.id}-mala`) || {}).value || "";
      const observacoes  = (gel(`emi-pax-${p.id}-obs`) || {}).value || "";
      if (p.cliente_id) return { cliente_id: p.cliente_id, tamanho_mala: tamanho_mala.trim(), observacoes: observacoes.trim() };
      const dados_novos = {};
      CLIENTE_CAMPOS.forEach((c) => { dados_novos[c] = (gel(`emi-pax-${p.id}-${c}`) || {}).value || ""; });
      return { dados_novos, tamanho_mala: tamanho_mala.trim(), observacoes: observacoes.trim() };
    });

    const produtosPayload = produtos.map((prod) => {
      const dados = {};
      (DADOS_CFG[prod.tipo] || []).forEach((f) => { dados[f.id] = (gel(`emi-prod-${prod.id}-dados-${f.id}`) || {}).value || ""; });

      let indices = passageiros.filter((p) => (paxSelecionados[prod.id] || new Set()).has(p.id)).map((p) => idxPorPaxId.get(p.id));
      if (indices.length === 0) indices = passageiros.map((_, i) => i); // ninguém marcado -> aplica a todos

      const compraTipoEl = gel(`emi-prod-${prod.id}-compra_tipo`);
      const compraMilhas = compraTipoEl ? compraTipoEl.value === "milhas" : false;
      const formaPagamento = gel(`emi-prod-${prod.id}-forma_pagamento`).value;

      return {
        tipo: prod.tipo,
        passageiro_indices: indices,
        dados,
        fornecedor_id: gel(`emi-prod-${prod.id}-fornecedor`).value || null,
        valor_milha: compraMilhas ? (parseFloat(gel(`emi-prod-${prod.id}-valor_milha`).value) || null) : null,
        qtd_milhas: compraMilhas ? (parseFloat(gel(`emi-prod-${prod.id}-qtd_milhas`).value) || null) : null,
        custo: !compraMilhas ? (parseFloat(gel(`emi-prod-${prod.id}-custo`).value) || null) : null,
        valor_venda: parseFloat(gel(`emi-prod-${prod.id}-valor_venda`).value) || 0,
        forma_pagamento: formaPagamento,
        data_faturamento: formaPagamento === "faturado" ? (gel(`emi-prod-${prod.id}-data_faturamento`).value || null) : null,
        funcionaria: gel(`emi-prod-${prod.id}-funcionaria`).value.trim(),
        origem_lead: prod.tipo === "passagem" ? gel(`emi-prod-${prod.id}-origem_lead`).value : null,
      };
    });

    return { emissao, passageiros: passageirosPayload, produtos: produtosPayload };
  }

  function limparFormulario() {
    passageiros = []; produtos = [];
    Object.keys(paxSelecionados).forEach((k) => delete paxSelecionados[k]);
    ["emi-destino", "emi-data-ida", "emi-data-volta", "emi-tipo-viagem", "emi-obs-gerais"].forEach((id) => { const el = gel(id); if (el) el.value = ""; });
    renderPassageiros(); renderProdutos();
  }

  async function salvarEmissao() {
    const payload = coletarPayload();
    if (payload.passageiros.length === 0) { alert("Adicione ao menos um passageiro."); return; }
    if (payload.produtos.length === 0) { alert("Adicione ao menos um produto."); return; }
    for (const p of payload.produtos) {
      if (!p.valor_venda) { alert("Informe o valor cobrado do cliente em todos os produtos."); return; }
    }

    const btn = gel("emi-salvar-btn");
    btn.disabled = true; btn.textContent = "⏳ Salvando...";
    gel("emi-status").innerHTML = "";
    try {
      await chamarEmissoes("criar_emissao", payload);
      gel("emi-status").innerHTML = '<div class="ctr-status-msg ctr-status-msg--ok">✓ Emissão salva com sucesso.</div>';
      limparFormulario();
      await carregarClientes();
      await carregarListaEmissoes();
      renderListaEmissoes();
    } catch (err) {
      gel("emi-status").innerHTML = `<div class="ctr-status-msg ctr-status-msg--erro">Erro ao salvar: ${escHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = "💾 Salvar emissão";
    }
  }

  // ===== Listagem =====
  async function carregarListaEmissoes() {
    try {
      const resp = await fetch("/.netlify/functions/emissoes-data");
      emissoesSalvas = resp.ok ? await resp.json() : null;
    } catch { emissoesSalvas = null; }
  }

  function paxNome(pax) {
    const cliente = clientesCache.find((c) => c.id === pax.cliente_id);
    return cliente ? cliente.nome : "Passageiro";
  }

  function renderViagemCard(e) {
    const pax = e.venda_emissoes_passageiros || [];
    const prods = e.venda_emissoes_produtos || [];
    const totalVenda = prods.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);
    return `
      <div class="emi-viagem-card">
        <div class="emi-viagem-header">
          <strong>${escHtml(e.destino || "Sem destino informado")}</strong>
          <span style="opacity:0.8">${fData(e.data_ida)}${e.data_volta ? " – " + fData(e.data_volta) : ""}</span>
          ${e.tipo_viagem ? `<span class="badge badge--andamento">${escHtml(e.tipo_viagem)}</span>` : ""}
          <button type="button" class="orc-produto-remove" style="margin-left:auto;color:#fff" data-excluir-emissao="${e.id}">✕ Excluir</button>
        </div>
        <div class="emi-viagem-body">
          <div class="table__muted" style="margin-bottom:8px">${pax.map((p) => escHtml(paxNome(p))).join(", ") || "—"}</div>
          <div class="card">
            <table class="table">
              <thead><tr><th>Produto</th><th>Pax</th><th>Valor</th><th>Pagamento</th></tr></thead>
              <tbody>${prods.map((p) => `
                <tr>
                  <td>${PROD_ICON[p.tipo] || "📦"} ${escHtml(PROD_LABEL[p.tipo] || p.tipo)}</td>
                  <td class="table__muted">${(p.passageiro_ids || []).length || 1}</td>
                  <td>${fBRL(p.valor_venda)}</td>
                  <td class="table__muted">${escHtml(FORMAS_PAGAMENTO.find((f) => f.v === p.forma_pagamento)?.l || p.forma_pagamento || "—")}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <div style="text-align:right;margin-top:8px;font-weight:600">Total: ${fBRL(totalVenda)}</div>
        </div>
      </div>`;
  }

  function renderProdutoRow(p, mapaPax) {
    const nomes = (p.passageiro_ids || []).map((id) => (mapaPax.get(id) || {}).nome || "—").join(", ") || "—";
    return `
      <tr>
        <td class="table__muted">${fData(p.data_venda)}</td>
        <td>${escHtml(nomes)}</td>
        <td>${escHtml(p._destino || "—")}</td>
        <td>${PROD_ICON[p.tipo] || "📦"} ${escHtml(PROD_LABEL[p.tipo] || p.tipo)}</td>
        <td>${fBRL(p.valor_venda)}</td>
        <td class="table__muted">${escHtml(FORMAS_PAGAMENTO.find((f) => f.v === p.forma_pagamento)?.l || p.forma_pagamento || "—")}</td>
      </tr>`;
  }

  function tabelaProdutos(produtos, mapaPax) {
    return `<div class="card"><table class="table">
      <thead><tr><th>Data</th><th>Cliente(s)</th><th>Viagem</th><th>Produto</th><th>Valor</th><th>Pagamento</th></tr></thead>
      <tbody>${produtos.map((p) => renderProdutoRow(p, mapaPax)).join("")}</tbody>
    </table></div>`;
  }

  function somaValor(produtos) { return produtos.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0); }

  // id do passageiro (venda_emissoes_passageiros.id) -> { nome, clienteId }
  function construirMapaPax() {
    const mapa = new Map();
    (emissoesSalvas || []).forEach((e) => {
      (e.venda_emissoes_passageiros || []).forEach((pax) => {
        mapa.set(pax.id, { nome: paxNome(pax), clienteId: pax.cliente_id });
      });
    });
    return mapa;
  }

  function todosProdutosOrdenados() {
    return (emissoesSalvas || [])
      .flatMap((e) => (e.venda_emissoes_produtos || []).map((p) => ({ ...p, _destino: e.destino })))
      .sort((a, b) => (b.data_venda || "").localeCompare(a.data_venda || ""));
  }

  function renderPorData(produtos, mapaPax) {
    const grupos = new Map();
    produtos.forEach((p) => {
      const chave = (p.data_venda || "").slice(0, 7) || "sem-data";
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(p);
    });
    const chavesOrdenadas = [...grupos.keys()].sort((a, b) => b.localeCompare(a));
    return chavesOrdenadas.map((chave) => {
      const itens = grupos.get(chave);
      return `<div class="emi-grupo-wrap">
        <div class="emi-grupo-header">
          <strong>${escHtml(mesLabel(chave))}</strong>
          <span class="emi-grupo-total">${itens.length} produto${itens.length !== 1 ? "s" : ""} · ${fBRL(somaValor(itens))}</span>
        </div>
        ${tabelaProdutos(itens, mapaPax)}
      </div>`;
    }).join("");
  }

  function renderPorCliente(produtos, mapaPax) {
    const porCliente = new Map(); // clienteId -> { nome, produtos: [] }
    produtos.forEach((p) => {
      (p.passageiro_ids || []).forEach((id) => {
        const info = mapaPax.get(id);
        if (!info) return;
        const chave = info.clienteId || info.nome;
        if (!porCliente.has(chave)) porCliente.set(chave, { nome: info.nome, produtos: [] });
        porCliente.get(chave).produtos.push(p);
      });
    });
    const entradas = [...porCliente.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return entradas.map((c) => `<div class="emi-grupo-wrap">
      <div class="emi-grupo-header">
        <strong>${escHtml(c.nome)}</strong>
        <span class="emi-grupo-total">${c.produtos.length} produto${c.produtos.length !== 1 ? "s" : ""} · ${fBRL(somaValor(c.produtos))}</span>
      </div>
      ${tabelaProdutos(c.produtos, mapaPax)}
    </div>`).join("");
  }

  function renderListaEmissoes() {
    const wrap = gel("emi-lista-wrap");
    const count = gel("emi-count");
    if (!wrap) return;

    if (emissoesSalvas === null) {
      wrap.innerHTML = '<div class="empty-state"><p>Erro ao carregar emissões</p></div>';
      count.textContent = "";
      return;
    }
    if (emissoesSalvas.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>Nenhuma emissão cadastrada ainda</p></div>';
      count.textContent = "";
      return;
    }

    if (filtroListaEmi === "viagem") {
      count.textContent = emissoesSalvas.length + " viagem" + (emissoesSalvas.length !== 1 ? "ns" : "");
      wrap.innerHTML = emissoesSalvas.map(renderViagemCard).join("");
      wrap.querySelectorAll("[data-excluir-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => excluirEmissao(btn.dataset.excluirEmissao)));
      return;
    }

    const mapaPax = construirMapaPax();
    const todosProdutos = todosProdutosOrdenados();

    if (filtroListaEmi === "cliente") {
      const clientesUnicos = new Set(todosProdutos.flatMap((p) => (p.passageiro_ids || []).map((id) => (mapaPax.get(id) || {}).clienteId).filter(Boolean)));
      count.textContent = clientesUnicos.size + " cliente" + (clientesUnicos.size !== 1 ? "s" : "");
      wrap.innerHTML = renderPorCliente(todosProdutos, mapaPax);
    } else {
      // Lista mensal (mais recente primeiro), como na planilha antiga.
      count.textContent = todosProdutos.length + " produto" + (todosProdutos.length !== 1 ? "s" : "");
      wrap.innerHTML = renderPorData(todosProdutos, mapaPax);
    }
  }

  async function excluirEmissao(id) {
    if (!confirm("Excluir esta viagem e todos os produtos/lançamentos financeiros ligados a ela?")) return;
    try {
      await chamarEmissoes("excluir_emissao", { id });
      await carregarListaEmissoes();
      renderListaEmissoes();
    } catch (err) {
      alert("Erro ao excluir: " + err.message);
    }
  }

  // ===== Init =====
  async function init() {
    setupBuscaCliente();

    const botoesWrap = gel("emi-add-produto-btns");
    botoesWrap.innerHTML = PROD_TIPOS.map((p) => `<button type="button" class="emi-add-btn-inline" data-add-produto="${p.tipo}">${p.icon} ${p.label}</button>`).join("");
    botoesWrap.querySelectorAll("[data-add-produto]").forEach((btn) => btn.addEventListener("click", () => addProduto(btn.dataset.addProduto)));

    gel("emi-salvar-btn").addEventListener("click", salvarEmissao);
    gel("emi-atualizar-btn").addEventListener("click", async () => { await carregarListaEmissoes(); renderListaEmissoes(); });

    document.querySelectorAll("[data-filtro-emi]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filtroListaEmi = btn.dataset.filtroEmi;
        document.querySelectorAll("[data-filtro-emi]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderListaEmissoes();
      });
    });

    renderPassageiros();
    renderProdutos();

    await Promise.all([carregarClientes(), carregarFornecedores(), carregarListaEmissoes()]);
    renderListaEmissoes();
  }

  init();
})();
