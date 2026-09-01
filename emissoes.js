// ===== Emissões — Lolek Viagens =====
// Cadastro estruturado de vendas confirmadas: passageiros (existentes ou novos, lidos por
// IA), produtos da viagem (passagem/hospedagem/seguro/carro/passeio/transfer/mala, com
// leitura de print por IA pra passagem e hospedagem) e dados financeiros (milhas, milheiro,
// fornecedor, forma de pagamento, faturamento futuro). Ao salvar, cada produto gera
// automaticamente um lançamento de entrada no Financeiro (netlify/functions/emissoes-data.js).
(function () {
  "use strict";

  const LS_AI_MODEL = "lolek_anthropic_model";
  function getModel() { return localStorage.getItem(LS_AI_MODEL) || "claude-sonnet-4-6"; }
  function gel(id) { return document.getElementById(id); }

  // Mapeamento de companhias → site de gerenciamento da reserva, pra montar a instrução
  // "acesse o site da [companhia]..." no comprovante do cliente.
  const AIRLINE_SITES = {
    "latam":       { label: "LATAM Airlines",     path: "latam.com → Minha Conta → Minhas Viagens" },
    "gol":         { label: "GOL Linhas Aéreas",  path: "voegol.com.br → Minha GOL → Gerenciar Reserva" },
    "azul":        { label: "Azul Linhas Aéreas", path: "voeazul.com.br → Gerenciar → Minhas Viagens" },
    "tap":         { label: "TAP Air Portugal",   path: "flytap.com → Gerir Reservas" },
    "emirates":    { label: "Emirates",           path: "emirates.com → Manage Booking" },
    "copa":        { label: "Copa Airlines",      path: "copaair.com → Minha Reserva" },
    "american":    { label: "American Airlines",  path: "aa.com → My Trips" },
    "delta":       { label: "Delta Air Lines",    path: "delta.com → My Trips" },
    "united":      { label: "United Airlines",    path: "united.com → My Trips" },
    "air france":  { label: "Air France",         path: "airfrance.com.br → Minha Reserva" },
    "klm":         { label: "KLM",                path: "klm.com.br → Gerenciar Reserva" },
    "iberia":      { label: "Iberia",             path: "iberia.com → Minhas Viagens" },
    "lufthansa":   { label: "Lufthansa",          path: "lufthansa.com/pt → Minha Reserva" },
    "avianca":     { label: "Avianca",            path: "avianca.com → Gerenciar Reserva" },
    "turkish":     { label: "Turkish Airlines",   path: "turkishairlines.com/pt-br → Gerencie sua Reserva" },
    "qatar":       { label: "Qatar Airways",      path: "qatarairways.com/pt → Gerenciar Reserva" },
    "british":     { label: "British Airways",    path: "britishairways.com → Manage My Booking" },
    "swiss":       { label: "SWISS",              path: "swiss.com/pt → Gerenciar Reserva" },
    "aeromexico":  { label: "Aeroméxico",         path: "aeromexico.com/pt-br → Minha Reserva" },
    "ita":         { label: "ITA Airways",        path: "ita-airways.com → Minhas Reservas" },
    "alitalia":    { label: "ITA Airways",        path: "ita-airways.com → Minhas Reservas" },
  };

  function findAirline(str) {
    const lower = (str || "").toLowerCase();
    for (const [key, info] of Object.entries(AIRLINE_SITES)) {
      if (lower.includes(key)) return info;
    }
    return null;
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fBRL(v) { return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // ===== Valor por extenso (pra pré-preencher o contrato) =====
  const EXT_UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const EXT_10A19 = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const EXT_DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const EXT_CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const EXT_ESCALAS = [
    { valor: 1000000000, singular: "bilhão", plural: "bilhões" },
    { valor: 1000000, singular: "milhão", plural: "milhões" },
    { valor: 1000, singular: "mil", plural: "mil" },
  ];

  function extCentena(n) {
    if (n === 0) return "";
    if (n === 100) return "cem";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const partes = [];
    if (c > 0) partes.push(EXT_CENTENAS[c]);
    if (resto > 0) {
      if (resto < 10) partes.push(EXT_UNIDADES[resto]);
      else if (resto < 20) partes.push(EXT_10A19[resto - 10]);
      else {
        const d = Math.floor(resto / 10), u = resto % 10;
        partes.push(u > 0 ? `${EXT_DEZENAS[d]} e ${EXT_UNIDADES[u]}` : EXT_DEZENAS[d]);
      }
    }
    return partes.join(" e ");
  }

  function extInteiro(n) {
    if (n === 0) return "zero";
    const partes = [];
    let resto = n;
    for (const escala of EXT_ESCALAS) {
      if (resto >= escala.valor) {
        const qtd = Math.floor(resto / escala.valor);
        resto = resto % escala.valor;
        partes.push(escala.valor === 1000 && qtd === 1 ? "mil" : `${extCentena(qtd)} ${qtd === 1 ? escala.singular : escala.plural}`);
      }
    }
    if (resto > 0) partes.push(extCentena(resto));
    return partes.join(", ");
  }

  function valorPorExtenso(valor) {
    const centavosTotal = Math.round((Number(valor) || 0) * 100);
    const reais = Math.floor(centavosTotal / 100);
    const centavos = centavosTotal % 100;
    let texto = `${extInteiro(reais)} ${reais === 1 ? "real" : "reais"}`;
    if (centavos > 0) texto += ` e ${extInteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
  function fData(iso) {
    if (!iso) return "—";
    const [y, m, d] = String(iso).split("-");
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }
  function mesLabel(chaveAnoMes) {
    if (!chaveAnoMes || chaveAnoMes === "sem-data") return "Sem data";
    const [y, m] = chaveAnoMes.split("-");
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }

  // Lista de meses pro filtro da aba Emissões — sempre a partir de janeiro/2026 (início do
  // sistema) até o mês atual, mais recente primeiro, mesmo que o mês não tenha nada ainda.
  function gerarOpcoesMeses() {
    const inicio = new Date(2026, 0, 1);
    const agora = new Date();
    const opcoes = [];
    const cursor = new Date(agora.getFullYear(), agora.getMonth(), 1);
    while (cursor >= inicio) {
      const chave = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0");
      opcoes.push({ chave, label: mesLabel(chave) });
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return opcoes;
  }

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

  function contextoDataAtual() {
    const hoje = new Date();
    const dd = String(hoje.getDate()).padStart(2, "0");
    const mm = String(hoje.getMonth() + 1).padStart(2, "0");
    const yyyy = hoje.getFullYear();
    return `Hoje é ${dd}/${mm}/${yyyy}. Datas de viagem são sempre no presente ou futuro a partir de hoje — nunca deduza um ano passado.`;
  }

  function novoId(prefixo) { return prefixo + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  // ===== Config =====
  const CLIENTE_CAMPOS = ["nome", "nascimento", "rg", "cpf", "passaporte", "venc_passaporte", "email", "telefone", "endereco"];
  const CLIENTE_LABELS = {
    nome: "Nome completo", nascimento: "Nascimento", rg: "RG", cpf: "CPF",
    passaporte: "Passaporte", venc_passaporte: "Venc. passaporte", email: "E-mail", telefone: "Telefone",
    endereco: "Endereço",
  };

  const PROD_TIPOS = [
    { tipo: "passagem",   label: "Passagem aérea",     icon: "✈️" },
    { tipo: "hospedagem", label: "Hospedagem",         icon: "🏨" },
    { tipo: "seguro",     label: "Seguro viagem",      icon: "🛡️" },
    { tipo: "carro",      label: "Aluguel de carro",   icon: "🚗" },
    { tipo: "trem",       label: "Trem",              icon: "🚆" },
    { tipo: "passeio",    label: "Passeio / Ingresso", icon: "🗺️" },
    { tipo: "transfer",   label: "Transfer",           icon: "🚌" },
    { tipo: "mala",       label: "Adicional de mala",  icon: "🧳" },
    { tipo: "assento",    label: "Assento",            icon: "💺" },
    { tipo: "consultoria_milhas", label: "Consultoria de milhas", icon: "🧭" },
    { tipo: "visto_americano",    label: "Visto americano",       icon: "🛂" },
    { tipo: "venda_milhas",       label: "Venda de milhas",       icon: "💱" },
    { tipo: "outro",              label: "Outro / Diversos",      icon: "📌" },
  ];
  const PROD_LABEL = Object.fromEntries(PROD_TIPOS.map((p) => [p.tipo, p.label]));
  const PROD_ICON  = Object.fromEntries(PROD_TIPOS.map((p) => [p.tipo, p.icon]));

  const DADOS_CFG = {
    // passagem não usa DADOS_CFG — cada perna (ida/volta) tem sua própria lista de
    // trechos/segmentos (ver segmentosPorProduto), pra suportar conexões com todos os
    // detalhes (aeroporto, horários) em vez de resumir numa frase.
    hospedagem: [
      { id: "hotel", label: "Hotel / Pousada" },
      { id: "regime", label: "Regime", type: "select", options: ["Sem café", "Café incluso", "Meia pensão", "Pensão completa", "All inclusive"] },
      { id: "checkin", label: "Check-in", type: "date" },
      { id: "checkout", label: "Check-out", type: "date" },
      { id: "localizador", label: "Localizador / número da reserva" },
    ],
    seguro: [
      { id: "seguradora", label: "Seguradora" },
      { id: "plano", label: "Plano" },
      { id: "cobertura", label: "Cobertura" },
      { id: "localizador", label: "Localizador / número da reserva" },
    ],
    carro: [
      { id: "locadora", label: "Locadora" },
      { id: "categoria", label: "Categoria" },
      { id: "localizador", label: "Localizador / número da reserva" },
    ],
    trem: [
      { id: "trecho", label: "Trecho", placeholder: "Ex: Paris → Lyon" },
      { id: "companhia", label: "Companhia", placeholder: "Ex: SNCF, Trenitalia, Eurostar" },
      { id: "data_viagem", label: "Data", type: "date" },
      { id: "horario_partida", label: "Horário de partida" },
      { id: "horario_chegada", label: "Horário de chegada" },
      { id: "tem_parada", label: "Parada", type: "select", options: ["Direto", "Com parada"] },
      { id: "cidade_parada", label: "Cidade da parada", showIf: { field: "tem_parada", equals: "Com parada" } },
      { id: "horario_parada", label: "Horário da parada", showIf: { field: "tem_parada", equals: "Com parada" } },
      { id: "localizador", label: "Localizador / código da reserva" },
    ],
    passeio: [
      { id: "descricao", label: "Descrição" },
      { id: "data_passeio", label: "Data", type: "date" },
      { id: "localizador", label: "Localizador / número da reserva" },
    ],
    transfer: [
      { id: "trecho", label: "Trecho" },
      { id: "tipo_transfer", label: "Tipo", type: "select", options: ["Privativo", "Compartilhado", "Executivo"] },
      { id: "localizador", label: "Localizador / número da reserva" },
    ],
    mala: [
      { id: "descricao", label: "Descrição", placeholder: "Ex: 1 mala extra 23kg" },
    ],
    assento: [
      { id: "trecho", label: "Trecho / voo relacionado", placeholder: "Ex: FOR → LIS" },
      { id: "assento", label: "Assento", placeholder: "Ex: 14A - janela" },
    ],
    consultoria_milhas: [
      { id: "descricao", label: "Descrição da consultoria", placeholder: "Ex: Consultoria para emissão com milhas Smiles" },
    ],
    visto_americano: [
      { id: "tipo_visto", label: "Tipo de visto", placeholder: "Ex: B1/B2" },
      { id: "data_entrevista", label: "Data da entrevista", type: "date" },
      { id: "localizador", label: "Número do protocolo / caso" },
    ],
    venda_milhas: [
      { id: "programa", label: "Programa de milhagem", placeholder: "Ex: Latam Pass, Smiles, Azul" },
      { id: "quantidade", label: "Quantidade de milhas vendidas", type: "number" },
    ],
    outro: [
      { id: "descricao", label: "Descrição", placeholder: "Ex: Roteiro de viagem, consultoria, trem..." },
      { id: "localizador", label: "Localizador / número da reserva (se houver)" },
    ],
  };

  const FORMAS_PAGAMENTO = [
    { v: "pix", l: "Pix" }, { v: "sumup", l: "Sumup" }, { v: "valepay", l: "Valepay" }, { v: "faturado", l: "Faturado (cobrar depois)" },
  ];
  // "Indicação" e "Outro" saíram — a funcionária considera as duas a mesma coisa que Orgânico.
  const ORIGENS_LEAD = ["Shalom", "Orgânico", "Corporativo", "Convenção"];

  // ===== Estado =====
  let clientesCache = [];
  let fornecedoresCache = [];
  let vendedoresCache = []; // [{ id, nome }] — mesma lista das Metas em Vendas, pro nome bater certinho
  let empresasCache = []; // [{ id, nome }] — pro seletor de empresa quando origem do lead = Corporativo
  let passageiros = [];              // [{ id, cliente_id: string|null, nome }]
  let produtos = [];                 // [{ id, tipo }]
  const paxSelecionados = {};        // produtoId -> Set(paxId) — sobrevive a re-render das checkboxes
  const funcSelecionadas = {};       // produtoId -> Set(nomeVendedora) — sobrevive a re-render das checkboxes
  const pagamentosPorProduto = {};   // produtoId -> [{ id, forma, valor, dataFaturamento }] — permite dividir o pagamento em mais de uma forma
  // produtoId -> "ida" | "ida_volta" | "multitrechos" — controla quantos/quais blocos de
  // trecho aparecem no card de passagem.
  const modoPassagemPorProduto = {};
  // produtoId -> [{ id, label }] — a LISTA de trechos ativos desse produto. Em "ida" tem 1
  // (id "ida"); em "ida e volta" tem 2 fixos (ids "ida"/"volta"); em "multitrechos" tem N,
  // com id gerado, pra viagens com 3+ pernas (ex: FOR→LIS→ROM→FOR) ou ida/volta com
  // companhias tão diferentes que faz mais sentido tratar como trechos soltos.
  const trechosPorProduto = {};
  // produtoId -> { <trechoId>: [{id,trecho,companhia,voo,horario_partida,horario_chegada}] }
  const segmentosPorProduto = {};
  let emissoesSalvas = null;
  let filtroListaEmi = "data"; // "data" (padrão, lista cronológica como na planilha) ou "viagem" (agrupado)
  let filtroMesEmi = "";          // "" = todos os meses, ou "YYYY-MM"
  let filtroFuncionariaEmi = "";  // "" = todas
  let filtroTipoProdutoEmi = "";  // "" = todos os tipos
  let filtroNomeEmi = "";         // "" = todos, ou busca por nome do passageiro (sem acento/maiúscula)
  let emissaoEmEdicaoId = null; // id da emissão sendo editada, ou null se for um cadastro novo

  // ===== Rede =====
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
    try {
      const resp = await fetch("/.netlify/functions/clientes-data");
      clientesCache = resp.ok ? await resp.json() : [];
    } catch { clientesCache = []; }
  }

  async function carregarFornecedores() {
    try { fornecedoresCache = await chamarEmissoes("listar_fornecedores"); }
    catch { fornecedoresCache = []; }
  }

  async function carregarVendedores() {
    try {
      const resp = await fetch("/.netlify/functions/vendas-config");
      const cfg = resp.ok ? await resp.json() : null;
      vendedoresCache = (cfg && Array.isArray(cfg.funcs)) ? cfg.funcs : [];
    } catch { vendedoresCache = []; }
  }

  async function carregarEmpresas() {
    try { empresasCache = await chamarEmissoes("listar_empresas_nomes"); }
    catch { empresasCache = []; }
  }

  // ===== Passageiros =====
  function addPassageiroExistente(cliente) {
    const id = novoId("pax");
    passageiros.push({ id, cliente_id: cliente.id, nome: cliente.nome });
    renderPassageiros();
    produtos.forEach((p) => { paxSelecionados[p.id] = paxSelecionados[p.id] || new Set(); paxSelecionados[p.id].add(id); renderProdutoPaxChecks(p.id); });
  }

  function addPassageiroNovo() {
    const id = novoId("pax");
    passageiros.push({ id, cliente_id: null, nome: "" });
    renderPassageiros();
    produtos.forEach((p) => { paxSelecionados[p.id] = paxSelecionados[p.id] || new Set(); paxSelecionados[p.id].add(id); renderProdutoPaxChecks(p.id); });
  }

  function removePassageiro(id) {
    passageiros = passageiros.filter((p) => p.id !== id);
    Object.values(paxSelecionados).forEach((set) => set.delete(id));
    renderPassageiros();
    produtos.forEach((p) => renderProdutoPaxChecks(p.id));
  }

  function renderPassageiros() {
    const wrap = gel("emi-passageiros-list");
    if (!wrap) return;

    // Preserva o que já foi digitado nos cards existentes — sem isso, adicionar/remover
    // um passageiro reconstrói o HTML inteiro e apaga os dados dos outros já preenchidos.
    const salvos = {};
    wrap.querySelectorAll("input,select,textarea").forEach((e) => { if (e.id) salvos[e.id] = e.value; });

    if (passageiros.length === 0) {
      wrap.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum passageiro adicionado ainda</p></div>';
      return;
    }
    wrap.innerHTML = passageiros.map((p, i) => `
      <div class="orc-produto-item">
        <div class="orc-produto-header">
          <span class="orc-produto-icon">🧑</span>
          <span>Passageiro ${i + 1}${p.cliente_id ? " — " + escHtml(p.nome) : " (novo)"}</span>
          <button type="button" class="orc-produto-remove" data-remove-pax="${p.id}">✕ Remover</button>
        </div>
        <div class="orc-produto-body">
          ${p.cliente_id ? "" : `
            <div class="form__grid" style="margin-bottom:10px">
              <label class="field field--full">
                <span class="field__label">Colar dados do passageiro</span>
                <textarea class="input" rows="2" id="emi-pax-${p.id}-paste" placeholder="Cole aqui nome, CPF, passaporte etc."></textarea>
              </label>
            </div>
            <button type="button" class="btn btn--ghost btn--icon" data-pax-extrair="${p.id}" style="margin-bottom:10px">🤖 Extrair dados</button>
            <div class="form__grid">
              ${CLIENTE_CAMPOS.map((c) => `
                <label class="field"><span class="field__label">${CLIENTE_LABELS[c]}</span>
                  <input type="text" class="input" id="emi-pax-${p.id}-${c}" />
                </label>`).join("")}
            </div>
          `}
          <div class="form__grid" style="margin-top:10px">
            <label class="field"><span class="field__label">Tamanho da mala</span>
              <input type="text" class="input" id="emi-pax-${p.id}-mala" placeholder="Ex: 1 mala 23kg + bagagem de mão" />
            </label>
            <label class="field field--full"><span class="field__label">Observações / lembretes</span>
              <textarea class="input" rows="2" id="emi-pax-${p.id}-obs" placeholder="Ex: quer assento na janela, vai levar pet, refeição sem glúten..."></textarea>
            </label>
          </div>
        </div>
      </div>`).join("");

    Object.entries(salvos).forEach(([id, val]) => { const el = gel(id); if (el) el.value = val; });

    wrap.querySelectorAll("[data-remove-pax]").forEach((btn) =>
      btn.addEventListener("click", () => removePassageiro(btn.dataset.removePax)));
    wrap.querySelectorAll("[data-pax-extrair]").forEach((btn) =>
      btn.addEventListener("click", () => extrairPassageiroIA(btn.dataset.paxExtrair)));
  }

  async function extrairPassageiroIA(paxId) {
    const btn = document.querySelector(`[data-pax-extrair="${paxId}"]`);
    const texto = (gel(`emi-pax-${paxId}-paste`) || {}).value || "";
    if (!texto.trim()) { alert("Cole os dados do passageiro antes de extrair."); return; }
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
            content: `Extraia os dados do passageiro abaixo e retorne SOMENTE um JSON válido, sem texto adicional:\n\n${texto}\n\n{"nome":"","nascimento":"","rg":"","cpf":"","passaporte":"","venc_passaporte":"","email":"","telefone":"","endereco":""}`,
          }],
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }
      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");
      const ex = JSON.parse(jsonStr);
      CLIENTE_CAMPOS.forEach((c) => { const el = gel(`emi-pax-${paxId}-${c}`); if (el && ex[c]) el.value = ex[c]; });
      if (btn) { btn.disabled = false; btn.textContent = "✓ Extraído!"; setTimeout(() => { btn.textContent = "🤖 Extrair dados"; }, 2000); }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "🤖 Extrair dados"; }
      alert("Erro ao extrair: " + err.message);
    }
  }

  // ===== Busca de cliente existente =====
  function setupBuscaCliente() {
    gel("emi-add-passageiro-existente").addEventListener("click", () => {
      const wrap = gel("emi-busca-cliente-wrap");
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) { gel("emi-busca-cliente").value = ""; gel("emi-busca-cliente-resultados").innerHTML = ""; gel("emi-busca-cliente").focus(); }
    });
    gel("emi-add-passageiro-novo").addEventListener("click", addPassageiroNovo);
    gel("emi-busca-cliente").addEventListener("input", renderBuscaResultados);
  }

  function renderBuscaResultados() {
    const termo = norm(gel("emi-busca-cliente").value.trim());
    const box = gel("emi-busca-cliente-resultados");
    if (!termo) { box.innerHTML = ""; return; }
    const encontrados = clientesCache.filter((c) => norm(c.nome).includes(termo)).slice(0, 15);
    if (encontrados.length === 0) {
      box.innerHTML = '<div class="emi-busca-item" style="cursor:default;color:var(--text-muted)">Nenhum cliente encontrado</div>';
      return;
    }
    box.innerHTML = encontrados.map((c) => `<button type="button" class="emi-busca-item" data-id="${escHtml(c.id)}">${escHtml(c.nome)}</button>`).join("");
    box.querySelectorAll(".emi-busca-item[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cliente = clientesCache.find((c) => c.id === btn.dataset.id);
        if (cliente) addPassageiroExistente(cliente);
        gel("emi-busca-cliente-wrap").hidden = true;
      });
    });
  }

  // ===== Produtos =====
  function addProduto(tipo) {
    const id = novoId("prod");
    produtos.push({ id, tipo });
    paxSelecionados[id] = new Set(passageiros.map((p) => p.id));
    funcSelecionadas[id] = new Set();
    pagamentosPorProduto[id] = [novoPagamento("pix")];
    modoPassagemPorProduto[id] = "ida";
    trechosPorProduto[id] = [{ id: "ida", label: "Passagem" }];
    segmentosPorProduto[id] = { ida: [novoSegmento()] };
    renderProdutos();
  }

  function removeProduto(id) {
    produtos = produtos.filter((p) => p.id !== id);
    delete paxSelecionados[id];
    delete funcSelecionadas[id];
    delete pagamentosPorProduto[id];
    delete modoPassagemPorProduto[id];
    delete trechosPorProduto[id];
    delete segmentosPorProduto[id];
    renderProdutos();
  }

  // Troca o modo (ida / ida e volta / multitrechos) de um produto de passagem, ajustando a
  // lista de trechos ativos sem perder o que já foi digitado nos trechos que continuam
  // existindo (ex: trocar de "ida e volta" pra "multitrechos" mantém ida e volta como estão
  // e só passa a permitir adicionar mais).
  function definirModoPassagem(prodId, modo) {
    modoPassagemPorProduto[prodId] = modo;
    const atuais = trechosPorProduto[prodId] || [];

    // Reaproveita os ids dos trechos que já existiam (ex: "ida"/"volta") — o que já foi
    // digitado neles (segmentosPorProduto, campos com id) continua lá, já que nada disso é
    // apagado aqui, só a LISTA de quais trechos aparecem é que muda.
    if (modo === "ida") {
      trechosPorProduto[prodId] = [{ id: "ida", label: "Passagem" }];
    } else if (modo === "ida_volta") {
      trechosPorProduto[prodId] = [
        { id: "ida", label: "Ida" },
        { id: "volta", label: "Volta" },
      ];
    } else {
      // multitrechos: reaproveita os trechos que já existiam (relabelados "Trecho N"),
      // garante pelo menos 2 pra já vir num formato útil.
      const base = atuais.length > 0 ? atuais : [{ id: "ida" }, { id: "volta" }];
      trechosPorProduto[prodId] = base.map((t, i) => ({ id: t.id, label: "Trecho " + (i + 1) }));
    }

    renderProdutos();
  }

  function adicionarTrecho(prodId) {
    const lista = trechosPorProduto[prodId] || (trechosPorProduto[prodId] = []);
    lista.push({ id: novoId("trecho"), label: "Trecho " + (lista.length + 1) });
    renderProdutos();
  }

  function removerTrecho(prodId, trechoId) {
    const lista = trechosPorProduto[prodId];
    if (!lista || lista.length <= 1) return;
    trechosPorProduto[prodId] = lista.filter((t) => t.id !== trechoId).map((t, i) => ({ ...t, label: "Trecho " + (i + 1) }));
    delete (segmentosPorProduto[prodId] || {})[trechoId];
    renderProdutos();
  }

  function montarOptionsFornecedor(selectedId) {
    return '<option value="">— Nenhum —</option>' +
      fornecedoresCache.map((f) => `<option value="${escHtml(f.id)}" ${f.id === selectedId ? "selected" : ""}>${escHtml(f.nome)}</option>`).join("") +
      '<option value="__novo__">+ Novo fornecedor...</option>';
  }

  function montarOptionsEmpresa(selectedId) {
    return '<option value="">Selecione...</option>' +
      empresasCache.map((e) => `<option value="${escHtml(e.id)}" ${e.id === selectedId ? "selected" : ""}>${escHtml(e.nome)}</option>`).join("") +
      '<option value="__novo__">+ Nova empresa...</option>';
  }

  // "showIf" deixa um campo (ex: cidade/horário da parada) só aparecer quando outro campo
  // do mesmo produto (ex: "Parada") tiver um valor específico — genérico, não é só pro Trem.
  function campoDados(prodId, f, prefixo) {
    const idAttr = `emi-prod-${prodId}-dados-${prefixo ? prefixo + "-" : ""}${f.id}`;
    const hiddenAttr = f.showIf ? "hidden" : "";
    if (f.type === "select") {
      return `<label class="field" ${hiddenAttr}><span class="field__label">${f.label}</span>
        <select class="input" id="${idAttr}"><option value="">—</option>${f.options.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}</select>
      </label>`;
    }
    return `<label class="field" ${hiddenAttr}><span class="field__label">${f.label}</span>
      <input type="${f.type || "text"}" class="input" id="${idAttr}" ${f.step ? `step="${f.step}"` : ""} placeholder="${f.placeholder || ""}" />
    </label>`;
  }

  // Liga os campos com "showIf" às mudanças do campo que eles dependem, escondendo/
  // mostrando o próprio <label class="field"> (mesmo padrão de .field[hidden] já usado no
  // resto do formulário) — chamar depois de renderizar os campos de um produto (dados-
  // driven, fora de passagem).
  function ligarCamposCondicionais(prodId, tipo) {
    (DADOS_CFG[tipo] || []).forEach((f) => {
      if (!f.showIf) return;
      const controleEl = gel(`emi-prod-${prodId}-dados-${f.showIf.field}`);
      const campoEl = gel(`emi-prod-${prodId}-dados-${f.id}`)?.closest(".field");
      if (!controleEl || !campoEl) return;
      const atualizar = () => { campoEl.hidden = controleEl.value !== f.showIf.equals; };
      controleEl.addEventListener("change", atualizar);
      atualizar();
    });
  }

  // Passagem tem seu próprio layout: um card só, com um bloco de campos pra "Ida" e,
  // se marcado, outro pra "Volta" — pro cliente é 1 produto/1 cobrança só (ida e volta
  // juntos), mas cada perna tem seu próprio financeiro (fornecedor/custo/milhas podem ser
  // diferentes — ida e volta às vezes são compradas separadas). Dentro de cada perna, uma
  // LISTA de trechos/segmentos (não só um campo de texto) — pra mostrar cada conexão com
  // aeroporto e horário próprios, igual a companhia aérea mostra, em vez de resumir numa
  // frase.
  function novoSegmento() {
    return { id: novoId("seg"), trecho: "", companhia: "", voo: "", horario_partida: "", horario_chegada: "" };
  }

  function renderSegmentos(prodId, perna) {
    const wrap = gel(`emi-prod-${prodId}-${perna}-segmentos`);
    if (!wrap) return;
    if (!segmentosPorProduto[prodId]) segmentosPorProduto[prodId] = {};
    const lista = segmentosPorProduto[prodId][perna] || (segmentosPorProduto[prodId][perna] = [novoSegmento()]);

    wrap.innerHTML = lista.map((seg, i) => `
      <div class="orc-produto-item" style="margin-bottom:8px">
        <div class="orc-produto-header" style="padding:7px 12px">
          <span style="font-size:0.8rem;font-weight:600">Trecho ${i + 1}</span>
          ${lista.length > 1 ? `<button type="button" class="orc-produto-remove emi-seg-remover" data-seg="${seg.id}" style="margin-left:auto">✕</button>` : ""}
        </div>
        <div class="orc-produto-body" style="padding:10px 12px">
          <div class="form__grid">
            <label class="field field--full"><span class="field__label">Trecho</span>
              <input type="text" class="input emi-seg-campo" data-seg="${seg.id}" data-campo="trecho" placeholder="Ex: FOR → GRU" value="${escHtml(seg.trecho)}" />
            </label>
            <label class="field"><span class="field__label">Companhia aérea</span>
              <input type="text" class="input emi-seg-campo" data-seg="${seg.id}" data-campo="companhia" value="${escHtml(seg.companhia)}" />
            </label>
            <label class="field"><span class="field__label">Nº do voo</span>
              <input type="text" class="input emi-seg-campo" data-seg="${seg.id}" data-campo="voo" value="${escHtml(seg.voo)}" />
            </label>
            <label class="field"><span class="field__label">Horário de partida</span>
              <input type="text" class="input emi-seg-campo" data-seg="${seg.id}" data-campo="horario_partida" value="${escHtml(seg.horario_partida)}" />
            </label>
            <label class="field"><span class="field__label">Horário de chegada</span>
              <input type="text" class="input emi-seg-campo" data-seg="${seg.id}" data-campo="horario_chegada" value="${escHtml(seg.horario_chegada)}" />
            </label>
          </div>
        </div>
      </div>`).join("");

    wrap.querySelectorAll(".emi-seg-campo").forEach((inp) => {
      inp.addEventListener("input", () => {
        const seg = lista.find((s) => s.id === inp.dataset.seg);
        if (seg) seg[inp.dataset.campo] = inp.value;
      });
    });
    wrap.querySelectorAll(".emi-seg-remover").forEach((btn) => {
      btn.addEventListener("click", () => {
        segmentosPorProduto[prodId][perna] = lista.filter((s) => s.id !== btn.dataset.seg);
        renderSegmentos(prodId, perna);
      });
    });
  }

  // Financeiro — normalmente é 1 só pra passagem inteira (mesma companhia/compra), mas em
  // "multitrechos" cada trecho pode ter o seu (fornecedores/milheiros diferentes por
  // trecho), daí o "trechoId" pra saber em qual bloco os campos ficam.
  function trechoFinanceiroHtml(prodId, trechoId, titulo) {
    return `
      <div class="orc-milhas-box" style="margin-top:10px">
        <div class="orc-milhas-title">${escHtml(titulo)}</div>
        <div class="form__grid">
          <label class="field"><span class="field__label">Como foi comprada</span>
            <select class="input" id="emi-prod-${prodId}-${trechoId}-compra_tipo">
              <option value="milhas">Milhas</option>
              <option value="tarifado">Tarifado / operadora (dinheiro)</option>
            </select>
          </label>
          <label class="field" id="emi-prod-${prodId}-${trechoId}-wrap-milhas"><span class="field__label">Qtd. milhas <span class="table__muted">(informativo)</span></span>
            <input type="number" class="input" id="emi-prod-${prodId}-${trechoId}-qtd_milhas" />
          </label>
          <label class="field" id="emi-prod-${prodId}-${trechoId}-wrap-milheiro"><span class="field__label">Valor do milheiro (R$) <span class="table__muted">(informativo)</span></span>
            <input type="number" class="input" id="emi-prod-${prodId}-${trechoId}-valor_milha" step="0.01" />
          </label>
          <label class="field"><span class="field__label">💸 CUSTO — quanto NÓS pagamos (R$)</span>
            <input type="number" class="input" id="emi-prod-${prodId}-${trechoId}-custo" step="0.01" />
          </label>
          <label class="field field--full"><span class="field__label">Fornecedor (milheiro / site / operadora) ★</span>
            <select class="input emi-sel-fornecedor" id="emi-prod-${prodId}-${trechoId}-fornecedor">${montarOptionsFornecedor(null)}</select>
          </label>
        </div>
      </div>`;
  }

  function trechoUploadHtml(prodId, trechoId, hint) {
    return `
      <div class="orc-foto-zone" id="emi-prod-${prodId}-${trechoId}-fotozone" tabindex="0">
        <div class="orc-foto-hint">📎 ${hint}</div>
        <input type="file" id="emi-prod-${prodId}-${trechoId}-arquivo-input" accept="image/*,.pdf" hidden />
      </div>
      <div style="display:flex;justify-content:center;margin:6px 0 10px">
        <button type="button" id="emi-prod-${prodId}-${trechoId}-btn-arquivo" class="btn btn--ghost" style="font-size:0.78rem">📎 Selecionar arquivo (imagem ou PDF)</button>
      </div>`;
  }

  // comFinanceiroEArquivo: false pra "ida e volta" da MESMA compra — nesse caso o upload e
  // o financeiro ficam só uma vez (no trecho "ida", compartilhado pros dois), porque é uma
  // reserva só, lida de um documento só. Só fica true por trecho no modo "multitrechos",
  // onde cada trecho pode ter vindo de uma compra/companhia diferente.
  function trechoFormHtml(prodId, trechoId, label, removivel, comFinanceiroEArquivo) {
    return `
      <div class="orc-cost-divider" style="margin:8px 0"><span>${escHtml(label)}</span>${removivel ? `<button type="button" class="orc-produto-remove emi-trecho-remover" data-trecho="${trechoId}" style="margin-left:auto">✕ Remover trecho</button>` : ""}</div>
      <label class="field field--full"><span class="field__label">Localizador / código</span>
        <input type="text" class="input" id="emi-prod-${prodId}-loc-${trechoId}" />
      </label>
      <div id="emi-prod-${prodId}-${trechoId}-segmentos"></div>
      <button type="button" class="btn btn--ghost" id="emi-prod-${prodId}-${trechoId}-add-seg" style="margin:2px 0 10px;font-size:0.76rem">+ Adicionar conexão/escala neste trecho</button>

      ${comFinanceiroEArquivo ? trechoUploadHtml(prodId, trechoId, "Cole aqui (Ctrl+V) ou arraste o print/arquivo deste trecho pra IA ler os dados") : ""}

      <label class="field field--full"><span class="field__label">Bagagem (franquia deste trecho)</span>
        <input type="text" class="input" id="emi-prod-${prodId}-${trechoId}-bagagem" placeholder="Ex: 1 despachada 23kg + 1 de mão 10kg" />
      </label>
      <label class="field field--full"><span class="field__label">Observações importantes (uma por linha — aparecem no comprovante do cliente)</span>
        <textarea class="input" rows="2" id="emi-prod-${prodId}-${trechoId}-observacoes" placeholder="Ex: Tarifa Light, sem direito a reembolso. Remarcação com multa de R$ 300."></textarea>
      </label>
      ${comFinanceiroEArquivo ? trechoFinanceiroHtml(prodId, trechoId, "Financeiro deste trecho") : ""}`;
  }

  function passagemCamposHtml(prodId) {
    const modo = modoPassagemPorProduto[prodId] || "ida";
    const trechos = trechosPorProduto[prodId] || [];
    const modos = [
      { v: "ida", l: "Somente ida" },
      { v: "ida_volta", l: "Ida e volta" },
      { v: "multitrechos", l: "Múltiplos trechos" },
    ];
    return `
      <div class="form__grid" style="margin-bottom:10px">
        <label class="field field--full"><span class="field__label">Tipo de passagem</span>
          <select class="input emi-modo-passagem" id="emi-prod-${prodId}-modo" data-prod="${prodId}">
            ${modos.map((m) => `<option value="${m.v}" ${m.v === modo ? "selected" : ""}>${m.l}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="table__muted" style="font-size:0.76rem;margin:-4px 0 10px">
        ${modo === "ida" ? "Um trecho só, sem volta." : modo === "ida_volta"
          ? "Ida e volta da mesma compra/companhia — cole o bilhete uma vez, a IA lê os dois trechos automaticamente."
          : "Quantos trechos precisar, cada um com seu próprio arquivo e financeiro — útil pra ida/volta com bilhetes bem separados (companhias diferentes) ou roteiros com 3+ paradas (ex: FOR → LIS → ROM → FOR)."}
      </div>
      <div id="emi-prod-${prodId}-trechos-wrap">
        ${trechos.map((t) => trechoFormHtml(prodId, t.id, t.label, modo === "multitrechos" && trechos.length > 1, modo !== "ida_volta")).join("")}
      </div>
      ${modo === "ida_volta" ? `
        ${trechoUploadHtml(prodId, "ida", "Cole aqui (Ctrl+V) ou arraste o bilhete — se mostrar ida e volta juntas, os dois trechos acima são preenchidos automaticamente")}
        ${trechoFinanceiroHtml(prodId, "ida", "Financeiro (ida e volta)")}
      ` : ""}
      ${modo === "multitrechos" ? `<button type="button" class="btn btn--ghost" id="emi-prod-${prodId}-add-trecho" style="margin:4px 0 10px;font-size:0.78rem">+ Adicionar trecho</button>` : ""}
      <div class="form__grid" style="margin-top:10px">
        <label class="field"><span class="field__label">Taxa de embarque total (R$, informativo)</span>
          <input type="number" class="input" id="emi-prod-${prodId}-dados-taxa_embarque" step="0.01" />
        </label>
      </div>`;
  }

  function renderProdutoPaxChecks(prodId) {
    const box = gel(`emi-prod-${prodId}-pax-checks`);
    if (!box) return;
    const selecionados = paxSelecionados[prodId] || new Set();
    if (passageiros.length === 0) {
      box.innerHTML = '<span class="table__muted">Adicione passageiros acima primeiro</span>';
      return;
    }
    box.innerHTML = passageiros.map((p, i) => `
      <label style="display:inline-flex;align-items:center;gap:5px;margin:0 14px 6px 0;font-size:0.85rem">
        <input type="checkbox" id="emi-prod-${prodId}-pax-${p.id}" ${selecionados.has(p.id) ? "checked" : ""} />
        ${p.cliente_id ? escHtml(p.nome) : "Passageiro " + (i + 1) + " (novo)"}
      </label>`).join("");
    box.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const paxId = cb.id.replace(`emi-prod-${prodId}-pax-`, "");
        if (!paxSelecionados[prodId]) paxSelecionados[prodId] = new Set();
        if (cb.checked) paxSelecionados[prodId].add(paxId); else paxSelecionados[prodId].delete(paxId);
      });
    });
  }

  // Lista das mesmas vendedoras cadastradas em Vendas → Metas — evita nome digitado
  // diferente do nome usado no cálculo de comissão/meta (ex: "Thaynara" vs "Thay").
  function renderProdutoFuncChecks(prodId) {
    const box = gel(`emi-prod-${prodId}-func-checks`);
    if (!box) return;
    const selecionadas = funcSelecionadas[prodId] || new Set();
    if (vendedoresCache.length === 0) {
      box.innerHTML = '<span class="table__muted">Nenhuma vendedora cadastrada ainda — cadastre em Vendas → Metas</span>';
      return;
    }
    box.innerHTML = vendedoresCache.map((f, i) => `
      <label style="display:inline-flex;align-items:center;gap:5px;margin:0 14px 6px 0;font-size:0.85rem">
        <input type="checkbox" id="emi-prod-${prodId}-func-${i}" ${selecionadas.has(f.nome) ? "checked" : ""} />
        ${escHtml(f.nome)}
      </label>`).join("");
    vendedoresCache.forEach((f, i) => {
      const cb = gel(`emi-prod-${prodId}-func-${i}`);
      if (!cb) return;
      cb.addEventListener("change", () => {
        if (!funcSelecionadas[prodId]) funcSelecionadas[prodId] = new Set();
        if (cb.checked) funcSelecionadas[prodId].add(f.nome); else funcSelecionadas[prodId].delete(f.nome);
      });
    });
  }

  // ===== Formas de pagamento (divide o valor total em quantas formas precisar) =====
  function novoPagamento(forma) {
    return { id: novoId("pag"), forma: forma || "pix", valor: null, dataFaturamento: null };
  }

  function somaPagamentos(prodId) {
    return (pagamentosPorProduto[prodId] || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
  }

  function atualizarValorTotalDisplay(prodId) {
    const el = gel(`emi-prod-${prodId}-valor-total-display`);
    if (el) el.textContent = fBRL(somaPagamentos(prodId));
  }

  function renderProdutoPagamentos(prodId) {
    const wrap = gel(`emi-prod-${prodId}-pagamentos-list`);
    if (!wrap) return;
    const lista = pagamentosPorProduto[prodId] || (pagamentosPorProduto[prodId] = [novoPagamento("pix")]);

    wrap.innerHTML = lista.map((pag) => `
      <div class="emi-pagamento-row">
        <select class="input emi-pag-forma" data-pag="${pag.id}">
          ${FORMAS_PAGAMENTO.map((f) => `<option value="${f.v}" ${f.v === pag.forma ? "selected" : ""}>${f.l}</option>`).join("")}
        </select>
        <input type="number" class="input emi-pag-valor" data-pag="${pag.id}" step="0.01" placeholder="Valor (R$)" value="${pag.valor != null ? pag.valor : ""}" />
        <input type="date" class="input emi-pag-data" data-pag="${pag.id}" ${pag.forma === "faturado" ? "" : "hidden"} value="${pag.dataFaturamento || ""}" />
        ${lista.length > 1 ? `<button type="button" class="orc-produto-remove emi-pag-remover" data-pag="${pag.id}" title="Remover">✕</button>` : ""}
      </div>`).join("");

    wrap.querySelectorAll(".emi-pag-forma").forEach((sel) => {
      sel.addEventListener("change", () => {
        const pag = lista.find((p) => p.id === sel.dataset.pag);
        if (pag) pag.forma = sel.value;
        renderProdutoPagamentos(prodId); // re-render pra mostrar/esconder a data de faturamento
      });
    });
    wrap.querySelectorAll(".emi-pag-valor").forEach((inp) => {
      inp.addEventListener("input", () => {
        const pag = lista.find((p) => p.id === inp.dataset.pag);
        if (pag) pag.valor = parseFloat(inp.value) || null;
        atualizarValorTotalDisplay(prodId);
      });
    });
    wrap.querySelectorAll(".emi-pag-data").forEach((inp) => {
      inp.addEventListener("change", () => {
        const pag = lista.find((p) => p.id === inp.dataset.pag);
        if (pag) pag.dataFaturamento = inp.value || null;
      });
    });
    wrap.querySelectorAll(".emi-pag-remover").forEach((btn) => {
      btn.addEventListener("click", () => {
        pagamentosPorProduto[prodId] = lista.filter((p) => p.id !== btn.dataset.pag);
        renderProdutoPagamentos(prodId);
      });
    });

    atualizarValorTotalDisplay(prodId);
  }

  function renderProdutos() {
    const wrap = gel("emi-produtos-list");
    if (!wrap) return;

    // Preserva o que já foi digitado nos cards existentes — sem isso, adicionar/remover
    // um produto reconstrói o HTML inteiro e apaga os dados dos outros já preenchidos
    // (foi o que aconteceu com o "trecho da volta": ao adicionar o 2º card de passagem,
    // o 1º perdia os dados). Exclui inputs de arquivo: navegador nunca deixa restaurar o
    // valor de um <input type="file"> por script (só aceita voltar pra vazio) — tentar
    // atribuir o valor antigo lança um erro que interrompe o "forEach" no meio, deixando
    // TODOS os campos seguintes (ex: custo/milhas/fornecedor, que vêm depois do campo de
    // arquivo no HTML) sem ser restaurados. Isso já causou exatamente esse sintoma.
    const salvos = {};
    wrap.querySelectorAll("input:not([type=file]),select,textarea").forEach((e) => { if (e.id) salvos[e.id] = e.value; });

    if (produtos.length === 0) {
      wrap.innerHTML = '<div class="empty-state empty-state--compact"><p>Nenhum produto adicionado ainda</p></div>';
      return;
    }

    wrap.innerHTML = produtos.map((prod) => {
      const isPassagem = prod.tipo === "passagem";
      const dadosSecaoHtml = isPassagem
        ? passagemCamposHtml(prod.id)
        : `<div class="form__grid">${(DADOS_CFG[prod.tipo] || []).map((f) => campoDados(prod.id, f)).join("")}</div>`;

      return `
      <div class="orc-produto-item">
        <div class="orc-produto-header">
          <span class="orc-produto-icon">${PROD_ICON[prod.tipo]}</span>
          <span>${PROD_LABEL[prod.tipo]}</span>
          <button type="button" class="orc-produto-remove" data-remove-prod="${prod.id}">✕ Remover</button>
        </div>
        <div class="orc-produto-body">

          <div class="orc-extras-label">Passageiros cobertos por esta linha</div>
          <div id="emi-prod-${prod.id}-pax-checks" style="margin-bottom:12px"></div>

          ${dadosSecaoHtml}

          ${prod.tipo === "hospedagem" || prod.tipo === "trem" ? `<div class="orc-foto-zone" id="emi-prod-${prod.id}-fotozone" tabindex="0">
            <div class="orc-foto-hint">📎 Cole aqui (Ctrl+V) ou arraste um print/arquivo ${prod.tipo === "hospedagem" ? "da reserva do hotel" : "do bilhete de trem"} pra IA ler os dados</div>
            <input type="file" id="emi-prod-${prod.id}-arquivo-input" accept="image/*,.pdf" hidden />
          </div>
          <div style="display:flex;justify-content:center;margin:6px 0 10px">
            <button type="button" id="emi-prod-${prod.id}-btn-arquivo" class="btn btn--ghost" style="font-size:0.78rem">📎 Selecionar arquivo (imagem ou PDF)</button>
          </div>` : ""}

          <div class="orc-milhas-box">
            <div class="orc-milhas-title">${isPassagem ? "Cobrança do cliente" : "Financeiro"}</div>
            <div class="form__grid">
              ${isPassagem ? "" : `
                <label class="field"><span class="field__label">💸 CUSTO — quanto NÓS pagamos (R$)</span>
                  <input type="number" class="input" id="emi-prod-${prod.id}-custo" step="0.01" />
                </label>
                <label class="field"><span class="field__label">Fornecedor (milheiro / site / operadora) ★</span>
                  <select class="input emi-sel-fornecedor" id="emi-prod-${prod.id}-fornecedor">${montarOptionsFornecedor(null)}</select>
                </label>
              `}
              <label class="field field--full orc-field--highlight"><span class="field__label">💰 VALOR COBRADO DO CLIENTE — total (soma das formas de pagamento abaixo) (R$) ★</span>
                <div class="emi-valor-total-display" id="emi-prod-${prod.id}-valor-total-display">R$ 0,00</div>
              </label>
              <div class="field field--full">
                <span class="field__label">Formas de pagamento ★</span>
                <div id="emi-prod-${prod.id}-pagamentos-list"></div>
                <button type="button" class="btn btn--ghost" id="emi-prod-${prod.id}-add-pagamento" style="margin-top:6px;font-size:0.78rem">+ Adicionar forma de pagamento</button>
              </div>
              <label class="field"><span class="field__label">Origem do lead ★</span>
                <select class="input" id="emi-prod-${prod.id}-origem_lead">
                  <option value="">Selecione...</option>
                  ${ORIGENS_LEAD.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join("")}
                </select>
              </label>
              <label class="field" id="emi-prod-${prod.id}-empresa-wrap" hidden>
                <span class="field__label">Empresa ★</span>
                <select class="input emi-sel-empresa" id="emi-prod-${prod.id}-empresa_id">${montarOptionsEmpresa(null)}</select>
              </label>
            </div>

            <div class="orc-extras-label" style="margin-top:10px">Funcionária responsável</div>
            <div id="emi-prod-${prod.id}-func-checks"></div>
          </div>
        </div>
      </div>`;
    }).join("");

    // Restaura os valores antes de religar os listeners abaixo, pra os toggles (milhas x
    // tarifado, forma de pagamento faturada) partirem já do valor certo. "__novo__" é só o
    // valor-gatilho do "+ Novo fornecedor..." — nunca pode ficar selecionado depois de um
    // re-render, senão vira o texto literal "__novo__" no lugar de um uuid ao salvar.
    Object.entries(salvos).forEach(([id, val]) => { if (val === "__novo__") return; const el = gel(id); if (el) el.value = val; });

    produtos.forEach((prod) => {
      const isPassagem = prod.tipo === "passagem";
      renderProdutoPaxChecks(prod.id);
      renderProdutoFuncChecks(prod.id);

      const removeBtn = document.querySelector(`[data-remove-prod="${prod.id}"]`);
      if (removeBtn) removeBtn.addEventListener("click", () => removeProduto(prod.id));

      const modoEl = gel(`emi-prod-${prod.id}-modo`);
      if (modoEl) {
        modoEl.addEventListener("change", () => definirModoPassagem(prod.id, modoEl.value));
      }
      const addTrechoBtn = gel(`emi-prod-${prod.id}-add-trecho`);
      if (addTrechoBtn) addTrechoBtn.addEventListener("click", () => adicionarTrecho(prod.id));

      if (isPassagem) {
        (trechosPorProduto[prod.id] || []).forEach(({ id: perna }) => {
          renderSegmentos(prod.id, perna);
          const addSegBtn = gel(`emi-prod-${prod.id}-${perna}-add-seg`);
          if (addSegBtn) {
            addSegBtn.addEventListener("click", () => {
              if (!segmentosPorProduto[prod.id]) segmentosPorProduto[prod.id] = {};
              if (!segmentosPorProduto[prod.id][perna]) segmentosPorProduto[prod.id][perna] = [];
              segmentosPorProduto[prod.id][perna].push(novoSegmento());
              renderSegmentos(prod.id, perna);
            });
          }

          const removerTrechoBtn = document.querySelector(`.emi-trecho-remover[data-trecho="${perna}"]`);
          if (removerTrechoBtn) removerTrechoBtn.addEventListener("click", () => removerTrecho(prod.id, perna));

          const compraTipoEl = gel(`emi-prod-${prod.id}-${perna}-compra_tipo`);
          if (compraTipoEl) {
            const atualizarCompraTipo = () => {
              const milhas = compraTipoEl.value === "milhas";
              gel(`emi-prod-${prod.id}-${perna}-wrap-milhas`).hidden = !milhas;
              gel(`emi-prod-${prod.id}-${perna}-wrap-milheiro`).hidden = !milhas;
              // "Custo" fica sempre visível: mesmo comprando com milhas, o custo é digitado
              // à mão (pode ter ajuste com o milheiro, taxa de embarque etc.) — não é mais
              // calculado automaticamente a partir de qtd. milhas × valor do milheiro.
            };
            compraTipoEl.addEventListener("change", atualizarCompraTipo);
            atualizarCompraTipo();
          }

          const fornecedorPernaEl = gel(`emi-prod-${prod.id}-${perna}-fornecedor`);
          if (fornecedorPernaEl) {
            fornecedorPernaEl.addEventListener("change", async () => {
              if (fornecedorPernaEl.value !== "__novo__") return;
              const nome = prompt("Nome do novo fornecedor (milheiro/site/operadora):");
              if (!nome || !nome.trim()) { fornecedorPernaEl.value = ""; return; }
              try {
                const [criado] = await chamarEmissoes("criar_fornecedor", { nome: nome.trim() });
                fornecedoresCache.push(criado);
                document.querySelectorAll(".emi-sel-fornecedor").forEach((sel) => {
                  const valorAtual = sel === fornecedorPernaEl ? criado.id : sel.value;
                  sel.innerHTML = montarOptionsFornecedor(valorAtual);
                });
              } catch (err) {
                alert("Erro ao criar fornecedor: " + err.message);
                fornecedorPernaEl.value = "";
              }
            });
          }

          wireFotoZone(
            gel(`emi-prod-${prod.id}-${perna}-fotozone`),
            gel(`emi-prod-${prod.id}-${perna}-arquivo-input`),
            gel(`emi-prod-${prod.id}-${perna}-btn-arquivo`),
            (imageSrc, zone) => analisarDocumento(prod.id, "passagem", imageSrc, zone, perna)
          );
        });
      }

      renderProdutoPagamentos(prod.id);
      const addPagamentoBtn = gel(`emi-prod-${prod.id}-add-pagamento`);
      if (addPagamentoBtn) {
        addPagamentoBtn.addEventListener("click", () => {
          if (!pagamentosPorProduto[prod.id]) pagamentosPorProduto[prod.id] = [];
          pagamentosPorProduto[prod.id].push(novoPagamento("pix"));
          renderProdutoPagamentos(prod.id);
        });
      }

      const fornecedorEl = gel(`emi-prod-${prod.id}-fornecedor`);
      if (fornecedorEl) {
        fornecedorEl.addEventListener("change", async () => {
          if (fornecedorEl.value !== "__novo__") return;
          const nome = prompt("Nome do novo fornecedor (milheiro/site/operadora):");
          if (!nome || !nome.trim()) { fornecedorEl.value = ""; return; }
          try {
            const [criado] = await chamarEmissoes("criar_fornecedor", { nome: nome.trim() });
            fornecedoresCache.push(criado);
            document.querySelectorAll(".emi-sel-fornecedor").forEach((sel) => {
              const valorAtual = sel === fornecedorEl ? criado.id : sel.value;
              sel.innerHTML = montarOptionsFornecedor(valorAtual);
            });
          } catch (err) {
            alert("Erro ao criar fornecedor: " + err.message);
            fornecedorEl.value = "";
          }
        });
      }

      const empresaEl = gel(`emi-prod-${prod.id}-empresa_id`);
      if (empresaEl) {
        empresaEl.addEventListener("change", async () => {
          if (empresaEl.value !== "__novo__") return;
          const nome = prompt("Nome da nova empresa:");
          if (!nome || !nome.trim()) { empresaEl.value = ""; return; }
          try {
            const [criada] = await chamarEmissoes("criar_empresa", { nome: nome.trim() });
            empresasCache.push(criada);
            document.querySelectorAll(".emi-sel-empresa").forEach((sel) => {
              const valorAtual = sel === empresaEl ? criada.id : sel.value;
              sel.innerHTML = montarOptionsEmpresa(valorAtual);
            });
          } catch (err) {
            alert("Erro ao criar empresa: " + err.message);
            empresaEl.value = "";
          }
        });
      }

      if (prod.tipo === "hospedagem" || prod.tipo === "trem") {
        wireFotoZone(
          gel(`emi-prod-${prod.id}-fotozone`),
          gel(`emi-prod-${prod.id}-arquivo-input`),
          gel(`emi-prod-${prod.id}-btn-arquivo`),
          (imageSrc, zone) => analisarDocumento(prod.id, prod.tipo, imageSrc, zone)
        );
      }

      // O seletor de empresa só faz sentido pra venda corporativa — some pros outros casos.
      const origemLeadEl  = gel(`emi-prod-${prod.id}-origem_lead`);
      const empresaWrapEl = gel(`emi-prod-${prod.id}-empresa-wrap`);
      if (origemLeadEl && empresaWrapEl) {
        const atualizarVisibilidadeEmpresa = () => { empresaWrapEl.hidden = origemLeadEl.value !== "Corporativo"; };
        origemLeadEl.addEventListener("change", atualizarVisibilidadeEmpresa);
        atualizarVisibilidadeEmpresa();
      }

      if (prod.tipo !== "passagem") ligarCamposCondicionais(prod.id, prod.tipo);
    });
  }

  // Netlify Functions recusa (HTTP 413) requisições acima de ~6MB — um print de tela em
  // resolução alta (retina, PNG) facilmente passa disso em base64. Redimensiona pro maior
  // lado caber em FOTO_MAX_DIM e reexporta como JPEG antes de mandar pra IA; o texto do
  // bilhete continua perfeitamente legível nesse tamanho.
  const FOTO_MAX_DIM = 1800;
  const FOTO_JPEG_QUALIDADE = 0.85;

  function redimensionarImagem(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, FOTO_MAX_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala);
        const h = Math.round(img.height * escala);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", FOTO_JPEG_QUALIDADE));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a imagem")); };
      img.src = url;
    });
  }

  // Liga colar/arrastar/clicar-pra-selecionar numa zona de upload, chamando onFile(dataUrl,
  // zone) quando um arquivo chega por qualquer um dos três caminhos.
  function wireFotoZone(zone, arquivoInput, btnArquivo, onFile) {
    if (!zone) return;
    const carregarArquivo = async (file) => {
      if (!file) return;
      if (file.type.startsWith("image/")) {
        try {
          onFile(await redimensionarImagem(file), zone);
          return;
        } catch { /* se falhar o redimensionamento, cai pro caminho normal abaixo */ }
      }
      const r = new FileReader();
      r.onload = (ev) => onFile(ev.target.result, zone);
      r.readAsDataURL(file);
    };

    zone.addEventListener("paste", (e) => {
      for (const item of (e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) { carregarArquivo(item.getAsFile()); break; }
      }
    });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("dragover");
      carregarArquivo(e.dataTransfer?.files?.[0]);
    });

    if (btnArquivo && arquivoInput) {
      btnArquivo.addEventListener("click", () => arquivoInput.click());
      arquivoInput.addEventListener("change", () => carregarArquivo(arquivoInput.files?.[0]));
    }
  }

  // Lê "dados" de um produto de passagem já salvo e devolve { modo, trechos } no formato
  // novo (lista), aceitando tanto o formato atual (dados.trechos) quanto o antigo (dados.
  // ida/dados.volta, de antes de existir "multitrechos" e financeiro por trecho — nesse
  // caso o financeiro cai todo no 1º trecho, igual funcionava antes).
  function normalizarTrechosPassagem(p) {
    const d = p.dados || {};
    if (Array.isArray(d.trechos) && d.trechos.length > 0) {
      return { modo: d.modo || (d.trechos.length > 1 ? "ida_volta" : "ida"), trechos: d.trechos };
    }
    const idaObj = d.ida || d;
    const trechos = [{
      id: "ida", label: d.volta ? "Ida" : "Passagem",
      localizador: idaObj.localizador, segmentos: idaObj.segmentos, bagagem: idaObj.bagagem, observacoes: idaObj.observacoes,
      financeiro: idaObj.financeiro || { fornecedor_id: p.fornecedor_id, valor_milha: p.valor_milha, qtd_milhas: p.qtd_milhas, custo: p.custo },
    }];
    if (d.volta) {
      trechos.push({
        id: "volta", label: "Volta",
        localizador: d.volta.localizador, segmentos: d.volta.segmentos, bagagem: d.volta.bagagem, observacoes: d.volta.observacoes,
        financeiro: d.volta.financeiro || null,
      });
    }
    return { modo: d.volta ? "ida_volta" : "ida", trechos };
  }

  // ===== Leitura de print por IA (passagem / hospedagem) =====
  // prefixo: "ida" ou "volta" — os dois trechos ficam no mesmo card de passagem.
  // Aplica os dados extraídos pela IA numa perna (ida ou volta): localizador + a lista de
  // trechos/segmentos inteira (substitui o que já tinha, já que veio de uma leitura nova).
  function aplicarPernaExtraida(prodId, perna, ex) {
    const locEl = gel(`emi-prod-${prodId}-loc-${perna}`);
    if (locEl && ex.localizador) locEl.value = ex.localizador;

    const segs = (Array.isArray(ex.segmentos) && ex.segmentos.length > 0)
      ? ex.segmentos.map((s) => ({
          id: novoId("seg"),
          trecho: s.trecho || "", companhia: s.companhia || "", voo: s.voo || "",
          horario_partida: s.horario_partida || "", horario_chegada: s.horario_chegada || "",
        }))
      : [novoSegmento()];

    if (!segmentosPorProduto[prodId]) segmentosPorProduto[prodId] = {};
    segmentosPorProduto[prodId][perna] = segs;
    renderSegmentos(prodId, perna);

    const bagagemEl = gel(`emi-prod-${prodId}-${perna}-bagagem`);
    if (bagagemEl && ex.bagagem) bagagemEl.value = ex.bagagem;
    const obsEl = gel(`emi-prod-${prodId}-${perna}-observacoes`);
    if (obsEl && ex.observacoes) obsEl.value = ex.observacoes;

    const milhas = Number(ex.milhas) || 0;
    if (milhas > 0) { const el = gel(`emi-prod-${prodId}-${perna}-qtd_milhas`); if (el) el.value = milhas; }
  }

  // pernaAlvo (só passagem): "ida" (padrão) ou "volta" — qual zona recebeu o arquivo.
  // Upload feito na zona da volta é tratado como um bilhete separado só dessa perna (ida e
  // volta às vezes são compradas em companhias diferentes, cada uma com seu próprio
  // documento) — não mexe na ida nem olha um eventual "volta" aninhado na resposta.
  async function analisarDocumento(prodId, tipo, imageSrc, zone, pernaAlvo) {
    const match = imageSrc.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    const [, mime, b64] = match;
    const hintEl = zone.querySelector(".orc-foto-hint");
    if (hintEl) hintEl.textContent = "⏳ Analisando...";

    const prompt = tipo === "passagem"
      ? `${contextoDataAtual()}\n\nAnalise este documento/print de passagem aérea com atenção a TODA a tabela de itinerário/voos, que pode ter mais de uma linha. Bilhetes oficiais de companhia aérea (LATAM, GOL, Azul etc.) costumam listar TODOS os voos da reserva numa única tabela "Itinerário", uma linha por trecho, SEM escrever "IDA"/"VOLTA"/"CONEXÃO" em lugar nenhum — você precisa agrupar as linhas em até duas viagens (ida e, se houver, volta) pela sequência de origem/destino:\n\n- Linhas que se ENCADEIAM na mesma direção (destino de uma linha = origem da próxima) são TRECHOS DA MESMA VIAGEM, com conexão/escala no aeroporto onde encadeiam. Exemplo real: "Roma → São Paulo" seguida de "São Paulo → Fortaleza" são 2 trechos da MESMA viagem de ida (escala em São Paulo) — NÃO é ida e volta.\n- Se em algum ponto a sequência INVERTE e volta pro ponto de partida original, dali em diante são os trechos da VOLTA (pode ter 1 ou mais trechos também). Exemplo real: "Fortaleza → Lisboa" é a ida; se depois tiver "Lisboa → Fortaleza", isso é a volta.\n\nColoque CADA linha da tabela como um item separado dentro do array "segmentos" da perna correspondente (ida ou volta) — não resuma trechos com escala num só, a funcionária quer ver o aeroporto e horário de CADA trecho, igual a companhia mostra. Na dúvida se é conexão ou volta, trate como conexão (tudo dentro de "segmentos" da ida, "volta": null) — é pior assumir uma volta que não existe.\n\nRetorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "localizador": "código/localizador da reserva (da ida), ou null",\n  "segmentos": [\n    { "trecho": "SIGLA_ORIGEM → SIGLA_DESTINO", "companhia": "nome da companhia aérea", "voo": "número do voo", "horario_partida": "HH:MM", "horario_chegada": "HH:MM ou HH:MM (+1)" }\n  ],\n  "milhas": número_inteiro_ou_null,\n  "taxa_embarque": valor_numerico_em_reais_ou_null,\n  "bagagem": "descrição completa da franquia de bagagem desta perna (cabine e despachada), ou null se não aparecer",\n  "observacoes": "outras informações relevantes da tarifa desta perna (tipo de tarifa, número da passagem, regras de remarcação/reembolso), uma por linha, ou null",\n  "volta": {\n    "localizador": "código da volta, ou null (repita o da ida se for o mesmo PNR)",\n    "segmentos": [ { "trecho": "...", "companhia": "...", "voo": "...", "horario_partida": "...", "horario_chegada": "..." } ],\n    "milhas": número_inteiro_ou_null, "taxa_embarque": valor_numerico_em_reais_ou_null,\n    "bagagem": "idem, mas da volta, ou null", "observacoes": "idem, mas da volta, ou null"\n  } OU null — preencha SOMENTE se for genuinamente ida e volta pela regra acima. Uma viagem só de ida com escala continua com "volta": null, só que "segmentos" da ida vai ter mais de um item.\n}`
      : tipo === "trem"
      ? `${contextoDataAtual()}\n\nAnalise este documento/print de passagem de trem. Se houver troca de trem/baldeação no meio do trajeto (mais de um trecho), preencha "tem_parada" e os campos da parada com o PRIMEIRO ponto de troca. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "trecho": "CIDADE_ORIGEM → CIDADE_DESTINO (origem e destino finais da viagem)",\n  "companhia": "nome da companhia ferroviária (ex: SNCF, Trenitalia, Eurostar), ou null",\n  "data_viagem": "AAAA-MM-DD ou null",\n  "horario_partida": "HH:MM ou null",\n  "horario_chegada": "HH:MM ou null",\n  "tem_parada": true se o trajeto tiver alguma parada/baldeação/troca de trem no meio, false se for direto, ou null se não for possível saber,\n  "cidade_parada": "cidade onde troca de trem, se tem_parada for true, ou null",\n  "horario_parada": "horário da parada/conexão, se tem_parada for true, ou null",\n  "localizador": "código/localizador da reserva, ou null"\n}`
      : `${contextoDataAtual()}\n\nAnalise este print de reserva/confirmação de hotel ou pousada. Retorne SOMENTE um JSON válido, sem nenhum texto adicional:\n{\n  "hotel": "nome do hotel/pousada",\n  "regime": "uma destas opções, exatamente como escrito: ${DADOS_CFG.hospedagem[1].options.map((o) => `\"${o}\"`).join(", ")} — ou null se não estiver claro",\n  "checkin": "AAAA-MM-DD ou null",\n  "checkout": "AAAA-MM-DD ou null",\n  "localizador": "código/localizador/número de confirmação da reserva, ou null se não aparecer",\n  "custo": valor_numerico_total_em_reais_ou_null\n}`;

    const content = mime === "application/pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: prompt }]
      : [{ type: "image", source: { type: "base64", media_type: mime || "image/png", data: b64 } }, { type: "text", text: prompt }];

    try {
      const resp = await fetch("/.netlify/functions/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          messages: [{ role: "user", content }],
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error?.message || "Erro HTTP " + resp.status); }
      const data = await resp.json();
      const jsonStr = extractJson(data.content?.[0]?.text || "");
      if (!jsonStr) throw new Error("Resposta inesperada da IA");
      const ex = JSON.parse(jsonStr);

      let zonaFinal = pernaAlvo || "ida";

      if (tipo === "passagem") {
        const modoAtual = modoPassagemPorProduto[prodId] || "ida";
        // O auto-split "um documento mostrando ida e volta juntas" só faz sentido quando o
        // upload foi feito na zona da ida, num produto ainda em modo "ida" ou "ida e volta"
        // (2 pernas fixas) — em multitrechos cada zona já é um trecho explícito, então cada
        // upload preenche só aquele trecho, sem tentar adivinhar mais nada.
        const podeAutoExpandir = zonaFinal === "ida" && modoAtual !== "multitrechos" && ex.volta && typeof ex.volta === "object";

        aplicarPernaExtraida(prodId, zonaFinal, ex);

        if (podeAutoExpandir) {
          // Print único mostrando ida e volta juntas (reserva round-trip): garante que o
          // trecho de volta existe e preenche com o que veio aninhado em "ex.volta". É a
          // mesma compra/companhia, então o financeiro continua compartilhado (1 só) — as
          // milhas dos dois trechos entram somadas no campo único da ida.
          if (modoAtual === "ida") definirModoPassagem(prodId, "ida_volta");
          aplicarPernaExtraida(prodId, "volta", ex.volta);
          const milhasTotal = (Number(ex.milhas) || 0) + (Number(ex.volta.milhas) || 0);
          if (milhasTotal > 0) { const el = gel(`emi-prod-${prodId}-ida-qtd_milhas`); if (el) el.value = milhasTotal; }
        }

        if (zonaFinal === "ida" || zonaFinal === trechosPorProduto[prodId]?.[0]?.id) {
          const taxaEl = gel(`emi-prod-${prodId}-dados-taxa_embarque`);
          if (taxaEl && ex.taxa_embarque != null) taxaEl.value = ex.taxa_embarque;
        }
      } else if (tipo === "trem") {
        const fill = (campo, val) => { const el = gel(`emi-prod-${prodId}-dados-${campo}`); if (el && val != null && val !== "") el.value = val; };
        fill("trecho", ex.trecho);
        fill("companhia", ex.companhia);
        fill("data_viagem", ex.data_viagem);
        fill("horario_partida", ex.horario_partida);
        fill("horario_chegada", ex.horario_chegada);
        const temParadaEl = gel(`emi-prod-${prodId}-dados-tem_parada`);
        if (temParadaEl && ex.tem_parada != null) {
          temParadaEl.value = ex.tem_parada ? "Com parada" : "Direto";
          temParadaEl.dispatchEvent(new Event("change"));
        }
        fill("cidade_parada", ex.cidade_parada);
        fill("horario_parada", ex.horario_parada);
        fill("localizador", ex.localizador);
      } else {
        const fill = (campo, val) => { const el = gel(`emi-prod-${prodId}-dados-${campo}`); if (el && val != null && val !== "") el.value = val; };
        fill("hotel", ex.hotel);
        if (ex.regime && DADOS_CFG.hospedagem[1].options.includes(ex.regime)) fill("regime", ex.regime);
        fill("checkin", ex.checkin); fill("checkout", ex.checkout);
        fill("localizador", ex.localizador);
        if (ex.custo != null) { const el = gel(`emi-prod-${prodId}-custo`); if (el) el.value = ex.custo; }
      }
      // Reconsulta a zona/hint pelo id — se detectou volta, o "voltaWrap" pode ter acabado
      // de ficar visível, então o "zone"/"hintEl" capturados no início continuam válidos
      // pra passagem (é sempre a mesma zona onde o arquivo entrou), mas refazemos a busca
      // por segurança.
      const hintId = tipo === "passagem" ? `emi-prod-${prodId}-${zonaFinal}-fotozone` : `emi-prod-${prodId}-fotozone`;
      const hintAtual = gel(hintId)?.querySelector(".orc-foto-hint");
      if (hintAtual) hintAtual.textContent = "✓ Dados extraídos! Cole outro print pra tentar de novo.";
    } catch (err) {
      if (hintEl) hintEl.textContent = "Erro ao analisar: " + err.message + " — tente colar novamente.";
    }
  }

  // ===== Salvar =====
  function coletarPayload() {
    const emissao = {
      destino: gel("emi-destino").value.trim(),
      data_ida: gel("emi-data-ida").value || null,
      data_volta: gel("emi-data-volta").value || null,
      tipo_viagem: gel("emi-tipo-viagem").value || null,
      observacoes_gerais: gel("emi-obs-gerais").value.trim(),
    };

    const idxPorPaxId = new Map(passageiros.map((p, i) => [p.id, i]));

    const passageirosPayload = passageiros.map((p) => {
      const tamanho_mala = (gel(`emi-pax-${p.id}-mala`) || {}).value || "";
      const observacoes  = (gel(`emi-pax-${p.id}-obs`) || {}).value || "";
      if (p.cliente_id) return { cliente_id: p.cliente_id, tamanho_mala: tamanho_mala.trim(), observacoes: observacoes.trim() };
      const dados_novos = {};
      CLIENTE_CAMPOS.forEach((c) => { dados_novos[c] = (gel(`emi-pax-${p.id}-${c}`) || {}).value || ""; });
      return { dados_novos, tamanho_mala: tamanho_mala.trim(), observacoes: observacoes.trim() };
    });

    // Lê o financeiro (fornecedor/milhas/custo) de UMA perna de passagem — ida e volta têm
    // cada uma o seu, já que às vezes são compradas de fornecedores diferentes.
    const lerFinanceiroPerna = (prodId, perna) => {
      const compraTipoEl = gel(`emi-prod-${prodId}-${perna}-compra_tipo`);
      const compraMilhas = compraTipoEl ? compraTipoEl.value === "milhas" : false;
      const fornecedorEl = gel(`emi-prod-${prodId}-${perna}-fornecedor`);
      const fornecedorValor = fornecedorEl ? fornecedorEl.value : "";
      return {
        // "__novo__" é só o gatilho do "+ Novo fornecedor..." — nunca é um id válido.
        fornecedor_id: (fornecedorValor && fornecedorValor !== "__novo__") ? fornecedorValor : null,
        valor_milha: compraMilhas ? (parseFloat((gel(`emi-prod-${prodId}-${perna}-valor_milha`) || {}).value) || null) : null,
        qtd_milhas: compraMilhas ? (parseFloat((gel(`emi-prod-${prodId}-${perna}-qtd_milhas`) || {}).value) || null) : null,
        custo: parseFloat((gel(`emi-prod-${prodId}-${perna}-custo`) || {}).value) || 0,
      };
    };

    const produtosPayload = produtos.map((prod) => {
      let dados;
      let financeirosTrechos = []; // [{fornecedor_id, valor_milha, qtd_milhas, custo}, ...] na ordem dos trechos

      if (prod.tipo === "passagem") {
        const modo = modoPassagemPorProduto[prod.id] || "ida";
        const listaTrechos = trechosPorProduto[prod.id] || [];
        const lerTrecho = (t) => {
          const financeiro = lerFinanceiroPerna(prod.id, t.id);
          financeirosTrechos.push(financeiro);
          return {
            id: t.id,
            label: t.label,
            localizador: (gel(`emi-prod-${prod.id}-loc-${t.id}`) || {}).value || "",
            segmentos: ((segmentosPorProduto[prod.id] || {})[t.id] || [])
              .filter((s) => s.trecho || s.companhia || s.voo || s.horario_partida || s.horario_chegada)
              .map((s) => ({ trecho: s.trecho, companhia: s.companhia, voo: s.voo, horario_partida: s.horario_partida, horario_chegada: s.horario_chegada })),
            bagagem: (gel(`emi-prod-${prod.id}-${t.id}-bagagem`) || {}).value || "",
            observacoes: (gel(`emi-prod-${prod.id}-${t.id}-observacoes`) || {}).value || "",
            financeiro,
          };
        };
        const trechosLidos = listaTrechos.map(lerTrecho);

        // "dados.ida"/"dados.volta"/"dados.ida_volta" continuam existindo (1º trecho vira
        // ida, último vira volta) só pra manter o Check-in (checkin.js) funcionando — ele
        // lê especificamente esses dois nomes. "dados.trechos" é a lista completa de
        // verdade, usada pelo comprovante e por aqui mesmo ao editar depois.
        dados = {
          modo,
          trechos: trechosLidos,
          ida_volta: trechosLidos.length > 1,
          ida: trechosLidos[0] || { segmentos: [] },
          taxa_embarque: (gel(`emi-prod-${prod.id}-dados-taxa_embarque`) || {}).value || "",
        };
        if (trechosLidos.length > 1) dados.volta = trechosLidos[trechosLidos.length - 1];
      } else {
        dados = {};
        (DADOS_CFG[prod.tipo] || []).forEach((f) => { dados[f.id] = (gel(`emi-prod-${prod.id}-dados-${f.id}`) || {}).value || ""; });
      }

      // Venda corporativa com empresa escolhida: grava dentro de "dados" (sem migração de
      // banco) — o servidor usa isso pra criar a emissão correspondente no Portal Corporativo.
      const origemLeadValor = gel(`emi-prod-${prod.id}-origem_lead`)?.value || null;
      if (origemLeadValor === "Corporativo") {
        const empresaIdValor = gel(`emi-prod-${prod.id}-empresa_id`)?.value || "";
        if (empresaIdValor && empresaIdValor !== "__novo__") dados.empresa_id = empresaIdValor;
      }

      let indices = passageiros.filter((p) => (paxSelecionados[prod.id] || new Set()).has(p.id)).map((p) => idxPorPaxId.get(p.id));
      if (indices.length === 0) indices = passageiros.map((_, i) => i); // ninguém marcado -> aplica a todos

      // Formas de pagamento: 1 ou mais, cada uma com seu próprio valor — o valor total
      // da linha é sempre a soma delas, nunca digitado à parte.
      const pagamentos = (pagamentosPorProduto[prod.id] || [])
        .filter((pg) => (Number(pg.valor) || 0) > 0)
        .map((pg) => ({ forma: pg.forma, valor: Number(pg.valor) || 0, data_faturamento: pg.forma === "faturado" ? (pg.dataFaturamento || null) : null }));
      const valorVenda = pagamentos.reduce((s, pg) => s + pg.valor, 0);

      // Fora de passagem, custo/fornecedor continuam no nível do card, como sempre.
      let fornecedorId = null, valorMilha = null, qtdMilhas = null, custo = null;
      if (prod.tipo === "passagem") {
        const primeiro = financeirosTrechos[0] || { fornecedor_id: null, valor_milha: null, qtd_milhas: null, custo: 0 };
        fornecedorId = primeiro.fornecedor_id;
        valorMilha   = primeiro.valor_milha;
        qtdMilhas    = primeiro.qtd_milhas;
        custo        = financeirosTrechos.reduce((s, f) => s + (f.custo || 0), 0);
      } else {
        const fornecedorValor = gel(`emi-prod-${prod.id}-fornecedor`).value;
        fornecedorId = (fornecedorValor && fornecedorValor !== "__novo__") ? fornecedorValor : null;
        custo = parseFloat(gel(`emi-prod-${prod.id}-custo`).value) || null;
      }

      return {
        tipo: prod.tipo,
        passageiro_indices: indices,
        dados,
        fornecedor_id: fornecedorId,
        valor_milha: valorMilha,
        qtd_milhas: qtdMilhas,
        custo,
        valor_venda: valorVenda,
        pagamentos,
        funcionaria: [...(funcSelecionadas[prod.id] || [])].join("/"),
        origem_lead: origemLeadValor,
      };
    });

    return { emissao, passageiros: passageirosPayload, produtos: produtosPayload };
  }

  function limparFormulario() {
    passageiros = []; produtos = [];
    Object.keys(paxSelecionados).forEach((k) => delete paxSelecionados[k]);
    Object.keys(funcSelecionadas).forEach((k) => delete funcSelecionadas[k]);
    Object.keys(pagamentosPorProduto).forEach((k) => delete pagamentosPorProduto[k]);
    Object.keys(modoPassagemPorProduto).forEach((k) => delete modoPassagemPorProduto[k]);
    Object.keys(trechosPorProduto).forEach((k) => delete trechosPorProduto[k]);
    Object.keys(segmentosPorProduto).forEach((k) => delete segmentosPorProduto[k]);
    ["emi-destino", "emi-data-ida", "emi-data-volta", "emi-tipo-viagem", "emi-obs-gerais"].forEach((id) => { const el = gel(id); if (el) el.value = ""; });
    renderPassageiros(); renderProdutos();
  }

  async function salvarEmissao() {
    const payload = coletarPayload();
    if (payload.passageiros.length === 0) { alert("Adicione ao menos um passageiro."); return; }
    if (payload.produtos.length === 0) { alert("Adicione ao menos um produto."); return; }
    for (const p of payload.produtos) {
      if (!p.valor_venda) { alert("Informe o valor de pelo menos uma forma de pagamento em todos os produtos."); return; }
      if (!p.fornecedor_id) { alert("Selecione o fornecedor em todos os produtos."); return; }
      if (!p.origem_lead) { alert("Selecione a origem do lead em todos os produtos."); return; }
      if (p.origem_lead === "Corporativo" && !p.dados?.empresa_id) { alert("Selecione a empresa em todo produto marcado como Corporativo."); return; }
      if (p.pagamentos.some((pg) => pg.forma === "faturado" && !pg.data_faturamento)) { alert("Informe a data prevista de pagamento em toda forma de pagamento Faturado."); return; }
    }

    const editando = !!emissaoEmEdicaoId;
    const btn = gel("emi-salvar-btn");
    btn.disabled = true; btn.textContent = editando ? "⏳ Salvando edição..." : "⏳ Salvando...";
    gel("emi-status").innerHTML = "";
    try {
      const resultadoSalvar = editando
        ? await chamarEmissoes("editar_emissao", { id: emissaoEmEdicaoId, ...payload })
        : await chamarEmissoes("criar_emissao", payload);

      // Nomes dos passageiros pro comprovante — montado antes de limpar o formulário,
      // porque passageiros novos só têm o nome no input, não no array de estado.
      const nomesPorIndice = passageiros.map((p, i) =>
        p.cliente_id ? p.nome : ((payload.passageiros[i].dados_novos && payload.passageiros[i].dados_novos.nome) || "Passageiro"));
      const produtosInfo = payload.produtos.map((p) => ({
        tipo: p.tipo,
        dados: p.dados,
        valor_venda: p.valor_venda,
        pagamentos: p.pagamentos,
        nomesPax: p.passageiro_indices.map((i) => nomesPorIndice[i]).filter(Boolean).join(", "),
      }));

      // Dados do 1º passageiro — vira o contratante se ela decidir mandar um contrato
      // pra assinatura em seguida (montarOptionsFornecedor/mostrarComprovante ficam com
      // isso guardado em comprovanteAtual pro botão "Enviar contrato").
      const primeiroPax = payload.passageiros[0];
      const contratanteInfo = primeiroPax.cliente_id
        ? (() => { const c = clientesCache.find((x) => x.id === primeiroPax.cliente_id) || {}; return { nome: c.nome || nomesPorIndice[0], cpf: c.cpf || "", telefone: c.telefone || "", email: c.email || "", endereco: c.endereco || "" }; })()
        : (() => { const d = primeiroPax.dados_novos || {}; return { nome: d.nome || nomesPorIndice[0], cpf: d.cpf || "", telefone: d.telefone || "", email: d.email || "", endereco: d.endereco || "" }; })();

      emissaoEmEdicaoId = null;
      gel("emi-editando-aviso").hidden = true;
      limparFormulario();
      await carregarClientes();
      await carregarListaEmissoes();
      renderListaEmissoes();

      if (resultadoSalvar && resultadoSalvar.aviso) alert("⚠ " + resultadoSalvar.aviso);

      mostrarComprovante(payload.emissao, nomesPorIndice, produtosInfo, contratanteInfo);
    } catch (err) {
      gel("emi-status").innerHTML = `<div class="ctr-status-msg ctr-status-msg--erro">Erro ao salvar: ${escHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = "💾 Salvar emissão";
    }
  }

  // ===== Editar emissão existente =====
  // Recarrega os dados de uma emissão já salva de volta no formulário de Nova Emissão pra
  // corrigir algo cadastrado errado. Ao salvar, editar_emissao recria tudo do zero (mesma
  // lógica do cadastro normal) e só depois apaga a versão antiga.
  function editarEmissao(id) {
    const e = (emissoesSalvas || []).find((x) => x.id === id);
    if (!e) return;

    emissaoEmEdicaoId = id;

    gel("emi-destino").value = e.destino || "";
    gel("emi-data-ida").value = e.data_ida || "";
    gel("emi-data-volta").value = e.data_volta || "";
    gel("emi-tipo-viagem").value = e.tipo_viagem || "";
    gel("emi-obs-gerais").value = e.observacoes_gerais || "";

    const paxOriginais = e.venda_emissoes_passageiros || [];
    passageiros = paxOriginais.map((pax) => ({ id: novoId("pax"), cliente_id: pax.cliente_id, nome: paxNome(pax) }));
    const mapaOriginalParaNovo = new Map();
    paxOriginais.forEach((pax, i) => mapaOriginalParaNovo.set(pax.id, passageiros[i].id));

    Object.keys(paxSelecionados).forEach((k) => delete paxSelecionados[k]);
    Object.keys(funcSelecionadas).forEach((k) => delete funcSelecionadas[k]);
    const prodsOriginais = e.venda_emissoes_produtos || [];
    produtos = prodsOriginais.map((p) => ({ id: novoId("prod"), tipo: p.tipo }));

    renderPassageiros();
    paxOriginais.forEach((pax, i) => {
      const novoPaxId = passageiros[i].id;
      const mala = gel(`emi-pax-${novoPaxId}-mala`); if (mala) mala.value = pax.tamanho_mala || "";
      const obs = gel(`emi-pax-${novoPaxId}-obs`); if (obs) obs.value = pax.observacoes || "";
    });

    // Passagem: prepara modo/trechos/segmentos ANTES do primeiro render — os blocos de
    // trecho só aparecem no HTML de acordo com esse estado, então precisam existir antes
    // de tentar preencher valor nenhum neles.
    prodsOriginais.forEach((p, i) => {
      if (p.tipo !== "passagem") return;
      const novoProdId = produtos[i].id;
      const { modo, trechos } = normalizarTrechosPassagem(p);
      modoPassagemPorProduto[novoProdId] = modo;
      trechosPorProduto[novoProdId] = trechos.map((t) => ({ id: t.id, label: t.label }));
      segmentosPorProduto[novoProdId] = {};
      trechos.forEach((t) => {
        segmentosPorProduto[novoProdId][t.id] = (Array.isArray(t.segmentos) && t.segmentos.length > 0)
          ? t.segmentos.map((s) => ({
              id: novoId("seg"),
              trecho: s.trecho || "", companhia: s.companhia || "", voo: s.voo || "",
              horario_partida: s.horario_partida || "", horario_chegada: s.horario_chegada || "",
            }))
          : [novoSegmento()];
      });
    });

    renderProdutos();
    prodsOriginais.forEach((p, i) => {
      const novoProdId = produtos[i].id;
      paxSelecionados[novoProdId] = new Set((p.passageiro_ids || []).map((pid) => mapaOriginalParaNovo.get(pid)).filter(Boolean));
      renderProdutoPaxChecks(novoProdId);

      if (p.tipo === "passagem") {
        const d = p.dados || {};
        const { trechos } = normalizarTrechosPassagem(p);

        trechos.forEach((t) => {
          const locEl = gel(`emi-prod-${novoProdId}-loc-${t.id}`);
          if (locEl) locEl.value = t.localizador || "";
          renderSegmentos(novoProdId, t.id); // já semeado na 1ª passada, só desenha

          const bagagemEl = gel(`emi-prod-${novoProdId}-${t.id}-bagagem`); if (bagagemEl) bagagemEl.value = t.bagagem || "";
          const obsEl = gel(`emi-prod-${novoProdId}-${t.id}-observacoes`); if (obsEl) obsEl.value = t.observacoes || "";

          const financeiro = t.financeiro;
          if (!financeiro) return;
          const fornecedorEl = gel(`emi-prod-${novoProdId}-${t.id}-fornecedor`);
          if (fornecedorEl) fornecedorEl.value = financeiro.fornecedor_id || "";
          const compraTipoEl = gel(`emi-prod-${novoProdId}-${t.id}-compra_tipo`);
          if (compraTipoEl) {
            compraTipoEl.value = (financeiro.valor_milha != null && financeiro.qtd_milhas != null) ? "milhas" : "tarifado";
            compraTipoEl.dispatchEvent(new Event("change"));
          }
          const valorMilhaEl = gel(`emi-prod-${novoProdId}-${t.id}-valor_milha`); if (valorMilhaEl && financeiro.valor_milha != null) valorMilhaEl.value = financeiro.valor_milha;
          const qtdMilhasEl = gel(`emi-prod-${novoProdId}-${t.id}-qtd_milhas`); if (qtdMilhasEl && financeiro.qtd_milhas != null) qtdMilhasEl.value = financeiro.qtd_milhas;
          const custoEl = gel(`emi-prod-${novoProdId}-${t.id}-custo`); if (custoEl && financeiro.custo != null) custoEl.value = financeiro.custo;
        });

        const taxaEl = gel(`emi-prod-${novoProdId}-dados-taxa_embarque`);
        if (taxaEl && d.taxa_embarque != null) taxaEl.value = d.taxa_embarque;
      } else {
        (DADOS_CFG[p.tipo] || []).forEach((f) => {
          const el = gel(`emi-prod-${novoProdId}-dados-${f.id}`);
          if (el && p.dados && p.dados[f.id] != null) el.value = p.dados[f.id];
        });
        // Campos com showIf (ex: cidade/horário da parada do Trem) dependem do valor de
        // outro campo do mesmo produto — dispara o "change" dele pra mostrar/esconder certo
        // com o valor que acabou de ser restaurado.
        (DADOS_CFG[p.tipo] || []).forEach((f) => {
          if (!f.showIf) return;
          gel(`emi-prod-${novoProdId}-dados-${f.showIf.field}`)?.dispatchEvent(new Event("change"));
        });

        const fornecedorEl = gel(`emi-prod-${novoProdId}-fornecedor`);
        if (fornecedorEl) fornecedorEl.value = p.fornecedor_id || "";
        const custoEl = gel(`emi-prod-${novoProdId}-custo`); if (custoEl && p.custo != null) custoEl.value = p.custo;
      }

      // Formas de pagamento salvas (jsonb) — se o registro é de antes desse campo existir,
      // reconstrói uma única linha a partir dos campos antigos (forma_pagamento/valor_venda).
      pagamentosPorProduto[novoProdId] = (Array.isArray(p.pagamentos) && p.pagamentos.length > 0)
        ? p.pagamentos.map((pg) => ({ id: novoId("pag"), forma: pg.forma, valor: pg.valor, dataFaturamento: pg.data_faturamento || null }))
        : [{ id: novoId("pag"), forma: p.forma_pagamento || "pix", valor: p.valor_venda, dataFaturamento: p.data_faturamento || null }];
      renderProdutoPagamentos(novoProdId);

      funcSelecionadas[novoProdId] = new Set((p.funcionaria || "").split("/").map((n) => n.trim()).filter(Boolean));
      renderProdutoFuncChecks(novoProdId);
      const origemEl = gel(`emi-prod-${novoProdId}-origem_lead`);
      if (origemEl && p.origem_lead) {
        origemEl.value = p.origem_lead;
        origemEl.dispatchEvent(new Event("change")); // mostra o seletor de empresa se for Corporativo
      }
      const empresaEl = gel(`emi-prod-${novoProdId}-empresa_id`);
      if (empresaEl && p.dados && p.dados.empresa_id) empresaEl.value = p.dados.empresa_id;
    });

    gel("emi-editando-aviso").hidden = false;
    gel("emi-status").innerHTML = "";
    gel("emi-form-wrap").hidden = false;
    gel("emi-comprovante-wrap").hidden = true;

    document.querySelector('[data-tab="nova-emissao"]')?.click();
    window.scrollTo(0, 0);
  }

  function cancelarEdicao() {
    emissaoEmEdicaoId = null;
    limparFormulario();
    gel("emi-editando-aviso").hidden = true;
    gel("emi-status").innerHTML = "";
  }

  // ===== Comprovante de emissão (documento pro cliente) =====
  // Reaproveita o mesmo estilo visual do antigo "Confirmação de Emissão" (classes
  // orc-prev-* / conf-*), que foi aposentado: a Nova Emissão já cobre esse papel agora.
  let comprovanteAtual = null; // { emissaoInfo, nomesPax, produtosInfo } — pro botão de PDF/copiar do preview pós-salvar

  // O campo "Trecho" é digitado como um texto só (ex: "GRU → REC") — separa em
  // origem/destino pra montar as duas caixas de aeroporto do card de voo.
  function parseTrecho(trecho) {
    const raw = String(trecho || "");
    let partes = raw.split("→").map((s) => s.trim()).filter(Boolean);
    if (partes.length < 2) partes = raw.split(/->|-/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 2) return { origem: partes[0], destino: partes[partes.length - 1] };
    return { origem: raw || "—", destino: "" };
  }

  // Card de voo no estilo antigo (confirmacao.js): caixas de aeroporto com linha
  // tracejada + avião no meio, e o localizador em destaque numa caixa própria — porque é
  // a informação mais importante do comprovante.
  // Uma perna (ida OU volta) dentro do card de passagem.
  // Um trecho/segmento isolado (uma linha da tabela de itinerário).
  function segmentoComprovanteHtml(seg) {
    const { origem, destino } = parseTrecho(seg.trecho);
    return `
      <div class="orc-prev-flight-card-body" style="padding:0">
        <div class="orc-prev-airport">
          <div class="orc-prev-iata">${escHtml(origem || "—")}</div>
          ${seg.horario_partida ? `<div class="orc-prev-time">${escHtml(seg.horario_partida)}</div>` : ""}
        </div>
        <div class="orc-prev-flight-middle">
          <div class="orc-prev-dash-line">
            <span class="orc-prev-dash-seg"></span>
            <span class="orc-prev-plane-icon">✈</span>
            <span class="orc-prev-dash-seg"></span>
          </div>
          ${seg.companhia || seg.voo ? `<div class="orc-prev-direto">${escHtml([seg.companhia, seg.voo].filter(Boolean).join(" · "))}</div>` : ""}
        </div>
        <div class="orc-prev-airport orc-prev-airport--right">
          <div class="orc-prev-iata">${escHtml(destino || "—")}</div>
          ${seg.horario_chegada ? `<div class="orc-prev-time">${escHtml(seg.horario_chegada)}</div>` : ""}
        </div>
      </div>`;
  }

  // Uma perna (ida ou volta) inteira — pode ter vários trechos (conexão), cada um com
  // seus próprios aeroporto e horário, igual a companhia mostra pro cliente.
  function pernaComprovanteHtml(label, info) {
    const segmentos = (info.segmentos && info.segmentos.length) ? info.segmentos : [info];
    const segmentosHtml = segmentos.map((seg, i) => {
      let html = segmentoComprovanteHtml(seg);
      if (i < segmentos.length - 1) {
        const { destino } = parseTrecho(seg.trecho);
        html += `<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);margin:2px 0 10px">✈ Conexão em ${escHtml(destino || "—")}</div>`;
      }
      return html;
    }).join("");

    return `
      <div style="margin-bottom:14px">
        <div style="font-size:0.68rem;letter-spacing:1.5px;color:var(--gold);font-weight:700;margin-bottom:8px">${escHtml(label)}</div>
        ${info.localizador ? `<div class="conf-localizador" style="margin:0 0 12px"><span class="conf-loc-label">Localizador / código</span><span class="conf-loc-valor">${escHtml(info.localizador)}</span></div>` : ""}
        ${segmentosHtml}
      </div>`;
  }

  // Bagagem + observações + "acesse o site da companhia" de UMA perna — cada perna pode
  // ser de uma companhia diferente (ex: ida e volta compradas separadas), então o site de
  // gerenciamento é detectado a partir da própria companhia dos trechos dessa perna, não
  // de um valor fixo pro card inteiro.
  function infoImportantesPernaHtml(info) {
    const items = [];
    if (info.bagagem) items.push({ icon: "🧳", text: `<strong>Bagagem:</strong> ${escHtml(info.bagagem)}` });

    (info.observacoes || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((linha) => {
      items.push({ icon: "📌", text: escHtml(linha) });
    });

    const segmentos = (info.segmentos && info.segmentos.length) ? info.segmentos : [info];
    const companhia = segmentos.find((s) => s.companhia)?.companhia || "";
    const airline = findAirline(companhia);
    if (airline) {
      items.push({
        icon: "🌐",
        text: `Você pode acessar e acompanhar esta reserva diretamente no site da <strong>${escHtml(airline.label)}</strong>: <strong>${escHtml(airline.path)}</strong>`,
      });
    }

    if (!items.length) return "";
    return `
      <ul class="conf-obs-lista" style="margin-bottom:14px">
        ${items.map((it) => `<li class="conf-obs-item"><span class="conf-obs-icon">${it.icon}</span><span>${it.text}</span></li>`).join("")}
      </ul>`;
  }

  // Mesma normalização de normalizarTrechosPassagem, mas só com o "dados" (sem a linha do
  // produto inteira) — o comprovante não precisa de financeiro, só do que aparece pro
  // cliente (localizador/trechos/bagagem/observações).
  function normalizarTrechosComprovante(d) {
    if (Array.isArray(d.trechos) && d.trechos.length > 0) return d.trechos;
    const trechos = [{ label: d.volta ? "Ida" : "Passagem", ...(d.ida || d) }];
    if (d.volta) trechos.push({ label: "Volta", ...d.volta });
    return trechos;
  }

  function cardPassagemComprovante(dados, valorVenda) {
    const d = dados || {};
    const trechos = normalizarTrechosComprovante(d);
    const titulo = trechos.length === 1 ? "PASSAGEM AÉREA" : trechos.length === 2 ? "IDA E VOLTA" : "MÚLTIPLOS TRECHOS";
    const pernasHtml = trechos
      .map((t) => pernaComprovanteHtml((t.label || "").toUpperCase(), t) + infoImportantesPernaHtml(t))
      .join("");
    return `
      <div class="orc-prev-flight-card">
        <div class="orc-prev-flight-card-header">
          <span class="orc-prev-flight-label">✈️ ${titulo}</span>
          <span class="orc-prev-flight-card-voo">${fBRL(valorVenda)}</span>
        </div>
        <div style="padding:20px 24px 6px">${pernasHtml}</div>
      </div>`;
  }

  function linhaProdutoComprovante(tipo, dados, valorVenda, nomesPax) {
    if (tipo === "passagem") return cardPassagemComprovante(dados, valorVenda);
    const detalhes = (DADOS_CFG[tipo] || [])
      .filter((f) => dados && dados[f.id])
      .map((f) => `<div class="conf-obs-item"><span class="conf-obs-icon">•</span><span>${escHtml(f.label)}: <strong>${escHtml(dados[f.id])}</strong></span></div>`)
      .join("");
    return `
      <div class="orc-prev-flight-card">
        <div class="orc-prev-flight-card-header">
          <span class="orc-prev-flight-label">${PROD_ICON[tipo] || "📦"} ${escHtml((PROD_LABEL[tipo] || tipo).toUpperCase())}</span>
          <span class="orc-prev-flight-card-voo">${fBRL(valorVenda)}</span>
        </div>
        <div style="padding:12px 16px;font-size:0.85rem;color:var(--navy-light)">
          ${nomesPax ? `<div style="margin-bottom:6px"><strong>Passageiro(s):</strong> ${escHtml(nomesPax)}</div>` : ""}
          ${detalhes || '<div class="table__muted">Sem detalhes adicionais</div>'}
        </div>
      </div>`;
  }

  function montarComprovanteHtml(emissaoInfo, nomesPax, produtosInfo) {
    const agora = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const dataIda = fData(emissaoInfo.data_ida);
    const dataVolta = emissaoInfo.data_volta ? fData(emissaoInfo.data_volta) : "";
    const total = produtosInfo.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);

    const paxHtml = nomesPax.map((n) => `<div class="conf-pax-row">👤 ${escHtml(n)}</div>`).join("");
    const produtosHtml = produtosInfo.map((p) => linhaProdutoComprovante(p.tipo, p.dados, p.valor_venda, p.nomesPax)).join("");

    return `
      <div class="orc-prev-wrap conf-prev-wrap">
        <div class="orc-prev-header">
          <img src="Lolek_logotipo_3.png" class="orc-prev-logo-img" alt="Lolek Viagens">
          <div class="orc-prev-contatos">
            <strong>Lolek Viagens</strong><br>
            CNPJ 54.795.384/0001-05<br>
            thaynara@agencialolekviagens.com.br<br>
            (85) 99632-7092<br>
            Av. Santos Dumont, 2789, Sala 402 — Fortaleza/CE
          </div>
        </div>
        <div class="orc-prev-divider"></div>

        <div class="orc-prev-titulo">COMPROVANTE DE EMISSÃO</div>
        <div class="conf-emitido-em">Emitido em ${agora}</div>

        ${emissaoInfo.destino ? `<div class="conf-section-title">Viagem</div><div class="conf-pax-row">📍 ${escHtml(emissaoInfo.destino)}${dataIda !== "—" ? " — " + dataIda + (dataVolta ? " a " + dataVolta : "") : ""}</div>` : ""}

        ${nomesPax.length ? `<div class="conf-section-title">Passageiro${nomesPax.length !== 1 ? "s" : ""}</div>${paxHtml}` : ""}

        <div class="conf-section-title">Itens</div>
        ${produtosHtml}

        <div class="conf-valor-row"><span>Valor total</span><span class="conf-valor">${fBRL(total)}</span></div>

        <div class="conf-obs-section">
          <div class="conf-obs-title">Informações importantes</div>
          <ul class="conf-obs-lista">
            <li class="conf-obs-item"><span class="conf-obs-icon">📞</span><span>Em caso de dúvidas ou alterações, entre em contato com a Lolek Viagens pelo <strong>(85) 99632-7092</strong> ou <strong>thaynara@agencialolekviagens.com.br</strong>.</span></li>
          </ul>
        </div>

        <div class="orc-prev-footer">
          Este documento é um comprovante de emissão emitido pela Lolek Viagens como intermediária junto às operadoras e companhias contratadas. As condições de transporte e hospedagem são regidas pelas respectivas prestadoras de serviço.
        </div>
      </div>`;
  }

  // Abre uma aba limpa só com o comprovante e dispara a impressão (mesmo truque do
  // antigo confirmacao.js) — usuária escolhe "Salvar como PDF" na caixa de impressão.
  function abrirComprovantePDF(html) {
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
    /* "Salvar como PDF" e imprimir passam pelo mesmo diálogo nativo do navegador — a
       diferença de cor entre os dois vinha da opção "Gráficos em segundo plano" do
       diálogo, que o navegador às vezes desmarca sozinho dependendo do destino escolhido
       (PDF x impressora). Força manter as cores de fundo (ex: a caixa azul do localizador)
       nos dois casos, sem depender dessa opção. */
    * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    @media print {
      body { padding: 0; }
      .orc-prev-wrap { border: none; max-width: 100%; padding: 20px; }
      /* Reduz o tamanho de tudo (as fontes do comprovante são em rem, relativas a esse
         valor) só nessa janela de impressão/PDF — a pré-visualização normal na tela
         continua do tamanho de sempre. Ajuda um bilhete de ida e volta a caber numa página. */
      html { font-size: 85%; }
    }
  </style>
</head>
<body>
  ${html}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 600);
    };
  <\/script>
</body>
</html>`);
    win.document.close();
  }

  function copiarComprovanteTexto(emissaoInfo, nomesPax, produtosInfo) {
    let txt = "COMPROVANTE DE EMISSÃO — LOLEK VIAGENS\nCNPJ: 54.795.384/0001-05\nthaynara@agencialolekviagens.com.br | (85) 99632-7092\n\n";
    if (emissaoInfo.destino) txt += `Viagem: ${emissaoInfo.destino} — ${fData(emissaoInfo.data_ida)}${emissaoInfo.data_volta ? " a " + fData(emissaoInfo.data_volta) : ""}\n`;
    if (nomesPax.length) txt += `Passageiro(s): ${nomesPax.join(", ")}\n\n`;
    produtosInfo.forEach((p) => {
      txt += `[${(PROD_LABEL[p.tipo] || p.tipo).toUpperCase()}] ${fBRL(p.valor_venda)}${p.nomesPax ? " — " + p.nomesPax : ""}\n`;
      if (p.tipo === "passagem") {
        const d = p.dados || {};
        const escrevePerna = (label, info) => {
          if (!info) return;
          if (info.localizador) txt += `  ${label} — localizador: ${info.localizador}\n`;
          const segmentos = (info.segmentos && info.segmentos.length) ? info.segmentos : [info];
          segmentos.forEach((seg) => {
            txt += `  ${label}: ${seg.trecho || "—"}${seg.horario_partida ? " · saída " + seg.horario_partida : ""}${seg.companhia ? " · " + seg.companhia : ""}\n`;
          });
        };
        if (d.ida_volta && d.volta) { escrevePerna("Ida", d.ida); escrevePerna("Volta", d.volta); }
        else escrevePerna("Voo", d.ida || d);
      } else {
        (DADOS_CFG[p.tipo] || []).forEach((f) => { if (p.dados && p.dados[f.id]) txt += `  ${f.label}: ${p.dados[f.id]}\n`; });
      }
    });
    const total = produtosInfo.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);
    txt += `\nValor total: ${fBRL(total)}\n`;
    navigator.clipboard.writeText(txt);
  }

  function mostrarComprovante(emissaoInfo, nomesPax, produtosInfo, contratanteInfo) {
    comprovanteAtual = { emissaoInfo, nomesPax, produtosInfo, contratanteInfo };
    gel("emi-comprovante-preview").innerHTML = montarComprovanteHtml(emissaoInfo, nomesPax, produtosInfo);
    gel("emi-form-wrap").hidden = true;
    gel("emi-comprovante-wrap").hidden = false;
    window.scrollTo(0, 0);
  }

  // Botão "📝 Enviar contrato" — leva os dados da emissão recém-salva pra aba Contratos
  // já pré-preenchidos (contratante = 1º passageiro), pra revisar e enviar pro ZapSign.
  // Não faz isso sozinho: ela ainda revisa/ajusta antes de clicar em gerar, porque é um
  // documento assinado — não dá pra confiar 100% no que foi deduzido automaticamente.
  function enviarParaContrato() {
    if (!comprovanteAtual) return;
    const { emissaoInfo, produtosInfo, contratanteInfo } = comprovanteAtual;

    const total = produtosInfo.reduce((s, p) => s + (Number(p.valor_venda) || 0), 0);
    const tiposUnicos = [...new Set(produtosInfo.map((p) => PROD_LABEL[p.tipo] || p.tipo))];
    const periodo = emissaoInfo.data_ida
      ? ` (${fData(emissaoInfo.data_ida)}${emissaoInfo.data_volta ? " a " + fData(emissaoInfo.data_volta) : ""})`
      : "";
    const descricao = `Pacote de viagem para ${emissaoInfo.destino || "—"}${periodo}: ${tiposUnicos.join(", ")}.`;

    const formaLabel = (v) => (FORMAS_PAGAMENTO.find((f) => f.v === v) || {}).l || v;
    const formasUnicas = [...new Set(produtosInfo.flatMap((p) => (p.pagamentos || []).map((pg) => pg.forma)))].filter(Boolean).map(formaLabel);

    gel("ctr-nome_cliente").value = contratanteInfo.nome || "";
    gel("ctr-cpf_cnpj").value = contratanteInfo.cpf || "";
    gel("ctr-telefone_cliente").value = contratanteInfo.telefone || "";
    gel("ctr-email_cliente").value = contratanteInfo.email || "";
    gel("ctr-endereco_cliente").value = contratanteInfo.endereco || "";
    gel("ctr-descricao_servico").value = descricao;
    gel("ctr-valor_total").value = fBRL(total);
    gel("ctr-valor_extenso").value = valorPorExtenso(total);
    gel("ctr-forma_pagamento").value = formasUnicas.join(" / ");
    gel("ctr-prazo_entrega").value = "Imediato";
    gel("ctr-status").innerHTML = '<div class="ctr-status-msg ctr-status-msg--warn">Confira os dados abaixo — foram pré-preenchidos a partir da emissão. Ajuste o que precisar antes de gerar e enviar.</div>';

    document.querySelector('[data-tab="contratos"]')?.click();
    window.scrollTo(0, 0);
  }

  // Botão "📄 Comprovante" na listagem — reconstrói o documento de uma emissão já salva
  // (pra baixar de novo se não gerou na hora, ou se outra funcionária precisar depois).
  function baixarComprovanteSalvo(emissaoId, mapaPax) {
    const e = (emissoesSalvas || []).find((x) => x.id === emissaoId);
    if (!e) return;
    const nomesPax = (e.venda_emissoes_passageiros || []).map(paxNome);
    const produtosInfo = (e.venda_emissoes_produtos || []).map((p) => ({
      tipo: p.tipo,
      dados: p.dados,
      valor_venda: p.valor_venda,
      nomesPax: (p.passageiro_ids || []).map((id) => (mapaPax.get(id) || {}).nome).filter(Boolean).join(", "),
    }));
    abrirComprovantePDF(montarComprovanteHtml(e, nomesPax, produtosInfo));
  }

  // ===== Listagem =====
  async function carregarListaEmissoes() {
    try {
      const resp = await fetch("/.netlify/functions/emissoes-data");
      emissoesSalvas = resp.ok ? await resp.json() : null;
    } catch { emissoesSalvas = null; }
  }

  function paxNome(pax) {
    const cliente = clientesCache.find((c) => c.id === pax.cliente_id);
    return cliente ? cliente.nome : "Passageiro";
  }

  function fornecedorNome(id) {
    if (!id) return "—";
    const f = fornecedoresCache.find((f) => f.id === id);
    return f ? f.nome : "—";
  }

  // Reconstrói o custo total de um produto: usa a coluna custo se preenchida, senão
  // calcula pelo valor do milheiro × qtd. de milhas (caso de compra com milhas).
  function custoProdutoTotal(p) {
    if (p.custo != null) return Number(p.custo);
    if (p.valor_milha != null && p.qtd_milhas != null) return Number(p.valor_milha) * Number(p.qtd_milhas) / 1000;
    return 0;
  }

  // id do passageiro (venda_emissoes_passageiros.id) -> { nome, clienteId }
  function construirMapaPax() {
    const mapa = new Map();
    (emissoesSalvas || []).forEach((e) => {
      (e.venda_emissoes_passageiros || []).forEach((pax) => {
        mapa.set(pax.id, { nome: paxNome(pax), clienteId: pax.cliente_id });
      });
    });
    return mapa;
  }

  // Um produto que cobre N passageiros (ex: 1 passagem comprada pra 3 pessoas de uma vez)
  // vira N linhas na listagem — valor/custo/lucro rateados entre elas — porque foram
  // 3 vendas do ponto de vista de quem confere a lista, mesmo sendo 1 reserva só.
  function expandirProdutoEmLinhas(p, e, mapaPax) {
    const ids = (p.passageiro_ids && p.passageiro_ids.length) ? p.passageiro_ids : [null];
    const n = ids.length;
    const custoTotal = custoProdutoTotal(p);
    return ids.map((id) => {
      const info = id ? mapaPax.get(id) : null;
      return {
        produtoId: p.id,
        emissaoId: e.id,
        data_venda: p.data_venda,
        destino: e.destino,
        tipo: p.tipo,
        dados: p.dados,
        dataIdaViagem: e.data_ida,
        dataVoltaViagem: e.data_volta,
        nome: info ? info.nome : "—",
        clienteId: info ? info.clienteId : null,
        valor_venda: (Number(p.valor_venda) || 0) / n,
        custo: custoTotal / n,
        lucro: (Number(p.lucro) || 0) / n,
        qtd_milhas: p.qtd_milhas != null ? Number(p.qtd_milhas) / n : 0,
        fornecedor_id: p.fornecedor_id,
        forma_pagamento: p.forma_pagamento,
        pagamentos: p.pagamentos,
        funcionaria: p.funcionaria,
      };
    });
  }

  // Data do PRODUTO/serviço em si (viagem, check-in/out, entrevista de visto...) —
  // diferente da data_venda (quando a venda foi registrada no sistema).
  function dataServicoLinha(l) {
    const d = l.dados || {};
    if (l.tipo === "passagem") {
      if (d.ida_volta && d.volta) return `${fData(l.dataIdaViagem)} – ${fData(l.dataVoltaViagem)}`;
      return l.dataIdaViagem ? fData(l.dataIdaViagem) : "—";
    }
    if (l.tipo === "hospedagem") {
      if (!d.checkin && !d.checkout) return "—";
      return `${fData(d.checkin)} – ${fData(d.checkout)}`;
    }
    if (l.tipo === "passeio" && d.data_passeio) return fData(d.data_passeio);
    if (l.tipo === "visto_americano" && d.data_entrevista) return fData(d.data_entrevista);
    return "—";
  }

  function todasLinhasOrdenadas(mapaPax) {
    return (emissoesSalvas || [])
      .flatMap((e) => (e.venda_emissoes_produtos || []).flatMap((p) => expandirProdutoEmLinhas(p, e, mapaPax)))
      .sort((a, b) => (b.data_venda || "").localeCompare(a.data_venda || ""));
  }

  // Filtros da aba Emissões: mês (data da venda), funcionária e tipo de produto — aplicados
  // antes de agrupar por data/cliente/viagem, então valem nas 3 visões igual.
  function aplicarFiltrosEmi(linhas) {
    return linhas.filter((l) => {
      if (filtroMesEmi && (l.data_venda || "").slice(0, 7) !== filtroMesEmi) return false;
      if (filtroFuncionariaEmi) {
        const nomes = (l.funcionaria || "").split("/").map((n) => n.trim());
        if (!nomes.includes(filtroFuncionariaEmi)) return false;
      }
      if (filtroTipoProdutoEmi && l.tipo !== filtroTipoProdutoEmi) return false;
      if (filtroNomeEmi && !norm(l.nome).includes(filtroNomeEmi)) return false;
      return true;
    });
  }

  function pagamentosLinhaTexto(l) {
    if (Array.isArray(l.pagamentos) && l.pagamentos.length > 0) {
      return l.pagamentos.map((pg) => {
        const label = FORMAS_PAGAMENTO.find((f) => f.v === pg.forma)?.l || pg.forma;
        return l.pagamentos.length > 1 ? `${label} (${fBRL(pg.valor)})` : label;
      }).join(" + ");
    }
    return FORMAS_PAGAMENTO.find((f) => f.v === l.forma_pagamento)?.l || l.forma_pagamento || "—";
  }

  function renderLinhaRow(l) {
    return `
      <tr>
        <td class="table__muted">${fData(l.data_venda)}</td>
        <td>${escHtml(l.nome)}</td>
        <td>${escHtml(l.destino || "—")}</td>
        <td>${PROD_ICON[l.tipo] || "📦"} ${escHtml(PROD_LABEL[l.tipo] || l.tipo)}</td>
        <td class="table__muted">${dataServicoLinha(l)}</td>
        <td class="table__muted">${escHtml(fornecedorNome(l.fornecedor_id))}</td>
        <td class="table__muted">${fBRL(l.custo)}</td>
        <td>${fBRL(l.valor_venda)}</td>
        <td class="table__muted">${fBRL(l.lucro)}</td>
        <td class="table__muted">${escHtml(pagamentosLinhaTexto(l))}</td>
        <td class="table__muted">${escHtml(l.funcionaria || "—")}</td>
        <td><button type="button" class="orc-produto-remove" data-excluir-produto="${l.produtoId}" title="Exclui este produto (todos os passageiros cobertos por ele)">✕</button></td>
      </tr>`;
  }

  function tabelaLinhas(linhas) {
    if (linhas.length === 0) return '<div class="empty-state empty-state--compact"><p>Nada por aqui</p></div>';
    return `<div class="card"><table class="table table--compact">
      <thead><tr><th>Data da venda</th><th>Cliente</th><th>Viagem</th><th>Produto</th><th>Data do produto</th><th>Fornecedor</th><th>Custo</th><th>Valor</th><th>Lucro</th><th>Pagamento</th><th>Funcionária</th><th></th></tr></thead>
      <tbody>${linhas.map(renderLinhaRow).join("")}</tbody>
    </table></div>`;
  }

  function somaValor(linhas) { return linhas.reduce((s, l) => s + (Number(l.valor_venda) || 0), 0); }

  function resumoLinhas(linhas) {
    const faturamento = somaValor(linhas);
    const lucro = linhas.reduce((s, l) => s + (Number(l.lucro) || 0), 0);
    const margem = faturamento > 0 ? (lucro / faturamento * 100) : 0;
    const milhas = linhas.reduce((s, l) => s + (Number(l.qtd_milhas) || 0), 0);
    return { count: linhas.length, faturamento, lucro, margem, milhas };
  }

  function renderResumoStats(linhas) {
    const r = resumoLinhas(linhas);
    return `<div class="stats" style="margin:14px 0 0;padding:0 16px 16px">
      <div class="stat"><div class="stat__value">${r.count}</div><div class="stat__label">Produtos</div></div>
      <div class="stat"><div class="stat__value">${fBRL(r.faturamento)}</div><div class="stat__label">Faturamento</div></div>
      <div class="stat stat--gold"><div class="stat__value">${fBRL(r.lucro)}</div><div class="stat__label">Lucro</div></div>
      <div class="stat"><div class="stat__value">${r.margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div><div class="stat__label">Margem</div></div>
      ${r.milhas > 0 ? `<div class="stat"><div class="stat__value">${Math.round(r.milhas).toLocaleString("pt-BR")}</div><div class="stat__label">Milhas</div></div>` : ""}
    </div>`;
  }

  function renderViagemCard(e, linhas) {
    const pax = e.venda_emissoes_passageiros || [];
    const totalVenda = somaValor(linhas);
    return `
      <div class="emi-viagem-card">
        <div class="emi-viagem-header">
          <strong>${escHtml(e.destino || "Sem destino informado")}</strong>
          <span style="opacity:0.8">${fData(e.data_ida)}${e.data_volta ? " – " + fData(e.data_volta) : ""}</span>
          ${e.tipo_viagem ? `<span class="badge badge--andamento">${escHtml(e.tipo_viagem)}</span>` : ""}
          <div class="emi-viagem-header-actions">
            <button type="button" class="emi-btn-comprovante" data-comprovante-emissao="${e.id}">📄 Comprovante</button>
            <button type="button" class="emi-btn-comprovante" data-editar-emissao="${e.id}">✏ Editar</button>
            <button type="button" class="orc-produto-remove" data-excluir-emissao="${e.id}">✕ Excluir</button>
          </div>
        </div>
        <div class="emi-viagem-body">
          <div class="table__muted" style="margin-bottom:8px">${pax.map((p) => escHtml(paxNome(p))).join(", ") || "—"}</div>
          ${tabelaLinhas(linhas)}
          <div style="text-align:right;margin-top:8px;font-weight:600">Total: ${fBRL(totalVenda)}</div>
        </div>
      </div>`;
  }

  function renderPorData(linhas) {
    const grupos = new Map();
    linhas.forEach((l) => {
      const chave = (l.data_venda || "").slice(0, 7) || "sem-data";
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(l);
    });
    const chavesOrdenadas = [...grupos.keys()].sort((a, b) => b.localeCompare(a));
    return chavesOrdenadas.map((chave) => {
      const itens = grupos.get(chave);
      return `<div class="emi-grupo-wrap">
        <div class="emi-grupo-header">
          <strong>${escHtml(mesLabel(chave))}</strong>
          <span class="emi-grupo-total">${itens.length} produto${itens.length !== 1 ? "s" : ""} · ${fBRL(somaValor(itens))}</span>
        </div>
        ${tabelaLinhas(itens)}
        ${renderResumoStats(itens)}
      </div>`;
    }).join("");
  }

  function renderPorCliente(linhas) {
    const porCliente = new Map(); // clienteId -> { nome, linhas: [] }
    linhas.forEach((l) => {
      if (!l.clienteId) return;
      if (!porCliente.has(l.clienteId)) porCliente.set(l.clienteId, { nome: l.nome, linhas: [] });
      porCliente.get(l.clienteId).linhas.push(l);
    });
    const entradas = [...porCliente.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return entradas.map((c) => `<div class="emi-grupo-wrap">
      <div class="emi-grupo-header">
        <strong>${escHtml(c.nome)}</strong>
        <span class="emi-grupo-total">${c.linhas.length} produto${c.linhas.length !== 1 ? "s" : ""} · ${fBRL(somaValor(c.linhas))}</span>
      </div>
      ${tabelaLinhas(c.linhas)}
    </div>`).join("");
  }

  function renderListaEmissoes() {
    const wrap = gel("emi-lista-wrap");
    const count = gel("emi-count");
    if (!wrap) return;

    if (emissoesSalvas === null) {
      wrap.innerHTML = '<div class="empty-state"><p>Erro ao carregar emissões</p></div>';
      count.textContent = "";
      return;
    }
    if (emissoesSalvas.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>Nenhuma emissão cadastrada ainda</p></div>';
      count.textContent = "";
      return;
    }

    const mapaPax = construirMapaPax();
    const linhas = aplicarFiltrosEmi(todasLinhasOrdenadas(mapaPax));

    if (linhas.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>Nada encontrado com esses filtros</p></div>';
      count.textContent = "0";
    } else if (filtroListaEmi === "viagem") {
      // Agrupa as linhas (já filtradas) por viagem, mas preserva a ordem original
      // (mais recente primeiro) percorrendo emissoesSalvas — só inclui quem sobrou.
      const linhasPorEmissao = new Map();
      linhas.forEach((l) => {
        if (!linhasPorEmissao.has(l.emissaoId)) linhasPorEmissao.set(l.emissaoId, []);
        linhasPorEmissao.get(l.emissaoId).push(l);
      });
      const emissoesFiltradas = emissoesSalvas.filter((e) => linhasPorEmissao.has(e.id));
      count.textContent = emissoesFiltradas.length + " viagem" + (emissoesFiltradas.length !== 1 ? "ns" : "");
      wrap.innerHTML = emissoesFiltradas.map((e) => renderViagemCard(e, linhasPorEmissao.get(e.id))).join("");
      wrap.querySelectorAll("[data-excluir-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => excluirEmissao(btn.dataset.excluirEmissao)));
      wrap.querySelectorAll("[data-comprovante-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => baixarComprovanteSalvo(btn.dataset.comprovanteEmissao, mapaPax)));
      wrap.querySelectorAll("[data-editar-emissao]").forEach((btn) =>
        btn.addEventListener("click", () => editarEmissao(btn.dataset.editarEmissao)));
    } else if (filtroListaEmi === "cliente") {
      const clientesUnicos = new Set(linhas.map((l) => l.clienteId).filter(Boolean));
      count.textContent = clientesUnicos.size + " cliente" + (clientesUnicos.size !== 1 ? "s" : "");
      wrap.innerHTML = renderPorCliente(linhas);
    } else {
      // Lista mensal (mais recente primeiro), como na planilha antiga.
      count.textContent = linhas.length + " produto" + (linhas.length !== 1 ? "s" : "");
      wrap.innerHTML = renderPorData(linhas);
    }

    wrap.querySelectorAll("[data-excluir-produto]").forEach((btn) =>
      btn.addEventListener("click", () => excluirProduto(btn.dataset.excluirProduto)));
  }

  async function excluirEmissao(id) {
    if (!confirm("Excluir esta viagem e todos os produtos/lançamentos financeiros ligados a ela?")) return;
    try {
      await chamarEmissoes("excluir_emissao", { id });
      await carregarListaEmissoes();
      renderListaEmissoes();
    } catch (err) {
      alert("Erro ao excluir: " + err.message);
    }
  }

  async function excluirProduto(id) {
    if (!confirm("Excluir este produto? Isso também remove o lançamento financeiro gerado por ele.")) return;
    try {
      await chamarEmissoes("excluir_produto", { id });
      await carregarListaEmissoes();
      renderListaEmissoes();
    } catch (err) {
      alert("Erro ao excluir: " + err.message);
    }
  }

  // ===== Init =====
  async function init() {
    setupBuscaCliente();

    const botoesWrap = gel("emi-add-produto-btns");
    botoesWrap.innerHTML = PROD_TIPOS.map((p) => `<button type="button" class="emi-add-btn-inline" data-add-produto="${p.tipo}">${p.icon} ${p.label}</button>`).join("");
    botoesWrap.querySelectorAll("[data-add-produto]").forEach((btn) => btn.addEventListener("click", () => addProduto(btn.dataset.addProduto)));

    gel("emi-salvar-btn").addEventListener("click", salvarEmissao);
    gel("emi-atualizar-btn").addEventListener("click", async () => { await carregarListaEmissoes(); renderListaEmissoes(); });
    gel("emi-cancelar-edicao-btn").addEventListener("click", cancelarEdicao);

    gel("emi-comprovante-nova-btn").addEventListener("click", () => {
      gel("emi-comprovante-wrap").hidden = true;
      gel("emi-form-wrap").hidden = false;
      gel("emi-status").innerHTML = "";
    });
    gel("emi-comprovante-pdf-btn").addEventListener("click", () => {
      if (!comprovanteAtual) return;
      abrirComprovantePDF(montarComprovanteHtml(comprovanteAtual.emissaoInfo, comprovanteAtual.nomesPax, comprovanteAtual.produtosInfo));
    });
    gel("emi-comprovante-copy-btn").addEventListener("click", () => {
      if (!comprovanteAtual) return;
      copiarComprovanteTexto(comprovanteAtual.emissaoInfo, comprovanteAtual.nomesPax, comprovanteAtual.produtosInfo);
      const b = gel("emi-comprovante-copy-btn");
      b.textContent = "✓ Copiado!";
      setTimeout(() => { b.textContent = "Copiar texto"; }, 2000);
    });
    gel("emi-comprovante-contrato-btn").addEventListener("click", enviarParaContrato);

    document.querySelectorAll("[data-filtro-emi]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filtroListaEmi = btn.dataset.filtroEmi;
        document.querySelectorAll("[data-filtro-emi]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderListaEmissoes();
      });
    });

    const filtroMesEl = gel("emi-filtro-mes");
    if (filtroMesEl) {
      filtroMesEl.innerHTML = '<option value="">Todos os meses</option>' +
        gerarOpcoesMeses().map((o) => `<option value="${o.chave}">${escHtml(o.label)}</option>`).join("");
      filtroMesEl.addEventListener("change", () => { filtroMesEmi = filtroMesEl.value; renderListaEmissoes(); });
    }
    const filtroTipoEl = gel("emi-filtro-tipo");
    if (filtroTipoEl) {
      filtroTipoEl.innerHTML = '<option value="">Todos os produtos</option>' +
        PROD_TIPOS.map((p) => `<option value="${p.tipo}">${p.icon} ${escHtml(p.label)}</option>`).join("");
      filtroTipoEl.addEventListener("change", () => { filtroTipoProdutoEmi = filtroTipoEl.value; renderListaEmissoes(); });
    }
    const filtroFuncEl = gel("emi-filtro-funcionaria");
    if (filtroFuncEl) {
      filtroFuncEl.addEventListener("change", () => { filtroFuncionariaEmi = filtroFuncEl.value; renderListaEmissoes(); });
    }
    const filtroNomeEl = gel("emi-filtro-nome");
    if (filtroNomeEl) {
      filtroNomeEl.addEventListener("input", () => { filtroNomeEmi = norm(filtroNomeEl.value.trim()); renderListaEmissoes(); });
    }

    renderPassageiros();
    renderProdutos();

    await Promise.all([carregarClientes(), carregarFornecedores(), carregarVendedores(), carregarEmpresas(), carregarListaEmissoes()]);
    if (filtroFuncEl && vendedoresCache.length > 0) {
      filtroFuncEl.innerHTML = '<option value="">Todas as funcionárias</option>' +
        vendedoresCache.map((f) => `<option value="${escHtml(f.nome)}">${escHtml(f.nome)}</option>`).join("");
    }
    renderListaEmissoes();
  }

  init();
})();
