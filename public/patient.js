"use strict";

import { bootstrapSession, sessionState, sessionHeaders, sessionExpired, demoPatient, assertSessionActive } from './session.js';
import { createMedicationPhoto } from './patient-medication-photo.js';
import { createPatientCommunications } from './patient-communications.js';
import { preparePatientImage } from './patient-image.js';
import { createPatientAssist } from './patient-assist.js';
import { createPatientDictation } from './patient-dictation.js';
import { createValueConfirmation } from './patient-value-confirmation.js';

import { PATIENT_SCREENS, PATIENT_INPUT_SCREENS } from './patient-screens.js';

(async () => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const views = Object.keys(PATIENT_SCREENS);
  const metrics = ["steps", "sleepHours", "proteinGrams"];
  const dailyModes = { all: { fields: ["steps", "sleepHours", "weightKg", "medicationStatus", "appetite", "mood", "note"], hint: "입력하거나 바꾼 항목만 저장해요. 답하지 않은 항목은 미보고로 남아요." }, steps: { fields: ["steps"], hint: "이 날짜의 걸음 수만 저장해요. 수면이나 복약 기록은 바뀌지 않아요." }, sleep: { fields: ["sleepHours"], hint: "이 날짜의 수면 시간만 저장해요. 활동이나 복약 기록은 바뀌지 않아요." } };
  const state = { patients: [], patientId: null, summary: null, view: "home", metric: "steps", section: null, imageData: null, loading: false, saving: null, photoLoading: false, requestId: 0, dateRequestId: 0, photoRequestId: 0, dailyMode: "all", dailyBaseline: {}, dailyRevision: 0, dailySubmissionKey: null, dailySubmissionPayload: null, legacyDailyRevision: 0, legacySubmissionKey: null, legacySubmissionPayload: null, mealSubmissionKey: null, mealSubmissionPayload: null, capabilities: null, analysis: null, analysisBusy: false, analysisRequestId: 0, medicationDate: null, medicationSchedule: null, todayMedication: null, medicationRequestId: 0, medicationBusy: false, connectionRequestId: 0, connections: null, connectionBusy: false };
  const communication = createPatientCommunications({api,getView:()=>state.view,isBusy:()=>Boolean(state.saving||state.loading),setBusy:value=>{state.saving=value?'message':null;renderNavigation();},toast});
  const labels = { meal: { breakfast: "아침", lunch: "점심", dinner: "저녁", snack: "간식" }, food: { balanced: "밥과 반찬", porridge: "죽·부드러운 식사", protein: "고기·생선·두부", noodles: "면·빵" }, medication: { taken: "모두 복용", partial: "일부 복용", missed: "미복용", unknown: "기억나지 않음" }, appetite: { good: "좋음", normal: "보통", poor: "적음" }, mood: { good: "좋음", normal: "보통", poor: "가라앉음" } };
  const icons = {
    steps: '<path d="M10 3 7 7l1 5-3 7m3-7 5 2 2 7m-3-12 3 3h5"/><circle cx="14" cy="4" r="2"/>',
    sleep: '<path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10z"/>',
    medication: '<path d="m8 16 8-8m-3-3a5 5 0 0 1 7 7l-8 8a5 5 0 0 1-7-7z"/>',
    nutrition: '<path d="M5 3v7m3-7v7m3-7v7M5 7h6m-3 3v11m10-18c-3 2-3 8 0 9v9m0-18v9"/>',
    meal: '<path d="M4 11h16a8 8 0 0 1-16 0zm8-8v4M7 4l1 3m9-3-1 3"/>',
  };
  const svg = (key) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key] || icons.meal}</svg>`;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const medicationPhoto = createMedicationPhoto({ api, escape,
    getContext: () => ({ patientId: state.patientId, date: state.medicationDate, schedule: state.medicationSchedule, name: state.summary?.patient.name || '', vision: state.capabilities?.vision, busy: Boolean(state.saving || state.loading) }),
    openDialog: openRecordDialog, setBusy: value => { state.saving = value ? 'medication-photo' : null; renderNavigation(); },
    onSaved: async () => {
      savedFeedback('사진 복약 자기보고', state.medicationDate);
      try { await loadMedicationSchedule(); await loadPatient(state.patientId, { preserveMedicationInputs: true }); }
      catch { formError('#medication-error', '저장은 완료했지만 목록을 다시 불러오지 못했어요. 새로고침해 주세요.'); }
    },
  });
  const numeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const number = (value, digits = 0) => numeric(value) ? Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits }) : "—";
  const dateObject = (date) => new Date(`${date}T12:00:00+09:00`);
  const shortDate = (date) => date ? dateObject(date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }) : "";
  const weekday = (date) => date ? dateObject(date).toLocaleDateString("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }) : "";
  const fallbackToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const today = () => state.summary?.today || fallbackToday();
  let toastTimer, assist, dictation, valueConfirmation, checkedAt=0;
  let guidanceContextId = crypto.randomUUID(), medicationGuidancePending = false, guidanceValidation = false;
  const guidanceFormKey = () => JSON.stringify([state.patientId, state.view, $('dialog[open]')?.id || null, $('dialog[open] [name="date"]')?.value || state.medicationDate, guidanceContextId]);
  const dialogBaseline = new Map();
  const dialogOpeners = new Map();
  const medicationBaseline = new Map();
  let dailyLoadedDate, sessionReady = false, bootstrapInFlight = false, pendingPatientId = null;
  let recordLoadState = 'idle', pendingSave = null, operationState = 'idle';
  let connectionCreateRequestId = null, connectionCreatePayload = null, connectionRecoveryId = null, connectionIssuedId = null, connectionIssuanceState = 'idle';

  function formSnapshot(form) {
    return JSON.stringify([...form.elements].filter(element => element.name && !(form.id === 'daily-form' && element.name === 'date') && !['submit', 'button', 'file'].includes(element.type)).map(element =>
      [element.name, element.value, ['radio', 'checkbox'].includes(element.type) ? element.checked : null]
    ).concat(form.id === 'meal-form' ? [['imageData', state.imageData]] : form.id === 'medication-photo-form' ? [['medicationPhoto', medicationPhoto.dirtySnapshot()]] : []));
  }

  function dialogDirty(dialog) {
    const form = $('form', dialog);
    return Boolean(dictation?.belongsTo(form)&&dictation.dirty()) || (dialogBaseline.has(dialog.id) && dialogBaseline.get(dialog.id) !== formSnapshot(form));
  }

  function medicationDirty() {
    return state.view === 'medication' && $$('#medication-list form, #legacy-medication-form').some(form =>
      medicationBaseline.has(form.id) && medicationBaseline.get(form.id) !== formSnapshot(form));
  }

  function canLeavePatient() {
    if (state.saving || state.loading || state.connectionBusy) return false;
    const voiceDirty=dictation?.dirty();dictation?.pause();
    const uncertainConnection = connectionIssuanceState === 'unknown';
    const dirty=$$('dialog[open]').some(dialogDirty)||medicationDirty()||communication.dirty()||voiceDirty||uncertainConnection;
    if(dirty && !window.confirm(uncertainConnection ? '연결 코드 발급 결과를 아직 확인하지 못했어요. 환자를 바꾸거나 새로고침하면 같은 발급 결과를 확인하기 어려워요. 그래도 나갈까요?' : pendingSave ? '저장 결과를 아직 확인하지 못했어요. 나간 뒤 다시 입력하면 중복될 수 있어요. 그래도 나갈까요?' : '저장하지 않은 입력이 있어요. 저장하지 않고 나갈까요?'))return false;
    if(dirty)communication.discard();dictation?.reset();assist?.stop();return true;
  }

  function openRecordDialog(id) {
    assist?.stop(); dictation?.reset();
    guidanceContextId = crypto.randomUUID(); valueConfirmation?.reset();
    const dialog = $(`#${id}`);
    dialogBaseline.set(id, formSnapshot($('form', dialog)));
    dialogOpeners.set(id, document.activeElement);
    dialog.showModal();
  }

  function closeRecordDialog(dialog) {
    const voiceDirty=dictation?.belongsTo($('form',dialog))&&dictation.dirty();dictation?.pause();
    if (state.saving || ((voiceDirty||dialogDirty(dialog)) && !window.confirm(pendingSave ? '저장 결과를 아직 확인하지 못했어요. 나간 뒤 다시 입력하면 중복될 수 있어요. 그래도 나갈까요?' : '저장하지 않은 입력이 있어요. 저장하지 않고 나갈까요?'))) return;
    dialog.close();
  }

  function renderNavigation() {
    const screen = PATIENT_SCREENS[state.view];
    if (state.view !== 'home') $(`#view-${state.view} h1`).textContent = screen.title;
    const locked = Boolean(state.saving || state.loading || state.connectionBusy);
    $('#patient-view-close').hidden = !screen.closeTarget;
    $('#voice-guide-controls').hidden = false;
    $('#patient-view-close').disabled = locked;
    $('#patient-view-close').dataset.screenId = screen.id;
    $('#patient-home-link').href = `/patient?patientId=${encodeURIComponent(state.patientId || '')}`;
    $('#patient-home-link').setAttribute('aria-disabled', String(locked));
    $$('.bottom-nav button').forEach(button => { button.disabled = locked; });
    $('#patient-select').disabled = locked;
    medicationPhoto.refresh();
  }

  async function api(path, options = {}) {
    assertSessionActive();
    const writing = !['GET', 'HEAD'].includes(options.method || 'GET');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path.endsWith("/photo-analyses") ? 65000 : 20000);
    const scope = $('dialog[open] form') || $(`#view-${state.view}`);
    let progress, slowTimer;
    if (writing && scope) {
      progress = document.createElement('p');
      progress.className = 'inline-notice'; progress.setAttribute('role', 'status'); progress.dataset.operationStatus = '';
      progress.textContent = path.endsWith('/photo-analyses') ? '사진을 분석하고 있어요. 잠시 기다려 주세요.' : '요청을 처리하고 있어요. 잠시 기다려 주세요.';
      (scope.querySelector('.dialog-body') || scope).append(progress);
      slowTimer = setTimeout(() => { progress.textContent = '평소보다 오래 걸리고 있어요. 아직 결과를 기다리고 있으니 버튼을 다시 누르지 않아도 돼요.'; }, 5000);
    }
    try {
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...sessionHeaders(), ...(options.headers || {}) }, signal: controller.signal });
      if(response.status===401)sessionExpired();
      let payload;
      try { payload = await response.json(); }
      catch { const issue = new Error('서버 응답을 확인하지 못했어요. 같은 작업을 다시 시도해 주세요.'); issue.status = response.status; issue.outcomeUnknown = writing && (response.ok || response.status >= 500); throw issue; }
      if (!response.ok) { const issue = new Error(payload.error || "기록을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."); issue.status = response.status; issue.outcomeUnknown = writing && response.status >= 500; throw issue; }
      return payload;
    } catch (error) {
      if (error.name === "AbortError" || error instanceof TypeError) {
        const issue = new Error(writing ? '서버에 반영됐는지 아직 확인하지 못했어요. 연결을 확인한 뒤 같은 작업을 다시 시도해 주세요.' : '응답을 받지 못했어요. 연결 상태를 확인하고 다시 불러와 주세요.');
        issue.outcomeUnknown = writing; throw issue;
      }
      throw error;
    } finally { clearTimeout(timeout); clearTimeout(slowTimer); progress?.remove(); }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    const element = $("#toast");
    element.textContent = message;
    element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 4000);
  }

  function savedFeedback(item, date, detail = '저장한 내용은 내 기록에서 다시 확인할 수 있어요.') {
    $('#save-confirmation-title').textContent = `${state.summary?.patient?.name || '환자'}님 · ${date} · ${item} 저장 완료`;
    $('#save-confirmation-detail').textContent = detail;
    $('#save-confirmation').hidden = false;
    toast(`${item}을 저장했어요.`);
  }

  function savedRefreshFailed() {
    $('#save-confirmation-detail').textContent = '저장은 완료했어요. 최신 목록을 불러오지 못했으니 다시 불러오기를 눌러 주세요.';
    $('#save-confirmation').hidden = false;
  }

  function networkNotice() {
    const notice = $('#connection-status-notice');
    notice.hidden = false;
    notice.textContent = navigator.onLine ? '인터넷 연결이 돌아왔어요. 입력 내용을 확인한 뒤 저장 버튼을 눌러 주세요. 자동으로 다시 저장하지 않아요.' : '인터넷 연결이 끊겼어요. 입력은 현재 화면에만 남아 있어요. 창을 닫거나 새로고침하지 말고 연결 후 저장해 주세요.';
  }

  function showError(message) {
    $("#load-error-message").textContent = message;
    $("#load-error").hidden = false;
    $("#loading-state").hidden = true;
  }

  function clearConnectionToken() {
    for (const id of ["connection-token-value", "connection-server-origin", "connection-patient-name", "connection-patient-id"]) $(`#${id}`).textContent = "";
    $("#connection-token").hidden = true;
  }

  function invalidateAnalysis() {
    ++state.analysisRequestId;
    if (state.analysis) $$('#meal-form input[name="foodType"]').forEach(input => { input.checked = false; });
    state.analysis = null;
    state.analysisBusy = false;
    $("#meal-analysis-review").replaceChildren();
    $("#meal-analysis-review").hidden = true;
    $("#meal-analysis-error").hidden = true;
    $("#meal-manual-food").hidden = false;
    $("#meal-analysis-consent").checked = false;
    refreshAnalysisControls();
  }

  async function loadPatient(patientId, { initial = false, historyMode = "replace", preserveMedicationInputs = false } = {}) {
    const requestId = ++state.requestId;
    pendingPatientId = patientId;
    const changed = patientId !== state.patientId;
    state.loading = true;
    renderNavigation();
    $("#patient-select").disabled = true;
    $("#load-error").hidden = true;
    if (initial || changed) {
      dictation?.reset(); assist?.changed();
      ++state.medicationRequestId;
      ++state.connectionRequestId;
      ++state.dateRequestId;
      invalidateAnalysis();
      clearConnectionToken();
      $("#save-confirmation").hidden = true;
      state.mealSubmissionKey = null; state.mealSubmissionPayload = null;
      state.medicationSchedule = null;
      state.connections = null;
      connectionCreateRequestId = null; connectionCreatePayload = null; connectionRecoveryId = null; connectionIssuedId = null;
      connectionIssuanceState = 'idle'; renderConnectionRecovery();
      if (!state.saving) $$("dialog[open]").forEach(dialog => dialog.close());
      $("#loading-state").hidden = false;
      $("#app-content").hidden = true;
    }
    try {
      if(sessionState.mode==='demo')await demoPatient(patientId);
      const [summary, todayMedication] = await Promise.all([
        api(`/api/patients/${encodeURIComponent(patientId)}/summary`),
        api(`/api/patients/${encodeURIComponent(patientId)}/medication-schedule?date=${encodeURIComponent(fallbackToday())}`).catch(() => null),
      ]);
      if (requestId !== state.requestId) return;
      state.patientId = patientId;
      pendingPatientId = null;
      if(initial||changed)communication.reset(patientId);
      state.summary = summary;
      checkedAt=Date.now();
      state.todayMedication = todayMedication;
      $("#patient-select").value = patientId;
      try { localStorage.setItem("homecarePatientId", patientId); } catch (_) { /* Storage is optional. */ }
      render();
      $("#loading-state").hidden = true;
      $("#app-content").hidden = false;
      applyView({ historyMode, focus: false, refreshMedication: !preserveMedicationInputs || changed });
    } catch (error) {
      if (requestId === state.requestId) showError(error.message);
      throw error;
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        renderNavigation();
        assist?.update({automatic:initial||changed});
      }
    }
  }

  function currentMeals() {
    return state.summary?.todayMeals || (state.summary?.recentMeals || []).filter((meal) => meal.date === today());
  }

  function render() {
    const summary = state.summary;
    const record = summary.todayRecord;
    const name = summary.patient?.name || "환자";
    $("#patient-name").textContent = name;
    $("#today-label").textContent = dateObject(today()).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" });
    const clinicianUrl = `/clinician?patientId=${encodeURIComponent(state.patientId)}`;
    $("#guide-clinician-link").href = clinicianUrl;
    $("#guide-clinician-link").hidden=sessionState.mode==='kakao' && sessionState.user?.role!=='clinician';
    renderHome(record);
    renderRecords();
  }

  function sourceLabel(source, value) {
    if (!numeric(value)) return "미보고";
    return ({ "patient-self-report": "직접 입력", "health-connect": "Health Connect에서 수신", "apple-health": "Apple 건강에서 수신" })[source] || "직접 입력";
  }

  function renderHome(record) {
    const meals = currentMeals();
    const schedule = state.todayMedication;
    const scheduled = Boolean(schedule?.orders?.length);
    const slots = schedule?.slots || [];
    const reported = slots.filter(slot => slot.status !== "pending").length;
    const taken = slots.filter(slot => slot.status === "taken").length;
    const tasks = [
      { label: "식사", done: meals.length > 0 },
      { label: "복약", done: Boolean(schedule) && (scheduled ? slots.length > 0 && reported === slots.length : Boolean(record?.medicationStatus)) },
      { label: "활동", done: numeric(record?.steps) },
      { label: "수면", done: numeric(record?.sleepHours) },
    ];
    const count = tasks.filter((task) => task.done).length;
    $("#progress-count").innerHTML = `${count}<span>종류</span>`;
    $("#progress-fill").style.width = `${count * 25}%`;
    $("#progress-heading").textContent = count ? "오늘 남긴 기록이에요" : "필요한 기록부터 남겨요";
    $("#task-chips").innerHTML = tasks.map((task) => `<span class="task-chip${task.done ? " done" : ""}"><span class="check-dot" aria-hidden="true">${task.done ? "✓" : ""}</span>${task.label}<span class="sr-only">${task.done ? "기록 완료" : "미기록"}</span></span>`).join("");
    const knownMeals = meals.filter(meal => numeric(meal.proteinGrams));
    const protein = knownMeals.reduce((sum, meal) => sum + Number(meal.proteinGrams), 0);
    const cards = [
      { icon: "steps", label: "걸음 수", value: numeric(record?.steps) ? number(record.steps) : null, unit: "걸음", status: numeric(record?.steps) ? sourceLabel(record.stepsSource, record.steps) : "오늘의 활동을 남겨요", target: "steps" },
      { icon: "sleep", label: "수면", value: numeric(record?.sleepHours) ? number(record.sleepHours, 1) : null, unit: "시간", status: numeric(record?.sleepHours) ? sourceLabel(record.sleepSource, record.sleepHours) : "어젯밤 얼마나 주무셨나요?", target: "sleep" },
      { icon: "medication", label: "복약", value: !schedule ? "일정 확인 필요" : scheduled ? `${reported}/${slots.length}회 보고` : record?.medicationStatus ? labels.medication[record.medicationStatus] : null, unit: "", status: !schedule ? "목록을 다시 불러와 주세요" : scheduled ? `${taken}회 복용 보고 · ${slots.length - reported}회 미보고` : record?.medicationStatus ? "하루 전체 자기보고" : "오늘의 복약을 남겨요", target: "medication" },
      { icon: "nutrition", label: "단백질", value: knownMeals.length ? number(protein, 1) : meals.length ? "양 미상" : null, unit: knownMeals.length ? "g" : "", status: meals.length ? `기록한 식사 추정 합계 · ${meals.length - knownMeals.length}회 양 미상` : "식사를 기록하면 보여요", target: "nutrition" },
    ];
    $("#today-metrics").innerHTML = cards.map((card) => `<button class="health-card" type="button" data-action="${card.target}" aria-label="${escape(card.label)} ${card.value === null ? "미기록" : escape(card.value + " " + card.unit)}. ${card.target === "nutrition" ? "식사 기록 보기" : card.target === "medication" ? "복약 목록 보기" : "기록하기"}"><span class="metric-heading">${svg(card.icon)}${card.label}</span><span class="metric-value${card.value === null ? " empty" : ""}">${card.value === null ? "아직 기록 전" : escape(card.value)}${card.value !== null && card.unit ? `<small>${card.unit}</small>` : ""}</span><span class="metric-status">${escape(card.status)}</span><span class="metric-action">${card.target === "nutrition" ? "식사 기록 보기 ›" : card.target === "medication" ? "약 기록 열기 ›" : "입력·수정하기 ›"}</span></button>`).join("");
    $("#health-source-caption").textContent = `활동: ${sourceLabel(record?.stepsSource, record?.steps)} · 수면: ${sourceLabel(record?.sleepSource, record?.sleepHours)}`;
    renderMeals($("#home-meals"), (state.summary.recentMeals || []).slice(0, 2));
    assist?.update();
  }

  function safeImageUrl(value) {
    if (typeof value !== "string") return "";
    if (/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)) return value;
    if (/^\/uploads\/[a-zA-Z0-9_.-]+$/.test(value) || /^\/api\/meals\/[a-zA-Z0-9_-]+\/image$/.test(value)) return value;
    return "";
  }

  function renderMeals(container, meals) {
    if (!meals.length) {
      container.innerHTML = '<div class="empty-card"><p>아직 식사 기록이 없어요.</p><p>오늘의 첫 번째 식사를 남겨보세요.</p></div>';
      return;
    }
    container.innerHTML = `<div class="meal-list">${meals.map((meal) => {
      const imageUrl = safeImageUrl(meal.imageUrl);
      const portion = !numeric(meal.portion) ? "드신 양 모름" : Number(meal.portion) === 0 ? "안 먹었어요" : Number(meal.portion) === 1 ? "모두" : `${number(Number(meal.portion) * 100)}%`;
      return `<article class="meal-item">${imageUrl ? `<img class="meal-thumb" src="${escape(imageUrl)}" alt="${escape(labels.meal[meal.mealType] || "식사")} 기록 사진" loading="lazy">` : `<span class="meal-thumb meal-placeholder" aria-hidden="true">${svg("meal")}</span>`}<div class="meal-details"><h3 class="meal-title">${escape(meal.foodLabel || labels.food[meal.foodType] || "식사 기록")}</h3><p class="meal-meta">${escape(shortDate(meal.date))} · ${escape(labels.meal[meal.mealType] || meal.mealType)} · ${escape(portion)}</p></div><p class="meal-nutrition">${numeric(meal.calories) ? `${number(meal.calories)} <span>kcal</span>` : "영양량 미상"}<small>${numeric(meal.proteinGrams) ? `단백질 ${number(meal.proteinGrams, 1)}g · 추정` : "드신 양을 몰라 계산하지 않았어요"}</small><small class="record-source">${meal.source?.includes("vision") || meal.analysisId ? "AI 초안 확인 기록" : "수동 선택 예시"}</small></p></article>`;
    }).join("")}</div>`;
  }

  function renderRecords() {
    renderChart();
    const trends = [...(state.summary.trends || [])].slice(-7).reverse();
    $("#daily-history").innerHTML = trends.length ? trends.map((entry) => {
      const hasDaily = entry.hasDaily || entry.hasDoseReport || numeric(entry.steps) || numeric(entry.sleepHours) || Boolean(entry.medicationStatus);
      const values = [numeric(entry.steps) ? `${number(entry.steps)}걸음` : "활동 미기록", numeric(entry.sleepHours) ? `수면 ${number(entry.sleepHours, 1)}시간` : "수면 미기록"];
      return `<div class="history-row"><div class="history-date"><strong>${escape(shortDate(entry.date).replace(/\.\s*$/, ""))}</strong><span>${escape(weekday(entry.date))}요일</span></div><p class="history-values">${hasDaily ? values.join("<br>") : "아직 남긴 기록이 없어요"}${hasDaily ? `<small class="record-source">활동 ${escape(sourceLabel(entry.stepsSource, entry.steps))} · 수면 ${escape(sourceLabel(entry.sleepSource, entry.sleepHours))}</small>` : ""}</p><span class="history-med${!entry.medicationStatus || entry.medicationStatus === "unknown" ? " missing" : ""}">${entry.hasDoseReport ? `${number(entry.doseReportedSlots)}회차 보고 · ` : ""}${escape(labels.medication[entry.medicationStatus] || "일일 복약 미기록")}</span><button type="button" class="history-edit text-button" data-action="edit-daily" data-date="${escape(entry.date)}" aria-label="${escape(shortDate(entry.date))} 건강 기록 수정">수정</button></div>`;
    }).join("") : '<p class="history-empty">아직 건강 기록이 없어요.</p>';
    const meals = state.summary.recentMeals || [];
    renderMeals($("#all-meals"), meals);
    $("#meal-record-count").textContent = `최근 식사 ${meals.length}건을 보여드려요. 최대 24건까지 표시해요.`;
  }

  function renderChart() {
    const config = {
      steps: { unit: "걸음", label: "걸음 수", digits: 0, note: "기록이 있는 날의 하루 평균 걸음 수예요." },
      sleepHours: { unit: "시간", label: "수면 시간", digits: 1, note: "기록이 있는 날의 하루 평균 수면 시간이에요." },
      proteinGrams: { unit: "g", label: "단백질", digits: 1, note: "기록된 식사 추정 합계의 기록일 평균이에요. 전체 섭취량을 뜻하지 않아요. 사진 초안 또는 직접 선택한 음식과 섭취 비율로 계산해요." },
    }[state.metric];
    const trends = [...(state.summary.trends || [])].slice(-7);
    const entries = trends.map((entry) => {
      const hasValue = numeric(entry[state.metric]);
      return { ...entry, value: hasValue ? Number(entry[state.metric]) : null };
    });
    const values = entries.filter((entry) => entry.value !== null).map((entry) => entry.value);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    $("#trend-value").textContent = average === null ? "—" : number(average, config.digits);
    $("#trend-unit").textContent = config.unit;
    $("#trend-description").textContent = values.length ? `기록한 ${values.length}일의 하루 평균` : state.metric === "proteinGrams" && trends.some(entry => entry.mealCount > 0) ? "식사는 기록했지만 영양량을 산출하지 못했어요" : "기록을 남기면 변화가 보여요";
    $("#trend-range").textContent = trends.length ? `${shortDate(trends[0].date)} – ${shortDate(trends[trends.length - 1].date)}` : "";
    const sourceKey = state.metric === "steps" ? "stepsSource" : "sleepSource";
    const chartSources = state.metric === "proteinGrams" ? [] : [...new Set(entries.filter(entry => numeric(entry.value)).map(entry => sourceLabel(entry[sourceKey], entry.value)))];
    const unknownMeals = trends.reduce((sum, entry) => sum + (Number(entry.unknownMealCount) || 0), 0);
    $("#chart-note").textContent = `${config.note} ${chartSources.length ? `출처: ${chartSources.join(" / ")}. ` : ""}빈 날은 미기록·미상이에요.${state.metric === "proteinGrams" && unknownMeals ? ` 양을 모르는 식사 ${unknownMeals}건은 합계에서 제외했어요.` : ""}`;
    $("#chart-data-table").innerHTML = `<table><caption>${escape(config.label)} · 기록한 값과 미기록 구분</caption><thead><tr><th scope="col">날짜</th><th scope="col">${escape(config.label)}</th></tr></thead><tbody>${entries.map(entry => `<tr><th scope="row">${escape(shortDate(entry.date))}</th><td>${entry.value === null ? "미기록·미상" : escape(number(entry.value, config.digits) + config.unit)}</td></tr>`).join("")}</tbody></table>`;
    const chart = $("#trend-chart");
    const max = Math.max(...values, state.metric === "sleepHours" ? 10 : 1);
    chart.innerHTML = entries.map((entry) => `<span class="chart-column${entry.value === null ? " missing" : ""}" title="${escape(shortDate(entry.date))}: ${entry.value === null ? "미기록" : escape(number(entry.value, config.digits) + config.unit)}"><span class="chart-bar" style="height:${entry.value === null ? 0 : Math.max(3, (entry.value / max) * 100)}%"></span><span class="chart-label">${entry.date === today() ? "오늘" : escape(weekday(entry.date))}</span></span>`).join("");
    chart.setAttribute("aria-label", `${config.label} 최근 7일 추이. ${entries.map((entry) => `${shortDate(entry.date)} ${entry.value === null ? "미기록" : number(entry.value, config.digits) + config.unit}`).join(", ")}`);
  }

  function routeFromUrl() {
    const params = new URL(location.href).searchParams;
    state.view = views.includes(params.get("view")) ? params.get("view") : "home";
    state.metric = metrics.includes(params.get("metric")) ? params.get("metric") : "steps";
    state.section = ["meals", "history", "chart"].includes(params.get("section")) ? params.get("section") : null;
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today()) state.medicationDate = date;
    else state.medicationDate = today();
    return params.get("patientId");
  }

  function syncUrl(historyMode = "push") {
    const url = new URL(location.href);
    if (state.patientId) url.searchParams.set("patientId", state.patientId);
    for (const key of ["view", "metric", "section", "date"]) url.searchParams.delete(key);
    if (state.view !== "home") url.searchParams.set("view", state.view);
    if (state.view === "records") {
      url.searchParams.set("metric", state.metric);
      if (state.section) url.searchParams.set("section", state.section);
    }
    if (state.view === "medication" && state.medicationDate) url.searchParams.set("date", state.medicationDate);
    if (historyMode === "none" || url.href === location.href) return;
    history[historyMode === "replace" ? "replaceState" : "pushState"]({}, "", url);
  }

  function applyView({ historyMode = "push", focus = true, refreshMedication = true } = {}) {
    renderNavigation();
    communication.activate();
    $$(".app-view").forEach(element => { element.hidden = element.id !== `view-${state.view}`; });
    $$(".bottom-nav [data-view]").forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    $$(".chart-tab").forEach(tab => { const active = tab.dataset.metric === state.metric; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
    if (state.summary) renderChart();
    syncUrl(historyMode);
    if (state.view === "medication" && refreshMedication) loadMedicationSchedule();
    if (state.view === "connections") loadConnections();
    if (focus) {
      const section = state.view === "records" ? ({ meals: "#meal-records-section", history: ".history-section", chart: ".trend-card" }[state.section]) : null;
      const destination = section ? $(section) : $("#main-content");
      destination.setAttribute("tabindex", "-1");
      if (section) destination.scrollIntoView({ block: "start", behavior: "instant" }); else window.scrollTo({ top: 0, behavior: "instant" });
      destination.focus({ preventScroll: true });
    }
  }

  function switchView(view, { section = null, metric, historyMode = "push" } = {}) {
    if (!views.includes(view) || !canLeavePatient()) return;
    if (view !== "connections") { clearConnectionToken(); ++state.connectionRequestId; }
    if (view !== "medication") ++state.medicationRequestId;
    state.view = view;
    state.section = section;
    if (metrics.includes(metric)) state.metric = metric;
    guidanceContextId = crypto.randomUUID();
    medicationGuidancePending = view === 'medication';
    applyView({ historyMode });
    assist?.update({ automatic: view === 'home' });
  }

  function openMeal() {
    if (!state.summary || state.loading || state.saving) return;
    $("#meal-form").reset();
    setFormBusy('#meal-form', false);
    $("#meal-form [data-voice-applied]")?.remove();
    state.mealSubmissionKey = null; state.mealSubmissionPayload = null;
    $("#meal-dialog-title").textContent = PATIENT_INPUT_SCREENS.meal.title;
    invalidateAnalysis();
    $("#meal-date").value = today();
    $("#meal-date").max = today();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const type = hour < 10 ? "breakfast" : hour < 16 ? "lunch" : "dinner";
    $(`#meal-form input[name="mealType"][value="${type}"]`).checked = true;
    clearPhoto();
    $("#meal-error").hidden = true;
    updateEstimate();
    openRecordDialog(PATIENT_INPUT_SCREENS.meal.dialog);
    assist?.notify('meal_open', { contextId: guidanceContextId, recordDate: $('#meal-date').value });
  }

  function fieldValue(name, record) {
    return record?.[name] ?? (name === "note" ? "" : null);
  }

  function applyDailyRecord(record) {
    valueConfirmation?.reset();
    $("#daily-form [data-voice-applied]")?.remove();
    state.dailyBaseline = {};
    state.dailyRevision = record?.revision ?? 0;
    state.dailySubmissionKey = null; state.dailySubmissionPayload = null;
    $("#sleep-helper-hours").value = ""; $("#sleep-helper-minutes").value = ""; $("#sleep-helper-status").textContent = "";
    for (const name of ["steps", "sleepHours", "weightKg", "note"]) {
      $(`#daily-form [name="${name}"]`).value = record?.[name] ?? "";
      state.dailyBaseline[name] = fieldValue(name, record);
    }
    for (const name of ["medicationStatus", "appetite", "mood"]) {
      $$(`#daily-form input[name="${name}"]`).forEach(input => { input.checked = input.value === record?.[name]; });
      state.dailyBaseline[name] = fieldValue(name, record);
    }
    dailyLoadedDate = $('#daily-date').value;
    dialogBaseline.set('daily-dialog', formSnapshot($('#daily-form')));
  }

  function openDaily(mode = "all", date = today()) {
    if (!state.summary || state.loading || state.saving || !dailyModes[mode]) return;
    ++state.dateRequestId;
    state.dailyMode = mode;
    recordLoadState = 'idle';
    setFormBusy('#daily-form', false);
    $("#daily-form").dataset.mode = mode;
    $("#daily-form").reset();
    const config = dailyModes[mode];
    $("#daily-dialog-title").textContent = PATIENT_INPUT_SCREENS[mode].title;
    $("#daily-scope-note").textContent = config.hint;
    $$("#daily-form [data-daily-fields]").forEach(group => {
      const names = group.dataset.dailyFields.split(" ");
      group.hidden = !names.some(name => config.fields.includes(name)) && !(mode === "all" && names.includes("all"));
    });
    setDailyFieldsDisabled(false);
    $("#daily-submit").textContent = mode === "steps" ? "걸음 수 저장하기" : mode === "sleep" ? "수면 시간 저장하기" : "건강 기록 저장하기";
    $("#daily-date").value = date;
    $("#daily-date").max = today();
    applyDailyRecord(null);
    $("#daily-error").hidden = true;
    $("#daily-reload-record").hidden = true;
    openRecordDialog(PATIENT_INPUT_SCREENS[mode].dialog);
    selectDailyDate();
  }

  function clearPhoto() {
    ++state.photoRequestId;
    invalidateAnalysis();
    state.photoLoading = false;
    state.imageData = null;
    $("#meal-photo").value = "";
    $("#meal-camera").value = "";
    $("#meal-photo-preparation").textContent = "";
    $("#photo-preview").hidden = true;
    $("#photo-preview").removeAttribute("src");
    $("#photo-placeholder").hidden = false;
    $("#remove-photo").hidden = true;
    refreshAnalysisControls();
  }

  function updateEstimate() {
    const data = new FormData($('#meal-form'));
    const raw = data.get('portion');
    const portion = raw === null || raw === 'unknown' ? null : Number(raw);
    const portionLabel = raw === null ? '드신 양을 골라 주세요' : portion === null ? '드신 양 모름' : portion === 0 ? '안 먹었어요' : portion === 1 ? '모두' : portion === .5 ? '절반' : `${portion * 100}%`;
    const proposal = state.analysis?.proposal;
    $('#estimate-selection').textContent = `${proposal?.foodLabel || labels.food[data.get('foodType')] || '음식을 골라 주세요'} · ${portionLabel}`;
    $('#meal-estimate-badge').textContent = proposal ? 'AI 초안 · 직접 확인 필요' : '수동 선택 · 예시 영양 추정';
    $('#meal-estimate-note').textContent = raw === null ? '음식과 실제 드신 양을 직접 선택해야 저장할 수 있어요.' : portion === null ? '양을 모르는 기록은 영양량도 미상으로 저장해요. 0으로 계산하지 않아요.' : proposal ? `저장 시 약 ${number(proposal.calories * portion)} kcal, 단백질 ${number(proposal.proteinGrams * portion, 1)}g으로 추정해요. 실제 섭취량을 확정하지 않아요.` : '직접 선택한 음식 유형의 예시 영양값으로 추정해요. 안 먹었어요는 0으로 저장해요.';
  }

  function formError(id, message) {
    const element = $(id);
    element.textContent = message;
    element.hidden = false;
    element.setAttribute("tabindex", "-1");
    element.scrollIntoView({ block: "nearest" });
    element.focus({ preventScroll: true });
  }

  function setFormBusy(formId, busy) {
    $$('input, textarea, select, button', $(formId)).forEach((element) => { element.disabled = busy; });
    renderNavigation();
  }

  function setDailyFieldsDisabled(disabled) {
    $$('#daily-form input:not([name="date"]), #daily-form textarea').forEach(element => { element.disabled = disabled || !dailyModes[state.dailyMode].fields.includes(element.name); });
    $$("#sleep-helper-hours, #sleep-helper-minutes, #sleep-helper-apply").forEach(element => { element.disabled = disabled || !dailyModes[state.dailyMode].fields.includes("sleepHours"); });
    $("#daily-submit").disabled = disabled;
    const voiceButton = $('#daily-form [data-dictation="daily"]');
    voiceButton.disabled = disabled || recordLoadState !== 'ready';
    voiceButton.textContent = '말로 건강 기록 입력하기';
    if (recordLoadState === 'loading') voiceButton.textContent = '기록을 불러온 뒤 말로 입력할 수 있어요';
  }

  function restoreRecordControls(kind) {
    const uncertain = pendingSave?.kind === kind && operationState === 'unknown';
    setFormBusy(`#${kind}-form`, uncertain);
    if (kind === 'daily' && !uncertain) setDailyFieldsDisabled(recordLoadState !== 'ready');
    if (kind === 'meal' && !uncertain) refreshAnalysisControls();
    if (uncertain) $$(`#${kind}-form .close-dialog`).forEach(button => { button.disabled = false; });
    const button = $(`#${kind}-submit`);
    if (uncertain) button.disabled = false;
    button.textContent = uncertain ? '저장 결과 확인하기' : kind === 'meal' ? '식사 기록 저장하기' : state.dailyMode === 'steps' ? '걸음 수 저장하기' : state.dailyMode === 'sleep' ? '수면 시간 저장하기' : '건강 기록 저장하기';
  }

  async function submitRecord(kind, payload) {
    const patientId = pendingSave?.patientId || state.patientId;
    const dialog = $(`#${kind}-dialog`);
    pendingSave = { kind, patientId, payload };
    operationState = 'saving'; state.saving = kind;
    setFormBusy(`#${kind}-form`, true);
    $(`#${kind}-submit`).textContent = '저장하고 있어요…';
    $(`#${kind}-error`).hidden = true;
    try {
      await api(`/api/patients/${encodeURIComponent(patientId)}/${kind === 'meal' ? 'meals' : 'daily'}`, { method: 'POST', body: JSON.stringify(payload) });
      operationState = 'confirmed'; pendingSave = null;
      dialog.close();
      savedFeedback(kind === 'meal' ? '식사 기록' : '건강 기록', payload.date);
      await loadPatient(patientId);
    } catch (error) {
      if (dialog.open) {
        operationState = error.outcomeUnknown ? 'unknown' : 'error';
        if (!error.outcomeUnknown) pendingSave = null;
        formError(`#${kind}-error`, error.outcomeUnknown ? '저장됐는지 아직 확인하지 못했어요. 입력은 그대로 보관하고 있어요. 아래 저장 결과 확인하기를 누르면 같은 기록을 중복 없이 확인해요.' : error.message);
        if (kind === 'daily') $('#daily-reload-record').hidden = error.status !== 409;
      } else savedRefreshFailed();
    } finally {
      state.saving = null;
      restoreRecordControls(kind);
    }
  }

  async function saveMeal(event) {
    event.preventDefault();
    const button = $("#meal-submit");
    if (button.disabled || state.saving || state.photoLoading || state.analysisBusy) return;
    if (pendingSave?.kind === 'meal') return submitRecord('meal', pendingSave.payload);
    const data = new FormData(event.currentTarget);
    const patientId = state.patientId;
    if (!data.has('foodType')) { formError('#meal-error', '가장 가까운 식사 종류를 하나 골라 주세요.'); return; }
    if (!data.has('portion')) { formError('#meal-error', '실제로 드신 양을 하나 골라 주세요. 기억나지 않으면 모르겠어요를 고를 수 있어요.'); return; }
    const payload = { date: data.get("date"), mealType: data.get("mealType"), foodType: data.get("foodType"), portion: data.get('portion') === 'unknown' ? null : Number(data.get("portion")) };
    if (state.imageData) payload.imageData = state.imageData;
    if (state.analysis) {
      if (!$("#meal-analysis-confirm")?.checked) { formError("#meal-error", "먹기 전 전체 음식 사진인지와 식후 실제 드신 비율을 확인한 뒤 체크해 주세요."); return; }
      payload.analysisId = state.analysis.id;
      payload.patientConfirmed = true;
    }
    const signature = JSON.stringify(payload);
    if (signature !== state.mealSubmissionPayload) { state.mealSubmissionPayload = signature; state.mealSubmissionKey = crypto.randomUUID(); }
    payload.clientSubmissionId = state.mealSubmissionKey;
    await submitRecord('meal', payload);
  }

  async function saveDaily(event) {
    event.preventDefault();
    const button = $("#daily-submit");
    if (button.disabled || state.saving || guidanceValidation) return;
    if (pendingSave?.kind === 'daily') return submitRecord('daily', pendingSave.payload);
    if (recordLoadState !== 'ready' || dailyLoadedDate !== $('#daily-date').value) return;
    const data = new FormData(event.currentTarget);
    const patientId = state.patientId;
    const payload = { date: data.get("date") };
    for (const name of dailyModes[state.dailyMode].fields) {
      const raw = data.get(name);
      const value = ["steps", "sleepHours", "weightKg"].includes(name) ? raw === "" ? null : Number(raw) : name === "note" ? String(raw ?? "").trim() : raw;
      if (value !== state.dailyBaseline[name] && (value !== null || ["steps", "sleepHours", "weightKg"].includes(name))) payload[name] = value;
    }
    if (Object.keys(payload).length === 1) { toast("바뀐 항목이 없어요. 기록할 값을 입력해 주세요."); return; }
    const changedMetrics = ['steps', 'sleepHours'].filter(name => Object.hasOwn(payload, name) && payload[name] !== null);
    if (changedMetrics.length) {
      const form = event.currentTarget, contextId = guidanceContextId, snapshot = formSnapshot(form), date = $('#daily-date').value;
      guidanceValidation = true; button.disabled = true;
      try {
        await assist.refreshConfiguration({force:true});
        if (patientId !== state.patientId || contextId !== guidanceContextId || !$('#daily-dialog').open || date !== $('#daily-date').value || snapshot !== formSnapshot(form)) return;
        if (!assist.getConfiguration().ready) { formError('#daily-error', '입력 확인 설정을 불러오지 못했어요. 입력은 남아 있어요. 연결을 확인하고 저장을 다시 눌러 주세요.'); return; }
        if (!valueConfirmation.validate(changedMetrics)) return;
      } finally { guidanceValidation = false; if (recordLoadState === 'ready' && !state.saving) button.disabled = false; }
    }
    payload.expectedRevision = state.dailyRevision;
    const signature = JSON.stringify(payload);
    if (signature !== state.dailySubmissionPayload) { state.dailySubmissionPayload = signature; state.dailySubmissionKey = crypto.randomUUID(); }
    payload.clientSubmissionId = state.dailySubmissionKey;
    await submitRecord('daily', payload);
  }

  async function selectDailyDate() {
    if (state.saving || pendingSave) { $('#daily-date').value = dailyLoadedDate || today(); return; }
    const requestId = ++state.dateRequestId;
    const date = $("#daily-date").value;
    if (!date || date > today() || !$('#daily-date').checkValidity()) {
      recordLoadState = 'error'; setDailyFieldsDisabled(true);
      formError('#daily-error', '오늘 또는 이전 날짜를 골라 주세요.'); return;
    }
    if (dailyLoadedDate && date !== dailyLoadedDate && dialogDirty($('#daily-dialog')) && !window.confirm('저장하지 않은 입력이 있어요. 다른 날짜를 불러올까요?')) {
      $('#daily-date').value = dailyLoadedDate;
      return;
    }
    dictation?.reset(); assist?.stop(); valueConfirmation?.reset(); guidanceContextId = crypto.randomUUID();
    const patientId = state.patientId;
    recordLoadState = 'loading';
    $("#daily-error").hidden = true;
    setDailyFieldsDisabled(true);
    $("#daily-submit").textContent = "기존 기록을 불러오고 있어요…";
    try {
      const result = await api(`/api/patients/${encodeURIComponent(patientId)}/daily?date=${encodeURIComponent(date)}`);
      if (requestId !== state.dateRequestId || patientId !== state.patientId || date !== $('#daily-date').value || !$("#daily-dialog").open) return;
      applyDailyRecord(result.record);
      recordLoadState = 'ready';
      $("#daily-reload-record").hidden = true;
      const effective = state.summary?.trends.find(entry => entry.date === date);
      const automatic = [state.dailyMode === "sleep" ? "sleepHours" : "steps", ...(state.dailyMode === "all" ? ["sleepHours"] : [])].filter(name => numeric(effective?.[name]) && ["health-connect", "apple-health"].includes(effective[name === "steps" ? "stepsSource" : "sleepSource"]));
      $("#daily-scope-note").textContent = dailyModes[state.dailyMode].hint + (automatic.length ? " 현재 건강 연결에서 받은 값이 있어요. 직접 입력한 값이 우선 표시되며, 입력값을 지우면 연결 자료로 돌아가요." : "");
      setDailyFieldsDisabled(false);
      $("#daily-submit").textContent = state.dailyMode === "steps" ? "걸음 수 저장하기" : state.dailyMode === "sleep" ? "수면 시간 저장하기" : "건강 기록 저장하기";
      assist?.notify(state.dailyMode === "steps" ? "steps_open" : state.dailyMode === "sleep" ? "sleep_open" : "daily_open", { contextId: guidanceContextId, recordDate: date });
    } catch (error) {
      if (requestId !== state.dateRequestId || patientId !== state.patientId || date !== $('#daily-date').value || !$("#daily-dialog").open) return;
      recordLoadState = 'error';
      formError("#daily-error", `${error.message} 아래 다시 불러오기를 눌러 주세요.`);
      $('#daily-reload-record').hidden = false;
      setDailyFieldsDisabled(true);
      $("#daily-submit").textContent = "기존 기록을 불러오지 못했어요";
    }
  }

  async function loadCapabilities() {
    try { state.capabilities = await api("/api/capabilities"); }
    catch (_) { state.capabilities = null; }
    refreshAnalysisControls();
    medicationPhoto.refresh();
  }

  function refreshAnalysisControls() {
    const available = state.capabilities?.vision?.available === true;
    const ready = available && Boolean(state.imageData) && !state.photoLoading;
    $("#meal-analysis-availability").textContent = available ? "GPT로 먹기 전 전체 음식의 칼로리·단백질 추정 초안을 받아볼 수 있어요. 식사 뒤 실제 드신 비율을 확인해 주세요." : state.capabilities ? "현재 사진 AI가 설정되지 않았어요. 아래에서 음식 유형과 드신 양을 직접 선택해 기록할 수 있어요." : "사진 분석 상태를 확인하지 못했어요. 음식 유형을 직접 선택해 기록할 수 있어요.";
    $("#meal-analysis-consent").disabled = !available || Boolean(state.saving);
    $("#meal-analyze").disabled = !ready || !$("#meal-analysis-consent").checked || state.analysisBusy || Boolean(state.saving);
    $("#meal-analyze").textContent = state.analysisBusy ? "사진을 분석하고 있어요…" : "사진 분석하기";
    $("#meal-submit").disabled = state.photoLoading || state.analysisBusy || Boolean(state.saving) || Boolean(state.analysis && !$("#meal-analysis-confirm")?.checked);
    if (state.summary) updateEstimate();
  }

  async function analyzeMeal() {
    if ($("#meal-analyze").disabled || !state.imageData || !$("#meal-analysis-consent").checked || state.saving) return;
    const requestId = ++state.analysisRequestId;
    const patientId = state.patientId;
    const imageData = state.imageData;
    const date = $("#meal-date").value;
    if (state.analysis) $$('#meal-form input[name="foodType"]').forEach(input => { input.checked = false; });
    state.analysis = null;
    state.analysisBusy = true;
    $("#meal-manual-food").hidden = false;
    $("#meal-analysis-review").replaceChildren();
    $("#meal-analysis-review").hidden = true;
    $("#meal-analysis-error").hidden = true;
    refreshAnalysisControls();
    try {
      const result = await api(`/api/patients/${encodeURIComponent(patientId)}/photo-analyses`, { method: "POST", body: JSON.stringify({ kind: "meal", imageData, consentExternalProcessing: true }) });
      if (requestId !== state.analysisRequestId || patientId !== state.patientId || imageData !== state.imageData || date !== $("#meal-date").value || !$("#meal-dialog").open || !$("#meal-analysis-consent").checked) return;
      const analysis = result.analysis;
      if (!analysis || analysis.patientId !== patientId || analysis.kind !== "meal" || !analysis.id || !analysis.proposal) throw new Error("사진 분석 결과를 확인하지 못했어요.");
      state.analysis = analysis;
      const proposal = analysis.proposal;
      const choice = $(`#meal-form [name="foodType"][value="${proposal.foodType}"]`);
      if (choice) choice.checked = true;
      $("#meal-manual-food").hidden = true;
      $("#meal-analysis-review").innerHTML = `<h3>확인이 필요한 사진 초안</h3><p class="analysis-foods">${escape(proposal.foodLabel)}${proposal.foods?.length ? ` · ${proposal.foods.map(food => escape(food.name)).join(" · ")}` : ""}</p><div class="analysis-result-values"><span>제공된 전체 음식 약 <b>${number(proposal.calories)} kcal</b></span><span>단백질 약 <b>${number(proposal.proteinGrams, 1)} g</b></span></div><p class="section-description">먹기 전 제공된 전체 음식의 추정이에요. 식사 뒤 실제로 드신 비율을 아래에서 선택해 주세요.</p>${(analysis.warnings || []).map(warning => `<p class="analysis-warning">${escape(warning)}</p>`).join("")}<p class="analysis-meta">${escape(analysis.provider)} · ${escape(analysis.model)} · 실제 영양량을 확정하는 결과가 아니에요.</p><label class="analysis-consent"><input id="meal-analysis-confirm" type="checkbox"><span>먹기 전 전체 음식 사진이며, 음식 내용·추정치와 식후 실제 드신 비율을 확인했어요.</span></label><button type="button" class="text-button" data-action="manual-meal">직접 선택해서 기록하기</button>`;
      $("#meal-analysis-review").hidden = false;
    } catch (error) {
      if (requestId === state.analysisRequestId && patientId === state.patientId && $("#meal-dialog").open) formError("#meal-analysis-error", `${error.message} 음식 유형을 직접 선택해서 기록할 수 있어요.`);
    } finally {
      if (requestId === state.analysisRequestId) { state.analysisBusy = false; refreshAnalysisControls(); }
    }
  }

  function renderMedicationSummary(schedule) {
    const total = schedule.slots?.length || 0;
    const pending = (schedule.slots || []).filter(slot => slot.status === 'pending').length;
    $('#medication-summary').textContent = total ? `${shortDate(schedule.date)} · 총 ${total}회 중 ${total - pending}회 보고 · ${pending}회 미보고` : '이 날짜에 등록된 약별 일정이 없어요.';
  }

  async function loadMedicationSchedule() {
    if (!state.patientId || !state.summary) return;
    const requestId = ++state.medicationRequestId;
    const patientId = state.patientId;
    medicationBaseline.clear();
    const date = state.medicationDate || today();
    state.medicationDate = date;
    state.medicationSchedule = null;
    medicationPhoto.refresh();
    medicationPhoto.renderReports([]);
    $("#medication-date").value = date;
    $("#medication-date").max = today();
    $("#medication-loading").hidden = false;
    $("#medication-error").hidden = true;
    $("#medication-list").replaceChildren();
    $("#medication-summary").replaceChildren();
    $("#legacy-medication").hidden = true;
    try {
      const [schedule, photos] = await Promise.all([api(`/api/patients/${encodeURIComponent(patientId)}/medication-schedule?date=${encodeURIComponent(date)}`), api(`/api/patients/${encodeURIComponent(patientId)}/medication-photo-reports?date=${encodeURIComponent(date)}`)]);
      if (requestId !== state.medicationRequestId || patientId !== state.patientId || date !== state.medicationDate) return;
      state.medicationSchedule = schedule;
      medicationPhoto.refresh(); medicationPhoto.renderReports(photos.reports);
      renderMedicationSummary(schedule);
      if (date === today()) { state.todayMedication = schedule; renderHome(state.summary.todayRecord); }
      const slotForms = (schedule.slots || []).map((slot, index) => {
        const labels = { pending: "미보고", taken: "복용 보고", missed: "미복용 보고", unknown: "기억나지 않음" };
        return `<form id="medication-slot-${index}" class="medication-slot" data-slot-index="${index}"><div class="medication-slot-header"><div><h2>${escape(slot.time)} · ${escape(slot.name)}</h2><p class="medication-meta">${escape([slot.strength, slot.dose, slot.route].filter(Boolean).join(" · "))}</p></div><span class="medication-status ${escape(slot.status)}">${escape(labels[slot.status] || "미보고")}</span></div>${slot.instructions ? `<p class="inline-notice">${escape(slot.instructions)}</p>` : ""}<fieldset><legend>이 회차의 복약 상태</legend><div class="choice-grid three slot-actions">${[["taken", "먹었어요"], ["missed", "못 먹었어요"], ["unknown", "기억 안 나요"]].map(([value, label]) => `<label class="choice"><input type="radio" name="status" value="${value}" ${slot.status === value ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></fieldset><button type="button" class="button voice-entry" data-dictation="dose">말로 이 회차 복약 상태 입력하기</button><details class="medication-extra" ${slot.reason || slot.note ? "open" : ""}><summary>사유나 이야기도 남기기 (선택)</summary><div class="form-field slot-reason"><label for="slot-reason-${index}">사유 <span class="optional">선택</span></label><input id="slot-reason-${index}" name="reason" type="text" maxlength="500" value="${escape(slot.reason)}" placeholder="예: 잊었어요, 속이 불편했어요"></div><div class="form-field slot-note"><label for="slot-note-${index}">함께 전할 이야기 <span class="optional">선택</span></label><textarea id="slot-note-${index}" name="note" maxlength="2000" rows="2">${escape(slot.note)}</textarea></div></details><p class="form-error" data-slot-error role="alert" hidden></p><button class="button button-primary" type="submit">${slot.revision ? "이 회차 기록 수정하기" : "이 회차 기록 저장하기"}</button>${slot.revision ? `<p class="record-source">보고 ${slot.revision}차 · 수정 전 기록도 보관돼요.</p>` : ""}</form>`;
      });
      const times = [...new Set((schedule.slots || []).map(slot => slot.time))].sort();
      $('#medication-list').innerHTML = times.map(time => `<section class="medication-time-group"><h2>${escape(time)} 복약</h2>${(schedule.slots || []).flatMap((slot, index) => slot.time === time ? [slotForms[index]] : []).join('')}</section>`).join('');
      if (!(schedule.orders || []).length) {
        const result = await api(`/api/patients/${encodeURIComponent(patientId)}/daily?date=${encodeURIComponent(date)}`);
        if (requestId !== state.medicationRequestId || patientId !== state.patientId || date !== state.medicationDate) return;
        state.legacyDailyRevision = result.record?.revision ?? 0;
        state.legacySubmissionKey = null; state.legacySubmissionPayload = null;
        $("#legacy-medication-form").reset();
        $$("#legacy-medication-form [name=medicationStatus]").forEach(input => { input.checked = input.value === result.record?.medicationStatus; });
        $("#legacy-medication-error").hidden = true;
        $("#legacy-medication").hidden = false;
      }
      $$('#medication-list form, #legacy-medication-form').forEach(form => medicationBaseline.set(form.id, formSnapshot(form)));
      if (state.view === 'medication' && medicationGuidancePending) { medicationGuidancePending = false; assist?.notify('medication_open', { contextId: guidanceContextId, recordDate: date }); }
    } catch (error) {
      if (requestId === state.medicationRequestId && patientId === state.patientId) formError("#medication-error", `${error.message} 목록을 확인하지 못해 복약 상태를 저장할 수 없어요.`);
    } finally {
      if (requestId === state.medicationRequestId) $("#medication-loading").hidden = true;
    }
  }

  function medicationDateMatches() {
    const field = $('#medication-date');
    if (field.value === state.medicationDate && field.checkValidity()) return true;
    field.value = state.medicationDate || today();
    formError('#medication-error', '날짜를 확인하지 못했어요. 표시된 목록의 날짜로 돌렸어요. 날짜와 약을 확인한 뒤 다시 눌러 주세요.');
    return false;
  }

  async function saveMedication(event) {
    event.preventDefault();
    if (state.saving || !state.medicationSchedule) return;
    if (!medicationDateMatches()) return;
    const form = event.target;
    const data = new FormData(form);
    const legacy = form.id === "legacy-medication-form";
    const status = data.get(legacy ? "medicationStatus" : "status");
    const errorElement = legacy ? $("#legacy-medication-error") : $("[data-slot-error]", form);
    if (!status) { errorElement.textContent = "복약 상태를 선택해 주세요. 미보고를 자동으로 미복용 처리하지 않아요."; errorElement.hidden = false; return; }
    const patientId = state.patientId;
    const date = state.medicationDate;
    const slot = legacy ? null : state.medicationSchedule.slots[Number(form.dataset.slotIndex)];
    if (!legacy && !slot) return;
    const payload = legacy ? { date, medicationStatus: status, expectedRevision: state.legacyDailyRevision } : { orderId: slot.orderId, date, time: slot.time, status, reason: String(data.get("reason") || "").trim(), note: String(data.get("note") || "").trim() };
    if (legacy) {
      const signature = JSON.stringify(payload);
      if (signature !== state.legacySubmissionPayload) { state.legacySubmissionPayload = signature; state.legacySubmissionKey = crypto.randomUUID(); }
      payload.clientSubmissionId = state.legacySubmissionKey;
    }
    state.saving = "medication";
    renderNavigation();
    errorElement.hidden = true;
    $$("#view-medication input, #view-medication textarea, #view-medication button").forEach(input => { input.disabled = true; });
    $("#patient-select").disabled = true;
    try {
      const saved = await api(`/api/patients/${encodeURIComponent(patientId)}/${legacy ? "daily" : "medication-events"}`, { method: "POST", body: JSON.stringify(payload) });
      if (legacy) state.legacyDailyRevision = saved.record?.revision ?? state.legacyDailyRevision;
      if (!legacy) {
        Object.assign(slot, { eventId: saved.event.id, status: saved.event.status, reason: saved.event.reason,
          note: saved.event.note, revision: saved.event.revision, reportedAt: saved.event.reportedAt });
        const badge = $('.medication-status', form);
        badge.className = `medication-status ${slot.status}`;
        badge.textContent = ({ taken: '복용 보고', missed: '미복용 보고', unknown: '기억나지 않음' })[slot.status];
        $('[name=reason]', form).value = slot.reason;
        $('[name=note]', form).value = slot.note;
        $('button[type=submit]', form).textContent = '이 회차 기록 수정하기';
        let revision = $('.record-source', form);
        if (!revision) { revision = document.createElement('p'); revision.className = 'record-source'; form.append(revision); }
        revision.textContent = `보고 ${slot.revision}차 · 수정 전 기록도 보관돼요.`;
        renderMedicationSummary(state.medicationSchedule);
      }
      medicationBaseline.set(form.id, formSnapshot(form));
      savedFeedback(legacy ? "하루 복약 자기보고" : `${slot.time} ${slot.name} 복약`, date, "복용 상태를 저장했어요. 약별 목록에서 다시 확인할 수 있어요.");
      try { await loadPatient(patientId, { preserveMedicationInputs: true }); } catch { savedRefreshFailed(); }
    } catch (error) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    } finally {
      state.saving = null;
      $$("#view-medication input, #view-medication textarea, #view-medication button").forEach(input => { input.disabled = false; });
      renderNavigation();
    }
  }

  async function loadConnections() {
    if (!state.patientId || !state.summary) return;
    const requestId = ++state.connectionRequestId;
    const patientId = state.patientId;
    $("#connections-loading").hidden = false;
    $("#connections-error").hidden = true;
    $("#connection-list").replaceChildren();
    try {
      const result = await api(`/api/patients/${encodeURIComponent(patientId)}/health-connections`);
      if (requestId !== state.connectionRequestId || patientId !== state.patientId || state.view !== "connections") return;
      state.connections = result;
      $("#connection-list").innerHTML = result.connections?.length ? result.connections.map(connection => `<section class="connection-card"><div class="medication-slot-header"><h2>${escape(connection.label || (connection.platform === "health-connect" ? "Android · Health Connect" : "iPhone · Apple 건강"))}</h2><span class="connection-status ${escape(connection.status)}">${connection.status === "revoked" ? "폐기됨" : connection.status === "connected" ? "기록 수신됨" : "연결 프로그램 대기"}</span></div><p class="section-description">${connection.selected ? "현재 선택한 자료 출처" : "현재 요약의 자료 출처가 아니에요."}</p><p class="record-source">${connection.lastReceivedAt ? `마지막 수신: ${escape(new Date(connection.lastReceivedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }))}` : "아직 받은 건강 기록이 없어요."}</p><p class="section-description">실제 휴대폰·워치의 자동 수집은 검증 전이에요.</p>${connection.status !== "revoked" ? `<button type="button" class="button button-secondary" data-action="revoke-connection" data-connection-id="${escape(connection.id)}">이 연결 폐기하기</button>` : ""}</section>`).join("") : '<div class="empty-state-card"><h2>연결된 건강 기록이 없어요</h2><p>걸음 수와 수면은 직접 입력할 수 있어요. 연결 프로그램이 준비되고 기록을 받으면 여기에 출처와 마지막 수신을 표시해요.</p></div>';
    } catch (error) {
      if (requestId === state.connectionRequestId && patientId === state.patientId && state.view === "connections") formError("#connections-error", error.message);
    } finally {
      if (requestId === state.connectionRequestId) $("#connections-loading").hidden = true;
    }
  }

  function renderConnectionRecovery() {
    const unknown = connectionIssuanceState === 'unknown';
    $('#connection-create').disabled = state.connectionBusy || connectionIssuanceState === 'codeUnavailable';
    $('#connection-create').textContent = unknown ? '연결 코드 발급 결과 확인하기' : '테스트 연결 코드 만들기';
    $('#connection-platform').disabled = state.connectionBusy || unknown;
    $('#connection-label').disabled = state.connectionBusy || unknown;
    $('#connection-reissue').hidden = !connectionRecoveryId || connectionIssuanceState !== 'codeUnavailable';
    $('#connection-reissue').disabled = state.connectionBusy;
    const status = $('#connection-issuance-status');
    status.hidden = !['unknown', 'codeUnavailable'].includes(connectionIssuanceState);
    status.textContent = unknown ? '발급 결과를 아직 확인하지 못했어요. 발급 결과 확인하기를 누르면 같은 연결을 중복 없이 확인해요.' : '이미 만들어진 연결이지만 비밀 코드를 다시 보여드릴 수 없어요. 아래 버튼을 누르면 해당 코드만 폐기하고 새 코드를 만들어요.';
  }

  async function createConnection(event, replacesConnectionId = null) {
    event?.preventDefault();
    if (state.connectionBusy || state.loading || !state.patientId) return;
    clearConnectionToken();
    const patientId = state.patientId;
    const requestId = state.connectionRequestId;
    let payload;
    if (connectionIssuanceState === 'unknown') payload = JSON.parse(connectionCreatePayload);
    else {
      const fields = new FormData($('#connection-form'));
      payload = { platform: fields.get('platform') };
      if (String(fields.get('label') || '').trim()) payload.label = String(fields.get('label')).trim();
      if (replacesConnectionId) payload.replacesConnectionId = replacesConnectionId;
      const signature = JSON.stringify(payload);
      if (signature !== connectionCreatePayload) { connectionCreatePayload = signature; connectionCreateRequestId = crypto.randomUUID(); }
    }
    payload.clientRequestId = connectionCreateRequestId;
    state.connectionBusy = true;
    renderConnectionRecovery(); renderNavigation();
    $("#connections-error").hidden = true;
    try {
      const result = await api(`/api/patients/${encodeURIComponent(patientId)}/health-connections`, { method: "POST", body: JSON.stringify(payload) });
      if (patientId !== state.patientId || state.view !== "connections" || requestId !== state.connectionRequestId) return;
      const patient = state.summary?.patient;
      if (result.connection?.patientId !== patientId || patient?.id !== patientId || (!result.token && !result.codeUnavailable)) {
        const issue = new Error('환자와 연결 정보를 확인하지 못했어요. 발급 결과를 다시 확인해 주세요.'); issue.outcomeUnknown = true; throw issue;
      }
      connectionIssuanceState = result.token ? 'issued' : 'codeUnavailable';
      connectionIssuedId = result.connection.id;
      connectionRecoveryId = result.codeUnavailable && result.connection.status !== 'revoked' ? result.connection.id : null;
      if (result.connection.status === 'revoked') {
        connectionIssuanceState = 'idle'; connectionCreateRequestId = null; connectionCreatePayload = null;
        formError('#connections-error', '이전 연결은 이미 폐기됐어요. 새 연결 코드를 만들 수 있어요.');
      }
      if (result.token) {
        $('#connection-server-origin').textContent = location.origin;
        $('#connection-patient-name').textContent = patient.name;
        $('#connection-patient-id').textContent = patientId;
        $('#connection-token-value').textContent = result.token;
        $('#connection-token').hidden = false;
      }
      await loadConnections();
      if (result.token) toast('테스트 연결을 준비했어요. 자동 수집이 시작된 것은 아니에요.');
    } catch (error) {
      if (patientId === state.patientId && state.view === 'connections') {
        connectionIssuanceState = error.outcomeUnknown ? 'unknown' : 'idle';
        if (!error.outcomeUnknown) { connectionCreateRequestId = null; connectionCreatePayload = null; connectionRecoveryId = null; }
        formError('#connections-error', error.message);
      }
    } finally { state.connectionBusy = false; renderConnectionRecovery(); renderNavigation(); }
  }

  async function revokeConnection(connectionId) {
    if (state.connectionBusy || !state.patientId || !state.connections?.connections?.some(connection => connection.id === connectionId)) return;
    if (!window.confirm("이 연결을 폐기할까요? 새 기록 수신은 중단되고 이전 기록은 남아요.")) return;
    const patientId = state.patientId;
    state.connectionBusy = true;
    renderConnectionRecovery(); renderNavigation();
    clearConnectionToken();
    try {
      await api(`/api/patients/${encodeURIComponent(patientId)}/health-connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      if (connectionId === connectionIssuedId) {
        connectionCreateRequestId = null; connectionCreatePayload = null; connectionRecoveryId = null; connectionIssuedId = null; connectionIssuanceState = 'idle';
      }
      if (patientId === state.patientId && state.view === "connections") { await loadConnections(); toast("연결을 폐기했어요. 이전 기록은 보관돼요."); }
    } catch (error) {
      if (patientId === state.patientId && state.view === "connections") formError("#connections-error", error.message);
    } finally { state.connectionBusy = false; renderConnectionRecovery(); renderNavigation(); }
  }

  function bindEvents() {
    $('#patient-home-link').addEventListener('click', event => { event.preventDefault(); switchView('home', { historyMode: 'replace' }); });
    $('#patient-view-close').addEventListener('click', () => switchView(PATIENT_SCREENS[state.view].closeTarget, { historyMode: 'replace' }));
    $("#patient-select").addEventListener("change", event => {
      if (!canLeavePatient()) { event.target.value = state.patientId; return; }
      loadPatient(event.target.value, { historyMode: "push" }).catch(() => {});
    });
    $("#retry-button").addEventListener("click", () => {
      if (bootstrapInFlight || state.loading) return;
      if (!sessionReady) bootstrapApplication();
      else if (pendingPatientId || state.patientId) loadPatient(pendingPatientId || state.patientId, { initial: !state.summary }).catch(() => {});
      else initialize();
    });
    $("#open-meal").addEventListener("click", openMeal);
    $('#open-medication-photo').addEventListener('click', async () => {
      if (!medicationDateMatches()) return;
      const dirty = medicationDirty();
      if (!canLeavePatient()) return;
      if (dirty) await loadMedicationSchedule();
      medicationPhoto.open();
      if ($('#medication-photo-dialog').open) assist?.notify('medication_photo_open', { contextId: guidanceContextId, recordDate: state.medicationDate });
    });
    $("#open-medication").addEventListener("click", () => switchView("medication"));
    $("#open-daily").addEventListener("click", () => openDaily("all"));
    document.addEventListener("click", event => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) switchView(viewButton.dataset.view, { section: viewButton.dataset.section || null });
      const action = event.target.closest("[data-action]");
      if (action?.dataset.action === "meal") openMeal();
      if (action?.dataset.action === "steps") openDaily("steps");
      if (action?.dataset.action === "sleep") openDaily("sleep");
      if (action?.dataset.action === "medication") switchView("medication");
      if (action?.dataset.action === "nutrition") switchView("records", { metric: "proteinGrams", section: "meals" });
      if (action?.dataset.action === "edit-daily") openDaily("all", action.dataset.date);
      if (action?.dataset.action === "manual-meal") { invalidateAnalysis(); updateEstimate(); }
      if (action?.dataset.action === "refresh-medication" && canLeavePatient()) loadMedicationSchedule();
      if (action?.dataset.action === "revoke-connection") revokeConnection(action.dataset.connectionId);
    });
    $$(".chart-tab").forEach(button => button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      state.section = "chart";
      $$(".chart-tab").forEach(tab => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
      renderChart();
      syncUrl();
    }));
    $$(".close-dialog").forEach(button => button.addEventListener("click", () => closeRecordDialog(button.closest("dialog"))));
    $$("dialog").forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (state.saving || event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRecordDialog(dialog);
      });
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeRecordDialog(dialog); });
      dialog.addEventListener("close", () => {
        dialogBaseline.delete(dialog.id); assist?.stop(); valueConfirmation?.reset(); guidanceContextId = crypto.randomUUID();
        if (dialog.id === "daily-dialog") { ++state.dateRequestId; recordLoadState = 'idle'; }
        if (pendingSave && dialog.id === `${pendingSave.kind}-dialog`) { pendingSave = null; operationState = 'idle'; }
        if (dialog.id === "meal-dialog") clearPhoto();
        dictation?.reset();
        if (dialog.id === "medication-photo-dialog") medicationPhoto.reset();
        const opener = dialogOpeners.get(dialog.id);
        dialogOpeners.delete(dialog.id);
        if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
      });
    });
    $("#meal-form").addEventListener("submit", saveMeal);
    $("#daily-form").addEventListener("submit", saveDaily);
    $("#daily-date").addEventListener("change", selectDailyDate);
    $('#daily-reload-record').addEventListener('click', async () => {
      if (state.saving || pendingSave || !$('#daily-dialog').open) return;
      if (dialogDirty($('#daily-dialog')) && !window.confirm('작성 중인 내용을 저장된 최신 기록으로 바꿀까요? 바꾸기 전 필요한 내용은 확인해 주세요.')) return;
      $('#daily-reload-record').disabled = true;
      try { await selectDailyDate(); } finally { $('#daily-reload-record').disabled = false; }
    });
    $("#meal-form").addEventListener("change", event => {
      if (event.target.id === "meal-date") invalidateAnalysis();
      if (event.target.name === "portion" && state.analysis) $("#meal-analysis-confirm").checked = false;
      updateEstimate();
      refreshAnalysisControls();
    });
    $("#meal-analysis-consent").addEventListener("change", () => { if (!$("#meal-analysis-consent").checked) invalidateAnalysis(); refreshAnalysisControls(); });
    $("#meal-analyze").addEventListener("click", analyzeMeal);
    $("#remove-photo").addEventListener("click", clearPhoto);
    $("#medication-date").addEventListener("change", () => {
      const date = $("#medication-date").value;
      if (state.saving) { $("#medication-date").value = state.medicationDate; return; }
      if (!date || date > today() || !$("#medication-date").checkValidity()) { $("#medication-date").value = state.medicationDate; formError("#medication-error", "오늘 또는 이전 날짜를 골라 주세요. 표시된 목록의 날짜로 돌렸어요."); return; }
      if (!canLeavePatient()) { $('#medication-date').value = state.medicationDate; return; }
      state.medicationDate = date;
      syncUrl();
      loadMedicationSchedule();
    });
    $("#medication-list").addEventListener("submit", saveMedication);
    $("#legacy-medication-form").addEventListener("submit", saveMedication);
    $("#connection-form").addEventListener("submit", createConnection);
    $('#connection-reissue').addEventListener('click', () => {
      if (!connectionRecoveryId || state.connectionBusy) return;
      if (!window.confirm('받지 못한 이전 코드를 폐기하고 새 코드로 바꿀까요? 다른 연결과 이전 기록은 유지돼요.')) return;
      createConnection(null, connectionRecoveryId);
    });
    $('#connection-form').addEventListener('input', () => {
      if (!state.connectionBusy && connectionIssuanceState !== 'unknown') { connectionIssuanceState = 'idle'; connectionRecoveryId = null; renderConnectionRecovery(); }
    });
    $("#connection-token-dismiss").addEventListener("click", clearConnectionToken);
    window.addEventListener("pagehide", clearConnectionToken);
    window.addEventListener('beforeunload', event => {
      if (!window.__homecareLeaving && (state.saving || state.connectionBusy || connectionIssuanceState === 'unknown' || $$('dialog[open]').some(dialogDirty) || medicationDirty() || communication.dirty() || dictation?.dirty())) {
        dictation?.pause();
        event.preventDefault();
        event.returnValue = '';
      }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearConnectionToken(); });
    window.addEventListener("popstate", () => {
      if (!canLeavePatient()) { syncUrl('replace'); return; }
      const requestedId = routeFromUrl();
      invalidateAnalysis();
      clearConnectionToken();
      ++state.connectionRequestId;
      ++state.medicationRequestId;
      if (!state.saving) $$("dialog[open]").forEach(dialog => dialog.close());
      if (requestedId && requestedId !== state.patientId && state.patients.some(patient => patient.id === requestedId)) loadPatient(requestedId, { historyMode: "none" }).catch(() => {});
      else { guidanceContextId = crypto.randomUUID(); medicationGuidancePending = state.view === 'medication'; applyView({ historyMode: "none" }); assist?.update({automatic: state.view === 'home'}); }
    });
    async function chooseMealPhoto(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      clearPhoto(); $('#meal-error').hidden = true;
      const request = ++state.photoRequestId;
      state.photoLoading = true; refreshAnalysisControls();
      $('#meal-photo-preparation').textContent = '사진을 준비하고 있어요…';
      try {
        const prepared = await preparePatientImage(file);
        if (request !== state.photoRequestId || !$('#meal-dialog').open) return;
        state.imageData = prepared.imageData;
        $('#photo-preview').src = prepared.imageData; $('#photo-preview').hidden = false;
        $('#photo-placeholder').hidden = true; $('#remove-photo').hidden = false;
        $('#meal-photo-preparation').textContent = prepared.adjusted ? '사진을 기기 안에서 줄였어요. 음식이 잘 보이는지 확인해 주세요.' : '사진을 준비했어요. 음식이 잘 보이는지 확인해 주세요.';
      } catch (issue) { if (request === state.photoRequestId) { $('#meal-photo-preparation').textContent = ''; formError('#meal-error', issue.message); } }
      finally { if (request === state.photoRequestId) { state.photoLoading = false; refreshAnalysisControls(); } }
    }
    $('#meal-photo').addEventListener('change', chooseMealPhoto);
    $('#meal-camera').addEventListener('change', chooseMealPhoto);
    $('#save-confirmation-dismiss').addEventListener('click', () => { $('#save-confirmation').hidden = true; });
    window.addEventListener('online', networkNotice); window.addEventListener('offline', networkNotice);
    if (!navigator.onLine) networkNotice();
    $('#sleep-helper-apply').addEventListener('click', () => {
      const hours = $('#sleep-helper-hours'), minutes = $('#sleep-helper-minutes');
      if (hours.value === '' && minutes.value === '') { formError('#daily-error', '수면 시간 또는 분을 입력해 주세요.'); return; }
      if (!hours.checkValidity() || !minutes.checkValidity() || Number(hours.value) * 60 + Number(minutes.value) > 1440) { formError('#daily-error', '수면 시간은 0~24시간, 분은 0~59분으로 입력해 주세요.'); return; }
      $('#daily-sleep').value = String(Math.round((Number(hours.value) + Number(minutes.value) / 60) * 10) / 10);
      $('#daily-sleep').dispatchEvent(new Event('input', { bubbles: true }));
      valueConfirmation?.check('sleepHours');
      $('#sleep-helper-status').textContent = `${hours.value || 0}시간 ${minutes.value || 0}분을 ${$('#daily-sleep').value}시간으로 넣었어요. 저장 버튼을 눌러 마쳐 주세요.`;
      $('#daily-error').hidden = true;
    });
    $('#practice-start').addEventListener('click', () => { $('#practice-panel').hidden = false; $('#practice-result').textContent = ''; $('#practice-finish').hidden = true; });
    $('#practice-choice').addEventListener('click', () => { $('#practice-result').textContent = '2. 절반을 골랐어요. 실제 기록에서는 내용을 확인하고 저장하기를 누르면 완료돼요. 이 연습은 저장하지 않았어요.'; $('#practice-finish').hidden = false; });
    $('#practice-finish').addEventListener('click', () => { $('#practice-panel').hidden = true; $('#practice-start').focus(); });
    $('#patient-large-text').addEventListener('click', event => {
      const enabled = document.body.classList.toggle('patient-large-text');
      event.currentTarget.setAttribute('aria-pressed', String(enabled)); event.currentTarget.textContent = enabled ? '기본 글자 크기로' : '글자 더 크게';
    });
  }

  async function initialize() {
    state.loading = true; renderNavigation();
    $("#loading-state").hidden = false;
    $("#load-error").hidden = true;
    try {
      const result = await api("/api/patients");
      state.patients = result.patients || [];
      if (!state.patients.length) throw new Error("아직 데모 환자가 없어요. 데모 데이터를 준비한 뒤 다시 불러와 주세요.");
      $("#patient-select").innerHTML = state.patients.map((patient) => `<option value="${escape(patient.id)}">${escape(patient.name)} · ${escape(patient.age)}세</option>`).join("");
      let storedId;
      try { storedId = localStorage.getItem("homecarePatientId"); } catch (_) { /* Storage is optional. */ }
      const requestedId = new URL(location.href).searchParams.get("patientId") || storedId;
      const patientId = state.patients.some((patient) => patient.id === requestedId) ? requestedId : state.patients[0].id;
      state.patientId = patientId;
      await loadPatient(patientId, { initial: true });
    } catch (error) { showError(error.message); }
    finally { state.loading = false; renderNavigation(); }
  }

  function voiceContext(button) {
    const form=button.closest('form'); if(!form || !state.patientId || state.loading || state.saving)return null;
    const kind=button.dataset.dictation;
    if (kind === 'daily' && (recordLoadState !== 'ready' || dailyLoadedDate !== $('#daily-date').value)) return null;
    const date=kind==='daily'?$('#daily-date').value:kind==='meal'?$('#meal-date').value:kind==='dose'||kind==='legacy'?state.medicationDate:today();
    const slot=kind==='dose'?state.medicationSchedule?.slots[Number(form.dataset.slotIndex)]:null;
    const fields=[];
    const add=(key,label,example)=>{
      const controls=[...form.querySelectorAll('[name="'+key+'"]')];
      if(!controls.length||controls.every(el=>el.disabled||el.closest('[hidden]')))return;
      fields.push({key,label,example,apply(value){
        if(['radio','checkbox'].includes(controls[0].type))controls.forEach(el=>{el.checked=el.value===String(value===null?'unknown':value);});
        else controls[0].value=String(value);
        const target=controls.find(el=>el.checked)||controls[0];
        target.dispatchEvent(new Event('input',{bubbles:true})); target.dispatchEvent(new Event('change',{bubbles:true}));target.focus();
        if (kind === 'daily' && ['steps', 'sleepHours'].includes(key)) valueConfirmation?.check(key);
      }});
    };
    if(kind==='daily'){add('steps','걸음 수','삼천 오백 걸음');add('sleepHours','수면 시간','일곱 시간 삼십 분');add('weightKg','몸무게','육십이 점 오 킬로그램');add('medicationStatus','하루 전체 복약 상태','모두 먹었어요');add('note','함께 전할 이야기','오늘은 산책을 했어요');add('date','기록 날짜','오늘 또는 2026년 10월 23일');}
    if(kind==='meal'){if(!state.analysis)add('foodType','식사 종류','밥과 반찬');add('portion','먹은 양','절반 먹었어요');add('date','기록 날짜','오늘');}
    if(kind==='dose')add('status','이 회차 복약 상태','먹었어요 또는 못 먹었어요');
    if(kind==='legacy')add('medicationStatus','하루 전체 복약 상태','모두 먹었어요');
    if(kind==='message'){const textarea=$('#patient-message-body');fields.push({key:'messageBody',label:'의료진에게 남길 말',example:'기록 방법을 알려 주세요',apply(value){textarea.value=value;textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();}});}
    if(!fields.length)return null;
    return {key:JSON.stringify([state.patientId,form.id,date,state.dailyMode,slot?.orderId,slot?.time,state.analysis?.id]),today:today(),date,fields,label:`${state.summary.patient.name}님 · ${date}${slot?' · '+slot.time+' · '+slot.name:''}`};
  }
  async function refreshAssistance(){
    if(state.loading||state.saving||state.view!=='home'||document.hidden||$('dialog[open]')||dictation?.dirty()||communication.dirty())return false;
    const patientId=state.patientId,request=state.requestId;
    const [summary,schedule]=await Promise.all([api(`/api/patients/${encodeURIComponent(patientId)}/summary`),api(`/api/patients/${encodeURIComponent(patientId)}/medication-schedule?date=${encodeURIComponent(fallbackToday())}`).catch(()=>null)]);
    if(patientId!==state.patientId||request!==state.requestId||state.view!=='home'||$('dialog[open]')||state.saving||dictation?.dirty())return false;
    state.summary=summary;state.todayMedication=schedule;checkedAt=Date.now();render();return true;
  }
  assist=createPatientAssist({getContext:()=>({summary:state.summary,schedule:state.todayMedication,patientId:state.patientId,view:state.view,checkedAt,formKey:guidanceFormKey()}),isBusy:automatic=>Boolean(state.loading||state.saving||$('#app-content').hidden||!$('#load-error').hidden||dictation?.recording()||(automatic&&($('dialog[open]')||dictation?.dirty()||medicationDirty()||communication.dirty()))),refresh:refreshAssistance,onAction(action){if(action==='meal')openMeal();if(action==='medication')switchView('medication');if(action==='steps'||action==='sleep')openDaily(action);}});
  dictation=createPatientDictation({getContext:voiceContext,isBusy:()=>Boolean(state.loading||state.saving),beforeListen:()=>assist.stop(),stopSpeak:()=>assist.stop()});
  valueConfirmation=createValueConfirmation({form:$('#daily-form'),getContext:()=>({patientId:state.patientId,contextId:guidanceContextId,recordDate:$('#daily-date').value,ready:recordLoadState==='ready'&&$('#daily-dialog').open&&!state.saving}),getConfiguration:()=>assist.getConfiguration(),matchingRule:(...args)=>assist.matchingValueRule(...args),notify:(...args)=>assist.notify(...args),stop:()=>assist.stop()});

  window.addEventListener('homecare-guidance-config-changed', () => valueConfirmation.reset());
  window.homecareCanLogout=canLeavePatient;
  async function bootstrapApplication() {
    if (bootstrapInFlight) return;
    bootstrapInFlight = true; state.loading = true; renderNavigation();
    $('#retry-button').disabled = true; $('#loading-state').hidden = false; $('#load-error').hidden = true;
    try {
      if (!await bootstrapSession('patient')) return;
      sessionReady = true;
      if(sessionState.mode==='kakao' && sessionState.user?.role==='patient'){$('#patient-select').hidden=true;$('#patient-name').hidden=false;}
      routeFromUrl();
      medicationGuidancePending = state.view === 'medication';
      await initialize();
      loadCapabilities();
    } catch (issue) { sessionReady = false; showError(issue.message); }
    finally { bootstrapInFlight = false; state.loading = false; $('#retry-button').disabled = false; renderNavigation(); }
  }
  bindEvents();
  bootstrapApplication();
})();
