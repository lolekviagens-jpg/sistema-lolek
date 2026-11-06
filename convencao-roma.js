// ===== Convenção Shalom Roma 2026 — mensagens pré-viagem via Digisac =====
// Importa a planilha de preparação (peregrinos-convencao-roma-2026.xlsx), deixa a equipe
// resolver as pendências marcadas "⚠ CONFIRMAR NO SISTEMA" direto na tela, monta as 5
// mensagens do guia (mensagens-pre-viagem-roma-2026.md) com os dados reais de cada um, e
// dispara pelo Digisac — sempre com prévia antes, nunca envio automático sem revisão.
(function () {
  "use strict";

  function gel(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fData(iso) {
    if (!iso) return "—";
    const [y, m, d] = String(iso).split("-");
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  // ===== Fuzzy matching de nomes (mesma lógica de followup.js — cada aba é isolada, sem
  // módulos compartilhados, é o padrão do projeto) =====
  function normNome(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  }
  function similaridade(a, b) {
    const stopwords = new Set(["de", "da", "do", "dos", "das", "e"]);
    const wa = normNome(a).split(" ").filter((w) => w.length > 2 && !stopwords.has(w));
    const wb = normNome(b).split(" ").filter((w) => w.length > 2 && !stopwords.has(w));
    if (!wa.length || !wb.length) return 0;
    const setA = new Set(wa), setB = new Set(wb);
    const comuns = [...setA].filter((w) => setB.has(w));
    const sobrenomesComuns = comuns.filter((w) => w !== wa[0] && w !== wb[0]);
    if (sobrenomesComuns.length === 0) return 0;
    return comuns.length / Math.max(setA.size, setB.size);
  }
  function encontrarCliente(nome, clientes) {
    let melhor = null, melhorScore = 0;
    clientes.forEach((c) => {
      const s = similaridade(c.nome || "", nome);
      if (s > melhorScore && s >= 0.5) { melhorScore = s; melhor = c; }
    });
    return melhor;
  }
  function formatarTelWA(tel) {
    let d = (tel || "").trim().replace(/^\+/, "").replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10 || d.length === 11) return "55" + d;
    return d;
  }

  async function chamarConvencaoRoma(action, data) {
    const resp = await fetch("/.netlify/functions/convencao-roma-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }
  async function enviarPeloDigisac(phone, message) {
    const resp = await fetch("/.netlify/functions/digisac", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, message }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }
  async function carregarClientes() {
    const r = await fetch("/.netlify/functions/clientes-data");
    return r.ok ? r.json() : [];
  }

  // ===== Datas =====
  // A planilha usa "DD/MM" sem ano — o evento é nov/2026; qualquer mês >= 9 é 2026, os
  // meses iniciais (viagens que avançam pro ano novo) são 2027.
  function dataBrParaIso(ddmm) {
    const m = String(ddmm || "").match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    const dia = Number(m[1]), mes = Number(m[2]);
    const ano = mes >= 9 ? 2026 : 2027;
    return ano + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
  }
  function hoje0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function somarDias(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }
  function isoParaData0(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }

  // ===================================================================
  // Importação da planilha (.xlsx, via SheetJS — carregado por CDN em index.html)
  // ===================================================================

  // Hotéis já identificados pela Thay (aba "Contatos") — nome parcial basta pra reconhecer
  // (ex: texto da planilha às vezes abrevia ou tem variação de grafia).
  const HOTEIS_CONHECIDOS = [
    { chave: "grand hotel olympic", nome: "Grand Hotel Olympic", endereco: "Via Properzio, 2/a – 00193 Roma (metrô Ottaviano) · tel +39 06 689 6650", estrelas: 4 },
    { chave: "madison", nome: "Hotel Madison", endereco: "Via Marsala, 60 – 00185 Roma (perto de Termini) · tel +39 06 8339 5266", estrelas: 3 },
    { chave: "aurelius", nome: "Aurelius Art Gallery", endereco: "Via Aurelia, 458 – 00165 Roma · tel +39 06 662 4500", estrelas: 4 },
    { chave: "da angelo", nome: "Da Angelo", endereco: "Via San Potente, 6 – 06081 Assis" },
    { chave: "la terrazza", nome: "La Terrazza", endereco: "Via Fratelli Aleandro e Mario Canonichetti – 06081 Assis · tel +39 075 812368" },
    { chave: "san gabriele", nome: "San Gabriele", endereco: "Via San Gabriele dell'Addolorata, 16 – 06081 Assis" },
    { chave: "fontebella", nome: "Fontebella", endereco: "Via Fontebella, 25 – 06081 Assis · tel +39 075 812883" },
  ];
  function acharHotelConhecido(texto) {
    const t = normNome(texto);
    return HOTEIS_CONHECIDOS.find((h) => t.includes(h.chave)) || null;
  }

  // Conexão: a planilha às vezes mostra o itinerário completo com "+" entre trechos (ex:
  // "FOR→LIS 12/11 (LATAM) + LIS→FCO 15/11 (TAP)") — aí dá pra saber a cidade da conexão com
  // confiança. Quando só aparece "FOR→FCO" (início e fim), isso NÃO significa voo direto —
  // tem companhia (TAP, por ex.) que SEMPRE conecta no próprio hub e isso não aparece nesse
  // resumo. Por segurança, fica "não confirmado" (null) em vez de assumir voo direto —
  // vira pendência até alguém confirmar de olho no bilhete real.
  function parseVoo(texto) {
    const out = { cia_aerea: null, data_voo_ida: null, aeroporto_saida: null, data_volta: null, voo_tem_conexao: null, conexao_cidade: null };
    if (!texto) return out;
    const segs = [...texto.matchAll(/([A-Za-zÀ-ú]{2,6})\s*→\s*([A-Za-zÀ-ú]{2,6})/g)];
    if (segs.length === 0) return out;
    out.aeroporto_saida = segs[0][1];
    if (segs.length >= 2) { out.voo_tem_conexao = true; out.conexao_cidade = segs[0][2]; }
    const m = texto.match(/(\d{1,2}\/\d{1,2})(?:[^0-9]*volta\s*(\d{1,2}\/\d{1,2}))?[^(]*\(([^)]+)\)/i);
    if (m) {
      out.data_voo_ida = dataBrParaIso(m[1]);
      out.data_volta = m[2] ? dataBrParaIso(m[2]) : null;
      out.cia_aerea = (m[3] || "").trim();
    }
    return out;
  }

  function parseHospedagem(texto) {
    const out = { nome: null, endereco: null, estrelas: null, noites: null };
    if (!texto) return out;
    const conhecido = acharHotelConhecido(texto);
    if (conhecido) { out.nome = conhecido.nome; out.endereco = conhecido.endereco; out.estrelas = conhecido.estrelas || null; }
    const datas = texto.match(/(\d{1,2})[–-](\d{1,2})\/(\d{1,2})/);
    if (datas) out.noites = Math.abs(Number(datas[2]) - Number(datas[1])) || null;
    return out;
  }

  // O sistema só aceita exatamente "GTA" ou "Assist Card" (restrição do banco) — a planilha
  // às vezes já tem a seguradora escrita, mas com variação de texto (ex: "GTA Assist"), não
  // necessariamente igual a essas duas strings. Normaliza antes de salvar.
  function normalizarSeguradora(texto) {
    if (!texto) return null;
    if (/assist\s*card/i.test(texto)) return "Assist Card";
    if (/\bgta\b/i.test(texto)) return "GTA";
    return null;
  }
  function parseSeguro(texto) {
    const out = { seguradora: normalizarSeguradora(texto), apolice: null };
    if (!texto) return out;
    const apolice = texto.match(/(?:n[ºo]\.?|loc\.?)\s*([A-Z0-9][A-Z0-9\s/]{2,20}?)(?:\s*·|\s*$)/i);
    if (apolice) out.apolice = apolice[1].trim();
    return out;
  }

  function parseTrem(texto) {
    if (!texto) return { data: null };
    const m = texto.match(/(\d{1,2})\/(\d{1,2})/);
    return { data: m ? dataBrParaIso(m[1] + "/" + m[2]) : null };
  }

  // Lê o arquivo .xlsx e devolve a lista normalizada de peregrinos (lista principal + fora
  // do filtro), pronta pra mandar pro backend. Tudo client-side — nada é salvo ainda aqui.
  async function lerPlanilha(file, clientes) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });

    function linhasDaAba(nomeAba, colunaChaveHeader) {
      const sheet = wb.Sheets[nomeAba];
      if (!sheet) return { header: [], linhas: [] };
      const todas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const idxHeader = todas.findIndex((row) => row[0] === colunaChaveHeader);
      if (idxHeader === -1) return { header: [], linhas: [] };
      const header = todas[idxHeader];
      const linhas = todas.slice(idxHeader + 1).filter((r) => r.some((c) => c != null && c !== ""));
      return { header, linhas };
    }
    function porColuna(header, linha, nomeColuna) {
      const idx = header.indexOf(nomeColuna);
      return idx === -1 ? null : linha[idx];
    }
    function ehPendente(valor) {
      return typeof valor === "string" && valor.includes("⚠ CONFIRMAR");
    }

    const peregrinos = [];

    // ===== Aba principal =====
    const principal = linhasDaAba("Peregrinos Convenção", "#");
    principal.linhas.forEach((linha) => {
      const nome = porColuna(principal.header, linha, "Nome");
      if (!nome) return;
      const rawVoos = porColuna(principal.header, linha, "Voos (trechos e datas)");
      const rawHotelRoma = porColuna(principal.header, linha, "Hotel Roma");
      const rawHotelAssis = porColuna(principal.header, linha, "Hotel Assis");
      const rawOutrasHosp = porColuna(principal.header, linha, "Outras hospedagens");
      const rawSeguro = porColuna(principal.header, linha, "Seguro (canal · apólice · vigência)");
      const rawTrem = porColuna(principal.header, linha, "Trem Roma⇄Assis");
      const rawOutrosItens = porColuna(principal.header, linha, "Outros itens");
      const rawPendencias = porColuna(principal.header, linha, "Pendências");

      const voo = parseVoo(rawVoos);
      const hotelRoma = parseHospedagem(rawHotelRoma);
      const hotelAssis = parseHospedagem(rawHotelAssis);
      const seguro = parseSeguro(rawSeguro);
      const trem = parseTrem(rawTrem);

      // Os campos "Endereço hotel X" / "Seguradora" / "Itens a identificar" da planilha já
      // vêm com "⚠ CONFIRMAR" quando pendente, ou com o valor já certo (ex: alguém já tinha
      // confirmado antes de exportar) — usa o valor da planilha quando NÃO for pendência,
      // senão usa o que o regex conseguiu adivinhar do texto bruto.
      const endRomaPlanilha = porColuna(principal.header, linha, "Endereço hotel Roma");
      const endAssisPlanilha = porColuna(principal.header, linha, "Endereço hotel Assis");
      const seguradoraPlanilha = porColuna(principal.header, linha, "Seguradora");
      const itensPlanilha = porColuna(principal.header, linha, "Itens a identificar");

      const cliente = encontrarCliente(nome, clientes);

      peregrinos.push({
        planilha_num: porColuna(principal.header, linha, "#"),
        origem: "lista_principal",
        nome,
        vendedora: porColuna(principal.header, linha, "Vendedora"),
        cliente_id: cliente ? cliente.id : null,
        whatsapp: cliente ? formatarTelWA(cliente.telefone) : null,

        cia_aerea: voo.cia_aerea, data_voo_ida: voo.data_voo_ida, aeroporto_saida: voo.aeroporto_saida, data_volta: voo.data_volta,
        voo_tem_conexao: voo.voo_tem_conexao, conexao_cidade: voo.conexao_cidade,

        hotel_roma_nome: hotelRoma.nome,
        hotel_roma_endereco: !ehPendente(endRomaPlanilha) && typeof endRomaPlanilha === "string" ? endRomaPlanilha : hotelRoma.endereco,
        hotel_roma_estrelas: hotelRoma.estrelas, hotel_roma_noites: hotelRoma.noites,

        hotel_assis_nome: hotelAssis.nome,
        hotel_assis_endereco: !ehPendente(endAssisPlanilha) && typeof endAssisPlanilha === "string" ? endAssisPlanilha : hotelAssis.endereco,
        hotel_assis_noites: hotelAssis.noites,

        seguradora: !ehPendente(seguradoraPlanilha) && typeof seguradoraPlanilha === "string" ? normalizarSeguradora(seguradoraPlanilha) : seguro.seguradora,
        seguro_apolice: seguro.apolice,

        trem_data: trem.data,

        itens_identificados: !ehPendente(itensPlanilha) && typeof itensPlanilha === "string" ? itensPlanilha : null,

        raw_voos: rawVoos, raw_hotel_roma: rawHotelRoma, raw_hotel_assis: rawHotelAssis, raw_outras_hosp: rawOutrasHosp,
        raw_seguro: rawSeguro, raw_trem: rawTrem, raw_outros_itens: rawOutrosItens, raw_pendencias: rawPendencias,
      });
    });

    // ===== Fora do filtro — descrição tudo numa coluna só ("O que consta"); aplica os
    // mesmos parsers nesse texto misto, mas sem muita esperança de pegar tudo — essas 30
    // pessoas já são sabidamente candidatas a revisão manual mesmo. =====
    const fora = linhasDaAba("Fora do filtro (confirmar)", "Nome");
    fora.linhas.forEach((linha) => {
      const nome = porColuna(fora.header, linha, "Nome");
      if (!nome) return;
      const consta = porColuna(fora.header, linha, "O que consta") || "";
      const voo = parseVoo(consta);
      const seguro = parseSeguro(consta);
      const cliente = encontrarCliente(nome, clientes);

      peregrinos.push({
        origem: "fora_do_filtro",
        nome,
        vendedora: null,
        cliente_id: cliente ? cliente.id : null,
        whatsapp: cliente ? formatarTelWA(cliente.telefone) : null,
        cia_aerea: voo.cia_aerea, data_voo_ida: voo.data_voo_ida, aeroporto_saida: voo.aeroporto_saida, data_volta: voo.data_volta,
        voo_tem_conexao: voo.voo_tem_conexao, conexao_cidade: voo.conexao_cidade,
        seguradora: seguro.seguradora, seguro_apolice: seguro.apolice,
        raw_pendencias: `Lead na planilha: ${porColuna(fora.header, linha, "Lead na planilha") || "—"} — ${consta}`,
      });
    });

    return peregrinos;
  }

  // ===================================================================
  // Mensagens — modelos de mensagens-pre-viagem-roma-2026.md
  // ===================================================================

  function subtrairHoras(horaTxt, n) {
    const m = String(horaTxt || "").match(/(\d{1,2})h(\d{2})?/);
    if (!m) return null;
    let h = Number(m[1]) - n;
    const min = m[2] || "00";
    if (h < 0) h += 24;
    return String(h).padStart(2, "0") + "h" + min;
  }
  const TABELA_TAXA_ROMA = { 3: 6, 4: 7.5, 5: 10 };
  function taxaRomaTotal(p) {
    const valor = TABELA_TAXA_ROMA[p.hotel_roma_estrelas];
    if (!valor || !p.hotel_roma_noites) return null;
    const total = valor * Math.min(p.hotel_roma_noites, 10);
    return total.toFixed(2).replace(".", ",");
  }

  function campo(p, chave, fallback) {
    const v = p[chave];
    return (v == null || v === "") ? (fallback != null ? fallback : "") : v;
  }

  function montarMensagem1(p) {
    const partes = [];
    partes.push(`Oi, ${p.nome}! 🙏 Aqui é a ${campo(p, "responsavel_lolek", "equipe")}, da Lolek.\n\n` +
      `Falta pouco para a Convenção Shalom em Roma e Assis! Reuni aqui *tudo o que é seu* nessa viagem, para você embarcar tranquilo(a). Salve esta mensagem e o guia em PDF que vai logo abaixo.`);

    partes.push(`✈️ *SEU VOO DE IDA*\n${campo(p, "cia_aerea", "—")} · ${campo(p, "voo_ida", "—")}\n` +
      `${fData(p.data_voo_ida)}, às ${campo(p, "hora_voo_ida", "—")}, saindo de ${campo(p, "aeroporto_saida", "—")}\n` +
      (p.voo_tem_conexao === true
        ? `Conexão em ${p.conexao_cidade || "—"}. É lá que você passa pela imigração europeia.`
        : p.voo_tem_conexao === false
        ? `Voo direto: a imigração é feita em Roma.`
        : AVISO_CONEXAO_NAO_CONFIRMADA));

    partes.push(`🧳 *SUA BAGAGEM*\nConfira no seu bilhete qual franquia você comprou:\n\n` +
      `👉 *Caso sua passagem tenha só mala de mão (até 10 kg)*\n` +
      `• 1 item pessoal (bolsa ou mochila pequena), que vai embaixo do assento da frente\n` +
      `• 1 mala de mão de até 10 kg, com cerca de 55 × 35 × 25 cm (rodinhas e alças incluídas)\n` +
      `• No aeroporto, a companhia pode pesar e medir. Se passar do limite, ela cobra para despachar.\n\n` +
      `👉 *Caso sua passagem inclua mala de 23 kg*\n` +
      `• Tudo o que está acima, *mais* 1 mala despachada de até 23 kg\n` +
      `• Tamanho máximo: altura + largura + profundidade somando até 158 cm\n` +
      `• Ela vai no porão e você só pega no destino final\n\n` +
      `Ficou na dúvida sobre o que você comprou? Me chama que eu confiro pelo seu localizador.\n` +
      `💡 Pese a mala antes de sair de casa. Saco a vácuo diminui o volume, não o peso.\n` +
      `💡 Líquidos na mão: frascos de até 100 ml, num saco transparente de 1 litro.`);

    if (p.raw_hotel_roma) {
      partes.push(p.hotel_roma_nome
        ? `🏨 *SEU HOTEL EM ROMA*\n${p.hotel_roma_nome}\n📍 ${p.hotel_roma_endereco || "—"}\n` +
          `Check-in a partir das ${campo(p, "hotel_roma_checkin", "14h")}\n` +
          `Taxa de turismo: aproximadamente *€${taxaRomaTotal(p) || "—"}* (${p.hotel_roma_noites || "—"} noites), paga direto na recepção.`
        : `🏨 *HOSPEDAGEM EM ROMA*\nLeve impresso e no celular o comprovante da sua hospedagem: a imigração pode pedir.`);
    }

    if (p.hotel_assis_nome) {
      partes.push(`🏨 *SEU HOTEL EM ASSIS*\n${p.hotel_assis_nome}\n📍 ${p.hotel_assis_endereco || "—"}\n` +
        `Taxa de turismo: cerca de €${campo(p, "hotel_assis_taxa", "—")} por noite, paga na recepção.`);
    }

    if (p.seguradora === "GTA") {
      partes.push(`🛡️ *SEU SEGURO VIAGEM: GTA*\nApólice: ${campo(p, "seguro_apolice", "—")}\n` +
        `• WhatsApp 24h: *+1 305 404 2167* (só texto e foto, não mande áudio)\n• Central Europa: *+34 91 946 4416*\n• Central internacional: +1 305 404 2167\n` +
        `Salve esses números no celular agora. Em qualquer problema de saúde, fale primeiro com a seguradora: ela indica aonde ir.`);
    } else if (p.seguradora === "Assist Card") {
      partes.push(`🛡️ *SEU SEGURO VIAGEM: ASSIST CARD*\nApólice: ${campo(p, "seguro_apolice", "—")}\n` +
        `• WhatsApp 24h: *+54 9 11 2703 9665*\n• Central na Itália: *+39 06 9480 4324*\n• Ligação gratuita (de telefone fixo na Itália): 00 800 0825 8803\n• App ASSIST CARD: dá para pedir atendimento por lá também\n` +
        `Salve esses números no celular agora. Em qualquer problema de saúde, fale primeiro com a seguradora: ela indica aonde ir.`);
    } else {
      partes.push(`🛡️ *SEGURO VIAGEM*\nO seguro é *obrigatório* para entrar na Europa (cobertura médica mínima de €30 mil). Leve a apólice impressa e salve a central 24h da sua seguradora no celular.`);
    }

    if (p.trem_data) {
      partes.push(`🚆 *SEU TREM ROMA → ASSIS*\n${fData(p.trem_data)}, às ${campo(p, "trem_horario", "—")}, saindo de ${campo(p, "trem_estacao_saida", "—")}\n` +
        `Seu bilhete já está com você no WhatsApp. Na véspera, mando as orientações da estação.`);
    } else {
      partes.push(`🚆 *ROMA → ASSIS*\nAinda não tem o trem para Assis? A gente emite o bilhete e envia aqui no WhatsApp. É só me chamar.`);
    }

    if (p.transfer_info) {
      partes.push(`🚐 *SEU TRANSFER AEROPORTO → HOTEL*\n${p.transfer_info}`);
    }

    partes.push(`📄 *DOCUMENTOS PARA LEVAR NA MÃO*\n• Passaporte (válido por pelo menos 3 meses após sua saída da Europa)\n` +
      `• Apólice do seguro viagem\n• Vouchers dos hotéis e passagem de volta\n• Comprovante de inscrição na Convenção\n` +
      `Tenha tudo impresso *e* salvo no celular para ver sem internet.`);

    partes.push(`🌧️ *CLIMA*\nRoma: entre 8 °C e 17 °C, com chuva frequente.\nAssis: entre 4 °C e 12 °C, mais fria e com vento.\n` +
      `Leve casaco quente, corta-vento impermeável, roupas em camadas, sapato fechado e guarda-chuva. Nas igrejas, ombros e joelhos cobertos.`);

    partes.push(`No guia completo abaixo estão os detalhes de pagamento, transporte, imigração e o que fazer em atrasos, mala extraviada e uso do seguro:\n${LINK_GUIA_PDF}`);

    partes.push(`Qualquer dúvida, é só me chamar. Estamos com você antes, durante e depois. 💛`);

    return partes.join("\n\n");
  }

  function montarMensagem2(p) {
    const horaChegada = subtrairHoras(p.hora_voo_ida, 3);
    const partes = [];
    partes.push(`${p.nome}, amanhã é o grande dia! ✈️`);
    partes.push(`✅ *SEU CHECK-IN*\nSegue abaixo seu cartão de embarque.`);
    partes.push(`⏰ *CHEGUE AO AEROPORTO 3 HORAS ANTES*\nSeu voo: ${campo(p, "voo_ida", "—")}, às ${campo(p, "hora_voo_ida", "—")}. Esteja no aeroporto até as ${horaChegada || "—"}.`);
    partes.push(`💺 *SOBRE OS ASSENTOS*\nOs assentos são distribuídos *aleatoriamente pela companhia aérea* no check-in. Por isso, pode acontecer de você não ficar ao lado de quem viaja com você.\n` +
      `Se quiser um assento específico, ele é *pago* à parte. Se tiver interesse, me chame que eu verifico o valor para você.`);
    partes.push(`🛂 *IMIGRAÇÃO*\n` +
      (p.voo_tem_conexao === true
        ? `Em ${p.conexao_cidade || "—"}, siga as placas de *Conexões / Flight connections*, nunca as de saída. A imigração é lá.`
        : p.voo_tem_conexao === false
        ? `A imigração é feita na chegada em Roma.`
        : AVISO_CONEXAO_NAO_CONFIRMADA) +
      `\nA Europa agora registra digitais e foto de quem entra, então as filas podem demorar mais.\n` +
      `O oficial costuma perguntar o motivo da viagem, onde você vai ficar e quando volta. Responda com calma: você vai participar de um evento religioso em Roma e Assis. Tenha à mão passaporte, voucher do hotel, passagem de volta, seguro e inscrição.`);
    partes.push(`📱 Antes de sair de casa:\n• Ative o uso internacional dos cartões no app do banco\n• Ative o roaming ou instale seu eSIM\n• Leve um adaptador de tomada universal\n• Remédios, documentos e eletrônicos sempre na bagagem de mão`);
    partes.push(`Boa viagem! Que Deus abençoe cada passo. 🙏`);
    return partes.join("\n\n");
  }

  function montarMensagem3(p) {
    const partes = [];
    partes.push(`Bem-vindo(a) a Roma, ${p.nome}! 🇮🇹 Espero que a viagem tenha sido tranquila.`);
    partes.push(p.transfer_info
      ? `🚐 Seu motorista: ${p.transfer_info}`
      : `🚕 *DO AEROPORTO AO HOTEL*\n• Táxi: só no ponto oficial (carro branco), com tarifa fixa para o centro histórico. Nunca aceite oferta de motorista dentro do saguão.\n• Uber funciona, mas com carros executivos. Vale a pena dividido entre 3 ou 4 pessoas.`);
    if (p.hotel_roma_nome) {
      partes.push(`🏨 ${p.hotel_roma_nome}\n📍 ${p.hotel_roma_endereco || "—"}\n💶 Taxa de turismo: cerca de €${taxaRomaTotal(p) || "—"}, paga na recepção. Alguns hotéis só aceitam em dinheiro, então tenha euros separados.`);
    }
    partes.push(`💳 *PAGAMENTOS*\n• Cartão de crédito internacional ou conta global (Wise) funcionam em quase todo lugar\n` +
      `• Use euro em espécie para cafés, lembranças, banheiros e a taxa do hotel\n• Leve dois cartões de bandeiras diferentes, guardados em lugares separados\n` +
      `• Na maquininha, se perguntarem, escolha pagar em *euro*, não em real: a conversão deles costuma sair mais cara`);
    partes.push(`🚇 *COMO CIRCULAR*\n• O centro histórico é compacto e dá para fazer muito a pé\n• No metrô, você paga por aproximação com o cartão direto na catraca\n` +
      `• Bilhetes de ônibus e metrô também são vendidos em máquinas e tabacarias\n• Táxi: só em pontos oficiais ou por aplicativo de táxi`);
    partes.push(`⚠️ Roma tem muitos batedores de carteira em metrô, estações e pontos turísticos. Bolsa na frente, celular guardado e documentos longe do dinheiro.`);
    partes.push(`Qualquer coisa, estou aqui. 💛`);
    return partes.join("\n\n");
  }

  function montarMensagem4(p) {
    const partes = [];
    partes.push(`${p.nome}, amanhã é dia de seguir para Assis! 🚆`);
    partes.push(`🎫 *SEU TREM*\n${fData(p.trem_data)}, às ${campo(p, "trem_horario", "—")}\nEstação: *${campo(p, "trem_estacao_saida", "—")}*\n` +
      `Seu bilhete digital está aqui no WhatsApp. Deixe-o salvo no celular, com bateria, e leve o passaporte.`);
    partes.push(`⏰ *CHEGUE 30 A 40 MINUTOS ANTES*\nA estação é grande e cheia, e o acesso às plataformas tem catraca com conferência do bilhete.`);
    partes.push(`🔎 *COMO ACHAR SEU TREM*\n1. Procure o painel de *Partenze* (partidas)\n` +
      `2. Localize o horário ${campo(p, "trem_horario", "—")} e o destino do trem. O destino final pode ser outra cidade depois de Assis: guie-se pelo horário e pelo número do trem que está no bilhete\n` +
      `3. A plataforma aparece na coluna *Binario*, geralmente uns 15 minutos antes da partida\n4. Fique de olho: a plataforma pode mudar`);
    partes.push(`✅ *PRECISA VALIDAR?*\nNão. O bilhete digital emitido pela Lolek é validado automaticamente. Basta mostrar no celular com documento. (Só bilhete de papel comprado na estação precisa ser carimbado na máquina verde.)`);
    partes.push(`🧳 No trem, cada um cuida da própria mala. A viagem dura cerca de 2 horas.`);
    partes.push(`📍 *CHEGANDO EM ASSIS*\nA estação fica na parte baixa da cidade, em Santa Maria degli Angeli. Até o centro histórico, siga de ônibus ou táxi (há ponto em frente à estação).` +
      (p.hotel_assis_nome ? `\nSeu hotel: ${p.hotel_assis_nome} · ${p.hotel_assis_endereco || "—"}` : ""));
    partes.push(`Boa viagem e bom encontro na terra de São Francisco! 🙏`);
    return partes.join("\n\n");
  }

  function montarMensagem5(p) {
    const partes = [];
    partes.push(`📌 ${p.nome}, *salve e fixe esta mensagem*. Ela é o seu guia rápido para imprevistos.`);
    partes.push(`✈️ *VOO ATRASADO OU CANCELADO*\n1. Vá ao balcão da companhia: é ela que remarca e presta assistência\n2. Guarde cartão de embarque e todos os recibos\n3. Avise a Lolek\n` +
      `Seus direitos (voos saindo do Brasil, regras da ANAC):\n• A partir de 1h: internet ou telefone\n• A partir de 2h: alimentação\n• A partir de 4h: hospedagem, se houver pernoite, com transporte\n` +
      `• Mais de 4h ou cancelado: você escolhe entre reacomodação, reembolso integral ou outro meio de transporte\nNos voos saindo da Europa, valem as regras europeias, com garantias parecidas.`);
    partes.push(`🧳 *MALA EXTRAVIADA OU DANIFICADA*\n1. *Antes de sair da área de bagagens*, vá ao balcão da companhia (Lost & Found)\n` +
      `2. Faça o registro (RIB/PIR), tire fotos e guarde o protocolo e a etiqueta da mala\n3. Compre só o essencial e guarde as notas fiscais\n4. Acione o seguro e avise a Lolek`);
    if (p.seguradora === "GTA") {
      partes.push(`🛡️ *SEGURO VIAGEM*\nGTA · WhatsApp +1 305 404 2167 · Europa +34 91 946 4416 · Apólice ${campo(p, "seguro_apolice", "—")}\n` +
        `1. Ligue para a seguradora *antes* de buscar atendimento: ela indica aonde ir\n2. Em emergência grave, vá direto ao hospital e avise a seguradora assim que puder\n3. Guarde recibos, laudos e receitas para o reembolso`);
    } else if (p.seguradora === "Assist Card") {
      partes.push(`🛡️ *SEGURO VIAGEM*\nAssist Card · WhatsApp +54 9 11 2703 9665 · Itália +39 06 9480 4324 · Apólice ${campo(p, "seguro_apolice", "—")}\n` +
        `1. Ligue para a seguradora *antes* de buscar atendimento: ela indica aonde ir\n2. Em emergência grave, vá direto ao hospital e avise a seguradora assim que puder\n3. Guarde recibos, laudos e receitas para o reembolso`);
    }
    partes.push(`📞 *QUEM CHAMAR*\n• Voo ou bagagem → balcão da companhia, depois a Lolek\n• Saúde → central do seguro, depois a Lolek\n• Problema no hotel → recepção, depois a Lolek\n• Dúvidas e bilhetes → Lolek`);
    partes.push(`💛 *LOLEK VIAGENS*: ${campo(p, "responsavel_lolek", "equipe")} · (85) 9727-4989\nEstamos com você durante toda a viagem.`);
    return partes.join("\n\n");
  }

  const MONTAR_MENSAGEM = { 1: montarMensagem1, 2: montarMensagem2, 3: montarMensagem3, 4: montarMensagem4, 5: montarMensagem5 };
  // O PDF fica na raiz do próprio site (commitado no repo, servido estático pelo Netlify) —
  // o Digisac aqui nunca anexou arquivo de verdade, só manda link em texto (mesmo padrão já
  // usado em gerar-contrato.js pro link de assinatura).
  const LINK_GUIA_PDF = location.origin + "/orientacoes-convencao-shalom-2026.pdf";
  const AVISO_CONEXAO_NAO_CONFIRMADA = "⚠ *A equipe ainda precisa confirmar se esse voo tem conexão* — essa mensagem não deveria estar sendo enviada ainda, avise a Lolek.";

  // A Mensagem 5 vai "junto" com a 1 e reenviada na 2, mas como MENSAGEM SEPARADA — não
  // concatenada no mesmo texto (isso já causou um caso real de mensagem gigante onde o link
  // do PDF parecia ter desaparecido). Esses números indicam, pra cada mensagem principal,
  // quais outras mensagens devem ser enviadas em seguida, automaticamente, no mesmo clique.
  const MENSAGENS_EM_CADEIA = { 1: [5], 2: [5] };

  // ===================================================================
  // "Mensagens pra enviar hoje" — regras de gatilho do calendário
  // ===================================================================
  function mensagensDevidasHoje(peregrinos) {
    const hojeIso = (() => { const d = hoje0(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();
    const devidas = { 1: [], 2: [], 3: [], 4: [] };
    peregrinos.forEach((p) => {
      if (p.status !== "pronto") return;
      const ja = p.mensagens_enviadas || {};
      if (p.data_voo_ida) {
        if (!ja["1"] && somarDias(p.data_voo_ida, -7) <= hojeIso) devidas[1].push(p);
        if (!ja["2"] && somarDias(p.data_voo_ida, -1) <= hojeIso) devidas[2].push(p);
        if (!ja["3"] && p.data_voo_ida <= hojeIso) devidas[3].push(p);
      }
      if (p.trem_data && !ja["4"] && somarDias(p.trem_data, -1) <= hojeIso) devidas[4].push(p);
    });
    return devidas;
  }

  // ===================================================================
  // Render
  // ===================================================================
  const TITULO_MSG = { 1: "Documentos e mala (D-7)", 2: "Véspera do voo (D-1)", 3: "Chegada em Roma", 4: "Véspera do trem p/ Assis" };
  const LABEL_STATUS = { pronto: "✅ Pronto para disparo", revisar: "⚠ Revisar", decidir: "❓ Decidir se entra" };

  let peregrinosCache = [];
  let clientesCache = [];
  let filtroStatus = "";
  let filtroBusca = "";

  function peregrinosFiltrados() {
    return peregrinosCache.filter((p) => {
      if (filtroStatus && p.status !== filtroStatus) return false;
      if (filtroBusca && !normNome(p.nome).includes(normNome(filtroBusca))) return false;
      return true;
    });
  }

  function renderResumo() {
    const porStatus = { pronto: 0, revisar: 0, decidir: 0 };
    peregrinosCache.forEach((p) => { porStatus[p.status] = (porStatus[p.status] || 0) + 1; });
    gel("cvr-resumo").textContent = peregrinosCache.length === 0
      ? "Nenhum peregrino importado ainda."
      : `${peregrinosCache.length} peregrinos — ${porStatus.pronto || 0} pronto(s), ${porStatus.revisar || 0} pra revisar, ${porStatus.decidir || 0} pra decidir`;
  }

  function renderDevidasHoje() {
    const wrap = gel("cvr-hoje-wrap");
    const devidas = mensagensDevidasHoje(peregrinosCache);
    const algumaCoisa = Object.values(devidas).some((lista) => lista.length > 0);
    if (!algumaCoisa) { wrap.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhuma mensagem devida hoje.</p></div>'; return; }

    wrap.innerHTML = Object.entries(devidas).filter(([, lista]) => lista.length > 0).map(([numero, lista]) => `
      <div class="card cvr-secao">
        <div class="cvr-secao__header"><span>📅 Mensagem ${numero} — ${escHtml(TITULO_MSG[numero])}</span><span class="cv-secao__count">${lista.length}</span></div>
        ${lista.map((p) => `
          <div class="cvr-item">
            <div class="cvr-item__nome">${escHtml(p.nome)} <span class="table__muted">— voo ${fData(p.data_voo_ida)}${p.trem_data ? " · trem " + fData(p.trem_data) : ""}</span></div>
            <button type="button" class="btn btn--gold btn--sm" data-cvr-previa="${p.id}" data-cvr-numero="${numero}">👁 Prévia e enviar</button>
          </div>`).join("")}
      </div>`).join("");

    wrap.querySelectorAll("[data-cvr-previa]").forEach((btn) => btn.addEventListener("click", () => {
      abrirPreviaMensagem(btn.dataset.cvrPrevia, Number(btn.dataset.cvrNumero));
    }));
  }

  function campoPendenteTag(p) {
    const faltas = [];
    if (!p.whatsapp) faltas.push("WhatsApp");
    if (p.data_voo_ida && p.voo_tem_conexao == null) faltas.push("confirmar se tem conexão");
    if (p.voo_tem_conexao === true && !p.conexao_cidade) faltas.push("cidade da conexão");
    if (p.raw_seguro && !p.seguradora) faltas.push("seguradora");
    if (p.raw_hotel_roma && !(p.hotel_roma_nome && p.hotel_roma_endereco)) faltas.push("hotel Roma");
    if (p.raw_hotel_assis && !(p.hotel_assis_nome && p.hotel_assis_endereco)) faltas.push("hotel Assis");
    if (p.raw_outras_hosp && !(p.outras_hosp_nome && p.outras_hosp_endereco)) faltas.push("outra hospedagem");
    if (p.raw_outros_itens && !p.itens_identificados) faltas.push("itens a identificar");
    return faltas;
  }

  function renderLista() {
    const wrap = gel("cvr-lista-wrap");
    const lista = peregrinosFiltrados();
    if (lista.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>Nenhum peregrino encontrado. Importe a planilha pelo botão acima.</p></div>';
      return;
    }
    wrap.innerHTML = lista.map((p) => {
      const faltas = campoPendenteTag(p);
      return `
      <div class="card cvr-pessoa">
        <div class="cvr-pessoa__topo">
          <div>
            <div class="cvr-pessoa__nome">${escHtml(p.nome)}</div>
            <div class="table__muted" style="font-size:0.78rem">${escHtml(p.vendedora || "—")} · voo ${fData(p.data_voo_ida)}${p.trem_data ? " · trem " + fData(p.trem_data) : ""}</div>
          </div>
          <span class="badge ${p.status === "pronto" ? "badge--concluido" : p.status === "decidir" ? "" : "badge--pendente"}">${escHtml(LABEL_STATUS[p.status] || p.status)}</span>
        </div>
        ${p.origem === "fora_do_filtro" && p.decisao_participa === "pendente" ? `
          <div class="cvr-decisao">
            <span>Entra na Convenção?</span>
            <button type="button" class="btn btn--gold btn--sm" data-cvr-decidir="${p.id}" data-decisao="sim">Sim</button>
            <button type="button" class="btn btn--ghost btn--sm" data-cvr-decidir="${p.id}" data-decisao="nao">Não</button>
          </div>` : ""}
        ${faltas.length ? `<div class="table__muted" style="font-size:0.78rem;color:#c0392b">Falta: ${faltas.map(escHtml).join(", ")}</div>` : ""}
        <div class="cvr-pessoa__acoes">
          <button type="button" class="btn btn--ghost btn--sm" data-cvr-resolver="${p.id}">✏ Resolver pendências</button>
          <button type="button" class="btn btn--ghost btn--sm" data-cvr-mensagens="${p.id}">💬 Ver as 5 mensagens</button>
        </div>
      </div>`;
    }).join("");

    wrap.querySelectorAll("[data-cvr-decidir]").forEach((btn) => btn.addEventListener("click", async () => {
      try { await chamarConvencaoRoma("decidir_participacao", { id: btn.dataset.cvrDecidir, decisao: btn.dataset.decisao }); await carregarTudo(); }
      catch (err) { alert(err.message); }
    }));
    wrap.querySelectorAll("[data-cvr-resolver]").forEach((btn) => btn.addEventListener("click", () => abrirResolverPendencias(btn.dataset.cvrResolver)));
    wrap.querySelectorAll("[data-cvr-mensagens]").forEach((btn) => btn.addEventListener("click", () => abrirTodasMensagens(btn.dataset.cvrMensagens)));
  }

  // ===== Modal: resolver pendências =====
  let peregrinoEmEdicaoId = null;
  function abrirResolverPendencias(id) {
    const p = peregrinosCache.find((x) => x.id === id);
    if (!p) return;
    peregrinoEmEdicaoId = id;
    gel("cvr-resolver-nome").textContent = p.nome;
    gel("cvr-r-whatsapp").value = p.whatsapp || "";
    gel("cvr-r-seguradora").value = p.seguradora || "";
    gel("cvr-r-seguro-apolice").value = p.seguro_apolice || "";
    gel("cvr-r-hotel-roma-nome").value = p.hotel_roma_nome || "";
    gel("cvr-r-hotel-roma-endereco").value = p.hotel_roma_endereco || "";
    gel("cvr-r-hotel-roma-estrelas").value = p.hotel_roma_estrelas || "";
    gel("cvr-r-hotel-roma-noites").value = p.hotel_roma_noites || "";
    gel("cvr-r-hotel-roma-checkin").value = p.hotel_roma_checkin || "";
    gel("cvr-r-hotel-assis-nome").value = p.hotel_assis_nome || "";
    gel("cvr-r-hotel-assis-endereco").value = p.hotel_assis_endereco || "";
    gel("cvr-r-hotel-assis-taxa").value = p.hotel_assis_taxa || "";
    gel("cvr-r-hora-voo").value = p.hora_voo_ida || "";
    gel("cvr-r-tem-conexao").value = p.voo_tem_conexao === true ? "sim" : p.voo_tem_conexao === false ? "nao" : "";
    gel("cvr-r-conexao-wrap").hidden = p.voo_tem_conexao !== true;
    gel("cvr-r-conexao").value = p.conexao_cidade || "";
    gel("cvr-r-trem-horario").value = p.trem_horario || "";
    gel("cvr-r-trem-estacao").value = p.trem_estacao_saida || "";
    gel("cvr-r-transfer").value = p.transfer_info || "";
    gel("cvr-r-itens").value = p.itens_identificados || "";
    gel("cvr-r-raw").textContent = [p.raw_voos, p.raw_hotel_roma, p.raw_hotel_assis, p.raw_outras_hosp, p.raw_seguro, p.raw_trem, p.raw_outros_itens, p.raw_pendencias].filter(Boolean).join("\n") || "—";
    gel("cvr-modal-resolver").hidden = false;
  }
  gel("cvr-r-tem-conexao").addEventListener("change", () => {
    gel("cvr-r-conexao-wrap").hidden = gel("cvr-r-tem-conexao").value !== "sim";
  });
  gel("cvr-resolver-salvar").addEventListener("click", async () => {
    if (!peregrinoEmEdicaoId) return;
    const dados = {
      id: peregrinoEmEdicaoId,
      whatsapp: gel("cvr-r-whatsapp").value.trim() || null,
      seguradora: gel("cvr-r-seguradora").value || null,
      seguro_apolice: gel("cvr-r-seguro-apolice").value.trim() || null,
      hotel_roma_nome: gel("cvr-r-hotel-roma-nome").value.trim() || null,
      hotel_roma_endereco: gel("cvr-r-hotel-roma-endereco").value.trim() || null,
      hotel_roma_estrelas: gel("cvr-r-hotel-roma-estrelas").value || null,
      hotel_roma_noites: gel("cvr-r-hotel-roma-noites").value || null,
      hotel_roma_checkin: gel("cvr-r-hotel-roma-checkin").value.trim() || null,
      hotel_assis_nome: gel("cvr-r-hotel-assis-nome").value.trim() || null,
      hotel_assis_endereco: gel("cvr-r-hotel-assis-endereco").value.trim() || null,
      hotel_assis_taxa: gel("cvr-r-hotel-assis-taxa").value || null,
      hora_voo_ida: gel("cvr-r-hora-voo").value.trim() || null,
      voo_tem_conexao: gel("cvr-r-tem-conexao").value === "sim" ? true : gel("cvr-r-tem-conexao").value === "nao" ? false : null,
      conexao_cidade: gel("cvr-r-tem-conexao").value === "sim" ? (gel("cvr-r-conexao").value.trim() || null) : null,
      trem_horario: gel("cvr-r-trem-horario").value.trim() || null,
      trem_estacao_saida: gel("cvr-r-trem-estacao").value.trim() || null,
      transfer_info: gel("cvr-r-transfer").value.trim() || null,
      itens_identificados: gel("cvr-r-itens").value.trim() || null,
    };
    try {
      await chamarConvencaoRoma("atualizar_peregrino", dados);
      gel("cvr-modal-resolver").hidden = true;
      await carregarTudo();
    } catch (err) { alert(err.message); }
  });

  // ===== Modal: prévia/envio de UMA mensagem =====
  function abrirPreviaMensagem(id, numero) {
    const p = peregrinosCache.find((x) => x.id === id);
    if (!p) return;
    const texto = MONTAR_MENSAGEM[numero](p);
    gel("cvr-previa-titulo").textContent = `Mensagem ${numero} — ${p.nome}`;
    gel("cvr-previa-texto").value = texto;
    gel("cvr-previa-enviar").dataset.id = id;
    gel("cvr-previa-enviar").dataset.numero = numero;
    gel("cvr-previa-erro").hidden = true;
    gel("cvr-modal-previa").hidden = false;
  }
  gel("cvr-previa-enviar").addEventListener("click", async () => {
    const btn = gel("cvr-previa-enviar");
    const id = btn.dataset.id, numero = btn.dataset.numero;
    const p = peregrinosCache.find((x) => x.id === id);
    const erroEl = gel("cvr-previa-erro");
    if (!p || !p.whatsapp) { erroEl.textContent = "Esse peregrino não tem WhatsApp cadastrado."; erroEl.hidden = false; return; }
    btn.disabled = true;
    try {
      await enviarPeloDigisac(p.whatsapp, gel("cvr-previa-texto").value);
      await chamarConvencaoRoma("marcar_mensagem_enviada", { id, numero });

      // Mensagem 5 vai "junto" com a 1 e reenviada na 2 — mas como mensagem SEPARADA no
      // WhatsApp (ver MENSAGENS_EM_CADEIA), não colada no mesmo texto. Manda em seguida,
      // automaticamente, sem abrir outra prévia (é sempre o mesmo aviso de emergência).
      const emCadeia = MENSAGENS_EM_CADEIA[Number(numero)] || [];
      for (const outroNumero of emCadeia) {
        await enviarPeloDigisac(p.whatsapp, MONTAR_MENSAGEM[outroNumero](p));
        await chamarConvencaoRoma("marcar_mensagem_enviada", { id, numero: outroNumero });
      }

      gel("cvr-modal-previa").hidden = true;
      await carregarTudo();
    } catch (err) {
      erroEl.textContent = err.message; erroEl.hidden = false;
    } finally { btn.disabled = false; }
  });

  // ===== Modal: ver as 5 mensagens de uma vez =====
  function abrirTodasMensagens(id) {
    const p = peregrinosCache.find((x) => x.id === id);
    if (!p) return;
    gel("cvr-todas-nome").textContent = p.nome;
    const corpo = gel("cvr-todas-corpo");
    corpo.innerHTML = [1, 2, 3, 4, 5].map((n) => {
      const enviado = p.mensagens_enviadas && p.mensagens_enviadas[String(n)];
      return `
        <div style="margin-bottom:16px">
          <div style="font-weight:600;margin-bottom:4px">Mensagem ${n}${enviado ? ` <span class="table__muted" style="font-weight:400">— enviada</span>` : ""}</div>
          <textarea class="input" rows="6" readonly style="font-size:0.78rem">${escHtml(MONTAR_MENSAGEM[n](p))}</textarea>
          ${n !== 5 ? `<button type="button" class="btn btn--ghost btn--sm" style="margin-top:4px" data-cvr-previa-todas="${n}">👁 Abrir prévia pra enviar</button>` : ""}
        </div>`;
    }).join("");
    corpo.querySelectorAll("[data-cvr-previa-todas]").forEach((btn) => btn.addEventListener("click", () => {
      gel("cvr-modal-todas").hidden = true;
      abrirPreviaMensagem(id, Number(btn.dataset.cvrPreviaTodas));
    }));
    gel("cvr-modal-todas").hidden = false;
  }

  // ===== Importação =====
  gel("cvr-importar-input").addEventListener("change", async () => {
    const file = gel("cvr-importar-input").files[0];
    if (!file) return;
    const statusEl = gel("cvr-status");
    statusEl.innerHTML = `<div class="notice">Lendo a planilha...</div>`;
    try {
      if (typeof XLSX === "undefined") throw new Error("Biblioteca de leitura de planilha não carregou — recarregue a página.");
      const peregrinos = await lerPlanilha(file, clientesCache);
      if (peregrinos.length === 0) throw new Error("Não encontrei nenhum peregrino nessa planilha — confira se as abas têm os nomes esperados.");
      statusEl.innerHTML = `<div class="notice">Importando ${peregrinos.length} peregrinos...</div>`;
      const r = await chamarConvencaoRoma("importar_peregrinos", { peregrinos });
      statusEl.innerHTML = "";
      alert(`${r.importados} peregrinos importados/atualizados.`);
      await carregarTudo();
    } catch (err) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao importar.</strong><p>${escHtml(err.message)}</p></div>`;
    } finally {
      gel("cvr-importar-input").value = "";
    }
  });

  document.querySelectorAll("[data-cvr-filtro]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filtroStatus = btn.dataset.cvrFiltro;
      document.querySelectorAll("[data-cvr-filtro]").forEach((b) => b.classList.toggle("is-active", b === btn));
      renderLista();
    });
  });
  gel("cvr-busca").addEventListener("input", () => { filtroBusca = gel("cvr-busca").value; renderLista(); });

  document.querySelectorAll("[data-cvr-fechar]").forEach((btn) => {
    btn.addEventListener("click", () => { gel(btn.dataset.cvrFechar).hidden = true; });
  });

  async function carregarTudo() {
    const statusEl = gel("cvr-status");
    statusEl.innerHTML = `<div class="notice">Carregando...</div>`;
    try {
      const [peregrinos, clientes] = await Promise.all([chamarConvencaoRoma("listar_peregrinos"), carregarClientes()]);
      peregrinosCache = peregrinos || [];
      clientesCache = clientes || [];
      statusEl.innerHTML = "";
      renderResumo();
      renderDevidasHoje();
      renderLista();
    } catch (err) {
      statusEl.innerHTML = `<div class="notice notice--error"><strong>Erro ao carregar.</strong><p>${escHtml(err.message)}</p></div>`;
    }
  }

  gel("cvr-atualizar-btn").addEventListener("click", carregarTudo);

  let carregouUmaVez = false;
  document.querySelector('[data-tab="convencao-roma"]').addEventListener("click", () => {
    if (carregouUmaVez) return;
    carregouUmaVez = true;
    carregarTudo();
  });
})();
