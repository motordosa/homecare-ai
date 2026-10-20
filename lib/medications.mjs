import { randomUUID } from 'node:crypto';
import { todayKorea, transaction } from './db.mjs';
import { allowedKeys, choice, dateValue, HttpError, objectBody, textValue } from './validation.mjs';

// These plans are entered and confirmed by a clinician in the demo UI. They are
// deliberately independent of patients.medications, which is legacy free text.
export function ensureMedicationSchema(db) {
  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS medication_orders (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        name TEXT NOT NULL, strength TEXT NOT NULL DEFAULT '', dose TEXT NOT NULL,
        route TEXT NOT NULL DEFAULT '', times TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT, instructions TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(id,patient_id), CHECK(end_date IS NULL OR end_date>=start_date)
      );
      CREATE TABLE IF NOT EXISTS medication_events (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('taken','missed','unknown')),
        reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL CHECK(revision>=1),
        reported_at TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(order_id,date,time), UNIQUE(id,patient_id),
        FOREIGN KEY(order_id,patient_id) REFERENCES medication_orders(id,patient_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS medication_event_audit (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL, order_id TEXT NOT NULL,
        date TEXT NOT NULL, time TEXT NOT NULL, revision INTEGER NOT NULL,
        previous_json TEXT, current_json TEXT NOT NULL, changed_at TEXT NOT NULL,
        UNIQUE(event_id,revision),
        FOREIGN KEY(event_id,patient_id) REFERENCES medication_events(id,patient_id) ON DELETE CASCADE,
        FOREIGN KEY(order_id,patient_id) REFERENCES medication_orders(id,patient_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS medication_orders_patient_dates ON medication_orders(patient_id,start_date,end_date);
      CREATE INDEX IF NOT EXISTS medication_events_patient_date ON medication_events(patient_id,date,time);
      CREATE INDEX IF NOT EXISTS medication_audit_patient_date ON medication_event_audit(patient_id,date,time,revision);
    `);
  });
}

function requirePatient(db, patientId) {
  if (typeof patientId !== 'string' || !db.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
}

function requireOrder(db, orderId, patientId) {
  const row = typeof orderId === 'string' ? db.prepare('SELECT * FROM medication_orders WHERE id=?').get(orderId) : null;
  if (!row || (patientId !== undefined && row.patient_id !== patientId)) throw new HttpError(404, '복약계획을 찾을 수 없습니다.');
  return row;
}

function timeValue(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new HttpError(400, '복용 시각은 HH:MM 형식이어야 합니다.');
  return value;
}

function timesValue(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new HttpError(400, '복용 시각은 1~12개 입력해 주세요.');
  const times = value.map(timeValue);
  if (new Set(times).size !== times.length) throw new HttpError(400, '복용 시각이 중복되었습니다.');
  return times.sort();
}

function orderFromRow(row) {
  return {
    id: row.id, patientId: row.patient_id, name: row.name, strength: row.strength,
    dose: row.dose, route: row.route, times: JSON.parse(row.times),
    startDate: row.start_date, endDate: row.end_date, instructions: row.instructions,
    status: row.status === 'ended' || (row.end_date && row.end_date < todayKorea()) ? 'ended' : 'active',
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function eventFromRow(row) {
  return {
    id: row.id, patientId: row.patient_id, orderId: row.order_id,
    date: row.date, time: row.time, status: row.status, reason: row.reason,
    note: row.note, revision: row.revision, reportedAt: row.reported_at,
  };
}

function eventSnapshot(event) {
  return { status: event.status, reason: event.reason, note: event.note, revision: event.revision, reportedAt: event.reportedAt };
}

export function getMedicationOrders(db, patientId) {
  requirePatient(db, patientId);
  return db.prepare('SELECT * FROM medication_orders WHERE patient_id=? ORDER BY start_date,name,id').all(patientId).map(orderFromRow);
}

export function createMedicationOrder(db, patientId, input) {
  requirePatient(db, patientId);
  const body = objectBody(input);
  allowedKeys(body, ['name', 'strength', 'dose', 'route', 'times', 'startDate', 'endDate', 'instructions']);
  const name = textValue(body.name, '약명', { min: 1, max: 120 });
  const strength = body.strength === undefined ? '' : textValue(body.strength, '함량', { max: 100 });
  const dose = textValue(body.dose, '1회량', { min: 1, max: 100 });
  const route = body.route === undefined ? '' : textValue(body.route, '투여 경로', { max: 80 });
  const times = timesValue(body.times);
  const startDate = dateValue(body.startDate);
  const endDate = body.endDate === null || body.endDate === undefined ? null : dateValue(body.endDate);
  if (endDate && endDate < startDate) throw new HttpError(400, '종료일은 시작일보다 빠를 수 없습니다.');
  const instructions = body.instructions === undefined ? '' : textValue(body.instructions, '주의문', { max: 2000 });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO medication_orders (id,patient_id,name,strength,dose,route,times,start_date,end_date,instructions,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)`)
    .run(id, patientId, name, strength, dose, route, JSON.stringify(times), startDate, endDate, instructions, now, now);
  return orderFromRow(requireOrder(db, id, patientId));
}

export function endMedicationOrder(db, orderId, input) {
  const body = objectBody(input);
  allowedKeys(body, ['endDate']);
  const endDate = dateValue(body.endDate);
  return transaction(db, () => {
    const order = requireOrder(db, orderId);
    if (endDate < todayKorea() || endDate < order.start_date) throw new HttpError(400, '종료일은 오늘과 시작일 이상이어야 합니다.');
    if (order.end_date && endDate > order.end_date) throw new HttpError(400, '종료한 기간을 연장할 수 없습니다. 새 복약계획을 만들어 주세요.');
    const latest = db.prepare('SELECT MAX(date) AS date FROM medication_events WHERE order_id=?').get(orderId).date;
    if (latest && endDate < latest) throw new HttpError(409, '이미 보고된 회차보다 앞선 날짜로 종료할 수 없습니다.');
    if (order.status !== 'ended' || order.end_date !== endDate) db.prepare("UPDATE medication_orders SET end_date=?,status='ended',updated_at=? WHERE id=?").run(endDate, new Date().toISOString(), orderId);
    return orderFromRow(requireOrder(db, orderId));
  });
}

export function medicationSchedule(db, patientId, requestedDate) {
  requirePatient(db, patientId);
  const date = dateValue(requestedDate ?? todayKorea());
  // A manually ended plan still owns all its dates up to and including endDate.
  // Never filter by its present-day status when reconstructing past schedules.
  const orders = db.prepare('SELECT * FROM medication_orders WHERE patient_id=? AND start_date<=? AND (end_date IS NULL OR end_date>=?) ORDER BY name,id').all(patientId, date, date).map(orderFromRow);
  const events = db.prepare('SELECT * FROM medication_events WHERE patient_id=? AND date=?').all(patientId, date).map(eventFromRow);
  const bySlot = new Map(events.map(event => [JSON.stringify([event.orderId, event.time]), event]));
  const slots = orders.flatMap(order => order.times.map(time => {
    const event = bySlot.get(JSON.stringify([order.id, time]));
    return {
      orderId: order.id, patientId, date, time, name: order.name, strength: order.strength,
      dose: order.dose, route: order.route, instructions: order.instructions,
      status: event?.status ?? 'pending', eventId: event?.id ?? null,
      reason: event?.reason ?? '', note: event?.note ?? '', revision: event?.revision ?? 0,
      reportedAt: event?.reportedAt ?? null,
    };
  })).sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name) || a.orderId.localeCompare(b.orderId));
  const summary = { total: slots.length, taken: 0, missed: 0, unknown: 0, pending: 0, reported: 0 };
  for (const slot of slots) { summary[slot.status]++; if (slot.status !== 'pending') summary.reported++; }
  return { date, orders, slots, summary };
}

// SAVEPOINT allows a photo report to commit several events and its evidence atomically.
function medicationEventTransaction(db, action) {
  db.exec('SAVEPOINT medication_event_write');
  try { const result = action(); db.exec('RELEASE medication_event_write'); return result; }
  catch (error) { db.exec('ROLLBACK TO medication_event_write; RELEASE medication_event_write'); throw error; }
}

export function saveMedicationEvent(db, patientId, input) {
  requirePatient(db, patientId);
  const body = objectBody(input);
  allowedKeys(body, ['orderId', 'date', 'time', 'status', 'reason', 'note']);
  const orderId = textValue(body.orderId, '복약계획 ID', { min: 1, max: 100 });
  const date = dateValue(body.date ?? todayKorea());
  if (date > todayKorea()) throw new HttpError(400, '미래 날짜의 복약을 보고할 수 없습니다.');
  const time = timeValue(body.time);
  const status = choice(body.status, '복약 상태', ['taken', 'missed', 'unknown']);
  const reason = body.reason === undefined ? '' : textValue(body.reason, '사유', { max: 1000 });
  const note = body.note === undefined ? '' : textValue(body.note, '메모', { max: 2000 });
  return medicationEventTransaction(db, () => {
    const order = requireOrder(db, orderId, patientId);
    if (date < order.start_date || (order.end_date && date > order.end_date) || !JSON.parse(order.times).includes(time)) throw new HttpError(400, '해당 날짜와 시각은 복약계획에 포함되지 않습니다.');
    const oldRow = db.prepare('SELECT * FROM medication_events WHERE order_id=? AND date=? AND time=?').get(orderId, date, time);
    const old = oldRow ? eventFromRow(oldRow) : null;
    if (old && old.status === status && old.reason === reason && old.note === note) return old;
    const now = new Date().toISOString();
    const id = old?.id ?? randomUUID();
    const revision = (old?.revision ?? 0) + 1;
    db.prepare(`INSERT INTO medication_events (id,patient_id,order_id,date,time,status,reason,note,revision,reported_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id,date,time) DO UPDATE SET
      status=excluded.status,reason=excluded.reason,note=excluded.note,revision=excluded.revision,reported_at=excluded.reported_at`)
      .run(id, patientId, orderId, date, time, status, reason, note, revision, now, oldRow?.created_at ?? now);
    const event = eventFromRow(db.prepare('SELECT * FROM medication_events WHERE id=?').get(id));
    db.prepare(`INSERT INTO medication_event_audit (id,patient_id,event_id,order_id,date,time,revision,previous_json,current_json,changed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), patientId, id, orderId, date, time, revision, old ? JSON.stringify(eventSnapshot(old)) : null, JSON.stringify(eventSnapshot(event)), now);
    return event;
  });
}

export function getMedicationEvents(db, patientId, requestedDate) {
  requirePatient(db, patientId);
  const date = dateValue(requestedDate ?? todayKorea());
  const events = db.prepare('SELECT * FROM medication_events WHERE patient_id=? AND date=? ORDER BY time,order_id').all(patientId, date).map(eventFromRow);
  const audit = db.prepare('SELECT * FROM medication_event_audit WHERE patient_id=? AND date=? ORDER BY time,order_id,revision').all(patientId, date).map(row => ({
    id: row.id, eventId: row.event_id, patientId: row.patient_id, orderId: row.order_id,
    date: row.date, time: row.time, revision: row.revision,
    previous: row.previous_json === null ? null : JSON.parse(row.previous_json),
    current: JSON.parse(row.current_json), changedAt: row.changed_at,
  }));
  return { date, events, audit };
}
