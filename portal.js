// ===== Portal Corporativo — Lolek Viagens =====
(function () {
  "use strict";

  const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
  const SUPABASE_KEY = "sb_publishable_MbjatMYR9rh6O0-S6icfAQ_Ol0QRsxw"; // segura para uso no navegador (protegida por RLS)

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  let emissoes    = [];
  let filtroAtual = "todos";

  function gel(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fBRL(v) {
    return "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fData(iso) {
    return iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  }

  function statusBadgeClass(status) {
    if (status === "pago") return "concluido";
    if (status === "atrasado") return "pendente";
    return "andamento";
  }

  function statusLabel(status) {
    return { aguardando: "Aguardando", pago: "Pago", atrasado: "Atrasado", cancelado: "Cancelado" }[status] || status;
  }

  function notaFiscalLabel(status) {
    return { nao_solicitada: "Não solicitada", solicitada: "Solicitada", emitida: "Emitida" }[status] || "—";
  }

  // ===== Login =====
  function mostrarErroLogin(msg) {
    const el = gel("portal-login-erro");
    el.textContent = msg;
    el.hidden = false;
  }

  async function fazerLogin() {
    const email = gel("portal-email").value.trim();
    const senha = gel("portal-senha").value;
    if (!email || !senha) return;

    const btn = gel("portal-login-btn");
    btn.disabled = true;
    gel("portal-login-erro").hidden = true;

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) {
        mostrarErroLogin(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
        return;
      }
      await mostrarDashboard();
    } catch (err) {
      mostrarErroLogin("Erro ao entrar: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function fazerLogout() {
    await supabase.auth.signOut();
    mostrarLogin();
  }

  function mostrarLogin() {
    gel("portal-dashboard-wrap").hidden = true;
    gel("portal-login-wrap").hidden = false;
    gel("portal-senha").value = "";
  }

  // ===== Dashboard =====
  async function mostrarDashboard() {
    gel("portal-login-wrap").hidden = true;
    gel("portal-dashboard-wrap").hidden = false;
    await carregarDados();
  }

  function showStatus(html) { gel("portal-status").innerHTML = html; }
  function clearStatus()    { gel("portal-status").innerHTML = ""; }

  async function carregarDados() {
    showStatus('<div class="notice">Carregando…</div>');
    try {
      const { data: empresaRows, error: errEmpresa } = await supabase.from("empresas").select("*").limit(1);
      if (errEmpresa) throw errEmpresa;
      if (!empresaRows || empresaRows.length === 0) {
        showStatus('<div class="notice notice--error"><strong>Nenhuma empresa vinculada a este acesso.</strong><p>Fale com a Lolek Viagens.</p></div>');
        return;
      }
      const empresa = empresaRows[0];
      gel("portal-empresa-nome").textContent = empresa.nome;
      gel("portal-empresa-cnpj").textContent = empresa.cnpj || "";

      const { data: emissoesRows, error: errEmissoes } = await supabase
        .from("emissoes")
        .select("*")
        .eq("empresa_id", empresa.id)
        .order("data_emissao", { ascending: false, nullsFirst: false });
      if (errEmissoes) throw errEmissoes;

      emissoes = emissoesRows || [];
      clearStatus();
      renderStats();
      renderTabela();
    } catch (err) {
      showStatus(`<div class="notice notice--error"><strong>Erro ao carregar dados.</strong><p>${escHtml(err.message)}</p></div>`);
    }
  }

  function renderStats() {
    const total       = emissoes.length;
    const aguardando  = emissoes.filter(e => e.status_pagamento === "aguardando").reduce((s, e) => s + parseFloat(e.valor || 0), 0);
    const pago        = emissoes.filter(e => e.status_pagamento === "pago").reduce((s, e) => s + parseFloat(e.valor || 0), 0);
    const atrasado    = emissoes.filter(e => e.status_pagamento === "atrasado").reduce((s, e) => s + parseFloat(e.valor || 0), 0);

    gel("portal-stat-total").textContent      = total;
    gel("portal-stat-aguardando").textContent = fBRL(aguardando);
    gel("portal-stat-pago").textContent       = fBRL(pago);
    gel("portal-stat-atrasado").textContent   = fBRL(atrasado);
  }

  function emissoesFiltradas() {
    if (filtroAtual === "todos") return emissoes;
    return emissoes.filter(e => e.status_pagamento === filtroAtual);
  }

  function renderTabela() {
    const body  = gel("portal-emissoes-body");
    const vazio = gel("portal-emissoes-vazio");
    const lista = emissoesFiltradas();

    if (lista.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma emissão encontrada</p></div>`;
      return;
    }
    vazio.innerHTML = "";

    body.innerHTML = lista.map(e => {
      const trecho = (e.saida || e.destino) ? `${escHtml(e.saida || "—")} → ${escHtml(e.destino || "—")}` : "—";
      return `
        <tr>
          <td>${fData(e.data_emissao)}</td>
          <td class="table__client">${escHtml(e.servico)}</td>
          <td>${escHtml(e.passageiro)}</td>
          <td class="table__muted">${trecho}</td>
          <td style="font-weight:600">${fBRL(e.valor)}</td>
          <td>${fData(e.data_pagamento)}</td>
          <td><span class="badge badge--${statusBadgeClass(e.status_pagamento)}">${statusLabel(e.status_pagamento)}</span></td>
          <td class="table__muted">${notaFiscalLabel(e.nota_fiscal_status)}</td>
        </tr>`;
    }).join("");
  }

  // ===== Trocar senha =====
  function abrirModalSenha() {
    gel("portal-nova-senha").value = "";
    gel("portal-senha-erro").hidden = true;
    gel("portal-modal-senha").hidden = false;
    gel("portal-nova-senha").focus();
  }
  function fecharModalSenha() { gel("portal-modal-senha").hidden = true; }

  async function salvarNovaSenha() {
    const novaSenha = gel("portal-nova-senha").value;
    if (!novaSenha || novaSenha.length < 6) {
      gel("portal-senha-erro").textContent = "A senha deve ter ao menos 6 caracteres.";
      gel("portal-senha-erro").hidden = false;
      return;
    }
    const btn = gel("portal-senha-salvar");
    btn.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;
      fecharModalSenha();
      alert("Senha alterada com sucesso!");
    } catch (err) {
      gel("portal-senha-erro").textContent = err.message;
      gel("portal-senha-erro").hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Init =====
  async function init() {
    gel("portal-login-btn").addEventListener("click", fazerLogin);
    [gel("portal-email"), gel("portal-senha")].forEach(el => {
      el.addEventListener("keydown", e => { if (e.key === "Enter") fazerLogin(); });
    });
    gel("portal-logout-btn").addEventListener("click", fazerLogout);

    gel("portal-trocar-senha-btn").addEventListener("click", abrirModalSenha);
    gel("portal-modal-senha-fechar").addEventListener("click", fecharModalSenha);
    gel("portal-senha-cancelar").addEventListener("click", fecharModalSenha);
    gel("portal-senha-salvar").addEventListener("click", salvarNovaSenha);
    gel("portal-modal-senha").addEventListener("click", e => { if (e.target === gel("portal-modal-senha")) fecharModalSenha(); });

    document.querySelectorAll("#portal-filtros .fin-filtro").forEach(btn => {
      btn.addEventListener("click", () => {
        filtroAtual = btn.dataset.filtro;
        document.querySelectorAll("#portal-filtros .fin-filtro").forEach(b => b.classList.toggle("is-active", b === btn));
        renderTabela();
      });
    });

    // Sessão persiste automaticamente via Supabase (localStorage) — verifica se já está logada
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await mostrarDashboard();
    else mostrarLogin();
  }

  init();
})();
