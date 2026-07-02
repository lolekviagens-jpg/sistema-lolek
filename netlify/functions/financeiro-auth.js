// Netlify Function — valida a senha da aba Financeiro no servidor
// Variável de ambiente necessária no painel do Netlify:
//   FINANCEIRO_SENHA — senha de acesso (nunca fica exposta no navegador/repositório)

const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const senhaCorreta = process.env.FINANCEIRO_SENHA;
  if (!senhaCorreta) {
    return { statusCode: 500, body: JSON.stringify({ error: "FINANCEIRO_SENHA não configurada no Netlify" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const senha = typeof body.senha === "string" ? body.senha : "";
  const ok = senhasIguais(senha, senhaCorreta);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok }),
  };
};

// Comparação em tempo constante para não vazar informação por timing
function senhasIguais(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
