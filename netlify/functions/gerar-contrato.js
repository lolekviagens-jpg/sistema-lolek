// Netlify Function — gera o contrato na ZapSign (a partir do modelo DOCX já
// cadastrado) e envia o link de assinatura pro cliente via Digisac (WhatsApp).
// Variáveis de ambiente necessárias no painel do Netlify:
//   ZAPSIGN_API_TOKEN   — token da conta ZapSign (Configurações > API)
//   ZAPSIGN_TEMPLATE_ID — token do modelo "Contrato Lolek" cadastrado na ZapSign
//   DIGISAC_TOKEN, DIGISAC_SERVICE_ID, DIGISAC_BASE_URL — já configuradas
//   (mesmas usadas por netlify/functions/digisac.js)
//   SUPABASE_SECRET_KEY — já configurada (mesma usada por clientes-data.js)
//
// Tabela necessária no Supabase (criar uma vez via SQL Editor):
//   create table contratos (
//     id uuid primary key default gen_random_uuid(),
//     nome_cliente text not null,
//     cpf_cnpj text not null,
//     endereco_cliente text,
//     telefone_cliente text not null,
//     email_cliente text,
//     descricao_servico text not null,
//     valor_total text not null,
//     valor_extenso text,
//     forma_pagamento text,
//     prazo_entrega text,
//     doc_token text,
//     link_assinatura text,
//     status text not null default 'enviado',
//     erro_envio text,
//     criado_em timestamptz not null default now(),
//     assinado_em timestamptz
//   );
//   alter table contratos enable row level security;

const https = require("https");
const url   = require("url");

const SUPABASE_URL     = "https://emadqnrylsqjmevxasup.supabase.co";
const DIGISAC_BASE     = process.env.DIGISAC_BASE_URL || "https://lolekviagens.digisac.app/api/v1";

const CAMPOS_OBRIGATORIOS = [
  "nome_cliente", "cpf_cnpj", "endereco_cliente", "telefone_cliente",
  "descricao_servico", "valor_total", "valor_extenso", "forma_pagamento",
  "prazo_entrega",
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const zapsignToken = process.env.ZAPSIGN_API_TOKEN;
  const templateId    = process.env.ZAPSIGN_TEMPLATE_ID;
  const supabaseKey    = process.env.SUPABASE_SECRET_KEY;

  if (!zapsignToken || !templateId) {
    return { statusCode: 500, body: JSON.stringify({ error: "ZAPSIGN_API_TOKEN / ZAPSIGN_TEMPLATE_ID não configurados no Netlify" }) };
  }
  if (!supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "SUPABASE_SECRET_KEY não configurada no Netlify" }) };
  }

  let dados;
  try { dados = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) }; }

  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (!dados[campo]) {
      return { statusCode: 400, body: JSON.stringify({ error: `Campo obrigatório faltando: ${campo}` }) };
    }
  }

  try {
    const dataContrato = new Date().toLocaleDateString("pt-BR");

    // 1) Monta os campos do modelo no formato que a ZapSign espera: [{ de, para }, ...]
    const camposModelo = {
      nome_cliente:      dados.nome_cliente,
      cpf_cnpj:          dados.cpf_cnpj,
      endereco_cliente:  dados.endereco_cliente,
      telefone_cliente:  dados.telefone_cliente,
      email_cliente:     dados.email_cliente || "",
      descricao_servico: dados.descricao_servico,
      valor_total:       dados.valor_total,
      valor_extenso:     dados.valor_extenso,
      forma_pagamento:   dados.forma_pagamento,
      prazo_entrega:     dados.prazo_entrega,
      data_contrato:     dataContrato,
    };
    const camposZapsign = Object.entries(camposModelo).map(([campo, valor]) => ({ de: `{{${campo}}}`, para: String(valor) }));

    // 2) Cria o documento na ZapSign a partir do modelo
    const zapsignResp = await requestJson("https://api.zapsign.com.br/api/v1/models/create-doc/", "POST", {
      Authorization: `Bearer ${zapsignToken}`,
    }, {
      template_id: templateId,
      signer_name: dados.nome_cliente,
      signer_email: dados.email_cliente || "",
      signer_phone_country: "55",
      signer_phone_number: String(dados.telefone_cliente).replace(/\D/g, ""),
      data: camposZapsign,
      lang: "pt-br",
      send_automatic_email: Boolean(dados.email_cliente),
      send_automatic_whatsapp: false, // o envio é feito pelo Digisac, não pela ZapSign
    });

    if (zapsignResp.status < 200 || zapsignResp.status >= 300) {
      return { statusCode: 502, body: JSON.stringify({ error: "Erro na ZapSign: " + zapsignResp.body }) };
    }

    const doc    = JSON.parse(zapsignResp.body);
    const signer = doc.signers && doc.signers[0];
    if (!signer) {
      return { statusCode: 502, body: JSON.stringify({ error: "ZapSign não retornou signatário" }) };
    }
    const linkAssinatura = signer.sign_url || `https://app.zapsign.com.br/verificar/${signer.token}`;

    // 3) Envia o link pelo Digisac (WhatsApp) — mesmo padrão de netlify/functions/digisac.js
    let tel = String(dados.telefone_cliente).replace(/\D/g, "");
    if (tel.length === 10 || tel.length === 11) tel = "55" + tel;

    const mensagem =
      `Oi, ${dados.nome_cliente}! Aqui é da Lolek Viagens 😊\n\n` +
      `Segue o contrato da sua viagem para assinatura digital, é rapidinho:\n${linkAssinatura}\n\n` +
      `Qualquer dúvida, é só chamar por aqui.`;

    let digisacOk = true, erroDigisac = null;
    if (process.env.DIGISAC_TOKEN) {
      const digisacResp = await requestJson(DIGISAC_BASE + "/messages", "POST", {
        Authorization: `Bearer ${process.env.DIGISAC_TOKEN}`,
      }, {
        number: tel,
        text: mensagem,
        serviceId: process.env.DIGISAC_SERVICE_ID,
      });
      if (digisacResp.status < 200 || digisacResp.status >= 300) {
        digisacOk = false;
        erroDigisac = digisacResp.body;
      }
    } else {
      digisacOk = false;
      erroDigisac = "DIGISAC_TOKEN não configurado no Netlify";
    }

    // 4) Registra o contrato no Supabase — o webhook da ZapSign usa doc_token pra
    // encontrar essa linha e marcar como assinado quando o cliente assinar.
    const [registro] = await supabaseRest("/contratos", "POST", supabaseKey, {
      nome_cliente:      dados.nome_cliente,
      cpf_cnpj:          dados.cpf_cnpj,
      endereco_cliente:  dados.endereco_cliente,
      telefone_cliente:  dados.telefone_cliente,
      email_cliente:     dados.email_cliente || null,
      descricao_servico: dados.descricao_servico,
      valor_total:       dados.valor_total,
      valor_extenso:     dados.valor_extenso,
      forma_pagamento:   dados.forma_pagamento,
      prazo_entrega:     dados.prazo_entrega,
      doc_token:         doc.token,
      link_assinatura:   linkAssinatura,
      status:            digisacOk ? "enviado" : "erro_envio",
      erro_envio:        erroDigisac,
    });

    if (!digisacOk) {
      return {
        statusCode: 207,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "erro_envio",
          aviso: "Contrato criado, mas o envio pelo Digisac falhou",
          erro_digisac: erroDigisac,
          link_assinatura: linkAssinatura,
          contrato: registro,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "enviado", doc_token: doc.token, link_assinatura: linkAssinatura, contrato: registro }),
    };
  } catch (err) {
    console.error("[gerar-contrato] erro:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ===== Requisição HTTPS genérica que devolve { status, body } =====
function requestJson(endpoint, method, headers, payload) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(endpoint);
    const body = payload != null ? JSON.stringify(payload) : null;
    const options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ===== Chamada genérica para a REST API do Supabase (PostgREST) =====
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
