import { sessionState } from './session.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
export function createPatientCommunications({api,getView,isBusy,setBusy,toast}) {
  const $=selector=>document.querySelector(selector);
  const list=$('#patient-message-list'),input=$('#patient-message-body'),send=$('#patient-message-send'),error=$('#patient-message-error'),older=$('#patient-message-older'),notices=$('#patient-notices');
  let patientId=null,generation=0,messages=[],hasOlder=false,nonce=null,nonceBody='',sending=false,loading=false,noticeSignature='';
  function badge(count){const el=$('#message-unread');el.textContent=count>99?'99+':String(count);el.hidden=!count;}
  function renderMessages() {
    const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<70;
    const role=sessionState.user?.role||'patient';
    list.innerHTML=messages.length?messages.map(message=>`<article class="message-bubble ${message.senderRole===role?'mine':''}"><div class="message-author">${message.senderRole==='clinician'?'의료진':'환자'}</div><p>${esc(message.body)}</p><small>${esc(time(message.createdAt))}${message.senderRole===role?` · ${message.readByOther?'읽음':'전달됨'}`:''}</small></article>`).join(''):'<div class="message-empty">아직 메시지가 없어요. 의료진에게 남길 내용을 적어 주세요.</div>';
    older.hidden=!hasOlder;
    if(nearBottom)list.scrollTop=list.scrollHeight;
  }
  async function loadMessages({before=null}={}) {
    if(!patientId || loading)return;
    const target=patientId,request=generation;loading=true;
    try {
      const result=await api(`/api/patients/${encodeURIComponent(target)}/messages${before?'?before='+before:messages.length?'?after='+messages.at(-1).id:''}`);
      if(request!==generation || patientId!==target)return;
      badge(result.unread||0);
      if(getView()!=='messages')return;
      const known=new Map(messages.map(m=>[m.id,m]));result.messages.forEach(m=>known.set(m.id,m));for(const m of known.values())if(m.senderRole===(sessionState.user?.role||'patient'))m.readByOther=m.id<=result.otherReadThrough;messages=[...known.values()].sort((a,b)=>a.id-b.id);
      if(before || messages.length===result.messages.length)hasOlder=result.hasMore;
      renderMessages();error.hidden=true;
      const throughId=result.messages.at(-1)?.id;
      if(throughId && !document.hidden) {
        await api(`/api/patients/${encodeURIComponent(target)}/messages/read`,{method:'POST',body:JSON.stringify({throughId})});
        if(request===generation && target===patientId)badge(0);
      }
    } catch(issue){if(request===generation){error.textContent=issue.message;error.hidden=false;}}
    finally{if(request===generation)loading=false;}
  }
  async function loadNotices() {
    if(!patientId)return;
    const request=generation;
    try {
      const result=await api('/api/notices/active');
      if(request!==generation)return;
      const signature=JSON.stringify(result.notices);
      if(signature===noticeSignature)return;
      noticeSignature=signature;
      const opened=new Set([...notices.querySelectorAll('details[open]')].map(el=>el.dataset.noticeId+':'+el.dataset.version));
      notices.innerHTML=`<div class="notice-banner-heading"><strong>의료진 공지</strong><span>${result.notices.length?'최근 '+result.notices.length+'건':'등록된 공지가 없어요'}</span></div>`+result.notices.map(n=>`<details class="patient-notice" data-notice-id="${n.id}" data-version="${n.version}" ${opened.has(n.id+':'+n.version)?'open':''}><summary>${n.pinned?'<span class="notice-important">중요</span>':''}<span>${esc(n.title)}</span>${n.read?'':'<span class="notice-new">새 공지</span>'}</summary><p>${esc(n.body)}</p><time>${esc(time(n.publishedAt))}</time></details>`).join('');
    } catch(issue){if(request===generation){noticeSignature='';notices.innerHTML='<div class="notice-banner-heading"><strong>의료진 공지</strong><span role="alert">공지를 불러오지 못했어요.</span></div><button type="button" class="text-button" id="notice-retry">다시 확인</button>';}}
  }
  notices.addEventListener('click',event=>{if(event.target.closest('#notice-retry'))loadNotices();});
  notices.addEventListener('toggle',async event=>{
    const details=event.target;
    if(!details.matches('details[data-notice-id]') || !details.open || !patientId)return;
    const request=generation;
    try {await api(`/api/notices/${details.dataset.noticeId}/read`,{method:'POST',body:JSON.stringify({version:Number(details.dataset.version)})});if(request===generation)details.querySelector('.notice-new')?.remove();}
    catch(issue){if(request===generation){noticeSignature='';toast(issue.message);}}
  },true);
  $('#patient-message-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!patientId || sending || isBusy())return;
    const body=input.value.trim();if(!body)return;
    if(body!==nonceBody || !nonce){nonce=crypto.randomUUID();nonceBody=body;}
    const target=patientId,request=generation;sending=true;setBusy(true);send.disabled=true;input.disabled=true;error.hidden=true;
    try {
      await api(`/api/patients/${encodeURIComponent(target)}/messages`,{method:'POST',body:JSON.stringify({body,clientMessageId:nonce})});
      if(request!==generation)return;
      input.value='';nonce=null;nonceBody='';await loadMessages();toast('메시지를 보냈어요.');
    } catch(issue){if(request===generation){error.textContent=issue.message;error.hidden=false;}}
    finally{sending=false;setBusy(false);send.disabled=false;input.disabled=false;}
  });
  older.addEventListener('click',()=>loadMessages({before:messages[0]?.id}));
  $('#patient-message-retry').addEventListener('click',()=>loadMessages());
  setInterval(()=>{if(!document.hidden && patientId && !sending)loadMessages();},15000);
  setInterval(()=>{if(!document.hidden && patientId)loadNotices();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadNotices();loadMessages();}});
  return {
    reset(id){patientId=id;generation++;messages=[];loading=false;hasOlder=false;nonce=null;nonceBody='';noticeSignature='';input.value='';list.innerHTML='';badge(0);loadNotices();loadMessages();},
    activate(){if(getView()==='messages')loadMessages();},
    dirty(){return input.value.trim().length>0;},discard(){input.value='';nonce=null;nonceBody='';},
    refresh:loadNotices
  };
}
