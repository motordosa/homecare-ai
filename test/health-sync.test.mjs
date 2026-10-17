import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureHealthSchema, getHealthConnections, createHealthConnection,
  revokeHealthConnection, receiveHealthBatch, healthDailyForPatient, getHealthConnectionIdentity,
} from '../lib/health-sync.mjs';

const day = (overrides = {}) => ({ date: '2026-01-02', steps: 2400, sleepMinutes: 420, updatedAt: '2026-01-03T12:00:00+09:00', ...overrides });
const batch = (overrides = {}) => ({ batchId: 'fixture-1', timeZone: 'Asia/Seoul', days: [day()], ...overrides });

function setup(t, filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO patients(id) VALUES ('fixture-patient-a'),('fixture-patient-b');
    CREATE TABLE IF NOT EXISTS legacy_marker(value TEXT);
  `);
  ensureHealthSchema(db);
  t.after(() => db.close());
  return db;
}

function expectStatus(status, operation) {
  assert.throws(operation, error => error.status === status, `expected HTTP ${status}`);
}

test('health schema is additive, repeatable and safe inside an existing transaction', t => {
  const db = setup(t);
  db.prepare('INSERT INTO legacy_marker(value) VALUES (?)').run('preserved');
  db.exec('BEGIN');
  ensureHealthSchema(db);
  db.exec('COMMIT');
  ensureHealthSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM patients').get().count, 2);
  assert.equal(db.prepare('SELECT value FROM legacy_marker').get().value, 'preserved');
  assert.deepEqual(getHealthConnections(db, 'fixture-patient-a'), {
    connections: [], selectedConnectionId: null, webDirectCollection: false,
    nativeBridge: { implemented: false, verified: false },
  });
});

test('connection creation issues a one-time 256-bit secret and stores only its hash', t => {
  const db = setup(t);
  const first = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect', label: '연결 시험' });
  assert.ok(/^hc_[A-Za-z0-9_-]{43}$/.test(first.token), 'connection secret format');
  const row = db.prepare('SELECT * FROM health_connections WHERE id=?').get(first.connection.id);
  const digest = createHash('sha256').update(first.token).digest('hex');
  assert.ok(row.token_hash === digest, 'stored hash matches issued secret');
  assert.ok(!Object.values(row).includes(first.token), 'no plaintext secret stored');
  const second = createHealthConnection(db, 'fixture-patient-b', { platform: 'apple-health' });
  assert.ok(first.token !== second.token, 'secrets are independent');
  const state = getHealthConnections(db, 'fixture-patient-a');
  assert.equal(state.connections.length, 1);
  assert.equal(state.connections[0].status, 'awaiting_native');
  assert.equal(state.connections[0].lastReceivedAt, null);
  assert.equal(state.selectedConnectionId, first.connection.id);
  assert.ok(!JSON.stringify(state).includes(first.token), 'secret never reappears in read responses');
  assert.ok(!JSON.stringify(state).includes(digest), 'hash stays private');
  expectStatus(404, () => createHealthConnection(db, 'missing-patient', { platform: 'apple-health' }));
  expectStatus(400, () => createHealthConnection(db, 'fixture-patient-a', { platform: 'unsupported' }));
  expectStatus(400, () => createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health', patientId: 'fixture-patient-b' }));
  expectStatus(400, () => createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health', label: '' }));
});

test('real receiver acceptance changes state without claiming native verification', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const result = receiveHealthBatch(db, connection.token, batch());
  assert.deepEqual({ patientId: result.patientId, acceptedDays: result.acceptedDays, ignoredDays: result.ignoredDays, duplicate: result.duplicate }, {
    patientId: 'fixture-patient-a', acceptedDays: 1, ignoredDays: 0, duplicate: false,
  });
  const state = getHealthConnections(db, 'fixture-patient-a');
  assert.equal(state.connections[0].status, 'connected');
  assert.equal(state.connections[0].lastReceivedAt, result.receivedAt);
  assert.deepEqual(state.nativeBridge, { implemented: false, verified: false });
  const rows = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].steps, 2400);
  assert.equal(rows[0].sleepHours, 7);
  assert.equal(rows[0].platform, 'health-connect');
  assert.equal(rows[0].source, 'health-connect');
  assert.equal(rows[0].connectionId, connection.connection.id);
  assert.equal(rows[0].updatedAt, '2026-01-03T03:00:00.000000000Z');
});

test('native preflight exposes only its patient binding and shares receiver authentication rules', t => {
  const db = setup(t);
  const original = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const identity = getHealthConnectionIdentity(db, original.token);
  assert.ok(Math.abs(Date.now() - Date.parse(identity.serverTime)) < 2000);
  assert.deepEqual(identity, {
    connectionId: original.connection.id, patientId: 'fixture-patient-a', platform: 'health-connect', partialMetrics: true, selected: true, serverTime: identity.serverTime,
  });
  let state = getHealthConnections(db, 'fixture-patient-a');
  assert.equal(state.connections[0].status, 'awaiting_native');
  assert.equal(state.connections[0].lastReceivedAt, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_batches').get().count, 0);
  const replacement = createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health' });
  assert.equal(getHealthConnectionIdentity(db, original.token).connectionId, original.connection.id);
  assert.equal(getHealthConnectionIdentity(db, original.token).selected, false);
  receiveHealthBatch(db, original.token, batch());
  state = getHealthConnections(db, 'fixture-patient-a');
  assert.equal(state.selectedConnectionId, replacement.connection.id);
  assert.equal(state.connections.find(item => item.id === original.connection.id).status, 'connected');
  assert.deepEqual(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31'), []);
  const other = createHealthConnection(db, 'fixture-patient-b', { platform: 'health-connect' });
  assert.equal(getHealthConnectionIdentity(db, other.token).patientId, 'fixture-patient-b');
  for (const invalid of [undefined, null, '', 'invalid', `hc_${'A'.repeat(43)}`]) {
    expectStatus(401, () => getHealthConnectionIdentity(db, invalid));
    expectStatus(401, () => receiveHealthBatch(db, invalid, batch()));
  }
  revokeHealthConnection(db, 'fixture-patient-a', original.connection.id);
  expectStatus(401, () => getHealthConnectionIdentity(db, original.token));
  expectStatus(401, () => receiveHealthBatch(db, original.token, batch()));
  db.prepare('DELETE FROM patients WHERE id=?').run('fixture-patient-b');
  expectStatus(401, () => getHealthConnectionIdentity(db, other.token));
});

test('duplicate batches are no-ops while reused IDs with changed content conflict', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const original = receiveHealthBatch(db, connection.token, batch());
  const duplicate = receiveHealthBatch(db, connection.token, batch());
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.acceptedDays, 0);
  assert.equal(duplicate.receivedAt, original.receivedAt);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_batches').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 1);
  expectStatus(409, () => receiveHealthBatch(db, connection.token, batch({ days: [day({ steps: 999 })] })));
  assert.equal(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0].steps, 2400);
  // Object key order, day order and equivalent timestamp offsets do not alter semantic content.
  const equivalent = receiveHealthBatch(db, connection.token, { days: [{ updatedAt: '2026-01-03T03:00:00Z', sleepMinutes: 420, steps: 2400, date: '2026-01-02' }], timeZone: 'Asia/Seoul', batchId: 'fixture-1' });
  assert.equal(equivalent.duplicate, true);
});

test('only a newer revision replaces a day, including explicit zero and null deletion snapshots', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health' });
  receiveHealthBatch(db, connection.token, batch());
  const old = receiveHealthBatch(db, connection.token, batch({ batchId: 'old', days: [day({ steps: 9000, updatedAt: '2026-01-03T02:59:59Z' })] }));
  assert.equal(old.acceptedDays, 0);
  assert.equal(old.ignoredDays, 1);
  const equal = receiveHealthBatch(db, connection.token, batch({ batchId: 'equal', days: [day({ steps: 5000, updatedAt: '2026-01-03T03:00:00Z' })] }));
  assert.equal(equal.ignoredDays, 1);
  const updated = receiveHealthBatch(db, connection.token, batch({ batchId: 'zero', days: [day({ steps: 0, sleepMinutes: null, updatedAt: '2026-01-03T03:00:01Z' })] }));
  assert.equal(updated.acceptedDays, 1);
  let record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, 0);
  assert.equal(record.sleepHours, null);
  receiveHealthBatch(db, connection.token, batch({ batchId: 'clear', days: [day({ steps: null, sleepMinutes: 0, updatedAt: '2026-01-03T03:00:02Z' })] }));
  record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, null);
  assert.equal(record.sleepHours, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 1);
});

test('nanosecond and offset revisions are compared as absolute instants', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  receiveHealthBatch(db, connection.token, batch({ days: [day({ steps: 1, updatedAt: '2026-01-03T12:00:00.000000001+09:00' })] }));
  const newer = receiveHealthBatch(db, connection.token, batch({ batchId: 'nano-new', days: [day({ steps: 2, updatedAt: '2026-01-03T03:00:00.000000002Z' })] }));
  assert.equal(newer.acceptedDays, 1);
  const older = receiveHealthBatch(db, connection.token, batch({ batchId: 'nano-old', days: [day({ steps: 3, updatedAt: '2026-01-03T12:00:00.000000001+09:00' })] }));
  assert.equal(older.ignoredDays, 1);
  assert.equal(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0].steps, 2);
});

test('selection uses one connection without adding platforms or falling back on revoke', t => {
  const db = setup(t);
  const android = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  receiveHealthBatch(db, android.token, batch({ days: [day({ steps: 2000 })] }));
  const apple = createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health' });
  assert.deepEqual(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31'), []);
  receiveHealthBatch(db, apple.token, batch({ days: [day({ steps: 3000 })] }));
  const selected = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31');
  assert.equal(selected[0].steps, 3000);
  assert.equal(selected[0].platform, 'apple-health');
  const state = getHealthConnections(db, 'fixture-patient-a');
  assert.equal(state.connections.filter(item => item.selected).length, 1);
  assert.equal(state.selectedConnectionId, apple.connection.id);
  revokeHealthConnection(db, 'fixture-patient-a', apple.connection.id);
  assert.equal(getHealthConnections(db, 'fixture-patient-a').selectedConnectionId, null);
  assert.deepEqual(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31'), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 2);
});

test('tokens are bound to their patient, revocation is idempotent and blocks all later batches', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health' });
  expectStatus(401, () => receiveHealthBatch(db, undefined, batch()));
  expectStatus(401, () => receiveHealthBatch(db, 'invalid', batch()));
  expectStatus(401, () => receiveHealthBatch(db, `hc_${'A'.repeat(43)}`, batch()));
  expectStatus(400, () => receiveHealthBatch(db, connection.token, { ...batch(), patientId: 'fixture-patient-b' }));
  expectStatus(400, () => receiveHealthBatch(db, connection.token, batch({ days: [day({ patientId: 'fixture-patient-b' })] })));
  receiveHealthBatch(db, connection.token, batch());
  assert.deepEqual(healthDailyForPatient(db, 'fixture-patient-b', '2026-01-01', '2026-01-31'), []);
  expectStatus(404, () => revokeHealthConnection(db, 'fixture-patient-b', connection.connection.id));
  const first = revokeHealthConnection(db, 'fixture-patient-a', connection.connection.id);
  const second = revokeHealthConnection(db, 'fixture-patient-a', connection.connection.id);
  assert.equal(first.connection.revokedAt, second.connection.revokedAt);
  assert.equal(second.connection.status, 'revoked');
  expectStatus(401, () => receiveHealthBatch(db, connection.token, batch()));
  expectStatus(401, () => receiveHealthBatch(db, connection.token, batch({ batchId: 'new' })));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 1);
});

test('batch validation is atomic and distinguishes missing, null, zero and numeric limits', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const invalidDays = [
    day({ steps: -1 }), day({ steps: 100001 }), day({ steps: 1.5 }), day({ steps: '20' }), day({ steps: undefined }),
    day({ sleepMinutes: -1 }), day({ sleepMinutes: 1441 }), day({ sleepMinutes: '20' }), day({ sleepMinutes: undefined }),
    day({ date: '2026-02-30' }), day({ date: '2200-01-01' }), day({ updatedAt: '2026-01-03T12:00:00' }),
    day({ updatedAt: '2026-02-30T12:00:00Z' }), day({ updatedAt: '2200-01-01T00:00:00Z' }),
    day({ updatedAt: '2026-01-03T24:00:00Z' }), day({ updatedAt: '2026-01-03T12:00:00+25:00' }),
    day({ unexpected: true }), null,
  ];
  for (const invalid of invalidDays) expectStatus(400, () => receiveHealthBatch(db, connection.token, batch({ days: [day({ date: '2026-01-01' }), invalid] })));
  for (const input of [null, [], {}, batch({ timeZone: 'UTC' }), batch({ batchId: '' }), batch({ days: [] }), batch({ days: [day(), day()] }), { ...batch(), extra: true }]) {
    expectStatus(400, () => receiveHealthBatch(db, connection.token, input));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_batches').get().count, 0);
  assert.equal(getHealthConnections(db, 'fixture-patient-a').connections[0].status, 'awaiting_native');
  receiveHealthBatch(db, connection.token, batch({ days: [day({ steps: 100000, sleepMinutes: 1440 })] }));
  receiveHealthBatch(db, connection.token, batch({ batchId: 'fractional-minutes', days: [day({ sleepMinutes: 120.5, updatedAt: '2026-01-04T00:00:00Z' })] }));
  assert.equal(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0].sleepMinutes, 120.5);
});

test('31-day batches are accepted, 32 rejected, and queries stay date/patient bounded', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const days = Array.from({ length: 31 }, (_, index) => day({ date: `2026-01-${String(index + 1).padStart(2, '0')}` }));
  const result = receiveHealthBatch(db, connection.token, batch({ days: [...days].reverse() }));
  assert.equal(result.acceptedDays, 31);
  assert.deepEqual(healthDailyForPatient(db, 'fixture-patient-a', '2026-01-10', '2026-01-12').map(row => row.date), ['2026-01-10', '2026-01-11', '2026-01-12']);
  expectStatus(400, () => receiveHealthBatch(db, connection.token, batch({ batchId: 'too-many', days: [...days, day({ date: '2026-02-01' })] })));
  expectStatus(400, () => healthDailyForPatient(db, 'fixture-patient-a', '2026-01-31', '2026-01-01'));
  expectStatus(404, () => healthDailyForPatient(db, 'missing-patient', '2026-01-01', '2026-01-31'));
});

test('patient deletion cascades all health records and invalidates tokens', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'apple-health' });
  receiveHealthBatch(db, connection.token, batch());
  db.prepare('DELETE FROM patients WHERE id=?').run('fixture-patient-a');
  for (const table of ['health_connections', 'health_daily', 'health_batches']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  expectStatus(401, () => receiveHealthBatch(db, connection.token, batch()));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM patients').get().count, 1);
});

test('stored snapshots, selection and replay protection survive a fresh DB connection', t => {
  const directory = mkdtempSync(join(tmpdir(), 'homecare-health-fixture-'));
  const filename = join(directory, 'fixture.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = new DatabaseSync(filename);
  first.exec("PRAGMA foreign_keys=ON; CREATE TABLE patients (id TEXT PRIMARY KEY); INSERT INTO patients VALUES ('fixture-patient-a');");
  ensureHealthSchema(first);
  const connection = createHealthConnection(first, 'fixture-patient-a', { platform: 'health-connect' });
  receiveHealthBatch(first, connection.token, batch());
  first.close();
  const second = new DatabaseSync(filename);
  try {
    second.exec('PRAGMA foreign_keys=ON');
    ensureHealthSchema(second);
    assert.equal(getHealthConnections(second, 'fixture-patient-a').selectedConnectionId, connection.connection.id);
    assert.equal(healthDailyForPatient(second, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0].steps, 2400);
    assert.equal(receiveHealthBatch(second, connection.token, batch()).duplicate, true);
  } finally { second.close(); }
});

test('partial snapshots preserve omitted metrics and distinguish omission, null and zero in replay hashes', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const stepsOnly = { date: '2026-01-02', steps: 0, updatedAt: '2026-01-03T03:00:00Z' };
  const payload = batch({ days: [stepsOnly] });
  receiveHealthBatch(db, connection.token, payload);
  ensureHealthSchema(db);
  let record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, 0);
  assert.equal(record.sleepMinutes, null);
  assert.equal(record.sleepUpdatedAt, null, 'restart must not invent a sleep revision');
  assert.equal(record.stepsUpdatedAt, '2026-01-03T03:00:00.000000000Z');
  assert.equal(receiveHealthBatch(db, connection.token, payload).duplicate, true);
  expectStatus(409, () => receiveHealthBatch(db, connection.token, batch({ days: [{ ...stepsOnly, sleepMinutes: null }] })));
  receiveHealthBatch(db, connection.token, batch({ batchId: 'sleep-before-step', days: [{ date: stepsOnly.date, sleepMinutes: 120, updatedAt: '2026-01-03T02:00:00Z' }] }));
  record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, 0);
  assert.equal(record.sleepMinutes, 120);
  assert.equal(record.updatedAt, record.stepsUpdatedAt);
});

test('metric revisions merge independently across partial and legacy full snapshots', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  receiveHealthBatch(db, connection.token, batch());
  receiveHealthBatch(db, connection.token, batch({ batchId: 'steps-latest', days: [{ date: '2026-01-02', steps: 900, updatedAt: '2026-01-03T05:00:00Z' }] }));
  const mixed = receiveHealthBatch(db, connection.token, batch({ batchId: 'legacy-in-between', days: [day({ steps: 1, sleepMinutes: 360, updatedAt: '2026-01-03T04:00:00Z' })] }));
  assert.equal(mixed.acceptedDays, 1);
  let record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, 900, 'older step value must not replace newer steps');
  assert.equal(record.sleepMinutes, 360, 'newer sleep value can arrive before the step revision');
  const stale = receiveHealthBatch(db, connection.token, batch({ batchId: 'stale', days: [day()] }));
  assert.equal(stale.ignoredDays, 1);
  receiveHealthBatch(db, connection.token, batch({ batchId: 'clear-sleep', days: [{ date: '2026-01-02', sleepMinutes: null, updatedAt: '2026-01-03T06:00:00Z' }] }));
  record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, 900);
  assert.equal(record.sleepMinutes, null);
  assert.equal(record.stepsUpdatedAt, '2026-01-03T05:00:00.000000000Z');
  assert.equal(record.sleepUpdatedAt, '2026-01-03T06:00:00.000000000Z');
});

test('old health tables and pending full-batch hashes migrate without losing values or replay protection', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  receiveHealthBatch(db, connection.token, batch());
  const oldNormalized = { batchId: 'fixture-1', timeZone: 'Asia/Seoul', days: [{ date: '2026-01-02', steps: 2400, sleepMinutes: 420, updatedAt: '2026-01-03T03:00:00.000000000Z' }] };
  assert.equal(db.prepare('SELECT body_hash FROM health_batches').get().body_hash, createHash('sha256').update(JSON.stringify(oldNormalized)).digest('hex'));
  db.exec('ALTER TABLE health_daily DROP COLUMN steps_updated_at; ALTER TABLE health_daily DROP COLUMN sleep_updated_at;');
  ensureHealthSchema(db);
  const record = healthDailyForPatient(db, 'fixture-patient-a', '2026-01-01', '2026-01-31')[0];
  assert.equal(record.steps, 2400);
  assert.equal(record.sleepMinutes, 420);
  assert.equal(record.stepsUpdatedAt, record.updatedAt);
  assert.equal(record.sleepUpdatedAt, record.updatedAt);
  assert.equal(receiveHealthBatch(db, connection.token, batch()).duplicate, true);
  ensureHealthSchema(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 1);
});

test('a missing metric is accepted only when another metric is present and invalid batches roll back completely', t => {
  const db = setup(t);
  const connection = createHealthConnection(db, 'fixture-patient-a', { platform: 'health-connect' });
  const first = { date: '2026-01-01', steps: 10, updatedAt: '2026-01-03T03:00:00Z' };
  for (const invalid of [
    { date: '2026-01-02', updatedAt: first.updatedAt },
    { date: '2026-01-02', steps: undefined, updatedAt: first.updatedAt },
    { date: '2026-01-02', sleepMinutes: -1, updatedAt: first.updatedAt },
  ]) expectStatus(400, () => receiveHealthBatch(db, connection.token, batch({ days: [first, invalid] })));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_batches').get().count, 0);
});
