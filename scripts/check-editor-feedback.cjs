// 격리된 저장소에서 끼니 선택·교체·안내 위치를 확인한다. 실제 사용자 사진은 사용하지 않는다.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_URL || 'http://127.0.0.1:5173/';
const out=process.env.SCREENSHOT_DIR;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const report=[];
 if(out)fs.mkdirSync(out,{recursive:true});
 for(const [width,height] of [[320,568],[360,800],[402,874]]){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Seoul',deviceScaleFactor:2,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-26T14:10:00+09:00'));
  await page.route('**/js/db.js?*',async r=>{
   const res=await r.fetch();const body=(await res.text()).replace('export const put =','const originalPut =');
   await r.fulfill({response:res,body:body+`\nexport const put=async(...args)=>{if(window.failSave)throw Error('test');if(window.saveGate)await window.saveGate;return originalPut(...args)};`});
  });
  await page.route('**/js/app.js?*',async r=>{
   const res=await r.fetch();await r.fulfill({response:res,body:await res.text()+`\nwindow.qa={state,startEdit,closeEditor,quickSave,editorDone,showToast,hideToast,fillFields,get ed(){return ed}};`});
  });
  await page.goto(base);await page.waitForFunction(()=>window.__tsBooted&&qa.state.loaded);
  await page.evaluate(async()=>{
   document.documentElement.style.setProperty('--st','47px');document.documentElement.style.setProperty('--sb','34px');
   await document.fonts.ready;
   const c=document.createElement('canvas');c.width=c.height=1024;const x=c.getContext('2d');x.fillStyle='#e7eee7';x.fillRect(0,0,1024,1024);
   const im=new Image();im.src='assets/art/meal/odung-lunch.png';await im.decode();x.drawImage(im,160,140,700,700);
   window.photo=new File([await new Promise(r=>c.toBlob(r,'image/jpeg',.9))],'sample.jpg',{type:'image/jpeg',lastModified:Date.now()});
   await qa.startEdit(photo,{camera:true});
  });
  async function capture(name){
   await page.evaluate(()=>{document.querySelector('#ed-hint').classList.add('gone')});
   if(out)await page.screenshot({path:`${out}/${name}-${width}.png`});
   const bounds=await page.evaluate(()=>{
    const feedback=document.querySelector('#ed-feedback'),canvas=document.querySelector('#preview'),panel=document.querySelector('.ed-panel');
    const f=feedback.getBoundingClientRect(),p=canvas.getBoundingClientRect();
    return{overflow:document.documentElement.scrollWidth>innerWidth,overlap:f.top<p.bottom,feedback:f.height,panel:panel.getBoundingClientRect().top,photo:p.height};
   });
   assert.equal(bounds.overflow,false);assert.equal(bounds.overlap,false);
   assert.equal(await page.locator('#toast').isHidden(),true);
   report.push({width,state:name,...bounds});return bounds;
  }
  await capture('empty');
  await page.locator('#ed-done').click();await page.waitForSelector('#editor',{state:'hidden'});
  await page.evaluate(()=>qa.startEdit(photo,{camera:true}));
  const occupied=await capture('occupied');
  assert.equal(await page.locator('#ed-done-label').textContent(),'사진 교체');
  assert.equal(await page.locator('#ed-existing-photo').isVisible(),true);
  assert.match(await page.locator('#ed-feedback-title').textContent(),/점심 사진이 있어요/);
  assert.match(await page.locator('#meal-track').getAttribute('aria-valuetext'),/사진 있음/);
  assert.equal(await page.locator('.has-photo,.mp-fill').count(),0);
  await page.locator('#meal-track').focus();await page.keyboard.press('Home');
  assert.equal(await page.locator('#ed-done-label').textContent(),'완료');
  assert.equal(await page.locator('#ed-existing-photo').isHidden(),true);
  const empty=await capture('switch-empty');
  assert.ok(Math.abs(occupied.photo-empty.photo)<1,'선택 변경으로 사진 크기가 변하지 않음');
  assert.ok(Math.abs(occupied.panel-empty.panel)<1,'선택 변경으로 조작부가 움직이지 않음');
  await page.keyboard.press('ArrowRight');
  page.once('dialog',d=>d.dismiss());await page.locator('#ed-done').click();
  assert.equal(await page.evaluate(()=>qa.state.records.length),1);
  await capture('cancel-replace');
  assert.match(await page.locator('#ed-feedback-title').textContent(),/점심 사진이 있어요/);
  // 날짜를 바꾸면 그날의 저장 상태와 버튼 문구도 함께 바뀐다.
  await page.locator('#ed-time').fill('2026-11-25T12:00');await page.locator('#ed-time').dispatchEvent('change');
  assert.equal(await page.locator('#ed-done-label').textContent(),'완료');
  assert.equal(await page.locator('#ed-existing-photo').isHidden(),true);
  await page.locator('#ed-time').fill('2026-11-26T12:00');await page.locator('#ed-time').dispatchEvent('change');
  assert.equal(await page.locator('#ed-done-label').textContent(),'사진 교체');
  await page.evaluate(()=>window.failSave=true);
  page.once('dialog',d=>d.accept());await page.locator('#ed-done').click();
  await page.waitForFunction(()=>!qa.ed.busy);
  assert.equal(await page.locator('#ed-feedback').getAttribute('data-tone'),'error');
  assert.equal(await page.evaluate(()=>qa.state.records.length),1);
  await capture('save-error');
  // 저장 안내가 떠도 사진·버튼을 덮지 않고, 안내 자체는 inert 영역 밖에 있다.
  await page.evaluate(()=>{failSave=false;window.saveGate=new Promise(r=>window.releaseSave=r);window.saveJob=qa.editorDone()});
  await page.waitForFunction(()=>qa.ed.busy);
  assert.equal(await page.locator('#ed-done').isDisabled(),true);
  assert.equal(await page.locator('#ed-feedback').evaluate(e=>Boolean(e.closest('[inert]'))),false);
  await capture('saving');
  await page.evaluate(async()=>{releaseSave();await saveJob;saveGate=null});
  assert.equal(await page.locator('#editor').isHidden(),true);
  assert.equal(await page.evaluate(()=>qa.state.records.length),1);
  // 다시 열었을 때 이전 편집의 오류가 남지 않는다.
  await page.evaluate(()=>qa.startEdit(photo,{camera:true}));
  assert.equal(await page.locator('#ed-feedback').getAttribute('data-tone'),'info');
  assert.match(await page.locator('#ed-feedback-title').textContent(),/점심 사진이 있어요/);
  await page.evaluate(()=>{qa.showToast('촬영 시각을 확인해 주세요',{detail:'사진에 시각이 없어 지금 시각을 넣었어요',stay:true})});
  await capture('time-note');
  assert.deepEqual(errors,[]);
  await context.close();
 }
 if(out)fs.writeFileSync(`${out}/verification.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.length,report},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
