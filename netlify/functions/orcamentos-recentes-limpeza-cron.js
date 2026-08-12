// Netlify Scheduled Function — apaga da tabela orcamentos_recentes (memória de
// rascunhos por usuário, ver orcamentos-recentes.js) tudo que passou de 7 dias
// desde a criação. A listagem já filtra por data (então nada expirado aparece
// pra usuária), isso aqui é só limpeza — evita a tabela crescer pra sempre.
//
// Variável de ambiente necessária: SUPABASE_SECRET_KEY
// Agendamento: ver netlify.toml

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
const DIAS_RETENCAO = 7;

exports.handler = async () => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    console.error("[orcamentos-recentes-limpeza-cron] SUPABASE_SECRET_KEY não configurada");
    return { statusCode: 500, body: "falta SUPABASE_SECRET_KEY" };
  }

  const limite = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000).toISOString();

  try {
    await supabaseRest(
      "/orcamentos_recentes?criado_em=lt." + encodeURIComponent(limite),
      "DELETE", secretKey, null, { "Prefer": "return=minimal" }
    );
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("[orcamentos-recentes-limpeza-cron] erro:", err.message);
    return { statusCode: 500, body: err.message };
  }
};

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
};
