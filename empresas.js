// ===== Empresas (Portal Corporativo) — Lolek Viagens =====
(function () {
  "use strict";

  let desbloqueado   = false; // só em memória: recarregar a página (F5) sempre pede a senha de novo
  let senhaAtual      = "";   // guardada em memória pra autenticar cada chamada à function
  let empresas        = [];
  let empresaAtivaId  = null;
  let emissoesAtivas  = [];
  let usuariosAtivos  = [];
  let emissaoEditando = null;

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

  function servicoClasse(servico) {
    const s = (servico || "").toLowerCase();
    if (s.includes("passagem") || s.includes("aére") || s.includes("aere") || s.includes("voo")) return "servico-passagem";
    if (s.includes("hospedagem") || s.includes("hotel"))  return "servico-hospedagem";
    if (s.includes("mala"))     return "servico-mala";
    if (s.includes("assento")) return "servico-assento";
    if (s.includes("seguro"))  return "servico-seguro";
    return "servico-outro";
  }

  function servicoBadgeHtml(servico) {
    return `<span class="badge badge--${servicoClasse(servico)}">${escHtml(servico)}</span>`;
  }

  // ===== Chamada à function administrativa =====
  async function chamar(action, data) {
    const resp = await fetch("/.netlify/functions/empresas-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senha: senhaAtual, action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  // ===== Senha (verificada no servidor, mesma senha do Financeiro) =====
  function mostrarErroLock(msg) {
    const el = gel("emp-lock-erro");
    el.textContent = msg;
    el.hidden = false;
  }

  function mostrarLock() {
    gel("emp-conteudo").hidden = true;
    gel("emp-lock").hidden = false;
    gel("emp-lock-senha").value = "";
    gel("emp-lock-erro").hidden = true;
    gel("emp-lock-senha").focus();
  }

  async function mostrarConteudo() {
    gel("emp-lock").hidden = true;
    gel("emp-conteudo").hidden = false;
    await carregarEmpresas();
  }

  async function tentarEntrar() {
    const senha = gel("emp-lock-senha").value;
    if (!senha) return;

    const btn = gel("emp-lock-btn");
    btn.disabled = true;
    gel("emp-lock-erro").hidden = true;

    try {
      const resp = await fetch("/.netlify/functions/financeiro-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const data = await resp.json();

      if (data.ok) {
        desbloqueado = true;
        senhaAtual = senha;
        await mostrarConteudo();
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
    senhaAtual = "";
    empresaAtivaId = null;
    mostrarLock();
  }

  // ===== Status / erro =====
  function showStatus(html) { gel("emp-status").innerHTML = html; }
  function clearStatus()    { gel("emp-status").innerHTML = ""; }

  // ===== Empresas =====
  async function carregarEmpresas() {
    showStatus('<div class="notice">Carregando empresas…</div>');
    try {
      empresas = await chamar("listar_empresas");
      clearStatus();
      renderListaEmpresas();
    } catch (err) {
      showStatus(`<div class="notice notice--error"><strong>Erro ao carregar empresas.</strong><p>${escHtml(err.message)}</p></div>`);
    }
  }

  function renderListaEmpresas() {
    const box = gel("emp-lista-empresas");
    if (empresas.length === 0) {
      box.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma empresa cadastrada</p></div>`;
      return;
    }
    box.innerHTML = empresas.map(e => `
      <div class="emp-empresa-card${e.id === empresaAtivaId ? " emp-empresa-card--ativa" : ""}" data-id="${escHtml(e.id)}">
        <div class="emp-empresa-nome">${escHtml(e.nome)}</div>
        ${e.cnpj ? `<div class="emp-empresa-cnpj">${escHtml(e.cnpj)}</div>` : ""}
      </div>`).join("");

    box.querySelectorAll(".emp-empresa-card").forEach(card => {
      card.addEventListener("click", () => selecionarEmpresa(card.dataset.id));
    });
  }

  async function selecionarEmpresa(id) {
    empresaAtivaId = id;
    renderListaEmpresas();

    const detalhe = gel("emp-detalhe");
    detalhe.innerHTML = `<div class="notice">Carregando…</div>`;

    try {
      const empresa = empresas.find(e => e.id === id);
      const [emissoes, usuarios] = await Promise.all([
        chamar("listar_emissoes", { empresa_id: id }),
        chamar("listar_usuarios_empresa", { empresa_id: id }),
      ]);
      emissoesAtivas = emissoes;
      usuariosAtivos = usuarios;
      renderDetalheEmpresa(empresa);
    } catch (err) {
      detalhe.innerHTML = `<div class="notice notice--error"><strong>Erro ao carregar dados da empresa.</strong><p>${escHtml(err.message)}</p></div>`;
    }
  }

  function statusBadgeClass(status) {
    if (status === "pago") return "concluido";
    if (status === "atrasado") return "pendente";
    if (status === "cancelado") return "pendente";
    return "andamento";
  }

  function statusLabel(status) {
    return { aguardando: "Aguardando", pago: "Pago", atrasado: "Atrasado", cancelado: "Cancelado" }[status] || status;
  }

  function notaFiscalLabel(status) {
    return { nao_solicitada: "Não solicitada", solicitada: "Solicitada", emitida: "Emitida" }[status] || status || "—";
  }

  function renderDetalheEmpresa(empresa) {
    const total = emissoesAtivas.length;
    const totalAguardando = emissoesAtivas.filter(e => e.status_pagamento === "aguardando").reduce((s, e) => s + parseFloat(e.valor || 0), 0);
    const totalPago        = emissoesAtivas.filter(e => e.status_pagamento === "pago").reduce((s, e) => s + parseFloat(e.valor || 0), 0);
    const totalAtrasado    = emissoesAtivas.filter(e => e.status_pagamento === "atrasado").reduce((s, e) => s + parseFloat(e.valor || 0), 0);

    const detalhe = gel("emp-detalhe");
    detalhe.innerHTML = `
      <div class="emp-detalhe-header">
        <div>
          <div class="emp-detalhe-nome">${escHtml(empresa.nome)}</div>
          ${empresa.cnpj ? `<div class="emp-detalhe-cnpj">${escHtml(empresa.cnpj)}</div>` : ""}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn--ghost" id="emp-btn-usuario" type="button">+ Criar acesso</button>
          <button class="btn btn--gold" id="emp-btn-emissao" type="button">+ Nova emissão</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat__value">${total}</div><div class="stat__label">Emissões</div></div>
        <div class="stat"><div class="stat__value">${fBRL(totalAguardando)}</div><div class="stat__label">Aguardando</div></div>
        <div class="stat stat--gold"><div class="stat__value">${fBRL(totalPago)}</div><div class="stat__label">Pago</div></div>
        <div class="stat"><div class="stat__value">${fBRL(totalAtrasado)}</div><div class="stat__label">Atrasado</div></div>
      </div>

      <div class="emp-usuarios-box">
        <div class="emp-usuarios-titulo">👤 Acesso ao portal (${usuariosAtivos.length})</div>
        ${usuariosAtivos.length === 0
          ? `<div class="emp-usuario-item">Nenhum acesso criado ainda.</div>`
          : usuariosAtivos.map(u => `<div class="emp-usuario-item">Usuário desde ${new Date(u.criado_em).toLocaleDateString("pt-BR")}</div>`).join("")}
      </div>

      <div class="card">
        <table class="table">
          <thead>
            <tr>
              <th>Emissão</th>
              <th>Serviço</th>
              <th>Passageiro</th>
              <th>Trecho</th>
              <th>Valor</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th>N. Fiscal</th>
              <th class="table__actions-col"></th>
            </tr>
          </thead>
          <tbody id="emp-emissoes-body"></tbody>
        </table>
      </div>
      <div id="emp-emissoes-vazio"></div>
    `;

    gel("emp-btn-emissao").addEventListener("click", () => abrirModalEmissao(null));
    gel("emp-btn-usuario").addEventListener("click", abrirModalUsuario);

    renderTabelaEmissoes();
  }

  function renderTabelaEmissoes() {
    const body  = gel("emp-emissoes-body");
    const vazio = gel("emp-emissoes-vazio");

    if (emissoesAtivas.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhuma emissão cadastrada</p></div>`;
      return;
    }
    vazio.innerHTML = "";

    body.innerHTML = emissoesAtivas.map(e => {
      const trecho = (e.saida || e.destino) ? `${escHtml(e.saida || "—")} → ${escHtml(e.destino || "—")}` : "—";
      return `
        <tr data-id="${escHtml(e.id)}">
          <td>${fData(e.data_emissao)}</td>
          <td>${servicoBadgeHtml(e.servico)}</td>
          <td>${escHtml(e.passageiro)}</td>
          <td class="table__muted">${trecho}</td>
          <td style="font-weight:600">${fBRL(e.valor)}</td>
          <td>${fData(e.data_pagamento)}</td>
          <td><span class="badge badge--${statusBadgeClass(e.status_pagamento)}">${statusLabel(e.status_pagamento)}</span></td>
          <td class="table__muted">${notaFiscalLabel(e.nota_fiscal_status)}</td>
          <td class="table__actions-col">
            <div class="table__actions">
              <button class="btn btn--ghost btn--icon emp-editar-emissao" title="Editar">✏</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".emp-editar-emissao").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        abrirModalEmissao(emissoesAtivas.find(e => e.id === id));
      });
    });
  }

  // ===== Modal: nova empresa =====
  function abrirModalEmpresa() {
    gel("emp-f-nome").value = "";
    gel("emp-f-cnpj").value = "";
    gel("emp-modal-empresa").hidden = false;
    gel("emp-f-nome").focus();
  }
  function fecharModalEmpresa() { gel("emp-modal-empresa").hidden = true; }

  async function salvarEmpresa() {
    const nome = gel("emp-f-nome").value.trim();
    const cnpj = gel("emp-f-cnpj").value.trim();
    if (!nome) { alert("Nome da empresa é obrigatório."); return; }

    const btn = gel("emp-f-empresa-salvar");
    btn.disabled = true;
    try {
      await chamar("criar_empresa", { nome, cnpj });
      fecharModalEmpresa();
      await carregarEmpresas();
    } catch (err) {
      alert("Erro ao criar empresa: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Modal: nova/editar emissão =====
  function abrirModalEmissao(e) {
    emissaoEditando = e || null;
    gel("emp-modal-emissao-titulo").textContent = e ? "Editar emissão" : "Nova emissão";
    gel("emp-e-data_emissao").value      = e && e.data_emissao ? formatarDataInput(e.data_emissao) : "";
    gel("emp-e-servico").value           = e ? e.servico : "";
    gel("emp-e-passageiro").value        = e ? e.passageiro : "";
    gel("emp-e-data_ida").value          = e && e.data_ida ? formatarDataInput(e.data_ida) : "";
    gel("emp-e-data_volta").value        = e && e.data_volta ? formatarDataInput(e.data_volta) : "";
    gel("emp-e-saida").value             = e ? (e.saida || "") : "";
    gel("emp-e-destino").value           = e ? (e.destino || "") : "";
    gel("emp-e-localizador").value       = e ? (e.localizador || "") : "";
    gel("emp-e-valor").value             = e ? e.valor : "";
    gel("emp-e-data_pagamento").value    = e && e.data_pagamento ? formatarDataInput(e.data_pagamento) : "";
    gel("emp-e-status_pagamento").value  = e ? e.status_pagamento : "aguardando";
    gel("emp-e-nota_fiscal_status").value = e ? e.nota_fiscal_status : "nao_solicitada";
    gel("emp-e-excluir").hidden = !e;
    gel("emp-modal-emissao").hidden = false;
    gel("emp-e-servico").focus();
  }
  function fecharModalEmissao() { gel("emp-modal-emissao").hidden = true; emissaoEditando = null; }

  // DD/MM/AAAA <-> AAAA-MM-DD (formato aceito pelo Postgres)
  function formatarDataInput(isoDate) {
    const d = new Date(isoDate + "T12:00:00");
    if (isNaN(d)) return "";
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }
  function paraDataISO(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  }

  async function salvarEmissao() {
    const dados = {
      empresa_id:          empresaAtivaId,
      data_emissao:        paraDataISO(gel("emp-e-data_emissao").value),
      servico:              gel("emp-e-servico").value.trim(),
      passageiro:            gel("emp-e-passageiro").value.trim(),
      data_ida:            paraDataISO(gel("emp-e-data_ida").value),
      data_volta:          paraDataISO(gel("emp-e-data_volta").value),
      saida:                gel("emp-e-saida").value.trim(),
      destino:              gel("emp-e-destino").value.trim(),
      localizador:          gel("emp-e-localizador").value.trim(),
      valor:                parseFloat(gel("emp-e-valor").value) || 0,
      data_pagamento:      paraDataISO(gel("emp-e-data_pagamento").value),
      status_pagamento:      gel("emp-e-status_pagamento").value,
      nota_fiscal_status:    gel("emp-e-nota_fiscal_status").value,
    };
    if (!dados.servico)     { alert("Informe o serviço."); return; }
    if (!dados.passageiro)  { alert("Informe o passageiro."); return; }
    if (!dados.valor)       { alert("Informe o valor."); return; }

    const btn = gel("emp-e-salvar");
    btn.disabled = true;
    try {
      if (emissaoEditando) {
        await chamar("atualizar_emissao", { id: emissaoEditando.id, ...dados });
      } else {
        await chamar("criar_emissao", dados);
      }
      fecharModalEmissao();
      await selecionarEmpresa(empresaAtivaId);
    } catch (err) {
      alert("Erro ao salvar emissão: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirEmissao() {
    if (!emissaoEditando) return;
    if (!confirm('Excluir a emissão de "' + emissaoEditando.passageiro + '"?')) return;
    try {
      await chamar("excluir_emissao", { id: emissaoEditando.id });
      fecharModalEmissao();
      await selecionarEmpresa(empresaAtivaId);
    } catch (err) {
      alert("Erro ao excluir: " + err.message);
    }
  }

  // ===== Modal: criar acesso da empresa =====
  function abrirModalUsuario() {
    gel("emp-u-email").value = "";
    gel("emp-u-resultado").hidden = true;
    gel("emp-u-resultado").innerHTML = "";
    gel("emp-modal-usuario").hidden = false;
    gel("emp-u-email").focus();
  }
  function fecharModalUsuario() { gel("emp-modal-usuario").hidden = true; }

  async function criarUsuario() {
    const email = gel("emp-u-email").value.trim();
    if (!email) { alert("Informe o e-mail."); return; }

    const btn = gel("emp-u-criar");
    btn.disabled = true;
    try {
      const resultado = await chamar("criar_usuario_empresa", { empresa_id: empresaAtivaId, email });
      gel("emp-u-resultado").hidden = false;
      gel("emp-u-resultado").innerHTML = `
        <div class="emp-senha-resultado">
          <div>✅ Acesso criado! Copie e envie pra empresa (essa senha só aparece agora):</div>
          <div style="margin-top:8px">E-mail: <strong>${escHtml(resultado.email)}</strong></div>
          <div>Senha: <strong>${escHtml(resultado.senha_temporaria)}</strong></div>
        </div>`;
      await selecionarEmpresa(empresaAtivaId);
    } catch (err) {
      alert("Erro ao criar acesso: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Init =====
  function init() {
    gel("emp-lock-btn").addEventListener("click", tentarEntrar);
    gel("emp-lock-senha").addEventListener("keydown", e => { if (e.key === "Enter") tentarEntrar(); });
    gel("emp-lock-btn2").addEventListener("click", bloquear);

    gel("emp-nova-empresa-btn").addEventListener("click", abrirModalEmpresa);
    gel("emp-modal-empresa-fechar").addEventListener("click", fecharModalEmpresa);
    gel("emp-f-empresa-cancelar").addEventListener("click", fecharModalEmpresa);
    gel("emp-f-empresa-salvar").addEventListener("click", salvarEmpresa);
    gel("emp-modal-empresa").addEventListener("click", e => { if (e.target === gel("emp-modal-empresa")) fecharModalEmpresa(); });

    gel("emp-modal-emissao-fechar").addEventListener("click", fecharModalEmissao);
    gel("emp-e-cancelar").addEventListener("click", fecharModalEmissao);
    gel("emp-e-salvar").addEventListener("click", salvarEmissao);
    gel("emp-e-excluir").addEventListener("click", excluirEmissao);
    gel("emp-modal-emissao").addEventListener("click", e => { if (e.target === gel("emp-modal-emissao")) fecharModalEmissao(); });

    gel("emp-modal-usuario-fechar").addEventListener("click", fecharModalUsuario);
    gel("emp-u-cancelar").addEventListener("click", fecharModalUsuario);
    gel("emp-u-criar").addEventListener("click", criarUsuario);
    gel("emp-modal-usuario").addEventListener("click", e => { if (e.target === gel("emp-modal-usuario")) fecharModalUsuario(); });

    if (desbloqueado) mostrarConteudo();
    else mostrarLock();
  }

  init();
})();
