// Netlify Function agendada — reabre automaticamente os cards de "Oportunidade futura" cuja
// data de retomada chegou, devolvendo pro quadro da vendedora em "Em cotação" com o evento
// "reaberto" no histórico. Roda 1x por dia (ver [functions] no netlify.toml).
//
// Mesma SUPABASE_SECRET_KEY do resto do sistema.

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

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
          try { resolve(chunks ? JSON.parse(chunks) : null); } catch { resolve(null); }
        } else reject(new Error("Supabase " + res.statusCode + ": " + chunks));
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async () => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return { statusCode: 500, body: "SUPABASE_SECRET_KEY não configurada" };

  const hoje = new Date().toISOString().slice(0, 10);
  try {
    const pendentes = await supabaseRest(
      "/kanban_cards?select=id,etapa&quadro=eq.vendas&encerramento_tipo=eq.oportunidade_futura" +
        "&encerramento_data_retomada=lte." + hoje,
      "GET", secretKey
    );

    for (const card of pendentes || []) {
      if (card.etapa !== "encerrado") continue; // já foi reaberto ou mexida manualmente — não repete
      await supabaseRest("/kanban_cards?id=eq." + card.id, "PATCH", secretKey, {
        etapa: "em_cotacao",
        encerramento_tipo: null,
        encerramento_data_retomada: null,
        encerrado_em: null,
        atualizado_em: new Date().toISOString(),
      }, { "Prefer": "return=minimal" });
      await supabaseRest("/kanban_card_eventos", "POST", secretKey, {
        card_id: card.id, tipo: "reaberto", de_etapa: "encerrado", para_etapa: "em_cotacao",
        motivo: "Data de retomada chegou",
      }, { "Prefer": "return=minimal" });
    }

    console.log("[kanban-retomada-cron] reabertos:", (pendentes || []).length);
    return { statusCode: 200, body: JSON.stringify({ reabertos: (pendentes || []).length }) };
  } catch (err) {
    console.error("[kanban-retomada-cron] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
