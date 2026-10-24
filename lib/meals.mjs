import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { foodTable, mealFromRow, todayKorea, transaction } from './db.mjs';
import { ensureVisionSchema, resolveMealAnalysis, markAnalysisApplied } from './vision.mjs';
import { allowedKeys, choice, dateValue, decodeImage, HttpError, objectBody } from './validation.mjs';

const mealColumns = ['id','patient_id','date','meal_type','food_type','portion','calories','protein_grams','image_filename','source','created_at','analysis_id','food_label','estimation_json'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// SQLite cannot remove a NOT NULL constraint with ALTER COLUMN. Rebuild only
// this known table, atomically preserving every existing column and row.
export function ensureMealSchema(db) {
  ensureVisionSchema(db);
  const columns = db.prepare('PRAGMA table_info(meals)').all();
  if (columns.some(column => ['portion','calories','protein_grams'].includes(column.name) && column.notnull)) {
    if (columns.some(column => !mealColumns.includes(column.name))) throw new Error('Unsupported meals schema; migration stopped without changing records.');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const {name} of tables) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Unsupported table name during meal migration.');
      if (db.prepare(`PRAGMA foreign_key_list("${name}")`).all().some(key => key.table === 'meals')) {
        throw new Error('Unexpected meal dependency; migration stopped without changing records.');
      }
    }
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='meals' AND sql IS NOT NULL").all();
    if (indexes.some(index => index.name !== 'meals_patient_date')) throw new Error('Unsupported meal index; migration stopped without changing records.');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name='meals'").get()) throw new Error('Unsupported meal trigger; migration stopped without changing records.');
    transaction(db, () => {
      db.exec(`CREATE TABLE meals_v6 (
        id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT NOT NULL, meal_type TEXT NOT NULL, food_type TEXT NOT NULL,
        portion REAL, calories REAL, protein_grams REAL, image_filename TEXT,
        source TEXT NOT NULL DEFAULT 'demo-food-table-v1', created_at TEXT NOT NULL,
        analysis_id TEXT, food_label TEXT, estimation_json TEXT
      );`);
      const names = mealColumns.join(',');
      db.exec(`INSERT INTO meals_v6 (${names}) SELECT ${names} FROM meals;`);
      const difference = db.prepare(`SELECT ${names} FROM meals EXCEPT SELECT ${names} FROM meals_v6`).all();
      const originalCount = db.prepare('SELECT COUNT(*) AS n FROM meals').get().n;
      if (difference.length || originalCount !== db.prepare('SELECT COUNT(*) AS n FROM meals_v6').get().n) throw new Error('Meal migration preservation check failed.');
      db.exec('DROP TABLE meals; ALTER TABLE meals_v6 RENAME TO meals; CREATE INDEX meals_patient_date ON meals(patient_id,date);');
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Meal migration foreign key check failed.');
    });
  }
  db.exec(`CREATE TABLE IF NOT EXISTS meal_submissions (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    meal_id TEXT REFERENCES meals(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(patient_id,request_id)
  );`);
}

export function saveMeal(db, uploadDir, patientId, input) {
  if (!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
  const body = objectBody(input);
  allowedKeys(body, ['date','mealType','foodType','portion','imageData','analysisId','patientConfirmed','clientSubmissionId']);
  const date = dateValue(body.date ?? todayKorea());
  if (date > todayKorea()) throw new HttpError(400, '미래의 식사는 미리 기록할 수 없습니다. 날짜를 확인해 주세요.');
  const mealType = choice(body.mealType, '식사 종류', ['breakfast','lunch','dinner','snack']);
  if (!Object.hasOwn(body, 'portion')) throw new HttpError(400, '먹은 양 또는 모르겠어요를 선택해 주세요.');
  const portion = body.portion === null ? null : choice(body.portion, '섭취 비율', [0,.25,.5,.75,1]);
  const requestId = body.clientSubmissionId;
  if (requestId !== undefined && (typeof requestId !== 'string' || !uuidPattern.test(requestId))) throw new HttpError(400, '올바른 식사 저장 요청번호가 필요합니다.');
  const normalized = { date, mealType, portion, foodType: body.foodType ?? null, imageData: body.imageData ?? null,
    analysisId: body.analysisId ?? null, patientConfirmed: body.patientConfirmed ?? null };
  const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  if (requestId) {
    const previous = db.prepare('SELECT * FROM meal_submissions WHERE patient_id=? AND request_id=?').get(patientId, requestId);
    if (previous) {
      if (previous.request_hash !== requestHash) throw new HttpError(409, '같은 저장 요청번호의 내용이 바뀌었습니다. 새 기록으로 다시 확인해 주세요.');
      const meal = previous.meal_id && db.prepare('SELECT * FROM meals WHERE id=? AND patient_id=?').get(previous.meal_id, patientId);
      if (!meal) throw new HttpError(410, '이 저장 요청의 기록은 이미 삭제되었습니다. 새로 기록해 주세요.');
      return mealFromRow(meal);
    }
  }
  const analysis = body.analysisId === undefined ? null : resolveMealAnalysis(db, {
    analysisId: body.analysisId, patientId, imageData: body.imageData, patientConfirmed: body.patientConfirmed,
  });
  if (!analysis && 'patientConfirmed' in body) throw new HttpError(400, '분석 초안이 없는 확인 요청입니다.');
  const foodType = analysis?.foodType ?? choice(body.foodType, '음식 유형', Object.keys(foodTable));
  const food = analysis || foodTable[foodType];
  let filename = null;
  if (body.imageData) {
    const decoded = decodeImage(body.imageData);
    filename = `${randomUUID()}.${decoded.extension}`;
    writeFileSync(join(uploadDir, filename), decoded.buffer, { flag: 'wx', mode: 0o600 });
  }
  const mealId = randomUUID();
  const createdAt = new Date().toISOString();
  try {
    transaction(db, () => {
      db.prepare(`INSERT INTO meals (${mealColumns.join(',')}) VALUES (${mealColumns.map(() => '?').join(',')})`).run(
        mealId, patientId, date, mealType, foodType, portion,
        portion === null ? null : Math.round(food.calories * portion),
        portion === null ? null : Math.round(food.proteinGrams * portion * 10) / 10,
        filename, analysis?.source ?? 'demo-food-table-v1', createdAt,
        analysis?.analysisId ?? null, analysis?.foodLabel ?? null, analysis ? JSON.stringify(analysis.estimation) : null,
      );
      if (analysis) markAnalysisApplied(db, analysis.analysisId, mealId);
      if (requestId) db.prepare('INSERT INTO meal_submissions (patient_id,request_id,request_hash,meal_id,created_at) VALUES (?,?,?,?,?)')
        .run(patientId, requestId, requestHash, mealId, createdAt);
    });
  } catch (error) {
    if (filename) { try { unlinkSync(join(uploadDir, filename)); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('Meal upload cleanup failed:', cleanupError.code); } }
    throw error;
  }
  return mealFromRow(db.prepare('SELECT * FROM meals WHERE id=?').get(mealId));
}
