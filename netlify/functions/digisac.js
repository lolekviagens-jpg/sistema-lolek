// Netlify Function — proxy seguro para a API do Digisac
// Variáveis de ambiente necessárias no painel do Netlify:
//   DIGISAC_TOKEN      — token de autenticação Bearer
//   DIGISAC_SERVICE_ID — ID da conexão (Menu → Conexões → três pontos → Visualizar → ID na URL)
//   DIGISAC_BASE_URL   — opcional, padrão: https://lolekviagens.digisac.app/api/v1

const https = require("https");
const url   = require("url");

const BASE = process.env.DIGISAC_BASE_URL || "https://lolekviagens.digisac.app/api/v1";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const token     = process.env.DIGISAC_TOKEN;
  const serviceId = process.env.DIGISAC_SERVICE_ID;

  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: "DIGISAC_TOKEN não configurado no Netlify" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { phone, message } = body;
  if (!phone || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: "phone e message são obrigatórios" }) };
  }

  // Normaliza telefone — brasileiro: 10-11 dígitos → adiciona "55"; internacional: mantém como veio
  let tel = String(phone).replace(/\D/g, "");
  if (tel.length === 10 || tel.length === 11) tel = "55" + tel;

  const payload = JSON.stringify({
    number:    tel,
    text:      message,
    serviceId: serviceId,
  });

  console.log("[Digisac] payload:", JSON.stringify({ number: tel, body: "(msg)", serviceId }));

  try {
    const result = await request(BASE + "/messages", token, payload);
    console.log("[Digisac] status:", result.status, "body:", result.body.slice(0, 300));
    return {
      statusCode: result.status,
      headers: { "Content-Type": "application/json" },
      body: result.body,
    };
  } catch (err) {
    console.error("[Digisac] erro de rede:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function request(endpoint, token, payload) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(endpoint);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.path,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  "Bearer " + token,
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
