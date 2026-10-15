"use strict";

(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const state = { patients: [], patientId: null, summary: null, view: "home", metric: "steps", imageData: null, loading: false, saving: null, photoLoading: false, requestId: 0, dateRequestId: 0, photoRequestId: 0 };
  const labels = { meal: { breakfast: "아침", lunch: "점심", dinner: "저녁", snack: "간식" }, food: { balanced: "밥과 반찬", porridge: "죽·부드러운 식사", protein: "고기·생선·두부", noodles: "면·빵" }, medication: { taken: "모두 복용", partial: "일부 복용", missed: "미복용", unknown: "확인 전" }, appetite: { good: "좋음", normal: "보통", poor: "적음" }, mood: { good: "좋음", normal: "보통", poor: "가라앉음" } };
  const icons = {
    steps: '<path d="M10 3 7 7l1 5-3 7m3-7 5 2 2 7m-3-12 3 3h5"/><circle cx="14" cy="4" r="2"/>',
    sleep: '<path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10z"/>',
    medication: '<path d="m8 16 8-8m-3-3a5 5 0 0 1 7 7l-8 8a5 5 0 0 1-7-7z"/>',
    nutrition: '<path d="M5 3v7m3-7v7m3-7v7M5 7h6m-3 3v11m10-18c-3 2-3 8 0 9v9m0-18v9"/>',
    meal: '<path d="M4 11h16a8 8 0 0 1-16 0zm8-8v4M7 4l1 3m9-3-1 3"/>',
  };
  const svg = (key) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key] || icons.meal}</svg>`;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const numeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const number = (value, digits = 0) => numeric(value) ? Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits }) : "—";
  const dateObject = (date) => new Date(`${date}T12:00:00+09:00`);
  const shortDate = (date) => date ? dateObject(date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }) : "";
  const weekday = (date) => date ? dateObject(date).toLocaleDateString("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }) : "";
  const fallbackToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const today = () => state.summary?.today || fallbackToday();
  let toastTimer;

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "기록을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("응답이 지연되고 있어요. 연결 상태를 확인하고 다시 시도해 주세요.");
      if (error instanceof TypeError) throw new Error("서버에 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    const element = $("#toast");
    element.textContent = message;
    element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 4000);
  }

  function showError(message) {
    $("#load-error-message").textContent = message;
    $("#load-error").hidden = false;
    $("#loading-state").hidden = true;
  }

  async function loadPatient(patientId, { initial = false } = {}) {
    const requestId = ++state.requestId;
    state.loading = true;
    $("#patient-select").disabled = true;
    $("#load-error").hidden = true;
    if (initial || patientId !== state.patientId) {
      $("#loading-state").hidden = false;
      $("#app-content").hidden = true;
    }
    try {
      const summary = await api(`/api/patients/${encodeURIComponent(patientId)}/summary`);
      if (requestId !== state.requestId) return;
      state.patientId = patientId;
      state.summary = summary;
      $("#patient-select").value = patientId;
      const url = new URL(location.href);
      url.searchParams.set("patientId", patientId);
      history.replaceState({}, "", url);
      try { localStorage.setItem("homecarePatientId", patientId); } catch (_) { /* Storage is optional. */ }
      render();
      $("#loading-state").hidden = true;
      $("#app-content").hidden = false;
    } catch (error) {
      if (requestId === state.requestId) showError(error.message);
      throw error;
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        $("#patient-select").disabled = Boolean(state.saving);
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
    $("#clinician-link").href = clinicianUrl;
    $("#guide-clinician-link").href = clinicianUrl;
    renderHome(record);
    renderRecords();
  }

  function renderHome(record) {
    const meals = currentMeals();
    const tasks = [
      { label: "식사", done: meals.length > 0 },
      { label: "복약", done: Boolean(record && record.medicationStatus && record.medicationStatus !== "unknown") },
      { label: "활동", done: numeric(record?.steps) },
      { label: "수면", done: numeric(record?.sleepHours) },
    ];
    const count = tasks.filter((task) => task.done).length;
    $("#progress-count").innerHTML = `${count}<span> / 4</span>`;
    $("#progress-fill").style.width = `${count * 25}%`;
    $("#progress-heading").textContent = count === 4 ? "오늘의 기록을 모두 채웠어요" : count === 0 ? "차근차근 채워보세요" : "잘하고 있어요, 조금만 더!";
    $("#task-chips").innerHTML = tasks.map((task) => `<span class="task-chip${task.done ? " done" : ""}"><span class="check-dot" aria-hidden="true">${task.done ? "✓" : ""}</span>${task.label}<span class="sr-only">${task.done ? "기록 완료" : "미기록"}</span></span>`).join("");
    const protein = meals.reduce((sum, meal) => sum + (Number(meal.proteinGrams) || 0), 0);
    const cards = [
      { icon: "steps", label: "걸음 수", value: numeric(record?.steps) ? number(record.steps) : null, unit: "걸음", status: numeric(record?.steps) ? "직접 입력한 기록" : "오늘의 활동을 남겨요", target: "daily" },
      { icon: "sleep", label: "수면", value: numeric(record?.sleepHours) ? number(record.sleepHours, 1) : null, unit: "시간", status: numeric(record?.sleepHours) ? "직접 입력한 기록" : "어젯밤 얼마나 주무셨나요?", target: "daily" },
      { icon: "medication", label: "복약", value: record?.medicationStatus ? labels.medication[record.medicationStatus] : null, unit: "", status: record?.medicationStatus ? "오늘의 자기보고" : "오늘의 복약을 남겨요", target: "medication" },
      { icon: "nutrition", label: "단백질", value: meals.length ? number(protein, 1) : null, unit: "g", status: meals.length ? `식사 ${meals.length}회 · 데모 추정` : "식사를 기록하면 보여요", target: "meal" },
    ];
    $("#today-metrics").innerHTML = cards.map((card) => `<button class="health-card" type="button" data-action="${card.target}" aria-label="${escape(card.label)} ${card.value === null ? "미기록" : escape(card.value + " " + card.unit)}. 기록하기"><span class="metric-heading">${svg(card.icon)}${card.label}</span><span class="metric-value${card.value === null ? " empty" : ""}">${card.value === null ? "아직 기록 전" : escape(card.value)}${card.value !== null && card.unit ? `<small>${card.unit}</small>` : ""}</span><span class="metric-status">${escape(card.status)}</span></button>`).join("");
    renderMeals($("#home-meals"), (state.summary.recentMeals || []).slice(0, 2));
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
      const portion = Number(meal.portion) === 1 ? "모두" : `${number(Number(meal.portion) * 100)}%`;
      return `<article class="meal-item">${imageUrl ? `<img class="meal-thumb" src="${escape(imageUrl)}" alt="${escape(labels.meal[meal.mealType] || "식사")} 기록 사진" loading="lazy">` : `<span class="meal-thumb meal-placeholder" aria-hidden="true">${svg("meal")}</span>`}<div class="meal-details"><h3 class="meal-title">${escape(labels.food[meal.foodType] || "식사 기록")}</h3><p class="meal-meta">${escape(shortDate(meal.date))} · ${escape(labels.meal[meal.mealType] || meal.mealType)} · ${escape(portion)}</p></div><p class="meal-nutrition">${number(meal.calories)} <span>kcal</span><small>단백질 ${number(meal.proteinGrams, 1)}g · 추정</small></p></article>`;
    }).join("")}</div>`;
  }

  function renderRecords() {
    renderChart();
    const trends = [...(state.summary.trends || [])].slice(-7).reverse();
    $("#daily-history").innerHTML = trends.length ? trends.map((entry) => {
      const hasDaily = entry.hasDaily || numeric(entry.steps) || numeric(entry.sleepHours) || Boolean(entry.medicationStatus);
      const values = [numeric(entry.steps) ? `${number(entry.steps)}걸음` : "활동 미기록", numeric(entry.sleepHours) ? `수면 ${number(entry.sleepHours, 1)}시간` : "수면 미기록"];
      return `<div class="history-row"><div class="history-date"><strong>${escape(shortDate(entry.date).replace(/\.\s*$/, ""))}</strong><span>${escape(weekday(entry.date))}요일</span></div><p class="history-values">${hasDaily ? values.join("<br>") : "아직 남긴 기록이 없어요"}</p><span class="history-med${!entry.medicationStatus || entry.medicationStatus === "unknown" ? " missing" : ""}">${escape(labels.medication[entry.medicationStatus] || "복약 미기록")}</span></div>`;
    }).join("") : '<p class="history-empty">아직 건강 기록이 없어요.</p>';
    renderMeals($("#all-meals"), state.summary.recentMeals || []);
  }

  function renderChart() {
    const config = {
      steps: { unit: "걸음", label: "걸음 수", digits: 0, note: "기록한 날의 하루 평균 걸음 수예요. 활동은 직접 입력한 값이에요." },
      sleepHours: { unit: "시간", label: "수면 시간", digits: 1, note: "기록한 날의 하루 평균 수면 시간이에요. 수면은 직접 입력한 값이에요." },
      proteinGrams: { unit: "g", label: "단백질", digits: 1, note: "식사를 기록한 날의 하루 평균 추정량이에요. 식사 선택·분량으로 계산한 데모 값이에요." },
    }[state.metric];
    const trends = [...(state.summary.trends || [])].slice(-7);
    const entries = trends.map((entry) => {
      const hasValue = state.metric === "proteinGrams" ? numeric(entry.proteinGrams) && (Number(entry.calories) > 0 || Number(entry.proteinGrams) > 0) : numeric(entry[state.metric]);
      return { ...entry, value: hasValue ? Number(entry[state.metric]) : null };
    });
    const values = entries.filter((entry) => entry.value !== null).map((entry) => entry.value);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    $("#trend-value").textContent = average === null ? "—" : number(average, config.digits);
    $("#trend-unit").textContent = config.unit;
    $("#trend-description").textContent = values.length ? `기록한 ${values.length}일의 하루 평균` : "기록을 남기면 변화가 보여요";
    $("#trend-range").textContent = trends.length ? `${shortDate(trends[0].date)} – ${shortDate(trends[trends.length - 1].date)}` : "";
    $("#chart-note").textContent = `${config.note} 빈 날은 미기록이에요.`;
    const chart = $("#trend-chart");
    const max = Math.max(...values, state.metric === "sleepHours" ? 10 : 1);
    chart.innerHTML = entries.map((entry) => `<span class="chart-column${entry.value === null ? " missing" : ""}" title="${escape(shortDate(entry.date))}: ${entry.value === null ? "미기록" : escape(number(entry.value, config.digits) + config.unit)}"><span class="chart-bar" style="height:${entry.value === null ? 0 : Math.max(3, (entry.value / max) * 100)}%"></span><span class="chart-label">${entry.date === today() ? "오늘" : escape(weekday(entry.date))}</span></span>`).join("");
    chart.setAttribute("aria-label", `${config.label} 최근 7일 추이. ${entries.map((entry) => `${shortDate(entry.date)} ${entry.value === null ? "미기록" : number(entry.value, config.digits) + config.unit}`).join(", ")}`);
  }

  function switchView(view) {
    if (!["home", "records", "guide"].includes(view)) return;
    state.view = view;
    $$(".app-view").forEach((element) => { element.hidden = element.id !== `view-${view}`; });
    $$(".bottom-nav [data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
      if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#main-content").focus({ preventScroll: true });
  }

  function openMeal() {
    if (!state.summary) return;
    $("#meal-form").reset();
    $("#meal-date").value = today();
    $("#meal-date").max = today();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const type = hour < 10 ? "breakfast" : hour < 16 ? "lunch" : "dinner";
    $(`#meal-form input[name="mealType"][value="${type}"]`).checked = true;
    clearPhoto();
    $("#meal-error").hidden = true;
    updateEstimate();
    $("#meal-dialog").showModal();
  }

  function applyDailyRecord(record) {
    for (const name of ["steps", "sleepHours", "weightKg", "note"]) $(`#daily-form [name="${name}"]`).value = record?.[name] ?? "";
    for (const [name, fallback] of [["medicationStatus", "unknown"], ["appetite", "normal"], ["mood", "normal"]]) {
      const input = $(`#daily-form input[name="${name}"][value="${record?.[name] || fallback}"]`);
      if (input) input.checked = true;
    }
  }

  function openDaily(focusMedication = false) {
    if (!state.summary) return;
    ++state.dateRequestId;
    $("#daily-form").reset();
    setDailyFieldsDisabled(false);
    $("#daily-submit").textContent = "건강 기록 저장하기";
    $("#daily-date").value = today();
    $("#daily-date").max = today();
    applyDailyRecord(state.summary.todayRecord);
    $("#daily-error").hidden = true;
    $("#daily-dialog").showModal();
    if (focusMedication) {
      const selected = $('#medication-fieldset input:checked');
      selected.focus();
      $("#medication-fieldset").scrollIntoView({ block: "nearest" });
    }
  }

  function clearPhoto() {
    ++state.photoRequestId;
    state.photoLoading = false;
    state.imageData = null;
    $("#meal-photo").value = "";
    $("#photo-preview").hidden = true;
    $("#photo-preview").removeAttribute("src");
    $("#photo-placeholder").hidden = false;
    $("#remove-photo").hidden = true;
    if (state.saving !== "meal") $("#meal-submit").disabled = false;
  }

  function updateEstimate() {
    const data = new FormData($("#meal-form"));
    const portion = Number(data.get("portion"));
    const portionLabel = portion === 1 ? "모두" : portion === .5 ? "절반" : `${portion * 100}%`;
    $("#estimate-selection").textContent = `${labels.food[data.get("foodType")]} · ${portionLabel}`;
  }

  function formError(id, message) {
    const element = $(id);
    element.textContent = message;
    element.hidden = false;
    element.scrollIntoView({ block: "nearest" });
  }

  function setFormBusy(formId, busy) {
    $$('input, textarea, button', $(formId)).forEach((element) => { element.disabled = busy; });
    $("#patient-select").disabled = busy || state.loading;
  }

  function setDailyFieldsDisabled(disabled) {
    $$('#daily-form input:not([name="date"]), #daily-form textarea, #daily-submit').forEach((element) => { element.disabled = disabled; });
  }

  async function saveMeal(event) {
    event.preventDefault();
    const button = $("#meal-submit");
    if (button.disabled || state.saving || state.photoLoading) return;
    const data = new FormData(event.currentTarget);
    const patientId = state.patientId;
    const payload = { date: data.get("date"), mealType: data.get("mealType"), foodType: data.get("foodType"), portion: Number(data.get("portion")) };
    if (state.imageData) payload.imageData = state.imageData;
    state.saving = "meal";
    setFormBusy("#meal-form", true);
    button.textContent = "저장하고 있어요…";
    $("#meal-error").hidden = true;
    try {
      await api(`/api/patients/${encodeURIComponent(patientId)}/meals`, { method: "POST", body: JSON.stringify(payload) });
      $("#meal-dialog").close();
      toast("식사 기록을 저장했어요.");
      await loadPatient(patientId);
    } catch (error) {
      if ($("#meal-dialog").open) formError("#meal-error", error.message);
      else toast("저장은 완료됐지만 화면을 갱신하지 못했어요. 다시 불러와 주세요.");
    } finally {
      state.saving = null;
      setFormBusy("#meal-form", false);
      button.textContent = "식사 기록 저장하기";
    }
  }

  async function saveDaily(event) {
    event.preventDefault();
    const button = $("#daily-submit");
    if (button.disabled || state.saving) return;
    const data = new FormData(event.currentTarget);
    const patientId = state.patientId;
    const payload = { date: data.get("date"), medicationStatus: data.get("medicationStatus"), appetite: data.get("appetite"), mood: data.get("mood"), note: data.get("note").trim() };
    for (const name of ["steps", "sleepHours", "weightKg"]) {
      const value = data.get(name).trim();
      payload[name] = value === "" ? null : Number(value);
    }
    state.saving = "daily";
    setFormBusy("#daily-form", true);
    button.textContent = "저장하고 있어요…";
    $("#daily-error").hidden = true;
    try {
      await api(`/api/patients/${encodeURIComponent(patientId)}/daily`, { method: "POST", body: JSON.stringify(payload) });
      $("#daily-dialog").close();
      toast("건강 기록을 저장했어요.");
      await loadPatient(patientId);
    } catch (error) {
      if ($("#daily-dialog").open) formError("#daily-error", error.message);
      else toast("저장은 완료됐지만 화면을 갱신하지 못했어요. 다시 불러와 주세요.");
    } finally {
      state.saving = null;
      setFormBusy("#daily-form", false);
      button.textContent = "건강 기록 저장하기";
    }
  }

  async function selectDailyDate() {
    const date = $("#daily-date").value;
    if (!date || date > today()) return;
    const requestId = ++state.dateRequestId;
    const patientId = state.patientId;
    $("#daily-error").hidden = true;
    setDailyFieldsDisabled(true);
    $("#daily-submit").textContent = "기존 기록을 불러오고 있어요…";
    try {
      const result = await api(`/api/patients/${encodeURIComponent(patientId)}/daily?date=${encodeURIComponent(date)}`);
      if (requestId !== state.dateRequestId || patientId !== state.patientId || !$("#daily-dialog").open) return;
      applyDailyRecord(result.record);
      setDailyFieldsDisabled(false);
      $("#daily-submit").textContent = "건강 기록 저장하기";
    } catch (error) {
      if (requestId !== state.dateRequestId || patientId !== state.patientId || !$("#daily-dialog").open) return;
      formError("#daily-error", `${error.message} 날짜를 다시 선택해 주세요.`);
      $("#daily-submit").textContent = "기존 기록을 불러오지 못했어요";
    }
  }

  function bindEvents() {
    $("#patient-select").addEventListener("change", (event) => { if (!state.saving) loadPatient(event.target.value).catch(() => {}); });
    $("#retry-button").addEventListener("click", () => { if (state.patientId) loadPatient(state.patientId, { initial: !state.summary }).catch(() => {}); else initialize(); });
    $("#open-meal").addEventListener("click", openMeal);
    $("#open-medication").addEventListener("click", () => openDaily(true));
    $("#open-daily").addEventListener("click", () => openDaily());
    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) switchView(viewButton.dataset.view);
      const action = event.target.closest("[data-action]");
      if (action?.dataset.action === "meal") openMeal();
      if (action?.dataset.action === "daily") openDaily();
      if (action?.dataset.action === "medication") openDaily(true);
    });
    $$(".chart-tab").forEach((button) => button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      $$(".chart-tab").forEach((tab) => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active)); });
      renderChart();
    }));
    $$(".close-dialog").forEach((button) => button.addEventListener("click", () => { if (!state.saving) button.closest("dialog").close(); }));
    $$("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (state.saving) return;
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
      });
      dialog.addEventListener("cancel", (event) => { if (state.saving) event.preventDefault(); });
      dialog.addEventListener("close", () => { if (dialog.id === "daily-dialog") ++state.dateRequestId; });
    });
    $("#meal-form").addEventListener("submit", saveMeal);
    $("#daily-form").addEventListener("submit", saveDaily);
    $("#daily-date").addEventListener("change", selectDailyDate);
    $("#meal-form").addEventListener("change", updateEstimate);
    $("#remove-photo").addEventListener("click", clearPhoto);
    $("#meal-photo").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      $("#meal-error").hidden = true;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        clearPhoto(); formError("#meal-error", "JPG, PNG, WebP 사진을 선택해 주세요."); return;
      }
      if (file.size > 5 * 1024 * 1024) {
        clearPhoto(); formError("#meal-error", "사진은 최대 5MB까지 저장할 수 있어요. 더 작은 사진을 선택해 주세요."); return;
      }
      const reader = new FileReader();
      const photoRequestId = ++state.photoRequestId;
      state.photoLoading = true;
      $("#meal-submit").disabled = true;
      reader.onload = () => {
        if (photoRequestId !== state.photoRequestId) return;
        state.imageData = reader.result;
        $("#photo-preview").src = state.imageData;
        $("#photo-preview").hidden = false;
        $("#photo-placeholder").hidden = true;
        $("#remove-photo").hidden = false;
      };
      reader.onerror = () => { if (photoRequestId !== state.photoRequestId) return; clearPhoto(); formError("#meal-error", "사진을 읽지 못했어요. 다른 사진을 선택해 주세요."); };
      reader.onloadend = () => { if (photoRequestId !== state.photoRequestId) return; state.photoLoading = false; if (state.saving !== "meal") $("#meal-submit").disabled = false; };
      reader.readAsDataURL(file);
    });
  }

  async function initialize() {
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
  }

  bindEvents();
  initialize();
})();
