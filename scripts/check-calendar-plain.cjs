// 달력 칸에서 올린 사진은 스탬프 없이 사진만, 사진 보기의 ‘사진 교체하기’는 그대로 스탬프가 찍히는지 확인한다.
// 실행: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/check-calendar-plain.cjs  (격리된 저장소 · 가짜 사진만 사용)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.SCREENSHOT_DIR;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }).end(data);
  });
});
server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-11-26T19:00:00+09:00'));
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(fn)) return; await page.waitForTimeout(150); } throw new Error('timeout'); };
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__tsBooted);
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
      const x = c.getContext('2d'); x.fillStyle = '#cfe3d4'; x.fillRect(0, 0, 1200, 900);
      window.photo = new File([await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))], 'plain.jpg', { type: 'image/jpeg', lastModified: Date.now() });
      const input = document.querySelector('#input-photo');
      input.click = () => { const dt = new DataTransfer(); dt.items.add(window.photo); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
      // 저장된 사진의 얼룩(스탬프) 정도: 평균색에서 가장 많이 벗어난 픽셀 차이와 벗어난 픽셀 비율
      window.records = () => new Promise((resolve, reject) => {
        const req = indexedDB.open('timestamp');
        req.onsuccess = () => { const g = req.result.transaction('photos').objectStore('photos').getAll(); g.onsuccess = () => resolve(g.result); g.onerror = () => reject(g.error); };
        req.onerror = () => reject(req.error);
      });
      window.inkOf = async (blob) => {
        const bmp = await createImageBitmap(blob); const c2 = document.createElement('canvas'); c2.width = bmp.width; c2.height = bmp.height;
        const x2 = c2.getContext('2d'); x2.drawImage(bmp, 0, 0); const d = x2.getImageData(0, 0, c2.width, c2.height).data;
        let off = 0; const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0xcf) + Math.abs(d[i + 1] - 0xe3) + Math.abs(d[i + 2] - 0xd4) > 30) off++;
        return { w: bmp.width, h: bmp.height, offRatio: off / n };
      };
    });
    // 1) 달력 칸에서 올리기
    await page.locator('.tab[data-view="calendar"]').click();
    await page.locator('.slot-ph[data-slot="lunch"]').click();
    await until(async () => (await window.records()).length === 1 && !document.querySelector('#toast-text').textContent.includes('남기고'));
    await page.waitForTimeout(300);
    if (out) await page.screenshot({ path: `${out}/plain-calendar.png` });
    const a = await page.evaluate(async () => { const [r] = await window.records(); return { style: r.style, meal: r.meal, ink: await window.inkOf(r.blob), thumb: await window.inkOf(r.thumb), toast: document.querySelector('#toast-text').textContent }; });
    console.log('calendar slot', JSON.stringify(a));
    assert.equal(a.style, 'none');
    assert.equal(a.meal, 'lunch');
    assert.ok(a.ink.offRatio < 0.001, '달력 사진에 스탬프가 없어야 함');
    assert.ok(a.thumb.offRatio < 0.001);
    // 2) 같은 칸을 다시 눌러 교체해도 스탬프 없음
    await page.locator('.slot-ph[data-slot="lunch"]').click();
    await until(async () => { const rs = await window.records(); return rs.length === 1 && document.querySelector('#toast-text').textContent.includes('교체'); });
    const b = await page.evaluate(async () => { const [r] = await window.records(); return { style: r.style, ink: await window.inkOf(r.blob) }; });
    console.log('calendar replace', JSON.stringify(b));
    assert.equal(b.style, 'none');
    assert.ok(b.ink.offRatio < 0.001);
    // 3) 사진 보기의 ‘사진 교체하기’는 그대로 스탬프
    await page.locator('.tab[data-view="album"]').click();
    await page.locator('[data-id]').first().click();
    await page.locator('#vw-replace').click();
    await until(async () => { const rs = await window.records(); return rs.length === 1 && rs[0].style !== 'none'; });
    const c = await page.evaluate(async () => { const rs = await window.records(); const [r] = rs; return { style: r.style, ink: await window.inkOf(r.blob) }; });
    console.log('viewer replace', JSON.stringify(c));
    assert.ok(c.ink.offRatio > 0.005, '사진 보기 교체는 스탬프가 있어야 함');
    assert.deepEqual(errors, []);
    console.log('PASS 달력 칸 사진은 스탬프 없음 · 사진 보기 교체는 스탬프 유지');
  } finally { await browser.close(); server.close(); }
});
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
