import {parseVoiceInput} from './voice-parser.js';
const errors={ 'not-allowed':'마이크 사용이 허용되지 않았어요. 브라우저 설정에서 허용하거나 손으로 입력해 주세요.', 'service-not-allowed':'이 기기에서 음성 서비스를 사용할 수 없어요. 손으로 입력해 주세요.', 'audio-capture':'마이크를 찾을 수 없어요. 연결을 확인하거나 손으로 입력해 주세요.', network:'음성 서비스에 연결하지 못했어요. 연결을 확인하거나 손으로 입력해 주세요.', 'no-speech':'말소리를 듣지 못했어요. 다시 말하거나 손으로 입력해 주세요.', 'language-not-supported':'이 기기에서는 한국어 인식을 지원하지 않아요. 손으로 입력해 주세요.' };
export function createPatientDictation({getContext,isBusy,beforeListen,speak,stopSpeak}){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  let host=null,trigger=null,context=null,recognition=null,generation=0,recording=false,phase='idle',raw='',parsed=null,confirmedText='',timer;
  const $=s=>host?.querySelector(s);
  function valid(){const c=trigger&&getContext(trigger);return Boolean(c&&context&&c.key===context.key&&!document.hidden&&!document.querySelector('#session-recovery')&&!isBusy());}
  function message(text,alert=false){if(!host)return;const el=$('[data-voice-status]');el.textContent=text;el.setAttribute('role',alert?'alert':'status');}
  function stop({abort=false}={}){clearTimeout(timer);if(abort){generation++;try{recognition?.abort();}catch{}recording=false;recognition=null;renderMic();}else try{recognition?.stop();}catch{recording=false;renderMic();}}
  function pause(){if(recording){stop({abort:true});message('마이크를 껐어요. 작성한 말을 확인하거나 다시 시작해 주세요.');}}
  function dirty(){return Boolean(host&&(recording||raw.trim()||$('[data-voice-transcript]')?.value.trim()));}
  function renderMic(){if(!host)return;host.classList.toggle('is-listening',recording&&phase==='listening');$('[data-voice-start]').disabled=recording||!Recognition;$('[data-voice-stop]').disabled=!recording;$('[data-voice-field]').disabled=recording;$('[data-voice-transcript]').disabled=recording;$('[data-voice-consent]').disabled=recording;$('[data-voice-parse]').disabled=recording;$('[data-voice-apply]').disabled=recording||!parsed||!$('[data-voice-confirm]').checked;$('[data-voice-mic]').textContent=recording?(phase==='listening'?'● 마이크 사용 중 · 말씀해 주세요':'마이크 시작 대기 · 허용 여부를 확인해 주세요'):'마이크 꺼짐';}
  function clearPreview(){parsed=null;confirmedText='';$('[data-voice-preview]').hidden=true;$('[data-voice-confirm]').checked=false;renderMic();}
  function reset(){stopSpeak?.();stop({abort:true});host?.remove();host=null;trigger=null;context=null;raw='';parsed=null;}
  function make(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
  function open(button){
    if(isBusy())return;
    const c=getContext(button);if(!c)return;
    const hadDraft=dirty();pause();if(hadDraft&&!confirm('확인 전 음성 내용을 버리고 다른 항목을 입력할까요?'))return;
    reset();trigger=button;context=c;host=document.createElement('section');host.className='voice-input-panel';host.setAttribute('aria-label','말로 입력하고 확인하기');
    host.innerHTML=`<h3>말로 입력하고 확인해요</h3><p data-voice-context></p><p>말한 내용은 바로 저장되지 않아요. 내용을 확인한 뒤 입력칸에 넣어 주세요.</p><p data-voice-unsupported hidden>이 브라우저는 말로 입력하기를 지원하지 않아요. 원래 입력칸을 손으로 눌러 기록해 주세요.</p><div data-voice-controls><label>무엇을 입력할까요?<select data-voice-field></select></label><p data-voice-example></p><p class="voice-privacy">기기에 따라 브라우저 회사의 음성 서비스로 목소리가 전송될 수 있어요. 이름·주민번호 등은 말하지 마세요.</p><label class="voice-check"><input type="checkbox" data-voice-consent>음성 처리 안내를 확인했고 마이크를 사용할게요</label><div class="voice-button-row"><button type="button" class="button voice-start" data-voice-start>마이크 켜고 말하기</button><button type="button" class="button button-secondary" data-voice-stop disabled>말하기 중지</button></div><strong data-voice-mic>마이크 꺼짐</strong><label>인식한 말 · 틀린 글자는 직접 고칠 수 있어요<textarea rows="3" maxlength="2000" data-voice-transcript></textarea></label><button type="button" class="button button-secondary" data-voice-parse>이 말로 내용 확인하기</button><section class="voice-review" data-voice-preview hidden><h3>이 내용이 맞나요?</h3><p data-voice-value></p><p data-voice-notice></p><label class="voice-check"><input type="checkbox" data-voice-confirm>날짜와 내용이 맞아요</label><button type="button" class="button button-primary" data-voice-apply disabled>확인한 내용을 입력칸에 넣기</button><button type="button" class="button button-secondary" data-voice-read>확인할 내용 듣기</button><button type="button" class="button button-secondary" data-voice-read-stop>읽기 멈추기</button></section></div><p data-voice-status role="status" aria-live="polite"></p><button type="button" class="button button-secondary" data-voice-cancel>음성 입력 닫기 · 손으로 입력</button>`;
    button.after(host);$('[data-voice-context]').textContent=c.label;
    if(!Recognition){$('[data-voice-controls]').hidden=true;$('[data-voice-unsupported]').hidden=false;message('마이크를 켜지 않았어요. 아래 원래 입력칸을 이용해 주세요.');}
    const select=$('[data-voice-field]');for(const f of c.fields){const op=make('option',f.label);op.value=f.key;select.append(op);}
    const example=()=>{$('[data-voice-example]').textContent='예: '+context.fields.find(f=>f.key===select.value).example;};example();
    select.onchange=()=>{stop({abort:true});raw='';$('[data-voice-transcript]').value='';clearPreview();example();message('새 항목을 골랐어요. 마이크를 켜고 말씀해 주세요.');};
    $('[data-voice-transcript]').oninput=e=>{raw=e.target.value;clearPreview();message('고친 말의 내용을 다시 확인해 주세요.');};
    $('[data-voice-start]').onclick=start;$('[data-voice-stop]').onclick=()=>{stop();message('말하기를 마치고 있어요. 인식 결과를 확인해 주세요.');};
    $('[data-voice-parse]').onclick=review;$('[data-voice-confirm]').onchange=renderMic;$('[data-voice-apply]').onclick=apply;
    $('[data-voice-read]').onclick=()=>{if(parsed&&confirmedText)speak(confirmedText+' 맞으면 확인한 내용을 입력칸에 넣기를 눌러 주세요.');};
    $('[data-voice-read-stop]').onclick=()=>stopSpeak?.();
    $('[data-voice-cancel]').onclick=()=>{const hadDraft=dirty();pause();if(hadDraft&&!confirm('확인 전 음성 내용을 버리고 손으로 입력할까요?'))return;const opener=trigger;reset();opener?.focus();};
    host.scrollIntoView({block:'nearest'});select.focus();renderMic();
  }
  function start(){
    if(!Recognition||recording)return;
    if(!valid()){message('입력 대상이 바뀌었어요. 음성 입력을 닫고 다시 열어 주세요.',true);return;}
    if(!$('[data-voice-consent]').checked){message('음성 처리 안내를 확인하고 마이크 사용에 체크해 주세요.',true);return;}
    beforeListen();stop({abort:true});raw='';$('[data-voice-transcript]').value='';clearPreview();
    const request=++generation;recognition=new Recognition();recognition.lang='ko-KR';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;recording=true;phase='requesting';renderMic();message('마이크 권한을 확인하고 있어요. 창이 뜨면 허용 여부를 선택해 주세요.');
    let finalParts=new Map(),ended=false;
    recognition.onstart=()=>{if(request!==generation)return;phase='listening';renderMic();message('듣고 있어요. 한 가지 내용만 천천히 말씀해 주세요.');};
    recognition.onresult=event=>{
      if(request!==generation||!valid())return;
      let interim='';for(let i=event.resultIndex||0;i<event.results.length;i++){const r=event.results[i];if(r.isFinal)finalParts.set(i,r[0].transcript);else interim+=r[0].transcript;}
      raw=[...finalParts.values()].join(' ').slice(0,2000);$('[data-voice-transcript]').value=raw||interim.slice(0,2000);
    };
    recognition.onerror=event=>{if(request!==generation)return;ended=true;recording=false;clearTimeout(timer);stop({abort:true});renderMic();message(errors[event.error]||'음성을 인식하지 못했어요. 다시 말하거나 손으로 입력해 주세요.',true);};
    recognition.onend=()=>{if(request!==generation)return;clearTimeout(timer);recording=false;recognition=null;renderMic();if(!ended){if(raw.trim()){message('말씀을 들었어요. 글자를 고친 뒤 내용 확인하기를 눌러 주세요.');}else{$('[data-voice-transcript]').value='';message('확정된 말소리가 없어요. 다시 말하거나 손으로 입력해 주세요.',true);}}};
    timer=setTimeout(()=>{if(request!==generation)return;stop({abort:true});message('25초가 지나 마이크를 껐어요. 인식한 내용을 확인해 주세요.');},25000);
    try{recognition.start();}catch{stop({abort:true});message('마이크를 켜지 못했어요. 다른 앱의 마이크 사용을 확인하거나 손으로 입력해 주세요.',true);}
  }
  function review(){
    if(recording)return;
    clearPreview();if(!valid()){message('날짜나 입력 대상이 바뀌었어요. 다시 열어 주세요.',true);return;}
    raw=$('[data-voice-transcript]').value.trim();const field=context.fields.find(f=>f.key===$('[data-voice-field]').value);
    parsed=parseVoiceInput(raw,field.key,{today:context.today,currentDate:context.date});
    if(!parsed.ok){message(parsed.error,true);parsed=null;return;}
    confirmedText=`${context.label}. ${field.label}: ${parsed.display}`;
    $('[data-voice-value]').textContent=confirmedText;$('[data-voice-notice]').textContent=parsed.notice||'아직 저장되지 않았어요. 입력칸에 넣은 뒤 저장 버튼을 눌러 마쳐 주세요.';$('[data-voice-preview]').hidden=false;message('날짜와 내용을 직접 확인해 주세요.');renderMic();
  }
  function apply(){
    if(!parsed?.ok||!$('[data-voice-confirm]').checked||recording)return;
    if(!valid()){message('입력 대상이 달라졌어요. 이 내용은 적용하지 않았어요.',true);return;}
    const fresh=getContext(trigger),field=fresh.fields.find(f=>f.key===$('[data-voice-field]').value);if(!field){message('이 항목은 더 이상 입력할 수 없어요.',true);return;}
    const value=parsed.value;const description=parsed.display;const form=trigger.closest('form');reset();field.apply(value);let status=form.querySelector('[data-voice-applied]');if(!status){status=document.createElement('p');status.dataset.voiceApplied='';status.className='inline-notice';status.setAttribute('role','status');const holder=form.querySelector('.dialog-body')||form;holder.prepend(status);}status.textContent=`${description}을 입력칸에 넣었어요. 값을 확인한 뒤 저장 버튼을 눌러 주세요. 아직 저장되지 않았어요.`;status.hidden=false;
  }
  function cancelForContext(){reset();}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-dictation]');if(b)open(b);});
  document.addEventListener('change',e=>{if(host&&trigger?.closest('form')?.contains(e.target)&&!host.contains(e.target)&&e.target.name==='date'){stop({abort:true});clearPreview();message('날짜가 바뀌어 마이크를 껐어요. 음성 입력을 닫고 새 날짜에서 다시 열어 주세요.');}},true);
  document.addEventListener('submit',e=>{if(host&&e.target.contains(host)&&dirty()){e.preventDefault();e.stopImmediatePropagation();message('확인 전 음성 내용이 있어요. 내용을 입력칸에 넣거나 음성 입력을 닫은 뒤 저장해 주세요.',true);}else e.target.querySelectorAll('[data-voice-applied]').forEach(el=>el.remove());},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop({abort:true});if(host)message('화면을 벗어나 마이크를 껐어요. 돌아와 내용을 확인해 주세요.');}});
  window.addEventListener('homecare-session-expired',()=>{stop({abort:true});if(host)message('로그인을 다시 확인할 때까지 마이크를 껐어요. 작성한 말은 이 화면에만 남아 있어요.');});
  window.addEventListener('homecare-stop-microphone',()=>stop({abort:true}));window.addEventListener('pagehide',cancelForContext);
  return {reset,pause,cancelForContext,dirty,recording:()=>recording,belongsTo:form=>Boolean(host&&form?.contains(host))};
}
