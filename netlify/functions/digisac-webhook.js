// Netlify Function — recebe os webhooks da Digisac e alimenta o Kanban (Fase 3).
//
// Eventos confirmados na prática (testando com a conta real da Lolek — a documentação
// pública da Digisac não detalhava isso):
//   ticket.created — chamado novo. data.userId é null quando cai na fila (sem responsável);
//                    data.contact tem os dados do cliente (nome, telefone).
//   ticket.updated — qualquer mudança no chamado: quando alguém assume ou quando é
//                    transferido, data.userId muda; quando fecha no Digisac, data.isOpen
//                    vira false (a gente IGNORA isso — fechar no Digisac não encerra o card
//                    aqui, só a vendedora encerra, com o motivo obrigatório).
//   message.created — toda mensagem do chamado. isFromMe:true + type:"chat" é mensagem da
//                    ATENDENTE (não do cliente) — é o que vira "primeira resposta".
//                    type:"ticket" é um espelho sintético de ticket.created/updated —
//                    ignorado aqui pra não processar a mesma coisa duas vezes.
//   contact.updated, kanbanCard.updated — ignorados (kanbanCard é o funil PRÓPRIO da
//                    Digisac, sem relação com o nosso).
//
// Variáveis de ambiente necessárias no painel do Netlify:
//   SUPABASE_SECRET_KEY     — mesma do resto do sistema
//   DIGISAC_WEBHOOK_SECRET  — senha só nossa, vai na URL do webhook (?secret=...)
//
// Tabela de log (guarda TODO evento cru recebido, útil pra investigar qualquer coisa depois):
//   create table kanban_digisac_log (
//     id uuid primary key default gen_random_uuid(),
//     evento text,
//     corpo jsonb not null,
//     recebido_em timestamptz not null default now()
//   );
//   alter table kanban_digisac_log enable row level security;

const { supabaseRest } = require("./_auth");

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const segredoEsperado = process.env.DIGISAC_WEBHOOK_SECRET;

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!secretKey) return { statusCode: 500, body: "SUPABASE_SECRET_KEY não configurada" };
  // Fail-closed: sem o segredo configurado no Netlify, RECUSA tudo — nunca aceita "de graça"
  // só porque a variável ainda não chegou na function (foi o que aconteceu na 1ª tentativa:
  // a variável não tinha propagado ainda e a checagem antiga deixava passar sem querer).
  if (!segredoEsperado) return { statusCode: 500, body: "DIGISAC_WEBHOOK_SECRET não configurado" };

  const params = event.queryStringParameters || {};
  if (params.secret !== segredoEsperado) {
    console.warn("[digisac-webhook] chamada rejeitada — secret não bate");
    return { statusCode: 401, body: "unauthorized" };
  }

  let corpo;
  try { corpo = JSON.parse(event.body || "{}"); }
  catch { corpo = { _bruto: event.body || "" }; }

  // Nunca deixa um erro de processamento derrubar a resposta — a Digisac espera resposta em
  // até 5s e REENVIA se não responder, o que duplicaria tudo. Loga e responde 200 de qualquer
  // jeito; o log cru serve pra investigar se algo saiu errado.
  try {
    await supabaseRest("/kanban_digisac_log", "POST", secretKey,
      { evento: corpo.event || null, corpo }, { "Prefer": "return=minimal" });
  } catch (err) {
    console.error("[digisac-webhook] falha ao salvar log:", err.message);
  }

  try {
    await processarEvento(corpo, secretKey);
  } catch (err) {
    console.error("[digisac-webhook] falha ao processar evento " + (corpo.event || "?") + ":", err.message);
  }

  return { statusCode: 200, body: "ok" };
};

async function processarEvento(corpo, secretKey) {
  const tipo = corpo.event;
  const d = corpo.data || {};

  if (tipo === "ticket.created") return tratarTicketCriado(d, secretKey);
  if (tipo === "ticket.updated") return tratarTicketAtualizado(d, secretKey);
  if (tipo === "message.created" && d.type === "chat") return tratarMensagem(d, secretKey);
  // contact.updated, kanbanCard.updated, message.created do tipo "ticket" (espelho
  // sintético) — sem ação nossa.
}

async function buscarCardPorTicket(ticketId, secretKey) {
  const rows = await supabaseRest(
    "/kanban_cards?digisac_ticket_id=eq." + encodeURIComponent(ticketId) + "&select=*",
    "GET", secretKey
  );
  return (rows && rows[0]) || null;
}

// Novo chamado → entra na fila compartilhada (quadro null), igual um cadastro manual. Se por
// algum motivo o mesmo ticket chegar de novo (reenvio da Digisac), "on_conflict" ignora —
// nunca duplica card pro mesmo chamado.
async function tratarTicketCriado(d, secretKey) {
  if (!d.id) return;
  const contato = d.contact || {};
  await supabaseRest(
    "/kanban_cards?on_conflict=digisac_ticket_id", "POST", secretKey,
    {
      digisac_ticket_id: d.id,
      digisac_contact_id: contato.id || null,
      cliente_nome: contato.name || contato.alternativeName || null,
      cliente_telefone: (contato.data && contato.data.number) || null,
      etapa: "aguardando_atendimento",
    },
    { "Prefer": "return=minimal,resolution=ignore-duplicates" }
  );
}

// Assumiu ou foi transferido no próprio Digisac — sincroniza o responsável aqui, sem exigir
// que a vendedora faça nada na nossa tela (só a classificação continua manual, quando ela
// abrir o card). Só age se der pra mapear o userId da Digisac pra uma usuária cadastrada
// (campo "ID no Digisac" em Usuários) — sem isso, ignora silenciosamente (fica só a fila).
async function tratarTicketAtualizado(d, secretKey) {
  if (!d.id) return;
  const card = await buscarCardPorTicket(d.id, secretKey);
  if (!card) return; // chamado de antes desta integração existir, ou ainda não sincronizado

  if (d.userId) {
    const [usuario] = await supabaseRest(
      "/usuarios?digisac_user_id=eq." + encodeURIComponent(d.userId) + "&select=id,nome", "GET", secretKey
    );
    if (usuario && usuario.id !== card.responsavel_id) {
      const eraSemDono = !card.responsavel_id;
      const patch = { responsavel_id: usuario.id, atualizado_em: new Date().toISOString() };
      if (eraSemDono) patch.assumido_em = new Date().toISOString();
      await supabaseRest("/kanban_cards?id=eq." + card.id, "PATCH", secretKey, patch, { "Prefer": "return=minimal" });
      await supabaseRest("/kanban_card_eventos", "POST", secretKey, {
        card_id: card.id,
        tipo: eraSemDono ? "assumido" : "transferido",
        motivo: eraSemDono ? "Assumido no Digisac" : "Transferido no Digisac",
        usuario_nome: usuario.nome,
      }, { "Prefer": "return=minimal" });
    }
  }
  // Fechar o chamado no Digisac (isOpen:false) NÃO encerra o card aqui — de propósito
  // (só a vendedora encerra, com o resultado obrigatório).
}

// Mensagem da ATENDENTE (isFromMe:true, type:"chat") — primeira depois de assumir vira o
// "tempo de primeira resposta" (métrica da Fase 4). Só grava a primeira; as próximas não
// mexem em nada.
async function tratarMensagem(d, secretKey) {
  if (!d.isFromMe || !d.ticketId) return;
  const card = await buscarCardPorTicket(d.ticketId, secretKey);
  if (!card || card.primeira_resposta_em) return;
  await supabaseRest("/kanban_cards?id=eq." + card.id, "PATCH", secretKey,
    { primeira_resposta_em: d.createdAt || new Date().toISOString() },
    { "Prefer": "return=minimal" });
}
