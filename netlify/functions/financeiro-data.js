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
//       check (fonte in ('manual','extrato_texto','extrato_ofx','extrato_csv','extrato_pdf','planilha_venda','emissao_app')),
//     dedupe_key text,
//     fornecedor_id uuid references fornecedores(id),
//     sheet_meta jsonb,
//     emissao_produto_id uuid references venda_emissoes_produtos(id) on delete set null -- ver emissoes-data.js
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
//
//   create table financeiro_contas_fixas (
//     id uuid primary key default gen_random_uuid(),
//     nome text not null,
//     valor numeric(12,2), -- fica em branco até a funcionária confirmar (varia mês a mês em contas como energia)
//     dia_vencimento int check (dia_vencimento between 1 and 31),
//     banco_cartao text,
//     categoria text,
//     recorrencia text not null default 'mensal' check (recorrencia in ('mensal','parcela')),
//     parcelas_restantes int, -- só relevante quando recorrencia = 'parcela'
//     ativo boolean not null default true,
//     ultimo_valor_pago numeric(12,2),
//     ultima_vez_paga_em date,
//     criado_em timestamptz not null default now()
//   );
//   alter table financeiro_contas_fixas enable row level security;
//
//   -- Liga um lançamento à conta fixa que o gerou, pra "marcar como paga este mês" saber
//   -- de onde veio e pra tela de contas fixas listar o histórico de pagamentos de cada uma.
//   alter table financeiro_lancamentos add column if not exists conta_fixa_id uuid references financeiro_contas_fixas(id) on delete set null;

const https  = require("https");
const crypto = require("crypto");
const { validarSessao, tokenDoEvento, registrarAtividade } = require("./_auth");

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
    // A senha do Financeiro (acima) já protege a área inteira — a sessão aqui é só pra
    // saber QUEM fez a ação no log de atividade, não bloqueia se não vier token.
    const sessao = await validarSessao(tokenDoEvento(event), secretKey);
    const resultado = await executarAcao(action, data || {}, secretKey, sessao.nome);
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

async function executarAcao(action, data, secretKey, usuarioNome) {
  switch (action) {
    // ===== Lançamentos =====
    case "listar_lancamentos":
      return supabaseRest("/financeiro_lancamentos?select=*&order=vencimento.desc.nullslast", "GET", secretKey);

    case "criar_lancamento": {
      if (!data.descricao || !data.valor) throw new Error("Descrição e valor são obrigatórios");
      const { id, ...campos } = data;
      const resultado = await supabaseRest("/financeiro_lancamentos", "POST", secretKey, campos);
      const criado = Array.isArray(resultado) ? resultado[0] : resultado;
      await registrarAtividade(secretKey, { usuarioNome, acao: "criar", area: "financeiro", descricao: data.descricao, registroId: criado && criado.id });
      return resultado;
    }

    case "atualizar_lancamento": {
      if (!data.id) throw new Error("id é obrigatório");
      const { id, ...campos } = data;
      const resultado = await supabaseRest("/financeiro_lancamentos?id=eq." + encodeURIComponent(id), "PATCH", secretKey, campos);
      await registrarAtividade(secretKey, { usuarioNome, acao: "editar", area: "financeiro", descricao: data.descricao || null, registroId: id });
      return resultado;
    }

    case "excluir_lancamento": {
      if (!data.id) throw new Error("id é obrigatório");
      const resultado = await supabaseRest("/financeiro_lancamentos?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);
      await registrarAtividade(secretKey, { usuarioNome, acao: "excluir", area: "financeiro", descricao: "Lançamento excluído", registroId: data.id });
      return resultado;
    }

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

    // ===== Contas fixas (aluguel, folha, assinaturas, parcelas...) =====
    case "listar_contas_fixas":
      return supabaseRest("/financeiro_contas_fixas?select=*&ativo=eq.true&order=dia_vencimento.asc.nullslast,nome.asc", "GET", secretKey);

    case "criar_conta_fixa": {
      if (!data.nome) throw new Error("Nome é obrigatório");
      const resultado = await supabaseRest("/financeiro_contas_fixas", "POST", secretKey, {
        nome: data.nome,
        valor: data.valor || null,
        dia_vencimento: data.dia_vencimento || null,
        banco_cartao: data.banco_cartao || null,
        categoria: data.categoria || null,
        recorrencia: data.recorrencia || "mensal",
        parcelas_restantes: data.parcelas_restantes || null,
      });
      const criado = Array.isArray(resultado) ? resultado[0] : resultado;
      await registrarAtividade(secretKey, { usuarioNome, acao: "criar", area: "financeiro_conta_fixa", descricao: data.nome, registroId: criado && criado.id });
      return resultado;
    }

    case "atualizar_conta_fixa": {
      if (!data.id) throw new Error("id é obrigatório");
      const { id, ...campos } = data;
      const resultado = await supabaseRest("/financeiro_contas_fixas?id=eq." + encodeURIComponent(id), "PATCH", secretKey, campos);
      await registrarAtividade(secretKey, { usuarioNome, acao: "editar", area: "financeiro_conta_fixa", descricao: data.nome || null, registroId: id });
      return resultado;
    }

    case "excluir_conta_fixa": {
      if (!data.id) throw new Error("id é obrigatório");
      // Desativa em vez de apagar — mantém o histórico de lançamentos já ligados a ela.
      const resultado = await supabaseRest("/financeiro_contas_fixas?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey, { ativo: false });
      await registrarAtividade(secretKey, { usuarioNome, acao: "excluir", area: "financeiro_conta_fixa", descricao: "Conta fixa desativada", registroId: data.id });
      return resultado;
    }

    // Confirma o pagamento do mês de uma conta fixa: cria o lançamento (saída/pago) ligado
    // a ela, atualiza "último valor pago" pra conferência do próximo mês, e — se for parcela
    // — desconta 1 das parcelas restantes automaticamente.
    case "marcar_conta_paga": {
      if (!data.id || !data.valor) throw new Error("id e valor são obrigatórios");
      const [conta] = await supabaseRest("/financeiro_contas_fixas?id=eq." + encodeURIComponent(data.id) + "&select=*", "GET", secretKey);
      if (!conta) throw new Error("Conta fixa não encontrada");

      const dataPagamento = data.data_pagamento || new Date().toISOString().slice(0, 10);
      const [lancamento] = await supabaseRest("/financeiro_lancamentos", "POST", secretKey, {
        tipo: "saida", status: "pago",
        descricao: conta.nome,
        categoria: conta.categoria || null,
        origem: conta.banco_cartao || null,
        valor: data.valor,
        vencimento: dataPagamento,
        fonte: "manual",
        conta_fixa_id: conta.id,
      });

      const camposConta = { ultimo_valor_pago: data.valor, ultima_vez_paga_em: dataPagamento };
      if (conta.recorrencia === "parcela" && conta.parcelas_restantes != null) {
        camposConta.parcelas_restantes = Math.max(0, conta.parcelas_restantes - 1);
      }
      await supabaseRest("/financeiro_contas_fixas?id=eq." + encodeURIComponent(conta.id), "PATCH", secretKey, camposConta);

      await registrarAtividade(secretKey, { usuarioNome, acao: "pagar", area: "financeiro_conta_fixa", descricao: conta.nome, registroId: conta.id });
      return { lancamento, conta: { ...conta, ...camposConta } };
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

      // Gera o id de cada fornecedor aqui em vez de deixar o Postgres gerar (gen_random_uuid()) —
      // o bulk insert do PostgREST não garante que a resposta volta na mesma ordem do envio, então
      // não dá pra confiar em "criados[i]" pra saber qual id corresponde a qual grupo.
      const novosFornecedores = semFornecedor.map((g) => ({ id: crypto.randomUUID(), nome: g.nome_novo }));
      if (novosFornecedores.length > 0) {
        await supabaseRest("/fornecedores", "POST", secretKey, novosFornecedores);
      }

      // Um por alias_normalizado: o insert não aceita duas linhas com a mesma chave no mesmo lote
      // (a IA pode repetir o mesmo nome em dois grupos, ou duplicar dentro do mesmo grupo).
      const aliasesPorChave = new Map();
      const addAlias = (a, fornecedorId) => aliasesPorChave.set(a.alias_normalizado, {
        alias_normalizado: a.alias_normalizado, alias_original: a.alias_original, fornecedor_id: fornecedorId, status: "confirmado",
      });
      semFornecedor.forEach((g, i) => (g.aliases || []).forEach((a) => addAlias(a, novosFornecedores[i].id)));
      comFornecedor.forEach((g) => (g.aliases || []).forEach((a) => addAlias(a, g.fornecedor_id)));
      const todosAliases = Array.from(aliasesPorChave.values());

      if (todosAliases.length > 0) {
        await supabaseRest(
          "/fornecedor_aliases?on_conflict=alias_normalizado", "POST", secretKey, todosAliases,
          { "Prefer": "resolution=merge-duplicates,return=representation" }
        );
      }

      return [...novosFornecedores, ...comFornecedor.map((g) => ({ id: g.fornecedor_id }))];
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

    // ===== Pagamentos a fornecedores =====
    // Vendas (da planilha OU cadastradas em Emissões) atribuídas a esse fornecedor — usado no
    // cliente pra calcular o saldo devedor (custo em milhas das vendas menos os pagamentos já
    // registrados).
    case "listar_lancamentos_fornecedor":
      if (!data.fornecedor_id) throw new Error("fornecedor_id é obrigatório");
      return supabaseRest(
        "/financeiro_lancamentos?select=id,descricao,vencimento,valor,sheet_meta&fornecedor_id=eq." +
          encodeURIComponent(data.fornecedor_id) + "&fonte=in.(planilha_venda,emissao_app)&order=vencimento.desc",
        "GET", secretKey
      );

    case "listar_pagamentos_fornecedor":
      if (!data.fornecedor_id) throw new Error("fornecedor_id é obrigatório");
      return supabaseRest(
        "/fornecedor_pagamentos?select=*&fornecedor_id=eq." + encodeURIComponent(data.fornecedor_id) + "&order=data.desc",
        "GET", secretKey
      );

    // Cria o pagamento e espelha como saída no razão principal (financeiro_lancamentos), pra
    // aparecer nos cards/gráficos do Financeiro automaticamente.
    case "criar_pagamento_fornecedor": {
      if (!data.fornecedor_id || !data.data || !data.valor_pago) throw new Error("fornecedor_id, data e valor_pago são obrigatórios");
      const [fornecedor] = await supabaseRest("/fornecedores?id=eq." + encodeURIComponent(data.fornecedor_id) + "&select=nome", "GET", secretKey);
      const [lancamento] = await supabaseRest("/financeiro_lancamentos", "POST", secretKey, {
        tipo: "saida", status: "pago", fonte: "manual", fornecedor_id: data.fornecedor_id,
        descricao: "Pagamento a " + (fornecedor?.nome || "fornecedor"),
        categoria: "Milheiro/Fornecedor",
        valor: data.valor_pago,
        vencimento: data.data,
      });
      const [pagamento] = await supabaseRest("/fornecedor_pagamentos", "POST", secretKey, {
        fornecedor_id: data.fornecedor_id, data: data.data, valor_pago: data.valor_pago,
        milhas_recebidas: data.milhas_recebidas || null, valor_por_milha: data.valor_por_milha || null,
        observacoes: data.observacoes || null, lancamento_id: lancamento.id,
      });
      return pagamento;
    }

    case "excluir_pagamento_fornecedor": {
      if (!data.id) throw new Error("id é obrigatório");
      await supabaseRest("/fornecedor_pagamentos?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);
      if (data.lancamento_id) {
        await supabaseRest("/financeiro_lancamentos?id=eq." + encodeURIComponent(data.lancamento_id), "DELETE", secretKey);
      }
      return { ok: true };
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}
