// SILAT-LALA service worker
// Naikkan nomor versi ini setiap kali Anda mengubah file di GitHub
const VERSI = 'silat-lala-v2';
const FILE_INTI = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './intro-poster.jpg',
  './logo-kecamatan-cincin.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => c.addAll(FILE_INTI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Data aplikasi (Google) tidak pernah disimpan di cache
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Video diputar langsung dari jaringan (mendukung request Range)
  if (url.pathname.endsWith('.mp4')) return;
  // Halaman: coba jaringan dulu, kalau offline pakai cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(r => { const k = r.clone(); caches.open(VERSI).then(c => c.put('./index.html', k)); return r; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // File lain: cache dulu, lalu jaringan
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const k = r.clone(); caches.open(VERSI).then(c => c.put(e.request, k)); }
      return r;
    }))
  );
});
