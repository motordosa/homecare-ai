// Real local patient UI/HTTP with deliberately mocked Web Speech lifecycle.
// This does not verify an iPhone microphone, audible speech, or a recognition provider.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const directory=await mkdtemp(join(tmpdir(),'homecare-dictation-reliability-'));
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['--disable-warning=ExperimentalWarning','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_DIR:directory,NODE_ENV:'test',AUTH_MODE:'demo',VISION_ENABLED:'false',HOMECARE_VISION_API_KEY:'',OPENAI_API_KEY:'',STAFF_ACCESS_JSON:''},stdio:'ignore'});
let browser,count=0;const pageErrors=[];
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await delay(50);}throw Error('Temporary server did not start');}
function recognitionMock(){
 window.__mode={start:true,endOnStop:false,endOnAbort:true};window.__recognizers=[];window.__abortCount=0;window.__stopCount=0;
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:undefined});
 window.SpeechRecognition=class{
  constructor(){if(window.__mode.constructorThrow)throw Error('Mock constructor failed');window.__recognizers.push(this);}
  start(){if(window.__mode.startThrow)throw Error('Mock start failed');if(window.__mode.start)this.onstart?.();}
  stop(){window.__stopCount++;if(window.__mode.stopThrow)throw Error('Mock stop failed');if(window.__mode.endOnStop)this.onend?.();}
  abort(){window.__abortCount++;this.aborts=(this.aborts||0)+1;if(this.throwOnAbort)throw Error('Mock abort failed');if(window.__mode.endOnAbort)this.onend?.();if(this.endThenThrow)throw Error('Mock abort failed after terminal');}
 };
 window.__result=(text,final=true,index=-1)=>{const instance=window.__recognizers.at(index),result=[{transcript:text}];result.isFinal=final;instance.onresult?.({resultIndex:0,results:[result]});};
}
async function scenario(name,fn,{unsupported=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844}});await context.addInitScript(recognitionMock);
 if(unsupported)await context.addInitScript(()=>{window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;});
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));page.setDefaultTimeout(8000);
 try{
  await page.goto(base+'/patient?patientId=p001');await page.locator('#app-content:not([hidden])').waitFor();await page.waitForFunction(()=>!document.querySelector('#patient-select').disabled);
  await page.locator('#today-metrics [data-action=steps]').click();await page.locator('#daily-submit:not([disabled])').waitFor();await page.locator('[data-dictation=daily]').click();
  await page.clock.install();
  await fn(page);count++;console.log('PASS '+name);
 }finally{await context.close();}
}
async function start(page){await page.locator('[data-voice-consent]').check();await page.locator('[data-voice-start]').click();}
async function editable(page){assert.equal(await page.locator('[data-voice-transcript]').isEnabled(),true);assert.equal(await page.locator('[data-voice-start]').isEnabled(),true);assert.equal(await page.locator('[data-voice-parse]').isEnabled(),true);assert.equal(await page.locator('[data-voice-stop]').isDisabled(),true);}
try{
 await ready();browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
 await scenario('MOCK stop with no terminal event recovers in 2 seconds and late callbacks cannot replace final text',async page=>{
  await start(page);await page.evaluate(()=>window.__result('삼천 걸음'));await page.locator('[data-voice-stop]').click();assert.match(await page.locator('[data-voice-mic]').innerText(),/마치는 중/);
  await page.clock.fastForward(2001);await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 걸음');assert.equal(await page.evaluate(()=>window.__abortCount),1);
  await page.evaluate(()=>{const old=window.__recognizers[0];old.onstart();window.__result('99999걸음');old.onerror({error:'network'});old.onend();});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 걸음');
 });
 await scenario('MOCK missing start is bounded and failed retry preserves edited transcript',async page=>{
  await page.locator('[data-voice-transcript]').fill('삼천 육백 걸음');await page.evaluate(()=>window.__mode.start=false);await start(page);await page.clock.fastForward(10001);await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');assert.match(await page.locator('[data-voice-status]').innerText(),/시작 응답/);
  await page.evaluate(()=>{const old=window.__recognizers[0];old.onstart();window.__result('99999걸음');});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
 });
 await scenario('MOCK delayed permission start re-aborts only the expired recognizer while a new attempt stays active',async page=>{
  await page.evaluate(()=>{window.__mode.start=false;window.__mode.endOnAbort=false;});await start(page);await page.clock.fastForward(10001);await editable(page);
  await page.evaluate(()=>window.__mode.start=true);await start(page);await page.evaluate(()=>window.__recognizers[0].onstart());assert.equal(await page.evaluate(()=>window.__recognizers[0].aborts),2);assert.equal(await page.evaluate(()=>window.__recognizers[1].aborts||0),0);assert.match(await page.locator('[data-voice-mic]').innerText(),/마이크 사용 중/);
  await page.evaluate(()=>{window.__result('오천 걸음');window.__recognizers[1].onend();});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'오천 걸음');
 });
 await scenario('MOCK capture is bounded at 25 seconds without a manual stop',async page=>{
  await start(page);await page.evaluate(()=>window.__result('사천 걸음'));await page.clock.fastForward(25001);await editable(page);assert.match(await page.locator('[data-voice-status]').innerText(),/25초/);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'사천 걸음');
 });
 await scenario('MOCK network failure restores edited draft despite new interim and final events',async page=>{
  await page.locator('[data-voice-transcript]').fill('삼천 육백 걸음');await start(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
  await page.evaluate(()=>{window.__result('잘못된 중간 말',false);window.__result('사천 걸음');window.__recognizers[0].onerror({error:'network'});});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
  await start(page);await page.evaluate(()=>{window.__result('99999걸음',true,0);window.__recognizers[0].onend();window.__result('오천 걸음');window.__recognizers.at(-1).onend();});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'오천 걸음');
 });
 await scenario('MOCK a first capture with final text retains that reviewable draft after a service failure',async page=>{
  await start(page);await page.evaluate(()=>{window.__result('삼천 육백 걸음');window.__recognizers[0].onerror({error:'network'});});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');assert.equal(await page.locator('[data-voice-preview]').isHidden(),true);
 });
 await scenario('MOCK interim-only completion keeps previous draft and does not promote uncertain words',async page=>{
  await page.locator('[data-voice-transcript]').fill('삼천 육백 걸음');await start(page);await page.evaluate(()=>{window.__result('사천 걸음',false);window.__recognizers[0].onend();});await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');assert.match(await page.locator('[data-voice-status]').innerText(),/이전에 쓴 말/);
 });
 await scenario('MOCK stop before start cannot reenter listening on a delayed start callback',async page=>{
  await page.evaluate(()=>window.__mode.start=false);await start(page);await page.locator('[data-voice-stop]').click();await page.evaluate(()=>window.__recognizers[0].onstart());assert.match(await page.locator('[data-voice-mic]').innerText(),/마치는 중/);await page.clock.fastForward(2001);await editable(page);
 });
 await scenario('MOCK synchronous stop completion keeps final success rather than a stale waiting message',async page=>{
  await page.evaluate(()=>window.__mode.endOnStop=true);await start(page);await page.evaluate(()=>window.__result('삼천 걸음'));await page.locator('[data-voice-stop]').click();await editable(page);assert.match(await page.locator('[data-voice-status]').innerText(),/말씀을 들었어요/);await page.clock.fastForward(30000);assert.match(await page.locator('[data-voice-status]').innerText(),/말씀을 들었어요/);
 });
 await scenario('MOCK constructor/start/stop exceptions restore manual controls without losing existing text',async page=>{
  await page.locator('[data-voice-transcript]').fill('삼천 육백 걸음');await page.evaluate(()=>window.__mode.constructorThrow=true);await start(page);await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
  await page.evaluate(()=>{window.__mode.constructorThrow=false;window.__mode.startThrow=true;});await start(page);await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
  await page.evaluate(()=>{window.__mode.startThrow=false;window.__mode.stopThrow=true;});await start(page);await page.locator('[data-voice-stop]').click();await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
 });
 await scenario('MOCK abort failure reports unconfirmed shutdown while manual review and real save remain available',async page=>{
  await start(page);await page.evaluate(()=>{window.__result('삼천 육백 걸음');window.__recognizers[0].throwOnAbort=true;});await page.locator('[data-voice-stop]').click();await page.clock.fastForward(2001);
  assert.match(await page.locator('[data-voice-mic]').innerText(),/종료 확인 필요/);assert.doesNotMatch(await page.locator('[data-voice-mic]').innerText(),/꺼짐/);assert.equal(await page.locator('[data-voice-start]').isDisabled(),true);assert.match(await page.locator('[data-voice-stop-unconfirmed]').innerText(),/탭을 닫거나/);assert.equal(await page.locator('[data-voice-transcript]').isEnabled(),true);
  await page.locator('[data-voice-transcript]').fill('사천 육백 걸음');await page.locator('[data-voice-parse]').click();await page.locator('[data-voice-confirm]').check();await page.locator('[data-voice-apply]').click();assert.equal(await page.locator('#daily-steps').inputValue(),'4600');await page.locator('#daily-submit').click();await page.locator('#daily-dialog').waitFor({state:'hidden'});assert.equal((await(await fetch(base+'/api/patients/p001/daily')).json()).record.steps,4600);assert.equal(await page.locator('[data-voice-stop-unconfirmed]').isVisible(),true);
  await page.locator('#today-metrics [data-action=steps]').click();await page.locator('#daily-submit:not([disabled])').waitFor();await page.locator('[data-dictation=daily]').click();assert.equal(await page.locator('[data-voice-start]').isDisabled(),true);assert.match(await page.locator('[data-voice-mic]').innerText(),/종료 확인 필요/);
  await page.evaluate(()=>window.__recognizers[0].onend());await editable(page);assert.equal(await page.locator('[data-voice-stop-unconfirmed]').isHidden(),true);
 });
 await scenario('MOCK stale-start abort failure is not cleared by a newer recognizer ending',async page=>{
  await page.evaluate(()=>{window.__mode.start=false;window.__mode.endOnAbort=false;});await start(page);await page.clock.fastForward(10001);await page.evaluate(()=>window.__mode.start=true);await start(page);
  await page.evaluate(()=>{window.__recognizers[0].throwOnAbort=true;window.__recognizers[0].onstart();window.__result('오천 걸음');window.__recognizers[1].onend();});assert.match(await page.locator('[data-voice-mic]').innerText(),/종료 확인 필요/);assert.equal(await page.locator('[data-voice-start]').isDisabled(),true);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'오천 걸음');
  await page.evaluate(()=>window.__recognizers[0].onerror({error:'aborted'}));await editable(page);assert.equal(await page.locator('[data-voice-stop-unconfirmed]').isHidden(),true);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'오천 걸음');
 });
 await scenario('MOCK terminal callback before an abort exception is accepted as shutdown evidence',async page=>{
  await start(page);await page.evaluate(()=>{window.__recognizers[0].endThenThrow=true;window.dispatchEvent(new Event('homecare-stop-microphone'));});await editable(page);assert.match(await page.locator('[data-voice-mic]').innerText(),/꺼짐/);assert.equal(await page.locator('[data-voice-stop-unconfirmed]:visible').count(),0);
 });
 await scenario('MOCK permission denial supports retry and retains previous draft',async page=>{
  await page.locator('[data-voice-transcript]').fill('삼천 육백 걸음');await start(page);await page.evaluate(()=>window.__recognizers[0].onerror({error:'not-allowed'}));await editable(page);assert.match(await page.locator('[data-voice-status]').innerText(),/허용되지/);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');
  await start(page);await page.evaluate(()=>{window.__result('칠천 걸음');window.__recognizers.at(-1).onend();});await page.locator('[data-voice-parse]').click();assert.match(await page.locator('[data-voice-value]').innerText(),/7,000/);assert.equal(await page.locator('[data-voice-apply]').isDisabled(),true);
 });
 await scenario('MOCK cancelling a date change preserves the captured draft and original target',async page=>{
  const originalDate=await page.locator('#daily-date').inputValue();const previousDate=new Date(Date.parse(originalDate+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  await start(page);await page.evaluate(()=>window.__result('삼천 육백 걸음'));let prompts=0;page.once('dialog',dialog=>{prompts++;dialog.dismiss();});await page.locator('#daily-date').fill(previousDate);
  assert.equal(prompts,1);assert.equal(await page.locator('#daily-date').inputValue(),originalDate);await editable(page);assert.equal(await page.locator('[data-voice-transcript]').inputValue(),'삼천 육백 걸음');await page.locator('[data-voice-parse]').click();assert.match(await page.locator('[data-voice-value]').innerText(),/3,600/);
 });
 await scenario('MOCK interrupt/hidden/session stop invalidates callbacks and never silently applies a value',async page=>{
  const original=await page.locator('#daily-steps').inputValue();await start(page);await page.evaluate(()=>{window.__result('삼천 걸음');window.dispatchEvent(new Event('homecare-stop-microphone'));});await editable(page);await page.evaluate(()=>{window.__result('99999걸음');window.__recognizers[0].onend();});assert.equal(await page.locator('#daily-steps').inputValue(),original);
  await start(page);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});});await editable(page);
  await start(page);await page.evaluate(()=>window.dispatchEvent(new Event('homecare-session-expired')));await editable(page);assert.equal(await page.locator('#daily-steps').inputValue(),original);
 });
 await scenario('MOCK missing recognition offers a manual path without a microphone control',async page=>{
  assert.equal(await page.locator('[data-voice-unsupported]').isVisible(),true);assert.equal(await page.locator('[data-voice-start]').isVisible(),false);await page.locator('[data-voice-cancel]').click();assert.equal(await page.locator('.voice-input-panel').count(),0);await page.locator('#daily-steps').fill('3500');assert.equal(await page.locator('#daily-steps').inputValue(),'3500');
 },{unsupported:true});
 assert.deepEqual(pageErrors,[]);console.log(`${count} dictation reliability scenarios passed. Speech events MOCK; actual iPhone microphone unverified.`);
}finally{
 await browser?.close();server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));await rm(directory,{recursive:true,force:true});
}
