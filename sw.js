/* =====================================================================
   Service worker · AgroField Capture
   Permite abrir la app sin conexión (iPhone/Android instalada en inicio).
   Para publicar una actualización: cambia VERSION y sube ambos archivos.
   ===================================================================== */
const VERSION = '1.3.0';
const CACHE = 'muestreo-suelos-' + VERSION;
const RUNTIME = 'muestreo-suelos-runtime';

// Archivos propios de la app
const CORE = ['./', './index.html'];

// Librerías externas (mismas direcciones que en index.html)
const LIBS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Los mosaicos satelitales no se guardan (pesan mucho y solo se usan con conexión)
const NO_CACHE_HOSTS = ['server.arcgisonline.com', 'services.arcgisonline.com'];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all([...CORE, ...LIBS].map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (e) { /* si una falla, se reintenta en el próximo uso */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  if (NO_CACHE_HOSTS.includes(url.hostname)) return;

  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, true)); return; }
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req, false)); return; }
  event.respondWith(cacheFirst(req));
});

// Página: primero la red (para recibir actualizaciones), con tiempo límite; si no hay señal, la copia guardada.
async function networkFirst(req, isNav) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), isNav ? NAV_TIMEOUT_MS : 8000);
    if (res && res.ok) {
      cache.put(req, res.clone());
      if (isNav) cache.put('./index.html', res.clone());
    }
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
                (isNav ? (await cache.match('./index.html')) || (await cache.match('./')) : null);
    if (hit) return hit;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">' +
      '<div><h1 style="color:#f59e0b">Sin conexión</h1><p>Abre la app una vez con internet para que quede disponible sin señal.</p></div></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// Librerías y tipografías: primero la copia guardada; si no existe, se descarga y se guarda.
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      const cache = await caches.open(RUNTIME);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); });
  });
}
