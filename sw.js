// 버전 숫자는 scripts/bump-version.sh 가 올린다.
const VERSION = '111';
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
  `./assets/icons/icon-192.png?v=${VERSION}`,
  `./assets/icons/apple-touch-icon.png?v=${VERSION}`,
];

// 그림 내용 지문. scripts/art-hashes.mjs가 배포 때(bump-version.sh) 채운다. 손으로 고치지 않는다.
const ART_HASH = {
  'assets/art/album/odung.png': '04ebdeb66f0e',
  'assets/art/album/perpeng.png': 'badc585df962',
  'assets/art/meal/odung-breakfast.png': 'aeb7030e9444',
  'assets/art/meal/odung-dinner.png': '54fd9c53dc53',
  'assets/art/meal/odung-full.png': 'c7df55b9fba8',
  'assets/art/meal/odung-lunch.png': '3c421e4baa42',
  'assets/art/meal/perpeng-breakfast.png': '8816c11ec72c',
  'assets/art/meal/perpeng-dinner.png': '12d674117169',
  'assets/art/meal/perpeng-full.png': 'a6a185b879d8',
  'assets/art/meal/perpeng-lunch.png': '6b7b45f49508',
  'assets/art/odung-empty.png': '4b7f1405f0be',
  'assets/art/odung-hero.png': '7da9b37a04a2',
  'assets/art/perpeng-empty.png': 'ec2037a757f9',
  'assets/art/perpeng-hero.png': '29f032dca72b',
  'assets/art/seal-disc-rough.png': '303af379e529',
  'assets/art/seal-ring-rough.png': '721578cf1869',
  'assets/art/slot/breakfast.png': '8428534a9978',
  'assets/art/slot/dinner.png': 'a416362bd7f9',
  'assets/art/slot/lunch.png': '15a5bbf0219f',
  'assets/art/stamp/odung-miss-hungry.png': '86f4a110e684',
  'assets/art/stamp/odung-miss-sad.png': 'e8860ceb0416',
  'assets/art/stamp/odung-smile.png': '71e9ba2be8cf',
  'assets/art/stamp/odung-wink.png': 'b9ec1c28dd51',
  'assets/art/stamp/odung-yum.png': 'b7744cfc17d2',
  'assets/art/stamp/perpeng-miss-hungry.png': 'e926f22f126a',
  'assets/art/stamp/perpeng-miss-sad.png': '20c3da495e07',
  'assets/art/stamp/perpeng-smile.png': '7f5037c681e5',
  'assets/art/stamp/perpeng-wink.png': '74d30ca77531',
  'assets/art/stamp/perpeng-yum.png': '445075884be6',
  'assets/mascots/odung-calendar-face-v7.png': '908c0f7e46eb',
  'assets/mascots/odung-camera-v2.png': '8a293f71d7e9',
  'assets/mascots/odung-camera-v3.png': '578d0ace9a04',
  'assets/mascots/perpeng-calendar-face-v4.png': 'fe62e86efc53',
  'assets/mascots/perpeng-camera-v2.png': '8ccba3d1eb32',
  'assets/mascots/perpeng-camera-v3.png': '0af9dd8b3ff9',
  'assets/poses/odung-fullbody.png': '31affb22788c',
  'assets/poses/odung-pt.png': '6e2eabb384e5',
  'assets/poses/odung-running.png': 'b617c6f7ec59',
  'assets/poses/odung-solo.png': 'd92ca4201248',
  'assets/poses/odung-stairs.png': '900390a69f74',
  'assets/poses/odung-strength.png': '4b32b92ca52f',
  'assets/poses/odung-summary.png': 'f568dd98b64c',
  'assets/poses/perpeng-arms.png': '9636f9f5d737',
  'assets/poses/perpeng-chest.png': '6935058aaf8e',
  'assets/poses/perpeng-fullbody.png': '3df7900fb1c1',
  'assets/poses/perpeng-pt.png': '9bc63f8140ac',
  'assets/poses/perpeng-running.png': '13243b7afcb7',
  'assets/poses/perpeng-solo.png': 'a6fbf41aebf7',
  'assets/poses/perpeng-stairs.png': 'cffb5630ba63',
  'assets/poses/perpeng-summary.png': '1150a0a17639',
};

// 주소에 ?v= 가 없는 assets/ 파일만 그림 캐시에 둔다. (?v= 아이콘은 버전 캐시로)
const scopePath = new URL(self.registration.scope).pathname;
const artPath = (url) => (url.origin === self.location.origin && !url.search && url.pathname.startsWith(`${scopePath}assets/`)
  ? url.pathname.slice(scopePath.length) : null);

// 지문을 응답 머리에 붙여 저장한다. 다음 배포에서 지문이 같으면 다시 받지 않는다.
async function putArt(cache, req, res, path) {
  const hash = ART_HASH[path];
  if (!hash) { await cache.put(req, res); return; }
  const headers = new Headers(res.headers);
  headers.set('x-art-hash', hash);
  await cache.put(req, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers }));
}

// 코드와 첫 화면은 같은 버전으로 설치. 그림은 내용(지문)이 바뀐 것만 새로 받는다.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(CACHE);
    const art = await caches.open(ART_CACHE);
    await Promise.all(SHELL.map(async (path) => {
      const req = new Request(new URL(path, self.registration.scope));
      const key = artPath(new URL(req.url));
      if (key) {
        const hit = await art.match(req);
        if (hit && (!ART_HASH[key] || hit.headers.get('x-art-hash') === ART_HASH[key])) return;
      }
      const res = await fetch(req, { cache: 'reload' });
      if (!res.ok) throw new Error(`Install failed: ${path}`);
      if (key) await putArt(art, req, res, key);
      else await shell.put(req, res);
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
    // 그림 캐시 정리: 예전에 쌓인 ?v= 아이콘과 더 이상 배포하지 않는 그림. 다른 곳(글꼴 CDN) 파일은 둔다.
    const art = await caches.open(ART_CACHE);
    const shipped = Object.keys(ART_HASH).length > 0;
    await Promise.all((await art.keys()).map((req) => {
      const url = new URL(req.url);
      if (url.origin !== self.location.origin) return null;
      const stale = url.search || (shipped && !ART_HASH[artPath(url)]);
      return stale ? art.delete(req) : null;
    }));
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
    const key = artPath(url);
    const cache = await caches.open(key || !sameOrigin ? ART_CACHE : CACHE);
    const hit = await cache.match(req) || await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (key && res.ok) await putArt(cache, req, res.clone(), key);
    else if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
    return res;
  })().catch(() => Response.error()));
});
