// Real Chromium DOM + HTTP/SQLite with a focused patient-assist harness.
// SpeechSynthesis callbacks are MOCK; no physical speaker or microphone evidence.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const dir=await mkdtemp(join(tmpdir(),'homecare-speech-reliability-'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'test',AUTH_MODE:'demo',VISION_ENABLED:'false',HOMECARE_VISION_API_KEY:'',OPENAI_API_KEY:'',STAFF_ACCESS_JSON:''},stdio:['ignore','ignore','pipe']});
let browser;const cases=[],errors=[];
function mockSpeech(){
 window.__speechCalls=[];window.__speechCancel=0;window.__speechStart=true;window.__duringGesture=false;document.addEventListener('pointerup',()=>{window.__duringGesture=true;queueMicrotask(()=>window.__duringGesture=false);},true);
 window.__voices=[{lang:'ko-KR',name:'첫 한국어',voiceURI:'first',default:false},{lang:'ko-KR',name:'기기 기본 한국어',voiceURI:'default-ko',default:true},{lang:'en-US',name:'English',voiceURI:'en',default:true}];
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>window.__voices,cancel(){window.__speechCancel++;},speak(u){u.syncGesture=/gesture/.test(new Error().stack);window.__speechCalls.push(u);if(window.__speechStart)queueMicrotask(()=>u.onstart?.());}}});
 window.__finishSpeech=()=>window.__speechCalls.at(-1)?.onend?.();
}
const harness=`<!doctype html><meta charset="utf-8"><div id="voice-guide-controls"><button id="voice-guide-stop">안내 멈추기</button></div><p id="voice-guide-status" role="status"></p><p id="voice-guide-script"></p><input type="checkbox" id="patient-voice-enabled"><p id="patient-voice-preference-status"></p><input type="checkbox" id="patient-reminders-enabled"><button id="patient-task-refresh">다시 확인</button><button id="patient-browser-alerts">브라우저 알림</button><button id="patient-browser-alerts-off">알림 끄기</button><p id="patient-alert-status"></p><p id="patient-task-summary"></p><ul id="patient-task-list"></ul><p id="patient-task-updated"></p><p id="patient-task-error" hidden></p><p id="patient-reminder" hidden></p><button id="ordinary">다음 항목 확인</button><dialog id="test-dialog"><p data-guidance-text></p><p data-guidance-status></p><button data-guidance-stop hidden>안내 멈추기</button></dialog>
<script type="module">
import {bootstrapSession,demoPatient,sessionHeaders} from '/session.js';
import {createPatientAssist} from '/patient-assist.js';
await bootstrapSession('patient');await demoPatient(new URL(location.href).searchParams.get('patientId'));
const patientId=new URL(location.href).searchParams.get('patientId');
const summary=await (await fetch('/api/patients/'+patientId+'/summary',{headers:sessionHeaders()})).json();
const schedule=await (await fetch('/api/patients/'+patientId+'/medication-schedule',{headers:sessionHeaders()})).json();
window.__context={patientId,summary,schedule,view:'home',checkedAt:Date.now(),formKey:'initial'};window.__busy=false;
window.__assist=createPatientAssist({getContext:()=>window.__context,isBusy:()=>window.__busy,refresh:async()=>true,onAction:()=>{}});
await window.__assist.refreshConfiguration();window.__ready=true;
</script>`;
async function createPatient(){const response=await fetch(base+'/api/patients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'[합성검증] 자동음성',age:80,sex:'female',conditions:[]})});assert.equal(response.status,201);return (await response.json()).patient.id;}
async function pageFor(id,{legacyOff=false}={}){const context=await browser.newContext({viewport:{width:390,height:844}});await context.addInitScript(mockSpeech);if(legacyOff)await context.addInitScript(()=>localStorage.setItem('homecarePatientAssist',JSON.stringify({voiceEnabled:false,remindersEnabled:false})));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/voice-harness?*',route=>route.fulfill({contentType:'text/html',body:harness}));await page.goto(base+'/voice-harness?patientId='+id);await page.waitForFunction(()=>window.__ready);return page;}
async function notify(page,event='meal_open',options={}){await page.evaluate(async ({event,options})=>{await window.__assist.notify(event,options);},{event,options});}
async function check(name,fn){await fn();cases.push({name,passed:true,speech:'MOCK'});console.log('PASS '+name);}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
 await check('automatic menu uses default Korean voice/rate and server prevents replay in a new tab',async()=>{
  const id=await createPatient(),page=await pageFor(id);await notify(page);assert.deepEqual(await page.evaluate(()=>({text:window.__speechCalls.at(-1).text,voice:window.__speechCalls.at(-1).voice.voiceURI,rate:window.__speechCalls.at(-1).rate})),{text:'음식 전체가 보이도록 사진을 찍어 주세요.',voice:'default-ko',rate:1});
  await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);await notify(page);assert.equal(await page.evaluate(()=>window.__speechCalls.length),1);
  const other=await pageFor(id);await notify(other);assert.equal(await other.evaluate(()=>window.__speechCalls.length),0);await page.context().close();await other.context().close();
 });
 await check('voice preference persists server-side; patient has no playback controls',async()=>{
  const id=await createPatient(),page=await pageFor(id);await page.locator('#patient-voice-enabled').uncheck();await page.waitForFunction(()=>!document.querySelector('#patient-voice-enabled').disabled);await notify(page);assert.equal(await page.evaluate(()=>window.__speechCalls.length),0);
  const other=await pageFor(id);assert.equal(await other.locator('#patient-voice-enabled').isChecked(),false);await other.locator('#patient-voice-enabled').click();await other.waitForFunction(()=>!document.querySelector('#patient-voice-enabled').disabled);await notify(other);assert.equal(await other.evaluate(()=>window.__speechCalls.length),1);assert.equal(await other.locator('#voice-guide-start,#voice-guide-full,#patient-voice-preview').count(),0);await page.context().close();await other.context().close();
 });
 await check('legacy local voice-off migrates only for an unconfigured patient preference',async()=>{
  const id=await createPatient(),page=await pageFor(id,{legacyOff:true});await page.waitForFunction(()=>!document.querySelector('#patient-voice-enabled').disabled);assert.equal(await page.locator('#patient-voice-enabled').isChecked(),false);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('homecarePatientAssist')).voiceEnabled),undefined);
  await page.locator('#patient-voice-enabled').click();await page.waitForFunction(()=>document.querySelector('#patient-voice-enabled').checked&&!document.querySelector('#patient-voice-enabled').disabled);
  const other=await pageFor(id,{legacyOff:true});await other.waitForFunction(()=>!document.querySelector('#patient-voice-enabled').disabled);assert.equal(await other.locator('#patient-voice-enabled').isChecked(),true);await page.context().close();await other.context().close();
 });
 await check('missing Korean voice retains unstarted reservation and supports manual text fallback',async()=>{
  const page=await pageFor(await createPatient());await page.evaluate(()=>window.__voices=[]);await notify(page);assert.equal(await page.evaluate(()=>window.__speechCalls.length),0);assert.match(await page.locator('#voice-guide-status').innerText(),/한국어 목소리/);assert.match(await page.locator('#voice-guide-script').innerText(),/음식 전체/);
  await page.waitForTimeout(150);await page.evaluate(()=>window.__voices=[{lang:'ko-KR',name:'한국어',voiceURI:'new',default:true}]);await page.locator('#ordinary').click();assert.equal(await page.evaluate(()=>window.__speechCalls.length),1);await page.context().close();
 });
 await check('missing onstart is bounded, ordinary gesture retries once, and late callbacks cannot start',async()=>{
  const page=await pageFor(await createPatient());await page.clock.install();await page.evaluate(()=>window.__speechStart=false);await notify(page);await page.clock.fastForward(3100);assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);assert.match(await page.locator('#voice-guide-status').innerText(),/자동 음성/);
  await page.evaluate(()=>{const u=window.__speechCalls.at(-1);u.onstart?.();u.onend?.();});assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);await page.waitForTimeout(150);await page.locator('#ordinary').click();await page.waitForFunction(()=>window.__speechCalls.length===2);assert.equal(await page.evaluate(()=>window.__speechCalls.at(-1).syncGesture),true);await page.clock.fastForward(3100);await page.locator('#ordinary').click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__speechCalls.length),2);await page.context().close();
 });
 await check('missing onend and repeated callbacks recover without stale queue continuation',async()=>{
  const page=await pageFor(await createPatient());await page.clock.install();await notify(page);await page.clock.fastForward(31000);assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);assert.match(await page.locator('#voice-guide-status').innerText(),/마치지 못해/);const count=await page.evaluate(()=>window.__speechCalls.length);await page.evaluate(()=>{const u=window.__speechCalls.at(-1);u.onend?.();u.onstart?.();u.onerror?.();});assert.equal(await page.evaluate(()=>window.__speechCalls.length),count);await page.context().close();
 });
 await check('modal guidance has local stop/text, explicit stop discards remaining sentences',async()=>{
  const page=await pageFor(await createPatient());await page.evaluate(()=>{document.querySelector('#test-dialog').showModal();window.__context.formKey='steps-modal';});const today=await page.evaluate(()=>window.__context.summary.today);await notify(page,'value_check',{metric:'steps',value:10,recordDate:today});assert.match(await page.locator('[data-guidance-text]').innerText(),/10걸음/);assert.equal(await page.locator('[data-guidance-stop]').isVisible(),true);await page.locator('[data-guidance-stop]').click();await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.evaluate(()=>window.__speechCalls.length),1);assert.equal(await page.locator('[data-guidance-stop]').isHidden(),true);await page.context().close();
 });
 await check('microphone busy, navigation and page hide block overlapping or stale guidance',async()=>{
  const page=await pageFor(await createPatient());await page.evaluate(()=>window.__busy=true);await notify(page);assert.equal(await page.evaluate(()=>window.__speechCalls.length),0);await page.evaluate(()=>window.__busy=false);await notify(page);assert.equal(await page.evaluate(()=>window.__speechCalls.length),1);
  await page.evaluate(()=>{window.dispatchEvent(new Event('homecare-stop-speech'));window.__finishSpeech();});assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);await notify(page,'sleep_open');await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));window.__finishSpeech();});assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);assert.equal(await page.evaluate(()=>window.__speechCalls.length),2);await page.context().close();
 });
 await check('failed config refresh prevents stale speech; visual numeric confirmation survives voice off',async()=>{
  const page=await pageFor(await createPatient());await page.locator('#patient-voice-enabled').uncheck();await page.waitForFunction(()=>!document.querySelector('#patient-voice-enabled').disabled);assert.equal(await page.evaluate(()=>window.__assist.matchingValueRule('steps',10)?.id),'steps-check');
  await page.route('**/api/patients/*/voice-guidance',route=>route.abort());assert.equal(await page.evaluate(()=>window.__assist.refreshConfiguration({force:true})),false);assert.equal(await page.evaluate(()=>window.__assist.getConfiguration().ready),false);await notify(page);assert.equal(await page.evaluate(()=>window.__speechCalls.length),0);await page.context().close();
 });
 assert.deepEqual(errors,[]);await mkdir('test-results/speech-reliability',{recursive:true});await writeFile('test-results/speech-reliability/results.json',JSON.stringify({cases,errors,focusedAssistHarness:true,physicalAudioVerified:false,physicalMicrophoneVerified:false},null,2));console.log(`${cases.length} speech reliability scenarios passed; synthetic speech callbacks only.`);
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});}
