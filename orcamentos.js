// ===== Orçamentos — Lolek Viagens =====
// Passagem aérea é um produto adicionável como qualquer outro.
// Cada destino pode ter múltiplos produtos de qualquer tipo.
(function () {
  "use strict";

  const LOLEK_TEL   = "(85) 99632-7092";
  const LOLEK_EMAIL = "thaynara@agencialolekviagens.com.br";
  const LOLEK_END   = "Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE";

  // ===== Configuração dos produtos =====
  // "passagem" é tipo especial: venda = valor_pax × adultos
  const PROD_CFG = {
    passagem: {
      label: "Passagem aérea", icon: "✈️",
      fields: [
        { id: "trecho",    label: "Trecho",             type: "text",   placeholder: "Ex: FOR → LIS", cols: 2 },
        { id: "companhia", label: "Companhia",           type: "text",   placeholder: "Ex: LATAM",    cols: 1 },
        { id: "conexoes",  label: "Conexões / Escalas", type: "text",   placeholder: "Voo direto",   cols: 1 },
        { id: "duracao",   label: "Duração",             type: "text",   placeholder: "Ex: 9h30",     cols: 1 },
        { id: "milhas",    label: "Qtd. milhas",         type: "number", placeholder: "Ex: 60000",    cols: 1 },
        { id: "milheiro",  label: "Valor milheiro (R$)", type: "number", placeholder: "Ex: 18",       cols: 1, step: "0.01" },
        { id: "markup",    label: "Markup / pessoa (R$)",type: "number", placeholder: "Ex: 200",      cols: 1, step: "0.01" },
        { id: "valor_pax", label: "Valor / pessoa (R$) ★", type: "number", placeholder: "Calculado ou manual", cols: 1, step: "0.01" },
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

  // ===== Cálculo milhas (para produtos de passagem) =====
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

      // Produtos
      const prodHtml = dest.produtos.map((p) => {
        const cfg = PROD_CFG[p.tipo];
        const isPassagem = p.tipo === "passagem";

        const fieldsHtml = cfg.fields.map((f) => {
          const span = f.cols === 2 ? "grid-column:span 2;" : "";
          let inp;
          if (f.type === "select") {
            const opts = (f.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join("");
            inp = `<select id="${dest.id}-${p.pid}-${f.id}" class="input"><option value=""></option>${opts}</select>`;
          } else {
            const step = f.step ? `step="${f.step}"` : f.type === "number" ? 'step="0.01"' : "";
            inp = `<input id="${dest.id}-${p.pid}-${f.id}" type="${f.type}" class="input" placeholder="${escapeHtml(f.placeholder||"")}" ${step}>`;
          }
          // Destaca o campo valor/pessoa da passagem
          const extra = (isPassagem && f.id === "valor_pax") ? " orc-field--highlight" : "";
          return `<label class="field${extra}" style="${span}"><span class="field__label">${escapeHtml(f.label)}</span>${inp}</label>`;
        }).join("");

        // Hint de milhas só para passagem
        const milhasHint = isPassagem
          ? `<p class="orc-milhas-hint" style="margin-top:10px;grid-column:1/-1">Milhas ÷ 1000 × valor milheiro + markup = valor por pessoa</p>`
          : "";

        const zoneId = "fotozone-" + p.pid;
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
                ${milhasHint}
              </div>
              <div class="orc-foto-zone" id="${zoneId}" tabindex="0">
                <span class="orc-foto-hint">📷 Cole (Ctrl+V), arraste ou clique para adicionar fotos</span>
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

          ${dest.produtos.length > 0 ? `<div id="orc-produtos-${dest.id}">${prodHtml}</div>` : `<div id="orc-produtos-${dest.id}"></div>`}

          <div class="orc-add-prod-label">Adicionar serviço</div>
          <div class="orc-prod-toggles">${togglesHtml}</div>
        </div>`;

      destinosList.appendChild(div);

      // Restaura valores
      Object.entries(saved).forEach(([id, val]) => { const e = document.getElementById(id); if (e) e.value = val; });

      // Eventos da cidade (atualiza nome no header)
      const nomeIn = div.querySelector("#o-nome-" + dest.id);
      nomeIn?.addEventListener("input", () => {
        const d = document.getElementById("o-nome-display-" + dest.id);
        if (d) d.textContent = nomeIn.value || "Destino " + (idx + 1);
      });

      // Eventos de datas
      div.querySelector("#o-ci-" + dest.id)?.addEventListener("change", () => calcNoites(dest.id));
      div.querySelector("#o-co-" + dest.id)?.addEventListener("change", () => calcNoites(dest.id));

      // Delegação dos botões de remover e adicionar
      div.querySelectorAll(".orc-destino-remove").forEach((b) => b.addEventListener("click", () => removeDestino(b.dataset.dest)));
      div.querySelectorAll(".orc-produto-remove").forEach((b) => b.addEventListener("click", () => removeProduto(b.dataset.dest, b.dataset.pid)));
      div.querySelectorAll(".orc-prod-toggle").forEach((b) => b.addEventListener("click", () => addProduto(b.dataset.dest, b.dataset.tipo)));

      // Fotos e cálculo de milhas
      dest.produtos.forEach((p) => {
        const zoneId = "fotozone-" + p.pid;
        setupFotoZone(p.pid, zoneId);
        renderFotos(p.pid, zoneId);
        if (p.tipo === "passagem") bindMilhasCalc(dest.id, p.pid);
      });

      calcNoites(dest.id);
    });
  }

  // ===== Fotos =====
  function setupFotoZone(pid, zoneId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener("paste", (e) => {
      for (const item of (e.clipboardData?.items || []))
        if (item.type.startsWith("image/")) readFoto(pid, item.getAsFile(), zoneId);
    });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("dragover");
      for (const f of (e.dataTransfer?.files || []))
        if (f.type.startsWith("image/")) readFoto(pid, f, zoneId);
    });
    zone.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.onchange = () => { for (const f of inp.files) readFoto(pid, f, zoneId); };
      inp.click();
    });
  }

  function readFoto(pid, file, zoneId) {
    const r = new FileReader();
    r.onload = (e) => {
      if (!fotoStore[pid]) fotoStore[pid] = [];
      fotoStore[pid].push({ fid: "f" + Date.now() + Math.random().toString(36).slice(2), src: e.target.result });
      renderFotos(pid, zoneId);
    };
    r.readAsDataURL(file);
  }

  function removeFoto(pid, fid, zoneId) {
    fotoStore[pid] = (fotoStore[pid] || []).filter((f) => f.fid !== fid);
    renderFotos(pid, zoneId);
  }

  function renderFotos(pid, zoneId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    let prev = zone.querySelector(".orc-fotos-preview");
    if (!prev) { prev = document.createElement("div"); prev.className = "orc-fotos-preview"; zone.appendChild(prev); }
    prev.innerHTML = (fotoStore[pid] || []).map((f) =>
      `<div class="orc-foto-thumb"><img src="${f.src}"><button class="orc-foto-rm" data-pid="${pid}" data-fid="${f.fid}" data-zone="${zoneId}">✕</button></div>`
    ).join("");
    prev.querySelectorAll(".orc-foto-rm").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); removeFoto(b.dataset.pid, b.dataset.fid, b.dataset.zone); })
    );
  }

  // ===== Coleta de dados =====
  function coletarDados() {
    const adultos  = parseInt(gV("o-adultos")) || 2;
    const criancas = parseInt(gV("o-criancas")) || 0;
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

      dest.produtos.forEach((p) => {
        const cfg = PROD_CFG[p.tipo];
        let nomeItem = cfg.label, desc = "", venda = 0;

        if (p.tipo === "passagem") {
          const valorPax = gN(dest.id + "-" + p.pid + "-valor_pax");
          venda = valorPax * adultos;
          nomeItem = gV(dest.id + "-" + p.pid + "-trecho") || "Passagem aérea";
          const info = [
            gV(dest.id + "-" + p.pid + "-companhia"),
            gV(dest.id + "-" + p.pid + "-conexoes"),
            gV(dest.id + "-" + p.pid + "-duracao"),
          ].filter(Boolean).join(" · ");
          const milhas = gN(dest.id + "-" + p.pid + "-milhas");
          const milheiroV = gN(dest.id + "-" + p.pid + "-milheiro");
          desc = [info, milhas ? milhas.toLocaleString("pt-BR") + " milhas · R$ " + milheiroV + "/milh." : ""].filter(Boolean).join(" · ");
          // Metadado extra para o preview
          itens.push({ nomeItem, desc, venda, fotos: (fotoStore[p.pid] || []).map((f) => f.src), tipo: "passagem", valorPax, adultos });
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
    return { nome, roteiro, adultos, criancas, obs, totalGeral, destsData, porPessoa: totalGeral / (adultos || 1) };
  }

  // ===== Preview =====
  function gerarOrcamento() {
    if (destinos.length === 0) { alert("Adicione pelo menos um destino."); return; }

    const d = coletarDados();
    const paxStr = d.adultos + " adulto" + (d.adultos !== 1 ? "s" : "") +
      (d.criancas > 0 ? " + " + d.criancas + " criança" + (d.criancas !== 1 ? "s" : "") : "");

    const destsHtml = d.destsData.map((dest, i) => {
      const itensHtml = dest.itens.map((it, j) => {
        const passDetalhe = it.tipo === "passagem"
          ? `<div class="orc-prev-item-desc">Por adulto: ${fBRL(it.valorPax)} × ${it.adultos} = ${fBRL(it.venda)}</div>`
          : "";
        return `
          <div class="orc-prev-item${j % 2 === 1 ? " orc-prev-item--alt" : ""}">
            <div>
              <div class="orc-prev-item-nome">${escapeHtml(it.nomeItem)}</div>
              ${it.desc ? `<div class="orc-prev-item-desc">${escapeHtml(it.desc)}</div>` : ""}
              ${passDetalhe}
              ${it.fotos.length ? `<div class="orc-prev-fotos">${it.fotos.map((s) => `<img src="${s}">`).join("")}</div>` : ""}
            </div>
            <div class="orc-prev-item-valor">${fBRL(it.venda)}</div>
          </div>`;
      }).join("");

      return `
        <div class="orc-prev-destino">
          <div class="orc-prev-dest-header">
            <span>${i + 1}. ${escapeHtml(dest.nome)}</span>
            ${dest.periodo ? `<span class="orc-prev-dest-periodo">${escapeHtml(dest.periodo)}</span>` : ""}
          </div>
          <div class="orc-prev-col-header"><span>Descrição</span><span>Valor</span></div>
          ${itensHtml || '<div class="orc-prev-empty">Nenhum serviço adicionado</div>'}
        </div>`;
    }).join("");

    const subHtml = d.destsData.map((dest, i) => `
      <div class="orc-prev-sub-row${i % 2 === 0 ? " orc-prev-sub-row--alt" : ""}">
        <span>${i + 1}. ${escapeHtml(dest.nome)}</span>
        <span>${fBRL(dest.totalDest)}</span>
      </div>`).join("");

    document.getElementById("orc-preview-wrap").innerHTML = `
      <div class="orc-prev-wrap">
        <div class="orc-prev-header">
          <div class="orc-prev-logo">
            <div class="orc-prev-logo-mark">LV</div>
            <div>
              <div class="orc-prev-logo-nome">Lolek Viagens</div>
              <div class="orc-prev-logo-sub">agência de viagens</div>
            </div>
          </div>
          <div class="orc-prev-contatos">${escapeHtml(LOLEK_EMAIL)}<br>${escapeHtml(LOLEK_TEL)}<br>${escapeHtml(LOLEK_END)}</div>
        </div>
        <div class="orc-prev-divider"></div>
        <div class="orc-prev-titulo">PROPOSTA PERSONALIZADA DE VIAGEM</div>
        <div class="orc-prev-subtitulo">Para: <strong>${escapeHtml(d.nome)}</strong> &nbsp;·&nbsp; ${escapeHtml(paxStr)}</div>
        ${destsHtml}
        <div class="orc-prev-sub-header"><span>Resumo por destino</span><span>Subtotal</span></div>
        ${subHtml}
        <div class="orc-prev-por-pessoa">
          <span>Por pessoa (${d.adultos} adulto${d.adultos !== 1 ? "s" : ""})</span>
          <span>${fBRL(d.porPessoa)}</span>
        </div>
        <div class="orc-prev-total">
          <span class="orc-prev-total-lbl">VALOR TOTAL</span>
          <span class="orc-prev-total-val">${fBRL(d.totalGeral)}</span>
        </div>
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
        (d.criancas > 0 ? " + " + d.criancas + " criança" + (d.criancas !== 1 ? "s" : "") : "");
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
        doc.setFillColor(243, 244, 246); doc.rect(ML, y, usableW, 6, "F");
        doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(107, 114, 128);
        doc.text("DESCRIÇÃO", ML + 3, y + 4); doc.text("VALOR", W - MR - 2, y + 4, { align: "right" }); y += 6;

        itens.forEach((it, j) => {
          const linhasNome = doc.splitTextToSize(it.nomeItem || "", usableW - 40);
          const descFull   = it.tipo === "passagem" && it.valorPax
            ? [it.desc, "Por adulto: " + fBRL(it.valorPax) + " × " + it.adultos].filter(Boolean).join(" | ")
            : it.desc;
          const linhasDesc = descFull ? doc.splitTextToSize(descFull, usableW - 40) : [];
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
            doc.text(linhasDesc, ML + 3, iy);
          }
          if (nFotos > 0) {
            let fx = ML + 3, fy = iy + linhasDesc.length * 3.5 + 1;
            for (let k = 0; k < Math.min(nFotos, 6); k++) {
              try { doc.addImage(it.fotos[k], "JPEG", fx, fy, 20, 15); }
              catch { try { doc.addImage(it.fotos[k], "PNG", fx, fy, 20, 15); } catch {} }
              fx += 22; if (fx > W - MR - 20) { fx = ML + 3; fy += 17; }
            }
          }
          doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(10, 31, 61);
          doc.text(fBRL(it.venda), W - MR - 2, y + 5.5, { align: "right" }); y += rowH;
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
    txt += "\n\n";
    d.destsData.forEach((dest, i) => {
      txt += "📍 " + (i + 1) + ". " + dest.nome + (dest.periodo ? " (" + dest.periodo + ")" : "") + "\n";
      dest.itens.forEach((it) => {
        txt += "   • " + it.nomeItem + (it.desc ? " — " + it.desc : "");
        if (it.tipo === "passagem" && it.valorPax) txt += " (R$ " + it.valorPax.toFixed(2) + "/pessoa)";
        txt += ": " + fBRL(it.venda) + "\n";
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

  // ===== Início =====
  addDestino();
})();
