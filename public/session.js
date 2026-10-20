export const sessionState = { mode: null, user: null, csrfToken: null };
export const sessionHeaders = () => sessionState.csrfToken ? { 'X-CSRF-Token': sessionState.csrfToken } : {};
export function sessionExpired() {
  if (sessionState.mode !== 'kakao') return;
  window.__homecareLeaving = true;
  if(document.querySelector('#app-content'))document.querySelector('#app-content').hidden=true;
  location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
}
export async function refreshSession() {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 열어 주세요.');
  const result = await response.json(); Object.assign(sessionState, result);
  return result;
}
export async function sessionRequest(path, options = {}) {
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
