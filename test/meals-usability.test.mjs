import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, todayKorea } from '../lib/db.mjs';
import { ensureVisionSchema } from '../lib/vision.mjs';
import { ensureMealSchema, saveMeal } from '../lib/meals.mjs';

function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'homecare-meals-usability-'));
  const {db,uploadDir} = openDatabase(dir);
  try { fn(db,uploadDir); } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=';
const meal = (portion,extra={}) => ({ date:todayKorea(),mealType:'lunch',foodType:'balanced',portion,...extra });

test('v1/v5 meal migration preserves every row and provenance and is idempotent',()=>fixture(db=>{
  ensureVisionSchema(db);
  const id=db.prepare('SELECT id FROM meals LIMIT 1').get().id;
  db.prepare('UPDATE meals SET analysis_id=?,food_label=?,estimation_json=? WHERE id=?').run('old-analysis','기존 음식','{"source":"test"}',id);
  const before=db.prepare('SELECT * FROM meals ORDER BY id').all();
  ensureMealSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM meals ORDER BY id').all(),before);
  ensureMealSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM meals ORDER BY id').all(),before);
  assert.equal(db.prepare('PRAGMA table_info(meals)').all().find(c=>c.name==='portion').notnull,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}));

test('unknown intake stays SQL null while not eaten stays actual zero; omitted choice is rejected',()=>fixture((db,uploads)=>{
  ensureMealSchema(db);
  const unknown=saveMeal(db,uploads,'p001',meal(null));
  assert.equal(unknown.portion,null);assert.equal(unknown.calories,null);assert.equal(unknown.proteinGrams,null);
  assert.equal(db.prepare('SELECT calories FROM meals WHERE id=?').get(unknown.id).calories,null);
  const none=saveMeal(db,uploads,'p001',meal(0));
  assert.equal(none.calories,0);assert.equal(none.proteinGrams,0);
  assert.throws(()=>saveMeal(db,uploads,'p001',meal(1,{date:'2199-01-01'})),e=>e.status===400);
  const missing=meal(1);delete missing.portion;
  assert.throws(()=>saveMeal(db,uploads,'p001',missing),e=>e.status===400);
  for(const portion of ['',undefined,'unknown',2,-1])assert.throws(()=>saveMeal(db,uploads,'p001',meal(portion)),e=>e.status===400);
}));

test('lost-response meal retry creates one meal/image and rejects changed payload or deleted replay',()=>fixture((db,uploads)=>{
  ensureMealSchema(db);
  const clientSubmissionId=randomUUID();
  const body=meal(.5,{imageData:png,clientSubmissionId});
  const first=saveMeal(db,uploads,'p001',body);
  const second=saveMeal(db,uploads,'p001',{...body});
  assert.equal(first.id,second.id);assert.equal(readdirSync(uploads).length,1);
  assert.throws(()=>saveMeal(db,uploads,'p001',{...body,portion:1}),e=>e.status===409);
  const other=saveMeal(db,uploads,'p002',body);assert.notEqual(other.id,first.id);
  db.prepare('DELETE FROM meals WHERE id=?').run(first.id);
  assert.throws(()=>saveMeal(db,uploads,'p001',body),e=>e.status===410);
}));

test('unknown custom columns stop migration without dropping data',()=>fixture(db=>{
  db.exec('ALTER TABLE meals ADD COLUMN custom_note TEXT');
  db.prepare('UPDATE meals SET custom_note=?').run('preserve');
  assert.throws(()=>ensureMealSchema(db),/Unsupported meals schema/);
  assert.equal(db.prepare('SELECT custom_note FROM meals LIMIT 1').get().custom_note,'preserve');
  assert.equal(db.prepare('PRAGMA table_info(meals)').all().find(c=>c.name==='portion').notnull,1);
}));
