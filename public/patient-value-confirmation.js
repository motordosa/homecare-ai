// A confirmation of the entered value, never a clinical normal-range diagnosis.
export function createValueConfirmation({ form, getContext, getConfiguration, matchingRule, notify, stop }) {
  const confirmed = new Map();
  const displayed = new Map();
  const hosts = new Map();
  const fields = ['steps', 'sleepHours'];
  function signature(field, value) {
    const context = getContext();
    return JSON.stringify([context.patientId, context.contextId, context.recordDate, field, value, getConfiguration()?.configurationKey]);
  }
  function clear(field) {
    hosts.get(field)?.remove(); hosts.delete(field); displayed.delete(field); confirmed.delete(field);
  }
  function reset() { fields.forEach(clear); }
  function check(field, { focus = false, announce = true } = {}) {
    const input = form.elements.namedItem(field);
    const context = getContext();
    if (!context.ready || !input || input.disabled || input.closest('[hidden]') || input.value === '' || !input.checkValidity()) { clear(field); return true; }
    const value = Number(input.value);
    const rule = matchingRule(field, value, { recordDate: context.recordDate });
    if (!rule) { clear(field); return true; }
    const key = signature(field, value);
    if (confirmed.get(field) === key) return true;
    if (displayed.get(field) !== key) {
      clear(field);
      const host = document.createElement('section');
      host.dataset.valueConfirmation = field; host.className = 'value-confirmation'; host.tabIndex = -1;
      host.setAttribute('role', 'group'); host.setAttribute('aria-label', '입력한 수치 확인');
      const title = document.createElement('strong');
      title.textContent = `${field === 'steps' ? '걸음 수' : '수면 시간'} ${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${field === 'steps' ? '걸음' : '시간'}이 맞나요?`;
      const text = document.createElement('p');
      text.textContent = '의료진이 정한 입력 확인 범위에 해당해요. 실제 수치가 맞으면 확인해 주세요.';
      const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'button button-primary'; accept.dataset.valueConfirm = ''; accept.textContent = '이 값이 맞아요';
      const correct = document.createElement('button'); correct.type = 'button'; correct.className = 'button button-secondary'; correct.dataset.valueCorrect = ''; correct.textContent = '수정하기';
      accept.addEventListener('click', () => {
        if (!getContext().ready || input.disabled || signature(field, Number(input.value)) !== key) { clear(field); return; }
        confirmed.set(field, key); stop?.();
        title.textContent += ' · 확인했어요'; text.textContent = '아직 저장되지 않았어요. 아래 저장 버튼으로 마쳐 주세요.';
        accept.hidden = true; correct.textContent = '다시 수정하기';
      });
      correct.addEventListener('click', () => { clear(field); stop?.(); input.focus(); input.select(); });
      host.append(title, text, accept, correct); input.closest('.form-field').append(host);
      hosts.set(field, host); displayed.set(field, key);
      if (announce) notify('value_check', { contextId: context.contextId, recordDate: context.recordDate, metric: field, value });
    }
    if (focus) { hosts.get(field)?.scrollIntoView({ block: 'nearest' }); hosts.get(field)?.focus({ preventScroll: true }); }
    return false;
  }
  for (const field of fields) {
    const input = form.elements.namedItem(field);
    input.addEventListener('input', () => { if (displayed.has(field)) stop?.(); clear(field); });
    input.addEventListener('blur', () => check(field));
  }
  return {
    check, reset,
    validate(selected = fields) {
      // Only the first unconfirmed field speaks and gets focus on each submission.
      for (const field of selected) if (!check(field, { focus: true })) return false;
      return true;
    },
  };
}
