// SCREEN_SPEC.md is the design authority. All patient navigation uses this registry.
export const PATIENT_SCREENS = Object.freeze({
  home: Object.freeze({ id: 'P-HOME', title: '홈', kind: 'page', closeTarget: null, nav: 'home' }),
  records: Object.freeze({ id: 'P-RECORDS', title: '기록 모아보기', kind: 'page', closeTarget: 'home', nav: 'records' }),
  medication: Object.freeze({ id: 'P-MED', title: '복약 기록', kind: 'page', closeTarget: 'home', nav: 'medication' }),
  messages: Object.freeze({ id: 'P-MESSAGES', title: '의료진 메시지', kind: 'page', closeTarget: 'home', nav: 'messages' }),
  connections: Object.freeze({ id: 'P-CONNECT', title: '건강 기록 연결', kind: 'page', closeTarget: 'home', nav: 'connections' }),
  guide: Object.freeze({ id: 'P-GUIDE', title: '이용 안내', kind: 'page', closeTarget: 'home', nav: 'guide' }),
});

export const PATIENT_INPUT_SCREENS = Object.freeze({
  medicationPhoto: Object.freeze({ id: 'P-MED-PHOTO', dialog: 'medication-photo-dialog', title: '사진으로 복약 기록', closeTarget: 'opener' }),
  meal: Object.freeze({ id: 'P-MEAL', dialog: 'meal-dialog', title: '무엇을 드셨나요?', closeTarget: 'opener' }),
  all: Object.freeze({ id: 'P-DAILY', dialog: 'daily-dialog', title: '건강 기록 남기기', closeTarget: 'opener' }),
  steps: Object.freeze({ id: 'P-STEPS', dialog: 'daily-dialog', title: '걸음 수 기록하기', closeTarget: 'opener' }),
  sleep: Object.freeze({ id: 'P-SLEEP', dialog: 'daily-dialog', title: '수면 시간 기록하기', closeTarget: 'opener' }),
});
