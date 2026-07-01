// Netlify Function — proxy seguro para a API da Anthropic
// Variável de ambiente necessária no painel do Netlify:
//   ANTHROPIC_API_KEY — chave sk-ant-... (nunca fica exposta no navegador)

const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: { message: "ANTHROPIC_API_KEY não configurada no Netlify" } }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: { message: "JSON inválido" } }) }; }

  const { model, max_tokens, messages } = payload;
  if (!model || !messages) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "model e messages são obrigatórios" } }) };
  }

  const body = JSON.stringify({ model, max_tokens: max_tokens || 1024, messages });

  try {
    const result = await request(apiKey, body);
    return {
      statusCode: result.status,
      headers: { "Content-Type": "application/json" },
      body: result.body,
    };
  } catch (err) {
    console.error("[Anthropic] erro de rede:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: { message: err.message } }) };
  }
};

function request(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
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
