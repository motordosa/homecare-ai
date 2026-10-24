// Local synthetic records and a marked in-process Europe PMC fixture only.
// This checks browser behavior, not older-adult usability or live API access.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const temp = await mkdtemp(join(tmpdir(), 'homecare-usability-browser-'));
const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const fixture = `const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{const u=new URL(String(url));if(u.origin==='https://www.ebi.ac.uk'&&u.pathname==='/europepmc/webservices/rest/search')return Response.json({hitCount:1,resultList:{result:[{id:'12345678',source:'MED',pmid:'12345678',doi:'10.1234/synthetic-study',title:'Synthetic older-adult study — fictional test fixture',authorString:'Kim A',pubYear:'2025',journalInfo:{journal:{title:'Synthetic Journal'}},abstractText:'Entirely fictional evidence for interface verification.',pubTypeList:{pubType:['Journal Article']}}]}});if(u.protocol==='https:')throw Error('Unexpected external request in local fixture');return original(url,options);};`;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'data:text/javascript,' + encodeURIComponent(fixture), 'server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'test', AUTH_MODE: 'demo', APP_ORIGIN: '', PORT: String(port), DATA_DIR: temp,
    VISION_ENABLED: 'false', HOMECARE_VISION_API_KEY: '', OPENAI_API_KEY: '', STAFF_ACCESS_JSON: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', browser, count = 0; const errors = [], measurements = [];
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
async function check(name, action) { await action(); count++; console.log('PASS ' + name); }
async function until(predicate, label = 'condition') {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(50); }
  throw Error('Timed out: ' + label);
}
async function get(path) { const response = await fetch(base + path); assert.equal(response.status, 200, path); return response.json(); }
async function write(path, body, context, method = 'POST') {
  if (context) {
    const session = await (await context.request.get(base + '/api/auth/session')).json();
    return context.request.fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, data: body });
  }
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function newPage(viewport) {
  const context = await browser.newContext({ viewport }); const page = await context.newPage();
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); return page;
}
async function patientPage(page, id, view = '') {
  await page.goto(`${base}/patient?patientId=${id}${view ? '&view=' + view : ''}`);
  await page.locator('#app-content:not([hidden])').waitFor(); await page.waitForFunction(() => !document.querySelector('#patient-select').disabled);
}
async function textMeasures(page, selectors) {
  return page.evaluate(selectors => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = color => color.slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const background = element => {
      const layers = []; for (let current = element; current; current = current.parentElement) layers.push(rgb(getComputedStyle(current).backgroundColor));
      return layers.reverse().reduce((result, layer) => result.map((channel, i) => channel * (1 - (layer[3] ?? 1)) + layer[i] * (layer[3] ?? 1)), [255, 255, 255]);
    };
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length && element.innerText.trim()).map(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect(), bg = background(element), rawFg = rgb(style.color);
      const fg = bg.map((value, i) => value * (1 - (rawFg[3] ?? 1)) + rawFg[i] * (rawFg[3] ?? 1));
      const ratio = (Math.max(luminance(fg), luminance(bg)) + .05) / (Math.min(luminance(fg), luminance(bg)) + .05);
      return { selector, text: element.innerText.slice(0, 60), fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight), contrast: Number(ratio.toFixed(3)), box: { width: box.width, height: box.height } };
    }));
  }, selectors);
}

try {
  await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 'temporary server');
  const today = (await get('/api/health')).today;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}) });
  const mobile = await newPage({ width: 390, height: 844 });
  const desktop = await newPage({ width: 1440, height: 1000 });
  const result = await write('/api/patients', { name: '사용성 검증 가상환자', age: 81, sex: 'female', conditions: ['합성자료'] });
  assert.equal(result.status, 201); const patient = (await result.json()).patient;
  await patientPage(mobile, patient.id);
  await desktop.goto(`${base}/clinician?patientId=${patient.id}&view=medications`); await desktop.locator('#app-content:not([hidden])').waitFor();
  const staff = desktop.context();
  await mkdir('test-results/usability-v07', { recursive: true });

  await check('patient navigation is readable, high contrast, touchable and within 320/390px', async () => {
    for (const width of [320, 390]) {
      await mobile.setViewportSize({ width, height: 844 });
      const values = await textMeasures(mobile, ['.bottom-nav .nav-item span', '.source-caption', '#view-home .small-label', '#view-home .metric-value.empty', '#view-home .empty-card p']);
      assert.ok(values.length >= 6); measurements.push({ width, values });
      for (const value of values) { assert.ok(value.fontSize >= 16, JSON.stringify(value)); assert.ok(value.contrast >= 4.5, JSON.stringify(value)); }
      const boxes = await mobile.locator('.bottom-nav .nav-item').evaluateAll(elements => elements.map(el => { const b = el.getBoundingClientRect(); return { width: b.width, height: b.height }; }));
      assert.equal(boxes.length, 6); assert.ok(boxes.every(box => box.width >= 48 && box.height >= 48));
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  });

  await check('ten notices preserve the first record action while all notices remain reachable', async () => {
    const before = await mobile.locator('#open-meal').boundingBox();
    for (let i = 0; i < 10; i++) {
      const response = await write('/api/clinician/notices', { title: `합성 공지 ${i + 1}`, body: '화면 검증용 안내입니다.', status: 'published', pinned: i === 0 }, staff);
      assert.equal(response.status(), 201);
    }
    await mobile.reload(); await mobile.locator('#app-content:not([hidden])').waitFor(); await mobile.locator('.notice-more').waitFor();
    const after = await mobile.locator('#open-meal').boundingBox();
    assert.ok(after.y - before.y < 130, `notice accumulation moved primary action ${after.y - before.y}px`);
    assert.ok(after.y < 844 - 120, `primary action top ${after.y}px should remain discoverable`);
    assert.equal(await mobile.locator('.notice-more').evaluate(element => element.open), false);
    assert.equal(await mobile.locator('.patient-notice:visible').count(), 1);
    await mobile.locator('.notice-more > summary').click(); assert.equal(await mobile.locator('.patient-notice:visible').count(), 10);
    await mobile.locator('.notice-more > summary').click();
    await mobile.screenshot({ path: 'test-results/usability-v07/patient-home.png', fullPage: true });
  });

  await check('meal has no implicit food or portion, unknown stays null and saved confirmation persists', async () => {
    await mobile.locator('#open-meal').click();
    assert.equal(await mobile.locator('#meal-form input[name=foodType]:checked').count(), 0);
    assert.equal(await mobile.locator('#meal-form input[name=portion]:checked').count(), 0);
    let prematureWrites = 0;
    const countPremature = request => { if (request.method() === 'POST' && request.url().endsWith('/meals')) prematureWrites++; };
    mobile.on('request', countPremature);
    await mobile.locator('#meal-submit').click(); await mobile.locator('#meal-error:not([hidden])').waitFor();
    assert.equal(await mobile.locator('#meal-dialog').isVisible(), true); assert.equal(prematureWrites, 0);
    mobile.off('request', countPremature);
    await mobile.locator('#meal-form').getByText('밥과 반찬', { exact: true }).click();
    await mobile.locator('#meal-form input[name=portion][value=unknown]').check();
    const saving = mobile.waitForResponse(response => response.url().includes(`/api/patients/${patient.id}/meals`) && response.request().method() === 'POST');
    await mobile.locator('#meal-submit').click(); const response = await saving; assert.equal(response.status(), 201);
    const meal = (await response.json()).meal; assert.equal(meal.portion, null); assert.equal(meal.calories, null);
    await mobile.locator('#meal-dialog').waitFor({ state: 'hidden' });
    await mobile.locator('#save-confirmation:not([hidden])').waitFor();
    await mobile.clock.install(); await mobile.clock.fastForward(5001);
    assert.equal(await mobile.locator('#save-confirmation').isVisible(), true);
    assert.match(await mobile.locator('#save-confirmation').innerText(), /저장/);
    await mobile.locator('#open-meal').click(); await mobile.locator('#meal-form').getByText('밥과 반찬', { exact: true }).click();
    await mobile.locator('#meal-form input[name=portion][value="0"]').check();
    await mobile.locator('#meal-submit').click(); await mobile.locator('#meal-dialog').waitFor({ state: 'hidden' });
    const summary = await get(`/api/patients/${patient.id}/summary`);
    assert.equal(summary.todayMeals.length, 2); assert.ok(summary.todayMeals.some(entry => entry.portion === 0 && entry.calories === 0));
  });

  await check('a quick help request can be composed and sent without free text typing', async () => {
    await mobile.locator('.bottom-nav [data-view=messages]').click();
    await mobile.locator('[data-quick-message]').first().click();
    const body = await mobile.locator('#patient-message-body').inputValue(); assert.ok(body.length > 0);
    await mobile.locator('#patient-message-send').click(); await until(async () => await mobile.locator('#patient-message-body').inputValue() === '');
    assert.ok((await mobile.locator('#patient-message-list').innerText()).includes(body));
    await mobile.locator('#patient-view-close').click();
  });

  await check('all medication modal exit paths preserve drafts until explicitly discarded', async () => {
    await desktop.locator('[data-action=add-medication-order]').first().click(); await desktop.locator('#medication-name').fill('보존할 합성 약명');
    desktop.once('dialog', dialog => dialog.dismiss()); await desktop.keyboard.press('Escape');
    assert.equal(await desktop.locator('#modal-backdrop').isVisible(), true); assert.equal(await desktop.locator('#medication-name').inputValue(), '보존할 합성 약명');
    desktop.once('dialog', dialog => dialog.dismiss()); await desktop.locator('#modal .icon-button[data-modal-action=close]').click();
    assert.equal(await desktop.locator('#medication-name').inputValue(), '보존할 합성 약명');
    desktop.once('dialog', dialog => dialog.accept()); await desktop.keyboard.press('Escape'); await desktop.locator('#modal-backdrop').waitFor({ state: 'hidden' });
    await desktop.locator('#main-nav [data-view=records]').click(); await desktop.locator('#main-nav [data-view=medications]').click();
    await desktop.locator('[data-action=add-medication-order]').first().click(); await desktop.locator('#medication-name').fill('뒤로 이동 보존');
    const dialog = desktop.waitForEvent('dialog'); await desktop.evaluate(() => history.back()); await (await dialog).dismiss();
    await desktop.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'medications');
    assert.equal(await desktop.locator('#medication-name').inputValue(), '뒤로 이동 보존');
    desktop.once('dialog', item => item.accept()); await desktop.keyboard.press('Escape');
  });

  await check('saving medication plan locks dismissal and does not create duplicate plans', async () => {
    await desktop.locator('[data-action=add-medication-order]').first().click();
    await desktop.locator('#medication-name').fill('전송 중 검증약'); await desktop.locator('#medication-dose').fill('1정');
    await desktop.locator('#medication-times input').fill('08:00'); await desktop.locator('#medication-order-confirmed').check();
    let release, started; const gate = new Promise(resolve => { release = resolve; }); const waiting = new Promise(resolve => { started = resolve; });
    await desktop.route(`**/api/patients/${patient.id}/medication-orders`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
    });
    await desktop.locator('#medication-order-form [type=submit]').click(); await waiting;
    await desktop.keyboard.press('Escape'); assert.equal(await desktop.locator('#modal-backdrop').isVisible(), true);
    release(); await desktop.locator('#modal-backdrop').waitFor({ state: 'hidden' });
    await desktop.unroute(`**/api/patients/${patient.id}/medication-orders`);
    assert.equal((await get(`/api/patients/${patient.id}/medication-orders`)).orders.length, 1);
  });

  await check('medication date errors restore the shown date and ordinary patient dose entry saves', async () => {
    await desktop.locator('#medication-date').fill(''); await desktop.locator('#medication-date').blur();
    assert.equal(await desktop.locator('#medication-date').inputValue(), today);
    assert.match(await desktop.locator('#operation-result-text').innerText(), /이전 조회 날짜/);
    await mobile.locator('.bottom-nav [data-view=medication]').click();
    await mobile.locator('#medication-slot-0').waitFor();
    await mobile.locator('#medication-date').fill(''); await mobile.locator('#medication-date').blur();
    assert.equal(await mobile.locator('#medication-date').inputValue(), today);
    await mobile.locator('#medication-error:not([hidden])').waitFor();
    await mobile.locator('#medication-date').fill('2999-01-01'); await mobile.locator('#medication-date').blur();
    assert.equal(await mobile.locator('#medication-date').inputValue(), today);
    await mobile.locator('#medication-slot-0 input[name=status][value=taken]').check();
    const save = mobile.waitForResponse(item => item.url().endsWith('/medication-events') && item.request().method() === 'POST');
    await mobile.locator('#medication-slot-0 button[type=submit]').click(); assert.equal((await save).status(), 200);
    const events = await get(`/api/patients/${patient.id}/medication-events?date=${today}`);
    assert.equal(events.events.length, 1); assert.equal(events.events[0].status, 'taken'); assert.equal(events.events[0].date, today);
    await mobile.locator('#patient-view-close').click();
  });

  await check('a lost daily save response keeps the draft and an identical retry creates one revision', async () => {
    await mobile.locator('#open-daily').click(); await mobile.waitForFunction(() => !document.querySelector('#daily-submit').disabled);
    await mobile.locator('#daily-steps').fill('1234');
    await mobile.locator('details.sleep-helper > summary').click();
    await mobile.locator('#sleep-helper-hours').fill('7'); await mobile.locator('#sleep-helper-minutes').fill('30'); await mobile.locator('#sleep-helper-apply').click();
    assert.equal(await mobile.locator('#daily-sleep').inputValue(), '7.5');
    const submissions = []; let loseOnce = true;
    await mobile.route(`**/api/patients/${patient.id}/daily`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postDataJSON());
      if (loseOnce) { loseOnce = false; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed'); }
      return route.continue();
    });
    await mobile.locator('#daily-submit').click(); await mobile.locator('#daily-error:not([hidden])').waitFor();
    assert.equal(await mobile.locator('#daily-steps').inputValue(), '1234');
    await mobile.locator('#daily-submit').click(); await mobile.locator('#daily-dialog').waitFor({ state: 'hidden' });
    assert.equal(submissions.length, 2); assert.ok(submissions[0].clientSubmissionId); assert.deepEqual(submissions[0], submissions[1]);
    const { record } = await get(`/api/patients/${patient.id}/daily?date=${today}`);
    assert.equal(record.revision, 1); assert.equal(record.steps, 1234); assert.equal(record.sleepHours, 7.5);
    await mobile.unroute(`**/api/patients/${patient.id}/daily`);
  });

  await check('clinician charts offer numeric tables and refresh preserves an opened reading position', async () => {
    await desktop.locator('#main-nav [data-view=overview]').click();
    const disclosure = desktop.locator('details.chart-data').first(); await disclosure.locator('summary').click();
    assert.ok(await disclosure.locator('table tbody tr').count());
    const key = await disclosure.getAttribute('data-preserve-key');
    await desktop.locator('#refresh-button').click(); await desktop.waitForFunction(() => !document.querySelector('#refresh-button').disabled);
    assert.equal(await desktop.locator(`details[data-preserve-key="${key}"]`).evaluate(element => element.open), true);
    const sizes = await textMeasures(desktop, ['#app-content p', '#app-content td', '#app-content th', '#app-content small']);
    assert.ok(sizes.length); assert.ok(sizes.every(value => value.fontSize >= 14), JSON.stringify(sizes.filter(value => value.fontSize < 14)));
    for (const value of sizes) assert.ok(value.contrast >= (value.fontSize >= 24 || (value.fontSize >= 18.66 && value.fontWeight >= 700) ? 3 : 4.5), JSON.stringify(value));
    measurements.push({ clinician: sizes });
  });

  await check('CSV preview matches selected patient and becomes invalid when scope changes', async () => {
    await desktop.locator('#main-nav [data-view=records]').click(); await desktop.locator('[data-action=export-preview]').click();
    assert.equal(await desktop.locator('#export-scope').inputValue(), 'selected'); assert.equal(await desktop.locator('#export-download').isVisible(), false);
    await desktop.locator('#export-preview-form [type=submit]').click(); await desktop.locator('#export-download').waitFor({ state: 'visible' });
    assert.match(await desktop.locator('#export-download').getAttribute('href'), new RegExp(`patientId=${patient.id}`));
    assert.match(await desktop.locator('#export-preview-result').innerText(), /1명/);
    await desktop.locator('#export-scope').selectOption('all'); assert.equal(await desktop.locator('#export-download').isVisible(), false);
    desktop.once('dialog', dialog => dialog.accept()); await desktop.locator('#modal [data-modal-action=close]').last().click();
  });

  await check('staff worklist saves the selected patient and preserves a dirty editor during refresh', async () => {
    await desktop.locator('#main-nav [data-view=worklist]').click();
    await desktop.locator('[data-workflow=new-task]').click();
    await desktop.locator('#workflow-editor [name=title]').fill('사용성 합성 연락 업무');
    await desktop.locator('#workflow-editor [name=note]').fill('환자 연결 확인 요청');
    await desktop.locator('#refresh-button').click(); await desktop.waitForFunction(() => !document.querySelector('#refresh-button').disabled);
    assert.equal(await desktop.locator('#workflow-editor [name=title]').inputValue(), '사용성 합성 연락 업무');
    await desktop.locator('#workflow-editor [type=submit]').click();
    await desktop.locator('[data-workflow=edit-task]').waitFor();
    let tasks = await (await staff.request.get(base + '/api/clinician/tasks?patientId=' + patient.id)).json();
    assert.equal(tasks.total, 1); assert.equal(tasks.tasks[0].patientId, patient.id);
    await desktop.locator('[data-workflow=edit-task]').click();
    await desktop.locator('#workflow-editor [name=status]').selectOption('in_progress');
    await desktop.locator('#workflow-editor [type=submit]').click(); await desktop.locator('[data-workflow=edit-task]').waitFor();
    tasks = await (await staff.request.get(base + '/api/clinician/tasks?patientId=' + patient.id)).json();
    assert.equal(tasks.tasks[0].status, 'in_progress'); assert.equal(tasks.tasks[0].history.length, 2);
    await desktop.screenshot({ path: 'test-results/usability-v07/clinician-worklist.png', fullPage: true });
  });

  await check('research UI exports frozen CSV with exactly the manifest hash', async () => {
    await desktop.locator('#main-nav [data-view=research]').click();
    await desktop.locator('#research-start').fill(today); await desktop.locator('#research-end').fill(today);
    await desktop.locator('#research-preview-button').click();
    await until(async () => (await desktop.locator('#research-query-status').innerText()).includes('조회 완료'));
    await desktop.locator('[data-research=snapshot]').click();
    await desktop.locator('[data-research=export]').waitFor();
    const downloads = []; const collect = download => downloads.push(download); desktop.on('download', collect);
    await desktop.locator('[data-research=export]').click(); await until(() => downloads.length === 2, 'CSV and manifest downloads');
    desktop.off('download', collect);
    const csvDownload = downloads.find(item => item.suggestedFilename().endsWith('.csv'));
    const manifestDownload = downloads.find(item => item.suggestedFilename().endsWith('-manifest.json'));
    assert.ok(csvDownload && manifestDownload);
    const csvBytes = await readFile(await csvDownload.path()); const manifest = JSON.parse(await readFile(await manifestDownload.path(), 'utf8'));
    assert.equal(createHash('sha256').update(csvBytes).digest('hex'), manifest.csvSha256);
    assert.equal(csvBytes.subarray(0, 3).toString('hex'), 'efbbbf'); assert.notEqual(csvBytes.subarray(3, 6).toString('hex'), 'efbbbf');
    assert.ok(!csvBytes.toString('utf8').includes(patient.name));
  });

  await check('new worklist, research and evidence screens share real Back/Forward history', async () => {
    for (const view of ['worklist', 'research', 'evidence']) {
      await desktop.locator(`#main-nav [data-view=${view}]`).click();
      assert.equal(new URL(desktop.url()).searchParams.get('view'), view);
      assert.equal(await desktop.locator(`#main-nav [data-view=${view}]`).getAttribute('aria-current'), 'page');
    }
    await desktop.goBack(); await desktop.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'research');
    await desktop.goForward(); await desktop.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'evidence');
    await desktop.locator('#evidence-query').waitFor();
  });

  await check('MOCK literature search requires privacy confirmation and preserves source identification', async () => {
    await desktop.locator('#evidence-query').fill('older adults usability');
    assert.equal(await desktop.locator('#evidence-privacy').isChecked(), false);
    await desktop.locator('#evidence-privacy').check();
    const response = desktop.waitForResponse(item => item.url().endsWith('/api/clinician/evidence/search') && item.request().method() === 'POST');
    await desktop.locator('#evidence-search-button').click(); const result = await response; assert.ok(result.ok(), await result.text());
    await until(async () => (await desktop.locator('#evidence-results').innerText()).includes('Synthetic older-adult study'));
    const text = await desktop.locator('#evidence-results').innerText();
    assert.match(text, /12345678/); assert.match(text, /10\.1234\/synthetic-study/); assert.match(text, /초록/);
    await desktop.locator('[data-evidence=bookmark]').first().click();
    await desktop.locator('[data-evidence=edit-bookmark]').first().waitFor();
    await desktop.locator('[data-evidence=edit-bookmark]').first().click();
    await desktop.locator('#evidence-review-status').selectOption('reviewed');
    await desktop.locator('#evidence-review-basis').selectOption('abstract');
    await desktop.locator('#evidence-review-note').fill('가상 문헌의 인터페이스 검증이며 임상 근거로 사용할 수 없음');
    await desktop.locator('#evidence-review-text').fill('Entirely fictional evidence for interface verification.');
    await desktop.locator('#evidence-review-locator').fill('가상 제공자 초록');
    const saving = desktop.waitForResponse(item => item.url().includes('/api/clinician/evidence/bookmarks/') && item.request().method() === 'PATCH');
    await desktop.locator('#evidence-review-save').click(); assert.equal((await saving).status(), 200);
    await until(async () => !(await desktop.locator('#evidence-review-save').isDisabled()));
    const library = await (await staff.request.get(base + '/api/clinician/evidence')).json();
    assert.equal(library.bookmarks.length, 1); assert.equal(library.bookmarks[0].status, 'reviewed');
    assert.equal(library.bookmarks[0].reviewBasis, 'abstract'); assert.match(library.bookmarks[0].locator, /초록/);
    await desktop.screenshot({ path: 'test-results/usability-v07/clinician-evidence.png', fullPage: true });
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/usability-v07/measurements.json', JSON.stringify({ scope: 'temporary synthetic local browser; mocked literature provider; no actual older users', scenarios: count, measurements }, null, 2));
  console.log(`${count} usability browser scenarios passed. Live provider, device and participant validation remain separate.`);
} catch (error) { console.error(output); console.error('Browser errors:', errors); throw error; }
finally {
  await browser?.close();
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  await rm(temp, { recursive: true, force: true });
}
