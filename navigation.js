// ===== Navegação entre as abas da Lolek =====
(function () {
  "use strict";

  const navItems = document.querySelectorAll(".nav__item");
  const panels = document.querySelectorAll(".panel");
  const pageTitle = document.getElementById("page-title");

  // Título exibido na topbar para cada aba
  const TITLES = {
    checkin: "Check-in do dia",
    orcamentos: "Orçamentos",
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
    item.addEventListener("click", () => activateTab(item.dataset.tab));
  });

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
})();
