// Netlify Function — sincroniza a config de metas/funcionárias da aba Vendas entre computadores (Supabase)
// Sem senha: a aba Vendas já é de leitura livre para qualquer um no escritório.
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — Settings -> API Keys -> Secret keys, no projeto lolek-portal-corporativo
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table vendas_config (
//     chave text primary key,
//     valor jsonb not null,
//     atualizado_em timestamptz not null default now()
//   );
//   alter table vendas_config enable row level security;

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
const CHAVE = "cfg";

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      const rows = await supabaseRest("/vendas_config?select=valor&chave=eq." + CHAVE, "GET", secretKey);
      const valor = (rows && rows[0] && rows[0].valor) || null;
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(valor) };
    }

    if (event.httpMethod === "POST") {
      let payload;
      try { payload = JSON.parse(event.body || "{}"); }
      catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

      const { valor } = payload;
      if (!valor) return { statusCode: 400, body: JSON.stringify({ error: "valor é obrigatório" }) };

      await supabaseRest("/vendas_config?on_conflict=chave", "POST", secretKey,
        { chave: CHAVE, valor, atualizado_em: new Date().toISOString() },
        { "Prefer": "resolution=merge-duplicates,return=minimal" });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

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
