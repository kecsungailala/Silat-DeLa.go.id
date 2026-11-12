// SILAT-DeLa service worker: menyimpan tampilan & pustaka agar aplikasi bisa dibuka tanpa sinyal.
// Naikkan nomor versi setiap kali file di GitHub diganti.
const VERSI = 'silat-dela-v1';
const INTI = [
  './', './index.html', './app.html', './offline.js', './manifest.webmanifest',
  './favicon.ico', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './intro-poster.jpg', './logo-kecamatan-cincin.png'
];
const LUAR = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://i.ibb.co.com/bjYrMn6v/Logo.png',
  'https://i.ibb.co.com/xtV3KsM9/Gemini-Generated-Image-iwy39ciwy39ciwy3.png'
];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap';
// Host yang boleh disimpan (pustaka & gambar). Data aplikasi (script.google.com) TIDAK pernah disimpan di sini.
const HOST_SIMPAN = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'i.ibb.co.com', 'lh3.googleusercontent.com'];

async function simpanLuar(cache, url) {
  try { const r = await fetch(url, { mode: 'no-cors' }); await cache.put(url, r); } catch (e) { }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSI);
    await Promise.all(INTI.map(u => c.add(u).catch(() => { })));
    await Promise.all(LUAR.map(u => simpanLuar(c, u)));
    try {   // font Inter: simpan CSS-nya dan semua file font di dalamnya
      const r = await fetch(FONT_CSS); const css = await r.clone().text(); await c.put(FONT_CSS, r);
      const fonts = css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"]+/g) || [];
      await Promise.all(fonts.map(u => simpanLuar(c, u)));
    } catch (e) { }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('.mp4')) return;                  // video langsung dari jaringan
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {                            // halaman: jaringan dulu, lalu salinan
      e.respondWith(fetch(req).then(r => { const k = r.clone(); caches.open(VERSI).then(c => c.put(req, k)); return r; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || caches.match('./app.html'))));
      return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(r => { if (r.ok) { const k = r.clone(); caches.open(VERSI).then(c => c.put(req, k)); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (HOST_SIMPAN.indexOf(url.hostname) === -1) return;        // selain itu (data Google) tidak disentuh
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { const k = r.clone(); caches.open(VERSI).then(c => c.put(req, k)); return r; }).catch(() => hit);
    return hit || net;
  }));
});
