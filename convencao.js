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
  async function chamarEmissoes(action, data) {
    const resp = await fetch("/.netlify/functions/emissoes-data", {
      method: "POST",
      headers: { "content-type": "application/json", ...(window.LolekAuth ? window.LolekAuth.headers() : {}) },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }
  async function carregarClientes() {
    const r = await fetch("/.netlify/functions/clientes-data");
    return r.ok ? r.json() : [];
  }

  // O objetivo dessa aba é conferir cada reserva direto com a empresa (cia aérea, hotel,
  // locadora...) — por isso o foco é data/horário/companhia/localizador, nunca o valor.
  function textoSegmentos(segmentos) {
    return (segmentos || []).map((s) => {
      const partes = [];
      if (s.trecho) partes.push(s.trecho);
      if (s.companhia) partes.push(s.companhia + (s.voo ? " " + s.voo : ""));
      if (s.data) partes.push(fData(s.data));
      if (s.horario_partida || s.horario_chegada) partes.push((s.horario_partida || "—") + " → " + (s.horario_chegada || "—"));
      return partes.join(" · ") || "—";
    }).join("  |  ") || "—";
  }

  // Campos relevantes de cada tipo de produto (pra conferência com a empresa) + o texto
  // usado pra detectar a cidade do evento.
  function camposEBase(prod) {
    const d = prod.dados || {};
    switch (prod.tipo) {
      case "passagem": {
        const ida = d.ida || d;
        const campos = [{ label: "Ida", value: textoSegmentos(ida.segmentos) }];
        if (ida.localizador) campos.push({ label: "Localizador (ida)", value: ida.localizador });
        if (d.volta) {
          campos.push({ label: "Volta", value: textoSegmentos(d.volta.segmentos) });
          if (d.volta.localizador) campos.push({ label: "Localizador (volta)", value: d.volta.localizador });
        }
        const trechosIda = (ida.segmentos || []).map((s) => s.trecho).join(" ");
        const trechosVolta = (d.volta && d.volta.segmentos || []).map((s) => s.trecho).join(" ");
        return { campos, textoCidade: trechosIda + " " + trechosVolta };
      }
      case "hospedagem":
        return {
          campos: [
            { label: "Hotel", value: d.hotel || "—" },
            { label: "Check-in", value: fData(d.checkin) + (d.horario_checkin ? " · " + d.horario_checkin : "") },
            { label: "Check-out", value: fData(d.checkout) + (d.horario_checkout ? " · " + d.horario_checkout : "") },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: [d.hotel, d.endereco].filter(Boolean).join(" "),
        };
      case "trem":
        return {
          campos: [
            { label: "Trecho", value: d.trecho || "—" },
            { label: "Companhia", value: d.companhia || "—" },
            { label: "Data", value: fData(d.data_viagem) },
            { label: "Horário", value: (d.horario_partida || "—") + " → " + (d.horario_chegada || "—") },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: d.trecho || "",
        };
      case "transfer":
        return {
          campos: [
            { label: "Trecho", value: d.trecho || "—" },
            { label: "Tipo", value: d.tipo_transfer || "—" },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: d.trecho || "",
        };
      case "carro":
        return {
          campos: [
            { label: "Locadora", value: d.locadora || "—" },
            { label: "Retirada", value: fData(d.data_retirada) },
            { label: "Devolução", value: fData(d.data_devolucao) },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: d.locadora || "",
        };
      case "chip":
        return {
          campos: [
            { label: "Operadora", value: d.operadora || "—" },
            { label: "Cobertura", value: d.cobertura || "—" },
            { label: "Dados/validade", value: d.dados || "—" },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: d.cobertura || "",
        };
      case "passeio":
        return {
          campos: [
            { label: "Descrição", value: d.descricao || "—" },
            { label: "Data", value: fData(d.data_passeio) },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: d.descricao || "",
        };
      case "seguro":
        return {
          campos: [
            { label: "Seguradora", value: d.seguradora || "—" },
            { label: "Plano", value: d.plano || "—" },
            { label: "Vigência", value: fData(d.data_inicio) + " a " + fData(d.data_fim) },
            { label: "Localizador", value: d.localizador || "—" },
          ],
          textoCidade: "",
        };
      case "mala":
        return { campos: [{ label: "Descrição", value: d.descricao || "Mala adicional" }], textoCidade: "" };
      default: {
        const campos = [{ label: "Descrição", value: d.descricao || "—" }];
        if (d.localizador) campos.push({ label: "Localizador", value: d.localizador });
        return { campos, textoCidade: "" };
      }
    }
  }

  // "Outro" cobre coisas bem diferentes (chip, roteiro, consultoria...) — pra não misturar
  // tudo numa sala só, usa o texto da descrição pra dar um rótulo melhor que "outro" no
  // relatório. Não precisa ser perfeito: o texto completo continua nos campos de qualquer forma.
  function rotuloOutro(descricao) {
    const t = norm(descricao || "");
    if (/\bchip\b|esim|e-sim/.test(t)) return "📶 Chip/eSIM (lançado como Outro)";
    return "📌 Outro / Diversos";
  }

  function construirItem(prod, e, paxPorId, clienteNomePorId) {
    const nomesPax = (prod.passageiro_ids || [])
      .map((pid) => { const pax = paxPorId.get(pid); return pax && clienteNomePorId.get(pax.cliente_id); })
      .filter(Boolean)
      .join(" / ") || "Passageiro não identificado";
    const { campos, textoCidade } = camposEBase(prod);
    return {
      id: prod.id,
      tipo: prod.tipo,
      grupo: prod.tipo === "outro" ? rotuloOutro((prod.dados || {}).descricao) : null,
      nomesPax,
      campos,
      cidade: detectarCidade(textoCidade) || detectarCidade(e.destino),
      funcionaria: prod.funcionaria || "—",
      origemAtual: prod.origem_lead,
      destino: e.destino || "",
    };
  }

  // Monta a lista plana de itens vendidos pra Convenção, a partir de todas as emissões —
  // cada produto vira um item, com os nomes dos passageiros já resolvidos.
  function montarItens(emissoes, clienteNomePorId) {
    const itens = [];
    emissoes.forEach((e) => {
      const paxPorId = new Map((e.venda_emissoes_passageiros || []).map((p) => [p.id, p]));
      (e.venda_emissoes_produtos || []).forEach((prod) => {
        if (prod.origem_lead !== "Convenção") return;
        itens.push(construirItem(prod, e, paxPorId, clienteNomePorId));
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
    const camposHtml = item.campos.map((c) =>
      `<span class="cv-campo"><strong>${escHtml(c.label)}:</strong> ${escHtml(c.value)}</span>`
    ).join("");
    return `
      <div class="cv-item ${confirmado ? "cv-item--ok" : ""}">
        <label class="cv-item__check">
          <input type="checkbox" data-cv-check="${item.id}" ${confirmado ? "checked" : ""} />
        </label>
        <div class="cv-item__corpo">
          <div class="cv-item__nome">${escHtml(item.nomesPax)}</div>
          <div class="cv-item__campos">${camposHtml}</div>
        </div>
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
    // sub-agrupa por cidade dentro da seção. "Outro" sub-agrupa por grupo (ex: separa Chip
    // do resto) em vez de cidade. Os demais ficam numa lista só, sem sub-divisão.
    const TIPOS_COM_CIDADE = new Set(["hospedagem", "trem", "transfer", "passeio"]);

    wrap.innerHTML = tipos.map((tipo) => {
      const lista = porTipo[tipo];
      const confirmadosTipo = lista.filter((i) => confirmadosSet.has(i.id)).length;
      const cabecalho = `<div class="cv-secao__header"><span>${TIPO_LABEL[tipo] || tipo}</span><span class="cv-secao__count">${confirmadosTipo}/${lista.length}</span></div>`;

      const chaveSub = tipo === "outro" ? (i) => i.grupo : TIPOS_COM_CIDADE.has(tipo) ? (i) => i.cidade || "Cidade não identificada" : null;
      if (!chaveSub) {
        return `<div class="card cv-secao">${cabecalho}${lista.map(itemLinhaHtml).join("")}</div>`;
      }

      const porSub = {};
      lista.forEach((i) => { const c = chaveSub(i); (porSub[c] || (porSub[c] = [])).push(i); });
      const subs = Object.keys(porSub).sort((a, b) => a === "Cidade não identificada" ? 1 : b === "Cidade não identificada" ? -1 : a.localeCompare(b, "pt-BR"));
      return `<div class="card cv-secao">${cabecalho}
        ${subs.map((sub) => `
          <div class="cv-subsecao__header">${escHtml(sub)}</div>
          ${porSub[sub].map(itemLinhaHtml).join("")}
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

  // Reclassificação automática em lote (regra: viagem Itália/Assis + chip, 12–25/11) — roda
  // tudo de uma vez no backend (ver reconciliar_convencao em emissoes-data.js) e mostra o
  // resumo de quem mudou, sem precisar confirmar item por item.
  function renderResultadoReconciliacao(r) {
    const wrap = gel("cv-suspeitos-wrap");
    const partes = [];
    if (r.marcados.length) partes.push(`<div style="color:#1f8a4c">✅ Marcados como Convenção: ${r.marcados.length}</div>`);
    if (r.desmarcados.length) partes.push(`<div style="color:#c0392b">🗑 Removida a marcação de Convenção (fora da regra): ${r.desmarcados.length}</div>`);
    if (r.ambiguos.length) {
      partes.push(`<div style="color:#d4a017">⚠ ${r.ambiguos.length} sem data de viagem cadastrada — não dá pra aplicar a regra, confira na mão:</div>`);
      partes.push(r.ambiguos.map((a) => `<div class="table__muted" style="font-size:0.78rem;margin-left:12px">${escHtml(a.tipo)} — destino: ${escHtml(a.destino || "—")} — origem atual: "${escHtml(a.origem_atual || "—")}"</div>`).join(""));
    }
    if (partes.length === 0) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = `<div class="card cv-secao cv-secao--alerta"><div class="cv-secao__header"><span>Resultado da reclassificação automática</span></div>${partes.join("")}</div>`;
  }

  gel("cv-reconciliar-btn").addEventListener("click", async () => {
    const btn = gel("cv-reconciliar-btn");
    btn.disabled = true;
    const statusEl = gel("cv-status");
    statusEl.innerHTML = `<div class="notice">Reclassificando...</div>`;
    try {
      const r = await chamarEmissoes("reconciliar_convencao");
      statusEl.innerHTML = "";
      await carregarTudo();
      renderResultadoReconciliacao(r);
    } catch (err) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao reclassificar.</strong><p>${escHtml(err.message)}</p></div>`;
    } finally { btn.disabled = false; }
  });

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
      gel("cv-suspeitos-wrap").innerHTML = "";
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
