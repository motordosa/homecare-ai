const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const displayTime = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '확인 시각 없음';
const statuses = { saved: '보관', included: '검토 대상으로 포함', excluded: '검토 대상에서 제외', reviewed: '사람이 검토 완료' };
const emptyDraft = () => ({ status: 'saved', note: '', evidenceText: '', locator: '', reviewBasis: 'metadata' });
function sourceLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['europepmc.org', 'pubmed.ncbi.nlm.nih.gov', 'doi.org'].includes(parsed.hostname)) return '';
    return `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} (새 창)</a>`;
  } catch { return ''; }
}

export function createEvidenceWorkspace({ api, getState, toast }) {
  const root = document.querySelector('#app-content');
  const $ = selector => root.querySelector(selector);
  let active = false, generation = 0, pending = '', searchAbort = null;
  let library = { searches: [], bookmarks: [], permissions: { canReview: false }, limits: { searches: 20, bookmarks: 100 } };
  let searchResult = null, editor = null, draft = emptyDraft(), baseline = JSON.stringify(emptyDraft());
  let queryDraft = { query: '', yearFrom: '', yearTo: '' }, queryBaseline = JSON.stringify(queryDraft);
  let libraryGeneration = 0;

  function setError(error) {
    const target = $('#evidence-error');
    if (target) { target.textContent = error?.message || String(error); target.hidden = false; }
  }
  function clearError() { if ($('#evidence-error')) $('#evidence-error').hidden = true; }
  function setStatus(message) { if ($('#evidence-status')) $('#evidence-status').textContent = message; }
  function dirty() { return active && (JSON.stringify(draft) !== baseline || JSON.stringify(queryDraft) !== queryBaseline); }
  function canLeave() {
    if (!active) return true;
    if (pending) { toast('진행 중인 작업이 끝난 뒤 이동해 주세요. 검색은 취소할 수 있습니다.', true); return false; }
    if (dirty() && !confirm('작성한 검색·검토 내용을 저장하지 않고 이동할까요?')) return false;
    draft = editor ? { status: editor.status, note: editor.note, evidenceText: editor.evidenceText, locator: editor.locator, reviewBasis: editor.reviewBasis } : emptyDraft();
    baseline = JSON.stringify(draft); queryBaseline = JSON.stringify(queryDraft);
    return true;
  }
  function updateControls() {
    if (!active) return;
    for (const control of root.querySelectorAll('.evidence-workspace input,.evidence-workspace textarea,.evidence-workspace select,.evidence-workspace button')) {
      control.disabled = Boolean(pending);
    }
    const cancel = $('#evidence-cancel-search');
    if (cancel) { cancel.hidden = pending !== 'search'; cancel.disabled = pending !== 'search'; }
    const status = $('#evidence-review-status');
    if (status) for (const option of status.options) if (option.value === 'reviewed') option.disabled = !library.permissions.canReview;
    const save = $('#evidence-review-save');
    if (save && editor?.status === 'reviewed' && !library.permissions.canReview) save.disabled = true;
  }
  function articleDetails(article) {
    return `<p>${escapeHtml(article.authors || '저자 정보 없음')} · ${escapeHtml(article.year ?? '연도 미상')} · ${escapeHtml(article.journal || '학술지 정보 없음')}</p>
      <p>PMID ${escapeHtml(article.pmid || '없음')} · DOI ${escapeHtml(article.doi || '없음')}<br>연구유형: ${escapeHtml(article.publicationTypes?.join(', ') || '제공 정보 없음')} (공급자 메타데이터)</p>
      <p>${article.retractionStatus === 'retracted' ? '<strong>제공자에 철회 표시가 있습니다.</strong>' : '철회·정정 여부는 확인되지 않았습니다.'} 확인: ${escapeHtml(displayTime(article.checkedAt))}</p>
      <p class="evidence-links">${[sourceLink(article.sourceUrl, 'Europe PMC에서 확인'), sourceLink(article.pubmedUrl, 'PubMed'), sourceLink(article.doiUrl, 'DOI 원문 연결')].filter(Boolean).join(' · ')}</p>
      ${article.abstractText ? `<details><summary>초록 보기${article.abstractTruncated ? ' (길이 제한으로 일부)' : ''}</summary><p class="evidence-abstract">${escapeHtml(article.abstractText)}</p></details>` : '<p>서지정보만 확보했습니다. 초록·전문을 읽은 것으로 표시하지 않습니다.</p>'}`;
  }
  function renderResults() {
    const target = $('#evidence-results'); if (!target) return;
    if (!searchResult) { target.innerHTML = '<p class="compact-empty">검색하면 문헌과 출처가 여기에 표시됩니다. 선택 환자의 자료는 검색어에 자동 전송하지 않습니다.</p>'; return; }
    const count = Number.isFinite(searchResult.totalCount) ? searchResult.totalCount.toLocaleString('ko-KR') : '확인 불가';
    target.innerHTML = `<h3>검색 결과</h3><p>제공자 전체 ${escapeHtml(count)}건 · 이번 페이지 ${searchResult.results.length}건 (중복 제거)<br>${escapeHtml(searchResult.provider)} · ${escapeHtml(displayTime(searchResult.searchedAt))}${searchResult.cached ? ' · 10분 이내 저장 결과 재사용' : searchResult.savedSnapshot ? ' · 저장 당시 결과' : ''}</p>
      <details><summary>실제 검색식과 조건 보기</summary><p>${escapeHtml(searchResult.executedQuery)}</p><p>시작 연도 ${escapeHtml(searchResult.parameters?.yearFrom ?? '제한 없음')} / 종료 연도 ${escapeHtml(searchResult.parameters?.yearTo ?? '제한 없음')}</p></details>
      ${searchResult.results.length ? searchResult.results.map((article, index) => `<article class="evidence-result"><h4>${escapeHtml(article.title)}</h4>${articleDetails(article)}<button class="button button-secondary" data-evidence="bookmark" data-index="${index}">이 문헌 보관</button></article>`).join('') : '<p class="compact-empty">검색은 완료됐지만 해당 결과가 없습니다. 검색어·연도를 바꾸어 보세요.</p>'}
      ${searchResult.nextCursor ? '<button class="button button-secondary" data-evidence="next">다음 검색 결과</button>' : ''}`;
    updateControls();
  }
  function renderLibrary() {
    const target = $('#evidence-library'); if (!target) return;
    target.innerHTML = `<h3>저장한 검색</h3><p>최근 ${library.limits.searches}건의 성공 검색을 표시합니다. 선택하면 그때의 결과를 불러옵니다.</p>
      ${library.searches.length ? library.searches.map(search => `<button class="notice-list-item" data-evidence="restore-search" data-id="${escapeHtml(search.id)}"><strong>${escapeHtml(search.query)}</strong><small>${escapeHtml(displayTime(search.searchedAt))} · ${escapeHtml(search.totalCount)}건</small></button>`).join('') : '<p class="compact-empty">저장한 검색이 없습니다.</p>'}
      <h3>보관 문헌과 근거 검토</h3><p>최근 수정 ${library.limits.bookmarks}건을 표시합니다. 검토 완료는 사람이 남긴 검토 기록이며 치료 권고의 자동 승인이 아닙니다.</p>
      ${library.bookmarks.length ? library.bookmarks.map(bookmark => `<article class="evidence-bookmark"><h4>${escapeHtml(bookmark.article.title)}</h4><p>${escapeHtml(statuses[bookmark.status])} · v${bookmark.version} · ${escapeHtml(displayTime(bookmark.updatedAt))}</p><p>${escapeHtml(bookmark.note || '아직 검토 메모가 없습니다.')}</p><button class="button button-secondary" data-evidence="edit-bookmark" data-id="${escapeHtml(bookmark.id)}">근거·검토 열기</button></article>`).join('') : '<p class="compact-empty">검색 결과에서 문헌을 보관해 주세요.</p>'}`;
    updateControls();
  }
  async function loadLibrary() {
    const request = generation, loading = ++libraryGeneration;
    try {
      const response = await api('/api/clinician/evidence');
      if (!active || request !== generation || loading !== libraryGeneration) return;
      library = response; renderLibrary();
    } catch (error) { if (active && request === generation && loading === libraryGeneration) setError(error); }
  }
  function editorView() {
    const target = $('#evidence-editor'); if (!target) return;
    if (!editor) { target.innerHTML = '<h3>근거 검토</h3><p>보관 문헌의 “근거·검토 열기”를 선택하세요.</p>'; return; }
    const readonly = editor.status === 'reviewed' && !library.permissions.canReview;
    target.innerHTML = `<h3>근거 검토</h3><h4>${escapeHtml(editor.article.title)}</h4>${articleDetails(editor.article)}
      <p>문헌은 ${escapeHtml(displayTime(editor.article.checkedAt))}에 확보한 검색 스냅샷입니다. 현재 원문·정정 여부는 외부 출처에서 확인하세요.</p>
      ${readonly ? '<p>검토 완료된 문헌의 수정은 지정 검토자에게 요청해 주세요.</p>' : ''}
      <form id="evidence-review-form"><label for="evidence-review-status">검토 상태</label><select id="evidence-review-status">${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${draft.status === key ? 'selected' : ''} ${key === 'reviewed' && !library.permissions.canReview ? 'disabled' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
      <label for="evidence-review-basis">직접 확인한 자료 범위</label><select id="evidence-review-basis">${[['metadata','서지정보'],['abstract','제공자 초록'],['external-fulltext','별도 원문을 직접 읽음']].map(([key,label]) => `<option value="${key}" ${draft.reviewBasis === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <p>“별도 원문”은 사용자가 외부에서 읽었다는 기록입니다. 이 사이트가 전문을 수집하거나 검증했다는 뜻이 아닙니다.</p>
      <label for="evidence-review-note">검토 메모·포함 또는 제외 이유</label><textarea id="evidence-review-note" maxlength="2000" rows="3">${escapeHtml(draft.note)}</textarea>
      <label for="evidence-review-text">판단을 뒷받침하는 근거 구절</label><textarea id="evidence-review-text" maxlength="4000" rows="4">${escapeHtml(draft.evidenceText)}</textarea>
      <label for="evidence-review-locator">근거 위치 (예: 초록 결과 / 원문 3쪽 표2)</label><input id="evidence-review-locator" maxlength="500" value="${escapeHtml(draft.locator)}">
      <p>검토 완료에는 메모·근거 구절·위치를 모두 남겨 주세요. 환자 개인정보를 입력하지 마세요. 변경 전 기록은 이력으로 보존합니다.</p>
      <button class="button button-primary" id="evidence-review-save" type="submit" ${readonly ? 'disabled' : ''}>검토 내용 저장</button></form>`;
    updateControls();
  }
  function mount() {
    if (active) return;
    active = true; generation++; pending = '';
    root.innerHTML = `<div class="evidence-workspace"><div id="evidence-error" class="error-banner" role="alert" hidden></div><p id="evidence-status" role="status" aria-live="polite"></p>
      <section class="card communication-panel"><h2>관련 문헌 찾기</h2><p class="communication-help">일반적인 연구 질문으로 Europe PMC를 검색합니다. 환자 이름·연락처·증상 원문을 보내지 마세요. 문헌 검색과 원문 읽기를 지원하며 AI가 논문이나 임상 권고를 생성하지 않습니다.</p>
      <form id="evidence-search-form"><label for="evidence-query">연구 주제 또는 검색식</label><input id="evidence-query" required minlength="2" maxlength="500" value="${escapeHtml(queryDraft.query)}" placeholder="예: older adults medication adherence">
      <div class="form-row"><label for="evidence-year-from">시작 연도 (선택)<input id="evidence-year-from" type="number" min="1800" max="2200" value="${escapeHtml(queryDraft.yearFrom)}"></label><label for="evidence-year-to">종료 연도 (선택)<input id="evidence-year-to" type="number" min="1800" max="2200" value="${escapeHtml(queryDraft.yearTo)}"></label></div>
      <label class="check-label"><input id="evidence-privacy" type="checkbox" required> 검색어에 환자 개인정보가 없음을 확인했습니다.</label>
      <button type="submit" class="button button-primary" id="evidence-search-button">문헌 검색</button><button type="button" class="button button-secondary" id="evidence-cancel-search" data-evidence="cancel-search" hidden>검색 취소</button></form>
      <div id="evidence-results"></div></section>
      <section class="card communication-panel"><div class="card-header"><h2>문헌 보관함</h2><button class="button button-secondary" data-evidence="refresh">목록 새로고침</button></div><div id="evidence-library"><p>저장 목록을 불러오는 중입니다.</p></div></section>
      <section class="card communication-panel" id="evidence-editor"></section></div>`;
    renderResults(); editorView(); loadLibrary();
  }
  async function runSearch(next = false) {
    if (pending || !active) return;
    const data = next ? { query: searchResult.query, yearFrom: searchResult.parameters?.yearFrom, yearTo: searchResult.parameters?.yearTo, cursorMark: searchResult.nextCursor, confirmNoPersonalData: true } : {
      query: queryDraft.query, ...(queryDraft.yearFrom ? { yearFrom: Number(queryDraft.yearFrom) } : {}), ...(queryDraft.yearTo ? { yearTo: Number(queryDraft.yearTo) } : {}), confirmNoPersonalData: $('#evidence-privacy').checked,
    };
    if (!data.confirmNoPersonalData) { setError(new Error('검색어에 환자 개인정보가 없는지 확인해 주세요.')); $('#evidence-privacy').focus(); return; }
    const request = generation, submitted = JSON.stringify(queryDraft);
    searchAbort = new AbortController(); pending = 'search'; clearError(); setStatus('Europe PMC에서 문헌을 찾고 있습니다. 아직 검색이 완료되지 않았습니다.'); updateControls();
    try {
      const result = await api('/api/clinician/evidence/search', { method: 'POST', body: JSON.stringify(data), signal: searchAbort.signal });
      if (!active || request !== generation) return;
      searchResult = result; if (!next) queryBaseline = submitted;
      renderResults(); setStatus(`검색을 완료했습니다. 이번 페이지 ${result.results.length}건을 표시하며 검색 조건과 시각을 저장했습니다.`); await loadLibrary();
    } catch (error) {
      if (active && request === generation) {
        if (error.name === 'AbortError') setStatus('검색을 취소했습니다. 검색어는 유지했습니다.');
        else { setError(error); setStatus('검색을 완료하지 못했습니다. 기존 결과가 있다면 이전 검색 결과입니다.'); }
      }
    } finally { if (request === generation) { pending = ''; searchAbort = null; updateControls(); } }
  }
  async function writeOperation(path, body, method, onSuccess) {
    if (pending || !active) return;
    const request = generation; pending = 'save'; clearError(); setStatus('저장 중입니다.'); updateControls();
    try {
      const result = await api(path, { method, body: JSON.stringify(body) });
      if (!active || request !== generation) return;
      onSuccess(result); setStatus('서버에 저장했습니다. 목록 조회에 실패하더라도 다시 저장할 필요는 없습니다.'); await loadLibrary();
    } catch (error) { if (active && request === generation) { setError(error); setStatus('저장 결과를 확인하지 못했습니다. 입력은 유지했습니다.'); } }
    finally { if (request === generation) { pending = ''; updateControls(); } }
  }
  root.addEventListener('input', event => {
    if (!active) return;
    const queryFields = { 'evidence-query': 'query', 'evidence-year-from': 'yearFrom', 'evidence-year-to': 'yearTo' };
    if (queryFields[event.target.id]) queryDraft[queryFields[event.target.id]] = event.target.value;
    const fields = { 'evidence-review-note': 'note', 'evidence-review-text': 'evidenceText', 'evidence-review-locator': 'locator' };
    if (fields[event.target.id]) draft[fields[event.target.id]] = event.target.value;
  });
  root.addEventListener('change', event => {
    if (!active) return;
    if (event.target.id === 'evidence-review-status') draft.status = event.target.value;
    if (event.target.id === 'evidence-review-basis') draft.reviewBasis = event.target.value;
  });
  root.addEventListener('submit', event => {
    if (!active) return;
    if (event.target.id === 'evidence-search-form') { event.preventDefault(); runSearch(); }
    if (event.target.id === 'evidence-review-form') {
      event.preventDefault(); if (!editor) return;
      writeOperation(`/api/clinician/evidence/bookmarks/${encodeURIComponent(editor.id)}`, { version: editor.version, ...draft }, 'PATCH', result => {
        editor = result.bookmark; draft = { status: editor.status, note: editor.note, evidenceText: editor.evidenceText, locator: editor.locator, reviewBasis: editor.reviewBasis }; baseline = JSON.stringify(draft); editorView();
      });
    }
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-evidence]'); if (!active || !button) return;
    const action = button.dataset.evidence;
    if (action === 'cancel-search') { searchAbort?.abort(); return; }
    if (pending) return;
    if (action === 'refresh') { clearError(); await loadLibrary(); }
    if (action === 'next' && searchResult?.nextCursor) await runSearch(true);
    if (action === 'bookmark') {
      const article = searchResult?.results[Number(button.dataset.index)]; if (!article) return;
      await writeOperation('/api/clinician/evidence/bookmarks', { searchId: searchResult.id, articleKey: article.articleKey }, 'POST', result => { toast(result.duplicate ? '이미 보관한 문헌입니다.' : '문헌과 검색 출처를 보관했습니다.'); });
    }
    if (action === 'edit-bookmark') {
      if (JSON.stringify(draft) !== baseline && !confirm('작성한 검토 내용을 저장하지 않고 다른 문헌을 열까요?')) return;
      const bookmark = library.bookmarks.find(item => item.id === button.dataset.id); if (!bookmark) return;
      editor = bookmark; draft = { status: editor.status, note: editor.note, evidenceText: editor.evidenceText, locator: editor.locator, reviewBasis: editor.reviewBasis }; baseline = JSON.stringify(draft); clearError(); editorView(); $('#evidence-review-note').focus();
    }
    if (action === 'restore-search') {
      if (JSON.stringify(queryDraft) !== queryBaseline && !confirm('작성한 검색식을 저장하지 않고 이전 검색을 열까요?')) return;
      const request = generation; pending = 'load'; updateControls(); clearError();
      try {
        const result = await api(`/api/clinician/evidence/searches/${encodeURIComponent(button.dataset.id)}`);
        if (!active || request !== generation) return;
        searchResult = result; queryDraft = { query: result.query, yearFrom: String(result.parameters?.yearFrom ?? ''), yearTo: String(result.parameters?.yearTo ?? '') }; queryBaseline = JSON.stringify(queryDraft);
        $('#evidence-query').value = queryDraft.query; $('#evidence-year-from').value = queryDraft.yearFrom; $('#evidence-year-to').value = queryDraft.yearTo; $('#evidence-privacy').checked = false;
        renderResults(); setStatus('저장 당시 검색 결과를 불러왔습니다. 외부 검색을 다시 실행한 것은 아닙니다.');
      } catch (error) { if (active && request === generation) setError(error); }
      finally { if (request === generation) { pending = ''; updateControls(); } }
    }
  });
  return {
    mount,
    deactivate() { if (!active) return; active = false; generation++; libraryGeneration++; searchAbort?.abort(); searchAbort = null; pending = ''; },
    canLeave, dirty, busy: () => Boolean(pending), refresh() { if (active && !pending && !document.hidden) loadLibrary(); },
  };
}
