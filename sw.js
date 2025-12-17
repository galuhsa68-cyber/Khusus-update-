// 🚀 Service Worker Auto Update Modern Tanpa Offline Page

// 🧠 Versi otomatis berdasarkan waktu build
const VERSION = new Date().getTime();
const CACHE_NAME = `save-kontak-${VERSION}`;

// 💾 File penting yang akan disimpan di cache
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png'
];

// 📦 INSTALL — Cache file penting
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  // Langsung aktif tanpa nunggu versi lama
  self.skipWaiting();
});

// 🔄 ACTIVATE — Hapus cache lama & reload otomatis semua tab
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));

      // 🔁 Paksa semua tab reload agar langsung versi baru
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
  self.clients.claim();
});

// 🌐 FETCH — Cache first, fallback ke jaringan
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});