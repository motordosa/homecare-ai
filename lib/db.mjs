import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function todayKorea() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function dateOffset(date, offset) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const foodTable = {
  balanced: { label: '밥과 반찬', calories: 620, proteinGrams: 25 },
  porridge: { label: '죽', calories: 350, proteinGrams: 10 },
  protein: { label: '단백질 중심 식사', calories: 580, proteinGrams: 35 },
  noodles: { label: '면 요리', calories: 520, proteinGrams: 15 },
};
export { foodTable };

export function openDatabase(dataDirectory) {
  const dataDir = resolve(dataDirectory);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'homecare.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, sex TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '[]', medications TEXT NOT NULL DEFAULT '[]',
      caregiver TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS daily_records (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL, steps INTEGER, sleep_hours REAL, medication_status TEXT,
      appetite TEXT, mood TEXT, note TEXT NOT NULL DEFAULT '', weight_kg REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(patient_id,date)
    );
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL, meal_type TEXT NOT NULL, food_type TEXT NOT NULL, portion REAL NOT NULL,
      calories REAL NOT NULL, protein_grams REAL NOT NULL, image_filename TEXT,
      source TEXT NOT NULL DEFAULT 'demo-food-table-v1', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS daily_patient_date ON daily_records(patient_id,date);
    CREATE INDEX IF NOT EXISTS meals_patient_date ON meals(patient_id,date);
  `);
  if (!db.prepare("SELECT value FROM metadata WHERE key='initialized'").get()) seedDatabase(db);
  // Add the generation to existing databases without changing their records or
  // reset timestamps. Reopening an unchanged database must keep this identity.
  db.prepare("INSERT INTO metadata (key,value) VALUES ('generation',?) ON CONFLICT(key) DO NOTHING").run(randomUUID());
  return { db, dataDir, uploadDir };
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function patientFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, age: row.age, sex: row.sex,
    conditions: JSON.parse(row.conditions), medications: JSON.parse(row.medications),
    caregiver: row.caregiver, createdAt: row.created_at, demo: Boolean(row.demo),
  };
}

export function recordFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, patientId: row.patient_id, date: row.date, steps: row.steps,
    sleepHours: row.sleep_hours, medicationStatus: row.medication_status,
    appetite: row.appetite, mood: row.mood, note: row.note, weightKg: row.weight_kg,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function mealFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, patientId: row.patient_id, date: row.date, mealType: row.meal_type,
    foodType: row.food_type, foodLabel: row.food_label || foodTable[row.food_type]?.label || row.food_type,
    portion: row.portion, calories: row.calories, proteinGrams: row.protein_grams,
    imageUrl: row.image_filename ? `/uploads/${row.image_filename}` : null,
    source: row.source, createdAt: row.created_at,
    analysisId: row.analysis_id ?? null,
    estimation: row.estimation_json ? JSON.parse(row.estimation_json) : null,
  };
}

export function seedDatabase(db, mode = 'seed') {
  const today = todayKorea();
  const createdAt = new Date().toISOString();
  transaction(db, () => {
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notices'").get())db.exec('DELETE FROM notices;');
    db.exec('DELETE FROM meals; DELETE FROM daily_records; DELETE FROM patients;');
    if (mode === 'seed') {
      const patients = [
        ['p001', '김하늘', 78, 'female', ['고혈압', '골관절염'], ['혈압약 1일 1회'], '딸 · 주 3회 방문', 0],
        ['p002', '박새봄', 82, 'female', ['당뇨병', '노쇠'], ['당뇨약 1일 2회'], '배우자 · 동거', 1],
        ['p003', '이도담', 75, 'male', ['고혈압'], ['혈압약 1일 1회'], '아들 · 주 1회 방문', 2],
        ['p004', '최가온', 86, 'male', ['심부전', '관절염'], ['처방약 아침·저녁'], '방문간호 · 주 2회', 3],
        ['p005', '정나래', 73, 'female', ['골다공증'], ['골다공증약 주 1회'], '독거 · 이웃 돌봄', 4],
        ['p006', '윤다온', 80, 'male', ['당뇨병', '고혈압'], ['처방약 아침·저녁'], '딸 · 매일 연락', 5],
      ];
      const insertPatient = db.prepare('INSERT INTO patients (id,name,age,sex,conditions,medications,caregiver,created_at,demo) VALUES (?,?,?,?,?,?,?,?,1)');
      const insertRecord = db.prepare('INSERT INTO daily_records (id,patient_id,date,steps,sleep_hours,medication_status,appetite,mood,note,weight_kg,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      const insertMeal = db.prepare('INSERT INTO meals (id,patient_id,date,meal_type,food_type,portion,calories,protein_grams,image_filename,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const [id, name, age, sex, conditions, medications, caregiver, index] of patients) {
        insertPatient.run(id, name, age, sex, JSON.stringify(conditions), JSON.stringify(medications), caregiver, createdAt);
        for (let offset = -27; offset <= 0; offset++) {
          const day = offset + 27;
          const date = dateOffset(today, offset);
          // Purposefully include incomplete days to distinguish missing data from a zero value.
          if ((day + index * 3) % 11 === 0 || (offset === 0 && index > 2)) continue;
          const deteriorating = (index === 1 || index === 3) && offset >= -6;
          const steps = Math.max(180, Math.round((index === 2 ? 5500 : index === 4 ? 4200 : 2800) + Math.sin(day * 1.7 + index) * 950 - (deteriorating ? 1900 : 0)));
          const sleepHours = Math.round((6.6 + Math.sin(day * .8 + index) * .8 - (deteriorating ? 1.7 : 0)) * 10) / 10;
          const medicationStatus = deteriorating && day % 3 !== 0 ? 'missed' : (day + index) % 13 === 0 ? 'partial' : 'taken';
          const appetite = deteriorating ? 'poor' : day % 8 === 0 ? 'normal' : 'good';
          const mood = deteriorating && day % 2 === 0 ? 'poor' : 'normal';
          const note = deteriorating && day % 3 === 0 ? '입맛이 적고 집에서 쉬는 시간이 많았습니다. (합성 기록)' : offset === 0 ? '오늘도 기록을 남겼습니다. (합성 기록)' : '';
          const weight = day % 4 === 0 ? Math.round((sex === 'male' ? 65 : 53) * 10 + Math.sin(day + index) * 4 - (deteriorating ? 8 : 0)) / 10 : null;
          insertRecord.run(`daily-${id}-${date}`, id, date, steps, sleepHours, medicationStatus, appetite, mood, note, weight, createdAt, createdAt);
          for (let mealIndex = 0; mealIndex < 3; mealIndex++) {
            if ((day + mealIndex + index) % 9 === 0) continue;
            const mealType = ['breakfast', 'lunch', 'dinner'][mealIndex];
            const foodType = deteriorating ? 'porridge' : ['balanced', 'protein', 'noodles'][(day + mealIndex + index) % 3];
            const portion = deteriorating ? .5 : (day + mealIndex) % 5 === 0 ? .75 : 1;
            const food = foodTable[foodType];
            insertMeal.run(`meal-${id}-${date}-${mealIndex}`, id, date, mealType, foodType, portion, Math.round(food.calories * portion), Math.round(food.proteinGrams * portion * 10) / 10, null, 'demo-food-table-v1', createdAt);
          }
        }
      }
    }
    db.prepare("INSERT INTO metadata (key,value) VALUES ('initialized',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(createdAt);
    db.prepare("INSERT INTO metadata (key,value) VALUES ('mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(mode);
    db.prepare("INSERT INTO metadata (key,value) VALUES ('reset_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(createdAt);
    db.prepare("INSERT INTO metadata (key,value) VALUES ('generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(randomUUID());
  });
}
