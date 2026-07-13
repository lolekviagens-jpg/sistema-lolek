// Netlify Function — sincroniza os clientes entre computadores (Supabase)
// Sem senha: a aba Clientes já é de leitura livre para qualquer um no escritório.
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — Settings -> API Keys -> Secret keys, no projeto lolek-portal-corporativo
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table clientes (
//     id uuid primary key default gen_random_uuid(),
//     nome text not null,
//     nascimento text,
//     rg text,
//     cpf text,
//     passaporte text,
//     venc_passaporte text,
//     email text,
//     telefone text,
//     criado_em timestamptz not null default now()
//   );
//   alter table clientes enable row level security;

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
const CAMPOS = ["nome", "nascimento", "rg", "cpf", "passaporte", "venc_passaporte", "email", "telefone"];

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      const rows = await supabaseRest("/clientes?select=*&order=nome.asc", "GET", secretKey);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows || []) };
    }

    if (event.httpMethod === "POST") {
      let payload;
      try { payload = JSON.parse(event.body || "{}"); }
      catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

      const { action, data } = payload;

      if (action === "criar") {
        const registro = {};
        CAMPOS.forEach(c => { registro[c] = data?.[c] || null; });
        const [criado] = await supabaseRest("/clientes", "POST", secretKey, registro);
        return { statusCode: 200, body: JSON.stringify(criado) };
      }

      if (action === "atualizar") {
        if (!data?.id) return { statusCode: 400, body: JSON.stringify({ error: "id é obrigatório" }) };
        const registro = {};
        CAMPOS.forEach(c => { registro[c] = data[c] || null; });
        await supabaseRest("/clientes?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey, registro, { "Prefer": "return=minimal" });
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (action === "excluir") {
        if (!data?.id) return { statusCode: 400, body: JSON.stringify({ error: "id é obrigatório" }) };
        await supabaseRest("/clientes?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey, null, { "Prefer": "return=minimal" });
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      // Importação em lote — usada só na migração inicial do localStorage.
      if (action === "importar") {
        const lista = Array.isArray(data) ? data : [];
        if (lista.length === 0) return { statusCode: 200, body: JSON.stringify([]) };
        const registros = lista.map(c => {
          const registro = {};
          CAMPOS.forEach(campo => { registro[campo] = c[campo] || null; });
          return registro;
        });
        const criados = await supabaseRest("/clientes", "POST", secretKey, registros);
        return { statusCode: 200, body: JSON.stringify(criados) };
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
