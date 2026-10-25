// Shared, plain-data catalog. No executable templates or browser dependencies.
export const GUIDANCE_EVENTS = Object.freeze([
  { value: 'period_entry', label: '시간대 첫 접속' },
  { value: 'meal_open', label: '식사 기록 열기' },
  { value: 'medication_open', label: '복약 기록 열기' },
  { value: 'medication_photo_open', label: '약 사진 입력 열기' },
  { value: 'steps_open', label: '걸음 수 입력 열기' },
  { value: 'sleep_open', label: '수면 입력 열기' },
  { value: 'daily_open', label: '전체 건강 기록 열기' },
  { value: 'value_check', label: '입력값 다시 확인' },
]);
export const GUIDANCE_CONDITIONS = Object.freeze([
  { value: 'always', label: '추가 조건 없음' },
  { value: 'any_missing', label: '현재 시간대 확인할 기록 있음' },
  { value: 'missing_breakfast', label: '아침 식사 미기록' },
  { value: 'missing_lunch', label: '점심 식사 미기록' },
  { value: 'missing_dinner', label: '저녁 식사 미기록' },
  { value: 'pending_medication', label: '시간이 된 약의 복용 여부 미보고' },
  { value: 'missing_sleep', label: '수면 미기록' },
  { value: 'missing_steps', label: '걸음 수 미기록' },
]);
const rule = (id, label, trigger, text, extra = {}) => ({
  id, label, enabled: true, trigger, text, startTime: '00:00', endTime: '24:00',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], activeFrom: null, activeUntil: null,
  frequency: 'day', condition: 'always', metric: null, minValue: null, maxValue: null,
  cooldownMinutes: 0, maxPerDay: 1, priority: 50, ...extra,
});
export const DEFAULT_GUIDANCE_RULES = Object.freeze([
  rule('morning', '아침 첫 인사', 'period_entry', '안녕하세요. 아침 식사와 복약 여부, 지난밤 수면 기록을 확인해 주세요.', { startTime: '06:00', endTime: '12:00', condition: 'any_missing', priority: 10 }),
  rule('afternoon', '오후 첫 안내', 'period_entry', '오후 식사와 드신 약을 확인해 기록해 주세요.', { startTime: '12:00', endTime: '18:00', condition: 'any_missing', priority: 10 }),
  rule('evening', '저녁 첫 안내', 'period_entry', '오늘 식사와 복약, 걸음 수 기록을 확인해 주세요.', { startTime: '18:00', endTime: '22:00', condition: 'any_missing', priority: 10 }),
  rule('meal-photo', '식사 사진 설명', 'meal_open', '음식 전체가 보이도록 사진을 찍어 주세요.'),
  rule('medication', '복약 기록 설명', 'medication_open', '약 이름과 시간을 보고 복용 여부를 골라 주세요.'),
  rule('medication-photo', '약 사진 설명', 'medication_photo_open', '약봉투의 글자가 잘 보이게 찍어 주세요.'),
  rule('steps', '걸음 수 입력 설명', 'steps_open', '휴대폰에 표시된 걸음 수를 정확히 입력해 주세요.'),
  rule('sleep', '수면 입력 설명', 'sleep_open', '주무신 시간과 분을 확인해 입력해 주세요.'),
  rule('daily', '건강 기록 설명', 'daily_open', '확인한 항목만 정확히 입력해 주세요.'),
  rule('steps-check', '걸음 수 재확인', 'value_check', '입력한 {value}{unit}이 맞나요? 다시 확인해 주세요.', { frequency: 'value', metric: 'steps', minValue: 100, maxValue: 50000, priority: 100 }),
  rule('sleep-check', '수면 시간 재확인', 'value_check', '입력한 수면 {value}{unit}이 맞나요? 다시 확인해 주세요.', { frequency: 'value', metric: 'sleepHours', minValue: 2, maxValue: 14, priority: 100 }),
]);
export function defaultGuidanceConfig() {
  return { enabled: true, rate: 1, rules: JSON.parse(JSON.stringify(DEFAULT_GUIDANCE_RULES)) };
}
