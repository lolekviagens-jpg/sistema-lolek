// Netlify Scheduled Function — roda sozinha (ver agendamento em netlify.toml) e consulta
// a API da ZapSign pra cada contrato "enviado", corrigindo o status/arquivando o PDF
// quando já foi assinado. É a mesma lógica de netlify/functions/zapsign-webhook.js
// (?reconciliar=1), só que automática — existe porque o webhook da ZapSign pode não
// disparar (não configurado, falha de rede etc.) e o status ficaria desatualizado até
// alguém reparar e pedir uma conferência manual.
//
// Variáveis de ambiente necessárias: SUPABASE_SECRET_KEY, ZAPSIGN_API_TOKEN
// (mesmas já usadas por zapsign-webhook.js / gerar-contrato.js)

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
const STORAGE_BUCKET = "contratos-assinados";

exports.handler = async () => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const zapsignToken = process.env.ZAPSIGN_API_TOKEN;
  if (!secretKey || !zapsignToken) {
    console.error("[zapsign-reconciliar-cron] SUPABASE_SECRET_KEY ou ZAPSIGN_API_TOKEN não configurados");
    return { statusCode: 500, body: "faltam variáveis de ambiente" };
  }

  try {
    const pendentes = await supabaseRest(
      "/contratos?status=eq.enviado&select=id,doc_token,nome_cliente",
      "GET", secretKey
    );

    let atualizados = 0;
    for (const c of (pendentes || [])) {
      try {
        const resp = await zapsignGet("/api/v1/docs/" + encodeURIComponent(c.doc_token) + "/", zapsignToken);
        if (resp.status < 200 || resp.status >= 300) continue;

        const doc = JSON.parse(resp.body);
        const signers = doc.signers || [];
        const assinado = doc.status === "signed" || (signers.length > 0 && signers.every((s) => s.status === "signed"));
        if (!assinado) continue;

        let arquivoPath = null;
        if (doc.signed_file || doc.original_file) {
          try {
            const pdfBuffer = await httpsGetBuffer(doc.signed_file || doc.original_file);
            arquivoPath = c.doc_token + ".pdf";
            await supabaseStorageUpload(arquivoPath, secretKey, pdfBuffer);
          } catch (e) {
            console.error("[zapsign-reconciliar-cron] falha ao arquivar PDF:", c.nome_cliente, e.message);
            arquivoPath = null;
          }
        }

        await supabaseRest(
          "/contratos?id=eq." + encodeURIComponent(c.id),
          "PATCH", secretKey,
          { status: "assinado", assinado_em: new Date().toISOString(), ...(arquivoPath ? { arquivo_path: arquivoPath } : {}) },
          { "Prefer": "return=minimal" }
        );
        atualizados++;
        console.log("[zapsign-reconciliar-cron] contrato assinado:", c.nome_cliente);
      } catch (e) {
        console.error("[zapsign-reconciliar-cron] erro ao verificar contrato:", c.nome_cliente, e.message);
      }
    }

    console.log(`[zapsign-reconciliar-cron] verificados=${(pendentes || []).length} atualizados=${atualizados}`);
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("[zapsign-reconciliar-cron] erro:", err.message);
    return { statusCode: 500, body: err.message };
  }
};

function zapsignGet(path, zapsignToken) {
  return new Promise((resolve, reject) => {
    const options = { hostname: "api.zapsign.com.br", path, method: "GET", headers: { "Authorization": "Bearer " + zapsignToken } };
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on("error", reject);
    req.end();
  });
}

function httpsGetBuffer(targetUrl, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    https.get(targetUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(httpsGetBuffer(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error("Falha ao baixar arquivo assinado: HTTP " + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function supabaseStorageUpload(path, secretKey, buffer) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + "/storage/v1/object/" + STORAGE_BUCKET + "/" + encodeURIComponent(path));
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "apikey": secretKey,
        "Authorization": "Bearer " + secretKey,
        "Content-Type": "application/pdf",
        "Content-Length": buffer.length,
        "x-upsert": "true",
      },
    };
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error("Supabase Storage " + res.statusCode + ": " + chunks));
      });
    });
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

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
};
