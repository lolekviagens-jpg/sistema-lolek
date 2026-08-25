// Netlify Function — importação única do histórico da planilha antiga (Google Sheets,
// abas 2024/2025/2026) pra dentro da Nova Emissão. Uso pontual, disparado manualmente
// (não é chamado por nenhuma tela do sistema).
//
// IMPORTANTE — decisões já combinadas com a usuária:
//   - NÃO gera financeiro_lancamentos (ela já reconcilia o caixa pelo extrato bancário
//     mês a mês; gerar aqui também duplicaria receita).
//   - Formas de pagamento fora do padrão atual (Boleto, Stone, Wise, Mittu, etc.) ficam
//     só no histórico importado, normalizadas em slugs — não viram opção nova no
//     formulário de Nova Emissão.
//   - Categorias sem tipo de produto equivalente (Consultoria, Roteiro de Viagem, Trem,
//     Guia Turístico, Convenção, Parceria Eva) entram como tipo "outro".
//
// GET  ?modo=dry     -> lê e processa tudo, devolve um relatório (nada é gravado).
// GET  ?modo=commit&offset=N&limit=M -> grava um lote de emissões (idempotente por
//      posição — chame em sequência aumentando offset até "restam" chegar a 0).
//
// Variável de ambiente necessária: SUPABASE_SECRET_KEY (mesma de emissoes-data.js)

const https = require("https");

const SHEET_ID = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

const ABAS = [
  { chave: "2026", url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`, ano: 2026 },
  { chave: "2025", url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=2025`, ano: 2025 },
  { chave: "2024", url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=2024`, ano: 2024 },
];

// Índices de coluna (0-based) por layout de aba.
const LAYOUT_PADRAO = { data: 0, situacao: 1, venda: 2, lead: 3, nome: 4, ida: 5, volta: 6, saida: 7, destino: 8, companhia: 9, milheiro: 10, reserva: 11, forma: 12, valorTotal: 14, lucro: 15, valorMilha: 17, taxas: 18, qtdMilhas: 19 };
const LAYOUT_2024    = { data: 0, situacao: 1, venda: 2, lead: null, nome: 3, ida: 4, volta: 5, saida: 6, destino: 7, companhia: 8, milheiro: 9, reserva: 10, forma: 11, valorTotal: 12, lucro: 13, valorMilha: null, taxas: null, qtdMilhas: null };
function layoutDaAba(ano) { return ano === 2024 ? LAYOUT_2024 : LAYOUT_PADRAO; }

// "REEMBOLSO" não é cancelamento, mas também não é venda (é dinheiro saindo) — trata
// junto, exclui do import igual.
const SITUACOES_EXCLUIDAS_EXATO = new Set([
  "NO SHOW", "NO SHOW - SAÚDE", "(NO SHOW - SAÚDE)", "REEMBOLSO",
]);
function ehExcluida(situacaoUpper) {
  if (SITUACOES_EXCLUIDAS_EXATO.has(situacaoUpper)) return true;
  return situacaoUpper.includes("CANCELAD"); // pega "CANCELADA", "CANCELADO", "MALA ADICIONAL (CANCELADA)", "VOLTA CANCELADA" etc.
}

const TIPO_POR_SITUACAO = {
  "VIAGEM CONCLUIDA": "passagem", "AGUARDANDO VIAGEM": "passagem", "PASSAGEM EM ABERTO": "passagem",
  "REMARCAÇÃO": "passagem", "VIAGEM REMARCADA": "passagem", "FOI REMARCADA": "passagem",
  "RESERVA ABERTA P/ REMARCAR": "passagem", "PASSAGEM DE ONIBUS": "passagem",
  "HOSPEDAGEM": "hospedagem",
  "SEGURO VIAGEM": "seguro",
  "TRANSFER": "transfer", "TRANSLADO": "transfer",
  "MALA ADICIONAL": "mala",
  "ALUGUEL DE CARRO": "carro",
  "ASSENTO": "assento", "ADICIONAL ASSENTO": "assento", "MARCAÇÃO ASSENTO": "assento",
  "ASSESSORIA VISTO AMERICANO": "visto_americano",
  "COMPRA/VENDA DE MILHAS": "venda_milhas",
  "CONSULTORIA DE MILHAS": "consultoria_milhas",
  "PASSEIOS ROMA": "passeio", "PASSEIOS VENEZA": "passeio", "PASSEIOS PARIS": "passeio",
  "INGRESSO DISNEY": "passeio", "INGRESSO BETO CARRERO": "passeio", "PASSEIO JERI": "passeio",
};
// Qualquer situação não excluída e fora do mapa acima vira "outro".

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return json(500, { error: "SUPABASE_SECRET_KEY não configurada no Netlify" });

  const params = event.queryStringParameters || {};
  const modo = params.modo || "dry";

  try {
    const { grupos, relatorio } = await montarGrupos();

    if (modo === "dry") {
      return json(200, {
        ...relatorio,
        total_emissoes_a_criar: grupos.length,
        amostra_5_emissoes: grupos.slice(0, 5),
      });
    }

    if (modo === "commit") {
      const offset = parseInt(params.offset, 10) || 0;
      const limit = Math.min(parseInt(params.limit, 10) || 20, 50);
      const lote = grupos.slice(offset, offset + limit);

      const clientesCache = await supabaseRest("/clientes?select=id,nome", "GET", secretKey);
      const resultado = await commitLote(lote, clientesCache || [], secretKey);

      return json(200, {
        processados: lote.length,
        offset_proximo: offset + lote.length,
        restam: Math.max(0, grupos.length - (offset + lote.length)),
        total: grupos.length,
        detalhe: resultado,
      });
    }

    return json(400, { error: "modo inválido — use 'dry' ou 'commit'" });
  } catch (err) {
    console.error("[importar-planilha-antiga] erro:", err.message);
    return json(500, { error: err.message });
  }
};

// ===== Monta os grupos (candidatos a emissão) a partir das 3 abas =====
async function montarGrupos() {
  const situacoesEncontradas = {};   // situacao -> { count, tipo }
  const formasEncontradas = {};      // forma_raw -> { count, normalizada }
  const contadores = { linhas_lidas: 0, excluidas: 0, sem_data_ou_nome: 0, por_ano: {} };

  const todasLinhas = [];

  for (const aba of ABAS) {
    const csvText = await httpsGetText(aba.url);
    const linhasCsv = parseCsv(csvText).slice(1); // pula cabeçalho
    const layout = layoutDaAba(aba.ano);
    contadores.por_ano[aba.ano] = { lidas: 0, importaveis: 0 };

    linhasCsv.forEach((cols) => {
      contadores.linhas_lidas++;
      contadores.por_ano[aba.ano].lidas++;

      const situacaoRaw = (cols[layout.situacao] || "").trim();
      const nome = (cols[layout.nome] || "").trim();
      const dataVendaIso = paraDataISO(cols[layout.data], aba.ano);
      const situacao = situacaoRaw.toUpperCase();

      if (!nome || !dataVendaIso) { contadores.sem_data_ou_nome++; return; }
      if (ehExcluida(situacao)) { contadores.excluidas++; return; }

      const tipo = TIPO_POR_SITUACAO[situacao] || "outro";
      situacoesEncontradas[situacaoRaw] = situacoesEncontradas[situacaoRaw] || { count: 0, tipo };
      situacoesEncontradas[situacaoRaw].count++;

      const formaRaw = (cols[layout.forma] || "").trim();
      const formaNorm = normalizarForma(formaRaw);
      formasEncontradas[formaRaw || "(vazio)"] = formasEncontradas[formaRaw || "(vazio)"] || { count: 0, normalizada: formaNorm };
      formasEncontradas[formaRaw || "(vazio)"].count++;

      const valorTotal = layout.valorTotal != null ? paraNumeroBR(cols[layout.valorTotal]) : 0;
      const lucro = layout.lucro != null ? paraNumeroBR(cols[layout.lucro]) : null;
      const custo = lucro != null ? Math.round((valorTotal - lucro) * 100) / 100 : null;

      todasLinhas.push({
        ano: aba.ano,
        dataVenda: dataVendaIso,
        situacao: situacaoRaw,
        tipo,
        funcionaria: (cols[layout.venda] || "").trim(),
        origemLead: layout.lead != null ? (cols[layout.lead] || "").trim() : "",
        nome,
        dataIda: paraDataISO(cols[layout.ida], aba.ano),
        dataVolta: paraDataISO(cols[layout.volta], aba.ano),
        saida: (cols[layout.saida] || "").trim(),
        destino: (cols[layout.destino] || "").trim(),
        companhia: (cols[layout.companhia] || "").trim(),
        milheiro: (cols[layout.milheiro] || "").trim(),
        reserva: (cols[layout.reserva] || "").trim(),
        formaRaw, formaNorm,
        valorTotal, custo,
        valorMilha: layout.valorMilha != null ? paraNumeroBR(cols[layout.valorMilha]) : null,
        taxas: layout.taxas != null ? paraNumeroBR(cols[layout.taxas]) : null,
        qtdMilhas: layout.qtdMilhas != null ? paraNumeroBR(cols[layout.qtdMilhas]) : null,
      });
      contadores.por_ano[aba.ano].importaveis++;
    });
  }

  // Até julho/2026 (antes do sistema novo passar a ser usado exclusivamente), cada linha
  // da planilha era uma venda própria — mesmo quando várias pessoas viajavam juntas na
  // mesma reserva, o valor de cada uma era contado separado, linha por linha, sem somar
  // nem agrupar. Preserva esse mesmo critério aqui: 1 linha = 1 emissão, sempre.
  const grupos = todasLinhas.map((l) => construirEmissaoCandidata([l]));

  const relatorio = {
    linhas_lidas_total: contadores.linhas_lidas,
    linhas_canceladas_ou_reembolso_ignoradas: contadores.excluidas,
    linhas_sem_data_ou_nome_ignoradas: contadores.sem_data_ou_nome,
    por_ano: contadores.por_ano,
    situacoes_encontradas: situacoesEncontradas,
    formas_pagamento_encontradas: formasEncontradas,
    valores_forma_pagamento_normalizados_unicos: [...new Set(Object.values(formasEncontradas).map((f) => f.normalizada))],
  };

  return { grupos, relatorio };
}

function construirEmissaoCandidata(linhas) {
  const l0 = linhas[0];
  const dados = montarDadosProduto(l0.tipo, linhas);
  return {
    emissao: {
      destino: l0.destino || null,
      data_ida: l0.dataIda,
      data_volta: l0.dataVolta,
      tipo_viagem: null,
      observacoes_gerais: "Importado da planilha antiga (" + l0.ano + ", situação original: " + l0.situacao + ")",
    },
    passageiros: linhas.map((l) => ({ nome: l.nome })),
    produto: {
      tipo: l0.tipo,
      dados,
      custo: l0.custo,
      valor_venda: l0.valorTotal,
      forma_pagamento: l0.formaNorm,
      funcionaria: l0.funcionaria || null,
      origem_lead: l0.tipo === "passagem" ? (l0.origemLead || null) : null,
      milheiro_nome: l0.milheiro || null,
      valor_milha: l0.valorMilha,
      qtd_milhas: l0.qtdMilhas,
      data_venda: l0.dataVenda,
    },
  };
}

function montarDadosProduto(tipo, linhas) {
  const l0 = linhas[0];
  const trecho = (l0.saida && l0.destino) ? `${l0.saida} → ${l0.destino}` : (l0.destino || "");
  switch (tipo) {
    case "passagem": {
      const ida = { segmentos: [{ trecho, companhia: l0.companhia, voo: "", horario_partida: "", horario_chegada: "" }], localizador: l0.reserva || null };
      const temVolta = !!l0.dataVolta;
      const dados = { ida_volta: temVolta, ida, taxa_embarque: l0.taxas || "" };
      if (temVolta) dados.volta = { segmentos: [{ trecho: (l0.destino && l0.saida) ? `${l0.destino} → ${l0.saida}` : "", companhia: l0.companhia, voo: "", horario_partida: "", horario_chegada: "" }], localizador: l0.reserva || null };
      return dados;
    }
    case "hospedagem":
      return { hotel: l0.companhia || "", regime: "", checkin: l0.dataIda, checkout: l0.dataVolta };
    case "seguro":
      return { seguradora: l0.companhia || "", plano: "", cobertura: "" };
    case "transfer":
      return { trecho, tipo_transfer: "" };
    case "carro":
      return { locadora: l0.companhia || "", categoria: "" };
    case "assento":
      return { trecho, assento: "" };
    case "visto_americano":
      return { tipo_visto: "", data_entrevista: l0.dataIda };
    case "venda_milhas":
      return { programa: l0.companhia || "", quantidade: l0.qtdMilhas || "" };
    case "consultoria_milhas":
      return { descricao: "" };
    case "passeio":
      return { descricao: l0.destino || l0.companhia || "", data_passeio: l0.dataIda };
    case "mala":
      return { descricao: l0.companhia || l0.destino || "" };
    default:
      return { descricao: `${l0.situacao}${l0.destino ? " — " + l0.destino : ""}` };
  }
}

// ===== Grava um lote de emissões =====
async function commitLote(grupos, clientesCache, secretKey) {
  const nomeParaId = new Map(clientesCache.map((c) => [normNome(c.nome), c.id]));
  const criados = [];

  for (const grupo of grupos) {
    try {
      const passageirosCriados = [];
      for (const pax of grupo.passageiros) {
        let clienteId = nomeParaId.get(normNome(pax.nome));
        if (!clienteId) {
          const [novo] = await supabaseRest("/clientes", "POST", secretKey, { nome: pax.nome });
          clienteId = novo.id;
          nomeParaId.set(normNome(pax.nome), clienteId);
        }
        passageirosCriados.push(clienteId);
      }

      const [emissaoCriada] = await supabaseRest("/venda_emissoes", "POST", secretKey, grupo.emissao);

      const passageiroIdsSalvos = [];
      for (const clienteId of passageirosCriados) {
        const [p] = await supabaseRest("/venda_emissoes_passageiros", "POST", secretKey, {
          emissao_id: emissaoCriada.id, cliente_id: clienteId,
        });
        passageiroIdsSalvos.push(p.id);
      }

      let fornecedorId = null;
      if (grupo.produto.milheiro_nome) {
        fornecedorId = await encontrarOuCriarFornecedor(grupo.produto.milheiro_nome, secretKey);
      }

      const custoTotal = grupo.produto.custo != null ? grupo.produto.custo : 0;
      const lucro = (grupo.produto.valor_venda || 0) - custoTotal;

      await supabaseRest("/venda_emissoes_produtos", "POST", secretKey, {
        emissao_id: emissaoCriada.id,
        tipo: grupo.produto.tipo,
        passageiro_ids: passageiroIdsSalvos,
        dados: grupo.produto.dados,
        fornecedor_id: fornecedorId,
        valor_milha: grupo.produto.valor_milha || null,
        qtd_milhas: grupo.produto.qtd_milhas || null,
        custo: grupo.produto.custo,
        valor_venda: grupo.produto.valor_venda || 0,
        lucro,
        forma_pagamento: grupo.produto.forma_pagamento,
        data_faturamento: null,
        pagamentos: [{ forma: grupo.produto.forma_pagamento, valor: grupo.produto.valor_venda || 0, data_faturamento: null }],
        funcionaria: grupo.produto.funcionaria,
        origem_lead: grupo.produto.origem_lead,
        data_venda: grupo.produto.data_venda,
      });
      // Sem financeiro_lancamentos de propósito — ver comentário no topo do arquivo.

      criados.push({ ok: true, emissao_id: emissaoCriada.id });
    } catch (err) {
      criados.push({ ok: false, erro: err.message, destino: grupo.emissao.destino });
    }
  }

  return criados;
}

let fornecedoresCacheLocal = null;
async function encontrarOuCriarFornecedor(nome, secretKey) {
  if (!fornecedoresCacheLocal) {
    fornecedoresCacheLocal = await supabaseRest("/fornecedores?select=id,nome", "GET", secretKey);
  }
  const existente = fornecedoresCacheLocal.find((f) => normNome(f.nome) === normNome(nome));
  if (existente) return existente.id;
  const [criado] = await supabaseRest("/fornecedores", "POST", secretKey, { nome });
  fornecedoresCacheLocal.push(criado);
  return criado.id;
}

// ===== Normalização de forma de pagamento (histórico só — não vira opção nova) =====
function normalizarForma(raw) {
  const s = (raw || "").toUpperCase().trim();
  if (!s) return "outro_pagamento";
  const tem = (kw) => s.includes(kw);
  if (tem("VALEPAY") && tem("PIX")) return "pix_valepay";
  if (tem("SUMUP") && tem("PIX")) return "pix_sumup";
  if (s === "PIX") return "pix";
  if (s === "SUMUP") return "sumup";
  if (s === "VALEPAY") return "valepay";
  if (tem("WISE")) return "wise";
  if (tem("BOLETO")) return "boleto";
  if (tem("MITTU")) return "mittu";
  if (tem("MAQUINA C6") || tem("MÁQUINA C6") || s === "C6") return "maquina_c6";
  if (tem("STONE")) return "stone";
  if (tem("MERCADO PAGO")) return "mercado_pago";
  if (tem("DINHEIRO")) return "dinheiro";
  if (tem("INFINITY")) return "infinity";
  if (tem("INTER")) return "inter_pj";
  if (tem("BTG")) return "btg";
  if (tem("MILHEIRO")) return "faturado";
  return "outro_pagamento";
}

function normNome(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

// ===== Parsers =====
function paraDataISO(raw, anoFallback) {
  const s = String(raw || "").trim();
  if (!s || s === "-") return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`; }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/); // sem ano — usa o ano da aba de origem (não o ano atual)
  if (m) { const y = anoFallback || new Date().getFullYear(); return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`; }
  return null;
}

function paraNumeroBR(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "-") return 0;
  const limpo = s.replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return isNaN(n) ? 0 : n;
}

function parseCsv(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGetText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error("HTTP " + res.statusCode + " ao buscar " + url)); return; }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ===== Chamada genérica REST pro Supabase =====
function supabaseRest(path, method, secretKey, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(SUPABASE_URL + "/rest/v1" + path);
    const options = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { "apikey": secretKey, "Authorization": "Bearer " + secretKey, "Content-Type": "application/json", "Prefer": "return=representation", ...(extraHeaders || {}) },
    };
    if (payload) options.headers["Content-Length"] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(chunks ? JSON.parse(chunks) : null); } catch { resolve(null); } }
        else reject(new Error("Supabase " + res.statusCode + ": " + chunks));
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
