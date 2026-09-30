// Netlify Function — recebe os webhooks da Digisac (Kanban, Fase 3).
//
// AINDA EM MODO DE DESCOBERTA: a documentação pública da Digisac não deixa claro o nome
// exato dos eventos de "chamado aberto"/"atribuído"/"transferido" (só confirma "message.
// created" pra mensagem nova). Por enquanto esta function só GRAVA tudo que chegar (numa
// tabela que dá pra ver pelo Table Editor do Supabase, sem precisar de nada técnico) — a
// lógica de criar/mover card de verdade entra depois que a gente enxergar um payload real.
//
// Variáveis de ambiente necessárias no painel do Netlify:
//   SUPABASE_SECRET_KEY     — mesma do resto do sistema
//   DIGISAC_WEBHOOK_SECRET  — senha que só nós sabemos; vai colada na URL do webhook
//                             (?secret=...) pra ninguém de fora conseguir mandar payload falso
//                             pra cá. Gere uma string aleatória qualquer e cadastre as duas
//                             cópias (aqui no Netlify e na URL configurada na Digisac).
//
// Tabela necessária no Supabase:
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

  const params = event.queryStringParameters || {};
  if (segredoEsperado && params.secret !== segredoEsperado) {
    console.warn("[digisac-webhook] chamada rejeitada — secret não bate");
    return { statusCode: 401, body: "unauthorized" };
  }

  let corpo;
  try { corpo = JSON.parse(event.body || "{}"); }
  catch { corpo = { _bruto: event.body || "" }; }

  console.log("[digisac-webhook] evento recebido:", corpo.event || "(sem campo 'event')", JSON.stringify(corpo).slice(0, 2000));

  try {
    await supabaseRest("/kanban_digisac_log", "POST", secretKey,
      { evento: corpo.event || null, corpo },
      { "Prefer": "return=minimal" });
  } catch (err) {
    // Nunca falha a resposta pro Digisac por causa do log — a Digisac espera resposta em
    // até 5s e reenvia se não responder, o que criaria eventos duplicados.
    console.error("[digisac-webhook] falha ao salvar log:", err.message);
  }

  return { statusCode: 200, body: "ok" };
};
