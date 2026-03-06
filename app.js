/* =========================================
   HomeCare AI — Application Logic
   ========================================= */

// ===========================
// PATIENT DATA
// ===========================
const patients = [
  {
    id: 0,
    name: '김영수',
    gender: '남',
    age: 78,
    time: '09:00',
    address: '서울 강남구 역삼동 123-4 (거동 제한)',
    diseases: ['제2형 당뇨', '고혈압', '만성신장질환 3기', '골관절염'],
    drugs: 8,
    frailty: 18,
    frailtyLabel: '경도 노쇠',
    mmse: 25,
    phq9: 8,
    risk: 'high',
    briefing: {
      drugWarnings: [
        '🔴 클로르페니라민: 강한 항콜린 작용 → 2세대 전환 권고',
        '🟠 로라제팜 + 낙상 고위험: BZD 낙상위험 2배 → 비약물 수면관리',
        '🟡 글리메피리드 + eGFR 38: 저혈당 위험 → 용량 감량 검토',
      ],
      recentLabs: '혈당(공복) 185 mg/dL ↑ | HbA1c 8.2% ↑\neGFR 38 mL/min ↓ | 크레아티닌 1.8 mg/dL\n혈색소 11.2 g/dL (경도 빈혈)',
      lastVisitIssues: [
        '혈당 조절 불량 지속 → 인슐린 전환 논의 필요',
        '야간 수면장애 호소 → 로라제팜 의존 우려',
        '좌측 무릎 부종 악화 → 정형외과 의뢰 검토',
      ],
      todayAlerts: [
        '1. 신기능 악화 추세 — eGFR/크레아티닌 재확인',
        '2. 다약제 복용(8개) — Beers Criteria 약물 재검토',
        '3. 혈당 조절 실패 — 인슐린 전환 의사결정',
        '4. 낙상 위험 — 환경 평가 + BZD 감량 논의',
      ],
      observeItems: ['신기능 재확인', '혈당 추이 확인', '약물 부작용 모니터링', '낙상 위험 평가'],
      prep: {
        equipment: '혈압계, 혈당측정기, 체온계, SpO2',
        drugs: '인슐린 교육 키트, 처방전 사본',
        documents: '정형외과 의뢰서, 수면위생 교육자료',
      },
    },
    soap: {
      s: '78세 남환. 최근 1개월 혈당 조절 불량(공복 180~200mg/dL) 호소. 야간 수면 어려움 지속, 좌측 무릎 부종으로 보행 불편 지속. 경구 혈당강하제 복용 중이나 효과 미흡. 식이 조절은 어느 정도 유지 중.',
      o: '활력징후: BP 148/92mmHg ↑, HR 78bpm, BT 36.5°C, SpO₂ 97%\n혈당(공복): 185 mg/dL ↑ | HbA1c 8.2% ↑\neGFR 38 mL/min ↓ (경-중등도 신기능 저하)\nK-MMSE 25/30 (전회 27, 2점 감소)\nPHQ-9 8점 (전회 6, 경도 우울↑)',
      a: '① 제2형 당뇨: 경구약 한계 → 인슐린 도입 필요성 증가\n② 만성신장질환 3기: eGFR 악화 추세 → 글리메피리드 중단 고려\n③ 수면장애: 로라제팜 의존 → 비약물 요법 전환 권고\n④ 인지기능: K-MMSE 2점 감소 → 추적 관찰 강화\n⑤ 낙상 위험: 수면제 + 무릎 불안정 복합 위험',
      p: '1. 인슐린 글라르긴 10U/day 도입 처방 예정\n2. 글리메피리드 → 리나글립틴 전환 (신기능 고려)\n3. 로라제팜 점감, 비약물 수면요법 교육\n4. 신장내과 협진 의뢰서 발급\n5. K-MMSE 1개월 후 재평가\n6. 낙상 예방 교육 및 가정 환경 점검',
    },
  },
  {
    id: 1,
    name: '이순자',
    gender: '여',
    age: 82,
    time: '11:30',
    address: '서울 관악구 봉천동 456-7',
    diseases: ['심부전', '골다공증', '우울증'],
    drugs: 5,
    frailty: 22,
    frailtyLabel: '중등도 노쇠',
    mmse: 27,
    phq9: 11,
    risk: 'medium',
    briefing: {
      drugWarnings: [
        '🔴 아미트리프틸린: 강한 항콜린/심장 독성 → 고령자 사용 금기',
        '🟠 푸로세미드 + 저나트륨: 전해질 이상 모니터링 필요',
      ],
      recentLabs: 'BNP 450 pg/mL ↑ (심부전 악화 지표)\n혈청 나트륨 133 mEq/L ↓\nDXA 골밀도: T-score -2.8 (골다공증 진단)',
      lastVisitIssues: [
        '하지 부종 악화 → 이뇨제 용량 조정 필요',
        'PHQ-9 9점 → 항우울제 효과 불충분',
        '2주 전 미끄러짐 사고 (낙상 아님)',
      ],
      todayAlerts: [
        '1. 심부전 악화 징후 — BNP, 부종 상태 확인',
        '2. 우울 증상 악화 — PHQ-9 재평가 및 치료 조정',
        '3. 골다공증 — 항골다공증제 복약 점검',
        '4. 저나트륨혈증 — 수분·염분 섭취 교육',
      ],
      observeItems: ['심부전 증상 확인', '우울 척도 평가', '부종 정도', '복약 순응도'],
      prep: {
        equipment: '혈압계, 청진기, 체중계, SpO2',
        drugs: '이뇨제 처방 검토, 항우울제 교육자료',
        documents: '심장내과 협진 양식, 정신건강의학과 의뢰서',
      },
    },
    soap: {
      s: '82세 여환. 최근 2주간 하지 부종 악화 및 호흡곤란 증가 호소. 식욕 감퇴, 외출 꺼림, 무기력감 심화. 항우울제 복용 중이나 효과 미흡하다고 호소. 잠 못 이루는 날이 많다고 함.',
      o: '활력징후: BP 136/84mmHg, HR 82bpm, BT 36.3°C, SpO₂ 95%\n체중 전주 대비 +1.8kg ↑ (수분 저류 의심)\nBNP 450 pg/mL ↑\nPHQ-9 11점 (중등도 우울)\nK-MMSE 27/30',
      a: '① 심부전 악화: BNP 상승 + 체중 증가 → 이뇨제 증량 필요\n② 중등도 우울: PHQ-9 11점 → 현 항우울제 효과 불충분\n③ 아미트리프틸린: 심장 독성 위험 → 즉시 교체 권고\n④ 저나트륨: 이뇨제 부작용 → 전해질 재확인',
      p: '1. 푸로세미드 40mg → 80mg 증량\n2. 아미트리프틸린 중단, 세르트랄린 25mg 시작\n3. 2주 후 전해질·BNP 추적 검사 의뢰\n4. 심장내과 외래 예약 (2주 이내)\n5. 저염·저수분 식이 교육\n6. PHQ-9 2주 후 재평가',
    },
  },
  {
    id: 2,
    name: '박철호',
    gender: '남',
    age: 71,
    time: '14:00',
    address: '서울 송파구 문정동 789-1',
    diseases: ['COPD', '고지혈증'],
    drugs: 4,
    frailty: 10,
    frailtyLabel: '건강',
    mmse: 28,
    phq9: 4,
    risk: 'low',
    briefing: {
      drugWarnings: [
        '🟡 심바스타틴 + 클라리스로마이신 병용 시: 근병증 위험 주의',
      ],
      recentLabs: 'FEV1/FVC 62% (COPD GOLD 2단계)\nLDL 콜레스테롤 118 mg/dL (목표 이하 도달)\n산소포화도 96%',
      lastVisitIssues: [
        '호흡기 증상 계절적 악화 경향',
        '흡입제 사용법 재교육 필요',
      ],
      todayAlerts: [
        '1. COPD 흡입제 복약 순응도 및 사용법 확인',
        '2. 이상지질혈증 LDL 재확인',
        '3. 독감·폐구균 예방접종 여부 확인',
      ],
      observeItems: ['흡입제 사용 확인', 'LDL 추이', '예방접종 확인'],
      prep: {
        equipment: '혈압계, SpO2, 청진기',
        drugs: '흡입기 교육 모형',
        documents: '호흡 재활 운동 안내문',
      },
    },
    soap: {
      s: '71세 남환. 최근 기침 빈도 증가 호소. 계단 오르기 시 약간의 호흡곤란 있으나 일상생활은 독립적으로 수행 중. 금연 유지 중(3년). 흡입제 사용은 하루 1회 정도.',
      o: '활력징후: BP 128/78mmHg, HR 72bpm, BT 36.4°C, SpO₂ 96%\nFEV1/FVC 62% (안정기 유지)\nLDL 118 mg/dL (목표 달성)\nK-MMSE 28/30\nPHQ-9 4점 (정상)',
      a: '① COPD GOLD 2단계: 현재 안정기, 흡입제 순응도 개선 필요\n② 이상지질혈증: LDL 목표 도달, 현 스타틴 유지 적절\n③ 전반적 상태 양호 — 정기 모니터링 유지',
      p: '1. LABA/LAMA 복합 흡입제 사용법 재교육\n2. 폐구균 예방접종 확인 및 미접종 시 접종 의뢰\n3. 독감 예방접종 안내 (접종철 확인)\n4. 3개월 후 폐기능 검사 추적\n5. 스타틴 유지, 6개월 후 지질 재검',
    },
  },
];

// ===========================
// APP STATE
// ===========================
let state = {
  mode: 'proto',          // 'proto' | 'live'
  selectedPatient: null,  // patient index
  currentScreen: 'dashboard',
  currentStage: 1,
  currentInterviewTab: 0,
  selectedModel: 'claude',
  apiKey: '',
};

// ===========================
// SCREEN MANAGEMENT
// ===========================
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    state.currentScreen = screenId;
  }
  updateStatusBar(screenId);
  updateBottomNav(screenId);
}

function updateStatusBar(screenId) {
  const el = document.getElementById('status-app-name');
  const map = {
    'screen-dashboard': 'HomeCare AI',
    'screen-stage1': 'HomeCare AI',
    'screen-stage2': 'HomeCare AI',
    'screen-vitals': 'HomeCare AI',
    'screen-stage3': 'HomeCare AI',
    'screen-live': '● HomeCare AI · AI',
  };
  el.textContent = map[screenId] || 'HomeCare AI';
}

function updateBottomNav(screenId) {
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const map = {
    'screen-dashboard': 'bnav-home',
    'screen-stage1': 'bnav-home',
    'screen-stage2': 'bnav-interview',
    'screen-vitals': 'bnav-interview',
    'screen-stage3': 'bnav-records',
    'screen-live': null,
  };
  const id = map[screenId];
  if (id) document.getElementById(id)?.classList.add('active');
}

// ===========================
// MODE SWITCHING
// ===========================
function switchMode(mode) {
  state.mode = mode;
  document.getElementById('btn-proto').classList.toggle('active', mode === 'proto');
  document.getElementById('btn-live').classList.toggle('active', mode === 'live');

  if (mode === 'live') {
    showScreen('screen-live');
    document.getElementById('bottom-nav').style.display = 'none';
  } else {
    document.getElementById('bottom-nav').style.display = 'flex';
    showScreen('screen-dashboard');
  }
}

// ===========================
// PATIENT SELECTION
// ===========================
function selectPatient(idx) {
  state.selectedPatient = idx;
  const p = patients[idx];

  // Traffic light colors
  const riskConfig = {
    high: { lights: ['🔴', '⚪', '⚪'], label: '고위험', bg: '#fee2e2', color: '#991b1b', msg: '즉시 의료진 연락 필요 가능성' },
    medium: { lights: ['⚪', '🟡', '⚪'], label: '주의', bg: '#fef3c7', color: '#92400e', msg: '집중 모니터링 필요' },
    low: { lights: ['⚪', '⚪', '🟢'], label: '안정', bg: '#dcfce7', color: '#166534', msg: '정기 방문 관리 유지' },
  };
  const rc = riskConfig[p.risk] || riskConfig.low;

  // Avatar initials (first char of name)
  const initial = p.name.charAt(0);
  const avatarBg = p.risk === 'high' ? '#fecaca' : p.risk === 'medium' ? '#fde68a' : '#bbf7d0';
  const avatarColor = p.risk === 'high' ? '#991b1b' : p.risk === 'medium' ? '#92400e' : '#166534';

  // Populate Stage 1 patient card
  const card = document.getElementById('s1-patient-card');
  card.innerHTML = `
    <div class="pi-header">
      <div class="pi-avatar" style="background:${avatarBg};color:${avatarColor}">${initial}</div>
      <div class="pi-info">
        <div class="pi-name-row">
          <span class="pi-name">${p.name}</span>
          <div class="traffic-light-wrap">
            <div class="traffic-light" title="중증도: ${rc.label}">
              <span class="tl-dot${p.risk === 'high' ? ' tl-on' : ''}" style="color:#ef4444">🔴</span>
              <span class="tl-dot${p.risk === 'medium' ? ' tl-on' : ''}" style="color:#f59e0b">🟡</span>
              <span class="tl-dot${p.risk === 'low' ? ' tl-on' : ''}" style="color:#22c55e">🟢</span>
            </div>
            <span class="tl-label" style="background:${rc.bg};color:${rc.color}">${rc.label}</span>
          </div>
        </div>
        <div class="pi-meta">${p.gender}/${p.age}세 · ${p.time}</div>
        <div class="pi-addr">${p.address}</div>
      </div>
    </div>
    <div class="patient-tags" style="margin-top:0.5rem">
      ${p.diseases.map(d => `<span class="tag tag--disease">${d}</span>`).join('')}
    </div>
    <div class="patient-stats">
      <span>약물 ${p.drugs}개</span>
      <span class="stat-dot">·</span>
      <span>Frailty ${p.frailty}/50</span>
      <span class="stat-dot">·</span>
      <span>K-MMSE ${p.mmse}/30</span>
    </div>
    <div class="tl-notice" style="background:${rc.bg};color:${rc.color};border-left:3px solid ${rc.color}">
      ⚡ ${rc.msg}
    </div>
  `;

  // Reset briefing
  document.getElementById('briefing-result').classList.add('hidden');
  document.getElementById('briefing-section').classList.remove('hidden');

  goToStage(1);
  showScreen('screen-stage1');
  updateFrailtyDisplay(p);
}

function updateFrailtyDisplay(p) {
  const numEl = document.getElementById('frailty-num');
  const badgeEl = document.getElementById('frailty-badge');
  if (numEl) numEl.textContent = p.frailty;
  if (badgeEl) {
    badgeEl.textContent = p.frailtyLabel;
    badgeEl.style.background = p.frailty >= 20 ? '#fee2e2' : p.frailty >= 15 ? '#fef3c7' : '#dcfce7';
    badgeEl.style.color = p.frailty >= 20 ? '#991b1b' : p.frailty >= 15 ? '#92400e' : '#166534';
    badgeEl.style.borderColor = p.frailty >= 20 ? '#fecaca' : p.frailty >= 15 ? '#fde68a' : '#bbf7d0';
  }
}

// ===========================
// STAGE NAVIGATION
// ===========================
function goToStage(stage) {
  state.currentStage = stage;
  if (stage === 1) showScreen('screen-stage1');
  else if (stage === 2) showScreen('screen-stage2');
  else if (stage === 3) showScreen('screen-stage3');
}

// ===========================
// GENERATE AI BRIEFING
// ===========================
function generateBriefing() {
  if (state.selectedPatient === null) return;
  const p = patients[state.selectedPatient];
  const btn = document.getElementById('btn-generate-briefing');

  btn.textContent = '✨ AI 분석 중...';
  btn.classList.add('loading-pulse');
  btn.disabled = true;

  setTimeout(() => {
    btn.classList.remove('loading-pulse');
    btn.disabled = false;
    btn.textContent = '✅ 브리핑 생성 완료';

    // Populate briefing content
    const b = p.briefing;
    const contentEl = document.getElementById('briefing-content');
    contentEl.innerHTML = `
      <div class="briefing-section-title">■ 주요 약물 경고 (Beers Criteria)</div>
      ${b.drugWarnings.map(w => `<div class="drug-alert-inline">${w}</div>`).join('')}
      <div class="briefing-section-title">■ 최근 검사 결과</div>
      <div class="briefing-line">${b.recentLabs.replace(/\n/g, '<br/>')}</div>
      <div class="briefing-section-title">■ 이전 방문 이슈</div>
      ${b.lastVisitIssues.map(i => `<div class="briefing-line">• ${i}</div>`).join('')}
      <div class="briefing-section-title">■ ⚠️ 금일 주의사항</div>
      ${b.todayAlerts.map(a => `<div class="briefing-line">${a}</div>`).join('')}
    `;

    const tagsEl = document.getElementById('observe-tags');
    tagsEl.innerHTML = b.observeItems.map(item => `<span class="observe-tag">${item}</span>`).join('');

    const prepEl = document.getElementById('prep-content');
    prepEl.innerHTML = `
      <div class="prep-category">필수 장비</div>
      <div class="prep-items">${b.prep.equipment}</div>
      <div class="prep-category">약물/교육</div>
      <div class="prep-items">${b.prep.drugs}</div>
      <div class="prep-category">서류</div>
      <div class="prep-items">${b.prep.documents}</div>
    `;

    document.getElementById('briefing-section').classList.add('hidden');
    document.getElementById('briefing-result').classList.remove('hidden');
    document.getElementById('briefing-result').classList.add('fade-in');

    showToast('AI 환자 브리핑 생성 완료!');
  }, 1500);
}

// ===========================
// START VISIT → Stage 2
// ===========================
function startVisit() {
  const p = patients[state.selectedPatient];
  if (p) renderRecordingChecklist(p);
  goToStage(2);
  switchInterviewTab(0);
}

// Render key checklist in recording tab from briefing observeItems + todayAlerts
function renderRecordingChecklist(p) {
  const container = document.getElementById('rec-checklist');
  if (!container) return;

  const items = [
    ...(p.briefing.observeItems || []),
    ...(p.briefing.todayAlerts || []).slice(0, 3),
  ];

  container.innerHTML = items.map((item, i) => `
    <div class="rec-check-item" id="rci-${i}" data-idx="${i}">
      <div class="rci-checkbox" id="rci-cb-${i}"></div>
      <span class="rci-text">${item}</span>
    </div>
  `).join('');

  window._rciItems = items;
}

// ===========================
// INTERVIEW TAB SWITCHING
// ===========================
function switchInterviewTab(idx) {
  state.currentInterviewTab = idx;

  document.querySelectorAll('.itab').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });

  document.querySelectorAll('.interview-panel').forEach((panel, i) => {
    panel.classList.toggle('hidden', i !== idx);
  });
}

// ===========================
// YES/NO ANSWERS
// ===========================
function answerYN(panelIdx, qIdx, answer) {
  const yesBtn = document.getElementById(`q${panelIdx}-${qIdx}-yes`);
  const noBtn = document.getElementById(`q${panelIdx}-${qIdx}-no`);
  if (!yesBtn || !noBtn) return;

  yesBtn.classList.toggle('selected', answer === 'yes');
  noBtn.classList.toggle('selected', answer === 'no');
}

// ===========================
// SCALE ANSWERS (PHQ-9)
// ===========================
function setScale(prefix, qIdx, val) {
  const group = document.getElementById(`${prefix}-${qIdx}`);
  if (!group) return;
  group.querySelectorAll('.scale-btn').forEach((btn, i) => {
    btn.classList.toggle('selected', i === val);
  });
}

// ===========================
// PROCEED TO VITALS
// ===========================
function proceedToVitals() {
  showScreen('screen-vitals');
}

// ===========================
// BLE SIMULATION
// ===========================
function simulateBLE() {
  const btn = document.querySelector('.ble-btn');
  btn.textContent = '📡 연동 중...';
  btn.style.background = 'var(--teal-300)';

  setTimeout(() => {
    btn.textContent = '✅ 연동 완료';
    btn.style.background = '#dcfce7';
    btn.style.color = '#166534';
    btn.style.borderColor = '#86efac';
    showToast('BLE 기기 연동 완료! 측정값 자동 입력되었습니다.');
  }, 2000);
}

// ===========================
// GENERATE SOAP
// ===========================
function generateSOAP() {
  if (state.selectedPatient === null) return;
  const p = patients[state.selectedPatient];
  const btn = document.getElementById('btn-generate-soap');

  btn.textContent = '✨ SOAP 기록 생성 중...';
  btn.classList.add('loading-pulse');
  btn.disabled = true;

  setTimeout(() => {
    btn.classList.remove('loading-pulse');
    btn.disabled = false;

    const soap = p.soap;
    document.getElementById('soap-s').innerHTML = soap.s.replace(/\n/g, '<br/>');
    document.getElementById('soap-o').innerHTML = soap.o.replace(/\n/g, '<br/>');
    document.getElementById('soap-a').innerHTML = soap.a.replace(/\n/g, '<br/>');
    document.getElementById('soap-p').innerHTML = soap.p.replace(/\n/g, '<br/>');

    // === Stage 3: Severity header + action panel ===
    renderStage3Header(p);

    document.getElementById('soap-generate-section').classList.add('hidden');
    document.getElementById('soap-result').classList.remove('hidden');
    document.getElementById('soap-result').classList.add('fade-in');

    showToast('AI SOAP 진료기록 생성 완료!');
  }, 2000);
}

// Determine urgency action based on patient risk
function renderStage3Header(p) {
  const headerEl = document.getElementById('stage3-severity-header');
  if (!headerEl) return;

  const riskConfig = {
    high: {
      light: '🔴',
      label: '고위험',
      bg: 'linear-gradient(135deg,#fee2e2,#fecaca)',
      border: '#fca5a5',
      color: '#991b1b',
      urgency: 'immediate',
      urgencyIcon: '🚨',
      urgencyTitle: '즉시 의료진 연락 필요',
      urgencyMsg: '환자의 상태가 즉각적인 의료 개입을 요구합니다. 담당 의사에게 즉시 연락하세요.',
      urgencyBg: '#fee2e2',
      urgencyColor: '#991b1b',
      nextVisit: '3~5일 이내 재방문',
    },
    medium: {
      light: '🟡',
      label: '주의',
      bg: 'linear-gradient(135deg,#fef3c7,#fde68a)',
      border: '#fcd34d',
      color: '#92400e',
      urgency: 'report',
      urgencyIcon: '📋',
      urgencyTitle: '보고서 전송 후 경과 관찰',
      urgencyMsg: '즉각적 응급 개입은 불필요하나 금일 방문보고서를 의료팀에 전송하고 경과를 모니터링하세요.',
      urgencyBg: '#fef3c7',
      urgencyColor: '#92400e',
      nextVisit: '1~2주 이내 재방문',
    },
    low: {
      light: '🟢',
      label: '안정',
      bg: 'linear-gradient(135deg,#dcfce7,#bbf7d0)',
      border: '#86efac',
      color: '#166534',
      urgency: 'routine',
      urgencyIcon: '✅',
      urgencyTitle: '정기 보고서 전송',
      urgencyMsg: '환자 상태 안정적입니다. 방문 보고서를 정기 채널로 전송하고 예정된 방문 일정을 유지하세요.',
      urgencyBg: '#dcfce7',
      urgencyColor: '#166534',
      nextVisit: '4주 후 정기 방문',
    },
  };

  const rc = riskConfig[p.risk] || riskConfig.low;

  headerEl.innerHTML = `
    <div class="s3-severity-card" style="background:${rc.bg};border:1.5px solid ${rc.border}">
      <div class="s3-sev-top">
        <span class="s3-sev-light">${rc.light}</span>
        <div class="s3-sev-info">
          <span class="s3-sev-name">${p.name} <span class="s3-sev-badge" style="background:${rc.urgencyBg};color:${rc.color}">${rc.label}</span></span>
          <span class="s3-sev-sub">방문 완료 · ${new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
      <div class="s3-urgency-panel" style="background:${rc.urgencyBg};border-left:4px solid ${rc.color}">
        <div class="s3-urgency-title" style="color:${rc.color}">${rc.urgencyIcon} ${rc.urgencyTitle}</div>
        <div class="s3-urgency-msg">${rc.urgencyMsg}</div>
      </div>
      <div class="s3-next-visit">
        <span class="s3-nv-icon">📅</span>
        <span class="s3-nv-label">다음 방문 권고:</span>
        <span class="s3-nv-val" style="color:${rc.color}">${rc.nextVisit}</span>
      </div>
    </div>
  `;
  headerEl.classList.remove('hidden');
}

// ===========================
// SOAP ACTIONS
// ===========================
function copySOAP() {
  const p = patients[state.selectedPatient];
  const text = `[S]\n${p.soap.s}\n\n[O]\n${p.soap.o}\n\n[A]\n${p.soap.a}\n\n[P]\n${p.soap.p}`;
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 SOAP 기록이 클립보드에 복사되었습니다.');
  }).catch(() => {
    showToast('복사를 지원하지 않는 환경입니다.');
  });
}

function saveSOAP() {
  showToast('💾 진료기록이 서버에 저장되었습니다.');
}

function finishVisit() {
  // Mark card as done
  const card = document.getElementById(`card-${state.selectedPatient}`);
  if (card) {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
    card.querySelector('.time-badge').textContent = '완료';
    card.querySelector('.time-badge').style.background = '#dcfce7';
    card.querySelector('.time-badge').style.color = '#166534';
  }

  state.selectedPatient = null;
  showScreen('screen-dashboard');
  navTo('dashboard');
  showToast('✅ 방문 완료! 다음 환자를 선택해주세요.');
}

// ===========================
// BOTTOM NAV
// ===========================
function navTo(dest) {
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));

  if (dest === 'dashboard') {
    document.getElementById('bnav-home')?.classList.add('active');
    showScreen('screen-dashboard');
  } else if (dest === 'interview') {
    document.getElementById('bnav-interview')?.classList.add('active');
    if (state.selectedPatient !== null) {
      showScreen('screen-stage2');
    } else {
      showToast('환자를 먼저 선택해주세요.');
    }
  } else if (dest === 'records') {
    document.getElementById('bnav-records')?.classList.add('active');
    if (state.selectedPatient !== null) {
      showScreen('screen-stage3');
    } else {
      showToast('환자를 먼저 선택해주세요.');
    }
  } else if (dest === 'settings') {
    document.getElementById('bnav-settings')?.classList.add('active');
    showToast('⚙️ 설정 기능은 준비 중입니다.');
  }
}

// ===========================
// LIVE DEMO
// ===========================
function selectModel(model) {
  state.selectedModel = model;
  document.getElementById('model-claude').classList.toggle('active', model === 'claude');
  document.getElementById('model-gpt').classList.toggle('active', model === 'gpt');

  const label = document.getElementById('api-label');
  const btn = document.getElementById('btn-start-live');
  const input = document.getElementById('api-key-input');

  if (model === 'claude') {
    label.textContent = 'Claude Sonnet 4.5 API Key';
    btn.textContent = 'Claude Sonnet 4.5로 시작하기';
    input.placeholder = 'sk-ant-api03-...';
  } else {
    label.textContent = 'OpenAI GPT-4o API Key';
    btn.textContent = 'OpenAI GPT-4o로 시작하기';
    input.placeholder = 'sk-proj-...';
  }
}

function startLiveDemo() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) {
    showToast('API 키를 입력해주세요.');
    return;
  }
  state.apiKey = key;
  document.getElementById('live-chat').classList.remove('hidden');
  document.getElementById('live-chat').classList.add('fade-in');

  addChatMessage('ai', `✅ ${state.selectedModel === 'claude' ? 'Claude Sonnet 4.5' : 'OpenAI GPT-4o'}에 연결되었습니다.\n방문 환자 정보를 입력하거나 의학적 질문을 자유롭게 해주세요.`);
  showToast('AI 모델 연결 완료!');
}

function addChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = `chat-msg chat-msg--${role}`;
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function handleChatKey(e) {
  if (e.key === 'Enter') sendChat();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  addChatMessage('user', text);
  input.value = '';

  // Simulate AI response (since we don't have actual API call in browser)
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'chat-msg chat-msg--ai loading-pulse';
  loadingMsg.textContent = '답변 생성 중...';
  document.getElementById('chat-messages').appendChild(loadingMsg);

  // Try actual API call if key present
  if (state.apiKey && state.selectedModel === 'claude') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': state.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: '당신은 방문진료 의사를 보조하는 AI 의료 어시스턴트입니다. 노인 환자의 방문진료와 관련된 의학적 질문에 한국어로 전문적이고 실용적인 답변을 제공합니다.',
          messages: [{ role: 'user', content: text }],
        }),
      });

      const data = await response.json();
      loadingMsg.remove();

      if (data.content && data.content[0]) {
        addChatMessage('ai', data.content[0].text);
      } else {
        addChatMessage('ai', '응답을 받지 못했습니다. API 키를 확인해주세요.');
      }
    } catch (err) {
      loadingMsg.remove();
      addChatMessage('ai', '⚠️ API 연결 오류: ' + (err.message || '알 수 없는 오류'));
    }
  } else {
    // Simulate response after 1.5s
    setTimeout(() => {
      loadingMsg.remove();
      const responses = [
        '해당 환자의 경우 eGFR이 38 mL/min으로 만성신장질환 3기에 해당합니다. 신기능 악화 시 글리메피리드는 저혈당 위험이 높아 용량 조정 또는 중단을 권고드립니다.',
        '다약제(8종) 복용 환자에서 Beers Criteria 검토는 매우 중요합니다. 특히 항콜린성 약물과 벤조디아제핀계는 노인 낙상 및 인지 저하와 연관성이 높습니다.',
        'K-MMSE 25점은 경증 인지장애 기준에 근접합니다. 이전 27점에서 2점 하락은 단기간 내 유의미한 변화로, 추적 관찰 및 신경과 의뢰를 고려할 수 있습니다.',
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      addChatMessage('ai', randomResponse);
    }, 1500);
  }
}

// ===========================
// TOAST
// ===========================
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ===========================
// INIT
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  showScreen('screen-dashboard');
  initSpeechRecognition();
});

// ===========================
// RECORDING & SPEECH-TO-TEXT
// ===========================
let recognition = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;
let isPaused = false;
let fullTranscript = '';
let interimTranscript = '';
let savedRecordings = [];

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        fullTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }
    updateTranscriptDisplay();
  };

  recognition.onerror = (e) => {
    if (e.error !== 'aborted') {
      console.warn('STT error:', e.error);
    }
  };

  recognition.onend = () => {
    // Auto-restart if still in recording state
    if (mediaRecorder && mediaRecorder.state === 'recording' && !isPaused) {
      try { recognition.start(); } catch (e) { }
    }
  };
}

function updateTranscriptDisplay() {
  const body = document.getElementById('transcript-body');
  if (!body) return;
  body.innerHTML = '';

  if (fullTranscript) {
    const finalSpan = document.createElement('span');
    finalSpan.className = 'transcript-final';
    finalSpan.textContent = fullTranscript;
    body.appendChild(finalSpan);
  }

  if (interimTranscript) {
    const interim = document.createElement('span');
    interim.className = 'transcript-interim';
    interim.textContent = interimTranscript;
    body.appendChild(interim);
  }

  if (!fullTranscript && !interimTranscript) {
    body.innerHTML = '<span class="transcript-placeholder">녹음을 시작하면 대화 내용이 여기에 실시간으로 변환됩니다.</span>';
  }
  body.scrollTop = body.scrollHeight;
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    fullTranscript = '';
    interimTranscript = '';
    isPaused = false;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      saveRecording(blob);
    };

    mediaRecorder.start(1000);

    // STT
    if (recognition) {
      try { recognition.start(); } catch (e) { }
    }

    // UI: recording state
    setRecordingUI('recording');
    startTimer();

    // Clear transcript
    updateTranscriptDisplay();

    showToast('🎙️ 녹음이 시작되었습니다.');
  } catch (err) {
    // Microphone not available — run in simulation mode
    fullTranscript = '';
    isPaused = false;
    setRecordingUI('recording');
    startTimer();
    simulateSTT();
    showToast('🎙️ 녹음 시작 (시뮬레이션 모드)');
  }
}

// Simulate STT for demo purposes (when microphone unavailable)
const samplePhrases = [
  '네, 혈압약은 매일 아침 복용하고 있어요.',
  '요즘 무릎이 많이 아프고 부어 있어요.',
  '지난 달에 한 번 미끄러졌는데 다행히 크게 다치지는 않았어요.',
  '당뇨 때문에 식이 조절을 하려고 하는데 잘 안 되네요.',
  '밤에 잠이 잘 안 와서 수면제를 복용하고 있어요.',
  '계단 오르내리는 것이 점점 어려워지고 있어요.',
  '약을 8가지나 먹다 보니 부작용이 있을 것 같아 걱정이에요.',
  '우울하고 외로운 날이 많아요. 가족들도 자주 못 봐서요.',
];
let sttSimInterval = null;
let sttPhraseIdx = 0;

function simulateSTT() {
  sttPhraseIdx = 0;
  sttSimInterval = setInterval(() => {
    if (sttPhraseIdx < samplePhrases.length) {
      fullTranscript += samplePhrases[sttPhraseIdx] + ' ';
      sttPhraseIdx++;
      updateTranscriptDisplay();
    } else {
      clearInterval(sttSimInterval);
    }
  }, 2000);
}

function stopRecording() {
  if (sttSimInterval) {
    clearInterval(sttSimInterval);
    sttSimInterval = null;
  }
  if (recognition) {
    try { recognition.stop(); } catch (e) { }
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    // Simulation mode — save dummy text recording
    saveRecordingText();
  }

  stopTimer();
  setRecordingUI('done');

  // Show analyze button if we have transcript
  if (fullTranscript.trim().length > 0) {
    document.getElementById('rec-analyze-section').classList.remove('hidden');
    document.getElementById('rec-analyze-section').classList.add('fade-in');
  }

  showToast('⏹ 녹음이 완료되었습니다.');
}

function saveRecording(blob) {
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const duration = formatTime(recordingSeconds);
  const id = Date.now();

  savedRecordings.push({ id, url, timestamp, duration, transcript: fullTranscript });
  renderSavedRecordings();
}

function saveRecordingText() {
  const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const duration = formatTime(recordingSeconds);
  const id = Date.now();

  savedRecordings.push({ id, url: null, timestamp, duration, transcript: fullTranscript });
  renderSavedRecordings();
}

function renderSavedRecordings() {
  const list = document.getElementById('saved-recs-list');
  if (!list) return;

  if (savedRecordings.length === 0) {
    list.innerHTML = '<span class="no-recs">저장된 녹음이 없습니다.</span>';
    return;
  }

  list.innerHTML = savedRecordings.map((rec, idx) => `
    <div class="rec-item">
      <div class="rec-item__info">
        <div class="rec-item__name">녹음 ${idx + 1} · ${rec.timestamp}</div>
        <div class="rec-item__meta">${rec.duration} · ${rec.transcript ? Math.ceil(rec.transcript.split(' ').length) + '단어' : '전사 없음'}</div>
      </div>
      ${rec.url ? `<button class="rec-item__play" onclick="playRecording(${idx})">▶</button>` : '<span style="font-size:0.7rem;color:var(--text-muted)">텍스트</span>'}
    </div>
  `).join('');
}

function playRecording(idx) {
  const rec = savedRecordings[idx];
  if (!rec.url) return;
  const audio = new Audio(rec.url);
  audio.play();
  showToast('▶ 재생 중...');
}

function togglePause() {
  const pauseBtn = document.getElementById('rec-pause-btn');

  if (!isPaused) {
    isPaused = true;
    if (recognition) try { recognition.stop(); } catch (e) { }
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause();
    clearInterval(recordingTimer);
    pauseBtn.textContent = '▶ 재개';
    document.getElementById('rec-indicator').className = 'rec-indicator paused';
    document.getElementById('rec-status-txt').textContent = '일시 정지';
    showToast('⏸ 녹음이 일시 정지되었습니다.');
  } else {
    isPaused = false;
    if (recognition) try { recognition.start(); } catch (e) { }
    if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume();
    startTimer();
    pauseBtn.textContent = '⏸ 일시정지';
    document.getElementById('rec-indicator').className = 'rec-indicator recording';
    document.getElementById('rec-status-txt').textContent = '🔴 녹음 중';
    showToast('🎙️ 녹음이 재개되었습니다.');
  }
}

function setRecordingUI(state) {
  const indicator = document.getElementById('rec-indicator');
  const statusTxt = document.getElementById('rec-status-txt');
  const startBtn = document.getElementById('rec-start-btn');
  const stopBtn = document.getElementById('rec-stop-btn');
  const pauseBtn = document.getElementById('rec-pause-btn');

  if (state === 'recording') {
    indicator.className = 'rec-indicator recording';
    statusTxt.textContent = '🔴 녹음 중';
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
  } else if (state === 'done') {
    indicator.className = 'rec-indicator done';
    statusTxt.textContent = '✅ 녹음 완료';
    startBtn.textContent = '🎙️ 새 녹음';
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    pauseBtn.classList.add('hidden');
  }
}

function startTimer() {
  recordingTimer = setInterval(() => {
    if (!isPaused) {
      recordingSeconds++;
      document.getElementById('rec-timer').textContent = formatTime(recordingSeconds);
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(recordingTimer);
  recordingTimer = null;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ===========================
// TRANSCRIPT ANALYSIS → AUTO-CHECK
// ===========================

// Keyword maps: text → { panel, qIdx, answer }
const keywordRules = [
  { keywords: ['고혈압', '혈압약'], panel: 1, qIdx: 0, answer: 'yes', label: '고혈압 진단 확인' },
  { keywords: ['당뇨', '혈당', '인슐린'], panel: 1, qIdx: 1, answer: 'yes', label: '당뇨병 진단 확인' },
  { keywords: ['신장', '신기능', 'eGFR', '신장질환'], panel: 1, qIdx: 2, answer: 'yes', label: '만성신장질환 확인' },
  { keywords: ['관절', '무릎', '관절염'], panel: 1, qIdx: 3, answer: 'yes', label: '골관절염 확인' },
  { keywords: ['미끄러', '낙상', '넘어'], panel: 2, qIdx: 0, answer: 'yes', label: '낙상 경험 확인' },
  { keywords: ['외출 꺼', '무서워', '공포'], panel: 2, qIdx: 1, answer: 'yes', label: '낙상 공포감 확인' },
  { keywords: ['지팡이', '보조기구', '보조기'], panel: 2, qIdx: 2, answer: 'yes', label: '보행 보조기구 사용' },
  { keywords: ['약을', '약이', '8가지', '여러 약'], panel: 3, qIdx: 0, answer: 'yes', label: '다약제 복용 확인 (5개 이상)' },
  { keywords: ['부작용', '약 부작용'], panel: 3, qIdx: 1, answer: 'yes', label: '약물 부작용 경험' },
  { keywords: ['식욕', '못 먹', '밥을 잘'], panel: 5, qIdx: 1, answer: 'yes', label: '식욕부진/식사량 감소' },
  { keywords: ['우울', '외로운', '슬프'], panel: 6, qIdx: 1, answer: 'yes', label: '우울감 보고' },
  { keywords: ['잠', '수면', '불면'], panel: 6, qIdx: 2, answer: 'yes', label: '수면 문제 보고' },
];

function analyzeTranscript() {
  const text = fullTranscript.toLowerCase();
  if (!text.trim()) {
    showToast('전사된 대화 내용이 없습니다.');
    return;
  }

  const btn = document.getElementById('btn-analyze-transcript');
  btn.textContent = '🤖 분석 중...';
  btn.classList.add('loading-pulse');
  btn.disabled = true;

  setTimeout(() => {
    btn.classList.remove('loading-pulse');
    btn.disabled = false;

    const matched = [];

    keywordRules.forEach(rule => {
      const hit = rule.keywords.some(kw => text.includes(kw.toLowerCase()));
      if (hit) {
        // Auto-check the corresponding button
        answerYN(rule.panel, rule.qIdx, rule.answer);
        matched.push(rule.label);
      }
    });

    // Auto-check the recording checklist items
    const rciItems = window._rciItems || [];
    const checklistKeywords = {
      '신기능': ['신장', '신기능', 'egfr', '크레아티닌'],
      '혈당': ['혈당', '당뇨', '인슐린', '혈당'],
      '약물': ['약', '부작용', '복용'],
      '낙상': ['낙상', '미끄러', '넘어'],
      '심부전': ['부종', '호흡', 'bnp'],
      '우울': ['우울', '외로운', '무기력'],
      '흡입제': ['흡입제', '기침', '호흡'],
      '인지': ['날짜', '기억', '계산'],
    };

    rciItems.forEach((item, i) => {
      const itemLower = item.toLowerCase();
      let hit = false;
      for (const [key, kws] of Object.entries(checklistKeywords)) {
        if (itemLower.includes(key) || kws.some(kw => text.includes(kw))) {
          hit = true; break;
        }
      }
      if (hit) {
        const cb = document.getElementById(`rci-cb-${i}`);
        const row = document.getElementById(`rci-${i}`);
        if (cb) { cb.classList.add('checked'); cb.textContent = '✓'; }
        if (row) row.classList.add('rci-done');
      }
    });

    // Show result
    const resultEl = document.getElementById('rec-analysis-result');
    const itemsEl = document.getElementById('analysis-checked-items');

    if (matched.length > 0) {
      itemsEl.innerHTML = matched.map(m => `<div class="analysis-checked-item">${m}</div>`).join('');
    } else {
      itemsEl.innerHTML = '<div class="analysis-checked-item" style="color:var(--text-muted)">자동 분류된 항목이 없습니다. 수동으로 확인해 주세요.</div>';
    }

    resultEl.classList.remove('hidden');
    resultEl.classList.add('fade-in');

    showToast(`✅ 대화 분석 완료 — ${matched.length}개 항목 자동 체크`);
  }, 1800);
}

// ===========================
// PHOTO UPLOAD & SKIN ANALYSIS
// ===========================
let currentPhotoCategory = 'wound';
let uploadedPhotos = [];

function selectPhotoCategory(cat) {
  currentPhotoCategory = cat;
  document.querySelectorAll('.photo-cat-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`pcat-${cat}`)?.classList.add('active');
}

const catLabels = { wound: '🩹 환부', skin: '🔬 피부', env: '🏠 거주환경', other: '📌 기타' };

function handlePhotoUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const photoData = {
        id: Date.now() + Math.random(),
        src: e.target.result,
        category: currentPhotoCategory,
        catLabel: catLabels[currentPhotoCategory] || '기타',
        file,
      };
      uploadedPhotos.push(photoData);
      renderPhotoPreviews();

      // Auto-trigger analysis for skin/wound photos
      if (currentPhotoCategory === 'skin' || currentPhotoCategory === 'wound') {
        setTimeout(() => analyzeSkinPhoto(photoData), 800);
      }
    };
    reader.readAsDataURL(file);
  });

  // Reset file input so same file can be re-selected
  event.target.value = '';
}

function renderPhotoPreviews() {
  const container = document.getElementById('photo-previews');
  if (!container) return;

  if (uploadedPhotos.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = uploadedPhotos.map((p, i) => `
    <div class="photo-preview-item fade-in">
      <img src="${p.src}" alt="사진 ${i + 1}" />
      <div class="photo-preview-overlay">
        <span class="photo-preview-cat">${p.catLabel}</span>
      </div>
      <button class="photo-preview-del" onclick="deletePhoto(${i})">✕</button>
    </div>
  `).join('');
}

function deletePhoto(idx) {
  uploadedPhotos.splice(idx, 1);
  renderPhotoPreviews();
  if (uploadedPhotos.length === 0) {
    document.getElementById('skin-analysis-result').classList.add('hidden');
  }
}

// Simulated AI skin condition database
const skinConditions = [
  {
    name: '건성 피부염 (Xerosis)',
    severity: 'mild',
    severityLabel: '경증',
    findings: [
      { dot: 'warn', text: '피부 건조 및 인설(각질) 소견 관찰됨' },
      { dot: 'warn', text: '정강이 및 발목 부위 균열 소견' },
      { dot: 'ok', text: '감염 소견 없음' },
    ],
    recommendation: '보습제 1일 2회 이상 도포 권고. 라놀린 또는 바세린 계열 보습제 적합.',
    confidence: 82,
  },
  {
    name: '욕창 1단계 (Pressure Ulcer Stage 1)',
    severity: 'moderate',
    severityLabel: '중등도',
    findings: [
      { dot: 'danger', text: '천골 부위 압박에 의한 발적 소견 (2×3cm)' },
      { dot: 'warn', text: '피부 손상 없으나 발적이 압력 제거 후에도 지속' },
      { dot: 'warn', text: '욕창 2단계로 진행 위험 있음' },
    ],
    recommendation: '체위 변경 2시간 마다 시행. 압력 감소용 에어매트리스 사용 권고. 피부 보호 드레싱 적용.',
    confidence: 78,
  },
  {
    name: '접촉성 피부염 (Contact Dermatitis)',
    severity: 'mild',
    severityLabel: '경증',
    findings: [
      { dot: 'warn', text: '전박 내측면 경계부 홍반 및 구진 소견' },
      { dot: 'ok', text: '수포 형성 없음, 2차 감염 소견 없음' },
      { dot: 'warn', text: '알레르기성 또는 자극성 접촉성 피부염 의심' },
    ],
    recommendation: '원인 물질(기저귀, 세제, 테이프) 파악 및 제거. 스테로이드 연고 단기 도포 고려.',
    confidence: 75,
  },
  {
    name: '정상 피부 소견',
    severity: 'normal',
    severityLabel: '정상',
    findings: [
      { dot: 'ok', text: '육안 소견상 특이 피부 병변 없음' },
      { dot: 'ok', text: '연령에 적합한 피부 상태 관찰됨' },
      { dot: 'ok', text: '감염, 궤양, 욕창 소견 없음' },
    ],
    recommendation: '정기 피부 관리 유지. 보습 습관 지속 권고.',
    confidence: 91,
  },
];

// ===========================
// PRESCRIPTION PHOTO UPLOAD (다약제 탭)
// ===========================
let rxPhotos = [];

function handleRxUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      rxPhotos.push({ src: e.target.result });
      renderRxPreviews();
      showToast('📸 처방전 사진이 등록되었습니다.');
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function renderRxPreviews() {
  const grid = document.getElementById('rx-preview-grid');
  if (!grid) return;

  grid.innerHTML = rxPhotos.map((p, i) => `
    <div class="rx-preview-item fade-in">
      <img src="${p.src}" alt="처방전 ${i + 1}" />
      <button class="rx-preview-del" onclick="deleteRxPhoto(${i})">✕</button>
    </div>
  `).join('');
}

function deleteRxPhoto(idx) {
  rxPhotos.splice(idx, 1);
  renderRxPreviews();
}

function analyzeSkinPhoto(photo) {

  const resultEl = document.getElementById('skin-analysis-result');
  const badge = document.getElementById('skin-severity-badge');
  const body = document.getElementById('skin-analysis-body');

  // Show loading
  resultEl.classList.remove('hidden');
  badge.className = 'skin-analysis-badge';
  badge.textContent = '분석 중...';
  body.innerHTML = '<div class="loading-pulse" style="font-size:0.8rem;color:var(--text-muted);">AI가 이미지를 분석하고 있습니다...</div>';

  setTimeout(() => {
    // Pick a condition based on category
    let condition;
    if (photo.category === 'wound') {
      condition = skinConditions[Math.random() < 0.5 ? 1 : 0];
    } else if (photo.category === 'skin') {
      const idx = Math.floor(Math.random() * skinConditions.length);
      condition = skinConditions[idx];
    } else {
      condition = skinConditions[3]; // normal for env photos
    }

    badge.className = `skin-analysis-badge ${condition.severity}`;
    badge.textContent = condition.severityLabel;

    body.innerHTML = `
      <strong style="font-size:0.8rem;color:var(--text-primary);">${condition.name}</strong>
      <div style="margin:0.5rem 0;">
        ${condition.findings.map(f => `
          <div class="skin-finding">
            <div class="skin-finding-dot ${f.dot}"></div>
            <span>${f.text}</span>
          </div>
        `).join('')}
      </div>
      <div style="background:#f3e8ff;border-radius:6px;padding:0.5rem;margin-top:0.4rem;">
        <span style="font-size:0.7rem;font-weight:700;color:#5b21b6;">💡 권고 사항</span><br/>
        <span style="font-size:0.72rem;color:var(--text-secondary);">${condition.recommendation}</span>
      </div>
      <div class="skin-confidence">⚠️ AI 분석 신뢰도 ${condition.confidence}% — 반드시 임상 판단과 함께 사용하세요.</div>
    `;

    resultEl.classList.add('fade-in');
    showToast(`🔬 피부 분석 완료: ${condition.name}`);
  }, 2200);
}

