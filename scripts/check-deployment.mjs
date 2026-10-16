#!/usr/bin/env node
// Read-only deployment checks. This script never creates patients, saves records, or resets a DB.
import { chromium, request } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: npm run demo:check -- <http(s)://deployment-origin>\nExample (your running local server): npm run demo:check -- http://127.0.0.1:3000';
const input = process.argv[2];
if (input === '--help' || input === '-h') {
  console.log(usage);
  process.exit(0);
}
if (!input || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}
let target;
try {
  target = new URL(input);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error();
} catch {
  console.error('Provide one HTTP(S) origin URL without credentials, a path, query, or fragment.');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = join(root, 'public');
const artifactDirectory = join(root, 'test-results', 'deployment');
const requestedTimeout = Number(process.env.DEMO_CHECK_TIMEOUT_MS || 60000);
const timeout = Number.isFinite(requestedTimeout) && requestedTimeout >= 1000 && requestedTimeout <= 120000 ? requestedTimeout : 60000;
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
const cacheTag = String(Date.now());
const report = {
  status: 'running', readOnly: true, targetOrigin: target.origin, startedAt: new Date().toISOString(),
  health: null, patientCount: null, checks: [], fingerprints: [], screenshots: [], errors: [],
};
const sensitiveErrorNames = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'TimeoutError', 'URIError', 'EvalError']);
let browser;
let client;
let patients = null;
let dashboard = null;
let summary = null;
let patientId = null;

class CheckFailure extends Error {
  constructor(code) { super(code); this.name = 'CheckFailure'; this.code = code; }
}
const requireCheck = (condition, code) => { if (!condition) throw new CheckFailure(code); };
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
function safePath(inputUrl) {
  try {
    const url = new URL(inputUrl, target);
    if (url.origin !== target.origin) return '(cross-origin resource)';
    const pathname = url.pathname;
    if (/^\/api\/patients\/[^/]+\/(summary|daily|meals)$/.test(pathname)) return pathname.replace(/(\/api\/patients\/)[^/]+/, '$1:id');
    if (pathname.startsWith('/uploads/')) return '/uploads/:file';
    if (['/', '/patient', '/clinician', '/api/health', '/api/patients', '/api/dashboard', '/api/export.csv', '/favicon.ico'].includes(pathname)) return pathname;
    if (/^\/[a-zA-Z0-9_.\/-]+\.(css|js|html|svg|webmanifest)$/.test(pathname)) return pathname;
  } catch {}
  return '(other resource)';
}
function failureKind(error) {
  if (error instanceof CheckFailure) return error.code;
  const message = String(error?.message || '');
  if (/tunnel[\s\S]*403|statusCode\s*[=:]\s*403|CONNECT[\s\S]*403/i.test(message)) return 'proxy-connect-denied';
  if (/ERR_TUNNEL_CONNECTION_FAILED|tunnel connection|proxy connection/i.test(message)) return 'proxy-connect-failed';
  if (/ERR_CERT|certificate|CERT_HAS_EXPIRED|SELF_SIGNED_CERT/i.test(message)) return 'TLS-verification-failed';
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(message)) return 'DNS-resolution-failed';
  if (error?.name === 'TimeoutError' || /timed out|timeout.*exceeded/i.test(message)) return 'request-timeout';
  if (/executable.*doesn.t exist|browser.*not.*found/i.test(message)) return 'browser-not-installed';
  return sensitiveErrorNames.has(error?.name) ? error.name : 'operation-failed';
}
function addError(scope, kind, extra = {}) {
  const item = { scope, kind, ...extra };
  const key = JSON.stringify(item);
  if (!report.errors.some(error => JSON.stringify(error) === key)) report.errors.push(item);
}
async function check(name, action) {
  try {
    const detail = await action();
    report.checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    const kind = failureKind(error);
    report.checks.push({ name, status: 'failed', error: kind });
    addError(name, kind);
    console.error(`FAIL ${name}: ${kind}`);
    return false;
  }
}
function skip(name, reason) {
  report.checks.push({ name, status: 'skipped', reason });
  console.log(`SKIP ${name}: ${reason}`);
}
function proxyOptions() {
  // Never forward localhost through an external proxy; never print proxy values or credentials.
  if (loopback || !process.env.HTTPS_PROXY) return undefined;
  try {
    const parsed = new URL(process.env.HTTPS_PROXY.includes('://') ? process.env.HTTPS_PROXY : `http://${process.env.HTTPS_PROXY}`);
    requireCheck(['http:', 'https:', 'socks5:'].includes(parsed.protocol), 'unsupported-proxy-protocol');
    const options = { server: `${parsed.protocol}//${parsed.host}` };
    if (parsed.username) options.username = decodeURIComponent(parsed.username);
    if (parsed.password) options.password = decodeURIComponent(parsed.password);
    if (process.env.NO_PROXY) options.bypass = process.env.NO_PROXY;
    return options;
  } catch { throw new CheckFailure('invalid-HTTPS_PROXY-configuration'); }
}
async function getOnly(pathname, bustCache = false) {
  // This helper intentionally accepts no request options, body, or method override.
  const url = new URL(pathname, target);
  requireCheck(url.origin === target.origin, 'cross-origin-api-request-refused');
  if (bustCache) url.searchParams.set('demo-check', cacheTag);
  const response = await client.get(url.href, {
    timeout, maxRedirects: 0, headers: { 'Cache-Control': 'no-cache' },
  });
  if (response.status() !== 200) {
    addError('http', 'unexpected-status', { resource: safePath(url.href), status: response.status() });
    await response.dispose();
    throw new CheckFailure(`HTTP-${response.status()}`);
  }
  return response;
}
async function getJson(pathname) {
  const response = await getOnly(pathname);
  try {
    requireCheck((response.headers()['content-type'] || '').includes('application/json'), 'unexpected-json-content-type');
    return await response.json();
  } finally { await response.dispose(); }
}
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(path));
    else if (entry.isFile() && /\.(html|css|js)$/.test(entry.name)) output.push(path);
  }
  return output.sort();
}
async function fingerprintSources() {
  const aliases = { 'index.html': '/', 'patient.html': '/patient', 'clinician.html': '/clinician' };
  const files = await sourceFiles(publicDirectory);
  requireCheck(files.length > 0, 'local-public-sources-not-found');
  for (const file of files) {
    const local = relative(publicDirectory, file).replaceAll('\\', '/');
    const resource = aliases[local] || `/${local}`;
    const item = { file: `public/${local}`, resource, localSha256: sha256(await readFile(file)), remoteSha256: null, status: 'failed' };
    report.fingerprints.push(item);
    await check(`source ${resource}`, async () => {
      const response = await getOnly(resource, true);
      try {
        requireCheck(new URL(response.url()).origin === target.origin, 'cross-origin-source-refused');
        item.remoteSha256 = sha256(await response.body());
        item.status = item.localSha256 === item.remoteSha256 ? 'matched' : 'mismatched';
        if (item.status !== 'matched') {
          addError('source-fingerprint', 'deployed-source-mismatch', { resource });
          throw new CheckFailure('deployed-source-mismatch');
        }
      } finally { await response.dispose(); }
    });
  }
}
async function guardedContext(options, label) {
  const context = await browser.newContext({ ...options, ignoreHTTPSErrors: false, serviceWorkers: 'block', acceptDownloads: false });
  await context.route('**/*', async route => {
    const req = route.request();
    if (req.method() !== 'GET') {
      addError(label, 'blocked-non-GET-request', { method: req.method(), resource: safePath(req.url()) });
      await route.abort('blockedbyclient');
      return;
    }
    if (new URL(req.url()).origin !== target.origin) {
      addError(label, 'blocked-cross-origin-request', { resource: '(cross-origin resource)' });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  context.on('page', page => {
    page.on('pageerror', error => addError(label, 'runtime-pageerror', { errorName: sensitiveErrorNames.has(error.name) ? error.name : 'Error' }));
    page.on('response', response => {
      if (response.status() >= 400) addError(label, 'http-error', { resource: safePath(response.url()), status: response.status() });
    });
    page.on('requestfailed', req => {
      // No request URLs, query values, proxy strings, response bodies, or arbitrary error messages are saved.
      addError(label, 'request-failed', { resource: safePath(req.url()) });
    });
  });
  return context;
}
async function navigate(page, path) {
  const response = await page.goto(new URL(path, target).href, { waitUntil: 'domcontentloaded', timeout });
  requireCheck(response?.status() === 200, `navigation-HTTP-${response?.status() ?? 'missing'}`);
  requireCheck(new URL(page.url()).origin === target.origin, 'navigation-left-target-origin');
}
async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  requireCheck(!overflow, 'horizontal-page-overflow');
}
async function screenshot(page, filename) {
  await page.screenshot({ path: join(artifactDirectory, filename), fullPage: true, timeout });
  report.screenshots.push(filename);
}
async function browserChecks() {
  const desktop = await guardedContext({ viewport: { width: 1440, height: 1000 } }, 'desktop');
  const mobile = await guardedContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 'mobile');
  try {
    const landing = await desktop.newPage();
    await check('landing desktop 1440px', async () => {
      await navigate(landing, '/');
      await landing.locator('a.portal[href="/patient"]').waitFor({ state: 'visible', timeout });
      requireCheck(await landing.locator('a.portal[href="/clinician"]').isVisible(), 'clinician-portal-missing');
      await noOverflow(landing);
      await screenshot(landing, 'landing.png');
    });
    await landing.close();

    const patient = await mobile.newPage();
    const patientPath = patientId ? `/patient?patientId=${encodeURIComponent(patientId)}` : '/patient';
    const patientReady = await check('patient mobile 390px', async () => {
      await navigate(patient, patientPath);
      if (patients?.length) await patient.locator('#app-content').waitFor({ state: 'visible', timeout });
      else if (patients) {
        await patient.waitForFunction(() => !document.querySelector('#loading-state') || document.querySelector('#loading-state').hidden, undefined, { timeout });
        requireCheck(await patient.locator('#load-error').isVisible(), 'empty-patient-guidance-missing');
      } else await patient.locator('.patient-header').waitFor({ state: 'visible', timeout });
      await noOverflow(patient);
      await screenshot(patient, 'patient-mobile.png');
    });
    if (patientReady && patients?.length && summary) {
      await check('patient records chart', async () => {
        await patient.locator('.bottom-nav [data-view="records"]').click();
        await patient.locator('#view-records').waitFor({ state: 'visible', timeout });
        const records = summary.trends.slice(-7);
        const key = ['steps', 'sleepHours', 'proteinGrams'].find(field => records.some(row => finite(row[field]) && (field !== 'proteinGrams' || Number(row.calories) > 0 || Number(row.proteinGrams) > 0)));
        if (key) {
          await patient.locator(`.chart-tab[data-metric="${key}"]`).click();
          await patient.locator('#trend-chart .chart-column:not(.missing) .chart-bar').first().waitFor({ state: 'visible', timeout });
          requireCheck(await patient.locator('#trend-chart .chart-column').count() === records.length, 'patient-chart-columns-missing');
          requireCheck((await patient.locator('#trend-chart').getAttribute('aria-label'))?.length > 0, 'patient-chart-accessible-label-missing');
        } else requireCheck((await patient.locator('#chart-note').innerText()).length > 0, 'patient-no-chart-data-guidance-missing');
        await noOverflow(patient);
        await screenshot(patient, 'patient-records-mobile.png');
        return key ? 'existing recorded data chart displayed' : 'no recorded chart data; guidance displayed';
      });
    } else skip('patient records chart', patients?.length === 0 ? 'empty DB; no chart expected' : 'patient data unavailable');
    await patient.close();

    const clinician = await desktop.newPage();
    const clinicianPath = patientId ? `/clinician?patientId=${encodeURIComponent(patientId)}` : '/clinician';
    const clinicianReady = await check('clinician desktop 1440px', async () => {
      await navigate(clinician, clinicianPath);
      await clinician.locator('#app-content').waitFor({ state: 'visible', timeout });
      if (patients?.length) {
        requireCheck(await clinician.locator('.patient-row').count() > 0, 'patient-list-missing');
        await clinician.locator('#patient-detail').waitFor({ state: 'visible', timeout });
        requireCheck(await clinician.locator('.metric-panel').count() === 4, 'patient-metric-panels-missing');
      } else if (patients) await clinician.locator('.empty-state').waitFor({ state: 'visible', timeout });
      await noOverflow(clinician);
      await screenshot(clinician, 'clinician-desktop.png');
    });
    if (clinicianReady && patients?.length && summary) {
      await check('clinician trend charts', async () => {
        const recorded = summary.trends.slice(-14).some(row => finite(row.steps) || finite(row.sleepHours) || finite(row.calories) || ['taken', 'partial', 'missed'].includes(row.medicationStatus));
        if (recorded) requireCheck(await clinician.locator('.detail-chart-grid .chart-svg').count() > 0, 'recorded-data-trend-chart-missing');
        else requireCheck(await clinician.locator('.detail-chart-grid .compact-empty').count() === 4, 'empty-chart-guidance-missing');
        return recorded ? 'existing recorded data charts displayed' : 'no recorded chart data; empty guidance displayed';
      });
      await check('clinician record navigation', async () => {
        await clinician.locator('#main-nav [data-view="records"]').click();
        await clinician.locator('#record-patient').waitFor({ state: 'visible', timeout });
        requireCheck(await clinician.locator('.record-full').isVisible(), 'health-record-table-missing');
        await noOverflow(clinician);
      });
    } else skip('clinician trend charts', patients?.length === 0 ? 'empty DB; no chart expected' : 'clinician data unavailable');
    await clinician.close();
  } finally { await desktop.close(); await mobile.close(); }
}

await mkdir(artifactDirectory, { recursive: true });
for (const filename of ['report.json', 'landing.png', 'patient-mobile.png', 'patient-records-mobile.png', 'clinician-desktop.png']) {
  await rm(join(artifactDirectory, filename), { force: true });
}
console.log(`Read-only deployment checks: ${target.origin}`);
console.log('Only GET requests are allowed. Screenshots stay in ignored test-results/deployment/.');
try {
  const proxy = proxyOptions();
  client = await request.newContext({ ...(proxy ? { proxy } : {}), ignoreHTTPSErrors: false, timeout });
  const healthReady = await check('health API', async () => {
    const health = await getJson('/api/health');
    requireCheck(health.ok === true && health.status === 'ok', 'health-not-ready');
    requireCheck(health.storage === 'sqlite', 'health-storage-not-sqlite');
    requireCheck(health.dataMode === 'demo', 'health-not-demo-mode');
    requireCheck(health.counts && ['patients', 'dailyRecords', 'meals'].every(key => Number.isInteger(health.counts[key]) && health.counts[key] >= 0), 'invalid-health-counts');
    report.health = {
      ok: health.ok, status: health.status, counts: { patients: health.counts.patients, dailyRecords: health.counts.dailyRecords, meals: health.counts.meals },
      ...(health.dataMode === 'demo' ? { dataMode: 'demo' } : {}), ...(health.storage === 'sqlite' ? { storage: 'sqlite' } : {}),
    };
  });
  if (!healthReady) {
    skip('remaining deployment checks', 'health check failed; no further network requests made');
    throw new CheckFailure('health-check-failed');
  }
  await check('patients API', async () => {
    const value = await getJson('/api/patients');
    requireCheck(Array.isArray(value.patients) && value.patients.every(row => typeof row.id === 'string'), 'invalid-patients-response');
    patients = value.patients;
    report.patientCount = patients.length;
    patientId = patients[0]?.id || null;
  });
  await check('dashboard API', async () => {
    const value = await getJson('/api/dashboard');
    requireCheck(Array.isArray(value.patients) && value.stats && Number.isInteger(value.stats.patients) && Array.isArray(value.trends) && Array.isArray(value.alerts), 'invalid-dashboard-response');
    dashboard = value;
    // Prefer an existing patient with chart data. IDs and names are never written to the JSON report. Screenshots are for synthetic demo data only.
    const candidate = value.patients.find(row => ['steps', 'sleepHours', 'medication', 'nutrition'].some(key => finite(row.metrics?.[key]?.value)));
    if (candidate && (!patients || patients.some(row => row.id === candidate.id))) patientId = candidate.id;
  });
  if (patientId) await check('patient summary API', async () => {
    const value = await getJson(`/api/patients/${encodeURIComponent(patientId)}/summary`);
    requireCheck(value.patient?.id === patientId && Array.isArray(value.trends) && value.metrics && value.risk && value.briefing && Array.isArray(value.recentRecords) && Array.isArray(value.recentMeals), 'invalid-summary-response');
    summary = value;
  });
  else skip('patient summary API', patients?.length === 0 ? 'empty DB; no patient summary exists' : 'patient list unavailable');
  await check('CSV export GET', async () => {
    const response = await getOnly('/api/export.csv');
    try {
      requireCheck((response.headers()['content-type'] || '').includes('text/csv'), 'unexpected-csv-content-type');
      const header = (await response.text()).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
      requireCheck(header.includes('recordType') && header.includes('patientId') && header.includes('date'), 'invalid-csv-header');
      // CSV rows are deliberately not saved or printed.
    } finally { await response.dispose(); }
  });
  await fingerprintSources();
  for (const resource of ['/manifest.webmanifest', '/icon.svg']) await check(`static ${resource}`, async () => {
    const response = await getOnly(resource, true);
    await response.dispose();
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
    ...(proxy ? { proxy } : {}),
  });
  await browserChecks();
} catch (error) {
  const kind = failureKind(error);
  addError('runner', kind);
  console.error(`FAIL deployment checker: ${kind}. See the redacted report; no response bodies were saved.`);
} finally {
  if (browser) await browser.close().catch(() => addError('runner', 'browser-close-failed'));
  if (client) await client.dispose().catch(() => addError('runner', 'request-context-close-failed'));
  report.finishedAt = new Date().toISOString();
  report.status = report.errors.length || report.checks.some(item => item.status === 'failed') ? 'failed' : 'passed';
  await writeFile(join(artifactDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const passed = report.checks.filter(item => item.status === 'passed').length;
  const failed = report.checks.filter(item => item.status === 'failed').length;
  const skipped = report.checks.filter(item => item.status === 'skipped').length;
  console.log(`${report.status.toUpperCase()}: ${passed} passed, ${failed} failed, ${skipped} skipped. Artifacts: test-results/deployment/`);
  if (report.status !== 'passed') process.exitCode = 1;
}
