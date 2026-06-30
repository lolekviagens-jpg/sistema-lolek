// ===== Dashboard de Vendas — Lolek Viagens =====
(function () {
  "use strict";

  const SHEET_ID  = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv";
  const CFG_KEY   = "lolek_vendas_cfg2";

  const COL_FUNC  = 2;  // coluna C — nome da funcionária
  const COL_SEP   = 4;  // coluna E — separador de mês (ex: "junho")
  const COL_LUCRO = 15; // coluna P — lucro

  const MESES_PT    = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const MESES_LABEL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  // ===== Utilitários =====
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fBRL(v) {
    return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function gel(id) { return document.getElementById(id); }

  function parseNum(s) {
    const str = String(s || "").replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  // Retorna índice do mês (0-11) se o texto for (ou contiver) um nome de mês, senão -1
  function detectaMes(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return -1;
    return MESES_PT.findIndex(m => t === m || t.startsWith(m + " ") || t.endsWith(" " + m) || t.includes(" " + m + " "));
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

    // Encontra separadores de mês pela coluna E
    const separadores = [];
    rows.forEach((cols, i) => {
      const sep = (cols[COL_SEP] || "").trim();
      const m = detectaMes(sep);
      if (m >= 0) separadores.push({ rowIdx: i, month: m });
    });

    if (separadores.length === 0) return { porFunc: {}, month: currentMonth, year: now.getFullYear(), aviso: "sem-separador" };

    // Separador do mês atual
    let sep = separadores.find(s => s.month === currentMonth);
    // Se não encontrou o mês atual, usa o último separador encontrado
    if (!sep) sep = separadores[separadores.length - 1];

    const proxSep = separadores.find(s => s.rowIdx > sep.rowIdx);
    const fim     = proxSep ? proxSep.rowIdx : rows.length;

    // Linhas do mês
    const linhasMes = rows.slice(sep.rowIdx + 1, fim);

    // Agrupa por coluna C (nome da funcionária)
    const porFunc = {};
    linhasMes.forEach(cols => {
      const func  = (cols[COL_FUNC] || "").trim();
      if (!func) return;
      const lucro = parseNum(cols[COL_LUCRO]);
      if (!lucro) return;
      porFunc[func] = (porFunc[func] || 0) + lucro;
    });

    return { porFunc, month: sep.month, year: now.getFullYear() };
  }

  // ===== Configuração (metas) =====
  let cfg = { funcs: [], metas: {} };
  // funcs: [{id, nome}]  — nome exato como aparece na planilha
  // metas: { "YYYY-MM": { "nome": valor, _empresa: valor } }

  function loadCfg()  { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{"funcs":[],"metas":{}}'); } catch { return { funcs: [], metas: {} }; } }
  function saveCfg()  { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

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

    // Total geral das funcionárias configuradas
    let totalGeral = 0;
    cfg.funcs.forEach(f => { totalGeral += d.porFunc[f.nome] || 0; });

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

    renderFuncs(d, metas, diasR);
  }

  function renderFuncs(d, metas, diasR) {
    const grid = gel("vendas-func-grid");
    if (cfg.funcs.length === 0) {
      grid.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma funcionária configurada</p><small>Clique em "⚙ Metas" para configurar</small></div>`;
      return;
    }
    grid.innerHTML = cfg.funcs.map(f => {
      const total = d.porFunc[f.nome] || 0;
      const meta  = metas[f.nome] || 0;
      const pct   = meta > 0 ? Math.min(100, (total / meta) * 100) : 0;
      const falta = Math.max(0, meta - total);
      const sug   = diasR > 0 && falta > 0 ? falta / diasR : 0;
      const barCls = "vendas-bar__fill" + (pct >= 100 ? " vendas-bar__fill--ok" : pct >= 70 ? " vendas-bar__fill--warn" : "");

      let infoMeta = "";
      if (meta > 0) {
        if (falta > 0) {
          infoMeta = `
            <div class="vendas-bar" style="margin:10px 0 5px">
              <div class="${barCls}" style="width:${pct}%"></div>
            </div>
            <div class="vendas-func-pct">${pct.toFixed(0)}% de ${fBRL(meta)}</div>
            <div class="vendas-func-sugestao">
              Faltam <strong>${fBRL(falta)}</strong><br>
              ${diasR > 0 ? "Sugestão: <strong>" + fBRL(sug) + "</strong>/dia útil" : ""}
            </div>`;
        } else {
          infoMeta = `
            <div class="vendas-bar" style="margin:10px 0 5px">
              <div class="${barCls}" style="width:100%"></div>
            </div>
            <div class="vendas-func-pct vendas-meta-ok">✅ Meta atingida!</div>`;
        }
      } else {
        infoMeta = `<div class="vendas-func-meta">Sem meta definida</div>`;
      }

      return `
        <div class="vendas-func-card">
          <div class="vendas-func-nome">${escHtml(f.nome)}</div>
          <div class="vendas-func-valor">${fBRL(total)}</div>
          ${infoMeta}
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

  function salvarMetas() {
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
    saveCfg();
    gel("metas-modal").hidden = true;
    if (ultimoDado) render(ultimoDado);
  }

  function addFuncRow() {
    cfg.funcs.push({ id: "f" + Date.now(), nome: "" });
    const chave = chaveAtual();
    renderMetasFuncs(chave, cfg.metas[chave] || {});
    gel("metas-funcs").querySelector("[data-id]:last-child .vcfg-nome")?.focus();
  }

  // ===== Init =====
  function init() {
    cfg = loadCfg();

    gel("vendas-metas-btn").addEventListener("click", abrirMetas);
    gel("vendas-refresh-btn").addEventListener("click", fetchSheet);
    gel("metas-modal-close").addEventListener("click", () => { gel("metas-modal").hidden = true; });
    gel("metas-modal-cancel").addEventListener("click", () => { gel("metas-modal").hidden = true; });
    gel("metas-modal-save").addEventListener("click", salvarMetas);
    gel("metas-add-func").addEventListener("click", addFuncRow);
    gel("metas-modal").addEventListener("click", e => { if (e.target === gel("metas-modal")) gel("metas-modal").hidden = true; });

    fetchSheet();
  }

  init();
})();
