// ===== Aba Follow-up — Lolek Viagens =====
(function () {
  "use strict";

  const SHEET_ID   = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
  const LS_CLI     = "lolek_clientes";
  const LS_EVENTOS = "lolek_eventos_especiais";

  // Abas da planilha "passagens emitidas"
  const ABAS = [
    { param: "gid=113268884", ano: 2026, colNome: 4, colIda: 5, colVolta: 6, colDestino: 8 },
    { param: "sheet=2025",    ano: 2025, colNome: 4, colIda: 5, colVolta: 6, colDestino: 8 },
    { param: "sheet=2024",    ano: 2024, colNome: 3, colIda: 4, colVolta: 5, colDestino: 7 },
  ];

  // ===== Utilitários =====
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function gel(id) { return document.getElementById(id); }

  function parseDateBR(s) {
    if (!s) return null;
    s = String(s).trim();
    // Date(ano,mes,dia) do Google Sheets
    const gm = s.match(/^Date\((\d+),(\d+),(\d+)\)$/);
    if (gm) return new Date(+gm[1], +gm[2], +gm[3]);
    // DD/MM/AAAA
    const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dm) return new Date(+dm[3], +dm[2] - 1, +dm[1]);
    // ISO AAAA-MM-DD
    const im = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (im) return new Date(+im[1], +im[2] - 1, +im[3]);
    return null;
  }

  function fmtDate(d) {
    if (!d) return "";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function hoje0() {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }

  function addDias(base, n) {
    const d = new Date(base); d.setDate(d.getDate() + n); return d;
  }

  function calcIdade(nascimento) {
    const d = parseDateBR(nascimento);
    if (!d) return null;
    const h = new Date();
    let age = h.getFullYear() - d.getFullYear();
    if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) age--;
    return age;
  }

  // ===== Fuzzy matching de nomes =====
  function normNome(s) {
    return (s || "").toLowerCase()
      .normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ").trim();
  }

  function similaridade(a, b) {
    const stopwords = new Set(["de", "da", "do", "dos", "das", "e"]);
    const wa = new Set(normNome(a).split(" ").filter(w => w.length > 1 && !stopwords.has(w)));
    const wb = new Set(normNome(b).split(" ").filter(w => w.length > 1 && !stopwords.has(w)));
    if (!wa.size || !wb.size) return 0;
    let matches = 0;
    wa.forEach(w => { if (wb.has(w)) matches++; });
    return matches / Math.max(wa.size, wb.size);
  }

  function encontrarCliente(nome, clientes) {
    let melhor = null, melhorScore = 0;
    clientes.forEach(c => {
      const s = similaridade(c.nome || "", nome);
      if (s > melhorScore && s >= 0.5) { melhorScore = s; melhor = c; }
    });
    return melhor;
  }

  function formatarTelWA(tel) {
    const d = (tel || "").replace(/\D/g, "");
    if (!d) return null;
    return d.startsWith("55") ? d : "55" + d;
  }

  // ===== CSV parser =====
  function parseCsv(text) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQ = false;
        else field += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        row.push(field); field = "";
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        if (ch === '\r') i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ===== Carregar planilha =====
  function urlAba(aba) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&${aba.param}`;
  }

  async function carregarAba(aba) {
    try {
      const r = await fetch(urlAba(aba));
      if (!r.ok) return [];
      const text = await r.text();
      const rows = parseCsv(text);
      // Pula linhas de cabeçalho ou vazias
      const viagens = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nome = (row[aba.colNome] || "").trim();
        if (!nome || nome.toLowerCase().includes("nome")) continue;
        const ida   = parseDateBR(row[aba.colIda]);
        const volta = parseDateBR(row[aba.colVolta]);
        const dest  = (row[aba.colDestino] || "").trim();
        if (!ida && !volta) continue;
        viagens.push({ nome, ida, volta, destino: dest, ano: aba.ano });
      }
      return viagens;
    } catch {
      return [];
    }
  }

  async function carregarTodasViagens() {
    const resultados = await Promise.all(ABAS.map(carregarAba));
    return resultados.flat();
  }

  // ===== Mensagens padrão =====
  function msgAniversario(nome) {
    return `Olá, ${nome}! 🎂 Toda a equipe da Lolek Viagens deseja um feliz aniversário! Que este novo ano seja repleto de viagens incríveis e memórias inesquecíveis. Quando quiser planejar sua próxima aventura, estamos aqui! ✈️🌍`;
  }
  function msgAnivViagem(nome, destino) {
    const dest = destino ? ` para ${destino}` : "";
    return `Olá, ${nome}! Há exatamente um ano você embarcou${dest} com a Lolek Viagens. 🌍✈️ Que experiência incrível! Que tal começar a planejar a próxima aventura? Estamos aqui para fazer acontecer!`;
  }
  function msgUpsell(nome, dataIda) {
    return `Olá, ${nome}! Sua viagem está chegando (${dataIda})! 🎉 Já pensou em complementar sua experiência com seguro viagem, hospedagem ou passeios? A Lolek cuida de tudo para você. Entre em contato! 😊`;
  }
  function msgPosViagem(nome, destino) {
    const dest = destino ? ` de ${destino}` : "";
    return `Olá, ${nome}! Você acabou de voltar${dest}! Como foi a experiência? 🌟 Adoraríamos saber mais. E quando bater aquela saudade de viajar, a Lolek Viagens está pronta para planejar a próxima aventura!`;
  }
  function msgEspecial(nome, ocasiao) {
    return `Olá, ${nome}! Estamos muito animados com a sua ${ocasiao || "viagem especial"} que está chegando! 🎉 A Lolek Viagens quer garantir que tudo seja perfeito. Tem alguma dúvida de última hora? Estamos à disposição!`;
  }
  function msgReativacao(nome) {
    return `Olá, ${nome}! Estamos com saudade de você! 😊 Faz um tempinho que não viajamos juntos. Temos promoções e destinos incríveis esperando por você. Que tal darmos uma olhada? A Lolek Viagens está aqui! ✈️`;
  }

  // ===== Cálculo das seções =====
  function calcAniversariantes(clientes) {
    const h = new Date();
    const d = h.getDate(), m = h.getMonth() + 1;
    return clientes
      .filter(c => {
        if (!c.nascimento) return false;
        const p = c.nascimento.split(/[\/\-\.]/);
        return parseInt(p[0]) === d && parseInt(p[1]) === m;
      })
      .map(c => {
        const idade = calcIdade(c.nascimento);
        return {
          nome: c.nome,
          sub: `🎂 Aniversário hoje${idade ? " — " + idade + " anos" : ""}`,
          tel: c.telefone,
          msg: msgAniversario(c.nome),
        };
      });
  }

  function calcAnivViagem(viagens, clientes) {
    const h = hoje0();
    return viagens
      .filter(v => {
        if (!v.ida) return false;
        const idaMs  = v.ida.getTime();
        const umAno  = new Date(h); umAno.setFullYear(umAno.getFullYear() - 1);
        const diff   = Math.abs(idaMs - umAno.getTime()) / 86400000;
        return diff <= 3;
      })
      .map(v => {
        const cli = encontrarCliente(v.nome, clientes);
        return {
          nome: v.nome,
          sub: `✈️ 1 ano da viagem${v.destino ? " para " + v.destino : ""} (${fmtDate(v.ida)})`,
          tel: cli ? cli.telefone : null,
          msg: msgAnivViagem(v.nome, v.destino),
        };
      });
  }

  function calcUpsell(viagens, clientes) {
    const h   = hoje0();
    const ini = addDias(h, 1);
    const fim = addDias(h, 30);
    // Deduplica por nome (pega só a próxima viagem de cada um)
    const porNome = {};
    viagens.forEach(v => {
      if (!v.ida || v.ida < ini || v.ida > fim) return;
      if (!porNome[normNome(v.nome)] || v.ida < porNome[normNome(v.nome)].ida)
        porNome[normNome(v.nome)] = v;
    });
    return Object.values(porNome).map(v => {
      const cli = encontrarCliente(v.nome, clientes);
      return {
        nome: v.nome,
        sub: `✈️ Parte em ${fmtDate(v.ida)}${v.destino ? " → " + v.destino : ""} — ofereça extras!`,
        tel: cli ? cli.telefone : null,
        msg: msgUpsell(v.nome, fmtDate(v.ida)),
      };
    });
  }

  function calcPosViagem(viagens, clientes) {
    const h   = hoje0();
    const ini = addDias(h, -5);
    const fim = addDias(h, -1);
    const porNome = {};
    viagens.forEach(v => {
      if (!v.volta || v.volta < ini || v.volta > fim) return;
      if (!porNome[normNome(v.nome)] || v.volta > porNome[normNome(v.nome)].volta)
        porNome[normNome(v.nome)] = v;
    });
    return Object.values(porNome).map(v => {
      const cli = encontrarCliente(v.nome, clientes);
      return {
        nome: v.nome,
        sub: `🏡 Voltou${v.destino ? " de " + v.destino : ""} em ${fmtDate(v.volta)}`,
        tel: cli ? cli.telefone : null,
        msg: msgPosViagem(v.nome, v.destino),
      };
    });
  }

  function calcViagensEspeciais(eventos) {
    const h   = hoje0();
    const fim = addDias(h, 7);
    return eventos
      .filter(e => {
        const d = parseDateBR(e.dataViagem);
        return d && d >= h && d <= fim;
      })
      .map(e => ({
        nome: e.nomeCliente,
        sub: `💍 ${e.ocasiao || "Viagem especial"} — ${e.dataViagem}${e.destino ? " em " + e.destino : ""}`,
        tel: e.telefone || null,
        msg: msgEspecial(e.nomeCliente, e.ocasiao),
      }));
  }

  function calcReativacao(viagens, clientes) {
    const h      = hoje0();
    const limite = addDias(h, -180); // 6 meses
    // Última data de viagem (ida ou volta) por nome normalizado
    const ultima = {};
    viagens.forEach(v => {
      const data = v.volta || v.ida;
      if (!data) return;
      const k = normNome(v.nome);
      if (!ultima[k] || data > ultima[k].data)
        ultima[k] = { nome: v.nome, data };
    });
    return Object.values(ultima)
      .filter(v => v.data < limite)
      .map(v => {
        const cli = encontrarCliente(v.nome, clientes);
        return {
          nome: v.nome,
          sub: `🔄 Última viagem em ${fmtDate(v.data)} — inativo há mais de 6 meses`,
          tel: cli ? cli.telefone : null,
          msg: msgReativacao(v.nome),
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  // ===== Envio via Digisac =====
  async function enviarDigisac(btn, tel, msg) {
    const phone = formatarTelWA(tel);
    if (!phone) return;
    btn.disabled = true;
    btn.textContent = "⏳";
    try {
      const resp = await fetch("/.netlify/functions/digisac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: msg }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        btn.textContent = "✓ Enviado";
        btn.style.cssText = "background:#22c55e;color:#fff;border-color:#22c55e";
      } else {
        throw new Error(data.error || "Erro " + resp.status);
      }
    } catch (err) {
      btn.textContent = "✕ Erro";
      btn.title = err.message;
      btn.style.cssText = "background:#ef4444;color:#fff;border-color:#ef4444";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "💬 Enviar";
        btn.style.cssText = "";
      }, 3000);
    }
  }

  // ===== Renderização =====
  function renderCard(card) {
    const temTel = card.tel && formatarTelWA(card.tel);
    const btnEnviar = temTel
      ? `<button class="btn btn--gold fu-btn-dg" data-tel="${esc(card.tel)}" title="Enviar via Digisac">💬 Enviar</button>`
      : `<button class="btn btn--ghost fu-btn-dg" disabled title="Telefone não cadastrado">💬 Enviar</button>`;

    return `
      <div class="fu-card">
        <div class="fu-card__main">
          <div class="fu-card__info">
            <div class="fu-card__nome">${esc(card.nome)}</div>
            <div class="fu-card__sub">${esc(card.sub)}</div>
          </div>
          <div class="fu-card__actions">
            ${btnEnviar}
            <button class="btn btn--ghost fu-btn-edit" data-msg="${esc(card.msg)}" title="Editar mensagem antes de enviar">✏️</button>
            <button class="btn btn--ghost fu-btn-copy" data-msg="${esc(card.msg)}" title="Copiar mensagem">⧉</button>
          </div>
        </div>
        <div class="fu-card__editarea" hidden>
          <textarea class="input fu-msg-textarea" rows="4">${esc(card.msg)}</textarea>
          <div class="fu-editarea-hint">Edite a mensagem acima e clique em Enviar quando estiver pronto.</div>
        </div>
      </div>`;
  }

  function renderSecao(icone, titulo, cards, idSecao) {
    const badge = cards.length > 0
      ? `<span class="fu-badge">${cards.length}</span>`
      : `<span class="fu-badge fu-badge--zero">0</span>`;
    const conteudo = cards.length > 0
      ? cards.map(renderCard).join("")
      : `<p class="fu-vazio">Nenhum contato nesta categoria hoje.</p>`;
    return `
      <div class="fu-secao" id="${idSecao}">
        <div class="fu-secao__header">
          <span class="fu-secao__titulo">${icone} ${titulo}</span>
          ${badge}
        </div>
        <div class="fu-secao__body">${conteudo}</div>
      </div>`;
  }

  // ===== Seção de eventos especiais (com mini-formulário) =====
  function carregarEventos() {
    try { return JSON.parse(localStorage.getItem(LS_EVENTOS) || "[]"); }
    catch { return []; }
  }

  function salvarEventos(eventos) {
    localStorage.setItem(LS_EVENTOS, JSON.stringify(eventos));
  }

  function renderFormEventos() {
    return `
      <div class="fu-evento-form" id="fu-evento-form" hidden>
        <div class="form__grid" style="margin-bottom:10px">
          <label class="field">
            <span class="field__label">Nome do cliente</span>
            <input type="text" id="fu-ev-nome" class="input" placeholder="Ex: Maria Silva" />
          </label>
          <label class="field">
            <span class="field__label">Ocasião</span>
            <select id="fu-ev-ocasiao" class="input">
              <option value="Lua de mel">Lua de mel</option>
              <option value="Aniversário de casamento">Aniversário de casamento</option>
              <option value="Aniversário de 15 anos">Aniversário de 15 anos</option>
              <option value="Formatura">Formatura</option>
              <option value="Família">Viagem em família</option>
              <option value="Outro">Outro</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Data da viagem</span>
            <input type="text" id="fu-ev-data" class="input" placeholder="DD/MM/AAAA" />
          </label>
          <label class="field">
            <span class="field__label">Destino</span>
            <input type="text" id="fu-ev-destino" class="input" placeholder="Ex: Paris" />
          </label>
          <label class="field">
            <span class="field__label">Telefone (opcional)</span>
            <input type="text" id="fu-ev-tel" class="input" placeholder="Ex: 85 99999-9999" />
          </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn--ghost" id="fu-ev-cancelar">Cancelar</button>
          <button type="button" class="btn btn--gold" id="fu-ev-salvar">Salvar evento</button>
        </div>
      </div>`;
  }

  function renderListaEventos(eventos) {
    const container = gel("fu-lista-eventos");
    if (!container) return;
    if (!eventos.length) {
      container.innerHTML = `<p class="fu-vazio" style="margin:8px 0">Nenhum evento especial cadastrado.</p>`;
      return;
    }
    container.innerHTML = eventos.map((e, i) => `
      <div class="fu-card" style="margin-bottom:6px">
        <div class="fu-card__info">
          <div class="fu-card__nome">${esc(e.nomeCliente)}</div>
          <div class="fu-card__sub">${esc(e.ocasiao)} — ${esc(e.dataViagem)}${e.destino ? " · " + esc(e.destino) : ""}</div>
        </div>
        <div class="fu-card__actions">
          <button class="btn btn--ghost btn--icon fu-ev-del" data-idx="${i}" title="Remover">✕</button>
        </div>
      </div>`).join("");

    container.querySelectorAll(".fu-ev-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const ev = carregarEventos();
        ev.splice(+btn.dataset.idx, 1);
        salvarEventos(ev);
        renderListaEventos(carregarEventos());
      });
    });
  }

  // ===== Render principal =====
  function renderTudo(secoes) {
    const wrap = gel("fu-secoes");
    if (!wrap) return;
    wrap.innerHTML = [
      renderSecao("🎂", "Aniversariantes do dia",        secoes.aniversariantes, "fu-s1"),
      renderSecao("✈️", "Aniversário de viagem (1 ano)", secoes.anivViagem,       "fu-s2"),
      renderSecao("🛍️", "Upsell pendente",               secoes.upsell,           "fu-s3"),
      renderSecao("🏡", "Pós-viagem",                    secoes.posViagem,         "fu-s4"),
      renderSecao("💍", "Viagens especiais chegando",    secoes.especiais,         "fu-s5"),
      renderSecao("🔄", "Reativação de inativos",        secoes.reativacao,        "fu-s6"),
    ].join("");

    // Botões Digisac — usa textarea se estiver aberta
    wrap.querySelectorAll(".fu-btn-dg").forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => {
        const card = btn.closest(".fu-card");
        const textarea = card?.querySelector(".fu-msg-textarea");
        const msg = (textarea && !card.querySelector(".fu-card__editarea").hidden)
          ? textarea.value
          : btn.closest(".fu-card__main").querySelector(".fu-btn-edit").dataset.msg;
        enviarDigisac(btn, btn.dataset.tel, msg);
      });
    });

    // Botões de editar
    wrap.querySelectorAll(".fu-btn-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const card     = btn.closest(".fu-card");
        const editArea = card.querySelector(".fu-card__editarea");
        const aberto   = !editArea.hidden;
        editArea.hidden = aberto;
        btn.classList.toggle("fu-btn-edit--ativo", !aberto);
        if (!aberto) card.querySelector(".fu-msg-textarea").focus();
      });
    });

    // Botões de copiar mensagem
    wrap.querySelectorAll(".fu-btn-copy").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.msg).then(() => {
          const orig = btn.textContent;
          btn.textContent = "✓";
          setTimeout(() => (btn.textContent = orig), 1500);
        });
      });
    });
  }

  function mostrarLoading() {
    const wrap = gel("fu-secoes");
    if (wrap) wrap.innerHTML = `<div class="fu-loading">Carregando dados da planilha…</div>`;
  }

  function mostrarErro(msg) {
    const wrap = gel("fu-secoes");
    if (wrap) wrap.innerHTML = `<div class="empty-state"><p>${esc(msg)}</p></div>`;
  }

  // ===== Inicialização =====
  async function carregar() {
    mostrarLoading();

    const clientes = (() => {
      try { return JSON.parse(localStorage.getItem(LS_CLI) || "[]"); }
      catch { return []; }
    })();

    const viagens = await carregarTodasViagens();
    if (!viagens.length) {
      mostrarErro("Não foi possível carregar a planilha de passagens. Verifique a conexão.");
      return;
    }

    const eventos = carregarEventos();

    renderTudo({
      aniversariantes: calcAniversariantes(clientes),
      anivViagem:      calcAnivViagem(viagens, clientes),
      upsell:          calcUpsell(viagens, clientes),
      posViagem:       calcPosViagem(viagens, clientes),
      especiais:       calcViagensEspeciais(eventos),
      reativacao:      calcReativacao(viagens, clientes),
    });

    renderListaEventos(eventos);
  }

  function initEventos() {
    const btnAdicionar = gel("fu-ev-adicionar");
    const form = gel("fu-evento-form");
    const btnCancelar = gel("fu-ev-cancelar");
    const btnSalvar   = gel("fu-ev-salvar");

    if (!btnAdicionar || !form) return;

    btnAdicionar.addEventListener("click", () => { form.hidden = false; });
    btnCancelar.addEventListener("click",  () => { form.hidden = true; });

    btnSalvar.addEventListener("click", () => {
      const nome    = (gel("fu-ev-nome").value    || "").trim();
      const ocasiao = gel("fu-ev-ocasiao").value;
      const data    = (gel("fu-ev-data").value    || "").trim();
      const destino = (gel("fu-ev-destino").value || "").trim();
      const tel     = (gel("fu-ev-tel").value     || "").trim();

      if (!nome || !data) { alert("Preencha ao menos o nome e a data."); return; }

      const ev = carregarEventos();
      ev.push({ nomeCliente: nome, ocasiao, dataViagem: data, destino, telefone: tel, criadoEm: new Date().toISOString().slice(0, 10) });
      salvarEventos(ev);

      form.hidden = true;
      gel("fu-ev-nome").value = gel("fu-ev-data").value = gel("fu-ev-destino").value = gel("fu-ev-tel").value = "";

      renderListaEventos(carregarEventos());
      // Re-renderiza só a seção de especiais
      const sec = gel("fu-s5");
      if (sec) {
        const novos = calcViagensEspeciais(carregarEventos());
        sec.querySelector(".fu-secao__body").innerHTML = novos.length
          ? novos.map(renderCard).join("")
          : `<p class="fu-vazio">Nenhum contato nesta categoria hoje.</p>`;
        sec.querySelector(".fu-badge").textContent = novos.length || "0";
        if (!novos.length) sec.querySelector(".fu-badge").classList.add("fu-badge--zero");
        // Re-ativa botões
        sec.querySelectorAll(".fu-btn-dg").forEach(btn => {
          if (btn.disabled) return;
          btn.addEventListener("click", () => {
            const card = btn.closest(".fu-card");
            const textarea = card?.querySelector(".fu-msg-textarea");
            const msg = (textarea && !card.querySelector(".fu-card__editarea").hidden)
              ? textarea.value
              : btn.closest(".fu-card__main").querySelector(".fu-btn-edit").dataset.msg;
            enviarDigisac(btn, btn.dataset.tel, msg);
          });
        });
        sec.querySelectorAll(".fu-btn-edit").forEach(btn => {
          btn.addEventListener("click", () => {
            const card = btn.closest(".fu-card");
            const editArea = card.querySelector(".fu-card__editarea");
            const aberto = !editArea.hidden;
            editArea.hidden = aberto;
            btn.classList.toggle("fu-btn-edit--ativo", !aberto);
            if (!aberto) card.querySelector(".fu-msg-textarea").focus();
          });
        });
        sec.querySelectorAll(".fu-btn-copy").forEach(btn => {
          btn.addEventListener("click", () => {
            navigator.clipboard.writeText(btn.dataset.msg).then(() => {
              const orig = btn.textContent;
              btn.textContent = "✓";
              setTimeout(() => (btn.textContent = orig), 1500);
            });
          });
        });
      }
    });
  }

  function init() {
    // Só carrega quando a aba estiver visível
    const panel = document.querySelector('[data-panel="followup"]');
    if (!panel) return;

    const navBtn = document.querySelector('[data-tab="followup"]');
    if (navBtn) {
      navBtn.addEventListener("click", () => {
        if (!gel("fu-secoes").dataset.carregado) {
          gel("fu-secoes").dataset.carregado = "1";
          carregar();
        }
      });
    }

    // Botão de atualizar
    const btnRefresh = gel("fu-refresh");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => {
        gel("fu-secoes").dataset.carregado = "1";
        carregar();
      });
    }

    initEventos();
    renderListaEventos(carregarEventos());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
