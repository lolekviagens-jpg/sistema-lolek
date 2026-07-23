// ===== Contratos — Lolek Viagens =====
// Gera o contrato na ZapSign a partir do modelo DOCX e envia o link de
// assinatura pro cliente via Digisac (WhatsApp). O status "Assinado" é
// atualizado automaticamente pelo webhook da ZapSign (zapsign-webhook.js).
(function () {
  "use strict";

  const CAMPOS = [
    "nome_cliente", "cpf_cnpj", "endereco_cliente", "telefone_cliente",
    "email_cliente", "descricao_servico", "valor_total", "valor_extenso",
    "forma_pagamento", "prazo_entrega",
  ];
  const OBRIGATORIOS = CAMPOS.filter((c) => c !== "email_cliente");

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function gel(id) { return document.getElementById(id); }
  function fData(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  let contratos = [];

  async function carregar() {
    try {
      const resp = await fetch("/.netlify/functions/zapsign-webhook");
      if (!resp.ok) throw new Error("Erro ao buscar contratos");
      contratos = await resp.json();
    } catch (e) {
      console.error("Falha ao carregar contratos", e);
      contratos = null; // null = erro (diferente de lista vazia)
    }
  }

  function statusInfo(row) {
    if (row.status === "assinado")   return { label: "Assinado",              cls: "badge--concluido" };
    if (row.status === "erro_envio") return { label: "Falha no envio WhatsApp", cls: "badge--erro" };
    return { label: "Aguardando assinatura", cls: "badge--andamento" };
  }

  function renderLista() {
    const body  = gel("ctr-tabela-body");
    const vazio = gel("ctr-vazio");
    const count = gel("ctr-count");
    if (!body) return;

    if (contratos === null) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state"><p>Erro ao carregar contratos</p></div>';
      count.textContent = "";
      return;
    }

    count.textContent = contratos.length + " contrato" + (contratos.length !== 1 ? "s" : "");

    if (contratos.length === 0) {
      body.innerHTML = "";
      vazio.innerHTML = '<div class="empty-state"><p>Nenhum contrato gerado ainda</p></div>';
      return;
    }

    vazio.innerHTML = "";
    body.innerHTML = contratos.map((c) => {
      const st = statusInfo(c);
      return `
        <tr>
          <td>
            <span class="table__client">${escHtml(c.nome_cliente)}</span><br>
            <span class="table__muted">${escHtml(c.telefone_cliente || "")}</span>
          </td>
          <td>${escHtml(c.valor_total || "—")}</td>
          <td class="table__muted">${fData(c.criado_em)}</td>
          <td><span class="badge ${st.cls}">${st.label}</span></td>
          <td class="table__actions-col">
            <div class="table__actions">
              ${c.link_assinatura ? `<button type="button" class="btn btn--ghost btn--icon ctr-copiar-link" data-link="${escHtml(c.link_assinatura)}" title="Copiar link de assinatura">⧉</button>` : ""}
            </div>
          </td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".ctr-copiar-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.link).catch(() => {});
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = "⧉"; }, 1500);
      });
    });
  }

  function mostrarStatus(html) { gel("ctr-status").innerHTML = html; }

  function limparForm() {
    CAMPOS.forEach((c) => { const el = gel("ctr-" + c); if (el) el.value = ""; });
  }

  async function gerarContrato() {
    const dados = {};
    CAMPOS.forEach((c) => { dados[c] = (gel("ctr-" + c)?.value || "").trim(); });

    for (const c of OBRIGATORIOS) {
      if (!dados[c]) {
        mostrarStatus(`<div class="ctr-status-msg ctr-status-msg--erro">Preencha todos os campos obrigatórios (*).</div>`);
        gel("ctr-" + c)?.focus();
        return;
      }
    }

    const btn = gel("ctr-gerar-btn");
    btn.disabled = true; btn.textContent = "⏳ Gerando contrato...";
    mostrarStatus("");

    try {
      const resp = await fetch("/.netlify/functions/gerar-contrato", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dados),
      });
      const json = await resp.json().catch(() => ({}));

      if (resp.status === 200) {
        mostrarStatus(`<div class="ctr-status-msg ctr-status-msg--ok">✓ Contrato gerado e enviado por WhatsApp com sucesso.</div>`);
        limparForm();
      } else if (resp.status === 207) {
        mostrarStatus(`
          <div class="ctr-status-msg ctr-status-msg--warn">
            ⚠ Contrato criado na ZapSign, mas o envio pelo WhatsApp falhou.<br>
            Envie o link manualmente: <a href="${escHtml(json.link_assinatura)}" target="_blank" rel="noopener">${escHtml(json.link_assinatura)}</a>
          </div>`);
        limparForm();
      } else {
        mostrarStatus(`<div class="ctr-status-msg ctr-status-msg--erro">Erro ao gerar contrato: ${escHtml(json.error || "erro desconhecido")}</div>`);
      }

      await carregar();
      renderLista();
    } catch (e) {
      mostrarStatus(`<div class="empty-state empty-state--compact"><p>Erro: ${escHtml(e.message)}</p></div>`);
    } finally {
      btn.disabled = false; btn.textContent = "📝 Gerar e enviar contrato";
    }
  }

  async function init() {
    gel("ctr-gerar-btn")?.addEventListener("click", gerarContrato);
    gel("ctr-atualizar-btn")?.addEventListener("click", async () => { await carregar(); renderLista(); });

    await carregar();
    renderLista();
  }

  init();
})();
