import {buildPatientTasks} from './patient-tasks.js';
import {sessionHeaders, assertSessionActive, sessionExpired} from './session.js';
import {guidanceClock, matchingGuidanceRules, guidanceText} from './voice-guidance-evaluator.js';

const labels={pending:'남길 수 있어요',recorded:'기록 있어요',upcoming:'나중에 확인',unavailable:'확인 필요',optional:'필요할 때'};
const CONFIG_MAX_AGE=90000;

export function createPatientAssist({getContext,isBusy,refresh,onAction}) {
  const $=selector=>document.querySelector(selector), synth=window.speechSynthesis;
  const voiceOK=Boolean(synth&&window.SpeechSynthesisUtterance);
  let remindersEnabled=false,legacyVoiceOff=false;
  try { const old=JSON.parse(localStorage.getItem('homecarePatientAssist')||'{}');remindersEnabled=old.remindersEnabled===true;legacyVoiceOff=old.voiceEnabled===false; } catch {}
  let bundle=null, configPatient=null, configFetchedAt=0, configGeneration=0, configRequest=null, clockOffset=0;
  let preferenceBusy=false, localMuted=legacyVoiceOff, localPreferencePatient=null;
  let speechPhase='idle', speechGeneration=0, active=null, pending=null, startTimer, endTimer;
  let lastReminder=Date.now(),lastRefresh=Date.now(),refreshing=false,notification=null,browserAlerts=false;
  let taskData=null,drawKey='',lastFailureAt=0,fresh=false,eventCounter=0,viewKey='';
  const completed=new Set(), attempts=new Map();
  const now=()=>new Date(Date.now()+clockOffset);
  const context=()=>({...getContext(),now:now()});
  const patientPath=id=>`/api/patients/${encodeURIComponent(id)}/voice-guidance`;
  const currentFormKey=()=>String(getContext().formKey??`${getContext().view}:${$('dialog[open]')?.id||''}:${$('#daily-dialog[open] #daily-date')?.value||''}`);
  const status=text=>{const el=$('#voice-guide-status');if(el){el.classList.remove('sr-only');el.textContent=text;} const modal=$('dialog[open] [data-guidance-status]');if(modal)modal.textContent=text;};
  const preferenceStatus=text=>{const el=$('#patient-voice-preference-status');if(el)el.textContent=text;else status(text);};
  const writeText=text=>{for(const selector of ['#voice-guide-script','#voice-guidance-text','dialog[open] [data-guidance-text]']){const el=$(selector);if(el)el.textContent=text;}};
  const persistReminder=()=>{try{localStorage.setItem('homecarePatientAssist',JSON.stringify({...legacyVoiceOff?{voiceEnabled:false}:{},remindersEnabled}));}catch{}};
  const allowed=automatic=>!document.hidden&&!$('#session-recovery')&&navigator.onLine!==false&&!isBusy(automatic);
  const currentConfig=()=>bundle&&configPatient===getContext().patientId&&Date.now()-configFetchedAt<CONFIG_MAX_AGE;
  const enabled=()=>currentConfig()&&bundle.configuration.enabled&&bundle.preference.enabled&&!localMuted;
  const koreanVoices=()=>{try{return voiceOK?synth.getVoices().filter(voice=>/^ko(?:$|[-_])/i.test(voice.lang)):[];}catch{return [];}};
  function renderSpeech(){for(const button of document.querySelectorAll('#voice-guide-stop,[data-guidance-stop]'))button.hidden=speechPhase==='idle';const toolbar=$('#voice-guide-controls');if(toolbar)toolbar.hidden=speechPhase==='idle';}
  async function request(path,method='GET',body,timeout=10000) {
    assertSessionActive();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try {const response=await fetch(path,{method,headers:{...sessionHeaders(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'});
      let result;try{result=await response.json();}catch{throw Error('응답을 확인하지 못했어요.');}
      if(!response.ok){if(response.status===401)sessionExpired();throw Object.assign(Error(result.error||'설정을 확인하지 못했어요.'),{status:response.status});}return result;
    } finally {clearTimeout(timer);}
  }
  async function receipt(candidate,outcome) {
    const claimId=candidate.claim?.claimId,patientId=candidate.patientId;if(!claimId)return;
    for(let retry=0;retry<2;retry++)try {await request(`${patientPath(patientId)}/receipts/${encodeURIComponent(claimId)}`,'POST',{outcome},7000);return;} catch(error){if((error.status&&error.status<500)||retry===1)return;}
  }
  function clearTimers(){clearTimeout(startTimer);clearTimeout(endTimer);startTimer=endTimer=undefined;}
  function cancelActive({keepPending=false}={}) {
    speechGeneration++;clearTimers();const old=active,oldPending=pending;active=null;speechPhase='idle';
    try{if(voiceOK)synth.cancel();}catch{}
    if(old&&!old.started)void receipt(old,'released');
    if(!keepPending){pending=null;if(oldPending&&oldPending!==old&&!oldPending.started)void receipt(oldPending,'released');}renderSpeech();
  }
  function stop(){eventCounter++;cancelActive();}
  function valid(candidate) {
    if(!candidate||candidate.patientId!==getContext().patientId||candidate.configurationKey!==bundle?.configurationKey||!enabled())return false;
    if(candidate.day!==guidanceClock(now()).date)return false;
    if(candidate.event==='period_entry'&&(getContext().view!=='home'||$('dialog[open]')))return false;
    if(candidate.event!=='period_entry'&&candidate.formKey!==currentFormKey())return false;
    return matchingGuidanceRules(bundle.configuration,candidate.event,{...context(),...candidate.options}).some(rule=>rule.id===candidate.rule.id);
  }
  function renderPreference() {
    const checkbox=$('#patient-voice-enabled');if(!checkbox)return;
    checkbox.checked=Boolean(bundle?.preference.enabled&&!localMuted);checkbox.disabled=preferenceBusy||!currentConfig();
  }
  async function refreshConfiguration({force=false}={}) {
    const id=getContext().patientId;if(!id)return false;
    if(configRequest?.patientId===id)return configRequest.promise;
    if(!force&&currentConfig())return true;
    if(configPatient!==id){bundle=null;configFetchedAt=0;localMuted=legacyVoiceOff;localPreferencePatient=id;stop();}
    const generation=++configGeneration;
    const promise=(async()=>{try {
      const result=await request(patientPath(id));
      if(generation!==configGeneration||id!==getContext().patientId)return false;
      const changed=bundle?.configurationKey!==result.configurationKey;
      if(changed)cancelActive();
      bundle=result;configPatient=id;configFetchedAt=Date.now();
      if(legacyVoiceOff&&result.preference.configured){legacyVoiceOff=false;localMuted=false;persistReminder();}
      const serverTime=Date.parse(result.serverTime);if(Number.isFinite(serverTime))clockOffset=serverTime-Date.now();
      if(localPreferencePatient!==id){localPreferencePatient=id;localMuted=legacyVoiceOff;}
      renderPreference();
      if(!bundle.configuration.enabled){stop();preferenceStatus('의료진이 자동 음성 안내를 꺼 두었어요. 글로 확인할 수 있어요.');}
      else if(!bundle.preference.enabled||localMuted){stop();preferenceStatus('음성 안내가 꺼져 있어요. 글로 계속 확인할 수 있어요.');}
      else preferenceStatus('필요한 때에만 짧게 자동 안내해요. 안내 중에는 멈출 수 있어요.');
      if(legacyVoiceOff&&!result.preference.configured)void setPreference(false);
      if(changed)window.dispatchEvent(new CustomEvent('homecare-guidance-config-changed',{detail:{configurationKey:bundle.configurationKey}}));
      return true;
    } catch {
      if(generation===configGeneration){configFetchedAt=0;stop();renderPreference();preferenceStatus('음성 설정을 확인하지 못했어요. 화면을 다시 열거나 기록 다시 확인을 눌러 주세요. 글과 손 입력은 계속 사용할 수 있어요.');}
      return false;
    } finally {if(configRequest?.generation===generation)configRequest=null;}})();
    configRequest={patientId:id,generation,promise};return promise;
  }
  function markStarted(candidate) {
    if(candidate.started)return;candidate.started=true;completed.add(candidate.key);void receipt(candidate,'started');
  }
  function playback(candidate) {
    if(!valid(candidate)||!allowed(candidate.event==='period_entry'))return;
    const voices=koreanVoices(),voice=voices.find(v=>v.default)||voices[0];
    writeText(candidate.text);
    if(!voiceOK){status('이 브라우저는 음성 안내를 지원하지 않아요. 안내 글을 확인해 주세요.');pending=null;void receipt(candidate,'released');return;}
    if(!voice){status('한국어 목소리가 준비되지 않았어요. 기기의 한국어 음성 설정이나 안내 글을 확인해 주세요.');pending=candidate;return;}
    pending=null;active=candidate;const generation=++speechGeneration;let chunk=0;
    const chunks=candidate.text.trim().replace(/([.!?。])\s+/gu,'$1\n').split('\n').filter(Boolean);
    candidate.attempts=(attempts.get(candidate.key)||0)+1;attempts.set(candidate.key,candidate.attempts);
    function fail(message) {
      if(generation!==speechGeneration)return;
      const retry=!candidate.started&&candidate.attempts<2&&valid(candidate);
      const previous={...candidate,claim:candidate.claim};cancelActive();if(retry){pending={...candidate,claim:null};void prepareRetry(pending,previous);}status(!retry&&!candidate.started&&candidate.attempts>=2?'자동 음성을 재생하지 못했어요. 안내 글을 확인해 주세요.':message);
    }
    function next(index) {
      if(generation!==speechGeneration||!valid(candidate)||!allowed(candidate.event==='period_entry')){if(generation===speechGeneration)cancelActive();return;}
      if(index>=chunks.length){clearTimers();active=null;speechPhase='idle';renderSpeech();status('안내를 마쳤어요. 필요한 기록을 남겨 주세요.');return;}
      const chunkId=++chunk;let utterance,ended=false,started=false;
      try{utterance=new SpeechSynthesisUtterance(chunks[index]);}catch{fail('소리를 준비하지 못했어요. 안내 글을 확인해 주세요.');return;}
      utterance.lang='ko-KR';utterance.voice=voice;utterance.rate=candidate.claim.rate;utterance.pitch=1;
      const live=()=>generation===speechGeneration&&chunkId===chunk&&!ended;
      speechPhase='preparing';renderSpeech();status('짧은 음성 안내를 준비하고 있어요.');
      utterance.onstart=()=>{if(!live()||started)return;if(!valid(candidate)||!allowed(candidate.event==='period_entry')){cancelActive();return;}started=true;clearTimeout(startTimer);markStarted(candidate);speechPhase='speaking';renderSpeech();status(candidate.text);endTimer=setTimeout(()=>fail('안내를 마치지 못해 소리를 멈췄어요. 안내 글을 확인해 주세요.'),Math.min(30000,Math.max(8000,Math.ceil(chunks[index].length*100/utterance.rate)+5000)));};
      utterance.onend=()=>{if(!live())return;if(!started){ended=true;fail('자동 음성이 시작되지 않았어요. 안내 글을 확인해 주세요.');return;}ended=true;clearTimers();next(index+1);};
      utterance.onerror=()=>{if(!live())return;ended=true;fail('자동으로 소리를 내지 못했어요. 다음 화면 조작 때 다시 시도하거나 안내 글을 확인해 주세요.');};
      startTimer=setTimeout(()=>{if(live()&&!started)fail('자동 음성이 시작되지 않았어요. 다음 화면 조작 때 다시 시도하며, 안내 글도 확인할 수 있어요.');},3000);
      try{synth.speak(utterance);}catch{fail('자동 음성이 시작되지 않았어요. 안내 글을 확인해 주세요.');}
    }
    next(0);
  }
  function claimBody(candidate) {
    const body={configurationKey:candidate.configurationKey,ruleId:candidate.rule.id,event:candidate.event};
    if(candidate.rule.frequency==='entry')body.contextId=candidate.options.contextId;
    if(candidate.event==='value_check'){body.recordDate=candidate.options.recordDate;body.value=candidate.options.value;}
    return body;
  }
  async function prepareRetry(candidate,previous=null) {
    if(candidate.preparing)return;candidate.preparing=true;
    if(previous)await receipt(previous,'released');
    if(pending!==candidate||!valid(candidate)){candidate.preparing=false;return;}
    try {
      const claim=await request(`${patientPath(candidate.patientId)}/claims`,'POST',claimBody(candidate));
      candidate.claim=claim;
      if(pending!==candidate||!valid(candidate)){if(claim.allowed)void receipt(candidate,'released');return;}
      if(!claim.allowed){pending=null;if(claim.reason==='configuration_changed')void refreshConfiguration({force:true});if(claim.reason==='already_started')completed.add(candidate.key);}
    }catch{if(pending===candidate){pending=null;status('음성 안내를 연결하지 못했어요. 안내 글을 확인해 주세요.');}}
    finally{candidate.preparing=false;}
  }
  async function attempt(candidate) {
    if(!valid(candidate)||!allowed(candidate.event==='period_entry')||completed.has(candidate.key)||(attempts.get(candidate.key)||0)>=2)return;
    if(active&&active.rule.priority>candidate.rule.priority)return;
    cancelActive();const generation=speechGeneration;pending=candidate;candidate.preparing=true;
    try {
      const claim=await request(`${patientPath(candidate.patientId)}/claims`,'POST',claimBody(candidate));
      candidate.claim=claim;
      if(generation!==speechGeneration||pending!==candidate||!valid(candidate)||!allowed(candidate.event==='period_entry')){if(claim.allowed)void receipt(candidate,'released');return;}
      if(!claim.allowed){pending=null;if(claim.reason==='configuration_changed')void refreshConfiguration({force:true});if(claim.reason==='already_started')completed.add(candidate.key);return;}
      candidate.text=claim.text;playback(candidate);
    } catch {
      if(generation===speechGeneration){pending=null;status('음성 안내를 연결하지 못했어요. 안내 글을 확인해 주세요.');}
    } finally {candidate.preparing=false;}
  }
  async function notify(event,options={}) {
    const patientId=getContext().patientId,formKey=currentFormKey(),counter=++eventCounter;
    if(!patientId||!allowed(event==='period_entry'))return false;
    if(!await refreshConfiguration())return false;
    if(counter!==eventCounter||patientId!==getContext().patientId||formKey!==currentFormKey()||!enabled())return false;
    const c=context(),rule=matchingGuidanceRules(bundle.configuration,event,{...c,...options})[0];
    if(!rule)return false;
    const day=guidanceClock(c.now).date;
    const eventOptions={...options,contextId:options.contextId||crypto.randomUUID()};
    const bucket=rule.frequency==='day'?'day':rule.frequency==='value'?`${options.recordDate}:${options.metric}:${options.value}`:eventOptions.contextId;
    const key=`${patientId}:${day}:${rule.id}:${bucket}`;
    if(completed.has(key)||(attempts.get(key)||0)>=2||active?.key===key||pending?.key===key)return false;
    const candidate={patientId,configurationKey:bundle.configurationKey,event,options:eventOptions,formKey,day,key,rule,text:guidanceText(rule,options.value),started:false};
    writeText(candidate.text);await attempt(candidate);return true;
  }
  function update({automatic=false}={}) {
    const c=context();if(!c.summary)return;
    const nextView=`${c.patientId}:${currentFormKey()}`;if(viewKey&&nextView!==viewKey)stop();viewKey=nextView;
    if(navigator.onLine===false){stop();return;}
    taskData=buildPatientTasks(c);fresh=!taskData.stale&&c.checkedAt>=lastFailureAt&&Date.now()-c.checkedAt<120000;
    const list=$('#patient-task-list'),keyToDraw=c.patientId+':'+taskData.signature,redraw=keyToDraw!==drawKey;
    if(redraw){list?.replaceChildren();drawKey=keyToDraw;}
    if(!fresh){if($('#patient-task-summary'))$('#patient-task-summary').textContent='최신 기록을 다시 확인해 주세요. 날짜나 남은 항목이 달라졌을 수 있어요.';stop();return;}
    if($('#patient-task-summary'))$('#patient-task-summary').textContent=taskData.pending.length?`아직 기록이 없는 항목 ${taskData.pending.length}가지예요. 가능한 것부터 남겨 주세요.`:'지금 확인한 기록은 남겨 주셨어요. 식사는 더 추가할 수 있어요.';
    for(const task of redraw?taskData.tasks:[]){const item=document.createElement('li');item.className='patient-task '+task.state;const description=document.createElement('div'),heading=document.createElement('strong'),detail=document.createElement('p');heading.textContent=`${task.state==='recorded'?'✓ ':''}${task.label} · ${labels[task.state]}`;detail.textContent=task.detail;description.append(heading,detail);const button=document.createElement('button');button.type='button';button.className='button task-open';button.textContent=task.id==='medication'?'약 기록 열기 ›':task.id==='meal'?'식사 기록 열기 ›':`${task.label} 입력·수정 ›`;button.onclick=()=>onAction(task.action);item.append(description,button);list?.append(item);}
    if($('#patient-task-updated'))$('#patient-task-updated').textContent=c.checkedAt?`${new Date(c.checkedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'})} 확인 · 필요한 기록만 남겨요.`:'기록을 확인했어요.';
    if(!bundle||!currentConfig())void refreshConfiguration().then(ok=>{if(ok&&automatic&&getContext().view==='home')void notify('period_entry');});
    else if(automatic&&c.view==='home')void notify('period_entry');
  }
  async function reload() {
    if(refreshing||!allowed(true))return;refreshing=true;if($('#patient-task-refresh'))$('#patient-task-refresh').disabled=true;
    try{const ok=await refresh();if(!ok)throw Error();lastRefresh=Date.now();if($('#patient-task-error'))$('#patient-task-error').hidden=true;await refreshConfiguration({force:true});update({automatic:true});}
    catch{lastFailureAt=Date.now();fresh=false;const el=$('#patient-task-error');if(el){el.hidden=false;el.textContent='최신 기록을 확인하지 못했어요. 연결 후 다시 확인을 눌러 주세요.';}stop();}
    finally{refreshing=false;if($('#patient-task-refresh'))$('#patient-task-refresh').disabled=false;}
  }
  async function setPreference(enabledValue) {
    if(preferenceBusy)return;const patientId=getContext().patientId;preferenceBusy=true;
    // Turning off is immediate even if saving fails; turning on awaits server success.
    if(!enabledValue){localMuted=true;stop();}renderPreference();
    try{await request(`${patientPath(patientId)}/preference`,'PUT',{enabled:enabledValue});if(patientId!==getContext().patientId)return;
      if(bundle)bundle.preference={enabled:enabledValue,configured:true};localMuted=!enabledValue;localPreferencePatient=patientId;if(legacyVoiceOff){legacyVoiceOff=false;persistReminder();}
      preferenceStatus(enabledValue?'음성 안내를 켰어요. 필요한 때에만 짧게 안내해요.':'음성 안내를 껐어요. 글로 계속 확인할 수 있어요.');
    }catch{if(patientId===getContext().patientId){localMuted=true;preferenceStatus(enabledValue?'켜기 설정을 저장하지 못했어요. 연결 후 다시 켜 주세요.':'서버에 끄기 설정을 저장하지 못했어요. 이 화면에서는 껐지만 다른 기기에는 반영되지 않았어요. 연결 후 다시 꺼 주세요.');}}
    finally{preferenceBusy=false;renderPreference();}
  }
  async function requestAlerts(){const button=$('#patient-browser-alerts');
    if(!window.isSecureContext||!('Notification'in window)){if(button)button.disabled=true;$('#patient-alert-status').textContent='이 기기에서는 브라우저 알림을 사용할 수 없어요. 화면 안의 할 일로 확인해 주세요.';return;}
    try{let permission=Notification.permission;if(permission==='default')permission=await Notification.requestPermission();if(permission!=='granted'){browserAlerts=false;$('#patient-alert-status').textContent='알림이 허용되지 않았어요. 화면 안에서 확인할 수 있어요. 변경하려면 브라우저 설정을 확인해 주세요.';return;}
      notification?.close();notification=new Notification('HomeCare 기록 알림',{body:'이 화면을 열어 오늘의 기록을 확인해 주세요.',tag:'homecare-record-reminder'});browserAlerts=true;$('#patient-alert-status').textContent='브라우저 알림을 켰어요. 이 화면이 열려 있을 때만 보낼 수 있어요.';
    }catch{browserAlerts=false;$('#patient-alert-status').textContent='이 기기에서는 알림을 띄우지 못했어요. 화면 안의 할 일을 확인해 주세요.';}}
  function suspend(){stop();notification?.close();}
  const userStop=()=>{if(active)completed.add(active.key);if(pending)completed.add(pending.key);stop();status('음성 안내를 멈췄어요. 글로 확인할 수 있어요.');};
  const stopButton=$('#voice-guide-stop');if(stopButton)stopButton.onclick=userStop;
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-guidance-stop]'))userStop();});
  const voiceToggle=$('#patient-voice-enabled');if(voiceToggle){voiceToggle.checked=false;voiceToggle.disabled=true;voiceToggle.onchange=event=>void setPreference(event.target.checked);}
  const reminderToggle=$('#patient-reminders-enabled');if(reminderToggle){reminderToggle.checked=remindersEnabled;reminderToggle.onchange=event=>{remindersEnabled=event.target.checked;lastReminder=Date.now();persistReminder();};}
  if($('#patient-task-refresh'))$('#patient-task-refresh').onclick=reload;
  if($('#patient-browser-alerts'))$('#patient-browser-alerts').onclick=requestAlerts;
  if($('#patient-browser-alerts-off'))$('#patient-browser-alerts-off').onclick=()=>{browserAlerts=false;notification?.close();$('#patient-alert-status').textContent='이 화면의 브라우저 알림을 껐어요.';};
  const gesture=event=>{
    if(event.target?.closest?.('#voice-guide-stop,[data-guidance-stop],#patient-voice-enabled,[data-voice-start],[data-voice-stop]'))return;
    const retry=pending;if(!retry||active||!valid(retry)||!allowed(retry.event==='period_entry'))return;
    // iPhone Safari needs speak() in this actual gesture, without awaiting a network request.
    if(retry.claim?.allowed&&Date.parse(retry.claim.expiresAt)>now().getTime()+1000)playback(retry);
    else if(!retry.preparing){const previous=retry.claim?{...retry,claim:retry.claim}:null;retry.claim=null;void prepareRetry(retry,previous);}
  };
  synth?.addEventListener?.('voiceschanged',()=>{if(pending&&!active&&koreanVoices().length&&!pending.claim?.allowed)void prepareRetry(pending);});
  document.addEventListener('pointerup',gesture);document.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))gesture(event);});
  setInterval(async()=>{if(document.hidden||$('#session-recovery'))return;
    if(Date.now()-configFetchedAt>=60000)await refreshConfiguration({force:true});
    if(!allowed(true)||getContext().view!=='home')return;
    if(Date.now()-lastRefresh>=60000)await reload();else update({automatic:true});
    if(!remindersEnabled||!taskData?.pending.length||!fresh||taskData.stale||Date.now()-lastReminder<15*60000||!allowed(true)||navigator.onLine===false)return;
    lastReminder=Date.now();$('#patient-reminder').hidden=false;$('#patient-reminder').textContent='아직 남길 수 있는 기록이 있어요. 오늘 할 일에서 확인해 주세요.';
    if(browserAlerts&&Notification.permission==='granted')try{notification?.close();notification=new Notification('HomeCare 기록 알림',{body:'오늘의 기록을 확인해 주세요.',tag:'homecare-record-reminder'});}catch{browserAlerts=false;$('#patient-alert-status').textContent='브라우저 알림을 띄우지 못했어요. 화면 안에서 확인해 주세요.';}
  },60000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else void refreshConfiguration({force:true}).then(()=>{if(getContext().view==='home')void reload();});});
  window.addEventListener('pagehide',suspend);window.addEventListener('homecare-session-expired',()=>{suspend();configGeneration++;configFetchedAt=0;});window.addEventListener('homecare-stop-speech',suspend);window.addEventListener('offline',suspend);
  persistReminder();renderSpeech();
  return {update,stop,suspend,refresh:reload,notify,refreshConfiguration,speaking:()=>speechPhase!=='idle',say:()=>false,
    getConfiguration:()=>({configuration:bundle?.configuration||null,configurationKey:bundle?.configurationKey||null,ready:Boolean(currentConfig())}),
    matchingValueRule(metric,value,options={}){if(!currentConfig())return null;return matchingGuidanceRules({...bundle.configuration,enabled:true},'value_check',{...context(),...options,metric,value})[0]||null;},
    changed(){suspend();configGeneration++;configRequest=null;configFetchedAt=0;lastReminder=Date.now();lastRefresh=Date.now();drawKey='';viewKey='';taskData=null;const el=$('#patient-reminder');if(el)el.hidden=true;},
  };
}
