const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';
const blank=()=>({title:'',body:'',status:'draft',pinned:false});
export function createClinicianCommunications({api,getState,toast,selectPatient,invite}) {
  const root=document.querySelector('#app-content');
  const $=selector=>root.querySelector(selector);
  let mounted='',generation=0,sending=false,notice=null,draft=blank(),baseline=JSON.stringify(blank()),notices=[],messages=[],hasOlder=false,nonce=null,nonceBody='',loading=false;
  function dirty(){return mounted.startsWith('notices')?JSON.stringify(draft)!==baseline:Boolean($('#clinician-message-body')?.value.trim());}
  function discard(){draft=blank();baseline=JSON.stringify(draft);notice=null;nonce=null;nonceBody='';if($('#clinician-message-body'))$('#clinician-message-body').value='';}
  function canLeave(){if(sending){toast('전송이 끝난 뒤 이동해 주세요.',true);return false;}if(dirty()&&!confirm('작성 중인 내용을 버리고 이동할까요?'))return false;discard();return true;}
  function fail(error){if($('#communication-error')){$('#communication-error').textContent=error.message;$('#communication-error').hidden=false;}}
  function clearError(){if($('#communication-error'))$('#communication-error').hidden=true;}
  function noticeEditor(){
    $('#notice-editor').innerHTML=`<h2>${notice?'공지 수정':'새 공지'}</h2><p>전체 환자에게 게시됩니다. 개인 환자 정보는 메시지로 보내세요.</p><form id="notice-form"><label>제목<input id="notice-title" required maxlength="120" value="${esc(draft.title)}"></label><label>내용<textarea id="notice-body" required maxlength="5000" rows="9">${esc(draft.body)}</textarea></label><label>게시 상태<select id="notice-status">${[['draft','임시 저장'],['published','게시'],['archived','보관']].map(([v,l])=>`<option value="${v}" ${draft.status===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="check-label"><input id="notice-pinned" type="checkbox" ${draft.pinned?'checked':''}> 상단 중요 공지</label><p>${notice?'수정 버전 '+notice.version+' · 저장하면 게시 내용이 반영됩니다.':'임시 저장 공지는 환자에게 보이지 않습니다.'}</p><button type="submit" class="button button-primary" ${sending?'disabled':''}>${sending?'저장 중':'공지 저장'}</button></form>`;
  }
  async function loadNotices(){const request=generation;try{const result=await api('/api/clinician/notices');if(request!==generation||mounted!=='notices')return;notices=result.notices;$('#notice-list').innerHTML=notices.length?notices.map(n=>`<button class="notice-list-item" data-comm="edit-notice" data-id="${n.id}"><strong>${n.pinned?'중요 · ':''}${esc(n.title)}</strong><small>${({draft:'임시 저장',published:'게시 중',archived:'보관'})[n.status]} · v${n.version} · ${esc(time(n.updatedAt))}</small></button>`).join(''):'<p>등록된 공지가 없습니다. 새 공지를 작성하세요.</p>';}catch(error){if(request===generation)fail(error);}}
  function renderThread(){const list=$('#clinician-message-list');if(!list)return;const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<70;list.innerHTML=messages.length?messages.map(m=>`<article class="message-bubble ${m.senderRole==='clinician'?'mine':''}"><b>${m.senderRole==='clinician'?'의료진':'환자'}</b><p>${esc(m.body)}</p><small>${esc(time(m.createdAt))}${m.senderRole==='clinician'?' · '+(m.readByOther?'읽음':'전달됨'):''}</small></article>`).join(''):'<p class="compact-empty">아직 메시지가 없습니다.</p>';$('#clinician-message-older').hidden=!hasOlder;if(bottom)list.scrollTop=list.scrollHeight;}
  async function loadMessages(before=null){
    const target=getState().selectedId,request=generation;if(!target||loading||!mounted.startsWith('messages:'))return;loading=true;
    try{const result=await api(`/api/patients/${encodeURIComponent(target)}/messages${before?'?before='+before:messages.length?'?after='+messages.at(-1).id:''}`);if(request!==generation||target!==getState().selectedId)return;
      const known=new Map(messages.map(m=>[m.id,m]));result.messages.forEach(m=>known.set(m.id,m));for(const m of known.values())if(m.senderRole==='clinician')m.readByOther=m.id<=result.otherReadThrough;messages=[...known.values()].sort((a,b)=>a.id-b.id);if(before||messages.length===result.messages.length)hasOlder=result.hasMore;
      renderThread();clearError();const throughId=result.messages.at(-1)?.id;if(throughId&&!document.hidden)await api(`/api/patients/${encodeURIComponent(target)}/messages/read`,{method:'POST',body:JSON.stringify({throughId})});
    }catch(error){if(request===generation)fail(error);}finally{if(request===generation)loading=false;}
  }
  async function loadConversations(){const request=generation;try{const result=await api('/api/clinician/conversations');if(request!==generation||!mounted.startsWith('messages:'))return;$('#conversation-list').innerHTML=result.conversations.map(c=>`<button class="notice-list-item ${c.patientId===getState().selectedId?'selected':''}" data-comm="select-conversation" data-id="${esc(c.patientId)}"><strong>${esc(c.name)} ${c.unread?`<span class="unread-badge">${c.unread}</span>`:''}</strong><small>${esc(c.preview||'대화 시작하기')}</small></button>`).join('');}catch(error){if(request===generation)fail(error);}}
  function mount(view){
    const state=getState(),key=view==='notices'?'notices':`messages:${state.selectedId||''}`;
    if(mounted===key)return;
    mounted=key;generation++;loading=false;messages=[];hasOlder=false;
    root.innerHTML=`<div id="communication-error" class="error-banner" role="alert" hidden></div>`+(view==='notices'?`<div class="communication-layout"><section class="card communication-panel"><div class="card-header"><h2>공지 관리</h2><button class="button button-secondary" data-comm="new-notice">새 공지</button></div><div id="notice-list" class="communication-list">불러오는 중…</div><button class="button button-secondary" data-comm="reload-notices">목록 새로고침</button></section><section class="card communication-panel" id="notice-editor"></section></div>`:`<p class="communication-help">선택한 환자와 의료진만 확인하는 사이트 내 대화입니다. 응급 상황은 119 또는 의료기관으로 연락하세요. 카카오톡 알림은 발송하지 않습니다.</p><div class="communication-layout"><section class="card communication-panel"><h2>환자별 대화</h2><div id="conversation-list" class="communication-list">불러오는 중…</div></section><section class="card communication-panel">${state.selectedId?`<div class="card-header"><h2>${esc(state.data.patients.find(p=>p.id===state.selectedId)?.name||'선택 환자')} 님과의 대화 · ${esc(state.selectedId)}</h2><button class="button button-secondary" data-comm="invite">환자 연결코드</button></div><button id="clinician-message-older" class="text-link" data-comm="older" hidden>이전 메시지</button><div id="clinician-message-list" class="message-thread" role="log" aria-label="환자 대화"></div><form id="clinician-message-form"><label for="clinician-message-body">메시지</label><textarea id="clinician-message-body" rows="3" required maxlength="2000" placeholder="이 환자에게 보낼 내용을 입력하세요"></textarea><div class="message-actions"><button type="button" class="button button-secondary" data-comm="reload-messages">대화 새로고침</button><button type="submit" class="button button-primary" id="clinician-message-send">메시지 보내기</button></div></form>`:'<p>먼저 환자를 등록해 주세요.</p>'}</section></div>`);
    if(view==='notices'){noticeEditor();loadNotices();}else{loadConversations();loadMessages();}
  }
  root.addEventListener('input',event=>{if(mounted==='notices'){if(event.target.id==='notice-title')draft.title=event.target.value;if(event.target.id==='notice-body')draft.body=event.target.value;}});
  root.addEventListener('change',event=>{if(event.target.id==='notice-status')draft.status=event.target.value;if(event.target.id==='notice-pinned')draft.pinned=event.target.checked;});
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-comm]');if(!button)return;
    const action=button.dataset.comm;
    if(action==='new-notice'||action==='edit-notice'){if(!canLeave())return;notice=action==='edit-notice'?notices.find(n=>n.id===Number(button.dataset.id)):null;draft=notice?{title:notice.title,body:notice.body,status:notice.status,pinned:notice.pinned}:blank();baseline=JSON.stringify(draft);noticeEditor();$('#notice-title').focus();clearError();}
    if(action==='reload-notices')loadNotices();
    if(action==='select-conversation')selectPatient(button.dataset.id);
    if(action==='invite')invite();
    if(action==='reload-messages'){loadMessages();loadConversations();}
    if(action==='older')loadMessages(messages[0]?.id);
  });
  root.addEventListener('submit',async event=>{
    if(!['notice-form','clinician-message-form'].includes(event.target.id))return;event.preventDefault();if(sending)return;
    const isNotice=event.target.id==='notice-form',target=getState().selectedId,request=generation;
    const body=isNotice?null:$('#clinician-message-body').value.trim();if(!isNotice&&!body)return;
    if(!isNotice&&(body!==nonceBody||!nonce)){nonce=crypto.randomUUID();nonceBody=body;}
    sending=true;clearError();const controls=[...event.target.querySelectorAll('input,textarea,select,button')];controls.forEach(el=>el.disabled=true);
    try{
      if(isNotice){const result=await api('/api/clinician/notices'+(notice?'/'+notice.id:''),{method:notice?'PATCH':'POST',body:JSON.stringify({...draft,...(notice?{version:notice.version}:{})})});if(request!==generation)return;notice=result.notice;draft={title:notice.title,body:notice.body,status:notice.status,pinned:notice.pinned};baseline=JSON.stringify(draft);await loadNotices();toast('공지를 저장했습니다.');}
      else{await api(`/api/patients/${encodeURIComponent(target)}/messages`,{method:'POST',body:JSON.stringify({body,clientMessageId:nonce})});if(request!==generation)return;$('#clinician-message-body').value='';nonce=null;nonceBody='';await loadMessages();await loadConversations();toast(`${getState().data.patients.find(p=>p.id===target)?.name||target} 님에게 메시지를 보냈습니다.`);}
    }catch(error){if(request===generation)fail(error);}finally{sending=false;controls.forEach(el=>el.disabled=false);if(isNotice&&request===generation)noticeEditor();}
  });
  function refresh(){if(document.hidden||sending)return;if(mounted==='notices')loadNotices();else if(mounted.startsWith('messages:')){loadMessages();loadConversations();}}
  setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);
  return {mount,deactivate(){if(mounted){mounted='';generation++;loading=false;}},canLeave,dirty,busy:()=>sending,refresh};
}
