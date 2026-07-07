// Netlify Function — sincroniza as confirmações de check-in entre computadores (Supabase)
// Sem senha: a aba Check-in já é de leitura livre para qualquer um no escritório.
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — Settings -> API Keys -> Secret keys, no projeto lolek-portal-corporativo
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table checkins (
//     chave text primary key,
//     confirmado_em timestamptz not null default now()
//   );
//   alter table checkins enable row level security;

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      const rows = await supabaseRest("/checkins?select=chave,confirmado_em", "GET", secretKey);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows || []) };
    }

    if (event.httpMethod === "POST") {
      let payload;
      try { payload = JSON.parse(event.body || "{}"); }
      catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

      const { action, chave } = payload;
      if (!chave) return { statusCode: 400, body: JSON.stringify({ error: "chave é obrigatória" }) };

      if (action === "confirmar") {
        await supabaseRest("/checkins", "POST", secretKey,
          { chave, confirmado_em: new Date().toISOString() },
          { "Prefer": "resolution=merge-duplicates,return=minimal" });
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (action === "desfazer") {
        await supabaseRest("/checkins?chave=eq." + encodeURIComponent(chave), "DELETE", secretKey, null, { "Prefer": "return=minimal" });
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, body: JSON.stringify({ error: "Ação desconhecida" }) };
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
