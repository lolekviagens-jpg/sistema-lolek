// ===== Aba Convenção (temporária) — Lolek Viagens =====
// Lista tudo que foi vendido com origem_lead = "Convenção" (ver ORIGENS_LEAD em emissoes.js),
// agrupado por produto, com um checklist de confirmação persistido no Supabase (ver
// netlify/functions/convencao-data.js). Os dados da venda em si (cliente, voo, hotel...)
// continuam vindo de Emissões — essa aba só lê e empresta um checkbox por cima.
(function () {
  "use strict";

  function gel(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fBRL(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fData(iso) {
    if (!iso) return "—";
    const [y, m, d] = String(iso).split("-");
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }

  const TIPO_LABEL = {
    passagem: "✈️ Passagem aérea", hospedagem: "🏨 Hospedagem", seguro: "🛡️ Seguro viagem",
    carro: "🚗 Aluguel de carro", trem: "🚆 Trem", passeio: "🗺️ Passeio / Ingresso",
    transfer: "🚌 Transfer", chip: "📶 Chip/eSIM internacional", mala: "🧳 Adicional de mala",
    assento: "💺 Assento", consultoria_milhas: "🧭 Consultoria de milhas",
    visto_americano: "🛂 Visto americano", venda_milhas: "💱 Venda de milhas", outro: "📌 Outro / Diversos",
  };
  // Ordem fixa das seções — produtos mais relevantes pra conferência do evento primeiro.
  const ORDEM_TIPOS = ["passagem", "hospedagem", "trem", "transfer", "carro", "chip", "passeio", "seguro", "mala", "assento", "outro", "consultoria_milhas", "visto_americano", "venda_milhas"];

  // Cidades da convenção — cada entrada é [nome pra exibir, variações de texto pra detectar
  // (sem acento, minúsculo)]. Qualquer item cujo texto não bater com nenhuma entra em
  // "Cidade não identificada", nunca é descartado silenciosamente.
  const CIDADES_CONVENCAO = [
    ["Roma",     ["roma"]],
    ["Assis",    ["assis", "assisi"]],
    ["Florença", ["florenc", "firenze"]],
    ["Veneza",   ["venez", "venice"]],
  ];
  function detectarCidade(texto) {
    const t = norm(texto || "");
    for (const [nome, variacoes] of CIDADES_CONVENCAO) {
      if (variacoes.some((v) => t.includes(v))) return nome;
    }
    return null;
  }

  async function chamarConvencao(action, data) {
    const resp = await fetch("/.netlify/functions/convencao-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  async function carregarEmissoes() {
    const r = await fetch("/.netlify/functions/emissoes-data");
    if (!r.ok) throw new Error("Erro ao carregar emissões (HTTP " + r.status + ")");
    return r.json();
  }
  async function carregarClientes() {
    const r = await fetch("/.netlify/functions/clientes-data");
    return r.ok ? r.json() : [];
  }

  // Texto-chave de cada tipo de produto, usado pra detectar cidade e pra mostrar o detalhe
  // principal na lista (o que mais importa olhar de cada um).
  function detalheEBase(prod) {
    const d = prod.dados || {};
    switch (prod.tipo) {
      case "passagem": {
        const ida = d.ida || d;
        const seg = (ida.segmentos && ida.segmentos[0]) || {};
        const voltaTxt = d.volta ? " + volta" : "";
        return { detalhe: `${seg.trecho || "—"}${seg.companhia ? " — " + seg.companhia : ""}${voltaTxt}`, textoCidade: (seg.trecho || "") };
      }
      case "hospedagem":
        return { detalhe: `${d.hotel || "Hotel não informado"} — ${fData(d.checkin)} a ${fData(d.checkout)}`, textoCidade: [d.hotel, d.endereco].filter(Boolean).join(" ") };
      case "trem":
        return { detalhe: `${d.trecho || "—"} — ${d.companhia || ""} — ${fData(d.data_viagem)}`, textoCidade: d.trecho || "" };
      case "transfer":
        return { detalhe: `${d.trecho || "—"} (${d.tipo_transfer || "—"})`, textoCidade: d.trecho || "" };
      case "carro":
        return { detalhe: `${d.locadora || "—"} — ${fData(d.data_retirada)} a ${fData(d.data_devolucao)}`, textoCidade: d.locadora || "" };
      case "chip":
        return { detalhe: `${d.operadora || "—"} — ${d.dados || ""} — ${d.cobertura || ""}`, textoCidade: d.cobertura || "" };
      case "passeio":
        return { detalhe: `${d.descricao || "—"} — ${fData(d.data_passeio)}`, textoCidade: d.descricao || "" };
      case "seguro":
        return { detalhe: `${d.seguradora || "—"} — ${d.plano || ""}`, textoCidade: "" };
      case "mala":
        return { detalhe: d.descricao || "Mala adicional", textoCidade: "" };
      default:
        return { detalhe: d.descricao || "—", textoCidade: "" };
    }
  }

  // Monta a lista plana de itens vendidos pra Convenção, a partir de todas as emissões —
  // cada produto vira um item, com os nomes dos passageiros já resolvidos.
  function montarItens(emissoes, clienteNomePorId) {
    const itens = [];
    emissoes.forEach((e) => {
      const paxPorId = new Map((e.venda_emissoes_passageiros || []).map((p) => [p.id, p]));
      (e.venda_emissoes_produtos || []).forEach((prod) => {
        if (prod.origem_lead !== "Convenção") return;
        const nomesPax = (prod.passageiro_ids || [])
          .map((pid) => { const pax = paxPorId.get(pid); return pax && clienteNomePorId.get(pax.cliente_id); })
          .filter(Boolean)
          .join(" / ") || "Passageiro não identificado";
        const { detalhe, textoCidade } = detalheEBase(prod);
        itens.push({
          id: prod.id,
          tipo: prod.tipo,
          nomesPax,
          detalhe,
          cidade: detectarCidade(textoCidade) || detectarCidade(e.destino),
          valor: prod.valor_venda,
          funcionaria: prod.funcionaria || "—",
          destino: e.destino || "",
        });
      });
    });
    return itens;
  }

  let confirmadosSet = new Set();
  let itensCache = [];

  function renderResumo(itens) {
    const total = itens.length;
    const confirmados = itens.filter((i) => confirmadosSet.has(i.id)).length;
    gel("cv-resumo").textContent = total === 0
      ? "Nenhum item vendido com origem \"Convenção\" ainda."
      : `${total} ite${total !== 1 ? "ns" : "m"} vendido${total !== 1 ? "s" : ""} — ${confirmados} confirmado${confirmados !== 1 ? "s" : ""}, ${total - confirmados} pendente${total - confirmados !== 1 ? "s" : ""}`;
  }

  function itemLinhaHtml(item) {
    const confirmado = confirmadosSet.has(item.id);
    return `
      <div class="cv-item ${confirmado ? "cv-item--ok" : ""}">
        <label class="cv-item__check">
          <input type="checkbox" data-cv-check="${item.id}" ${confirmado ? "checked" : ""} />
        </label>
        <div class="cv-item__corpo">
          <div class="cv-item__nome">${escHtml(item.nomesPax)}</div>
          <div class="cv-item__detalhe">${escHtml(item.detalhe)}</div>
        </div>
        <div class="cv-item__valor">${fBRL(item.valor)}</div>
        <div class="cv-item__func table__muted">${escHtml(item.funcionaria)}</div>
      </div>`;
  }

  function renderLista(itens) {
    const wrap = gel("cv-lista-wrap");
    if (itens.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>Nenhum item vendido com origem "Convenção" ainda. Marque essa origem ao lançar as vendas em Emissões pra elas aparecerem aqui.</p></div>';
      return;
    }

    const porTipo = {};
    itens.forEach((i) => (porTipo[i.tipo] || (porTipo[i.tipo] = [])).push(i));
    const tipos = ORDEM_TIPOS.filter((t) => porTipo[t]).concat(Object.keys(porTipo).filter((t) => !ORDEM_TIPOS.includes(t)));

    // Tipos onde a cidade importa pra conferência (vários destinos na mesma viagem) —
    // sub-agrupa por cidade dentro da seção; os demais (chip, seguro, mala...) ficam numa
    // lista só, sem sub-divisão, porque não dependem de qual cidade é.
    const TIPOS_COM_CIDADE = new Set(["hospedagem", "trem", "transfer", "passeio"]);

    wrap.innerHTML = tipos.map((tipo) => {
      const lista = porTipo[tipo];
      const confirmadosTipo = lista.filter((i) => confirmadosSet.has(i.id)).length;
      const cabecalho = `<div class="cv-secao__header"><span>${TIPO_LABEL[tipo] || tipo}</span><span class="cv-secao__count">${confirmadosTipo}/${lista.length}</span></div>`;

      if (!TIPOS_COM_CIDADE.has(tipo)) {
        return `<div class="card cv-secao">${cabecalho}${lista.map(itemLinhaHtml).join("")}</div>`;
      }

      const porCidade = {};
      lista.forEach((i) => { const c = i.cidade || "Cidade não identificada"; (porCidade[c] || (porCidade[c] = [])).push(i); });
      const cidades = Object.keys(porCidade).sort((a, b) => a === "Cidade não identificada" ? 1 : b === "Cidade não identificada" ? -1 : a.localeCompare(b, "pt-BR"));
      return `<div class="card cv-secao">${cabecalho}
        ${cidades.map((cidade) => `
          <div class="cv-subsecao__header">${escHtml(cidade)}</div>
          ${porCidade[cidade].map(itemLinhaHtml).join("")}
        `).join("")}
      </div>`;
    }).join("");

    wrap.querySelectorAll("[data-cv-check]").forEach((chk) => {
      chk.addEventListener("change", async () => {
        const id = chk.dataset.cvCheck;
        chk.disabled = true;
        try {
          if (chk.checked) { await chamarConvencao("confirmar", { chave: id }); confirmadosSet.add(id); }
          else { await chamarConvencao("desconfirmar", { chave: id }); confirmadosSet.delete(id); }
          renderResumo(itensCache);
          chk.closest(".cv-item").classList.toggle("cv-item--ok", chk.checked);
        } catch (err) {
          alert("Não foi possível salvar: " + err.message);
          chk.checked = !chk.checked;
        } finally { chk.disabled = false; }
      });
    });
  }

  async function carregarTudo() {
    const statusEl = gel("cv-status");
    statusEl.innerHTML = `<div class="notice">Carregando...</div>`;
    try {
      const [emissoes, clientes, confirmacoes] = await Promise.all([
        carregarEmissoes(), carregarClientes(), chamarConvencao("listar_confirmacoes"),
      ]);
      const clienteNomePorId = new Map(clientes.map((c) => [c.id, c.nome]));
      confirmadosSet = new Set((confirmacoes || []).map((c) => c.chave));
      itensCache = montarItens(emissoes, clienteNomePorId);
      statusEl.innerHTML = "";
      renderResumo(itensCache);
      renderLista(itensCache);
    } catch (err) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao carregar.</strong><p>${escHtml(err.message)}</p></div>`;
    }
  }

  gel("cv-atualizar-btn").addEventListener("click", carregarTudo);

  let carregouUmaVez = false;
  document.querySelector('[data-tab="convencao"]').addEventListener("click", () => {
    if (carregouUmaVez) return;
    carregouUmaVez = true;
    carregarTudo();
  });
})();
