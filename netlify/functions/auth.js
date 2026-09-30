// Netlify Function — login por funcionária + gerenciamento de usuários.
//
// Variável de ambiente necessária: SUPABASE_SECRET_KEY (mesma de clientes-data.js)
//
// Tabelas necessárias no Supabase (ver netlify/functions/_auth.js pro resto do
// esquema de segurança compartilhado):
//   create table usuarios (
//     id uuid primary key default gen_random_uuid(),
//     nome text not null,
//     usuario text not null unique,
//     senha_hash text not null,
//     senha_salt text not null,
//     ativo boolean not null default true,
//     admin boolean not null default false,
//     criado_em timestamptz not null default now()
//   );
//   create table sessoes (
//     token text primary key,
//     usuario_id uuid not null references usuarios(id) on delete cascade,
//     criado_em timestamptz not null default now(),
//     expira_em timestamptz not null
//   );
//
// Se a tabela "usuarios" já existia antes do Kanban (integração com Digisac), rodar uma vez:
//   alter table usuarios add column if not exists digisac_user_id text;
//
// Ações (POST { action, data }):
//   login            { usuario, senha } -> { token, nome, usuario, admin }
//   logout           { token }
//   validar          { token } -> { valido, nome, usuario, admin }
//   listar_usuarios  (precisa de token de admin) -> [{ id, nome, usuario, ativo, admin }]
//   criar_usuario    (precisa de token de admin) { nome, usuario, senha, admin }
//   editar_usuario   (precisa de token de admin) { id, nome?, ativo?, admin?, senha? }
//   excluir_usuario  (precisa de token de admin) { id }

const { supabaseRest, validarSessao, tokenDoEvento, gerarSalt, gerarToken, hashSenha, senhaConfere } = require("./_auth");

const SESSAO_DIAS = 30;

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { action, data } = payload;
  const d = data || {};

  try {
    if (action === "login") {
      const usuarioLogin = String(d.usuario || "").trim().toLowerCase();
      if (!usuarioLogin || !d.senha) {
        return json(400, { error: "Usuário e senha são obrigatórios" });
      }
      const rows = await supabaseRest("/usuarios?usuario=eq." + encodeURIComponent(usuarioLogin) + "&select=*", "GET", secretKey);
      const u = rows && rows[0];
      if (!u || !u.ativo || !senhaConfere(d.senha, u.senha_salt, u.senha_hash)) {
        return json(401, { error: "Usuário ou senha inválidos" });
      }
      const token = gerarToken();
      const expiraEm = new Date(Date.now() + SESSAO_DIAS * 24 * 60 * 60 * 1000).toISOString();
      await supabaseRest("/sessoes", "POST", secretKey, { token, usuario_id: u.id, expira_em: expiraEm }, { "Prefer": "return=minimal" });
      return json(200, { token, nome: u.nome, usuario: u.usuario, admin: !!u.admin });
    }

    if (action === "logout") {
      if (d.token) await supabaseRest("/sessoes?token=eq." + encodeURIComponent(d.token), "DELETE", secretKey).catch(() => {});
      return json(200, { ok: true });
    }

    if (action === "validar") {
      const sessao = await validarSessao(d.token, secretKey);
      return json(200, sessao);
    }

    // Lista leve (id + nome) de colegas ativas — qualquer pessoa logada pode ver, sem dado
    // sensível nenhum. Usado pelo Kanban pra escolher "transferir para" e (se admin) filtrar
    // um quadro por vendedora — diferente de listar_usuarios (completa, só admin).
    if (action === "listar_colegas") {
      const sessaoColegas = await validarSessao(tokenDoEvento(event) || d.token, secretKey);
      if (!sessaoColegas.valido) return json(401, { error: "Sessão expirada — faça login novamente." });
      const rows = await supabaseRest("/usuarios?ativo=eq.true&select=id,nome,usuario&order=nome.asc", "GET", secretKey);
      return json(200, rows || []);
    }

    // ===== Ações abaixo exigem admin =====
    const sessaoAtual = await validarSessao(tokenDoEvento(event) || d.token, secretKey);
    if (!sessaoAtual.valido || !sessaoAtual.admin) {
      return json(403, { error: "Acesso restrito à administradora" });
    }

    if (action === "listar_usuarios") {
      const rows = await supabaseRest("/usuarios?select=id,nome,usuario,ativo,admin,digisac_user_id,criado_em&order=nome.asc", "GET", secretKey);
      return json(200, rows || []);
    }

    if (action === "listar_atividade") {
      const filtroArea = d.area ? "&area=eq." + encodeURIComponent(d.area) : "";
      const rows = await supabaseRest(
        "/atividade_log?select=*&order=criado_em.desc&limit=300" + filtroArea,
        "GET", secretKey
      );
      return json(200, rows || []);
    }

    if (action === "criar_usuario") {
      if (!d.nome || !d.usuario || !d.senha) return json(400, { error: "nome, usuario e senha são obrigatórios" });
      const salt = gerarSalt();
      const [criado] = await supabaseRest("/usuarios", "POST", secretKey, {
        nome: d.nome.trim(),
        usuario: String(d.usuario).trim().toLowerCase(),
        senha_salt: salt,
        senha_hash: hashSenha(d.senha, salt),
        admin: !!d.admin,
        digisac_user_id: d.digisac_user_id ? String(d.digisac_user_id).trim() : null,
      });
      return json(200, { id: criado.id, nome: criado.nome, usuario: criado.usuario });
    }

    if (action === "editar_usuario") {
      if (!d.id) return json(400, { error: "id é obrigatório" });
      const patch = {};
      if (d.nome != null) patch.nome = d.nome.trim();
      if (d.ativo != null) patch.ativo = !!d.ativo;
      if (d.admin != null) patch.admin = !!d.admin;
      if (d.digisac_user_id != null) patch.digisac_user_id = String(d.digisac_user_id).trim() || null;
      if (d.senha) {
        const salt = gerarSalt();
        patch.senha_salt = salt;
        patch.senha_hash = hashSenha(d.senha, salt);
      }
      await supabaseRest("/usuarios?id=eq." + encodeURIComponent(d.id), "PATCH", secretKey, patch, { "Prefer": "return=minimal" });
      return json(200, { ok: true });
    }

    if (action === "excluir_usuario") {
      if (!d.id) return json(400, { error: "id é obrigatório" });
      await supabaseRest("/usuarios?id=eq." + encodeURIComponent(d.id), "DELETE", secretKey);
      return json(200, { ok: true });
    }

    return json(400, { error: "Ação desconhecida: " + action });
  } catch (err) {
    console.error("[auth] erro:", err.message);
    return json(500, { error: err.message });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
