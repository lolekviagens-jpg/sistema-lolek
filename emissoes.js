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

  // ===== Valor por extenso (pra pré-preencher o contrato) =====
  const EXT_UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const EXT_10A19 = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const EXT_DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const EXT_CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const EXT_ESCALAS = [
    { valor: 1000000000, singular: "bilhão", plural: "bilhões" },
    { valor: 1000000, singular: "milhão", plural: "milhões" },
    { valor: 1000, singular: "mil", plural: "mil" },
  ];

  function extCentena(n) {
    if (n === 0) return "";
    if (n === 100) return "cem";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const partes = [];
    if (c > 0) partes.push(EXT_CENTENAS[c]);
    if (resto > 0) {
      if (resto < 10) partes.push(EXT_UNIDADES[resto]);
      else if (resto < 20) partes.push(EXT_10A19[resto - 10]);
      else {
        const d = Math.floor(resto / 10), u = resto % 10;
        partes.push(u > 0 ? `${EXT_DEZENAS[d]} e ${EXT_UNIDADES[u]}` : EXT_DEZENAS[d]);
      }
    }
    return partes.join(" e ");
  }

  function extInteiro(n) {
    if (n === 0) return "zero";
    const partes = [];
    let resto = n;
    for (const escala of EXT_ESCALAS) {
      if (resto >= escala.valor) {
        const qtd = Math.floor(resto / escala.valor);
        resto = resto % escala.valor;
        partes.push(escala.valor === 1000 && qtd === 1 ? "mil" : `${extCentena(qtd)} ${qtd === 1 ? escala.singular : escala.plural}`);
      }
    }
    if (resto > 0) partes.push(extCentena(resto));
    return partes.join(", ");
  }

  function valorPorExtenso(valor) {
    const centavosTotal = Math.round((Number(valor) || 0) * 100);
    const reais = Math.floor(centavosTotal / 100);
    const centavos = centavosTotal % 100;
    let texto = `${extInteiro(reais)} ${reais === 1 ? "real" : "reais"}`;
    if (centavos > 0) texto += ` e ${extInteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
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
  const CLIENTE_CAMPOS = ["nome", "nascimento", "rg", "cpf", "passaporte", "venc_passaporte", "email", "telefone", "endereco"];
  const CLIENTE_LABELS = {
    nome: "Nome completo", nascimento: "Nascimento", rg: "RG", cpf: "CPF",
    passaporte: "Passaporte", venc_passaporte: "Venc. passaporte", email: "E-mail", telefone: "Telefone",
    endereco: "Endereço",
  };

  const PROD_TIPOS = [
    { tipo: "passagem",   label: "Passagem aérea",     icon: "✈️" },
    { tipo: "hospedagem", label: "Hospedagem",         icon: "🏨" },
    { tipo: "seguro",     label: "Seguro viagem",      icon: "🛡️" },
    { tipo: "carro",      label: "Aluguel de carro",   icon: "🚗" },
    { tipo: "passeio",    label: "Passeio / Ingresso", icon: "🗺️" },
    { tipo: "transfer",   label: "Transfer",           icon: "🚌" },
    { tipo: "mala",       label: "Adicional de mala",  icon: "🧳" },
    { tipo: "assento",    label: "Assento",            icon: "💺" },
    { tipo: "consultoria_milhas", label: "Consultoria de milhas", icon: "🧭" },
    { tipo: "visto_americano",    label: "Visto americano",       icon: "🛂" },
    { tipo: "venda_milhas",       label: "Venda de milhas",       icon: "💱" },
  ];
  const PROD_LABEL = Object.fromEntries(PROD_TIPOS.map((p) => [p.tipo, p.label]));
  const PROD_ICON  = Object.fromEntries(PROD_TIPOS.map((p) => [p.tipo, p.icon]));

  const DADOS_CFG = {
    passagem: [
      { id: "perna", label: "Perna da viagem", type: "select", options: ["Ida", "Volta", "Não se aplica"] },
      { id: "trecho", label: "Trecho", placeholder: "Ex: FOR → LIS" },
      { id: "localizador", label: "Localizador / código" },
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
    assento: [
      { id: "trecho", label: "Trecho / voo relacionado", placeholder: "Ex: FOR → LIS" },
      { id: "assento", label: "Assento", placeholder: "Ex: 14A - janela" },
    ],
    consultoria_milhas: [
      { id: "descricao", label: "Descrição da consultoria", placeholder: "Ex: Consultoria para emissão com milhas Smiles" },
    ],
    visto_americano: [
      { id: "tipo_visto", label: "Tipo de visto", placeholder: "Ex: B1/B2" },
      { id: "data_entrevista", label: "Data da entrevista", type: "date" },
    ],
    venda_milhas: [
      { id: "programa", label: "Programa de milhagem", placeholder: "Ex: Latam Pass, Smiles, Azul" },
      { id: "quantidade", label: "Quantidade de milhas vendidas", type: "number" },
    ],
  };

  const FORMAS_PAGAMENTO = [
    { v: "pix", l: "Pix" }, { v: "sumup", l: "Sumup" }, { v: "valepay", l: "Valepay" }, { v: "faturado", l: "Faturado (cobrar depois)" },
  ];
  const ORIGENS_LEAD = ["Shalom", "Orgânico", "Corporativo", "Convenção", "Indicação", "Outro"];

  // ===== Estado =====
  let clientesCache = [];
  let fornecedoresCache = [];
  let vendedoresCache = []; // [{ id, nome }] — mesma lista das Metas em Vendas, pro nome bater certinho
  let passageiros = [];              // [{ id, cliente_id: string|null, nome }]
  let produtos = [];                 // [{ id, tipo }]
  const paxSelecionados = {};        // produtoId -> Set(paxId) — sobrevive a re-render das checkboxes
  const funcSelecionadas = {};       // produtoId -> Set(nomeVendedora) — sobrevive a re-render das checkboxes
  let emissoesSalvas = null;
  let filtroListaEmi = "data"; // "data" (padrão, lista cronológica como na planilha) ou "viagem" (agrupado)
  let emissaoEmEdicaoId = null; // id da emissão sendo editada, ou null se for um cadastro novo

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

  async function carregarVendedores() {
    try {
      const resp = await fetch("/.netlify/functions/vendas-config");
      const cfg = resp.ok ? await resp.json() : null;
      vendedoresCache = (cfg && Array.isArray(cfg.funcs)) ? cfg.funcs : [];
    } catch { vendedoresCache = []; }
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

    // Preserva o que já foi digitado nos cards existentes — sem isso, adicionar/remover
    // um passageiro reconstrói o HTML inteiro e apaga os dados dos outros já preenchidos.
    const salvos = {};
    wrap.querySelectorAll("input,select,textarea").forEach((e) => { if (e.id) salvos[e.id] = e.value; });

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

    Object.entries(salvos).forEach(([id, val]) => { const el = gel(id); if (el) el.value = val; });

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
            content: `Extraia os dados do passageiro abaixo e retorne SOMENTE um JSON válido, sem texto adicional:\n\n${texto}\n\n{"nome":"","nascimento":"","rg":"","cpf":"","passaporte":"","venc_passaporte":"","email":"","telefone":"","endereco":""}`,
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
    funcSelecionadas[id] = new Set();
    renderProdutos();

    // Valor padrão esperto pra "Perna da viagem": 1º card de passagem = Ida, os
    // seguintes = Volta — ela pode trocar manualmente se não for esse o caso
    // (ex: 3ª perna de uma viagem multi-destino).
    if (tipo === "passagem") {
      const qtdPassagens = produtos.filter((p) => p.tipo === "passagem").length;
      const pernaEl = gel(`emi-prod-${id}-dados-perna`);
      if (pernaEl) pernaEl.value = qtdPassagens === 1 ? "Ida" : "Volta";
    }
  }

  function removeProduto(id) {
    produtos = produtos.filter((p) => p.id !== id);
    delete paxSelecionados[id];
    delete funcSelecionadas[id];
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

  // Lista das mesmas vendedoras cadastradas em Vendas → Metas — evita nome digitado
  // diferente do nome usado no cálculo de comissão/meta (ex: "Thaynara" vs "Thay").
  function renderProdutoFuncChecks(prodId) {
    const box = gel(`emi-prod-${prodId}-func-checks`);
    if (!box) return;
    const selecionadas = funcSelecionadas[prodId] || new Set();
    if (vendedoresCache.length === 0) {
      box.innerHTML = '<span class="table__muted">Nenhuma vendedora cadastrada ainda — cadastre em Vendas → Metas</span>';
      return;
    }
    box.innerHTML = vendedoresCache.map((f, i) => `
      <label style="display:inline-flex;align-items:center;gap:5px;margin:0 14px 6px 0;font-size:0.85rem">
        <input type="checkbox" id="emi-prod-${prodId}-func-${i}" ${selecionadas.has(f.nome) ? "checked" : ""} />
        ${escHtml(f.nome)}
      </label>`).join("");
    vendedoresCache.forEach((f, i) => {
      const cb = gel(`emi-prod-${prodId}-func-${i}`);
      if (!cb) return;
      cb.addEventListener("change", () => {
        if (!funcSelecionadas[prodId]) funcSelecionadas[prodId] = new Set();
        if (cb.checked) funcSelecionadas[prodId].add(f.nome); else funcSelecionadas[prodId].delete(f.nome);
      });
    });
  }

  function renderProdutos() {
    const wrap = gel("emi-produtos-list");
    if (!wrap) return;

    // Preserva o que já foi digitado nos cards existentes — sem isso, adicionar/remover
    // um produto reconstrói o HTML inteiro e apaga os dados dos outros já preenchidos
    // (foi o que aconteceu com o "trecho da volta": ao adicionar o 2º card de passagem,
    // o 1º perdia os dados).
    const salvos = {};
    wrap.querySelectorAll("input,select,textarea").forEach((e) => { if (e.id) salvos[e.id] = e.value; });

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
            <div class="orc-foto-hint">📎 Cole aqui (Ctrl+V) ou arraste um print/arquivo da passagem/reserva pra IA ler os dados</div>
            <input type="file" id="emi-prod-${prod.id}-arquivo-input" accept="image/*,.pdf" hidden />
          </div>
          <div style="display:flex;justify-content:center;margin:6px 0 10px">
            <button type="button" id="emi-prod-${prod.id}-btn-arquivo" class="btn btn--ghost" style="font-size:0.78rem">📎 Selecionar arquivo (imagem ou PDF)</button>
          </div>` : ""}
          ${prod.tipo === "hospedagem" ? `<div class="orc-foto-zone" id="emi-prod-${prod.id}-fotozone" tabindex="0">
            <div class="orc-foto-hint">📎 Cole aqui (Ctrl+V) ou arraste um print/arquivo da reserva do hotel pra IA ler os dados</div>
            <input type="file" id="emi-prod-${prod.id}-arquivo-input" accept="image/*,.pdf" hidden />
          </div>
          <div style="display:flex;justify-content:center;margin:6px 0 10px">
            <button type="button" id="emi-prod-${prod.id}-btn-arquivo" class="btn btn--ghost" style="font-size:0.78rem">📎 Selecionar arquivo (imagem ou PDF)</button>
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
              <label class="field"><span class="field__label">Fornecedor (milheiro / site / operadora) ★</span>
                <select class="input emi-sel-fornecedor" id="emi-prod-${prod.id}-fornecedor">${montarOptionsFornecedor(null)}</select>
              </label>
              <label class="field orc-field--highlight"><span class="field__label">Valor TOTAL da linha — some todos os passageiros marcados acima (R$) ★</span>
                <input type="number" class="input" id="emi-prod-${prod.id}-valor_venda" step="0.01" placeholder="Ex: 3000,00 — não é por pessoa" />
              </label>
              <label class="field"><span class="field__label">Forma de pagamento</span>
                <select class="input" id="emi-prod-${prod.id}-forma_pagamento">
                  ${FORMAS_PAGAMENTO.map((f) => `<option value="${f.v}">${f.l}</option>`).join("")}
                </select>
              </label>
              <label class="field" id="emi-prod-${prod.id}-wrap-faturamento" hidden><span class="field__label">Cobrar em (data)</span>
                <input type="date" class="input" id="emi-prod-${prod.id}-data_faturamento" />
              </label>
              ${isPassagem ? `<label class="field"><span class="field__label">Origem do lead</span>
                <select class="input" id="emi-prod-${prod.id}-origem_lead">
                  <option value="">—</option>
                  ${ORIGENS_LEAD.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}
                </select>
              </label>` : ""}
            </div>

            <div class="orc-extras-label" style="margin-top:10px">Funcionária responsável</div>
            <div id="emi-prod-${prod.id}-func-checks"></div>
          </div>
        </div>
      </div>`;
    }).join("");

    // Restaura os valores antes de religar os listeners abaixo, pra os toggles (milhas x
    // tarifado, forma de pagamento faturada) partirem já do valor certo.
    Object.entries(salvos).forEach(([id, val]) => { const el = gel(id); if (el) el.value = val; });

    produtos.forEach((prod) => {
      renderProdutoPaxChecks(prod.id);
      renderProdutoFuncChecks(prod.id);

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
        const arquivoInput = gel(`emi-prod-${prod.id}-arquivo-input`);
        const btnArquivo = gel(`emi-prod-${prod.id}-btn-arquivo`);
        if (zone) {
          const carregarArquivo = (file) => {
            if (!file) return;
            const r = new FileReader();
            r.onload = (ev) => analisarDocumento(prod.id, prod.tipo, ev.target.result, zone);
            r.readAsDataURL(file);
          };

          zone.addEventListener("paste", (e) => {
            for (const item of (e.clipboardData?.items || [])) {
              if (item.type.startsWith("image/")) { carregarArquivo(item.getAsFile()); break; }
            }
          });
          zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
          zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
          zone.addEventListener("drop", (e) => {
            e.preventDefault(); zone.classList.remove("dragover");
            carregarArquivo(e.dataTransfer?.files?.[0]);
          });

          if (btnArquivo && arquivoInput) {
            btnArquivo.addEventListener("click", () => arquivoInput.click());
            arquivoInput.addEventListener("change", () => carregarArquivo(arquivoInput.files?.[0]));
          }
        }
      }
    });
  }

  // ===== Leitura de print por IA (passagem / hospedagem) =====
  function preencherCamposPassagem(prodId, ex) {
    const fill = (campo, val) => { const el = gel(`emi-prod-${prodId}-dados-${campo}`); if (el && val != null && val !== "") el.value = val; };
    fill("trecho", ex.trecho); fill("localizador", ex.localizador); fill("companhia", ex.companhia); fill("voo", ex.voo);
    fill("horario_partida", ex.horario_partida); fill("horario_chegada", ex.horario_chegada);
    fill("conexoes", ex.conexoes); fill("taxa_embarque", ex.taxa_embarque);
    if (ex.milhas != null) { const el = gel(`emi-prod-${prodId}-qtd_milhas`); if (el) el.value = ex.milhas; }
  }

  async function analisarDocumento(prodId, tipo, imageSrc, zone) {
    const match = imageSrc.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    const [, mime, b64] = match;
    const hintEl = zone.querySelector(".orc-foto-hint");
    if (hintEl) hintEl.textContent = "⏳ Analisando...";

    const prompt = tipo === "passagem"
      ? `${contextoDataAtual()}\n\nAnalise este print de passagem/reserva aérea. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO",\n  "localizador": "código/localizador da reserva, ou null",\n  "companhia": "nome da companhia aérea",\n  "voo": "número do voo",\n  "horario_partida": "HH:MM",\n  "horario_chegada": "HH:MM ou HH:MM (+1)",\n  "conexoes": "Voo direto OU ex: 1 escala em GRU",\n  "milhas": número_inteiro_ou_null,\n  "taxa_embarque": valor_numerico_em_reais_ou_null,\n  "volta": {\n    "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO (invertido em relação à ida)",\n    "localizador": "...", "companhia": "...", "voo": "...",\n    "horario_partida": "HH:MM", "horario_chegada": "HH:MM ou HH:MM (+1)",\n    "conexoes": "...", "milhas": número_inteiro_ou_null, "taxa_embarque": valor_numerico_em_reais_ou_null\n  } OU null — preencha "volta" SOMENTE se este mesmo print mostrar claramente os dois trechos (ida E volta) de uma reserva de ida e volta. Se mostrar só um trecho, "volta" deve ser null.\n}`
      : `${contextoDataAtual()}\n\nAnalise este print de reserva/confirmação de hotel ou pousada. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "hotel": "nome do hotel/pousada",\n  "regime": "uma destas opções, exatamente como escrito: ${DADOS_CFG.hospedagem[1].options.map((o) => `\"${o}\"`).join(", ")} — ou null se não estiver claro",\n  "checkin": "AAAA-MM-DD ou null",\n  "checkout": "AAAA-MM-DD ou null",\n  "custo": valor_numerico_total_em_reais_ou_null\n}`;

    const content = mime === "application/pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: prompt }]
      : [{ type: "image", source: { type: "base64", media_type: mime || "image/png", data: b64 } }, { type: "text", text: prompt }];

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [{ role: "user", content }],
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }
      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");
      const ex = JSON.parse(jsonStr);

      if (tipo === "passagem") {
        preencherCamposPassagem(prodId, ex);

        // Print único mostrando ida e volta juntas (reserva round-trip): garante um
        // segundo card de passagem pra volta e preenche com os dados extraídos — sem
        // isso a funcionária precisava colar o mesmo print de novo manualmente.
        if (ex.volta && typeof ex.volta === "object") {
          addProduto("passagem");
          const voltaId = produtos[produtos.length - 1].id;
          preencherCamposPassagem(voltaId, ex.volta);
        }
      } else {
        const fill = (campo, val) => { const el = gel(`emi-prod-${prodId}-dados-${campo}`); if (el && val != null && val !== "") el.value = val; };
        fill("hotel", ex.hotel);
        if (ex.regime && DADOS_CFG.hospedagem[1].options.includes(ex.regime)) fill("regime", ex.regime);
        fill("checkin", ex.checkin); fill("checkout", ex.checkout);
        if (ex.custo != null) { const el = gel(`emi-prod-${prodId}-custo`); if (el) el.value = ex.custo; }
      }
      // Reconsulta a zona/hint pelo id — se detectou volta, addProduto() re-renderizou a
      // lista e o "zone"/"hintEl" capturados no início não existem mais no DOM.
      const hintAtual = gel(`emi-prod-${prodId}-fotozone`)?.querySelector(".orc-foto-hint");
      if (hintAtual) hintAtual.textContent = "✓ Dados extraídos! Cole outro print pra tentar de novo.";
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
        funcionaria: [...(funcSelecionadas[prod.id] || [])].join("/"),
        origem_lead: prod.tipo === "passagem" ? gel(`emi-prod-${prod.id}-origem_lead`).value : null,
      };
    });

    return { emissao, passageiros: passageirosPayload, produtos: produtosPayload };
  }

  function limparFormulario() {
    passageiros = []; produtos = [];
    Object.keys(paxSelecionados).forEach((k) => delete paxSelecionados[k]);
    Object.keys(funcSelecionadas).forEach((k) => delete funcSelecionadas[k]);
    ["emi-destino", "emi-data-ida", "emi-data-volta", "emi-tipo-viagem", "emi-obs-gerais"].forEach((id) => { const el = gel(id); if (el) el.value = ""; });
    renderPassageiros(); renderProdutos();
  }

  async function salvarEmissao() {
    const payload = coletarPayload();
    if (payload.passageiros.length === 0) { alert("Adicione ao menos um passageiro."); return; }
    if (payload.produtos.length === 0) { alert("Adicione ao menos um produto."); return; }
    for (const p of payload.produtos) {
      if (!p.valor_venda) { alert("Informe o valor cobrado do cliente em todos os produtos."); return; }
      if (!p.fornecedor_id) { alert("Selecione o fornecedor em todos os produtos."); return; }
    }

    const editando = !!emissaoEmEdicaoId;
    const btn = gel("emi-salvar-btn");
    btn.disabled = true; btn.textContent = editando ? "⏳ Salvando edição..." : "⏳ Salvando...";
    gel("emi-status").innerHTML = "";
    try {
      const resultadoSalvar = editando
        ? await chamarEmissoes("editar_emissao", { id: emissaoEmEdicaoId, ...payload })
        : await chamarEmissoes("criar_emissao", payload);

      // Nomes dos passageiros pro comprovante — montado antes de limpar o formulário,
      // porque passageiros novos só têm o nome no input, não no array de estado.
      const nomesPorIndice = passageiros.map((p, i) =>
        p.cliente_id ? p.nome : ((payload.passageiros[i].dados_novos && payload.passageiros[i].dados_novos.nome) || "Passageiro"));
      const produtosInfo = payload.produtos.map((p) => ({
        tipo: p.tipo,
        dados: p.dados,
        valor_venda: p.valor_venda,
        forma_pagamento: p.forma_pagamento,
        nomesPax: p.passageiro_indices.map((i) => nomesPorIndice[i]).filter(Boolean).join(", "),
      }));

      // Dados do 1º passageiro — vira o contratante se ela decidir mandar um contrato
      // pra assinatura em seguida (montarOptionsFornecedor/mostrarComprovante ficam com
      // isso guardado em comprovanteAtual pro botão "Enviar contrato").
      const primeiroPax = payload.passageiros[0];
      const contratanteInfo = primeiroPax.cliente_id
        ? (() => { const c = clientesCache.find((x) => x.id === primeiroPax.cliente_id) || {}; return { nome: c.nome || nomesPorIndice[0], cpf: c.cpf || "", telefone: c.telefone || "", email: c.email || "", endereco: c.endereco || "" }; })()
        : (() => { const d = primeiroPax.dados_novos || {}; return { nome: d.nome || nomesPorIndice[0], cpf: d.cpf || "", telefone: d.telefone || "", email: d.email || "", endereco: d.endereco || "" }; })();

      emissaoEmEdicaoId = null;
      gel("emi-editando-aviso").hidden = true;
      limparFormulario();
      await carregarClientes();
      await carregarListaEmissoes();
      renderListaEmissoes();

      if (resultadoSalvar && resultadoSalvar.aviso) alert("⚠ " + resultadoSalvar.aviso);

      mostrarComprovante(payload.emissao, nomesPorIndice, produtosInfo, contratanteInfo);
    } catch (err) {
      gel("emi-status").innerHTML = `<div class="ctr-status-msg ctr-status-msg--erro">Erro ao salvar: ${escHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = "💾 Salvar emissão";
    }
  }

  // ===== Editar emissão existente =====
  // Recarrega os dados de uma emissão já salva de volta no formulário de Nova Emissão pra
  // corrigir algo cadastrado errado. Ao salvar, editar_emissao recria tudo do zero (mesma
  // lógica do cadastro normal) e só depois apaga a versão antiga.
  function editarEmissao(id) {
    const e = (emissoesSalvas || []).find((x) => x.id === id);
    if (!e) return;

    emissaoEmEdicaoId = id;

    gel("emi-destino").value = e.destino || "";
    gel("emi-data-ida").value = e.data_ida || "";
    gel("emi-data-volta").value = e.data_volta || "";
    gel("emi-tipo-viagem").value = e.tipo_viagem || "";
    gel("emi-obs-gerais").value = e.observacoes_gerais || "";

    const paxOriginais = e.venda_emissoes_passageiros || [];
    passageiros = paxOriginais.map((pax) => ({ id: novoId("pax"), cliente_id: pax.cliente_id, nome: paxNome(pax) }));
    const mapaOriginalParaNovo = new Map();
    paxOriginais.forEach((pax, i) => mapaOriginalParaNovo.set(pax.id, passageiros[i].id));

    Object.keys(paxSelecionados).forEach((k) => delete paxSelecionados[k]);
    Object.keys(funcSelecionadas).forEach((k) => delete funcSelecionadas[k]);
    const prodsOriginais = e.venda_emissoes_produtos || [];
    produtos = prodsOriginais.map((p) => ({ id: novoId("prod"), tipo: p.tipo }));

    renderPassageiros();
    paxOriginais.forEach((pax, i) => {
      const novoPaxId = passageiros[i].id;
      const mala = gel(`emi-pax-${novoPaxId}-mala`); if (mala) mala.value = pax.tamanho_mala || "";
      const obs = gel(`emi-pax-${novoPaxId}-obs`); if (obs) obs.value = pax.observacoes || "";
    });

    renderProdutos();
    prodsOriginais.forEach((p, i) => {
      const novoProdId = produtos[i].id;
      paxSelecionados[novoProdId] = new Set((p.passageiro_ids || []).map((pid) => mapaOriginalParaNovo.get(pid)).filter(Boolean));
      renderProdutoPaxChecks(novoProdId);

      (DADOS_CFG[p.tipo] || []).forEach((f) => {
        const el = gel(`emi-prod-${novoProdId}-dados-${f.id}`);
        if (el && p.dados && p.dados[f.id] != null) el.value = p.dados[f.id];
      });

      const fornecedorEl = gel(`emi-prod-${novoProdId}-fornecedor`);
      if (fornecedorEl) fornecedorEl.value = p.fornecedor_id || "";

      const compraTipoEl = gel(`emi-prod-${novoProdId}-compra_tipo`);
      if (compraTipoEl) {
        compraTipoEl.value = (p.valor_milha != null && p.qtd_milhas != null) ? "milhas" : "tarifado";
        compraTipoEl.dispatchEvent(new Event("change"));
      }
      const valorMilhaEl = gel(`emi-prod-${novoProdId}-valor_milha`); if (valorMilhaEl && p.valor_milha != null) valorMilhaEl.value = p.valor_milha;
      const qtdMilhasEl = gel(`emi-prod-${novoProdId}-qtd_milhas`); if (qtdMilhasEl && p.qtd_milhas != null) qtdMilhasEl.value = p.qtd_milhas;
      const custoEl = gel(`emi-prod-${novoProdId}-custo`); if (custoEl && p.custo != null) custoEl.value = p.custo;

      const valorVendaEl = gel(`emi-prod-${novoProdId}-valor_venda`); if (valorVendaEl) valorVendaEl.value = p.valor_venda;

      const formaPagEl = gel(`emi-prod-${novoProdId}-forma_pagamento`);
      if (formaPagEl) { formaPagEl.value = p.forma_pagamento; formaPagEl.dispatchEvent(new Event("change")); }
      const dataFatEl = gel(`emi-prod-${novoProdId}-data_faturamento`); if (dataFatEl && p.data_faturamento) dataFatEl.value = p.data_faturamento;

      funcSelecionadas[novoProdId] = new Set((p.funcionaria || "").split("/").map((n) => n.trim()).filter(Boolean));
      renderProdutoFuncChecks(novoProdId);
      const origemEl = gel(`emi-prod-${novoProdId}-origem_lead`); if (origemEl && p.origem_lead) origemEl.value = p.origem_lead;
    });

    gel("emi-editando-aviso").hidden = false;
    gel("emi-status").innerHTML = "";
    gel("emi-form-wrap").hidden = false;
    gel("emi-comprovante-wrap").hidden = true;

    document.querySelector('[data-tab="nova-emissao"]')?.click();
    window.scrollTo(0, 0);
  }

  function cancelarEdicao() {
    emissaoEmEdicaoId = null;
    limparFormulario();
    gel("emi-editando-aviso").hidden = true;
    gel("emi-status").innerHTML = "";
  }

  // ===== Comprovante de emissão (documento pro cliente) =====
  // Reaproveita o mesmo estilo visual do antigo "Confirmação de Emissão" (classes
  // orc-prev-* / conf-*), que foi aposentado: a Nova Emissão já cobre esse papel agora.
  let comprovanteAtual = null; // { emissaoInfo, nomesPax, produtosInfo } — pro botão de PDF/copiar do preview pós-salvar

  // O campo "Trecho" é digitado como um texto só (ex: "GRU → REC") — separa em
  // origem/destino pra montar as duas caixas de aeroporto do card de voo.
  function parseTrecho(trecho) {
    const raw = String(trecho || "");
    let partes = raw.split("→").map((s) => s.trim()).filter(Boolean);
    if (partes.length < 2) partes = raw.split(/->|-/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 2) return { origem: partes[0], destino: partes[partes.length - 1] };
    return { origem: raw || "—", destino: "" };
  }

  // Card de voo no estilo antigo (confirmacao.js): caixas de aeroporto com linha
  // tracejada + avião no meio, e o localizador em destaque numa caixa própria — porque é
  // a informação mais importante do comprovante.
  function cardPassagemComprovante(dados, valorVenda) {
    const d = dados || {};
    const { origem, destino } = parseTrecho(d.trecho);
    return `
      <div class="orc-prev-flight-card">
        <div class="orc-prev-flight-card-header">
          <span class="orc-prev-flight-label">✈️ ${d.perna && d.perna !== "Não se aplica" ? escHtml(d.perna.toUpperCase()) : "PASSAGEM AÉREA"}</span>
          <span class="orc-prev-flight-card-voo">${fBRL(valorVenda)}</span>
        </div>
        ${d.localizador ? `<div class="conf-localizador" style="margin:16px 20px 0"><span class="conf-loc-label">Localizador / código</span><span class="conf-loc-valor">${escHtml(d.localizador)}</span></div>` : ""}
        <div class="orc-prev-flight-card-body">
          <div class="orc-prev-airport">
            <div class="orc-prev-iata">${escHtml(origem || "—")}</div>
            ${d.horario_partida ? `<div class="orc-prev-time">${escHtml(d.horario_partida)}</div>` : ""}
          </div>
          <div class="orc-prev-flight-middle">
            <div class="orc-prev-dash-line">
              <span class="orc-prev-dash-seg"></span>
              <span class="orc-prev-plane-icon">✈</span>
              <span class="orc-prev-dash-seg"></span>
            </div>
            <div class="orc-prev-direto">${escHtml(d.conexoes || "Voo direto")}</div>
          </div>
          <div class="orc-prev-airport orc-prev-airport--right">
            <div class="orc-prev-iata">${escHtml(destino || "—")}</div>
            ${d.horario_chegada ? `<div class="orc-prev-time">${escHtml(d.horario_chegada)}</div>` : ""}
          </div>
        </div>
        ${d.companhia || d.voo ? `<div style="padding:0 20px 18px;margin-top:-8px;font-size:0.82rem;color:var(--navy-light)">${escHtml([d.companhia, d.voo].filter(Boolean).join(" · "))}</div>` : ""}
      </div>`;
  }

  function linhaProdutoComprovante(tipo, dados, valorVenda, nomesPax) {
    if (tipo === "passagem") return cardPassagemComprovante(dados, valorVenda);
    const detalhes = (DADOS_CFG[tipo] || [])
      .filter((f) => dados && dados[f.id])
      .map((f) => `<div class="conf-obs-item"><span class="conf-obs-icon">•</span><span>${escHtml(f.label)}: <strong>${escHtml(dados[f.id])}</strong></span></div>`)
      .join("");
    return `
      <div class="orc-prev-flight-card">
        <div class="orc-prev-flight-card-header">
          <span class="orc-prev-flight-label">${PROD_ICON[tipo] || "📦"} ${escHtml((PROD_LABEL[tipo] || tipo).toUpperCase())}</span>
          <span class="orc-prev-flight-card-voo">${fBRL(valorVenda)}</span>
        </div>
        <div style="padding:12px 16px;font-size:0.85rem;color:var(--navy-light)">
          ${nomesPax ? `<div style="margin-bottom:6px"><strong>Passageiro(s):</strong> ${escHtml(nomesPax)}</div>` : ""}
          ${detalhes || '<div class="table__muted">Sem detalhes adicionais</div>'}
        </div>
      </div>`;
  }

  function montarComprovanteHtml(emissaoInfo, nomesPax, produtosInfo) {
    const agora = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const dataIda = fData(emissaoInfo.data_ida);
    const dataVolta = emissaoInfo.data_volta ? fData(emissaoInfo.data_volta) : "";
    const total = produtosInfo.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);

    const paxHtml = nomesPax.map((n) => `<div class="conf-pax-row">👤 ${escHtml(n)}</div>`).join("");
    const produtosHtml = produtosInfo.map((p) => linhaProdutoComprovante(p.tipo, p.dados, p.valor_venda, p.nomesPax)).join("");

    return `
      <div class="orc-prev-wrap conf-prev-wrap">
        <div class="orc-prev-header">
          <img src="Lolek_logotipo_3.png" class="orc-prev-logo-img" alt="Lolek Viagens">
          <div class="orc-prev-contatos">
            <strong>Lolek Viagens</strong><br>
            CNPJ 54.795.384/0001-05<br>
            thaynara@agencialolekviagens.com.br<br>
            (85) 99632-7092<br>
            Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE
          </div>
        </div>
        <div class="orc-prev-divider"></div>

        <div class="orc-prev-titulo">COMPROVANTE DE EMISSÃO</div>
        <div class="conf-emitido-em">Emitido em ${agora}</div>

        ${emissaoInfo.destino ? `<div class="conf-section-title">Viagem</div><div class="conf-pax-row">📍 ${escHtml(emissaoInfo.destino)}${dataIda !== "—" ? " — " + dataIda + (dataVolta ? " a " + dataVolta : "") : ""}</div>` : ""}

        ${nomesPax.length ? `<div class="conf-section-title">Passageiro${nomesPax.length !== 1 ? "s" : ""}</div>${paxHtml}` : ""}

        <div class="conf-section-title">Itens</div>
        ${produtosHtml}

        <div class="conf-valor-row"><span>Valor total</span><span class="conf-valor">${fBRL(total)}</span></div>

        <div class="conf-obs-section">
          <div class="conf-obs-title">Informações importantes</div>
          <ul class="conf-obs-lista">
            <li class="conf-obs-item"><span class="conf-obs-icon">📞</span><span>Em caso de dúvidas ou alterações, entre em contato com a Lolek Viagens pelo <strong>(85) 99632-7092</strong> ou <strong>thaynara@agencialolekviagens.com.br</strong>.</span></li>
          </ul>
        </div>

        <div class="orc-prev-footer">
          Este documento é um comprovante de emissão emitido pela Lolek Viagens como intermediária junto às operadoras e companhias contratadas. As condições de transporte e hospedagem são regidas pelas respectivas prestadoras de serviço.
        </div>
      </div>`;
  }

  // Abre uma aba limpa só com o comprovante e dispara a impressão (mesmo truque do
  // antigo confirmacao.js) — usuária escolhe "Salvar como PDF" na caixa de impressão.
  function abrirComprovantePDF(html) {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("Permita pop-ups para salvar o PDF."); return; }
    const baseUrl = location.href.replace(/\/[^/]*$/, "/");
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Comprovante de Emissão — Lolek Viagens</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${baseUrl}style.css">
  <style>
    body { margin: 0; padding: 20px; background: #fff; font-family: var(--font-body, Montserrat, sans-serif); }
    .orc-prev-wrap { box-shadow: none; border: 1px solid #e3e6ec; max-width: 800px; margin: 0 auto; }
    @media print {
      body { padding: 0; }
      .orc-prev-wrap { border: none; max-width: 100%; }
    }
  </style>
</head>
<body>
  ${html}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 600);
    };
  <\/script>
</body>
</html>`);
    win.document.close();
  }

  function copiarComprovanteTexto(emissaoInfo, nomesPax, produtosInfo) {
    let txt = "COMPROVANTE DE EMISSÃO — LOLEK VIAGENS\nCNPJ: 54.795.384/0001-05\nthaynara@agencialolekviagens.com.br | (85) 99632-7092\n\n";
    if (emissaoInfo.destino) txt += `Viagem: ${emissaoInfo.destino} — ${fData(emissaoInfo.data_ida)}${emissaoInfo.data_volta ? " a " + fData(emissaoInfo.data_volta) : ""}\n`;
    if (nomesPax.length) txt += `Passageiro(s): ${nomesPax.join(", ")}\n\n`;
    produtosInfo.forEach((p) => {
      txt += `[${(PROD_LABEL[p.tipo] || p.tipo).toUpperCase()}] ${fBRL(p.valor_venda)}${p.nomesPax ? " — " + p.nomesPax : ""}\n`;
      (DADOS_CFG[p.tipo] || []).forEach((f) => { if (p.dados && p.dados[f.id]) txt += `  ${f.label}: ${p.dados[f.id]}\n`; });
    });
    const total = produtosInfo.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);
    txt += `\nValor total: ${fBRL(total)}\n`;
    navigator.clipboard.writeText(txt);
  }

  function mostrarComprovante(emissaoInfo, nomesPax, produtosInfo, contratanteInfo) {
    comprovanteAtual = { emissaoInfo, nomesPax, produtosInfo, contratanteInfo };
    gel("emi-comprovante-preview").innerHTML = montarComprovanteHtml(emissaoInfo, nomesPax, produtosInfo);
    gel("emi-form-wrap").hidden = true;
    gel("emi-comprovante-wrap").hidden = false;
    window.scrollTo(0, 0);
  }

  // Botão "📝 Enviar contrato" — leva os dados da emissão recém-salva pra aba Contratos
  // já pré-preenchidos (contratante = 1º passageiro), pra revisar e enviar pro ZapSign.
  // Não faz isso sozinho: ela ainda revisa/ajusta antes de clicar em gerar, porque é um
  // documento assinado — não dá pra confiar 100% no que foi deduzido automaticamente.
  function enviarParaContrato() {
    if (!comprovanteAtual) return;
    const { emissaoInfo, produtosInfo, contratanteInfo } = comprovanteAtual;

    const total = produtosInfo.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);
    const tiposUnicos = [...new Set(produtosInfo.map((p) => PROD_LABEL[p.tipo] || p.tipo))];
    const periodo = emissaoInfo.data_ida
      ? ` (${fData(emissaoInfo.data_ida)}${emissaoInfo.data_volta ? " a " + fData(emissaoInfo.data_volta) : ""})`
      : "";
    const descricao = `Pacote de viagem para ${emissaoInfo.destino || "—"}${periodo}: ${tiposUnicos.join(", ")}.`;

    const formaLabel = (v) => (FORMAS_PAGAMENTO.find((f) => f.v === v) || {}).l || v;
    const formasUnicas = [...new Set(produtosInfo.map((p) => p.forma_pagamento))].filter(Boolean).map(formaLabel);

    gel("ctr-nome_cliente").value = contratanteInfo.nome || "";
    gel("ctr-cpf_cnpj").value = contratanteInfo.cpf || "";
    gel("ctr-telefone_cliente").value = contratanteInfo.telefone || "";
    gel("ctr-email_cliente").value = contratanteInfo.email || "";
    gel("ctr-endereco_cliente").value = contratanteInfo.endereco || "";
    gel("ctr-descricao_servico").value = descricao;
    gel("ctr-valor_total").value = fBRL(total);
    gel("ctr-valor_extenso").value = valorPorExtenso(total);
    gel("ctr-forma_pagamento").value = formasUnicas.join(" / ");
    gel("ctr-prazo_entrega").value = "Imediato";
    gel("ctr-status").innerHTML = '<div class="ctr-status-msg ctr-status-msg--warn">Confira os dados abaixo — foram pré-preenchidos a partir da emissão. Ajuste o que precisar antes de gerar e enviar.</div>';

    document.querySelector('[data-tab="contratos"]')?.click();
    window.scrollTo(0, 0);
  }

  // Botão "📄 Comprovante" na listagem — reconstrói o documento de uma emissão já salva
  // (pra baixar de novo se não gerou na hora, ou se outra funcionária precisar depois).
  function baixarComprovanteSalvo(emissaoId, mapaPax) {
    const e = (emissoesSalvas || []).find((x) => x.id === emissaoId);
    if (!e) return;
    const nomesPax = (e.venda_emissoes_passageiros || []).map(paxNome);
    const produtosInfo = (e.venda_emissoes_produtos || []).map((p) => ({
      tipo: p.tipo,
      dados: p.dados,
      valor_venda: p.valor_venda,
      nomesPax: (p.passageiro_ids || []).map((id) => (mapaPax.get(id) || {}).nome).filter(Boolean).join(", "),
    }));
    abrirComprovantePDF(montarComprovanteHtml(e, nomesPax, produtosInfo));
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

  function fornecedorNome(id) {
    if (!id) return "—";
    const f = fornecedoresCache.find((f) => f.id === id);
    return f ? f.nome : "—";
  }

  // Reconstrói o custo total de um produto: usa a coluna custo se preenchida, senão
  // calcula pelo valor do milheiro × qtd. de milhas (caso de compra com milhas).
  function custoProdutoTotal(p) {
    if (p.custo != null) return Number(p.custo);
    if (p.valor_milha != null && p.qtd_milhas != null) return Number(p.valor_milha) * Number(p.qtd_milhas) / 1000;
    return 0;
  }

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

  // Um produto que cobre N passageiros (ex: 1 passagem comprada pra 3 pessoas de uma vez)
  // vira N linhas na listagem — valor/custo/lucro rateados entre elas — porque foram
  // 3 vendas do ponto de vista de quem confere a lista, mesmo sendo 1 reserva só.
  function expandirProdutoEmLinhas(p, e, mapaPax) {
    const ids = (p.passageiro_ids && p.passageiro_ids.length) ? p.passageiro_ids : [null];
    const n = ids.length;
    const custoTotal = custoProdutoTotal(p);
    return ids.map((id) => {
      const info = id ? mapaPax.get(id) : null;
      return {
        produtoId: p.id,
        data_venda: p.data_venda,
        destino: e.destino,
        tipo: p.tipo,
        dados: p.dados,
        dataIdaViagem: e.data_ida,
        dataVoltaViagem: e.data_volta,
        nome: info ? info.nome : "—",
        clienteId: info ? info.clienteId : null,
        valor_venda: (Number(p.valor_venda) || 0) / n,
        custo: custoTotal / n,
        lucro: (Number(p.lucro) || 0) / n,
        qtd_milhas: p.qtd_milhas != null ? Number(p.qtd_milhas) / n : 0,
        fornecedor_id: p.fornecedor_id,
        forma_pagamento: p.forma_pagamento,
        funcionaria: p.funcionaria,
      };
    });
  }

  // Data do PRODUTO/serviço em si (viagem, check-in/out, entrevista de visto...) —
  // diferente da data_venda (quando a venda foi registrada no sistema).
  function dataServicoLinha(l) {
    const d = l.dados || {};
    if (l.tipo === "passagem") {
      const isVolta = d.perna === "Volta";
      const data = isVolta ? l.dataVoltaViagem : l.dataIdaViagem;
      return data ? fData(data) : "—";
    }
    if (l.tipo === "hospedagem") {
      if (!d.checkin && !d.checkout) return "—";
      return `${fData(d.checkin)} – ${fData(d.checkout)}`;
    }
    if (l.tipo === "passeio" && d.data_passeio) return fData(d.data_passeio);
    if (l.tipo === "visto_americano" && d.data_entrevista) return fData(d.data_entrevista);
    return "—";
  }

  function todasLinhasOrdenadas(mapaPax) {
    return (emissoesSalvas || [])
      .flatMap((e) => (e.venda_emissoes_produtos || []).flatMap((p) => expandirProdutoEmLinhas(p, e, mapaPax)))
      .sort((a, b) => (b.data_venda || "").localeCompare(a.data_venda || ""));
  }

  function renderLinhaRow(l) {
    return `
      <tr>
        <td class="table__muted">${fData(l.data_venda)}</td>
        <td>${escHtml(l.nome)}</td>
        <td>${escHtml(l.destino || "—")}</td>
        <td>${PROD_ICON[l.tipo] || "📦"} ${escHtml(PROD_LABEL[l.tipo] || l.tipo)}</td>
        <td class="table__muted">${dataServicoLinha(l)}</td>
        <td class="table__muted">${escHtml(fornecedorNome(l.fornecedor_id))}</td>
        <td class="table__muted">${fBRL(l.custo)}</td>
        <td>${fBRL(l.valor_venda)}</td>
        <td class="table__muted">${fBRL(l.lucro)}</td>
        <td class="table__muted">${escHtml(FORMAS_PAGAMENTO.find((f) => f.v === l.forma_pagamento)?.l || l.forma_pagamento || "—")}</td>
        <td class="table__muted">${escHtml(l.funcionaria || "—")}</td>
        <td><button type="button" class="orc-produto-remove" data-excluir-produto="${l.produtoId}" title="Exclui este produto (todos os passageiros cobertos por ele)">✕</button></td>
      </tr>`;
  }

  function tabelaLinhas(linhas) {
    if (linhas.length === 0) return '<div class="empty-state empty-state--compact"><p>Nada por aqui</p></div>';
    return `<div class="card"><table class="table">
      <thead><tr><th>Data da venda</th><th>Cliente</th><th>Viagem</th><th>Produto</th><th>Data do produto</th><th>Fornecedor</th><th>Custo</th><th>Valor</th><th>Lucro</th><th>Pagamento</th><th>Funcionária</th><th></th></tr></thead>
      <tbody>${linhas.map(renderLinhaRow).join("")}</tbody>
    </table></div>`;
  }

  function somaValor(linhas) { return linhas.reduce((s, l) => s + (Number(l.valor_venda) || 0), 0); }

  function resumoLinhas(linhas) {
    const faturamento = somaValor(linhas);
    const lucro = linhas.reduce((s, l) => s + (Number(l.lucro) || 0), 0);
    const margem = faturamento > 0 ? (lucro / faturamento * 100) : 0;
    const milhas = linhas.reduce((s, l) => s + (Number(l.qtd_milhas) || 0), 0);
    return { count: linhas.length, faturamento, lucro, margem, milhas };
  }

  function renderResumoStats(linhas) {
    const r = resumoLinhas(linhas);
    return `<div class="stats" style="margin:14px 0 0;padding:0 16px 16px">
      <div class="stat"><div class="stat__value">${r.count}</div><div class="stat__label">Produtos</div></div>
      <div class="stat"><div class="stat__value">${fBRL(r.faturamento)}</div><div class="stat__label">Faturamento</div></div>
      <div class="stat stat--gold"><div class="stat__value">${fBRL(r.lucro)}</div><div class="stat__label">Lucro</div></div>
      <div class="stat"><div class="stat__value">${r.margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div><div class="stat__label">Margem</div></div>
      ${r.milhas > 0 ? `<div class="stat"><div class="stat__value">${Math.round(r.milhas).toLocaleString("pt-BR")}</div><div class="stat__label">Milhas</div></div>` : ""}
    </div>`;
  }

  function renderViagemCard(e, mapaPax) {
    const pax = e.venda_emissoes_passageiros || [];
    const linhas = (e.venda_emissoes_produtos || []).flatMap((p) => expandirProdutoEmLinhas(p, e, mapaPax));
    const totalVenda = somaValor(linhas);
    return `
      <div class="emi-viagem-card">
        <div class="emi-viagem-header">
          <strong>${escHtml(e.destino || "Sem destino informado")}</strong>
          <span style="opacity:0.8">${fData(e.data_ida)}${e.data_volta ? " – " + fData(e.data_volta) : ""}</span>
          ${e.tipo_viagem ? `<span class="badge badge--andamento">${escHtml(e.tipo_viagem)}</span>` : ""}
          <div class="emi-viagem-header-actions">
            <button type="button" class="emi-btn-comprovante" data-comprovante-emissao="${e.id}">📄 Comprovante</button>
            <button type="button" class="emi-btn-comprovante" data-editar-emissao="${e.id}">✏ Editar</button>
            <button type="button" class="orc-produto-remove" data-excluir-emissao="${e.id}">✕ Excluir</button>
          </div>
        </div>
        <div class="emi-viagem-body">
          <div class="table__muted" style="margin-bottom:8px">${pax.map((p) => escHtml(paxNome(p))).join(", ") || "—"}</div>
          ${tabelaLinhas(linhas)}
          <div style="text-align:right;margin-top:8px;font-weight:600">Total: ${fBRL(totalVenda)}</div>
        </div>
      </div>`;
  }

  function renderPorData(linhas) {
    const grupos = new Map();
    linhas.forEach((l) => {
      const chave = (l.data_venda || "").slice(0, 7) || "sem-data";
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(l);
    });
    const chavesOrdenadas = [...grupos.keys()].sort((a, b) => b.localeCompare(a));
    return chavesOrdenadas.map((chave) => {
      const itens = grupos.get(chave);
      return `<div class="emi-grupo-wrap">
        <div class="emi-grupo-header">
          <strong>${escHtml(mesLabel(chave))}</strong>
          <span class="emi-grupo-total">${itens.length} produto${itens.length !== 1 ? "s" : ""} · ${fBRL(somaValor(itens))}</span>
        </div>
        ${tabelaLinhas(itens)}
        ${renderResumoStats(itens)}
      </div>`;
    }).join("");
  }

  function renderPorCliente(linhas) {
    const porCliente = new Map(); // clienteId -> { nome, linhas: [] }
    linhas.forEach((l) => {
      if (!l.clienteId) return;
      if (!porCliente.has(l.clienteId)) porCliente.set(l.clienteId, { nome: l.nome, linhas: [] });
      porCliente.get(l.clienteId).linhas.push(l);
    });
    const entradas = [...porCliente.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return entradas.map((c) => `<div class="emi-grupo-wrap">
      <div class="emi-grupo-header">
        <strong>${escHtml(c.nome)}</strong>
        <span class="emi-grupo-total">${c.linhas.length} produto${c.linhas.length !== 1 ? "s" : ""} · ${fBRL(somaValor(c.linhas))}</span>
      </div>
      ${tabelaLinhas(c.linhas)}
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

    const mapaPax = construirMapaPax();

    if (filtroListaEmi === "viagem") {
      count.textContent = emissoesSalvas.length + " viagem" + (emissoesSalvas.length !== 1 ? "ns" : "");
      wrap.innerHTML = emissoesSalvas.map((e) => renderViagemCard(e, mapaPax)).join("");
      wrap.querySelectorAll("[data-excluir-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => excluirEmissao(btn.dataset.excluirEmissao)));
      wrap.querySelectorAll("[data-comprovante-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => baixarComprovanteSalvo(btn.dataset.comprovanteEmissao, mapaPax)));
      wrap.querySelectorAll("[data-editar-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => editarEmissao(btn.dataset.editarEmissao)));
    } else {
      const linhas = todasLinhasOrdenadas(mapaPax);
      if (filtroListaEmi === "cliente") {
        const clientesUnicos = new Set(linhas.map((l) => l.clienteId).filter(Boolean));
        count.textContent = clientesUnicos.size + " cliente" + (clientesUnicos.size !== 1 ? "s" : "");
        wrap.innerHTML = renderPorCliente(linhas);
      } else {
        // Lista mensal (mais recente primeiro), como na planilha antiga.
        count.textContent = linhas.length + " produto" + (linhas.length !== 1 ? "s" : "");
        wrap.innerHTML = renderPorData(linhas);
      }
    }

    wrap.querySelectorAll("[data-excluir-produto]").forEach((btn) =>
      btn.addEventListener("click", () => excluirProduto(btn.dataset.excluirProduto)));
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

  async function excluirProduto(id) {
    if (!confirm("Excluir este produto? Isso também remove o lançamento financeiro gerado por ele.")) return;
    try {
      await chamarEmissoes("excluir_produto", { id });
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
    gel("emi-cancelar-edicao-btn").addEventListener("click", cancelarEdicao);

    gel("emi-comprovante-nova-btn").addEventListener("click", () => {
      gel("emi-comprovante-wrap").hidden = true;
      gel("emi-form-wrap").hidden = false;
      gel("emi-status").innerHTML = "";
    });
    gel("emi-comprovante-pdf-btn").addEventListener("click", () => {
      if (!comprovanteAtual) return;
      abrirComprovantePDF(montarComprovanteHtml(comprovanteAtual.emissaoInfo, comprovanteAtual.nomesPax, comprovanteAtual.produtosInfo));
    });
    gel("emi-comprovante-copy-btn").addEventListener("click", () => {
      if (!comprovanteAtual) return;
      copiarComprovanteTexto(comprovanteAtual.emissaoInfo, comprovanteAtual.nomesPax, comprovanteAtual.produtosInfo);
      const b = gel("emi-comprovante-copy-btn");
      b.textContent = "✓ Copiado!";
      setTimeout(() => { b.textContent = "Copiar texto"; }, 2000);
    });
    gel("emi-comprovante-contrato-btn").addEventListener("click", enviarParaContrato);

    document.querySelectorAll("[data-filtro-emi]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filtroListaEmi = btn.dataset.filtroEmi;
        document.querySelectorAll("[data-filtro-emi]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderListaEmissoes();
      });
    });

    renderPassageiros();
    renderProdutos();

    await Promise.all([carregarClientes(), carregarFornecedores(), carregarVendedores(), carregarListaEmissoes()]);
    renderListaEmissoes();
  }

  init();
})();
