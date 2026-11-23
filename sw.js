// 네트워크를 먼저 쓰고, 끊기면 마지막으로 받은 파일을 보여 준다.
const CACHE = 'timestamp-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/format.js',
  './js/exif.js',
  './js/stamp.js',
  './js/db.js',
  './assets/mascots/odung-summary-v2.png',
  './assets/mascots/odung-calendar-face-v7.png',
  './assets/mascots/odung-week-trio-v2.png',
  './assets/mascots/perpeng-summary-v1.png',
  './assets/mascots/perpeng-calendar-face-v4.png',
  './assets/mascots/perpeng-week-trio-v1.png',
  './assets/illustrations/empty-log.png',
  './assets/icons/icon-192.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
