import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { dateOffset, mealFromRow, todayKorea, transaction } from './db.mjs';
import { effectiveRecords, getPatients } from './analysis.mjs';
import { allowedKeys, choice, csvCell, dateValue, HttpError, objectBody, textValue } from './validation.mjs';

const METHOD_VERSION = 'homecare-descriptive-v1';
const SOURCES = ['all', 'patient-self-report', 'health-connect', 'apple-health'];
const MAX_PATIENTS = 200;
const MAX_PATIENT_DAYS = 50000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const round = value => value === null ? null : Math.round(value * 1e6) / 1e6;
const total = values => values.reduce((sum, value) => sum + value, 0);
const percent = (n, d) => d ? Math.round(n / d * 1000) / 10 : null;
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const serialize = value => JSON.stringify(canonical(value));

export function ensureResearchSchema(db) {
  transaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS research_snapshots (
      id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL, created_by TEXT NOT NULL,
      request_hash TEXT NOT NULL, scope_json TEXT NOT NULL, recipe_json TEXT NOT NULL,
      data_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      generation TEXT NOT NULL, UNIQUE(created_by,client_request_id)
    );
    CREATE TRIGGER IF NOT EXISTS research_snapshot_immutable
      BEFORE UPDATE ON research_snapshots BEGIN SELECT RAISE(ABORT,'research snapshots are immutable'); END;`);
    db.prepare("INSERT INTO metadata(key,value) VALUES ('research_pseudonym_secret',?) ON CONFLICT(key) DO NOTHING").run(randomBytes(32).toString('hex'));
  });
}

// Hyndman/Fan type 7 quantiles; sample SD (n - 1), not population SD.
export function describeNumbers(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, mean: null, sd: null, median: null, q1: null, q3: null, iqr: null, min: null, max: null };
  const mean = total(sorted) / sorted.length;
  const quantile = p => {
    const h = (sorted.length - 1) * p;
    const low = Math.floor(h);
    return sorted[low] + (sorted[Math.ceil(h)] - sorted[low]) * (h - low);
  };
  const q1 = quantile(.25);
  const q3 = quantile(.75);
  return { count: sorted.length, mean: round(mean), sd: sorted.length < 2 ? null : round(Math.sqrt(total(sorted.map(value => (value - mean) ** 2)) / (sorted.length - 1))), median: round(quantile(.5)), q1: round(q1), q3: round(q3), iqr: round(q3 - q1), min: sorted[0], max: sorted.at(-1) };
}

function scopeAndRecipe(db, input, allowedPatientIds) {
  const body = objectBody(input);
  allowedKeys(body, ['startDate', 'endDate', 'patientIds', 'source']);
  const endDate = dateValue(body.endDate ?? todayKorea());
  const startDate = dateValue(body.startDate ?? dateOffset(endDate, -27));
  const calendarDays = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
  if (endDate > todayKorea() || calendarDays < 1 || calendarDays > 366) throw new HttpError(400, '연구 조회 기간은 미래를 제외한 1~366일이어야 합니다.');
  const source = choice(body.source ?? 'all', '자료 출처', SOURCES);
  const allIds = getPatients(db).map(patient => patient.id);
  const existing = new Set(allIds);
  const allowed = allowedPatientIds === null || allowedPatientIds === undefined ? null : new Set(allowedPatientIds);
  let ids;
  if (body.patientIds === undefined) ids = allIds.filter(id => !allowed || allowed.has(id));
  else {
    if (!Array.isArray(body.patientIds) || body.patientIds.length > MAX_PATIENTS) throw new HttpError(400, '대상 환자 목록을 확인해 주세요.');
    ids = [...new Set(body.patientIds.map(id => textValue(id, '환자 ID', { min: 1, max: 100 })))];
    if (ids.some(id => allowed && !allowed.has(id))) throw new HttpError(403, '허용된 환자 범위에서만 연구 자료를 조회할 수 있습니다.');
    if (ids.some(id => !existing.has(id))) throw new HttpError(404, '대상 환자를 찾을 수 없습니다.');
  }
  ids.sort();
  if (ids.length > MAX_PATIENTS || ids.length * calendarDays > MAX_PATIENT_DAYS) throw new HttpError(400, '한 번에 최대200명·50,000환자일 범위에서 조회해 주세요.');
  return { ids, recipe: { startDate, endDate, source, patientCount: ids.length, calendarDays,
    unit: 'patient-day', timezone: 'Asia/Seoul', methodVersion: METHOD_VERSION, quantileMethod: 'Hyndman-Fan type 7', standardDeviation: 'sample, n-1',
    coverageMeaning: '선택 기간의 달력일 × 선택 환자 수. 연구 참여·휴지·항목별 예정 수집률이 아닙니다.',
    sourceFilterMeaning: '활동·수면은 유효값의 선택 출처를 필터링합니다. 직접 입력은 기기값보다 우선합니다. 식사·복약·체중은 전체 또는 직접 입력 선택에서만 포함합니다.',
    nutritionMeaning: '기록된 산출 가능 식사의 일별 추정 합계입니다. 미기록 식사와 먹은 양 모름을0으로 채우지 않으며 하루 전체 섭취량이 아닙니다.',
    analysisMeaning: '기술통계입니다. 반복 관측을 독립 환자 표본으로 해석하거나 인과 효과·임상 성능을 판단하지 않습니다.',
  } };
}

function pseudonymContext(db) {
  const secret = db.prepare("SELECT value FROM metadata WHERE key='research_pseudonym_secret'").get()?.value;
  const generation = db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value;
  if (!secret || !generation) throw new HttpError(503, '연구 자료 준비 상태를 확인해 주세요.');
  return { generation, identify: id => `P-${createHmac('sha256', secret).update(`${generation}\0${id}`).digest('hex').slice(0, 20)}` };
}

function buildDataset(db, ids, recipe) {
  const { generation, identify } = pseudonymContext(db);
  const dates = Array.from({ length: recipe.calendarDays }, (_, i) => dateOffset(recipe.startDate, i));
  const includeManual = ['all', 'patient-self-report'].includes(recipe.source);
  const sourceMatches = source => recipe.source === 'all' || source === recipe.source;
  const hasMedication = exists(db, 'medication_events') && exists(db, 'medication_orders');
  const today = todayKorea();
  const nowTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const rows = [];
  const participants = [];
  for (const patientId of ids) {
    const participantId = identify(patientId);
    const records = effectiveRecords(db, patientId, recipe.startDate, recipe.endDate);
    const byDate = new Map(records.map(record => [record.date, record]));
    const meals = includeManual ? db.prepare('SELECT * FROM meals WHERE patient_id=? AND date>=? AND date<=? ORDER BY date,created_at,id').all(patientId, recipe.startDate, recipe.endDate).map(mealFromRow) : [];
    const doses = hasMedication && includeManual ? db.prepare('SELECT * FROM medication_events WHERE patient_id=? AND date>=? AND date<=? ORDER BY date,time,id').all(patientId, recipe.startDate, recipe.endDate) : [];
    const orders = hasMedication && includeManual ? db.prepare('SELECT id,times,start_date,end_date FROM medication_orders WHERE patient_id=? AND start_date<=? AND (end_date IS NULL OR end_date>=?) ORDER BY id').all(patientId, recipe.endDate, recipe.startDate).map(order => ({ ...order, times: JSON.parse(order.times) })) : [];
    const patientRows = dates.map(date => {
      const record = byDate.get(date);
      const stepKnown = Number.isFinite(record?.steps) && sourceMatches(record.stepsSource);
      const sleepKnown = Number.isFinite(record?.sleepHours) && sourceMatches(record.sleepSource);
      const dayMeals = meals.filter(meal => meal.date === date);
      const knownMeals = dayMeals.filter(meal => Number.isFinite(meal.calories) && Number.isFinite(meal.proteinGrams));
      const dayDoses = doses.filter(dose => dose.date === date);
      const bySlot = new Map(dayDoses.map(dose => [`${dose.order_id}\0${dose.time}`, dose]));
      const dueSlots = orders.filter(order => order.start_date <= date && (!order.end_date || order.end_date >= date)).flatMap(order => order.times.filter(time => date < today || time <= nowTime).map(time => bySlot.get(`${order.id}\0${time}`)?.status ?? 'pending'));
      const nutritionSources = [...new Set(knownMeals.map(meal => meal.source))].sort();
      const row = { participantId, observedDate: date,
        steps: stepKnown ? record.steps : null, stepsSource: stepKnown ? record.stepsSource : null,
        sleepHours: sleepKnown ? record.sleepHours : null, sleepSource: sleepKnown ? record.sleepSource : null,
        weightKg: includeManual ? record?.weightKg ?? null : null,
        calories: knownMeals.length ? total(knownMeals.map(meal => meal.calories)) : null,
        proteinGrams: knownMeals.length ? round(total(knownMeals.map(meal => meal.proteinGrams))) : null,
        nutritionSource: nutritionSources.length === 1 ? nutritionSources[0] : nutritionSources.length > 1 ? 'mixed-estimates' : null,
        recordedMeals: dayMeals.length, knownMealCount: knownMeals.length, unknownMealCount: dayMeals.length - knownMeals.length,
        doseReported: dayDoses.length, doseTaken: dayDoses.filter(dose => dose.status === 'taken').length,
        doseMissed: dayDoses.filter(dose => dose.status === 'missed').length, doseUnknown: dayDoses.filter(dose => dose.status === 'unknown').length,
        dueSlots: dueSlots.length, dueTaken: dueSlots.filter(status => status === 'taken').length,
        dueMissed: dueSlots.filter(status => status === 'missed').length, dueUnknown: dueSlots.filter(status => status === 'unknown').length,
        duePending: dueSlots.filter(status => status === 'pending').length,
        legacyMedicationStatus: includeManual ? record?.medicationStatus ?? null : null,
        hasReport: recipe.source === 'all' ? Boolean(record || dayMeals.length || dayDoses.length) : stepKnown || sleepKnown || Boolean(includeManual && ((record && record.dataOrigin !== 'device') || dayMeals.length || dayDoses.length)),
      };
      return row;
    });
    rows.push(...patientRows);
    const reportingDays = patientRows.filter(row => row.hasReport).length;
    participants.push({ participantId, calendarDays: recipe.calendarDays, reportingDays, missingDays: recipe.calendarDays - reportingDays, coveragePercent: percent(reportingDays, recipe.calendarDays) });
  }
  const metrics = {};
  const definitions = { steps: ['걸음', 'stepsSource'], sleepHours: ['시간', 'sleepSource'], weightKg: ['kg', null], calories: ['kcal', 'nutritionSource'], proteinGrams: ['g', 'nutritionSource'] };
  for (const [key, [unit, sourceKey]] of Object.entries(definitions)) {
    const known = rows.filter(row => Number.isFinite(row[key]));
    const patientMeans = participants.map(participant => {
      const values = known.filter(row => row.participantId === participant.participantId).map(row => row[key]);
      return values.length ? total(values) / values.length : null;
    }).filter(Number.isFinite);
    const sourceCounts = known.reduce((counts, row) => { const source = sourceKey ? row[sourceKey] : 'patient-self-report'; counts[source] = (counts[source] || 0) + 1; return counts; }, {});
    metrics[key] = { unit, observationCount: known.length, patientCount: patientMeans.length, missingPatientDays: rows.length - known.length, sourceCounts,
      pooled: describeNumbers(known.map(row => row[key])), patientMeans: describeNumbers(patientMeans),
      pooledMeaning: '유효 관측일을 같은 가중치로 합친 기술통계', patientMeansMeaning: '자료가 있는 환자별 평균을 같은 가중치로 합친 기술통계' };
  }
  const sumField = key => total(rows.map(row => row[key]));
  const plannedDueSlots = sumField('dueSlots');
  const takenSlots = sumField('dueTaken');
  const missedSlots = sumField('dueMissed');
  const unknownSlots = sumField('dueUnknown');
  const reportedSlots = takenSlots + missedSlots + unknownSlots;
  const reportedPatientDays = rows.filter(row => row.hasReport).length;
  const result = { recipe,
    summary: { patientCount: ids.length, calendarDays: recipe.calendarDays, plannedPatientDays: rows.length, reportedPatientDays, reportingPatients: participants.filter(p => p.reportingDays > 0).length, missingPatientDays: rows.length - reportedPatientDays, coveragePercent: percent(reportedPatientDays, rows.length) },
    metrics, participants,
    medication: { plannedDueSlots, reportedSlots, takenSlots, missedSlots, unknownSlots, pendingSlots: sumField('duePending'), knownStatusSlots: takenSlots + missedSlots,
      totalReportSlots: sumField('doseReported'), notYetDueReportSlots: sumField('doseReported') - reportedSlots,
      reportPercent: percent(reportedSlots, plannedDueSlots), takenPerPlannedPercent: percent(takenSlots, plannedDueSlots), takenOfKnownPercent: percent(takenSlots, takenSlots + missedSlots),
      meaning: '분석 시점까지 도래한 예정 회차의 최종 자기보고. 사진·보고는 실제 복용 증명이 아니며 일일 partial=.5 점수와 합치지 않습니다.' },
    quality: { mealCount: sumField('recordedMeals'), knownMealCount: sumField('knownMealCount'), unknownMealCount: sumField('unknownMealCount'), excludedIdentifiers: ['patientId', 'patientName', 'note', 'photo', 'accountId'], missingDataPolicy: '결측 유지, 자동 대치 없음', participationPolicyApplied: false },
  };
  const inputHash = hash(serialize({ generation, recipe, rows }));
  return { generation, rows, result: { ...result, inputHash }, inputHash };
}

export function researchPreview(db, input = {}, allowedPatientIds = null) {
  const { ids, recipe } = scopeAndRecipe(db, input, allowedPatientIds);
  return buildDataset(db, ids, recipe).result;
}

function requireSnapshot(db, id, allowedPatientIds) {
  const key = textValue(id, '스냅샷 ID', { min: 1, max: 100 });
  const row = db.prepare('SELECT * FROM research_snapshots WHERE id=?').get(key);
  const generation = db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value;
  if (!row || row.generation !== generation) throw new HttpError(404, '연구 스냅샷을 찾을 수 없습니다.');
  const scope = JSON.parse(row.scope_json);
  const allowed = allowedPatientIds === null || allowedPatientIds === undefined ? null : new Set(allowedPatientIds);
  if (allowed && scope.some(patientId => !allowed.has(patientId))) throw new HttpError(403, '스냅샷의 모든 환자에 대한 현재 조회 권한이 필요합니다.');
  const data = JSON.parse(row.data_json);
  if (hash(serialize({ generation: row.generation, recipe: JSON.parse(row.recipe_json), rows: data.rows })) !== row.content_hash) throw new HttpError(409, '스냅샷 무결성 확인에 실패했습니다.');
  return { row, data };
}

function snapshotResult(row, data) {
  const recipe = JSON.parse(row.recipe_json);
  return { id: row.id, createdAt: row.created_at, contentHash: row.content_hash, recipe, result: data.result,
    manifest: { snapshotId: row.id, createdAt: row.created_at, inputHash: row.content_hash, recipeHash: hash(serialize(recipe)), methodVersion: METHOD_VERSION, softwareVersion: 'homecare-ai-0.7.0',
      patientCount: recipe.patientCount, calendarDays: recipe.calendarDays, rowCount: data.rows.length, rowUnit: 'patient-day', timeZone: recipe.timezone,
      source: recipe.source, startDate: recipe.startDate, endDate: recipe.endDate,
      pseudonymization: 'DB generation-scoped HMAC pseudonym; pseudonymous, not guaranteed anonymous',
      excludedFields: ['patientId', 'patientName', 'note', 'photo', 'accountId'],
      denominator: recipe.coverageMeaning, missingDataPolicy: 'null preserved; no imputation', quantileMethod: recipe.quantileMethod, standardDeviation: recipe.standardDeviation,
      limitation: '단일기관 합성자료 데모. 실제 연구의 프로토콜·참여/철회·반출 승인 검증을 대신하지 않습니다.' } };
}

export function createResearchSnapshot(db, input, actor, allowedPatientIds = null) {
  const body = objectBody(input);
  allowedKeys(body, ['clientRequestId', 'startDate', 'endDate', 'patientIds', 'source', 'expectedInputHash']);
  if (!uuid(body.clientRequestId)) throw new HttpError(400, '스냅샷 요청 식별자가 필요합니다.');
  if (body.expectedInputHash !== undefined && (typeof body.expectedInputHash !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedInputHash))) throw new HttpError(400, '검토한 자료 해시를 확인해 주세요.');
  const actorId = textValue(typeof actor === 'string' ? actor : actor?.accountId, '작성자', { min: 1, max: 150 });
  const { clientRequestId, expectedInputHash, ...options } = body;
  const requestHash = hash(serialize({ ...options, ...(expectedInputHash === undefined ? {} : { expectedInputHash }) }));
  return transaction(db, () => {
    const previous = db.prepare('SELECT id,request_hash FROM research_snapshots WHERE created_by=? AND client_request_id=?').get(actorId, clientRequestId);
    if (previous) {
      if (previous.request_hash !== requestHash) throw new HttpError(409, '같은 요청 식별자로 다른 분석 조건을 저장할 수 없습니다.');
      return { ...getResearchSnapshot(db, previous.id, allowedPatientIds), duplicate: true };
    }
    const { ids, recipe } = scopeAndRecipe(db, options, allowedPatientIds);
    if (!ids.length) throw new HttpError(400, '스냅샷에 포함할 환자를 선택해 주세요.');
    const dataset = buildDataset(db, ids, recipe);
    if (expectedInputHash !== undefined && expectedInputHash !== dataset.inputHash) throw new HttpError(409, '검토한 이후 자료 또는 예정 회차가 변경되었습니다. 기술통계를 다시 조회한 뒤 저장해 주세요.');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO research_snapshots(id,client_request_id,created_by,request_hash,scope_json,recipe_json,data_json,content_hash,created_at,generation)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, clientRequestId, actorId, requestHash, JSON.stringify(ids), serialize(recipe), serialize({ rows: dataset.rows, result: dataset.result }), dataset.inputHash, createdAt, dataset.generation);
    return { ...getResearchSnapshot(db, id, allowedPatientIds), duplicate: false };
  });
}

export function getResearchSnapshot(db, id, allowedPatientIds = null) {
  const { row, data } = requireSnapshot(db, id, allowedPatientIds);
  return snapshotResult(row, data);
}

export function exportResearchSnapshot(db, id, allowedPatientIds = null) {
  const { row, data } = requireSnapshot(db, id, allowedPatientIds);
  const snapshot = snapshotResult(row, data);
  const columns = ['participantId', 'observedDate', 'steps', 'stepsSource', 'sleepHours', 'sleepSource', 'weightKg', 'calories', 'proteinGrams', 'nutritionSource', 'recordedMeals', 'knownMealCount', 'unknownMealCount', 'doseReported', 'doseTaken', 'doseMissed', 'doseUnknown', 'dueSlots', 'dueTaken', 'dueMissed', 'dueUnknown', 'duePending', 'legacyMedicationStatus', 'hasReport'];
  const csv = '\ufeff' + [columns.map(csvCell).join(','), ...data.rows.map(record => columns.map(column => csvCell(record[column])).join(','))].join('\r\n') + '\r\n';
  const units = { observedDate: 'Asia/Seoul date', steps: 'steps/day', sleepHours: 'hours/day', weightKg: 'kg', calories: 'kcal from recorded known meals/day', proteinGrams: 'g from recorded known meals/day', dueSlots: 'scheduled dose slots due by snapshot time', legacyMedicationStatus: 'daily self-report, separate from dose slots' };
  return { manifest: { ...snapshot.manifest, columns, columnDefinitions: columns.map(name => ({ name, unit: units[name] ?? (name.endsWith('Source') ? 'provenance label' : name === 'participantId' ? 'pseudonym' : name === 'hasReport' ? 'boolean' : 'count/day'), missing: 'empty CSV cell means null, not zero' })), csvSha256: hash(csv) }, columns, csv };
}
