// ===== Confirmação de Emissão — Lolek Viagens =====
(function () {
  "use strict";

  const LOLEK_NOME  = "Lolek Viagens";
  const LOLEK_CNPJ  = "54.795.384/0001-05";
  const LOLEK_END   = "Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE";
  const LOLEK_EMAIL = "thaynara@agencialolekviagens.com.br";
  const LOLEK_TEL   = "(85) 99632-7092";

  const LS_AI_MODEL = "lolek_anthropic_model";

  // Mapeamento de companhias → site de gerenciamento da reserva
  const AIRLINE_SITES = {
    "latam":       { label: "LATAM Airlines",       url: "latam.com/pt-br/minhas-viagens",                         path: "latam.com → Minha Conta → Minhas Viagens" },
    "gol":         { label: "GOL Linhas Aéreas",    url: "voegol.com.br",                                           path: "voegol.com.br → Minha GOL → Gerenciar Reserva" },
    "azul":        { label: "Azul Linhas Aéreas",   url: "voeazul.com.br",                                          path: "voeazul.com.br → Gerenciar → Minhas Viagens" },
    "tap":         { label: "TAP Air Portugal",     url: "flytap.com/pt-br",                                        path: "flytap.com → Gerir Reservas" },
    "emirates":    { label: "Emirates",             url: "emirates.com/pt/portuguese/manage-booking",               path: "emirates.com → Manage Booking" },
    "copa":        { label: "Copa Airlines",        url: "copaair.com/pt",                                          path: "copaair.com → Minha Reserva" },
    "american":    { label: "American Airlines",    url: "aa.com",                                                  path: "aa.com → My Trips" },
    "delta":       { label: "Delta Air Lines",      url: "delta.com",                                               path: "delta.com → My Trips" },
    "united":      { label: "United Airlines",      url: "united.com",                                              path: "united.com → My Trips" },
    "air france":  { label: "Air France",           url: "airfrance.com.br",                                        path: "airfrance.com.br → Minha Reserva" },
    "klm":         { label: "KLM",                  url: "klm.com.br",                                              path: "klm.com.br → Gerenciar Reserva" },
    "iberia":      { label: "Iberia",               url: "iberia.com/pt",                                           path: "iberia.com → Minhas Viagens" },
    "lufthansa":   { label: "Lufthansa",            url: "lufthansa.com/pt",                                        path: "lufthansa.com → Minha Reserva" },
    "avianca":     { label: "Avianca",              url: "avianca.com/pt-br",                                       path: "avianca.com → Gerenciar Reserva" },
    "turkish":     { label: "Turkish Airlines",     url: "turkishairlines.com/pt-br",                               path: "turkishairlines.com → Gerencie sua Reserva" },
    "qatar":       { label: "Qatar Airways",        url: "qatarairways.com/pt",                                     path: "qatarairways.com → Gerenciar Reserva" },
    "british":     { label: "British Airways",      url: "britishairways.com",                                      path: "britishairways.com → Manage My Booking" },
    "swiss":       { label: "SWISS",                url: "swiss.com/pt",                                            path: "swiss.com → Gerenciar Reserva" },
    "aeromexico":  { label: "Aeroméxico",           url: "aeromexico.com/pt-br",                                    path: "aeromexico.com → Minha Reserva" },
    "ita":         { label: "ITA Airways",          url: "ita-airways.com",                                         path: "ita-airways.com → Minhas Reservas" },
    "alitalia":    { label: "ITA Airways",          url: "ita-airways.com",                                         path: "ita-airways.com → Minhas Reservas" },
  };

  function findAirline(str) {
    const lower = (str || "").toLowerCase();
    for (const [key, info] of Object.entries(AIRLINE_SITES)) {
      if (lower.includes(key)) return info;
    }
    return null;
  }

  function getModel()  { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function gel(id) { return document.getElementById(id); }
  function fBRL(v) {
    const n = parseFloat(String(v || "").replace(/[R$\s.]/g, "").replace(",", ".")) || 0;
    return n > 0 ? "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "";
  }

  // ===== Extração IA =====
  async function extrairReserva() {
    const texto = (gel("conf-paste")?.value || "").trim();
    const fileInput = gel("conf-print-input");
    const files = fileInput?.files;
    const temTexto  = texto.length > 0;
    const temArquivo = files && files.length > 0;

    if (!temTexto && !temArquivo) {
      alert("Cole o texto da confirmação, o print ou selecione um arquivo.");
      return;
    }

    const btn = gel("conf-extrair-btn");
    btn.disabled = true; btn.textContent = "⏳ Extraindo dados...";

    try {
      let content;

      if (temArquivo) {
        const file = files[0];
        const b64  = await fileToBase64(file);
        const match = b64.match(/^data:([^;]+);base64,(.+)$/);
        const mediaType = match[1];

        if (mediaType === "application/pdf") {
          content = [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: match[2] } },
            { type: "text", text: promptExtracao() },
          ];
        } else {
          content = [
            { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } },
            { type: "text", text: promptExtracao() },
          ];
        }
      } else {
        content = [{ type: "text", text: promptExtracao() + "\n\nTexto da confirmação:\n" + texto }];
      }

      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: getModel(), max_tokens: 2048, messages: [{ role: "user", content }] }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data    = await resp.json();
      const jsonStr = (data.content?.[0]?.text || "").match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const extraido = JSON.parse(jsonStr);
      // Normaliza: se a IA retornou campos legacy (origem/destino/voo), transforma em trechos
      if (!extraido.trechos || !extraido.trechos.length) {
        if (extraido.origem || extraido.destino) {
          extraido.trechos = [{
            label: "IDA", origem: extraido.origem, destino: extraido.destino,
            data: extraido.ida, horario_partida: extraido.horario_partida,
            horario_chegada: extraido.horario_chegada, companhia: extraido.companhia,
            voo: extraido.voo, classe: extraido.classe,
          }];
          if (extraido.volta) {
            extraido.trechos.push({
              label: "VOLTA", origem: extraido.destino, destino: extraido.origem,
              data: extraido.volta, companhia: extraido.companhia, classe: extraido.classe,
            });
          }
        } else {
          extraido.trechos = [{}];
        }
      }

      preencherFormulario(extraido);
      gel("conf-form-section").hidden = false;
      gel("conf-form-section").scrollIntoView({ behavior: "smooth", block: "start" });

    } catch (err) {
      alert("Erro ao extrair: " + err.message);
    } finally {
      btn.disabled = false; btn.textContent = "🤖 Extrair dados";
    }
  }

  function promptExtracao() {
    return `Analise esta confirmação/comprovante de emissão e retorne SOMENTE um JSON válido, sem texto adicional:
{
  "tipo": "aereo | hotel | pacote | outro",
  "passageiros": ["Nome completo de cada passageiro"],
  "localizador": "código PNR / código de confirmação",
  "data_emissao": "DD/MM/AAAA se disponível",
  "trechos": [
    {
      "label": "IDA | VOLTA | TRECHO 1 | CONEXÃO | etc",
      "origem": "cidade ou aeroporto de origem",
      "destino": "cidade ou aeroporto de destino",
      "data": "DD/MM/AAAA",
      "horario_partida": "HH:MM",
      "horario_chegada": "HH:MM",
      "companhia": "companhia aérea",
      "voo": "número do voo",
      "classe": "Econômica | Executiva | etc"
    }
  ],
  "bagagens": "descrição completa das franquias de bagagem (ex: 1 bagagem despachada de 23kg por pessoa)",
  "hotel_nome": "nome do hotel se houver ou null",
  "hotel_endereco": "endereço do hotel ou null",
  "quarto": "tipo de quarto ou null",
  "regime": "café da manhã / all inclusive / etc ou null",
  "check_in":  "DD/MM/AAAA (hotel)",
  "check_out": "DD/MM/AAAA (hotel)",
  "valor_total": "valor em reais ou null",
  "observacoes": "informações adicionais relevantes (uma por linha), ou null"
}
IMPORTANTE: para voos com múltiplos trechos ou escala, inclua CADA trecho separadamente no array "trechos".`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ===== Formulário de revisão — trechos dinâmicos =====
  function trechoHtml(t, idx) {
    const v = (val) => escHtml(val || "");
    return `
      <div class="conf-trecho-card" data-idx="${idx}">
        <div class="conf-trecho-header">
          <span class="conf-trecho-num">Trecho ${idx + 1}</span>
          <input type="text" class="input conf-tr-label" value="${v(t.label)}" placeholder="IDA / VOLTA / CONEXÃO…" style="flex:1;margin:0 10px;font-size:0.8rem;padding:4px 8px" />
          <button type="button" class="btn btn--ghost btn--sm conf-trecho-del" title="Remover trecho">✕</button>
        </div>
        <div class="form__grid" style="margin-top:8px">
          <label class="field"><span class="field__label">Origem</span><input type="text" class="input conf-tr-origem" value="${v(t.origem)}" /></label>
          <label class="field"><span class="field__label">Destino</span><input type="text" class="input conf-tr-destino" value="${v(t.destino)}" /></label>
          <label class="field"><span class="field__label">Data do voo</span><input type="text" class="input conf-tr-data" value="${v(t.data)}" placeholder="DD/MM/AAAA" /></label>
          <label class="field"><span class="field__label">Companhia</span><input type="text" class="input conf-tr-companhia" value="${v(t.companhia)}" /></label>
          <label class="field"><span class="field__label">Nº do voo</span><input type="text" class="input conf-tr-voo" value="${v(t.voo)}" /></label>
          <label class="field"><span class="field__label">Partida</span><input type="text" class="input conf-tr-partida" value="${v(t.horario_partida)}" placeholder="HH:MM" /></label>
          <label class="field"><span class="field__label">Chegada</span><input type="text" class="input conf-tr-chegada" value="${v(t.horario_chegada)}" placeholder="HH:MM" /></label>
          <label class="field"><span class="field__label">Classe</span><input type="text" class="input conf-tr-classe" value="${v(t.classe)}" /></label>
        </div>
      </div>`;
  }

  function renderTrechos(trechos) {
    const container = gel("conf-trechos-list");
    if (!container) return;
    const list = (trechos && trechos.length) ? trechos : [{}];
    container.innerHTML = list.map((t, i) => trechoHtml(t, i)).join("");
    bindTrechoEvents(container);
  }

  function bindTrechoEvents(container) {
    container.querySelectorAll(".conf-trecho-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const cards = container.querySelectorAll(".conf-trecho-card");
        if (cards.length <= 1) return;
        btn.closest(".conf-trecho-card").remove();
        // Renumera
        container.querySelectorAll(".conf-trecho-num").forEach((el, i) => { el.textContent = "Trecho " + (i + 1); });
      });
    });
  }

  function addTrechoVazio() {
    const container = gel("conf-trechos-list");
    if (!container) return;
    const idx = container.querySelectorAll(".conf-trecho-card").length;
    const div = document.createElement("div");
    div.innerHTML = trechoHtml({}, idx);
    const card = div.firstElementChild;
    container.appendChild(card);
    bindTrechoEvents(container);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function coletarTrechos() {
    const container = gel("conf-trechos-list");
    if (!container) return [];
    return Array.from(container.querySelectorAll(".conf-trecho-card")).map(card => ({
      label:            card.querySelector(".conf-tr-label")?.value.trim()    || "",
      origem:           card.querySelector(".conf-tr-origem")?.value.trim()   || "",
      destino:          card.querySelector(".conf-tr-destino")?.value.trim()  || "",
      data:             card.querySelector(".conf-tr-data")?.value.trim()     || "",
      companhia:        card.querySelector(".conf-tr-companhia")?.value.trim()|| "",
      voo:              card.querySelector(".conf-tr-voo")?.value.trim()      || "",
      horario_partida:  card.querySelector(".conf-tr-partida")?.value.trim()  || "",
      horario_chegada:  card.querySelector(".conf-tr-chegada")?.value.trim()  || "",
      classe:           card.querySelector(".conf-tr-classe")?.value.trim()   || "",
    }));
  }

  function preencherFormulario(d) {
    const set = (id, val) => { const el = gel(id); if (el && val != null && val !== "null") el.value = val; };

    set("conf-tipo",        d.tipo);
    set("conf-localizador", d.localizador);
    set("conf-data_emissao",d.data_emissao);
    set("conf-bagagens",    d.bagagens);
    set("conf-hotel_nome",  d.hotel_nome);
    set("conf-hotel_endereco", d.hotel_endereco);
    set("conf-quarto",      d.quarto);
    set("conf-regime",      d.regime);
    set("conf-check_in",    d.check_in || d.ida);
    set("conf-check_out",   d.check_out || d.volta);
    set("conf-valor_total", d.valor_total);
    set("conf-observacoes", d.observacoes);

    const paxEl = gel("conf-passageiros");
    if (paxEl && Array.isArray(d.passageiros)) paxEl.value = d.passageiros.join("\n");

    renderTrechos(d.trechos);
    atualizarCamposVisiveis();
  }

  function atualizarCamposVisiveis() {
    const tipo = gel("conf-tipo")?.value || "aereo";
    const secAereo = gel("conf-section-aereo");
    const secHotel = gel("conf-section-hotel");
    if (secAereo) secAereo.hidden = tipo === "hotel";
    if (secHotel) secHotel.hidden = tipo === "aereo";
  }

  // ===== Geração do documento =====
  function cardVooHtml(t) {
    const vooInfo  = [t.companhia, t.voo].filter(Boolean).join(" · ");
    return `
      <div class="orc-prev-flight-card" style="margin-bottom:14px">
        <div class="orc-prev-flight-card-header">
          <span class="orc-prev-flight-label">${escHtml(t.label || "VOO")}</span>
          ${t.data     ? `<span class="orc-prev-flight-card-date">${escHtml(t.data)}</span>` : ""}
          ${vooInfo    ? `<span class="orc-prev-flight-card-voo">${escHtml(vooInfo)}</span>` : ""}
        </div>
        <div class="orc-prev-flight-card-body">
          <div class="orc-prev-airport">
            <div class="orc-prev-iata">${escHtml(t.origem || "—")}</div>
            ${t.horario_partida ? `<div class="orc-prev-time">${escHtml(t.horario_partida)}</div>` : ""}
          </div>
          <div class="orc-prev-flight-middle">
            <div class="orc-prev-dash-line">
              <span class="orc-prev-dash-seg"></span>
              <span class="orc-prev-plane-icon">✈</span>
              <span class="orc-prev-dash-seg"></span>
            </div>
            ${t.classe ? `<div class="orc-prev-direto">${escHtml(t.classe)}</div>` : ""}
          </div>
          <div class="orc-prev-airport orc-prev-airport--right">
            <div class="orc-prev-iata">${escHtml(t.destino || "—")}</div>
            ${t.horario_chegada ? `<div class="orc-prev-time">${escHtml(t.horario_chegada)}</div>` : ""}
          </div>
        </div>
      </div>`;
  }

  function buildObsList(rawObs, airline, bagagens) {
    const items = [];

    // Bagagens
    if (bagagens) {
      items.push({ icon: "🧳", text: `<strong>Bagagem:</strong> ${escHtml(bagagens)}` });
    }

    // Observações brutas (cada linha vira um item)
    if (rawObs) {
      rawObs.split("\n").map(l => l.trim()).filter(Boolean).forEach(linha => {
        items.push({ icon: "📌", text: escHtml(linha) });
      });
    }

    // Site da companhia
    if (airline) {
      items.push({
        icon: "🌐",
        text: `Você pode acessar e acompanhar sua reserva diretamente no site da <strong>${escHtml(airline.label)}</strong>: <strong>${escHtml(airline.path)}</strong>`,
      });
    }

    // Sempre incluir: dúvidas entrar em contato
    items.push({ icon: "📞", text: `Em caso de dúvidas ou alterações, entre em contato com a Lolek Viagens pelo <strong>${escHtml(LOLEK_TEL)}</strong> ou <strong>${escHtml(LOLEK_EMAIL)}</strong>.` });

    if (!items.length) return "";

    return `
      <div class="conf-obs-section">
        <div class="conf-obs-title">Informações importantes</div>
        <ul class="conf-obs-lista">
          ${items.map(it => `<li class="conf-obs-item"><span class="conf-obs-icon">${it.icon}</span><span>${it.text}</span></li>`).join("")}
        </ul>
      </div>`;
  }

  function gerarDocumento() {
    const get = id => (gel(id)?.value || "").trim();

    const tipo        = get("conf-tipo") || "aereo";
    const paxRaw      = get("conf-passageiros");
    const passageiros = paxRaw ? paxRaw.split("\n").map(p => p.trim()).filter(Boolean) : [];
    const localizador = get("conf-localizador");
    const bagagens    = get("conf-bagagens");
    const hotelNome   = get("conf-hotel_nome");
    const hotelEnd    = get("conf-hotel_endereco");
    const quarto      = get("conf-quarto");
    const regime      = get("conf-regime");
    const checkIn     = get("conf-check_in");
    const checkOut    = get("conf-check_out");
    const valor       = get("conf-valor_total");
    const rawObs      = get("conf-observacoes");

    const trechos = coletarTrechos().filter(t => t.origem || t.destino);

    // Detecta companhia principal (do 1º trecho com companhia)
    const companhiaPrincipal = trechos.find(t => t.companhia)?.companhia || "";
    const airline = findAirline(companhiaPrincipal);

    const agora = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

    // Cards de voo
    const voosHtml = (tipo !== "hotel" && trechos.length)
      ? `<div style="margin-bottom:8px">${trechos.map(cardVooHtml).join("")}</div>`
      : "";

    // Card de hotel
    let hotelHtml = "";
    if (tipo !== "aereo" && hotelNome) {
      hotelHtml = `
        <div class="conf-hotel-card">
          <div class="conf-hotel-nome">🏨 ${escHtml(hotelNome)}</div>
          ${hotelEnd  ? `<div class="conf-hotel-info">${escHtml(hotelEnd)}</div>` : ""}
          ${quarto    ? `<div class="conf-hotel-info">Quarto: ${escHtml(quarto)}</div>` : ""}
          ${regime    ? `<div class="conf-hotel-info">Regime: ${escHtml(regime)}</div>` : ""}
          ${checkIn   ? `<div class="conf-hotel-dates">Check-in: <strong>${escHtml(checkIn)}</strong>${checkOut ? "&nbsp;·&nbsp;Check-out: <strong>" + escHtml(checkOut) + "</strong>" : ""}</div>` : ""}
        </div>`;
    }

    // Passageiros
    const paxHtml = passageiros.length
      ? passageiros.map(p => `<div class="conf-pax-row">👤 ${escHtml(p)}</div>`).join("")
      : "";

    // Localizador
    const locHtml = localizador
      ? `<div class="conf-localizador"><span class="conf-loc-label">Localizador / Código de confirmação</span><span class="conf-loc-valor">${escHtml(localizador)}</span></div>`
      : "";

    // Valor
    const valorBRL = fBRL(valor);
    const valorHtml = valorBRL
      ? `<div class="conf-valor-row"><span>Valor total</span><span class="conf-valor">${escHtml(valorBRL)}</span></div>`
      : "";

    // Observações formatadas
    const obsHtml = buildObsList(rawObs, airline, bagagens);

    gel("conf-preview").innerHTML = `
      <div class="orc-prev-wrap conf-prev-wrap">
        <div class="orc-prev-header">
          <img src="Lolek_logotipo_3.png" class="orc-prev-logo-img" alt="Lolek Viagens">
          <div class="orc-prev-contatos">
            <strong>${escHtml(LOLEK_NOME)}</strong><br>
            CNPJ ${escHtml(LOLEK_CNPJ)}<br>
            ${escHtml(LOLEK_EMAIL)}<br>
            ${escHtml(LOLEK_TEL)}<br>
            ${escHtml(LOLEK_END)}
          </div>
        </div>
        <div class="orc-prev-divider"></div>

        <div class="orc-prev-titulo">COMPROVANTE DE EMISSÃO</div>
        <div class="conf-emitido-em">Emitido em ${agora}</div>

        ${paxHtml ? `<div class="conf-section-title">Passageiro${passageiros.length !== 1 ? "s" : ""}</div>${paxHtml}` : ""}

        ${voosHtml}
        ${hotelHtml}
        ${locHtml}
        ${valorHtml}
        ${obsHtml}

        <div class="orc-prev-footer">
          Este documento é um comprovante de emissão emitido pela ${escHtml(LOLEK_NOME)} como intermediária junto às operadoras e companhias contratadas. As condições de transporte e hospedagem são regidas pelas respectivas prestadoras de serviço.
        </div>
      </div>`;

    gel("conf-input-wrap").hidden  = true;
    gel("conf-output-wrap").hidden = false;
    window.scrollTo(0, 0);
  }

  // ===== PDF — abre janela limpa com só o comprovante =====
  function baixarPDF() {
    const conteudo = gel("conf-preview")?.innerHTML || "";
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("Permita pop-ups para salvar o PDF."); return; }

    const baseUrl = location.href.replace(/\/[^/]*$/, "/");

    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Comprovante de Emissão — Lolek Viagens</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${baseUrl}style.css">
  <style>
    body { margin: 0; padding: 20px; background: #fff; font-family: var(--font-body, Montserrat, sans-serif); }
    .orc-prev-wrap { box-shadow: none; border: 1px solid #e3e6ec; max-width: 800px; margin: 0 auto; }
    @media print {
      body { padding: 0; }
      .orc-prev-wrap { border: none; max-width: 100%; }
    }
  </style>
</head>
<body>
  ${conteudo}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 600);
    };
  <\/script>
</body>
</html>`);
    win.document.close();
  }

  // ===== Copiar texto =====
  function copiarTexto() {
    const get = id => (gel(id)?.value || "").trim();
    const passageiros = (get("conf-passageiros") || "").split("\n").map(p => p.trim()).filter(Boolean);
    const trechos = coletarTrechos().filter(t => t.origem || t.destino);

    let txt = `COMPROVANTE DE EMISSÃO — LOLEK VIAGENS\nCNPJ: ${LOLEK_CNPJ}\n${LOLEK_EMAIL} | ${LOLEK_TEL}\n\n`;
    if (passageiros.length) txt += `Passageiro(s): ${passageiros.join(", ")}\n`;
    if (get("conf-localizador")) txt += `Localizador: ${get("conf-localizador")}\n\n`;

    trechos.forEach((t, i) => {
      txt += `[${t.label || "Trecho " + (i + 1)}] ${t.origem || "?"} → ${t.destino || "?"} em ${t.data || "?"}\n`;
      if (t.companhia || t.voo) txt += `  ${[t.companhia, t.voo].filter(Boolean).join(" · ")}\n`;
      if (t.horario_partida)   txt += `  Partida: ${t.horario_partida}`;
      if (t.horario_chegada)   txt += `  Chegada: ${t.horario_chegada}`;
      txt += "\n";
    });

    if (get("conf-bagagens")) txt += `\nBagagem: ${get("conf-bagagens")}\n`;
    if (get("conf-hotel_nome")) txt += `Hotel: ${get("conf-hotel_nome")}\n`;
    if (get("conf-valor_total")) txt += `Valor total: ${get("conf-valor_total")}\n`;
    if (get("conf-observacoes")) txt += `\nObs: ${get("conf-observacoes")}\n`;

    navigator.clipboard.writeText(txt).then(() => {
      const btn = gel("conf-copy-btn");
      btn.textContent = "✓ Copiado!";
      setTimeout(() => { btn.textContent = "Copiar texto"; }, 2000);
    });
  }

  // ===== Zona de entrada (print / arquivo) =====
  function setupZonaEntrada() {
    const zone      = gel("conf-print-zone");
    const fileInput = gel("conf-print-input");
    const hint      = zone?.querySelector(".conf-print-hint");
    if (!zone || !fileInput) return;

    function carregarArquivo(file) {
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      if (hint) hint.textContent = `✓ "${file.name}" carregado — clique em Extrair dados`;
      zone.classList.add("conf-print-zone--loaded");
      extrairReserva();
    }

    // Colar imagem com Ctrl+V
    zone.addEventListener("paste", e => {
      for (const item of (e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) { carregarArquivo(item.getAsFile()); break; }
      }
    });

    // Arrastar arquivo
    zone.addEventListener("dragover",  e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) carregarArquivo(file);
    });

    // Botão "Selecionar arquivo"
    const btnFile = gel("conf-btn-arquivo");
    if (btnFile) {
      btnFile.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) {
          if (hint) hint.textContent = `✓ "${file.name}" selecionado — clique em Extrair dados`;
          zone.classList.add("conf-print-zone--loaded");
          extrairReserva();
        }
      });
    }
  }

  // ===== Init =====
  function init() {
    setupZonaEntrada();
    renderTrechos([{}]);

    gel("conf-extrair-btn")?.addEventListener("click", extrairReserva);
    gel("conf-add-trecho")?.addEventListener("click",  addTrechoVazio);
    gel("conf-gerar-btn")?.addEventListener("click",   gerarDocumento);
    gel("conf-editar-btn")?.addEventListener("click",  () => {
      gel("conf-input-wrap").hidden  = false;
      gel("conf-output-wrap").hidden = true;
    });
    gel("conf-pdf-btn")?.addEventListener("click",  baixarPDF);
    gel("conf-copy-btn")?.addEventListener("click", copiarTexto);
    gel("conf-tipo")?.addEventListener("change",    atualizarCamposVisiveis);
    if (gel("conf-form-section")) gel("conf-form-section").hidden = true;
  }

  init();
})();
