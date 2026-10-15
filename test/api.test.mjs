import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

let child;
let dataDir;
let base;
let today;
let savedMeal;
let createdPatient;
let output = '';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  output = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    await delay(100);
  }
  throw new Error(`Server did not become ready: ${output}`);
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
}

async function get(path) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  return response.json();
}

async function post(path, body, extra = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'homecare-api-test-'));
  await start();
});
after(async () => { await stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); });

test('SQLite seed contains six independent demo patients and coherent dashboard data', async () => {
  const health = await get('/api/health');
  assert.equal(health.storage, 'sqlite');
  assert.equal(health.counts.patients, 6);
  assert.ok(health.counts.dailyRecords > 100);
  today = health.today;
  const dashboard = await get('/api/dashboard');
  assert.equal(dashboard.patients.length, 6);
  assert.ok(dashboard.patients.some(patient => patient.risk.level === 'high'));
  assert.ok(dashboard.patients.some(patient => patient.risk.level === 'stable'));
  assert.equal(dashboard.trends.length, 14);
});

test('daily edits merge fields, preserve explicit zero and stay attached to the correct patient', async () => {
  const beforeOther = await get('/api/patients/p002/summary');
  let response = await post('/api/patients/p001/daily', { date: today, steps: 0, sleepHours: 8.5, medicationStatus: 'taken', note: '통합 테스트 기록' });
  assert.equal(response.status, 200);
  response = await post('/api/patients/p001/daily', { date: today, appetite: 'good' });
  assert.equal(response.status, 200);
  const summary = await get('/api/patients/p001/summary');
  assert.equal(summary.todayRecord.steps, 0);
  assert.equal(summary.todayRecord.sleepHours, 8.5);
  assert.equal(summary.todayRecord.medicationStatus, 'taken');
  assert.equal(summary.todayRecord.appetite, 'good');
  assert.equal(summary.todayRecord.note, '통합 테스트 기록');
  const afterOther = await get('/api/patients/p002/summary');
  assert.deepEqual(afterOther.todayRecord, beforeOther.todayRecord);
  assert.equal(summary.trends.find(day => day.date === today).steps, 0);
});

test('meal upload persists the actual image and reproducible demo estimates', async () => {
  const response = await post('/api/patients/p001/meals', { date: today, mealType: 'lunch', foodType: 'protein', portion: .5, imageData: png });
  assert.equal(response.status, 201);
  savedMeal = (await response.json()).meal;
  assert.equal(savedMeal.proteinGrams, 17.5);
  assert.equal(savedMeal.calories, 290);
  assert.equal(savedMeal.source, 'demo-food-table-v1');
  assert.ok(savedMeal.imageUrl.startsWith('/uploads/'));
  const image = await fetch(base + savedMeal.imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await image.arrayBuffer()).byteLength, Buffer.from(png.split(',')[1], 'base64').length);
  const summary = await get('/api/patients/p001/summary');
  assert.ok(summary.todayMeals.some(meal => meal.id === savedMeal.id));
});

test('invalid numbers, dates, image content and unknown fields are rejected', async () => {
  for (const body of [{ steps: -1 }, { sleepHours: 25 }, { date: '2026-02-30', steps: 1 }, { steps: '2000' }, { unknown: 1 }]) {
    const response = await post('/api/patients/p001/daily', body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const response = await post('/api/patients/p001/meals', { mealType: 'lunch', foodType: 'balanced', portion: 1, imageData: 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' });
  assert.equal(response.status, 400);
  assert.equal((await fetch(`${base}/api/patients/not-a-patient/summary`)).status, 404);
});

test('cross-site writes and private filesystem routes are not exposed', async () => {
  const response = await post('/api/demo/reset', { mode: 'empty', confirmation: 'RESET' }, { Origin: 'https://unrelated.example' });
  assert.equal(response.status, 403);
  for (const path of ['/server.mjs', '/.env', '/data/homecare.sqlite', '/uploads/not-an-upload.png']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await get('/api/health')).counts.patients, 6);
});

test('patient creation and CSV export preserve data while neutralizing spreadsheet formulas', async () => {
  const response = await post('/api/patients', { name: '=TEST-DEMO', age: 76, sex: 'female', conditions: ['테스트'] });
  assert.equal(response.status, 201);
  createdPatient = (await response.json()).patient;
  await post(`/api/patients/${createdPatient.id}/daily`, { note: '=1+1', medicationStatus: 'unknown' });
  const exported = await fetch(base + '/api/export.csv');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const csv = await exported.text();
  assert.ok(csv.includes("'=TEST-DEMO"));
  assert.ok(csv.includes("'=1+1"));
  assert.ok(csv.includes('"meal"'));
  assert.ok(csv.includes('demo-food-table-v1'));
});

test('server restart preserves patient records and uploaded images', async () => {
  await stop(); await start();
  const summary = await get('/api/patients/p001/summary');
  assert.equal(summary.todayRecord.note, '통합 테스트 기록');
  assert.ok(summary.recentMeals.some(meal => meal.id === savedMeal.id));
  assert.equal((await fetch(base + savedMeal.imageUrl)).status, 200);
  assert.equal((await get(`/api/patients/${createdPatient.id}`)).patient.name, '=TEST-DEMO');
});

test('empty reset requires confirmation, deletes uploads and remains empty after restart', async () => {
  assert.equal((await post('/api/demo/reset', { mode: 'empty' })).status, 400);
  const response = await post('/api/demo/reset', { mode: 'empty', confirmation: 'RESET' });
  assert.equal(response.status, 200);
  assert.deepEqual((await get('/api/health')).counts, { patients: 0, dailyRecords: 0, meals: 0 });
  assert.equal((await fetch(base + savedMeal.imageUrl)).status, 404);
  await stop(); await start();
  assert.equal((await get('/api/health')).counts.patients, 0);
  assert.equal((await get('/api/dashboard')).patients.length, 0);
});

test('sample reset repopulates coherent records without accumulating duplicate data', async () => {
  assert.equal((await post('/api/demo/reset', { mode: 'seed', confirmation: 'RESET' })).status, 200);
  const first = (await get('/api/health')).counts;
  assert.equal(first.patients, 6);
  await post('/api/demo/reset', { mode: 'seed', confirmation: 'RESET' });
  assert.deepEqual((await get('/api/health')).counts, first);
  const summary = await get('/api/patients/p001/summary');
  assert.equal(summary.trends.length, 28);
  assert.ok(summary.briefing.items.every(item => Array.isArray(item.evidence)));
});
