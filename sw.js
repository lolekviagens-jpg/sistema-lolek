// Service worker do PWA — só existe pra tornar o site instalável (ícone na tela
// inicial / instalar no computador). Estratégia network-first: sempre tenta buscar
// a versão mais nova primeiro (o site muda várias vezes por dia) e só usa o cache
// como reserva se não tiver internet. Nunca cacheia chamadas às Netlify Functions
// (dados sempre precisam vir ao vivo).

const CACHE_NAME = "lolek-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/style.css", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca intercepta chamadas de API/funções — sempre direto na rede.
  if (event.request.method !== "GET" || url.pathname.startsWith("/.netlify/")) return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
