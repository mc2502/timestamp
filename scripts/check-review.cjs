// 실행: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/check-review.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_URL || 'http://127.0.0.1:5173/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:360,height:800},timezoneId:'Asia/Seoul',serviceWorkers:'block',reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());
 await page.clock.setFixedTime(new Date('2026-11-26T14:10:00+09:00'));
 await page.addInitScript(()=>{window.__readGate=new Promise(r=>window.__releaseRead=r)});
 await page.route('**/js/db.js?*',async r=>{
  const res=await r.fetch();let body=await res.text();
  body=body.replace('export const put =','const basePut =').replace('export const all =','const baseAll =');
  body+=`\nexport const all=async()=>{await window.__readGate;return baseAll()};
  export const put=async(...args)=>{if(window.__putGate)await window.__putGate;if(window.__failPut)throw new DOMException('test','QuotaExceededError');return basePut(...args)};
  export const __close=async()=>{(await open()).close()};`;
  await r.fulfill({response:res,body});
 });
 await page.route('**/js/app.js?*',async r=>{
  const res=await r.fetch();await r.fulfill({response:res,body:await res.text()+`\nwindow.qa={state,settings,db,startEdit,quickSave,editorDone,editorSave,closeEditor,checkForUpdate,tick,showView,setFilter,createBackup,readBackup,renderAll,loadRecords,restoreBackup,get ed(){return ed},get active(){return activeWork},get pending(){return pendingReload},cancelReload(){pendingReload=false}};`});
 });
 async function check(name,fn){await fn();results.push(name);console.log('PASS',name)}
 await page.goto(base);await page.waitForFunction(()=>window.__tsBooted);
 await check('읽기 전 빈 앨범이 깜빡이지 않음',async()=>{
  assert.equal(await page.locator('#album-intro').isHidden(),true);
  assert.equal(await page.locator('#boot-status').isVisible(),true);
  await page.evaluate(()=>window.__releaseRead());await page.waitForFunction(()=>qa.state.loaded);
  assert.equal(await page.locator('#album-intro').isVisible(),true);
 });
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=4032;c.height=3024;const x=c.getContext('2d');
  x.fillStyle='#f5e5c6';x.fillRect(0,0,c.width,c.height);x.fillStyle='#ef8460';x.beginPath();x.arc(2000,1500,800,0,Math.PI*2);x.fill();
  x.font='180px sans-serif';x.fillStyle='#173d59';x.fillText('TimeStamp 사진 테스트',350,1500);
  window.photo=new File([await new Promise(r=>c.toBlob(r,'image/jpeg',.95))],'photo.jpg',{type:'image/jpeg',lastModified:Date.now()});
 });
 await check('편집 미리보기 축소 및 대기 중 재압축 없음',async()=>{
  await page.evaluate(()=>qa.startEdit(photo));
  assert.equal(await page.evaluate(()=>qa.ed.file===null),true);
  assert.ok(await page.evaluate(()=>qa.ed.base.width*qa.ed.base.height<1500000));
 });
 await check('저장 실패 시 편집 사진 유지, 재시도 성공',async()=>{
  await page.evaluate(async()=>{window.__failPut=true;await qa.editorDone()});
  assert.equal(await page.locator('#editor').isVisible(),true);
  assert.equal(await page.evaluate(()=>qa.state.records.length),0);
  assert.ok(await page.evaluate(()=>qa.ed.ready&&qa.ed.source&&qa.ed.file&&!qa.ed.busy));
  await page.evaluate(async()=>{window.__failPut=false;await qa.editorDone()});
  assert.equal(await page.locator('#editor').isHidden(),true);
  assert.equal(await page.evaluate(()=>qa.state.records.length),1);
  assert.equal(await page.evaluate(()=>qa.state.records[0].width),1440);
 });
 await check('닫힌 IndexedDB 연결 자동 복구',async()=>{
  assert.equal(await page.evaluate(async()=>{await qa.db.__close();return(await qa.db.all()).length}),1);
 });
 await check('사진 교체 트랜잭션 중단 시 기존 사진 유지',async()=>{
  const result=await page.evaluate(async()=>{
   const old=(await qa.db.all())[0],put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(r){const req=put.call(this,r);if(r.id==='aborted-new')req.addEventListener('success',()=>this.transaction.abort());return req};
   let failed=false;try{await qa.db.put({...old,id:'aborted-new'},old.id)}catch{failed=true}finally{IDBObjectStore.prototype.put=put}
   const list=await qa.db.all();return{failed,old:list.some(r=>r.id===old.id),new:list.some(r=>r.id==='aborted-new')};
  });assert.deepEqual(result,{failed:true,old:true,new:false});
 });
 await check('즉시 저장 중복 안내 유지, 다른 끼니 저장 후 필터 통일',async()=>{
  await page.evaluate(()=>qa.quickSave(photo));
  assert.equal(await page.locator('#toast').isHidden(),true);
  assert.match(await page.locator('#ed-feedback-title').textContent(),/점심 사진이 있어요/);
  assert.equal(await page.locator('#ed-done-label').textContent(),'사진 교체');
  await page.evaluate(async()=>{qa.setFilter('breakfast');qa.ed.meal='snack';qa.ed.mealAuto=false;await qa.editorDone()});
  assert.equal(await page.evaluate(()=>qa.state.filter),'all');
  assert.equal(await page.locator('.tile[data-id]').count(),2);
 });
 await check('오늘 아직 열리지 않은 저녁 저장 차단',async()=>{
  await page.evaluate(async()=>{await qa.startEdit(photo);qa.ed.meal='dinner';await qa.editorDone()});
  assert.match(await page.locator('#ed-feedback-title').textContent(),/오후 3시/);
  assert.equal(await page.locator('#editor').isVisible(),true);
  await page.evaluate(()=>qa.closeEditor());
 });
 await check('공유 연타 한 번만 실행, 취소해도 편집 유지',async()=>{
  await page.evaluate(async()=>{
   await qa.startEdit(photo);qa.ed.meal='snack';window.shares=0;
   navigator.canShare=()=>true;navigator.share=()=>{shares++;return new Promise((r,j)=>window.cancelShare=()=>j(new DOMException('cancel','AbortError')))};
   window.shareJob=qa.editorSave();qa.editorSave();
  });
  await page.waitForFunction(()=>window.shares===1);assert.equal(await page.evaluate(()=>qa.ed.busy),true);
  await page.evaluate(async()=>{cancelShare();await shareJob;delete navigator.share;delete navigator.canShare});
  assert.equal(await page.locator('#editor').isVisible(),true);assert.equal(await page.evaluate(()=>qa.ed.busy),false);
  await page.evaluate(()=>qa.closeEditor());
 });
 await check('즉시 저장 실패 시 교체 대상과 사진을 편집기에 보존',async()=>{
  await page.evaluate(async()=>{__failPut=true;await qa.quickSave(photo,{target:{day:'2026-11-26',meal:'lunch'}})});
  assert.equal(await page.locator('#editor').isVisible(),true);
  assert.ok(await page.evaluate(()=>qa.ed.source&&qa.ed.replaceId&&qa.ed.meal==='lunch'));
  await page.evaluate(async()=>{__failPut=false;await qa.editorDone()});
  assert.equal(await page.evaluate(()=>qa.state.records.length),2);
 });
 await check('다른 날 달력 사진의 조정 시각 안내',async()=>{
  await page.evaluate(()=>qa.quickSave(photo,{target:{day:'2026-11-20',meal:'breakfast'}}));
  assert.match(await page.locator('#toast-text').textContent(),/11월 20일 오전 8:00/);
 });
 await check('백업 바이너리 왕복, 중복·기존 끼니 보존, 손상 거절',async()=>{
  const report=await page.evaluate(async()=>{
   const original=await qa.db.all();const file=await qa.createBackup(original);const restored=await qa.readBackup(file);
   const same=await Promise.all(original.map(async(r,i)=>JSON.stringify([...new Uint8Array(await r.blob.arrayBuffer())])===JSON.stringify([...new Uint8Array(await restored[i].blob.arrayBuffer())])));
   const duplicate=await qa.db.merge(restored);
   const conflict=await qa.db.merge([{...restored.find(r=>r.meal==='lunch'),id:'new-conflict'}]);
   const before=(await qa.db.all()).length;
   const bytes=new Uint8Array(await file.arrayBuffer());bytes[bytes.length-1]^=1;
   let damaged=false;try{await qa.readBackup(new File([bytes],'broken.timestamp'))}catch{damaged=true}
   let truncated=false;try{await qa.readBackup(file.slice(0,file.size-1))}catch{truncated=true}
   // 새 저장소를 흉내 내기 위해 이 테스트 문맥의 기록만 비운다.
   for(const r of original)await qa.db.remove(r.id);
   const emptyRestore=await qa.db.merge(restored);await qa.loadRecords();qa.renderAll();
   return{same:same.every(Boolean),duplicate,conflict,before,damaged,truncated,emptyRestore,count:(await qa.db.all()).length};
  });
  assert.equal(report.same,true);assert.equal(report.duplicate.added,0);assert.equal(report.conflict.added,0);assert.equal(report.damaged,true);assert.equal(report.truncated,true);assert.equal(report.emptyRestore.added,report.before);assert.equal(report.count,report.before);
 });
 await check('복원 중 쓰기 실패 시 전체 복원 취소',async()=>{
  const result=await page.evaluate(async()=>{
   const before=await qa.db.all(),add=IDBObjectStore.prototype.add;
   IDBObjectStore.prototype.add=function(r){const req=add.call(this,r);if(r.id==='restore-fail-b')req.addEventListener('success',()=>this.transaction.abort());return req};
   let failed=false;try{await qa.db.merge(['restore-fail-a','restore-fail-b'].map(id=>({...before[0],id,meal:'snack'})))}catch{failed=true}finally{IDBObjectStore.prototype.add=add}
   const after=await qa.db.all();return{failed,count:after.length,before:before.length,partial:after.some(r=>r.id.startsWith('restore-fail'))};
  });assert.equal(result.failed,true);assert.equal(result.count,result.before);assert.equal(result.partial,false);
 });
 await check('새 버전 확인은 저장이 끝날 때까지 보류',async()=>{
  await page.route('**/index.html?check=*',r=>r.fulfill({status:200,body:'<script src="js/app.js?v=999"></script>'}));
  await page.evaluate(()=>{window.__putGate=new Promise(r=>window.releasePut=r);window.quickJob=qa.quickSave(photo,{target:{day:'2026-11-25',meal:'dinner'}})});
  await page.waitForFunction(()=>qa.active>0);
  await page.evaluate(()=>qa.checkForUpdate());
  assert.equal(await page.evaluate(()=>qa.pending),true);assert.equal(await page.evaluate(()=>qa.active>0),true);
  await page.evaluate(async()=>{qa.cancelReload();releasePut();await quickJob;window.__putGate=null});
  await page.unroute('**/index.html?check=*');
 });
 await check('자정 월 넘김과 하루 규칙 유지',async()=>{
  await page.clock.setFixedTime(new Date('2026-11-30T23:59:00+09:00'));
  await page.evaluate(()=>{qa.state.selectedDay='2026-11-30';qa.state.todayKey='2026-11-30';qa.tick()});
  await page.clock.setFixedTime(new Date('2026-12-01T00:01:00+09:00'));await page.evaluate(()=>qa.tick());
  assert.equal(await page.evaluate(()=>qa.state.month.getMonth()),11);
  assert.equal(await page.evaluate(()=>qa.state.selectedDay),'2026-12-01');
 });
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:results.length,results,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
