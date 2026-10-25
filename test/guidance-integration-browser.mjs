// Actual Chromium interactions + isolated HTTP/SQLite. Speech synthesis callbacks are explicit mocks.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const dir=await mkdtemp(join(tmpdir(),'homecare-guidance-flow-'));
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:dir,AUTH_MODE:'demo',NODE_ENV:'test',VISION_ENABLED:'false',HOMECARE_VISION_API_KEY:'',OPENAI_API_KEY:'',STAFF_ACCESS_JSON:''},stdio:['ignore','ignore','pipe']});
let output='',browser;const results=[],errors=[];child.stderr.on('data',chunk=>output+=chunk);
let debugPage;
async function check(name,fn){try{await fn();}catch(error){console.error("FAILED",name,await debugPage?.evaluate(()=>({daily:document.querySelector("#daily-dialog")?.innerText,error:document.querySelector("#daily-error")?.textContent,save:document.querySelector("#daily-submit")?.disabled})));throw error;}results.push({name,passed:true});console.log('PASS '+name);}
async function ready(page){await page.locator('#app-content:not([hidden])').waitFor();}
async function patientReady(page,id){await page.goto(base+'/patient?patientId='+id);await ready(page);await page.waitForFunction(()=>!document.querySelector('#patient-select').disabled);await page.waitForFunction(()=>!document.querySelector('#patient-voice-enabled').disabled);}
async function api(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{const{sessionHeaders}=await import('/session.js');const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...sessionHeaders()},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};},{path,method,body});}
async function save(page){const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/clinician/voice-guidance');await page.locator('#guidance-save').click();const result=await response;assert.equal(result.status(),200,await result.text());await page.waitForFunction(()=>!document.querySelector('#guidance-scope').disabled);}
async function ruleField(page,id,name){const rule=page.locator(`[data-rule-id="${id}"]`);if(!await rule.evaluate(el=>el.open))await rule.locator('summary').click();return rule.locator(`[data-rule-field="${name}"]`);}
async function dismiss(page,id){await page.locator(`#${id} .close-dialog`).click();await page.locator('#'+id).waitFor({state:'hidden'});}
function mockSpeech(){window.__spoken=[];window.__cancelled=0;window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'ko-KR',name:'MOCK 한국어',default:true}],addEventListener(){},cancel(){window.__cancelled++;},speak(utterance){window.__spoken.push(utterance.text);window.__lastSpeech=utterance;queueMicrotask(()=>utterance.onstart?.());setTimeout(()=>utterance.onend?.(),40);}}});}
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(i===99)throw Error(output);await delay(50);}
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(mockSpeech);
  const clinician=await context.newPage();clinician.setDefaultTimeout(15000);clinician.on('pageerror',error=>errors.push(error.message));
  await clinician.goto(base+'/clinician?view=voice-guidance&patientId=p001');await ready(clinician);await clinician.locator('#guidance-save').waitFor();
  const created=await api(clinician,'/api/patients','POST',{name:'[합성 검증] 자동 안내 환자',age:83,sex:'female',conditions:[]});assert.equal(created.status,201);const id=created.body.patient.id;
  await clinician.goto(base+'/clinician?view=voice-guidance&patientId='+id);await ready(clinician);await clinician.locator('#guidance-save').waitFor();
  const patient=await context.newPage();debugPage=patient;patient.setDefaultTimeout(15000);await patient.setViewportSize({width:390,height:844});patient.on('pageerror',error=>errors.push(error.message));

  await check('clinician edits global short prompt/rate and real patient receives it once across reload',async()=>{
    assert.equal(await clinician.locator('#guidance-rule-count').innerText(),'11 / 40개');
    await(await ruleField(clinician,'meal-photo','text')).fill('[합성 확인] 음식 전체가 보이도록 찍어 주세요.');
    await clinician.locator('#guidance-rate').selectOption('1.15');await save(clinician);
    const stored=await api(clinician,'/api/clinician/voice-guidance');assert.equal(stored.body.configuration.rate,1.15);assert.match(stored.body.configuration.rules.find(r=>r.id==='meal-photo').text,/합성 확인/);
    await patientReady(patient,id);await patient.locator('#open-meal').click();await patient.waitForFunction(()=>window.__spoken.some(text=>text.includes('[합성 확인]')));
    await dismiss(patient,'meal-dialog');await patient.reload();await ready(patient);await patient.waitForFunction(()=>!document.querySelector('#patient-select').disabled);await patient.locator('#open-meal').click();await patient.waitForTimeout(200);assert.equal(await patient.evaluate(()=>window.__spoken.filter(text=>text.includes('[합성 확인]')).length),0);await dismiss(patient,'meal-dialog');
    assert.equal(await patient.locator('#voice-guide-start,#voice-guide-full,#patient-voice-preview,#patient-voice-choice,#patient-voice-rate').count(),0);
  });

  await check('patient override is isolated and detailed thresholds survive reload',async()=>{
    await clinician.locator('#guidance-scope').selectOption('patient');await clinician.locator('#guidance-inherit').waitFor();
    await(await ruleField(clinician,'steps','text')).fill('[합성 개별] 걸음 수를 확인해 주세요.');await(await ruleField(clinician,'steps-check','minValue')).fill('200');await save(clinician);
    await clinician.reload();await ready(clinician);await clinician.locator('#guidance-scope').selectOption('patient');await clinician.locator('#guidance-inherit').waitFor();
    assert.equal(await(await ruleField(clinician,'steps-check','minValue')).inputValue(),'200');
    const global=await api(clinician,'/api/clinician/voice-guidance');const selected=await api(clinician,'/api/clinician/voice-guidance?patientId='+id);const other=await api(clinician,'/api/clinician/voice-guidance?patientId=p002');
    assert.equal(global.body.configuration.rules.find(r=>r.id==='steps-check').minValue,100);assert.equal(selected.body.configuration.rules.find(r=>r.id==='steps-check').minValue,200);assert.equal(other.body.inherited,true);assert.equal(other.body.configuration.rules.find(r=>r.id==='steps-check').minValue,100);
    await patientReady(patient,id);await patient.locator('#today-metrics [data-action=steps]').click();await patient.locator('#daily-submit:not([disabled])').waitFor();await patient.waitForFunction(()=>window.__spoken.some(text=>text.includes('[합성 개별]')));await dismiss(patient,'daily-dialog');
  });

  await check('dirty navigation cancel, conflict and lost save response preserve editable draft and idempotency',async()=>{
    await(await ruleField(clinician,'steps','text')).fill('[합성 보존] 저장 전 원고');clinician.once('dialog',dialog=>dialog.dismiss());await clinician.locator('#main-nav [data-view=records]').click();assert.equal(new URL(clinician.url()).searchParams.get('view'),'voice-guidance');assert.equal(await(await ruleField(clinician,'steps','text')).inputValue(),'[합성 보존] 저장 전 원고');
    const current=await api(clinician,'/api/clinician/voice-guidance?patientId='+id);const updated=structuredClone(current.body.configuration);updated.rate=.85;
    assert.equal((await api(clinician,'/api/clinician/voice-guidance?patientId='+id,'PUT',{revision:current.body.revision,clientRequestId:crypto.randomUUID(),configuration:updated})).status,200);
    const conflict=clinician.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/api/clinician/voice-guidance'));await clinician.locator('#guidance-save').click();assert.equal((await conflict).status(),409);await clinician.locator('#guidance-error:not([hidden])').waitFor();assert.equal(await(await ruleField(clinician,'steps','text')).inputValue(),'[합성 보존] 저장 전 원고');
    clinician.once('dialog',dialog=>dialog.accept());await clinician.locator('#guidance-refresh').click();await clinician.waitForFunction(()=>!document.querySelector('#guidance-scope').disabled);
    await(await ruleField(clinician,'steps','text')).fill('[합성 재시도] 입력 수치를 확인해 주세요.');let lose=true;const bodies=[];
    await clinician.route('**/api/clinician/voice-guidance?patientId='+id,async route=>{if(route.request().method()!=='PUT')return route.continue();bodies.push(route.request().postDataJSON());if(lose){lose=false;const response=await route.fetch();assert.equal(response.status(),200);return route.abort('failed');}return route.continue();});
    await clinician.locator('#guidance-save').click();await clinician.locator('#guidance-error:not([hidden])').waitFor();assert.equal(await(await ruleField(clinician,'steps','text')).inputValue(),'[합성 재시도] 입력 수치를 확인해 주세요.');await save(clinician);await clinician.unroute('**/api/clinician/voice-guidance?patientId='+id);assert.equal(bodies.length,2);assert.deepEqual(bodies[1],bodies[0]);
    const after=await api(clinician,'/api/clinician/voice-guidance?patientId='+id);assert.equal(after.body.revision,current.body.revision+2);
  });

  await check('low steps require direct confirmation, changed values invalidate it, saved data reaches clinician',async()=>{
    await patientReady(patient,id);await patient.locator('#today-metrics [data-action=steps]').click();await patient.locator('#daily-submit:not([disabled])').waitFor();await patient.locator('#daily-steps').fill('10');await patient.locator('#daily-submit').click();await patient.locator('[data-value-confirmation=steps]').waitFor();assert.equal((await api(clinician,`/api/patients/${id}/daily`)).body.record,null);
    await patient.locator('[data-value-confirmation=steps] [data-value-confirm]').click();await patient.locator('#daily-steps').fill('11');await patient.locator('#daily-submit').click();assert.equal(await patient.locator('#daily-dialog').isVisible(),true);assert.match(await patient.locator('[data-value-confirmation=steps]').innerText(),/11걸음/);
    await patient.locator('[data-value-confirmation=steps] [data-value-correct]').click();assert.equal(await patient.locator('#daily-steps').evaluate(el=>el===document.activeElement),true);await patient.locator('#daily-steps').fill('10');await patient.locator('#daily-steps').blur();await patient.locator('[data-value-confirmation=steps] [data-value-confirm]').click();
    const oldConfig=await api(clinician,'/api/clinician/voice-guidance?patientId='+id);oldConfig.body.configuration.rules.find(rule=>rule.id==='steps-check').text='[합성 재확인] {value}{unit}이 맞는지 확인해 주세요.';
    assert.equal((await api(clinician,'/api/clinician/voice-guidance?patientId='+id,'PUT',{revision:oldConfig.body.revision,clientRequestId:crypto.randomUUID(),configuration:oldConfig.body.configuration})).status,200);
    await patient.locator('#daily-submit').click();await patient.locator('[data-value-confirmation=steps] [data-value-confirm]').waitFor();assert.equal(await patient.locator('#daily-steps').inputValue(),'10');assert.equal((await api(clinician,`/api/patients/${id}/daily`)).body.record,null);
    await patient.locator('[data-value-confirmation=steps] [data-value-confirm]').click();await patient.locator('#daily-submit').click();await patient.locator('#daily-dialog').waitFor({state:'hidden'});
    assert.equal((await api(clinician,`/api/patients/${id}/daily`)).body.record.steps,10);await clinician.locator('#main-nav [data-view=records]').click();await clinician.waitForFunction(()=>document.querySelector('#app-content').textContent.includes('10'));assert.match(await clinician.locator('#app-content').innerText(),/10/);
  });

  await check('voice off persists across reload; ten-minute sleep helper still requires visible confirmation',async()=>{
    await patient.locator('.bottom-nav [data-view=guide]').click();const pref=patient.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/voice-guidance/preference'));await patient.locator('#patient-voice-enabled').uncheck();assert.equal((await pref).status(),200);await patientReady(patient,id);await patient.locator('.bottom-nav [data-view=guide]').click();assert.equal(await patient.locator('#patient-voice-enabled').isChecked(),false);await patient.locator('#patient-view-close').click();
    await patient.locator('#today-metrics [data-action=sleep]').click();await patient.locator('#daily-submit:not([disabled])').waitFor();await patient.locator('#sleep-helper-minutes').locator('xpath=ancestor::details').locator('summary').click();await patient.locator('#sleep-helper-minutes').fill('10');await patient.locator('#sleep-helper-apply').click();assert.equal(await patient.locator('#daily-sleep').inputValue(),'0.2');await patient.locator('[data-value-confirmation=sleepHours]').waitFor();assert.match(await patient.locator('[data-value-confirmation=sleepHours]').innerText(),/0.2시간/);await patient.locator('#daily-submit').click();assert.equal(await patient.locator('#daily-dialog').isVisible(),true);await patient.locator('[data-value-confirmation=sleepHours] [data-value-confirm]').click();await patient.locator('#daily-submit').click();await patient.locator('#daily-dialog').waitFor({state:'hidden'});assert.equal((await api(clinician,`/api/patients/${id}/daily`)).body.record.sleepHours,.2);assert.equal(await patient.evaluate(()=>window.__spoken.length),0);
  });

  await check('settings lookup failure keeps the entered value and retry saves only after fresh confirmation',async()=>{
    await patient.locator('#today-metrics [data-action=steps]').click();await patient.locator('#daily-submit:not([disabled])').waitFor();await patient.locator('#daily-steps').fill('12');
    await patient.route('**/api/patients/'+id+'/voice-guidance',route=>route.abort('failed'));await patient.locator('#daily-submit').click();await patient.locator('#daily-error:not([hidden])').waitFor();assert.match(await patient.locator('#daily-error').innerText(),/설정.*불러오지/);assert.equal(await patient.locator('#daily-steps').inputValue(),'12');assert.equal((await api(clinician,`/api/patients/${id}/daily`)).body.record.steps,10);
    await patient.unroute('**/api/patients/'+id+'/voice-guidance');await patient.locator('#daily-submit').click();await patient.locator('[data-value-confirmation=steps] [data-value-confirm]').waitFor();await patient.locator('[data-value-confirmation=steps] [data-value-confirm]').click();await patient.locator('#daily-submit').click();await patient.locator('#daily-dialog').waitFor({state:'hidden'});assert.equal((await api(clinician,`/api/patients/${id}/daily`)).body.record.steps,12);
  });

  await check('explicit inheritance restore and add/cancel retain global defaults; narrow patient view fits',async()=>{
    await clinician.locator('#main-nav [data-view=voice-guidance]').click();await clinician.locator('#guidance-scope').selectOption('patient');await clinician.locator('#guidance-inherit').waitFor();clinician.once('dialog',dialog=>dialog.accept());await clinician.locator('#guidance-inherit').click();await clinician.waitForFunction(()=>document.querySelector('#guidance-scope-description').textContent.includes('현재 공통 설정'));
    assert.equal((await api(clinician,'/api/clinician/voice-guidance?patientId='+id)).body.inherited,true);
    await clinician.locator('#guidance-add').click();assert.equal(await clinician.locator('[data-rule-id]').count(),12);clinician.once('dialog',dialog=>dialog.accept());await clinician.locator('#guidance-cancel').click();assert.equal(await clinician.locator('[data-rule-id]').count(),11);
    await patient.setViewportSize({width:320,height:844});await patient.locator('.bottom-nav [data-view=guide]').click();await patient.locator('#patient-large-text').click();assert.equal(await patient.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await patient.locator('#patient-view-close').click();await patient.locator('#today-metrics [data-action=steps]').click();await patient.locator('#daily-submit:not([disabled])').waitFor();await patient.locator('#daily-steps').fill('11');await patient.locator('#daily-steps').blur();await patient.locator('[data-value-confirmation=steps]').waitFor();assert.equal(await patient.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mkdir('test-results/voice-guidance',{recursive:true});await patient.screenshot({path:'test-results/voice-guidance/confirmation-320.png',fullPage:true});await clinician.screenshot({path:'test-results/voice-guidance/clinician-settings.png',fullPage:true});
  });
  await check('all patient entry menus and direct medication URL emit their configured event; late cancelled claims cannot speak',async()=>{
    const created=await api(clinician,'/api/patients','POST',{name:'[합성 검증] 전체 메뉴 안내',age:82,sex:'female',conditions:[]});assert.equal(created.status,201);const menuId=created.body.patient.id;
    const labels={meal_open:'식사',medication_open:'복약',medication_photo_open:'약 사진',daily_open:'전체 건강',steps_open:'걸음',sleep_open:'수면'};
    const configuration=(await api(clinician,'/api/clinician/voice-guidance')).body.configuration;
    configuration.enabled=true;configuration.rate=1;configuration.rules=configuration.rules.filter(rule=>Object.hasOwn(labels,rule.trigger)).map(rule=>({...rule,text:`[합성 메뉴] ${labels[rule.trigger]} 안내입니다.`,frequency:'entry',maxPerDay:10,cooldownMinutes:0,condition:'always',startTime:'00:00',endTime:'24:00'}));
    assert.equal((await api(clinician,'/api/clinician/voice-guidance?patientId='+menuId,'PUT',{revision:0,clientRequestId:crypto.randomUUID(),configuration})).status,200);
    const health=await(await fetch(base+'/api/health')).json();assert.equal((await api(clinician,`/api/patients/${menuId}/medication-orders`,'POST',{name:'[합성 검증] 안내 확인 약',dose:'1정',times:['08:00'],startDate:health.today})).status,201);
    const menus=await context.newPage();debugPage=menus;menus.setDefaultTimeout(15000);await menus.setViewportSize({width:390,height:844});menus.on('pageerror',error=>errors.push(error.message));const claims=[];
    menus.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/voice-guidance/claims'))claims.push(request.postDataJSON());});
    async function trigger(event,action){
      const text=`[합성 메뉴] ${labels[event]} 안내입니다.`,before=await menus.evaluate(text=>(window.__spoken||[]).filter(item=>item===text).length,text);
      const response=menus.waitForResponse(result=>result.request().method()==='POST'&&result.url().endsWith('/voice-guidance/claims')&&result.request().postDataJSON().event===event);
      const [result]=await Promise.all([response,action()]);assert.equal(result.status(),200);assert.equal((await result.json()).allowed,true,event);
      await menus.waitForFunction(({text,before})=>window.__spoken.filter(item=>item===text).length===before+1,{text,before});
    }
    await trigger('medication_open',async()=>{await menus.goto(base+`/patient?patientId=${menuId}&view=medication`);await ready(menus);await menus.locator('#medication-slot-0').waitFor();});
    await menus.locator('#patient-view-close').click();
    await trigger('meal_open',()=>menus.locator('#open-meal').click());await dismiss(menus,'meal-dialog');
    await trigger('meal_open',()=>menus.locator('#open-meal').click());await dismiss(menus,'meal-dialog');
    await trigger('daily_open',()=>menus.locator('#open-daily').click());await dismiss(menus,'daily-dialog');
    await trigger('steps_open',()=>menus.locator('#today-metrics [data-action=steps]').click());await dismiss(menus,'daily-dialog');
    await trigger('sleep_open',()=>menus.locator('#today-metrics [data-action=sleep]').click());await dismiss(menus,'daily-dialog');
    await trigger('medication_open',()=>menus.locator('#open-medication').click());
    await trigger('medication_photo_open',()=>menus.locator('#open-medication-photo').click());await dismiss(menus,'medication-photo-dialog');await menus.locator('#patient-view-close').click();
    const mealClaims=claims.filter(claim=>claim.event==='meal_open');assert.equal(mealClaims.length,2);assert.notEqual(mealClaims[0].contextId,mealClaims[1].contextId);assert.equal(mealClaims[0].ruleId,mealClaims[1].ruleId);
    assert.deepEqual([...new Set(claims.map(claim=>claim.event))].sort(),Object.keys(labels).sort());
    let release,received;const held=new Promise(resolve=>{release=resolve;});const receivedClaim=new Promise(resolve=>{received=resolve;});let intercept=true;
    await menus.route(`**/api/patients/${menuId}/voice-guidance/claims`,async route=>{if(!intercept||route.request().postDataJSON().event!=='meal_open')return route.continue();intercept=false;const response=await route.fetch();assert.equal(response.status(),200);received();await held;await route.fulfill({response});});
    const before=await menus.evaluate(()=>window.__spoken.length);await menus.locator('#open-meal').click();await receivedClaim;await dismiss(menus,'meal-dialog');
    const released=menus.waitForResponse(result=>result.request().method()==='POST'&&result.url().includes('/voice-guidance/receipts/')&&result.request().postDataJSON().outcome==='released');release();assert.equal((await released).status(),200);assert.equal(await menus.evaluate(()=>window.__spoken.length),before);
    await menus.unroute(`**/api/patients/${menuId}/voice-guidance/claims`);await trigger('meal_open',()=>menus.locator('#open-meal').click());await dismiss(menus,'meal-dialog');
    assert.equal(new Set(claims.filter(claim=>claim.event==='meal_open').map(claim=>claim.contextId)).size,4);await menus.close();debugPage=patient;
  });
  assert.deepEqual(errors,[]);await writeFile('test-results/voice-guidance/integration.json',JSON.stringify({environment:'real Chromium UI and isolated synthetic DB; MOCK synthesis',results,errors,physicalMicrophoneVerified:false,physicalAudioVerified:false},null,2));console.log(`${results.length} contextual voice-guidance end-to-end flows passed.`);
}finally{await browser?.close();child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
