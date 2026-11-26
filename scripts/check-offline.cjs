const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const source=await fs.readFile(path.join(root,'sw.js'),'utf8');
 const current=Number(/const VERSION = '(\d+)'/.exec(source)[1]);
 const releaseSource=await fs.readFile(path.join(root,'js/releases.js'),'utf8');
 const publicVersion=/version:\s*'([^']+)'/.exec(releaseSource)[1];
 const nextParts=publicVersion.split('.').map(Number);nextParts[2]++;
 const nextPublicVersion=nextParts.join('.');
 let version=current,slow=false,slowBody=false,artOverride=null;const requests=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
  let relative=decodeURIComponent(url.pathname).slice(1)||'index.html';
  if(relative.includes('..')){res.writeHead(403).end();return}
  try{
   let body=await fs.readFile(path.join(root,artOverride&&relative===artOverride.path?artOverride.from:relative));
   const ext=path.extname(relative),text=['.js','.html','.css','.webmanifest'].includes(ext);
   if(text)body=Buffer.from(body.toString().replace(/\?v=\d+/g,`?v=${version}`).replace(/const (APP_BUILD|VERSION) = '\d+';/g,(_,n)=>`const ${n} = '${version}';`));
   // 같은 이름으로 다시 그린 그림: 다른 내용과 바뀐 지문을 내보낸다
   if(relative==='sw.js'&&artOverride)body=Buffer.from(body.toString().replace(new RegExp(`'${artOverride.path}': '[0-9a-f]+'`),`'${artOverride.path}': '${artOverride.hash}'`));
   if(relative==='js/releases.js'&&version>current)body=Buffer.from(body.toString().replace(`version: '${publicVersion}'`,`version: '${nextPublicVersion}'`));
   if(slow&&relative==='index.html'&&!url.searchParams.has('check'))await new Promise(r=>setTimeout(r,8000));
   if(slowBody && relative==='index.html'&&!url.searchParams.has('check')){res.writeHead(200,{'content-type':'text/html'});res.write(body.subarray(0,50));await new Promise(r=>setTimeout(r,8000));res.end(body.subarray(50));return}
   res.writeHead(200,{'content-type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'})[ext]||'application/octet-stream','cache-control':'no-store'}).end(body);
  }catch{res.writeHead(404).end()}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({timezoneId:'Asia/Seoul'});const page=await context.newPage();
 const results=[];async function check(name,fn){await fn();results.push(name);console.log('PASS',name)}
 try{
  await page.goto(url);await page.waitForFunction(()=>window.__tsBooted);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;await(await caches.open('unrelated-app')).put('/sentinel',new Response('keep'))});
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await check('버전 확인 URL·새로고침 주소가 캐시에 쌓이지 않음',async()=>{
   await page.evaluate(async()=>{for(let i=0;i<5;i++)await fetch(`index.html?check=${Date.now()}-${i}`)});
   await page.goto(url+'?r=123');await page.waitForFunction(()=>window.__tsBooted);
   const keys=await page.evaluate(async()=>{const all=await Promise.all((await caches.keys()).map(async k=>(await(await caches.open(k)).keys()).map(r=>r.url)));return all.flat()});
   assert.equal(keys.some(x=>/[?&](check|r)=/.test(x)),false);
  });
  await check('느린 첫 화면은 저장본으로 5초 이내 시작',async()=>{
   slow=true;const begin=Date.now();await page.reload();await page.waitForFunction(()=>window.__tsBooted);
   assert.ok(Date.now()-begin<5000);slow=false;
  });
  await check('본문 전송 중 멈춰도 저장본으로 시작',async()=>{
   slowBody=true;const begin=Date.now();await page.reload();await page.waitForFunction(()=>window.__tsBooted);assert.ok(Date.now()-begin<5000);slowBody=false;
  });
  await check('느린 시작 뒤에도 오프라인 재시작',async()=>{
   await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.__tsBooted);
   assert.equal(await page.locator('#album-intro').isVisible(),true);await context.setOffline(false);
  });
  await check('배포 전환 시 같은 그림 재다운로드 없음·다른 앱 캐시 유지',async()=>{
   requests.length=0;version=current+1;
   await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update()});
   await page.waitForFunction(v=>caches.has(`timestamp-v${v}`),version);
   await page.waitForTimeout(1500);
   assert.equal(requests.some(x=>x.startsWith('/assets/')&&!x.includes('/icons/')),false);
   assert.equal(await page.evaluate(()=>caches.has('unrelated-app')),true);
   await page.reload();await page.waitForFunction(()=>window.__tsBooted);
   assert.equal(await page.locator('#app-version').textContent(),`버전 ${nextPublicVersion}`);
  });
  await check('같은 이름으로 다시 그린 그림만 새로 받음',async()=>{
   artOverride={path:'assets/art/stamp/odung-smile.png',from:'assets/art/stamp/perpeng-smile.png',hash:'0123456789ab'};
   requests.length=0;version++;
   await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update()});
   await page.waitForFunction(v=>caches.has(`timestamp-v${v}`),version);
   await page.waitForTimeout(1500);
   const art=requests.filter(x=>x.startsWith('/assets/')&&!x.includes('/icons/'));
   assert.deepEqual(art,['/assets/art/stamp/odung-smile.png']);
   await page.reload();await page.waitForFunction(()=>window.__tsBooted);
   const info=await page.evaluate(async()=>{const r=await(await caches.open('timestamp-art-v1')).match('assets/art/stamp/odung-smile.png');return{hash:r.headers.get('x-art-hash'),size:(await r.blob()).size}});
   const want=(await fs.stat(path.join(root,artOverride.from))).size;
   assert.deepEqual(info,{hash:'0123456789ab',size:want});
   const icons=await page.evaluate(async()=>(await(await caches.open('timestamp-art-v1')).keys()).filter(r=>r.url.includes('?')).length);
   assert.equal(icons,0);
  });
  await check('느린 망에서 새 버전이 나와도 새로고침이 되풀이되지 않음',async()=>{
   let loads=0;const onNav=(f)=>{if(f===page.mainFrame())loads++};
   page.on('framenavigated',onNav);
   version++;slow=true;
   await page.reload();
   const deadline=Date.now()+40000;let ok=false;
   while(!ok&&Date.now()<deadline){
    await page.waitForTimeout(500);
    try{ok=await page.evaluate(v=>Boolean(window.__tsBooted&&[...document.scripts].some(s=>s.src.includes(`app.js?v=${v}`))),version)}catch{/* 새로 불러오는 중 */}
   }
   await page.waitForTimeout(4000); // 새 버전에서 더 새로고침하지 않는지
   slow=false;page.off('framenavigated',onNav);
   assert.ok(ok,'새 버전으로 바뀌지 않음');
   assert.ok(loads<=2,`새로고침 ${loads}번`);
  });
  await check('업데이트한 버전도 오프라인 실행',async()=>{
   await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.__tsBooted);
   assert.equal(await page.locator('#app-version').textContent(),`버전 ${nextPublicVersion}`);
   await page.locator('#open-settings').click();await page.locator('#release-notes summary').click();
   assert.equal(await page.locator('.release-entry h3').first().textContent(),nextPublicVersion);
   const files=await page.evaluate(async()=>{const c=await caches.open('timestamp-art-v1');return(await c.keys()).length});
   assert.ok(files>40);
  });
  console.log(JSON.stringify({passed:results.length,results},null,2));
 }finally{await browser.close();server.close();server.closeAllConnections()}
})().catch(e=>{console.error(e);process.exit(1)});
