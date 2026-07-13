// ===== Clientes — Lolek Viagens =====
(function () {
  "use strict";

  const LS_AI_MODEL = "lolek_anthropic_model";

  // ===== Utilitários =====
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function gel(id) { return document.getElementById(id); }
  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  }
  function getModel()    { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }

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

  // ===== Estado =====
  let clientes    = [];
  let termoBusca  = "";
  let clienteEditando = null;
  let erroCarregar   = null;

  // ===== Persistência (Supabase — sincroniza entre computadores) =====
  async function listarRemoto() {
    const resp = await fetch("/.netlify/functions/clientes-data");
    if (!resp.ok) throw new Error("Erro ao buscar clientes");
    return await resp.json();
  }

  async function chamar(action, data) {
    const resp = await fetch("/.netlify/functions/clientes-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(json?.error || "Erro HTTP " + resp.status);
    return json;
  }

  async function carregar() {
    try {
      clientes = await listarRemoto();
      erroCarregar = null;
    } catch (e) {
      console.error("Falha ao carregar clientes", e);
      clientes = [];
      erroCarregar = e.message;
    }
  }

  // ===== Busca =====
  function clientesFiltrados() {
    const base = [...clientes].sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
    if (!termoBusca) return base;
    const t = norm(termoBusca);
    const td = t.replace(/\D/g, "");
    return base.filter(c =>
      norm(c.nome).includes(t) ||
      (td && (c.cpf || "").replace(/\D/g, "").includes(td)) ||
      (td && (c.telefone || "").replace(/\D/g, "").includes(td)) ||
      norm(c.email).includes(t) ||
      norm(c.passaporte).includes(t)
    );
  }

  // ===== Render lista =====
  function renderLista() {
    const lista = clientesFiltrados();
    const listEl  = gel("cli-lista");
    const countEl = gel("cli-count");
    if (!listEl) return;

    countEl.textContent = lista.length === clientes.length
      ? clientes.length + " clientes"
      : lista.length + " de " + clientes.length + " clientes";

    if (erroCarregar) {
      listEl.innerHTML = `<div class="empty-state"><p>Erro ao carregar clientes</p><small>${escHtml(erroCarregar)}</small></div>`;
      return;
    }

    if (lista.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>Nenhum cliente encontrado</p></div>';
      return;
    }

    // Agrupa por letra inicial
    const grupos = {};
    lista.forEach(c => {
      const letra = norm((c.nome || "?").charAt(0)).toUpperCase();
      if (!grupos[letra]) grupos[letra] = [];
      grupos[letra].push(c);
    });

    listEl.innerHTML = Object.keys(grupos).sort().map(letra => `
      <div class="cli-grupo">
        <div class="cli-grupo-letra">${escHtml(letra)}</div>
        <div class="cli-grupo-cards">
          ${grupos[letra].map(c => `
            <div class="cli-card" data-id="${escHtml(c.id)}">
              <div class="cli-card-nome">${escHtml(c.nome || "—")}</div>
              <div class="cli-card-meta">
                ${c.telefone ? `<span>${escHtml(c.telefone)}</span>` : ""}
                ${c.email    ? `<span>${escHtml(c.email)}</span>`    : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll(".cli-card").forEach(card => {
      card.addEventListener("click", () => abrirDetalhe(card.dataset.id));
    });
  }

  // ===== Modal de detalhe =====
  function abrirDetalhe(id) {
    const c = clientes.find(x => x.id === id);
    if (!c) return;
    clienteEditando = c;

    const campos = [
      { l: "Nome completo",         v: c.nome },
      { l: "Data de nascimento",    v: c.nascimento },
      { l: "RG",                    v: c.rg },
      { l: "CPF",                   v: c.cpf },
      { l: "Passaporte",            v: c.passaporte },
      { l: "Vencimento passaporte", v: c.venc_passaporte },
      { l: "E-mail",                v: c.email },
      { l: "Telefone",              v: c.telefone },
    ];

    gel("cli-detalhe-nome").textContent = c.nome || "—";
    gel("cli-detalhe-campos").innerHTML = campos.map(f => `
      <div class="cli-detalhe-row${f.v ? "" : " cli-detalhe-row--vazio"}">
        <span class="cli-detalhe-label">${escHtml(f.l)}</span>
        <span class="cli-detalhe-valor">${escHtml(f.v || "—")}</span>
        ${f.v ? `<button class="cli-copiar" data-val="${escHtml(f.v)}" title="Copiar">⧉</button>` : ""}
      </div>
    `).join("");

    gel("cli-detalhe-campos").querySelectorAll(".cli-copiar").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.val).catch(() => {});
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = "⧉"; }, 1500);
      });
    });

    gel("cli-modal-detalhe").hidden = false;
  }

  function fecharDetalhe() { gel("cli-modal-detalhe").hidden = true; clienteEditando = null; }

  // ===== Modal de novo / edição =====
  function abrirFormCliente(c) {
    const isEdicao = !!c;
    clienteEditando = c || null;

    const campos = ["nome","nascimento","rg","cpf","passaporte","venc_passaporte","email","telefone"];
    campos.forEach(f => { const el = gel("cform-" + f); if (el) el.value = c ? (c[f] || "") : ""; });

    gel("cli-form-titulo").textContent = isEdicao ? "Editar cliente" : "Novo cliente";
    gel("cli-form-excluir").hidden = !isEdicao;
    gel("cli-modal-form").hidden = false;
    gel("cform-nome").focus();
  }

  function fecharFormCliente() { gel("cli-modal-form").hidden = true; clienteEditando = null; }

  async function salvarFormCliente() {
    const campos = ["nome","nascimento","rg","cpf","passaporte","venc_passaporte","email","telefone"];
    const dados  = {};
    campos.forEach(f => { dados[f] = (gel("cform-" + f)?.value || "").trim(); });

    if (!dados.nome) { alert("Nome obrigatório."); return; }

    const btn = gel("cli-form-salvar");
    btn.disabled = true;
    try {
      if (clienteEditando) {
        await chamar("atualizar", { id: clienteEditando.id, ...dados });
      } else {
        await chamar("criar", dados);
      }
      await carregar();
      fecharFormCliente();
      renderLista();
    } catch (e) {
      alert("Erro ao salvar cliente: " + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirCliente() {
    if (!clienteEditando) return;
    if (!confirm("Excluir " + clienteEditando.nome + "?")) return;
    try {
      await chamar("excluir", { id: clienteEditando.id });
      await carregar();
      fecharFormCliente();
      renderLista();
    } catch (e) {
      alert("Erro ao excluir cliente: " + e.message);
    }
  }

  // ===== IA: extração do texto colado =====
  async function extrairComIA(texto) {
    const btn = gel("cform-ia-btn");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Extraindo..."; }

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 512,
          messages: [{
            role: "user",
            content: `Extraia os dados do cliente abaixo e retorne SOMENTE um JSON válido, sem texto adicional:\n\n${texto}\n\n{"nome":"","nascimento":"","rg":"","cpf":"","passaporte":"","venc_passaporte":"","email":"","telefone":""}`,
          }],
        }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada");

      const ex = JSON.parse(jsonStr);
      ["nome","nascimento","rg","cpf","passaporte","venc_passaporte","email","telefone"].forEach(f => {
        const el = gel("cform-" + f);
        if (el && ex[f]) el.value = ex[f];
      });
      gel("cform-ia-paste").value = "";
    } catch (err) {
      alert("Erro ao extrair: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "🤖 Extrair dados"; }
    }
  }

  // ===== Exportar CSV =====
  function exportarCSV() {
    const header = "Nome,Nascimento,RG,CPF,Passaporte,Venc. Passaporte,E-mail,Telefone";
    const csv = [header, ...clientes.map(c =>
      [c.nome, c.nascimento, c.rg, c.cpf, c.passaporte, c.venc_passaporte, c.email, c.telefone]
        .map(v => '"' + (v || "").replace(/"/g, '""') + '"').join(",")
    )].join("\r\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "lolek_clientes.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ===== Init =====
  async function init() {
    await carregar();
    renderLista();

    gel("cli-busca").addEventListener("input", e => { termoBusca = e.target.value; renderLista(); });
    gel("cli-novo-btn").addEventListener("click", () => abrirFormCliente(null));
    gel("cli-exportar-btn").addEventListener("click", exportarCSV);

    // Modal detalhe
    gel("cli-modal-detalhe").addEventListener("click", e => { if (e.target === gel("cli-modal-detalhe")) fecharDetalhe(); });
    gel("cli-detalhe-fechar").addEventListener("click", fecharDetalhe);
    gel("cli-detalhe-editar").addEventListener("click", () => {
      const c = clienteEditando;
      fecharDetalhe();
      abrirFormCliente(c);
    });

    // Modal form
    gel("cli-modal-form").addEventListener("click", e => { if (e.target === gel("cli-modal-form")) fecharFormCliente(); });
    gel("cli-form-fechar").addEventListener("click", fecharFormCliente);
    gel("cli-form-cancelar").addEventListener("click", fecharFormCliente);
    gel("cli-form-salvar").addEventListener("click", salvarFormCliente);
    gel("cli-form-excluir").addEventListener("click", excluirCliente);

    // Extração IA
    gel("cform-ia-btn").addEventListener("click", () => {
      const texto = gel("cform-ia-paste").value.trim();
      if (texto) extrairComIA(texto);
    });
  }

  init();
})();