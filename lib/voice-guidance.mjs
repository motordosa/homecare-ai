import { createHash, randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { effectiveRecords } from './analysis.mjs';
import { medicationSchedule } from './medications.mjs';
import { assertStaffCapability, assignedPatientIds, hasCapability } from './staff-access.mjs';
import { allowedKeys, choice, dateValue, HttpError, numberValue, objectBody, textValue } from './validation.mjs';
import { defaultGuidanceConfig, GUIDANCE_EVENTS, GUIDANCE_CONDITIONS } from '../public/voice-guidance-rules.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ruleKeys = ['id', 'label', 'enabled', 'trigger', 'text', 'startTime', 'endTime', 'daysOfWeek', 'activeFrom', 'activeUntil', 'frequency', 'condition', 'metric', 'minValue', 'maxValue', 'cooldownMinutes', 'maxPerDay', 'priority'];
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const fail = message => { throw new HttpError(400, message); };
const bool = (value, label) => typeof value === 'boolean' ? value : fail(`${label} 사용 여부를 확인해 주세요.`);
const uuid = value => typeof value === 'string' && uuidPattern.test(value) ? value : fail('올바른 요청번호가 필요합니다.');
const scopeKey = patientId => patientId ? `patient:${patientId}` : 'global';

export function ensureVoiceGuidanceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_guidance_config (
      scope_key TEXT PRIMARY KEY, patient_id TEXT UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, configuration_json TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK ((scope_key='global' AND patient_id IS NULL AND configuration_json IS NOT NULL) OR (patient_id IS NOT NULL AND scope_key='patient:'||patient_id))
    );
    CREATE TABLE IF NOT EXISTS voice_guidance_submissions (
      actor_id TEXT NOT NULL, scope_key TEXT NOT NULL REFERENCES voice_guidance_config(scope_key) ON DELETE CASCADE,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(actor_id,scope_key,request_id)
    );
    CREATE TABLE IF NOT EXISTS voice_guidance_preferences (
      patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voice_guidance_playbacks (
      claim_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL, date TEXT NOT NULL, bucket TEXT NOT NULL,
      configuration_key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','started','released')),
      reserved_at TEXT NOT NULL, expires_at TEXT NOT NULL, started_at TEXT,
      UNIQUE(patient_id,rule_id,date,bucket)
    );
    CREATE INDEX IF NOT EXISTS voice_guidance_playback_frequency ON voice_guidance_playbacks(patient_id,rule_id,date,state);
  `);
}

function requirePatient(db, patientId) {
  if (!db.prepare('SELECT 1 FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
}
function assertPatient(actor, patientId) {
  if (!actor?.accountId) throw new HttpError(401, '로그인이 필요합니다.');
  if (actor.role !== 'patient' || actor.patientId !== patientId) throw new HttpError(403, '환자 본인 화면에서 음성 안내를 설정해 주세요.');
}
function assertRead(actor, patientId) {
  if (actor?.role === 'clinician') assertStaffCapability(actor, 'patient.read', patientId);
  else assertPatient(actor, patientId);
}
function canWrite(actor, patientId) {
  const scope = assignedPatientIds(actor);
  return hasCapability(actor, 'clinical.write') && (patientId ? scope === null || scope.includes(patientId) : scope === null);
}
function effectiveConfiguration(db, patientId = null) {
  const globalRow = db.prepare("SELECT * FROM voice_guidance_config WHERE scope_key='global'").get();
  const localRow = patientId ? db.prepare('SELECT * FROM voice_guidance_config WHERE scope_key=?').get(scopeKey(patientId)) : null;
  const row = localRow?.configuration_json ? localRow : globalRow;
  const configuration = row ? JSON.parse(row.configuration_json) : defaultGuidanceConfig();
  const generation = db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value || '';
  return {
    configuration,
    configurationKey: digest(canonical({ generation, patientId, globalRevision: globalRow?.revision || 0, localRevision: localRow?.revision || 0, configuration })),
    revision: (patientId ? localRow : globalRow)?.revision || 0,
    exists: Boolean((patientId ? localRow : globalRow)?.configuration_json),
    inherited: Boolean(patientId && !localRow?.configuration_json),
  };
}
export function clinicianVoiceGuidance(db, actor, patientId = null) {
  assertStaffCapability(actor, 'patient.read', patientId);
  if (patientId) requirePatient(db, patientId);
  return { scope: patientId ? 'patient' : 'global', patientId, ...effectiveConfiguration(db, patientId), canWrite: canWrite(actor, patientId), catalog: { events: GUIDANCE_EVENTS, conditions: GUIDANCE_CONDITIONS } };
}

export function validateGuidanceConfiguration(input) {
  const config = objectBody(input);
  allowedKeys(config, ['enabled', 'rate', 'rules']);
  const enabled = bool(config.enabled, '전체 안내');
  const rate = choice(config.rate, '안내 속도', [0.85, 1, 1.15]);
  if (!Array.isArray(config.rules) || config.rules.length > 40) fail('음성 안내 규칙은 최대 40개입니다.');
  const ids = new Set();
  const rules = config.rules.map(value => {
    const r = objectBody(value); allowedKeys(r, ruleKeys);
    if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(r.id) || ids.has(r.id)) fail('안내 규칙 ID는 중복 없는 영문 소문자·숫자·하이픈 1~48자입니다.');
    ids.add(r.id);
    const label = textValue(r.label, '안내 제목', { min: 1, max: 60 });
    const text = textValue(r.text, '안내 문장', { min: 1, max: 180 });
    if (/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || /[{}]/.test(text.replaceAll('{value}', '').replaceAll('{unit}', ''))) fail('문장에는 일반 글자와 {value}, {unit}만 사용할 수 있습니다.');
    const trigger = choice(r.trigger, '발생 동작', GUIDANCE_EVENTS.map(item => item.value));
    const condition = choice(r.condition, '기록 조건', GUIDANCE_CONDITIONS.map(item => item.value));
    const frequency = choice(r.frequency, '반복 기준', ['day', 'entry', 'value']);
    if (trigger === 'period_entry' && frequency !== 'day' || trigger === 'value_check' && frequency !== 'value' || !['period_entry', 'value_check'].includes(trigger) && frequency === 'value') fail('발생 동작과 반복 기준을 함께 확인해 주세요.');
    if (typeof r.startTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.startTime) || typeof r.endTime !== 'string' || !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(r.endTime) || r.startTime >= r.endTime) fail('시작 시각은 종료 시각보다 빨라야 합니다. 자정을 넘는 안내는 규칙을 나누어 주세요.');
    if (!Array.isArray(r.daysOfWeek) || !r.daysOfWeek.length || r.daysOfWeek.length > 7 || r.daysOfWeek.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(r.daysOfWeek).size !== r.daysOfWeek.length) fail('적용 요일을 1개 이상 선택해 주세요.');
    const activeFrom = r.activeFrom === null ? null : dateValue(r.activeFrom);
    const activeUntil = r.activeUntil === null ? null : dateValue(r.activeUntil);
    if (activeFrom && activeUntil && activeFrom > activeUntil) fail('적용 종료일은 시작일 이후여야 합니다.');
    let metric = null, minValue = null, maxValue = null;
    if (trigger === 'value_check') {
      metric = choice(r.metric, '수치 항목', ['steps', 'sleepHours']);
      const limit = metric === 'steps' ? 100000 : 24;
      minValue = r.minValue === null ? null : numberValue(r.minValue, '하한', 0, limit, metric === 'steps');
      maxValue = r.maxValue === null ? null : numberValue(r.maxValue, '상한', 0, limit, metric === 'steps');
      if (minValue === null && maxValue === null || minValue !== null && maxValue !== null && minValue >= maxValue) fail('확인 기준의 하한·상한을 확인해 주세요.');
    } else if (r.metric !== null || r.minValue !== null || r.maxValue !== null) fail('수치 확인 동작에서만 수치 기준을 설정할 수 있습니다.');
    const cooldownMinutes = numberValue(r.cooldownMinutes, '최소 간격', 0, 1440, true);
    if (trigger === 'value_check' && cooldownMinutes !== 0) fail('값 재확인은 최소 간격을 0으로 설정해 주세요.');
    return { id: r.id, label, enabled: bool(r.enabled, '개별 안내'), trigger, text, startTime: r.startTime, endTime: r.endTime, daysOfWeek: [...r.daysOfWeek].sort(), activeFrom, activeUntil, frequency, condition, metric, minValue, maxValue, cooldownMinutes, maxPerDay: numberValue(r.maxPerDay, '하루 상한', 1, 10, true), priority: numberValue(r.priority, '우선순위', 0, 100, true) };
  });
  return { enabled, rate, rules };
}

export function saveClinicianVoiceGuidance(db, actor, patientId, input, now = new Date()) {
  assertStaffCapability(actor, 'clinical.write', patientId);
  if (!canWrite(actor, patientId)) throw new HttpError(403, '공통 안내 변경은 전체 환자 담당 의료진만 할 수 있습니다.');
  if (patientId) requirePatient(db, patientId);
  const body = objectBody(input); allowedKeys(body, ['revision', 'clientRequestId', 'configuration', 'inherit']);
  const revision = numberValue(body.revision, '수정번호', 0, 1000000000, true), requestId = uuid(body.clientRequestId);
  const inherit = body.inherit === true;
  if ('inherit' in body && !inherit || inherit && (!patientId || 'configuration' in body)) fail('공통 설정 따르기는 선택 환자에서만 저장할 수 있습니다.');
  const configuration = inherit ? null : validateGuidanceConfiguration(body.configuration);
  const requestHash = digest(canonical({ revision, inherit, configuration })), key = scopeKey(patientId);
  return transaction(db, () => {
    const prior = db.prepare('SELECT request_hash,response_json FROM voice_guidance_submissions WHERE actor_id=? AND scope_key=? AND request_id=?').get(actor.accountId, key, requestId);
    if (prior) {
      if (prior.request_hash !== requestHash) throw new HttpError(409, '같은 요청번호의 설정 내용이 바뀌었습니다. 저장 상태를 확인해 주세요.');
      return JSON.parse(prior.response_json);
    }
    const current = db.prepare('SELECT revision FROM voice_guidance_config WHERE scope_key=?').get(key);
    if ((current?.revision || 0) !== revision) throw new HttpError(409, '다른 곳에서 음성 안내 설정을 바꿨습니다. 최신 설정을 확인해 주세요.');
    db.prepare(`INSERT INTO voice_guidance_config(scope_key,patient_id,revision,configuration_json,updated_by,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(scope_key) DO UPDATE SET revision=excluded.revision,configuration_json=excluded.configuration_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(key, patientId || null, revision + 1, configuration ? JSON.stringify(configuration) : null, actor.accountId, now.toISOString());
    const result = clinicianVoiceGuidance(db, actor, patientId);
    db.prepare('INSERT INTO voice_guidance_submissions(actor_id,scope_key,request_id,request_hash,response_json,created_at) VALUES (?,?,?,?,?,?)').run(actor.accountId, key, requestId, requestHash, JSON.stringify(result), now.toISOString());
    return result;
  });
}

export function patientVoiceGuidance(db, actor, patientId, now = new Date()) {
  assertRead(actor, patientId); requirePatient(db, patientId);
  const { configuration, configurationKey } = effectiveConfiguration(db, patientId);
  const preference = db.prepare('SELECT enabled FROM voice_guidance_preferences WHERE patient_id=?').get(patientId);
  return { configuration, configurationKey, preference: { enabled: preference ? Boolean(preference.enabled) : true, configured: Boolean(preference) }, serverTime: now.toISOString() };
}
export function saveVoiceGuidancePreference(db, actor, patientId, input, now = new Date()) {
  assertPatient(actor, patientId); requirePatient(db, patientId);
  const body = objectBody(input); allowedKeys(body, ['enabled']);
  const enabled = bool(body.enabled, '음성 안내');
  db.prepare('INSERT INTO voice_guidance_preferences(patient_id,enabled,updated_at) VALUES (?,?,?) ON CONFLICT(patient_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at').run(patientId, Number(enabled), now.toISOString());
  return { preference: { enabled, configured: true } };
}
export function guidanceClock(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: shifted.getUTCDay() };
}
function windowMatches(rule, clock) {
  return clock.time >= rule.startTime && clock.time < rule.endTime && rule.daysOfWeek.includes(clock.weekday) && (!rule.activeFrom || clock.date >= rule.activeFrom) && (!rule.activeUntil || clock.date <= rule.activeUntil);
}
function conditionMatches(db, patientId, rule, clock) {
  if (rule.condition === 'always') return true;
  const record = effectiveRecords(db, patientId, clock.date, clock.date)[0];
  const meals = db.prepare('SELECT meal_type FROM meals WHERE patient_id=? AND date=?').all(patientId, clock.date);
  const missingMeal = kind => !meals.some(meal => meal.meal_type === kind);
  if (rule.condition.startsWith('missing_') && ['breakfast', 'lunch', 'dinner'].includes(rule.condition.slice(8))) return missingMeal(rule.condition.slice(8));
  const missingSteps = record?.steps === null || record?.steps === undefined;
  const missingSleep = record?.sleepHours === null || record?.sleepHours === undefined;
  if (rule.condition === 'missing_steps') return missingSteps;
  if (rule.condition === 'missing_sleep') return missingSleep;
  const schedule = medicationSchedule(db, patientId, clock.date);
  const medicationPending = schedule.orders.length ? schedule.slots.some(slot => slot.status === 'pending' && slot.time <= clock.time) : !record?.medicationStatus;
  if (rule.condition === 'pending_medication') return medicationPending;
  const periodMeal = clock.time < '12:00' ? 'breakfast' : clock.time < '18:00' ? 'lunch' : 'dinner';
  return missingMeal(periodMeal) || medicationPending || clock.time < '12:00' && missingSleep || clock.time >= '18:00' && missingSteps;
}

export function claimVoiceGuidance(db, actor, patientId, input, now = new Date()) {
  assertPatient(actor, patientId); requirePatient(db, patientId);
  const body = objectBody(input); allowedKeys(body, ['configurationKey', 'ruleId', 'event', 'contextId', 'recordDate', 'value']);
  const configurationKey = textValue(body.configurationKey, '설정 식별자', { min: 1, max: 128 });
  const ruleId = textValue(body.ruleId, '안내 규칙', { min: 1, max: 48 });
  const event = choice(body.event, '발생 동작', GUIDANCE_EVENTS.map(item => item.value));
  if (body.contextId !== undefined) uuid(body.contextId);
  const clock = guidanceClock(now), deny = reason => ({ allowed: false, reason });
  return transaction(db, () => {
    const settings = patientVoiceGuidance(db, actor, patientId, now);
    if (settings.configurationKey !== configurationKey) return deny('configuration_changed');
    const rule = settings.configuration.rules.find(item => item.id === ruleId);
    if (!rule || rule.trigger !== event) fail('현재 안내 규칙과 발생 동작을 확인해 주세요.');
    if (!settings.preference.enabled || !settings.configuration.enabled || !rule.enabled) return deny('disabled');
    if (!windowMatches(rule, clock)) return deny('outside_window');
    let bucket = 'day', value = null;
    if (rule.frequency === 'entry') bucket = `entry:${uuid(body.contextId)}`;
    if (rule.frequency === 'value') {
      const recordDate = dateValue(body.recordDate);
      if (recordDate > clock.date) fail('미래 기록의 값은 확인할 수 없습니다.');
      value = numberValue(body.value, '확인할 값', 0, rule.metric === 'steps' ? 100000 : 24, rule.metric === 'steps');
      if (!(rule.minValue !== null && value < rule.minValue || rule.maxValue !== null && value > rule.maxValue)) return deny('condition_not_met');
      bucket = `value:${digest(canonical({ metric: rule.metric, recordDate, value }))}`;
    }
    if (!conditionMatches(db, patientId, rule, clock)) return deny('condition_not_met');
    const prior = db.prepare('SELECT * FROM voice_guidance_playbacks WHERE patient_id=? AND rule_id=? AND date=? AND bucket=?').get(patientId, rule.id, clock.date, bucket);
    if (prior?.state === 'started') return deny('already_started');
    if (prior?.state === 'reserved' && prior.expires_at > now.toISOString()) return deny('reserved_elsewhere');
    if (rule.frequency !== 'value') {
      const active = db.prepare("SELECT state,started_at,reserved_at FROM voice_guidance_playbacks WHERE patient_id=? AND rule_id=? AND date=? AND (state='started' OR (state='reserved' AND expires_at>?))").all(patientId, rule.id, clock.date, now.toISOString());
      if (active.length >= rule.maxPerDay) return deny('daily_limit');
      if (rule.cooldownMinutes && active.some(row => now.getTime() - Date.parse(row.started_at || row.reserved_at) < rule.cooldownMinutes * 60000)) return deny('cooldown');
    }
    const claimId = randomUUID(), expiresAt = new Date(now.getTime() + 30000).toISOString();
    db.prepare(`INSERT INTO voice_guidance_playbacks(claim_id,patient_id,rule_id,date,bucket,configuration_key,state,reserved_at,expires_at,started_at) VALUES (?,?,?,?,?,?,'reserved',?,?,NULL)
      ON CONFLICT(patient_id,rule_id,date,bucket) DO UPDATE SET claim_id=excluded.claim_id,configuration_key=excluded.configuration_key,state='reserved',reserved_at=excluded.reserved_at,expires_at=excluded.expires_at,started_at=NULL`).run(claimId, patientId, rule.id, clock.date, bucket, configurationKey, now.toISOString(), expiresAt);
    const text = rule.text.replaceAll('{value}', value === null ? '' : String(value)).replaceAll('{unit}', rule.metric === 'steps' ? '걸음' : rule.metric === 'sleepHours' ? '시간' : '');
    return { allowed: true, reason: 'reserved', claimId, text, rate: settings.configuration.rate, expiresAt };
  });
}

export function receiveVoiceGuidanceReceipt(db, actor, patientId, claimId, input, now = new Date()) {
  assertPatient(actor, patientId); requirePatient(db, patientId); uuid(claimId);
  const body = objectBody(input); allowedKeys(body, ['outcome']);
  const outcome = choice(body.outcome, '재생 상태', ['started', 'released']);
  return transaction(db, () => {
    const prior = db.prepare('SELECT * FROM voice_guidance_playbacks WHERE claim_id=? AND patient_id=?').get(claimId, patientId);
    if (!prior) throw new HttpError(404, '현재 환자의 재생 예약을 찾을 수 없습니다.');
    if (prior.state === 'started') return { ok: true, outcome: 'started' };
    if (prior.state === 'released') {
      if (outcome === 'started') throw new HttpError(409, '취소된 음성 안내 예약입니다.');
      return { ok: true, outcome: 'released' };
    }
    if (outcome === 'started' && prior.expires_at <= now.toISOString()) throw new HttpError(409, '음성 안내 예약이 만료되었습니다.');
    db.prepare('UPDATE voice_guidance_playbacks SET state=?,started_at=? WHERE claim_id=?').run(outcome, outcome === 'started' ? now.toISOString() : null, claimId);
    return { ok: true, outcome };
  });
}
