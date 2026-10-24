// Real local HTTP/SQLite integration only. All people and records are synthetic.
// No public service, actual Kakao account, external AI or clinical validation is used.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const servers = [];
let demo, today, clinician, patientActor;
async function start(mode, extra = {}) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const dir = await mkdtemp(join(tmpdir(), 'homecare-usability-api-'));
  const base = `http://127.0.0.1:${port}`;
  const args = ['--disable-warning=ExperimentalWarning'];
  if (mode === 'kakao') args.push('--import', './test/helpers/kakao-provider-fixture.mjs');
  args.push('server.mjs');
  const child = spawn(process.execPath, args, {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', AUTH_MODE: mode, APP_ORIGIN: mode === 'kakao' ? base : '',
      DATA_DIR: dir, PORT: String(port), VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '',
      KAKAO_CLIENT_ID: 'fixture', KAKAO_CLIENT_SECRET: 'fixture-secret', CLINICIAN_KAKAO_IDS: '101', STAFF_ACCESS_JSON: '', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const server = { child, base, dir }; servers.push(server);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return server; } catch {}
    if (child.exitCode !== null) throw Error(output);
    await delay(50);
  }
  throw Error('Temporary usability server did not become ready: ' + output);
}
async function call(server, path, { method = 'GET', body, actor, csrf = true } = {}) {
  return fetch(server.base + path, { method, headers: { 'Content-Type': 'application/json',
    ...(actor ? { Cookie: actor.cookie, ...(csrf ? { 'X-CSRF-Token': actor.csrf } : {}) } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(server, path, options) {
  const response = await call(server, path, options);
  assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
  return response.json();
}
async function demoLogin(role, patientId) {
  const response = await fetch(demo.base + '/api/auth/demo', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeCare-Demo': '1' }, body: JSON.stringify({ role, ...(patientId ? { patientId } : {}) }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  const session = await json(demo, '/api/auth/session', { actor: { cookie } });
  return { cookie, csrf: session.csrfToken, user: session.user };
}
async function kakaoLogin(server, id) {
  const start = await fetch(server.base + '/auth/kakao?next=%2Fclinician', { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const nonce = start.headers.getSetCookie()[0].split(';')[0];
  const finish = await fetch(server.base + `/auth/kakao/callback?state=${encodeURIComponent(state)}&code=fixture-${id}`, { headers: { Cookie: nonce }, redirect: 'manual' });
  assert.equal(finish.status, 302);
  const cookie = finish.headers.getSetCookie().map(value => value.split(';')[0]).find(value => /hc_session=/.test(value));
  assert.ok(cookie, 'mock OAuth establishes a real local server session');
  const session = await json(server, '/api/auth/session', { actor: { cookie } });
  return { cookie, csrf: session.csrfToken, user: session.user };
}
async function newPatient(name) {
  const response = await call(demo, '/api/patients', { method: 'POST', body: { name, age: 79, sex: 'female', conditions: ['합성 검증'] } });
  assert.equal(response.status, 201);
  return (await response.json()).patient;
}
before(async () => {
  demo = await start('demo'); today = (await json(demo, '/api/health')).today;
  clinician = await demoLogin('clinician'); patientActor = await demoLogin('patient', 'p001');
});
after(async () => {
  for (const server of servers) {
    if (server.child.exitCode === null) await new Promise(resolve => { server.child.once('exit', resolve); server.child.kill('SIGTERM'); });
    await rm(server.dir, { recursive: true, force: true });
  }
});

test('UX meal missing selection, unknown quantity, actual zero and retry identity remain distinct', async () => {
  const patient = await newPatient('섭취량 구분 검증');
  const path = `/api/patients/${patient.id}/meals`;
  const base = { date: today, mealType: 'lunch', foodType: 'balanced' };
  assert.equal((await call(demo, path, { method: 'POST', body: base })).status, 400, 'omission is not unknown');
  const unknownBody = { ...base, portion: null, clientSubmissionId: randomUUID() };
  const first = await call(demo, path, { method: 'POST', body: unknownBody });
  assert.equal(first.status, 201);
  const unknown = (await first.json()).meal;
  assert.equal(unknown.portion, null); assert.equal(unknown.calories, null); assert.equal(unknown.proteinGrams, null);
  const repeat = await call(demo, path, { method: 'POST', body: unknownBody });
  assert.ok([200, 201].includes(repeat.status)); assert.equal((await repeat.json()).meal.id, unknown.id);
  assert.equal((await call(demo, path, { method: 'POST', body: { ...unknownBody, portion: 1 } })).status, 409);
  const zeroResponse = await call(demo, path, { method: 'POST', body: { ...base, portion: 0, clientSubmissionId: randomUUID() } });
  assert.equal(zeroResponse.status, 201); const zero = (await zeroResponse.json()).meal;
  assert.equal(zero.portion, 0); assert.equal(zero.calories, 0); assert.equal(zero.proteinGrams, 0);
  const summary = await json(demo, `/api/patients/${patient.id}/summary`);
  assert.equal(summary.todayMeals.length, 2); assert.equal(summary.metrics.nutrition.unknownMealCount, 1);
  assert.equal(summary.metrics.nutrition.value, 0, 'known zero remains zero; missing is counted separately');
});

test('UX concurrent meal retries create one record and preserve the original request', async () => {
  const patient = await newPatient('재전송 검증');
  const body = { date: today, mealType: 'breakfast', foodType: 'protein', portion: .5, clientSubmissionId: randomUUID() };
  const responses = await Promise.all([1, 2].map(() => call(demo, `/api/patients/${patient.id}/meals`, { method: 'POST', body })));
  assert.ok(responses.every(response => [200, 201].includes(response.status)));
  const meals = await Promise.all(responses.map(async response => (await response.json()).meal));
  assert.equal(meals[0].id, meals[1].id);
  assert.equal((await json(demo, `/api/patients/${patient.id}/summary`)).todayMeals.length, 1);
});

test('UX dose-only self-report counts as participation without inventing a legacy daily score', async () => {
  const patient = await newPatient('약별 보고 검증');
  const response = await call(demo, `/api/patients/${patient.id}/medication-orders`, { method: 'POST', body: { name: '가상 약', dose: '1정', times: ['00:01'], startDate: today } });
  assert.equal(response.status, 201); const order = (await response.json()).order;
  const saved = await call(demo, `/api/patients/${patient.id}/medication-events`, { method: 'POST', body: { orderId: order.id, date: today, time: '00:01', status: 'unknown' } });
  assert.equal(saved.status, 200);
  const summary = await json(demo, `/api/patients/${patient.id}/summary`);
  assert.equal(summary.metrics.completion.reportedDays, 1);
  assert.equal(summary.lastRecordDate, today);
  assert.equal(summary.metrics.medication.value, null);
  assert.equal(summary.metrics.medication.doseReportedDays, 1);
  assert.ok(summary.trends.some(day => day.date === today && day.hasDoseReport));
});

test('UX daily revisions reject stale changes while preserving unrelated values', async () => {
  const patient = await newPatient('수정 충돌 검증');
  const path = `/api/patients/${patient.id}/daily`;
  let response = await call(demo, path, { method: 'POST', body: { date: today, steps: 0, note: '원래 메모', expectedRevision: 0 } });
  assert.equal(response.status, 200);
  const initial = (await json(demo, path + '?date=' + today)).record;
  assert.equal(initial.revision, 1);
  response = await call(demo, path, { method: 'POST', body: { date: today, sleepHours: 7.5, expectedRevision: 1 } });
  assert.equal(response.status, 200);
  response = await call(demo, path, { method: 'POST', body: { date: today, steps: 99, expectedRevision: 1 } });
  assert.equal(response.status, 409);
  const current = (await json(demo, path + '?date=' + today)).record;
  assert.equal(current.steps, 0); assert.equal(current.sleepHours, 7.5); assert.equal(current.note, '원래 메모'); assert.equal(current.revision, 2);
});

test('UX new staff surfaces require a session and reject patient role and missing CSRF', async () => {
  for (const path of ['/api/clinician/tasks', '/api/clinician/evidence', `/api/research/preview?startDate=${today}&endDate=${today}`, '/api/patients/p001/corrections']) {
    assert.equal((await call(demo, path)).status, 401, path + ' anonymous');
    assert.equal((await call(demo, path, { actor: patientActor })).status, 403, path + ' patient');
  }
  assert.equal((await call(demo, '/api/clinician/tasks', { method: 'POST', actor: clinician, csrf: false, body: {} })).status, 403);
  assert.equal((await call(demo, '/api/clinician/evidence/search', { method: 'POST', actor: clinician, csrf: false, body: { query: 'older adults', confirmNoPersonalData: true } })).status, 403);
  assert.equal((await call(demo, '/api/research/snapshots', { method: 'POST', actor: clinician, csrf: false, body: {} })).status, 403);
});

test('UX restricted support role cannot cross assigned-patient scope or write clinical orders', async () => {
  const server = await start('kakao', { STAFF_ACCESS_JSON: JSON.stringify({ '301': { roles: ['support'], patientIds: ['p001'] }, '401': { roles: ['researcher'], patientIds: ['p001'] } }) });
  const support = await kakaoLogin(server, '301');
  assert.ok(support.user.staffRoles.includes('support'));
  const dashboard = await json(server, '/api/dashboard', { actor: support });
  assert.deepEqual(dashboard.patients.map(patient => patient.id), ['p001']);
  assert.equal(dashboard.stats.patients, 1); assert.ok(dashboard.trends.every(day => day.reportingPatients <= 1));
  const selectedDashboard = await json(server, '/api/dashboard?patientIds=p001', { actor: support });
  assert.deepEqual(selectedDashboard.patients.map(patient => patient.id), ['p001']);
  assert.equal((await call(server, '/api/dashboard?unexpected=1', { actor: support })).status, 400);

  const patients = await json(server, '/api/patients', { actor: support });
  assert.deepEqual(patients.patients.map(patient => patient.id), ['p001']);
  assert.equal((await call(server, '/api/patients/p001/summary', { actor: support })).status, 200);
  for (const path of ['/api/patients/p002/summary', '/api/patients/p002/daily', '/api/patients/p002/meals', '/api/patients/p002/medication-orders', '/api/patients/p002/messages', '/api/patients/p002/corrections']) {
    assert.equal((await call(server, path, { actor: support })).status, 403, path);
  }
  assert.equal((await call(server, '/api/patients/p001/medication-orders', { actor: support, method: 'POST', body: { name: '권한 없는 약', dose: '1정', times: ['08:00'], startDate: today } })).status, 403);
  assert.equal((await call(server, '/api/demo/reset', { actor: support, method: 'POST', body: { mode: 'empty', confirmation: 'RESET' } })).status, 403);
  assert.equal((await call(server, '/api/export.csv', { actor: support })).status, 403);
  assert.equal((await call(server, '/api/patients/p001/daily', { actor: support, method: 'POST', body: { date: today, steps: 999 } })).status, 403, 'support proposes a correction instead of silently editing');
  assert.equal((await call(server, '/api/clinician/conversations', { actor: support })).status, 403);
  const work = await call(server, '/api/clinician/tasks', { actor: support, method: 'POST', body: { patientId: 'p001', type: 'clinical_review', title: '전문 검토 요청', clientRequestId: randomUUID() } });
  assert.equal(work.status, 201); const { task } = await work.json();
  assert.equal((await call(server, `/api/clinician/tasks/${task.id}`, { actor: support, method: 'PATCH', body: { version: task.version, status: 'completed', clientRequestId: randomUUID() } })).status, 403);
  const admin = await kakaoLogin(server, '101');
  const outside = await call(server, '/api/research/snapshots', { actor: admin, method: 'POST', body: { patientIds: ['p002'], startDate: today, endDate: today, source: 'all', clientRequestId: randomUUID() } });
  assert.equal(outside.status, 201); const snapshotId = (await outside.json()).snapshot.id;
  const researcher = await kakaoLogin(server, '401');
  const own = await json(server, `/api/research/preview?startDate=${today}&endDate=${today}`, { actor: researcher });
  assert.equal(own.summary.patientCount, 1);
  assert.equal((await call(server, `/api/research/preview?startDate=${today}&endDate=${today}&patientIds=p002`, { actor: researcher })).status, 403);
  for (const suffix of ['', '/export']) assert.equal((await call(server, `/api/research/snapshots/${snapshotId}${suffix}`, { actor: researcher })).status, 403);
  assert.equal((await call(server, '/api/patients/p001/summary', { actor: researcher })).status, 403, 'research access does not expose identified charts');

});


// The CSV parser checks quoted/multiline fields without treating embedded newlines as rows.
function csvRows(csv) {
  const rows = [], text = csv.replace(/^\uFEFF/, ''); let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if (char === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('UX selected-patient CSV preview and actual export share date scope and quoted row counts', async () => {
  const patient = await newPatient('내보내기 범위 검증');
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  await call(demo, `/api/patients/${patient.id}/daily`, { method: 'POST', body: { date: yesterday, steps: 10 } });
  await call(demo, `/api/patients/${patient.id}/daily`, { method: 'POST', body: { date: today, steps: 0, note: '쉼표,와 "인용"\n여러 줄 메모' } });
  await call(demo, `/api/patients/${patient.id}/meals`, { method: 'POST', body: { date: today, mealType: 'lunch', foodType: 'balanced', portion: null } });
  const query = `?patientId=${patient.id}&startDate=${today}&endDate=${today}`;
  const preview = await json(demo, '/api/export-preview' + query, { actor: clinician });
  assert.equal(preview.patientCount, 1); assert.equal(preview.scope.patientId, patient.id);
  assert.equal(preview.scope.includesIdentifiers, true);
  const response = await call(demo, '/api/export.csv' + query, { actor: clinician });
  assert.equal(response.status, 200);
  const rows = csvRows(await response.text());
  assert.deepEqual(rows.shift(), preview.columns); assert.equal(rows.length, preview.rowCount); assert.equal(rows.length, 2);
  const patientColumn = preview.columns.indexOf('patientId'), dateColumn = preview.columns.indexOf('date');
  assert.ok(rows.every(row => row[patientColumn] === patient.id && row[dateColumn] === today));
  assert.ok(rows.some(row => row[preview.columns.indexOf('note')] === '쉼표,와 "인용"\n여러 줄 메모'));
  assert.equal((await call(demo, `/api/export-preview?startDate=${today}&endDate=${yesterday}`, { actor: clinician })).status, 400);
});

test('UX research snapshot freezes values, excludes direct identifiers and hashes exact exported bytes', async () => {
  const patient = await newPatient('연구추출 비공개 이름');
  await call(demo, `/api/patients/${patient.id}/daily`, { method: 'POST', body: { date: today, steps: 0, note: '비공개 원문 메모' } });
  const initial = await json(demo, `/api/research/preview?startDate=${today}&endDate=${today}&patientIds=${patient.id}`, { actor: clinician });
  const body = { startDate: today, endDate: today, patientIds: [patient.id], source: 'all', clientRequestId: randomUUID(), expectedInputHash: initial.inputHash };
  const response = await call(demo, '/api/research/snapshots', { method: 'POST', actor: clinician, body });
  assert.equal(response.status, 201); const { snapshot } = await response.json();
  assert.equal(snapshot.result.summary.patientCount, 1); assert.equal(snapshot.result.metrics.steps.pooled.mean, 0);
  const replay = await call(demo, '/api/research/snapshots', { method: 'POST', actor: clinician, body });
  assert.equal((await replay.json()).snapshot.id, snapshot.id);
  await call(demo, `/api/patients/${patient.id}/daily`, { method: 'POST', body: { date: today, steps: 99, expectedRevision: 1 } });
  const live = await json(demo, `/api/research/preview?startDate=${today}&endDate=${today}&patientIds=${patient.id}`, { actor: clinician });
  assert.equal(live.metrics.steps.pooled.mean, 99);
  const stale = await call(demo, '/api/research/snapshots', { method: 'POST', actor: clinician, body: { ...body, clientRequestId: randomUUID() } });
  assert.equal(stale.status, 409, 'snapshot cannot silently use data changed after preview');
  const retry = await call(demo, '/api/research/snapshots', { method: 'POST', actor: clinician, body });
  assert.equal((await retry.json()).snapshot.id, snapshot.id);
  const frozen = await json(demo, `/api/research/snapshots/${snapshot.id}`, { actor: clinician });
  assert.equal(frozen.snapshot.result.metrics.steps.pooled.mean, 0);
  const exported = await json(demo, `/api/research/snapshots/${snapshot.id}/export`, { actor: clinician });
  assert.equal(createHash('sha256').update(exported.csv).digest('hex'), exported.manifest.csvSha256);
  assert.ok(exported.columns.includes('participantId')); assert.ok(!exported.columns.includes('patientId'));
  for (const privateValue of [patient.name, patient.id, '비공개 원문 메모']) assert.ok(!exported.csv.includes(privateValue), privateValue);
  assert.equal(csvRows(exported.csv).length - 1, exported.manifest.rowCount);
});

test('UX worklist retry identity and versions protect concurrent task changes', async () => {
  const body = { patientId: 'p001', type: 'contact', title: '합성 연락 확인', note: '전화 연결 여부 확인', clientRequestId: randomUUID() };
  const response = await call(demo, '/api/clinician/tasks', { method: 'POST', actor: clinician, body });
  assert.equal(response.status, 201); const { task } = await response.json();
  const replay = await call(demo, '/api/clinician/tasks', { method: 'POST', actor: clinician, body });
  assert.equal((await replay.json()).task.id, task.id);
  const update = await call(demo, `/api/clinician/tasks/${task.id}`, { method: 'PATCH', actor: clinician, body: { version: task.version, status: 'in_progress', clientRequestId: randomUUID() } });
  assert.equal(update.status, 200); assert.equal((await update.json()).task.version, task.version + 1);
  const stale = await call(demo, `/api/clinician/tasks/${task.id}`, { method: 'PATCH', actor: clinician, body: { version: task.version, status: 'completed', clientRequestId: randomUUID() } });
  assert.equal(stale.status, 409);
  const current = await json(demo, '/api/clinician/tasks?patientId=p001', { actor: clinician });
  assert.equal(current.tasks.find(item => item.id === task.id).status, 'in_progress');
});

test('UX correction approval rechecks source revision and preserves newer patient data', async () => {
  const patient = await newPatient('정정 제안 검증');
  await call(demo, `/api/patients/${patient.id}/daily`, { method: 'POST', body: { date: today, steps: 20, note: '원기록' } });
  const proposed = await call(demo, `/api/patients/${patient.id}/corrections`, { method: 'POST', actor: clinician, body: { date: today, expectedRevision: 1, patch: { steps: 30 }, reason: '합성 정정 제안', clientRequestId: randomUUID() } });
  assert.equal(proposed.status, 201); const { correction } = await proposed.json();
  await call(demo, `/api/patients/${patient.id}/daily`, { method: 'POST', body: { date: today, steps: 40, expectedRevision: 1 } });
  const approve = await call(demo, `/api/clinician/corrections/${correction.id}`, { method: 'PATCH', actor: clinician, body: { version: correction.version, status: 'approved', reason: '검토 후 승인', clientRequestId: randomUUID() } });
  assert.equal(approve.status, 409);
  const { record } = await json(demo, `/api/patients/${patient.id}/daily?date=${today}`);
  assert.equal(record.steps, 40); assert.equal(record.note, '원기록');
});
