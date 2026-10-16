// These tests use only a temporary local server/database and clearly marked mocked AI responses.
// No real image is sent to an external provider, and no public deployment is modified.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const temp = await mkdtemp(join(tmpdir(), 'homecare-automation-browser-'));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), DATA_DIR: temp, VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
let browser;
let fixtureDb;
let completed = 0;
const pageErrors = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=', 'base64');
const pngFile = { name: 'browser-fixture-not-a-real-meal.png', mimeType: 'image/png', buffer: png };
const get = async path => { const response = await fetch(base + path); assert.equal(response.status, 200, path); return response.json(); };
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const responseFor = (page, suffix, method = 'POST') => page.waitForResponse(response => response.url() === base + suffix && response.request().method() === method);
const ready = page => page.locator('#app-content').waitFor({ state: 'visible' });
const settledPatient = page => page.waitForFunction(() => !document.querySelector('#patient-select')?.disabled);
const assertHidden = async locator => assert.equal(await locator.isVisible(), false);
async function check(name, action) { await action(); completed++; console.log(`PASS ${name}`); }
async function until(predicate, description) {
  for (let attempt = 0; attempt < 120; attempt++) { if (predicate()) return; await delay(25); }
  throw new Error(`Timed out: ${description}`);
}
async function flushUi(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function newPage(mobile = false) {
  const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  return page;
}
async function patientPage(page, id, suffix = '') {
  await page.goto(`${base}/patient?patientId=${encodeURIComponent(id)}${suffix}`, { waitUntil: 'networkidle' });
  await ready(page); await settledPatient(page);
}
async function saveDaily(page, id, expected) {
  const request = page.waitForRequest(request => request.url() === `${base}/api/patients/${id}/daily` && request.method() === 'POST');
  await page.locator('#daily-submit').click();
  assert.deepEqual((await request).postDataJSON(), expected);
  await page.locator('#daily-dialog').waitFor({ state: 'hidden' });
  await settledPatient(page);
}
async function enableMockVision(page) {
  const capabilities = await get('/api/capabilities');
  await page.route('**/api/capabilities', route => route.fulfill({ json: { ...capabilities, vision: {
    enabled: true, configured: true, available: true, provider: 'openai', model: 'fixture-browser-not-live', reason: null,
  } } }));
}
function draft(patientId, kind, proposal) {
  const createdAt = new Date().toISOString();
  return {
    id: `analysis-browser-${randomUUID()}`, patientId, kind, provider: 'openai', model: 'fixture-browser-not-live', createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(), proposal,
    warnings: ['브라우저 검증용 가상 제공자 응답입니다. 실제 AI 분석 결과가 아닙니다.', '영양값·약 후보는 확인이 필요한 초안입니다.'],
  };
}
function storeMockDraft(analysis, imageData) {
  const hash = createHash('sha256').update(Buffer.from(imageData.split(',')[1], 'base64')).digest('hex');
  fixtureDb.prepare(`INSERT INTO photo_analyses
    (id,patient_id,kind,image_hash,provider,model,proposal_json,warnings_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(analysis.id, analysis.patientId, analysis.kind, hash, analysis.provider, analysis.model, JSON.stringify(analysis.proposal), JSON.stringify(analysis.warnings), analysis.createdAt, analysis.expiresAt);
}

try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    if (child.exitCode !== null) throw new Error(output);
    await delay(100);
  }
  const today = (await get('/api/health')).today;
  fixtureDb = new DatabaseSync(join(temp, 'homecare.sqlite'));
  fixtureDb.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}) });
  const mobile = await newPage(true);
  const desktop = await newPage();
  const patients = [];
  for (const name of ['부분입력검증', '미보고보존검증']) {
    const response = await post('/api/patients', { name, age: 76, sex: 'female', conditions: ['합성 테스트'] });
    assert.equal(response.status, 201);
    patients.push((await response.json()).patient);
  }
  const [patient, otherPatient] = patients;

  await check('purpose-specific activity/sleep forms send only changed fields and preserve zero, null and unrelated values', async () => {
    const original = { date: today, steps: 1234, sleepHours: 6.5, medicationStatus: 'partial', appetite: 'poor', mood: 'poor', note: '다른 항목 보존', weightKg: 50.2 };
    assert.equal((await post(`/api/patients/${patient.id}/daily`, original)).status, 200);
    await patientPage(mobile, patient.id);
    await mobile.locator('#today-metrics [data-action=steps]').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    assert.equal(await mobile.locator('#daily-dialog-title').innerText(), '걸음 수 기록하기');
    await assertHidden(mobile.locator('#daily-sleep'));
    await assertHidden(mobile.locator('#medication-fieldset'));
    await mobile.locator('#daily-steps').fill('0');
    await saveDaily(mobile, patient.id, { date: today, steps: 0 });
    let record = (await get(`/api/patients/${patient.id}/daily?date=${today}`)).record;
    assert.equal(record.steps, 0);
    for (const key of ['sleepHours', 'medicationStatus', 'appetite', 'mood', 'note', 'weightKg']) assert.equal(record[key], original[key]);
    await mobile.locator('#today-metrics [data-action=sleep]').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    assert.equal(await mobile.locator('#daily-dialog-title').innerText(), '수면 시간 기록하기');
    await assertHidden(mobile.locator('#daily-steps'));
    await mobile.locator('#daily-sleep').fill('7.2');
    await saveDaily(mobile, patient.id, { date: today, sleepHours: 7.2 });
    await mobile.locator('#today-metrics [data-action=steps]').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    await mobile.locator('#daily-steps').fill('');
    await saveDaily(mobile, patient.id, { date: today, steps: null });
    record = (await get(`/api/patients/${patient.id}/daily?date=${today}`)).record;
    assert.equal(record.steps, null);
    assert.equal(record.sleepHours, 7.2);
    assert.equal(record.note, original.note);
  });

  await check('legacy medication-only reporting leaves unanswered health fields null and isolates other patients', async () => {
    const before = (await get(`/api/patients/${patient.id}/daily?date=${today}`)).record;
    await patientPage(mobile, otherPatient.id);
    await mobile.locator('#open-medication').click();
    await mobile.locator('#legacy-medication-form').waitFor({ state: 'visible' });
    await mobile.locator('#legacy-medication-form').getByText('기억나지 않아요', { exact: true }).click();
    const request = mobile.waitForRequest(request => request.url() === `${base}/api/patients/${otherPatient.id}/daily` && request.method() === 'POST');
    await mobile.locator('#legacy-medication-submit').click();
    assert.deepEqual((await request).postDataJSON(), { date: today, medicationStatus: 'unknown' });
    await mobile.waitForFunction(() => !document.querySelector('#legacy-medication-submit').disabled);
    const record = (await get(`/api/patients/${otherPatient.id}/daily?date=${today}`)).record;
    assert.equal(record.medicationStatus, 'unknown');
    for (const key of ['steps', 'sleepHours', 'appetite', 'mood', 'weightKg']) assert.equal(record[key], null, key);
    assert.deepEqual((await get(`/api/patients/${patient.id}/daily?date=${today}`)).record, before);
    await mobile.locator('.bottom-nav [data-view=home]').click();
    await mobile.locator('#open-daily').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    assert.equal(await mobile.locator('#daily-form input[name=appetite]:checked').count(), 0);
    assert.equal(await mobile.locator('#daily-form input[name=mood]:checked').count(), 0);
    await mobile.locator('#daily-dialog .close-dialog').click();
  });

  await check('nutrition and recent-meal links open the actual meal list and URL navigation restores view and patient', async () => {
    assert.equal((await post(`/api/patients/${patient.id}/meals`, { date: today, mealType: 'lunch', foodType: 'balanced', portion: 1 })).status, 201);
    await patientPage(mobile, patient.id);
    await mobile.locator('#today-metrics [data-action=nutrition]').click();
    await mobile.locator('#meal-records-section').waitFor({ state: 'visible' });
    assert.equal(new URL(mobile.url()).searchParams.get('view'), 'records');
    assert.equal(new URL(mobile.url()).searchParams.get('metric'), 'proteinGrams');
    assert.equal(new URL(mobile.url()).searchParams.get('section'), 'meals');
    assert.equal(await mobile.evaluate(() => document.activeElement?.id), 'meal-records-section');
    await assertHidden(mobile.locator('#meal-dialog'));
    assert.equal(await mobile.locator('#all-meals .meal-item').count(), 1);
    await mobile.reload({ waitUntil: 'networkidle' }); await ready(mobile);
    await mobile.locator('#view-records').waitFor({ state: 'visible' });
    await mobile.locator('.bottom-nav [data-view=guide]').click();
    await mobile.goBack();
    await mobile.locator('#view-records').waitFor({ state: 'visible' });
    await mobile.locator('.bottom-nav [data-view=home]').click();
    await mobile.locator('#view-home [data-view=records][data-section=meals]').click();
    assert.equal(new URL(mobile.url()).searchParams.get('section'), 'meals');
    assert.ok((await mobile.locator('#clinician-link').getAttribute('href')).includes(encodeURIComponent(patient.id)));
    await mobile.locator('#patient-select').selectOption(otherPatient.id); await settledPatient(mobile);
    assert.equal(new URL(mobile.url()).searchParams.get('patientId'), otherPatient.id);
    await mobile.goBack();
    await mobile.waitForFunction(id => document.querySelector('#patient-select').value === id && !document.querySelector('#patient-select').disabled, patient.id);
    assert.equal(new URL(mobile.url()).searchParams.get('patientId'), patient.id);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });

  await check('clinician registers two dose slots; patient reports and revises one while pending and the clinician audit remain accurate', async () => {
    await desktop.goto(`${base}/clinician?patientId=${patient.id}`, { waitUntil: 'networkidle' }); await ready(desktop);
    await desktop.locator('#main-nav [data-view=medications]').click();
    await desktop.locator('.medication-toolbar [data-action=add-medication-order]').click();
    await desktop.locator('#medication-name').fill('브라우저확인약');
    await desktop.locator('#medication-strength').fill('5 mg');
    await desktop.locator('#medication-dose').fill('1정');
    await desktop.locator('#medication-route').fill('경구');
    await desktop.locator('#medication-times [name=times]').fill('08:00');
    await desktop.locator('[data-modal-action=add-time]').click();
    await desktop.locator('#medication-times [name=times]').nth(1).fill('20:00');
    await desktop.locator('#medication-start-date').fill(today);
    await desktop.locator('#medication-instructions').fill('합성 브라우저 검증 계획');
    await desktop.locator('#medication-order-confirmed').check();
    const creating = responseFor(desktop, `/api/patients/${patient.id}/medication-orders`);
    await desktop.locator('#medication-order-form button[type=submit]').click();
    assert.equal((await creating).status(), 201);
    await desktop.locator('#modal-backdrop').waitFor({ state: 'hidden' });
    await desktop.locator('.medication-order').filter({ hasText: '브라우저확인약' }).waitFor({ state: 'visible' });
    await patientPage(mobile, patient.id, '&view=medication');
    await mobile.locator('#medication-slot-0').waitFor({ state: 'visible' });
    assert.equal(await mobile.locator('#medication-list .medication-slot').count(), 2);
    assert.equal(await mobile.locator('#medication-list .medication-status.pending').count(), 2);
    await mobile.locator('#medication-slot-0').getByText('먹었어요', { exact: true }).click();
    await mobile.locator('#slot-note-0').fill('처음 복용으로 보고');
    let saving = responseFor(mobile, `/api/patients/${patient.id}/medication-events`);
    await mobile.locator('#medication-slot-0 button[type=submit]').click(); assert.equal((await saving).status(), 200);
    await mobile.locator('#medication-slot-0 .medication-status.taken').waitFor({ state: 'visible' });
    assert.equal(await mobile.locator('#medication-slot-1 .medication-status.pending').count(), 1);
    await desktop.locator('#refresh-button').click();
    await desktop.locator('.medication-status.taken').waitFor({ state: 'visible' });
    assert.equal(await desktop.locator('.medication-status.pending').count(), 1);
    await mobile.locator('#medication-slot-0').getByText('못 먹었어요', { exact: true }).click();
    await mobile.locator('#slot-reason-0').fill('기억을 다시 확인');
    await mobile.locator('#slot-note-0').fill('이전 보고를 미복용으로 정정');
    saving = responseFor(mobile, `/api/patients/${patient.id}/medication-events`);
    await mobile.locator('#medication-slot-0 button[type=submit]').click(); assert.equal((await saving).status(), 200);
    await mobile.locator('#medication-slot-0 .medication-status.missed').waitFor({ state: 'visible' });
    const schedule = await get(`/api/patients/${patient.id}/medication-schedule?date=${today}`);
    assert.deepEqual([schedule.summary.missed, schedule.summary.pending, schedule.summary.taken], [1, 1, 0]);
    await desktop.locator('#refresh-button').click();
    await desktop.locator('.medication-status.missed').waitFor({ state: 'visible' });
    await desktop.locator('[data-action=medication-history][data-time="08:00"]').click();
    const history = await desktop.locator('.medication-history-timeline').innerText();
    assert.ok(history.includes('처음 복용으로 보고'));
    assert.ok(history.includes('이전 보고를 미복용으로 정정'));
    assert.ok(history.includes('복용 보고 → 미복용 보고'));
    await desktop.locator('#modal [data-modal-action=close]').last().click();
  });

  await check('health connection stays in native-program preparation state and its one-time token disappears on navigation', async () => {
    await patientPage(mobile, patient.id, '&view=connections');
    await mobile.locator('#connection-list .empty-state-card').waitFor({ state: 'visible' });
    assert.ok((await mobile.locator('#view-connections .connection-help').innerText()).includes('직접 읽지 않아요'));
    await mobile.locator('.connection-setup summary').click();
    await mobile.locator('#connection-label').fill('브라우저 연결 검증');
    await mobile.locator('#connection-create').click();
    await mobile.locator('#connection-token').waitFor({ state: 'visible' });
    const token = await mobile.locator('#connection-token-value').innerText();
    assert.ok(token.length > 30);
    assert.equal(await mobile.evaluate(value => Object.values(localStorage).some(item => item.includes(value)), token), false);
    assert.ok((await mobile.locator('#connection-list').innerText()).includes('연결 프로그램 대기'));
    const connections = await get(`/api/patients/${patient.id}/health-connections`);
    assert.equal(connections.webDirectCollection, false);
    assert.equal(connections.nativeBridge.verified, false);
    assert.ok(!JSON.stringify(connections).includes(token));
    await mobile.locator('.bottom-nav [data-view=guide]').click();
    assert.equal(await mobile.locator('#connection-token-value').textContent(), '');
    await mobile.goBack();
    await mobile.locator('#view-connections').waitFor({ state: 'visible' });
    await mobile.locator('#connection-list [data-action=revoke-connection]').waitFor({ state: 'visible' });
    await assertHidden(mobile.locator('#connection-token'));
    mobile.once('dialog', dialog => dialog.accept());
    await mobile.locator('#connection-list [data-action=revoke-connection]').click();
    await mobile.locator('.connection-status.revoked').waitFor({ state: 'visible' });
    assert.equal(await mobile.locator('#connection-token-value').textContent(), '');
  });

  await check('unconfigured photo AI offers a working manual meal path and makes no analysis request', async () => {
    await patientPage(mobile, patient.id);
    let analysisRequests = 0;
    const listener = request => { if (request.url().endsWith('/photo-analyses')) analysisRequests++; };
    mobile.on('request', listener);
    await mobile.locator('#open-meal').click();
    assert.ok((await mobile.locator('#meal-analysis-availability').innerText()).includes('설정되지'));
    assert.equal(await mobile.locator('#meal-analysis-consent').isDisabled(), true);
    await mobile.locator('#meal-photo').setInputFiles(pngFile);
    await mobile.locator('#photo-preview').waitFor({ state: 'visible' });
    assert.equal(await mobile.locator('#meal-analyze').isDisabled(), true);
    await mobile.locator('#meal-form').getByText('고기·생선·두부', { exact: true }).click();
    await mobile.locator('#meal-form').getByText('절반', { exact: true }).click();
    const saving = responseFor(mobile, `/api/patients/${patient.id}/meals`);
    await mobile.locator('#meal-submit').click();
    const response = await saving; assert.equal(response.status(), 201);
    const saved = (await response.json()).meal;
    assert.equal(saved.source, 'demo-food-table-v1');
    assert.equal(saved.analysisId, null);
    assert.equal(saved.calories, 290); assert.equal(saved.proteinGrams, 17.5);
    assert.equal(analysisRequests, 0);
    await mobile.locator('#meal-dialog').waitFor({ state: 'hidden' });
    mobile.off('request', listener);
  });

  await check('MOCK AI fixture requires consent and draft/portion confirmation, then saves through the real hash-bound one-use meal API', async () => {
    const page = await newPage(true); await enableMockVision(page);
    const proposal = { foodType: 'protein', foodLabel: '가상 제공자 두부 식사', foods: [{ name: '가상 두부' }], calories: 612, proteinGrams: 30.8, confidence: .7 };
    let analysis;
    let calls = 0;
    await page.route('**/api/patients/*/photo-analyses', async route => {
      calls++;
      const body = route.request().postDataJSON();
      assert.equal(body.consentExternalProcessing, true); assert.equal(body.kind, 'meal');
      analysis = draft(patient.id, 'meal', proposal); storeMockDraft(analysis, body.imageData);
      await route.fulfill({ json: { analysis } });
    });
    await patientPage(page, patient.id);
    await page.locator('#open-meal').click(); await page.locator('#meal-photo').setInputFiles(pngFile);
    await page.locator('#photo-preview').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#meal-analyze').isDisabled(), true); assert.equal(calls, 0);
    await page.locator('#meal-analysis-consent').check(); await page.locator('#meal-analyze').click();
    await page.locator('#meal-analysis-confirm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#meal-submit').isDisabled(), true);
    await page.locator('#meal-analysis-confirm').check();
    await page.locator('#meal-form').getByText('절반', { exact: true }).click();
    assert.equal(await page.locator('#meal-analysis-confirm').isChecked(), false);
    assert.equal(await page.locator('#meal-submit').isDisabled(), true);
    await page.locator('#meal-analysis-confirm').check();
    const saving = responseFor(page, `/api/patients/${patient.id}/meals`);
    await page.locator('#meal-submit').click();
    const response = await saving; assert.equal(response.status(), 201);
    const payload = response.request().postDataJSON();
    assert.equal(payload.analysisId, analysis.id); assert.equal(payload.patientConfirmed, true);
    assert.equal(payload.calories, undefined); assert.equal(payload.source, undefined);
    const saved = (await response.json()).meal;
    assert.equal(saved.source, 'openai-image-estimate-v1'); assert.equal(saved.foodLabel, proposal.foodLabel);
    assert.equal(saved.calories, 306); assert.equal(saved.proteinGrams, 15.4);
    assert.equal(saved.estimation.model, 'fixture-browser-not-live'); assert.equal(saved.estimation.patientConfirmed, true);
    assert.equal((await post(`/api/patients/${patient.id}/meals`, payload)).status, 409);
    assert.equal(calls, 1);
    await page.locator('#meal-dialog').waitFor({ state: 'hidden' });
    await page.close();
  });

  await check('MOCK AI late responses cannot survive a changed image or a closed and reopened meal form', async () => {
    const page = await newPage(true); await enableMockVision(page);
    const pending = [];
    await page.route('**/api/patients/*/photo-analyses', async route => {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      pending.push({ release });
      await held;
      await route.fulfill({ json: { analysis: draft(patient.id, 'meal', { foodType: 'balanced', foodLabel: '도착하면 안 되는 과거 초안', foods: [{ name: '가상 음식' }], calories: 999, proteinGrams: 99, confidence: .9 }) } });
    });
    await patientPage(page, patient.id);
    await page.locator('#open-meal').click(); await page.locator('#meal-photo').setInputFiles(pngFile);
    await page.locator('#photo-preview').waitFor({ state: 'visible' });
    await page.locator('#meal-analysis-consent').check(); await page.locator('#meal-analyze').click();
    await until(() => pending.length === 1, 'first mocked analysis request');
    const changedImage = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 3; const context = canvas.getContext('2d'); context.fillStyle = '#e8ba3a'; context.fillRect(0, 0, 3, 3); return canvas.toDataURL('image/png'); });
    await page.locator('#meal-photo').setInputFiles({ name: 'changed-browser-fixture.png', mimeType: 'image/png', buffer: Buffer.from(changedImage.split(',')[1], 'base64') });
    await page.waitForFunction(image => document.querySelector('#photo-preview').src === image, changedImage);
    const late = page.waitForResponse(response => response.url().endsWith('/photo-analyses'));
    pending[0].release(); await (await late).finished(); await flushUi(page);
    await assertHidden(page.locator('#meal-analysis-review'));
    assert.equal(await page.locator('#meal-analysis-consent').isChecked(), false);
    const saving = responseFor(page, `/api/patients/${patient.id}/meals`);
    await page.locator('#meal-submit').click();
    const savedResponse = await saving; assert.equal(savedResponse.status(), 201);
    assert.equal(savedResponse.request().postDataJSON().imageData, changedImage);
    assert.equal(savedResponse.request().postDataJSON().analysisId, undefined);
    assert.equal((await savedResponse.json()).meal.source, 'demo-food-table-v1');
    await page.locator('#meal-dialog').waitFor({ state: 'hidden' }); await settledPatient(page);
    await page.locator('#open-meal').click(); await page.locator('#meal-photo').setInputFiles(pngFile);
    await page.locator('#photo-preview').waitFor({ state: 'visible' });
    await page.locator('#meal-analysis-consent').check(); await page.locator('#meal-analyze').click();
    await until(() => pending.length === 2, 'second mocked analysis request');
    await page.locator('#meal-dialog .close-dialog').click(); await page.locator('#open-meal').click();
    const closedLate = page.waitForResponse(response => response.url().endsWith('/photo-analyses'));
    pending[1].release(); await (await closedLate).finished(); await flushUi(page);
    await assertHidden(page.locator('#meal-analysis-review')); await assertHidden(page.locator('#photo-preview'));
    assert.equal(await page.locator('#meal-analysis-consent').isChecked(), false);
    assert.ok(!(await page.locator('#meal-dialog').innerText()).includes('도착하면 안 되는 과거 초안'));
    await page.close();
  });

  await check('MOCK medication OCR requires consent and label verification and imports only the candidate name and strength', async () => {
    const page = await newPage(); await enableMockVision(page);
    let calls = 0;
    await page.route('**/api/patients/*/photo-analyses', async route => {
      calls++;
      const body = route.request().postDataJSON(); assert.equal(body.kind, 'medication'); assert.equal(body.consentExternalProcessing, true);
      const analysis = draft(patient.id, 'medication', { medications: [{ name: '가상 OCR 이름', strength: '10 mg', labelText: '<img src=x onerror="window.__ocrInjected=true"> 가상 OCR 이름 10 mg' }], confidence: .4 });
      await route.fulfill({ json: { analysis } });
    });
    await page.goto(`${base}/clinician?patientId=${patient.id}`, { waitUntil: 'networkidle' }); await ready(page);
    await page.locator('#main-nav [data-view=medications]').click();
    await page.locator('.medication-toolbar [data-action=add-medication-order]').click();
    await page.locator('.medication-photo-helper summary').click();
    await page.waitForFunction(() => !document.querySelector('#medication-photo').disabled);
    await page.locator('#medication-photo').setInputFiles(pngFile);
    await page.locator('#medication-photo-preview').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#analyze-medication-photo').isDisabled(), true); assert.equal(calls, 0);
    await page.locator('#medication-photo-consent').check(); await page.locator('#analyze-medication-photo').click();
    await page.locator('.medication-candidate').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-modal-action=use-medication-candidate]').isDisabled(), true);
    assert.equal(await page.locator('.medication-candidate img').count(), 0);
    assert.equal(await page.evaluate(() => window.__ocrInjected), undefined);
    await page.locator('[data-candidate-confirm]').check(); await page.locator('[data-modal-action=use-medication-candidate]').click();
    assert.equal(await page.locator('#medication-name').inputValue(), '가상 OCR 이름');
    assert.equal(await page.locator('#medication-strength').inputValue(), '10 mg');
    for (const selector of ['#medication-dose', '#medication-route', '#medication-instructions', '#medication-times [name=times]']) assert.equal(await page.locator(selector).inputValue(), '');
    assert.equal(await page.locator('#medication-order-confirmed').isChecked(), false);
    assert.equal(calls, 1);
    await page.locator('#modal [data-modal-action=close]').first().click(); await page.close();
  });

  assert.deepEqual(pageErrors, []);
  console.log(`${completed} automation browser scenarios passed. AI scenarios used mocked provider fixtures only; actual AI and native device integration remain unverified.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  fixtureDb?.close();
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  await rm(temp, { recursive: true, force: true });
}
