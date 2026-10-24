export const sessionState = { mode: null, user: null, csrfToken: null };
export const sessionHeaders = () => sessionState.csrfToken ? { 'X-CSRF-Token': sessionState.csrfToken } : {};
let recoveryIdentity = null;
const identityKey = user => JSON.stringify(user ? [user.id,user.role,user.patientId,user.staffRoles,user.capabilities,user.assignedPatientIds] : null);
export function sessionExpired() {
  if (sessionState.mode !== 'kakao') return;
  if (recoveryIdentity || document.querySelector('#session-recovery')) return;
  if (!sessionState.user) {
    window.__homecareLeaving = true;
    if(document.querySelector('#app-content'))document.querySelector('#app-content').hidden=true;
    location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }
  recoveryIdentity = identityKey(sessionState.user);
  sessionState.csrfToken = null;
  const dialog=document.createElement('dialog');
  dialog.id='session-recovery';dialog.setAttribute('aria-labelledby','session-recovery-title');
  dialog.style.cssText='border:2px solid #254c60;border-radius:16px;padding:24px;max-width:min(560px,94vw);width:94vw;background:white;color:#172b35;font-size:18px;line-height:1.6;';
  const style=document.createElement('style');style.textContent='#session-recovery::backdrop{background:#fff} #session-recovery button,#session-recovery a{display:block;box-sizing:border-box;min-height:48px;padding:12px;margin:12px 0;font-size:18px;width:100%;color:#173f52;background:#eef5f7;border:1px solid #476b7c;border-radius:8px;text-align:center;}';
  dialog.append(style);
  const title=document.createElement('h2');title.id='session-recovery-title';title.textContent='로그인을 다시 확인해 주세요';dialog.append(title);
  const message=document.createElement('p');message.textContent='작성 내용은 이 창에 잠시 보관하고 있습니다. 새 창에서 같은 계정으로 로그인한 뒤 돌아와 주세요. 이 창을 닫거나 새로고침하면 작성 내용이 사라질 수 있습니다.';dialog.append(message);
  const login=document.createElement('a');login.href='/login?next=%2Faccount';login.target='_blank';login.rel='noopener';login.textContent='새 창에서 로그인하기';dialog.append(login);
  const check=document.createElement('button');check.type='button';check.textContent='로그인했어요 · 이어서 작성';dialog.append(check);
  const status=document.createElement('p');status.setAttribute('role','status');dialog.append(status);
  const discard=document.createElement('button');discard.type='button';discard.textContent='작성 내용을 버리고 다시 열기';dialog.append(discard);
  discard.onclick=()=>{if(confirm('저장하지 않은 내용을 버리고 화면을 다시 여시겠어요?')){window.__homecareLeaving=true;location.reload();}};
  check.onclick=async()=>{
    check.disabled=true;status.textContent='계정을 확인하고 있습니다.';
    try {
      const result=await readSession();
      if(!result.user || identityKey(result.user)!==recoveryIdentity){
        sessionState.csrfToken=null;
        status.textContent='이전에 작성하던 계정과 접근 권한이 일치하지 않습니다. 같은 계정으로 다시 로그인하거나 작성 내용을 버리고 새로 열어 주세요.';
        return;
      }
      Object.assign(sessionState,result);
      recoveryIdentity=null;dialog.close();dialog.remove();renderSession();
      window.dispatchEvent(new Event('homecare-session-restored'));
    } catch(error){status.textContent=error.message;}
    finally{check.disabled=false;}
  };
  dialog.addEventListener('cancel',event=>event.preventDefault());
  document.body.append(dialog);dialog.showModal();check.focus();
}
async function readSession() {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 열어 주세요.');
  return response.json();
}
export function assertSessionActive() {
  if (recoveryIdentity || document.querySelector('#session-recovery')) throw new Error('같은 계정으로 로그인 상태를 확인한 뒤 이어서 작성해 주세요.');
}
export async function refreshSession() {
  assertSessionActive();
  const result = await readSession(); Object.assign(sessionState,result);
  return result;
}
export async function sessionRequest(path, options = {}) {
  assertSessionActive();
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...sessionHeaders(), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { if(response.status===401)sessionExpired();throw new Error(result.error || '요청을 처리하지 못했습니다.'); }
  return result;
}
export async function demoPatient(patientId) {
  if(sessionState.mode!=='demo' || (sessionState.user?.role==='patient' && sessionState.user.patientId===patientId))return;
  await sessionRequest('/api/auth/demo',{method:'POST',headers:{'X-HomeCare-Demo':'1'},body:JSON.stringify({role:'patient',patientId})});
  await refreshSession();renderSession();
}
function renderSession() {
  document.querySelectorAll('[data-auth-label]').forEach(el=>{el.textContent=sessionState.mode==='demo'?`합성자료 · ${sessionState.user?.role==='clinician'?'의료진':'환자'} 체험`:`카카오 로그인 · ${sessionState.user?.displayName||'연결 대기'}`;});
  document.querySelectorAll('[data-demo-only]').forEach(el=>{el.hidden=sessionState.mode!=='demo';});
  document.querySelectorAll('[data-auth-logout]').forEach(el=>{
    el.hidden=!sessionState.user;
    el.onclick=async()=>{
      if(window.homecareCanLogout && !window.homecareCanLogout())return;
      el.disabled=true;
      try {await sessionRequest('/api/auth/logout',{method:'POST',body:'{}'});window.__homecareLeaving=true;if(document.querySelector('#app-content'))document.querySelector('#app-content').hidden=true;location.replace('/login?loggedout=1');}
      catch(error){el.disabled=false;const status=document.querySelector('[data-auth-label]');if(status)status.textContent=error.message;}
    };
  });
}
export async function bootstrapSession(role) {
  await refreshSession();
  if(sessionState.mode==='demo') {
    if(!sessionState.user || sessionState.user.role!==role) {
      await sessionRequest('/api/auth/demo',{method:'POST',headers:{'X-HomeCare-Demo':'1'},body:JSON.stringify({role})});
      await refreshSession();
    }
  } else if(!sessionState.user) {sessionExpired();return false;}
  else if(sessionState.user.role==='pending' || (role==='clinician' && sessionState.user.role!=='clinician')) {
    window.__homecareLeaving=true;location.replace('/account'+(role==='clinician'?'?reason=clinician_required':''));return false;
  }
  renderSession();return true;
}

window.addEventListener('pageshow',event=>{if(event.persisted && sessionState.mode==='kakao')location.reload();});
