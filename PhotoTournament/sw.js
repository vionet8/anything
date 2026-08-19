// 電波の悪い店内でも開けるように、アプリ本体をキャッシュしておく。
// 写真そのものは IndexedDB 側にあるので、ここで持つのは画面を出すための一式だけ。
const VERSION = 'photo-tournament-v3';
const ASSETS = [
  './',
  './index.html',
  './src/bracket.js',
  './src/share.js',
  './src/store.js',
  './src/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュを先に返しつつ裏で取り直す。次に開いたときには新しいものになる。
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    )
  );
});
