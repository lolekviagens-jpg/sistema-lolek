// Netlify Function — dados do Financeiro (lançamentos, fornecedores de milhas e pagamentos), via Supabase
// Mesmo projeto Supabase do checkins.js/empresas-admin.js.
// Variáveis de ambiente necessárias no painel do Netlify:
//   SUPABASE_SECRET_KEY — Settings -> API Keys -> Secret keys, no projeto lolek-portal-corporativo
//   FINANCEIRO_SENHA    — mesma senha já usada para destravar a aba Financeiro/Empresas
//
// Tabelas necessárias no Supabase (criar uma vez via SQL Editor, nesta ordem —
// financeiro_lancamentos e fornecedor_pagamentos referenciam fornecedores):
//
//   create table fornecedores (
//     id uuid primary key default gen_random_uuid(),
//     nome text not null,
//     pix text,
//     contato text,
//     observacoes text,
//     ativo boolean not null default true,
//     criado_em timestamptz not null default now()
//   );
//   alter table fornecedores enable row level security;
//
//   create table financeiro_lancamentos (
//     id uuid primary key default gen_random_uuid(),
//     tipo text not null check (tipo in ('entrada','saida')),
//     status text not null default 'pendente' check (status in ('pendente','pago')),
//     descricao text not null,
//     categoria text,
//     origem text,
//     valor numeric(12,2) not null,
//     vencimento date,
//     criado_em timestamptz not null default now(),
//     fonte text not null default 'manual'
//       check (fonte in ('manual','extrato_texto','extrato_ofx','extrato_csv','extrato_pdf','planilha_venda')),
//     dedupe_key text,
//     fornecedor_id uuid references fornecedores(id),
//     sheet_meta jsonb
//   );
//   create unique index financeiro_lancamentos_dedupe_key_idx
//     on financeiro_lancamentos (dedupe_key);
//   -- (indice unico "cheio", nao parcial: o Postgres ja trata varios NULLs como
//   -- distintos entre si, e o on_conflict do PostgREST nao reconhece indices parciais)
//   alter table financeiro_lancamentos enable row level security;
//
//   create table fornecedor_aliases (
//     id uuid primary key default gen_random_uuid(),
//     fornecedor_id uuid references fornecedores(id),
//     alias_normalizado text not null unique,
//     alias_original text not null,
//     status text not null default 'confirmado' check (status in ('confirmado','pendente')),
//     criado_em timestamptz not null default now()
//   );
//   alter table fornecedor_aliases enable row level security;
//
//   create table fornecedor_pagamentos (
//     id uuid primary key default gen_random_uuid(),
//     fornecedor_id uuid not null references fornecedores(id) on delete cascade,
//     data date not null,
//     valor_pago numeric(12,2) not null,
//     milhas_recebidas numeric(14,0),
//     valor_por_milha numeric(10,5),
//     observacoes text,
//     lancamento_id uuid references financeiro_lancamentos(id),
//     criado_em timestamptz not null default now()
//   );
//   alter table fornecedor_pagamentos enable row level security;

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

async function executarAcao(action, data, secretKey) {
  switch (action) {
    // ===== Lançamentos =====
    case "listar_lancamentos":
      return supabaseRest("/financeiro_lancamentos?select=*&order=vencimento.desc.nullslast", "GET", secretKey);

    case "criar_lancamento": {
      if (!data.descricao || !data.valor) throw new Error("Descrição e valor são obrigatórios");
      const { id, ...campos } = data;
      return supabaseRest("/financeiro_lancamentos", "POST", secretKey, campos);
    }

    case "atualizar_lancamento": {
      if (!data.id) throw new Error("id é obrigatório");
      const { id, ...campos } = data;
      return supabaseRest("/financeiro_lancamentos?id=eq." + encodeURIComponent(id), "PATCH", secretKey, campos);
    }

    case "excluir_lancamento":
      if (!data.id) throw new Error("id é obrigatório");
      return supabaseRest("/financeiro_lancamentos?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);

    case "importar_lancamentos": {
      const lista = Array.isArray(data.lancamentos) ? data.lancamentos : [];
      if (lista.length === 0) return [];
      return supabaseRest("/financeiro_lancamentos", "POST", secretKey, lista);
    }

    case "upsert_sheet_lancamentos": {
      const lista = Array.isArray(data.lancamentos) ? data.lancamentos : [];
      if (lista.length === 0) return [];
      return supabaseRest(
        "/financeiro_lancamentos?on_conflict=dedupe_key", "POST", secretKey, lista,
        { "Prefer": "resolution=merge-duplicates,return=representation" }
      );
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}
