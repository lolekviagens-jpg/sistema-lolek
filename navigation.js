// ===== Navegação entre as abas da Lolek =====
(function () {
  "use strict";

  const navItems = document.querySelectorAll(".nav__item");
  const panels = document.querySelectorAll(".panel");
  const pageTitle = document.getElementById("page-title");

  // Título exibido na topbar para cada aba
  const TITLES = {
    checkin:    "Check-in do dia",
    orcamentos: "Orçamentos",
    vendas:     "Dashboard",
    "nova-emissao": "Novas Emissões",
    emissoes:    "Emissões",
    clientes:    "Clientes",
    roteiro:     "Roteiro",
    followup:    "Follow-up",
    financeiro:  "Financeiro",
    contratos:   "Contratos",
    empresas:    "Empresas",
    usuarios:    "Usuários",
  };

  function activateTab(tab) {
    navItems.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.tab === tab);
    });

    panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === tab);
    });

    if (TITLES[tab]) {
      pageTitle.textContent = TITLES[tab];
    }
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      activateTab(item.dataset.tab);
      closeMenu();
    });
  });

  // ===== Menu lateral (gaveta) no celular =====
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuToggle = document.getElementById("menu-toggle");

  function openMenu() {
    sidebar?.classList.add("is-open");
    overlay?.classList.add("is-open");
  }

  function closeMenu() {
    sidebar?.classList.remove("is-open");
    overlay?.classList.remove("is-open");
  }

  menuToggle?.addEventListener("click", () => {
    sidebar?.classList.contains("is-open") ? closeMenu() : openMenu();
  });

  overlay?.addEventListener("click", closeMenu);

  // ===== Data de hoje na topbar =====
  function renderDate() {
    const el = document.getElementById("page-date");
    if (!el) return;
    const hoje = new Date();
    el.textContent = hoje.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  renderDate();

  // ===== Barra de rolagem horizontal "espelho" no topo de tabelas largas =====
  // Em listas compridas, a barra de rolagem do navegador só aparece lá embaixo, no fim da
  // tabela — pra rolar pro lado e ver as colunas escondidas é preciso descer até ela. Isso
  // cria uma segunda barra fina logo ACIMA de cada tabela larga, sincronizada com o scroll
  // real, sempre visível perto do topo do conteúdo.
  (function () {
    function processarCard(card) {
      if (card.dataset.scrollEspelho) return;
      if (card.scrollWidth <= card.clientWidth + 2) return; // não precisa rolar
      card.dataset.scrollEspelho = "1";

      const barra = document.createElement("div");
      barra.className = "scroll-espelho";
      const interno = document.createElement("div");
      barra.appendChild(interno);
      card.parentNode.insertBefore(barra, card);

      const sincronizarLargura = () => {
        interno.style.width = card.scrollWidth + "px";
        barra.style.display = card.scrollWidth > card.clientWidth + 2 ? "block" : "none";
      };

      let sincronizando = false;
      barra.addEventListener("scroll", () => {
        if (sincronizando) return;
        sincronizando = true;
        card.scrollLeft = barra.scrollLeft;
        sincronizando = false;
      });
      card.addEventListener("scroll", () => {
        if (sincronizando) return;
        sincronizando = true;
        barra.scrollLeft = card.scrollLeft;
        sincronizando = false;
      });

      sincronizarLargura();
      if (window.ResizeObserver) new ResizeObserver(sincronizarLargura).observe(card);
    }

    function varrer() {
      document.querySelectorAll(".card").forEach((card) => {
        if (card.querySelector(".table")) processarCard(card);
      });
    }

    let agendado = null;
    const observer = new MutationObserver(() => {
      if (agendado) return;
      agendado = setTimeout(() => {
        agendado = null;
        varrer();
      }, 150);
    });
    observer.observe(document.querySelector(".content") || document.body, { childList: true, subtree: true });

    varrer();
  })();
})();
