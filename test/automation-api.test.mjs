import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=';
const dayOffset = (date, offset) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// This is the original schema, intentionally without the new module tables or
// meal-estimation columns. Starting the server must upgrade it without reseeding.
function createLegacyDatabase(dataDir, date) {
  const db = new DatabaseSync(join(dataDir, 'homecare.sqlite'));
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE patients (
        id TEXT PRIMARY KEY,name TEXT NOT NULL,age INTEGER NOT NULL,sex TEXT NOT NULL,
        conditions TEXT NOT NULL DEFAULT '[]',medications TEXT NOT NULL DEFAULT '[]',
        caregiver TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE daily_records (
        id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT NOT NULL,steps INTEGER,sleep_hours REAL,medication_status TEXT,
        appetite TEXT,mood TEXT,note TEXT NOT NULL DEFAULT '',weight_kg REAL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(patient_id,date)
      );
      CREATE TABLE meals (
        id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT NOT NULL,meal_type TEXT NOT NULL,food_type TEXT NOT NULL,portion REAL NOT NULL,
        calories REAL NOT NULL,protein_grams REAL NOT NULL,image_filename TEXT,
        source TEXT NOT NULL DEFAULT 'demo-food-table-v1',created_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO metadata VALUES ('initialized',?)").run(now);
    db.prepare("INSERT INTO metadata VALUES ('mode','empty')").run();
    db.prepare('INSERT INTO patients (id,name,age,sex,medications,created_at) VALUES (?,?,?,?,?,?)')
      .run('legacy-001', '합성 보존 환자', 79, 'female', JSON.stringify(['옛 자유문자열이며 확정 처방 아님']), now);
    db.prepare('INSERT INTO daily_records (id,patient_id,date,steps,sleep_hours,medication_status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('legacy-daily', 'legacy-001', date, 0, 6.25, 'unknown', '마이그레이션 보존용 합성 메모', now, now);
    db.prepare('INSERT INTO meals (id,patient_id,date,meal_type,food_type,portion,calories,protein_grams,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('legacy-meal', 'legacy-001', date, 'lunch', 'balanced', .5, 310, 12.5, 'demo-food-table-v1', now);
  } finally { db.close(); }
}

async function localFixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homecare-automation-api-'));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  createLegacyDatabase(dataDir, date);
  let child;
  let base;
  let output = '';
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const running = child;
    await new Promise(resolve => {
      const force = setTimeout(() => running.kill('SIGKILL'), 2500);
      running.once('exit', () => { clearTimeout(force); resolve(); });
      running.kill('SIGTERM');
    });
  }
  t.after(async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); });
  async function start() {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    output = '';
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-8000); });
    child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-8000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      if (child.exitCode !== null) throw new Error(`Local fixture server exited: ${output}`);
      await delay(50);
    }
    throw new Error(`Local fixture server did not start: ${output}`);
  }
  async function request(path, { method = 'GET', body, token, status = 200 } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    // Never include headers, token or a whole response in an assertion failure.
    assert.equal(response.status, status, `${method} ${path}: expected HTTP ${status}`);
    return response.json();
  }
  async function text(path) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, `GET ${path}`);
    return response.text();
  }
  await start();
  return { request, text, restart: async () => { await stop(); await start(); }, today: date, dataDir };
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  const csv = text.replace(/^\ufeff/, '');
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"' && quoted && csv[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { record.push(cell); cell = ''; }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index++;
      record.push(cell); records.push(record); record = []; cell = '';
    } else cell += char;
  }
  if (cell || record.length) { record.push(cell); records.push(record); }
  const [columns, ...rows] = records;
  return { columns, rows: rows.map(row => Object.fromEntries(columns.map((key, index) => [key, row[index] ?? '']))) };
}

test('automation APIs migrate an original DB and preserve medication and health provenance over HTTP', async t => {
  const app = await localFixture(t);
  const { request, today } = app;
  const yesterday = dayOffset(today, -1);
  const tomorrow = dayOffset(today, 1);
  let medicationPatient;
  let medicationOrder;
  let healthPatient;
  let otherPatient;
  let connection;
  let token;
  const createPatient = async name => (await request('/api/patients', { method: 'POST', status: 201, body: { name, age: 80, sex: 'female' } })).patient;

  await t.test('original patient, explicit zero, notes and meal survive additive migration', async () => {
    const health = await request('/api/health');
    assert.ok(health.schemaVersion >= 2);
    assert.deepEqual(health.counts, { patients: 1, dailyRecords: 1, meals: 1 });
    const summary = await request('/api/patients/legacy-001/summary');
    assert.equal(summary.patient.name, '합성 보존 환자');
    assert.equal(summary.todayRecord.steps, 0);
    assert.equal(summary.todayRecord.sleepHours, 6.25);
    assert.equal(summary.todayRecord.note, '마이그레이션 보존용 합성 메모');
    assert.equal(summary.todayMeals[0].id, 'legacy-meal');
    assert.equal(summary.todayMeals[0].calories, 310);
    assert.deepEqual((await request('/api/patients/legacy-001/medication-orders')).orders, []);
    const raw = await request(`/api/patients/legacy-001/daily?date=${today}`);
    assert.equal(raw.record.steps, 0);
    const db = new DatabaseSync(join(app.dataDir, 'homecare.sqlite'));
    try {
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      for (const table of ['medication_orders', 'medication_events', 'medication_event_audit', 'health_connections', 'health_daily', 'health_batches', 'photo_analyses']) {
        assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), `migration adds ${table}`);
      }
    } finally { db.close(); }
  });

  await t.test('two-dose plans keep pending distinct and preserve corrected events and audit', async () => {
    medicationPatient = await createPatient('합성 복약 환자');
    otherPatient = await createPatient('합성 분리 환자');
    const path = `/api/patients/${medicationPatient.id}`;
    medicationOrder = (await request(`${path}/medication-orders`, { method: 'POST', status: 201, body: { name: '확정 테스트 약', strength: '테스트 함량', dose: '1정', route: '경구', times: ['18:00', '08:00'], startDate: yesterday, instructions: '의료진 확인 테스트 입력' } })).order;
    assert.deepEqual(medicationOrder.times, ['08:00', '18:00']);
    let schedule = await request(`${path}/medication-schedule?date=${today}`);
    assert.deepEqual(schedule.summary, { total: 2, taken: 0, missed: 0, unknown: 0, pending: 2, reported: 0 });
    assert.ok(schedule.slots.every(slot => slot.status === 'pending' && slot.revision === 0 && slot.eventId === null));
    const body = { orderId: medicationOrder.id, date: today, time: '08:00', status: 'taken' };
    const initial = (await request(`${path}/medication-events`, { method: 'POST', body })).event;
    assert.equal(initial.revision, 1);
    const correction = { ...body, status: 'missed', reason: '기억을 확인하여 정정', note: '합성 테스트 기록' };
    const corrected = (await request(`${path}/medication-events`, { method: 'POST', body: correction })).event;
    const repeated = (await request(`${path}/medication-events`, { method: 'POST', body: correction })).event;
    assert.equal(corrected.id, initial.id);
    assert.equal(corrected.revision, 2);
    assert.deepEqual(repeated, corrected);
    const history = await request(`${path}/medication-events?date=${today}`);
    assert.equal(history.events.length, 1);
    assert.equal(history.audit.length, 2);
    assert.equal(history.audit[0].previous, null);
    assert.equal(history.audit[1].previous.status, 'taken');
    assert.equal(history.audit[1].current.status, 'missed');
    schedule = await request(`${path}/medication-schedule?date=${today}`);
    assert.deepEqual(schedule.summary, { total: 2, taken: 0, missed: 1, unknown: 0, pending: 1, reported: 1 });
    assert.equal((await request(`${path}/daily?date=${today}`)).record, null);
    await request(`/api/patients/${otherPatient.id}/medication-events`, { method: 'POST', status: 404, body });
    assert.equal((await request(`/api/patients/${otherPatient.id}/medication-schedule?date=${today}`)).slots.length, 0);
    await request(`/api/medication-orders/${medicationOrder.id}`, { method: 'PATCH', body: { endDate: today } });
    assert.equal((await request(`${path}/medication-schedule?date=${today}`)).slots.length, 2);
    assert.equal((await request(`${path}/medication-schedule?date=${tomorrow}`)).slots.length, 0);
    assert.equal((await request(`${path}/medication-schedule?date=${yesterday}`)).summary.pending, 2);
    const csv = parseCsv(await app.text('/api/export.csv'));
    assert.ok(csv.rows.some(row => row.recordType === 'medication' && row.patientId === medicationPatient.id), 'CSV includes per-dose reports');
  });

  await t.test('unconfigured external vision is explicit and never fabricates analysis', async () => {
    const capabilities = await request('/api/capabilities');
    assert.equal(capabilities.vision.available, false);
    assert.equal(capabilities.vision.enabled, false);
    assert.equal(capabilities.vision.configured, false);
    assert.equal(capabilities.health.webDirectCollection, false);
    const result = await request('/api/patients/legacy-001/photo-analyses', { method: 'POST', status: 503, body: { kind: 'meal', imageData: png, consentExternalProcessing: true } });
    assert.equal(typeof result.error, 'string');
    assert.equal(result.analysis, undefined);
  });

  await t.test('native token is revealed once and batches are isolated, idempotent and revision aware', async () => {
    healthPatient = await createPatient('합성 건강 수신 환자');
    const path = `/api/patients/${healthPatient.id}`;
    const created = await request(`${path}/health-connections`, { method: 'POST', status: 201, body: { platform: 'health-connect', label: '로컬 테스트 연결' } });
    connection = created.connection;
    token = created.token;
    assert.ok(typeof token === 'string' && token.length > 40, 'creation returns a connection secret');
    assert.equal(connection.status, 'awaiting_native');
    const listed = await request(`${path}/health-connections`);
    assert.equal(listed.selectedConnectionId, connection.id);
    assert.ok(!JSON.stringify(listed).includes(token), 'GET connections never returns a secret');
    assert.ok(!JSON.stringify(listed).includes('token_hash'), 'GET connections never returns token hashes');
    const identity = await request('/api/health-sync/connection', { token });
    assert.deepEqual(identity, { connectionId: connection.id, patientId: healthPatient.id, platform: 'health-connect', partialMetrics: true, selected: true });
    await request('/api/health-sync/connection', { status: 401 });
    const revision = new Date(Date.now() - 600000).toISOString();
    const body = { batchId: 'first-fixture-batch', timeZone: 'Asia/Seoul', days: [{ date: today, steps: 9876, sleepMinutes: 390, updatedAt: revision }, { date: yesterday, steps: 3000, sleepMinutes: 360, updatedAt: revision }] };
    const first = await request('/api/health-sync', { method: 'POST', token, body });
    assert.equal(first.patientId, healthPatient.id);
    assert.equal(first.acceptedDays, 2);
    assert.equal(first.duplicate, false);
    assert.ok(!JSON.stringify(first).includes(token), 'sync response never returns a secret');
    const repeated = await request('/api/health-sync', { method: 'POST', token, body });
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.acceptedDays, 0);
    await request('/api/health-sync', { method: 'POST', token, status: 409, body: { ...body, days: [{ ...body.days[0], steps: 1 }, body.days[1]] } });
    const stale = await request('/api/health-sync', { method: 'POST', token, body: { batchId: 'stale-fixture-batch', timeZone: 'Asia/Seoul', days: [{ date: today, steps: 1, sleepMinutes: 1, updatedAt: new Date(Date.now() - 700000).toISOString() }] } });
    assert.equal(stale.acceptedDays, 0);
    assert.equal(stale.ignoredDays, 1);
    assert.equal((await request(`${path}/health-connections`)).connections[0].status, 'connected');
    assert.equal((await request(`/api/patients/${otherPatient.id}/summary`)).todayRecord, null);
    await request(`/api/patients/${otherPatient.id}/health-connections/${connection.id}`, { method: 'DELETE', status: 404 });
    await request('/api/health-sync', { method: 'POST', status: 401, body });
  });

  await t.test('effective summaries preserve device provenance, manual zero priority and clear-to-device fallback', async () => {
    const path = `/api/patients/${healthPatient.id}`;
    let summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 9876);
    assert.equal(summary.todayRecord.sleepHours, 6.5);
    assert.equal(summary.todayRecord.stepsSource, 'health-connect');
    assert.equal(summary.todayRecord.sleepSource, 'health-connect');
    assert.equal(summary.todayRecord.dataOrigin, 'device');
    assert.equal(summary.trends.find(day => day.date === today).stepsSource, 'health-connect');
    assert.equal(summary.trends.find(day => day.date === today).sleepSource, 'health-connect');
    assert.equal(summary.metrics.steps.sourceCounts['health-connect'], 2);
    assert.equal(summary.metrics.sleepHours.sourceCounts['health-connect'], 2);
    assert.equal((await request(`${path}/daily?date=${today}`)).record, null);
    await request(`${path}/daily`, { method: 'POST', body: { date: today, steps: 0 } });
    const manual = (await request(`${path}/daily?date=${today}`)).record;
    assert.equal(manual.steps, 0);
    assert.equal(manual.sleepHours, null);
    summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 0);
    assert.equal(summary.todayRecord.stepsSource, 'patient-self-report');
    assert.equal(summary.todayRecord.sleepHours, 6.5);
    assert.equal(summary.todayRecord.sleepSource, 'health-connect');
    assert.equal(summary.todayRecord.dataOrigin, 'mixed');
    assert.equal(summary.metrics.steps.sourceCounts['patient-self-report'], 1);
    assert.equal(summary.metrics.steps.sourceCounts['health-connect'], 1);
    await request(`${path}/daily`, { method: 'POST', body: { date: today, steps: null, sleepHours: 0 } });
    summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 9876);
    assert.equal(summary.todayRecord.stepsSource, 'health-connect');
    assert.equal(summary.todayRecord.sleepHours, 0);
    assert.equal(summary.todayRecord.sleepSource, 'patient-self-report');
    await request(`${path}/daily`, { method: 'POST', body: { date: today, sleepHours: null } });
    summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord.sleepHours, 6.5);
    assert.equal(summary.todayRecord.sleepSource, 'health-connect');
    assert.equal(summary.todayRecord.appetite, null);
    assert.equal(summary.todayRecord.mood, null);
    const csvText = await app.text('/api/export.csv');
    assert.ok(!csvText.includes(token), 'CSV never exposes connection secrets');
    const csv = parseCsv(csvText);
    assert.ok(csv.columns.includes('stepsSource'));
    assert.ok(csv.columns.includes('sleepSource'));
    const daily = csv.rows.find(row => row.recordType === 'daily' && row.patientId === healthPatient.id && row.date === today);
    assert.ok(daily, 'CSV includes effective daily values');
    assert.equal(daily.steps, '9876');
    assert.equal(daily.stepsSource, 'health-connect');
    assert.equal(daily.sleepSource, 'health-connect');
    assert.ok(csv.rows.some(row => row.recordType === 'health' && row.patientId === healthPatient.id), 'CSV distinguishes device snapshots');
  });

  await t.test('new device zero/null replaces old totals; revocation blocks both identity and new batches', async () => {
    const body = { batchId: 'zero-and-deletion-fixture', timeZone: 'Asia/Seoul', days: [{ date: today, steps: 0, sleepMinutes: null, updatedAt: new Date(Date.now() - 1000).toISOString() }] };
    const response = await request('/api/health-sync', { method: 'POST', token, body });
    assert.equal(response.acceptedDays, 1);
    const path = `/api/patients/${healthPatient.id}`;
    const summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 0);
    assert.equal(summary.todayRecord.stepsSource, 'health-connect');
    assert.equal(summary.todayRecord.sleepHours, null);
    assert.equal(summary.todayRecord.sleepSource, null);
    const revoked = await request(`${path}/health-connections/${connection.id}`, { method: 'DELETE' });
    assert.equal(revoked.connection.status, 'revoked');
    assert.equal((await request(`${path}/health-connections`)).selectedConnectionId, null);
    await request('/api/health-sync/connection', { token, status: 401 });
    await request('/api/health-sync', { method: 'POST', token, status: 401, body: { ...body, batchId: 'post-revocation-fixture' } });
    assert.ok(parseCsv(await app.text('/api/export.csv')).rows.some(row => row.recordType === 'health' && row.patientId === healthPatient.id), 'revocation preserves historical device snapshots in export');
  });

  await t.test('selected platforms are never added and device-only null snapshots do not fabricate reports', async () => {
    const patient = await createPatient('합성 선택 출처 환자');
    const path = `/api/patients/${patient.id}`;
    const android = await request(`${path}/health-connections`, { method: 'POST', status: 201, body: { platform: 'health-connect' } });
    const firstRevision = new Date(Date.now() - 500000).toISOString();
    const updateRevision = new Date(Date.now() - 300000).toISOString();
    const clearRevision = new Date(Date.now() - 100000).toISOString();
    const batch = (batchId, steps, sleepMinutes, updatedAt = firstRevision) => ({ batchId, timeZone: 'Asia/Seoul', days: [{ date: today, steps, sleepMinutes, updatedAt }] });
    await request('/api/health-sync', { method: 'POST', token: android.token, body: batch('android-initial', 1000, 300) });
    assert.equal((await request(`${path}/summary`)).todayRecord.steps, 1000);
    const apple = await request(`${path}/health-connections`, { method: 'POST', status: 201, body: { platform: 'apple-health' } });
    assert.equal((await request(`${path}/summary`)).todayRecord, null);
    await request('/api/health-sync', { method: 'POST', token: apple.token, body: batch('apple-initial', 500, 240) });
    await request('/api/health-sync', { method: 'POST', token: android.token, body: batch('android-not-selected', 10000, 600, updateRevision) });
    let summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 500);
    assert.equal(summary.todayRecord.sleepHours, 4);
    assert.equal(summary.todayRecord.stepsSource, 'apple-health');
    assert.equal(summary.metrics.steps.sourceCounts['apple-health'], 1);
    await request('/api/health-sync', { method: 'POST', token: apple.token, body: batch('apple-clear', null, null, clearRevision) });
    summary = await request(`${path}/summary`);
    assert.equal(summary.todayRecord, null);
    assert.equal(summary.metrics.steps.value, null);
    assert.equal(summary.metrics.sleepHours.value, null);
    assert.equal(summary.metrics.completion.reportedDays, 0);
    const trend = summary.trends.find(day => day.date === today);
    assert.equal(trend.steps, null);
    assert.equal(trend.sleepHours, null);
    assert.equal(trend.stepsSource, null);
    assert.equal(trend.sleepSource, null);
    assert.equal(trend.hasDaily, false);
    assert.equal((await request(`${path}/daily?date=${today}`)).record, null);
    await request(`${path}/health-connections/${apple.connection.id}`, { method: 'DELETE' });
    assert.equal((await request(`${path}/health-connections`)).selectedConnectionId, null);
    assert.equal((await request(`${path}/summary`)).todayRecord, null);
  });

  await t.test('restart preserves legacy rows, medication revisions and revoked connections', async () => {
    await app.restart();
    const legacy = await request('/api/patients/legacy-001/summary');
    assert.equal(legacy.todayRecord.note, '마이그레이션 보존용 합성 메모');
    assert.equal(legacy.todayMeals[0].id, 'legacy-meal');
    const events = await request(`/api/patients/${medicationPatient.id}/medication-events?date=${today}`);
    assert.equal(events.events[0].revision, 2);
    assert.equal(events.audit.length, 2);
    const orders = await request(`/api/patients/${medicationPatient.id}/medication-orders`);
    assert.equal(orders.orders[0].id, medicationOrder.id);
    assert.equal(orders.orders[0].status, 'ended');
    const connections = await request(`/api/patients/${healthPatient.id}/health-connections`);
    assert.equal(connections.connections[0].status, 'revoked');
    assert.ok(!JSON.stringify(connections).includes(token), 'restart cannot reveal a connection secret');
    const db = new DatabaseSync(join(app.dataDir, 'homecare.sqlite'));
    try { assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); }
    finally { db.close(); }
  });
});
