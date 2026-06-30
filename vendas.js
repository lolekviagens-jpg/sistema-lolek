// ===== Dashboard de Vendas — Lolek Viagens =====
(function () {
  "use strict";

  const VENDAS_KEY = "lolek_vendas";
  const CFG_KEY    = "lolek_vendas_cfg";

  let vendas = [];
  let cfg    = { meta_emp: 0, funcs: [] };
  let viewYear, viewMonth;

  // ===== Persistência =====
  function loadVendas() { try { return JSON.parse(localStorage.getItem(VENDAS_KEY) || "[]"); } catch { return []; } }
  function saveVendas() { localStorage.setItem(VENDAS_KEY, JSON.stringify(vendas)); }
  function loadCfg()   { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{"meta_emp":0,"funcs":[]}'); } catch { return { meta_emp: 0, funcs: [] }; } }
  function saveCfg()   { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  // ===== Utilitários =====
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fBRL(v)  { return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fData(iso) { return iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : ""; }
  function gel(id)  { return document.getElementById(id); }

  function vendasDoMes() {
    const pref = viewYear + "-" + String(viewMonth + 1).padStart(2, "0");
    return vendas.filter(v => v.data && v.data.startsWith(pref));
  }

  // ===== Render principal =====
  function render() {
    const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    gel("vendas-mes-title").textContent = MESES[viewMonth] + " " + viewYear;

    const mv    = vendasDoMes();
    const total = mv.reduce((s, v) => s + v.valor, 0);
    const meta  = cfg.meta_emp || 0;
    const pct   = meta > 0 ? Math.min(100, (total / meta) * 100) : 0;

    gel("vendas-total").textContent = fBRL(total);
    gel("vendas-meta").textContent  = meta > 0 ? fBRL(meta) : "Meta não definida";
    gel("vendas-pct").textContent   = meta > 0 ? pct.toFixed(0) + "%" : "";

    const fill = gel("vendas-bar-fill");
    fill.style.width = pct + "%";
    fill.className   = "vendas-bar__fill" + (pct >= 100 ? " vendas-bar__fill--ok" : pct >= 70 ? " vendas-bar__fill--warn" : "");

    renderFuncs(mv);
    renderHistorico(mv);
  }

  function renderFuncs(mv) {
    const grid = gel("vendas-func-grid");
    if (cfg.funcs.length === 0) {
      grid.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma funcionária configurada</p><small>Clique em "Metas" para configurar</small></div>`;
      return;
    }
    grid.innerHTML = cfg.funcs.map(f => {
      const vf   = mv.filter(v => v.func_id === f.id);
      const tot  = vf.reduce((s, v) => s + v.valor, 0);
      const meta = f.meta || 0;
      const pct  = meta > 0 ? Math.min(100, (tot / meta) * 100) : 0;
      const barCls = "vendas-bar__fill" + (pct >= 100 ? " vendas-bar__fill--ok" : pct >= 70 ? " vendas-bar__fill--warn" : "");
      return `
        <div class="vendas-func-card">
          <div class="vendas-func-nome">${escapeHtml(f.nome)}</div>
          <div class="vendas-func-valor">${fBRL(tot)}</div>
          ${meta > 0 ? `<div class="vendas-func-meta">Meta: ${fBRL(meta)}</div>` : '<div class="vendas-func-meta">Sem meta</div>'}
          <div class="vendas-bar" style="margin:10px 0 5px">
            <div class="${barCls}" style="width:${pct}%"></div>
          </div>
          <div class="vendas-func-pct">${meta > 0 ? pct.toFixed(0) + "% da meta &nbsp;·&nbsp; " : ""}${vf.length} venda${vf.length !== 1 ? "s" : ""}</div>
        </div>`;
    }).join("");
  }

  function renderHistorico(mv) {
    const box    = gel("vendas-historico");
    const sorted = mv.slice().sort((a, b) => b.data.localeCompare(a.data));
    if (sorted.length === 0) {
      box.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma venda neste mês</p></div>`;
      return;
    }
    box.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Data</th><th>Funcionária</th><th>Cliente</th><th>Destino</th><th>Valor</th><th class="table__actions-col"></th>
        </tr></thead>
        <tbody>${sorted.map(v => {
          const func = cfg.funcs.find(f => f.id === v.func_id);
          return `<tr>
            <td>${fData(v.data)}</td>
            <td>${escapeHtml(func ? func.nome : "—")}</td>
            <td class="table__client">${escapeHtml(v.cliente || "—")}</td>
            <td class="table__muted">${escapeHtml(v.destino || "—")}</td>
            <td><strong>${fBRL(v.valor)}</strong></td>
            <td class="table__actions-col">
              <button class="btn btn--ghost btn--icon vendas-rm" data-id="${v.id}" title="Excluir">✕</button>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    box.querySelectorAll(".vendas-rm").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("Excluir esta venda?")) return;
        vendas = vendas.filter(v => v.id !== btn.dataset.id);
        saveVendas();
        render();
      });
    });
  }

  // ===== Modal: adicionar venda =====
  function openAdd() {
    gel("vendas-modal-data").value    = new Date().toISOString().slice(0, 10);
    gel("vendas-modal-func").value    = "";
    gel("vendas-modal-cliente").value = "";
    gel("vendas-modal-destino").value = "";
    gel("vendas-modal-valor").value   = "";
    gel("vendas-modal").hidden = false;
    setTimeout(() => gel("vendas-modal-valor").focus(), 50);
  }
  function closeAdd() { gel("vendas-modal").hidden = true; }

  function salvarVenda() {
    const func_id = gel("vendas-modal-func").value;
    const valor   = parseFloat(gel("vendas-modal-valor").value) || 0;
    const data    = gel("vendas-modal-data").value;
    if (!func_id)  { alert("Selecione a funcionária."); return; }
    if (valor <= 0){ alert("Informe o valor da venda."); return; }
    if (!data)     { alert("Informe a data."); return; }
    vendas.push({
      id:      "v" + Date.now() + Math.random().toString(36).slice(2, 6),
      data,
      func_id,
      cliente: gel("vendas-modal-cliente").value.trim(),
      destino: gel("vendas-modal-destino").value.trim(),
      valor,
    });
    saveVendas();
    closeAdd();
    render();
  }

  // ===== Modal: configurar metas =====
  function openCfg() {
    gel("vendas-cfg-meta-emp").value = cfg.meta_emp || "";
    renderCfgFuncs();
    gel("vendas-cfg-modal").hidden = false;
  }
  function closeCfg() { gel("vendas-cfg-modal").hidden = true; }

  function renderCfgFuncs() {
    const box = gel("vendas-cfg-funcs");
    if (cfg.funcs.length === 0) {
      box.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">Nenhuma funcionária ainda.</p>`;
      return;
    }
    box.innerHTML = cfg.funcs.map(f => `
      <div class="vendas-cfg-row" data-id="${f.id}">
        <input type="text" class="input vcfg-nome" value="${escapeHtml(f.nome)}" placeholder="Nome da funcionária" style="flex:1">
        <input type="number" class="input vcfg-meta" value="${f.meta || ""}" placeholder="Meta mensal (R$)" step="100" style="width:170px">
        <button type="button" class="btn btn--ghost btn--icon vcfg-rm" title="Remover">✕</button>
      </div>`).join("");
    box.querySelectorAll(".vcfg-rm").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        cfg.funcs = cfg.funcs.filter(f => f.id !== id);
        renderCfgFuncs();
      });
    });
  }

  function salvarCfg() {
    gel("vendas-cfg-funcs").querySelectorAll("[data-id]").forEach(row => {
      const func = cfg.funcs.find(f => f.id === row.dataset.id);
      if (func) {
        func.nome = row.querySelector(".vcfg-nome").value.trim() || func.nome;
        func.meta = parseFloat(row.querySelector(".vcfg-meta").value) || 0;
      }
    });
    cfg.meta_emp = parseFloat(gel("vendas-cfg-meta-emp").value) || 0;
    saveCfg();
    closeCfg();
    atualizarSelectFunc();
    render();
  }

  function addFunc() {
    cfg.funcs.push({ id: "f" + Date.now(), nome: "", meta: 0 });
    renderCfgFuncs();
    const rows = gel("vendas-cfg-funcs").querySelectorAll("[data-id]");
    rows[rows.length - 1]?.querySelector(".vcfg-nome")?.focus();
  }

  function atualizarSelectFunc() {
    gel("vendas-modal-func").innerHTML =
      `<option value="">Selecione</option>` +
      cfg.funcs.map(f => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join("");
  }

  // ===== Início =====
  function init() {
    vendas = loadVendas();
    cfg    = loadCfg();
    const now  = new Date();
    viewYear   = now.getFullYear();
    viewMonth  = now.getMonth();

    atualizarSelectFunc();
    render();

    gel("vendas-add-btn").addEventListener("click", openAdd);
    gel("vendas-config-btn").addEventListener("click", openCfg);

    gel("vendas-modal-close").addEventListener("click", closeAdd);
    gel("vendas-modal-cancel").addEventListener("click", closeAdd);
    gel("vendas-modal-save").addEventListener("click", salvarVenda);
    gel("vendas-modal").addEventListener("click", e => { if (e.target === gel("vendas-modal")) closeAdd(); });

    gel("vendas-cfg-close").addEventListener("click", closeCfg);
    gel("vendas-cfg-cancel").addEventListener("click", closeCfg);
    gel("vendas-cfg-save").addEventListener("click", salvarCfg);
    gel("vendas-cfg-add-func").addEventListener("click", addFunc);
    gel("vendas-cfg-modal").addEventListener("click", e => { if (e.target === gel("vendas-cfg-modal")) closeCfg(); });

    gel("vendas-prev-mes").addEventListener("click", () => {
      viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render();
    });
    gel("vendas-next-mes").addEventListener("click", () => {
      viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render();
    });
    gel("vendas-mes-hoje").addEventListener("click", () => {
      const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); render();
    });
  }

  init();
})();
