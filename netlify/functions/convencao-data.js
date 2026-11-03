// Netlify Function — checklist da Convenção (aba temporária, só pra esse evento). Guarda só
// "esse item já foi confirmado" por produto vendido com origem_lead = "Convenção" — os dados
// da venda em si (cliente, voo, hotel...) continuam vindo de Emissões; aqui só fica o checkbox.
// Sem senha: igual Check-in/Follow-up, leitura/escrita livre pra qualquer uma no escritório.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — mesma do resto do sistema
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table convencao_confirmacoes (
//     chave text primary key,              -- id do produto (venda_emissoes_produtos.id),
//                                           -- ou uma chave manual pra itens fora do sistema
//     confirmado_em timestamptz not null default now()
//   );
//   alter table convencao_confirmacoes enable row level security;
//
// Ações (POST { action, data }):
//   listar_confirmacoes                  -> [{ chave, confirmado_em }]
//   confirmar       { chave }
//   desconfirmar    { chave }

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
    console.error("[convencao-data] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function executarAcao(action, data, secretKey) {
  switch (action) {
    case "listar_confirmacoes":
      return supabaseRest("/convencao_confirmacoes?select=chave,confirmado_em", "GET", secretKey);

    case "confirmar": {
      if (!data.chave) throw new Error("chave é obrigatória");
      await supabaseRest("/convencao_confirmacoes", "POST", secretKey,
        { chave: data.chave, confirmado_em: new Date().toISOString() },
        { "Prefer": "resolution=merge-duplicates,return=minimal" });
      return { ok: true };
    }

    case "desconfirmar": {
      if (!data.chave) throw new Error("chave é obrigatória");
      await supabaseRest("/convencao_confirmacoes?chave=eq." + encodeURIComponent(data.chave), "DELETE", secretKey, null, { "Prefer": "return=minimal" });
      return { ok: true };
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}

// ===== Chamada genérica para a REST API do Supabase (PostgREST) =====
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
