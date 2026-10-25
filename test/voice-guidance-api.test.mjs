import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultGuidanceConfig } from '../public/voice-guidance-rules.js';

let dir, child, base, clinician, patient, secondTab, otherPatient;
async function request(path, { method = 'GET', body, session, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...session, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function login(role, patientId) {
  const result = await request('/api/auth/demo', { method: 'POST', body: { role, ...(patientId ? { patientId } : {}) }, headers: { 'x-homecare-demo': '1' } });
  assert.equal(result.status, 200);
  const session = { 'x-homecare-demo-session': result.body.demoToken };
  const current = await request('/api/auth/session', { session });
  session['x-csrf-token'] = current.body.csrfToken;
  return session;
}
async function start() {
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'test', AUTH_MODE: 'demo', APP_ORIGIN: '', PORT: String(port), DATA_DIR: dir, VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/api/health')).status === 200) return; } catch { /* Bounded temporary-server startup. */ }
    if (child.exitCode !== null) throw Error(output); await delay(50);
  }
  throw Error('Guidance API temporary server did not start: ' + output);
}
async function stop() { if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }); }
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'homecare-guidance-api-')); await start();
  clinician = await login('clinician'); patient = await login('patient', 'p001'); secondTab = await login('patient', 'p001'); otherPatient = await login('patient', 'p002');
});
after(async () => { await stop(); if (dir) await rm(dir, { recursive: true, force: true }); });

test('Guidance HTTP requires authenticated demo sessions, current CSRF, own patient and clinician capabilities', async () => {
  const clinicPath = '/api/clinician/voice-guidance', path = '/api/patients/p001/voice-guidance';
  assert.equal((await request(clinicPath)).status, 401);
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { session: otherPatient })).status, 403);
  assert.equal((await request(clinicPath, { session: patient })).status, 403);
  assert.equal((await request(path, { session: clinician })).status, 200);
  assert.equal((await request(path + '/preference', { method: 'PUT', body: { enabled: false }, session: clinician })).status, 403);
  assert.equal((await request(path + '/preference', { method: 'PUT', body: { enabled: false }, session: patient, headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await request(clinicPath, { method: 'PUT', body: { revision: 0, clientRequestId: randomUUID(), configuration: defaultGuidanceConfig() }, session: clinician, headers: { origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await request('/api/patients/unknown/voice-guidance', { session: clinician })).status, 404);
});
test('Guidance HTTP clinician edit reaches intended patient only, same UUID does not duplicate and stale revision conflicts', async () => {
  const path = '/api/clinician/voice-guidance?patientId=p001';
  const current = await request(path, { session: clinician }); assert.equal(current.body.revision, 0);
  const configuration = defaultGuidanceConfig(); configuration.rules[3].text = '[합성] 음식 전체를 사진에 담아 주세요.';
  const body = { revision: current.body.revision, clientRequestId: randomUUID(), configuration };
  const saves = await Promise.all([request(path, { method: 'PUT', body, session: clinician }), request(path, { method: 'PUT', body, session: clinician })]);
  assert.equal(saves[0].status, 200); assert.deepEqual(saves[0], saves[1]); assert.equal(saves[0].body.revision, 1);
  assert.equal((await request(path, { method: 'PUT', body: { ...body, clientRequestId: randomUUID() }, session: clinician })).status, 409);
  const target = await request('/api/patients/p001/voice-guidance', { session: patient });
  const other = await request('/api/patients/p002/voice-guidance', { session: otherPatient });
  assert.equal(target.body.configuration.rules[3].text, configuration.rules[3].text);
  assert.notEqual(other.body.configuration.rules[3].text, configuration.rules[3].text);
  assert.equal(target.body.preference.configured, false);
  assert.ok(Number.isFinite(Date.parse(target.body.serverTime)));
});
test('Guidance HTTP two patient tabs race one reservation, release retries, started ACK and refresh dedup persist through server restart', async () => {
  const path = '/api/patients/p001/voice-guidance', settings = await request(path, { session: patient });
  const body = { configurationKey: settings.body.configurationKey, ruleId: 'meal-photo', event: 'meal_open' };
  const claims = await Promise.all([request(path + '/claims', { method: 'POST', body, session: patient }), request(path + '/claims', { method: 'POST', body, session: secondTab })]);
  assert.equal(claims.filter(result => result.body.allowed).length, 1);
  assert.equal(claims.find(result => !result.body.allowed).body.reason, 'reserved_elsewhere');
  const first = claims.find(result => result.body.allowed).body;
  assert.equal((await request(path + '/receipts/' + first.claimId, { method: 'POST', body: { outcome: 'released' }, session: patient })).status, 200);
  const retry = await request(path + '/claims', { method: 'POST', body, session: secondTab }); assert.equal(retry.body.allowed, true);
  const received = await request(path + '/receipts/' + retry.body.claimId, { method: 'POST', body: { outcome: 'started' }, session: patient }); assert.equal(received.body.outcome, 'started');
  assert.deepEqual(await request(path + '/receipts/' + retry.body.claimId, { method: 'POST', body: { outcome: 'started' }, session: secondTab }), received);
  assert.equal((await request(path + '/claims', { method: 'POST', body, session: secondTab })).body.reason, 'already_started');
  await stop(); await start();
  assert.equal((await request(path, { session: patient })).body.configurationKey, settings.body.configurationKey);
  assert.equal((await request(path + '/claims', { method: 'POST', body, session: patient })).body.reason, 'already_started');
  assert.equal((await request('/api/health')).body.schemaVersion, 9);
});
test('Guidance HTTP mute persists across tabs and blocks new claims; clinician disabled setting takes precedence', async () => {
  const path = '/api/patients/p001/voice-guidance';
  const muted = await request(path + '/preference', { method: 'PUT', body: { enabled: false }, session: patient }); assert.deepEqual(muted.body.preference, { enabled: false, configured: true });
  let settings = await request(path, { session: secondTab }); assert.equal(settings.body.preference.enabled, false);
  const claim = () => request(path + '/claims', { method: 'POST', body: { configurationKey: settings.body.configurationKey, ruleId: 'steps', event: 'steps_open' }, session: secondTab });
  assert.equal((await claim()).body.reason, 'disabled');
  await request(path + '/preference', { method: 'PUT', body: { enabled: true }, session: patient });
  const clinicPath = '/api/clinician/voice-guidance?patientId=p001', current = await request(clinicPath, { session: clinician });
  current.body.configuration.enabled = false;
  await request(clinicPath, { method: 'PUT', body: { revision: current.body.revision, clientRequestId: randomUUID(), configuration: current.body.configuration }, session: clinician });
  settings = await request(path, { session: secondTab }); assert.equal(settings.body.preference.enabled, true); assert.equal((await claim()).body.reason, 'disabled');
});
