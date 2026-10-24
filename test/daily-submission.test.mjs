import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

let dir, base, child, db, today;
async function request(path, body) {
  const response = await fetch(base + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function patient(name) {
  const result = await request('/api/patients', { name, age: 79, sex: 'female' });
  assert.equal(result.status, 201);
  return result.body.patient.id;
}
const counts = id => ({
  audits: db.prepare('SELECT COUNT(*) n FROM daily_record_audit WHERE patient_id=?').get(id).n,
  submissions: db.prepare('SELECT COUNT(*) n FROM daily_record_submissions WHERE patient_id=?').get(id).n,
});

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'homecare-daily-retry-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', AUTH_MODE: 'demo', APP_ORIGIN: '',
      PORT: String(port), DATA_DIR: dir, VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    try {
      const health = await request('/api/health');
      if (health.status === 200) {
        today = health.body.today;
        db = new DatabaseSync(join(dir, 'homecare.sqlite'));
        return;
      }
    } catch { /* Wait only for the temporary local server. */ }
    if (child.exitCode !== null) throw Error(output);
    await delay(50);
  }
  throw Error('Temporary daily retry server did not start: ' + output);
});
after(async () => {
  db?.close();
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('Daily retry returns the original response before revision checking without duplicate audit or overwriting later changes', async () => {
  const id = await patient('일일 재전송 합성 환자'), path = `/api/patients/${id}/daily`;
  const body = { date: today, steps: 0, sleepHours: null, expectedRevision: 0, clientSubmissionId: randomUUID() };
  const replies = await Promise.all([request(path, body), request(path, body)]);
  replies.forEach(reply => assert.equal(reply.status, 200));
  assert.deepEqual(replies[0].body, replies[1].body);
  assert.equal(replies[0].body.record.revision, 1);
  assert.deepEqual(counts(id), { audits: 1, submissions: 1 });
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  assert.deepEqual((await request(path, reordered)).body, replies[0].body);
  assert.equal((await request(path, { ...body, steps: null })).status, 409);
  assert.equal((await request(path, { ...body, clientSubmissionId: randomUUID() })).status, 409, 'a new stale request remains a revision conflict');
  const later = await request(path, { date: today, steps: 30, expectedRevision: 1, clientSubmissionId: randomUUID() });
  assert.equal(later.status, 200); assert.equal(later.body.record.revision, 2);
  assert.deepEqual((await request(path, body)).body, replies[0].body, 'replay preserves the actual originally saved response');
  const current = await request(path + `?date=${today}`);
  assert.equal(current.body.record.steps, 30); assert.equal(current.body.record.revision, 2);
  assert.deepEqual(counts(id), { audits: 2, submissions: 2 });
  const secondPatient = await patient('동일 키 다른 합성 환자');
  assert.equal((await request(`/api/patients/${secondPatient}/daily`, body)).status, 200, 'submission keys are scoped by patient');
  assert.deepEqual(counts(secondPatient), { audits: 1, submissions: 1 });
});

test('Daily submissions validate UUID and real record fields, preserve optional legacy writes, and cascade on patient removal', async () => {
  const id = await patient('일일 요청 검증 합성 환자'), path = `/api/patients/${id}/daily`;
  assert.equal((await request(path, { date: today, clientSubmissionId: randomUUID(), expectedRevision: 0 })).status, 400);
  assert.equal((await request(path, { date: today, steps: 0, clientSubmissionId: 'invalid' })).status, 400);
  assert.deepEqual(counts(id), { audits: 0, submissions: 0 });
  const oldClient = await request(path, { date: today, steps: 0 });
  assert.equal(oldClient.status, 200); assert.equal(oldClient.body.record.revision, 1);
  const response = await request(path, { date: today, sleepHours: null, expectedRevision: 1, clientSubmissionId: randomUUID() });
  assert.equal(response.status, 200); assert.equal(response.body.record.revision, 2);
  assert.deepEqual(counts(id), { audits: 2, submissions: 1 });
  db.exec('PRAGMA foreign_keys=ON');
  db.prepare('DELETE FROM patients WHERE id=?').run(id);
  assert.deepEqual(counts(id), { audits: 0, submissions: 0 });
});

test('Daily write, audit and retry receipt roll back together if receipt persistence fails', async () => {
  const id = await patient('일일 원자성 합성 환자'), path = `/api/patients/${id}/daily`;
  const initial = await request(path, { date: today, steps: 10, clientSubmissionId: randomUUID() });
  assert.equal(initial.status, 200);
  const body = { date: today, steps: 20, expectedRevision: 1, clientSubmissionId: randomUUID() };
  db.exec("CREATE TRIGGER reject_daily_submission BEFORE INSERT ON daily_record_submissions BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");
  try {
    assert.equal((await request(path, body)).status, 500);
    assert.deepEqual((await request(path + `?date=${today}`)).body, initial.body);
    assert.deepEqual(counts(id), { audits: 1, submissions: 1 });
  } finally { db.exec('DROP TRIGGER reject_daily_submission'); }
  const retried = await request(path, body);
  assert.equal(retried.status, 200); assert.equal(retried.body.record.steps, 20); assert.equal(retried.body.record.revision, 2);
  assert.deepEqual(counts(id), { audits: 2, submissions: 2 });
});
