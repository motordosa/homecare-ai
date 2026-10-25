import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureHealthSchema, createHealthConnection, getHealthConnections, getHealthConnectionIdentity, receiveHealthBatch, healthDailyForPatient, revokeHealthConnection } from '../lib/health-sync.mjs';

function fixture(t, filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY); INSERT OR IGNORE INTO patients VALUES ('a'),('b');");
  ensureHealthSchema(db);
  t.after(() => db.close());
  return db;
}
const input = (changes = {}) => ({ platform: 'apple-health', label: '합성 코드 복구 검사', clientRequestId: randomUUID(), ...changes });
const status = code => error => error.status === code;
const active = (db, patientId = 'a') => getHealthConnections(db, patientId).connections.filter(row => row.status !== 'revoked');

test('lost first issuance response replays one connection and never returns the secret again', t => {
  const db = fixture(t), body = input();
  const first = createHealthConnection(db, 'a', body);
  const replay = createHealthConnection(db, 'a', { ...body, clientRequestId: body.clientRequestId.toUpperCase() });
  assert.equal(replay.connection.id, first.connection.id);
  assert.equal(replay.token, null);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.codeUnavailable, true);
  assert.equal(active(db).length, 1);
  assert.equal(first.duplicate, false);
  assert.equal(first.codeUnavailable, false);
  const receipts = db.prepare('SELECT * FROM health_connection_issuances').all();
  assert.equal(receipts.length, 1);
  assert.ok(!JSON.stringify(receipts).includes(first.token));
  assert.ok(!JSON.stringify(getHealthConnections(db, 'a')).includes(first.token));
});

test('request IDs are patient scoped and changed intent is rejected without mutation', t => {
  const db = fixture(t), body = input();
  const first = createHealthConnection(db, 'a', body);
  const second = createHealthConnection(db, 'b', body);
  assert.notEqual(first.connection.id, second.connection.id);
  for (const change of [{ label: '다른 이름' }, { platform: 'health-connect' }, { replacesConnectionId: first.connection.id }]) {
    assert.throws(() => createHealthConnection(db, 'a', { ...body, ...change }), status(409));
  }
  for (const change of [{ clientRequestId: null }, { clientRequestId: 'invalid' }, { replacesConnectionId: 'invalid' }]) {
    assert.throws(() => createHealthConnection(db, 'a', { ...body, ...change }), status(400));
  }
  assert.throws(() => createHealthConnection(db, 'a', { platform: 'apple-health', replacesConnectionId: first.connection.id }), status(400));
  assert.equal(active(db).length, 1);
  assert.equal(active(db, 'b').length, 1);
});

test('explicit reissue and repeated or competing requests yield one active replacement', t => {
  const db = fixture(t), body = input();
  const first = createHealthConnection(db, 'a', body);
  const replacementBody = input({ replacesConnectionId: first.connection.id });
  const replacement = createHealthConnection(db, 'a', replacementBody);
  const replay = createHealthConnection(db, 'a', replacementBody);
  assert.equal(replay.connection.id, replacement.connection.id);
  assert.equal(replay.token, null);
  assert.equal(active(db).length, 1);
  assert.equal(active(db)[0].id, replacement.connection.id);
  assert.equal(replacement.connection.selected, true);
  assert.throws(() => createHealthConnection(db, 'a', { ...replacementBody, clientRequestId: randomUUID() }), status(409));
  assert.throws(() => getHealthConnectionIdentity(db, first.token), status(401));
  assert.equal(getHealthConnectionIdentity(db, replacement.token).connectionId, replacement.connection.id);
  const originalReplay = createHealthConnection(db, 'a', body);
  assert.equal(originalReplay.connection.status, 'revoked');
  assert.equal(originalReplay.connection.selected, false);
  assert.equal(active(db).length, 1);
});

test('reissuing a nonselected connection preserves another selection and all received data', t => {
  const db = fixture(t);
  const old = createHealthConnection(db, 'a', input());
  const current = createHealthConnection(db, 'a', input({ platform: 'health-connect' }));
  const batch = { batchId: 'synthetic-preservation', timeZone: 'Asia/Seoul', days: [{ date: '2026-01-02', steps: 3210, updatedAt: '2026-01-03T00:00:00Z' }] };
  receiveHealthBatch(db, old.token, batch);
  receiveHealthBatch(db, current.token, batch);
  const replacement = createHealthConnection(db, 'a', input({ replacesConnectionId: old.connection.id }));
  assert.equal(replacement.connection.selected, false);
  assert.equal(getHealthConnections(db, 'a').selectedConnectionId, current.connection.id);
  assert.equal(getHealthConnectionIdentity(db, current.token).selected, true);
  assert.equal(healthDailyForPatient(db, 'a', '2026-01-01', '2026-01-31')[0].steps, 3210);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM health_daily').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM health_batches').get().n, 2);
  assert.throws(() => createHealthConnection(db, 'b', input({ replacesConnectionId: current.connection.id })), status(404));
  assert.equal(getHealthConnections(db, 'a').selectedConnectionId, current.connection.id);
});

test('failed replacement transaction rolls back revocation and selection before retry', t => {
  const db = fixture(t), first = createHealthConnection(db, 'a', input());
  db.exec("CREATE TRIGGER synthetic_issuance_failure BEFORE INSERT ON health_connection_issuances BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  const body = input({ replacesConnectionId: first.connection.id });
  assert.throws(() => createHealthConnection(db, 'a', body), /synthetic failure/);
  assert.equal(active(db).length, 1);
  assert.equal(getHealthConnectionIdentity(db, first.token).selected, true);
  db.exec('DROP TRIGGER synthetic_issuance_failure');
  const retried = createHealthConnection(db, 'a', body);
  assert.equal(active(db).length, 1);
  assert.equal(active(db)[0].id, retried.connection.id);
});

test('receipt migration is additive, survives reopening, and follows patient deletion', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hc-issuance-schema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'health.sqlite');
  const firstDb = new DatabaseSync(filename);
  firstDb.exec("PRAGMA foreign_keys=ON; CREATE TABLE patients(id TEXT PRIMARY KEY); INSERT INTO patients VALUES ('a');");
  ensureHealthSchema(firstDb);
  const legacy = createHealthConnection(firstDb, 'a', { platform: 'apple-health' });
  // Represent schema7: existing connections without the newly introduced receipt table.
  firstDb.exec('DROP TABLE health_connection_issuances');
  ensureHealthSchema(firstDb);
  const body = input();
  const created = createHealthConnection(firstDb, 'a', body);
  firstDb.close();
  const reopened = fixture(t, filename);
  ensureHealthSchema(reopened);
  assert.equal(getHealthConnectionIdentity(reopened, legacy.token).connectionId, legacy.connection.id);
  assert.equal(createHealthConnection(reopened, 'a', body).connection.id, created.connection.id);
  assert.equal(active(reopened).length, 2);
  reopened.prepare('DELETE FROM patients WHERE id=?').run('a');
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM health_connection_issuances').get().n, 0);
  assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
});

test('replaying a revoked connection does not revive it or displace another selection', t => {
  const db = fixture(t), body = input();
  const first = createHealthConnection(db, 'a', body);
  revokeHealthConnection(db, 'a', first.connection.id);
  const current = createHealthConnection(db, 'a', input());
  const replay = createHealthConnection(db, 'a', body);
  assert.equal(replay.connection.status, 'revoked');
  assert.equal(replay.token, null);
  assert.equal(getHealthConnections(db, 'a').selectedConnectionId, current.connection.id);
  assert.equal(active(db).length, 1);
});

async function httpFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hc-issuance-http-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', './test/helpers/kakao-provider-fixture.mjs', 'server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', AUTH_MODE: 'kakao', APP_ORIGIN: base, KAKAO_CLIENT_ID: 'fixture', KAKAO_CLIENT_SECRET: 'fixture-secret', CLINICIAN_KAKAO_IDS: '101', STAFF_ACCESS_JSON: '', PORT: String(port), DATA_DIR: dir, VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
    rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    if (child.exitCode !== null || i === 99) throw Error(`Fixture unavailable: ${output}`);
    await delay(50);
  }
  async function login(id) {
    const start = await fetch(base + '/auth/kakao?next=/account', { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const finished = await fetch(base + '/auth/kakao/callback?' + new URLSearchParams({ state, code: `fixture-${id}` }), { redirect: 'manual', headers: { cookie: start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') } });
    assert.equal(finished.status, 302);
    const cookie = finished.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const session = await (await fetch(base + '/api/auth/session', { headers: { cookie } })).json();
    return { cookie, 'x-csrf-token': session.csrfToken, origin: base, 'content-type': 'application/json' };
  }
  async function send(path, headers, body, expected = 200) {
    const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, expected, path);
    return response.json();
  }
  return { base, dir, login, send };
}

test('HTTP lost body and concurrent replay stay singular; replay still checks CSRF, patient ACL and revoked session', async t => {
  const { base, dir, login, send } = await httpFixture(t);
  const staff = await login('101'), patient = await login('201'), other = await login('202');
  const invite = await send('/api/clinician/patients/p001/invitations', staff, {}, 201);
  await send('/api/auth/enroll', patient, { code: invite.invitation.code });
  const invite2 = await send('/api/clinician/patients/p002/invitations', staff, {}, 201);
  await send('/api/auth/enroll', other, { code: invite2.invitation.code });
  const path = '/api/patients/p001/health-connections', body = input();
  // Destroy the actual HTTP response stream without reading the issued token.
  await new Promise((resolve, reject) => {
    const request = http.request(base + path, { method: 'POST', headers: patient }, response => {
      try { assert.equal(response.statusCode, 201); response.destroy(); resolve(); } catch (error) { reject(error); }
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
  const replays = await Promise.all(Array.from({ length: 5 }, () => send(path, patient, body)));
  assert.equal(new Set(replays.map(value => value.connection.id)).size, 1);
  assert.ok(replays.every(value => value.duplicate && value.codeUnavailable && value.token === null));
  const listed = await (await fetch(base + path, { headers: patient })).json();
  assert.equal(listed.connections.filter(row => row.status !== 'revoked').length, 1);
  await send(path, { ...patient, 'x-csrf-token': 'invalid' }, body, 403);
  await send(path, other, body, 403);
  await send(path, {}, body, 401);
  await send(path, patient, { ...body, label: '변경된 의도' }, 409);
  const replacementBody = input({ replacesConnectionId: replays[0].connection.id });
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(base + path, { method: 'POST', headers: patient, body: JSON.stringify(replacementBody) })));
  assert.equal(responses.filter(value => value.status === 201).length, 1);
  assert.equal(responses.filter(value => value.status === 200).length, 4);
  const replacements = await Promise.all(responses.map(value => value.json()));
  assert.equal(new Set(replacements.map(value => value.connection.id)).size, 1);
  const db = new DatabaseSync(join(dir, 'homecare.sqlite'));
  try {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM health_connections WHERE patient_id='p001' AND revoked_at IS NULL").get().n, 1);
    db.prepare("UPDATE auth_sessions SET expires_at=0 WHERE account_id IN (SELECT id FROM auth_accounts WHERE provider='kakao' AND provider_user_id='201')").run();
  } finally { db.close(); }
  await send(path, patient, replacementBody, 401);
});
