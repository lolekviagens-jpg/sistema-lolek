// ===== Dashboard de Vendas — Lolek Viagens =====
(function () {
  "use strict";

  const SHEET_ID  = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv";
  const CFG_KEY   = "lolek_vendas_cfg2";

  const COL_SITUACAO    = 1;  // coluna B — tipo de produto
  const COL_FUNC        = 2;  // coluna C — nome da funcionária
  const COL_LEAD        = 3;  // coluna D — origem do lead (Shalom, Orgânico, Corporativo, Convenção...)
  const COL_SEP         = 4;  // coluna E — separador de mês (ex: "junho")
  const COL_VALOR_TOTAL = 14; // coluna O — valor total (faturamento)
  const COL_LUCRO       = 15; // coluna P — lucro

  const MESES_PT    = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const MESES_LABEL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  // ===== Utilitários =====
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fBRL(v) {
    return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fPct(v) { return v.toFixed(1).replace(".", ",") + "%"; }
  function gel(id) { return document.getElementById(id); }

  function parseNum(s) {
    const str = String(s || "").replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  function detectaMes(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return -1;
    return MESES_PT.findIndex(m => t === m || t.startsWith(m + " ") || t.endsWith(" " + m) || t.includes(" " + m + " "));
  }

  // Classifica produto pela coluna B
  function tipoProduto(situacao) {
    const s = (situacao || "").toLowerCase().trim();
    if (!s) return null;
    if (s === "aguardando viagem" || s === "viagem concluida") return "Passagem aérea";
    if (s.includes("hospedagem"))   return "Hospedagem";
    if (s.includes("seguro"))       return "Seguro viagem";
    if (s.includes("mala"))         return "Adicional de mala";
    // Capitaliza primeira letra do valor original
    return situacao.trim().charAt(0).toUpperCase() + situacao.trim().slice(1);
  }

  // Comissão: 5% sobre tudo enquanto não bate a meta; 10% sobre tudo ao bater
  function calcComissao(total, meta) {
    const bateuMeta = meta > 0 && total >= meta;
    const taxa      = bateuMeta ? 10 : 5;
    return {
      valor: total * (taxa / 100),
      taxa,
      bateuMeta,
      excedente: bateuMeta ? total - meta : 0,
    };
  }

  // ===== Dias úteis =====
  function diasUteisRestantes() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), hoje = now.getDate();
    const ultimo = new Date(y, m + 1, 0).getDate();
    let count = 0;
    for (let d = hoje; d <= ultimo; d++) {
      const dow = new Date(y, m, d).getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }

  // ===== CSV parser =====
  function parseCsv(text) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ===== Processa planilha =====
  function processaLinhas(rows) {
    const now = new Date();
    const currentMonth = now.getMonth();

    const separadores = [];
    rows.forEach((cols, i) => {
      const sep = (cols[COL_SEP] || "").trim();
      const m = detectaMes(sep);
      if (m >= 0) separadores.push({ rowIdx: i, month: m });
    });

    if (separadores.length === 0) return { porFunc: {}, month: currentMonth, year: now.getFullYear(), aviso: "sem-separador" };

    let sep = separadores.find(s => s.month === currentMonth);
    if (!sep) sep = separadores[separadores.length - 1];

    const proxSep = separadores.find(s => s.rowIdx > sep.rowIdx);
    const fim     = proxSep ? proxSep.rowIdx : rows.length;

    const linhasMes = rows.slice(sep.rowIdx + 1, fim);

    // porFunc[nome] = { total, count, produtos: { tipo: n } }
    const porFunc      = {};
    const produtosTotal = {};
    const leadsPassagem = {};
    let faturamento = 0, lucroTotal = 0;

    linhasMes.forEach(cols => {
      // Linhas de subtotal/resumo (ex: totalizador antes do separador do próximo mês)
      // não têm situação preenchida — só o valor numérico na coluna de funcionária.
      const situacao = (cols[COL_SITUACAO] || "").trim();
      if (!situacao) return;

      const func  = (cols[COL_FUNC] || "").trim();
      if (!func) return;

      const lucro = parseNum(cols[COL_LUCRO]);
      const valor = parseNum(cols[COL_VALOR_TOTAL]);
      const tipo  = tipoProduto(situacao);

      // Venda conjunta (ex: "Letícia/Emily") — divide o lucro entre as funcionárias listadas,
      // mas cada uma leva o crédito cheio de "1 produto vendido" (pra meta/comissão de cada uma
      // refletir o trabalho, sem inventar 0,5 produto no card de cada uma).
      const nomesFunc = func.split("/").map(n => n.trim()).filter(Boolean);
      nomesFunc.forEach(nome => {
        if (!porFunc[nome]) porFunc[nome] = { total: 0, count: 0, produtos: {} };
        porFunc[nome].total += lucro / nomesFunc.length;
        porFunc[nome].count++;
        if (tipo) porFunc[nome].produtos[tipo] = (porFunc[nome].produtos[tipo] || 0) + 1;
      });
      if (tipo) produtosTotal[tipo] = (produtosTotal[tipo] || 0) + 1;

      faturamento += valor;
      lucroTotal  += lucro;

      if (tipo === "Passagem aérea") {
        const lead = (cols[COL_LEAD] || "").trim() || "Não informado";
        leadsPassagem[lead] = (leadsPassagem[lead] || 0) + 1;
      }
    });

    return { porFunc, produtosTotal, leadsPassagem, faturamento, lucroTotal, month: sep.month, year: now.getFullYear() };
  }

  // ===== Configuração (metas) =====
  let cfg = { funcs: [], metas: {} };

  async function fetchCfgRemoto() {
    const resp = await fetch("/.netlify/functions/vendas-config");
    if (!resp.ok) throw new Error("Erro ao buscar configuração");
    return await resp.json();
  }

  async function salvarCfgRemoto(valorCfg) {
    const resp = await fetch("/.netlify/functions/vendas-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valor: valorCfg }),
    });
    if (!resp.ok) throw new Error("Erro ao salvar configuração");
  }

  // Carrega a config do Supabase (sincroniza entre computadores). Se ainda não existir remotamente,
  // migra a config antiga do localStorage desse navegador uma única vez.
  async function carregarCfg() {
    let remoto = null;
    try { remoto = await fetchCfgRemoto(); } catch { /* segue pro fallback local */ }

    if (remoto) { cfg = remoto; return; }

    let local = null;
    try { local = JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch {}
    if (local && (local.funcs?.length || Object.keys(local.metas || {}).length)) {
      cfg = local;
      try { await salvarCfgRemoto(cfg); } catch { /* tenta de novo no próximo salvamento */ }
    } else {
      cfg = { funcs: [], metas: {} };
    }
  }

  function chaveAtual() {
    const n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0");
  }

  // ===== Render principal =====
  let ultimoDado = null;

  function render(data) {
    if (data) ultimoDado = data;
    const d = ultimoDado;
    if (!d) return;

    gel("vendas-mes-label").textContent = MESES_LABEL[d.month] + " " + d.year;

    const diasR = diasUteisRestantes();
    gel("vendas-dias-uteis").textContent = diasR + " dia" + (diasR !== 1 ? "s úteis" : " útil") + " restante" + (diasR !== 1 ? "s" : "") + " no mês";

    const chave = d.year + "-" + String(d.month + 1).padStart(2, "0");
    const metas = cfg.metas[chave] || {};

    // Lucro total da empresa no mês — precisa ser o mesmo valor do card "Lucro" (todas as vendas),
    // não só a soma das funcionárias cadastradas em Metas (senão vendas conjuntas como "Letícia/Emily"
    // na planilha, que não batem com nenhum nome cadastrado, ficam de fora do total da empresa).
    const totalGeral = d.lucroTotal || 0;

    const metaEmp  = metas._empresa || 0;
    const pctEmp   = metaEmp > 0 ? Math.min(100, (totalGeral / metaEmp) * 100) : 0;
    const faltaEmp = Math.max(0, metaEmp - totalGeral);
    const sugEmp   = diasR > 0 && faltaEmp > 0 ? faltaEmp / diasR : 0;

    gel("vendas-empresa-total").textContent = fBRL(totalGeral);
    gel("vendas-empresa-meta").textContent  = metaEmp > 0 ? fBRL(metaEmp) : "Meta não definida";
    gel("vendas-empresa-pct").textContent   = metaEmp > 0 ? pctEmp.toFixed(0) + "%" : "";

    const fill = gel("vendas-empresa-bar");
    fill.style.width = pctEmp + "%";
    fill.className   = "vendas-bar__fill" + (pctEmp >= 100 ? " vendas-bar__fill--ok" : pctEmp >= 70 ? " vendas-bar__fill--warn" : "");

    const sugEl = gel("vendas-empresa-sugestao");
    if (metaEmp > 0) {
      sugEl.innerHTML = faltaEmp > 0
        ? "Faltam <strong>" + fBRL(faltaEmp) + "</strong>" + (diasR > 0 ? " &nbsp;·&nbsp; sugestão: <strong>" + fBRL(sugEmp) + "/dia útil</strong>" : "")
        : '<span class="vendas-meta-ok">✅ Meta da empresa atingida!</span>';
    } else {
      sugEl.innerHTML = "";
    }

    renderStats(d);
    renderProdutos(d);
    renderLeads(d);
    renderFuncs(d, metas, diasR);
  }

  // ===== Faturamento / lucro / margem =====
  function renderStats(d) {
    const faturamento = d.faturamento || 0;
    const lucro       = d.lucroTotal  || 0;
    const margem      = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    gel("vendas-stat-faturamento").textContent = fBRL(faturamento);
    gel("vendas-stat-lucro").textContent       = fBRL(lucro);
    gel("vendas-stat-margem").textContent      = fPct(margem);
  }

  // ===== Produtos vendidos no mês (todas as funcionárias) =====
  const PRODUTO_ICONS = {
    "Passagem aérea":     "✈️",
    "Hospedagem":         "🏨",
    "Seguro viagem":      "🛡️",
    "Adicional de mala":  "🧳",
  };

  function renderProdutos(d) {
    const grid  = gel("vendas-produtos-grid");
    const prods = Object.entries(d.produtosTotal || {}).sort((a, b) => b[1] - a[1]);

    if (prods.length === 0) {
      grid.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhum produto vendido neste mês</p></div>`;
      return;
    }

    grid.innerHTML = prods.map(([tipo, n]) => `
      <div class="vendas-prod-card">
        <div class="vendas-prod-icon">${PRODUTO_ICONS[tipo] || "📦"}</div>
        <div class="vendas-prod-num">${n}</div>
        <div class="vendas-prod-nome">${escHtml(tipo)}</div>
      </div>`).join("");
  }

  // ===== Origem das passagens (lead) =====
  const LEAD_CORES = ["#0a1f3d", "#c9a84c", "#1f8a4c", "#2563eb", "#b45309", "#7c3aed", "#be123c"];

  function renderLeads(d) {
    const box   = gel("vendas-leads-list");
    const leads = Object.entries(d.leadsPassagem || {}).sort((a, b) => b[1] - a[1]);
    const total = leads.reduce((s, [, n]) => s + n, 0);

    if (total === 0) {
      box.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma passagem vendida neste mês</p></div>`;
      return;
    }

    box.innerHTML = leads.map(([lead, n], i) => {
      const pct = (n / total) * 100;
      const cor = LEAD_CORES[i % LEAD_CORES.length];
      return `
        <div class="vendas-lead-row">
          <div class="vendas-lead-info">
            <span class="vendas-lead-nome">${escHtml(lead)}</span>
            <span class="vendas-lead-num">${n} · ${fPct(pct)}</span>
          </div>
          <div class="vendas-lead-bar">
            <div class="vendas-lead-bar__fill" style="width:${pct}%;background:${cor}"></div>
          </div>
        </div>`;
    }).join("");
  }

  function renderFuncs(d, metas, diasR) {
    const grid = gel("vendas-func-grid");
    if (cfg.funcs.length === 0) {
      grid.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma funcionária configurada</p><small>Clique em "⚙ Metas" para configurar</small></div>`;
      return;
    }
    grid.innerHTML = cfg.funcs.map(f => {
      const fd      = d.porFunc[f.nome] || { total: 0, count: 0, produtos: {} };
      const total   = fd.total;
      const count   = fd.count;
      const prods   = fd.produtos;
      const meta    = metas[f.nome] || 0;
      const pct     = meta > 0 ? Math.min(100, (total / meta) * 100) : 0;
      const falta   = Math.max(0, meta - total);
      const sug     = diasR > 0 && falta > 0 ? falta / diasR : 0;
      const barCls  = "vendas-bar__fill" + (pct >= 100 ? " vendas-bar__fill--ok" : pct >= 70 ? " vendas-bar__fill--warn" : "");
      const com     = calcComissao(total, meta);

      // Linha de progresso / meta
      let infoMeta = "";
      if (meta > 0) {
        if (falta > 0) {
          infoMeta = `
            <div class="vendas-bar" style="margin:10px 0 4px">
              <div class="${barCls}" style="width:${pct}%"></div>
            </div>
            <div class="vendas-func-pct">${pct.toFixed(0)}% de ${fBRL(meta)}</div>
            <div class="vendas-func-sugestao">
              Faltam <strong>${fBRL(falta)}</strong>
              ${diasR > 0 ? "&nbsp;·&nbsp; sugestão: <strong>" + fBRL(sug) + "/dia útil</strong>" : ""}
            </div>`;
        } else {
          const excPct = meta > 0 ? ((com.excedente / meta) * 100) : 0;
          infoMeta = `
            <div class="vendas-bar" style="margin:10px 0 4px">
              <div class="${barCls}" style="width:100%"></div>
            </div>
            <div class="vendas-func-pct vendas-meta-ok">✅ Meta atingida!</div>
            <div class="vendas-func-excedente">
              Superou em <strong>${fBRL(com.excedente)}</strong>
              &nbsp;·&nbsp; <strong>+${fPct(excPct)}</strong> acima da meta
            </div>`;
        }
      } else {
        infoMeta = `<div class="vendas-func-meta">Sem meta definida</div>`;
      }

      // Comissão
      const comissaoHtml = `
        <div class="vendas-func-comissao${com.bateuMeta ? " vendas-func-comissao--dupla" : ""}">
          <span class="vendas-comissao-label">💰 Comissão estimada <span class="vendas-comissao-taxa">(${com.taxa}%)</span></span>
          <span class="vendas-comissao-valor">${fBRL(com.valor)}</span>
        </div>`;

      // Produtos vendidos
      let prodsHtml = "";
      if (count > 0) {
        const tiposList = Object.entries(prods)
          .sort((a, b) => b[1] - a[1])
          .map(([tipo, n]) => `${n} ${escHtml(tipo.toLowerCase())}`)
          .join(" · ");
        prodsHtml = `
          <div class="vendas-func-produtos">
            <span class="vendas-prod-total">${count} produto${count !== 1 ? "s" : ""} vendido${count !== 1 ? "s" : ""}</span>
            ${tiposList ? `<span class="vendas-prod-lista">${tiposList}</span>` : ""}
          </div>`;
      }

      return `
        <div class="vendas-func-card">
          <div class="vendas-func-nome">${escHtml(f.nome)}</div>
          <div class="vendas-func-valor">${fBRL(total)}</div>
          ${infoMeta}
          ${comissaoHtml}
          ${prodsHtml}
        </div>`;
    }).join("");
  }

  // ===== Busca a planilha =====
  async function fetchSheet() {
    const statusEl = gel("vendas-status");
    const btn      = gel("vendas-refresh-btn");
    if (btn) btn.disabled = true;
    statusEl.innerHTML = `<div class="notice">Carregando planilha…</div>`;

    try {
      const resp = await fetch(SHEET_URL + "&t=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      const data = processaLinhas(parseCsv(text));

      if (data.aviso === "sem-separador") {
        statusEl.innerHTML = `<div class="notice notice--error"><strong>Separadores de mês não encontrados.</strong><p>Adicione uma linha com o nome do mês (ex: "junho") na coluna E da planilha para cada mês.</p></div>`;
        return;
      }

      statusEl.innerHTML = "";
      gel("vendas-updated").textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      render(data);
    } catch (e) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao carregar planilha.</strong><p>${escHtml(e.message)}</p></div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ===== Modal de metas =====
  function abrirMetas() {
    const chave = chaveAtual();
    const metas = cfg.metas[chave] || {};
    gel("metas-meta-emp").value = metas._empresa || "";
    renderMetasFuncs(chave, metas);
    gel("metas-modal").hidden = false;
  }

  function renderMetasFuncs(chave, metas) {
    const box = gel("metas-funcs");
    if (cfg.funcs.length === 0) {
      box.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">Nenhuma funcionária ainda.</p>`;
      return;
    }
    box.innerHTML = cfg.funcs.map(f => `
      <div class="vendas-cfg-row" data-id="${f.id}">
        <input type="text" class="input vcfg-nome" value="${escHtml(f.nome)}" placeholder="Nome exato da planilha" style="flex:1">
        <input type="number" class="input vcfg-meta" value="${metas[f.nome] || ""}" placeholder="Meta (R$)" step="100" style="width:160px">
        <button type="button" class="btn btn--ghost btn--icon vcfg-rm" title="Remover">✕</button>
      </div>`).join("");
    box.querySelectorAll(".vcfg-rm").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        cfg.funcs = cfg.funcs.filter(f => f.id !== id);
        renderMetasFuncs(chave, metas);
      });
    });
  }

  async function salvarMetas() {
    const chave  = chaveAtual();
    const metas  = { _empresa: parseFloat(gel("metas-meta-emp").value) || 0 };
    gel("metas-funcs").querySelectorAll("[data-id]").forEach(row => {
      const id   = row.dataset.id;
      const func = cfg.funcs.find(f => f.id === id);
      if (!func) return;
      func.nome = row.querySelector(".vcfg-nome").value.trim() || func.nome;
      const m   = parseFloat(row.querySelector(".vcfg-meta").value) || 0;
      if (func.nome && m) metas[func.nome] = m;
    });
    cfg.metas[chave] = metas;

    const btn = gel("metas-modal-save");
    btn.disabled = true;
    try {
      await salvarCfgRemoto(cfg);
      gel("metas-modal").hidden = true;
      if (ultimoDado) render(ultimoDado);
    } catch (e) {
      alert("Erro ao salvar metas: " + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function addFuncRow() {
    cfg.funcs.push({ id: "f" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), nome: "" });
    const chave = chaveAtual();
    renderMetasFuncs(chave, cfg.metas[chave] || {});
    gel("metas-funcs").querySelector("[data-id]:last-child .vcfg-nome")?.focus();
  }

  // ===== Init =====
  async function init() {
    gel("vendas-metas-btn").addEventListener("click", abrirMetas);
    gel("vendas-refresh-btn").addEventListener("click", fetchSheet);
    gel("metas-modal-close").addEventListener("click", () => { gel("metas-modal").hidden = true; });
    gel("metas-modal-cancel").addEventListener("click", () => { gel("metas-modal").hidden = true; });
    gel("metas-modal-save").addEventListener("click", salvarMetas);
    gel("metas-add-func").addEventListener("click", addFuncRow);
    gel("metas-modal").addEventListener("click", e => { if (e.target === gel("metas-modal")) gel("metas-modal").hidden = true; });

    await carregarCfg();
    fetchSheet();
  }

  init();
})();
