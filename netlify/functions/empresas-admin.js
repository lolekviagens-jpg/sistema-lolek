// Netlify Function — administra empresas, usuarios e emissoes do Portal Corporativo
// Usa a chave secreta do Supabase (bypassa RLS), por isso fica so no servidor.
// Variaveis de ambiente necessarias no painel do Netlify:
//   SUPABASE_SECRET_KEY — Settings -> API Keys -> Secret keys, no projeto lolek-portal-corporativo
//   FINANCEIRO_SENHA    — reaproveitada como senha de acesso a esta area tambem

const https  = require("https");
const crypto = require("crypto");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey    = process.env.SUPABASE_SECRET_KEY;
  const senhaCorreta = process.env.FINANCEIRO_SENHA;
  if (!secretKey || !senhaCorreta) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY ou FINANCEIRO_SENHA não configurada no Netlify" }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { senha, action, data } = payload;
  if (!senhasIguais(String(senha || ""), senhaCorreta)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Senha incorreta" }) };
  }

  try {
    const resultado = await executarAcao(action, data || {}, secretKey);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(resultado) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function senhasIguais(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function gerarSenhaTemp() {
  return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
}

// ===== Chamada generica para a REST API do Supabase (PostgREST) =====
function supabaseRequest(basePath, path, method, secretKey, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(SUPABASE_URL + basePath + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "apikey": secretKey,
        "Authorization": "Bearer " + secretKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
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

const supabaseRest = (path, method, secretKey, body) => supabaseRequest("/rest/v1", path, method, secretKey, body);
const supabaseAuth = (path, method, secretKey, body) => supabaseRequest("/auth/v1", path, method, secretKey, body);

async function executarAcao(action, data, secretKey) {
  switch (action) {
    case "listar_empresas":
      return supabaseRest("/empresas?select=*&order=nome.asc", "GET", secretKey);

    case "criar_empresa":
      if (!data.nome) throw new Error("Nome da empresa é obrigatório");
      return supabaseRest("/empresas", "POST", secretKey, { nome: data.nome, cnpj: data.cnpj || null });

    case "listar_emissoes":
      if (!data.empresa_id) throw new Error("empresa_id é obrigatório");
      return supabaseRest(
        "/emissoes?select=*&empresa_id=eq." + encodeURIComponent(data.empresa_id) + "&order=data_emissao.desc.nullslast",
        "GET", secretKey
      );

    case "criar_emissao": {
      if (!data.empresa_id) throw new Error("empresa_id é obrigatório");
      const { id, ...campos } = data;
      return supabaseRest("/emissoes", "POST", secretKey, campos);
    }

    case "atualizar_emissao": {
      if (!data.id) throw new Error("id é obrigatório");
      const { id, ...campos } = data;
      return supabaseRest("/emissoes?id=eq." + encodeURIComponent(id), "PATCH", secretKey, campos);
    }

    case "excluir_emissao":
      if (!data.id) throw new Error("id é obrigatório");
      return supabaseRest("/emissoes?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);

    case "listar_usuarios_empresa":
      if (!data.empresa_id) throw new Error("empresa_id é obrigatório");
      return supabaseRest(
        "/empresa_usuarios?select=user_id,criado_em&empresa_id=eq." + encodeURIComponent(data.empresa_id),
        "GET", secretKey
      );

    case "criar_usuario_empresa": {
      if (!data.empresa_id || !data.email) throw new Error("empresa_id e email são obrigatórios");
      const senhaTemp = gerarSenhaTemp();
      const usuario = await supabaseAuth("/admin/users", "POST", secretKey, {
        email: data.email,
        password: senhaTemp,
        email_confirm: true,
      });
      await supabaseRest("/empresa_usuarios", "POST", secretKey, {
        user_id: usuario.id,
        empresa_id: data.empresa_id,
      });
      return { email: data.email, senha_temporaria: senhaTemp };
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}
