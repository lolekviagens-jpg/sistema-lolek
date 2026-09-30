// Netlify Function — Kanban (CRM) de Vendas e Suporte, integrado ao Digisac.
//
// FASE 2 (esta): os dois quadros completos — fila compartilhada, classificação obrigatória,
// encerramento obrigatório (com os campos certos por tipo), transferência com histórico,
// Agenda de retomada e configuração dos dias de alerta. Ainda SEM Digisac (isso é a Fase 3) —
// tudo aqui é criado/movido manualmente pela tela.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — mesma usada pelo resto do sistema
//
// IMPORTANTE sobre permissão: assim como todo o resto do sistema, o navegador nunca fala
// direto com o Supabase — sempre passa por aqui. Por isso a garantia "vendedora só vê os
// próprios cards" é aplicada NESTA function, não via RLS do Postgres — mesmo efeito prático,
// já que não existe nenhum caminho do navegador até o banco que não passe por essa checagem.
//
// Tabelas necessárias no Supabase (criar uma vez via SQL Editor, nessa ordem — depois de já
// existir "clientes" e "usuarios"):
//
//   create table kanban_cards (
//     id uuid primary key default gen_random_uuid(),
//     -- NULL = ainda na fila compartilhada, sem classificar. "arquivado" tira da fila sem
//     -- entrar em quadro nenhum (contato de fornecedor, engano, spam — não conta métrica).
//     quadro text check (quadro in ('vendas','suporte')),
//     arquivado boolean not null default false,
//     etapa text not null default 'aguardando_atendimento',
//
//     cliente_id uuid references clientes(id),
//     cliente_nome text,
//     cliente_telefone text,
//
//     -- Vendas
//     tipo text check (tipo in ('nova_viagem','complemento')),
//     destino text,
//     data_ida date,
//     data_volta date,
//     num_passageiros int,
//     valor_estimado numeric(12,2),
//     origem_lead text,
//     segmento text check (segmento in ('B2C','B2B','Grupo')),
//
//     -- Suporte
//     motivo_suporte text,
//     momento_viagem text check (momento_viagem in ('antes_embarque','em_viagem','pos_viagem')),
//     prioridade text check (prioridade in ('normal','urgente','emergencia')),
//     venda_vinculada_id uuid references kanban_cards(id),
//     descricao_caso text,
//
//     -- Comuns
//     responsavel_id uuid references usuarios(id),
//     proxima_acao_texto text,
//     proxima_acao_data date,
//     anotacoes text,
//
//     -- Encerramento — Vendas: venda_concluida | oportunidade_futura | venda_nao_realizada.
//     -- Suporte: resolvido.
//     encerramento_tipo text,
//     encerramento_valor_total numeric(12,2),
//     encerramento_produtos jsonb,
//     encerramento_data_retomada date,
//     encerramento_obs text,
//     encerramento_motivo_perda text,
//     resolucao_texto text,
//     resolucao_gerou_custo boolean,
//     resolucao_valor_custo numeric(12,2),
//     resolucao_gerou_venda boolean,
//
//     -- Digisac (usado a partir da Fase 3 — colunas já prontas)
//     digisac_ticket_id text unique,
//     digisac_contact_id text,
//
//     -- Tempos (pro painel de métricas da Fase 4)
//     criado_em timestamptz not null default now(),
//     etapa_desde timestamptz not null default now(), -- só muda quando a ETAPA muda (não em
//                                                       -- qualquer edição) — é o que alimenta
//                                                       -- o alerta de "card parado há X dias"
//     assumido_em timestamptz,
//     primeira_resposta_em timestamptz,
//     proposta_enviada_em timestamptz,
//     aguardando_fornecedor_desde timestamptz,
//     aguardando_fornecedor_acumulado_min int not null default 0,
//     encerrado_em timestamptz,
//     atualizado_em timestamptz not null default now()
//   );
//   alter table kanban_cards enable row level security;
//
//   -- Se a tabela já existia da Fase 1 (quadro era "not null"), rodar uma vez:
//   alter table kanban_cards alter column quadro drop not null;
//   alter table kanban_cards add column if not exists arquivado boolean not null default false;
//   alter table kanban_cards add column if not exists etapa_desde timestamptz not null default now();
//
//   create table kanban_card_eventos (
//     id uuid primary key default gen_random_uuid(),
//     card_id uuid not null references kanban_cards(id) on delete cascade,
//     tipo text not null, -- criado | assumido | classificado | movido | transferido | encerrado | reaberto | arquivado
//     de_etapa text,
//     para_etapa text,
//     usuario_nome text,
//     motivo text,
//     criado_em timestamptz not null default now()
//   );
//   alter table kanban_card_eventos enable row level security;
//
//   create table kanban_config (
//     chave text primary key,
//     valor jsonb not null
//   );
//   alter table kanban_config enable row level security;

const { supabaseRest, validarSessao, tokenDoEvento, registrarAtividade } = require("./_auth");

const QUADROS = new Set(["vendas", "suporte"]);
const ETAPAS_VENDAS  = new Set(["em_cotacao", "proposta_enviada", "encerrado"]);
const ETAPAS_SUPORTE = new Set(["em_atendimento", "aguardando_fornecedor", "aguardando_cliente", "resolvido"]);
const MOTIVOS_PERDA = new Set([
  "preco_alto", "comprou_outra_agencia", "desistiu_sem_data", "parou_responder",
  "sem_disponibilidade", "documentacao", "outro",
]);
const PRODUTOS_VENDA = new Set([
  "passagem_aerea", "hospedagem", "seguro", "aluguel_carro", "passeio", "assessoria_visto", "pacote",
]);

const CONFIG_PADRAO = { dias_alerta_amarelo: 2, dias_alerta_vermelho: 5 };

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return json(500, { error: "SUPABASE_SECRET_KEY não configurada no Netlify" });
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "JSON inválido" }); }

  const { action, data } = payload;
  const d = data || {};

  // Todo o Kanban exige login — não faz sentido nenhuma leitura/escrita sem saber quem é.
  const sessao = await validarSessao(tokenDoEvento(event), secretKey);
  if (!sessao.valido) {
    return json(401, { error: "Sessão expirada — faça login novamente." });
  }

  try {
    switch (action) {
      case "listar_fila":            return json(200, await listarFila(sessao, secretKey));
      case "listar_cards":           return json(200, await listarCards(d, sessao, secretKey));
      case "listar_agenda_retomada": return json(200, await listarAgendaRetomada(d, sessao, secretKey));
      case "listar_eventos":         return json(200, await listarEventos(d, secretKey));
      case "criar_card":             return json(200, await criarCard(d, sessao, secretKey));
      case "classificar_card":       return json(200, await classificarCard(d, sessao, secretKey));
      case "atualizar_card":         return json(200, await atualizarCard(d, sessao, secretKey));
      case "transferir_card":        return json(200, await transferirCard(d, sessao, secretKey));
      case "encerrar_card":          return json(200, await encerrarCard(d, sessao, secretKey));
      case "obter_config":           return json(200, await obterConfig(secretKey));
      case "salvar_config":          return json(200, await salvarConfig(d, sessao, secretKey));
      case "listar_digisac_log":     return json(200, await listarDigisacLog(sessao, secretKey));
      default: return json(400, { error: "Ação desconhecida: " + action });
    }
  } catch (err) {
    console.error("[kanban] erro:", err.message);
    return json(400, { error: err.message });
  }
};

function validarQuadro(quadro) {
  if (!QUADROS.has(quadro)) throw new Error('Quadro inválido — use "vendas" ou "suporte"');
}

async function carregarCard(id, secretKey) {
  const [card] = await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(id) + "&select=*", "GET", secretKey);
  if (!card) throw new Error("Card não encontrado");
  return card;
}

// Vê e mexe: admin sempre; vendedora só se o card é dela ou ainda está na fila (sem dono).
function podeAcessar(card, sessao) {
  return sessao.admin || !card.responsavel_id || card.responsavel_id === sessao.usuarioId;
}

// ===== Fila compartilhada (sem classificar ainda) — igual pra Vendas e Suporte =====
async function listarFila(sessao, secretKey) {
  const rows = await supabaseRest(
    "/kanban_cards?select=*&quadro=is.null&arquivado=eq.false&order=criado_em.asc",
    "GET", secretKey
  );
  return rows || [];
}

// Cards já classificados de um quadro — vendedora só os próprios, admin tudo (com filtro
// opcional por vendedora específica).
async function listarCards(d, sessao, secretKey) {
  validarQuadro(d.quadro);
  let filtro = "quadro=eq." + encodeURIComponent(d.quadro);
  if (sessao.admin) {
    if (d.funcionaria_id) filtro += "&responsavel_id=eq." + encodeURIComponent(d.funcionaria_id);
  } else {
    filtro += "&responsavel_id=eq." + sessao.usuarioId;
  }
  const rows = await supabaseRest("/kanban_cards?select=*&" + filtro + "&order=criado_em.desc", "GET", secretKey);
  return rows || [];
}

// Oportunidades futuras — filtrável por período e por vendedora (admin) ou só as próprias
// (vendedora).
async function listarAgendaRetomada(d, sessao, secretKey) {
  let filtro = "quadro=eq.vendas&encerramento_tipo=eq.oportunidade_futura";
  if (d.de) filtro += "&encerramento_data_retomada=gte." + encodeURIComponent(d.de);
  if (d.ate) filtro += "&encerramento_data_retomada=lte." + encodeURIComponent(d.ate);
  if (!sessao.admin) filtro += "&responsavel_id=eq." + sessao.usuarioId;
  else if (d.funcionaria_id) filtro += "&responsavel_id=eq." + encodeURIComponent(d.funcionaria_id);
  const rows = await supabaseRest("/kanban_cards?select=*&" + filtro + "&order=encerramento_data_retomada.asc", "GET", secretKey);
  return rows || [];
}

async function listarEventos(d, secretKey) {
  if (!d.card_id) throw new Error("card_id é obrigatório");
  const rows = await supabaseRest(
    "/kanban_card_eventos?card_id=eq." + encodeURIComponent(d.card_id) + "&select=*&order=criado_em.asc",
    "GET", secretKey
  );
  return rows || [];
}

// Cria um card na FILA (ainda sem quadro) — usado tanto pra cadastro manual (Fase 2) quanto,
// na Fase 3, pelo webhook do Digisac quando chega um chamado novo.
async function criarCard(d, sessao, secretKey) {
  const card = {
    cliente_id: d.cliente_id || null,
    cliente_nome: d.cliente_nome || null,
    cliente_telefone: d.cliente_telefone || null,
    digisac_ticket_id: d.digisac_ticket_id || null,
    digisac_contact_id: d.digisac_contact_id || null,
    etapa: "aguardando_atendimento",
  };
  const [criado] = await supabaseRest("/kanban_cards", "POST", secretKey, card);
  await registrarEvento(secretKey, criado.id, "criado", { usuarioNome: sessao.nome });
  return criado;
}

// Ao assumir um card da fila, a classificação é obrigatória — isso é o que decide o quadro
// (ou arquiva, se for "outro contato" que não é lead nem suporte).
async function classificarCard(d, sessao, secretKey) {
  if (!d.id) throw new Error("id é obrigatório");
  const atual = await carregarCard(d.id, secretKey);
  if (atual.quadro || atual.arquivado) throw new Error("Esse card já foi classificado.");

  const agora = new Date().toISOString();

  if (d.classificacao === "outros") {
    await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey,
      { arquivado: true, responsavel_id: sessao.usuarioId, assumido_em: agora, atualizado_em: agora },
      { "Prefer": "return=minimal" });
    await registrarEvento(secretKey, d.id, "arquivado", { usuarioNome: sessao.nome, motivo: d.observacao || null });
    return { ok: true };
  }

  const patch = { responsavel_id: sessao.usuarioId, assumido_em: agora, atualizado_em: agora, etapa_desde: agora };
  if (d.cliente_id) patch.cliente_id = d.cliente_id;

  if (d.classificacao === "nova_viagem" || d.classificacao === "complemento") {
    patch.quadro = "vendas";
    patch.etapa = "em_cotacao";
    patch.tipo = d.classificacao;
    patch.destino = d.destino || null;
    patch.data_ida = d.data_ida || null;
    patch.data_volta = d.data_volta || null;
    patch.num_passageiros = d.num_passageiros || null;
    patch.valor_estimado = d.valor_estimado || null;
    patch.origem_lead = d.origem_lead || null;
    patch.segmento = d.segmento || null;
  } else if (d.classificacao === "suporte") {
    // Motivo NÃO é obrigatório aqui — o momento de classificar é só decidir "isso é
    // suporte" (sai da fila, fica com quem assumiu); o motivo específico dá pra preencher
    // depois, quando for realmente atender o caso.
    patch.quadro = "suporte";
    patch.etapa = "em_atendimento";
    patch.motivo_suporte = d.motivo_suporte || null;
    patch.momento_viagem = d.momento_viagem || null;
    patch.prioridade = d.prioridade || "normal";
    patch.venda_vinculada_id = d.venda_vinculada_id || null;
    patch.descricao_caso = d.descricao_caso || null;
  } else {
    throw new Error("Classificação inválida.");
  }

  await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey, patch, { "Prefer": "return=minimal" });
  await registrarEvento(secretKey, d.id, "classificado", { usuarioNome: sessao.nome, paraEtapa: patch.etapa, motivo: patch.quadro });
  return { ok: true };
}

// Edição geral do card já classificado — mover de etapa (arrastar-e-soltar cai aqui),
// atualizar campos, marcar próxima ação etc. Encerramento e transferência têm ação própria
// (regras específicas — não passam por aqui).
async function atualizarCard(d, sessao, secretKey) {
  if (!d.id) throw new Error("id é obrigatório");
  const atual = await carregarCard(d.id, secretKey);
  if (!podeAcessar(atual, sessao)) throw new Error("Esse card já está com outra pessoa.");
  if (!atual.quadro) throw new Error("Classifique o card antes de editar.");

  const etapasValidas = atual.quadro === "vendas" ? ETAPAS_VENDAS : ETAPAS_SUPORTE;
  if (d.etapa != null && d.etapa !== "encerrado" && d.etapa !== "resolvido" && !etapasValidas.has(d.etapa)) {
    throw new Error("Etapa inválida pra esse quadro.");
  }
  if (d.etapa === "encerrado" || d.etapa === "resolvido") {
    throw new Error("Use a ação de encerrar (com o motivo/resultado obrigatório), não mover direto pra essa etapa.");
  }

  const patch = { atualizado_em: new Date().toISOString() };
  const camposPermitidos = [
    "etapa", "destino", "data_ida", "data_volta", "num_passageiros", "valor_estimado",
    "origem_lead", "segmento", "proxima_acao_texto", "proxima_acao_data", "anotacoes",
    "motivo_suporte", "momento_viagem", "prioridade", "descricao_caso", "venda_vinculada_id",
  ];
  camposPermitidos.forEach((c) => { if (d[c] !== undefined) patch[c] = d[c]; });

  // Controla o tempo acumulado em "Aguardando fornecedor" (descontado do tempo de
  // resolução do suporte) — fecha o intervalo ao SAIR dessa etapa, abre um novo ao ENTRAR.
  if (atual.etapa === "aguardando_fornecedor" && patch.etapa && patch.etapa !== "aguardando_fornecedor" && atual.aguardando_fornecedor_desde) {
    const minutos = Math.round((Date.now() - new Date(atual.aguardando_fornecedor_desde).getTime()) / 60000);
    patch.aguardando_fornecedor_acumulado_min = (atual.aguardando_fornecedor_acumulado_min || 0) + Math.max(0, minutos);
    patch.aguardando_fornecedor_desde = null;
  }
  if (patch.etapa === "aguardando_fornecedor" && atual.etapa !== "aguardando_fornecedor") {
    patch.aguardando_fornecedor_desde = new Date().toISOString();
  }
  if (patch.etapa === "proposta_enviada" && !atual.proposta_enviada_em) {
    patch.proposta_enviada_em = new Date().toISOString();
  }

  const mudouEtapa = patch.etapa && patch.etapa !== atual.etapa;
  if (mudouEtapa) patch.etapa_desde = patch.atualizado_em;

  await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey, patch, { "Prefer": "return=minimal" });
  if (mudouEtapa) {
    await registrarEvento(secretKey, d.id, "movido", { usuarioNome: sessao.nome, deEtapa: atual.etapa, paraEtapa: patch.etapa });
  }
  return { ok: true };
}

async function transferirCard(d, sessao, secretKey) {
  if (!d.id || !d.para_usuario_id) throw new Error("id e para_usuario_id são obrigatórios");
  if (!d.motivo) throw new Error("Informe o motivo da transferência.");
  const atual = await carregarCard(d.id, secretKey);
  if (!podeAcessar(atual, sessao)) throw new Error("Esse card já está com outra pessoa.");

  await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey,
    { responsavel_id: d.para_usuario_id, atualizado_em: new Date().toISOString() },
    { "Prefer": "return=minimal" });
  await registrarEvento(secretKey, d.id, "transferido", { usuarioNome: sessao.nome, motivo: d.motivo });
  return { ok: true };
}

// Encerramento — nenhum card sai do quadro sem os campos obrigatórios certos pro tipo.
// Confere aqui de novo (mesmo já validando na tela) — é a garantia de verdade, já que quem
// manda os dados é o navegador, e a tela pode ter bug ou alguém tentar contornar.
async function encerrarCard(d, sessao, secretKey) {
  if (!d.id) throw new Error("id é obrigatório");
  const atual = await carregarCard(d.id, secretKey);
  if (!podeAcessar(atual, sessao)) throw new Error("Esse card já está com outra pessoa.");
  if (!atual.quadro) throw new Error("Classifique o card antes de encerrar.");

  const agora = new Date().toISOString();
  const patch = { atualizado_em: agora, encerrado_em: agora, etapa_desde: agora };

  if (atual.quadro === "vendas") {
    if (!["venda_concluida", "oportunidade_futura", "venda_nao_realizada"].includes(d.encerramento_tipo)) {
      throw new Error("Selecione o resultado do encerramento.");
    }
    patch.etapa = "encerrado";
    patch.encerramento_tipo = d.encerramento_tipo;

    if (d.encerramento_tipo === "venda_concluida") {
      if (!(Number(d.encerramento_valor_total) > 0)) throw new Error("Informe o valor total da venda.");
      const produtos = Array.isArray(d.encerramento_produtos) ? d.encerramento_produtos : [];
      if (produtos.length === 0 || produtos.some((p) => !PRODUTOS_VENDA.has(p))) throw new Error("Selecione ao menos um produto vendido.");
      patch.encerramento_valor_total = Number(d.encerramento_valor_total);
      patch.encerramento_produtos = produtos;
    } else if (d.encerramento_tipo === "oportunidade_futura") {
      if (!d.encerramento_data_retomada) throw new Error("Informe a data de retomada.");
      if (!d.encerramento_obs) throw new Error("Informe uma observação da retomada.");
      patch.encerramento_data_retomada = d.encerramento_data_retomada;
      patch.encerramento_obs = d.encerramento_obs;
    } else if (d.encerramento_tipo === "venda_nao_realizada") {
      if (!MOTIVOS_PERDA.has(d.encerramento_motivo_perda)) throw new Error("Selecione o motivo.");
      if (d.encerramento_motivo_perda === "outro" && !d.encerramento_obs) throw new Error('Descreva o motivo em "Outro".');
      patch.encerramento_motivo_perda = d.encerramento_motivo_perda;
      patch.encerramento_obs = d.encerramento_obs || null;
    }
  } else {
    // Suporte
    if (!d.resolucao_texto) throw new Error("Descreva como foi resolvido.");
    if (d.resolucao_gerou_custo == null) throw new Error('Informe se gerou custo (Sim/Não).');
    if (d.resolucao_gerou_custo && !(Number(d.resolucao_valor_custo) > 0)) throw new Error("Informe o valor do custo gerado.");
    if (d.resolucao_gerou_venda == null) throw new Error('Informe se gerou nova venda (Sim/Não).');

    patch.etapa = "resolvido";
    patch.encerramento_tipo = "resolvido";
    patch.resolucao_texto = d.resolucao_texto;
    patch.resolucao_gerou_custo = !!d.resolucao_gerou_custo;
    patch.resolucao_valor_custo = d.resolucao_gerou_custo ? Number(d.resolucao_valor_custo) : null;
    patch.resolucao_gerou_venda = !!d.resolucao_gerou_venda;

    // Fecha um "aguardando fornecedor" que porventura tenha ficado aberto, pro tempo de
    // resolução não ficar contando o descanso indevidamente.
    if (atual.etapa === "aguardando_fornecedor" && atual.aguardando_fornecedor_desde) {
      const minutos = Math.round((Date.now() - new Date(atual.aguardando_fornecedor_desde).getTime()) / 60000);
      patch.aguardando_fornecedor_acumulado_min = (atual.aguardando_fornecedor_acumulado_min || 0) + Math.max(0, minutos);
      patch.aguardando_fornecedor_desde = null;
    }
  }

  await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey, patch, { "Prefer": "return=minimal" });
  await registrarEvento(secretKey, d.id, "encerrado", { usuarioNome: sessao.nome, deEtapa: atual.etapa, paraEtapa: patch.etapa });
  await registrarAtividade(secretKey, { usuarioNome: sessao.nome, acao: "editar", area: "kanban", descricao: "Encerrou card — " + patch.encerramento_tipo, registroId: d.id });

  // Suporte que gerou venda: cria um card já em Vendas como Complemento, ligado ao cliente
  // e ao mesmo caso de suporte (pra ela não ter que copiar os dados na mão).
  let novoCardVendaId = null;
  if (atual.quadro === "suporte" && patch.resolucao_gerou_venda) {
    const [novo] = await supabaseRest("/kanban_cards", "POST", secretKey, {
      quadro: "vendas", etapa: "em_cotacao", tipo: "complemento",
      cliente_id: atual.cliente_id, cliente_nome: atual.cliente_nome, cliente_telefone: atual.cliente_telefone,
      responsavel_id: sessao.usuarioId, assumido_em: agora,
      venda_vinculada_id: atual.id, origem_lead: "Suporte",
    });
    novoCardVendaId = novo.id;
    await registrarEvento(secretKey, novo.id, "criado", { usuarioNome: sessao.nome, motivo: "Gerado a partir do suporte #" + atual.id });
    // Guarda a referência também no card de suporte original, nos dois sentidos.
    await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(atual.id), "PATCH", secretKey,
      { venda_vinculada_id: novo.id }, { "Prefer": "return=minimal" });
  }

  return { ok: true, novo_card_venda_id: novoCardVendaId };
}

async function obterConfig(secretKey) {
  const rows = await supabaseRest("/kanban_config?chave=eq.alertas&select=valor", "GET", secretKey);
  return (rows && rows[0] && rows[0].valor) || CONFIG_PADRAO;
}

async function salvarConfig(d, sessao, secretKey) {
  if (!sessao.admin) throw new Error("Só a administradora pode alterar essa configuração.");
  const valor = {
    dias_alerta_amarelo: Number(d.dias_alerta_amarelo) || CONFIG_PADRAO.dias_alerta_amarelo,
    dias_alerta_vermelho: Number(d.dias_alerta_vermelho) || CONFIG_PADRAO.dias_alerta_vermelho,
  };
  await supabaseRest("/kanban_config", "POST", secretKey, { chave: "alertas", valor },
    { "Prefer": "resolution=merge-duplicates,return=minimal" });
  return valor;
}

// Últimos payloads recebidos do Digisac (Fase 3, descoberta dos eventos) — só admin, só
// leitura, pra não precisar abrir o Supabase pra ver o que chegou.
async function listarDigisacLog(sessao, secretKey) {
  if (!sessao.admin) throw new Error("Só a administradora pode ver isso.");
  const rows = await supabaseRest("/kanban_digisac_log?select=*&order=recebido_em.desc&limit=20", "GET", secretKey);
  return rows || [];
}

async function registrarEvento(secretKey, cardId, tipo, { usuarioNome, deEtapa, paraEtapa, motivo } = {}) {
  await supabaseRest("/kanban_card_eventos", "POST", secretKey, {
    card_id: cardId, tipo, de_etapa: deEtapa || null, para_etapa: paraEtapa || null,
    usuario_nome: usuarioNome || null, motivo: motivo || null,
  }, { "Prefer": "return=minimal" }).catch((err) => console.error("[kanban] falha ao registrar evento:", err.message));
}

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
