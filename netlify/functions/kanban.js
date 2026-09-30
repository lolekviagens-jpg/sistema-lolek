// Netlify Function — Kanban (CRM) de Vendas e Suporte, integrado ao Digisac.
//
// FASE 1 (esta): só a base — tabelas, e o controle de permissão admin × vendedora.
// A lógica completa de card (classificação, encerramento obrigatório, transferência,
// integração com o Digisac) entra nas próximas fases, sobre esta mesma base.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — mesma usada pelo resto do sistema
//
// IMPORTANTE sobre permissão: assim como todo o resto do sistema, o navegador nunca fala
// direto com o Supabase — sempre passa por aqui. Por isso a garantia "vendedora só vê os
// próprios cards" é aplicada NESTA function (não é RLS do Postgres, mas tem o mesmo efeito
// prático: não existe nenhum caminho do navegador até o banco que não passe por essa
// checagem). Ver README/decisão registrada na conversa sobre login do Kanban.
//
// Tabelas necessárias no Supabase (criar uma vez via SQL Editor, nessa ordem — depois de já
// existir "clientes" e "usuarios"):
//
//   create table kanban_cards (
//     id uuid primary key default gen_random_uuid(),
//     quadro text not null check (quadro in ('vendas','suporte')),
//     etapa text not null default 'aguardando_atendimento',
//
//     -- Cliente (linkado quando já é cadastrado; nome/telefone soltos quando ainda não é)
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
//     -- Encerramento (Vendas: venda_concluida | oportunidade_futura | venda_nao_realizada —
//     -- Suporte: resolvido)
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
//     -- Digisac
//     digisac_ticket_id text unique, -- evita 2 cards pro mesmo chamado
//     digisac_contact_id text,
//
//     -- Tempos (pro painel de métricas da Fase 4)
//     criado_em timestamptz not null default now(),        -- chegou na fila
//     assumido_em timestamptz,                              -- alguém assumiu
//     primeira_resposta_em timestamptz,                     -- 1ª mensagem da atendente
//     proposta_enviada_em timestamptz,                      -- vendas: foi pra "Proposta enviada"
//     aguardando_fornecedor_desde timestamptz,               -- suporte: entrou nessa etapa agora
//     aguardando_fornecedor_acumulado_min int not null default 0, -- soma de todas as vezes
//     encerrado_em timestamptz,
//     atualizado_em timestamptz not null default now()
//   );
//   alter table kanban_cards enable row level security;
//
//   create table kanban_card_eventos ( -- histórico automático de cada card
//     id uuid primary key default gen_random_uuid(),
//     card_id uuid not null references kanban_cards(id) on delete cascade,
//     tipo text not null, -- criado | assumido | movido | transferido | encerrado | reaberto
//     de_etapa text,
//     para_etapa text,
//     usuario_nome text,
//     motivo text,
//     criado_em timestamptz not null default now()
//   );
//   alter table kanban_card_eventos enable row level security;
//
//   create table kanban_config ( -- configurações do admin (dias de alerta, horário de
//     chave text primary key,    -- atendimento etc. — usado a partir da Fase 2/4)
//     valor jsonb not null
//   );
//   alter table kanban_config enable row level security;

const { supabaseRest, validarSessao, tokenDoEvento, registrarAtividade } = require("./_auth");

const QUADROS = new Set(["vendas", "suporte"]);

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "JSON inválido" }); }

  const { action, data } = payload;
  const d = data || {};

  // Todo o Kanban exige login (diferente de Emissões, que tem ações públicas) — não faz
  // sentido nenhuma leitura/escrita de card sem saber quem é a pessoa.
  const sessao = await validarSessao(tokenDoEvento(event), secretKey);
  if (!sessao.valido) {
    return json(401, { error: "Sessão expirada — faça login novamente." });
  }

  try {
    if (action === "listar_cards") return json(200, await listarCards(d, sessao, secretKey));
    if (action === "criar_card") return json(200, await criarCard(d, sessao, secretKey));
    if (action === "atualizar_card") return json(200, await atualizarCard(d, sessao, secretKey));
    return json(400, { error: "Ação desconhecida: " + action });
  } catch (err) {
    console.error("[kanban] erro:", err.message);
    return json(500, { error: err.message });
  }
};

function validarQuadro(quadro) {
  if (!QUADROS.has(quadro)) throw new Error('Quadro inválido — use "vendas" ou "suporte"');
}

// Vendedora vê a fila (sem responsável) + só os próprios cards. Admin vê tudo do quadro,
// com filtro opcional por vendedora (pra conferir o quadro de uma pessoa específica).
async function listarCards(d, sessao, secretKey) {
  validarQuadro(d.quadro);
  let filtro = "quadro=eq." + encodeURIComponent(d.quadro);

  if (sessao.admin) {
    if (d.funcionaria_id) filtro += "&responsavel_id=eq." + encodeURIComponent(d.funcionaria_id);
  } else {
    // "or" do PostgREST: fila (sem responsável) OU responsável = eu mesma.
    filtro += "&or=(responsavel_id.eq." + sessao.usuarioId + ",responsavel_id.is.null)";
  }

  const rows = await supabaseRest(
    "/kanban_cards?select=*&" + filtro + "&order=criado_em.desc",
    "GET", secretKey
  );
  return rows || [];
}

async function criarCard(d, sessao, secretKey) {
  validarQuadro(d.quadro);
  const [card] = await supabaseRest("/kanban_cards", "POST", secretKey, {
    quadro: d.quadro,
    etapa: d.etapa || "aguardando_atendimento",
    cliente_id: d.cliente_id || null,
    cliente_nome: d.cliente_nome || null,
    cliente_telefone: d.cliente_telefone || null,
    tipo: d.tipo || null,
    destino: d.destino || null,
    origem_lead: d.origem_lead || null,
    segmento: d.segmento || null,
    motivo_suporte: d.motivo_suporte || null,
    momento_viagem: d.momento_viagem || null,
    prioridade: d.prioridade || "normal",
    descricao_caso: d.descricao_caso || null,
    digisac_ticket_id: d.digisac_ticket_id || null,
    digisac_contact_id: d.digisac_contact_id || null,
  });
  await registrarEvento(secretKey, card.id, "criado", { usuarioNome: sessao.nome });
  await registrarAtividade(secretKey, { usuarioNome: sessao.nome, acao: "criar", area: "kanban", descricao: (d.quadro || "") + " — " + (d.cliente_nome || "sem nome"), registroId: card.id });
  return card;
}

// Só permite mexer num card que é da fila (ninguém assumiu) ou que já é seu — vendedora não
// consegue editar o card de uma colega por aqui (nem soltando "admin:true" no payload, já
// que quem manda é a sessão validada no servidor, não o que o navegador manda).
async function atualizarCard(d, sessao, secretKey) {
  if (!d.id) throw new Error("id é obrigatório");
  const [atual] = await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id) + "&select=*", "GET", secretKey);
  if (!atual) throw new Error("Card não encontrado");

  const podeMexer = sessao.admin || !atual.responsavel_id || atual.responsavel_id === sessao.usuarioId;
  if (!podeMexer) throw new Error("Esse card já está com outra pessoa.");

  const patch = { atualizado_em: new Date().toISOString() };
  const camposPermitidos = [
    "etapa", "responsavel_id", "destino", "data_ida", "data_volta", "num_passageiros",
    "valor_estimado", "origem_lead", "segmento", "proxima_acao_texto", "proxima_acao_data",
    "anotacoes", "momento_viagem", "prioridade", "descricao_caso",
  ];
  camposPermitidos.forEach((c) => { if (d[c] !== undefined) patch[c] = d[c]; });

  // Primeira vez que alguém assume (sai da fila) — carimba o horário, usado no tempo de fila.
  if (patch.responsavel_id && !atual.responsavel_id) patch.assumido_em = new Date().toISOString();

  await supabaseRest("/kanban_cards?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey, patch, { "Prefer": "return=minimal" });

  if (patch.etapa && patch.etapa !== atual.etapa) {
    await registrarEvento(secretKey, d.id, "movido", { usuarioNome: sessao.nome, deEtapa: atual.etapa, paraEtapa: patch.etapa });
  }
  return { ok: true };
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
