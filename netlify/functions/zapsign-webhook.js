// Netlify Function — webhook da ZapSign + listagem de contratos para o painel.
//
// Configure esta URL como webhook na ZapSign (Configurações > Webhooks), no
// evento "doc_signed" (documento assinado por todos os signatários):
//   https://sistema-lolek.netlify.app/.netlify/functions/zapsign-webhook
//
// GET  — usado pelo painel (aba Contratos) para listar o histórico.
// POST — recebido da ZapSign quando um contrato é assinado.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — já configurada (mesma usada por clientes-data.js)

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      const rows = await supabaseRest("/contratos?select=*&order=criado_em.desc", "GET", secretKey);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows || []) };
    }

    if (event.httpMethod === "POST") {
      let payload;
      try { payload = JSON.parse(event.body || "{}"); }
      catch { return { statusCode: 400, body: "JSON inválido" }; }

      // payload.event -> ex: "doc_signed"
      // payload.data.token -> token do documento (mesmo salvo como doc_token na criação)
      // payload.data.signed_file -> link do PDF assinado (temporário, 60 min)
      if (payload.event === "doc_signed" && payload.data?.token) {
        await supabaseRest(
          "/contratos?doc_token=eq." + encodeURIComponent(payload.data.token),
          "PATCH", secretKey,
          { status: "assinado", assinado_em: new Date().toISOString() },
          { "Prefer": "return=minimal" }
        );
      }

      return { statusCode: 200, body: "ok" };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    console.error("[zapsign-webhook] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ===== Chamada genérica para a REST API do Supabase (PostgREST) =====
function supabaseRest(path, method, secretKey, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(SUPABASE_URL + "/rest/v1" + path);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
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
