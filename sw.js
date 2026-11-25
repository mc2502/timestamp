// 오프라인용 서비스 워커.
// GitHub Pages는 파일을 10분씩 캐시하게 해서, 배포 직후 예전 파일과 새 파일이 섞일 수 있다.
// 그래서 매번 서버에 바뀌었는지 물어보고(no-cache, 안 바뀌었으면 304로 가볍게), 끊겼을 때만 저장본을 쓴다.
// 버전 숫자는 scripts/bump-version.sh 가 올린다.
const VERSION = '68';
const CACHE = `timestamp-v${VERSION}`;
const SHELL = [
  './',
  './index.html',
  `./styles.css?v=${VERSION}`,
  `./manifest.webmanifest?v=${VERSION}`,
  `./js/app.js?v=${VERSION}`,
  `./js/format.js?v=${VERSION}`,
  `./js/exif.js?v=${VERSION}`,
  `./js/stamp.js?v=${VERSION}`,
  `./js/db.js?v=${VERSION}`,
  './assets/mascots/odung-camera-v2.png',
  './assets/mascots/perpeng-camera-v2.png',
  './assets/poses/odung-fullbody.png',
  './assets/poses/odung-pt.png',
  './assets/poses/odung-running.png',
  './assets/poses/odung-solo.png',
  './assets/poses/odung-stairs.png',
  './assets/poses/odung-strength.png',
  './assets/poses/odung-summary.png',
  './assets/poses/perpeng-arms.png',
  './assets/poses/perpeng-chest.png',
  './assets/poses/perpeng-fullbody.png',
  './assets/poses/perpeng-pt.png',
  './assets/poses/perpeng-running.png',
  './assets/poses/perpeng-solo.png',
  './assets/poses/perpeng-stairs.png',
  './assets/poses/perpeng-summary.png',
  './assets/mascots/odung-calendar-face-v7.png',
  './assets/mascots/perpeng-calendar-face-v4.png',
  './assets/art/odung-hero.png',
  './assets/art/perpeng-hero.png',
  './assets/art/odung-empty.png',
  './assets/art/perpeng-empty.png',
  './assets/art/seal-ring-rough.png',
  './assets/art/seal-disc-rough.png',
  ...['odung', 'perpeng'].flatMap((who) => [
    ...['breakfast', 'lunch', 'dinner', 'full'].map((m) => `./assets/art/meal/${who}-${m}.png`),
    ...['smile', 'yum', 'wink'].map((f) => `./assets/art/stamp/${who}-${f}.png`),
  ]),
  `./assets/icons/icon-192.png?v=${VERSION}`,
  `./assets/icons/apple-touch-icon.png?v=${VERSION}`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fresh(req) {
  // 화면 이동 요청은 옵션을 붙여 다시 만들 수 없어서 주소로 다시 요청한다
  if (req.mode === 'navigate') return fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  return fetch(req, { cache: 'no-cache' });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.hostname !== 'cdn.jsdelivr.net') return;
  event.respondWith(
    (sameOrigin ? fresh(req) : fetch(req))
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
