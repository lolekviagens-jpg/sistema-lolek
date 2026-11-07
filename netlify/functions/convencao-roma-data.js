// Netlify Function — Convenção Shalom Roma 2026: dados dos peregrinos (importados da
// planilha de preparação) + envio das mensagens pré-viagem via Digisac.
// Sem senha: igual Check-in/Follow-up/Convenção, leitura/escrita livre pra qualquer uma no
// escritório.
//
// Variável de ambiente necessária no painel do Netlify:
//   SUPABASE_SECRET_KEY — mesma do resto do sistema
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table convencao_roma_peregrinos (
//     id uuid primary key default gen_random_uuid(),
//     planilha_num int,
//     origem text not null check (origem in ('lista_principal','fora_do_filtro')),
//     decisao_participa text not null default 'sim'
//       check (decisao_participa in ('pendente','sim','nao')),
//
//     nome text not null,
//     vendedora text,
//     responsavel_lolek text,
//     cliente_id uuid references clientes(id),
//     whatsapp text,
//
//     cia_aerea text, voo_ida text, data_voo_ida date, hora_voo_ida text,
//     aeroporto_saida text, conexao_cidade text, data_volta date, voo_tem_conexao boolean,
//     pais_imigracao text,
//
//     hotel_roma_nome text, hotel_roma_endereco text, hotel_roma_estrelas int,
//     hotel_roma_noites int, hotel_roma_checkin text,
//     hotel_assis_nome text, hotel_assis_endereco text, hotel_assis_taxa numeric,
//     hotel_assis_noites int,
//     outras_hosp_nome text, outras_hosp_endereco text,
//
//     seguradora text check (seguradora in ('GTA','Assist Card')),
//     seguro_apolice text,
//     trem_data date, trem_horario text, trem_estacao_saida text,
//     transfer_info text,
//
//     itens_identificados text,
//
//     raw_voos text, raw_hotel_roma text, raw_hotel_assis text, raw_outras_hosp text,
//     raw_seguro text, raw_trem text, raw_outros_itens text, raw_pendencias text,
//
//     status text not null default 'revisar',
//     mensagens_enviadas jsonb not null default '{}',
//
//     criado_em timestamptz not null default now(),
//     atualizado_em timestamptz not null default now()
//   );
//   alter table convencao_roma_peregrinos enable row level security;
//
//   -- Upsert de reimportação casa por nome (índice único — PostgREST "on_conflict" exige
//   -- índice de verdade, não dá pra usar coalesce/expressão). Limitação aceita: duas pessoas
//   -- reais com o nome exatamente igual se misturariam numa reimportação — raro o bastante
//   -- pra essa lista, e cada reimportação é revisada na tela de qualquer jeito.
//   create unique index convencao_roma_peregrinos_nome_idx
//     on convencao_roma_peregrinos (nome);
//
//   -- Se a tabela já existia antes do campo de conexão (2026-11-06), rodar uma vez:
//   alter table convencao_roma_peregrinos add column if not exists voo_tem_conexao boolean;
//
//   -- Se a tabela já existia antes do país da imigração (2026-11-06), rodar uma vez:
//   alter table convencao_roma_peregrinos add column if not exists pais_imigracao text;
//
// Ações (POST { action, data }):
//   importar_peregrinos { peregrinos: [...] }  -> upsert em lote, recalcula status de cada um
//   listar_peregrinos                          -> [{...}]
//   atualizar_peregrino { id, ...campos }      -> PATCH parcial, recalcula status
//   decidir_participacao { id, decisao }       -> 'sim' | 'nao', só pra fora_do_filtro
//   marcar_mensagem_enviada { id, numero, manual? } -> grava em mensagens_enviadas (manual=true: enviado por fora do Digisac)

const https = require("https");

const SUPABASE_URL = "https://emadqnrylsqjmevxasup.supabase.co";

const CAMPOS_EDITAVEIS = [
  "vendedora", "responsavel_lolek", "cliente_id", "whatsapp",
  "cia_aerea", "voo_ida", "data_voo_ida", "hora_voo_ida", "aeroporto_saida", "voo_tem_conexao", "conexao_cidade", "pais_imigracao", "data_volta",
  "hotel_roma_nome", "hotel_roma_endereco", "hotel_roma_estrelas", "hotel_roma_noites", "hotel_roma_checkin",
  "hotel_assis_nome", "hotel_assis_endereco", "hotel_assis_taxa", "hotel_assis_noites",
  "outras_hosp_nome", "outras_hosp_endereco",
  "seguradora", "seguro_apolice",
  "trem_data", "trem_horario", "trem_estacao_saida",
  "transfer_info", "itens_identificados",
];

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

  try {
    const resultado = await executarAcao(payload.action, payload.data || {}, secretKey);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error("[convencao-roma-data] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// "Pendência" é só considerada quando o campo BRUTO correspondente diz que a pessoa comprou
// aquilo (senão, quem nunca comprou seguro ficaria pra sempre em "revisar" por falta de
// seguradora, por exemplo). decisao_participa='nao' nunca vira "pronto" — a pessoa foi
// excluída da conta, não faz sentido disparar mensagem pra ela.
function calcularStatus(p) {
  if (p.origem === "fora_do_filtro" && (p.decisao_participa || "pendente") === "pendente") return "decidir";
  if (p.decisao_participa === "nao") return "revisar";
  if (!p.whatsapp) return "revisar";
  // Sem confirmar se tem conexão, a mensagem pode dar uma orientação de imigração errada
  // (ex: dizer "imigração em Roma" pra alguém que na verdade entra na Europa por outro
  // país) — por isso bloqueia "pronto" até alguém confirmar, mesmo que o resto esteja ok.
  if (p.data_voo_ida && p.voo_tem_conexao == null) return "revisar";
  if (p.voo_tem_conexao === true && !p.conexao_cidade) return "revisar";
  if (p.raw_seguro && !p.seguradora) return "revisar";
  if (p.raw_hotel_roma && !(p.hotel_roma_nome && p.hotel_roma_endereco)) return "revisar";
  if (p.raw_hotel_assis && !(p.hotel_assis_nome && p.hotel_assis_endereco)) return "revisar";
  if (p.raw_outras_hosp && !(p.outras_hosp_nome && p.outras_hosp_endereco)) return "revisar";
  if (p.raw_outros_itens && !p.itens_identificados) return "revisar";
  return "pronto";
}

async function recalcularStatus(id, secretKey) {
  const [p] = await supabaseRest("/convencao_roma_peregrinos?id=eq." + encodeURIComponent(id) + "&select=*", "GET", secretKey);
  if (!p) return;
  const status = calcularStatus(p);
  if (status !== p.status) {
    await supabaseRest("/convencao_roma_peregrinos?id=eq." + encodeURIComponent(id), "PATCH", secretKey,
      { status, atualizado_em: new Date().toISOString() }, { "Prefer": "return=minimal" });
  }
}

async function executarAcao(action, data, secretKey) {
  switch (action) {
    case "importar_peregrinos": {
      const lista = Array.isArray(data.peregrinos) ? data.peregrinos : [];
      if (lista.length === 0) throw new Error("Nenhum peregrino pra importar");
      const linhas = lista.map((p) => ({
        planilha_num: p.planilha_num ?? null,
        origem: p.origem === "fora_do_filtro" ? "fora_do_filtro" : "lista_principal",
        decisao_participa: p.origem === "fora_do_filtro" ? "pendente" : "sim",
        nome: p.nome,
        vendedora: p.vendedora || null,
        responsavel_lolek: p.vendedora || null,
        cliente_id: p.cliente_id || null,
        whatsapp: p.whatsapp || null,
        cia_aerea: p.cia_aerea || null, voo_ida: p.voo_ida || null,
        data_voo_ida: p.data_voo_ida || null, hora_voo_ida: p.hora_voo_ida || null,
        aeroporto_saida: p.aeroporto_saida || null, conexao_cidade: p.conexao_cidade || null,
        // "false" é um valor válido (voo direto confirmado) — não pode virar null com "||".
        voo_tem_conexao: p.voo_tem_conexao === undefined ? null : p.voo_tem_conexao,
        data_volta: p.data_volta || null,
        hotel_roma_nome: p.hotel_roma_nome || null, hotel_roma_endereco: p.hotel_roma_endereco || null,
        hotel_roma_estrelas: p.hotel_roma_estrelas || null, hotel_roma_noites: p.hotel_roma_noites || null,
        hotel_roma_checkin: p.hotel_roma_checkin || null,
        hotel_assis_nome: p.hotel_assis_nome || null, hotel_assis_endereco: p.hotel_assis_endereco || null,
        hotel_assis_taxa: p.hotel_assis_taxa || null, hotel_assis_noites: p.hotel_assis_noites || null,
        outras_hosp_nome: p.outras_hosp_nome || null, outras_hosp_endereco: p.outras_hosp_endereco || null,
        seguradora: p.seguradora || null, seguro_apolice: p.seguro_apolice || null,
        trem_data: p.trem_data || null, trem_horario: p.trem_horario || null, trem_estacao_saida: p.trem_estacao_saida || null,
        transfer_info: p.transfer_info || null,
        itens_identificados: p.itens_identificados || null,
        raw_voos: p.raw_voos || null, raw_hotel_roma: p.raw_hotel_roma || null,
        raw_hotel_assis: p.raw_hotel_assis || null, raw_outras_hosp: p.raw_outras_hosp || null,
        raw_seguro: p.raw_seguro || null, raw_trem: p.raw_trem || null,
        raw_outros_itens: p.raw_outros_itens || null, raw_pendencias: p.raw_pendencias || null,
        atualizado_em: new Date().toISOString(),
      }));
      linhas.forEach((l) => { l.status = calcularStatus(l); });

      const criados = await supabaseRest(
        "/convencao_roma_peregrinos?on_conflict=nome", "POST", secretKey, linhas,
        { "Prefer": "resolution=merge-duplicates,return=representation" }
      );
      return { importados: (criados || []).length };
    }

    case "listar_peregrinos":
      return supabaseRest("/convencao_roma_peregrinos?select=*&order=data_voo_ida.asc.nullslast,nome.asc", "GET", secretKey);

    case "atualizar_peregrino": {
      if (!data.id) throw new Error("id é obrigatório");
      const patch = { atualizado_em: new Date().toISOString() };
      CAMPOS_EDITAVEIS.forEach((c) => { if (data[c] !== undefined) patch[c] = data[c]; });
      await supabaseRest("/convencao_roma_peregrinos?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey,
        patch, { "Prefer": "return=minimal" });
      await recalcularStatus(data.id, secretKey);
      return { ok: true };
    }

    case "decidir_participacao": {
      if (!data.id || !["sim", "nao"].includes(data.decisao)) throw new Error("id e decisao ('sim'/'nao') são obrigatórios");
      await supabaseRest("/convencao_roma_peregrinos?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey,
        { decisao_participa: data.decisao, atualizado_em: new Date().toISOString() }, { "Prefer": "return=minimal" });
      await recalcularStatus(data.id, secretKey);
      return { ok: true };
    }

    case "marcar_mensagem_enviada": {
      if (!data.id || !data.numero) throw new Error("id e numero são obrigatórios");
      const [p] = await supabaseRest("/convencao_roma_peregrinos?id=eq." + encodeURIComponent(data.id) + "&select=mensagens_enviadas", "GET", secretKey);
      // Prefixo "manual:" diferencia quem foi enviado por fora do Digisac (ex: WhatsApp não
      // reconhece o número) e marcado manualmente, do envio normal — mesmo campo, histórico
      // mais claro na tela.
      const valor = (data.manual ? "manual:" : "") + new Date().toISOString();
      const mensagens = { ...(p && p.mensagens_enviadas), [String(data.numero)]: valor };
      await supabaseRest("/convencao_roma_peregrinos?id=eq." + encodeURIComponent(data.id), "PATCH", secretKey,
        { mensagens_enviadas: mensagens, atualizado_em: new Date().toISOString() }, { "Prefer": "return=minimal" });
      return { ok: true };
    }

    default:
      throw new Error("Ação desconhecida: " + action);
  }
}

// ===== Chamada genérica para a REST API do Supabase (PostgREST) =====
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
