import { GUIDANCE_EVENTS, GUIDANCE_CONDITIONS, defaultGuidanceConfig } from './voice-guidance-rules.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clone = value => structuredClone(value);
const days = ['일', '월', '화', '수', '목', '금', '토'];
const frequencyLabels = { day: '하루에 한 번', entry: '메뉴를 열 때마다 (간격·상한 적용)', value: '확인할 값이 달라질 때' };
const options = (items, selected) => items.map(({ value, label }) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
const timeMinutes = value => /^\d{2}:\d{2}$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Clinician editor; a pending write retains its exact body and UUID until resolved. */
export function createVoiceGuidanceWorkspace({ api, getState, toast, selectPatient }) {
  const root = document.querySelector('#app-content'), $ = selector => root.querySelector(selector);
  let active = false, mounted = '', scope = 'global', generation = 0, loading = false, saving = false;
  let snapshot = null, draft = null, baseline = '', pendingWrite = null, conflict = false, errorText = '', statusText = '';
  let requestAbort = null, previewGeneration = 0, previewStartTimer = null, previewEndTimer = null, previewActive = false;
  const selectedPatient = () => getState().data?.patients?.find(patient => patient.id === getState().selectedId);
  const contextKey = () => `${scope}|${getState().selectedId || ''}`;
  const endpoint = () => '/api/clinician/voice-guidance' + (scope === 'patient' ? '?' + new URLSearchParams({ patientId: getState().selectedId }) : '');
  const dirty = () => Boolean(active && (pendingWrite || draft && JSON.stringify(draft) !== baseline));
  const writable = () => Boolean(snapshot?.canWrite);
  const setStatus = message => { statusText = message; if ($('#guidance-status')) $('#guidance-status').textContent = message; };
  function setError(message) {
    errorText = message?.message || String(message || '');
    if ($('#guidance-error')) { $('#guidance-error').textContent = errorText; $('#guidance-error').hidden = !errorText; }
  }
  function canLeave() {
    if (!active) return true;
    if (saving || loading) { toast('조회 또는 저장이 끝난 뒤 이동해 주세요.', true); return false; }
    if (dirty() && !confirm(pendingWrite ? '저장 결과를 아직 확인하지 못했습니다. 서버에는 반영됐을 수 있습니다. 이 화면을 나갈까요?' : '음성 안내 변경 내용을 저장하지 않고 이동할까요?')) return false;
    stopPreview();
    return true;
  }
  async function request(path, settings = {}) {
    const controller = new AbortController(); requestAbort = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try { return await api(path, { ...settings, signal: controller.signal }); }
    catch (error) { if (error.name === 'AbortError') { const timeout = new Error('20초 안에 응답을 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'); timeout.uncertain = true; throw timeout; } throw error; }
    finally { clearTimeout(timer); if (requestAbort === controller) requestAbort = null; }
  }
  function updateControls() {
    if (!active) return;
    const busy = loading || saving, locked = busy || Boolean(pendingWrite) || !writable();
    for (const element of root.querySelectorAll('[data-guidance-edit]')) element.disabled = locked;
    for (const element of root.querySelectorAll('[data-guidance-navigation]')) element.disabled = busy;
    if ($('#guidance-save')) { $('#guidance-save').disabled = busy || !writable() || conflict || !draft; $('#guidance-save').textContent = saving ? '저장 중…' : pendingWrite ? '저장 결과 다시 확인' : '설정 저장'; }
    if ($('#guidance-cancel')) $('#guidance-cancel').disabled = busy || Boolean(pendingWrite) || !draft || !dirty();
    if ($('#guidance-inherit')) $('#guidance-inherit').disabled = locked || !snapshot || snapshot.inherited;
    if ($('#guidance-add')) $('#guidance-add').disabled = locked || (draft?.rules.length || 0) >= 40;
    if ($('#guidance-refresh')) $('#guidance-refresh').disabled = busy;
    for (const element of root.querySelectorAll('[data-guidance="preview"]')) element.disabled = busy;
    if ($('#guidance-preview-stop')) { $('#guidance-preview-stop').disabled = !previewActive; $('#guidance-preview-stop').hidden = !previewActive; }
    if ($('#guidance-changes')) $('#guidance-changes').textContent = pendingWrite ? '저장 결과 확인이 필요합니다. 같은 내용으로 다시 확인해 주세요.' : dirty() ? '아직 저장하지 않은 변경이 있습니다.' : '현재 서버 설정과 같습니다.';
  }
  function field(rule, key, label, attributes = '') {
    return `<label for="guidance-${esc(rule.id)}-${key}">${label}<input id="guidance-${esc(rule.id)}-${key}" data-rule-field="${key}" data-guidance-edit ${attributes} value="${esc(rule[key] ?? '')}"></label>`;
  }
  function selector(rule, key, label, items) {
    return `<label for="guidance-${esc(rule.id)}-${key}">${label}<select id="guidance-${esc(rule.id)}-${key}" data-rule-field="${key}" data-guidance-edit>${options(items, rule[key])}</select></label>`;
  }
  function ruleMarkup(rule, open = false) {
    const numeric = rule.trigger === 'value_check';
    const frequencies = rule.trigger === 'period_entry' ? ['day'] : numeric ? ['value'] : ['day', 'entry'];
    const triggerName = GUIDANCE_EVENTS.find(item => item.value === rule.trigger)?.label || rule.trigger;
    return `<details class="guidance-rule" data-rule-id="${esc(rule.id)}" ${open ? 'open' : ''}><summary><strong data-rule-summary-label>${esc(rule.label)}</strong><span data-rule-summary-state>${rule.enabled ? '사용' : '사용 안 함'} · ${esc(triggerName)} · ${esc(rule.startTime)}–${esc(rule.endTime)}</span><span data-rule-summary-text>${esc(rule.text)}</span></summary>
      <div class="guidance-rule-body"><p class="muted-note">규칙 ID: ${esc(rule.id)} · 문구를 수정해도 오늘 재생한 횟수는 유지됩니다.</p>
      <div class="workspace-form-grid"><label class="check-label"><input type="checkbox" data-rule-field="enabled" data-guidance-edit ${rule.enabled ? 'checked' : ''}> 이 안내 사용</label>
      ${field(rule, 'label', '안내 이름', 'required maxlength="60"')}
      ${selector(rule, 'trigger', '안내할 동작', GUIDANCE_EVENTS)}
      ${selector(rule, 'condition', '기록 조건', GUIDANCE_CONDITIONS)}
      <label class="full-width" for="guidance-${esc(rule.id)}-text">짧은 안내 문구 (최대 180자)<textarea id="guidance-${esc(rule.id)}-text" data-rule-field="text" data-guidance-edit required maxlength="180" rows="2">${esc(rule.text)}</textarea><span class="muted-note">수치 확인 문구에는 {value}(입력값), {unit}(단위)를 넣을 수 있습니다. 한두 문장으로 작성해 주세요.</span></label>
      ${field(rule, 'startTime', '시작 시각 · 한국 시간', 'type="time" required')}
      ${field(rule, 'endTime', '종료 시각 · 한국 시간 (24:00 가능)', 'type="text" required inputmode="numeric" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00" placeholder="24:00"')}
      <fieldset class="full-width guidance-days"><legend>안내할 요일</legend>${days.map((day, index) => `<label class="check-label"><input type="checkbox" data-rule-day="${index}" data-guidance-edit ${rule.daysOfWeek.includes(index) ? 'checked' : ''}>${day}</label>`).join('')}</fieldset>
      ${field(rule, 'activeFrom', '적용 시작일 (비우면 제한 없음)', 'type="date"')}
      ${field(rule, 'activeUntil', '적용 종료일 (비우면 제한 없음)', 'type="date"')}
      ${selector(rule, 'frequency', '반복 기준', frequencies.map(value => ({ value, label: frequencyLabels[value] })))}
      ${field(rule, 'priority', '같은 동작의 안내 우선순위 (0–100)', 'type="number" min="0" max="100" step="1" required')}
      ${numeric ? `${selector(rule, 'metric', '확인할 항목', [{ value: 'steps', label: '걸음 수 · 걸음' }, { value: 'sleepHours', label: '수면 · 시간' }])}
      <p class="muted-note">아래 기준은 입력값을 다시 묻는 조건이며 의학적인 정상 범위가 아닙니다. 실제 수치가 맞으면 환자가 확인 후 저장할 수 있습니다.</p>
      ${field(rule, 'minValue', '이 값보다 작으면 확인 (비워도 됨)', `type="number" min="0" max="${rule.metric === 'steps' ? 100000 : 24}" step="${rule.metric === 'steps' ? 1 : '0.1'}"`)}
      ${field(rule, 'maxValue', '이 값보다 크면 확인 (비워도 됨)', `type="number" min="0" max="${rule.metric === 'steps' ? 100000 : 24}" step="${rule.metric === 'steps' ? 1 : '0.1'}"`)}
      <p class="muted-note full-width">값 확인은 다른 수치에 대한 안내를 간격이나 하루 상한으로 생략하지 않습니다.</p>` : `${field(rule, 'cooldownMinutes', '안내 사이 최소 간격 (분)', 'type="number" min="0" max="1440" step="1" required')}
      ${field(rule, 'maxPerDay', '하루 최대 안내 횟수', 'type="number" min="1" max="10" step="1" required')}<p class="muted-note full-width">‘하루에 한 번’은 상한을 높여도 하루 한 번만 안내합니다. 시각 범위는 시작 포함·종료 제외입니다.</p>`}
      </div><div class="workspace-action-row"><button type="button" class="button button-secondary" data-guidance="preview">이 문구 미리듣기</button><button type="button" class="button button-secondary" data-guidance="delete" data-guidance-edit>안내 삭제</button></div></div></details>`;
  }
  function renderRules(openId = null) {
    const target = $('#guidance-rules'); if (!target || !draft) return;
    target.innerHTML = draft.rules.length ? draft.rules.map(rule => ruleMarkup(rule, rule.id === openId)).join('') : '<p class="compact-empty">등록된 안내가 없습니다. 새 안내를 추가하거나 기본 예시를 불러오세요.</p>';
    if ($('#guidance-rule-count')) $('#guidance-rule-count').textContent = `${draft.rules.length} / 40개`;
    updateControls();
  }
  function render() {
    const state = getState(), patient = selectedPatient();
    root.innerHTML = `<div class="guidance-workspace" data-screen-id="C-VOICE-GUIDANCE"><section class="workspace-context"><div class="workspace-form-grid"><label for="guidance-scope">설정 대상<select id="guidance-scope" data-guidance-navigation><option value="global" ${scope === 'global' ? 'selected' : ''}>공통 기본 · 모든 환자의 기본 안내</option><option value="patient" ${scope === 'patient' ? 'selected' : ''} ${state.selectedId ? '' : 'disabled'}>선택 환자만</option></select></label>
      <label for="guidance-patient">선택 환자<select id="guidance-patient" data-guidance-navigation>${(state.data?.patients || []).map(item => `<option value="${esc(item.id)}" ${item.id === state.selectedId ? 'selected' : ''}>${esc(item.name)} · ${esc(item.id)}</option>`).join('')}</select></label></div>
      <p id="guidance-scope-description">${scope === 'global' ? '개별 설정이 없는 환자는 이 공통 설정을 따릅니다.' : `${esc(patient?.name || '선택 환자')} (${esc(state.selectedId)})에게만 적용합니다. ${snapshot?.inherited ? '현재 공통 설정을 따르는 중입니다.' : snapshot ? '환자별 설정을 사용하고 있습니다.' : ''}`}</p>
      <p>환자는 이용 안내에서 음성 안내를 켜거나 끌 수 있습니다. 화면이 닫혀 있거나 기기에서 자동 재생을 막으면 소리가 나지 않을 수 있으며, 같은 내용을 글로 표시합니다.</p></section>
      <div id="guidance-error" class="error-banner" role="alert" ${errorText ? '' : 'hidden'}>${esc(errorText)}</div><p id="guidance-status" class="workspace-status" role="status" aria-live="polite">${esc(statusText)}</p>
      <div class="workspace-action-row"><button type="button" id="guidance-refresh" class="button button-secondary" data-guidance="reload">서버 설정 다시 불러오기</button><button type="button" id="guidance-preview-stop" class="button button-secondary" data-guidance="stop-preview" hidden>미리듣기 멈춤</button></div>
      ${loading && !draft ? '<section class="card communication-panel"><p>음성 안내 설정을 불러오고 있습니다.</p></section>' : draft ? `<form id="guidance-form" novalidate><section class="card communication-panel"><h2>안내 사용과 속도</h2>${!writable() ? '<p class="workspace-context">조회 권한으로 보고 있습니다. 설정 변경은 담당 의료진에게 요청해 주세요.</p>' : ''}
      <div class="workspace-form-grid"><label class="check-label"><input id="guidance-enabled" type="checkbox" data-guidance-edit ${draft.enabled ? 'checked' : ''}> 이 설정의 자동 음성 안내 사용</label>
      <label for="guidance-rate">말하기 속도<select id="guidance-rate" data-guidance-edit>${options([{ value: 0.85, label: '조금 천천히 (0.85)' }, { value: 1, label: '보통 (1.0)' }, { value: 1.15, label: '조금 빠르게 (1.15)' }], draft.rate)}</select></label></div>
      <p class="muted-note">한국어 목소리와 실제 속도·음질은 환자의 기기와 브라우저에 따라 다릅니다. 미리듣기는 현재 의료진 기기의 예시이며 환자 재생 기록에 남기지 않습니다.</p></section>
      <section class="card communication-panel"><div class="card-header"><h2>자동 안내 규칙 <span id="guidance-rule-count">${draft.rules.length} / 40개</span></h2><div class="workspace-action-row"><button type="button" id="guidance-add" class="button button-secondary" data-guidance="add" data-guidance-edit>안내 추가</button><button type="button" class="button button-secondary" data-guidance="defaults" data-guidance-edit>기본 예시 불러오기</button></div></div><p>안내를 펼치면 문구와 상세 조건을 수정할 수 있습니다. 같은 동작에 여러 규칙이 맞으면 우선순위가 가장 높은 한 개를 안내합니다.</p><div id="guidance-rules"></div></section>
      <section class="card communication-panel guidance-save-panel"><p id="guidance-changes" role="status"></p><div class="workspace-action-row"><button type="submit" id="guidance-save" class="button button-primary">설정 저장</button><button type="button" id="guidance-cancel" class="button button-secondary" data-guidance="cancel">변경 취소</button>${scope === 'patient' ? '<button type="button" id="guidance-inherit" class="button button-secondary" data-guidance="inherit" data-guidance-edit>공통 설정 따르기</button>' : ''}</div><p class="muted-note">저장한 설정은 환자 화면에서 다음 조회 때 반영됩니다. 지금 수정한 문구를 모든 환자에게 즉시 재생하는 기능은 아닙니다.</p></section></form>` : '<section class="card communication-panel"><p>설정을 확인하지 못했습니다. 서버 설정 다시 불러오기로 재시도해 주세요.</p></section>'}</div>`;
    renderRules(); updateControls();
  }
  async function load({ discard = false } = {}) {
    if (!active || saving || loading) return;
    if (dirty() && !discard) { setStatus('편집 중인 설정은 유지했습니다. 새 서버 설정을 보려면 ‘서버 설정 다시 불러오기’를 선택하세요.'); return; }
    const ticket = ++generation; loading = true; stopPreview(); setError(''); setStatus('음성 안내 설정을 불러오고 있습니다.');
    if (discard) { draft = null; snapshot = null; baseline = ''; pendingWrite = null; conflict = false; }
    render();
    try {
      const result = await request(endpoint()); if (!active || ticket !== generation) return;
      snapshot = result; draft = clone(result.configuration); baseline = JSON.stringify(draft); pendingWrite = null; conflict = false;
      setStatus(`서버 설정을 불러왔습니다. 수정번호 ${result.revision}${result.inherited ? ' · 공통 설정 상속' : ''}.`);
    } catch (error) { if (active && ticket === generation) { setError(error); setStatus('조회하지 못했습니다. 저장한 것으로 표시하지 않습니다.'); } }
    finally { if (active && ticket === generation) { loading = false; render(); } }
  }
  function validDraft() {
    for (const rule of draft.rules) {
      if (!rule.label.trim() || !rule.text.trim()) throw new Error('안내 이름과 문구를 입력해 주세요.');
      if (!rule.daysOfWeek.length) throw new Error(`${rule.label}: 안내할 요일을 하나 이상 선택해 주세요.`);
      if (!Number.isFinite(timeMinutes(rule.startTime)) || !Number.isFinite(timeMinutes(rule.endTime)) || timeMinutes(rule.startTime) >= timeMinutes(rule.endTime)) throw new Error(`${rule.label}: 시작 시각보다 늦은 종료 시각을 입력해 주세요. 자정을 넘는 안내는 규칙 두 개로 나누세요.`);
      if (!validDate(rule.activeFrom) || !validDate(rule.activeUntil) || rule.activeFrom && rule.activeUntil && rule.activeFrom > rule.activeUntil) throw new Error(`${rule.label}: 적용 시작일과 종료일을 확인해 주세요.`);
      if (/{(?!value\}|unit\})[^}]*}|[<>]/.test(rule.text)) throw new Error(`${rule.label}: 문구에는 일반 글자와 {value}, {unit}만 사용해 주세요.`);
      if (rule.trigger === 'value_check' && (rule.minValue === null && rule.maxValue === null || rule.minValue !== null && rule.maxValue !== null && rule.minValue >= rule.maxValue)) throw new Error(`${rule.label}: 확인 기준을 하나 이상 입력하고 작은 값부터 정해 주세요.`);
    }
    const form = $('#guidance-form'), invalid = [...form.querySelectorAll('input,select,textarea')].find(element => !element.disabled && !element.checkValidity());
    if (invalid) { const detail = invalid.closest('details'); if (detail) detail.open = true; invalid.focus(); invalid.reportValidity(); return false; }
    return true;
  }
  async function save(inherit = false) {
    if (!active || loading || saving || !writable() || conflict || !draft) return;
    if (!pendingWrite) {
      try { if (!inherit && !validDraft()) return; } catch (error) { setError(error); return; }
      if (inherit && !confirm('이 환자의 개별 설정을 해제하고 공통 설정을 따르도록 저장할까요?')) return;
      pendingWrite = { path: endpoint(), body: { revision: snapshot.revision, clientRequestId: crypto.randomUUID(), ...(inherit ? { inherit: true } : { configuration: clone(draft) }) } };
    }
    const ticket = generation; saving = true; stopPreview(); setError(''); setStatus('설정을 저장하고 있습니다.'); updateControls();
    try {
      const result = await request(pendingWrite.path, { method: 'PUT', body: JSON.stringify(pendingWrite.body) });
      if (!active || ticket !== generation) return;
      snapshot = result; draft = clone(result.configuration); baseline = JSON.stringify(draft); pendingWrite = null; conflict = false;
      setStatus(`설정을 저장했습니다. 수정번호 ${result.revision}${result.inherited ? ' · 공통 설정을 따릅니다' : ''}.`); toast('음성 안내 설정을 저장했습니다.');
    } catch (error) {
      if (!active || ticket !== generation) return;
      if (error.status === 409) { conflict = true; pendingWrite = null; setError(`${error.message} 입력 내용은 유지했습니다. 내용을 확인한 뒤 ‘서버 설정 다시 불러오기’로 최신 설정을 불러오세요.`); }
      else if (error.status && error.status < 500) { pendingWrite = null; setError(error); }
      else setError(`${error.message} 저장 여부가 확실하지 않습니다. ‘저장 결과 다시 확인’은 같은 요청을 재전송하므로 중복 저장하지 않습니다.`);
      setStatus('입력한 설정은 유지했습니다.');
    } finally { if (active && ticket === generation) { saving = false; if (!errorText) render(); else updateControls(); } }
  }
  function stopPreview(message = '') {
    previewGeneration++; clearTimeout(previewStartTimer); clearTimeout(previewEndTimer); previewStartTimer = null; previewEndTimer = null;
    if (previewActive) { try { speechSynthesis.cancel(); } catch {} }
    previewActive = false; if (message) setStatus(message); updateControls();
  }
  function preview(rule) {
    stopPreview();
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { setStatus('이 브라우저는 음성 미리듣기를 지원하지 않습니다. 화면의 문구를 확인해 주세요.'); return; }
    let voices; try { voices = speechSynthesis.getVoices().filter(voice => /^ko(?:-|_)/i.test(voice.lang) || voice.lang === 'ko'); } catch { voices = []; }
    if (!voices.length) { setStatus('한국어 목소리를 찾지 못했습니다. 기기의 한국어 음성을 확인한 뒤 다시 눌러 주세요. 문구는 그대로 저장할 수 있습니다.'); return; }
    if (!rule.text.trim()) { setStatus('미리 들을 문구를 입력해 주세요.'); return; }
    const example = rule.metric === 'sleepHours' ? ['0.2', '시간'] : ['10', '걸음'];
    const text = rule.text.replaceAll('{value}', example[0]).replaceAll('{unit}', example[1]);
    const utterance = new SpeechSynthesisUtterance(text), ticket = ++previewGeneration;
    utterance.lang = 'ko-KR'; utterance.voice = voices.find(voice => voice.default) || voices.find(voice => voice.localService) || voices[0]; utterance.rate = Number(draft.rate) || 1;
    const finish = message => { if (ticket !== previewGeneration) return; stopPreview(message); };
    utterance.onstart = () => { if (ticket !== previewGeneration) return; clearTimeout(previewStartTimer); setStatus(`미리듣는 중${rule.trigger === 'value_check' ? ' · 수치는 예시입니다' : ''}: ${text}`); previewEndTimer = setTimeout(() => finish('미리듣기를 중지했습니다. 소리가 끝나지 않으면 기기의 소리 설정을 확인해 주세요.'), 30000); };
    utterance.onend = () => finish('미리듣기를 마쳤습니다. 환자에게 재생한 기록은 남기지 않았습니다.');
    utterance.onerror = () => finish('소리를 재생하지 못했습니다. 문구를 확인하거나 다시 시도해 주세요.');
    previewActive = true; updateControls(); setStatus('한국어 음성을 준비하고 있습니다.');
    previewStartTimer = setTimeout(() => finish('음성이 시작되지 않아 중지했습니다. 기기의 음성 설정을 확인하고 다시 시도해 주세요.'), 3000);
    try { speechSynthesis.cancel(); speechSynthesis.speak(utterance); } catch { finish('소리를 재생하지 못했습니다. 화면의 문구를 확인해 주세요.'); }
  }
  function updateRuleSummary(card, rule) {
    card.querySelector('[data-rule-summary-label]').textContent = rule.label;
    card.querySelector('[data-rule-summary-text]').textContent = rule.text;
    card.querySelector('[data-rule-summary-state]').textContent = `${rule.enabled ? '사용' : '사용 안 함'} · ${GUIDANCE_EVENTS.find(item => item.value === rule.trigger)?.label || rule.trigger} · ${rule.startTime}–${rule.endTime}`;
  }
  function edit(event) {
    if (!active || loading || saving || pendingWrite || !writable() || !draft) return;
    const target = event.target;
    if (target.id === 'guidance-enabled') draft.enabled = target.checked;
    else if (target.id === 'guidance-rate') draft.rate = Number(target.value);
    else {
      const card = target.closest('[data-rule-id]'), rule = draft.rules.find(item => item.id === card?.dataset.ruleId); if (!rule) return;
      if (target.hasAttribute('data-rule-day')) rule.daysOfWeek = [...card.querySelectorAll('[data-rule-day]:checked')].map(element => Number(element.dataset.ruleDay));
      else if (target.dataset.ruleField) {
        const key = target.dataset.ruleField;
        if (key === 'enabled') rule.enabled = target.checked;
        else if (['minValue', 'maxValue'].includes(key)) rule[key] = target.value === '' ? null : Number(target.value);
        else if (['cooldownMinutes', 'maxPerDay', 'priority'].includes(key)) rule[key] = target.value === '' ? null : Number(target.value);
        else if (['activeFrom', 'activeUntil'].includes(key)) rule[key] = target.value || null;
        else rule[key] = target.value;
        if (key === 'trigger') {
          const numeric = rule.trigger === 'value_check'; rule.frequency = numeric ? 'value' : 'day'; rule.metric = numeric ? 'steps' : null; rule.minValue = numeric ? 100 : null; rule.maxValue = numeric ? 50000 : null; rule.cooldownMinutes = 0; rule.maxPerDay = 1;
          card.outerHTML = ruleMarkup(rule, true); $(`[data-rule-id="${rule.id}"] [data-rule-field="trigger"]`)?.focus();
        } else if (key === 'metric') { rule.minValue = rule.metric === 'steps' ? 100 : 2; rule.maxValue = rule.metric === 'steps' ? 50000 : 14; card.outerHTML = ruleMarkup(rule, true); $(`[data-rule-id="${rule.id}"] [data-rule-field="metric"]`)?.focus(); }
      }
      if (card.isConnected) updateRuleSummary(card, rule);
    }
    setError(''); updateControls();
  }
  root.addEventListener('input', edit);
  root.addEventListener('change', event => {
    if (!active) return;
    if (event.target.id === 'guidance-scope') {
      const next = event.target.value; event.target.value = scope;
      if (next !== scope && canLeave()) { scope = next; mounted = contextKey(); load({ discard: true }); }
    } else if (event.target.id === 'guidance-patient') { const id = event.target.value; event.target.value = getState().selectedId; selectPatient(id); }
    else if (event.target.matches('[data-rule-field="trigger"],[data-rule-field="metric"]')) { /* input already handles native selects */ }
    else edit(event);
  });
  root.addEventListener('submit', event => { if (active && event.target.id === 'guidance-form') { event.preventDefault(); save(); } });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-guidance]'); if (!active || !button) return;
    const action = button.dataset.guidance;
    if (action === 'stop-preview') { stopPreview('미리듣기를 멈췄습니다.'); return; }
    if (loading || saving) return;
    if (action === 'reload') { if (dirty() && !confirm(pendingWrite ? '저장 결과가 확실하지 않습니다. 현재 입력을 버리고 서버에 반영된 설정을 다시 확인할까요?' : '현재 변경 내용을 버리고 서버 설정을 다시 불러올까요?')) return; load({ discard: true }); return; }
    const card = button.closest('[data-rule-id]'), rule = draft?.rules.find(item => item.id === card?.dataset.ruleId);
    if (action === 'preview' && rule) { preview(rule); return; }
    if (!writable() || pendingWrite || !draft) return;
    if (action === 'cancel') { if (dirty() && !confirm('저장하지 않은 변경을 취소할까요?')) return; draft = clone(snapshot.configuration); conflict = false; setError(''); stopPreview(); render(); setStatus('변경을 취소했습니다. 서버 자료는 바뀌지 않았습니다.'); }
    if (action === 'inherit') save(true);
    if (action === 'defaults') { if (!confirm('현재 편집 내용을 짧은 한국어 기본 예시로 바꿀까요? 설정 저장을 눌러야 반영됩니다.')) return; draft = defaultGuidanceConfig(); setError(''); stopPreview(); render(); setStatus('기본 예시를 불러왔습니다. 확인한 뒤 설정 저장을 눌러 주세요.'); }
    if (action === 'add' && draft.rules.length < 40) { const rule = { ...clone(defaultGuidanceConfig().rules.find(item => item.trigger === 'meal_open')), id: 'custom-' + crypto.randomUUID(), label: '새 안내', enabled: false }; draft.rules.push(rule); renderRules(rule.id); $(`[data-rule-id="${rule.id}"] [data-rule-field="label"]`)?.focus(); }
    if (action === 'delete' && rule) { if (!confirm(`‘${rule.label}’ 안내를 삭제할까요? 설정 저장을 눌러야 반영됩니다.`)) return; draft.rules = draft.rules.filter(item => item !== rule); stopPreview(); renderRules(); $('#guidance-add')?.focus(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); });
  window.addEventListener('pagehide', () => stopPreview());
  window.addEventListener('homecare-session-expired', () => stopPreview('세션을 확인한 뒤 미리듣기를 다시 이용해 주세요.'));
  return {
    mount() {
      const key = contextKey(); if (active && mounted === key && $('.guidance-workspace')) return;
      active = true; mounted = key; generation++; loading = false; saving = false; draft = null; snapshot = null; baseline = ''; pendingWrite = null; conflict = false; errorText = ''; statusText = ''; load();
    },
    deactivate() { if (!active) return; stopPreview(); active = false; mounted = ''; generation++; requestAbort?.abort(); requestAbort = null; loading = false; saving = false; },
    canLeave, dirty, busy: () => loading || saving,
    refresh() { if (active && !loading && !saving && !document.hidden) load(); },
  };
}
