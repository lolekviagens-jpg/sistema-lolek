// ===== Financeiro — Lolek Viagens =====
(function () {
  "use strict";

  const LS_KEY       = "lolek_financeiro";
  const LS_HASH_KEY  = "lolek_fin_pass_hash";
  const SS_UNLOCK_KEY = "lolek_fin_unlocked";

  let lancamentos = [];
  let filtroAtual = "todos";
  let editando    = null;

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

  // ===== Senha (hash SHA-256, nunca guardamos a senha em texto puro) =====
  async function hashSenha(txt) {
    const enc = new TextEncoder().encode(txt);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function temSenha()          { return !!localStorage.getItem(LS_HASH_KEY); }
  function estaDesbloqueado()  { return sessionStorage.getItem(SS_UNLOCK_KEY) === "1"; }

  function mostrarErroLock(msg) {
    const el = gel("fin-lock-erro");
    el.textContent = msg;
    el.hidden = false;
  }

  function mostrarLock(modoCriar) {
    gel("fin-conteudo").hidden = true;
    gel("fin-lock").hidden = false;
    gel("fin-lock-senha").value = "";
    gel("fin-lock-senha2").value = "";
    gel("fin-lock-senha2").hidden = !modoCriar;
    gel("fin-lock-erro").hidden = true;
    gel("fin-lock-title").textContent = modoCriar ? "Criar senha da área financeira" : "Área financeira protegida";
    gel("fin-lock-hint").textContent  = modoCriar
      ? "Defina uma senha para proteger o acesso a esta aba."
      : "Digite a senha para continuar.";
    gel("fin-lock-btn").textContent = modoCriar ? "Criar senha" : "Entrar";
    gel("fin-lock-senha").focus();
  }

  function mostrarConteudo() {
    gel("fin-lock").hidden = true;
    gel("fin-conteudo").hidden = false;
    render();
  }

  async function tentarEntrar() {
    const modoCriar = !temSenha();
    const senha  = gel("fin-lock-senha").value;
    const senha2 = gel("fin-lock-senha2").value;
    if (!senha) return;

    if (modoCriar) {
      if (senha.length < 4)   { mostrarErroLock("A senha deve ter ao menos 4 caracteres."); return; }
      if (senha !== senha2)   { mostrarErroLock("As senhas não coincidem."); return; }
      localStorage.setItem(LS_HASH_KEY, await hashSenha(senha));
      sessionStorage.setItem(SS_UNLOCK_KEY, "1");
      mostrarConteudo();
      return;
    }

    const hash = await hashSenha(senha);
    if (hash === localStorage.getItem(LS_HASH_KEY)) {
      sessionStorage.setItem(SS_UNLOCK_KEY, "1");
      mostrarConteudo();
    } else {
      mostrarErroLock("Senha incorreta.");
    }
  }

  function bloquear() {
    sessionStorage.removeItem(SS_UNLOCK_KEY);
    mostrarLock(false);
  }

  function trocarSenha() {
    if (!confirm("Isso apaga a senha atual e pede para cadastrar uma nova. Continuar?")) return;
    localStorage.removeItem(LS_HASH_KEY);
    sessionStorage.removeItem(SS_UNLOCK_KEY);
    mostrarLock(true);
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

  // ===== Init =====
  function init() {
    carregar();

    gel("fin-lock-btn").addEventListener("click", tentarEntrar);
    [gel("fin-lock-senha"), gel("fin-lock-senha2")].forEach(el => {
      el.addEventListener("keydown", e => { if (e.key === "Enter") tentarEntrar(); });
    });
    gel("fin-lock-btn2").addEventListener("click", bloquear);
    gel("fin-senha-btn").addEventListener("click", trocarSenha);

    gel("fin-novo-btn").addEventListener("click", () => abrirForm(null));
    gel("fin-modal-fechar").addEventListener("click", fecharForm);
    gel("fin-f-cancelar").addEventListener("click", fecharForm);
    gel("fin-f-salvar").addEventListener("click", salvarForm);
    gel("fin-f-excluir").addEventListener("click", excluirLancamento);
    gel("fin-modal-lanc").addEventListener("click", e => { if (e.target === gel("fin-modal-lanc")) fecharForm(); });

    document.querySelectorAll(".fin-filtro").forEach(btn => {
      btn.addEventListener("click", () => {
        filtroAtual = btn.dataset.filtro;
        document.querySelectorAll(".fin-filtro").forEach(b => b.classList.toggle("is-active", b === btn));
        renderTabela();
      });
    });

    if (estaDesbloqueado()) mostrarConteudo();
    else mostrarLock(!temSenha());
  }

  init();
})();
