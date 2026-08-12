// Netlify Function — memória de orçamentos recentes (rascunhos), por usuário.
//
// Cada funcionária só vê os próprios orçamentos recentes (últimos 7 dias) —
// serve pra retomar/editar rapidinho um orçamento já feito, sem refazer do
// zero quando o cliente pede um ajuste horas depois. Orçamentos fechados/
// confirmados como venda não passam por aqui — isso é só o rascunho da aba
// Orçamentos (ver orcamentos.js).
//
// Variável de ambiente necessária: SUPABASE_SECRET_KEY (mesma do resto do projeto)
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table orcamentos_recentes (
//     id uuid primary key default gen_random_uuid(),
//     usuario_id uuid not null references usuarios(id) on delete cascade,
//     cliente_nome text,
//     destino_resumo text,
//     dados jsonb not null,
//     criado_em timestamptz not null default now(),
//     atualizado_em timestamptz not null default now()
//   );
//   create index orcamentos_recentes_usuario_idx on orcamentos_recentes (usuario_id, criado_em desc);
//   alter table orcamentos_recentes enable row level security;
//
// A limpeza automática dos que passaram de 7 dias é feita pela scheduled
// function orcamentos-recentes-limpeza-cron.js — aqui o filtro por data é só
// pra não listar os expirados enquanto a limpeza não passa.
//
// Ações (POST { action, data }) — todas exigem sessão válida (x-auth-token),
// pois a lista é sempre por usuário:
//   listar   -> [{ id, cliente_nome, destino_resumo, dados, criado_em, atualizado_em }]
//   salvar   { id?, cliente_nome, destino_resumo, dados } -> { id }
//              (com id: atualiza dados/atualizado_em, mantém criado_em intacto —
//               o prazo de 7 dias conta da criação, não da última edição)
//   excluir  { id }

const { supabaseRest, validarSessao, tokenDoEvento } = require("./_auth");

const DIAS_RETENCAO = 7;

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
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const sessao = await validarSessao(tokenDoEvento(event), secretKey);
  if (!sessao.valido) {
    return { statusCode: 401, body: JSON.stringify({ error: "Sessão expirada — faça login novamente." }) };
  }

  try {
    const resultado = await executarAcao(payload.action, payload.data || {}, secretKey, sessao);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error("[orcamentos-recentes] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function executarAcao(action, data, secretKey, sessao) {
  switch (action) {
    case "listar": {
      const limite = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000).toISOString();
      return supabaseRest(
        "/orcamentos_recentes?usuario_id=eq." + encodeURIComponent(sessao.usuarioId) +
          "&criado_em=gte." + encodeURIComponent(limite) +
          "&select=id,cliente_nome,destino_resumo,dados,criado_em,atualizado_em" +
          "&order=atualizado_em.desc",
        "GET", secretKey
      );
    }

    case "salvar": {
      if (!data.dados) throw new Error("dados é obrigatório");
      const agora = new Date().toISOString();

      if (data.id) {
        // Confirma que o registro é do próprio usuário antes de editar (nunca
        // confia só no id vindo do cliente).
        const [existente] = await supabaseRest(
          "/orcamentos_recentes?id=eq." + encodeURIComponent(data.id) +
            "&usuario_id=eq." + encodeURIComponent(sessao.usuarioId) + "&select=id",
          "GET", secretKey
        );
        if (!existente) throw new Error("Orçamento não encontrado");

        await supabaseRest(
          "/orcamentos_recentes?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey,
          {
            cliente_nome: data.cliente_nome || null,
            destino_resumo: data.destino_resumo || null,
            dados: data.dados,
            atualizado_em: agora,
          },
          { "Prefer": "return=minimal" }
        );
        return { id: data.id };
      }

      const [criado] = await supabaseRest("/orcamentos_recentes", "POST", secretKey, {
        usuario_id: sessao.usuarioId,
        cliente_nome: data.cliente_nome || null,
        destino_resumo: data.destino_resumo || null,
        dados: data.dados,
        criado_em: agora,
        atualizado_em: agora,
      });
      return { id: criado && criado.id };
    }

    case "excluir": {
      if (!data.id) throw new Error("id é obrigatório");
      await supabaseRest(
        "/orcamentos_recentes?id=eq." + encodeURIComponent(data.id) +
          "&usuario_id=eq." + encodeURIComponent(sessao.usuarioId),
        "DELETE", secretKey, null, { "Prefer": "return=minimal" }
      );
      return { ok: true };
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}
