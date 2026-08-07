// ===== Usuários (login das funcionárias) + log de atividade — Lolek Viagens =====
(function () {
  "use strict";

  const AUTH_FN = "/.netlify/functions/auth";

  function gel(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  const AREA_LABEL = {
    emissao: "Emissão", cliente: "Cliente", financeiro: "Financeiro",
    fornecedor: "Fornecedor", contrato: "Contrato", empresa: "Empresa", vendas_config: "Metas de vendas",
  };
  const ACAO_LABEL = { criar: "➕ Criou", editar: "✏ Editou", excluir: "🗑 Apagou" };

  const statusEl = gel("usr-status");
  const listaTbody = gel("usr-lista-tbody");
  const logTbody = gel("usr-log-tbody");
  const logFiltroArea = gel("usr-log-filtro-area");

  async function chamarAuth(action, data) {
    const resp = await fetch(AUTH_FN, {
      method: "POST",
      headers: { "content-type": "application/json", ...(window.LolekAuth ? window.LolekAuth.headers() : {}) },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  function mostrarErro(msg) {
    statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro</strong>${escHtml(msg)}</div>`;
  }

  // ===== Lista de usuários =====
  async function carregarUsuarios() {
    try {
      const usuarios = await chamarAuth("listar_usuarios");
      if (usuarios.length === 0) {
        listaTbody.innerHTML = `<tr><td colspan="5" class="table__muted">Nenhum usuário cadastrado</td></tr>`;
        return;
      }
      listaTbody.innerHTML = usuarios.map((u) => `
        <tr>
          <td>${escHtml(u.nome)}</td>
          <td class="table__muted">${escHtml(u.usuario)}</td>
          <td>${u.admin ? "🔑 Admin" : "Funcionária"}</td>
          <td>${u.ativo ? '<span class="badge badge--concluido">Ativo</span>' : '<span class="badge badge--erro">Desativado</span>'}</td>
          <td style="display:flex;gap:6px">
            <button type="button" class="btn btn--ghost btn--icon" data-editar-usr="${u.id}" title="Editar">✏</button>
            <button type="button" class="btn btn--ghost btn--icon" data-toggle-usr="${u.id}" data-ativo="${u.ativo}" title="${u.ativo ? "Desativar" : "Reativar"}">${u.ativo ? "🔒" : "🔓"}</button>
          </td>
        </tr>`).join("");

      listaTbody.querySelectorAll("[data-editar-usr]").forEach((btn) => {
        btn.addEventListener("click", () => abrirModal(usuarios.find((u) => u.id === btn.dataset.editarUsr)));
      });
      listaTbody.querySelectorAll("[data-toggle-usr]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ativo = btn.dataset.ativo === "true";
          try {
            await chamarAuth("editar_usuario", { id: btn.dataset.toggleUsr, ativo: !ativo });
            carregarUsuarios();
          } catch (err) { mostrarErro(err.message); }
        });
      });
    } catch (err) {
      mostrarErro(err.message);
    }
  }

  // ===== Modal criar/editar =====
  const modal = gel("usr-modal");
  const modalTitulo = gel("usr-modal-titulo");
  const modalErro = gel("usr-modal-erro");
  const idEl = gel("usr-id"), nomeEl = gel("usr-nome"), usuarioEl = gel("usr-usuario"),
        senhaEl = gel("usr-senha"), senhaHintEl = gel("usr-senha-hint"), adminEl = gel("usr-admin");

  function abrirModal(usuario) {
    modalErro.hidden = true;
    idEl.value = usuario ? usuario.id : "";
    nomeEl.value = usuario ? usuario.nome : "";
    usuarioEl.value = usuario ? usuario.usuario : "";
    usuarioEl.disabled = !!usuario; // login não muda depois de criado
    senhaEl.value = "";
    adminEl.checked = usuario ? !!usuario.admin : false;
    modalTitulo.textContent = usuario ? "Editar usuário" : "Novo usuário";
    senhaHintEl.textContent = usuario ? "(deixe em branco pra manter)" : "*";
    modal.hidden = false;
  }
  function fecharModal() { modal.hidden = true; }

  gel("usr-novo-btn").addEventListener("click", () => abrirModal(null));
  gel("usr-modal-fechar").addEventListener("click", fecharModal);
  gel("usr-cancelar").addEventListener("click", fecharModal);

  gel("usr-salvar").addEventListener("click", async () => {
    modalErro.hidden = true;
    const id = idEl.value;
    const nome = nomeEl.value.trim();
    const usuario = usuarioEl.value.trim();
    const senha = senhaEl.value;
    const admin = adminEl.checked;

    if (!nome || (!id && !usuario) || (!id && !senha)) {
      modalErro.textContent = "Preencha nome, usuário e senha.";
      modalErro.hidden = false;
      return;
    }
    try {
      if (id) {
        await chamarAuth("editar_usuario", { id, nome, admin, ...(senha ? { senha } : {}) });
      } else {
        await chamarAuth("criar_usuario", { nome, usuario, senha, admin });
      }
      fecharModal();
      carregarUsuarios();
    } catch (err) {
      modalErro.textContent = err.message;
      modalErro.hidden = false;
    }
  });

  // ===== Log de atividade =====
  function fDataHora(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  async function carregarLog() {
    try {
      const linhas = await chamarAuth("listar_atividade", { area: logFiltroArea.value || undefined });
      if (linhas.length === 0) {
        logTbody.innerHTML = `<tr><td colspan="5" class="table__muted">Nada por aqui ainda</td></tr>`;
        return;
      }
      logTbody.innerHTML = linhas.map((l) => `
        <tr>
          <td class="table__muted">${fDataHora(l.criado_em)}</td>
          <td>${escHtml(l.usuario_nome || "—")}</td>
          <td>${ACAO_LABEL[l.acao] || escHtml(l.acao)}</td>
          <td class="table__muted">${escHtml(AREA_LABEL[l.area] || l.area)}</td>
          <td class="table__muted">${escHtml(l.descricao || "—")}</td>
        </tr>`).join("");
    } catch (err) {
      mostrarErro(err.message);
    }
  }

  logFiltroArea.innerHTML = '<option value="">Todas as áreas</option>' +
    Object.entries(AREA_LABEL).map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join("");
  logFiltroArea.addEventListener("change", carregarLog);

  // Só carrega quando a aba é aberta (evita chamada logo de cara sem estar logado/admin)
  document.querySelector('[data-tab="usuarios"]').addEventListener("click", () => {
    carregarUsuarios();
    carregarLog();
  });
})();
