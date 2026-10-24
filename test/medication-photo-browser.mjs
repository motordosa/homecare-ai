// Isolated temporary SQLite + mocked OpenAI transport. No public DB or real key.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const base=`http://127.0.0.1:${port}`,dir=await mkdtemp(join(tmpdir(),'hc-med-photo-browser-'));
let output='',browser;const errors=[];
const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--import','./test/helpers/medication-vision-fixture.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',AUTH_MODE:'demo',APP_ORIGIN:'',VISION_ENABLED:'true',HOMECARE_VISION_API_KEY:'test-only-not-real',PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=','base64');
const write=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status} ${await r.clone().text()}`);return r.json();};
const get=async path=>(await fetch(base+path)).json();
async function until(action){for(let i=0;i<80;i++){if(await action())return;await delay(50);}throw Error('Condition timed out');}
async function revealField(page,selector){const disclosure=page.locator(selector).locator('xpath=ancestor::details[1]');if(await disclosure.count()&&!await disclosure.evaluate(element=>element.open))await disclosure.locator(':scope > summary').click();}
try {
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}});
 const date=(await get('/api/health')).today;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/patient?patientId=p001&view=medication');await page.locator('#legacy-medication:not([hidden])').waitFor();assert.equal(await page.locator('#open-medication-photo').isDisabled(),true);
 const {order}=await write('/api/patients/p001/medication-orders',{name:'가상약A',strength:'5 mg',dose:'1정',times:['08:00','20:00'],startDate:date});
 await page.locator('[data-action=refresh-medication]').click();await page.locator('#medication-slot-1').waitFor();await until(async()=>!(await page.locator('#patient-select').isDisabled()));
 await page.locator('#open-medication-photo').click();await page.locator('#medication-photo-dialog[open]').waitFor();await page.locator('#medication-photo-dialog .close-dialog').click();await page.locator('#medication-photo-dialog').waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.get('view'),'medication');assert.equal(await page.evaluate(()=>document.activeElement.id),'open-medication-photo');
 await page.locator('#open-medication-photo').click();await page.locator('#med-photo-consent').check();page.once('dialog',d=>d.dismiss());await page.locator('#medication-photo-dialog .close-dialog').click();assert.equal(await page.locator('#medication-photo-dialog').isVisible(),true);page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await page.locator('#medication-photo-dialog').waitFor({state:'hidden'});
 console.log('PASS empty plan, shared X/opener focus, dirty dismissal and Escape');
 async function analyze(){
  await page.locator('#open-medication-photo').click();await page.locator('#med-photo-file').setInputFiles({name:'mock-package.png',mimeType:'image/png',buffer:png});await page.locator('#med-photo-preview:not([hidden])').waitFor();assert.equal(await page.locator('#med-photo-analyze').isDisabled(),true);
  await page.locator('#med-photo-package').check();await page.locator('#med-photo-consent').check();await page.locator('#med-photo-analyze').click();await page.locator('#med-photo-review:not([hidden])').waitFor();
 }
 await analyze();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/medication-photo-patient-review.png',fullPage:true});assert.ok((await page.locator('#med-photo-review').innerText()).includes('이름·함량 문자열 일치 후보'));assert.equal(await page.locator('#med-photo-review script,#med-photo-review img').count(),0);assert.equal(await page.evaluate(()=>window.xss),undefined);assert.equal(await page.locator('[data-slot-select]:checked').count(),0);
 for(const index of [0,1]){await page.locator(`[data-slot-select="${index}"]`).check();await page.locator(`#med-photo-status-${index}`).selectOption(index?'unknown':'taken');}
 await revealField(page,'#med-photo-note-0');await page.locator('#med-photo-note-0').fill('사진으로 보고한 데모');await page.locator('#med-photo-confirm').check();
 let lose=true,release,started;let gate=new Promise(r=>release=r),waiting=new Promise(r=>started=r);
 await page.route('**/medication-photo-reports',async route=>{
  if(route.request().method()==='POST'&&lose){lose=false;const response=await route.fetch();assert.equal(response.status(),201);started();await gate;await route.abort('failed');}else await route.continue();
 });
 await page.locator('#med-photo-save').click();await waiting;assert.equal(await page.locator('#medication-photo-dialog .close-dialog').isDisabled(),true);assert.equal(await page.locator('.bottom-nav button:disabled').count(),6);await page.keyboard.press('Escape');assert.equal(await page.locator('#medication-photo-dialog').isVisible(),true);release();
 await page.locator('#med-photo-error:not([hidden])').waitFor();assert.equal(await page.locator('#med-photo-note-0').inputValue(),'사진으로 보고한 데모');await page.locator('#med-photo-save').click();await page.locator('#medication-photo-dialog').waitFor({state:'hidden'});await page.locator('#medication-photo-history details').waitFor();
 const reports=await get(`/api/patients/p001/medication-photo-reports?date=${date}`);assert.equal(reports.reports.length,1);assert.equal(reports.reports[0].events.length,2);const report=reports.reports[0];
 const image=await fetch(base+report.imageUrl);assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 assert.equal((await fetch(base+report.imageUrl.replace('p001','p002'))).status,404);
 console.log('PASS real server OCR draft → multiple events/photo, busy lock, lost response replay');
 await until(async()=>!(await page.locator('#patient-select').isDisabled()));await analyze();await page.locator('[data-slot-select="0"]').check();await page.locator('#med-photo-status-0').selectOption('taken');await page.locator('#med-photo-confirm').check();
 await write('/api/patients/p001/medication-events',{orderId:order.id,date,time:'08:00',status:'missed',note:'동시 수정'});
 await page.locator('#med-photo-save').click();await page.locator('#med-photo-error:not([hidden])').waitFor();assert.ok((await page.locator('#med-photo-error').innerText()).includes('다른 창'));assert.equal(await page.locator('[data-slot-select="0"]').isChecked(),true);
 page.once('dialog',d=>d.accept());await page.locator('#medication-photo-dialog .close-dialog').click();
 await page.locator('[data-action=refresh-medication]').click();await until(async()=>!(await page.locator('#open-medication-photo').isDisabled()));
 // Late analysis may not repopulate a dialog after close or another patient opens.
 let releaseAnalysis,startAnalysis;const analyzeGate=new Promise(r=>releaseAnalysis=r),analysisWaiting=new Promise(r=>startAnalysis=r);
 await page.route('**/photo-analyses',async route=>{const response=await route.fetch();startAnalysis();await analyzeGate;await route.fulfill({response});});
 await page.locator('#open-medication-photo').click();await page.locator('#med-photo-file').setInputFiles({name:'mock-package.png',mimeType:'image/png',buffer:png});await page.locator('#med-photo-preview:not([hidden])').waitFor();await page.locator('#med-photo-package').check();await page.locator('#med-photo-consent').check();await page.locator('#med-photo-analyze').click();await analysisWaiting;
 page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');releaseAnalysis();await delay(150);assert.equal(await page.locator('#med-photo-review').innerHTML(),'');await page.unroute('**/photo-analyses');
 console.log('PASS conflict preserves input, late analysis invalidation, owned image response');
 const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),clinician=await desktop.newPage();clinician.on('pageerror',e=>errors.push(e.message));
 await clinician.goto(base+`/clinician?view=medications&patientId=p001&medicationDate=${date}`);await clinician.locator('.medication-photo-report').waitFor();await clinician.locator('.medication-photo-report summary').click();
 const text=await clinician.locator('.medication-photo-report').innerText();assert.ok(text.includes('복용 보고'));assert.ok(text.includes('당시 보고 1차'));assert.ok(text.includes('의료진 미검토'));assert.equal(await clinician.locator('.medication-photo-report script').count(),0);assert.equal(await clinician.evaluate(()=>window.xss),undefined);
 await until(async()=>clinician.locator('.medication-photo-report img').evaluate(img=>img.complete&&img.naturalWidth>0));
 await mkdir('test-results',{recursive:true});await clinician.screenshot({path:'test-results/medication-photo-clinician.png',fullPage:true});
 await page.locator('#open-medication-photo').click();for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const bounds=await page.locator('#medication-photo-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);const close=await page.locator('#medication-photo-dialog .close-dialog').boundingBox();assert.ok(close.width>=48&&close.height>=48);assert.ok(close.x>=0&&close.x+close.width<=width);}
 await page.screenshot({path:'test-results/medication-photo-patient.png',fullPage:true});await page.locator('#medication-photo-dialog .close-dialog').click();
 assert.deepEqual(errors,[]);console.log('PASS clinician evidence/current-vs-snapshot, 320/390px dialog, no page errors');
} catch(error){console.error(output);throw error;}
finally{await browser?.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
