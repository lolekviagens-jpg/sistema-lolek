// ===== Orçamentos — Lolek Viagens =====
(function () {
  "use strict";

  const LOLEK_TEL   = "(85) 99632-7092";
  const LOLEK_EMAIL = "thaynara@agencialolekviagens.com.br";
  const LOLEK_END   = "Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE";

  const LS_MODEL = "lolek_anthropic_model";

  function getModel()    { return localStorage.getItem(LS_MODEL) || "claude-haiku-4-5-20251001"; }

  // Contexto pra IA não "chutar" um ano errado (ex: 2024) quando o print não mostra o ano da data.
  function contextoDataAtual() {
    const hoje = new Date();
    const dd = String(hoje.getDate()).padStart(2, "0");
    const mm = String(hoje.getMonth() + 1).padStart(2, "0");
    const yyyy = hoje.getFullYear();
    return `Hoje é ${dd}/${mm}/${yyyy}. Datas de viagem são sempre no presente ou futuro a partir de hoje — nunca deduza um ano passado. Se o print não mostrar o ano de uma data, infira o mais provável: se o mês da data já passou em relação ao mês atual (${mm}/${yyyy}), o ano certo é ${yyyy + 1}; caso contrário, é ${yyyy}.`;
  }

  const PROD_CFG = {
    passagem: {
      label: "Passagem aérea", icon: "✈️",
      fields: [
        { id: "trecho",          label: "Trecho",               type: "text",   placeholder: "Ex: FOR → LIS",    cols: 2 },
        { id: "companhia",       label: "Companhia aérea",      type: "text",   placeholder: "Ex: LATAM",         cols: 1 },
        { id: "voo",             label: "Nº do voo",            type: "text",   placeholder: "Ex: LA3504",        cols: 1 },
        { id: "horario_partida", label: "Horário de partida",   type: "text",   placeholder: "Ex: 14:30",         cols: 1 },
        { id: "horario_chegada", label: "Horário de chegada",   type: "text",   placeholder: "Ex: 22:15 (+1)",    cols: 1 },
        { id: "conexoes",        label: "Paradas / escalas",    type: "text",   placeholder: "Ex: Voo direto",    cols: 1 },
        { id: "duracao",         label: "Duração total",        type: "text",   placeholder: "Ex: 9h30",          cols: 1 },
        { id: "cidade_orig",     label: "Cidade de origem",     type: "text",   placeholder: "Ex: Fortaleza",     cols: 1 },
        { id: "cidade_dest",     label: "Cidade de destino",    type: "text",   placeholder: "Ex: Lisboa",        cols: 1 },
        { id: "_div",            label: "Valores internos — não aparecem para o cliente", type: "divider", cols: 4 },
        { id: "milhas",          label: "Qtd. milhas",          type: "number", placeholder: "Ex: 60000",         cols: 1 },
        { id: "milheiro",        label: "Valor do milheiro (R$)", type: "number", placeholder: "Ex: 18",          cols: 1, step: "0.01" },
        { id: "markup",          label: "Markup / pax (R$)",    type: "number", placeholder: "Ex: 200",           cols: 1, step: "0.01" },
        { id: "valor_pax",       label: "Passagem / pax (R$) ★", type: "number", placeholder: "Calculado ou manual", cols: 1, step: "0.01" },
        { id: "taxa_embarque",   label: "Taxa de embarque / pax (R$)", type: "number", placeholder: "Ex: 150",   cols: 1, step: "0.01" },
      ],
    },
    hospedagem: {
      label: "Hospedagem", icon: "🏨",
      fields: [
        { id: "hotel",  label: "Hotel / Pousada", type: "text",   placeholder: "Nome do hotel", cols: 2 },
        { id: "regime", label: "Regime",           type: "select", options: ["Sem café","Café incluso","Meia pensão","Pensão completa","All inclusive"], cols: 1 },
        { id: "custo",  label: "Custo (R$)",       type: "number", placeholder: "0", cols: 1, step: "0.01" },
        { id: "markup", label: "Markup (R$)",      type: "number", placeholder: "0", cols: 1, step: "0.01" },
      ],
    },
    seguro: {
      label: "Seguro viagem", icon: "🛡️",
      fields: [
        { id: "seguradora", label: "Seguradora",   type: "text",   placeholder: "Ex: Assist Card", cols: 1 },
        { id: "plano",      label: "Plano",        type: "text",   placeholder: "Ex: Gold",         cols: 1 },
        { id: "cobertura",  label: "Cobertura",    type: "text",   placeholder: "Ex: USD 300.000",  cols: 1 },
        { id: "custo",      label: "Custo (R$)",   type: "number", placeholder: "0", cols: 1, step: "0.01" },
        { id: "markup",     label: "Markup (R$)",  type: "number", placeholder: "0", cols: 1, step: "0.01" },
      ],
    },
    carro: {
      label: "Aluguel de carro", icon: "🚗",
      fields: [
        { id: "locadora",  label: "Locadora",    type: "text",   placeholder: "Ex: Hertz",          cols: 1 },
        { id: "categoria", label: "Categoria",   type: "text",   placeholder: "Ex: SUV automático", cols: 1 },
        { id: "custo",     label: "Custo (R$)",  type: "number", placeholder: "0", cols: 1, step: "0.01" },
        { id: "markup",    label: "Markup (R$)", type: "number", placeholder: "0", cols: 1, step: "0.01" },
      ],
    },
    passeio: {
      label: "Passeio / Ingresso", icon: "🗺️",
      fields: [
        { id: "descricao",    label: "Descrição",   type: "text",   placeholder: "Ex: Ingresso Coliseu", cols: 2 },
        { id: "data_passeio", label: "Data",        type: "date",   placeholder: "",                     cols: 1 },
        { id: "custo",        label: "Custo (R$)",  type: "number", placeholder: "0", cols: 1, step: "0.01" },
        { id: "markup",       label: "Markup (R$)", type: "number", placeholder: "0", cols: 1, step: "0.01" },
      ],
    },
    transfer: {
      label: "Transfer", icon: "🚌",
      fields: [
        { id: "trecho", label: "Trecho",      type: "text",   placeholder: "Ex: Aeroporto → Hotel", cols: 2 },
        { id: "tipo",   label: "Tipo",        type: "select", options: ["Privativo","Compartilhado","Executivo"], cols: 1 },
        { id: "custo",  label: "Custo (R$)",  type: "number", placeholder: "0", cols: 1, step: "0.01" },
        { id: "markup", label: "Markup (R$)", type: "number", placeholder: "0", cols: 1, step: "0.01" },
      ],
    },
  };

  // ===== Estado =====
  let destinos = [], destCounter = 0;
  const fotoStore = {};       // fotos que aparecem para o cliente (preview/PDF)
  const fotoStorePrint = {};  // print de reserva usado só para a IA extrair dados (hospedagem)

  // ===== Elementos =====
  const formWrap     = document.getElementById("orc-form-wrap");
  const outputWrap   = document.getElementById("orc-output-wrap");
  const destinosList = document.getElementById("orc-destinos-list");
  const addDestinoBtn= document.getElementById("orc-add-destino");
  const gerarBtn     = document.getElementById("orc-gerar");
  const editBtn      = document.getElementById("orc-edit-btn");
  const novoBtn      = document.getElementById("orc-novo-btn");
  const pdfBtn       = document.getElementById("orc-pdf-btn");
  const copyBtn      = document.getElementById("orc-copy-btn");

  // ===== Utilitários =====
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function gV(id)  { const e = document.getElementById(id); return e ? e.value.trim() : ""; }
  function gN(id)  { const e = document.getElementById(id); return e ? (parseFloat(e.value) || 0) : 0; }
  function fBRL(v) { return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fData(s){ return s ? new Date(s + "T12:00:00").toLocaleDateString("pt-BR") : "—"; }

  // Converte data extraída pela IA (DD/MM/AAAA ou ISO) para o formato do <input type="date">.
  function paraDataISO(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    return null;
  }

  // Posição (0-based) desta passagem entre as passagens do destino: 0=IDA, 1=VOLTA, etc.
  function passagemIndex(destId, pid) {
    const dest = destinos.find((d) => d.id === destId);
    if (!dest) return 0;
    let idx = 0;
    for (const p of dest.produtos) {
      if (p.tipo !== "passagem") continue;
      if (p.pid === pid) return idx;
      idx++;
    }
    return idx;
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

  // Rótulo de uma linha de passagem: menciona "+ taxa de embarque" só quando ela
  // existe, pra taxa continuar visível pro cliente mesmo já somada ao valor.
  function labelPassagem(base, taxa) {
    return taxa > 0 ? base + " + taxa de embarque" : base;
  }

  // Agrupa os trechos de passagem em linhas de preço (valor + taxa já somados,
  // mas taxa nomeada no rótulo): ida+volta vira uma única linha; com 3+ trechos
  // (itinerário multi-cidade), cada trecho continua em linha própria.
  function agruparPassagens(itens) {
    const passagens = itens.filter((it) => it.tipo === "passagem");
    const outros    = itens.filter((it) => it.tipo !== "passagem");
    const linhas = [];

    if (passagens.length === 2) {
      const totalTaxa = passagens[0].totalTaxa + passagens[1].totalTaxa;
      const valor = passagens[0].totalPassagem + passagens[1].totalPassagem + totalTaxa;
      linhas.push({ label: labelPassagem("Passagem aérea (ida e volta)", totalTaxa), pax: passagens[0].adultos, valor });
    } else {
      passagens.forEach((it) => {
        const base = passagens.length > 1 ? "Passagem aérea — " + it.flightLabel : "Passagem aérea";
        linhas.push({
          label: labelPassagem(base, it.totalTaxa),
          pax: it.adultos,
          valor: it.totalPassagem + it.totalTaxa,
        });
      });
    }

    return { linhas, outros };
  }

  function diffD(a, b) {
    if (!a || !b) return 0;
    return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  }

  // Extrai siglas IATA do campo trecho ("FOR → LIS")
  function parseTrecho(trecho) {
    if (!trecho) return { orig: "", dest: "" };
    const m = trecho.match(/([A-Za-z]{2,3})\s*[→>\-]\s*([A-Za-z]{2,3})/);
    if (m) return { orig: m[1].toUpperCase(), dest: m[2].toUpperCase() };
    const parts = trecho.split(/\s*[→>\-]\s*/);
    return {
      orig: (parts[0] || "").trim().toUpperCase().substring(0, 3),
      dest: (parts[1] || "").trim().toUpperCase().substring(0, 3),
    };
  }

  // ===== Cálculo milhas =====
  // valor_pax = (milhas / 1000) × milheiro + markup
  // taxa_embarque é separada e não entra nesse cálculo
  function bindMilhasCalc(destId, pid) {
    const ids = ["milhas", "milheiro", "markup"].map((f) => `${destId}-${pid}-${f}`);
    const valorEl = document.getElementById(`${destId}-${pid}-valor_pax`);
    function calc() {
      const m  = gN(ids[0]);
      const v  = gN(ids[1]);
      const mk = gN(ids[2]);
      if (m > 0 && v > 0 && valorEl) valorEl.value = ((m / 1000) * v + mk).toFixed(2);
    }
    ids.forEach((id) => document.getElementById(id)?.addEventListener("input", calc));
  }

  // ===== Destinos =====
  function addDestino() {
    destCounter++;
    destinos.push({ id: "dest-" + destCounter, produtos: [] });
    renderDestinos();
    setTimeout(() => document.getElementById("o-nome-dest-" + destCounter)?.focus(), 50);
  }

  function removeDestino(id) {
    destinos = destinos.filter((d) => d.id !== id);
    renderDestinos();
  }

  // Zera o formulário inteiro pra montar um novo orçamento sem precisar recarregar a página.
  function novoOrcamento() {
    if (!confirm("Iniciar um novo orçamento? Os dados atuais serão perdidos.")) return;

    destinos = [];
    destCounter = 0;
    Object.keys(fotoStore).forEach((k) => delete fotoStore[k]);
    Object.keys(fotoStorePrint).forEach((k) => delete fotoStorePrint[k]);

    document.getElementById("o-nome").value     = "";
    document.getElementById("o-adultos").value  = "1";
    document.getElementById("o-criancas").value = "0";
    document.getElementById("o-bebes").value    = "0";
    document.getElementById("o-obs").value      = "";

    addDestino();

    document.getElementById("orc-preview-wrap").innerHTML = "";
    outputWrap.hidden = true;
    formWrap.hidden   = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addProduto(destId, tipo) {
    const dest = destinos.find((d) => d.id === destId);
    if (!dest) return;
    const pid = tipo + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    dest.produtos.push({ pid, tipo, extras: tipo === "passagem" ? [] : undefined });
    fotoStore[pid] = [];
    fotoStorePrint[pid] = [];
    renderDestinos();
  }

  function removeProduto(destId, pid) {
    const dest = destinos.find((d) => d.id === destId);
    if (!dest) return;
    dest.produtos = dest.produtos.filter((p) => p.pid !== pid);
    delete fotoStore[pid];
    delete fotoStorePrint[pid];
    renderDestinos();
  }

  // Itens adicionais de uma passagem (bagagem extra, assento, pet, etc.) — cada um
  // com descrição e valor livres, somados ao total do orçamento como linhas próprias.
  function addExtraItem(destId, pid) {
    const dest = destinos.find((d) => d.id === destId);
    const p = dest?.produtos.find((x) => x.pid === pid);
    if (!p) return;
    if (!p.extras) p.extras = [];
    const exId = "ex-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    p.extras.push(exId);
    renderDestinos();
    setTimeout(() => document.getElementById(`${destId}-${pid}-extra-${exId}-desc`)?.focus(), 50);
  }

  function removeExtraItem(destId, pid, exId) {
    const dest = destinos.find((d) => d.id === destId);
    const p = dest?.produtos.find((x) => x.pid === pid);
    if (!p) return;
    p.extras = (p.extras || []).filter((id) => id !== exId);
    renderDestinos();
  }

  function calcNoites(destId) {
    const ci = document.getElementById("o-ci-" + destId);
    const co = document.getElementById("o-co-" + destId);
    const el = document.getElementById("o-noites-" + destId);
    if (!ci || !co || !el) return;
    const diff = diffD(ci.value, co.value);
    el.hidden = diff <= 0;
    if (diff > 0) el.textContent = "🌙 " + diff + " noite" + (diff !== 1 ? "s" : "");
  }

  function renderDestinos() {
    const saved = {};
    destinosList.querySelectorAll("input,select,textarea").forEach((e) => { if (e.id) saved[e.id] = e.value; });
    destinosList.innerHTML = "";

    destinos.forEach((dest, idx) => {
      const div = document.createElement("div");
      div.className = "orc-destino-card";
      div.id = dest.id;

      const prodHtml = dest.produtos.map((p) => {
        const cfg = PROD_CFG[p.tipo];
        const isPassagem = p.tipo === "passagem";
        const isHospedagem = p.tipo === "hospedagem";

        const fieldsHtml = cfg.fields.map((f) => {
          if (f.type === "divider") {
            return `<div class="orc-cost-divider" style="grid-column:1/-1"><span>${escapeHtml(f.label)}</span></div>`;
          }
          const span = f.cols === 2 ? "grid-column:span 2;" : "";
          let inp;
          if (f.type === "select") {
            const opts = (f.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join("");
            inp = `<select id="${dest.id}-${p.pid}-${f.id}" class="input"><option value=""></option>${opts}</select>`;
          } else {
            const step = f.step ? `step="${f.step}"` : f.type === "number" ? 'step="0.01"' : "";
            inp = `<input id="${dest.id}-${p.pid}-${f.id}" type="${f.type}" class="input" placeholder="${escapeHtml(f.placeholder||"")}" ${step}>`;
          }
          const extra = (isPassagem && f.id === "valor_pax") ? " orc-field--highlight" : "";
          return `<label class="field${extra}" style="${span}"><span class="field__label">${escapeHtml(f.label)}</span>${inp}</label>`;
        }).join("");

        const extrasHtml = isPassagem ? `
          <div class="orc-extras-wrap">
            <div class="orc-extras-label">Itens adicionais (bagagem extra, assento, pet...)</div>
            ${(p.extras || []).map((exId) => `
              <div class="orc-extra-row">
                <input id="${dest.id}-${p.pid}-extra-${exId}-desc" type="text" class="input" placeholder="Ex: Bagagem 23kg">
                <input id="${dest.id}-${p.pid}-extra-${exId}-valor" type="number" class="input" placeholder="Valor (R$)" step="0.01">
                <button type="button" class="orc-extra-remove" data-dest="${dest.id}" data-pid="${p.pid}" data-extra="${exId}" title="Remover">✕</button>
              </div>`).join("")}
            <button type="button" class="btn btn--ghost btn--sm orc-extra-add" data-dest="${dest.id}" data-pid="${p.pid}">+ Adicionar item</button>
          </div>` : "";

        const zoneId = "fotozone-" + p.pid;
        const zoneClass = isPassagem ? "orc-foto-zone orc-print-zone" : "orc-foto-zone";
        const zoneHint  = isPassagem
          ? "📋 Cole aqui o print do bilhete (Ctrl+V) para extrair dados automaticamente"
          : isHospedagem
            ? "📷 Cole, arraste ou clique para adicionar fotos do hotel (aparecem no orçamento para o cliente)"
            : "📷 Cole (Ctrl+V), arraste ou clique para adicionar fotos";

        // Hospedagem tem uma zona extra, só para o print da reserva (nome/preço do
        // hotel) — a IA lê daqui, e essas imagens não aparecem no orçamento do cliente.
        const printZoneId  = "fotozone-print-" + p.pid;
        const printZoneHtml = isHospedagem ? `
              <div class="orc-foto-zone orc-print-zone" id="${printZoneId}" tabindex="0">
                <span class="orc-foto-hint">📋 Cole aqui o print da reserva do hotel (Ctrl+V) para extrair dados automaticamente</span>
              </div>` : "";

        return `
          <div class="orc-produto-item" id="pi-${p.pid}">
            <div class="orc-produto-header">
              <span class="orc-produto-icon">${cfg.icon}</span>
              <span>${escapeHtml(cfg.label)}</span>
              <button type="button" class="orc-produto-remove" data-dest="${dest.id}" data-pid="${p.pid}">✕</button>
            </div>
            <div class="orc-produto-body">
              <div class="form__grid orc-produto-fields">
                ${fieldsHtml}
              </div>
              ${extrasHtml}
              ${printZoneHtml}
              <div class="${zoneClass}" id="${zoneId}" tabindex="0">
                <span class="orc-foto-hint">${zoneHint}</span>
              </div>
            </div>
          </div>`;
      }).join("");

      const togglesHtml = Object.entries(PROD_CFG)
        .map(([tipo, cfg]) => `<button type="button" class="orc-prod-toggle" data-dest="${dest.id}" data-tipo="${tipo}">${cfg.icon} ${escapeHtml(cfg.label)}</button>`)
        .join("");

      div.innerHTML = `
        <div class="orc-destino-header">
          <div class="orc-destino-num">${idx + 1}</div>
          <div class="orc-destino-nome" id="o-nome-display-${dest.id}">Destino ${idx + 1}</div>
          ${destinos.length > 1 ? `<button type="button" class="orc-destino-remove" data-dest="${dest.id}">✕ Remover</button>` : ""}
        </div>
        <div class="orc-destino-body">
          <div class="form__grid orc-destino-grid">
            <label class="field">
              <span class="field__label">Cidade / País *</span>
              <input id="o-nome-${dest.id}" type="text" class="input" placeholder="Ex: Roma, Itália">
            </label>
            <label class="field">
              <span class="field__label">Data de ida</span>
              <input id="o-ci-${dest.id}" type="date" class="input">
            </label>
            <label class="field">
              <span class="field__label">Data de volta <span class="field__optional">(opcional)</span></span>
              <input id="o-co-${dest.id}" type="date" class="input">
            </label>
          </div>
          <div class="orc-noites-badge" id="o-noites-${dest.id}" hidden></div>

          <div id="orc-produtos-${dest.id}">${prodHtml}</div>

          <div class="orc-add-prod-label">Adicionar serviço</div>
          <div class="orc-prod-toggles">${togglesHtml}</div>
        </div>`;

      destinosList.appendChild(div);

      Object.entries(saved).forEach(([id, val]) => { const e = document.getElementById(id); if (e) e.value = val; });

      const nomeIn = div.querySelector("#o-nome-" + dest.id);
      nomeIn?.addEventListener("input", () => {
        const d = document.getElementById("o-nome-display-" + dest.id);
        if (d) d.textContent = nomeIn.value || "Destino " + (idx + 1);
      });

      div.querySelector("#o-ci-" + dest.id)?.addEventListener("change", () => calcNoites(dest.id));
      div.querySelector("#o-co-" + dest.id)?.addEventListener("change", () => calcNoites(dest.id));

      div.querySelectorAll(".orc-destino-remove").forEach((b) => b.addEventListener("click", () => removeDestino(b.dataset.dest)));
      div.querySelectorAll(".orc-produto-remove").forEach((b) => b.addEventListener("click", () => removeProduto(b.dataset.dest, b.dataset.pid)));
      div.querySelectorAll(".orc-prod-toggle").forEach((b) => b.addEventListener("click", () => addProduto(b.dataset.dest, b.dataset.tipo)));
      div.querySelectorAll(".orc-extra-add").forEach((b) => b.addEventListener("click", () => addExtraItem(b.dataset.dest, b.dataset.pid)));
      div.querySelectorAll(".orc-extra-remove").forEach((b) => b.addEventListener("click", () => removeExtraItem(b.dataset.dest, b.dataset.pid, b.dataset.extra)));

      dest.produtos.forEach((p) => {
        const zoneId = "fotozone-" + p.pid;
        setupFotoZone(p.pid, zoneId, p.tipo, dest.id);
        renderFotos(p.pid, zoneId, p.tipo, dest.id);
        if (p.tipo === "passagem") bindMilhasCalc(dest.id, p.pid);
        if (p.tipo === "hospedagem") {
          const printZoneId = "fotozone-print-" + p.pid;
          setupFotoZonePrintHotel(p.pid, printZoneId, dest.id);
          renderFotosPrintHotel(p.pid, printZoneId, dest.id);
        }
      });

      calcNoites(dest.id);
    });
  }

  // ===== Modal de configuração IA =====
  function abrirConfigIA(onSaved) {
    const modal  = document.getElementById("orc-ia-modal");
    const modEl  = document.getElementById("orc-ia-model");
    if (!modal) return;

    // Preenche com valores salvos
    modEl.value = getModel();
    modal.hidden = false;

    // Referência temporária para callback pós-save
    modal._onSaved = onSaved || null;
  }

  function fecharConfigIA() {
    const modal = document.getElementById("orc-ia-modal");
    if (modal) modal.hidden = true;
  }

  // Preenche um card de passagem com os dados extraídos pela IA. forcarVolta:
  // true = grava a data em "Data de volta", false = em "Data de ida", null = decide
  // pela posição do card entre as passagens do destino (0=ida, 1=volta, ...).
  function preencherCardPassagem(destId, cardPid, ex, forcarVolta) {
    const prefix = `${destId}-${cardPid}-`;
    const fill = (field, val) => {
      if (val == null || val === "") return;
      const el = document.getElementById(prefix + field);
      if (el) el.value = val;
    };

    fill("trecho",          ex.trecho);
    fill("cidade_orig",     ex.cidade_orig);
    fill("cidade_dest",     ex.cidade_dest);
    fill("companhia",       ex.companhia);
    fill("voo",             ex.voo);
    fill("horario_partida", ex.horario_partida);
    fill("horario_chegada", ex.horario_chegada);
    fill("conexoes",        ex.conexoes);
    fill("duracao",         ex.duracao);
    fill("milhas",          ex.milhas);

    // Data do voo não tem campo próprio no card — vai para "Data de ida/volta" do
    // destino (só se ainda estiver vazio, pra não sobrescrever o que já foi digitado).
    const dataIso = paraDataISO(ex.data);
    if (dataIso) {
      const isVolta = forcarVolta === null ? passagemIndex(destId, cardPid) % 2 === 1 : forcarVolta;
      const fieldId = isVolta ? "o-co-" + destId : "o-ci-" + destId;
      const dataEl  = document.getElementById(fieldId);
      if (dataEl && !dataEl.value) {
        dataEl.value = dataIso;
        dataEl.dispatchEvent(new Event("change"));
      }
    }
    fill("taxa_embarque", ex.taxa_embarque);

    document.getElementById(prefix + "milhas")?.dispatchEvent(new Event("input"));
  }

  // Garante um segundo card de passagem no destino, para preencher a volta extraída
  // do mesmo print da ida — reaproveita um card já existente ou cria um novo.
  function garantirSegundaPassagem(destId, pid) {
    const dest = destinos.find((d) => d.id === destId);
    if (!dest) return null;
    const passagens = dest.produtos.filter((p) => p.tipo === "passagem");
    const idx = passagens.findIndex((p) => p.pid === pid);
    if (idx === -1) return null;
    if (passagens[idx + 1]) return passagens[idx + 1].pid;

    addProduto(destId, "passagem");
    const novasPassagens = dest.produtos.filter((p) => p.tipo === "passagem");
    return novasPassagens[novasPassagens.length - 1].pid;
  }

  // ===== Análise com IA (somente passagem) =====
  async function analisarPassagem(pid, destId, imageSrc) {
    const btn = document.querySelector(`[data-ai-pid="${pid}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Analisando..."; }

    try {
      const match = imageSrc.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("Imagem inválida");
      const [, mime, b64] = match;

      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime || "image/png", data: b64 } },
              { type: "text", text: `${contextoDataAtual()}

Analise este print de passagem/reserva aérea. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:
{
  "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO",
  "cidade_orig": "nome da cidade de origem (ex: Fortaleza)",
  "cidade_dest": "nome da cidade de destino (ex: Lisboa)",
  "companhia": "nome da companhia aérea",
  "voo": "número do voo",
  "data": "DD/MM/AAAA da data do voo, ou null se não estiver visível",
  "horario_partida": "HH:MM",
  "horario_chegada": "HH:MM ou HH:MM (+1) se for dia seguinte",
  "conexoes": "Voo direto OU ex: 1 escala em GRU",
  "duracao": "Xh Ymin",
  "milhas": número_inteiro_ou_null,
  "taxa_embarque": valor_numerico_em_reais_ou_null,
  "volta": {
    "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO (invertido em relação à ida)",
    "cidade_orig": "...", "cidade_dest": "...",
    "companhia": "...", "voo": "...",
    "data": "DD/MM/AAAA ou null",
    "horario_partida": "HH:MM", "horario_chegada": "HH:MM ou HH:MM (+1)",
    "conexoes": "...", "duracao": "...",
    "milhas": número_inteiro_ou_null,
    "taxa_embarque": valor_numerico_em_reais_ou_null
  } OU null — preencha "volta" SOMENTE se este mesmo print mostrar claramente os dois trechos (ida E volta) de uma reserva de ida e volta. Se mostrar só um trecho, "volta" deve ser null.
}` },
            ],
          }],
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || "Erro HTTP " + resp.status);
      }

      const data = await resp.json();
      const text = data.content?.[0]?.text || "";
      const jsonStr = extractJson(text);
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const ex = JSON.parse(jsonStr);
      preencherCardPassagem(destId, pid, ex, /* forcarVolta */ null);

      // Print único mostrando ida e volta juntas (reserva round-trip): garante um
      // segundo card de passagem para a volta e preenche com os dados extraídos.
      if (ex.volta && typeof ex.volta === "object") {
        const voltaPid = garantirSegundaPassagem(destId, pid);
        if (voltaPid) preencherCardPassagem(destId, voltaPid, ex.volta, true);
      }

      if (btn) { btn.disabled = false; btn.textContent = "✓ Dados extraídos!"; }
      setTimeout(() => { if (btn) { btn.textContent = "🤖 Analisar novamente"; } }, 3000);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "🤖 Analisar novamente"; }
      alert("Erro ao analisar: " + err.message);
    }
  }

  // ===== Análise com IA (hospedagem) =====
  const REGIMES_HOSPEDAGEM = PROD_CFG.hospedagem.fields.find((f) => f.id === "regime").options;

  async function analisarHospedagem(pid, destId, imageSrc) {
    const btn = document.querySelector(`[data-ai-hotel-pid="${pid}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Analisando..."; }

    try {
      const match = imageSrc.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("Imagem inválida");
      const [, mime, b64] = match;

      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime || "image/png", data: b64 } },
              { type: "text", text: `${contextoDataAtual()}

Analise este print de reserva/confirmação de hotel ou pousada. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:
{
  "hotel": "nome do hotel/pousada",
  "regime": "uma destas opções, exatamente como escrito: ${REGIMES_HOSPEDAGEM.map((r) => `\"${r}\"`).join(", ")} — ou null se não estiver claro",
  "checkin": "DD/MM/AAAA da data de check-in, ou null",
  "checkout": "DD/MM/AAAA da data de check-out, ou null",
  "custo": valor_numerico_total_em_reais_ou_null
}` },
            ],
          }],
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || "Erro HTTP " + resp.status);
      }

      const data = await resp.json();
      const text = data.content?.[0]?.text || "";
      const jsonStr = extractJson(text);
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const ex = JSON.parse(jsonStr);
      const prefix = `${destId}-${pid}-`;
      const fill = (field, val) => {
        if (val == null || val === "") return;
        const el = document.getElementById(prefix + field);
        if (el) el.value = val;
      };

      fill("hotel", ex.hotel);
      if (ex.regime && REGIMES_HOSPEDAGEM.includes(ex.regime)) fill("regime", ex.regime);
      fill("custo", ex.custo);

      const ciIso = paraDataISO(ex.checkin);
      const ciEl  = document.getElementById("o-ci-" + destId);
      if (ciIso && ciEl && !ciEl.value) { ciEl.value = ciIso; ciEl.dispatchEvent(new Event("change")); }

      const coIso = paraDataISO(ex.checkout);
      const coEl  = document.getElementById("o-co-" + destId);
      if (coIso && coEl && !coEl.value) { coEl.value = coIso; coEl.dispatchEvent(new Event("change")); }

      if (btn) { btn.disabled = false; btn.textContent = "✓ Dados extraídos!"; }
      setTimeout(() => { if (btn) { btn.textContent = "🤖 Analisar novamente"; } }, 3000);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "🤖 Analisar novamente"; }
      alert("Erro ao analisar: " + err.message);
    }
  }

  // ===== Fotos / Prints =====
  function setupFotoZone(pid, zoneId, tipo, destId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener("paste", (e) => {
      for (const item of (e.clipboardData?.items || []))
        if (item.type.startsWith("image/")) readFoto(pid, item.getAsFile(), zoneId, tipo, destId);
    });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("dragover");
      for (const f of (e.dataTransfer?.files || []))
        if (f.type.startsWith("image/")) readFoto(pid, f, zoneId, tipo, destId);
    });
    // Para fotos de hotel/outros: abre o seletor de arquivo ao clicar
    // Para passagem: somente Ctrl+V, sem dialog de arquivo
    if (tipo !== "passagem") {
      zone.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
        inp.onchange = () => { for (const f of inp.files) readFoto(pid, f, zoneId, tipo, destId); };
        inp.click();
      });
    }
  }

  function readFoto(pid, file, zoneId, tipo, destId) {
    const r = new FileReader();
    r.onload = (e) => {
      if (!fotoStore[pid]) fotoStore[pid] = [];
      fotoStore[pid].push({ fid: "f" + Date.now() + Math.random().toString(36).slice(2), src: e.target.result });
      renderFotos(pid, zoneId, tipo, destId);
      // Para passagem: aciona análise automaticamente ao colar o print
      if (tipo === "passagem") {
        analisarPassagem(pid, destId, e.target.result);
      }
    };
    r.readAsDataURL(file);
  }

  function removeFoto(pid, fid, zoneId, tipo, destId) {
    fotoStore[pid] = (fotoStore[pid] || []).filter((f) => f.fid !== fid);
    renderFotos(pid, zoneId, tipo, destId);
  }

  function renderFotos(pid, zoneId, tipo, destId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    let prev = zone.querySelector(".orc-fotos-preview");
    if (!prev) { prev = document.createElement("div"); prev.className = "orc-fotos-preview"; zone.appendChild(prev); }

    const fotos = fotoStore[pid] || [];
    const isPassagem = tipo === "passagem";

    prev.innerHTML = fotos.map((f) =>
      `<div class="orc-foto-thumb"><img src="${f.src}"><button class="orc-foto-rm" data-pid="${pid}" data-fid="${f.fid}" data-zone="${zoneId}" data-tipo="${tipo||""}" data-dest="${destId||""}">✕</button></div>`
    ).join("");

    // Para passagem: botão de reanálise manual
    if (isPassagem && fotos.length > 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--gold orc-ia-btn";
      btn.dataset.aiPid = pid;
      btn.textContent = "🤖 Analisar novamente";
      btn.addEventListener("click", () => analisarPassagem(pid, destId, fotos[fotos.length - 1].src));
      prev.appendChild(btn);
    }

    prev.querySelectorAll(".orc-foto-rm").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFoto(b.dataset.pid, b.dataset.fid, b.dataset.zone, b.dataset.tipo, b.dataset.dest);
      })
    );
  }

  // Zona de print da reserva de hotel (só para IA — imagens aqui não vão pro cliente)
  function setupFotoZonePrintHotel(pid, zoneId, destId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener("paste", (e) => {
      for (const item of (e.clipboardData?.items || []))
        if (item.type.startsWith("image/")) readFotoPrintHotel(pid, item.getAsFile(), zoneId, destId);
    });
  }

  function readFotoPrintHotel(pid, file, zoneId, destId) {
    const r = new FileReader();
    r.onload = (e) => {
      if (!fotoStorePrint[pid]) fotoStorePrint[pid] = [];
      fotoStorePrint[pid].push({ fid: "f" + Date.now() + Math.random().toString(36).slice(2), src: e.target.result });
      renderFotosPrintHotel(pid, zoneId, destId);
      analisarHospedagem(pid, destId, e.target.result);
    };
    r.readAsDataURL(file);
  }

  function removeFotoPrintHotel(pid, fid, zoneId, destId) {
    fotoStorePrint[pid] = (fotoStorePrint[pid] || []).filter((f) => f.fid !== fid);
    renderFotosPrintHotel(pid, zoneId, destId);
  }

  function renderFotosPrintHotel(pid, zoneId, destId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    let prev = zone.querySelector(".orc-fotos-preview");
    if (!prev) { prev = document.createElement("div"); prev.className = "orc-fotos-preview"; zone.appendChild(prev); }

    const fotos = fotoStorePrint[pid] || [];
    prev.innerHTML = fotos.map((f) =>
      `<div class="orc-foto-thumb"><img src="${f.src}"><button class="orc-foto-rm" data-pid="${pid}" data-fid="${f.fid}" data-zone="${zoneId}" data-dest="${destId||""}">✕</button></div>`
    ).join("");

    if (fotos.length > 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--gold orc-ia-btn";
      btn.dataset.aiHotelPid = pid;
      btn.textContent = "🤖 Analisar novamente";
      btn.addEventListener("click", () => analisarHospedagem(pid, destId, fotos[fotos.length - 1].src));
      prev.appendChild(btn);
    }

    prev.querySelectorAll(".orc-foto-rm").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFotoPrintHotel(b.dataset.pid, b.dataset.fid, b.dataset.zone, b.dataset.dest);
      })
    );
  }

  // ===== Coleta de dados =====
  function coletarDados() {
    const adultos  = parseInt(gV("o-adultos")) || 1;
    const criancas = parseInt(gV("o-criancas")) || 0;
    const bebes    = parseInt(gV("o-bebes"))    || 0;
    const nome     = gV("o-nome") || "Cliente";
    const obs      = gV("o-obs");

    let totalGeral = 0;
    const destsData = [];

    destinos.forEach((dest, idx) => {
      const dNome  = gV("o-nome-" + dest.id) || "Destino " + (idx + 1);
      const ciVal  = gV("o-ci-" + dest.id);
      const coVal  = gV("o-co-" + dest.id);
      const noites = diffD(ciVal, coVal);
      const periodo = ciVal
        ? (coVal
            ? fData(ciVal) + " → " + fData(coVal) + (noites > 0 ? " · " + noites + " noite" + (noites !== 1 ? "s" : "") : "")
            : "Ida: " + fData(ciVal) + " (somente ida)")
        : "";

      let totalDest = 0;
      const itens   = [];
      const FLIGHT_LABELS = ["IDA", "VOLTA", "IDA 2", "VOLTA 2"];
      let passagemIdx = 0;

      dest.produtos.forEach((p) => {
        const cfg = PROD_CFG[p.tipo];
        let nomeItem = cfg.label, desc = "", venda = 0, extrasVenda = 0;

        if (p.tipo === "passagem") {
          const valorPax      = gN(dest.id + "-" + p.pid + "-valor_pax");
          const taxaEmbarque  = gN(dest.id + "-" + p.pid + "-taxa_embarque");
          const totalPassagem = valorPax * adultos;
          const totalTaxa     = taxaEmbarque * adultos;
          venda    = totalPassagem + totalTaxa;
          nomeItem = gV(dest.id + "-" + p.pid + "-trecho") || "Passagem aérea";

          const flightLabel = FLIGHT_LABELS[passagemIdx] || ("TRECHO " + (passagemIdx + 1));
          const flightDate  = passagemIdx === 0 ? fData(ciVal) : (fData(coVal) || fData(ciVal));
          passagemIdx++;

          itens.push({
            nomeItem, venda, tipo: "passagem",
            fotos: [],
            valorPax, adultos, taxaEmbarque, totalPassagem, totalTaxa,
            flightLabel, flightDate,
            companhia:    gV(dest.id + "-" + p.pid + "-companhia"),
            voo:          gV(dest.id + "-" + p.pid + "-voo"),
            partida:      gV(dest.id + "-" + p.pid + "-horario_partida"),
            chegada:      gV(dest.id + "-" + p.pid + "-horario_chegada"),
            conexoes:     gV(dest.id + "-" + p.pid + "-conexoes"),
            duracao:      gV(dest.id + "-" + p.pid + "-duracao"),
            cidadeOrigem: gV(dest.id + "-" + p.pid + "-cidade_orig"),
            cidadeDestino:gV(dest.id + "-" + p.pid + "-cidade_dest"),
          });

          (p.extras || []).forEach((exId) => {
            const exDesc  = gV(`${dest.id}-${p.pid}-extra-${exId}-desc`);
            const exValor = gN(`${dest.id}-${p.pid}-extra-${exId}-valor`);
            if (!exDesc && !exValor) return;
            itens.push({ nomeItem: exDesc || "Item adicional", desc: flightLabel, venda: exValor, tipo: "extra", fotos: [] });
            extrasVenda += exValor;
          });
        } else {
          const custo  = gN(dest.id + "-" + p.pid + "-custo");
          const markup = gN(dest.id + "-" + p.pid + "-markup");
          venda = custo + markup;

          if (p.tipo === "hospedagem") {
            const h = gV(dest.id + "-" + p.pid + "-hotel");
            const r = gV(dest.id + "-" + p.pid + "-regime");
            if (h) nomeItem = h;
            desc = [r, noites > 0 ? noites + " noite" + (noites !== 1 ? "s" : "") : ""].filter(Boolean).join(" · ");
          } else if (p.tipo === "seguro") {
            desc = [gV(dest.id + "-" + p.pid + "-seguradora"), gV(dest.id + "-" + p.pid + "-plano"), gV(dest.id + "-" + p.pid + "-cobertura")].filter(Boolean).join(" · ");
          } else if (p.tipo === "carro") {
            const dias = diffD(ciVal, coVal);
            desc = [gV(dest.id + "-" + p.pid + "-locadora"), gV(dest.id + "-" + p.pid + "-categoria"), dias > 0 ? dias + " dia" + (dias !== 1 ? "s" : "") : ""].filter(Boolean).join(" · ");
          } else if (p.tipo === "passeio") {
            const d = gV(dest.id + "-" + p.pid + "-descricao");
            const dt = gV(dest.id + "-" + p.pid + "-data_passeio");
            if (d) nomeItem = d; if (dt) desc = fData(dt);
          } else if (p.tipo === "transfer") {
            const t = gV(dest.id + "-" + p.pid + "-trecho"), ti = gV(dest.id + "-" + p.pid + "-tipo");
            if (t) nomeItem = t; desc = ti;
          }
          itens.push({ nomeItem, desc, venda, fotos: (fotoStore[p.pid] || []).map((f) => f.src), tipo: p.tipo });
        }
        totalDest += venda + extrasVenda;
      });

      totalGeral += totalDest;
      destsData.push({ nome: dNome, periodo, itens, totalDest });
    });

    const roteiro  = destinos.map((d, i) => gV("o-nome-" + d.id) || "Destino " + (i + 1)).join(" · ");
    const totalPax = adultos + criancas;
    return { nome, roteiro, adultos, criancas, bebes, obs, totalGeral, destsData, totalPax, porPessoa: totalGeral / (totalPax || 1) };
  }

  // ===== Cartão visual de voo =====
  function renderFlightCard(it) {
    const iata    = parseTrecho(it.nomeItem);
    const origCity = it.cidadeOrigem  || "";
    const destCity = it.cidadeDestino || "";
    const vooInfo  = [it.companhia, it.voo].filter(Boolean).join(" · ");
    const isDireto = it.conexoes && /direto/i.test(it.conexoes);
    const stops    = isDireto ? "Voo direto" : (it.conexoes || "");

    return `
      <div class="orc-prev-flight-card">
        <div class="orc-prev-flight-card-header">
          <span class="orc-prev-flight-label">${escapeHtml(it.flightLabel || "VOO")}</span>
          ${it.flightDate ? `<span class="orc-prev-flight-card-date">${escapeHtml(it.flightDate)}</span>` : ""}
          ${vooInfo ? `<span class="orc-prev-flight-card-voo">${escapeHtml(vooInfo)}</span>` : ""}
        </div>
        <div class="orc-prev-flight-card-body">
          <div class="orc-prev-airport">
            <div class="orc-prev-iata">${escapeHtml(iata.orig || "—")}</div>
            ${it.partida  ? `<div class="orc-prev-time">${escapeHtml(it.partida)}</div>`  : ""}
            ${origCity    ? `<div class="orc-prev-city">${escapeHtml(origCity)}</div>`    : ""}
          </div>
          <div class="orc-prev-flight-middle">
            ${it.duracao  ? `<div class="orc-prev-duration">${escapeHtml(it.duracao)}</div>` : ""}
            <div class="orc-prev-dash-line">
              <span class="orc-prev-dash-seg"></span>
              <span class="orc-prev-plane-icon">✈</span>
              <span class="orc-prev-dash-seg"></span>
            </div>
            ${stops ? `<div class="orc-prev-direto">${escapeHtml(stops)}</div>` : ""}
          </div>
          <div class="orc-prev-airport orc-prev-airport--right">
            <div class="orc-prev-iata">${escapeHtml(iata.dest || "—")}</div>
            ${it.chegada  ? `<div class="orc-prev-time">${escapeHtml(it.chegada)}</div>`  : ""}
            ${destCity    ? `<div class="orc-prev-city">${escapeHtml(destCity)}</div>`    : ""}
          </div>
        </div>
      </div>`;
  }

  // ===== Preview =====
  function gerarOrcamento() {
    if (destinos.length === 0) { alert("Adicione pelo menos um destino."); return; }

    const d = coletarDados();
    const paxStr = d.adultos + " adulto" + (d.adultos !== 1 ? "s" : "") +
      (d.criancas > 0 ? " + " + d.criancas + " criança" + (d.criancas !== 1 ? "s" : "") : "") +
      (d.bebes    > 0 ? " + " + d.bebes    + " bebê"    + (d.bebes    !== 1 ? "s"    : "") : "");

    // Linhas de preço (voo + serviços) de um destino, já com passagens agrupadas.
    function linhasDestino(dest) {
      const rows = [];
      const { linhas, outros } = agruparPassagens(dest.itens);

      linhas.forEach((l) => {
        const paxLbl = l.pax + " adulto" + (l.pax !== 1 ? "s" : "");
        const valorTxt = l.valor > 0 ? fBRL(l.valor) : "Incluso em outro trecho";
        rows.push(`<tr>
          <td>${escapeHtml(l.label)} &nbsp;·&nbsp; ${escapeHtml(paxLbl)}</td>
          <td>${valorTxt}</td>
        </tr>`);
      });

      outros.forEach((it) => {
        let label = escapeHtml(it.nomeItem);
        if (it.desc) label += `<span class="orc-prev-table-desc"> · ${escapeHtml(it.desc)}</span>`;
        rows.push(`<tr>
          <td>${label}</td>
          <td>${fBRL(it.venda)}</td>
        </tr>`);
        if (it.fotos && it.fotos.length) {
          rows.push(`<tr class="orc-prev-table-fotos-row"><td colspan="2"><div class="orc-prev-fotos">${it.fotos.map((s) => `<img src="${s}">`).join("")}</div></td></tr>`);
        }
      });

      return rows;
    }

    // Com 2+ destinos, cada um vira um bloco próprio (voo + hotel daquele destino
    // juntos, com cabeçalho), em vez de misturar tudo numa tabela só.
    const multiDestino = d.destsData.length > 1;
    let corpoHtml;

    if (multiDestino) {
      corpoHtml = d.destsData.map((dest, i) => {
        let flightCards = "";
        dest.itens.forEach((it) => { if (it.tipo === "passagem") flightCards += renderFlightCard(it); });

        return `
          <div class="orc-prev-destino">
            <div class="orc-prev-dest-header">
              <span>${i + 1}. ${escapeHtml(dest.nome)}</span>
              ${dest.periodo ? `<span class="orc-prev-dest-periodo">${escapeHtml(dest.periodo)}</span>` : ""}
            </div>
            <div class="orc-prev-destino-body">
              ${flightCards}
              <table class="orc-prev-table">
                <tbody>${linhasDestino(dest).join("")}</tbody>
              </table>
            </div>
          </div>`;
      }).join("") + `
        <table class="orc-prev-table">
          <tfoot>
            <tr class="orc-prev-table-total">
              <td>VALOR TOTAL</td>
              <td>${fBRL(d.totalGeral)}</td>
            </tr>
            ${d.totalPax > 1 ? `<tr class="orc-prev-table-porpessoa">
              <td>Valor por pessoa</td>
              <td>${fBRL(d.porPessoa)}</td>
            </tr>` : ""}
          </tfoot>
        </table>`;
    } else {
      let flightCardsHtml = "";
      const tableRows = [];
      d.destsData.forEach((dest) => {
        dest.itens.forEach((it) => { if (it.tipo === "passagem") flightCardsHtml += renderFlightCard(it); });
        tableRows.push(...linhasDestino(dest));
      });

      corpoHtml = `
        ${flightCardsHtml}
        <table class="orc-prev-table">
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows.join("")}
          </tbody>
          <tfoot>
            <tr class="orc-prev-table-total">
              <td>VALOR TOTAL</td>
              <td>${fBRL(d.totalGeral)}</td>
            </tr>
            ${d.totalPax > 1 ? `<tr class="orc-prev-table-porpessoa">
              <td>Valor por pessoa</td>
              <td>${fBRL(d.porPessoa)}</td>
            </tr>` : ""}
          </tfoot>
        </table>`;
    }

    document.getElementById("orc-preview-wrap").innerHTML = `
      <div class="orc-prev-wrap">
        <div class="orc-prev-header">
          <img src="Lolek_logotipo_3.png" class="orc-prev-logo-img" alt="Lolek Viagens">
          <div class="orc-prev-contatos">${escapeHtml(LOLEK_EMAIL)}<br>${escapeHtml(LOLEK_TEL)}<br>${escapeHtml(LOLEK_END)}</div>
        </div>
        <div class="orc-prev-divider"></div>
        <div class="orc-prev-titulo">PROPOSTA PERSONALIZADA DE VIAGEM</div>
        <div class="orc-prev-subtitulo">Para: <strong>${escapeHtml(d.nome)}</strong> &nbsp;·&nbsp; ${escapeHtml(paxStr)}</div>
        ${corpoHtml}
        <div class="orc-prev-pag">
          <strong>Formas de pagamento</strong>
          ◆ PIX &nbsp;&nbsp; ▬ Cartão de crédito em até 12x (mediante taxas)
        </div>
        ${d.obs ? `<div class="orc-prev-pag"><strong>Observações</strong><br>${escapeHtml(d.obs)}</div>` : ""}
        <div class="orc-prev-footer">Este orçamento não possui validade fixa — os valores estão sujeitos à disponibilidade e podem ser alterados a qualquer momento.</div>
      </div>`;

    window._orcDados = d;
    formWrap.hidden = true;
    outputWrap.hidden = false;
    window.scrollTo(0, 0);
  }

  // ===== PDF =====
  // Gera o PDF capturando o próprio HTML do preview (html2canvas), para o
  // resultado ficar idêntico ao que aparece na tela em vez de um layout redesenhado.
  const PDF_STAGE_WIDTH = 800; // px — largura fixa de renderização, independente do tamanho da janela
  const PDF_SCALE = 2; // resolução da captura (2x = qualidade boa de impressão)
  // Seletores de trechos que não podem ser cortados no meio entre duas páginas do PDF.
  const PDF_UNSAFE_SELECTORS = ".orc-prev-flight-card, tr, .orc-prev-pag, .orc-prev-header, .orc-prev-titulo, .orc-prev-subtitulo, .orc-prev-footer, thead, tfoot";

  async function baixarPDF() {
    const d = window._orcDados;
    if (!d || !window.jspdf || !window.html2canvas) { alert("Biblioteca de PDF não carregada. Use Ctrl+P para imprimir."); return; }

    const original = document.querySelector("#orc-preview-wrap .orc-prev-wrap");
    if (!original) return;

    pdfBtn.disabled = true; pdfBtn.textContent = "⏳ Gerando...";
    const stage = document.createElement("div");
    try {
      stage.style.cssText = "position:fixed; left:-99999px; top:0; width:" + PDF_STAGE_WIDTH + "px; background:#fff;";
      const clone = original.cloneNode(true);
      clone.style.width = PDF_STAGE_WIDTH + "px";
      stage.appendChild(clone);
      document.body.appendChild(stage);

      const canvas = await window.html2canvas(clone, { scale: PDF_SCALE, backgroundColor: "#ffffff", useCORS: true });

      const cloneTop = clone.getBoundingClientRect().top;
      const unsafeZones = Array.from(clone.querySelectorAll(PDF_UNSAFE_SELECTORS)).map((el) => {
        const r = el.getBoundingClientRect();
        return { top: (r.top - cloneTop) * PDF_SCALE, bottom: (r.bottom - cloneTop) * PDF_SCALE };
      });

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const marginX = 10, marginY = 10;
      const usableW = pageW - marginX * 2;
      const usableH = pageH - marginY * 2;
      const pxPerMm = canvas.width / usableW;
      const pageHeightPx = usableH * pxPerMm;

      // Evita cortar um cartão de voo, linha de tabela etc. ao meio: se o corte ideal
      // cai dentro de um desses trechos, empurra o corte para o início do trecho.
      function safeBreak(sliceStart, idealEnd) {
        for (const zone of unsafeZones) {
          if (idealEnd > zone.top && idealEnd < zone.bottom && zone.top > sliceStart) return zone.top;
        }
        return idealEnd;
      }

      let sy = 0, first = true;
      while (sy < canvas.height - 1) {
        let sliceEnd = Math.min(sy + pageHeightPx, canvas.height);
        if (sliceEnd < canvas.height) sliceEnd = safeBreak(sy, sliceEnd);
        let sliceH = sliceEnd - sy;
        if (sliceH <= 0) sliceH = Math.min(pageHeightPx, canvas.height - sy);

        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceH;
        sliceCanvas.getContext("2d").drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        if (!first) doc.addPage();
        doc.addImage(sliceCanvas.toDataURL("image/jpeg", 0.92), "JPEG", marginX, marginY, usableW, sliceH / pxPerMm);
        first = false;
        sy += sliceH;
      }

      doc.save("Orcamento_Lolek_" + d.nome.replace(/\s+/g, "_") + ".pdf");
    } finally {
      stage.remove();
      pdfBtn.disabled = false; pdfBtn.textContent = "↓ Baixar PDF";
    }
  }

  // ===== Copiar texto =====
  function copiarTexto() {
    const d = window._orcDados; if (!d) return;
    let txt = "🌍 PROPOSTA LOLEK VIAGENS\n";
    txt += "Cliente: " + d.nome + " · " + d.adultos + " adulto" + (d.adultos !== 1 ? "s" : "");
    if (d.criancas > 0) txt += " + " + d.criancas + " criança" + (d.criancas !== 1 ? "s" : "");
    if (d.bebes    > 0) txt += " + " + d.bebes    + " bebê"    + (d.bebes    !== 1 ? "s"    : "");
    txt += "\n\n";
    d.destsData.forEach((dest, i) => {
      txt += "📍 " + (i + 1) + ". " + dest.nome + (dest.periodo ? " (" + dest.periodo + ")" : "") + "\n";
      dest.itens.filter((it) => it.tipo === "passagem").forEach((it) => {
        txt += "   ✈ " + it.nomeItem;
        const meta = [
          it.companhia && it.voo ? it.companhia + " " + it.voo : (it.companhia || it.voo || ""),
          it.partida && it.chegada ? it.partida + " → " + it.chegada : (it.partida || it.chegada || ""),
          it.conexoes || "",
          it.duracao  || "",
        ].filter(Boolean).join(" · ");
        if (meta) txt += " — " + meta;
        txt += "\n";
      });

      const { linhas, outros } = agruparPassagens(dest.itens);
      linhas.forEach((l) => {
        const paxLbl = l.pax + " adulto" + (l.pax !== 1 ? "s" : "");
        const valorTxt = l.valor > 0 ? fBRL(l.valor) : "Incluso em outro trecho";
        txt += "     " + l.label + " · " + paxLbl + ": " + valorTxt + "\n";
      });
      outros.forEach((it) => {
        txt += "   • " + it.nomeItem + (it.desc ? " — " + it.desc : "") + ": " + fBRL(it.venda) + "\n";
      });

      txt += "   Subtotal: " + fBRL(dest.totalDest) + "\n\n";
    });
    if (d.totalPax > 1) txt += "Por pessoa: " + fBRL(d.porPessoa) + "\n";
    txt += "💰 Total: " + fBRL(d.totalGeral) + "\n";
    if (d.obs) txt += "\n📝 " + d.obs + "\n";
    txt += "\n📞 " + LOLEK_TEL + " | " + LOLEK_EMAIL;

    navigator.clipboard.writeText(txt).then(() => {
      copyBtn.textContent = "✓ Copiado!";
      setTimeout(() => { copyBtn.textContent = "Copiar texto"; }, 2500);
    }).catch(() => alert("Não foi possível copiar."));
  }

  // ===== Eventos =====
  addDestinoBtn.addEventListener("click", addDestino);
  gerarBtn.addEventListener("click", gerarOrcamento);
  editBtn.addEventListener("click", () => { formWrap.hidden = false; outputWrap.hidden = true; });
  novoBtn.addEventListener("click", novoOrcamento);
  pdfBtn.addEventListener("click", baixarPDF);
  copyBtn.addEventListener("click", copiarTexto);

  // Botão ⚙ Configurar IA
  document.getElementById("orc-ia-cfg-btn")?.addEventListener("click", () => abrirConfigIA());

  // Modal: fechar
  document.getElementById("orc-ia-modal-close")?.addEventListener("click", fecharConfigIA);
  document.getElementById("orc-ia-modal-cancel")?.addEventListener("click", fecharConfigIA);
  document.getElementById("orc-ia-modal")?.querySelector(".modal__backdrop")
    ?.addEventListener("click", fecharConfigIA);

  // Modal: salvar
  document.getElementById("orc-ia-modal-save")?.addEventListener("click", () => {
    const modEl = document.getElementById("orc-ia-model");
    const model = modEl?.value || "claude-haiku-4-5-20251001";

    localStorage.setItem(LS_MODEL, model);

    fecharConfigIA();

    // Se havia callback (ex: acionar análise após configurar), executa agora
    const modal = document.getElementById("orc-ia-modal");
    if (modal?._onSaved) { const cb = modal._onSaved; modal._onSaved = null; cb(); }
  });

  // ===== Início =====
  addDestino();
})();
