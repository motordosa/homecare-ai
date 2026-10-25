// Real Chromium clicks, HTTP and temporary SQLite; injected network failures and accelerated timers.
// SpeechRecognition is only a support stub for opening the field selector. No microphone/audio claim.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

const dir = await mkdtemp(join(tmpdir(), 'hc-patient-reliability-'));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', AUTH_MODE: 'demo', APP_ORIGIN: '', VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '', STAFF_ACCESS_JSON: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', browser;
server.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
server.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
const errors = [], results = [];

async function until(check, message = 'condition timed out') {
  for (let i = 0; i < 120; i++) { if (await check()) return; await delay(50); }
  throw Error(message);
}
async function scenario(name, work) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('homecarePatientAssist', JSON.stringify({ voiceEnabled: false, remindersEnabled: false }));
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
    window.SpeechRecognition = class { start() { throw Error('This test must not start a microphone'); } stop() {} abort() {} };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push({ scenario: name, message: error.message }));
  try {
    await work(page, context);
    results.push({ name, status: 'passed' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'failed', message: error.message });
    await page.screenshot({ path: 'test-results/patient-reliability/failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
async function ready(page, patientId = 'p001') {
  await page.locator('#app-content:not([hidden])').waitFor();
  await page.waitForFunction(id => !document.querySelector('#patient-select').disabled && document.querySelector('#patient-select').value === id, patientId);
}
async function load(page, patientId = 'p001') {
  await page.goto(base + '/patient?patientId=' + patientId);
  await ready(page, patientId);
}
async function syntheticPatient(suffix) {
  const response = await fetch(base + '/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '[합성 검증] 신뢰성 ' + suffix, age: 82, sex: 'female', conditions: [] }) });
  assert.equal(response.status, 201);
  return (await response.json()).patient.id;
}
function query(sql, ...values) {
  const db = new DatabaseSync(join(dir, 'homecare.sqlite'));
  try { return db.prepare(sql).all(...values); } finally { db.close(); }
}
async function openSteps(page) {
  await page.locator('#today-metrics [data-action=steps]').click();
  await page.locator('#daily-dialog').waitFor({ state: 'visible' });
}
async function fillMeal(page) {
  await page.locator('#open-meal').click();
  await page.locator('#meal-form input[name=foodType][value=balanced]').check();
  await page.locator('#meal-form input[name=portion][value="0.5"]').check();
}

try {
  await until(async () => { if (server.exitCode !== null) throw Error(output); try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 'local server unavailable');
  await mkdir('test-results/patient-reliability', { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}) });

  await scenario('A01 initial session timeout releases loading and same-page retry recovers', async page => {
    await page.clock.install();
    let hold = true, requests = 0;
    const held = [];
    await page.route('**/api/auth/session', route => { requests++; if (hold) held.push(route); else return route.continue(); });
    await page.goto(base + '/patient?patientId=p001');
    await until(() => requests === 1);
    await page.clock.fastForward(21000);
    await page.locator('#load-error:not([hidden])').waitFor();
    assert.equal(await page.locator('#loading-state').isHidden(), true);
    assert.equal(await page.locator('#retry-button').isEnabled(), true);
    hold = false;
    for (const route of held) await route.abort().catch(() => {});
    await page.locator('#retry-button').click();
    await ready(page);
    assert.ok(requests >= 2);
    assert.equal(await page.locator('#load-error').isHidden(), true);
  });

  await scenario('A01 demo patient change timeout retries the intended patient without reload', async page => {
    await load(page);
    await page.clock.install();
    let hold = true, reached = false;
    const held = [];
    await page.route('**/api/auth/demo', route => {
      if (hold && route.request().postDataJSON()?.patientId === 'p002') { reached = true; held.push(route); }
      else return route.continue();
    });
    await page.locator('#patient-select').selectOption('p002');
    await until(() => reached);
    await page.clock.fastForward(21000);
    await page.locator('#load-error:not([hidden])').waitFor();
    assert.equal(await page.locator('#retry-button').isEnabled(), true);
    assert.equal(await page.locator('#loading-state').isHidden(), true);
    hold = false;
    for (const route of held) await route.abort().catch(() => {});
    await page.locator('#retry-button').click();
    await ready(page, 'p002');
    assert.equal(new URL(page.url()).searchParams.get('patientId'), 'p002');
  });

  await scenario('A02 initial 503 retry is bound before bootstrap and recovers without refresh', async page => {
    let fail = true, requests = 0;
    await page.route('**/api/auth/session', route => { requests++; return fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '합성 세션 실패' }) }) : route.continue(); });
    await page.goto(base + '/patient?patientId=p001');
    await page.locator('#load-error:not([hidden])').waitFor();
    assert.equal(requests, 1);
    fail = false;
    await page.locator('#retry-button').click();
    await ready(page);
    assert.ok(requests >= 2);
    assert.equal(await page.locator('#load-error').isHidden(), true);
  });

  await scenario('A05 delayed daily lookup gates voice and exposes correct fields when ready', async page => {
    await load(page);
    let held;
    await page.route('**/api/patients/p001/daily?*', route => { held = route; });
    await openSteps(page);
    await until(() => held);
    assert.equal(await page.locator('[data-dictation=daily]').isDisabled(), true);
    assert.match(await page.locator('[data-dictation=daily]').innerText(), /불러온 뒤/);
    assert.equal(await page.locator('#daily-submit').isDisabled(), true);
    await held.continue();
    await page.locator('#daily-submit:not([disabled])').waitFor();
    await page.locator('[data-dictation=daily]').click();
    const fields = await page.locator('[data-voice-field] option').evaluateAll(options => options.map(option => option.value));
    assert.deepEqual(fields, ['steps', 'date']);
    assert.equal(await page.locator('[data-voice-field]').inputValue(), 'steps');
  });

  await scenario('A06 daily lookup failure offers direct same-date retry and cannot save unverified data', async page => {
    await load(page);
    let fail = true, writes = 0;
    const dates = [];
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/daily')) writes++; });
    await page.route('**/api/patients/p001/daily?*', route => {
      dates.push(new URL(route.request().url()).searchParams.get('date'));
      return fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '합성 일일 조회 실패' }) }) : route.continue();
    });
    await openSteps(page);
    await page.locator('#daily-error:not([hidden])').waitFor();
    await page.locator('#daily-reload-record:not([hidden])').waitFor();
    assert.equal(await page.locator('#daily-submit').isDisabled(), true);
    assert.equal(await page.locator('[data-dictation=daily]').isDisabled(), true);
    assert.equal(writes, 0);
    fail = false;
    await page.locator('#daily-reload-record').click();
    await page.locator('#daily-submit:not([disabled])').waitFor();
    assert.equal(await page.locator('#daily-error').isHidden(), true);
    assert.equal(await page.locator('#daily-reload-record').isHidden(), true);
    assert.equal(dates.length, 2);
    assert.equal(dates[0], dates[1]);
    assert.equal(writes, 0);
  });

  await scenario('A07 meal response loss freezes pending content and retries same UUID exactly once', async page => {
    const patientId = await syntheticPatient('식사');
    await load(page, patientId);
    const submissions = [];
    let drop = true;
    await page.route(`**/api/patients/${patientId}/meals`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postDataJSON());
      if (!drop) return route.continue();
      drop = false;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort('failed');
    });
    await fillMeal(page);
    await page.locator('#meal-submit').click();
    await page.locator('#meal-error:not([hidden])').waitFor();
    await until(async () => await page.locator('#meal-submit').isEnabled());
    assert.match(await page.locator('#meal-submit').innerText(), /저장 결과 확인/);
    assert.equal(await page.locator('#meal-date').isDisabled(), true);
    assert.equal(await page.locator('#meal-form input[name=foodType][value=balanced]').isDisabled(), true);
    assert.equal(await page.locator('#meal-form input[name=portion][value="0.5"]').isChecked(), true);
    assert.equal(await page.locator('#meal-dialog .close-dialog').isEnabled(), true);
    assert.equal(await page.locator('.bottom-nav button:disabled').count(), 0);
    assert.equal(query('SELECT COUNT(*) n FROM meals WHERE patient_id=?', patientId)[0].n, 1);
    await page.locator('#meal-submit').click();
    await page.locator('#meal-dialog').waitFor({ state: 'hidden' });
    await ready(page, patientId);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.equal(query('SELECT COUNT(*) n FROM meals WHERE patient_id=?', patientId)[0].n, 1);
  });

  await scenario('A07 daily response loss preserves frozen values and original UUID without extra revision', async page => {
    const patientId = await syntheticPatient('걸음');
    await load(page, patientId);
    const submissions = [];
    let drop = true;
    await page.route(`**/api/patients/${patientId}/daily`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postDataJSON());
      if (!drop) return route.continue();
      drop = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    });
    await openSteps(page);
    await page.locator('#daily-submit:not([disabled])').waitFor();
    await page.locator('#daily-steps').fill('4567');
    await page.locator('#daily-submit').click();
    await page.locator('#daily-error:not([hidden])').waitFor();
    await until(async () => await page.locator('#daily-submit').isEnabled());
    assert.match(await page.locator('#daily-submit').innerText(), /저장 결과 확인/);
    assert.equal(await page.locator('#daily-date').isDisabled(), true);
    assert.equal(await page.locator('#daily-steps').isDisabled(), true);
    assert.equal(await page.locator('#daily-steps').inputValue(), '4567');
    assert.equal(await page.locator('[data-dictation=daily]').isDisabled(), true);
    const before = query('SELECT steps,revision FROM daily_records WHERE patient_id=?', patientId);
    assert.equal(before[0].steps, 4567);
    await page.locator('#daily-submit').click();
    await page.locator('#daily-dialog').waitFor({ state: 'hidden' });
    await ready(page, patientId);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.deepEqual(query('SELECT steps,revision FROM daily_records WHERE patient_id=?', patientId), before);
  });

  await scenario('A07 slow save explains waiting and timeout restores a safe retry without losing the draft', async page => {
    const patientId = await syntheticPatient('느린 저장');
    await load(page, patientId);
    await page.clock.install();
    let hold = true, held;
    const submissions = [];
    await page.route(`**/api/patients/${patientId}/meals`, route => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postDataJSON());
      if (hold) held = route;
      else return route.continue();
    });
    await fillMeal(page);
    await page.locator('#meal-submit').click();
    await until(() => held);
    assert.equal(await page.locator('.bottom-nav button:disabled').count(), 6);
    await page.clock.fastForward(6000);
    assert.match(await page.locator('[data-operation-status]').innerText(), /오래 걸리고/);
    await page.clock.fastForward(15000);
    await page.locator('#meal-error:not([hidden])').waitFor();
    await until(async () => await page.locator('#meal-submit').isEnabled());
    assert.equal(await page.locator('.bottom-nav button:disabled').count(), 0);
    assert.equal(await page.locator('#meal-form input[name=portion][value="0.5"]').isChecked(), true);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#meal-dialog .close-dialog').click();
    assert.equal(await page.locator('#meal-dialog').isVisible(), true);
    assert.equal(query('SELECT COUNT(*) n FROM meals WHERE patient_id=?', patientId)[0].n, 0);
    hold = false;
    await held.abort().catch(() => {});
    await page.locator('#meal-submit').click();
    await page.locator('#meal-dialog').waitFor({ state: 'hidden' });
    await ready(page, patientId);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.equal(query('SELECT COUNT(*) n FROM meals WHERE patient_id=?', patientId)[0].n, 1);
  });

  await scenario('A07 confirmed save plus summary failure retains successful result and reload recovers', async page => {
    const patientId = await syntheticPatient('요약 조회');
    await load(page, patientId);
    let fail = true;
    await page.route(`**/api/patients/${patientId}/summary`, route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '합성 저장 후 목록 조회 실패' }) }) : route.continue());
    await fillMeal(page);
    await page.locator('#meal-submit').click();
    await page.locator('#meal-dialog').waitFor({ state: 'hidden' });
    await page.locator('#load-error:not([hidden])').waitFor();
    await until(async () => (await page.locator('#save-confirmation-detail').innerText()).includes('저장은 완료'));
    assert.match(await page.locator('#save-confirmation-title').innerText(), /저장 완료/);
    assert.equal(query('SELECT COUNT(*) n FROM meals WHERE patient_id=?', patientId)[0].n, 1);
    fail = false;
    await page.locator('#retry-button').click();
    await ready(page, patientId);
    assert.equal(await page.locator('#load-error').isHidden(), true);
    assert.equal(query('SELECT COUNT(*) n FROM meals WHERE patient_id=?', patientId)[0].n, 1);
  });

  await scenario('A08 connection response loss resolves original attempt then explicit reissue replaces only it', async page => {
    const patientId = await syntheticPatient('연결');
    await load(page, patientId);
    await page.locator('.bottom-nav [data-view=connections]').click();
    await until(async () => await page.locator('#connections-loading').isHidden());
    await page.locator('.connection-setup > summary').click();
    await page.locator('#connection-label').fill('[합성 검증] 응답 유실');
    const submissions = [];
    let drop = true;
    await page.route(`**/api/patients/${patientId}/health-connections`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postDataJSON());
      if (!drop) return route.continue();
      drop = false;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort('failed');
    });
    await page.locator('#connection-create').click();
    await page.locator('#connections-error:not([hidden])').waitFor();
    await until(async () => await page.locator('#connection-create').isEnabled());
    assert.equal(query('SELECT COUNT(*) n FROM health_connections WHERE patient_id=? AND revoked_at IS NULL', patientId)[0].n, 1);
    await page.locator('#connection-create').click();
    await page.locator('#connection-reissue:not([hidden])').waitFor();
    assert.match(await page.locator('#connection-issuance-status').innerText(), /코드/);
    assert.equal(await page.locator('#connection-token').isHidden(), true);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    const original = query('SELECT id FROM health_connections WHERE patient_id=? AND revoked_at IS NULL', patientId)[0].id;
    drop = true;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#connection-reissue').click();
    await page.locator('#connections-error:not([hidden])').waitFor();
    await until(async () => await page.locator('#connection-create').isEnabled());
    assert.equal(submissions.length, 3);
    assert.notEqual(submissions[2].clientRequestId, submissions[1].clientRequestId);
    assert.equal(submissions[2].replacesConnectionId, original);
    let active = query('SELECT id FROM health_connections WHERE patient_id=? AND revoked_at IS NULL', patientId);
    assert.equal(active.length, 1);
    assert.notEqual(active[0].id, original);
    assert.ok(query('SELECT revoked_at FROM health_connections WHERE id=?', original)[0].revoked_at);
    const firstReplacement = active[0].id;
    await page.locator('#connection-create').click();
    await page.locator('#connection-reissue:not([hidden])').waitFor();
    assert.equal(submissions.length, 4);
    assert.deepEqual(submissions[2], submissions[3]);
    active = query('SELECT id FROM health_connections WHERE patient_id=? AND revoked_at IS NULL', patientId);
    assert.deepEqual(active.map(row => row.id), [firstReplacement]);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#connection-reissue').click();
    await page.locator('#connection-token:not([hidden])').waitFor();
    assert.equal(submissions.length, 5);
    assert.equal(submissions[4].replacesConnectionId, firstReplacement);
    active = query('SELECT id FROM health_connections WHERE patient_id=? AND revoked_at IS NULL', patientId);
    assert.equal(active.length, 1);
    assert.notEqual(active[0].id, firstReplacement);
    assert.match(await page.locator('#connection-token-value').innerText(), /^hc_/);
    await page.locator('#connection-token-dismiss').click();
    assert.equal(await page.locator('#connection-token-value').innerText(), '');
    await page.reload();
    await ready(page, patientId);
    assert.equal(query('SELECT COUNT(*) n FROM health_connections WHERE patient_id=? AND revoked_at IS NULL', patientId)[0].n, 1);
  });

  assert.deepEqual(errors, []);
  console.log(`${results.length} patient reliability browser scenarios passed. Network faults/timers injected; microphone and iPhone Safari unverified.`);
} finally {
  await writeFile('test-results/patient-reliability/results.json', JSON.stringify({ environment: 'local Chromium / temporary SQLite', speech: 'support stub only; microphone not exercised', results, pageErrors: errors }, null, 2)).catch(() => {});
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) await new Promise(resolve => { const timer = setTimeout(() => server.kill('SIGKILL'), 2000); server.once('exit', () => { clearTimeout(timer); resolve(); }); server.kill('SIGTERM'); });
  await rm(dir, { recursive: true, force: true });
}
