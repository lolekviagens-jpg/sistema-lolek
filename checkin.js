// ===== Check-in do dia — Lolek Viagens =====
(function () {
  "use strict";

  const CHECKINS_FN = "/.netlify/functions/checkins";
  const CONFIRMS_POLL_MS = 20000;        // reconsulta as confirmações de outros computadores periodicamente
  const DADOS_POLL_MS    = 5 * 60 * 1000; // recarrega passageiros/datas periodicamente (5 min)

  // ===== Estado =====
  let lastPassengers = [];
  let confirms = {}; // chave -> ISO timestamp (compartilhado via Supabase, não mais localStorage)
  let calYear, calMonth;
  let selectedDate = null; // null = visão geral (hoje+amanhã); "YYYY-MM-DD" = dia específico

  // ===== Elementos =====
  const sectionsEl = document.getElementById("checkin-sections");
  const statusEl   = document.getElementById("checkin-status");
  const updatedEl  = document.getElementById("checkin-updated");
  const refreshBtn = document.getElementById("checkin-refresh");
  const calGrid    = document.getElementById("cal-grid");
  const calTitle   = document.getElementById("cal-title");
  const calPrev    = document.getElementById("cal-prev");
  const calNext    = document.getElementById("cal-next");
  const calHoje    = document.getElementById("cal-hoje");
  const calToggle  = document.getElementById("cal-toggle");
  const calTogIcon = document.getElementById("cal-toggle-icon");
  const calBody    = document.getElementById("cal-body");

  const CAL_VIS_KEY = "lolek_cal_visible";
  function setCalVisible(v) {
    calBody.hidden = !v;
    calTogIcon.textContent = v ? "▲" : "▼";
    localStorage.setItem(CAL_VIS_KEY, v ? "1" : "0");
    if (!v && selectedDate) { selectedDate = null; renderSections(); }
  }
  calToggle.addEventListener("click", () => setCalVisible(calBody.hidden));
  setCalVisible(localStorage.getItem(CAL_VIS_KEY) === "1");

  // ===== Utilidades =====
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function ymd(date) {
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }
  function todayYmd()    { return ymd(new Date()); }
  function tomorrowYmd() { const t = new Date(); t.setDate(t.getDate() + 1); return ymd(t); }

  // ===== Confirmações (Supabase, via Netlify Function — compartilhado entre computadores) =====
  async function fetchConfirms() {
    try {
      const resp = await fetch(CHECKINS_FN);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const rows = await resp.json();
      const map = {};
      for (const r of rows) map[r.chave] = r.confirmado_em;
      confirms = map;
    } catch (e) {
      console.error("Falha ao carregar confirmações de check-in:", e);
    }
  }

  // Chave inclui nome do passageiro para evitar conflito em famílias com mesmo localizador
  function confirmKey(p, leg, legDate) {
    const loc  = (p.localizador || "").trim().toUpperCase();
    const nome = (p.nome || "").trim().toUpperCase();
    return `${loc}||${nome}||${leg}||${legDate}`;
  }

  async function setConfirmed(key, value) {
    // Otimista: atualiza a tela na hora, sincroniza com o servidor em seguida
    const anterior = confirms[key];
    if (value) confirms[key] = new Date().toISOString(); else delete confirms[key];
    renderSections();
    renderCalendar();

    try {
      const resp = await fetch(CHECKINS_FN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: value ? "confirmar" : "desfazer", chave: key }),
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
    } catch (e) {
      console.error("Falha ao salvar check-in:", e);
      if (anterior) confirms[key] = anterior; else delete confirms[key];
      renderSections();
      renderCalendar();
      alert("Não foi possível salvar o check-in. Verifique sua conexão e tente novamente.");
    }
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // ===== Processamento — a partir da Nova Emissão (venda_emissoes), não mais da planilha =====
  async function fetchEmissoesEClientes() {
    const [respEmi, respCli] = await Promise.all([
      fetch("/.netlify/functions/emissoes-data"),
      fetch("/.netlify/functions/clientes-data"),
    ]);
    if (!respEmi.ok) throw new Error("HTTP " + respEmi.status);
    const emissoes = await respEmi.json();
    const clientes = respCli.ok ? await respCli.json() : [];
    const nomePorClienteId = new Map(clientes.map((c) => [c.id, c.nome]));
    return { emissoes, nomePorClienteId };
  }

  // Um produto "passagem" vira 1 linha por passageiro coberto; a data usada (ida ou
  // volta) depende do campo "Perna da viagem" preenchido em Nova Emissão. Hospedagem
  // também vira linha própria, usando check-in/check-out do próprio produto (mais
  // preciso que a data geral da viagem).
  function emissoesParaPassageiros(emissoes, nomePorClienteId) {
    const linhas = [];
    (emissoes || []).forEach((e) => {
      const nomePorPaxId = new Map(
        (e.venda_emissoes_passageiros || []).map((pax) => [pax.id, nomePorClienteId.get(pax.cliente_id) || "Passageiro"])
      );
      const todosPaxIds = [...nomePorPaxId.keys()];

      const qtdPassagens = (e.venda_emissoes_produtos || []).filter((p) => p.tipo === "passagem").length;

      (e.venda_emissoes_produtos || []).forEach((prod) => {
        const d = prod.dados || {};
        const idsCobertos = (prod.passageiro_ids && prod.passageiro_ids.length) ? prod.passageiro_ids : todosPaxIds;
        const nomes = idsCobertos.map((id) => nomePorPaxId.get(id)).filter(Boolean);

        if (prod.tipo === "passagem") {
          // Ida e volta ficam no mesmo produto agora — vira 1 linha de check-in pra cada
          // perna que existir (dados.ida sempre, dados.volta só se for ida e volta).
          // Registros salvos antes dessa junção guardavam os dados do voo direto em
          // "dados" (sem aninhar em "ida") — cai pra "d" nesse caso, pra não perder o
          // check-in desses.
          const pernas = [{ leg: "ida", info: d.ida || d }];
          if (d.volta) {
            pernas.push({ leg: "volta", info: d.volta });
          } else if (e.data_volta && qtdPassagens === 1 && !d.ida) {
            // Registro antigo, viagem de ida e volta mas só um voo foi cadastrado —
            // mostra ao menos a data de volta (sem detalhes de voo).
            pernas.push({ leg: "volta", info: {} });
          }

          pernas.forEach(({ leg, info }) => {
            // Check-in é sempre do 1º trecho da perna (é o voo que ela precisa embarcar
            // primeiro) — os demais trechos (conexão) não têm check-in próprio.
            const segmentos = (info.segmentos && info.segmentos.length) ? info.segmentos : [info];
            const primeiro = segmentos[0] || {};
            // "saida" é sempre o aeroporto de origem de casa (não o de destino da
            // viagem): na ida é o 1º aeroporto do trecho, na volta é o último (a coluna
            // "Trecho" mostra saida→destino na ida e destino→saida na volta).
            const trechoPartes = (primeiro.trecho || "").split("→").map((s) => s.trim()).filter(Boolean);
            const aeroportoCasa = leg === "ida" ? (trechoPartes[0] || "") : (trechoPartes[trechoPartes.length - 1] || "");
            nomes.forEach((nome) => {
              linhas.push({
                nome, tipo: "Passagem aérea",
                saida: aeroportoCasa,
                destino: e.destino || "",
                companhia: primeiro.companhia || "",
                localizador: info.localizador || "",
                dataIda:   leg === "ida"   ? (e.data_ida || null)   : null,
                dataVolta: leg === "volta" ? (e.data_volta || null) : null,
              });
            });
          });
        } else if (prod.tipo === "hospedagem") {
          nomes.forEach((nome) => {
            linhas.push({
              nome, tipo: "Hospedagem",
              saida: "", destino: e.destino || "", companhia: d.hotel || "", localizador: "",
              dataIda: d.checkin || null, dataVolta: d.checkout || null,
            });
          });
        }
      });
    });
    return linhas;
  }

  // ===== Calendário =====
  function renderCalendar() {
    const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    calTitle.textContent = MESES[calMonth] + " " + calYear;

    const aereos    = lastPassengers.filter((p) => p.tipo === "Passagem aérea");
    const idaDays   = new Set(aereos.map((p) => p.dataIda).filter(Boolean));
    const voltaDays = new Set(aereos.map((p) => p.dataVolta).filter(Boolean));
    const today     = todayYmd();

    const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // seg=0
    const lastDate = new Date(calYear, calMonth + 1, 0).getDate();
    const DIAS = ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];

    let html = DIAS.map((d) => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-day cal-day--empty"></div>`;

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hasIda   = idaDays.has(dateStr);
      const hasVolta = voltaDays.has(dateStr);
      const cls = [
        "cal-day",
        dateStr === today        ? "cal-day--today"    : "",
        dateStr === selectedDate ? "cal-day--selected" : "",
        (hasIda || hasVolta)     ? "cal-day--events"   : "",
      ].filter(Boolean).join(" ");

      html += `<div class="${cls}" data-date="${dateStr}">
        <span class="cal-day-num">${d}</span>
        <div class="cal-dots">
          ${hasIda   ? `<span class="cal-dot cal-dot--ida"></span>`   : ""}
          ${hasVolta ? `<span class="cal-dot cal-dot--volta"></span>` : ""}
        </div>
      </div>`;
    }

    calGrid.innerHTML = html;
    calGrid.querySelectorAll(".cal-day[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        selectedDate = cell.dataset.date;
        renderCalendar();
        renderSections();
      });
    });
  }

  // ===== Seções =====
  function renderSections() {
    sectionsEl.innerHTML = "";

    if (selectedDate) {
      // Visão de dia específico
      const dateObj = new Date(selectedDate + "T12:00:00");
      const label   = dateObj.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

      const header = document.createElement("div");
      header.className = "ci-day-header";
      header.innerHTML = `<span class="ci-day-label">📅 ${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</span>`;
      sectionsEl.appendChild(header);

      const aereos = lastPassengers.filter((p) => p.tipo === "Passagem aérea");
      const ida   = aereos.filter((p) => p.dataIda   === selectedDate);
      const volta = aereos.filter((p) => p.dataVolta === selectedDate);
      sectionsEl.appendChild(renderSection("🔴", "Embarques — ida", ida, "ida", selectedDate));
      sectionsEl.appendChild(renderSection("🟣", "Chegadas — volta", volta, "volta", selectedDate));
    } else {
      // Visão padrão: hoje + amanhã (check-in é só de passagem aérea)
      const hoje    = todayYmd();
      const amanha  = tomorrowYmd();
      const aereos  = lastPassengers.filter((p) => p.tipo === "Passagem aérea");
      const groups = {
        idaAmanha:   aereos.filter((p) => p.dataIda   === amanha),
        voltaAmanha: aereos.filter((p) => p.dataVolta === amanha),
        idaHoje:     aereos.filter((p) => p.dataIda   === hoje),
        voltaHoje:   aereos.filter((p) => p.dataVolta === hoje),
      };
      sectionsEl.appendChild(renderSection("✅", "Check-in de ida — fazer hoje (voo amanhã)",      groups.idaAmanha,   "ida",   amanha));
      sectionsEl.appendChild(renderSection("✅", "Check-in de volta — fazer hoje (retorno amanhã)", groups.voltaAmanha, "volta", amanha));

      // Conferência de hospedagem — não é check-in, só garantir que está tudo certo antes do hóspede chegar
      const hospedagemAmanha = lastPassengers.filter((p) => p.tipo === "Hospedagem" && p.dataIda === amanha);
      if (hospedagemAmanha.length > 0) {
        sectionsEl.appendChild(renderSection("🏨", "Conferir hospedagem — check-in amanhã", hospedagemAmanha, "ida", amanha, false, "Conferido ✅"));
      }

      if (groups.idaHoje.length > 0 || groups.voltaHoje.length > 0) {
        const divEl = document.createElement("div");
        divEl.className = "ci-divider";
        divEl.innerHTML = "<span>Embarques e chegadas de hoje</span>";
        sectionsEl.appendChild(divEl);
        sectionsEl.appendChild(renderSection("🛫", "Embarcam hoje", groups.idaHoje,   "ida",   hoje, true));
        sectionsEl.appendChild(renderSection("🛬", "Retornam hoje", groups.voltaHoje, "volta", hoje, true));
      }
    }
  }

  function renderSection(emoji, title, items, leg, legDate, secondary = false, actionLabel = "Check-in feito ✅") {
    const wrap = document.createElement("div");
    wrap.className = "ci-section" + (secondary ? " ci-section--secondary" : "");

    const sorted = items.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    // Conta confirmados
    const total       = sorted.length;
    const confirmados = sorted.filter((p) => confirms[confirmKey(p, leg, legDate)]).length;

    const head = document.createElement("div");
    head.className = "ci-section__title";
    head.innerHTML = `
      <span>${emoji}</span>
      <span>${escapeHtml(title)}</span>
      <span class="ci-section__count">${total}</span>
      ${confirmados > 0 ? `<span class="ci-section__done">${confirmados}/${total} confirmados</span>` : ""}
    `;
    wrap.appendChild(head);

    const card = document.createElement("div");
    card.className = "card";

    if (total === 0) {
      card.innerHTML = `<div class="empty-state empty-state--compact"><p>Nenhum passageiro</p></div>`;
      wrap.appendChild(card);
      return wrap;
    }

    const table = document.createElement("table");
    table.className = "table table--compact ci-table";
    table.innerHTML = `
      <colgroup>
        <col style="width:24%"><col style="width:20%"><col style="width:20%">
        <col style="width:14%"><col style="width:22%">
      </colgroup>
      <thead>
        <tr>
          <th>Passageiro</th>
          <th>Trecho</th>
          <th>Companhia</th>
          <th>Localizador</th>
          <th class="table__actions-col">Check-in</th>
        </tr>
      </thead>
      <tbody></tbody>`;

    const tbody = table.querySelector("tbody");
    sorted.forEach((p) => {
      const key         = confirmKey(p, leg, legDate);
      const confirmedAt = confirms[key];
      const rota        = leg === "ida"
        ? `${escapeHtml(p.saida) || "—"} → ${escapeHtml(p.destino) || "—"}`
        : `${escapeHtml(p.destino) || "—"} → ${escapeHtml(p.saida) || "—"}`;

      const tr = document.createElement("tr");
      if (confirmedAt) tr.classList.add("ci-row--done");

      tr.innerHTML = `
        <td class="table__client"><span class="ci-nome" title="${escapeHtml(p.nome)}">${escapeHtml(p.nome)}</span></td>
        <td>${rota}</td>
        <td class="table__muted">${escapeHtml(p.companhia) || "—"}</td>
        <td class="table__muted">${escapeHtml(p.localizador) || "—"}</td>
        <td class="table__actions-col"></td>`;

      const actionCell = tr.querySelector(".table__actions-col");
      actionCell.appendChild(renderAction(key, confirmedAt, actionLabel));
      tbody.appendChild(tr);
    });

    card.appendChild(table);
    wrap.appendChild(card);
    return wrap;
  }

  function renderAction(key, confirmedAt, actionLabel = "Check-in feito ✅") {
    const cell = document.createElement("div");
    cell.className = "ci-action";

    if (confirmedAt) {
      cell.innerHTML = `
        <span class="badge badge--concluido">✅ Feito às ${formatTime(confirmedAt)}</span>
        <button class="ci-undo" type="button">desfazer</button>`;
      cell.querySelector(".ci-undo").addEventListener("click", () => {
        setConfirmed(key, false);
      });
    } else {
      const btn = document.createElement("button");
      btn.className = "btn btn--gold btn--icon";
      btn.type      = "button";
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => {
        setConfirmed(key, true);
      });
      cell.appendChild(btn);
    }
    return cell;
  }

  // ===== Status / erro =====
  function showStatus(html) { statusEl.innerHTML = html; }
  function clearStatus()    { statusEl.innerHTML = ""; }
  function showError(msg) {
    sectionsEl.innerHTML = "";
    showStatus(`
      <div class="notice notice--error">
        <strong>Não foi possível carregar as emissões.</strong>
        <p>${escapeHtml(msg)}</p>
      </div>`);
  }

  // ===== Carregamento =====
  async function carregarDados() {
    refreshBtn.disabled = true;
    showStatus(`<div class="notice">Carregando…</div>`);
    try {
      const [{ emissoes, nomePorClienteId }] = await Promise.all([
        fetchEmissoesEClientes(),
        fetchConfirms(),
      ]);
      lastPassengers = emissoesParaPassageiros(emissoes, nomePorClienteId);
      clearStatus();
      renderCalendar();
      renderSections();
      updatedEl.textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      console.error(e);
      showError(e.message || "Erro de rede.");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // Reconsulta só as confirmações (sem recarregar a planilha inteira), para refletir
  // check-ins feitos em outros computadores sem precisar clicar em "Atualizar".
  async function pollConfirms() {
    await fetchConfirms();
    renderSections();
    renderCalendar();
  }

  // ===== Eventos =====
  refreshBtn.addEventListener("click", carregarDados);

  calPrev.addEventListener("click", () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  calNext.addEventListener("click", () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
  calHoje.addEventListener("click", () => {
    const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth();
    selectedDate = null;
    renderCalendar();
    renderSections();
  });

  // ===== Início =====
  // carregarDados() busca a EMPRESA INTEIRA (todo o histórico de emissões + todos os
  // clientes) — pesado demais pra rodar sozinho toda vez que a página abre ou a cada
  // poucos minutos, não importa qual aba a pessoa está olhando (foi exatamente isso que
  // estourou a cota de egress do Supabase: todo computador com o sistema aberto o dia
  // inteiro baixava tudo de novo a cada 5min e a cada troca de aba do navegador, mesmo
  // parado no Dashboard). Só busca quando a aba Check-in é a que está realmente visível.
  function checkinAtivo() {
    const painel = document.querySelector('[data-panel="checkin"]');
    return !!painel && painel.classList.contains("is-active");
  }

  const now  = new Date();
  calYear    = now.getFullYear();
  calMonth   = now.getMonth();
  renderCalendar(); // renderiza calendário vazio enquanto carrega
  if (checkinAtivo()) carregarDados();
  document.addEventListener("aba:ativada", (e) => {
    if (e.detail.tab === "checkin") carregarDados();
  });
  setInterval(() => { if (checkinAtivo()) pollConfirms(); }, CONFIRMS_POLL_MS);
  // A lista de passageiros/datas era carregada só uma vez, na abertura da página — se a aba
  // ficasse aberta de um dia pro outro (comum numa aba fixa do trabalho), "hoje"/"amanhã"
  // nunca se atualizavam sozinhos e viagens novas/relevantes não apareciam até dar F5. Agora
  // recarrega sozinho de tempos em tempos e sempre que a aba volta a ficar visível — mas só
  // enquanto for a aba Check-in que está sendo exibida.
  setInterval(() => { if (checkinAtivo()) carregarDados(); }, DADOS_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && checkinAtivo()) carregarDados();
  });
})();
