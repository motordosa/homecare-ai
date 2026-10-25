import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, seedDatabase } from '../lib/db.mjs';
import { ensureMedicationSchema, createMedicationOrder, saveMedicationEvent } from '../lib/medications.mjs';
import { ensureVoiceGuidanceSchema, validateGuidanceConfiguration, clinicianVoiceGuidance, saveClinicianVoiceGuidance, patientVoiceGuidance, saveVoiceGuidancePreference, claimVoiceGuidance, receiveVoiceGuidanceReceipt, guidanceClock } from '../lib/voice-guidance.mjs';
import { defaultGuidanceConfig } from '../public/voice-guidance-rules.js';

const clinician = { accountId: 'synthetic-clinician', role: 'clinician', capabilities: ['patient.read', 'clinical.write'], assignedPatientIds: null };
const patient = { accountId: 'synthetic-patient', role: 'patient', patientId: 'p001' };
const now = new Date('2026-10-25T00:00:00Z'); // Sunday 09:00 KST
const at = time => new Date(`2026-10-25T${time}:00+09:00`);
const status = value => error => error.status === value;
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'homecare-guidance-'));
  const { db } = openDatabase(dir);
  ensureMedicationSchema(db); ensureVoiceGuidanceSchema(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return db;
}
function configWith(ruleId, changes = {}) {
  const configuration = defaultGuidanceConfig();
  configuration.rules = [Object.assign(configuration.rules.find(rule => rule.id === ruleId), changes)];
  return configuration;
}
function save(db, configuration, patientId = null) {
  return saveClinicianVoiceGuidance(db, clinician, patientId, { revision: clinicianVoiceGuidance(db, clinician, patientId).revision, clientRequestId: randomUUID(), configuration }, now);
}
function claim(db, ruleId = 'meal-photo', additions = {}, time = now) {
  const settings = patientVoiceGuidance(db, patient, 'p001', time);
  const rule = settings.configuration.rules.find(item => item.id === ruleId);
  return claimVoiceGuidance(db, patient, 'p001', { configurationKey: settings.configurationKey, ruleId, event: rule.trigger, ...additions }, time);
}
function ack(db, result, outcome = 'started', time = now) { return receiveVoiceGuidanceReceipt(db, patient, 'p001', result.claimId, { outcome }, time); }

test('Guidance shared defaults are fresh, valid, brief, and separate input-confirmation thresholds from medical judgments', () => {
  const a = defaultGuidanceConfig(), b = defaultGuidanceConfig();
  assert.equal(a.rules.length, 11); a.rules[0].daysOfWeek.length = 0; assert.equal(b.rules[0].daysOfWeek.length, 7);
  assert.deepEqual(validateGuidanceConfiguration(b), b);
  assert.deepEqual(b.rules.filter(rule => rule.metric).map(rule => [rule.metric, rule.minValue, rule.maxValue]), [['steps', 100, 50000], ['sleepHours', 2, 14]]);
});
test('Guidance validation rejects unknown fields, types, impossible dates/windows, duplicate IDs, templates, and invalid combinations', () => {
  const invalid = [
    config => { config.enabled = 'true'; }, config => { config.rate = 5; }, config => { config.extra = true; },
    config => { config.rules[0].enabled = 1; }, config => { config.rules[0].extra = true; },
    config => { config.rules[0].id = 'UPPER'; }, config => { config.rules.push(config.rules[0]); },
    config => { config.rules[0].text = '<script>bad</script>'; }, config => { config.rules[0].text = '{patient}'; },
    config => { config.rules[0].text = 'a'.repeat(181); }, config => { config.rules[0].daysOfWeek = [1, 1]; },
    config => { config.rules[0].daysOfWeek = []; }, config => { config.rules[0].activeFrom = '2026-02-30'; },
    config => { config.rules[0].activeFrom = '2026-10-26'; config.rules[0].activeUntil = '2026-10-25'; },
    config => { config.rules[0].startTime = '24:00'; }, config => { config.rules[0].endTime = '05:00'; },
    config => { config.rules[0].frequency = 'entry'; }, config => { config.rules[0].metric = 'steps'; },
    config => { config.rules[9].frequency = 'day'; }, config => { config.rules[9].minValue = 100001; },
    config => { config.rules[9].minValue = 0.5; }, config => { config.rules[9].minValue = null; config.rules[9].maxValue = null; },
    config => { config.rules[9].cooldownMinutes = 5; }, config => { config.rules = Array(41).fill(config.rules[0]); },
  ];
  for (const mutate of invalid) { const config = defaultGuidanceConfig(); mutate(config); assert.throws(() => validateGuidanceConfiguration(config), status(400)); }
});
test('Guidance scope inheritance, monotonic revisions, retries and conflicts preserve saved drafts', t => {
  const db = fixture(t), defaults = clinicianVoiceGuidance(db, clinician, 'p001');
  assert.equal(defaults.inherited, true); assert.equal(defaults.revision, 0); assert.equal(defaults.exists, false);
  const global = save(db, configWith('meal-photo', { text: '합성 공통 안내' }));
  assert.equal(patientVoiceGuidance(db, patient, 'p001').configuration.rules[0].text, '합성 공통 안내');
  const input = { revision: 0, clientRequestId: randomUUID(), configuration: configWith('meal-photo', { text: '합성 개별 안내' }) };
  const local = saveClinicianVoiceGuidance(db, clinician, 'p001', input);
  assert.equal(local.inherited, false); assert.equal(local.revision, 1); assert.notEqual(local.configurationKey, global.configurationKey);
  assert.deepEqual(saveClinicianVoiceGuidance(db, clinician, 'p001', input), local);
  assert.throws(() => saveClinicianVoiceGuidance(db, clinician, 'p001', { ...input, configuration: defaultGuidanceConfig() }), status(409));
  assert.throws(() => saveClinicianVoiceGuidance(db, clinician, 'p001', { ...input, clientRequestId: randomUUID() }), status(409));
  const inherited = saveClinicianVoiceGuidance(db, clinician, 'p001', { revision: 1, clientRequestId: randomUUID(), inherit: true });
  assert.equal(inherited.revision, 2); assert.equal(inherited.inherited, true); assert.equal(inherited.exists, false);
  assert.equal(inherited.configuration.rules[0].text, '합성 공통 안내');
  assert.deepEqual(saveClinicianVoiceGuidance(db, clinician, 'p001', input), local, 'response-loss retry preserves originally saved response');
  assert.equal(clinicianVoiceGuidance(db, clinician, 'p001').revision, 2);
});
test('Guidance read/write capabilities and assigned-patient restrictions apply before UUID replay', t => {
  const db = fixture(t), scoped = { ...clinician, assignedPatientIds: ['p001'] }, support = { ...scoped, capabilities: ['patient.read'] };
  const input = { revision: 0, clientRequestId: randomUUID(), configuration: defaultGuidanceConfig() };
  saveClinicianVoiceGuidance(db, clinician, null, input);
  assert.throws(() => saveClinicianVoiceGuidance(db, scoped, null, input), status(403));
  assert.equal(clinicianVoiceGuidance(db, scoped).canWrite, false);
  assert.equal(clinicianVoiceGuidance(db, scoped, 'p001').canWrite, true);
  assert.equal(clinicianVoiceGuidance(db, support, 'p001').canWrite, false);
  assert.throws(() => clinicianVoiceGuidance(db, scoped, 'p002'), status(403));
  assert.throws(() => saveClinicianVoiceGuidance(db, support, 'p001', input), status(403));
  assert.throws(() => clinicianVoiceGuidance(db, patient), status(403));
  assert.throws(() => patientVoiceGuidance(db, patient, 'p002'), status(403));
  assert.throws(() => patientVoiceGuidance(db, null, 'p001'), status(401));
  assert.throws(() => clinicianVoiceGuidance(db, { ...clinician, capabilities: ['research.read'] }), status(403));
});
test('Guidance config and write receipt are atomic and additive schema reopening preserves prior patient data', t => {
  const db = fixture(t), old = db.prepare('SELECT * FROM daily_records WHERE patient_id=? ORDER BY date').all('p001');
  ensureVoiceGuidanceSchema(db); assert.deepEqual(db.prepare('SELECT * FROM daily_records WHERE patient_id=? ORDER BY date').all('p001'), old);
  db.exec("CREATE TRIGGER fail_guidance_receipt BEFORE INSERT ON voice_guidance_submissions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  assert.throws(() => save(db, defaultGuidanceConfig()));
  assert.equal(clinicianVoiceGuidance(db, clinician).revision, 0);
  db.exec('DROP TRIGGER fail_guidance_receipt');
  assert.equal(save(db, defaultGuidanceConfig()).revision, 1);
});
test('Guidance patient preference is persistent, own-patient only and cannot override clinician disable', t => {
  const db = fixture(t); assert.equal(patientVoiceGuidance(db, patient, 'p001', now).serverTime, now.toISOString());
  assert.deepEqual(patientVoiceGuidance(db, patient, 'p001').preference, { enabled: true, configured: false });
  assert.throws(() => saveVoiceGuidancePreference(db, clinician, 'p001', { enabled: false }), status(403));
  assert.throws(() => saveVoiceGuidancePreference(db, patient, 'p002', { enabled: false }), status(403));
  assert.deepEqual(saveVoiceGuidancePreference(db, patient, 'p001', { enabled: false }), { preference: { enabled: false, configured: true } });
  assert.equal(claim(db).reason, 'disabled'); ensureVoiceGuidanceSchema(db);
  assert.equal(patientVoiceGuidance(db, patient, 'p001').preference.enabled, false);
  assert.equal(patientVoiceGuidance(db, patient, 'p001').preference.configured, true);
  saveVoiceGuidancePreference(db, patient, 'p001', { enabled: true });
  const config = defaultGuidanceConfig(); config.enabled = false; save(db, config);
  assert.equal(claim(db).reason, 'disabled');
});
test('Guidance atomic reservation prevents concurrent tabs; only onstart consumes daily rule; release/ACK retry are idempotent', t => {
  const db = fixture(t), first = claim(db); assert.equal(first.allowed, true);
  assert.equal(claim(db).reason, 'reserved_elsewhere');
  assert.deepEqual(ack(db, first, 'released'), { ok: true, outcome: 'released' });
  assert.deepEqual(ack(db, first, 'released'), { ok: true, outcome: 'released' });
  assert.throws(() => ack(db, first), status(409));
  const retry = claim(db); assert.equal(retry.allowed, true); assert.notEqual(retry.claimId, first.claimId);
  assert.throws(() => ack(db, first, 'released'), status(404));
  assert.deepEqual(ack(db, retry), { ok: true, outcome: 'started' });
  assert.deepEqual(ack(db, retry), { ok: true, outcome: 'started' });
  assert.deepEqual(ack(db, retry, 'released'), { ok: true, outcome: 'started' });
  assert.equal(claim(db).reason, 'already_started');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_guidance_playbacks').get().n, 1);
});
test('Guidance lease expires, stale receipts cannot claim new reservations, and patient ownership is mandatory', t => {
  const db = fixture(t), first = claim(db), later = new Date(now.getTime() + 30000);
  assert.throws(() => ack(db, first, 'started', later), status(409));
  const retry = claim(db, 'meal-photo', {}, later); assert.equal(retry.allowed, true);
  assert.throws(() => ack(db, first, 'started', later), status(404));
  assert.throws(() => receiveVoiceGuidanceReceipt(db, { ...patient, patientId: 'p002' }, 'p002', retry.claimId, { outcome: 'started' }), status(404));
  assert.throws(() => receiveVoiceGuidanceReceipt(db, clinician, 'p001', retry.claimId, { outcome: 'started' }), status(403));
  ack(db, retry, 'started', later);
});
test('Guidance uses KST exact half-open windows, weekdays, active dates and next-day renewal', t => {
  const db = fixture(t); save(db, configWith('morning', { condition: 'always' }));
  assert.deepEqual(guidanceClock(new Date('2026-10-24T15:00:00Z')), { date: '2026-10-25', time: '00:00', weekday: 0 });
  assert.equal(claim(db, 'morning', {}, at('05:59')).reason, 'outside_window');
  const first = claim(db, 'morning', {}, at('06:00')); assert.equal(first.allowed, true); ack(db, first, 'started', at('06:00'));
  assert.equal(claim(db, 'morning', {}, at('11:59')).reason, 'already_started');
  assert.equal(claim(db, 'morning', {}, at('12:00')).reason, 'outside_window');
  assert.equal(claim(db, 'morning', {}, new Date('2026-10-26T06:00:00+09:00')).allowed, true);
  save(db, configWith('morning', { condition: 'always', daysOfWeek: [1] }));
  assert.equal(claim(db, 'morning').reason, 'outside_window');
  save(db, configWith('morning', { condition: 'always', activeFrom: '2026-10-26' }));
  assert.equal(claim(db, 'morning').reason, 'outside_window');
  save(db, configWith('morning', { condition: 'always', activeUntil: '2026-10-24' }));
  assert.equal(claim(db, 'morning').reason, 'outside_window');
});
test('Guidance config edit invalidates queued key without resetting same rule daily start', t => {
  const db = fixture(t), settings = patientVoiceGuidance(db, patient, 'p001'), first = claim(db); ack(db, first);
  save(db, configWith('meal-photo', { text: '합성 문장 변경' }));
  assert.equal(claimVoiceGuidance(db, patient, 'p001', { configurationKey: settings.configurationKey, ruleId: 'meal-photo', event: 'meal_open' }, now).reason, 'configuration_changed');
  assert.equal(claim(db).reason, 'already_started');
});
test('Guidance entry frequency respects concurrent day cap and cooldown while distinct value warnings bypass day cap', t => {
  const db = fixture(t); save(db, configWith('meal-photo', { frequency: 'entry', maxPerDay: 2, cooldownMinutes: 5 }));
  assert.throws(() => claim(db), status(400));
  const first = claim(db, 'meal-photo', { contextId: randomUUID() }); ack(db, first);
  assert.equal(claim(db, 'meal-photo', { contextId: randomUUID() }).reason, 'cooldown');
  const later = new Date(now.getTime() + 5 * 60000), second = claim(db, 'meal-photo', { contextId: randomUUID() }, later); assert.equal(second.allowed, true);
  assert.equal(claim(db, 'meal-photo', { contextId: randomUUID() }, later).reason, 'daily_limit');
  ack(db, second, 'started', later);
  assert.equal(claim(db, 'meal-photo', { contextId: randomUUID() }, new Date(now.getTime() + 10 * 60000)).reason, 'daily_limit');
});
test('Guidance numeric checks retain zero, reject blank/null/future/invalid units and hash exact value/date without transcript storage', t => {
  const db = fixture(t), body = { recordDate: '2026-10-25', value: 10 };
  const first = claim(db, 'steps-check', body); assert.equal(first.text, '입력한 10걸음이 맞나요? 다시 확인해 주세요.'); ack(db, first);
  assert.equal(claim(db, 'steps-check', body).reason, 'already_started');
  for (const value of [0, 11, 12, 50001, 100000]) { const result = claim(db, 'steps-check', { ...body, value }); assert.equal(result.allowed, true); ack(db, result); }
  for (const value of [100, 50000, 3000]) assert.equal(claim(db, 'steps-check', { ...body, value }).reason, 'condition_not_met');
  for (const value of [null, '', -1, 100001, .5]) assert.throws(() => claim(db, 'steps-check', { ...body, value }), status(400));
  assert.throws(() => claim(db, 'steps-check', { ...body, recordDate: '2026-10-26' }), status(400));
  assert.equal(claim(db, 'steps-check', { ...body, recordDate: '2026-10-24' }).allowed, true);
  const sleep = claim(db, 'sleep-check', { ...body, value: .2 }); assert.equal(sleep.text, '입력한 수면 0.2시간이 맞나요? 다시 확인해 주세요.');
  assert.equal(claim(db, 'sleep-check', { ...body, value: 2 }).reason, 'condition_not_met');
  assert.equal(claim(db, 'sleep-check', { ...body, value: 14 }).reason, 'condition_not_met');
  const rows = db.prepare('SELECT bucket FROM voice_guidance_playbacks').all(); assert.ok(rows.every(row => /^value:[0-9a-f]{64}$/.test(row.bucket)));
  const columns = db.prepare('PRAGMA table_info(voice_guidance_playbacks)').all().map(row => row.name);
  assert.ok(!columns.includes('text')); assert.ok(!columns.includes('value')); assert.ok(!columns.includes('record_date'));
});
test('Guidance current records evaluate missing meal/sleep/steps and zero is an existing record', t => {
  const db = fixture(t), date = '2026-10-25';
  db.prepare('DELETE FROM daily_records WHERE patient_id=? AND date=?').run('p001', date);
  db.prepare('DELETE FROM meals WHERE patient_id=? AND date=?').run('p001', date);
  save(db, configWith('meal-photo', { condition: 'missing_sleep' })); assert.equal(claim(db).allowed, true);
  db.prepare('INSERT INTO daily_records(id,patient_id,date,steps,sleep_hours,medication_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'p001', date, 0, 0, 'taken', now.toISOString(), now.toISOString());
  assert.equal(claim(db).reason, 'condition_not_met');
  save(db, configWith('meal-photo', { condition: 'missing_steps' })); assert.equal(claim(db).reason, 'condition_not_met');
  save(db, configWith('meal-photo', { condition: 'missing_breakfast' })); assert.equal(claim(db).reason, 'reserved_elsewhere');
  db.prepare('INSERT INTO meals(id,patient_id,date,meal_type,food_type,portion,calories,protein_grams,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'p001', date, 'breakfast', 'balanced', 1, 620, 25, now.toISOString());
  assert.equal(claim(db).reason, 'condition_not_met');
  save(db, configWith('morning')); assert.equal(claim(db, 'morning').reason, 'condition_not_met');
});
test('Guidance medication condition uses actual due slots, reported unknown is not pending, and future slots are not due', t => {
  const db = fixture(t); save(db, configWith('medication', { condition: 'pending_medication' }));
  const order = createMedicationOrder(db, 'p001', { name: '합성 약', strength: '1mg', dose: '1정', route: 'oral', times: ['10:00'], startDate: '2026-10-25', endDate: null, instructions: '' });
  assert.equal(claim(db, 'medication', {}, at('09:59')).reason, 'condition_not_met');
  const due = claim(db, 'medication', {}, at('10:00')); assert.equal(due.allowed, true); ack(db, due, 'released', at('10:00'));
  saveMedicationEvent(db, 'p001', { orderId: order.id, date: '2026-10-25', time: '10:00', status: 'unknown', reason: '', note: '' });
  assert.equal(claim(db, 'medication', {}, at('11:00')).reason, 'condition_not_met');
});
test('Guidance patient deletion cascades overrides/preferences/claims/submissions; explicit reset also removes global settings', t => {
  const db = fixture(t); save(db, configWith('meal-photo')); save(db, configWith('meal-photo'), 'p001');
  saveVoiceGuidancePreference(db, patient, 'p001', { enabled: true }); ack(db, claim(db));
  db.prepare('DELETE FROM patients WHERE id=?').run('p001');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_guidance_preferences').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_guidance_playbacks').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM voice_guidance_submissions WHERE scope_key='patient:p001'").get().n, 0);
  assert.equal(clinicianVoiceGuidance(db, clinician).revision, 1);
  seedDatabase(db, 'empty');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_guidance_config').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_guidance_submissions').get().n, 0);
  assert.deepEqual(clinicianVoiceGuidance(db, clinician).configuration, defaultGuidanceConfig());
});
