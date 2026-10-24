import {buildPatientTasks} from './patient-tasks.js';
const labels={pending:'남길 수 있어요',recorded:'기록 있어요',upcoming:'나중에 확인',unavailable:'확인 필요',optional:'필요할 때'};
export function createPatientAssist({getContext,isBusy,refresh,onAction}){
  const $=s=>document.querySelector(s),synth=window.speechSynthesis;
  const voiceOK=Boolean(synth&&window.SpeechSynthesisUtterance);
  let prefs={voiceEnabled:true,remindersEnabled:false};
  try{const p=JSON.parse(localStorage.getItem('homecarePatientAssist')||'{}');for(const k of Object.keys(prefs))if(typeof p[k]==='boolean')prefs[k]=p[k];}catch{}
  let hasStarted=false,speaking=false,speechId=0,watchdog,spoken=new Set(),lastReminder=Date.now(),lastRefresh=Date.now(),refreshing=false,notification=null,browserAlerts=false,taskData=null,drawKey='',lastFailureAt=0,fresh=false;
  const status=text=>{$('#voice-guide-status').classList.remove('sr-only');$('#voice-guide-status').textContent=text;};
  const persist=()=>{try{localStorage.setItem('homecarePatientAssist',JSON.stringify(prefs));}catch{}};
  function stop(){speechId++;clearTimeout(watchdog);if(voiceOK)synth.cancel();speaking=false;$('#voice-guide-start').hidden=false;$('#voice-guide-stop').hidden=true;$('#voice-guide-start').textContent=!voiceOK?'음성 미지원':hasStarted?'다시 듣기':'안내 듣기';}
  function allowed(automatic=false){return !document.hidden&&!document.querySelector('#session-recovery')&&!isBusy(automatic);}
  function say(text,{manual=true}={}){
    stop();if(!prefs.voiceEnabled){status('음성 안내가 꺼져 있어요. 설정에서 다시 켤 수 있어요.');return false;}
    if(!voiceOK){status('이 브라우저에서는 음성 안내를 지원하지 않아요. 아래 글로 확인해 주세요.');return false;}
    if(!allowed())return false;
    const voice=synth.getVoices().find(v=>/^ko(?:$|[-_])/i.test(v.lang));
    if(!voice){status('한국어 목소리가 아직 준비되지 않았어요. 기기의 한국어 음성 설정을 확인하거나 글로 확인해 주세요.');return false;}
    const id=++speechId,u=new SpeechSynthesisUtterance(text);u.lang='ko-KR';u.voice=voice;u.rate=.9;u.pitch=1;
    const focusFromGuide=document.activeElement===$('#voice-guide-start');$('#voice-guide-start').hidden=true;$('#voice-guide-stop').hidden=false;if(focusFromGuide)$('#voice-guide-stop').focus();status('음성을 준비하고 있어요. 소리가 안 나면 다시 듣기를 눌러 주세요.');
    u.onstart=()=>{if(id!==speechId)return;clearTimeout(watchdog);speaking=true;hasStarted=true;status('안내를 읽고 있어요. 언제든 멈출 수 있어요.');};
    u.onend=()=>{if(id!==speechId)return;speaking=false;$('#voice-guide-start').hidden=false;$('#voice-guide-stop').hidden=true;status('안내를 마쳤어요. 다시 들을 수 있어요.');};
    u.onerror=()=>{if(id!==speechId)return;stop();status('소리를 재생하지 못했어요. 다시 듣기를 누르거나 글로 확인해 주세요.');};
    watchdog=setTimeout(()=>{if(id===speechId&&!speaking){stop();status('자동으로 소리를 낼 수 없어요. 큰 듣기 버튼을 직접 눌러 주세요.');}},3000);
    try{synth.speak(u);return true;}catch{stop();status('음성 재생을 시작하지 못했어요. 글로 확인해 주세요.');return false;}
  }
  function update({automatic=false}={}){
    const c=getContext();if(!c.summary)return;if(!navigator.onLine){stop();return;}
    taskData=buildPatientTasks(c);fresh=!taskData.stale&&c.checkedAt>=lastFailureAt&&Date.now()-c.checkedAt<120000;
    const list=$('#patient-task-list');const keyToDraw=c.patientId+':'+taskData.signature;const redraw=keyToDraw!==drawKey;if(redraw){list.replaceChildren();drawKey=keyToDraw;}
    if(!fresh){$('#patient-task-summary').textContent='최신 기록을 다시 확인해 주세요. 날짜나 남은 항목이 달라졌을 수 있어요.';stop();return;}
    $('#patient-task-summary').textContent=taskData.pending.length?`아직 기록이 없는 항목 ${taskData.pending.length}가지예요. 가능한 것부터 남겨 주세요.`:'지금 확인한 기록은 남겨 주셨어요. 식사는 더 추가할 수 있어요.';
    for(const task of redraw?taskData.tasks:[]){const item=document.createElement('li');item.className='patient-task '+task.state;const description=document.createElement('div');const heading=document.createElement('strong');heading.textContent=`${task.state==='recorded'?'✓ ':''}${task.label} · ${labels[task.state]}`;const detail=document.createElement('p');detail.textContent=task.detail;description.append(heading,detail);const button=document.createElement('button');button.type='button';button.className='button task-open';button.textContent=task.id==='medication'?'약 기록 열기 ›':task.id==='meal'?'식사 기록 열기 ›':`${task.label} 입력·수정 ›`;button.onclick=()=>onAction(task.action);item.append(description,button);list.append(item);}
    $('#voice-guide-script').textContent=taskData.speech;
    $('#patient-task-updated').textContent=c.checkedAt?`${new Date(c.checkedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'})} 확인 · 필요한 기록만 남겨요.`:'기록을 확인했어요.';
    const key=c.patientId+':'+taskData.date;
    if(automatic&&prefs.voiceEnabled&&!spoken.has(key)&&navigator.userActivation?.hasBeenActive&&allowed(true)&&c.view==='home'&&voiceOK&&synth.getVoices().some(v=>/^ko(?:$|[-_])/i.test(v.lang))){spoken.add(key);say(taskData.speech,{manual:false});}
  }
  async function reload(){if(refreshing||!allowed(true))return;refreshing=true;$('#patient-task-refresh').disabled=true;try{const ok=await refresh();if(ok){lastRefresh=Date.now();$('#patient-task-error').hidden=true;update();}else throw Error();}catch{lastFailureAt=Date.now();fresh=false;$('#patient-task-error').hidden=false;$('#patient-task-error').textContent='최신 기록을 확인하지 못했어요. 연결 후 다시 확인을 눌러 주세요.';stop();}finally{refreshing=false;$('#patient-task-refresh').disabled=false;}}
  async function requestAlerts(){
    const button=$('#patient-browser-alerts');
    if(!window.isSecureContext||!('Notification'in window)){button.disabled=true;$('#patient-alert-status').textContent='이 기기에서는 브라우저 알림을 사용할 수 없어요. 화면 안의 할 일로 확인해 주세요.';return;}
    try{
      let permission=Notification.permission;if(permission==='default')permission=await Notification.requestPermission();
      if(permission!=='granted'){browserAlerts=false;$('#patient-alert-status').textContent='알림이 허용되지 않았어요. 화면 안에서 확인할 수 있어요. 변경하려면 브라우저 설정을 확인해 주세요.';return;}
      notification?.close();notification=new Notification('HomeCare 기록 알림',{body:'이 화면을 열어 오늘의 기록을 확인해 주세요.',tag:'homecare-record-reminder'});browserAlerts=true;$('#patient-alert-status').textContent='브라우저 알림을 켰어요. 이 화면이 열려 있을 때만 보낼 수 있어요.';
    }catch{browserAlerts=false;$('#patient-alert-status').textContent='이 기기에서는 알림을 띄우지 못했어요. 화면 안의 할 일을 확인해 주세요.';}
  }
  function suspend(){stop();notification?.close();}
  $('#voice-guide-start').onclick=()=>{if(!prefs.voiceEnabled){status('음성 안내가 꺼져 있어요. 이용 안내의 음성·알림 설정에서 켜 주세요.');return;}window.dispatchEvent(new Event('homecare-stop-microphone'));update();if(taskData&&fresh){spoken.add(getContext().patientId+':'+taskData.date);say(taskData.speech);}};
  $('#voice-guide-stop').onclick=()=>{stop();$('#voice-guide-start').focus();status('음성 안내를 멈췄어요. 다시 들을 수 있어요.');};
  $('#patient-voice-enabled').checked=prefs.voiceEnabled;
  $('#patient-voice-enabled').onchange=e=>{prefs.voiceEnabled=e.target.checked;persist();if(!prefs.voiceEnabled)suspend();status(prefs.voiceEnabled?'듣기 버튼을 누르면 안내해 드려요.':'음성 안내를 껐어요. 글로 계속 확인할 수 있어요.');};
  $('#patient-reminders-enabled').checked=prefs.remindersEnabled;
  $('#patient-reminders-enabled').onchange=e=>{prefs.remindersEnabled=e.target.checked;lastReminder=Date.now();persist();};
  $('#patient-task-refresh').onclick=reload;$('#patient-browser-alerts').onclick=requestAlerts;
  $('#patient-browser-alerts-off').onclick=()=>{browserAlerts=false;notification?.close();$('#patient-alert-status').textContent='이 화면의 브라우저 알림을 껐어요.';};
  if(!voiceOK){$('#voice-guide-start').disabled=true;$('#voice-guide-start').textContent='음성 미지원';status('이 브라우저에서는 음성 안내를 지원하지 않아요. 아래 글로 확인해 주세요.');}
  setInterval(async()=>{
    if(!allowed(true)||getContext().view!=='home')return;
    if(Date.now()-lastRefresh>=60000)await reload();
    if(!prefs.remindersEnabled||!taskData?.pending.length||!fresh||taskData.stale||Date.now()-lastReminder<15*60000||!allowed(true)||!navigator.onLine)return;
    lastReminder=Date.now();$('#patient-reminder').hidden=false;$('#patient-reminder').textContent='아직 남길 수 있는 기록이 있어요. 오늘 할 일에서 확인해 주세요.';
    if(prefs.voiceEnabled)say(taskData.speech,{manual:false});
    if(browserAlerts&&Notification.permission==='granted')try{notification?.close();notification=new Notification('HomeCare 기록 알림',{body:'오늘의 기록을 확인해 주세요.',tag:'homecare-record-reminder'});}catch{browserAlerts=false;$('#patient-alert-status').textContent='브라우저 알림을 띄우지 못했어요. 화면 안에서 확인해 주세요.';}
  },60000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else if(getContext().view==='home'&&Date.now()-lastRefresh>=60000)reload();});window.addEventListener('pagehide',suspend);window.addEventListener('homecare-session-expired',suspend);
  return {update,say,stop,suspend,refresh:reload,changed(){suspend();lastReminder=Date.now();lastRefresh=Date.now();drawKey='';taskData=null;$('#patient-reminder').hidden=true;},speaking:()=>speaking};
}
