// Netlify Function — cadastro de Emissões (vendas confirmadas), via Supabase.
// Sem senha: a aba Emissões é de uso livre pra qualquer um no escritório, igual Clientes.
// Ao criar uma emissão, cada produto gera automaticamente um lançamento de entrada no
// Financeiro (fonte 'emissao_app') — assim a dívida com fornecedores de milhas
// (financeiro-fornecedores.js) e o caixa continuam corretos sem precisar da planilha.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — mesma usada por clientes-data.js/financeiro-data.js
//
// Tabelas necessárias no Supabase (criar uma vez via SQL Editor — nessa ordem, depois
// de já existirem "clientes" e "fornecedores"):
//
// IMPORTANTE: o nome é "venda_emissoes" (não "emissoes") porque já existe uma tabela
// "emissoes" nesse mesmo projeto Supabase, usada pelo Portal Corporativo
// (empresas-admin.js) — nada a ver com esta aba. Usar "emissoes" aqui colidiria com ela.
//
//   create table venda_emissoes (
//     id uuid primary key default gen_random_uuid(),
//     destino text,
//     data_ida date,
//     data_volta date,
//     tipo_viagem text,
//     observacoes_gerais text,
//     criado_em timestamptz not null default now()
//   );
//   alter table venda_emissoes enable row level security;
//
//   create table venda_emissoes_passageiros (
//     id uuid primary key default gen_random_uuid(),
//     emissao_id uuid not null references venda_emissoes(id) on delete cascade,
//     cliente_id uuid not null references clientes(id),
//     tamanho_mala text,
//     observacoes text,
//     criado_em timestamptz not null default now()
//   );
//   alter table venda_emissoes_passageiros enable row level security;
//
//   create table venda_emissoes_produtos (
//     id uuid primary key default gen_random_uuid(),
//     emissao_id uuid not null references venda_emissoes(id) on delete cascade,
//     tipo text not null check (tipo in ('passagem','hospedagem','seguro','carro','trem','passeio','transfer','mala','assento','consultoria_milhas','visto_americano','venda_milhas','outro')),
//     passageiro_ids jsonb not null default '[]',
//     dados jsonb not null default '{}',
//     fornecedor_id uuid references fornecedores(id),
//     valor_milha numeric(10,5),
//     qtd_milhas numeric(14,0),
//     custo numeric(12,2),
//     valor_venda numeric(12,2) not null,
//     lucro numeric(12,2) not null,
//     forma_pagamento text not null check (forma_pagamento in ('pix','sumup','valepay','faturado')),
//     data_faturamento date,
//     pagamentos jsonb not null default '[]', -- [{forma, valor, data_faturamento}] — detalhe completo
//                                              -- quando o produto é pago em mais de uma forma;
//                                              -- forma_pagamento/data_faturamento acima guardam só a 1ª
//     funcionaria text,
//     origem_lead text,
//     data_venda date not null default current_date,
//     criado_em timestamptz not null default now()
//   );
//   alter table venda_emissoes_produtos enable row level security;
//
//   -- Liga cada lançamento de entrada gerado automaticamente ao produto de origem, e
//   -- libera a nova fonte 'emissao_app' (além de 'planilha_venda' já existente):
//   alter table financeiro_lancamentos add column emissao_produto_id uuid references venda_emissoes_produtos(id) on delete set null;
//   alter table financeiro_lancamentos drop constraint financeiro_lancamentos_fonte_check;
//   alter table financeiro_lancamentos add constraint financeiro_lancamentos_fonte_check
//     check (fonte in ('manual','extrato_texto','extrato_ofx','extrato_csv','extrato_pdf','planilha_venda','emissao_app'));
//
//   -- Se a tabela venda_emissoes_produtos já existia antes destes tipos novos
//   -- (assento, consultoria_milhas, visto_americano, venda_milhas, trem), rodar uma vez
//   -- (inclui "trem", adicionado depois e esquecido aqui até 2026-08-17):
//   alter table venda_emissoes_produtos drop constraint venda_emissoes_produtos_tipo_check;
//   alter table venda_emissoes_produtos add constraint venda_emissoes_produtos_tipo_check
//     check (tipo in ('passagem','hospedagem','seguro','carro','trem','passeio','transfer','mala','assento','consultoria_milhas','visto_americano','venda_milhas','outro'));
//
//   -- Se a tabela já existia antes do campo "pagamentos" (múltiplas formas de pagamento
//   -- por produto), rodar uma vez:
//   alter table venda_emissoes_produtos add column if not exists pagamentos jsonb not null default '[]';
//
//   -- Necessário pra importar o histórico da planilha antiga (importar-planilha-antiga.js):
//   -- essas formas de pagamento só existem em vendas antigas, não aparecem como opção
//   -- nova no formulário de Nova Emissão daqui pra frente.
//   alter table venda_emissoes_produtos drop constraint venda_emissoes_produtos_forma_pagamento_check;
//   alter table venda_emissoes_produtos add constraint venda_emissoes_produtos_forma_pagamento_check
//     check (forma_pagamento in ('pix','sumup','valepay','faturado','pix_valepay','pix_sumup','wise','boleto','mittu','maquina_c6','stone','mercado_pago','dinheiro','infinity','inter_pj','btg','outro_pagamento'));

const https = require("https");
const { validarSessao, tokenDoEvento, registrarAtividade } = require("./_auth");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";
const CLIENTE_CAMPOS = ["nome", "nascimento", "rg", "cpf", "passaporte", "venc_passaporte", "email", "telefone", "endereco"];

const AÇÕES_QUE_PRECISAM_LOGIN = new Set([
  "criar_emissao", "editar_emissao", "excluir_emissao", "excluir_produto", "criar_fornecedor",
]);

const TIPO_LABEL = {
  passagem:   "Passagem aérea",
  hospedagem: "Hospedagem",
  seguro:     "Seguro viagem",
  carro:      "Aluguel de carro",
  trem:       "Trem",
  passeio:    "Passeio / Ingresso",
  transfer:   "Transfer",
  mala:       "Adicional de mala",
  assento:             "Assento",
  consultoria_milhas:  "Consultoria de milhas",
  visto_americano:     "Visto americano",
  venda_milhas:        "Venda de milhas",
  outro:               "Outro / Diversos",
};

const FORMA_PAG_LABEL = { pix: "Pix", sumup: "Sumup", valepay: "Valepay", faturado: "Faturado" };

exports.handler = async (event) => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      // O Supabase corta em 1000 linhas por padrão — sem paginar aqui, viagens antigas
      // (criado_em mais distante) somem da lista assim que a tabela passa de 1000 linhas
      // (ex: depois da importação do histórico da planilha antiga).
      const rows = await supabaseRestPaginado(
        "/venda_emissoes?select=*,venda_emissoes_passageiros(*),venda_emissoes_produtos(*)&order=criado_em.desc",
        secretKey
      );
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows || []) };
    }

    if (event.httpMethod === "POST") {
      let payload;
      try { payload = JSON.parse(event.body || "{}"); }
      catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

      const sessao = await validarSessao(tokenDoEvento(event), secretKey);
      if (AÇÕES_QUE_PRECISAM_LOGIN.has(payload.action) && !sessao.valido) {
        return { statusCode: 401, body: JSON.stringify({ error: "Sessão expirada — faça login novamente." }) };
      }

      const resultado = await executarAcao(payload.action, payload.data || {}, secretKey, sessao);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(resultado) };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    console.error("[emissoes-data] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function executarAcao(action, data, secretKey, sessao) {
  const usuarioNome = sessao && sessao.nome;
  switch (action) {
    case "criar_emissao": {
      const resultado = await criarEmissao(data, secretKey);
      await registrarAtividade(secretKey, {
        usuarioNome, acao: "criar", area: "emissao",
        descricao: "Emissão" + ((data.emissao || {}).destino ? " — " + data.emissao.destino : ""),
        registroId: resultado.emissao && resultado.emissao.id,
      });
      return resultado;
    }

    case "excluir_emissao": {
      if (!data.id) throw new Error("id é obrigatório");
      const produtos = await supabaseRest(
        "/venda_emissoes_produtos?emissao_id=eq." + encodeURIComponent(data.id) + "&select=id",
        "GET", secretKey
      );
      const idsProdutos = (produtos || []).map((p) => p.id);
      if (idsProdutos.length > 0) {
        await supabaseRest(
          "/financeiro_lancamentos?emissao_produto_id=in.(" + idsProdutos.join(",") + ")",
          "DELETE", secretKey
        );
      }
      await supabaseRest("/venda_emissoes?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);
      await registrarAtividade(secretKey, { usuarioNome, acao: "excluir", area: "emissao", descricao: "Emissão excluída", registroId: data.id });
      return { ok: true };
    }

    case "editar_emissao": {
      if (!data.id) throw new Error("id é obrigatório");

      // A edição recria a emissão do zero (ver criarEmissao) — sem isso, ela ganharia um
      // criado_em novo e pularia pro topo da lista/Emissões como se tivesse sido cadastrada
      // hoje, mesmo sendo só uma correção de algo antigo. Preserva a data original.
      const [antiga] = await supabaseRest(
        "/venda_emissoes?id=eq." + encodeURIComponent(data.id) + "&select=criado_em",
        "GET", secretKey
      );

      // Cria a versão nova primeiro; só apaga a antiga depois de confirmar sucesso — se a
      // criação falhar no meio do caminho (criarEmissao já reverte o que criou), a emissão
      // antiga continua intacta em vez de a usuária perder os dados.
      // pularBackupPlanilha: uma edição não é uma venda nova — sem isso, cada correção
      // mandaria mais uma linha pra planilha do Drive, duplicando o que já tá lá.
      const resultado = await criarEmissao(data, secretKey, {
        criadoEm: antiga && antiga.criado_em,
        pularBackupPlanilha: true,
      });
      await registrarAtividade(secretKey, {
        usuarioNome, acao: "editar", area: "emissao",
        descricao: "Emissão editada" + ((data.emissao || {}).destino ? " — " + data.emissao.destino : ""),
        registroId: data.id,
      });

      // Se a limpeza da versão antiga falhar por qualquer motivo, isso NÃO pode ficar em
      // silêncio — senão a emissão antiga fica esquecida no banco parecendo duplicada
      // (foi exatamente isso que aconteceu antes desta correção). Reporta um aviso em vez
      // de engolir o erro.
      let avisoLimpeza = null;
      try {
        const produtosAntigos = await supabaseRest(
          "/venda_emissoes_produtos?emissao_id=eq." + encodeURIComponent(data.id) + "&select=id",
          "GET", secretKey
        );
        const idsAntigos = (produtosAntigos || []).map((p) => p.id);
        if (idsAntigos.length > 0) {
          await supabaseRest("/financeiro_lancamentos?emissao_produto_id=in.(" + idsAntigos.join(",") + ")", "DELETE", secretKey);
        }
        await supabaseRest("/venda_emissoes?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);
      } catch (err) {
        console.error("[emissoes-data] editar_emissao: falha ao remover a versão antiga (id " + data.id + "):", err.message);
        avisoLimpeza = "A edição foi salva, mas a versão antiga (id " + data.id + ") não pôde ser removida automaticamente — pode ter ficado duplicada. Vá em Emissões → Por viagem e exclua a versão antiga manualmente.";
      }

      return { ...resultado, aviso: avisoLimpeza };
    }

    case "excluir_produto": {
      if (!data.id) throw new Error("id é obrigatório");
      const [produto] = await supabaseRest(
        "/venda_emissoes_produtos?id=eq." + encodeURIComponent(data.id) + "&select=id,emissao_id",
        "GET", secretKey
      );
      if (!produto) throw new Error("Produto não encontrado");

      await supabaseRest("/financeiro_lancamentos?emissao_produto_id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);
      await supabaseRest("/venda_emissoes_produtos?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);

      // Se a viagem ficou sem nenhum produto, apaga a viagem (e os passageiros ligados a
      // ela) também, pra não deixar um card vazio boiando na aba Emissões.
      const restantes = await supabaseRest(
        "/venda_emissoes_produtos?emissao_id=eq." + encodeURIComponent(produto.emissao_id) + "&select=id",
        "GET", secretKey
      );
      if (!restantes || restantes.length === 0) {
        await supabaseRest("/venda_emissoes?id=eq." + encodeURIComponent(produto.emissao_id), "DELETE", secretKey);
      }
      await registrarAtividade(secretKey, { usuarioNome, acao: "excluir", area: "emissao", descricao: "Produto excluído da emissão", registroId: data.id });
      return { ok: true };
    }

    case "listar_produtos_periodo": {
      if (!data.de || !data.ate) throw new Error("de e ate são obrigatórios");
      return supabaseRest(
        "/venda_emissoes_produtos?select=*,venda_emissoes(destino)" +
          "&data_venda=gte." + encodeURIComponent(data.de) +
          "&data_venda=lte." + encodeURIComponent(data.ate) +
          "&order=data_venda.asc",
        "GET", secretKey
      );
    }

    // ===== Fornecedores (mesma tabela do Financeiro, sem exigir a senha do Financeiro
    // pra só escolher/cadastrar um milheiro/site/operadora na hora de registrar uma venda) =====
    case "listar_fornecedores":
      return supabaseRest("/fornecedores?select=*&order=nome.asc", "GET", secretKey);

    case "criar_fornecedor": {
      if (!data.nome) throw new Error("Nome do fornecedor é obrigatório");
      const resultado = await supabaseRest("/fornecedores", "POST", secretKey, { nome: data.nome });
      await registrarAtividade(secretKey, { usuarioNome, acao: "criar", area: "fornecedor", descricao: data.nome, registroId: resultado && resultado[0] && resultado[0].id });
      return resultado;
    }

    // Só nome/id (sem CNPJ nem nada sensível) — pra popular o seletor de empresa numa
    // venda marcada como Corporativo, sem exigir a senha do Portal Corporativo
    // (empresas-admin.js) só pra isso.
    case "listar_empresas_nomes":
      return supabaseRest("/empresas?select=id,nome&order=nome.asc", "GET", secretKey);

    // Temporária, só pra validar o teste ponta a ponta da sincronização automática com o
    // Portal Corporativo — remover depois de confirmar.
    case "_debug_listar_emissoes_empresa":
      if (!data.empresa_id) throw new Error("empresa_id é obrigatório");
      return supabaseRest("/emissoes?select=*&empresa_id=eq." + encodeURIComponent(data.empresa_id) + "&order=criado_em.desc", "GET", secretKey);
    case "_debug_excluir_emissao_empresa":
      if (!data.id) throw new Error("id é obrigatório");
      await supabaseRest("/emissoes?id=eq." + encodeURIComponent(data.id), "DELETE", secretKey);
      return { ok: true };

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}

async function criarEmissao(data, secretKey, opcoes) {
  opcoes = opcoes || {};
  const emissao     = data.emissao || {};
  const passageiros = Array.isArray(data.passageiros) ? data.passageiros : [];
  const produtos     = Array.isArray(data.produtos) ? data.produtos : [];

  if (passageiros.length === 0) throw new Error("Informe ao menos um passageiro");
  if (produtos.length === 0) throw new Error("Informe ao menos um produto");

  // Os inserts abaixo são feitos em sequência via REST (sem transação real do Postgres).
  // Se qualquer etapa falhar no meio do caminho, o catch desfaz manualmente tudo que já
  // foi criado nesta chamada — senão o usuário reenvia o formulário depois de corrigir o
  // erro e acaba duplicando a emissão (aconteceu: erro no financeiro_lancamentos do 2º
  // produto deixou a emissão e o 1º produto já salvos, e o reenvio criou tudo de novo).
  const clientesCriadosNestaChamada = [];
  const produtosCriados = [];
  let emissaoCriada = null;

  try {
    [emissaoCriada] = await supabaseRest("/venda_emissoes", "POST", secretKey, {
      destino:            emissao.destino || null,
      data_ida:           emissao.data_ida || null,
      data_volta:         emissao.data_volta || null,
      tipo_viagem:        emissao.tipo_viagem || null,
      observacoes_gerais: emissao.observacoes_gerais || null,
      criado_em:          opcoes.criadoEm || undefined,
    });

    // Criados em sequência (não em lote) porque a ordem da resposta do PostgREST não é
    // garantida em inserts múltiplos — e os produtos abaixo precisam saber o id exato de
    // cada passageiro pela posição no array que o front mandou.
    const passageirosCriados = [];
    for (const p of passageiros) {
      let clienteId = p.cliente_id || null;
      if (!clienteId) {
        if (!p.dados_novos || !p.dados_novos.nome) throw new Error("Passageiro sem cliente_id precisa de dados_novos.nome");
        const registroCliente = {};
        CLIENTE_CAMPOS.forEach((c) => { registroCliente[c] = p.dados_novos[c] || null; });
        const [clienteCriado] = await supabaseRest("/clientes", "POST", secretKey, registroCliente);
        clienteId = clienteCriado.id;
        clientesCriadosNestaChamada.push(clienteId);
      }
      const [passageiroCriado] = await supabaseRest("/venda_emissoes_passageiros", "POST", secretKey, {
        emissao_id: emissaoCriada.id,
        cliente_id: clienteId,
        tamanho_mala: p.tamanho_mala || null,
        observacoes: p.observacoes || null,
      });
      passageirosCriados.push(passageiroCriado);
    }

    // Nomes dos clientes — só pra linha de backup na planilha (ver enviarParaPlanilhaBackup
    // logo abaixo); o resto da função só guarda cliente_id.
    const idsClientesUnicos = [...new Set(passageirosCriados.map((p) => p.cliente_id).filter(Boolean))];
    const clienteNomePorId = new Map();
    if (idsClientesUnicos.length > 0) {
      try {
        const clientesRows = await supabaseRest("/clientes?id=in.(" + idsClientesUnicos.join(",") + ")&select=id,nome", "GET", secretKey);
        (clientesRows || []).forEach((c) => clienteNomePorId.set(c.id, c.nome));
      } catch (err) {
        console.error("[emissoes-data] falha ao buscar nomes pro backup da planilha:", err.message);
      }
    }

    const hoje = new Date().toISOString().slice(0, 10);

    for (const prod of produtos) {
      if (!TIPO_LABEL[prod.tipo]) throw new Error("Tipo de produto inválido: " + prod.tipo);

      // O custo é sempre digitado à mão, nunca calculado a partir de qtd_milhas ×
      // valor_milha — o valor final combinado com o milheiro às vezes tem pequenos
      // ajustes que a conta simples não capta. valor_milha/qtd_milhas continuam sendo
      // gravados (servem só pro controle de dívida com fornecedores em
      // financeiro-fornecedores.js, que lê sheet_meta separadamente).
      const custoTotal = Number(prod.custo) || 0;

      // Uma ou mais formas de pagamento, cada uma com seu próprio valor (ex: parte de
      // entrada no Pix, parte faturada) — o valor total do produto é sempre a soma delas.
      // Registro antigo sem "pagamentos" (de antes desse campo existir) vira uma linha só.
      const pagamentos = (Array.isArray(prod.pagamentos) && prod.pagamentos.length > 0)
        ? prod.pagamentos
        : [{ forma: prod.forma_pagamento || "pix", valor: prod.valor_venda, data_faturamento: prod.data_faturamento || null }];
      const valorVenda = pagamentos.reduce((s, pg) => s + (Number(pg.valor) || 0), 0);
      const lucro = valorVenda - custoTotal;
      const primeiroPagamento = pagamentos[0] || {};
      const faturadoPrimeiro = primeiroPagamento.forma === "faturado";

      const idxList = Array.isArray(prod.passageiro_indices) ? prod.passageiro_indices : [];
      const passageiroIds = idxList.map((i) => passageirosCriados[i] && passageirosCriados[i].id).filter(Boolean);
      const dataVenda = prod.data_venda || hoje;

      const [produtoCriado] = await supabaseRest("/venda_emissoes_produtos", "POST", secretKey, {
        emissao_id: emissaoCriada.id,
        tipo: prod.tipo,
        passageiro_ids: passageiroIds,
        dados: prod.dados || {},
        fornecedor_id: prod.fornecedor_id || null,
        valor_milha: prod.valor_milha || null,
        qtd_milhas: prod.qtd_milhas || null,
        custo: prod.custo || null,
        valor_venda: valorVenda,
        lucro,
        // forma_pagamento/data_faturamento guardam só a 1ª forma, por compatibilidade com
        // telas antigas — o detalhe completo (todas as formas) fica em "pagamentos".
        forma_pagamento: primeiroPagamento.forma || "pix",
        data_faturamento: faturadoPrimeiro ? (primeiroPagamento.data_faturamento || null) : null,
        pagamentos: pagamentos.map((pg) => ({
          forma: pg.forma,
          valor: Number(pg.valor) || 0,
          data_faturamento: pg.forma === "faturado" ? (pg.data_faturamento || null) : null,
        })),
        funcionaria: prod.funcionaria || null,
        origem_lead: prod.origem_lead || null,
        data_venda: dataVenda,
      });
      produtosCriados.push(produtoCriado);

      // Backup: espelha esta linha na planilha antiga do Drive (Apps Script), pra nunca
      // depender só do Supabase. "await" aqui não é pra travar a emissão — é só pra
      // garantir que o envio realmente saia antes da function encerrar (em ambiente
      // serverless, sem esperar, a chamada pode ser cortada antes de completar). Falha
      // no backup nunca derruba a emissão (enviarParaPlanilhaBackup nunca lança erro).
      // Mesma condição usada abaixo pro Portal Corporativo: uma edição (pularBackupPlanilha)
      // é só a correção de uma venda que já existe, não uma venda nova de novo — sincronizar
      // de novo criaria um registro duplicado no portal da empresa.
      if (!opcoes.pularBackupPlanilha) {
        const nomesPaxProduto = passageiroIds.map((id) => {
          const pax = passageirosCriados.find((p) => p.id === id);
          return pax && clienteNomePorId.get(pax.cliente_id);
        }).filter(Boolean).join(" / ");
        await enviarParaPlanilhaBackup(montarLinhaBackup(emissao, prod, produtoCriado, nomesPaxProduto));

        // Venda corporativa com empresa selecionada: cria automaticamente o registro
        // correspondente no Portal Corporativo (aba Empresas), pra não precisar cadastrar
        // duas vezes. Nunca pode derrubar a venda em si — qualquer erro aqui só fica
        // registrado no log da function.
        if (prod.origem_lead === "Corporativo" && prod.dados && prod.dados.empresa_id) {
          try {
            await sincronizarEmissaoCorporativa({ emissao, prod, dataVenda, valorVenda, nomesPaxProduto }, secretKey);
          } catch (err) {
            console.error("[emissoes-data] falha ao sincronizar venda corporativa com o Portal Corporativo (produto " + produtoCriado.id + "):", err.message);
          }
        }
      }

      // Um lançamento financeiro POR forma de pagamento — assim uma entrada de Pix e um
      // saldo faturado do mesmo produto aparecem como eventos de caixa distintos.
      const paxCount = passageiroIds.length || 1;
      for (const pg of pagamentos) {
        const valorPg = Number(pg.valor) || 0;
        if (valorPg <= 0) continue;
        const faturadoPg = pg.forma === "faturado";
        const sufixoForma = pagamentos.length > 1 ? " [" + (FORMA_PAG_LABEL[pg.forma] || pg.forma) + "]" : "";
        await supabaseRest("/financeiro_lancamentos", "POST", secretKey, {
          tipo: "entrada",
          status: faturadoPg ? "pendente" : "pago",
          fonte: "emissao_app",
          descricao: TIPO_LABEL[prod.tipo] + (emissao.destino ? " — " + emissao.destino : "") + (paxCount > 1 ? " (" + paxCount + " pax)" : "") + sufixoForma,
          categoria: TIPO_LABEL[prod.tipo],
          valor: valorPg,
          vencimento: faturadoPg ? (pg.data_faturamento || null) : dataVenda,
          fornecedor_id: prod.fornecedor_id || null,
          sheet_meta: (prod.valor_milha != null && prod.qtd_milhas != null)
            ? { valor_milha: prod.valor_milha, qtd_milhas: prod.qtd_milhas } : null,
          emissao_produto_id: produtoCriado.id,
        });
      }

      // Passagem com 2+ trechos, cada um com fornecedor/milhas próprios (comprados
      // separado, ex: ida e volta ou trechos de um roteiro em companhias diferentes): o
      // custo de cada trecho já entrou somado no "custo" do produto acima (pro lucro total
      // ficar certo) e o 1º trecho já vira o lançamento normal (fornecedor_id/sheet_meta
      // do produto, no loop de pagamentos acima) — aqui é só o restante dos trechos (2º em
      // diante), cada um com seu próprio lançamento extra de valor 0 (não é uma cobrança a
      // mais do cliente, só registro de custo/milhas pro controle daquele fornecedor).
      const trechosPassagem = prod.tipo === "passagem" && prod.dados && Array.isArray(prod.dados.trechos) ? prod.dados.trechos : [];
      for (const trecho of trechosPassagem.slice(1)) {
        const fin = trecho.financeiro;
        if (!fin || !fin.fornecedor_id || fin.valor_milha == null || fin.qtd_milhas == null) continue;
        await supabaseRest("/financeiro_lancamentos", "POST", secretKey, {
          tipo: "entrada",
          status: "pago",
          fonte: "emissao_app",
          descricao: "Custo — " + (trecho.label || "trecho") + " (fornecedor separado)" + (emissao.destino ? " — " + emissao.destino : ""),
          categoria: TIPO_LABEL[prod.tipo],
          valor: 0,
          vencimento: dataVenda,
          fornecedor_id: fin.fornecedor_id,
          sheet_meta: { valor_milha: fin.valor_milha, qtd_milhas: fin.qtd_milhas },
          emissao_produto_id: produtoCriado.id,
        });
      }
    }

    return { emissao: emissaoCriada, passageiros: passageirosCriados, produtos: produtosCriados };
  } catch (err) {
    await reverterEmissaoParcial(emissaoCriada, produtosCriados, clientesCriadosNestaChamada, secretKey);
    throw err;
  }
}

async function reverterEmissaoParcial(emissaoCriada, produtosCriados, clientesCriadosNestaChamada, secretKey) {
  const idsProdutos = produtosCriados.map((p) => p.id);
  if (idsProdutos.length > 0) {
    await supabaseRest("/financeiro_lancamentos?emissao_produto_id=in.(" + idsProdutos.join(",") + ")", "DELETE", secretKey).catch(() => {});
  }
  if (emissaoCriada) {
    // Cascata apaga também venda_emissoes_passageiros e venda_emissoes_produtos.
    await supabaseRest("/venda_emissoes?id=eq." + encodeURIComponent(emissaoCriada.id), "DELETE", secretKey).catch(() => {});
  }
  for (const clienteId of clientesCriadosNestaChamada) {
    await supabaseRest("/clientes?id=eq." + encodeURIComponent(clienteId), "DELETE", secretKey).catch(() => {});
  }
}

// ===== Sincronização automática com o Portal Corporativo (aba Empresas) =====
// Quando uma venda é marcada como "Corporativo" com uma empresa selecionada, replica o
// produto como uma "emissão" da empresa (tabela "emissoes", mesmo projeto Supabase, usada
// pelo Portal Corporativo em empresas-admin.js/empresas.js) — assim a empresa já aparece
// com a venda sem precisar cadastrar de novo à mão. Mesma extração de saída/localizador já
// usada no backup da planilha (montarLinhaBackup), só que mapeada pras colunas da tabela
// "emissoes" (bem diferente da "venda_emissoes_produtos": um serviço só, sem trechos/perna).
function extrairSaidaDestino(prod, emissao) {
  const d = prod.dados || {};
  if (prod.tipo === "passagem") {
    const ida = d.ida || d;
    const seg = (ida.segmentos && ida.segmentos[0]) || ida;
    const partes = (seg.trecho || "").split("→").map((s) => s.trim()).filter(Boolean);
    return { saida: partes[0] || null, destino: partes[1] || emissao.destino || null };
  }
  if (prod.tipo === "hospedagem") return { saida: null, destino: d.hotel || emissao.destino || null };
  return { saida: null, destino: emissao.destino || null };
}

function extrairLocalizador(prod) {
  const d = prod.dados || {};
  return (prod.tipo === "passagem" ? (d.ida || d).localizador : d.localizador) || null;
}

async function sincronizarEmissaoCorporativa(ctx, secretKey) {
  const { emissao, prod, dataVenda, valorVenda, nomesPaxProduto } = ctx;
  const d = prod.dados || {};
  const { saida, destino } = extrairSaidaDestino(prod, emissao);

  await supabaseRest("/emissoes", "POST", secretKey, {
    empresa_id: d.empresa_id,
    data_emissao: dataVenda,
    servico: TIPO_LABEL[prod.tipo] || prod.tipo,
    passageiro: nomesPaxProduto || "—",
    data_ida: prod.tipo === "hospedagem" ? (d.checkin || null) : (emissao.data_ida || null),
    data_volta: prod.tipo === "hospedagem" ? (d.checkout || null) : (emissao.data_volta || null),
    saida,
    destino,
    localizador: extrairLocalizador(prod),
    valor: valorVenda,
    data_pagamento: null,
    status_pagamento: "aguardando",
    nota_fiscal_status: "nao_solicitada",
  });
}

// ===== Backup automático na planilha antiga do Drive (Apps Script) =====
// Variável de ambiente opcional: PLANILHA_BACKUP_URL — URL do Web App do Apps Script
// (ver netlify/functions/../apps-script-backup.gs, ou o arquivo que a Thay tem). Se não
// estiver configurada, simplesmente não faz nada (não é erro).
function fmtDataBR(iso) {
  if (!iso) return "";
  const partes = String(iso).slice(0, 10).split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : iso;
}

function montarLinhaBackup(emissao, prod, produtoCriado, nomesPax) {
  const d = prod.dados || {};
  let saida = "", companhia = "", reserva = "";

  if (prod.tipo === "passagem") {
    const ida = d.ida || d;
    const seg = (ida.segmentos && ida.segmentos[0]) || ida;
    const partesTrecho = (seg.trecho || "").split("→").map((s) => s.trim()).filter(Boolean);
    saida = partesTrecho[0] || "";
    companhia = seg.companhia || "";
    reserva = ida.localizador || "";
  } else if (prod.tipo === "hospedagem") {
    companhia = d.hotel || "";
    reserva = d.localizador || "";
  } else if (prod.tipo === "carro") {
    companhia = d.locadora || "";
    reserva = d.localizador || "";
  } else if (prod.tipo === "seguro") {
    companhia = d.seguradora || "";
    reserva = d.localizador || "";
  } else if (prod.tipo === "trem") {
    companhia = d.companhia || "";
    reserva = d.localizador || "";
  } else {
    reserva = d.localizador || "";
  }

  const primeiraForma = (prod.pagamentos && prod.pagamentos[0] && prod.pagamentos[0].forma) || prod.forma_pagamento;

  return {
    data: fmtDataBR(produtoCriado.data_venda),
    situacao: "AGUARDANDO VIAGEM",
    venda: prod.funcionaria || "",
    lead: prod.origem_lead || "",
    nome: nomesPax || "",
    ida: fmtDataBR(emissao.data_ida),
    volta: fmtDataBR(emissao.data_volta),
    saida,
    destino: emissao.destino || "",
    companhia,
    milheiro: "", // fornecedor vira nome só via join — não vale o custo extra aqui, fica em branco
    reserva,
    forma: FORMA_PAG_LABEL[primeiraForma] || primeiraForma || "",
    taxaEmbarque: prod.tipo === "passagem" ? (d.taxa_embarque || "") : "",
    valorTotal: produtoCriado.valor_venda || "",
    lucro: produtoCriado.lucro || "",
    valorMilha: produtoCriado.valor_milha || "",
    taxas: "",
    qtdMilhas: produtoCriado.qtd_milhas || "",
  };
}

async function enviarParaPlanilhaBackup(linha) {
  const url = process.env.PLANILHA_BACKUP_URL;
  if (!url) return; // backup não configurado — segue normalmente
  try {
    // GET, não POST: nesta conta do Google, o redirecionamento do Apps Script Web App só
    // aceita GET/HEAD até o ponto de execução real (POST dá 405 antes do script rodar,
    // confirmado testando manualmente) — os dados vão como parâmetro "dados" na URL.
    const urlComDados = new URL(url);
    urlComDados.searchParams.set("dados", JSON.stringify(linha));
    await getSeguindoRedirect(urlComDados.toString());
  } catch (err) {
    console.error("[emissoes-data] falha ao espelhar na planilha de backup:", err.message);
  }
}

function getSeguindoRedirect(urlStr, redirectsRestantes) {
  if (redirectsRestantes == null) redirectsRestantes = 4;
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "GET" }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsRestantes > 0) {
        res.resume();
        getSeguindoRedirect(res.headers.location, redirectsRestantes - 1).then(resolve, reject);
        return;
      }
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => resolve(chunks));
    });
    req.on("error", reject);
    req.end();
  });
}

// ===== Chamada genérica para a REST API do Supabase (PostgREST) =====
// Busca todas as páginas de um GET, usando o header Range do PostgREST — necessário
// porque o Supabase corta em 1000 linhas por página por padrão.
async function supabaseRestPaginado(path, secretKey) {
  const PAGE = 1000;
  let offset = 0;
  let todas = [];
  while (true) {
    const pagina = await supabaseRest(path, "GET", secretKey, null, { Range: `${offset}-${offset + PAGE - 1}` });
    if (!pagina || pagina.length === 0) break;
    todas = todas.concat(pagina);
    if (pagina.length < PAGE) break;
    offset += PAGE;
  }
  return todas;
}

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
