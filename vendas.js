// ===== Dashboard de Vendas — Lolek Viagens =====
(function () {
  "use strict";

  const CFG_KEY = "lolek_vendas_cfg2";

  const MESES_LABEL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  // Mesmos tipos cadastrados em emissoes.js (PROD_TIPOS) — mantido separado porque
  // cada aba é uma IIFE independente, sem módulos compartilhados entre arquivos.
  const TIPO_LABEL = {
    passagem: "Passagem aérea", hospedagem: "Hospedagem", seguro: "Seguro viagem",
    carro: "Aluguel de carro", trem: "Trem", passeio: "Passeio / Ingresso", transfer: "Transfer", mala: "Adicional de mala",
    assento: "Assento", consultoria_milhas: "Consultoria de milhas",
    visto_americano: "Visto americano", venda_milhas: "Venda de milhas",
    outro: "Outro / Diversos",
  };

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

  // ===== Processa os produtos vendidos no mês (vindos de Emissões) =====
  // Mesmo formato de retorno que a versão antiga (baseada na planilha) já produzia, pra
  // render()/renderStats/renderProdutos/renderLeads/renderFuncs continuarem sem alteração.
  function processaEmissoes(rows, mes, ano) {
    const porFunc       = {};
    const produtosTotal = {};
    const leadsPassagem = {};
    let faturamento = 0, lucroTotal = 0;

    rows.forEach((r) => {
      const tipo     = TIPO_LABEL[r.tipo] || r.tipo;
      const paxCount = Math.max(1, (r.passageiro_ids || []).length);

      // Venda conjunta (ex: "Letícia/Emily") — divide o lucro entre as funcionárias listadas,
      // mas cada uma leva o crédito cheio dos produtos vendidos (mesma convenção de antes).
      const nomesFunc = (r.funcionaria || "").split("/").map((n) => n.trim()).filter(Boolean);
      nomesFunc.forEach((nome) => {
        if (!porFunc[nome]) porFunc[nome] = { total: 0, count: 0, produtos: {} };
        porFunc[nome].total += (Number(r.lucro) || 0) / nomesFunc.length;
        porFunc[nome].count += paxCount;
        porFunc[nome].produtos[tipo] = (porFunc[nome].produtos[tipo] || 0) + paxCount;
      });

      produtosTotal[tipo] = (produtosTotal[tipo] || 0) + paxCount;
      faturamento += Number(r.valor_venda) || 0;
      lucroTotal  += Number(r.lucro) || 0;

      if (r.tipo === "passagem") {
        const lead = r.origem_lead || "Não informado";
        leadsPassagem[lead] = (leadsPassagem[lead] || 0) + paxCount;
      }
    });

    return { porFunc, produtosTotal, leadsPassagem, faturamento, lucroTotal, month: mes, year: ano };
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
      headers: { "content-type": "application/json", ...(window.LolekAuth ? window.LolekAuth.headers() : {}) },
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

  // Chave do mês/ano que está selecionado nos seletores no momento (não necessariamente
  // o mês real de hoje) — metas passam a ser editadas/consultadas pro mês em exibição.
  function chaveSelecionada() {
    return selAno + "-" + String(selMes + 1).padStart(2, "0");
  }

  // ===== Seletor de mês/ano =====
  const ANO_INICIAL = 2024; // primeiro ano com dados no sistema
  let selMes = new Date().getMonth();
  let selAno = new Date().getFullYear();

  function popularSeletores() {
    const selM = gel("vendas-sel-mes");
    const selA = gel("vendas-sel-ano");
    selM.innerHTML = MESES_LABEL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    const anoAtual = new Date().getFullYear();
    const anos = [];
    for (let a = anoAtual; a >= ANO_INICIAL; a--) anos.push(a);
    selA.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join("");
    selM.value = selMes;
    selA.value = selAno;
  }

  // ===== Render principal =====
  let ultimoDado = null;

  function render(data) {
    if (data) ultimoDado = data;
    const d = ultimoDado;
    if (!d) return;

    gel("vendas-mes-label").textContent = MESES_LABEL[d.month] + " " + d.year;

    const hoje = new Date();
    const ehMesAtual = d.month === hoje.getMonth() && d.year === hoje.getFullYear();
    const diasR = ehMesAtual ? diasUteisRestantes() : 0;
    gel("vendas-dias-uteis").textContent = ehMesAtual
      ? diasR + " dia" + (diasR !== 1 ? "s úteis" : " útil") + " restante" + (diasR !== 1 ? "s" : "") + " no mês"
      : "Mês encerrado";

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
    "Aluguel de carro":   "🚗",
    "Passeio / Ingresso": "🗺️",
    "Transfer":           "🚌",
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

  // ===== Busca os produtos vendidos num período qualquer (cadastrados em Emissões) =====
  async function buscarProdutosPeriodo(de, ate) {
    const resp = await fetch("/.netlify/functions/emissoes-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "listar_produtos_periodo", data: { de, ate } }),
    });
    const rows = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(rows.error || "Erro HTTP " + resp.status);
    return rows;
  }

  // ===== Busca as vendas do mês selecionado (ano/mês vêm dos seletores) =====
  async function carregarMes(ano = selAno, mes = selMes) {
    const statusEl = gel("vendas-status");
    const btn      = gel("vendas-refresh-btn");
    if (btn) btn.disabled = true;
    statusEl.innerHTML = `<div class="notice">Carregando vendas do mês…</div>`;

    try {
      const de  = ano + "-" + String(mes + 1).padStart(2, "0") + "-01";
      const ultimoDia = new Date(ano, mes + 1, 0).getDate();
      const ate = ano + "-" + String(mes + 1).padStart(2, "0") + "-" + String(ultimoDia).padStart(2, "0");

      const rows = await buscarProdutosPeriodo(de, ate);
      const data = processaEmissoes(rows, mes, ano);

      statusEl.innerHTML = "";
      gel("vendas-updated").textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      render(data);
    } catch (e) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao carregar vendas do mês.</strong><p>${escHtml(e.message)}</p></div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ===== Comparativos (gráfico do ano, mesmo mês ano passado, trimestral) =====
  let chartAno = null;
  let comparativosCache = {}; // ano -> array de 12 buckets, evita rebuscar o mesmo ano toda hora

  function bucketizarPorMes(rows) {
    const meses = Array.from({ length: 12 }, () => ({ faturamento: 0, lucro: 0 }));
    rows.forEach((r) => {
      const m = Number((r.data_venda || "").slice(5, 7)) - 1;
      if (m < 0 || m > 11) return;
      meses[m].faturamento += Number(r.valor_venda) || 0;
      meses[m].lucro += Number(r.lucro) || 0;
    });
    return meses.map((m) => ({ ...m, margem: m.faturamento > 0 ? (m.lucro / m.faturamento) * 100 : 0 }));
  }

  async function buscarAnoBucketizado(ano) {
    if (comparativosCache[ano]) return comparativosCache[ano];
    const rows = await buscarProdutosPeriodo(ano + "-01-01", ano + "-12-31");
    const bucket = bucketizarPorMes(rows);
    comparativosCache[ano] = bucket;
    return bucket;
  }

  function variacaoPct(atual, anterior) {
    if (!anterior) return null;
    return ((atual - anterior) / anterior) * 100;
  }

  function badgeVariacao(pct) {
    if (pct == null || !isFinite(pct)) return `<span class="vendas-var vendas-var--neutro">—</span>`;
    const cls  = pct > 0.05 ? "vendas-var--up" : pct < -0.05 ? "vendas-var--down" : "vendas-var--neutro";
    const seta = pct > 0.05 ? "▲" : pct < -0.05 ? "▼" : "•";
    return `<span class="vendas-var ${cls}">${seta} ${Math.abs(pct).toFixed(1).replace(".", ",")}%</span>`;
  }

  function renderGrafico(ano, meses) {
    gel("vendas-grafico-ano-label").textContent = ano;
    const canvas = gel("vendas-grafico-ano");
    if (!canvas || typeof Chart === "undefined") return;

    if (chartAno) { chartAno.destroy(); chartAno = null; }
    chartAno = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: MESES_LABEL.map((m) => m.slice(0, 3)),
        datasets: [
          { label: "Faturamento", data: meses.map((m) => m.faturamento), borderColor: "#0a1f3d", backgroundColor: "#0a1f3d", yAxisID: "y", tension: 0.3 },
          { label: "Lucro",       data: meses.map((m) => m.lucro),       borderColor: "#c9a84c", backgroundColor: "#c9a84c", yAxisID: "y", tension: 0.3 },
          { label: "Margem %",    data: meses.map((m) => m.margem),      borderColor: "#1f8a4c", backgroundColor: "#1f8a4c", yAxisID: "y1", tension: 0.3 },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ": " + (ctx.dataset.label === "Margem %" ? fPct(ctx.parsed.y) : fBRL(ctx.parsed.y)),
            },
          },
        },
        scales: {
          y:  { type: "linear", position: "left",  ticks: { callback: (v) => "R$ " + (v / 1000).toFixed(0) + "k" } },
          y1: { type: "linear", position: "right", grid: { drawOnChartArea: false }, ticks: { callback: (v) => v + "%" } },
        },
      },
    });
  }

  function renderComparativoAnoAnterior(ano, mes, atualMeses, anteriorMeses) {
    const box = gel("vendas-comp-anoanterior");
    const atual    = atualMeses[mes];
    const anterior = anteriorMeses[mes];
    const linhas = [
      ["Faturamento", atual.faturamento, anterior.faturamento, fBRL],
      ["Lucro",       atual.lucro,       anterior.lucro,       fBRL],
      ["Margem",      atual.margem,      anterior.margem,      fPct],
    ];
    box.innerHTML = `
      <div class="vendas-comp-sub">${MESES_LABEL[mes]} ${ano} vs ${MESES_LABEL[mes]} ${ano - 1}</div>
      <table class="vendas-comp-table">
        ${linhas.map(([label, a, b, fmt]) => `
          <tr>
            <td class="vendas-comp-label">${label}</td>
            <td class="vendas-comp-valor">${fmt(a)}</td>
            <td class="vendas-comp-valor vendas-comp-valor--muted">${fmt(b)}</td>
            <td>${badgeVariacao(variacaoPct(a, b))}</td>
          </tr>`).join("")}
      </table>`;
  }

  function renderComparativoTrimestral(meses) {
    const box = gel("vendas-comp-trimestre");
    const trimestres = [0, 1, 2, 3].map((t) => {
      const grupo = meses.slice(t * 3, t * 3 + 3);
      const faturamento = grupo.reduce((s, m) => s + m.faturamento, 0);
      const lucro       = grupo.reduce((s, m) => s + m.lucro, 0);
      return { faturamento, lucro, margem: faturamento > 0 ? (lucro / faturamento) * 100 : 0 };
    });
    const melhorLucro = Math.max(...trimestres.map((t) => t.lucro));

    box.innerHTML = `
      <table class="vendas-comp-table vendas-comp-table--trimestre">
        <thead><tr><th></th><th>Faturamento</th><th>Lucro</th><th>Margem</th></tr></thead>
        <tbody>
          ${trimestres.map((t, i) => `
            <tr class="${t.lucro === melhorLucro && melhorLucro > 0 ? "vendas-comp-row--melhor" : ""}">
              <td class="vendas-comp-label">${i + 1}º trim${t.lucro === melhorLucro && melhorLucro > 0 ? " 🏆" : ""}</td>
              <td>${fBRL(t.faturamento)}</td>
              <td>${fBRL(t.lucro)}</td>
              <td>${fPct(t.margem)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  async function carregarComparativos(ano, mes) {
    const statusEl = gel("vendas-comparativos-status");
    statusEl.innerHTML = `<div class="notice">Carregando comparativos…</div>`;
    try {
      const [doAno, doAnoAnterior] = await Promise.all([
        buscarAnoBucketizado(ano),
        buscarAnoBucketizado(ano - 1),
      ]);
      statusEl.innerHTML = "";
      renderGrafico(ano, doAno);
      renderComparativoAnoAnterior(ano, mes, doAno, doAnoAnterior);
      renderComparativoTrimestral(doAno);
    } catch (e) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao carregar comparativos.</strong><p>${escHtml(e.message)}</p></div>`;
    }
  }

  // ===== Modal de metas =====
  function abrirMetas() {
    const chave = chaveSelecionada();
    const metas = cfg.metas[chave] || {};
    gel("metas-meta-emp").value = metas._empresa || "";
    renderMetasFuncs(chave, metas);
    const tituloEl = document.querySelector("#metas-modal .modal__title");
    if (tituloEl) tituloEl.textContent = "Metas — " + MESES_LABEL[selMes] + " " + selAno;
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
        <input type="text" class="input vcfg-nome" value="${escHtml(f.nome)}" placeholder="Nome exato usado em Emissões" style="flex:1">
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
    const chave  = chaveSelecionada();
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
    const chave = chaveSelecionada();
    renderMetasFuncs(chave, cfg.metas[chave] || {});
    gel("metas-funcs").querySelector("[data-id]:last-child .vcfg-nome")?.focus();
  }

  // ===== Init =====
  function carregarTudo() {
    carregarMes(selAno, selMes);
    carregarComparativos(selAno, selMes);
  }

  async function init() {
    popularSeletores();

    gel("vendas-metas-btn").addEventListener("click", abrirMetas);
    gel("vendas-refresh-btn").addEventListener("click", () => {
      delete comparativosCache[selAno]; // força buscar de novo o ano corrente (pode ter venda nova)
      carregarTudo();
    });
    gel("vendas-sel-mes").addEventListener("change", (e) => { selMes = Number(e.target.value); carregarTudo(); });
    gel("vendas-sel-ano").addEventListener("change", (e) => { selAno = Number(e.target.value); carregarTudo(); });
    gel("vendas-hoje-btn").addEventListener("click", () => {
      const hoje = new Date();
      selMes = hoje.getMonth();
      selAno = hoje.getFullYear();
      popularSeletores();
      carregarTudo();
    });

    gel("metas-modal-close").addEventListener("click", () => { gel("metas-modal").hidden = true; });
    gel("metas-modal-cancel").addEventListener("click", () => { gel("metas-modal").hidden = true; });
    gel("metas-modal-save").addEventListener("click", salvarMetas);
    gel("metas-add-func").addEventListener("click", addFuncRow);
    gel("metas-modal").addEventListener("click", e => { if (e.target === gel("metas-modal")) gel("metas-modal").hidden = true; });

    await carregarCfg();
    carregarTudo();
  }

  init();
})();
