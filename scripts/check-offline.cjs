const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const source=await fs.readFile(path.join(root,'sw.js'),'utf8');
 const current=Number(/const VERSION = '(\d+)'/.exec(source)[1]);
 let version=current,slow=false,slowBody=false;const requests=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
  let relative=decodeURIComponent(url.pathname).slice(1)||'index.html';
  if(relative.includes('..')){res.writeHead(403).end();return}
  try{
   let body=await fs.readFile(path.join(root,relative));
   const ext=path.extname(relative),text=['.js','.html','.css','.webmanifest'].includes(ext);
   if(text)body=Buffer.from(body.toString().replace(/\?v=\d+/g,`?v=${version}`).replace(/const (APP_VERSION|VERSION) = '\d+';/g,(_,n)=>`const ${n} = '${version}';`));
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
   assert.match(await page.locator('#app-version').textContent(),new RegExp(`버전 ${version}`));
  });
  await check('업데이트한 버전도 오프라인 실행',async()=>{
   await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.__tsBooted);
   assert.match(await page.locator('#app-version').textContent(),new RegExp(`버전 ${version}`));
   const files=await page.evaluate(async()=>{const c=await caches.open('timestamp-art-v1');return(await c.keys()).length});
   assert.ok(files>40);
  });
  console.log(JSON.stringify({passed:results.length,results},null,2));
 }finally{await browser.close();server.close();server.closeAllConnections()}
})().catch(e=>{console.error(e);process.exit(1)});
