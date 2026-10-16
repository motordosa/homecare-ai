// These tests use only a temporary local server/database and clearly marked mocked AI responses.
// No real image is sent to an external provider, and no public deployment is modified.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
  await mkdir('test-results', { recursive: true });

  async function clinicianRoute(page, view, id, date = null) {
    await page.waitForFunction(({ view, id, date }) => {
      const url = new URL(location.href);
      return url.pathname === '/clinician' && (url.searchParams.get('view') || 'overview') === view
        && (!id || url.searchParams.get('patientId') === id)
        && (!date || url.searchParams.get('medicationDate') === date)
        && document.querySelector('#main-nav [aria-current="page"]')?.dataset.view === view;
    }, { view, id, date });
    await flushUi(page);
  }
  await check('clinician menus preserve real Back/Forward history from the landing page without refresh duplicates', async () => {
    const page = await newPage();
    await page.clock.install();
    await page.goto(base);
    await page.locator('.portal.clinician').click(); await ready(page);
    const id = new URL(page.url()).searchParams.get('patientId');
    const views = ['overview', 'patients', 'medications', 'records', 'settings'];
    for (const view of views.slice(1)) {
      await page.locator(`#main-nav [data-view="${view}"]`).click();
      await clinicianRoute(page, view, id);
    }
    const length = await page.evaluate(() => history.length);
    await page.locator('#main-nav [data-view="settings"]').click();
    await page.locator('#refresh-button').click();
    await page.waitForFunction(() => !document.querySelector('#refresh-button').disabled);
    assert.equal(await page.evaluate(() => history.length), length);
    const autoRefresh = page.waitForResponse(r => r.url() === `${base}/api/dashboard`);
    await page.clock.fastForward(20_001); await autoRefresh;
    await page.waitForFunction(() => !document.querySelector('#refresh-button').disabled);
    assert.equal(await page.evaluate(() => history.length), length);
    await page.goBack(); await clinicianRoute(page, 'records', id);
    assert.equal(await page.locator('#page-title').innerText(), '건강 기록');
    assert.equal(await page.locator('#record-patient').inputValue(), id);
    await page.goForward(); await clinicianRoute(page, 'settings', id);
    for (const view of [...views.slice(0, -1)].reverse()) {
      await page.goBack(); await clinicianRoute(page, view, id);
    }
    await page.goBack(); assert.equal(new URL(page.url()).pathname, '/');
    await page.close();
  });
  await check('clinician Back/Forward restores selected patients and medication dates, including reload and direct URL', async () => {
    const page = await newPage();
    await page.goto(`${base}/clinician?patientId=${patient.id}&view=records`); await ready(page);
    await page.locator('#record-patient').selectOption(otherPatient.id);
    await clinicianRoute(page, 'records', otherPatient.id);
    await page.waitForFunction(name => document.querySelector('#app-content').textContent.includes(name), otherPatient.name);
    await page.goBack(); await clinicianRoute(page, 'records', patient.id);
    await page.waitForFunction(name => document.querySelector('#app-content').textContent.includes(name), patient.name);
    assert.equal(await page.locator('#record-patient').inputValue(), patient.id);
    await page.goForward(); await clinicianRoute(page, 'records', otherPatient.id);
    await page.locator('#main-nav [data-view="medications"]').click();
    await page.locator('#medication-date').waitFor();
    const previous = new Date(Date.parse(`${today}T12:00:00+09:00`) - 86400000).toISOString().slice(0, 10);
    await page.locator('#medication-date').fill(previous);
    await clinicianRoute(page, 'medications', otherPatient.id, previous);
    await page.locator('#main-nav [data-view="settings"]').click();
    await page.goBack(); await clinicianRoute(page, 'medications', otherPatient.id, previous);
    assert.equal(await page.locator('#medication-date').inputValue(), previous);
    await page.goBack(); await clinicianRoute(page, 'medications', otherPatient.id, today);
    assert.equal(await page.locator('#medication-date').inputValue(), today);
    await page.goForward(); await clinicianRoute(page, 'medications', otherPatient.id, previous);
    await page.reload(); await ready(page);
    await clinicianRoute(page, 'medications', otherPatient.id, previous);
    assert.equal(await page.locator('#medication-date').inputValue(), previous);
    await page.close();
  });
  await check('clinician Back invalidates a delayed patient selection response and preserves the restored route', async () => {
    const page = await newPage();
    await page.goto(`${base}/clinician?patientId=${patient.id}&view=records`); await ready(page);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let intercepted = false;
    await page.route(`**/api/patients/${otherPatient.id}/summary`, async route => {
      intercepted = true;
      await gate;
      await route.continue();
    });
    await page.locator('#record-patient').selectOption(otherPatient.id);
    await until(() => intercepted, 'delayed clinician patient request');
    await page.goBack(); await clinicianRoute(page, 'records', patient.id);
    await page.locator('#record-patient').waitFor();
    const response = page.waitForResponse(r => r.url() === `${base}/api/patients/${otherPatient.id}/summary`);
    release(); await response; await flushUi(page);
    await clinicianRoute(page, 'records', patient.id);
    assert.equal(await page.locator('#record-patient').inputValue(), patient.id);
    assert.equal(await page.locator('#app-content').getByRole('heading', {name: `${patient.name} 님의 건강 기록`}).count(), 1);
    assert.equal(await page.locator('#app-content').getByRole('heading', {name: `${otherPatient.name} 님의 건강 기록`}).count(), 0);
    await page.close();
  });

  await check('every patient subpage uses the same upper-right close control and role switching is confined to the guide', async () => {
    for (const width of [320, 390]) {
      await mobile.setViewportSize({ width, height: 844 });
      await patientPage(mobile, patient.id);
      await assertHidden(mobile.locator('#patient-view-close'));
      let closeBounds;
      for (const view of ['records', 'medication', 'connections', 'guide']) {
        await mobile.locator(`.bottom-nav [data-view=${view}]`).click();
        await mobile.locator(`#view-${view}`).waitFor({ state: 'visible' });
        const close = mobile.getByRole('button', { name: '홈으로 돌아가기', exact: true });
        assert.equal(await close.isVisible(), true);
        const bounds = await close.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44);
        if (closeBounds) assert.deepEqual(bounds, closeBounds); else closeBounds = bounds;
        assert.equal(await mobile.locator('.patient-header a[href^="/clinician"]').count(), 0);
        assert.equal(await mobile.locator('#guide-clinician-link').isVisible(), view === 'guide');
        assert.equal(await mobile.locator('.bottom-nav [aria-current=page]').getAttribute('data-view'), view);
        assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width === 390 && view === 'medication') await mobile.screenshot({ path: 'test-results/patient-navigation-medication.png', fullPage: true });
        await close.click();
        await mobile.locator('#view-home').waitFor({ state: 'visible' });
        assert.equal(new URL(mobile.url()).searchParams.get('patientId'), patient.id);
        assert.equal(new URL(mobile.url()).searchParams.get('view'), null);
      }
    }
  });

  await check('a failed medication lookup does not turn a legacy self-report into verified daily completion', async () => {
    const page = await newPage(true);
    await post(`/api/patients/${patient.id}/daily`, { date: today, medicationStatus: 'taken' });
    await page.route('**/medication-schedule?*', route => route.fulfill({ status: 503, json: { error: '명시적 조회 실패 fixture' } }));
    await patientPage(page, patient.id);
    assert.ok((await page.locator('#today-metrics [data-action=medication]').innerText()).includes('일정 확인 필요'));
    assert.equal(await page.locator('#task-chips .task-chip.done').filter({ hasText: '복약' }).count(), 0);
    await page.close();
  });

  await check('all input close controls return to the opener and unsaved input survives a cancelled close', async () => {
    await patientPage(mobile, patient.id);
    await mobile.locator('#open-meal').click();
    await mobile.locator('#meal-dialog .close-dialog').click();
    await assertHidden(mobile.locator('#meal-dialog'));
    assert.equal(await mobile.evaluate(() => document.activeElement?.id), 'open-meal');
    await mobile.locator('#open-meal').click();
    await mobile.locator('#meal-form input[name=portion][value="0.5"]').check();
    mobile.once('dialog', dialog => dialog.dismiss());
    await mobile.locator('#meal-dialog .close-dialog').click();
    assert.equal(await mobile.locator('#meal-dialog').isVisible(), true);
    assert.equal(await mobile.locator('#meal-form input[name=portion][value="0.5"]').isChecked(), true);
    mobile.once('dialog', dialog => dialog.accept());
    await mobile.keyboard.press('Escape');
    await assertHidden(mobile.locator('#meal-dialog'));
    await mobile.locator('#open-daily').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    await mobile.locator('#daily-dialog .close-dialog').click();
    await assertHidden(mobile.locator('#daily-dialog'));
    await mobile.locator('.bottom-nav [data-view=connections]').click();
    for (const action of ['steps', 'sleep']) {
      await mobile.locator(`#view-connections [data-action=${action}]`).click();
      await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
      if (action === 'steps') {
        await mobile.locator('#daily-steps').fill('2468');
        mobile.once('dialog', dialog => dialog.dismiss());
        await mobile.locator('#daily-dialog .close-dialog').click();
        assert.equal(await mobile.locator('#daily-steps').inputValue(), '2468');
        mobile.once('dialog', dialog => dialog.accept());
      }
      await mobile.locator('#daily-dialog .close-dialog').click();
      await assertHidden(mobile.locator('#daily-dialog'));
      assert.equal(await mobile.locator('#view-connections').isVisible(), true);
    }
  });

  await check('unsaved medication input blocks accidental role, patient and home changes, and save locks navigation', async () => {
    await patientPage(mobile, otherPatient.id, '&view=medication');
    await mobile.locator('#legacy-medication').waitFor({ state: 'visible' });
    await mobile.locator('#legacy-medication-form input[value=taken]').check();
    mobile.once('dialog', dialog => dialog.dismiss());
    await mobile.locator('#patient-view-close').click();
    assert.equal(await mobile.locator('#view-medication').isVisible(), true);
    mobile.once('dialog', dialog => dialog.dismiss());
    await mobile.locator('#patient-select').selectOption(patient.id);
    assert.equal(await mobile.locator('#patient-select').inputValue(), otherPatient.id);
    let release;
    await mobile.route(`**/api/patients/${otherPatient.id}/daily`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise(resolve => { release = resolve; });
      await route.continue();
    });
    await mobile.locator('#legacy-medication-submit').click();
    await until(() => release, 'delayed medication write');
    assert.equal(await mobile.locator('#patient-view-close').isDisabled(), true);
    assert.equal(await mobile.locator('#patient-select').isDisabled(), true);
    assert.equal(await mobile.locator('.bottom-nav button:enabled').count(), 0);
    await mobile.evaluate(() => { history.pushState({}, '', '/patient?view=guide'); dispatchEvent(new PopStateEvent('popstate')); });
    assert.equal(new URL(mobile.url()).searchParams.get('view'), 'medication');
    assert.equal(new URL(mobile.url()).searchParams.get('patientId'), otherPatient.id);
    release();
    await mobile.waitForFunction(() => !document.querySelector('#legacy-medication-submit').disabled);
    await mobile.unroute(`**/api/patients/${otherPatient.id}/daily`);
    await mobile.locator('#patient-view-close').click();
    await mobile.locator('#view-home').waitFor({ state: 'visible' });
  });

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
    assert.ok((await mobile.locator('#guide-clinician-link').getAttribute('href')).includes(encodeURIComponent(patient.id)));
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

  await check('saving one medication slot preserves a different slot draft and its unsaved-navigation protection', async () => {
    await patientPage(mobile, patient.id, '&view=medication');
    await mobile.locator('#medication-slot-1').waitFor({ state: 'visible' });
    await mobile.locator('#slot-note-0').fill('첫 회차 추가 정정');
    await mobile.locator('#medication-slot-1 input[value=unknown]').check();
    await mobile.locator('#slot-note-1').fill('다른 회차의 아직 저장하지 않은 입력');
    await mobile.locator('#medication-slot-0 button[type=submit]').click();
    await mobile.waitForFunction(() => !document.querySelector('#medication-slot-0 button[type=submit]').disabled);
    assert.equal(await mobile.locator('#slot-note-1').inputValue(), '다른 회차의 아직 저장하지 않은 입력');
    assert.equal(await mobile.locator('#medication-slot-1 input[value=unknown]').isChecked(), true);
    mobile.once('dialog', dialog => dialog.dismiss());
    await mobile.locator('#patient-view-close').click();
    assert.equal(await mobile.locator('#view-medication').isVisible(), true);
    const leavePrompt = mobile.waitForEvent('dialog');
    // A deliberately cancelled document navigation never reaches "load".
    // Use actual browser history and verify the beforeunload prompt instead of waiting for a load.
    await mobile.evaluate(() => history.back());
    const prompt = await leavePrompt;
    assert.equal(prompt.type(), 'beforeunload');
    await prompt.dismiss();
    await flushUi(mobile);
    assert.equal(await mobile.locator('#view-medication').isVisible(), true);
    assert.equal(await mobile.locator('#slot-note-1').inputValue(), '다른 회차의 아직 저장하지 않은 입력');
    await mobile.locator('#medication-slot-1 button[type=submit]').click();
    await mobile.waitForFunction(() => !document.querySelector('#medication-slot-1 button[type=submit]').disabled);
    const schedule = await get(`/api/patients/${patient.id}/medication-schedule?date=${today}`);
    assert.equal(schedule.slots[1].status, 'unknown');
    assert.equal(schedule.slots[1].note, '다른 회차의 아직 저장하지 않은 입력');
    await mobile.locator('#patient-view-close').click();
    await mobile.locator('#view-home').waitFor({ state: 'visible' });
  });

  await check('health connection shows the exact server and patient identity and clears its one-time credentials on dismissal and navigation', async () => {
    const privateFields = ['connection-token-value', 'connection-server-origin', 'connection-patient-name', 'connection-patient-id'];
    const assertConnectionIdentity = async () => {
      assert.equal(await mobile.locator('#connection-server-origin').textContent(), base);
      assert.equal(await mobile.locator('#connection-patient-name').textContent(), patient.name);
      assert.equal(await mobile.locator('#connection-patient-id').textContent(), patient.id);
    };
    const assertCredentialsCleared = async () => {
      await assertHidden(mobile.locator('#connection-token'));
      for (const id of privateFields) assert.equal(await mobile.locator(`#${id}`).textContent(), '', id);
    };
    await patientPage(mobile, patient.id, '&view=connections');
    await mobile.locator('#connection-list .empty-state-card').waitFor({ state: 'visible' });
    assert.ok((await mobile.locator('#view-connections .connection-help').innerText()).includes('직접 읽지 않아요'));
    await mobile.locator('.connection-setup summary').click();
    await mobile.locator('#connection-label').fill('브라우저 연결 검증');
    await mobile.locator('#connection-create').click();
    await mobile.locator('#connection-token').waitFor({ state: 'visible' });
    const token = await mobile.locator('#connection-token-value').innerText();
    assert.ok(token.length > 30);
    await assertConnectionIdentity();
    assert.equal(await mobile.evaluate(value => Object.values(localStorage).some(item => item.includes(value)), token), false);
    assert.ok((await mobile.locator('#connection-list').innerText()).includes('연결 프로그램 대기'));
    const connections = await get(`/api/patients/${patient.id}/health-connections`);
    assert.equal(connections.webDirectCollection, false);
    assert.equal(connections.nativeBridge.verified, false);
    assert.ok(!JSON.stringify(connections).includes(token));
    await mobile.locator('#connection-token-dismiss').click();
    await assertCredentialsCleared();
    await mobile.locator('#connection-create').click();
    await mobile.locator('#connection-token').waitFor({ state: 'visible' });
    await assertConnectionIdentity();
    await mobile.locator('.bottom-nav [data-view=guide]').click();
    await assertCredentialsCleared();
    await mobile.goBack();
    await mobile.locator('#view-connections').waitFor({ state: 'visible' });
    await mobile.locator('#connection-list [data-action=revoke-connection]').first().waitFor({ state: 'visible' });
    await assertCredentialsCleared();
    mobile.once('dialog', dialog => dialog.accept());
    await mobile.locator('#connection-list [data-action=revoke-connection]').first().click();
    await mobile.locator('.connection-status.revoked').waitFor({ state: 'visible' });
    await assertCredentialsCleared();
  });

  await check('partial-permission device fixtures merge independently into patient cards and manual zero remains authoritative', async () => {
    const created = await post('/api/patients', { name: '부분권한수신검증', age: 76, sex: 'female', conditions: ['합성 자료'] });
    const fixturePatient = (await created.json()).patient;
    const path = `/api/patients/${fixturePatient.id}`;
    const connection = await (await post(`${path}/health-connections`, { platform: 'health-connect' })).json();
    const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
    const identity = await (await fetch(base + '/api/health-sync/connection', { headers })).json();
    assert.equal(identity.partialMetrics, true);
    assert.equal(identity.selected, true);
    const send = (batchId, day) => fetch(base + '/api/health-sync', { method: 'POST', headers, body: JSON.stringify({ batchId, timeZone: 'Asia/Seoul', days: [{ date: today, ...day }] }) });
    assert.equal((await send('steps-only-browser', { steps: 1200, updatedAt: new Date(Date.now() - 60000).toISOString() })).status, 200);
    assert.equal((await send('sleep-only-browser', { sleepMinutes: 360, updatedAt: new Date(Date.now() - 120000).toISOString() })).status, 200);
    let summary = await get(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 1200);
    assert.equal(summary.todayRecord.sleepHours, 6);
    assert.equal(summary.todayRecord.stepsSource, 'health-connect');
    assert.equal(summary.todayRecord.sleepSource, 'health-connect');
    assert.equal((await get(`${path}/daily?date=${today}`)).record, null);
    await patientPage(mobile, fixturePatient.id);
    assert.ok((await mobile.locator('#today-metrics [data-action=steps]').innerText()).includes('1,200'));
    assert.ok((await mobile.locator('#today-metrics [data-action=sleep]').innerText()).includes('Health Connect'));
    await mobile.locator('#today-metrics [data-action=steps]').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    await mobile.locator('#daily-steps').fill('0');
    await saveDaily(mobile, fixturePatient.id, { date: today, steps: 0 });
    summary = await get(`${path}/summary`);
    assert.equal(summary.todayRecord.steps, 0);
    assert.equal(summary.todayRecord.stepsSource, 'patient-self-report');
    assert.equal(summary.todayRecord.sleepHours, 6);
    await mobile.locator('#today-metrics [data-action=steps]').click();
    await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    await mobile.locator('#daily-steps').fill('');
    await saveDaily(mobile, fixturePatient.id, { date: today, steps: null });
    assert.equal((await get(`${path}/summary`)).todayRecord.steps, 1200);
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
    page.once('dialog', dialog => dialog.accept());
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
