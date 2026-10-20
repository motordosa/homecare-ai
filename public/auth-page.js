import { sessionState, refreshSession, sessionRequest } from './session.js';
const $=selector=>document.querySelector(selector);
const error=message=>{$('#auth-error').textContent=message;$('#auth-error').hidden=false;};
function nextPath() {
  const value=new URL(location.href).searchParams.get('next');
  if(!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))return '/account';
  const parsed=new URL(value,location.origin);
  return parsed.origin===location.origin && ['/patient','/clinician','/account'].includes(parsed.pathname)?parsed.pathname+parsed.search:'/account';
}
try {
  const result=await refreshSession();
  $('#auth-loading').hidden=true;$('#auth-content').hidden=false;
  const user=result.user;
  if(location.pathname==='/login') {
    const login=$('#kakao-login');login.href='/auth/kakao?next='+encodeURIComponent(nextPath());
    login.hidden=!result.kakaoAvailable;
    $('#auth-status').textContent=result.reason||'카카오에서 본인을 확인한 뒤 HomeCare로 돌아옵니다.';
    $('#demo-entry').hidden=result.mode!=='demo';
    if(new URL(location.href).searchParams.has('error'))error('로그인이 취소되었거나 확인 정보가 만료되었습니다. 다시 시도해 주세요.');
    if(new URL(location.href).searchParams.has('loggedout'))$('#auth-status').textContent='HomeCare에서 로그아웃했습니다.';
    $('#account-link').hidden=!user;
  } else {
    if(!user){location.replace('/login?next=/account');}
    else {
      $('#account-role').textContent=user.displayName;
      $('#own-kakao-id').textContent=user.kakaoId||'데모 계정';
      $('#enrollment').hidden=user.role!=='pending';
      $('#continue-link').hidden=user.role==='pending';
      $('#continue-link').href=user.role==='clinician'?'/clinician':'/patient';
      $('#continue-link').textContent=user.role==='clinician'?'의료진 화면 열기':'내 환자 화면 열기';
      if(new URL(location.href).searchParams.get('reason')==='clinician_required')error('이 계정에는 의료진 권한이 없습니다. 관리자가 의료진 계정을 등록해야 합니다.');
      $('#enrollment-form').addEventListener('submit',async event=>{
        event.preventDefault();const button=$('#enrollment-submit');button.disabled=true;$('#auth-error').hidden=true;
        try {await sessionRequest('/api/auth/enroll',{method:'POST',body:JSON.stringify({code:$('#invitation-code').value.trim()})});$('#invitation-code').value='';location.replace('/patient');}
        catch(issue){error(issue.message);}finally{button.disabled=false;}
      });
      $('#account-logout').addEventListener('click',async()=>{
        try{await sessionRequest('/api/auth/logout',{method:'POST',body:'{}'});location.replace('/login?loggedout=1');}catch(issue){error(issue.message);}
      });
    }
  }
} catch(issue){$('#auth-loading').hidden=true;error(issue.message);}
