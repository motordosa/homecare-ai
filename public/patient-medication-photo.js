// See MEDICATION_PHOTO_DEMO_SPEC.md. This module uses the patient shell's dialog,
// navigation, dirty tracking and save lock rather than defining another shell.
export function createMedicationPhoto({ api, getContext, openDialog, setBusy, onSaved, escape }) {
  const $ = selector => document.querySelector(selector);
  const form = $('#medication-photo-form');
  const dialog = $('#medication-photo-dialog');
  const state = { imageData: null, analysis: null, loading: false, analyzing: false, saving: false,
    generation: 0, patientId: null, date: null, schedule: null, submissionKey: null, submissionPayload: null };
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  const statusLabel = status => ({ taken: '먹었어요', missed: '못 먹었어요', unknown: '기억 안 나요' })[status] || '미보고';
  function error(message) { $('#med-photo-error').textContent = message; $('#med-photo-error').hidden = !message; }
  function invalidate() {
    ++state.generation; state.analysis = null; state.analyzing = false; state.loading = false;
    state.submissionKey = null; state.submissionPayload = null;
    $('#med-photo-review').replaceChildren(); $('#med-photo-review').hidden = true;
    $('#med-photo-confirm').checked = false;
  }
  function reset() {
    invalidate(); state.imageData = null; state.loading = false;
    $('#med-photo-preview').hidden = true; $('#med-photo-preview').removeAttribute('src');
    $('#med-photo-file').value = ''; form.reset(); error(''); refresh();
  }
  function refresh() {
    const context = getContext();
    $('#open-medication-photo').disabled = !context.schedule?.slots?.length || context.busy;
    const available = context.vision?.available === true;
    $('#med-photo-availability').textContent = available
      ? '약봉투·포장에 인쇄된 약명·함량의 글자를 읽어요. 개인정보를 가린 사진을 사용해 주세요.'
      : '현재 사진 AI를 사용할 수 없어요. 창을 닫고 기존 복약 목록에서 직접 기록할 수 있어요.';
    const busy = state.loading || state.analyzing || state.saving;
    $('#med-photo-analyze').disabled = !available || !state.imageData || busy || !$('#med-photo-consent').checked || !$('#med-photo-package').checked;
    $('#med-photo-analyze').textContent = state.analyzing ? '약봉투 글자를 읽고 있어요…' : '약봉투 글자 읽기';
    $('#med-photo-save').disabled = busy || !state.analysis || !$('#med-photo-confirm').checked;
    $('#med-photo-save').textContent = state.saving ? '사진과 복약 기록을 저장하고 있어요…' : '확인한 회차와 사진 저장하기';
    $('#med-photo-file').disabled = state.saving;
    $('#med-photo-consent').disabled = state.saving;
    $('#med-photo-package').disabled = state.saving;
    $('#med-photo-remove').disabled = state.saving;
    $('#med-photo-remove').hidden = !state.imageData;
    dialog.querySelectorAll('.close-dialog, #med-photo-review input, #med-photo-review select, #med-photo-review textarea, #med-photo-confirm').forEach(input => { input.disabled = state.saving; });
  }
  function open() {
    const context = getContext();
    if (!context.schedule?.slots?.length || context.busy) return;
    reset(); state.patientId = context.patientId; state.date = context.date; state.schedule = structuredClone(context.schedule);
    $('#med-photo-context').textContent = `${context.name} · ${state.date}의 복약 기록`;
    refresh(); openDialog('medication-photo-dialog');
    dialog.querySelector('.dialog-body').scrollTop = 0;
  }
  function renderReview() {
    const candidates = state.analysis.proposal.medications || [];
    const orders = state.schedule.orders;
    const candidateHtml = candidates.map(candidate => {
      const sameName = orders.filter(order => normalize(order.name) === normalize(candidate.name));
      const matches = sameName.length ? sameName.map(order => `${order.name} ${order.strength} · ${!candidate.strength || !order.strength ? '함량 직접 확인 필요' : normalize(order.strength) === normalize(candidate.strength) ? '이름·함량 문자열 일치 후보' : '함량 다름 · 직접 확인 필요'}`).join(' / ') : '같은 이름의 등록 계획 없음 · 의료진에게 확인 요청';
      return `<article class="med-photo-candidate"><strong>${escape(candidate.name)} ${escape(candidate.strength)}</strong><p>${escape(candidate.labelText)}</p><p class="record-source">${escape(matches)}</p></article>`;
    }).join('');
    $('#med-photo-review').innerHTML = `<h3>1. 사진에서 읽은 글자 후보</h3>${candidateHtml || '<p>읽을 수 있는 약명을 찾지 못했어요. 포장과 아래 계획을 직접 대조하거나 의료진에게 문의해 주세요.</p>'}<p class="section-description">사진에 없는 약을 미복용으로 처리하지 않아요. 아래에서 보고할 약과 회차만 선택해 주세요. 등록되지 않은 약은 의료진이 먼저 계획에 등록해야 해요.</p><h3>2. 보고할 약·회차와 상태 선택</h3>${state.schedule.slots.map((slot, index) => `<fieldset class="med-photo-slot" data-photo-slot="${index}"><legend>${escape(slot.time)} · ${escape(slot.name)}</legend><p>${escape([slot.strength,slot.dose,slot.route].filter(Boolean).join(' · '))}</p><p class="record-source">현재 기록: ${escape(statusLabel(slot.status))} · 보고 ${slot.revision}차</p><label class="analysis-consent"><input type="checkbox" name="selected-${index}" data-slot-select="${index}"><span>이 회차를 사진과 함께 보고할게요</span></label><div data-photo-fields="${index}" hidden><label for="med-photo-status-${index}">이 회차의 복약 상태</label><select id="med-photo-status-${index}" name="status-${index}"><option value="">직접 선택해 주세요</option><option value="taken">먹었어요</option><option value="missed">못 먹었어요</option><option value="unknown">기억 안 나요</option></select><label for="med-photo-reason-${index}">사유 (선택)</label><input id="med-photo-reason-${index}" name="reason-${index}" maxlength="1000"><label for="med-photo-note-${index}">메모 (선택)</label><textarea id="med-photo-note-${index}" name="note-${index}" maxlength="2000" rows="2"></textarea></div></fieldset>`).join('')}${state.analysis.warnings.map(warning => `<p class="analysis-warning">${escape(warning)}</p>`).join('')}`;
    $('#med-photo-review').hidden = false;
  }
  async function analyze() {
    if ($('#med-photo-analyze').disabled) return;
    invalidate(); const generation = state.generation, patientId = state.patientId, imageData = state.imageData;
    state.analyzing = true; error(''); refresh();
    try {
      const result = await api(`/api/patients/${encodeURIComponent(patientId)}/photo-analyses`, { method: 'POST', body: JSON.stringify({ kind: 'medication', imageData, consentExternalProcessing: true }) });
      if (generation !== state.generation || !dialog.open || getContext().patientId !== patientId) return;
      if (result.analysis?.kind !== 'medication' || result.analysis.patientId !== patientId || !Array.isArray(result.analysis.proposal?.medications)) throw new Error('약봉투 분석 결과를 확인하지 못했어요.');
      state.analysis = result.analysis; renderReview();
    } catch (cause) { if (generation === state.generation && dialog.open) error(`${cause.message} 창을 닫고 직접 기록할 수 있어요.`); }
    finally { if (generation === state.generation) { state.analyzing = false; refresh(); } }
  }
  async function save(event) {
    event.preventDefault(); if ($('#med-photo-save').disabled) return;
    const data = new FormData(form);
    const slots = state.schedule.slots.flatMap((slot, index) => data.has(`selected-${index}`) ? [{ orderId: slot.orderId, time: slot.time,
      status: data.get(`status-${index}`), reason: String(data.get(`reason-${index}`) || '').trim(), note: String(data.get(`note-${index}`) || '').trim(), expectedRevision: slot.revision }] : []);
    if (!slots.length || slots.length > 24 || slots.some(slot => !slot.status)) { error('보고할 회차를 1~24개 고르고 각 회차의 복약 상태를 직접 선택해 주세요.'); return; }
    const payload = { analysisId: state.analysis.id, imageData: state.imageData, date: state.date, patientConfirmed: true, slots };
    const signature = JSON.stringify(payload);
    if (signature !== state.submissionPayload) { state.submissionPayload = signature; state.submissionKey = crypto.randomUUID(); }
    state.saving = true; setBusy(true); error(''); refresh();
    let saved = false;
    try {
      await api(`/api/patients/${encodeURIComponent(state.patientId)}/medication-photo-reports`, { method: 'POST', body: JSON.stringify({ ...payload, clientSubmissionId: state.submissionKey }) });
      saved = true;
    } catch (cause) { error(cause.message); }
    finally { state.saving = false; setBusy(false); refresh(); }
    if (saved) { dialog.close(); await onSaved(); }
  }
  $('#med-photo-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    invalidate(); state.imageData = null; $('#med-photo-preview').hidden = true; $('#med-photo-preview').removeAttribute('src'); error('');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { error('5MB 이하 JPG·PNG·WebP를 선택해 주세요. HEIC는 JPEG로 변환해 주세요.'); refresh(); return; }
    const generation = state.generation; state.loading = true; refresh();
    try {
      const imageData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('사진을 읽지 못했어요.')); reader.readAsDataURL(file); });
      if (generation !== state.generation || !dialog.open) return;
      state.imageData = imageData; $('#med-photo-preview').src = imageData; $('#med-photo-preview').hidden = false;
    } catch (cause) { if (generation === state.generation) error(cause.message); }
    finally { if (generation === state.generation) { state.loading = false; refresh(); } }
  });
  $('#med-photo-remove').addEventListener('click', () => { invalidate(); state.imageData = null; state.loading = false; $('#med-photo-file').value = ''; $('#med-photo-preview').hidden = true; $('#med-photo-preview').removeAttribute('src'); refresh(); });
  for (const id of ['med-photo-consent','med-photo-package']) $(`#${id}`).addEventListener('change', () => { invalidate(); refresh(); });
  form.addEventListener('change', event => {
    if (event.target.dataset.slotSelect !== undefined) $(`[data-photo-fields="${event.target.dataset.slotSelect}"]`).hidden = !event.target.checked;
    if (event.target.id !== 'med-photo-confirm') $('#med-photo-confirm').checked = false;
    refresh();
  });
  form.addEventListener('input', event => { if (event.target.matches('textarea, [maxlength]')) { $('#med-photo-confirm').checked = false; refresh(); } });
  $('#med-photo-analyze').addEventListener('click', analyze); form.addEventListener('submit', save);
  function renderReports(reports) {
    $('#medication-photo-history').innerHTML = reports.length ? `<h2>사진을 첨부한 자기보고</h2>${reports.map(report => `<details class="med-photo-report"><summary>${escape(report.date)} · ${report.events.length}회차 · 사진 첨부</summary><p class="record-source">환자 자기보고 · 의료진 미검토 · 사진은 복용 증거가 아니에요.</p><img loading="lazy" src="${escape(report.imageUrl)}" alt="첨부한 약봉투 또는 포장 사진">${report.events.map(event => `<p>${escape(event.time)} · ${escape(event.name)} · ${escape(statusLabel(event.status))} (당시 ${event.revision}차 보고)</p>`).join('')}</details>`).join('')}` : '';
  }
  return { open, reset, refresh, renderReports, dirtySnapshot: () => JSON.stringify([state.imageData, state.loading, state.analyzing]), busy: () => state.loading || state.analyzing || state.saving };
}
