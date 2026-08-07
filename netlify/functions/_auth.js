// Módulo compartilhado de autenticação — usado pelas Netlify Functions que
// precisam validar login e registrar atividade (quem criou/editou/apagou o quê).
// Diferente do resto do projeto (que duplica os helpers por arquivo), esse fica
// centralizado porque é lógica de segurança: mais seguro corrigir/revisar um
// lugar só do que manter N cópias iguais.

const https = require("https");
const crypto = require("crypto");

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

// ===== Valida um token de sessão (header x-auth-token) =====
// Retorna { valido, usuarioId, nome, usuario, admin } — nunca lança erro por
// token inválido/expirado, só valido:false (quem chama decide o que fazer).
async function validarSessao(token, secretKey) {
  if (!token) return { valido: false };
  try {
    const rows = await supabaseRest(
      "/sessoes?token=eq." + encodeURIComponent(token) +
        "&select=usuario_id,expira_em,usuarios(id,nome,usuario,admin,ativo)",
      "GET", secretKey
    );
    const sessao = rows && rows[0];
    if (!sessao || !sessao.usuarios) return { valido: false };
    if (new Date(sessao.expira_em) < new Date()) return { valido: false };
    if (!sessao.usuarios.ativo) return { valido: false };
    return {
      valido: true,
      usuarioId: sessao.usuarios.id,
      nome: sessao.usuarios.nome,
      usuario: sessao.usuarios.usuario,
      admin: !!sessao.usuarios.admin,
    };
  } catch {
    return { valido: false };
  }
}

// Extrai o token do header (Netlify normaliza os nomes de header pra minúsculo)
function tokenDoEvento(event) {
  return (event.headers && (event.headers["x-auth-token"] || event.headers["X-Auth-Token"])) || null;
}

// Registra uma linha no log de atividade — nunca lança erro (log não pode
// derrubar a ação principal se falhar).
async function registrarAtividade(secretKey, { usuarioNome, acao, area, descricao, registroId }) {
  try {
    await supabaseRest("/atividade_log", "POST", secretKey, {
      usuario_nome: usuarioNome || null,
      acao, area,
      descricao: descricao || null,
      registro_id: registroId != null ? String(registroId) : null,
    }, { "Prefer": "return=minimal" });
  } catch (e) {
    console.error("[_auth] falha ao registrar atividade:", e.message);
  }
}

function gerarSalt() { return crypto.randomBytes(16).toString("hex"); }
function gerarToken() { return crypto.randomBytes(32).toString("hex"); }
function hashSenha(senha, salt) { return crypto.scryptSync(String(senha), salt, 64).toString("hex"); }
function senhaConfere(senha, salt, hash) {
  const calculado = hashSenha(senha, salt);
  const a = Buffer.from(calculado, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  supabaseRest, validarSessao, tokenDoEvento, registrarAtividade,
  gerarSalt, gerarToken, hashSenha, senhaConfere,
};
