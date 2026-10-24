import { bootstrapSession, sessionHeaders, sessionExpired, sessionState, assertSessionActive } from './session.js';
import { createClinicianCommunications } from './clinician-communications.js';
import { createClinicalWorklist } from './clinician-workflow.js';
import { createResearchWorkspace } from './clinician-research.js';
import { createEvidenceWorkspace } from './clinician-evidence.js';
'use strict';
(async () => {
  const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    settings: '<path d="m9.8 3-.7 2.1-2 .9-2.1-.3L3 9l1.4 1.7v2.5L3 15l2 3.4 2.2-.3 2 .9.7 2h4.1l.7-2 2-.9 2.1.3 2-3.4-1.4-1.8v-2.5L21 9l-2-3.3-2.1.3-2-.9-.7-2.1Z"/><circle cx="12" cy="12" r="3"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M4 12h4l2-4 3 8 2-4h5"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    trend: '<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    steps: '<path d="M8 14c-2 0-3 3-3 5s1 3 3 2 2-4 2-5-1-2-2-2ZM16 9c2 0 3-3 3-5s-1-3-3-2-2 4-2 5 1 2 2 2Z"/><path d="m11 9-1 2M13 14l1-2"/>',
    moon: '<path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z"/>',
    pill: '<path d="m9 3-6 6a5.7 5.7 0 0 0 8 8l6-6a5.7 5.7 0 0 0-8-8Z"/><path d="m6 6 8 8"/>',
    food: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 21V3c-4 3-5 8 0 10"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14a8 3 0 0 0 16 0V5M4 12a8 3 0 0 0 16 0"/>',
    chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 12h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  };
  const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = (value, digits = 0) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits });
  const val = (metrics, key) => typeof metrics?.[key] === 'object' ? metrics[key]?.value : metrics?.[key];
  const present = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const shortDate = date => date ? date.slice(5).replace('-', '.') : '기록 없음';
  const sexLabel = sex => ({ female:'여', male:'남', other:'기타' }[sex] || '미입력');
  const riskLabel = risk => risk?.label || ({ high:'확인 우선',watch:'관찰 필요',stable:'규칙 미해당',insufficient:'자료 부족' }[risk?.level] || '자료 부족');
  const riskClass = risk => ['high','watch','stable','insufficient'].includes(risk?.level) ? risk.level : 'insufficient';
  const riskPill = risk => `<span class="risk-pill ${riskClass(risk)}">${esc(riskLabel(risk))}</span>`;
  const medLabel = status => ({taken:'복용 보고',partial:'일부 복용',missed:'미복용 보고',unknown:'알 수 없음'}[status] || '미기록');
  const foodLabel = food => ({balanced:'밥과 반찬',porridge:'죽',protein:'단백질 중심',noodles:'면 요리'}[food] || food || '식사');
  const healthSourceName = source => ({'patient-self-report':'수동 자기보고','health-connect':'Health Connect 수신','apple-health':'Apple Health 수신'}[source] || '출처 미표시');
  const healthSourceSummary = metric => {
    const entries=Object.entries(metric?.sourceCounts||{}).filter(([,days])=>Number(days)>0);
    return entries.length ? entries.map(([source,days])=>`${healthSourceName(source)} ${num(days)}일`).join(' · ') : metric?.value===null?'측정 기록 없음':'저장 자료 · 출처 확인 필요';
  };
  const mealSourceLabel = meal => meal.source==='openai-image-estimate-v1' ? `AI 사진 추정${meal.estimation?.patientConfirmed?' · 환자 확인':''}` : meal.source==='demo-food-table-v1'?'음식 선택·비율 예시 추정':'식사 추정 · 출처 확인 필요';
  const mealLabel = meal => ({breakfast:'아침',lunch:'점심',dinner:'저녁',snack:'간식'}[meal] || '식사');
  const state = { view:'overview', data:null, summary:null, selectedId:new URLSearchParams(location.search).get('patientId'), filter:'all', search:'', refreshBusy:false, selectionRequest:0, modal:null, lastFocus:null, medicationDate:new URLSearchParams(location.search).get('medicationDate'), medications:null, medicationRequest:0, medicationLoading:false, medicationError:'', photoGeneration:0, photoAbort:null, capabilities:null, capabilityLoading:false, capabilityError:false };
  state.startDate=new URLSearchParams(location.search).get('startDate')||'';
  state.endDate=new URLSearchParams(location.search).get('endDate')||'';
  state.staffAccess=null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(state.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(state.endDate)){state.startDate='';state.endDate='';}
  const viewTitles = {
    overview:['CARE AT A GLANCE','오늘의 돌봄 현황','환자의 일상을 연결하고, 필요한 돌봄을 먼저 살펴보세요.','케어 대시보드'],
    patients:['PATIENT WORKSPACE','환자 관리','기록의 변화와 확인할 내용을 환자별로 자세히 살펴보세요.','환자 관리'],
    medications:['CONFIRMED MEDICATION PLAN','복약 계획과 보고','의료진이 확인한 계획과 약별·회차별 자기보고를 함께 살펴보세요.','복약 계획'],
    records:['EVERYDAY HEALTH RECORDS','건강 기록','일상의 기록을 확인하고 연구용 파일로 내보내세요.','건강 기록'],
    worklist:['TEAM WORKLIST','오늘 할 일과 검토','연락·자료 확인·검토 요청을 담당자와 처리 상태로 관리하세요.','업무 목록'],
    research:['RESEARCH WORKSPACE','연구 자료와 기술통계','대상·기간·출처·결측을 확인한 뒤 자료를 동결하고 가명으로 내보내세요.','연구 분석'],
    evidence:['EVIDENCE WORKSPACE','연구 문헌 검토','검색 조건과 실제 출처를 보존하고 근거를 직접 검토하세요.','문헌 검토'],
    notices:['CARE ANNOUNCEMENTS','의료진 공지','환자 화면 상단에 표시할 공지를 작성하고 관리하세요.','공지 관리'],
    messages:['PATIENT MESSAGES','환자 메시지','환자별로 내용을 보내고 답변과 읽음 여부를 확인하세요.','환자 메시지'],
    settings:['DEMO WORKSPACE SETTINGS','데모 설정','테스트 데이터를 관리하고 다음 시연을 준비하세요.','데모 설정'],
  };
  if(!/^\d{4}-\d{2}-\d{2}$/.test(state.medicationDate||''))state.medicationDate=null;
  const urlView = new URLSearchParams(location.search).get('view');
  if (Object.hasOwn(viewTitles,urlView)) state.view = urlView;
  const $ = selector => document.querySelector(selector);
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const communication=createClinicianCommunications({api,getState:()=>state,toast,selectPatient,invite:openInvitation});
  const workspaces={worklist:createClinicalWorklist({api,getState:()=>state,toast,selectPatient}),research:createResearchWorkspace({api,getState:()=>state,toast}),evidence:createEvidenceWorkspace({api,getState:()=>state,toast})};
  const currentWorkspace=()=>workspaces[state.view];
  const can=capability=>Boolean(state.staffAccess?.capabilities?.includes(capability));
  const viewPermissions={overview:'patient.read',patients:'patient.read',records:'patient.read',medications:'patient.read',worklist:'patient.read',research:'research.read',evidence:'evidence.read',notices:'notice.write',messages:'message.write',settings:'admin.reset'};
  function authorizedView(view){return can(viewPermissions[view])?view:Object.keys(viewTitles).find(key=>can(viewPermissions[key]))||'settings';}
  function lockModal(locked){$('#modal').querySelectorAll('input,select,textarea,button').forEach(el=>{if(locked){el.dataset.beforeLock=el.disabled?'1':'0';el.disabled=true;}else if(el.dataset.beforeLock!==undefined){el.disabled=el.dataset.beforeLock==='1';delete el.dataset.beforeLock;}});}
  const periodQuery=()=>state.startDate&&state.endDate?'?'+new URLSearchParams({startDate:state.startDate,endDate:state.endDate}):'';
  const periodDays=()=>state.summary?.period?.totalDays||7;
  const periodLabel=()=>state.startDate&&state.endDate?`${state.startDate} ~ ${state.endDate}`:'최근 7일';
  const offsetDate=(date,days)=>new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
  const modalValues=()=>JSON.stringify([...$('#modal').querySelectorAll('input,select,textarea')].map(el=>[el.id||el.name,el.type==='checkbox'||el.type==='radio'?el.checked:el.type==='file'?[...el.files].map(f=>[f.name,f.size,f.lastModified]):el.value]));
  const modalBusy=()=>Boolean(state.modal?.saving||state.modal?.busy);
  const modalDirty=()=>Boolean(state.modal&&state.modal.baseline!==undefined&&state.modal.baseline!==modalValues());
  function rememberModal(){if(state.modal)state.modal.baseline=modalValues();}
  function canCloseModal(){if(modalBusy()){toast('저장 또는 분석이 끝난 뒤 이동해 주세요.',true);return false;}return !modalDirty()||confirm('작성한 내용을 저장하지 않고 나갈까요? 취소하면 계속 작성할 수 있습니다.');}
  function canLeave(){
    if(!canCloseModal())return false;
    if(!communication.canLeave())return false;
    if(currentWorkspace()&&!currentWorkspace().canLeave())return false;
    if(state.modal)closeModal({force:true});
    return true;
  }
  let historyIndex=Number(history.state?.hcClinicianIndex)||0,restoringHistory=false;
  history.replaceState({...history.state,hcClinicianIndex:historyIndex},'',location.href);
  async function api(path, options = {}) {
    assertSessionActive();
    const response = await fetch(path, { ...options, headers:{ 'Content-Type':'application/json', ...sessionHeaders(), ...options.headers } });
    const result = await response.json().catch(() => ({}));
    if(response.status===401)sessionExpired();
    if (!response.ok) throw new Error(result.error || result.message || `요청을 처리하지 못했습니다. (${response.status})`);
    return result;
  }
  function syncUrl(historyMode = 'replace') {
    const url = new URL(location.href);
    if (state.selectedId) url.searchParams.set('patientId',state.selectedId); else url.searchParams.delete('patientId');
    if (state.view === 'overview') url.searchParams.delete('view'); else url.searchParams.set('view',state.view);
    if(state.view==='medications' && medDate())url.searchParams.set('medicationDate',medDate());else url.searchParams.delete('medicationDate');
    if(state.startDate&&state.endDate){url.searchParams.set('startDate',state.startDate);url.searchParams.set('endDate',state.endDate);}else{url.searchParams.delete('startDate');url.searchParams.delete('endDate');}
    if(url.href!==location.href){if(historyMode==='push')historyIndex++;history[historyMode==='push'?'pushState':'replaceState']({hcClinicianIndex:historyIndex},'',url);}
  }
  function focusPage() {
    $('#page-title').focus({preventScroll:true});
    window.scrollTo({top:0,behavior:'instant'});
  }
  function restoreRoute(event) {
    const target=Number(event.state?.hcClinicianIndex)||0;
    if(restoringHistory){restoringHistory=false;return;}
    if(!canLeave()){const delta=historyIndex-target;if(delta){restoringHistory=true;history.go(delta);}return;}
    historyIndex=target;
    const params=new URLSearchParams(location.search);
    const view=params.get('view'),patientId=params.get('patientId'),date=params.get('medicationDate');
    state.view=authorizedView(Object.hasOwn(viewTitles,view)?view:'overview');
    state.medicationDate=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:state.data?.today||null;
    const periodChanged=state.startDate!==(params.get('startDate')||'')||state.endDate!==(params.get('endDate')||'');
    state.startDate=params.get('startDate')||'';state.endDate=params.get('endDate')||'';
    ++state.selectionRequest;++state.medicationRequest;
    state.medications=null;state.medicationLoading=false;state.medicationError='';
    $('#app-content').removeAttribute('aria-busy');
    if(state.modal)closeModal({force:true});
    const selected=state.data?.patients.some(p=>p.id===patientId)?patientId:state.data?.patients[0]?.id||null;
    if(selected!==state.selectedId||periodChanged)state.summary=null;
    state.selectedId=selected;
    render();focusPage();
    if(periodChanged)refresh({quiet:true});
    else if(selected && !state.summary)selectPatient(selected,false,{historyMode:'replace'});
    else if(state.view==='medications' && selected)loadMedications();
  }
  window.addEventListener('popstate',restoreRoute);
  function showError(message) { $('#global-error').textContent=message; $('#global-error').hidden=!message; }
  let toastTimer;
  function toast(message, error = false) { const el=$('#toast');el.textContent=message;el.hidden=false;el.classList.toggle('error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},4000);const result=$('#operation-result');if(result){result.hidden=false;result.classList.toggle('is-error',error);$('#operation-result-text').textContent=message;} }
  let refreshQueue = Promise.resolve();
  function refresh(options = {}) {
    const operation = refreshQueue.then(() => performRefresh(options));
    refreshQueue = operation.catch(() => {});
    return operation;
  }
  async function performRefresh({quiet = false} = {}) {
    if(modalBusy()){if(!quiet)toast('저장 또는 분석이 끝나면 새로고침할 수 있습니다.',true);return;}
    state.refreshBusy=true;
    $('#refresh-button').disabled=true;
    try {
      const data=await api('/api/dashboard'+periodQuery());
      state.data=data;
      await loadIntegrationSettings({renderAfter:false});
      if(!data.patients.some(p=>p.id===state.selectedId)) state.selectedId=[...data.patients].sort((a,b)=>({high:0,watch:1,stable:2,insufficient:3}[a.risk?.level]??3)-({high:0,watch:1,stable:2,insufficient:3}[b.risk?.level]??3))[0]?.id || null;
      if(!can('patient.read'))state.selectedId=null;
      if(state.selectedId) {
        const selected=state.selectedId,request=state.selectionRequest;
        const summary=await api(`/api/patients/${encodeURIComponent(selected)}/summary${periodQuery()}`);
        if(state.selectedId===selected && request===state.selectionRequest) state.summary=summary;
      } else state.summary=null;
      if(!state.medicationDate)state.medicationDate=data.today;
      if(state.view==='medications' && state.selectedId)await loadMedications({renderAfter:false});
      showError('');
      $('#current-date').textContent=new Date(`${data.today}T12:00:00+09:00`).toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'});
      $('#nav-patient-count').textContent=data.patients.length;
      $('#last-sync').textContent=`화면 조회 ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'})} · 관측일은 각 기록에 표시`;
      $('#loading-state').hidden=true;
      $('#app-content').hidden=false;
      render();
      if(!quiet) toast('최신 기록으로 업데이트했습니다.');
    } catch(error) { showError(`기록을 불러오지 못했어요. ${error.message} 새로고침으로 다시 시도해 주세요.`);$('#loading-state').hidden=true; }
    finally { state.refreshBusy=false;$('#refresh-button').disabled=false; }
  }
  async function selectPatient(id, changeView = false, {historyMode='push'} = {}) {
    if(!can('patient.read')||!state.data?.patients.some(p=>p.id===id)) return;
    if(id!==state.selectedId && !canLeave())return;
    state.selectedId=id;
    state.summary=null;state.medications=null;
    ++state.medicationRequest;
    const request=++state.selectionRequest;
    $('#app-content').setAttribute('aria-busy','true');
    if(changeView) state.view='patients';
    showError('');render(historyMode);
    try {
      const summary=await api(`/api/patients/${encodeURIComponent(id)}/summary${periodQuery()}`);
      if(request!==state.selectionRequest || state.selectedId!==id) return;
      state.summary=summary;
      if(state.view==='medications')await loadMedications({renderAfter:false});
      if(request!==state.selectionRequest || state.selectedId!==id)return;
      render();
    } catch(error) { if(request===state.selectionRequest){showError(`선택 환자의 기록을 불러오지 못했습니다. ${error.message} 새로고침으로 다시 시도해 주세요.`);render();toast(error.message,true);} }
    finally { if(request===state.selectionRequest)$('#app-content').removeAttribute('aria-busy'); }
  }
  function spark(values,color='#80b7a7',width=76,height=25) {
    const numeric=values.filter(present).map(Number);if(!numeric.length) return '';
    const min=Math.min(...numeric),max=Math.max(...numeric);const range=max-min||1;
    const coords=values.map((v,i)=>present(v)?`${i/(Math.max(values.length-1,1))*width},${height-3-(v-min)/range*(height-7)}`:null);
    let d='';let active=false;coords.forEach(p=>{if(!p){active=false;return;}d+=`${active?'L':'M'}${p} `;active=true;});
    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function chart(rows, key, {color='#5ba994',unit='',type='line',height=137,max=null,secondary=null,label='기록 추이'}={}) {
    if(!rows?.length) return '<div class="compact-empty">아직 표시할 기록이 없습니다.</div>';
    const values=rows.map(r=>r[key]);const numeric=values.filter(present).map(Number);
    if(!numeric.length) return '<div class="compact-empty">이 기간에는 측정 기록이 없습니다.</div>';
    const w=440,h=height,left=34,right=12,top=14,bottom=25,plotW=w-left-right,plotH=h-top-bottom;
    const ceiling=max || Math.max(1,...numeric)*1.16;
    const x=i=>left+(rows.length===1?plotW/2:i/(rows.length-1)*plotW);
    const y=v=>top+plotH-clamp(v,0,ceiling)/ceiling*plotH;
    let content='';
    for(let i=0;i<4;i++) { const v=ceiling/3*i;const yy=y(v);content+=`<line class="grid-line" x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}"/><text x="${left-7}" y="${yy+3}" text-anchor="end">${v>=1000?`${(v/1000).toFixed(v>=3000?0:1)}k`:num(v,v<10?1:0)}</text>`; }
    const interval=Math.max(1,Math.floor((rows.length-1)/4));rows.forEach((r,i)=>{if(i===0 || i===rows.length-1 || (i%interval===0 && i<rows.length-2)) content+=`<text x="${x(i)}" y="${h-5}" text-anchor="middle">${shortDate(r.date)}</text>`;});
    if(type==='bar') {
      const bw=Math.min(17,plotW/rows.length*.62);
      values.forEach((v,i)=>{if(!present(v))return;content+=`<rect x="${x(i)-bw/2}" y="${y(v)}" width="${bw}" height="${Math.max(0,top+plotH-y(v))}" rx="${Math.min(bw/2,3)}" fill="${color}" opacity="${i===rows.length-1?1:.68}"><title>${esc(rows[i].date)}: ${num(v,1)} ${esc(unit)}</title></rect>`;});
    } else {
      let d='',segment=[];const segments=[];
      values.forEach((v,i)=>{if(!present(v)){if(segment.length)segments.push(segment);segment=[];return;}segment.push([x(i),y(v)]);});if(segment.length)segments.push(segment);
      segments.forEach(seg=>{d+=seg.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ')+' ';if(seg.length>1)content+=`<path d="M${seg[0][0]},${top+plotH} ${seg.map(p=>`L${p[0]},${p[1]}`).join(' ')} L${seg.at(-1)[0]},${top+plotH}Z" fill="${color}" opacity=".055"/>`;});
      content+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
      values.forEach((v,i)=>{if(present(v))content+=`<circle cx="${x(i)}" cy="${y(v)}" r="${i===rows.length-1?3:1.7}" fill="${color}" stroke="#fff" stroke-width="1"><title>${esc(rows[i].date)}: ${num(v,1)} ${esc(unit)}</title></circle>`;});
    }
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}. ${numeric.length}일 기록. 최소 ${num(Math.min(...numeric),1)}, 최대 ${num(Math.max(...numeric),1)} ${esc(unit)}">${content}</svg><details class="chart-data" data-preserve-key="chart-${esc(key)}-${esc(label)}"><summary>${esc(label)} 숫자 표 보기</summary><div class="table-scroll" tabindex="0" aria-label="${esc(label)} 날짜별 수치"><table class="patient-table"><thead><tr><th scope="col">날짜</th><th scope="col">값 (${esc(unit)})</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.date)}</td><td>${present(row[key])?num(row[key],2):'미기록'}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function stats() {
    const s=state.data.stats;const ts=state.data.trends||[];
    const cards=[['전체 관리 환자',s.patients,'명','users','현재 접근 가능한 환자','환자 수와 관측 수 구분',ts.map(()=>s.patients)],['확인이 필요한 환자',s.needsReview,'명','alert','별도 7일 확인 규칙','임상 진단 아님',ts.map(r=>Math.max(0,s.patients-r.reportingPatients))],[state.startDate?'기준일 기록한 환자':'오늘 기록한 환자',s.reportedAtReferenceDate??s.reportedToday,'명','check','약별·일일·기기·식사 포함',`${state.data.referenceDate||state.data.today} · 전체 ${s.patients}명 중`,ts.map(r=>r.reportingPatients)],['선택 기간 기록일 비율',s.averageCompletion,'%','trend','환자별 달력 날짜 비율 평균','연구계획 완결률과 다름',ts.map(r=>s.patients?r.reportingPatients/s.patients*100:0)]];
    return `<div class="stats-grid">${cards.map((c,i)=>`<section class="stat-card"><div class="stat-label">${esc(c[0])}</div><span class="stat-icon">${icon(c[3])}</span><div class="stat-number">${num(c[1])}<small>${c[2]}</small></div><div class="stat-caption"><b class="${i===1?'amber-text':''}">${esc(c[4])}</b></div><div class="stat-caption">${esc(c[5])}</div>${i>1?`<div class="stat-spark">${spark(c[6],i===2?'#8bb4d2':'#b3a0d0')}</div>`:''}</section>`).join('')}</div>`;
  }
  function filteredPatients() {
    return state.data.patients.filter(p=>(state.filter==='all'||p.risk?.level===state.filter) && `${p.name} ${p.id} ${(p.conditions||[]).join(' ')}`.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  }
  function patientRows(full = false) {
    const patients=filteredPatients();
    if(!patients.length)return `<tr><td colspan="${full?8:6}"><div class="compact-empty">조건에 맞는 환자가 없습니다.</div></td></tr>`;
    return patients.map(p=>`<tr class="patient-row ${p.id===state.selectedId?'selected':''}" data-action="select-patient" data-id="${esc(p.id)}" tabindex="0" aria-label="${esc(p.name)} 환자 상세 보기" aria-selected="${p.id===state.selectedId}"><td><div class="person-cell"><span class="avatar">${esc(p.name.slice(0,1))}</span><div><b>${esc(p.name)}</b><small>${esc(p.id.startsWith('p-')?'신규 데모 환자':p.id.toUpperCase())}</small></div></div></td><td class="patient-age">${num(p.age)}세 · ${sexLabel(p.sex)}</td><td>${riskPill(p.risk)}</td><td class="optional-col"><div class="mini-completion"><i><span style="width:${clamp(val(p.metrics,'completion'),0,100)}%"></span></i>${num(val(p.metrics,'completion'))}%</div></td>${full?`<td class="optional-col">${num(val(p.metrics,'steps'))} <span class="unit-note">걸음</span></td><td class="optional-col">${num(val(p.metrics,'sleepHours'),1)} <span class="unit-note">시간</span></td>`:''}<td>${shortDate(p.lastRecordDate)}${p.lastRecordDate===state.data.today?' <span class="unit-note">오늘</span>':''}</td><td class="row-arrow">${icon('arrow')}</td></tr>`).join('');
  }
  function patientList(full = false) {
    return `<section class="card ${full?'patient-full-card':''}"><div class="card-header"><div><h2>관리 환자 <span class="card-count">${state.data.patients.length}명</span></h2><p class="subheading">기록에 따른 확인 우선순위와 최근 변화를 살펴보세요.</p></div>${!full?`<button class="text-link" data-action="view" data-view="patients">전체 보기 ${icon('arrow')}</button>`:''}</div><div class="patient-controls"><div class="risk-tabs" aria-label="확인 우선순위 필터">${[['all','전체'],['high','확인 우선'],['watch','관찰 필요'],['stable','규칙 미해당'],['insufficient','자료 부족']].map(([key,label])=>`<button class="risk-tab ${state.filter===key?'active':''}" data-action="filter" data-filter="${key}" aria-pressed="${state.filter===key}">${label}</button>`).join('')}</div><label class="search-wrap">${icon('search')}<input id="patient-search" class="search-input" placeholder="환자 이름, 질환 검색" aria-label="환자 이름 또는 질환 검색" value="${esc(state.search)}"></label></div><div class="table-scroll"><table class="patient-table" aria-label="관리 환자 목록"><thead><tr><th>환자</th><th>나이 / 성별</th><th>확인 우선순위</th><th class="optional-col">기간 기록일 비율</th>${full?'<th class="optional-col">평균 활동</th><th class="optional-col">평균 수면</th>':''}<th>마지막 기록일</th><th aria-label="상세 보기"></th></tr></thead><tbody id="patient-table-body">${patientRows(full)}</tbody></table></div><div class="table-footer"><span id="patient-count-label">전체 ${state.data.patients.length}명 중 ${filteredPatients().length}명 표시</span><span>행을 선택하면 기록을 확인할 수 있어요 ${icon('arrow','control-chevron')}</span></div></section>`;
  }
  function briefingCard() {
    const s=state.summary;if(!s)return '';
    const first=s.briefing.items.slice(0,3);
    const headline=s.risk.reasons.length?s.risk.reasons.slice(0,2).join('. ')+'.':'최근 기록의 변화를 확인하고, 방문 시 환자의 생활 상태와 함께 살펴보세요.';
    return `<section class="card briefing-card"><div class="card-header"><h2>방문 전 브리핑</h2><span class="demo-ai-badge">${icon('spark')} DEMO</span></div><div class="briefing-patient"><span class="avatar">${esc(s.patient.name[0])}</span><div><h3>${esc(s.patient.name)} <span class="small-label">${s.patient.age}세 · ${sexLabel(s.patient.sex)}</span></h3><p>${esc((s.patient.conditions||[]).join(' · ')||'기저질환 미입력')}</p></div>${riskPill(s.risk)}</div><div class="briefing-summary"><h4>${icon('spark')}진료 전 확인할 내용</h4><p>${esc(headline)}</p></div><div class="briefing-points">${first.map(item=>`<div class="briefing-point"><span class="briefing-dot"></span><div><b>${esc(item.title)}</b><p>${esc(item.text)}</p></div></div>`).join('')}</div><div class="briefing-foot"><a href="#patient-detail" data-action="open-detail">전체 분석과 근거 보기 ${icon('arrow')}</a><div>기록을 정해진 규칙으로 요약한 데모입니다. 임상적으로 검증된 AI 위험예측이 아닙니다.</div></div></section>`;
  }
  function reportingChart() {
    const t=state.data.trends;
    return `<section class="card chart-card"><div class="card-header"><div><h2>꾸준히 연결되는 일상</h2><p class="subheading">${esc(state.startDate?periodLabel():'최근 14일')} · 약별·일일·기기·식사 기록이 있는 환자</p></div><div class="chart-legend"><span><i></i>기록 환자</span></div></div><div class="chart-wrap">${chart(t,'reportingPatients',{type:'bar',color:'#7db8a3',unit:'명',max:Math.max(state.data.patients.length,1),height:145,label:(state.startDate?periodLabel():'최근 14일')+' 기록 환자 수'})}</div><div class="chart-footer"><span>환자와 돌봄을 이어가는 매일의 기록</span><b>${esc(state.data.referenceDate||state.data.today)} · ${num(state.data.stats.reportedAtReferenceDate??state.data.stats.reportedToday)}명 기록</b></div></section>`;
  }
  function alerts() {
    const alerts=state.data.alerts.slice(0,3);
    return `<section class="card alerts-section"><div class="card-header"><h2>살펴볼 기록</h2><span class="small-label">${esc(state.data.referenceDate||state.data.today)}까지 7일</span></div>${alerts.length?`<div class="alert-list">${alerts.map(a=>`<div class="alert-item ${a.level==='high'?'high':''}"><span class="alert-dot">${icon('alert')}</span><div class="alert-body"><strong>${esc(a.patientName)} · ${esc(a.title)}</strong><p>${esc(a.detail)}</p></div><button data-action="alert-patient" data-id="${esc(a.patientId)}" aria-label="${esc(a.patientName)} 상세 보기">${icon('arrow')}</button></div>`).join('')}</div>`:'<div class="compact-empty">현재 확인 규칙에 해당하는 기록이 없습니다.</div>'}</section>`;
  }
  function metricPanels() {
    const s=state.summary,m=s.metrics,t=state.startDate?s.trends:s.trends.slice(-14);
    const panels=[['steps','steps','평균 활동',num(m.steps.value),'걸음',`${m.steps.coverageDays}/${periodDays()}일 활동 보고`,healthSourceSummary(m.steps),'#7db6a4'],['sleepHours','moon','평균 수면',num(m.sleepHours.value,1),'시간',`${m.sleepHours.coverageDays}/${periodDays()}일 수면 보고`,healthSourceSummary(m.sleepHours),'#a2a0c8'],['medication','pill','일일 복약 자기보고 점수',num(m.medication.value),'%',`${m.medication.takenDays}일 복용 · ${m.medication.reportedDays}일 보고`,'복용 1 · 일부 0.5 · 미복용 0','#b3bf92'],['calories','food','기록된 식사 추정량',m.nutrition.value===null?'산출 불가':num(m.nutrition.value),'kcal',`기록일 평균 · 단백질 ${num(m.nutrition.proteinGrams,1)} g`,'기록일의 추정 합계 평균 · 미기록 식사 제외','#d1af7b']];
    return `<div class="detail-metric-grid">${panels.map(([key,ic,title,value,unit,caption,source,color])=>`<article class="metric-panel"><div class="metric-panel-top">${icon(ic)}${title}</div><h3>${value}<small>${unit}</small></h3><div class="metric-bottom"><span>${esc(caption)}</span></div><div class="metric-trend">${spark(key==='medication'?t.map(r=>r.medicationStatus==='taken'?100:r.medicationStatus==='partial'?50:r.medicationStatus==='missed'?0:null):t.map(r=>r[key]),color)}</div><div class="source-note">${esc(source)}</div></article>`).join('')}</div>`;
  }
  function detailCharts() {
    const t=state.startDate?state.summary.trends:state.summary.trends.slice(-14);
    const medication=t.map(r=>({...r,medValue:r.medicationStatus==='taken'?100:r.medicationStatus==='partial'?50:r.medicationStatus==='missed'?0:null}));
    const chartPeriod=state.startDate?periodLabel():'최근 14일';
    const panels=[['활동 추이',chartPeriod,t,'steps',{unit:'걸음',color:'#73ad98'},healthSourceSummary(state.summary.metrics.steps),'미기록일은 연결하지 않음'],['수면 추이',chartPeriod,t,'sleepHours',{unit:'시간',color:'#a7a1c7'},healthSourceSummary(state.summary.metrics.sleepHours),'수면 질은 별도 평가 필요'],['일일 복약 보고',chartPeriod,medication,'medValue',{unit:'점',color:'#a1b88c',type:'bar',max:100},'100 복용 · 50 일부 · 0 미복용','자기보고 기준'],['식사 기록 추이',chartPeriod,t,'calories',{unit:'kcal',color:'#d5b47e',type:'bar'},'기록된 식사의 영양 추정 합계','실제 섭취량을 확정하지 않음']];
    return `<div class="detail-chart-grid">${panels.map(([title,period,rows,key,options,note,right])=>`<section class="card"><div class="card-header"><h2>${title}</h2><span class="card-count">${period}</span></div><div class="chart-wrap">${chart(rows,key,{...options,height:145,label:title})}</div><div class="chart-footer"><span>${note}</span><span>${right}</span></div></section>`).join('')}</div>`;
  }
  function coverage() {
    const s=state.summary,m=s.metrics;const data=[['활동',m.steps.coverageDays],['수면',m.sleepHours.coverageDays],['일일 복약 보고',m.medication.reportedDays],['약별 복약 보고',m.medication.doseReportedDays],['식사',m.nutrition.recordedDays]];
    return `<section class="card coverage-card"><h3>판단의 시작은, 충분한 기록</h3><p>${esc(periodLabel())} 중 영역별 기록이 있는 날입니다.<br>미기록은 0 또는 정상으로 처리하지 않습니다.</p>${data.map(([label,days])=>`<div class="coverage-row"><span>${label}</span><span class="coverage-bar"><i style="width:${clamp(days/periodDays()*100,0,100)}%"></i></span><b>${num(days)}/${periodDays()}일</b></div>`).join('')}<div class="coverage-note">기록일 비율 ${num(m.completion.value)}% · ${m.completion.reportedDays}/${m.completion.totalDays}일에 약별·일일·기기·식사 기록<br>체중 ${num(m.weightKg.value,1)} kg ${m.weightKg.date?`· ${shortDate(m.weightKg.date)} 보고`:''}</div><div class="risk-reasons"><h4>확인 우선순위의 근거</h4><ul>${s.risk.reasons.length?s.risk.reasons.map(r=>`<li>${esc(r)}</li>`).join(''):`<li>${s.risk.level==='insufficient'?'판단하기에 기록이 충분하지 않습니다.':'현재 데모 확인 규칙에 해당하는 항목이 없습니다.'}</li>`}</ul><p class="coverage-note">${esc(s.risk.disclaimer)}</p></div></section>`;
  }
  function foodIllustration(food) {
    const content={balanced:'<ellipse cx="55" cy="54" rx="14" ry="18" fill="#e9ddc0"/><circle cx="82" cy="37" r="11" fill="#88a276"/><circle cx="93" cy="57" r="10" fill="#c98f6f"/><circle cx="81" cy="77" r="11" fill="#d7ac70"/>',protein:'<path d="M44 58c-11-21 26-31 39-10s-10 43-29 27Z" fill="#b99573"/><path d="m48 50 19 21m-10-27 20 19" stroke="#927357" stroke-width="3" opacity=".4"/><circle cx="88" cy="37" r="9" fill="#91a778"/><circle cx="91" cy="79" r="8" fill="#adb28a"/>',noodles:'<ellipse cx="70" cy="57" rx="29" ry="25" fill="#dfc796"/><path d="M49 52c10-19 35 9 43-9M47 63c16-22 31 10 48-4M54 73c14-17 28 7 34-7" stroke="#b9a06d" stroke-width="3" fill="none"/><circle cx="78" cy="40" r="5" fill="#9dba87"/>',porridge:'<ellipse cx="70" cy="57" rx="30" ry="26" fill="#e2d4b5"/><path d="m56 47 3 2m16-4 2 2m-5 14 3 1m-17 6 4 1m22-16 3 2m-7 17 2 2" stroke="#b5a78a" stroke-width="2.5" stroke-linecap="round"/><path d="m66 50 7-5m-8 22 9-5" stroke="#98ae80" stroke-width="2.5"/>'}[food]||'';
    return `<svg viewBox="0 0 140 110" width="100%" height="100%" role="img" aria-label="음식 유형 예시 일러스트"><rect width="140" height="110" fill="#f0f3ea"/><ellipse cx="72" cy="61" rx="44" ry="41" fill="#d9e1d1" opacity=".4"/><circle cx="70" cy="55" r="39" fill="#fcfcf7"/><circle cx="70" cy="55" r="32" fill="#f3f2e9"/>${content}<path d="M123 23v65m-5-65v15m10-15v15m-10 0q5 7 10 0" stroke="#b4b9a9" stroke-width="2.1" fill="none" stroke-linecap="round"/></svg>`;
  }
  function meals() {
    const meals=state.summary.recentMeals.slice(0,state.view==='records'?24:3);
    return `<section class="card"><div class="card-header"><div><h2>식탁에서 온 기록</h2><p class="subheading">최근 식사 · AI 사진 또는 음식 선택에 따른 영양 추정</p></div><span class="small-label">최근 ${meals.length}건</span></div>${meals.length?`<div class="meal-list">${meals.map(m=>`<article class="meal-item"><div class="meal-visual">${m.imageUrl && /^\/uploads\/[a-zA-Z0-9._-]+$/.test(m.imageUrl)?`<img src="${esc(m.imageUrl)}" alt="${esc(shortDate(m.date))} ${esc(mealLabel(m.mealType))} 식사 사진" loading="lazy">`:foodIllustration(m.foodType)}<span class="food-label">${m.imageUrl?'등록 사진':'예시 그림'}</span></div><h4>${shortDate(m.date)} ${mealLabel(m.mealType)} · ${esc(m.foodLabel||foodLabel(m.foodType))}</h4><p>${m.calories===null?'영양 산출 불가':num(m.calories)+' kcal'} · 단백질 ${m.proteinGrams===null?'산출 불가':num(m.proteinGrams,1)+' g'}</p><small>섭취 비율 ${m.portion===null?'모름':num(m.portion*100)+'%'}</small><small class="meal-source-label">${esc(mealSourceLabel(m))}</small>${m.estimation?`<small>${esc(m.estimation.provider)} / ${esc(m.estimation.model)}</small>`:''}</article>`).join('')}</div>`:'<div class="compact-empty">아직 기록된 식사가 없습니다.</div>'}<div class="source-disclaimer">AI 사진 추정과 음식 선택·비율에 따른 예시 추정을 구별합니다. 환자의 섭취 확인은 자기보고이며 실제 영양량의 임상 검증이 아닙니다.</div></section>`;
  }
  function recordTable(full = false) {
    const records=state.summary?.recentRecords.slice(0,full?366:5)||[];
    return `<div class="table-scroll"><table class="patient-table records-table ${full?'record-full':''}" aria-label="환자 일일 건강 기록"><thead><tr><th>날짜</th><th>활동</th><th>수면</th><th>복약 보고</th>${full?'<th>식욕</th><th>기분</th><th>체중</th>':''}<th>메모</th></tr></thead><tbody>${records.length?records.map(r=>`<tr><td>${shortDate(r.date)}</td><td>${num(r.steps)} <span class="unit-note">걸음</span><small class="record-source">${r.steps===null?'미측정':esc(healthSourceName(r.stepsSource))}</small></td><td>${num(r.sleepHours,1)} <span class="unit-note">h</span><small class="record-source">${r.sleepHours===null?'미측정':esc(healthSourceName(r.sleepSource))}</small></td><td><span class="med-dot ${r.medicationStatus==='missed'?'no':r.medicationStatus==='partial'?'partial':r.medicationStatus==='taken'?'yes':'unknown'}"></span>${medLabel(r.medicationStatus)}</td>${full?`<td>${esc({good:'좋음',normal:'보통',poor:'저하'}[r.appetite]||'미기록')}</td><td>${esc({good:'좋음',normal:'보통',poor:'좋지 않음'}[r.mood]||'미기록')}</td><td>${num(r.weightKg,1)} <span class="unit-note">kg</span></td>`:''}<td class="record-note">${r.note?`<details data-preserve-key="note-${esc(r.id||r.date)}"><summary>메모 보기</summary><p>${esc(r.note)}</p></details>`:'—'}</td></tr>`).join(''):`<tr><td colspan="${full?8:5}"><div class="compact-empty">아직 일일 기록이 없습니다. 환자용 사이트에서 첫 기록을 남겨보세요.</div></td></tr>`}</tbody></table></div>`;
  }
  function recentRecords() { return `<section class="card"><div class="card-header"><div><h2>최근 건강 기록</h2><p class="subheading">${esc(state.summary.patient.name)} 님 · 항목별 출처 표시</p></div><button class="text-link" data-action="view" data-view="records">전체 보기 ${icon('arrow')}</button></div>${recordTable()}</section>`; }
  function expandedBriefing() {
    const s=state.summary;
    return `<section class="card briefing-expanded"><h3>근거와 함께 보는 브리핑 <span class="demo-ai-badge" style="display:inline-flex;margin-left:6px">규칙 기반 데모</span></h3><p>각 요약은 아래에 표시된 저장 기록에서 만들어졌습니다. 충분하지 않은 자료는 추가 확인해 주세요.</p>${s.briefing.items.map(item=>`<article class="briefing-evidence-item"><h4>${esc(item.title)}</h4><p>${esc(item.text)}</p><div class="evidence-list">${item.evidence.slice(-4).map(e=>`<span class="evidence-tag">${shortDate(e.date)} · ${esc(e.source==='demo-food-table-v1'?'음식표 예시 추정':e.source==='openai-image-estimate-v1'?'AI 사진 영양 추정':['patient-self-report','health-connect','apple-health'].includes(e.source)?healthSourceName(e.source):e.source)} · ${esc(typeof e.value==='string'?({taken:'복용',partial:'일부 복용',missed:'미복용',unknown:'알 수 없음'}[e.value]||e.value):num(e.value,1))}</span>`).join('')}</div></article>`).join('')}</section>`;
  }
  function patientDetails(expanded = false) {
    const s=state.summary;if(!s)return '';
    return `<section id="patient-detail"><div class="section-heading"><div><div class="detail-topline"><h2>${esc(s.patient.name)} 님의 일상 변화</h2>${riskPill(s.risk)}</div><p>${esc(periodLabel())} 요약 · 기록된 날의 평균과 자료수를 함께 확인하세요. ${esc(s.risk.windowLabel||'확인 규칙은 별도 최근7일 기준입니다.')}</p></div><div class="section-action-group"><span class="small-label">${shortDate(s.period?.startDate||s.trends.at(-7)?.date)} — ${shortDate(s.period?.endDate||s.today)}</span><button class="text-link" data-action="invitation">환자 연결코드</button><button class="text-link" data-action="view" data-view="messages">메시지</button><button class="text-link" data-action="view" data-view="medications">복약 계획 ${icon('pill')}</button><a class="text-link" href="/patient?patientId=${encodeURIComponent(s.patient.id)}" target="_blank" rel="noopener">환자 화면 ${icon('external')}</a></div></div>${metricPanels()}<div class="detail-analysis-grid">${detailCharts()}${coverage()}</div><div class="meals-records-grid">${meals()}${recentRecords()}</div><div class="notes-questions"><h3>${icon('chat')}다음 방문에서 물어보세요</h3><ul>${s.briefing.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul></div>${expanded?expandedBriefing():''}</section>`;
  }
  function emptyWorkspace() {
    return `<section class="card empty-state"><div class="empty-icon">${icon('users')}</div><h3>새로운 돌봄을 시작할 준비가 되었어요</h3><p>가상 환자를 추가하고 환자용 사이트에서 기록을 남겨보세요.<br>예시 데이터를 복원하면 모든 화면을 바로 체험할 수 있습니다.</p><button class="button button-primary" data-action="add-patient">${icon('plus')}가상 환자 추가</button><button class="button button-secondary" data-action="reset" data-mode="seed">${icon('refresh')}예시 데이터 복원</button></section>`;
  }
  function overview() {
    return `${stats()}${state.data.patients.length?`<div class="overview-grid"><div>${patientList()}${reportingChart()}</div><div class="overview-aside">${briefingCard()}${alerts()}</div></div>${patientDetails()}`:emptyWorkspace()}`;
  }
  function patientsView() {
    if(!state.data.patients.length)return emptyWorkspace();
    const s=state.summary;
    return `${patientList(true)}${s?`<div class="patient-workspace"><section class="selected-patient-banner"><span class="avatar">${esc(s.patient.name[0])}</span><div><h2>${esc(s.patient.name)} <span class="small-label">${s.patient.age}세 · ${sexLabel(s.patient.sex)}</span></h2><p>${esc(s.patient.conditions.join(' · ')||'기저질환 미입력')} · ${esc(s.patient.caregiver||'돌봄 정보 미입력')}</p></div><div class="banner-meta"><div>이전 참고 메모 · 처방 아님<b>${esc(s.patient.medications.join(' · ')||'미입력')}</b></div>${riskPill(s.risk)}</div><a href="/patient?patientId=${encodeURIComponent(s.patient.id)}" target="_blank" rel="noopener" class="button button-secondary">${icon('external')}환자 화면 열기</a></section>${patientDetails(true)}</div>`:''}`;
  }
  function recordsView() {
    if(!state.data.patients.length)return emptyWorkspace();
    return `<div class="records-toolbar"><label for="record-patient">환자 선택<select id="record-patient">${state.data.patients.map(p=>`<option value="${esc(p.id)}" ${p.id===state.selectedId?'selected':''}>${esc(p.name)} · ${p.age}세</option>`).join('')}</select></label><button class="button button-secondary" data-action="export-preview">${icon('download')}범위 확인 후 CSV 내보내기</button></div><section class="card"><div class="card-header"><div><h2>${esc(state.summary?.patient.name)} 님의 건강 기록</h2><p class="subheading">${esc(state.startDate?periodLabel():'최근 제공 기록')} · 제공된 일일 기록 ${state.summary?.recentRecords.length||0}건 · 빈칸은 미측정입니다.</p></div><span class="small-label">환자 자기보고</span></div>${recordTable(true)}</section><div class="meals-records-grid">${meals()}${coverage()}</div><div class="provenance-card"><b>기록과 분석의 출처</b><br>활동·수면은 수동 자기보고와 선택된 건강 연결의 수신 자료를 항목별로 구분합니다. 웹이 기기 자료를 직접 읽지는 않습니다. 복약은 자기보고입니다. 영양값은 AI 사진 추정 또는 음식 선택·비율을 적용한 예시 추정이며 출처를 함께 표시합니다. CSV에는 환자·일일·식사 기록이 함께 포함됩니다.</div>`;
  }
  async function loadIntegrationSettings({renderAfter=true}={}) {
    if(state.capabilityLoading)return;
    state.capabilityLoading=true;state.capabilityError=false;
    try { state.capabilities=await api('/api/capabilities'); }
    catch { state.capabilities=null;state.capabilityError=true; }
    finally {state.capabilityLoading=false;if(renderAfter && state.view==='settings')render();}
  }
  function integrationSettings() {
    const vision=state.capabilities?.vision;
    const status=state.capabilityError?'설정 상태 조회 실패':!vision?'설정 상태 확인 중':vision.available?'서버 설정 준비됨 · 실제 분석 필요':vision.reasonCode==='missing_key'?'OpenAI API 키 설정 필요':vision.reasonCode==='invalid_model'?'모델 설정 확인 필요':vision.enabled?'제공자 설정 필요':'사진 AI 비활성';
    return `<section class="card" id="integration-settings"><div class="card-header"><div><h2>GPT 사진 분석·건강 연결</h2><p class="subheading">설정 확인은 유료 분석을 호출하지 않습니다.</p></div></div><div class="settings-body"><div class="settings-row"><div><h3>사진 분석 상태</h3><p id="vision-config-status" role="status">${esc(status)}</p><p>모델: ${esc(vision?.model||'확인되지 않음')} · 준비 상태는 실제 인증·잔액·사진 추론 성공의 증거가 아닙니다.</p></div><button class="button button-secondary" data-action="check-integrations" ${state.capabilityLoading?'disabled':''}>설정 다시 확인</button></div><div class="settings-row"><div><h3>활성화 방법</h3><p>Render Environment에서 HOMECARE_VISION_API_KEY, VISION_ENABLED=true, VISION_MODEL을 설정하세요. 키를 이 화면이나 채팅에 입력하지 마세요.</p><p>사진 초안을 확인하고 실제 섭취비율을 저장하면 칼로리·단백질에 적용됩니다. API 사용료는 별도입니다.</p></div></div><div class="settings-row"><div><h3>아이폰 우선 건강 연결</h3><p>환자 웹의 건강 연결에서 iPhone 코드를 준비하고 별도 HealthKit 연결 앱에 입력합니다. 앱 서명·설치와 실제 권한·수신 검증이 필요합니다. Safari는 Apple 건강을 직접 읽지 않습니다.</p></div></div></div></section>`;
  }
  function settingsView() {
    return `<div class="settings-grid">${integrationSettings()}<section class="card"><div class="card-header"><div><h2>연결된 데모 환경</h2><p class="subheading">환자와 의료진 화면이 같은 테스트 데이터를 사용합니다.</p></div><span class="settings-tag">연결됨</span></div><div class="settings-body"><div class="settings-row"><div><h3>환자용 모바일 사이트</h3><p>모바일 화면에서 건강·식사 기록을 남기고, 의료진 화면에서 결과를 확인할 수 있습니다.</p></div><a class="button button-secondary" href="/patient${state.selectedId?`?patientId=${encodeURIComponent(state.selectedId)}`:''}" target="_blank" rel="noopener">사이트 열기 ${icon('external')}</a></div><div class="settings-row"><div><h3>테스트 기록 내보내기</h3><p>등록 환자와 일일·식사 기록을 CSV 파일로 내려받습니다. 초기화 전에 필요한 기록을 보관하세요.</p></div><button class="button button-secondary" data-action="export-preview">${icon('download')}범위 확인 후 CSV 받기</button></div><div class="settings-row"><div><h3>기록 자동 갱신</h3><p>20초마다 새 기록을 확인합니다. 새로고침 버튼으로 즉시 갱신할 수도 있습니다.</p></div><span class="settings-tag">사용 중</span></div></div></section><section class="card danger-card"><div class="card-header"><div><h2>테스트 데이터 초기화</h2><p class="subheading">실행 전 확인 문구를 입력해야 합니다.</p></div>${icon('database')}</div><div class="settings-body"><div class="settings-row"><div><h3>예시 데이터로 다시 시작</h3><p>현재 테스트 기록을 지우고, 가상 환자 6명과 4주 예시 기록을 복원합니다. 업로드 사진도 삭제됩니다.</p></div><button class="button button-secondary" data-action="reset" data-mode="seed">예시 데이터 복원</button></div><div class="settings-row"><div><h3>빈 데이터베이스로 시작</h3><p>환자·건강 기록·식사 기록과 업로드 사진을 모두 삭제합니다. 새 가상 환자를 등록해 테스트할 수 있습니다.</p></div><button class="button button-danger" data-action="reset" data-mode="empty">모든 테스트 데이터 삭제</button></div><p class="settings-detail">초기화 후에는 기록을 되돌릴 수 없습니다. 연구 투입 전에는 로그인·권한·동의·보안·기관 승인을 별도로 갖춰야 합니다.</p></div></section><section class="card"><div class="card-header"><h2>데모 결과를 읽는 방법</h2></div><div class="settings-body settings-detail"><ul><li>확인 우선순위는 기록에 정해진 데모 규칙을 적용한 결과이며, 질병 발생 확률이나 확정 진단이 아닙니다.</li><li>복약은 자기보고이며 실제 복용을 확정하지 않습니다.</li><li>사진 분석이 설정되고 전송에 동의한 경우 AI 검토 초안을 만들며, 사진만으로 처방이나 복용 사실을 확정하지 않습니다.</li><li>영양값은 AI 사진 추정과 수동 음식 선택·비율 예시 추정을 구분하며, 환자가 섭취량을 확인해도 임상적으로 검증된 값은 아닙니다.</li><li>미기록은 0 또는 정상으로 대체하지 않으며, 판단 시 기록 일수를 함께 보아야 합니다.</li></ul></div></section><section class="card"><div class="card-header"><h2>현재 워크스페이스</h2></div><div class="settings-body settings-detail">등록 환자 <b>${state.data.stats.patients}명</b><br>오늘 기록 <b>${state.data.stats.reportedToday}명</b><br>예시 기준일 <b>${esc(state.data.today)}</b><br>시간대 <b>대한민국 (Asia/Seoul)</b><br>최근 초기화 <b>${state.data.resetAt?esc(new Date(state.data.resetAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'아직 없음'}</b><br><br>저장된 테스트 기록은 페이지를 새로 열어도 유지됩니다. 이 공개 데모에는 실제 환자 개인정보를 입력하지 마세요.</div></section></div>`;
  }
  const medicationStatusLabel = status => ({taken:'복용 보고',missed:'미복용 보고',unknown:'기억 안 남',pending:'미응답'}[status] || '미응답');
  const medicationReason = reason => ({forgot:'깜빡함',side_effect:'불편한 증상',side_effects:'불편한 증상',unavailable:'약이 없음',refused:'복용 원치 않음',other:'기타',not_sure:'잘 모르겠음'}[reason] || reason || '미입력');
  const reportTime = timestamp => timestamp ? new Date(timestamp).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : '보고 없음';
  const medDate = () => state.medicationDate || state.data?.today || state.summary?.today || '';
  const medicationCurrent = () => state.medications?.patientId===state.selectedId && state.medications?.date===medDate() ? state.medications : null;
  const orderActive = order => order.startDate<=state.data.today && (!order.endDate || order.endDate>=state.data.today);
  function orderPeriodLabel(order) {
    if(order.startDate>state.data.today)return '시작 예정';
    if(order.endDate && order.endDate<state.data.today)return '종료';
    if(order.status==='ended')return '종료 예정';
    return '진행 중';
  }
  async function loadMedications({renderAfter=true}={}) {
    if(!state.selectedId)return;
    const patientId=state.selectedId,date=medDate(),generation=++state.medicationRequest;
    state.medicationLoading=true;state.medicationError='';
    try {
      const base=`/api/patients/${encodeURIComponent(patientId)}`;
      const [orders,schedule,events]=await Promise.all([api(`${base}/medication-orders`),api(`${base}/medication-schedule?date=${encodeURIComponent(date)}`),api(`${base}/medication-events?date=${encodeURIComponent(date)}`)]);
      if(generation!==state.medicationRequest || patientId!==state.selectedId || date!==medDate())return;
      state.medications={patientId,date,orders:orders.orders||[],schedule,events:events.events||[],audit:events.audit||[],photoReports:events.photoReports||[]};
    } catch(error) {
      if(generation!==state.medicationRequest || patientId!==state.selectedId || date!==medDate())return;
      state.medicationError=error.message;
    } finally {
      if(generation===state.medicationRequest) {
        state.medicationLoading=false;
        if(renderAfter && state.view==='medications')render();
      }
    }
  }
  function medicationOrdersCard(data) {
    const active=data.orders.filter(orderActive).length;
    return `<section class="card medication-orders-card"><div class="card-header"><div><h2>의료진이 확정한 복약 계획 <span class="card-count">현재 ${active}개</span></h2><p class="subheading">이름·용량·시각이 확정된 계획입니다. 종료된 계획도 보존합니다.</p></div><span class="small-label">전체 ${data.orders.length}개</span></div>${data.orders.length?`<div class="medication-order-list">${data.orders.map(order=>`<article class="medication-order ${orderPeriodLabel(order)==='종료'?'ended':''}" data-order-id="${esc(order.id)}"><div class="medication-order-title"><span class="medication-pill-icon">${icon('pill')}</span><div><h3>${esc(order.name)} <small>${esc(order.strength)}</small></h3><p>1회 ${esc(order.dose)}${order.route?` · ${esc(order.route)}`:''}</p></div><span class="order-state ${orderActive(order)?'active':''}">${orderPeriodLabel(order)}</span></div><dl class="medication-order-meta"><div><dt>예정 시각</dt><dd>${order.times.map(time=>`<span class="medication-time">${esc(time)}</span>`).join('')}</dd></div><div><dt>계획 기간</dt><dd>${esc(order.startDate)} — ${esc(order.endDate||'종료일 미지정')}</dd></div><div><dt>주의·안내</dt><dd>${esc(order.instructions||'등록된 안내 없음')}</dd></div></dl><div class="medication-order-foot"><span>의료진 확인 계획 · 기존 보고 보존</span>${order.status!=='ended' && (!order.endDate || order.endDate>=state.data.today)?`<button class="text-link" data-action="end-medication-order" data-id="${esc(order.id)}">계획 종료 ${icon('arrow')}</button>`:'<span>종료일 이후 예정 회차 없음</span>'}</div></article>`).join('')}</div>`:`<div class="medication-empty"><span class="medication-empty-icon">${icon('pill')}</span><h3>확정된 복약 계획이 없습니다</h3><p>약명과 용량을 직접 확인한 뒤 계획을 등록해 주세요.<br>기존 질환명이나 일반적인 복약 문구로 약을 추정하지 않습니다.</p><button class="button button-primary" data-action="add-medication-order">${icon('plus')}확정 복약 계획 등록</button></div>`}${data.orders.length && !active?'<div class="source-disclaimer">현재 진행 중인 확정 계획은 0개입니다. 위 목록은 시작 예정 또는 종료된 계획이며, 과거 기록은 그대로 보존됩니다.</div>':''}</section>`;
  }
  function medicationScheduleCard(data) {
    const schedule=data.schedule,totals=schedule.summary||{},slots=schedule.slots||[];
    return `<section class="card medication-schedule-card"><div class="card-header"><div><h2>날짜별 복약 자기보고</h2><p class="subheading">${esc(data.date)} · 예정 회차 ${slots.length}개</p></div><span class="small-label">보고 시각 ≠ 실제 복용 시각</span></div><div class="medication-report-stats">${[['taken','복용'],['missed','미복용'],['unknown','기억 안 남'],['pending','미응답']].map(([key,label])=>`<div><b class="medication-text-${key}">${num(totals[key]??slots.filter(s=>s.status===key).length)}</b><span>${label}</span></div>`).join('')}</div>${slots.length?`<div class="medication-slots">${slots.map(slot=>`<article class="medication-slot"><div class="medication-slot-top"><span class="medication-slot-time">${esc(slot.time)}</span><div><strong>${esc(slot.name)}</strong><span>${esc([slot.strength,slot.dose].filter(Boolean).join(' · '))}</span></div><span class="medication-status ${['taken','missed','unknown','pending'].includes(slot.status)?slot.status:'pending'}">${medicationStatusLabel(slot.status)}</span></div>${slot.status!=='pending'?`<div class="medication-slot-report"><p><b>사유</b>${esc(medicationReason(slot.reason))}</p><p><b>메모</b>${esc(slot.note||'미입력')}</p></div><div class="medication-slot-foot"><span>${reportTime(slot.reportedAt)} · 보고 수정 ${Math.max(0,Number(slot.revision||1)-1)}회</span><button class="text-link" data-action="medication-history" data-order-id="${esc(slot.orderId)}" data-time="${esc(slot.time)}">보고·변경 이력 ${icon('arrow')}</button></div>`:'<p class="medication-pending-note">아직 응답이 없습니다. 미복용으로 처리하지 않습니다.</p>'}</article>`).join('')}</div>`:'<div class="compact-empty">선택한 날짜에 예정된 복약 회차가 없습니다.<br>계획 기간과 예정 시각을 확인해 주세요.</div>'}<div class="source-disclaimer">약별 회차 자기보고입니다. 기존 ‘일일 복약 자기보고 점수’와 별개의 기록이며, 실제 복용을 증명하지 않습니다.</div></section>`;
  }
  function medicationPhotoReportsCard(data) {
    const reports=data.photoReports||[];
    return `<section class="card medication-photo-reports"><div class="card-header"><div><h2>사진을 첨부한 복약 자기보고</h2><p class="subheading">${esc(data.date)} · 최신 20건까지 · 전체 검토는 업무 목록에서 확인하세요. 사진은 복용 사실을 증명하지 않습니다.</p></div></div><div class="settings-body">${reports.length?reports.map(report=>`<details class="medication-photo-report" data-preserve-key="photo-${esc(report.id)}"><summary>${reportTime(report.createdAt)} · ${report.events.length}회차 · ${esc({reviewed:'사진 검토됨',needs_information:'추가 확인 필요'}[report.reviewStatus]||'의료진 미검토')}</summary><p class="source-disclaimer">당시 환자 자기보고입니다. 이후 수정된 현재 상태는 위 회차 목록에서 확인하세요. 사진·OCR만으로 복용량이나 실제 복용을 확정하지 않습니다.</p><img loading="lazy" src="${esc(report.imageUrl)}" alt="환자가 첨부한 약봉투 또는 포장 사진"><h3>당시 보고</h3>${report.events.map(event=>`<p><b>${esc(event.time)} · ${esc(event.name)} ${esc(event.strength)}</b> · ${medicationStatusLabel(event.status)} · 당시 보고 ${event.revision}차<br>사유: ${esc(event.reason||'미입력')} / 메모: ${esc(event.note||'미입력')}</p>`).join('')}<h3>AI가 읽은 포장 글자 후보 · 미확정</h3>${report.analysis.proposal.medications.map(candidate=>`<p><b>${esc(candidate.name)} ${esc(candidate.strength)}</b><br>${esc(candidate.labelText)}</p>`).join('')||'<p>읽힌 약명 없음 · 환자가 직접 계획을 대조함</p>'}<p class="subheading">${esc(report.analysis.provider)} · ${esc(report.analysis.model)} · ${reportTime(report.analysis.createdAt)}</p></details>`).join(''):'<p class="compact-empty">이 날짜에 사진을 첨부한 보고가 없습니다.</p>'}</div></section>`;
  }
  function medicationsView() {
    if(!state.data.patients.length)return emptyWorkspace();
    const data=medicationCurrent();
    return `<div class="medication-toolbar"><label for="medication-patient">환자<select id="medication-patient">${state.data.patients.map(p=>`<option value="${esc(p.id)}" ${p.id===state.selectedId?'selected':''}>${esc(p.name)} · ${p.age}세</option>`).join('')}</select></label><label for="medication-date">보고 날짜<input id="medication-date" type="date" value="${esc(medDate())}"></label><button class="button button-primary" data-action="add-medication-order">${icon('plus')}확정 복약 계획 등록</button></div><div class="medication-context-note">${icon('shield')}<p><b>${esc(state.summary?.patient.name||'선택 환자')} 님의 확정 계획과 자기보고</b><br>약 사진은 읽을 수 있는 글자의 후보만 제공합니다. 1회량·복용 시각은 의료진이 확인하여 등록합니다.</p></div>${state.medicationError?`<div class="medication-load-error" role="alert">복약 자료를 불러오지 못했습니다. ${esc(state.medicationError)}<button class="button button-secondary" data-action="reload-medications">다시 불러오기</button></div>`:''}${!data?`<div class="loading-state medication-loading"><span class="spinner"></span><b>${state.medicationLoading?'복약 계획과 보고를 불러오고 있어요':'복약 자료를 불러와 주세요'}</b></div>`:`<div class="medication-layout">${medicationOrdersCard(data)}${medicationScheduleCard(data)}</div>${medicationPhotoReportsCard(data)}`}<div class="medication-legacy-note"><b>이전 참고 메모 · 확정 처방 아님</b><p>${esc((state.summary?.patient.medications||[]).join(' · ')||'등록된 참고 메모 없음')}</p><span>위 일반 문구는 복약 계획으로 자동 전환하거나 용량·시간을 추론하지 않습니다.</span></div>`;
  }
  function medicationModalFrame(type,title,description) {
    state.lastFocus=document.activeElement;
    state.modal={type,patientId:state.selectedId,date:medDate(),photoGeneration:++state.photoGeneration,photo:null,busy:false};
    $('#modal-backdrop').hidden=false;document.body.style.overflow='hidden';
    $('#modal').classList.add('medication-modal');
    $('#modal').innerHTML=`<div class="modal-top"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-modal-action="close" aria-label="닫기">${icon('close')}</button></div><p class="modal-description">${esc(description)}</p>`;
  }
  function openMedicationOrder() {
    if(!state.selectedId)return;
    medicationModalFrame('medication-order','확정 복약 계획 등록',`${state.summary?.patient.name||'선택 환자'} 님의 약명·함량·1회량·용법·시각을 직접 확인한 뒤 등록해 주세요.`);
    $('#modal').insertAdjacentHTML('beforeend',`<form id="medication-order-form"><details class="medication-photo-helper"><summary>${icon('spark')}약 봉투·포장 사진으로 이름·함량 작성 보조</summary><p class="medication-photo-notice" id="medication-vision-status">사진 분석 설정을 확인하고 있습니다. 아래 항목은 수동으로 작성할 수 있습니다.</p><div class="medication-photo-controls"><input id="medication-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled aria-label="약 봉투 또는 포장 사진"><img id="medication-photo-preview" alt="확인할 약 봉투·포장 사진" hidden><label class="medication-consent"><input id="medication-photo-consent" type="checkbox" disabled>약 사진을 외부 AI 제공자에게 전송하는 데 동의합니다. 실제 개인정보가 보이지 않는 사진을 사용합니다.</label><button type="button" id="analyze-medication-photo" class="button button-secondary" disabled>${icon('spark')}약명·함량 후보 읽기</button><p class="form-error" id="medication-photo-error" role="alert" hidden></p><div id="medication-photo-candidates" aria-live="polite"></div></div></details><div class="form-row"><div class="field"><label for="medication-name">약명 *</label><input id="medication-name" name="name" maxlength="120" required placeholder="확인한 정확한 약명" autocomplete="off"></div><div class="field"><label for="medication-strength">함량 <small>선택 · 확인한 값만</small></label><input id="medication-strength" name="strength" maxlength="100" placeholder="예: 5 mg" autocomplete="off"></div></div><div class="form-row"><div class="field"><label for="medication-dose">1회량 *</label><input id="medication-dose" name="dose" maxlength="100" required placeholder="예: 1정" autocomplete="off"></div><div class="field"><label for="medication-route">투여 방법 <small>선택</small></label><input id="medication-route" name="route" maxlength="80" placeholder="예: 경구" autocomplete="off"></div></div><fieldset class="medication-times-field"><legend>복용 예정 시각 *</legend><div id="medication-times"><div class="medication-time-row"><input type="time" name="times" required aria-label="복용 예정 시각 1"><button type="button" class="text-link" data-modal-action="add-time">${icon('plus')}시각 추가</button></div></div><p>정기적으로 보고할 회차를 정합니다. 사진이나 기존 메모에서 자동 추정하지 않습니다.</p></fieldset><div class="form-row"><div class="field"><label for="medication-start-date">시작일 *</label><input id="medication-start-date" name="startDate" type="date" value="${esc(state.data.today)}" required></div><div class="field"><label for="medication-end-date">종료일 <small>선택 · 해당일 포함</small></label><input id="medication-end-date" name="endDate" type="date" min="${esc(state.data.today)}"></div></div><div class="field"><label for="medication-instructions">주의·복용 안내 <small>선택</small></label><textarea id="medication-instructions" name="instructions" rows="2" maxlength="2000" placeholder="의료진이 확인한 복용 안내"></textarea></div><label class="medication-confirmation"><input id="medication-order-confirmed" type="checkbox" required>확인한 약명·1회량·기간·시각과 선택 입력 항목을 검토했으며 이 계획을 등록합니다.</label><p class="form-error" id="modal-error" role="alert" hidden></p><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">취소</button><button type="submit" class="button button-primary">복약 계획 확정 등록</button></div></form>`);
    rememberModal();$('#medication-name').focus();
    loadMedicationCapability(state.modal.photoGeneration);
  }
  async function loadMedicationCapability(generation) {
    try {
      const capabilities=await api('/api/capabilities');
      if(!state.modal || state.modal.type!=='medication-order' || state.modal.photoGeneration!==generation)return;
      const enabled=capabilities.vision?.available===true;
      state.modal.visionEnabled=enabled;
      $('#medication-vision-status').textContent=enabled?'사진의 읽을 수 있는 약명·함량 후보를 찾습니다. 복용량·시각은 자동 확정하지 않습니다.':`${capabilities.vision?.reason||'현재 사진 분석을 사용할 수 없습니다.'} 아래에서 복약 계획을 직접 작성해 주세요.`;
      $('#medication-photo').disabled=!enabled;$('#medication-photo-consent').disabled=!enabled;
    } catch(error) {
      if(state.modal?.type==='medication-order' && state.modal.photoGeneration===generation)$('#medication-vision-status').textContent='사진 분석 설정을 확인하지 못했습니다. 복약 계획은 직접 작성할 수 있습니다.';
    }
  }
  function updatePhotoAnalyzeButton() {
    if(state.modal?.type!=='medication-order' || !$('#analyze-medication-photo'))return;
    $('#analyze-medication-photo').disabled=!state.modal.visionEnabled || !state.modal.photo?.imageData || !$('#medication-photo-consent').checked || state.modal.busy;
  }
  function clearMedicationPhoto() {
    state.photoAbort?.abort();state.photoAbort=null;
    if(state.modal?.type!=='medication-order')return;
    state.modal.photoGeneration=++state.photoGeneration;state.modal.photo=null;state.modal.busy=false;
    $('#medication-photo-candidates').innerHTML='';$('#medication-photo-error').hidden=true;
    $('#medication-photo-preview').hidden=true;$('#medication-photo-preview').removeAttribute('src');
    updatePhotoAnalyzeButton();
  }
  function readMedicationPhoto(file) {
    clearMedicationPhoto();
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) {
      $('#medication-photo-error').textContent='JPEG·PNG·WebP 사진을 5MB 이하로 선택해 주세요.';$('#medication-photo-error').hidden=false;return;
    }
    const generation=state.modal.photoGeneration,patientId=state.modal.patientId;
    const reader=new FileReader();
    reader.onload=()=>{
      if(state.modal?.type!=='medication-order' || state.modal.photoGeneration!==generation || state.modal.patientId!==patientId)return;
      state.modal.photo={imageData:reader.result,analysis:null};$('#medication-photo-preview').src=reader.result;$('#medication-photo-preview').hidden=false;updatePhotoAnalyzeButton();
    };
    reader.onerror=()=>{if(state.modal?.photoGeneration===generation){$('#medication-photo-error').textContent='사진을 읽지 못했습니다. 다른 사진을 선택하거나 직접 작성해 주세요.';$('#medication-photo-error').hidden=false;}};
    reader.readAsDataURL(file);
  }
  async function analyzeMedicationPhoto() {
    const modal=state.modal;
    if(modal?.type!=='medication-order' || !modal.photo?.imageData || !$('#medication-photo-consent').checked || modal.busy)return;
    const generation=modal.photoGeneration,patientId=modal.patientId;
    modal.busy=true;$('#medication-photo-error').hidden=true;$('#medication-photo-candidates').innerHTML='';updatePhotoAnalyzeButton();
    state.photoAbort=new AbortController();
    try {
      const result=await api(`/api/patients/${encodeURIComponent(patientId)}/photo-analyses`,{method:'POST',body:JSON.stringify({kind:'medication',imageData:modal.photo.imageData,consentExternalProcessing:true}),signal:state.photoAbort.signal});
      if(state.modal!==modal || modal.photoGeneration!==generation || state.selectedId!==patientId)return;
      const analysis=result.analysis;
      if(analysis?.patientId!==patientId || analysis.kind!=='medication')throw new Error('현재 환자의 약 사진 초안이 아닙니다. 다시 확인해 주세요.');
      modal.photo.analysis=analysis;
      const candidates=analysis.proposal?.medications||[];
      $('#medication-photo-candidates').innerHTML=`<div class="medication-analysis-source">검토 초안 · ${esc(analysis.provider)} / ${esc(analysis.model)} · ${reportTime(analysis.createdAt)}</div>${candidates.length?candidates.map((candidate,index)=>`<article class="medication-candidate"><h4>${esc(candidate.name||'약명 판독 안 됨')} <small>${esc(candidate.strength||'함량 판독 안 됨')}</small></h4><p>읽은 글자: ${esc(candidate.labelText||'판독 가능한 글자 없음')}</p><label><input type="checkbox" data-candidate-confirm="${index}">포장·원문과 이름·함량을 직접 대조했습니다.</label><button type="button" class="button button-secondary" data-modal-action="use-medication-candidate" data-candidate="${index}" disabled>이름·함량만 가져오기</button></article>`).join(''):'<p class="medication-photo-notice">확인 가능한 약명 후보를 찾지 못했습니다. 아래 항목을 직접 작성해 주세요.</p>'}${(analysis.warnings||[]).map(w=>`<p class="medication-photo-notice">${esc(w)}</p>`).join('')}<p class="medication-photo-notice">사진은 복용 사실이나 처방을 확정하지 않습니다. 1회량·용법·복용 시각은 별도로 확인하세요.</p>`;
    } catch(error) {
      if(state.modal!==modal || modal.photoGeneration!==generation || error.name==='AbortError')return;
      $('#medication-photo-error').textContent=`${error.message} 사진 분석 없이 아래 항목을 직접 작성할 수 있습니다.`;$('#medication-photo-error').hidden=false;
    } finally {
      if(state.modal===modal && modal.photoGeneration===generation){modal.busy=false;updatePhotoAnalyzeButton();}
    }
  }
  function useMedicationCandidate(index) {
    const candidate=state.modal?.photo?.analysis?.proposal?.medications?.[index];
    if(!candidate || !$('#modal').querySelector(`[data-candidate-confirm="${index}"]`)?.checked)return;
    $('#medication-name').value=candidate.name||'';$('#medication-strength').value=candidate.strength||'';
    $('#medication-order-confirmed').checked=false;
    $('#medication-name').focus();
    toast('이름·함량 후보를 가져왔습니다. 1회량·용법·시각을 직접 확인해 주세요.');
  }
  function openMedicationEnd(id) {
    const order=medicationCurrent()?.orders.find(item=>item.id===id);if(!order)return;
    medicationModalFrame('medication-end','복약 계획 종료',`${order.name} · ${order.strength} 계획의 마지막 유효일을 정합니다. 약 복용 중단 여부는 의료진의 판단으로 확인해 주세요.`);
    state.modal.orderId=id;
    const minimum=order.startDate>state.data.today?order.startDate:state.data.today;
    $('#modal').insertAdjacentHTML('beforeend',`<div class="medication-end-notice">선택한 날짜의 예정 회차까지 유효합니다. 다음 날부터 예정 회차가 없어지며, 기존 복약 보고와 변경 이력은 삭제되지 않습니다. 약명·용량 변경이 필요하면 기존 계획을 종료하고 새 계획을 등록하세요.</div><form id="medication-end-form"><div class="field"><label for="medication-stop-date">마지막 유효일 · 해당일 포함 *</label><input id="medication-stop-date" type="date" name="endDate" min="${minimum}" ${order.endDate?`max="${esc(order.endDate)}"`:''} value="${minimum}" required></div><label class="medication-confirmation"><input id="medication-end-confirmed" type="checkbox" required>종료일과 과거 기록 보존을 확인했습니다.</label><p class="form-error" id="modal-error" role="alert" hidden></p><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">취소</button><button type="submit" class="button button-primary">종료일 확정</button></div></form>`);
    rememberModal();$('#medication-stop-date').focus();
  }
  function openMedicationHistory(orderId,time) {
    const data=medicationCurrent();if(!data)return;
    const slot=data.schedule.slots.find(s=>s.orderId===orderId && s.time===time);if(!slot)return;
    medicationModalFrame('medication-history','복약 보고와 변경 이력',`${slot.name} · ${data.date} ${time} 예정 회차`);
    const audit=data.audit.filter(item=>item.orderId===orderId && item.time===time && item.date===data.date).sort((a,b)=>Number(b.revision)-Number(a.revision));
    $('#modal').insertAdjacentHTML('beforeend',`<div class="medication-history-current"><span class="medication-status ${esc(slot.status)}">${medicationStatusLabel(slot.status)}</span><p><b>현재 사유</b>${esc(medicationReason(slot.reason))}</p><p><b>현재 메모</b>${esc(slot.note||'미입력')}</p><small>${reportTime(slot.reportedAt)} · 자기보고 수정 ${Math.max(0,Number(slot.revision||1)-1)}회</small></div><h3 class="medication-history-heading">보존된 보고·수정 이력</h3><div class="medication-history-timeline">${audit.length?audit.map(entry=>`<article><span class="medication-history-dot"></span><strong>${entry.previous?'보고 수정':'최초 보고'} · ${reportTime(entry.changedAt)}</strong><p>${entry.previous?`${medicationStatusLabel(entry.previous.status)} → `:''}${medicationStatusLabel(entry.current?.status)}</p><dl><div><dt>이전 사유 / 메모</dt><dd>${entry.previous?`${esc(medicationReason(entry.previous.reason))} / ${esc(entry.previous.note||'미입력')}`:'최초 보고 전 기록 없음'}</dd></div><div><dt>변경 사유 / 메모</dt><dd>${esc(medicationReason(entry.current?.reason))} / ${esc(entry.current?.note||'미입력')}</dd></div></dl></article>`).join(''):'<p class="compact-empty">표시할 변경 이력이 없습니다.</p>'}</div><p class="medication-photo-notice">보고 시각은 서버에 기록된 시각입니다. 실제 약을 복용한 시각이나 복용 사실을 확정하지 않습니다.</p><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">닫기</button></div>`);
    $('#modal').focus();
  }
  async function submitMedicationModal(event) {
    const form=event.target;if(!['medication-order-form','medication-end-form'].includes(form.id))return;
    event.preventDefault();const modal=state.modal;if(!modal || modal.saving)return;
    const patientId=modal.patientId,err=$('#modal-error');err.hidden=true;
    if(patientId!==state.selectedId){err.textContent='선택 환자가 변경되었습니다. 창을 닫고 다시 확인해 주세요.';err.hidden=false;return;}
    const submit=form.querySelector('[type="submit"]');const fields=new FormData(form);modal.saving=true;lockModal(true);
    try {
      if(form.id==='medication-order-form') {
        const times=fields.getAll('times').filter(Boolean);
        if(new Set(times).size!==times.length)throw new Error('같은 복용 시각을 중복 등록할 수 없습니다.');
        const payload={name:String(fields.get('name')).trim(),strength:String(fields.get('strength')).trim(),dose:String(fields.get('dose')).trim(),route:String(fields.get('route')).trim(),times:times.sort(),startDate:fields.get('startDate'),endDate:fields.get('endDate')||null,instructions:String(fields.get('instructions')).trim()};
        const payloadKey=JSON.stringify(payload);if(modal.requestKey!==payloadKey||!modal.requestId){modal.requestKey=payloadKey;modal.requestId=crypto.randomUUID();}
        await api(`/api/patients/${encodeURIComponent(patientId)}/medication-orders`,{method:'POST',body:JSON.stringify({...payload,clientRequestId:modal.requestId})});
      } else await api(`/api/medication-orders/${encodeURIComponent(modal.orderId)}`,{method:'PATCH',body:JSON.stringify({endDate:fields.get('endDate')})});
      if(state.modal===modal)closeModal({force:true});
      toast(form.id==='medication-order-form'?'확정 복약 계획이 저장되었습니다.':'복약 계획의 종료일이 저장되었습니다. 과거 보고는 보존됩니다.');
      await refresh({quiet:true});
    } catch(error) { if(state.modal===modal){err.textContent=error.message;err.hidden=false;}else toast(error.message,true); }
    finally {modal.saving=false;if(state.modal===modal)lockModal(false);}
  }

  let renderedContext='';
  function captureReadingState(){
    const root=$('#app-content'),active=document.activeElement;
    let focus='';
    if(root.contains(active)){
      if(active.id)focus='#'+CSS.escape(active.id);
      else if(active.closest('[data-preserve-key]')&&active.tagName==='SUMMARY')focus=`[data-preserve-key="${CSS.escape(active.closest('[data-preserve-key]').dataset.preserveKey)}"] > summary`;
      else if(active.dataset.action)focus='['+Object.entries(active.dataset).filter(([key])=>['action','id','view','filter'].includes(key)).map(([key,value])=>`data-${key}="${CSS.escape(value)}"`).join('][')+']';
    }
    return {focus,selection:typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null,open:[...root.querySelectorAll('details[open][data-preserve-key]')].map(el=>el.dataset.preserveKey),scroll:[...root.querySelectorAll('.table-scroll')].map(el=>[el.scrollLeft,el.scrollTop]),x:window.scrollX,y:window.scrollY};
  }
  function restoreReadingState(saved){
    if(!saved)return;
    for(const key of saved.open){const el=$('#app-content').querySelector(`[data-preserve-key="${CSS.escape(key)}"]`);if(el)el.open=true;}
    $('#app-content').querySelectorAll('.table-scroll').forEach((el,i)=>{if(saved.scroll[i]){el.scrollLeft=saved.scroll[i][0];el.scrollTop=saved.scroll[i][1];}});
    const focus=saved.focus?$('#app-content').querySelector(saved.focus):null;
    if(focus){focus.focus({preventScroll:true});if(saved.selection&&typeof focus.setSelectionRange==='function')try{focus.setSelectionRange(...saved.selection);}catch{/* Date controls do not expose text selection. */}}
    window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
  }
  function applyAccess(){
    for(const button of document.querySelectorAll('#main-nav [data-view]'))button.hidden=!can(viewPermissions[button.dataset.view]);
    $('#add-patient-button').hidden=!can('clinical.write');
    for(const el of document.querySelectorAll('[data-action="add-patient"],[data-action="add-medication-order"],[data-action="end-medication-order"],[data-action="invitation"]'))el.hidden=!can('clinical.write');
    for(const el of document.querySelectorAll('[data-action="reset"]'))el.hidden=!can('admin.reset')||sessionState.mode!=='demo';
    for(const el of document.querySelectorAll('[data-action="view"][data-view]'))el.hidden=!can(viewPermissions[el.dataset.view]);
    for(const el of document.querySelectorAll('[data-action="export-preview"]'))el.hidden=!can('research.export');
    const roles={clinician:'임상 검토',support:'환자 관리 지원',researcher:'연구 분석',administrator:'운영 관리'};
    const profile=$('.sidebar-profile b');if(profile)profile.textContent=(state.staffAccess?.staffRoles||[]).map(role=>roles[role]||role).join(' · ')||'권한 확인 필요';
  }
  function render(historyMode = 'replace') {
    if(!state.data)return;
    state.view=authorizedView(state.view);
    const context=[state.view,state.selectedId,state.startDate,state.endDate,medDate()].join('|');
    const saved=context===renderedContext?captureReadingState():null;renderedContext=context;
    const [eyebrow,title,subtitle,breadcrumb]=viewTitles[state.view];
    $('#page-eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-subtitle').textContent=subtitle;$('#view-breadcrumb').textContent=breadcrumb;
    document.querySelectorAll('#main-nav [data-view]').forEach(btn=>{const active=btn.dataset.view===state.view;btn.classList.toggle('active',active);if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');});
    const inputFocused=document.activeElement?.id==='patient-search';const cursor=inputFocused?document.activeElement.selectionStart:null;
    const patientLink=$('.patient-site-link');if(patientLink)patientLink.href=state.selectedId?`/patient?patientId=${encodeURIComponent(state.selectedId)}`:'/patient';
    const periodForm=$('#clinical-period-form');periodForm.hidden=!['overview','patients','records','research'].includes(state.view);
    if(!periodForm.contains(document.activeElement)){
      $('#clinical-start-date').value=state.startDate||offsetDate(state.data.today,-6);$('#clinical-end-date').value=state.endDate||state.data.today;
      $('#clinical-start-date').max=state.data.today;$('#clinical-end-date').max=state.data.today;
      $('#clinical-period-preset').value=state.startDate?'custom':'default';
    }
    $('#clinical-period-description').textContent=`${periodLabel()} · 빈칸은 미측정입니다. 확인 규칙은 별도 7일 창을 사용합니다.`;
    for(const [key,workspace] of Object.entries(workspaces))if(key!==state.view)workspace.deactivate();
    if(['notices','messages'].includes(state.view)){communication.mount(state.view);applyAccess();syncUrl(historyMode);return;}
    communication.deactivate();
    if(currentWorkspace()){currentWorkspace().mount();applyAccess();syncUrl(historyMode);return;}
    $('#app-content').innerHTML=state.selectedId && !state.summary && state.view!=='settings'
      ? ($('#global-error').hidden ? '<div class="loading-state"><span class="spinner"></span><b>선택 환자의 기록을 확인하고 있어요</b></div>' : '<div class="compact-empty">선택 환자의 기록을 확인할 수 없습니다. 상단 새로고침으로 다시 시도해 주세요.</div>')
      : ({overview,patients:patientsView,records:recordsView,medications:medicationsView,settings:settingsView}[state.view])();
    if(inputFocused&&$('#patient-search')){$('#patient-search').focus();$('#patient-search').setSelectionRange(cursor,cursor);}
    restoreReadingState(saved);applyAccess();
    syncUrl(historyMode);
  }
  function changeView(view) { if(!Object.hasOwn(viewTitles,view)||!can(viewPermissions[view])||view===state.view||!canLeave())return;state.view=view;render('push');if(view==='medications')loadMedications();focusPage(); }
  async function openInvitation(){
    if(!state.selectedId||communication.busy()||!can('clinical.write'))return;
    state.lastFocus=document.activeElement;const marker={type:'invitation',busy:true};state.modal=marker;
    $('#modal-backdrop').hidden=false;document.body.style.overflow='hidden';
    $('#modal').innerHTML=`<div class="modal-top"><h2 id="modal-title">환자 연결코드</h2><button class="icon-button" data-modal-action="close" aria-label="닫기">${icon('close')}</button></div><p>선택한 환자에게만 안전하게 전달하세요. 24시간 동안 1회 사용할 수 있으며 재발급하면 이전 미사용 코드는 폐기됩니다.</p><p id="invitation-result" role="status">발급 중…</p>`;$('#modal').focus();
    try{const {invitation:result}=await api(`/api/clinician/patients/${encodeURIComponent(state.selectedId)}/invitations`,{method:'POST',body:'{}'});if(state.modal!==marker)return;$('#invitation-result').textContent=result.code+' · 만료 '+new Date(result.expiresAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});}
    catch(error){if(state.modal===marker)$('#invitation-result').textContent=error.message;}
    finally{marker.busy=false;}
  }
  function openExport(){
    if(!can('research.export')||!canLeave())return;
    medicationModalFrame('export','내보낼 범위를 먼저 확인하세요','일반 CSV에는 이름과 자유서술이 포함됩니다. 가명 연구 자료가 필요하면 연구 분석에서 스냅샷을 만드세요.');
    $('#modal').insertAdjacentHTML('beforeend',`<form id="export-preview-form"><div class="field"><label for="export-scope">대상 범위</label><select id="export-scope"><option value="selected" ${state.selectedId?'':'disabled'}>현재 환자 · ${esc(state.summary?.patient.name||'선택 없음')} (${esc(state.selectedId||'')})</option><option value="all">현재 권한으로 볼 수 있는 전체 환자</option></select></div><div class="form-row"><div class="field"><label for="export-start">시작일</label><input id="export-start" type="date" value="${esc(state.startDate||offsetDate(state.data.today,-6))}" max="${esc(state.data.today)}" required></div><div class="field"><label for="export-end">종료일</label><input id="export-end" type="date" value="${esc(state.endDate||state.data.today)}" max="${esc(state.data.today)}" required></div></div><button class="button button-secondary" type="submit">범위와 항목 확인</button><div id="export-preview-result" role="status"></div><p class="form-error" id="modal-error" role="alert" hidden></p><div class="modal-actions"><button class="button button-secondary" type="button" data-modal-action="close">닫기</button><a id="export-download" class="button button-primary" hidden download>확인한 범위 CSV 받기</a></div></form>`);
    if(!state.selectedId)$('#export-scope').value='all';
    $('#export-scope').focus();
  }
  async function previewExport(event){
    if(event.target.id!=='export-preview-form')return;event.preventDefault();
    const modal=state.modal;if(!modal||modal.busy)return;
    const params=new URLSearchParams({startDate:$('#export-start').value,endDate:$('#export-end').value});
    if($('#export-scope').value==='selected')params.set('patientId',modal.patientId);
    $('#modal-error').hidden=true;$('#export-download').hidden=true;modal.busy=true;lockModal(true);const key=params.toString();
    try{
      const result=await api('/api/export-preview?'+key);if(state.modal!==modal)return;
      $('#export-preview-result').innerHTML=`<p><b>${num(result.patientCount??result.scope?.patientCount)}명 · ${num(result.rowCount)}행</b></p><p>기간: ${esc(result.startDate||result.scope?.startDate||params.get('startDate'))} ~ ${esc(result.endDate||result.scope?.endDate||params.get('endDate'))}</p><p>포함 열: ${esc((result.columns||result.fields||[]).map(c=>typeof c==='string'?c:c.name).join(', '))}</p><p>이름과 메모가 포함된 관리용 CSV입니다. 복원용 DB 백업은 아닙니다.</p>`;
      $('#export-download').href='/api/export.csv?'+key;$('#export-download').hidden=false;
    }catch(error){if(state.modal===modal){$('#modal-error').textContent=error.message;$('#modal-error').hidden=false;}}
    finally{modal.busy=false;if(state.modal===modal)lockModal(false);}
  }
  function closeModal({force=false}={}) {
    if(!force&&!canCloseModal())return false;
    state.photoAbort?.abort();state.photoAbort=null;state.photoGeneration++;
    $('#modal-backdrop').hidden=true;$('#modal').innerHTML='';$('#modal').classList.remove('medication-modal');state.modal=null;document.body.style.overflow='';if(state.lastFocus?.isConnected)state.lastFocus.focus();
    return true;
  }
  function openModal(type, mode='seed') {
    state.lastFocus=document.activeElement;state.modal={type,mode};
    $('#modal-backdrop').hidden=false;document.body.style.overflow='hidden';
    const close=`<button class="icon-button" data-modal-action="close" aria-label="닫기">${icon('close')}</button>`;
    if(type==='add') {
      $('#modal').innerHTML=`<div class="modal-top"><h2 id="modal-title">가상 환자 추가</h2>${close}</div><p class="modal-description">시연에 사용할 가상 정보를 입력하세요.<br>실제 환자의 이름이나 개인정보를 입력하지 마세요.</p><form id="add-patient-form"><div class="field"><label for="new-patient-name">가상 이름 <span aria-hidden="true">*</span></label><input id="new-patient-name" name="name" placeholder="예: 김새봄" required maxlength="40" autocomplete="off"></div><div class="form-row"><div class="field"><label for="new-patient-age">나이 *</label><input id="new-patient-age" name="age" type="number" min="1" max="120" value="75" required></div><div class="field"><label for="new-patient-sex">성별 *</label><select id="new-patient-sex" name="sex"><option value="female">여성</option><option value="male">남성</option><option value="other">기타</option></select></div></div><div class="field"><label for="new-patient-conditions">기저질환 <small>선택</small></label><input id="new-patient-conditions" name="conditions" placeholder="예: 고혈압, 당뇨병" maxlength="500"><small>여러 질환은 쉼표로 구분해 주세요.</small></div><div class="form-error" id="modal-error" role="alert" hidden></div><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">취소</button><button type="submit" class="button button-primary">${icon('plus')}환자 등록</button></div></form>`;
      rememberModal();$('#new-patient-name').focus();
    } else {
      const seed=mode==='seed';
      $('#modal').innerHTML=`<div class="modal-top"><h2 id="modal-title">${seed?'예시 데이터 복원':'모든 테스트 데이터 삭제'}</h2>${close}</div><p class="modal-description">${seed?'새 시연을 위해 처음의 예시 데이터로 돌아갑니다.':'환자와 기록이 없는 빈 데이터베이스로 시작합니다.'}</p><div class="reset-warning">현재 환자, 건강·식사 기록, 업로드한 사진이 모두 삭제됩니다. ${seed?'가상 환자 6명과 예시 기록을 새로 생성합니다.':''}<br><b>이 작업은 되돌릴 수 없습니다.</b></div><form id="reset-form"><div class="field"><label for="reset-confirmation">계속하려면 <b>초기화</b>를 입력하세요.</label><input id="reset-confirmation" name="confirmation" placeholder="초기화" required autocomplete="off"></div><div class="form-error" id="modal-error" role="alert" hidden></div><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">취소</button><button type="submit" class="button button-danger">${seed?'초기화 후 예시 복원':'모든 데이터 삭제'}</button></div></form>`;
      rememberModal();$('#reset-confirmation').focus();
    }
  }
  async function submitModal(event) {
    const form=event.target;if(!['add-patient-form','reset-form'].includes(form.id))return;event.preventDefault();
    const modal=state.modal;if(!modal||modal.saving)return;modal.saving=true;
    const err=$('#modal-error');err.hidden=true;const fields=new FormData(form);lockModal(true);
    try {
      if(form.id==='add-patient-form') {
        const result=await api('/api/patients',{method:'POST',body:JSON.stringify({name:String(fields.get('name')).trim(),age:Number(fields.get('age')),sex:fields.get('sex'),conditions:String(fields.get('conditions')).split(',').map(s=>s.trim()).filter(Boolean)})});
        state.selectedId=result.patient?.id||result.id;state.view='patients';state.filter='all';state.search='';closeModal({force:true});toast('가상 환자가 등록되었습니다. 환자 화면에서 첫 기록을 남겨보세요.');await refresh({quiet:true});
      } else {
        if(String(fields.get('confirmation')).trim()!=='초기화')throw new Error('확인 문구를 정확히 입력해 주세요: 초기화');
        const mode=state.modal.mode;
        await api('/api/demo/reset',{method:'POST',body:JSON.stringify({mode,confirmation:'RESET'})});
        state.selectedId=null;state.summary=null;state.search='';state.filter='all';state.view='overview';closeModal({force:true});toast(mode==='seed'?'예시 데이터를 복원했습니다.':'모든 테스트 데이터를 삭제했습니다.');await refresh({quiet:true});
      }
    } catch(error) { if($('#modal-error')){$('#modal-error').textContent=error.message;$('#modal-error').hidden=false;}else toast(error.message,true); }
    finally { modal.saving=false;if(state.modal===modal)lockModal(false); }
  }
  $('#main-nav').addEventListener('click',event=>{const btn=event.target.closest('[data-view]');if(btn)changeView(btn.dataset.view);});
  $('#refresh-button').addEventListener('click',()=>{refresh();if(currentWorkspace()&&!currentWorkspace().busy())currentWorkspace().refresh();});
  $('#dismiss-operation-result').addEventListener('click',()=>{$('#operation-result').hidden=true;});
  $('#add-patient-button').addEventListener('click',()=>{if(can('clinical.write')&&canLeave())openModal('add');});
  $('#clinical-period-preset').addEventListener('change',event=>{
    const count=Number(event.target.value);
    if(count){$('#clinical-start-date').value=offsetDate(state.data.today,-count+1);$('#clinical-end-date').value=state.data.today;}
    if(event.target.value==='default'){$('#clinical-start-date').value=offsetDate(state.data.today,-6);$('#clinical-end-date').value=state.data.today;}
  });
  $('#clinical-period-form').addEventListener('submit',event=>{
    event.preventDefault();if(!canLeave())return;
    const start=$('#clinical-start-date').value,end=$('#clinical-end-date').value,days=(Date.parse(end)-Date.parse(start))/86400000+1;
    if(!Number.isInteger(days)||days<1||days>366||end>state.data.today){toast('오늘까지의 기간을 1~366일 사이로 선택해 주세요.',true);return;}
    state.startDate=$('#clinical-period-preset').value==='default'?'':start;state.endDate=state.startDate?end:'';
    ++state.selectionRequest;state.summary=null;syncUrl('push');render();refresh({quiet:true});
  });
  $('#app-content').addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');if(!el)return;
    const action=el.dataset.action;
    if(action==='invitation')openInvitation();
    if(action==='export-preview')openExport();
    if(action==='select-patient')selectPatient(el.dataset.id);
    if(action==='alert-patient')selectPatient(el.dataset.id,true).then(()=>$('#patient-detail')?.scrollIntoView({behavior:'smooth',block:'start'}));
    if(action==='view')changeView(el.dataset.view);
    if(action==='check-integrations')loadIntegrationSettings();
    if(action==='filter'){state.filter=el.dataset.filter;render();}
    if(action==='add-patient' && can('clinical.write')&&canLeave())openModal('add');
    if(action==='reset'&&can('admin.reset')&&sessionState.mode==='demo'&&canLeave())openModal('reset',el.dataset.mode);
    if(action==='add-medication-order'&&can('clinical.write')&&canLeave())openMedicationOrder();
    if(action==='end-medication-order'&&can('clinical.write')&&canLeave())openMedicationEnd(el.dataset.id);
    if(action==='medication-history')openMedicationHistory(el.dataset.orderId,el.dataset.time);
    if(action==='reload-medications')loadMedications();
    if(action==='open-detail'){event.preventDefault();$('#patient-detail')?.scrollIntoView({behavior:'smooth',block:'start'});}
  });
  $('#app-content').addEventListener('keydown',event=>{const row=event.target.closest('.patient-row');if(row&&['Enter',' '].includes(event.key)){event.preventDefault();selectPatient(row.dataset.id);}});
  $('#app-content').addEventListener('input',event=>{
    if(event.target.id==='patient-search') {state.search=event.target.value;$('#patient-table-body').innerHTML=patientRows(state.view==='patients');$('#patient-count-label').textContent=`전체 ${state.data.patients.length}명 중 ${filteredPatients().length}명 표시`;}
  });
  $('#app-content').addEventListener('change',event=>{if(['record-patient','medication-patient'].includes(event.target.id)){const id=event.target.value;event.target.value=state.selectedId;selectPatient(id);}if(event.target.id==='medication-date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){event.target.value=medDate();toast('확인할 날짜를 선택해 주세요. 이전 조회 날짜를 유지합니다.',true);return;}if(!canLeave()){event.target.value=medDate();return;}state.medicationDate=event.target.value;state.medications=null;render('push');loadMedications();focusPage();}});
  $('#modal-backdrop').addEventListener('click',event=>{if(event.target===$('#modal-backdrop')||event.target.closest('[data-modal-action="close"]'))closeModal();});
  $('#modal').addEventListener('submit',submitModal);
  $('#modal').addEventListener('submit',submitMedicationModal);
  $('#modal').addEventListener('submit',previewExport);
  $('#modal').addEventListener('click',event=>{
    const button=event.target.closest('[data-modal-action]');
    if(button?.dataset.modalAction==='add-time'){const rows=$('#medication-times');const count=rows.querySelectorAll('input').length;if(count>=12){toast('하루 예정 시각은 최대 12개까지 등록할 수 있습니다.',true);return;}rows.insertAdjacentHTML('beforeend',`<div class="medication-time-row"><input type="time" name="times" required aria-label="복용 예정 시각 ${count+1}"><button type="button" class="text-link" data-modal-action="remove-time">삭제</button></div>`);rows.lastElementChild.querySelector('input').focus();}
    if(button?.dataset.modalAction==='remove-time')button.closest('.medication-time-row').remove();
    if(button?.dataset.modalAction==='use-medication-candidate')useMedicationCandidate(Number(button.dataset.candidate));
    if(event.target.closest('#analyze-medication-photo'))analyzeMedicationPhoto();
  });
  $('#modal').addEventListener('change',event=>{
    if(state.modal?.type==='export'&&['export-scope','export-start','export-end'].includes(event.target.id)){$('#export-download').hidden=true;$('#export-preview-result').textContent='범위가 바뀌었습니다. 다시 확인해 주세요.';}
    if(event.target.id==='medication-photo')readMedicationPhoto(event.target.files?.[0]);
    if(event.target.id==='medication-photo-consent')updatePhotoAnalyzeButton();
    if(event.target.dataset.candidateConfirm!==undefined){const index=event.target.dataset.candidateConfirm;const btn=$('#modal').querySelector(`[data-candidate="${index}"]`);if(btn)btn.disabled=!event.target.checked;}
    if(event.target.id==='medication-start-date')$('#medication-end-date').min=event.target.value;
  });
  document.addEventListener('keydown',event=>{
    if(!state.modal)return;
    if(event.key==='Escape'){event.preventDefault();closeModal();return;}
    if(event.key==='Tab') {const items=[...$('#modal').querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){last?.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first?.focus();event.preventDefault();}}
  });
  window.homecareCanLogout=canLeave;
  window.addEventListener('beforeunload',event=>{if(!window.__homecareLeaving && (modalDirty()||modalBusy()||communication.dirty()||communication.busy()||currentWorkspace()?.dirty()||currentWorkspace()?.busy())){event.preventDefault();event.returnValue='';}});
  try{if(!await bootstrapSession('clinician'))return;}catch(error){showError(error.message);return;}
  try{state.staffAccess=await api('/api/clinician/access');}catch(error){state.staffAccess={staffRoles:sessionState.user?.staffRoles||[],capabilities:[],assignedPatientIds:[]};showError('업무 권한을 확인하지 못했습니다. 새로 열어 주세요. '+error.message);return;}
  state.view=authorizedView(state.view);if(!can('patient.read'))state.selectedId=null;
  refresh({quiet:true});
  setInterval(()=>{if(!document.hidden)refresh({quiet:true});},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({quiet:true});});
})();
