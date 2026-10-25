// Real local Chromium DOM + HTTP/SQLite; SpeechSynthesis is MOCK. No physical audio evidence.
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
  window.__speechCalls=[];window.__speechCancel=0;window.__speechStart=true;
  window.__voices=[{lang:'ko-KR',name:'첫 한국어',voiceURI:'first',default:false},{lang:'ko-KR',name:'기기 기본 한국어',voiceURI:'default-ko',default:true},{lang:'en-US',name:'English',voiceURI:'en',default:true}];
  const listeners=new Map();window.__voicesChanged=()=>listeners.get('voiceschanged')?.();
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>window.__voices,cancel(){window.__speechCancel++;},addEventListener(event,fn){listeners.set(event,fn);},speak(u){window.__speechCalls.push(u);if(window.__speechStart)queueMicrotask(()=>u.onstart?.());}}});
  window.__finishSpeech=()=>window.__speechCalls.at(-1)?.onend?.();
}
async function check(name,fn){await fn();cases.push({name,passed:true,speech:'MOCK'});console.log('PASS '+name);}
async function load(page){await page.goto(base+'/patient?patientId=p001');await page.locator('#app-content:not([hidden])').waitFor();await page.waitForFunction(()=>!document.querySelector('#patient-select').disabled);}
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
  const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addInitScript(mockSpeech);const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await load(page);
  await check('default Korean voice and normal speed; brief guide follows greeting with one action',async()=>{
    await page.locator('#voice-guide-start').click();
    assert.deepEqual(await page.evaluate(()=>({text:window.__speechCalls.at(-1).text,voice:window.__speechCalls.at(-1).voice.voiceURI,rate:window.__speechCalls.at(-1).rate})),{text:'안녕하세요.',voice:'default-ko',rate:1});
    await page.evaluate(()=>window.__finishSpeech());const second=await page.evaluate(()=>window.__speechCalls.at(-1).text);assert.ok(second.length<100,second);await page.evaluate(()=>window.__finishSpeech());
    // A completed day may have one extra short sentence; drain it without advancing timers.
    if(await page.locator('#voice-guide-stop').isVisible())await page.evaluate(()=>window.__finishSpeech());
    assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);assert.match(await page.locator('#voice-guide-status').innerText(),/마쳤/);
  });
  await check('voice/speed preference is explicit, preview can stop, only non-sensitive settings persist',async()=>{
    await page.locator('.bottom-nav [data-view=guide]').click();await page.locator('#patient-voice-choice').selectOption('first');await page.locator('#patient-voice-rate').selectOption('1.15');
    const before=await page.evaluate(()=>window.__speechCalls.length);await page.locator('#patient-voice-preview').click();assert.equal(await page.evaluate(()=>window.__speechCalls.at(-1).voice.voiceURI),'first');assert.equal(await page.evaluate(()=>window.__speechCalls.at(-1).rate),1.15);
    await page.locator('#patient-voice-preview-stop').click();await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.evaluate(()=>window.__speechCalls.length),before+1);assert.equal(await page.locator('#patient-voice-preview-stop').isDisabled(),true);
    const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('homecarePatientAssist')));assert.deepEqual(Object.keys(prefs).sort(),['remindersEnabled','selectedVoiceURI','speechRate','voiceEnabled'].sort());
    await page.reload();await page.locator('#app-content:not([hidden])').waitFor();await page.locator('.bottom-nav [data-view=guide]').click();assert.equal(await page.locator('#patient-voice-choice').inputValue(),'first');assert.equal(await page.locator('#patient-voice-rate').inputValue(),'1.15');
  });
  await check('missing and later voices show actionable fallback without automatic replay',async()=>{
    await page.evaluate(()=>{window.__voices=[];window.__voicesChanged();});await page.locator('#patient-voice-preview').click();assert.match(await page.locator('#patient-voice-preview-status').innerText(),/한국어 목소리/);const before=await page.evaluate(()=>window.__speechCalls.length);
    await page.evaluate(()=>{window.__voices=[{lang:'ko-KR',name:'새 기본',voiceURI:'new-default',default:true}];window.__voicesChanged();});assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);assert.match(await page.locator('#patient-voice-choice-note').innerText(),/찾지 못해/);await page.locator('#patient-voice-preview').click();assert.equal(await page.evaluate(()=>window.__speechCalls.at(-1).voice.voiceURI),'new-default');await page.locator('#patient-voice-preview-stop').click();
  });
  await check('missing onstart recovers after 3 seconds and late callbacks cannot restart guide',async()=>{
    await page.clock.install();await page.evaluate(()=>window.__speechStart=false);await page.locator('#patient-voice-preview').click();await page.clock.fastForward(3100);assert.equal(await page.locator('#patient-voice-preview-stop').isDisabled(),true);assert.match(await page.locator('#patient-voice-preview-status').innerText(),/직접 눌러/);
    const before=await page.evaluate(()=>window.__speechCalls.length);await page.evaluate(()=>{const u=window.__speechCalls.at(-1);u.onstart?.();u.onend?.();u.onerror?.();});assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);assert.equal(await page.locator('#patient-voice-preview-stop').isDisabled(),true);
  });
  await check('missing onend after onstart is bounded, duplicate callbacks and rapid stops stay idle',async()=>{
    await page.evaluate(()=>window.__speechStart=true);await page.locator('#patient-voice-preview').click();await page.clock.fastForward(31000);assert.equal(await page.locator('#patient-voice-preview-stop').isDisabled(),true);assert.match(await page.locator('#patient-voice-preview-status').innerText(),/마치지 못해/);
    const before=await page.evaluate(()=>window.__speechCalls.length);await page.evaluate(()=>{const u=window.__speechCalls.at(-1);u.onend?.();u.onstart?.();});assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);
    for(let i=0;i<20;i++){await page.locator('#patient-voice-preview').click();await page.locator('#patient-voice-preview-stop').click();}assert.equal(await page.locator('#patient-voice-preview-stop').isDisabled(),true);await page.clock.resume();
  });
  await check('full guide queues one sentence at a time and explicit stop discards remainder',async()=>{
    await page.locator('#patient-view-close').click();await page.locator('.voice-script summary').click();const before=await page.evaluate(()=>window.__speechCalls.length);await page.locator('#voice-guide-full').click();assert.equal(await page.evaluate(()=>window.__speechCalls.length),before+1);await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.evaluate(()=>window.__speechCalls.length),before+2);
    await page.locator('#voice-guide-stop').click();await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.evaluate(()=>window.__speechCalls.length),before+2);
  });
  await check('page hide and explicit speech-cancellation signal prevent stale utterance continuation',async()=>{
    await page.locator('#voice-guide-start').click();let before=await page.evaluate(()=>window.__speechCalls.length);await page.evaluate(()=>window.dispatchEvent(new Event('homecare-stop-speech')));await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);
    await page.locator('#voice-guide-start').click();before=await page.evaluate(()=>window.__speechCalls.length);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.evaluate(()=>window.__finishSpeech());assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);assert.equal(await page.locator('#voice-guide-stop').isHidden(),true);
  });
  await check('voice off blocks previews and 320px enlarged settings retain visible usable controls',async()=>{
    await page.locator('.bottom-nav [data-view=guide]').click();await page.locator('#patient-voice-enabled').uncheck();const before=await page.evaluate(()=>window.__speechCalls.length);await page.locator('#patient-voice-preview').click();assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);assert.match(await page.locator('#patient-voice-preview-status').innerText(),/꺼져/);
    await page.setViewportSize({width:320,height:844});await page.locator('#patient-large-text').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const sizes=await page.locator('.voice-playback-settings select,.voice-playback-settings button').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));assert.ok(sizes.every(s=>s.width>=56&&s.height>=56),JSON.stringify(sizes));
  });
  assert.deepEqual(errors,[]);await mkdir('test-results/speech-reliability',{recursive:true});await page.screenshot({path:'test-results/speech-reliability/settings-320.png',fullPage:true});await writeFile('test-results/speech-reliability/results.json',JSON.stringify({cases,errors,physicalAudioVerified:false,physicalMicrophoneVerified:false},null,2));console.log(`${cases.length} speech reliability scenarios passed; synthetic speech callbacks only.`);
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});}
