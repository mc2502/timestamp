// 버전 숫자는 scripts/bump-version.sh 가 올린다.
const VERSION = '105';
const CACHE = `timestamp-v${VERSION}`;
const ART_CACHE = 'timestamp-art-v1';
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
  `./js/backup.js?v=${VERSION}`,
  `./js/album-copy.js?v=${VERSION}`,
  `./js/releases.js?v=${VERSION}`,
  './assets/mascots/odung-camera-v3.png',
  './assets/mascots/perpeng-camera-v3.png',
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
    ...['sad', 'hungry'].map((f) => `./assets/art/stamp/${who}-miss-${f}.png`),
  ]),
  ...['breakfast', 'lunch', 'dinner'].map((m) => `./assets/art/slot/${m}.png`),
  './assets/art/album/odung.png',
  './assets/art/album/perpeng.png',
  './assets/art/notifications/toast-label-v1.png',
  `./assets/icons/icon-192.png?v=${VERSION}`,
  `./assets/icons/apple-touch-icon.png?v=${VERSION}`,
];

// 코드와 첫 화면은 같은 버전으로 설치. 그림은 주소가 바뀔 때만 새로 받는다.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(CACHE);
    const art = await caches.open(ART_CACHE);
    await Promise.all(SHELL.map(async (path) => {
      const req = new Request(new URL(path, self.registration.scope));
      const isArt = path.startsWith('./assets/');
      const cache = isArt ? art : shell;
      if (isArt && await cache.match(req)) return;
      const res = await fetch(req, { cache: 'reload' });
      if (!res.ok) throw new Error(`Install failed: ${path}`);
      await cache.put(req, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 저장 중인 이전 화면도 모듈을 읽을 수 있게 바로 전 버전은 남긴다.
    const previous = `timestamp-v${Number(VERSION) - 1}`;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /^timestamp-v\d+$/.test(k) && ![CACHE, previous].includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function network(req, ms = 2800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', signal: controller.signal });
    const body = await res.arrayBuffer(); // 헤더 뒤 본문이 멈추는 경우에도 같은 제한 시간을 적용
    const headers = new Headers(res.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.hostname !== 'cdn.jsdelivr.net') return;
  // 버전 확인 요청은 저장하지 않고, 실패해도 예전 HTML을 최신으로 반환하지 않는다.
  if (sameOrigin && url.searchParams.has('check')) {
    event.respondWith(network(req).catch(() => Response.error()));
    return;
  }
  event.respondWith((async () => {
    if (req.mode === 'navigate') {
      const key = new URL('index.html', self.registration.scope).href;
      const shell = await caches.open(CACHE);
      try {
        const res = await network(req);
        if (!res.ok) throw new Error('Navigation failed');
        // 다른 버전 HTML로 이 버전의 오프라인 첫 화면을 덮어쓰지 않는다.
        const html = await res.clone().text();
        if (/app\.js\?v=(\d+)/.exec(html)?.[1] === VERSION) await shell.put(key, res.clone());
        return res;
      } catch { return await shell.match(key) || Response.error(); }
    }
    const cache = await caches.open(url.pathname.includes('/assets/') || !sameOrigin ? ART_CACHE : CACHE);
    const hit = await cache.match(req) || await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
    return res;
  })().catch(() => Response.error()));
});
