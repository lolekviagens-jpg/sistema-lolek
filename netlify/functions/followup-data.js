// Netlify Function — sincroniza a aba Follow-up entre computadores (Supabase). Antes o
// "enviado"/"descartado" de cada contato e os "eventos especiais" cadastrados ficavam só no
// localStorage do navegador — cada funcionária via uma lista diferente, porque o que uma
// marcava/cadastrava no computador dela não aparecia pras outras. Sem senha: igual ao
// Check-in, é leitura/escrita livre pra qualquer uma no escritório (a aba já é assim).
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — Settings -> API Keys -> Secret keys, no projeto lolek-portal-corporativo
//
// Tabelas necessárias no Supabase (criar uma vez via SQL Editor):
//   create table followup_acoes (
//     chave text not null,
//     acao text not null check (acao in ('enviado','descartado')),
//     em timestamptz not null default now(),
//     primary key (chave, acao)
//   );
//   alter table followup_acoes enable row level security;
//
//   create table followup_eventos (
//     id uuid primary key default gen_random_uuid(),
//     nome_cliente text not null,
//     ocasiao text,
//     data_viagem text not null,
//     destino text,
//     telefone text,
//     criado_em timestamptz not null default now()
//   );
//   alter table followup_eventos enable row level security;
//
// Ações (POST { action, data }):
//   listar_acoes                        -> [{ chave, acao, em }]
//   marcar_acao    { chave, acao }
//   listar_eventos                      -> [{ id, nome_cliente, ocasiao, data_viagem, destino, telefone, criado_em }]
//   criar_evento   { nome_cliente, ocasiao, data_viagem, destino, telefone } -> registro criado
//   excluir_evento { id }

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

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

  try {
    const resultado = await executarAcao(payload.action, payload.data || {}, secretKey);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error("[followup-data] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function executarAcao(action, data, secretKey) {
  switch (action) {
    case "listar_acoes":
      return supabaseRest("/followup_acoes?select=chave,acao,em", "GET", secretKey);

    case "marcar_acao": {
      if (!data.chave || !data.acao) throw new Error("chave e acao são obrigatórios");
      await supabaseRest("/followup_acoes", "POST", secretKey,
        { chave: data.chave, acao: data.acao, em: new Date().toISOString() },
        { "Prefer": "resolution=merge-duplicates,return=minimal" });
      return { ok: true };
    }

    case "listar_eventos":
      return supabaseRest("/followup_eventos?select=*&order=criado_em.desc", "GET", secretKey);

    case "criar_evento": {
      if (!data.nome_cliente || !data.data_viagem) throw new Error("nome_cliente e data_viagem são obrigatórios");
      const [criado] = await supabaseRest("/followup_eventos", "POST", secretKey, {
        nome_cliente: data.nome_cliente,
        ocasiao: data.ocasiao || null,
        data_viagem: data.data_viagem,
        destino: data.destino || null,
        telefone: data.telefone || null,
      });
      return criado;
    }

    case "excluir_evento": {
      if (!data.id) throw new Error("id é obrigatório");
      await supabaseRest("/followup_eventos?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey, null, { "Prefer": "return=minimal" });
      return { ok: true };
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}

// ===== Chamada generica para a REST API do Supabase (PostgREST) =====
function supabaseRest(path, method, secretKey, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(SUPABASE_URL + "/rest/v1" + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "apikey": secretKey,
        "Authorization": "Bearer " + secretKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
        ...(extraHeaders || {}),
      },
    };
    if (payload) options.headers["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(chunks ? JSON.parse(chunks) : null); }
          catch { resolve(null); }
        } else {
          reject(new Error("Supabase " + res.statusCode + ": " + chunks));
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
