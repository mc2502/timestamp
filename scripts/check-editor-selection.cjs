// 실제 선택 동작에서 기록 표시, 선택 표시, 스탬프 농도와 배치를 확인한다.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.TEST_URL || 'http://127.0.0.1:5173/';
const out=process.env.SCREENSHOT_DIR;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
 if(out)fs.mkdirSync(out,{recursive:true});
 for(const width of [320,360,402]){
  const context=await browser.newContext({viewport:{width,height:874},timezoneId:'Asia/Seoul',deviceScaleFactor:2,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-26T16:10:00+09:00'));
  await page.addInitScript(()=>{window.stampFrames=[]});
  await page.route('**/js/stamp.js?*',async route=>{
   const response=await route.fetch();let body=await response.text();
   body=body.replace('if (pop) {','if (pop) { window.stampFrames.push({style,alpha:pop.alpha});');
   await route.fulfill({response,body});
  });
  await page.route('**/js/app.js?*',async route=>{
   const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nwindow.qa={state,settings,startEdit,fillFields,get ed(){return ed}};`});
  });
  await page.goto(base);await page.waitForFunction(()=>window.__tsBooted&&qa.state.loaded);
  await page.evaluate(async()=>{
   document.documentElement.style.setProperty('--st','47px');document.documentElement.style.setProperty('--sb','34px');
   await document.fonts.ready;
   const c=document.createElement('canvas');c.width=c.height=1024;const x=c.getContext('2d');x.fillStyle='#d8ddd3';x.fillRect(0,0,1024,1024);
   x.fillStyle='#f5efe4';x.beginPath();x.arc(512,512,340,0,Math.PI*2);x.fill();
   const im=new Image();im.src='assets/art/meal/odung-lunch.png';await im.decode();x.drawImage(im,180,140,660,660);
   const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));
   qa.state.records=['breakfast','dinner'].map((meal,i)=>({id:'fixture-'+i,day:'2026-11-26',meal,takenAt:+new Date('2026-11-26T08:00:00+09:00'),blob,thumb:blob}));
   qa.settings.effects=true;await qa.startEdit(new File([blob],'test.jpg',{type:'image/jpeg',lastModified:Date.now()}),{camera:true});
   document.querySelector('#ed-hint').classList.add('gone');
  });
  await page.waitForTimeout(550); // 최초 도장 효과 이후의 선택만 측정
  const colors=()=>page.locator('.mp-records > i').evaluateAll(els=>els.map(e=>getComputedStyle(e).backgroundColor));
  const initial=await colors();
  assert.notEqual(initial[0],'rgba(0, 0, 0, 0)');assert.notEqual(initial[2],'rgba(0, 0, 0, 0)');
  assert.equal(initial[1],'rgba(0, 0, 0, 0)','빈 점심까지 채우지 않음');
  await page.locator('#meal-track').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  assert.deepEqual(await colors(),initial,'선택만 바꿔서는 기록 색이 바뀌지 않음');
  await page.locator('#ed-time').fill('2026-11-25T12:00');await page.locator('#ed-time').dispatchEvent('change');
  assert.ok((await colors()).every(c=>c==='rgba(0, 0, 0, 0)'),'날짜가 다른 기록으로 칠하지 않음');
  await page.locator('#ed-time').fill('2026-11-26T12:00');await page.locator('#ed-time').dispatchEvent('change');
  assert.deepEqual(await colors(),initial);
  // 인접한 기록은 이어지고, 간식/없음은 기록 표시와 교체 동작이 구분된다.
  await page.evaluate(()=>{qa.state.records.push({...qa.state.records[0],id:'fixture-lunch',meal:'lunch'},{...qa.state.records[0],id:'fixture-snack',meal:'snack'},{...qa.state.records[0],id:'fixture-none',meal:null});qa.fillFields()});
  assert.ok((await colors()).every(c=>c!=='rgba(0, 0, 0, 0)'));
  await page.locator('#meal-track').focus();await page.keyboard.press('End');
  assert.equal(await page.locator('#ed-done-label').textContent(),'완료','끼니 없음 기록은 기존 사진을 교체하지 않음');
  assert.match(await page.locator('#meal-track').getAttribute('aria-valuetext'),/사진 있음/);
  await page.evaluate(()=>{qa.state.records=qa.state.records.filter(r=>r.meal==='breakfast'||r.meal==='lunch');qa.fillFields();window.stampFrames=[]});
  await page.locator('#meal-track').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  let firstBounds;
  for(const style of ['odung','perpeng','basic','capsule','meal','big','film','none']){
   const button=page.locator(`[data-style="${style}"]`);await button.click();await page.waitForTimeout(230);
   assert.equal(await page.locator('#style-strip [aria-checked="true"]').count(),1);
   assert.equal(await button.getAttribute('aria-checked'),'true');
   const appearance=await button.evaluate(el=>{
    const box=el.querySelector('.t-box'),css=getComputedStyle(box),panel=document.querySelector('.ed-panel').getBoundingClientRect();
    return{alpha:css.opacity,ring:css.boxShadow,background:css.backgroundColor,transform:getComputedStyle(el).transform,panelY:panel.y,panelHeight:panel.height,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(appearance.alpha,'1');assert.notEqual(appearance.ring,'none');assert.equal(appearance.transform,'none');assert.equal(appearance.overflow,false);
   if(firstBounds){assert.equal(appearance.panelY,firstBounds.panelY);assert.equal(appearance.panelHeight,firstBounds.panelHeight)}else firstBounds=appearance;
   if(out)await page.screenshot({path:`${out}/${style}-${width}.png`});
   report.push({width,style,...appearance});
  }
  assert.ok(await page.evaluate(()=>stampFrames.length>0&&stampFrames.every(f=>f.alpha===1)),'선택 중 도장 농도가 옅어지지 않음');
  // 빠르게 연달아 골라도 마지막 선택만 남고 이전 효과가 다시 덮지 않는다.
  await page.evaluate(()=>{for(const id of ['basic','perpeng','capsule','odung'])document.querySelector(`[data-style="${id}"]`).click()});
  await page.waitForTimeout(550);
  assert.equal(await page.locator('#style-strip [aria-checked="true"]').getAttribute('data-style'),'odung');
  assert.equal(await page.evaluate(()=>qa.ed.style),'odung');
  assert.ok(await page.evaluate(()=>stampFrames.every(f=>f.alpha===1)));
  assert.deepEqual(errors,[]);await context.close();
 }
 if(out)fs.writeFileSync(`${out}/verification.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.length,errors:[]},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
