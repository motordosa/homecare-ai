import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dateOffset, openDatabase, seedDatabase, todayKorea } from '../lib/db.mjs';
import {
  createMedicationOrder, endMedicationOrder, ensureMedicationSchema, getMedicationEvents,
  getMedicationOrders, medicationSchedule, saveMedicationEvent,
} from '../lib/medications.mjs';

const today = todayKorea();
const yesterday = dateOffset(today, -1);
const tomorrow = dateOffset(today, 1);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'homecare-medication-test-'));
  const { db } = openDatabase(dir);
  ensureMedicationSchema(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, dir };
}

function makeOrder(db, extra = {}) {
  return createMedicationOrder(db, 'p001', {
    name: '확정 복약계획 테스트용', strength: '테스트 함량', dose: '1정', route: '경구',
    times: ['18:00', '08:00'], startDate: yesterday, endDate: null,
    instructions: '의료진이 실제 약과 대조한 테스트 입력', ...extra,
  });
}

function isStatus(status) { return error => error.status === status; }

test('MED-01 additive schema is idempotent and legacy data does not create medication orders', t => {
  const { db } = fixture(t);
  const before = db.prepare('SELECT COUNT(*) AS count FROM daily_records').get().count;
  const legacy = db.prepare('SELECT medications FROM patients WHERE id=?').get('p001').medications;
  ensureMedicationSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM daily_records').get().count, before);
  assert.equal(db.prepare('SELECT medications FROM patients WHERE id=?').get('p001').medications, legacy);
  assert.deepEqual(getMedicationOrders(db, 'p001'), []);
  assert.deepEqual(medicationSchedule(db, 'p001', today).summary, { total: 0, taken: 0, missed: 0, unknown: 0, pending: 0, reported: 0 });
});

test('MED-01 multiple plans and times are scoped to a patient and inclusive dates', t => {
  const { db } = fixture(t);
  const order = makeOrder(db, { endDate: today });
  makeOrder(db, { name: '두 번째 계획', times: ['12:30'], startDate: today, endDate: today });
  assert.deepEqual(order.times, ['08:00', '18:00']);
  assert.equal(medicationSchedule(db, 'p001', yesterday).slots.length, 2);
  const schedule = medicationSchedule(db, 'p001', today);
  assert.equal(schedule.orders.length, 2);
  assert.deepEqual(schedule.slots.map(slot => slot.time), ['08:00', '12:30', '18:00']);
  assert.ok(schedule.slots.every(slot => slot.status === 'pending' && slot.eventId === null && slot.revision === 0 && slot.reportedAt === null));
  assert.equal(medicationSchedule(db, 'p001', tomorrow).slots.length, 0);
  assert.equal(medicationSchedule(db, 'p002', today).slots.length, 0);
});

test('MED-02 per-slot reports upsert without duplicates and preserve before/after audit', t => {
  const { db } = fixture(t);
  const order = makeOrder(db);
  const input = { orderId: order.id, date: today, time: '08:00', status: 'missed', reason: '잊어버림', note: '전화로 확인 예정' };
  const first = saveMedicationEvent(db, 'p001', input);
  const repeated = saveMedicationEvent(db, 'p001', input);
  assert.deepEqual(first, repeated);
  assert.equal(first.revision, 1);
  assert.equal(getMedicationEvents(db, 'p001', today).audit.length, 1);
  const corrected = saveMedicationEvent(db, 'p001', { ...input, status: 'taken', reason: '', note: '다시 확인하여 수정' });
  assert.equal(corrected.id, first.id);
  assert.equal(corrected.revision, 2);
  const history = getMedicationEvents(db, 'p001', today);
  assert.equal(history.events.length, 1);
  assert.equal(history.audit.length, 2);
  assert.equal(history.audit[0].previous, null);
  assert.equal(history.audit[0].current.status, 'missed');
  assert.equal(history.audit[1].previous.status, 'missed');
  assert.equal(history.audit[1].previous.reason, '잊어버림');
  assert.equal(history.audit[1].current.status, 'taken');
  assert.equal(history.audit[1].current.revision, 2);
  const schedule = medicationSchedule(db, 'p001', today);
  assert.equal(schedule.slots[0].eventId, corrected.id);
  assert.deepEqual(schedule.summary, { total: 2, taken: 1, missed: 0, unknown: 0, pending: 1, reported: 1 });
  assert.equal(db.prepare('SELECT medication_status FROM daily_records WHERE patient_id=? AND date=?').get('p001', today).medication_status, 'taken');
});

test('MED-02 unknown is an explicit report; absent remains pending even for old dates', t => {
  const { db } = fixture(t);
  const order = makeOrder(db);
  const unknown = saveMedicationEvent(db, 'p001', { orderId: order.id, date: yesterday, time: '08:00', status: 'unknown' });
  assert.equal(unknown.reason, '');
  assert.equal(unknown.note, '');
  assert.deepEqual(medicationSchedule(db, 'p001', yesterday).summary, { total: 2, taken: 0, missed: 0, unknown: 1, pending: 1, reported: 1 });
  const revised = saveMedicationEvent(db, 'p001', { orderId: order.id, date: yesterday, time: '08:00', status: 'unknown', note: '기억이 나지 않음' });
  assert.equal(revised.revision, 2);
});

test('MED-02 ownership, period, planned time, dates and statuses are validated', t => {
  const { db } = fixture(t);
  const order = makeOrder(db, { startDate: today, endDate: today });
  const body = { orderId: order.id, date: today, time: '08:00', status: 'taken' };
  assert.throws(() => saveMedicationEvent(db, 'p002', body), isStatus(404));
  assert.throws(() => saveMedicationEvent(db, 'missing', body), isStatus(404));
  assert.throws(() => saveMedicationEvent(db, 'p001', { ...body, orderId: 'missing' }), isStatus(404));
  for (const extra of [{ date: tomorrow }, { date: yesterday }, { date: '2026-02-30' }, { time: '09:00' }, { time: '24:00' }, { status: 'pending' }, { status: 'partial' }, { reason: null }, { note: 'x'.repeat(2001) }, { patientId: 'p002' }]) {
    assert.throws(() => saveMedicationEvent(db, 'p001', { ...body, ...extra }), isStatus(400));
  }
  assert.equal(getMedicationEvents(db, 'p001', today).events.length, 0);
});

test('MED-01 invalid and duplicate order times or malformed fields are rejected', t => {
  const { db } = fixture(t);
  for (const extra of [{ name: '' }, { dose: '' }, { times: [] }, { times: ['08:00', '08:00'] }, { times: ['8:00'] }, { times: ['23:60'] }, { times: '08:00' }, { startDate: '2026-02-31' }, { endDate: dateOffset(yesterday, -1) }, { status: 'active' }, { strength: null }]) {
    assert.throws(() => makeOrder(db, extra), isStatus(400));
  }
  const minimal = createMedicationOrder(db, 'p001', { name: '확정 이름', dose: '입력된 1회량', times: ['08:00'], startDate: today });
  assert.equal(minimal.route, '');
  assert.equal(minimal.strength, '');
  assert.equal(minimal.instructions, '');
  assert.equal(minimal.endDate, null);
});

test('MED-03 ending today preserves historical doses and allows past corrections', t => {
  const { db } = fixture(t);
  const order = makeOrder(db);
  const body = { orderId: order.id, date: yesterday, time: '08:00', status: 'missed', reason: '잊어버림' };
  saveMedicationEvent(db, 'p001', body);
  const ended = endMedicationOrder(db, order.id, { endDate: today });
  assert.equal(ended.status, 'ended');
  assert.equal(ended.endDate, today);
  assert.equal(medicationSchedule(db, 'p001', today).slots.length, 2);
  assert.equal(medicationSchedule(db, 'p001', tomorrow).slots.length, 0);
  assert.equal(medicationSchedule(db, 'p001', yesterday).slots[0].status, 'missed');
  const corrected = saveMedicationEvent(db, 'p001', { ...body, status: 'taken' });
  assert.equal(corrected.revision, 2);
  assert.equal(getMedicationEvents(db, 'p001', yesterday).audit.length, 2);
  assert.deepEqual(endMedicationOrder(db, order.id, { endDate: today }), ended);
  assert.throws(() => endMedicationOrder(db, order.id, { endDate: tomorrow }), isStatus(400));
  assert.throws(() => endMedicationOrder(db, order.id, { endDate: yesterday }), isStatus(400));
  assert.throws(() => endMedicationOrder(db, order.id, { endDate: today, name: '덮어쓰기' }), isStatus(400));
});

test('MED-03 ended plans cannot erase previously reported future imports', t => {
  const { db } = fixture(t);
  const order = makeOrder(db);
  // Simulate data imported under a previous system. Normal API reporting rejects future dates.
  db.prepare("INSERT INTO medication_events (id,patient_id,order_id,date,time,status,revision,reported_at,created_at) VALUES (?,?,?,?,?,'taken',1,?,?)")
    .run('imported-event', 'p001', order.id, tomorrow, '08:00', new Date().toISOString(), new Date().toISOString());
  assert.throws(() => endMedicationOrder(db, order.id, { endDate: today }), isStatus(409));
  assert.equal(getMedicationOrders(db, 'p001')[0].endDate, null);
});

test('MED-03 additional medication data survives reopen and explicit reset cascades', t => {
  const { db, dir } = fixture(t);
  const order = makeOrder(db);
  saveMedicationEvent(db, 'p001', { orderId: order.id, date: today, time: '08:00', status: 'taken' });
  const reopened = openDatabase(dir).db;
  try {
    ensureMedicationSchema(reopened);
    assert.equal(getMedicationOrders(reopened, 'p001').length, 1);
    assert.equal(getMedicationEvents(reopened, 'p001', today).audit.length, 1);
  } finally { reopened.close(); }
  seedDatabase(db, 'empty');
  for (const table of ['medication_orders', 'medication_events', 'medication_event_audit']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
