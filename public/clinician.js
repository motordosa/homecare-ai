'use strict';
(() => {
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
  const riskLabel = risk => risk?.label || ({ high:'확인 우선',watch:'관찰 필요',stable:'안정적 기록',insufficient:'자료 부족' }[risk?.level] || '자료 부족');
  const riskClass = risk => ['high','watch','stable','insufficient'].includes(risk?.level) ? risk.level : 'insufficient';
  const riskPill = risk => `<span class="risk-pill ${riskClass(risk)}">${esc(riskLabel(risk))}</span>`;
  const medLabel = status => ({taken:'복용 보고',partial:'일부 복용',missed:'미복용 보고',unknown:'알 수 없음'}[status] || '미기록');
  const foodLabel = food => ({balanced:'밥과 반찬',porridge:'죽',protein:'단백질 중심',noodles:'면 요리'}[food] || food || '식사');
  const mealLabel = meal => ({breakfast:'아침',lunch:'점심',dinner:'저녁',snack:'간식'}[meal] || '식사');
  const state = { view:'overview', data:null, summary:null, selectedId:new URLSearchParams(location.search).get('patientId'), filter:'all', search:'', refreshBusy:false, selectionRequest:0, modal:null, lastFocus:null };
  const viewTitles = {
    overview:['CARE AT A GLANCE','오늘의 돌봄 현황','환자의 일상을 연결하고, 필요한 돌봄을 먼저 살펴보세요.','케어 대시보드'],
    patients:['PATIENT WORKSPACE','환자 관리','기록의 변화와 확인할 내용을 환자별로 자세히 살펴보세요.','환자 관리'],
    records:['EVERYDAY HEALTH RECORDS','건강 기록','일상의 기록을 확인하고 연구용 파일로 내보내세요.','건강 기록'],
    settings:['DEMO WORKSPACE SETTINGS','데모 설정','테스트 데이터를 관리하고 다음 시연을 준비하세요.','데모 설정'],
  };
  const urlView = new URLSearchParams(location.search).get('view');
  if (viewTitles[urlView]) state.view = urlView;
  const $ = selector => document.querySelector(selector);
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.message || `요청을 처리하지 못했습니다. (${response.status})`);
    return result;
  }
  function syncUrl() {
    const url = new URL(location.href);
    if (state.selectedId) url.searchParams.set('patientId',state.selectedId); else url.searchParams.delete('patientId');
    if (state.view === 'overview') url.searchParams.delete('view'); else url.searchParams.set('view',state.view);
    history.replaceState(null,'',url);
  }
  function showError(message) { $('#global-error').textContent=message; $('#global-error').hidden=!message; }
  let toastTimer;
  function toast(message, error = false) { const el=$('#toast');el.textContent=message;el.hidden=false;el.classList.toggle('error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},4000); }
  let refreshQueue = Promise.resolve();
  function refresh(options = {}) {
    const operation = refreshQueue.then(() => performRefresh(options));
    refreshQueue = operation.catch(() => {});
    return operation;
  }
  async function performRefresh({quiet = false} = {}) {
    state.refreshBusy=true;
    $('#refresh-button').disabled=true;
    try {
      const data=await api('/api/dashboard');
      state.data=data;
      if(!data.patients.some(p=>p.id===state.selectedId)) state.selectedId=[...data.patients].sort((a,b)=>({high:0,watch:1,stable:2,insufficient:3}[a.risk?.level]??3)-({high:0,watch:1,stable:2,insufficient:3}[b.risk?.level]??3))[0]?.id || null;
      if(state.selectedId) {
        const selected=state.selectedId;
        const summary=await api(`/api/patients/${encodeURIComponent(selected)}/summary`);
        if(state.selectedId===selected) state.summary=summary;
      } else state.summary=null;
      showError('');
      $('#current-date').textContent=new Date(`${data.today}T12:00:00+09:00`).toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'});
      $('#nav-patient-count').textContent=data.patients.length;
      $('#last-sync').textContent=`${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'})} 업데이트`;
      $('#loading-state').hidden=true;
      $('#app-content').hidden=false;
      render();
      if(!quiet) toast('최신 기록으로 업데이트했습니다.');
    } catch(error) { showError(`기록을 불러오지 못했어요. ${error.message} 새로고침으로 다시 시도해 주세요.`);$('#loading-state').hidden=true; }
    finally { state.refreshBusy=false;$('#refresh-button').disabled=false; }
  }
  async function selectPatient(id, changeView = false) {
    if(!state.data?.patients.some(p=>p.id===id)) return;
    const previousId=state.selectedId;
    state.selectedId=id;
    const request=++state.selectionRequest;
    $('#app-content').setAttribute('aria-busy','true');
    if(changeView) state.view='patients';
    try {
      const summary=await api(`/api/patients/${encodeURIComponent(id)}/summary`);
      if(request!==state.selectionRequest || state.selectedId!==id) return;
      state.summary=summary;
      render();
    } catch(error) { if(request===state.selectionRequest)state.selectedId=previousId;toast(error.message,true); }
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
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}. ${numeric.length}일 기록. 최소 ${num(Math.min(...numeric),1)}, 최대 ${num(Math.max(...numeric),1)} ${esc(unit)}">${content}</svg>`;
  }
  function stats() {
    const s=state.data.stats;const ts=state.data.trends||[];
    const cards=[['전체 관리 환자',s.patients,'명','users','등록된 가상 환자','연구 참여 데모',ts.map(()=>s.patients)],['확인이 필요한 환자',s.needsReview,'명','alert','기록에 따른 확인 우선순위','방문 전 살펴보세요',ts.map(r=>Math.max(0,s.patients-r.reportingPatients))],['오늘 기록한 환자',s.reportedToday,'명','check','일일·식사 기록 기준',`전체 ${s.patients}명 중`,ts.map(r=>r.reportingPatients)],['최근 7일 기록률',s.averageCompletion,'%','trend','환자별 기록일 비율의 평균','일일 또는 식사 기록',ts.map(r=>s.patients?r.reportingPatients/s.patients*100:0)]];
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
    return `<section class="card ${full?'patient-full-card':''}"><div class="card-header"><div><h2>관리 환자 <span class="card-count">${state.data.patients.length}명</span></h2><p class="subheading">기록에 따른 확인 우선순위와 최근 변화를 살펴보세요.</p></div>${!full?`<button class="text-link" data-action="view" data-view="patients">전체 보기 ${icon('arrow')}</button>`:''}</div><div class="patient-controls"><div class="risk-tabs" aria-label="확인 우선순위 필터">${[['all','전체'],['high','확인 우선'],['watch','관찰 필요'],['stable','안정적 기록'],['insufficient','자료 부족']].map(([key,label])=>`<button class="risk-tab ${state.filter===key?'active':''}" data-action="filter" data-filter="${key}" aria-pressed="${state.filter===key}">${label}</button>`).join('')}</div><label class="search-wrap">${icon('search')}<input id="patient-search" class="search-input" placeholder="환자 이름, 질환 검색" aria-label="환자 이름 또는 질환 검색" value="${esc(state.search)}"></label></div><div class="table-scroll"><table class="patient-table" aria-label="관리 환자 목록"><thead><tr><th>환자</th><th>나이 / 성별</th><th>확인 우선순위</th><th class="optional-col">7일 기록률</th>${full?'<th class="optional-col">평균 활동</th><th class="optional-col">평균 수면</th>':''}<th>최근 기록</th><th aria-label="상세 보기"></th></tr></thead><tbody id="patient-table-body">${patientRows(full)}</tbody></table></div><div class="table-footer"><span id="patient-count-label">전체 ${state.data.patients.length}명 중 ${filteredPatients().length}명 표시</span><span>행을 선택하면 기록을 확인할 수 있어요 ${icon('arrow','control-chevron')}</span></div></section>`;
  }
  function briefingCard() {
    const s=state.summary;if(!s)return '';
    const first=s.briefing.items.slice(0,3);
    const headline=s.risk.reasons.length?s.risk.reasons.slice(0,2).join('. ')+'.':'최근 기록의 변화를 확인하고, 방문 시 환자의 생활 상태와 함께 살펴보세요.';
    return `<section class="card briefing-card"><div class="card-header"><h2>방문 전 브리핑</h2><span class="demo-ai-badge">${icon('spark')} DEMO</span></div><div class="briefing-patient"><span class="avatar">${esc(s.patient.name[0])}</span><div><h3>${esc(s.patient.name)} <span class="small-label">${s.patient.age}세 · ${sexLabel(s.patient.sex)}</span></h3><p>${esc((s.patient.conditions||[]).join(' · ')||'기저질환 미입력')}</p></div>${riskPill(s.risk)}</div><div class="briefing-summary"><h4>${icon('spark')}진료 전 확인할 내용</h4><p>${esc(headline)}</p></div><div class="briefing-points">${first.map(item=>`<div class="briefing-point"><span class="briefing-dot"></span><div><b>${esc(item.title)}</b><p>${esc(item.text)}</p></div></div>`).join('')}</div><div class="briefing-foot"><a href="#patient-detail" data-action="open-detail">전체 분석과 근거 보기 ${icon('arrow')}</a><div>기록을 정해진 규칙으로 요약한 데모입니다. 임상적으로 검증된 AI 위험예측이 아닙니다.</div></div></section>`;
  }
  function reportingChart() {
    const t=state.data.trends;
    return `<section class="card chart-card"><div class="card-header"><div><h2>꾸준히 연결되는 일상</h2><p class="subheading">최근 14일 · 일일 또는 식사 기록이 있는 환자</p></div><div class="chart-legend"><span><i></i>기록 환자</span></div></div><div class="chart-wrap">${chart(t,'reportingPatients',{type:'bar',color:'#7db8a3',unit:'명',max:Math.max(state.data.patients.length,1),height:145,label:'최근 14일 기록 환자 수'})}</div><div class="chart-footer"><span>환자와 돌봄을 이어가는 매일의 기록</span><b>오늘 ${state.data.stats.reportedToday}명 기록</b></div></section>`;
  }
  function alerts() {
    const alerts=state.data.alerts.slice(0,3);
    return `<section class="card alerts-section"><div class="card-header"><h2>살펴볼 기록</h2><span class="small-label">최근 7일</span></div>${alerts.length?`<div class="alert-list">${alerts.map(a=>`<div class="alert-item ${a.level==='high'?'high':''}"><span class="alert-dot">${icon('alert')}</span><div class="alert-body"><strong>${esc(a.patientName)} · ${esc(a.title)}</strong><p>${esc(a.detail)}</p></div><button data-action="alert-patient" data-id="${esc(a.patientId)}" aria-label="${esc(a.patientName)} 상세 보기">${icon('arrow')}</button></div>`).join('')}</div>`:'<div class="compact-empty">현재 확인 규칙에 해당하는 기록이 없습니다.</div>'}</section>`;
  }
  function metricPanels() {
    const s=state.summary,m=s.metrics,t=s.trends.slice(-14);
    const panels=[['steps','steps','평균 활동',num(m.steps.value),'걸음',`${m.steps.coverageDays}/7일 활동 보고`,'환자가 입력한 걸음 수','#7db6a4'],['sleepHours','moon','평균 수면',num(m.sleepHours.value,1),'시간',`${m.sleepHours.coverageDays}/7일 수면 보고`,'환자가 입력한 수면 시간','#a2a0c8'],['medication','pill','복약 자기보고 점수',num(m.medication.value),'%',`${m.medication.takenDays}일 복용 · ${m.medication.reportedDays}일 보고`,'복용 1 · 일부 0.5 · 미복용 0','#b3bf92'],['calories','food','기록된 식사 추정량',num(m.nutrition.value),'kcal/일',`단백질 ${num(m.nutrition.proteinGrams,1)} g/일`,'기록일의 추정 합계 평균 · 미기록 식사 제외','#d1af7b']];
    return `<div class="detail-metric-grid">${panels.map(([key,ic,title,value,unit,caption,source,color])=>`<article class="metric-panel"><div class="metric-panel-top">${icon(ic)}${title}</div><h3>${value}<small>${unit}</small></h3><div class="metric-bottom"><span>${esc(caption)}</span></div><div class="metric-trend">${spark(key==='medication'?t.map(r=>r.medicationStatus==='taken'?100:r.medicationStatus==='partial'?50:r.medicationStatus==='missed'?0:null):t.map(r=>r[key]),color)}</div><div class="source-note">${esc(source)}</div></article>`).join('')}</div>`;
  }
  function detailCharts() {
    const t=state.summary.trends.slice(-14);
    const medication=t.map(r=>({...r,medValue:r.medicationStatus==='taken'?100:r.medicationStatus==='partial'?50:r.medicationStatus==='missed'?0:null}));
    const panels=[['활동 추이','최근 14일',t,'steps',{unit:'걸음',color:'#73ad98'},'입력한 걸음 수','미기록일은 연결하지 않음'],['수면 추이','최근 14일',t,'sleepHours',{unit:'시간',color:'#a7a1c7'},'입력한 수면 시간','수면 질은 별도 평가 필요'],['복약 보고','최근 14일',medication,'medValue',{unit:'점',color:'#a1b88c',type:'bar',max:100},'100 복용 · 50 일부 · 0 미복용','자기보고 기준'],['식사 기록 추이','최근 14일',t,'calories',{unit:'kcal',color:'#d5b47e',type:'bar'},'기록된 식사의 영양 추정 합계','실제 섭취량을 확정하지 않음']];
    return `<div class="detail-chart-grid">${panels.map(([title,period,rows,key,options,note,right])=>`<section class="card"><div class="card-header"><h2>${title}</h2><span class="card-count">${period}</span></div><div class="chart-wrap">${chart(rows,key,{...options,height:145,label:title})}</div><div class="chart-footer"><span>${note}</span><span>${right}</span></div></section>`).join('')}</div>`;
  }
  function coverage() {
    const s=state.summary,m=s.metrics;const data=[['활동',m.steps.coverageDays],['수면',m.sleepHours.coverageDays],['복약',m.medication.reportedDays],['식사',m.nutrition.recordedDays]];
    return `<section class="card coverage-card"><h3>판단의 시작은, 충분한 기록</h3><p>최근 7일 중 영역별 기록이 있는 날입니다.<br>미기록은 0 또는 정상으로 처리하지 않습니다.</p>${data.map(([label,days])=>`<div class="coverage-row"><span>${label}</span><span class="coverage-bar"><i style="width:${clamp(days/7*100,0,100)}%"></i></span><b>${num(days)}/7일</b></div>`).join('')}<div class="coverage-note">기록률 ${num(m.completion.value)}% · ${m.completion.reportedDays}/7일에 일일 또는 식사 기록<br>체중 ${num(m.weightKg.value,1)} kg ${m.weightKg.date?`· ${shortDate(m.weightKg.date)} 보고`:''}</div><div class="risk-reasons"><h4>확인 우선순위의 근거</h4><ul>${s.risk.reasons.length?s.risk.reasons.map(r=>`<li>${esc(r)}</li>`).join(''):`<li>${s.risk.level==='insufficient'?'판단하기에 기록이 충분하지 않습니다.':'현재 데모 확인 규칙에 해당하는 항목이 없습니다.'}</li>`}</ul><p class="coverage-note">${esc(s.risk.disclaimer)}</p></div></section>`;
  }
  function foodIllustration(food) {
    const content={balanced:'<ellipse cx="55" cy="54" rx="14" ry="18" fill="#e9ddc0"/><circle cx="82" cy="37" r="11" fill="#88a276"/><circle cx="93" cy="57" r="10" fill="#c98f6f"/><circle cx="81" cy="77" r="11" fill="#d7ac70"/>',protein:'<path d="M44 58c-11-21 26-31 39-10s-10 43-29 27Z" fill="#b99573"/><path d="m48 50 19 21m-10-27 20 19" stroke="#927357" stroke-width="3" opacity=".4"/><circle cx="88" cy="37" r="9" fill="#91a778"/><circle cx="91" cy="79" r="8" fill="#adb28a"/>',noodles:'<ellipse cx="70" cy="57" rx="29" ry="25" fill="#dfc796"/><path d="M49 52c10-19 35 9 43-9M47 63c16-22 31 10 48-4M54 73c14-17 28 7 34-7" stroke="#b9a06d" stroke-width="3" fill="none"/><circle cx="78" cy="40" r="5" fill="#9dba87"/>',porridge:'<ellipse cx="70" cy="57" rx="30" ry="26" fill="#e2d4b5"/><path d="m56 47 3 2m16-4 2 2m-5 14 3 1m-17 6 4 1m22-16 3 2m-7 17 2 2" stroke="#b5a78a" stroke-width="2.5" stroke-linecap="round"/><path d="m66 50 7-5m-8 22 9-5" stroke="#98ae80" stroke-width="2.5"/>'}[food]||'';
    return `<svg viewBox="0 0 140 110" width="100%" height="100%" role="img" aria-label="음식 유형 예시 일러스트"><rect width="140" height="110" fill="#f0f3ea"/><ellipse cx="72" cy="61" rx="44" ry="41" fill="#d9e1d1" opacity=".4"/><circle cx="70" cy="55" r="39" fill="#fcfcf7"/><circle cx="70" cy="55" r="32" fill="#f3f2e9"/>${content}<path d="M123 23v65m-5-65v15m10-15v15m-10 0q5 7 10 0" stroke="#b4b9a9" stroke-width="2.1" fill="none" stroke-linecap="round"/></svg>`;
  }
  function meals() {
    const meals=state.summary.recentMeals.slice(0,3);
    return `<section class="card"><div class="card-header"><div><h2>식탁에서 온 기록</h2><p class="subheading">최근 식사 · 음식 유형과 섭취 비율 기반 추정</p></div><span class="small-label">최근 ${meals.length}건</span></div>${meals.length?`<div class="meal-list">${meals.map(m=>`<article class="meal-item"><div class="meal-visual">${m.imageUrl && /^\/uploads\/[a-zA-Z0-9._-]+$/.test(m.imageUrl)?`<img src="${esc(m.imageUrl)}" alt="${esc(shortDate(m.date))} ${esc(mealLabel(m.mealType))} 식사 사진" loading="lazy">`:foodIllustration(m.foodType)}<span class="food-label">${m.imageUrl?'등록 사진':'예시 그림'}</span></div><h4>${shortDate(m.date)} ${mealLabel(m.mealType)} · ${esc(foodLabel(m.foodType))}</h4><p>${num(m.calories)} kcal · 단백질 ${num(m.proteinGrams,1)} g</p><small>섭취 비율 ${num(m.portion*100)}%</small></article>`).join('')}</div>`:'<div class="compact-empty">아직 기록된 식사가 없습니다.</div>'}<div class="source-disclaimer">영양값은 선택한 음식과 섭취 비율을 기준으로 계산한 예시입니다. 사진 분석은 수행하지 않습니다.</div></section>`;
  }
  function recordTable(full = false) {
    const records=state.summary?.recentRecords.slice(0,full?14:5)||[];
    return `<div class="table-scroll"><table class="patient-table records-table ${full?'record-full':''}" aria-label="환자 일일 건강 기록"><thead><tr><th>날짜</th><th>활동</th><th>수면</th><th>복약 보고</th>${full?'<th>식욕</th><th>기분</th><th>체중</th>':''}<th>메모</th></tr></thead><tbody>${records.length?records.map(r=>`<tr><td>${shortDate(r.date)}</td><td>${num(r.steps)} <span class="unit-note">걸음</span></td><td>${num(r.sleepHours,1)} <span class="unit-note">h</span></td><td><span class="med-dot ${r.medicationStatus==='missed'?'no':r.medicationStatus==='partial'?'partial':r.medicationStatus==='taken'?'yes':'unknown'}"></span>${medLabel(r.medicationStatus)}</td>${full?`<td>${esc({good:'좋음',normal:'보통',poor:'저하'}[r.appetite]||'미기록')}</td><td>${esc({good:'좋음',normal:'보통',poor:'좋지 않음'}[r.mood]||'미기록')}</td><td>${num(r.weightKg,1)} <span class="unit-note">kg</span></td>`:''}<td class="record-note" title="${esc(r.note)}">${esc(r.note||'—')}</td></tr>`).join(''):`<tr><td colspan="${full?8:5}"><div class="compact-empty">아직 일일 기록이 없습니다. 환자용 사이트에서 첫 기록을 남겨보세요.</div></td></tr>`}</tbody></table></div>`;
  }
  function recentRecords() { return `<section class="card"><div class="card-header"><div><h2>최근 건강 기록</h2><p class="subheading">${esc(state.summary.patient.name)} 님 · 환자 입력 자료</p></div><button class="text-link" data-action="view" data-view="records">전체 보기 ${icon('arrow')}</button></div>${recordTable()}</section>`; }
  function expandedBriefing() {
    const s=state.summary;
    return `<section class="card briefing-expanded"><h3>근거와 함께 보는 브리핑 <span class="demo-ai-badge" style="display:inline-flex;margin-left:6px">규칙 기반 데모</span></h3><p>각 요약은 아래에 표시된 저장 기록에서 만들어졌습니다. 충분하지 않은 자료는 추가 확인해 주세요.</p>${s.briefing.items.map(item=>`<article class="briefing-evidence-item"><h4>${esc(item.title)}</h4><p>${esc(item.text)}</p><div class="evidence-list">${item.evidence.slice(-4).map(e=>`<span class="evidence-tag">${shortDate(e.date)} · ${esc(e.source==='demo-food-table-v1'?'음식표 예시 추정':e.source)} · ${esc(typeof e.value==='string'?({taken:'복용',partial:'일부 복용',missed:'미복용',unknown:'알 수 없음'}[e.value]||e.value):num(e.value,1))}</span>`).join('')}</div></article>`).join('')}</section>`;
  }
  function patientDetails(expanded = false) {
    const s=state.summary;if(!s)return '';
    return `<section id="patient-detail"><div class="section-heading"><div><div class="detail-topline"><h2>${esc(s.patient.name)} 님의 일상 변화</h2>${riskPill(s.risk)}</div><p>최근 7일 요약 · 보고된 날의 평균과 기록의 충분함을 함께 확인하세요.</p></div><div class="section-action-group"><span class="small-label">${shortDate(s.trends.at(-7)?.date)} — ${shortDate(s.today)}</span><a class="text-link" href="/patient?patientId=${encodeURIComponent(s.patient.id)}" target="_blank" rel="noopener">환자 화면 ${icon('external')}</a></div></div>${metricPanels()}<div class="detail-analysis-grid">${detailCharts()}${coverage()}</div><div class="meals-records-grid">${meals()}${recentRecords()}</div><div class="notes-questions"><h3>${icon('chat')}다음 방문에서 물어보세요</h3><ul>${s.briefing.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul></div>${expanded?expandedBriefing():''}</section>`;
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
    return `${patientList(true)}${s?`<div class="patient-workspace"><section class="selected-patient-banner"><span class="avatar">${esc(s.patient.name[0])}</span><div><h2>${esc(s.patient.name)} <span class="small-label">${s.patient.age}세 · ${sexLabel(s.patient.sex)}</span></h2><p>${esc(s.patient.conditions.join(' · ')||'기저질환 미입력')} · ${esc(s.patient.caregiver||'돌봄 정보 미입력')}</p></div><div class="banner-meta"><div>현재 복약 정보<b>${esc(s.patient.medications.join(' · ')||'미입력')}</b></div>${riskPill(s.risk)}</div><a href="/patient?patientId=${encodeURIComponent(s.patient.id)}" target="_blank" rel="noopener" class="button button-secondary">${icon('external')}환자 화면 열기</a></section>${patientDetails(true)}</div>`:''}`;
  }
  function recordsView() {
    if(!state.data.patients.length)return emptyWorkspace();
    return `<div class="records-toolbar"><label for="record-patient">환자 선택<select id="record-patient">${state.data.patients.map(p=>`<option value="${esc(p.id)}" ${p.id===state.selectedId?'selected':''}>${esc(p.name)} · ${p.age}세</option>`).join('')}</select></label><a class="button button-secondary" href="/api/export.csv" download>${icon('download')}전체 기록 CSV 내보내기</a></div><section class="card"><div class="card-header"><div><h2>${esc(state.summary?.patient.name)} 님의 건강 기록</h2><p class="subheading">최근 일일 기록 14건 · 빈칸은 미측정으로 보존됩니다.</p></div><span class="small-label">환자 자기보고</span></div>${recordTable(true)}</section><div class="meals-records-grid">${meals()}${coverage()}</div><div class="provenance-card"><b>기록과 분석의 출처</b><br>활동·수면·복약은 환자가 입력한 자기보고이며, 기기로 자동 측정한 값이 아닙니다. 영양값은 음식 유형과 섭취 비율을 고정 음식표에 적용한 예시 추정입니다. CSV에는 환자·일일·식사 기록이 함께 포함됩니다.</div>`;
  }
  function settingsView() {
    return `<div class="settings-grid"><section class="card"><div class="card-header"><div><h2>연결된 데모 환경</h2><p class="subheading">환자와 의료진 화면이 같은 테스트 데이터를 사용합니다.</p></div><span class="settings-tag">연결됨</span></div><div class="settings-body"><div class="settings-row"><div><h3>환자용 모바일 사이트</h3><p>모바일 화면에서 건강·식사 기록을 남기고, 의료진 화면에서 결과를 확인할 수 있습니다.</p></div><a class="button button-secondary" href="/patient${state.selectedId?`?patientId=${encodeURIComponent(state.selectedId)}`:''}" target="_blank" rel="noopener">사이트 열기 ${icon('external')}</a></div><div class="settings-row"><div><h3>테스트 기록 내보내기</h3><p>등록 환자와 일일·식사 기록을 CSV 파일로 내려받습니다. 초기화 전에 필요한 기록을 보관하세요.</p></div><a class="button button-secondary" href="/api/export.csv" download>${icon('download')}CSV 받기</a></div><div class="settings-row"><div><h3>기록 자동 갱신</h3><p>20초마다 새 기록을 확인합니다. 새로고침 버튼으로 즉시 갱신할 수도 있습니다.</p></div><span class="settings-tag">사용 중</span></div></div></section><section class="card danger-card"><div class="card-header"><div><h2>테스트 데이터 초기화</h2><p class="subheading">실행 전 확인 문구를 입력해야 합니다.</p></div>${icon('database')}</div><div class="settings-body"><div class="settings-row"><div><h3>예시 데이터로 다시 시작</h3><p>현재 테스트 기록을 지우고, 가상 환자 6명과 4주 예시 기록을 복원합니다. 업로드 사진도 삭제됩니다.</p></div><button class="button button-secondary" data-action="reset" data-mode="seed">예시 데이터 복원</button></div><div class="settings-row"><div><h3>빈 데이터베이스로 시작</h3><p>환자·건강 기록·식사 기록과 업로드 사진을 모두 삭제합니다. 새 가상 환자를 등록해 테스트할 수 있습니다.</p></div><button class="button button-danger" data-action="reset" data-mode="empty">모든 테스트 데이터 삭제</button></div><p class="settings-detail">초기화 후에는 기록을 되돌릴 수 없습니다. 연구 투입 전에는 로그인·권한·동의·보안·기관 승인을 별도로 갖춰야 합니다.</p></div></section><section class="card"><div class="card-header"><h2>데모 결과를 읽는 방법</h2></div><div class="settings-body settings-detail"><ul><li>확인 우선순위는 기록에 정해진 데모 규칙을 적용한 결과이며, 질병 발생 확률이나 확정 진단이 아닙니다.</li><li>복약은 자기보고이며 실제 복용을 확정하지 않습니다.</li><li>식사 사진은 저장·열람 용도이며 사진으로 영양을 분석하지 않습니다.</li><li>영양값은 선택 음식과 섭취 비율을 적용한 예시 추정입니다.</li><li>미기록은 0 또는 정상으로 대체하지 않으며, 판단 시 기록 일수를 함께 보아야 합니다.</li></ul></div></section><section class="card"><div class="card-header"><h2>현재 워크스페이스</h2></div><div class="settings-body settings-detail">등록 환자 <b>${state.data.stats.patients}명</b><br>오늘 기록 <b>${state.data.stats.reportedToday}명</b><br>예시 기준일 <b>${esc(state.data.today)}</b><br>시간대 <b>대한민국 (Asia/Seoul)</b><br>최근 초기화 <b>${state.data.resetAt?esc(new Date(state.data.resetAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'아직 없음'}</b><br><br>저장된 테스트 기록은 페이지를 새로 열어도 유지됩니다. 이 공개 데모에는 실제 환자 개인정보를 입력하지 마세요.</div></section></div>`;
  }
  function render() {
    if(!state.data)return;
    const [eyebrow,title,subtitle,breadcrumb]=viewTitles[state.view];
    $('#page-eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-subtitle').textContent=subtitle;$('#view-breadcrumb').textContent=breadcrumb;
    document.querySelectorAll('#main-nav [data-view]').forEach(btn=>{const active=btn.dataset.view===state.view;btn.classList.toggle('active',active);if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');});
    const inputFocused=document.activeElement?.id==='patient-search';const cursor=inputFocused?document.activeElement.selectionStart:null;
    $('#app-content').innerHTML=({overview,patients:patientsView,records:recordsView,settings:settingsView}[state.view])();
    if(inputFocused&&$('#patient-search')){$('#patient-search').focus();$('#patient-search').setSelectionRange(cursor,cursor);}
    syncUrl();
  }
  function changeView(view) { if(!viewTitles[view])return;state.view=view;render();window.scrollTo({top:0,behavior:'instant'}); }
  function closeModal() {
    $('#modal-backdrop').hidden=true;$('#modal').innerHTML='';state.modal=null;document.body.style.overflow='';if(state.lastFocus?.isConnected)state.lastFocus.focus();
  }
  function openModal(type, mode='seed') {
    state.lastFocus=document.activeElement;state.modal={type,mode};
    $('#modal-backdrop').hidden=false;document.body.style.overflow='hidden';
    const close=`<button class="icon-button" data-modal-action="close" aria-label="닫기">${icon('close')}</button>`;
    if(type==='add') {
      $('#modal').innerHTML=`<div class="modal-top"><h2 id="modal-title">가상 환자 추가</h2>${close}</div><p class="modal-description">시연에 사용할 가상 정보를 입력하세요.<br>실제 환자의 이름이나 개인정보를 입력하지 마세요.</p><form id="add-patient-form"><div class="field"><label for="new-patient-name">가상 이름 <span aria-hidden="true">*</span></label><input id="new-patient-name" name="name" placeholder="예: 김새봄" required maxlength="40" autocomplete="off"></div><div class="form-row"><div class="field"><label for="new-patient-age">나이 *</label><input id="new-patient-age" name="age" type="number" min="1" max="120" value="75" required></div><div class="field"><label for="new-patient-sex">성별 *</label><select id="new-patient-sex" name="sex"><option value="female">여성</option><option value="male">남성</option><option value="other">기타</option></select></div></div><div class="field"><label for="new-patient-conditions">기저질환 <small>선택</small></label><input id="new-patient-conditions" name="conditions" placeholder="예: 고혈압, 당뇨병" maxlength="500"><small>여러 질환은 쉼표로 구분해 주세요.</small></div><div class="form-error" id="modal-error" role="alert" hidden></div><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">취소</button><button type="submit" class="button button-primary">${icon('plus')}환자 등록</button></div></form>`;
      $('#new-patient-name').focus();
    } else {
      const seed=mode==='seed';
      $('#modal').innerHTML=`<div class="modal-top"><h2 id="modal-title">${seed?'예시 데이터 복원':'모든 테스트 데이터 삭제'}</h2>${close}</div><p class="modal-description">${seed?'새 시연을 위해 처음의 예시 데이터로 돌아갑니다.':'환자와 기록이 없는 빈 데이터베이스로 시작합니다.'}</p><div class="reset-warning">현재 환자, 건강·식사 기록, 업로드한 사진이 모두 삭제됩니다. ${seed?'가상 환자 6명과 예시 기록을 새로 생성합니다.':''}<br><b>이 작업은 되돌릴 수 없습니다.</b></div><form id="reset-form"><div class="field"><label for="reset-confirmation">계속하려면 <b>초기화</b>를 입력하세요.</label><input id="reset-confirmation" name="confirmation" placeholder="초기화" required autocomplete="off"></div><div class="form-error" id="modal-error" role="alert" hidden></div><div class="modal-actions"><button type="button" class="button button-secondary" data-modal-action="close">취소</button><button type="submit" class="button button-danger">${seed?'초기화 후 예시 복원':'모든 데이터 삭제'}</button></div></form>`;
      $('#reset-confirmation').focus();
    }
  }
  async function submitModal(event) {
    const form=event.target;if(!['add-patient-form','reset-form'].includes(form.id))return;event.preventDefault();
    const err=$('#modal-error');err.hidden=true;const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const fields=new FormData(form);
      if(form.id==='add-patient-form') {
        const result=await api('/api/patients',{method:'POST',body:JSON.stringify({name:String(fields.get('name')).trim(),age:Number(fields.get('age')),sex:fields.get('sex'),conditions:String(fields.get('conditions')).split(',').map(s=>s.trim()).filter(Boolean)})});
        state.selectedId=result.patient?.id||result.id;state.view='patients';state.filter='all';state.search='';closeModal();await refresh({quiet:true});toast('가상 환자를 등록했습니다. 환자 화면에서 첫 기록을 남겨보세요.');
      } else {
        if(String(fields.get('confirmation')).trim()!=='초기화')throw new Error('확인 문구를 정확히 입력해 주세요: 초기화');
        const mode=state.modal.mode;
        await api('/api/demo/reset',{method:'POST',body:JSON.stringify({mode,confirmation:'RESET'})});
        state.selectedId=null;state.summary=null;state.search='';state.filter='all';state.view='overview';closeModal();await refresh({quiet:true});toast(mode==='seed'?'예시 데이터를 복원했습니다.':'모든 테스트 데이터를 삭제했습니다.');
      }
    } catch(error) { if($('#modal-error')){$('#modal-error').textContent=error.message;$('#modal-error').hidden=false;}else toast(error.message,true); }
    finally { if(submit.isConnected)submit.disabled=false; }
  }
  $('#main-nav').addEventListener('click',event=>{const btn=event.target.closest('[data-view]');if(btn)changeView(btn.dataset.view);});
  $('#refresh-button').addEventListener('click',()=>refresh());
  $('#add-patient-button').addEventListener('click',()=>openModal('add'));
  $('#app-content').addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');if(!el)return;
    const action=el.dataset.action;
    if(action==='select-patient')selectPatient(el.dataset.id);
    if(action==='alert-patient')selectPatient(el.dataset.id,true).then(()=>$('#patient-detail')?.scrollIntoView({behavior:'smooth',block:'start'}));
    if(action==='view')changeView(el.dataset.view);
    if(action==='filter'){state.filter=el.dataset.filter;render();}
    if(action==='add-patient')openModal('add');
    if(action==='reset')openModal('reset',el.dataset.mode);
    if(action==='open-detail'){event.preventDefault();$('#patient-detail')?.scrollIntoView({behavior:'smooth',block:'start'});}
  });
  $('#app-content').addEventListener('keydown',event=>{const row=event.target.closest('.patient-row');if(row&&['Enter',' '].includes(event.key)){event.preventDefault();selectPatient(row.dataset.id);}});
  $('#app-content').addEventListener('input',event=>{
    if(event.target.id==='patient-search') {state.search=event.target.value;$('#patient-table-body').innerHTML=patientRows(state.view==='patients');$('#patient-count-label').textContent=`전체 ${state.data.patients.length}명 중 ${filteredPatients().length}명 표시`;}
  });
  $('#app-content').addEventListener('change',event=>{if(event.target.id==='record-patient')selectPatient(event.target.value);});
  $('#modal-backdrop').addEventListener('click',event=>{if(event.target===$('#modal-backdrop')||event.target.closest('[data-modal-action="close"]'))closeModal();});
  $('#modal').addEventListener('submit',submitModal);
  document.addEventListener('keydown',event=>{
    if(!state.modal)return;
    if(event.key==='Escape'){closeModal();return;}
    if(event.key==='Tab') {const items=[...$('#modal').querySelectorAll('button:not([disabled]),input,select,a[href]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){last?.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first?.focus();event.preventDefault();}}
  });
  refresh({quiet:true});
  setInterval(()=>{if(!document.hidden)refresh({quiet:true});},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({quiet:true});});
})();
