import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const temp = await mkdtemp(join(tmpdir(), 'homecare-browser-'));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
  cwd: new URL('..', import.meta.url), env: { ...process.env, AUTH_MODE: 'demo', APP_ORIGIN: '', VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '', PORT: String(port), DATA_DIR: temp }, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
let browser;
const pageErrors = [];
const artifacts = new URL('../test-results/', import.meta.url).pathname;
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = async path => { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json(); };
async function ready(page) { await page.locator('#app-content').waitFor({ state: 'visible' }); }
async function check(name, action) { await action(); console.log(`PASS ${name}`); }
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    if (child.exitCode !== null) throw new Error(output);
    await delay(100);
  }
  const today = (await get('/api/health')).today;
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}) });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const page of [mobile, desktop]) page.on('pageerror', error => pageErrors.push(error.message));
  let id;

  await check('landing routes and desktop dashboard', async () => {
    await desktop.goto(base + '/', { waitUntil: 'networkidle' });
    assert.equal(await desktop.locator('a.portal').count(), 2);
    await desktop.screenshot({ path: artifacts + 'landing.png', fullPage: true });
    await desktop.goto(base + '/clinician', { waitUntil: 'networkidle' });
    await ready(desktop);
    assert.equal(await desktop.locator('.patient-row').count(), 6);
    assert.equal(await desktop.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await desktop.screenshot({ path: artifacts + 'clinician-desktop.png', fullPage: true });
  });
  await check('clinician adds a demo patient through the interface', async () => {
    await desktop.locator('#add-patient-button').click();
    await desktop.locator('#new-patient-name').fill('정테스트');
    await desktop.locator('#new-patient-age').fill('76');
    await desktop.locator('#new-patient-conditions').fill('고혈압, 당뇨병');
    await desktop.locator('#add-patient-form button[type=submit]').click();
    await desktop.locator('#modal-backdrop').waitFor({ state: 'hidden' });
    const patients = (await get('/api/patients')).patients;
    id = patients.find(patient => patient.name === '정테스트').id;
    await desktop.waitForFunction(() => document.querySelector('#patient-detail')?.textContent.includes('정테스트'));
  });
  await check('mobile daily entry saves to the shared database', async () => {
    await mobile.goto(`${base}/patient?patientId=${id}`, { waitUntil: 'networkidle' });
    await ready(mobile);
    await mobile.locator('#open-daily').click();
    await mobile.locator('#daily-form').getByText('모두 먹었어요', { exact: true }).click();
    await mobile.locator('#daily-steps').fill('4321');
    await mobile.locator('#daily-sleep').fill('7.8');
    await mobile.locator('#daily-weight').fill('63.5');
    await mobile.locator('#daily-note').fill('모바일에서 저장한 테스트 기록');
    await mobile.locator('#daily-submit').click();
    await mobile.locator('#daily-dialog').waitFor({ state: 'hidden' });
    const record = (await get(`/api/patients/${id}/summary`)).todayRecord;
    assert.equal(record.steps, 4321);
    assert.equal(record.sleepHours, 7.8);
    assert.equal(record.medicationStatus, 'taken');
    assert.equal(record.note, '모바일에서 저장한 테스트 기록');
  });
  await check('mobile photo and meal appear in clinician analysis', async () => {
    await mobile.locator('#open-meal').click();
    const imageData = await mobile.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40; const context = canvas.getContext('2d'); context.fillStyle = '#d7e8ce'; context.fillRect(0, 0, 40, 40); return canvas.toDataURL('image/png'); });
    await mobile.locator('#meal-photo').setInputFiles({ name: 'demo-meal.png', mimeType: 'image/png', buffer: Buffer.from(imageData.split(',')[1], 'base64') });
    await mobile.getByText('고기·생선·두부', { exact: true }).click();
    await mobile.getByText('절반', { exact: true }).click();
    await mobile.locator('#meal-submit').click();
    await mobile.locator('#meal-dialog').waitFor({ state: 'hidden' });
    await desktop.locator('#refresh-button').click();
    await desktop.waitForFunction(() => document.querySelector('#patient-detail')?.textContent.includes('모바일에서 저장한 테스트 기록'));
    await desktop.locator('#patient-detail .meal-visual img').waitFor({ state: 'visible' });
    const summary = await get(`/api/patients/${id}/summary`);
    assert.equal(summary.todayMeals[0].proteinGrams, 17.5);
    assert.ok((await desktop.locator('#patient-detail').innerText()).includes('4,321'));
    await mobile.screenshot({ path: artifacts + 'patient-mobile.png', fullPage: true });
  });
  await check('historical edit preserves fields and patient changes isolate records', async () => {
    const pastDate = new Date(today + 'T12:00:00Z'); pastDate.setUTCDate(pastDate.getUTCDate() - 20);
    const date = pastDate.toISOString().slice(0, 10);
    await post(`/api/patients/${id}/daily`, { date, note: '이전 기록 보존', steps: 2222, sleepHours: 6, medicationStatus: 'partial', appetite: 'poor', mood: 'normal' });
    await mobile.locator('#open-daily').click();
    await mobile.locator('#daily-date').fill(date);
    await mobile.locator('#daily-date').dispatchEvent('change');
    await mobile.waitForFunction(() => document.querySelector('#daily-note').value === '이전 기록 보존');
    await mobile.locator('#daily-sleep').fill('6.5');
    await mobile.locator('#daily-submit').click();
    await mobile.locator('#daily-dialog').waitFor({ state: 'hidden' });
    const historical = (await get(`/api/patients/${id}/daily?date=${date}`)).record;
    assert.equal(historical.note, '이전 기록 보존');
    assert.equal(historical.steps, 2222);
    await mobile.locator('#patient-select').selectOption('p001');
    await mobile.waitForFunction(() => !document.querySelector('#patient-name').textContent.includes('정테스트'));
    await mobile.locator('#open-daily').click();
    assert.notEqual(await mobile.locator('#daily-note').inputValue(), '모바일에서 저장한 테스트 기록');
    await mobile.keyboard.press('Escape');
  });
  await check('mobile tabs, desktop filtering and CSV download work', async () => {
    await mobile.locator('.bottom-nav button[data-view=records]').click();
    await mobile.locator('#view-records').waitFor({ state: 'visible' });
    await mobile.locator('.chart-tab[data-metric=sleepHours]').click();
    assert.ok((await mobile.locator('#trend-chart').getAttribute('aria-label')).includes('수면'));
    await mobile.locator('.bottom-nav button[data-view=guide]').click();
    await mobile.locator('#view-guide').waitFor({ state: 'visible' });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await desktop.locator('#main-nav button[data-view=patients]').click();
    await desktop.locator('#patient-search').fill('정테스트');
    assert.equal(await desktop.locator('.patient-row').count(), 1);
    await desktop.locator('#main-nav button[data-view=records]').click();
    const downloading = desktop.waitForEvent('download');
    await desktop.locator('.records-toolbar a[href="/api/export.csv"]').click();
    assert.match((await downloading).suggestedFilename(), /homecare-demo.*\.csv/);
  });
  await check('confirmed empty reset, empty screens and sample restore work through UI', async () => {
    await desktop.locator('#main-nav button[data-view=settings]').click();
    await desktop.locator('[data-action=reset][data-mode=empty]').click();
    await desktop.locator('#reset-confirmation').fill('초기화');
    await desktop.locator('#reset-form button[type=submit]').click();
    await desktop.locator('#modal-backdrop').waitFor({ state: 'hidden' });
    await desktop.locator('.empty-state').waitFor({ state: 'visible' });
    assert.equal((await get('/api/health')).counts.patients, 0);
    await mobile.reload({ waitUntil: 'networkidle' });
    assert.ok((await mobile.locator('body').innerText()).includes('환자'));
    await desktop.locator('[data-action=reset][data-mode=seed]').click();
    await desktop.locator('#reset-confirmation').fill('초기화');
    await desktop.locator('#reset-form button[type=submit]').click();
    await desktop.locator('#modal-backdrop').waitFor({ state: 'hidden' });
    await desktop.locator('.patient-row').first().waitFor({ state: 'visible' });
    assert.equal((await get('/api/health')).counts.patients, 6);
    assert.deepEqual(pageErrors, []);
  });
  console.log('7 browser scenarios passed; screenshots saved in test-results/.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  await rm(temp, { recursive: true, force: true });
}
