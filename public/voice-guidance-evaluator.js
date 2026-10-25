import {koreaClock} from './patient-tasks.js';

const number = value => typeof value === 'number' && Number.isFinite(value);

export function guidanceClock(now = new Date()) {
  const clock = koreaClock(now);
  return {...clock, weekday:new Date(`${clock.date}T12:00:00+09:00`).getUTCDay()};
}

export function ruleInWindow(rule, now = new Date()) {
  const clock = guidanceClock(now);
  return Boolean(rule?.enabled && rule.daysOfWeek?.includes(clock.weekday)
    && clock.time >= rule.startTime && clock.time < rule.endTime
    && (!rule.activeFrom || clock.date >= rule.activeFrom)
    && (!rule.activeUntil || clock.date <= rule.activeUntil));
}

export function guidanceCondition(condition, {summary, schedule, now = new Date()} = {}) {
  if (condition === 'always') return true;
  const clock = guidanceClock(now);
  if (!summary || summary.today !== clock.date) return false;
  const record = summary.todayRecord;
  const meals = (summary.todayMeals || []).filter(meal => meal.date === clock.date);
  const missingMeal = type => !meals.some(meal => meal.mealType === type);
  const scheduleKnown = schedule?.date === clock.date;
  const medication = scheduleKnown && (schedule.orders?.length
    ? (schedule.slots || []).some(slot => slot.status === 'pending' && slot.time <= clock.time)
    : !record?.medicationStatus);
  const conditions = {
    missing_breakfast:missingMeal('breakfast'), missing_lunch:missingMeal('lunch'),
    missing_dinner:missingMeal('dinner'), pending_medication:medication,
    missing_sleep:!number(record?.sleepHours), missing_steps:!number(record?.steps),
  };
  if (condition === 'any_missing') {
    if (clock.time < '12:00') return conditions.missing_breakfast || medication || conditions.missing_sleep;
    if (clock.time < '18:00') return conditions.missing_lunch || medication;
    return conditions.missing_dinner || medication || conditions.missing_steps;
  }
  return conditions[condition] === true;
}

export function valueNeedsConfirmation(rule, metric, value) {
  if (rule?.trigger !== 'value_check' || rule.metric !== metric || !number(value)) return false;
  if (metric === 'steps' && (!Number.isInteger(value) || value < 0 || value > 100000)) return false;
  if (metric === 'sleepHours' && (value < 0 || value > 24)) return false;
  return (number(rule.minValue) && value < rule.minValue) || (number(rule.maxValue) && value > rule.maxValue);
}

export function matchingGuidanceRules(configuration, event, context = {}) {
  if (!configuration?.enabled) return [];
  return (configuration.rules || []).filter(rule => rule.trigger === event
    && ruleInWindow(rule, context.now)
    && guidanceCondition(rule.condition, context)
    && (event !== 'value_check' || valueNeedsConfirmation(rule, context.metric, context.value)))
    .sort((a,b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function guidanceText(rule, value) {
  const unit = rule.metric === 'steps' ? '걸음' : rule.metric === 'sleepHours' ? '시간' : '';
  const formatted = number(value) ? value.toLocaleString('ko-KR', {maximumFractionDigits:1}) : '';
  return String(rule.text).replaceAll('{value}', formatted).replaceAll('{unit}', unit);
}
