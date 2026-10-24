const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value===null||value===undefined?'산출 불가':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2});
const dayOffset=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);

/** C-RESEARCH: descriptive statistics only; no automatic statistical tests. */
export function createResearchWorkspace({api,getState,toast}){
  const root=document.querySelector('#app-content');
  const $=selector=>root.querySelector(selector);
  let mounted='',generation=0,loading=false,saving=false,preview=null,snapshot=null,baseline='',requestKey='',requestId='';
  const allowed=capability=>getState().staffAccess?.capabilities?.includes(capability);
  function values(){
    if(!$('#research-form'))return null;
    const body={startDate:$('#research-start').value,endDate:$('#research-end').value,source:$('#research-source').value};
    if(!$('#research-all-patients').checked)body.patientIds=[...root.querySelectorAll('[name=research-patient]:checked')].map(el=>el.value);
    return body;
  }
  function dirty(){return Boolean(mounted&&baseline&&JSON.stringify(values())!==baseline);}
  function canLeave(){if(saving||loading){toast('자료 조회 또는 저장이 끝난 뒤 이동해 주세요.',true);return false;}if(dirty()&&!confirm('변경한 분석 조건을 적용하지 않고 이동할까요? 취소하면 계속 검토할 수 있습니다.'))return false;baseline=JSON.stringify(values());return true;}
  function fail(error){if($('#research-error')){$('#research-error').hidden=false;$('#research-error').textContent=error.message;}}
  function lock(locked){root.querySelectorAll('button,input,textarea,select').forEach(el=>{if(locked){el.dataset.researchDisabled=el.disabled?'1':'0';el.disabled=true;}else if(el.dataset.researchDisabled!==undefined){el.disabled=el.dataset.researchDisabled==='1';delete el.dataset.researchDisabled;}});}
  function clearError(){if($('#research-error'))$('#research-error').hidden=true;}
  function valid(body){
    const days=(Date.parse(body.endDate)-Date.parse(body.startDate))/86400000+1;
    if(!Number.isInteger(days)||days<1||days>366||body.endDate>getState().data.today)throw new Error('오늘까지의 1~366일 기간을 선택해 주세요.');
    if(body.patientIds&&!body.patientIds.length)throw new Error('분석할 환자를 선택하거나 허용된 전체 대상으로 변경해 주세요.');
    return body;
  }
  function statsTable(stats,countLabel='관측 수'){return `<dl class="research-result-summary"><div><dt>${countLabel}</dt><dd>${number(stats?.count)}</dd></div><div><dt>평균 / 표본 SD</dt><dd>${number(stats?.mean)} / ${number(stats?.sd)}</dd></div><div><dt>중앙값</dt><dd>${number(stats?.median)}</dd></div><div><dt>Q1 / Q3 (IQR)</dt><dd>${number(stats?.q1)} / ${number(stats?.q3)} (${number(stats?.iqr)})</dd></div><div><dt>최솟값 / 최댓값</dt><dd>${number(stats?.min)} / ${number(stats?.max)}</dd></div></dl>`;}
  function renderResult(result){
    const s=result.summary||{},metricNames={steps:'걸음 수',sleepHours:'수면 시간',weightKg:'체중',calories:'기록된 끼니의 영양 추정 합계',proteinGrams:'기록된 끼니의 단백질 추정 합계'};
    $('#research-results').innerHTML=`<section class="card communication-panel"><h2>선택한 자료의 범위</h2><p>${esc(result.recipe.startDate)} ~ ${esc(result.recipe.endDate)} · ${esc(result.recipe.source||'all')}</p><div class="research-result-summary"><div><b>${number(s.patientCount)}</b>고유 환자 N</div><div><b>${number(s.plannedPatientDays)}</b>달력 환자-일 분모</div><div><b>${number(s.reportedPatientDays)}</b>보고된 환자-일</div><div><b>${number(s.missingPatientDays)}</b>보고 없는 환자-일</div><div><b>${number(s.coveragePercent)}%</b>달력 기준 기록일 비율</div></div><p>환자 수와 반복 관측 수는 다릅니다. 이 비율은 연구 프로토콜의 필수 기록 완결률이 아닙니다. 자료가 없는 값은 0으로 채우지 않습니다.</p></section><div class="research-metric-grid">${Object.entries(result.metrics||{}).map(([key,m])=>`<section class="card communication-panel"><h2>${esc(metricNames[key]||key)}</h2><p>단위 ${esc(m.unit)} · 환자 ${number(m.patientCount)}명 / 유효 관측 ${number(m.observationCount)}건 · 미관측 환자-일 ${number(m.missingPatientDays)}</p><h3>관측값 전체의 기술통계</h3>${statsTable(m.pooled)}<details><summary>환자별 평균에 같은 가중치를 준 통계</summary>${statsTable(m.patientMeans,'환자 수')}</details><p>출처: ${esc(Object.entries(m.sourceCounts||{}).map(([source,count])=>`${source} ${count}건`).join(' · ')||'유효 관측 없음')}</p>${['calories','proteinGrams'].includes(key)?'<p>기록되지 않은 끼니·먹은 양 모름은 제외합니다. 하루 총섭취량을 뜻하지 않습니다.</p>':''}</section>`).join('')}</div><section class="card communication-panel"><h2>자료 품질과 분석 경계</h2><p>같은 환자의 여러 날을 서로 독립적인 사람 수로 계산하지 않습니다. 표본 SD는 관측 2건 미만이면 산출하지 않습니다. 평균 대치·검정·인과 추론을 자동 적용하지 않습니다.</p><details><summary>지표·분모와 품질 정보 보기</summary><pre class="workspace-status">${esc(JSON.stringify({recipe:result.recipe,medication:result.medication,quality:result.quality},null,2))}</pre></details></section>`;
  }
  function renderSnapshot(){
    const el=$('#research-snapshot');if(!el)return;
    if(!snapshot){el.innerHTML='<p>현재 조건을 먼저 조회한 뒤 스냅샷을 저장하세요. 실시간 결과와 동결 자료는 구별됩니다.</p>';return;}
    el.innerHTML=`<h3>자료 스냅샷이 저장되었습니다</h3><p>ID: <code>${esc(snapshot.id)}</code><br>생성: ${esc(snapshot.createdAt)}<br>자료 해시: <code>${esc(snapshot.contentHash)}</code></p><p>저장 시점의 자료와 조건을 다시 읽으며 이후 원자료 변경을 조용히 반영하지 않습니다.</p><div class="workspace-action-row"><button class="button button-secondary" type="button" data-research="load-snapshot">저장본 다시 읽기</button><button class="button button-primary" type="button" data-research="export" ${allowed('research.export')?'':'disabled'}>가명 CSV·분석명세 받기</button></div>`;
  }
  function mount(){
    const state=getState(),key=[state.startDate,state.endDate,(state.staffAccess?.assignedPatientIds||[]).join(',')].join('|');
    if(mounted===key&&$('#research-form'))return;
    mounted=key;generation++;loading=false;saving=false;preview=null;snapshot=null;requestKey='';requestId='';
    const start=state.startDate||dayOffset(state.data.today,-6),end=state.endDate||state.data.today;
    root.innerHTML=`<div class="research-workspace"><div class="workspace-context"><b>기술통계와 가명 자료 추출</b><p>기간·출처·대상을 확인하고 결과를 검토하세요. 가명화는 익명화 보장이 아니며 실제 연구의 분석계획·기관 승인을 대신하지 않습니다.</p></div><p id="research-error" class="error-banner" role="alert" hidden></p><section class="card communication-panel"><h2>분석할 자료 선택</h2><form id="research-form"><div class="workspace-form-grid"><label>시작일<input id="research-start" type="date" value="${esc(start)}" max="${esc(state.data.today)}" required></label><label>종료일<input id="research-end" type="date" value="${esc(end)}" max="${esc(state.data.today)}" required></label><label>자료 출처<select id="research-source"><option value="all">모든 출처 · 항목별 유효값</option><option value="patient-self-report">직접 입력 자기보고</option><option value="health-connect">Health Connect</option><option value="apple-health">Apple 건강</option></select></label></div><label class="check-label"><input id="research-all-patients" type="checkbox" checked>현재 권한으로 분석할 수 있는 전체 대상</label><details><summary>환자별 대상 선택 (조회 권한이 있는 경우)</summary><div class="research-patients">${state.data.patients.length?state.data.patients.map(p=>`<label><input type="checkbox" name="research-patient" value="${esc(p.id)}" disabled>${esc(p.name)} · ${esc(p.id)}</label>`).join(''):'<p>이 계정은 실명 목록을 보지 않고 허용된 가명 대상군을 분석합니다.</p>'}</div></details><div class="workspace-action-row"><button class="button button-primary" id="research-preview-button" type="submit">기술통계 조회</button><button class="button button-secondary" type="button" data-research="snapshot" ${allowed('research.export')?'':'disabled'}>검토한 자료 스냅샷 저장</button></div></form><p id="research-query-status" role="status">아직 분석하지 않았습니다.</p></section><div id="research-results"></div><section id="research-snapshot" class="card communication-panel"></section></div>`;
    baseline=JSON.stringify(values());renderSnapshot();
  }
  function deactivate(){if(mounted){mounted='';generation++;loading=false;}}
  async function load(){
    if(loading||saving||!mounted)return;clearError();let body;
    try{body=valid(values());}catch(error){fail(error);return;}
    const request=generation,key=JSON.stringify(body);loading=true;lock(true);
    $('#research-query-status').textContent='자료의 기간·출처·분모를 계산하고 있습니다.';
    const query=new URLSearchParams({...body,...(body.patientIds?{patientIds:body.patientIds.join(',')}:{})});
    try{const result=await api('/api/research/preview?'+query);if(request!==generation)return;preview=result;snapshot=null;baseline=key;renderResult(result);renderSnapshot();$('#research-query-status').textContent=`${result.recipe.startDate} ~ ${result.recipe.endDate} 조회 완료. 이후 조건을 바꾸면 다시 조회해야 합니다.`;}
    catch(error){if(request===generation){fail(error);$('#research-query-status').textContent='조회하지 못했습니다. 조건은 유지됩니다.';}}
    finally{loading=false;if(request===generation)lock(false);}
  }
  async function saveSnapshot(){
    if(saving||loading)return;clearError();if(!preview||dirty()){fail(new Error('현재 조건으로 기술통계를 먼저 조회하고 확인해 주세요.'));return;}
    const body=values(),key=JSON.stringify({body,inputHash:preview.inputHash});if(requestKey!==key||!requestId){requestId=crypto.randomUUID();requestKey=key;}
    const request=generation;saving=true;lock(true);
    try{const result=await api('/api/research/snapshots',{method:'POST',body:JSON.stringify({...body,clientRequestId:requestId,expectedInputHash:preview.inputHash})});if(request!==generation)return;snapshot=result.snapshot;renderSnapshot();toast('검토한 자료의 가명 스냅샷이 저장되었습니다.');}
    catch(error){if(request===generation)fail(error);}finally{saving=false;if(request===generation)lock(false);}
  }
  function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function readSnapshot(exporting=false){
    if(!snapshot||loading||saving)return;const request=generation;loading=true;lock(true);clearError();
    try{
      const result=await api('/api/research/snapshots/'+encodeURIComponent(snapshot.id)+(exporting?'/export':''));if(request!==generation)return;
      if(exporting){download(result.csv,snapshot.id+'.csv','text/csv;charset=utf-8');download(JSON.stringify(result.manifest,null,2),snapshot.id+'-manifest.json','application/json');toast('가명 CSV와 분석명세를 내려받았습니다. 이름·메모·사진은 포함하지 않습니다.');}
      else{snapshot=result.snapshot;preview=snapshot.result;renderResult(preview);renderSnapshot();$('#research-query-status').textContent='동결된 저장본을 읽었습니다. 현재 DB를 다시 계산한 결과가 아닙니다.';}
    }catch(error){if(request===generation)fail(error);}finally{loading=false;if(request===generation)lock(false);}
  }
  root.addEventListener('submit',event=>{if(event.target.id==='research-form'){event.preventDefault();load();}});
  root.addEventListener('change',event=>{if(!mounted)return;if(event.target.id==='research-all-patients')root.querySelectorAll('[name=research-patient]').forEach(el=>el.disabled=event.target.checked);if($('#research-form')?.contains(event.target))$('#research-query-status').textContent='조건이 바뀌면 기술통계를 다시 조회해 주세요.';});
  root.addEventListener('click',event=>{const action=event.target.closest('[data-research]')?.dataset.research;if(action==='snapshot')saveSnapshot();if(action==='export')readSnapshot(true);if(action==='load-snapshot')readSnapshot();});
  return {mount,deactivate,canLeave,dirty,busy:()=>saving||loading,refresh(){if(mounted&&!dirty())load();}};
}
