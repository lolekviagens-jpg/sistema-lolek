// ===== Login / sessão — Lolek Viagens =====
// Carregado ANTES de todos os outros scripts. Bloqueia o app até logar (tela de
// login por cima de tudo) e expõe window.LolekAuth pros outros arquivos
// mandarem o token de autenticação nas ações de criar/editar/excluir.
(function () {
  "use strict";

  const AUTH_FN = "/.netlify/functions/auth";
  const STORAGE_KEY = "lolek_auth";

  const loginScreen = document.getElementById("login-screen");
  const appRoot      = document.getElementById("app-root");
  const loginForm    = document.getElementById("login-form");
  const usuarioEl    = document.getElementById("login-usuario");
  const senhaEl      = document.getElementById("login-senha");
  const erroEl       = document.getElementById("login-erro");
  const btnEl        = document.getElementById("login-btn");
  const sidebarUsuarioEl = document.getElementById("sidebar-usuario");
  const sidebarLogoutEl  = document.getElementById("sidebar-logout");
  const navUsuariosEl    = document.getElementById("nav-usuarios");

  function lerSessaoSalva() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }
  function salvarSessao(sessao) { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessao)); }
  function limparSessao() { localStorage.removeItem(STORAGE_KEY); }

  let sessaoAtual = lerSessaoSalva();

  function mostrarApp() {
    appRoot.hidden = false;
    loginScreen.hidden = true;
    if (sessaoAtual) {
      sidebarUsuarioEl.textContent = sessaoAtual.nome;
      navUsuariosEl.hidden = !sessaoAtual.admin;
    }
  }
  function mostrarLogin() {
    appRoot.hidden = true;
    loginScreen.hidden = false;
    senhaEl.value = "";
  }

  // Otimista: se já tem sessão salva, mostra o app na hora (sem esperar a rede)
  // e confirma em segundo plano — evita tela de login piscando à toa.
  if (sessaoAtual) mostrarApp(); else mostrarLogin();

  async function chamarAuth(action, data) {
    const resp = await fetch(AUTH_FN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, data: data || {} }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || "Erro HTTP " + resp.status);
    return json;
  }

  async function validarEmSegundoPlano() {
    if (!sessaoAtual) return;
    try {
      const r = await chamarAuth("validar", { token: sessaoAtual.token });
      if (!r.valido) { limparSessao(); sessaoAtual = null; mostrarLogin(); }
      else { sessaoAtual.admin = r.admin; sessaoAtual.nome = r.nome; salvarSessao(sessaoAtual); mostrarApp(); }
    } catch {
      // falha de rede: mantém a sessão otimista, não derruba o usuário por instabilidade
    }
  }
  validarEmSegundoPlano();

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    erroEl.hidden = true;
    btnEl.disabled = true;
    btnEl.textContent = "Entrando…";
    try {
      const r = await chamarAuth("login", { usuario: usuarioEl.value.trim(), senha: senhaEl.value });
      sessaoAtual = { token: r.token, nome: r.nome, usuario: r.usuario, admin: r.admin };
      salvarSessao(sessaoAtual);
      mostrarApp();
    } catch (err) {
      erroEl.textContent = err.message || "Não foi possível entrar.";
      erroEl.hidden = false;
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = "Entrar";
    }
  });

  sidebarLogoutEl.addEventListener("click", async () => {
    if (!confirm("Sair do sistema?")) return;
    const token = sessaoAtual && sessaoAtual.token;
    limparSessao();
    sessaoAtual = null;
    mostrarLogin();
    if (token) chamarAuth("logout", { token }).catch(() => {});
  });

  // ===== API pros outros arquivos =====
  window.LolekAuth = {
    token() { return sessaoAtual && sessaoAtual.token; },
    nome() { return sessaoAtual && sessaoAtual.nome; },
    admin() { return !!(sessaoAtual && sessaoAtual.admin); },
    // Header pra incluir nas chamadas de escrita (criar/editar/excluir)
    headers() {
      const t = sessaoAtual && sessaoAtual.token;
      return t ? { "x-auth-token": t } : {};
    },
  };
})();
