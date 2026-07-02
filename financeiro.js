// ===== Financeiro — Lolek Viagens =====
(function () {
  "use strict";

  const LS_KEY      = "lolek_financeiro";
  const LS_AI_MODEL = "lolek_anthropic_model";

  let lancamentos   = [];
  let filtroAtual   = "todos";
  let editando      = null;
  let desbloqueado  = false; // só em memória: recarregar a página (F5) sempre pede a senha de novo
  let importados    = [];    // linhas extraídas do extrato, aguardando revisão

  function gel(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fBRL(v) {
    return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function gerarId() { return "l" + Date.now() + "-" + Math.random().toString(36).slice(2, 8); }

  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }

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

  function parseData(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  function carregar() {
    try { lancamentos = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch { lancamentos = []; }
  }
  function salvar() { localStorage.setItem(LS_KEY, JSON.stringify(lancamentos)); }

  // ===== Senha (verificada no servidor — FINANCEIRO_SENHA no Netlify, nunca no navegador) =====
  function estaDesbloqueado() { return desbloqueado; }

  function mostrarErroLock(msg) {
    const el = gel("fin-lock-erro");
    el.textContent = msg;
    el.hidden = false;
  }

  function mostrarLock() {
    gel("fin-conteudo").hidden = true;
    gel("fin-lock").hidden = false;
    gel("fin-lock-senha").value = "";
    gel("fin-lock-erro").hidden = true;
    gel("fin-lock-senha").focus();
  }

  function mostrarConteudo() {
    gel("fin-lock").hidden = true;
    gel("fin-conteudo").hidden = false;
    render();
  }

  async function tentarEntrar() {
    const senha = gel("fin-lock-senha").value;
    if (!senha) return;

    const btn = gel("fin-lock-btn");
    btn.disabled = true;
    gel("fin-lock-erro").hidden = true;

    try {
      const resp = await fetch("/.netlify/functions/financeiro-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const data = await resp.json();

      if (data.ok) {
        desbloqueado = true;
        mostrarConteudo();
      } else if (resp.status === 500) {
        mostrarErroLock("Senha ainda não configurada no Netlify (variável FINANCEIRO_SENHA).");
      } else {
        mostrarErroLock("Senha incorreta.");
      }
    } catch (err) {
      mostrarErroLock("Erro ao verificar a senha: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function bloquear() {
    desbloqueado = false;
    mostrarLock();
  }

  // ===== Lançamentos =====
  function lancamentosFiltrados() {
    let lista = lancamentos.slice();
    if (filtroAtual === "entrada")  lista = lista.filter(l => l.tipo === "entrada");
    if (filtroAtual === "saida")    lista = lista.filter(l => l.tipo === "saida");
    if (filtroAtual === "pendente") lista = lista.filter(l => l.status === "pendente");
    lista.sort((a, b) => {
      const da = parseData(a.vencimento), db = parseData(b.vencimento);
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    });
    return lista;
  }

  function render() {
    renderStats();
    renderTabela();
    gel("fin-updated").textContent = lancamentos.length + " lançamento" + (lancamentos.length !== 1 ? "s" : "") + " no total";
  }

  function renderStats() {
    let saldo = 0, receber = 0, pagar = 0;
    lancamentos.forEach(l => {
      const v = parseFloat(l.valor) || 0;
      if (l.status === "pago") {
        saldo += l.tipo === "entrada" ? v : -v;
      } else if (l.tipo === "entrada") {
        receber += v;
      } else {
        pagar += v;
      }
    });
    gel("fin-stat-saldo").textContent   = fBRL(saldo);
    gel("fin-stat-receber").textContent = fBRL(receber);
    gel("fin-stat-pagar").textContent   = fBRL(pagar);
  }

  function renderTabela() {
    const body  = gel("fin-tabela-body");
    const vazio = gel("fin-vazio");
    const lista = lancamentosFiltrados();

    if (lista.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum lançamento encontrado</p></div>';
      return;
    }
    vazio.innerHTML = "";

    body.innerHTML = lista.map(l => {
      const v = parseFloat(l.valor) || 0;
      const corValor = l.tipo === "entrada" ? "#1f8a4c" : "#c0392b";
      return `
        <tr data-id="${escHtml(l.id)}">
          <td>${escHtml(l.vencimento || "—")}</td>
          <td class="table__client">${escHtml(l.descricao)}</td>
          <td class="table__muted">${escHtml(l.categoria || "—")}</td>
          <td class="table__muted">${escHtml(l.origem || "—")}</td>
          <td>${l.tipo === "entrada" ? "Entrada" : "Saída"}</td>
          <td style="color:${corValor};font-weight:600">${fBRL(v)}</td>
          <td><span class="badge badge--${l.status === "pago" ? "concluido" : "pendente"} fin-status-toggle">${l.status === "pago" ? "Pago" : "Pendente"}</span></td>
          <td class="table__actions-col">
            <div class="table__actions">
              <button class="btn btn--ghost btn--icon fin-editar" title="Editar">✏</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".fin-status-toggle").forEach(el => {
      el.addEventListener("click", () => {
        const l = lancamentos.find(x => x.id === el.closest("tr").dataset.id);
        if (!l) return;
        l.status = l.status === "pago" ? "pendente" : "pago";
        salvar();
        render();
      });
    });

    body.querySelectorAll(".fin-editar").forEach(btn => {
      btn.addEventListener("click", () => {
        abrirForm(lancamentos.find(x => x.id === btn.closest("tr").dataset.id));
      });
    });
  }

  // ===== Modal de lançamento =====
  function abrirForm(l) {
    editando = l || null;
    gel("fin-modal-titulo").textContent = l ? "Editar lançamento" : "Novo lançamento";
    gel("fin-f-tipo").value       = l ? l.tipo       : "entrada";
    gel("fin-f-status").value     = l ? l.status     : "pendente";
    gel("fin-f-descricao").value  = l ? l.descricao  : "";
    gel("fin-f-categoria").value  = l ? l.categoria  : "";
    gel("fin-f-origem").value     = l ? (l.origem || "") : "";
    gel("fin-f-valor").value      = l ? l.valor      : "";
    gel("fin-f-vencimento").value = l ? l.vencimento : "";
    gel("fin-f-excluir").hidden   = !l;
    gel("fin-modal-lanc").hidden  = false;
    gel("fin-f-descricao").focus();
  }

  function fecharForm() { gel("fin-modal-lanc").hidden = true; editando = null; }

  function salvarForm() {
    const dados = {
      tipo:       gel("fin-f-tipo").value,
      status:     gel("fin-f-status").value,
      descricao:  gel("fin-f-descricao").value.trim(),
      categoria:  gel("fin-f-categoria").value.trim(),
      origem:     gel("fin-f-origem").value.trim(),
      valor:      parseFloat(gel("fin-f-valor").value) || 0,
      vencimento: gel("fin-f-vencimento").value.trim(),
    };
    if (!dados.descricao) { alert("Descrição obrigatória."); return; }
    if (!dados.valor)     { alert("Informe um valor."); return; }

    if (editando) {
      Object.assign(editando, dados);
    } else {
      lancamentos.push({ ...dados, id: gerarId(), criadoEm: new Date().toISOString() });
    }
    salvar();
    fecharForm();
    render();
  }

  function excluirLancamento() {
    if (!editando) return;
    if (!confirm('Excluir "' + editando.descricao + '"?')) return;
    lancamentos = lancamentos.filter(l => l.id !== editando.id);
    salvar();
    fecharForm();
    render();
  }

  // ===== Importar extrato (IA) =====
  function abrirImportar() {
    gel("fin-imp-origem").value = "";
    gel("fin-imp-texto").value  = "";
    gel("fin-imp-passo1").hidden = false;
    gel("fin-imp-passo2").hidden = true;
    importados = [];
    gel("fin-modal-importar").hidden = false;
    gel("fin-imp-texto").focus();
  }

  function fecharImportar() {
    gel("fin-modal-importar").hidden = true;
    importados = [];
  }

  async function extrairExtrato() {
    const origem = gel("fin-imp-origem").value.trim();
    const texto  = gel("fin-imp-texto").value.trim();
    if (!texto) { alert("Cole o texto do extrato antes de extrair."); return; }

    const btn = gel("fin-imp-extrair-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Extraindo...";

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: `Extraia todas as transações do extrato bancário ou fatura de cartão de crédito abaixo. Ignore linhas de saldo, resumo, limite ou totalizadores — só transações individuais.

Para cada transação retorne:
- data: DD/MM/AAAA
- descricao: resumida, mantendo o que identifica a transação
- valor: número positivo, sem sinal
- tipo: "entrada" para receita/crédito/estorno, "saida" para despesa/débito/compra
- confianca: "alta" se o tipo de gasto é claro pelo texto (ex: tarifa bancária, PIX identificado, pagamento de fatura, juros, anuidade), ou "baixa" se for uma compra genérica sem contexto do que foi (ex: "COMPRA CARTAO ESTABELECIMENTO X", nome de maquininha, código numérico)
- categoria: sugestão curta de categoria quando confianca for "alta"; deixe "" (vazio) quando for "baixa"

Retorne SOMENTE um JSON válido, sem texto adicional, no formato:
{"transacoes":[{"data":"","descricao":"","valor":0,"tipo":"","confianca":"","categoria":""}]}

EXTRATO:
${texto}`,
          }],
        }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const parsed = JSON.parse(jsonStr);
      const transacoes = Array.isArray(parsed.transacoes) ? parsed.transacoes : [];
      if (transacoes.length === 0) { alert("Nenhuma transação encontrada nesse texto."); return; }

      importados = transacoes.map(t => ({
        data:      t.data || "",
        descricao: t.descricao || "",
        valor:     parseFloat(t.valor) || 0,
        tipo:      t.tipo === "entrada" ? "entrada" : "saida",
        categoria: t.categoria || "",
        confianca: t.confianca === "alta" ? "alta" : "baixa",
        origem,
      }));

      renderImportRevisao();
      gel("fin-imp-passo1").hidden = true;
      gel("fin-imp-passo2").hidden = false;
    } catch (err) {
      alert("Erro ao extrair lançamentos: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "🤖 Extrair lançamentos";
    }
  }

  function renderImportRevisao() {
    const tbody = gel("fin-imp-tbody");
    tbody.innerHTML = importados.map((t, i) => `
      <tr class="${t.confianca === "baixa" ? "fin-imp-row--atencao" : ""}" data-i="${i}">
        <td><input type="checkbox" class="fin-imp-check" checked /></td>
        <td><input type="text" class="input fin-imp-data" value="${escHtml(t.data)}" style="width:95px" /></td>
        <td><input type="text" class="input fin-imp-desc" value="${escHtml(t.descricao)}" style="min-width:180px" /></td>
        <td><input type="number" class="input fin-imp-valor" value="${t.valor}" step="0.01" style="width:95px" /></td>
        <td>
          <select class="input fin-imp-tipo">
            <option value="entrada"${t.tipo === "entrada" ? " selected" : ""}>Entrada</option>
            <option value="saida"${t.tipo === "saida" ? " selected" : ""}>Saída</option>
          </select>
        </td>
        <td><input type="text" class="input fin-imp-categoria" value="${escHtml(t.categoria)}" placeholder="${t.confianca === "baixa" ? "O que é isso?" : ""}" /></td>
      </tr>`).join("");
  }

  function confirmarImportacao() {
    const origem = gel("fin-imp-origem").value.trim();
    const linhas = gel("fin-imp-tbody").querySelectorAll("tr");
    let count = 0;

    linhas.forEach(tr => {
      if (!tr.querySelector(".fin-imp-check").checked) return;

      const dados = {
        tipo:       tr.querySelector(".fin-imp-tipo").value,
        status:     "pendente",
        descricao:  tr.querySelector(".fin-imp-desc").value.trim(),
        categoria:  tr.querySelector(".fin-imp-categoria").value.trim(),
        origem,
        valor:      parseFloat(tr.querySelector(".fin-imp-valor").value) || 0,
        vencimento: tr.querySelector(".fin-imp-data").value.trim(),
      };
      if (!dados.descricao || !dados.valor) return;

      lancamentos.push({ ...dados, id: gerarId(), criadoEm: new Date().toISOString() });
      count++;
    });

    salvar();
    fecharImportar();
    render();
    alert(count + " lançamento" + (count !== 1 ? "s importados" : " importado") + " com sucesso.");
  }

  // ===== Init =====
  function init() {
    carregar();

    gel("fin-lock-btn").addEventListener("click", tentarEntrar);
    gel("fin-lock-senha").addEventListener("keydown", e => { if (e.key === "Enter") tentarEntrar(); });
    gel("fin-lock-btn2").addEventListener("click", bloquear);

    gel("fin-novo-btn").addEventListener("click", () => abrirForm(null));
    gel("fin-modal-fechar").addEventListener("click", fecharForm);
    gel("fin-f-cancelar").addEventListener("click", fecharForm);
    gel("fin-f-salvar").addEventListener("click", salvarForm);
    gel("fin-f-excluir").addEventListener("click", excluirLancamento);
    gel("fin-modal-lanc").addEventListener("click", e => { if (e.target === gel("fin-modal-lanc")) fecharForm(); });

    gel("fin-importar-btn").addEventListener("click", abrirImportar);
    gel("fin-imp-fechar").addEventListener("click", fecharImportar);
    gel("fin-imp-cancelar").addEventListener("click", fecharImportar);
    gel("fin-imp-extrair-btn").addEventListener("click", extrairExtrato);
    gel("fin-imp-voltar").addEventListener("click", () => {
      gel("fin-imp-passo1").hidden = false;
      gel("fin-imp-passo2").hidden = true;
    });
    gel("fin-imp-confirmar-btn").addEventListener("click", confirmarImportacao);
    gel("fin-modal-importar").addEventListener("click", e => { if (e.target === gel("fin-modal-importar")) fecharImportar(); });

    document.querySelectorAll(".fin-filtro").forEach(btn => {
      btn.addEventListener("click", () => {
        filtroAtual = btn.dataset.filtro;
        document.querySelectorAll(".fin-filtro").forEach(b => b.classList.toggle("is-active", b === btn));
        renderTabela();
      });
    });

    if (estaDesbloqueado()) mostrarConteudo();
    else mostrarLock();
  }

  init();
})();
