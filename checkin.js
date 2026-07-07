// ===== Check-in do dia — Lolek Viagens =====
(function () {
  "use strict";

  const SHEET_ID  = "1xyyqOlYBcxB1odxA09zCff6xax6l5vIceNQkmXoOips";
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv";
  const CHECKINS_FN = "/.netlify/functions/checkins";
  const CONFIRMS_POLL_MS = 20000; // reconsulta as confirmações de outros computadores periodicamente

  const COL = { situacao: 1, nome: 4, dataIda: 5, dataVolta: 6, saida: 7, destino: 8, companhia: 9, localizador: 11 };

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

  function parseDate(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = s.match(/Date\((\d+),(\d+),(\d+)/);
    if (m) return `${m[1]}-${String(+m[2] + 1).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    // Erro comum de fórmula/digitação na planilha: data sem o ano (ex: "02/07"). Assume o ano corrente.
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return `${new Date().getFullYear()}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  function parseCsv(text) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

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

  // Classifica o produto pela coluna de situação (mesma regra usada em vendas.js)
  function tipoProduto(situacao) {
    const s = (situacao || "").toLowerCase().trim();
    if (!s) return null;
    if (s === "aguardando viagem" || s === "viagem concluida") return "Passagem aérea";
    if (s.includes("hospedagem")) return "Hospedagem";
    if (s.includes("seguro"))     return "Seguro viagem";
    if (s.includes("mala"))       return "Adicional de mala";
    return situacao.trim().charAt(0).toUpperCase() + situacao.trim().slice(1);
  }

  // ===== Processamento =====
  function rowsToPassengers(rows) {
    return rows
      .map((cols) => ({
        nome:       (cols[COL.nome]       || "").trim(),
        situacao:   (cols[COL.situacao]   || "").trim(),
        saida:      (cols[COL.saida]      || "").trim(),
        destino:    (cols[COL.destino]    || "").trim(),
        companhia:  (cols[COL.companhia]  || "").trim(),
        localizador:(cols[COL.localizador]|| "").trim(),
        dataIda:    parseDate(cols[COL.dataIda]),
        dataVolta:  parseDate(cols[COL.dataVolta]),
      }))
      .filter((p) => p.nome && !/cancel/i.test(p.situacao))
      .map((p) => ({ ...p, tipo: tipoProduto(p.situacao) }));
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
    table.className = "table";
    table.innerHTML = `
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
        <td class="table__client">${escapeHtml(p.nome)}</td>
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
        <strong>Não foi possível carregar a planilha.</strong>
        <p>${escapeHtml(msg)}</p>
        <small>Verifique se a planilha está compartilhada como "Qualquer pessoa com o link — Leitor" e tente de novo.</small>
      </div>`);
  }

  // ===== Carregamento =====
  async function fetchSheet() {
    refreshBtn.disabled = true;
    showStatus(`<div class="notice">Carregando planilha…</div>`);
    try {
      const [resp] = await Promise.all([
        fetch(SHEET_URL + "&t=" + Date.now()),
        fetchConfirms(),
      ]);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      lastPassengers = rowsToPassengers(parseCsv(text));
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
  refreshBtn.addEventListener("click", fetchSheet);

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
  const now  = new Date();
  calYear    = now.getFullYear();
  calMonth   = now.getMonth();
  renderCalendar(); // renderiza calendário vazio enquanto carrega
  fetchSheet();
  setInterval(pollConfirms, CONFIRMS_POLL_MS);
})();
