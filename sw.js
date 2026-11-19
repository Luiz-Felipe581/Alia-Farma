// Service worker simples: rede primeiro, cache como reserva (site abre mesmo com conexão ruim).
const V = 'alia-v5';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(['/', '/style.css', '/app.js'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/pagar')) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
