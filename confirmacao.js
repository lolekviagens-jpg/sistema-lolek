// ===== Confirmação de Reserva — Lolek Viagens =====
(function () {
  "use strict";

  const LOLEK_NOME   = "Lolek Viagens";
  const LOLEK_CNPJ   = "54.795.384/0001-05";
  const LOLEK_END    = "Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE";
  const LOLEK_EMAIL  = "thaynara@agencialolekviagens.com.br";
  const LOLEK_TEL    = "(85) 99632-7092";

  const LS_AI_KEY   = "lolek_anthropic_key";
  const LS_AI_MODEL = "lolek_anthropic_model";

  function getApiKey() { return localStorage.getItem(LS_AI_KEY)   || ""; }
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

  // ===== Estado =====
  let dadosExtraidos = null;

  // ===== Extração IA =====
  async function extrairReserva() {
    const apiKey = getApiKey();
    if (!apiKey) {
      alert("Configure a chave da API Anthropic primeiro (aba Orçamentos → ⚙ Configurar IA).");
      return;
    }

    const texto = gel("conf-paste").value.trim();
    const fileInput = gel("conf-print-input");
    const temTexto  = texto.length > 0;
    const temImagem = fileInput && fileInput.files && fileInput.files.length > 0;

    if (!temTexto && !temImagem) {
      alert("Cole o texto da confirmação ou carregue um print.");
      return;
    }

    const btn = gel("conf-extrair-btn");
    btn.disabled = true; btn.textContent = "⏳ Extraindo dados...";

    try {
      let content;

      if (temImagem) {
        const file = fileInput.files[0];
        const b64  = await fileToBase64(file);
        const match = b64.match(/^data:([^;]+);base64,(.+)$/);
        content = [
          { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
          { type: "text", text: promptExtracao() },
        ];
      } else {
        content = [{ type: "text", text: promptExtracao() + "\n\nTexto da confirmação:\n" + texto }];
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: getModel(), max_tokens: 1024, messages: [{ role: "user", content }] }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data    = await resp.json();
      const jsonStr = (data.content?.[0]?.text || "").match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      dadosExtraidos = JSON.parse(jsonStr);
      preencherFormulario(dadosExtraidos);
      gel("conf-form-section").hidden = false;
      gel("conf-form-section").scrollIntoView({ behavior: "smooth", block: "start" });

    } catch (err) {
      alert("Erro ao extrair: " + err.message);
    } finally {
      btn.disabled = false; btn.textContent = "🤖 Extrair dados";
    }
  }

  function promptExtracao() {
    return `Analise esta confirmação/comprovante de reserva e retorne SOMENTE um JSON válido, sem texto adicional:
{
  "tipo": "aereo | hotel | pacote | outro",
  "passageiros": ["Nome completo de cada passageiro"],
  "localizador": "código de confirmação / PNR / reserva",
  "data_emissao": "DD/MM/AAAA se disponível",
  "ida": "DD/MM/AAAA",
  "volta": "DD/MM/AAAA ou null se só ida",
  "origem": "cidade ou aeroporto de origem",
  "destino": "cidade ou destino principal",
  "companhia": "companhia aérea ou nome do hotel",
  "voo": "número do voo ou null",
  "horario_partida": "HH:MM ou null",
  "horario_chegada": "HH:MM ou null",
  "classe": "econômica / executiva / etc ou null",
  "hotel_nome": "nome do hotel se houver",
  "hotel_endereco": "endereço do hotel se houver",
  "quarto": "tipo de quarto se houver",
  "regime": "café da manhã / all inclusive / etc se houver",
  "valor_total": "valor em reais ou null",
  "observacoes": "informações adicionais relevantes ou null"
}`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ===== Preenche formulário de revisão =====
  function preencherFormulario(d) {
    const campos = ["tipo","localizador","data_emissao","ida","volta","origem","destino",
                    "companhia","voo","horario_partida","horario_chegada","classe",
                    "hotel_nome","hotel_endereco","quarto","regime","valor_total","observacoes"];
    campos.forEach(f => {
      const el = gel("conf-" + f);
      if (el && d[f] != null && d[f] !== "null") el.value = d[f];
    });

    // Passageiros (lista)
    const paxEl = gel("conf-passageiros");
    if (paxEl && Array.isArray(d.passageiros)) paxEl.value = d.passageiros.join("\n");

    atualizarCamposVisiveis();
  }

  function atualizarCamposVisiveis() {
    const tipo = gel("conf-tipo")?.value || "aereo";
    gel("conf-section-aereo").hidden  = tipo === "hotel";
    gel("conf-section-hotel").hidden  = tipo === "aereo";
  }

  // ===== Gera documento =====
  function gerarDocumento() {
    const get = id => (gel(id)?.value || "").trim();

    const tipo       = get("conf-tipo") || "aereo";
    const paxRaw     = get("conf-passageiros");
    const passageiros = paxRaw ? paxRaw.split("\n").map(p => p.trim()).filter(Boolean) : [];
    const localizador = get("conf-localizador");
    const ida         = get("conf-ida");
    const volta       = get("conf-volta");
    const origem      = get("conf-origem");
    const destino     = get("conf-destino");
    const companhia   = get("conf-companhia");
    const voo         = get("conf-voo");
    const hPartida    = get("conf-horario_partida");
    const hChegada    = get("conf-horario_chegada");
    const classe      = get("conf-classe");
    const hotelNome   = get("conf-hotel_nome");
    const hotelEnd    = get("conf-hotel_endereco");
    const quarto      = get("conf-quarto");
    const regime      = get("conf-regime");
    const valor       = get("conf-valor_total");
    const obs         = get("conf-observacoes");

    const agora = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

    // Card de voo (se aéreo)
    let cardVooHtml = "";
    if (tipo !== "hotel" && (origem || destino || hPartida)) {
      cardVooHtml = `
        <div class="orc-prev-flight-card" style="margin-bottom:20px">
          <div class="orc-prev-flight-card-header">
            <span class="orc-prev-flight-label">VOO CONFIRMADO</span>
            ${ida ? `<span class="orc-prev-flight-card-date">${escHtml(ida)}</span>` : ""}
            ${companhia || voo ? `<span class="orc-prev-flight-card-voo">${escHtml([companhia,voo].filter(Boolean).join(" · "))}</span>` : ""}
          </div>
          <div class="orc-prev-flight-card-body">
            <div class="orc-prev-airport">
              <div class="orc-prev-iata">${escHtml(origem || "—")}</div>
              ${hPartida ? `<div class="orc-prev-time">${escHtml(hPartida)}</div>` : ""}
            </div>
            <div class="orc-prev-flight-middle">
              <div class="orc-prev-dash-line">
                <span class="orc-prev-dash-seg"></span>
                <span class="orc-prev-plane-icon">✈</span>
                <span class="orc-prev-dash-seg"></span>
              </div>
              ${classe ? `<div class="orc-prev-direto">${escHtml(classe)}</div>` : ""}
            </div>
            <div class="orc-prev-airport orc-prev-airport--right">
              <div class="orc-prev-iata">${escHtml(destino || "—")}</div>
              ${hChegada ? `<div class="orc-prev-time">${escHtml(hChegada)}</div>` : ""}
            </div>
          </div>
        </div>
        ${volta ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:16px;text-align:center">Retorno: <strong>${escHtml(volta)}</strong></div>` : ""}`;
    }

    // Card de hotel (se hotel/pacote)
    let cardHotelHtml = "";
    if (tipo !== "aereo" && hotelNome) {
      cardHotelHtml = `
        <div class="conf-hotel-card">
          <div class="conf-hotel-nome">🏨 ${escHtml(hotelNome)}</div>
          ${hotelEnd  ? `<div class="conf-hotel-info">${escHtml(hotelEnd)}</div>` : ""}
          ${quarto    ? `<div class="conf-hotel-info">Quarto: ${escHtml(quarto)}</div>` : ""}
          ${regime    ? `<div class="conf-hotel-info">Regime: ${escHtml(regime)}</div>` : ""}
          ${ida       ? `<div class="conf-hotel-dates">Check-in: <strong>${escHtml(ida)}</strong>${volta ? "  &nbsp;·&nbsp;  Check-out: <strong>" + escHtml(volta) + "</strong>" : ""}</div>` : ""}
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

    gel("conf-preview").innerHTML = `
      <div class="orc-prev-wrap conf-prev-wrap">
        <!-- Cabeçalho -->
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

        <div class="orc-prev-titulo">COMPROVANTE DE RESERVA</div>
        <div class="conf-emitido-em">Emitido em ${agora}</div>

        <!-- Passageiros -->
        ${paxHtml ? `<div class="conf-section-title">Passageiro${passageiros.length !== 1 ? "s" : ""}</div>${paxHtml}` : ""}

        <!-- Card de voo ou hotel -->
        ${cardVooHtml}
        ${cardHotelHtml}

        <!-- Localizador -->
        ${locHtml}

        <!-- Valor -->
        ${valorHtml}

        <!-- Observações -->
        ${obs ? `<div class="orc-prev-pag"><strong>Observações</strong><br>${escHtml(obs)}</div>` : ""}

        <!-- Rodapé -->
        <div class="orc-prev-footer">
          Este documento foi emitido pela ${escHtml(LOLEK_NOME)} como comprovante de intermediação da reserva junto às operadoras e companhias contratadas.
          Em caso de dúvidas, entre em contato pelo ${escHtml(LOLEK_TEL)} ou ${escHtml(LOLEK_EMAIL)}.
        </div>
      </div>`;

    gel("conf-input-wrap").hidden   = true;
    gel("conf-output-wrap").hidden  = false;
    window.scrollTo(0, 0);
  }

  // ===== PDF =====
  async function baixarPDF() {
    if (!window.jspdf) { window.print(); return; }
    const { jsPDF } = window.jspdf;
    const el  = gel("conf-preview");
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    // Usa html2canvas via jspdf se disponível, senão print
    if (window.html2canvas) {
      const canvas = await html2canvas(el, { scale: 2 });
      const imgData = canvas.toDataURL("image/png");
      const W = 210, H = 297;
      const ratio = canvas.width / canvas.height;
      const imgH = W / ratio;
      let y = 0;
      while (y < imgH) {
        if (y > 0) doc.addPage();
        doc.addImage(imgData, "PNG", 0, -y, W, imgH);
        y += H;
      }
      doc.save("comprovante_reserva_lolek.pdf");
    } else {
      window.print();
    }
  }

  // ===== Copiar texto =====
  function copiarTexto() {
    const get = id => (gel(id)?.value || "").trim();
    const paxRaw = get("conf-passageiros");
    const passageiros = paxRaw ? paxRaw.split("\n").map(p => p.trim()).filter(Boolean) : [];

    let txt = `COMPROVANTE DE RESERVA — LOLEK VIAGENS\n`;
    txt += `CNPJ: ${LOLEK_CNPJ}\n`;
    txt += `${LOLEK_EMAIL} | ${LOLEK_TEL}\n\n`;

    if (passageiros.length) txt += `Passageiro(s): ${passageiros.join(", ")}\n`;
    if (get("conf-localizador")) txt += `Localizador: ${get("conf-localizador")}\n`;
    if (get("conf-ida"))         txt += `Ida: ${get("conf-ida")}`;
    if (get("conf-volta"))       txt += `  |  Volta: ${get("conf-volta")}`;
    txt += "\n";
    if (get("conf-origem"))      txt += `Origem: ${get("conf-origem")}  →  Destino: ${get("conf-destino")}\n`;
    if (get("conf-companhia"))   txt += `Companhia: ${get("conf-companhia")}`;
    if (get("conf-voo"))         txt += `  |  Voo: ${get("conf-voo")}`;
    txt += "\n";
    if (get("conf-hotel_nome"))  txt += `Hotel: ${get("conf-hotel_nome")}\n`;
    if (get("conf-valor_total")) txt += `Valor total: ${get("conf-valor_total")}\n`;
    if (get("conf-observacoes")) txt += `\nObs: ${get("conf-observacoes")}\n`;

    navigator.clipboard.writeText(txt).then(() => {
      const btn = gel("conf-copy-btn");
      btn.textContent = "✓ Copiado!";
      setTimeout(() => { btn.textContent = "Copiar texto"; }, 2000);
    });
  }

  // ===== Print zone (colar imagem) =====
  function setupPrintZone() {
    const zone = gel("conf-print-zone");
    if (!zone) return;

    zone.addEventListener("paste", async e => {
      for (const item of (e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          const input = gel("conf-print-input");
          // Cria DataTransfer para setar no input
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          zone.querySelector(".conf-print-hint").textContent = "✓ Print carregado — clique em Extrair dados";
          zone.classList.add("conf-print-zone--loaded");
          if (getApiKey()) extrairReserva();
          break;
        }
      }
    });

    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file?.type.startsWith("image/")) {
        const dt = new DataTransfer(); dt.items.add(file);
        gel("conf-print-input").files = dt.files;
        zone.querySelector(".conf-print-hint").textContent = "✓ Print carregado — clique em Extrair dados";
        zone.classList.add("conf-print-zone--loaded");
        if (getApiKey()) extrairReserva();
      }
    });
  }

  // ===== Init =====
  function init() {
    setupPrintZone();

    gel("conf-extrair-btn").addEventListener("click", extrairReserva);
    gel("conf-gerar-btn").addEventListener("click", gerarDocumento);
    gel("conf-editar-btn").addEventListener("click", () => {
      gel("conf-input-wrap").hidden  = false;
      gel("conf-output-wrap").hidden = true;
    });
    gel("conf-pdf-btn").addEventListener("click", baixarPDF);
    gel("conf-copy-btn").addEventListener("click", copiarTexto);
    gel("conf-tipo")?.addEventListener("change", atualizarCamposVisiveis);
    gel("conf-form-section").hidden = true;
  }

  init();
})();
