// Netlify Function — webhook da ZapSign + listagem de contratos para o painel.
//
// Configure esta URL como webhook na ZapSign (Configurações > Webhooks), no
// evento "doc_signed" (documento assinado por todos os signatários):
//   https://sistema-lolek.netlify.app/.netlify/functions/zapsign-webhook
//
// GET  — usado pelo painel (aba Contratos):
//   sem parâmetros      -> lista o histórico de contratos.
//   ?arquivo=<doc_token> -> devolve { url } com um link temporário (5 min)
//                           pra abrir o PDF assinado arquivado no Storage.
// POST — recebido da ZapSign quando um contrato é assinado. Baixa o PDF
//        assinado (o link que a ZapSign manda é temporário, ~60min) e
//        arquiva ele no Supabase Storage pra ficar disponível pra sempre.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — já configurada (mesma usada por clientes-data.js)
//
// Setup necessário no Supabase (uma vez só):
//   1) Storage > New bucket > nome "contratos-assinados", privado (não público).
//   2) SQL Editor:
//        alter table contratos add column arquivo_path text;

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
const STORAGE_BUCKET = "contratos-assinados";

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      // ?reconciliar=1 — consulta a API da ZapSign pra cada contrato "enviado" e corrige
      // o status se já foi assinado. Existe porque o webhook depende de estar configurado
      // certinho na ZapSign e de chegar (se falhar/não disparar, o status fica desatualizado
      // pra sempre) — isso serve de conferência manual, sob demanda.
      if (event.queryStringParameters?.reconciliar) {
        const zapsignToken = process.env.ZAPSIGN_API_TOKEN;
        if (!zapsignToken) {
          return { statusCode: 500, body: JSON.stringify({ error: "ZAPSIGN_API_TOKEN não configurado no Netlify" }) };
        }
        const pendentes = await supabaseRest(
          "/contratos?status=eq.enviado&select=id,doc_token,nome_cliente",
          "GET", secretKey
        );
        const resultados = [];
        for (const c of (pendentes || [])) {
          try {
            const resp = await zapsignGet("/api/v1/docs/" + encodeURIComponent(c.doc_token) + "/", zapsignToken);
            if (resp.status < 200 || resp.status >= 300) {
              resultados.push({ id: c.id, nome: c.nome_cliente, erro: "ZapSign " + resp.status + ": " + resp.body });
              continue;
            }
            const doc = JSON.parse(resp.body);
            const signers = doc.signers || [];
            const assinado = doc.status === "signed" || (signers.length > 0 && signers.every((s) => s.status === "signed"));

            if (assinado) {
              let arquivoPath = null;
              if (doc.signed_file || doc.original_file) {
                try {
                  const pdfBuffer = await httpsGetBuffer(doc.signed_file || doc.original_file);
                  arquivoPath = c.doc_token + ".pdf";
                  await supabaseStorageUpload(arquivoPath, secretKey, pdfBuffer);
                } catch (e) {
                  console.error("[zapsign-webhook] falha ao arquivar PDF (reconciliação):", e.message);
                  arquivoPath = null; // sem arquivo salvo, mas o status ainda é atualizado
                }
              }
              await supabaseRest(
                "/contratos?id=eq." + encodeURIComponent(c.id),
                "PATCH", secretKey,
                { status: "assinado", assinado_em: new Date().toISOString(), ...(arquivoPath ? { arquivo_path: arquivoPath } : {}) },
                { "Prefer": "return=minimal" }
              );
              resultados.push({ id: c.id, nome: c.nome_cliente, atualizado: true, status_zapsign: doc.status });
            } else {
              resultados.push({ id: c.id, nome: c.nome_cliente, atualizado: false, status_zapsign: doc.status });
            }
          } catch (e) {
            resultados.push({ id: c.id, nome: c.nome_cliente, erro: e.message });
          }
        }
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verificados: (pendentes || []).length, resultados }) };
      }

      const docToken = event.queryStringParameters?.arquivo;
      if (docToken) {
        const rows = await supabaseRest(
          "/contratos?doc_token=eq." + encodeURIComponent(docToken) + "&select=arquivo_path",
          "GET", secretKey
        );
        const arquivoPath = rows && rows[0] && rows[0].arquivo_path;
        if (!arquivoPath) {
          return { statusCode: 404, body: JSON.stringify({ error: "PDF assinado não encontrado para este contrato" }) };
        }
        const signed = await supabaseStorageSign(arquivoPath, secretKey, 300);
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: SUPABASE_URL + signed.signedURL }) };
      }

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
        const token = payload.data.token;
        let arquivoPath = null;

        if (payload.data.signed_file) {
          try {
            const pdfBuffer = await httpsGetBuffer(payload.data.signed_file);
            arquivoPath = token + ".pdf";
            await supabaseStorageUpload(arquivoPath, secretKey, pdfBuffer);
          } catch (e) {
            console.error("[zapsign-webhook] falha ao arquivar PDF assinado:", e.message);
            arquivoPath = null; // sem arquivo salvo, mas o status ainda é atualizado
          }
        }

        await supabaseRest(
          "/contratos?doc_token=eq." + encodeURIComponent(token),
          "PATCH", secretKey,
          { status: "assinado", assinado_em: new Date().toISOString(), ...(arquivoPath ? { arquivo_path: arquivoPath } : {}) },
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

// ===== Consulta um documento na API da ZapSign =====
function zapsignGet(path, zapsignToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.zapsign.com.br",
      path,
      method: "GET",
      headers: { "Authorization": "Bearer " + zapsignToken },
    };
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ===== Baixa um arquivo binário (segue redirecionamentos) =====
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

// ===== Envia (upload) um PDF pro Supabase Storage =====
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

// ===== Gera um link temporário de download pra um arquivo privado do Storage =====
function supabaseStorageSign(path, secretKey, expiresInSegundos) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + "/storage/v1/object/sign/" + STORAGE_BUCKET + "/" + encodeURIComponent(path));
    const payload = JSON.stringify({ expiresIn: expiresInSegundos });
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "apikey": secretKey,
        "Authorization": "Bearer " + secretKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(chunks)); } catch (e) { reject(e); }
        } else {
          reject(new Error("Supabase Storage sign " + res.statusCode + ": " + chunks));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

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
