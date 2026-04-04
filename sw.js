// 🚀 Service Worker Modern (Stable Auto Update)

// 🧠 Versi manual (lebih stabil daripada Date.now)
const CACHE_NAME = 'save-kontak-v54';

// 📦 Asset penting
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png'
];

// 📥 INSTALL
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
});

// 🔄 ACTIVATE
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      // 🧹 Hapus cache lama
      await Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );

      await self.clients.claim();
    })()
  );
});

// 🌐 FETCH (Network First untuk HTML, Cache First untuk lainnya)
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 🔥 Untuk halaman (biar update cepat)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put('/index.html', res.clone());
            return res;
          });
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // ⚡ Untuk asset (cepat dari cache)
  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req).then(res => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(req, res.clone());
          return res;
        });
      });
    })
  );
});
