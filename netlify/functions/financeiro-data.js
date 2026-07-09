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

    // ===== Fornecedores de milhas =====
    case "listar_fornecedores":
      return supabaseRest("/fornecedores?select=*&order=nome.asc", "GET", secretKey);

    case "criar_fornecedor": {
      if (!data.nome) throw new Error("Nome do fornecedor é obrigatório");
      return supabaseRest("/fornecedores", "POST", secretKey, {
        nome: data.nome, pix: data.pix || null, contato: data.contato || null, observacoes: data.observacoes || null,
      });
    }

    case "atualizar_fornecedor": {
      if (!data.id) throw new Error("id é obrigatório");
      const { id, ...campos } = data;
      return supabaseRest("/fornecedores?id=eq." + encodeURIComponent(id), "PATCH", secretKey, campos);
    }

    case "listar_aliases":
      return supabaseRest("/fornecedor_aliases?select=*", "GET", secretKey);

    // Chamado depois de cada pull da planilha, com os valores da coluna K ainda não vistos.
    // Idempotente: rodar de novo com o mesmo alias não duplica (ignora se já existir).
    case "registrar_pendencias_alias": {
      const lista = Array.isArray(data.aliases) ? data.aliases : [];
      if (lista.length === 0) return [];
      return supabaseRest(
        "/fornecedor_aliases?on_conflict=alias_normalizado", "POST", secretKey,
        lista.map((a) => ({ alias_normalizado: a.alias_normalizado, alias_original: a.alias_original, fornecedor_id: null, status: "pendente" })),
        { "Prefer": "resolution=ignore-duplicates,return=representation" }
      );
    }

    // Confirma os grupos revisados pela Thay depois do agrupamento por IA: cria o fornecedor
    // (se for novo) e vincula os aliases confirmados a ele.
    // Cria tudo em lote (no máximo 2 chamadas ao Supabase, não importa quantos grupos) — a versão
    // anterior criava um fornecedor por vez em sequência e estourava o tempo limite da function
    // com listas grandes (só uns 130 grupos já era o suficiente pra travar no meio do processo).
    case "confirmar_grupos_ia": {
      const grupos = Array.isArray(data.grupos) ? data.grupos : [];
      if (grupos.length === 0) return [];

      const semFornecedor = grupos.filter((g) => !g.fornecedor_id);
      const comFornecedor  = grupos.filter((g) => g.fornecedor_id);

      let criados = [];
      if (semFornecedor.length > 0) {
        criados = await supabaseRest("/fornecedores", "POST", secretKey, semFornecedor.map((g) => ({ nome: g.nome_novo })));
      }

      const todosAliases = [];
      semFornecedor.forEach((g, i) => {
        (g.aliases || []).forEach((a) => todosAliases.push({
          alias_normalizado: a.alias_normalizado, alias_original: a.alias_original, fornecedor_id: criados[i].id, status: "confirmado",
        }));
      });
      comFornecedor.forEach((g) => {
        (g.aliases || []).forEach((a) => todosAliases.push({
          alias_normalizado: a.alias_normalizado, alias_original: a.alias_original, fornecedor_id: g.fornecedor_id, status: "confirmado",
        }));
      });

      if (todosAliases.length > 0) {
        await supabaseRest(
          "/fornecedor_aliases?on_conflict=alias_normalizado", "POST", secretKey, todosAliases,
          { "Prefer": "resolution=merge-duplicates,return=representation" }
        );
      }

      return [...criados, ...comFornecedor.map((g) => ({ id: g.fornecedor_id }))];
    }

    // Atribuição pontual de um alias pendente (sem re-rodar o agrupamento por IA inteiro).
    case "resolver_pendencia_alias": {
      if (!data.id) throw new Error("id é obrigatório");
      let fornecedorId = data.fornecedor_id;
      if (!fornecedorId) {
        if (!data.nome_novo) throw new Error("Informe fornecedor_id ou nome_novo");
        const [criado] = await supabaseRest("/fornecedores", "POST", secretKey, { nome: data.nome_novo });
        fornecedorId = criado.id;
      }
      return supabaseRest("/fornecedor_aliases?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey, {
        fornecedor_id: fornecedorId, status: "confirmado",
      });
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}
