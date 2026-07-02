// ===== Roteiro — Lolek Viagens =====
(function () {
  "use strict";

  const LOLEK_NOME  = "Lolek Viagens";
  const LOLEK_CNPJ  = "54.795.384/0001-05";
  const LOLEK_END   = "Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE";
  const LOLEK_EMAIL = "thaynara@agencialolekviagens.com.br";
  const LOLEK_TEL   = "(85) 99632-7092";

  const LS_AI_MODEL = "lolek_anthropic_model";

  const ORCAMENTO_LABEL = {
    "econômico":   "Econômico",
    "moderado":    "Moderado",
    "alto padrão": "Alto padrão / luxo",
  };

  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-haiku-4-5-20251001"; }
  function gel(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

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

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function parseDataBR(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  // ===== Extração IA (dados básicos da viagem) =====
  async function extrairDados() {
    const texto = (gel("rot-paste")?.value || "").trim();
    const fileInput = gel("rot-print-input");
    const files = fileInput?.files;
    const temTexto   = texto.length > 0;
    const temArquivo = files && files.length > 0;

    if (!temTexto && !temArquivo) {
      alert("Cole o texto, o print ou selecione um arquivo com as informações da viagem.");
      return;
    }

    const btn = gel("rot-extrair-btn");
    btn.disabled = true; btn.textContent = "⏳ Extraindo...";

    const prompt = `Analise o texto/print abaixo sobre a viagem de um cliente e retorne SOMENTE um JSON válido, sem texto adicional:
{
  "nome_cliente": "nome do cliente, se identificável, ou null",
  "destino": "cidade/país de destino",
  "data_inicio": "DD/MM/AAAA — data de chegada no destino, ou null",
  "data_fim": "DD/MM/AAAA — data de partida do destino, ou null",
  "hospedagem": "nome do hotel/hospedagem já reservada, se houver, ou null"
}`;

    try {
      let content;

      if (temArquivo) {
        const file  = files[0];
        const b64   = await fileToBase64(file);
        const match = b64.match(/^data:([^;]+);base64,(.+)$/);
        const mediaType = match[1];

        content = mediaType === "application/pdf"
          ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: match[2] } }, { type: "text", text: prompt }]
          : [{ type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } }, { type: "text", text: prompt }];
      } else {
        content = [{ type: "text", text: prompt + "\n\nTEXTO:\n" + texto }];
      }

      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: getModel(), max_tokens: 1024, messages: [{ role: "user", content }] }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data    = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const d = JSON.parse(jsonStr);
      const set = (id, val) => { const el = gel(id); if (el && val != null && val !== "null") el.value = val; };
      set("rot-nome",        d.nome_cliente);
      set("rot-destino",     d.destino);
      set("rot-data-inicio", d.data_inicio);
      set("rot-data-fim",    d.data_fim);
      set("rot-hospedagem",  d.hospedagem);

      atualizarDiasPorData();

    } catch (err) {
      alert("Erro ao extrair: " + err.message);
    } finally {
      btn.disabled = false; btn.textContent = "🤖 Extrair dados";
    }
  }

  function atualizarDiasPorData() {
    const di = parseDataBR(gel("rot-data-inicio")?.value);
    const df = parseDataBR(gel("rot-data-fim")?.value);
    if (di && df && df >= di) {
      const dias = Math.round((df - di) / 86400000) + 1;
      gel("rot-dias").value = dias;
    }
  }

  // ===== Geração do roteiro (IA) =====
  async function gerarRoteiro() {
    const destino    = (gel("rot-destino")?.value || "").trim();
    const dias       = parseInt(gel("rot-dias")?.value, 10) || 0;
    const orcamento  = gel("rot-orcamento")?.value || "moderado";
    const perfil     = (gel("rot-perfil")?.value || "").trim();
    const hospedagem = (gel("rot-hospedagem")?.value || "").trim();

    if (!destino) { alert("Informe o destino."); return; }
    if (!dias || dias < 1) { alert("Informe a quantidade de dias."); return; }

    const btn = gel("rot-gerar-btn");
    btn.disabled = true; btn.textContent = "⏳ Gerando roteiro...";

    const prompt = `Você é especialista em roteiros de viagem. Monte um roteiro dia a dia para a viagem abaixo.

Destino: ${destino}
Duração: ${dias} dia${dias !== 1 ? "s" : ""}
Nível de orçamento do cliente: ${orcamento}
${perfil ? "Perfil / observações do cliente: " + perfil : ""}
${hospedagem ? "Hospedagem já reservada: " + hospedagem : ""}

Para cada dia, sugira atividades de manhã, tarde e noite adequadas ao destino e ao nível de orçamento informado, um restaurante conceituado condizente com o perfil e o orçamento, e quais ingressos ou reservas antecipadas são recomendados (parques, museus, shows, passeios guiados etc). Use nomes reais e conhecidos de lugares do destino sempre que possível, mas se não tiver certeza sobre preços ou funcionamento atual, diga isso na sugestão em vez de inventar valores.

Retorne SOMENTE um JSON válido, sem texto adicional, no formato:
{
  "dias": [
    {
      "dia": 1,
      "titulo": "título curto do dia",
      "manha": "sugestão para a manhã",
      "tarde": "sugestão para a tarde",
      "noite": "sugestão para a noite",
      "restaurante": "nome e breve descrição do restaurante sugerido",
      "ingressos": "ingressos/reservas recomendadas, ou string vazia se não houver"
    }
  ],
  "dica_geral": "uma dica geral extra sobre o destino (opcional, ou string vazia)"
}`;

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: getModel(), max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
      });

      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }

      const data    = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");

      const roteiro = JSON.parse(jsonStr);
      renderRoteiro(roteiro);

    } catch (err) {
      alert("Erro ao gerar roteiro: " + err.message);
    } finally {
      btn.disabled = false; btn.textContent = "Gerar roteiro →";
    }
  }

  // ===== Renderização =====
  function diaCardHtml(d) {
    const linha = (icone, titulo, texto, alt) => !texto ? "" : `
      <div class="orc-prev-item${alt ? " orc-prev-item--alt" : ""}">
        <div>
          <div class="orc-prev-item-nome">${icone} ${escHtml(titulo)}</div>
          <div class="orc-prev-item-desc">${escHtml(texto)}</div>
        </div>
      </div>`;

    return `
      <div class="orc-prev-destino">
        <div class="orc-prev-dest-header">
          <span>Dia ${escHtml(d.dia)}${d.titulo ? " — " + escHtml(d.titulo) : ""}</span>
        </div>
        ${linha("☀️", "Manhã", d.manha, false)}
        ${linha("🌇", "Tarde", d.tarde, true)}
        ${linha("🌙", "Noite", d.noite, false)}
        ${linha("🍽️", "Restaurante sugerido", d.restaurante, true)}
        ${linha("🎟️", "Ingressos / reservas", d.ingressos, false)}
      </div>`;
  }

  function renderRoteiro(roteiro) {
    const nome       = (gel("rot-nome")?.value || "").trim();
    const destino    = (gel("rot-destino")?.value || "").trim();
    const dataInicio = (gel("rot-data-inicio")?.value || "").trim();
    const dataFim    = (gel("rot-data-fim")?.value || "").trim();
    const orcamento  = gel("rot-orcamento")?.value || "moderado";
    const dias       = Array.isArray(roteiro.dias) ? roteiro.dias : [];
    const agora      = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

    const periodo = (dataInicio || dataFim)
      ? `${escHtml(dataInicio || "?")} a ${escHtml(dataFim || "?")}`
      : `${dias.length} dia${dias.length !== 1 ? "s" : ""}`;

    const dicaHtml = roteiro.dica_geral
      ? `<div class="orc-prev-item orc-prev-item--muted"><div><div class="orc-prev-item-nome">💡 Dica</div><div class="orc-prev-item-desc">${escHtml(roteiro.dica_geral)}</div></div></div>`
      : "";

    gel("rot-preview").innerHTML = `
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

        <div class="orc-prev-titulo">ROTEIRO DE VIAGEM${nome ? " — " + escHtml(nome.toUpperCase()) : ""}</div>
        <div class="orc-prev-subtitulo">${escHtml(destino)} · ${periodo}</div>
        <div class="conf-emitido-em">Preparado com carinho pela ${escHtml(LOLEK_NOME)} em ${agora}</div>

        ${dias.map(diaCardHtml).join("")}
        ${dicaHtml}

        <div class="rot-oferta-box">
          <div class="rot-oferta-titulo">✨ A ${escHtml(LOLEK_NOME)} cuida de tudo isso pra você</div>
          <div class="rot-oferta-texto">
            Hospedagens, ingressos para passeios e atrações, seguro viagem e reservas em restaurantes —
            fale com a gente e organizamos cada detalhe deste roteiro, com preços especiais e sem
            complicação. É só chamar!
          </div>
        </div>

        <div class="orc-prev-footer">
          Este roteiro é uma sugestão elaborada pela ${escHtml(LOLEK_NOME)} com base nas informações disponíveis sobre o destino.
          Preços, horários de funcionamento e disponibilidade devem ser confirmados antes da viagem.
        </div>
      </div>`;

    gel("rot-input-wrap").hidden  = true;
    gel("rot-output-wrap").hidden = false;
    window.scrollTo(0, 0);
  }

  // ===== PDF — abre janela limpa com só o roteiro =====
  function baixarPDF() {
    const conteudo = gel("rot-preview")?.innerHTML || "";
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("Permita pop-ups para salvar o PDF."); return; }

    const baseUrl = location.href.replace(/\/[^/]*$/, "/");

    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Roteiro de Viagem — Lolek Viagens</title>
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
    const nome      = (gel("rot-nome")?.value || "").trim();
    const destino   = (gel("rot-destino")?.value || "").trim();
    const dias      = Array.from(gel("rot-preview").querySelectorAll(".orc-prev-destino"));

    let txt = `ROTEIRO DE VIAGEM — ${LOLEK_NOME}\n`;
    if (nome)    txt += `Cliente: ${nome}\n`;
    if (destino) txt += `Destino: ${destino}\n`;
    txt += "\n";

    dias.forEach(card => {
      const titulo = card.querySelector(".orc-prev-dest-header span")?.textContent || "";
      txt += `${titulo}\n`;
      card.querySelectorAll(".orc-prev-item").forEach(item => {
        const label = item.querySelector(".orc-prev-item-nome")?.textContent || "";
        const desc  = item.querySelector(".orc-prev-item-desc")?.textContent || "";
        txt += `  ${label}: ${desc}\n`;
      });
      txt += "\n";
    });

    txt += `A ${LOLEK_NOME} vende hospedagens, ingressos, seguro viagem e reservas para este roteiro. Fale com a gente!\n`;
    txt += `${LOLEK_EMAIL} | ${LOLEK_TEL}\n`;

    navigator.clipboard.writeText(txt).then(() => {
      const btn = gel("rot-copy-btn");
      btn.textContent = "✓ Copiado!";
      setTimeout(() => { btn.textContent = "Copiar texto"; }, 2000);
    });
  }

  // ===== Zona de entrada (print / arquivo) =====
  function setupZonaEntrada() {
    const zone      = gel("rot-print-zone");
    const fileInput = gel("rot-print-input");
    const hint      = zone?.querySelector(".conf-print-hint");
    if (!zone || !fileInput) return;

    function carregarArquivo(file) {
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      if (hint) hint.textContent = `✓ "${file.name}" carregado — clique em Extrair dados`;
      zone.classList.add("conf-print-zone--loaded");
      extrairDados();
    }

    zone.addEventListener("paste", e => {
      for (const item of (e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) { carregarArquivo(item.getAsFile()); break; }
      }
    });

    zone.addEventListener("dragover",  e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) carregarArquivo(file);
    });

    const btnFile = gel("rot-btn-arquivo");
    if (btnFile) {
      btnFile.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) {
          if (hint) hint.textContent = `✓ "${file.name}" selecionado — clique em Extrair dados`;
          zone.classList.add("conf-print-zone--loaded");
          extrairDados();
        }
      });
    }
  }

  // ===== Init =====
  function init() {
    setupZonaEntrada();

    gel("rot-extrair-btn")?.addEventListener("click", extrairDados);
    gel("rot-gerar-btn")?.addEventListener("click",   gerarRoteiro);
    gel("rot-data-inicio")?.addEventListener("change", atualizarDiasPorData);
    gel("rot-data-fim")?.addEventListener("change",    atualizarDiasPorData);
    gel("rot-editar-btn")?.addEventListener("click", () => {
      gel("rot-input-wrap").hidden  = false;
      gel("rot-output-wrap").hidden = true;
    });
    gel("rot-pdf-btn")?.addEventListener("click",  baixarPDF);
    gel("rot-copy-btn")?.addEventListener("click", copiarTexto);
  }

  init();
})();
