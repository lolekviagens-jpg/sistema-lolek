// ===== Orçamentos — Lolek Viagens =====
(function () {
  "use strict";

  const LOLEK_TEL   = "(85) 99632-7092";
  const LOLEK_EMAIL = "thaynara@agencialolekviagens.com.br";
  const LOLEK_END   = "Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE";

  const LS_KEY   = "lolek_anthropic_key";
  const LS_MODEL = "lolek_anthropic_model";

  function getApiKey()   { return localStorage.getItem(LS_KEY)   || ""; }
  function getModel()    { return localStorage.getItem(LS_MODEL) || "claude-haiku-4-5-20251001"; }

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
  const fotoStore = {};

  // ===== Elementos =====
  const formWrap     = document.getElementById("orc-form-wrap");
  const outputWrap   = document.getElementById("orc-output-wrap");
  const destinosList = document.getElementById("orc-destinos-list");
  const addDestinoBtn= document.getElementById("orc-add-destino");
  const gerarBtn     = document.getElementById("orc-gerar");
  const editBtn      = document.getElementById("orc-edit-btn");
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

  function addProduto(destId, tipo) {
    const dest = destinos.find((d) => d.id === destId);
    if (!dest) return;
    const pid = tipo + "-" + Date.now();
    dest.produtos.push({ pid, tipo });
    fotoStore[pid] = [];
    renderDestinos();
  }

  function removeProduto(destId, pid) {
    const dest = destinos.find((d) => d.id === destId);
    if (!dest) return;
    dest.produtos = dest.produtos.filter((p) => p.pid !== pid);
    delete fotoStore[pid];
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

        const zoneId = "fotozone-" + p.pid;
        const zoneClass = isPassagem ? "orc-foto-zone orc-print-zone" : "orc-foto-zone";
        const zoneHint  = isPassagem
          ? "📋 Cole aqui o print do bilhete (Ctrl+V) para extrair dados automaticamente"
          : "📷 Cole (Ctrl+V), arraste ou clique para adicionar fotos";

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

      dest.produtos.forEach((p) => {
        const zoneId = "fotozone-" + p.pid;
        setupFotoZone(p.pid, zoneId, p.tipo, dest.id);
        renderFotos(p.pid, zoneId, p.tipo, dest.id);
        if (p.tipo === "passagem") bindMilhasCalc(dest.id, p.pid);
      });

      calcNoites(dest.id);
    });
  }

  // ===== Modal de configuração IA =====
  function abrirConfigIA(onSaved) {
    const modal  = document.getElementById("orc-ia-modal");
    const keyEl  = document.getElementById("orc-ia-key");
    const modEl  = document.getElementById("orc-ia-model");
    if (!modal) return;

    // Preenche com valores salvos
    keyEl.value = getApiKey();
    modEl.value = getModel();
    modal.hidden = false;

    // Referência temporária para callback pós-save
    modal._onSaved = onSaved || null;
  }

  function fecharConfigIA() {
    const modal = document.getElementById("orc-ia-modal");
    if (modal) modal.hidden = true;
  }

  // ===== Análise com IA (somente passagem) =====
  async function analisarPassagem(pid, destId, imageSrc) {
    const apiKey = getApiKey();
    if (!apiKey) {
      // Abre configurações e, após salvar, reanalisa automaticamente
      abrirConfigIA(() => analisarPassagem(pid, destId, imageSrc));
      return;
    }

    const btn = document.querySelector(`[data-ai-pid="${pid}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Analisando..."; }

    try {
      const match = imageSrc.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("Imagem inválida");
      const [, mime, b64] = match;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime || "image/png", data: b64 } },
              { type: "text", text: `Analise este print de passagem/reserva aérea. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:
{
  "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO",
  "cidade_orig": "nome da cidade de origem (ex: Fortaleza)",
  "cidade_dest": "nome da cidade de destino (ex: Lisboa)",
  "companhia": "nome da companhia aérea",
  "voo": "número do voo",
  "horario_partida": "HH:MM",
  "horario_chegada": "HH:MM ou HH:MM (+1) se for dia seguinte",
  "conexoes": "Voo direto OU ex: 1 escala em GRU",
  "duracao": "Xh Ymin",
  "milhas": número_inteiro_ou_null,
  "taxa_embarque": valor_numerico_em_reais_ou_null
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
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const ex = JSON.parse(jsonStr);
      const prefix = `${destId}-${pid}-`;
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
      fill("taxa_embarque",   ex.taxa_embarque);

      document.getElementById(prefix + "milhas")?.dispatchEvent(new Event("input"));

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
      // Para passagem: aciona análise automaticamente se a chave já estiver configurada
      if (tipo === "passagem" && getApiKey()) {
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

    // Para passagem: botão de análise (quando há key, serve para reanálise manual; sem key, abre config)
    if (isPassagem && fotos.length > 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--gold orc-ia-btn";
      btn.dataset.aiPid = pid;
      btn.textContent = getApiKey() ? "🤖 Analisar novamente" : "⚙ Configurar IA para extrair dados";
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

  // ===== Coleta de dados =====
  function coletarDados() {
    const adultos  = parseInt(gV("o-adultos")) || 2;
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
        let nomeItem = cfg.label, desc = "", venda = 0;

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
        totalDest += venda;
      });

      totalGeral += totalDest;
      destsData.push({ nome: dNome, periodo, itens, totalDest });
    });

    const roteiro = destinos.map((d, i) => gV("o-nome-" + d.id) || "Destino " + (i + 1)).join(" · ");
    return { nome, roteiro, adultos, criancas, bebes, obs, totalGeral, destsData, porPessoa: totalGeral / (adultos || 1) };
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

    // Cartões de voo (todos os trechos de todas as passagens)
    let flightCardsHtml = "";
    const tableRows = [];

    d.destsData.forEach((dest) => {
      dest.itens.forEach((it) => {
        if (it.tipo === "passagem") {
          flightCardsHtml += renderFlightCard(it);
          const paxLbl = it.adultos + " adulto" + (it.adultos !== 1 ? "s" : "");
          tableRows.push(`<tr>
            <td>Passagem aérea — ${escapeHtml(it.flightLabel)} &nbsp;·&nbsp; ${escapeHtml(paxLbl)}</td>
            <td>${fBRL(it.totalPassagem)}</td>
          </tr>`);
          if (it.taxaEmbarque > 0) {
            tableRows.push(`<tr class="orc-prev-table-row--taxa">
              <td>Taxa de embarque — ${escapeHtml(it.flightLabel)} &nbsp;·&nbsp; ${escapeHtml(paxLbl)}</td>
              <td>${fBRL(it.taxaEmbarque * it.adultos)}</td>
            </tr>`);
          }
        } else {
          let label = escapeHtml(it.nomeItem);
          if (it.desc) label += `<span class="orc-prev-table-desc"> · ${escapeHtml(it.desc)}</span>`;
          tableRows.push(`<tr>
            <td>${label}</td>
            <td>${fBRL(it.venda)}</td>
          </tr>`);
          if (it.fotos && it.fotos.length) {
            tableRows.push(`<tr class="orc-prev-table-fotos-row"><td colspan="2"><div class="orc-prev-fotos">${it.fotos.map((s) => `<img src="${s}">`).join("")}</div></td></tr>`);
          }
        }
      });
    });

    document.getElementById("orc-preview-wrap").innerHTML = `
      <div class="orc-prev-wrap">
        <div class="orc-prev-header">
          <img src="Lolek_logotipo_3.png" class="orc-prev-logo-img" alt="Lolek Viagens">
          <div class="orc-prev-contatos">${escapeHtml(LOLEK_EMAIL)}<br>${escapeHtml(LOLEK_TEL)}<br>${escapeHtml(LOLEK_END)}</div>
        </div>
        <div class="orc-prev-divider"></div>
        <div class="orc-prev-titulo">PROPOSTA PERSONALIZADA DE VIAGEM</div>
        <div class="orc-prev-subtitulo">Para: <strong>${escapeHtml(d.nome)}</strong> &nbsp;·&nbsp; ${escapeHtml(paxStr)}</div>
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
          </tfoot>
        </table>
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
  async function baixarPDF() {
    const d = window._orcDados;
    if (!d || !window.jspdf) { alert("Biblioteca de PDF não carregada. Use Ctrl+P para imprimir."); return; }

    pdfBtn.disabled = true; pdfBtn.textContent = "⏳ Gerando...";
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 210, H = 297, ML = 12, MR = 12, usableW = W - ML - MR;
      let y = 12;

      function checkPage(n = 20) { if (y + n > H - 18) { doc.addPage(); y = 14; } }

      doc.setFontSize(15); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
      doc.text("Lolek Viagens", ML, y + 7);
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
      doc.text(LOLEK_EMAIL, W - MR, y + 3, { align: "right" });
      doc.text(LOLEK_TEL,   W - MR, y + 8, { align: "right" });
      doc.text(LOLEK_END,   W - MR, y + 13, { align: "right" });
      y += 20;

      doc.setDrawColor(201, 168, 76); doc.setLineWidth(0.8); doc.line(ML, y, W - MR, y); y += 7;
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
      doc.text("PROPOSTA PERSONALIZADA DE VIAGEM", W / 2, y, { align: "center" }); y += 5;
      const paxStr = d.adultos + " adulto" + (d.adultos !== 1 ? "s" : "") +
        (d.criancas > 0 ? " + " + d.criancas + " criança" + (d.criancas !== 1 ? "s" : "") : "") +
        (d.bebes    > 0 ? " + " + d.bebes    + " bebê"    + (d.bebes    !== 1 ? "s"    : "") : "");
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
      doc.text("Para: " + d.nome + "   ·   " + paxStr, W / 2, y, { align: "center" }); y += 10;

      function drawBloco(label, periodo, itens) {
        checkPage(25);
        doc.setFillColor(10, 31, 61); doc.rect(ML, y, usableW, 8, "F");
        doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255);
        doc.text(label, ML + 3, y + 5.5);
        if (periodo) {
          doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
          doc.text(periodo, W - MR - 2, y + 5.5, { align: "right" });
        }
        y += 8;

        itens.forEach((it, j) => {
          if (it.tipo === "passagem") {
            // Monta linha de info de voo (sem dados internos)
            const metaParts = [
              it.companhia && it.voo ? it.companhia + " " + it.voo : (it.companhia || it.voo || ""),
              it.partida && it.chegada ? it.partida + " → " + it.chegada : (it.partida || it.chegada || ""),
              it.conexoes || "",
              it.duracao  || "",
            ].filter(Boolean);
            const metaLine = metaParts.join("  ·  ");

            const nomeLine = "✈ " + (it.nomeItem || "Passagem aérea");
            const linhasNome = doc.splitTextToSize(nomeLine, usableW - 50);
            const linhasMeta = metaLine ? doc.splitTextToSize(metaLine, usableW - 50) : [];
            const paxLabel   = it.adultos + " adulto" + (it.adultos !== 1 ? "s" : "");

            const passH = Math.max(10, linhasNome.length * 4.5 + linhasMeta.length * 3.5 + 4);
            const taxaH = it.taxaEmbarque > 0 ? 6 : 0;
            checkPage(passH + taxaH + 2);

            // Linha da passagem
            if (j % 2 === 0) { doc.setFillColor(243, 244, 246); doc.rect(ML, y, usableW, passH, "F"); }
            doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(ML, y + passH, W - MR, y + passH);

            let iy = y + 4;
            doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(17, 24, 39);
            doc.text(linhasNome, ML + 3, iy); iy += linhasNome.length * 4.5;
            if (linhasMeta.length) {
              doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
              doc.text(linhasMeta, ML + 3, iy);
            }
            doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
            doc.text("Passagem (" + paxLabel + ")", W - MR - 2 - 30, y + 4, { align: "left" });
            doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
            doc.text(fBRL(it.totalPassagem), W - MR - 2, y + 5.5, { align: "right" });
            y += passH;

            // Linha da taxa de embarque (se houver)
            if (it.taxaEmbarque > 0) {
              doc.setFillColor(249, 250, 251); doc.rect(ML, y, usableW, 6, "F");
              doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
              doc.text("   Taxa de embarque (" + paxLabel + ")", ML + 3, y + 4);
              doc.text(fBRL(it.taxaEmbarque * it.adultos), W - MR - 2, y + 4, { align: "right" });
              doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(ML, y + 6, W - MR, y + 6);
              y += 6;
            }
          } else {
            // Produtos normais
            const linhasNome = doc.splitTextToSize(it.nomeItem || "", usableW - 40);
            const linhasDesc = it.desc ? doc.splitTextToSize(it.desc, usableW - 40) : [];
            const nFotos     = (it.fotos || []).length;
            const fotoH      = nFotos > 0 ? Math.ceil(nFotos / 3) * 22 + 4 : 0;
            const rowH       = Math.max(10, linhasNome.length * 4 + linhasDesc.length * 3.5 + fotoH + 4);
            checkPage(rowH + 2);

            if (j % 2 === 0) { doc.setFillColor(243, 244, 246); doc.rect(ML, y, usableW, rowH, "F"); }
            doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(ML, y + rowH, W - MR, y + rowH);

            let iy = y + 4;
            doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(17, 24, 39);
            doc.text(linhasNome, ML + 3, iy); iy += linhasNome.length * 4;
            if (linhasDesc.length) {
              doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
              doc.text(linhasDesc, ML + 3, iy); iy += linhasDesc.length * 3.5;
            }
            if (nFotos > 0) {
              let fx = ML + 3, fy = iy + 1;
              for (let k = 0; k < Math.min(nFotos, 6); k++) {
                try { doc.addImage(it.fotos[k], "JPEG", fx, fy, 20, 15); }
                catch { try { doc.addImage(it.fotos[k], "PNG", fx, fy, 20, 15); } catch {} }
                fx += 22; if (fx > W - MR - 20) { fx = ML + 3; fy += 17; }
              }
            }
            doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
            doc.text(fBRL(it.venda), W - MR - 2, y + 5.5, { align: "right" }); y += rowH;
          }
        });
        y += 5;
      }

      d.destsData.forEach((dest, i) => drawBloco((i + 1) + ". " + dest.nome, dest.periodo, dest.itens));

      // Subtotais
      checkPage(45);
      doc.setFillColor(243, 244, 246); doc.rect(ML, y, usableW, 6, "F");
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(107, 114, 128);
      doc.text("RESUMO", ML + 3, y + 4); doc.text("SUBTOTAL", W - MR - 2, y + 4, { align: "right" }); y += 6;
      d.destsData.forEach((dest, i) => {
        if (i % 2 === 0) { doc.setFillColor(243, 244, 246); doc.rect(ML, y, usableW, 6, "F"); }
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(75, 85, 99);
        doc.text((i + 1) + ". " + dest.nome, ML + 3, y + 4);
        doc.text(fBRL(dest.totalDest), W - MR - 2, y + 4, { align: "right" });
        doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(ML, y + 6, W - MR, y + 6); y += 6;
      });

      y += 3;
      doc.setDrawColor(201, 168, 76); doc.setLineWidth(0.8); doc.line(ML, y, W - MR, y); y += 1;
      doc.setFillColor(243, 244, 246); doc.rect(ML, y, usableW, 7, "F");
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
      doc.text("Por pessoa (" + d.adultos + " adulto" + (d.adultos !== 1 ? "s" : "") + ")", ML + 3, y + 5);
      doc.text(fBRL(d.porPessoa), W - MR - 2, y + 5, { align: "right" }); y += 7;
      doc.setFillColor(10, 31, 61); doc.rect(ML, y, usableW, 10, "F");
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(201, 168, 76);
      doc.text("VALOR TOTAL", ML + 3, y + 7); doc.text(fBRL(d.totalGeral), W - MR - 2, y + 7, { align: "right" }); y += 14;

      checkPage(18);
      doc.setFillColor(253, 248, 238); doc.setDrawColor(201, 168, 76); doc.setLineWidth(0.4);
      doc.rect(ML, y, usableW, 14, "FD");
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
      doc.text("FORMAS DE PAGAMENTO", ML + 3, y + 5);
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
      doc.text("◆ PIX     ▬ Cartão de crédito em até 12x (mediante taxas)", ML + 3, y + 10); y += 18;

      if (d.obs) {
        checkPage(20);
        const lo = doc.splitTextToSize(d.obs, usableW - 6);
        const oh = lo.length * 4 + 10;
        doc.setFillColor(253, 248, 238); doc.setDrawColor(201, 168, 76); doc.setLineWidth(0.4);
        doc.rect(ML, y, usableW, oh, "FD");
        doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
        doc.text("OBSERVAÇÕES", ML + 3, y + 5);
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.text(lo, ML + 3, y + 10); y += oh + 4;
      }

      const total = doc.getNumberOfPages();
      for (let pg = 1; pg <= total; pg++) {
        doc.setPage(pg);
        doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.3); doc.line(ML, H - 16, W - MR, H - 16);
        doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(107, 114, 128);
        doc.text("Lolek Viagens  ·  " + LOLEK_TEL + "  ·  " + LOLEK_EMAIL, W / 2, H - 11, { align: "center" });
        doc.text("Este orçamento não possui validade fixa — valores sujeitos à disponibilidade no momento da emissão.", W / 2, H - 6, { align: "center" });
      }
      doc.save("Orcamento_Lolek_" + d.nome.replace(/\s+/g, "_") + ".pdf");
    } finally {
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
      dest.itens.forEach((it) => {
        if (it.tipo === "passagem") {
          txt += "   ✈ " + it.nomeItem;
          const meta = [
            it.companhia && it.voo ? it.companhia + " " + it.voo : (it.companhia || it.voo || ""),
            it.partida && it.chegada ? it.partida + " → " + it.chegada : (it.partida || it.chegada || ""),
            it.conexoes || "",
            it.duracao  || "",
          ].filter(Boolean).join(" · ");
          if (meta) txt += " — " + meta;
          txt += "\n";
          txt += "     Passagem: " + fBRL(it.totalPassagem) + "\n";
          if (it.taxaEmbarque > 0) txt += "     Taxa de embarque: " + fBRL(it.taxaEmbarque * it.adultos) + "\n";
        } else {
          txt += "   • " + it.nomeItem + (it.desc ? " — " + it.desc : "") + ": " + fBRL(it.venda) + "\n";
        }
      });
      txt += "   Subtotal: " + fBRL(dest.totalDest) + "\n\n";
    });
    txt += "Por pessoa: " + fBRL(d.porPessoa) + "\n💰 Total: " + fBRL(d.totalGeral) + "\n";
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
    const keyEl = document.getElementById("orc-ia-key");
    const modEl = document.getElementById("orc-ia-model");
    const key   = keyEl?.value.trim() || "";
    const model = modEl?.value || "claude-haiku-4-5-20251001";

    if (key) localStorage.setItem(LS_KEY, key);
    else localStorage.removeItem(LS_KEY);
    localStorage.setItem(LS_MODEL, model);

    fecharConfigIA();

    // Atualiza visual do botão de configuração
    const cfgBtn = document.getElementById("orc-ia-cfg-btn");
    if (cfgBtn) cfgBtn.textContent = key ? "⚙ IA configurada ✓" : "⚙ Configurar IA";

    // Se havia callback (ex: acionar análise após configurar), executa agora
    const modal = document.getElementById("orc-ia-modal");
    if (modal?._onSaved && key) { const cb = modal._onSaved; modal._onSaved = null; cb(); }
  });

  // ===== Início =====
  addDestino();

  // Reflete estado da chave no botão ao carregar
  (function() {
    const cfgBtn = document.getElementById("orc-ia-cfg-btn");
    if (cfgBtn && getApiKey()) cfgBtn.textContent = "⚙ IA configurada ✓";
  })();
})();
