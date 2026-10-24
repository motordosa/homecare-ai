import { createHash, randomUUID } from 'node:crypto';
import { recordFromRow, todayKorea } from './db.mjs';
import { allowedKeys, choice, dateValue, HttpError, numberValue, objectBody, textValue } from './validation.mjs';
import { assertStaffCapability, assignedPatientIds } from './staff-access.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const timestamp = () => new Date().toISOString();
const actorSnapshot = actor => ({ accountId: actor?.accountId ?? null, role: actor?.role ?? 'demo-anonymous', staffRoles: actor?.staffRoles ?? [], provider: actor?.provider ?? 'demo' });
const taskTypes = ['contact', 'photo_review', 'data_quality', 'clinical_review'];
const taskStatuses = ['new', 'in_progress', 'waiting', 'review_requested', 'completed'];
const dailyColumns = { steps: 'steps', sleepHours: 'sleep_hours', weightKg: 'weight_kg', medicationStatus: 'medication_status', appetite: 'appetite', mood: 'mood', note: 'note' };

export function ensureWorkflowSchema(db) {
  db.exec('SAVEPOINT workflow_schema');
  try {
  if (!db.prepare('PRAGMA table_info(daily_records)').all().some(column => column.name === 'revision')) db.exec('ALTER TABLE daily_records ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_tasks (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('contact','photo_review','data_quality','clinical_review')),
    title TEXT NOT NULL, note TEXT NOT NULL, assignee TEXT NOT NULL DEFAULT '', due_date TEXT,
    status TEXT NOT NULL CHECK(status IN ('new','in_progress','waiting','review_requested','completed')),
    version INTEGER NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workflow_patient_status ON workflow_tasks(patient_id,status,updated_at);
  CREATE TABLE IF NOT EXISTS workflow_task_events (
    id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(task_id,version)
  );
  CREATE TABLE IF NOT EXISTS workflow_mutations (
    actor_id TEXT NOT NULL, client_request_id TEXT NOT NULL, operation TEXT NOT NULL,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id,client_request_id)
  );
  CREATE TABLE IF NOT EXISTS medication_photo_reviews (
    report_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reviewed','needs_information')),
    note TEXT NOT NULL, version INTEGER NOT NULL, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL,
    FOREIGN KEY(report_id,patient_id) REFERENCES medication_photo_reports(id,patient_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS medication_photo_review_events (
    id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES medication_photo_reports(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(report_id,version)
  );
  CREATE TABLE IF NOT EXISTS record_corrections (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date TEXT NOT NULL, source_revision INTEGER NOT NULL, source_snapshot_json TEXT NOT NULL,
    source_hash TEXT NOT NULL, patch_json TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')), version INTEGER NOT NULL,
    proposed_by TEXT NOT NULL, proposed_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS corrections_patient_status ON record_corrections(patient_id,status,proposed_at);
  CREATE TABLE IF NOT EXISTS daily_record_audit (
    id INTEGER PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, actor_json TEXT NOT NULL,
    reason TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_record_submissions (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(patient_id,request_id)
  );
  CREATE TABLE IF NOT EXISTS study_participation (
    patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE, study_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','paused','withdrawn','completed')),
    start_date TEXT NOT NULL, end_date TEXT, consent_version TEXT NOT NULL, required_domains TEXT NOT NULL,
    version INTEGER NOT NULL, reason TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS participation_events (
    id INTEGER PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(patient_id,version)
  );
  CREATE TABLE IF NOT EXISTS caregiver_delegations (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE, scopes_json TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL,
    version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    revoked_by TEXT, revoked_at TEXT, revoke_reason TEXT
  );`);
    db.exec('RELEASE workflow_schema');
  } catch (error) {
    db.exec('ROLLBACK TO workflow_schema; RELEASE workflow_schema');
    throw error;
  }
}

function atomic(db, operation) {
  db.exec('SAVEPOINT workflow_operation');
  try { const value = operation(); db.exec('RELEASE workflow_operation'); return value; }
  catch (error) { db.exec('ROLLBACK TO workflow_operation; RELEASE workflow_operation'); throw error; }
}

function patientExists(db, patientId) {
  if (!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
}

function requirePatient(db, actor, capability, patientId) {
  assertStaffCapability(actor, capability, patientId); patientExists(db, patientId);
}

function version(value, minimum = 0) {
  return numberValue(value, '수정번호', minimum, Number.MAX_SAFE_INTEGER - 1, true);
}

function paginate(input) {
  return { limit: numberValue(Number(input.limit ?? 50), '조회 건수', 1, 100, true), offset: numberValue(Number(input.offset ?? 0), '조회 시작', 0, 1000000, true) };
}

function scopedWhere(actor, patientId, clauses = [], params = [], column = 'patient_id') {
  const scope = assignedPatientIds(actor);
  if (patientId) { clauses.push(`${column}=?`); params.push(patientId); }
  if (scope !== null) {
    if (!scope.length) clauses.push('0=1');
    else { clauses.push(`${column} IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

function mutate(db, actor, patientId, operation, input, perform) {
  if (typeof input.clientRequestId !== 'string' || !uuid.test(input.clientRequestId)) throw new HttpError(400, '전송 ID를 확인해 주세요.');
  const requestHash = hash({ operation, patientId, input });
  return atomic(db, () => {
    const previous = db.prepare('SELECT * FROM workflow_mutations WHERE actor_id=? AND client_request_id=?').get(actor.accountId, input.clientRequestId);
    if (previous) {
      if (previous.operation !== operation || previous.patient_id !== patientId || previous.request_hash !== requestHash) throw new HttpError(409, '같은 전송 ID의 내용이 달라졌습니다. 다시 확인해 주세요.');
      return { ...JSON.parse(previous.result_json), replayed: true };
    }
    const result = perform();
    db.prepare('INSERT INTO workflow_mutations(actor_id,client_request_id,operation,patient_id,request_hash,result_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(actor.accountId, input.clientRequestId, operation, patientId, requestHash, JSON.stringify(result), timestamp());
    return { ...result, replayed: false };
  });
}

function taskFromRow(db, row, history = true) {
  return { id: row.id, patientId: row.patient_id, type: row.type, title: row.title, note: row.note,
    assignee: row.assignee, dueDate: row.due_date, status: row.status, version: row.version,
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(history ? { history: db.prepare('SELECT * FROM workflow_task_events WHERE task_id=? ORDER BY version').all(row.id).map(item => ({ version: item.version, actor: JSON.parse(item.actor_json), snapshot: JSON.parse(item.snapshot_json), createdAt: item.created_at })) } : {}) };
}

function taskEvent(db, actor, row) {
  db.prepare('INSERT INTO workflow_task_events(task_id,version,actor_json,snapshot_json,created_at) VALUES (?,?,?,?,?)')
    .run(row.id, row.version, JSON.stringify(actorSnapshot(actor)), JSON.stringify(taskFromRow(db, row, false)), timestamp());
}

export function listTasks(db, actor, options = {}) {
  assertStaffCapability(actor, 'patient.read', options.patientId);
  if (options.patientId) patientExists(db, options.patientId);
  const { limit, offset } = paginate(options);
  const clauses = [], params = [];
  if (options.status) { clauses.push('status=?'); params.push(choice(options.status, '업무 상태', taskStatuses)); }
  const scope = scopedWhere(actor, options.patientId, clauses, params);
  const total = db.prepare(`SELECT COUNT(*) count FROM workflow_tasks${scope.where}`).get(...scope.params).count;
  const rows = db.prepare(`SELECT * FROM workflow_tasks${scope.where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...scope.params, limit, offset);
  return { tasks: rows.map(row => taskFromRow(db, row)), total, limit, offset };
}

export function createTask(db, actor, input) {
  const body = objectBody(input); allowedKeys(body, ['patientId', 'type', 'title', 'note', 'assignee', 'dueDate', 'clientRequestId']);
  const patientId = textValue(body.patientId, '환자 ID', { min: 1, max: 100 }); requirePatient(db, actor, 'workflow.write', patientId);
  const type = choice(body.type, '업무 종류', taskTypes), title = textValue(body.title, '업무 제목', { min: 1, max: 160 });
  const note = textValue(body.note ?? '', '업무 설명', { max: 2000 }), assignee = textValue(body.assignee ?? '', '담당자', { max: 100 });
  const dueDate = body.dueDate ? dateValue(body.dueDate) : null;
  return mutate(db, actor, patientId, 'createTask', body, () => {
    const id = randomUUID(), now = timestamp();
    db.prepare(`INSERT INTO workflow_tasks(id,patient_id,type,title,note,assignee,due_date,status,version,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'new',1,?,?,?,?)`)
      .run(id, patientId, type, title, note, assignee, dueDate, actor.accountId, actor.accountId, now, now);
    const row = db.prepare('SELECT * FROM workflow_tasks WHERE id=?').get(id); taskEvent(db, actor, row);
    return { task: taskFromRow(db, row) };
  });
}

export function updateTask(db, actor, taskId, input) {
  const body = objectBody(input); allowedKeys(body, ['version', 'status', 'note', 'assignee', 'dueDate', 'clientRequestId']);
  const existing = db.prepare('SELECT * FROM workflow_tasks WHERE id=?').get(taskId);
  if (!existing) throw new HttpError(404, '업무를 찾을 수 없습니다.');
  requirePatient(db, actor, 'workflow.write', existing.patient_id);
  const expected = version(body.version, 1), status = choice(body.status, '업무 상태', taskStatuses);
  if (status === 'completed' && ['clinical_review', 'photo_review'].includes(existing.type)) assertStaffCapability(actor, 'workflow.review', existing.patient_id);
  const note = body.note === undefined ? existing.note : textValue(body.note, '업무 설명', { max: 2000 });
  const assignee = body.assignee === undefined ? existing.assignee : textValue(body.assignee, '담당자', { max: 100 });
  const dueDate = body.dueDate === undefined ? existing.due_date : body.dueDate ? dateValue(body.dueDate) : null;
  return mutate(db, actor, existing.patient_id, `updateTask:${taskId}`, body, () => {
    const changed = db.prepare('UPDATE workflow_tasks SET status=?,note=?,assignee=?,due_date=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?')
      .run(status, note, assignee, dueDate, actor.accountId, timestamp(), taskId, expected);
    if (changed.changes !== 1) throw new HttpError(409, '다른 담당자가 업무를 변경했습니다. 목록을 다시 확인해 주세요.');
    const row = db.prepare('SELECT * FROM workflow_tasks WHERE id=?').get(taskId); taskEvent(db, actor, row);
    return { task: taskFromRow(db, row) };
  });
}

export function photoReview(db, reportId) {
  const row = db.prepare('SELECT * FROM medication_photo_reviews WHERE report_id=?').get(reportId);
  return row ? { reportId: row.report_id, patientId: row.patient_id, status: row.status, note: row.note, version: row.version, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at }
    : { reportId, status: 'unreviewed', note: '', version: 0, reviewedBy: null, reviewedAt: null };
}

export function listPhotoReviews(db, actor, patientId, options = {}) {
  requirePatient(db, actor, 'patient.read', patientId);
  const { limit, offset } = paginate(options), clauses = ['patient_id=?'], params = [patientId];
  if (options.date) { clauses.push('date=?'); params.push(dateValue(options.date)); }
  const where = clauses.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) count FROM medication_photo_reports WHERE ${where}`).get(...params).count;
  const rows = db.prepare(`SELECT id,patient_id,date,created_at,analysis_json FROM medication_photo_reports WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { reports: rows.map(row => ({ id: row.id, patientId: row.patient_id, date: row.date, createdAt: row.created_at,
    source: 'patient-self-report-with-photo', analysis: JSON.parse(row.analysis_json),
    imageUrl: `/api/patients/${encodeURIComponent(patientId)}/medication-photo-reports/${encodeURIComponent(row.id)}/image`,
    events: db.prepare('SELECT event_json FROM medication_photo_report_events WHERE report_id=? ORDER BY event_id').all(row.id).map(item => JSON.parse(item.event_json)),
    review: photoReview(db, row.id), reviewStatus: photoReview(db, row.id).status,
  })), total, limit, offset };
}

export function reviewPhoto(db, actor, patientId, reportId, input) {
  const body = objectBody(input); allowedKeys(body, ['reportId', 'version', 'status', 'note', 'clientRequestId']);
  requirePatient(db, actor, 'workflow.write', patientId);
  if (body.reportId !== undefined && body.reportId !== reportId) throw new HttpError(400, '검토할 사진 ID가 일치하지 않습니다.');
  const status = choice(body.status, '사진 검토 상태', ['reviewed', 'needs_information']);
  if (status === 'reviewed') assertStaffCapability(actor, 'workflow.review', patientId);
  const expected = version(body.version), note = textValue(body.note, '검토 사유', { min: 1, max: 2000 });
  if (!db.prepare('SELECT id FROM medication_photo_reports WHERE id=? AND patient_id=?').get(reportId, patientId)) throw new HttpError(404, '이 환자의 사진 보고를 찾을 수 없습니다.');
  return mutate(db, actor, patientId, `reviewPhoto:${reportId}`, body, () => {
    if (photoReview(db, reportId).version !== expected) throw new HttpError(409, '사진 검토가 변경되었습니다. 다시 확인해 주세요.');
    const now = timestamp();
    db.prepare(`INSERT INTO medication_photo_reviews(report_id,patient_id,status,note,version,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET status=excluded.status,note=excluded.note,version=excluded.version,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
      .run(reportId, patientId, status, note, expected + 1, actor.accountId, now);
    const review = photoReview(db, reportId);
    db.prepare('INSERT INTO medication_photo_review_events(report_id,version,actor_json,snapshot_json,created_at) VALUES (?,?,?,?,?)')
      .run(reportId, review.version, JSON.stringify(actorSnapshot(actor)), JSON.stringify(review), now);
    return { review };
  });
}

export function appendDailyAudit(db, { patientId, date, before, after, actor = null, reason = '환자 입력', source = 'patient-self-report' }) {
  patientExists(db, patientId);
  const result = db.prepare('INSERT INTO daily_record_audit(patient_id,date,before_json,after_json,actor_json,reason,source,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(patientId, dateValue(date), before ? JSON.stringify(before) : null, JSON.stringify(after), JSON.stringify(actorSnapshot(actor)), textValue(reason, '변경 사유', { min: 1, max: 2000 }), textValue(source, '입력 출처', { min: 1, max: 100 }), timestamp());
  return Number(result.lastInsertRowid);
}

function validatePatch(input) {
  const patch = objectBody(input); allowedKeys(patch, Object.keys(dailyColumns));
  if (!Object.keys(patch).length) throw new HttpError(400, '정정할 항목을 선택해 주세요.');
  const result = {};
  for (const key of Object.keys(dailyColumns)) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (key !== 'note' && value === null) { result[key] = null; continue; }
    if (key === 'steps') result[key] = numberValue(value, '걸음 수', 0, 100000, true);
    else if (key === 'sleepHours') result[key] = numberValue(value, '수면 시간', 0, 24);
    else if (key === 'weightKg') result[key] = numberValue(value, '체중', 10, 350);
    else if (key === 'medicationStatus') result[key] = choice(value, '일일 복약', ['taken', 'partial', 'missed', 'unknown']);
    else if (['appetite', 'mood'].includes(key)) result[key] = choice(value, '상태', ['good', 'normal', 'poor']);
    else result[key] = textValue(value, '메모', { max: 2000 });
  }
  return result;
}

function correctionFromRow(row) {
  return { id: row.id, patientId: row.patient_id, date: row.date, sourceRevision: row.source_revision,
    sourceSnapshot: JSON.parse(row.source_snapshot_json), patch: JSON.parse(row.patch_json), reason: row.reason,
    status: row.status, version: row.version, proposedBy: row.proposed_by, proposedAt: row.proposed_at,
    reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, reviewReason: row.review_reason };
}

export function listCorrections(db, actor, patientId, options = {}) {
  requirePatient(db, actor, 'patient.read', patientId);
  const { limit, offset } = paginate(options), params = [patientId];
  const statusClause = options.status ? ' AND status=?' : '';
  if (options.status) params.push(choice(options.status, '정정 상태', ['proposed', 'approved', 'rejected']));
  const total = db.prepare(`SELECT COUNT(*) count FROM record_corrections WHERE patient_id=?${statusClause}`).get(...params).count;
  return { corrections: db.prepare(`SELECT * FROM record_corrections WHERE patient_id=?${statusClause} ORDER BY proposed_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset).map(correctionFromRow), total, limit, offset };
}

export function proposeCorrection(db, actor, patientId, input) {
  const body = objectBody(input); allowedKeys(body, ['date', 'expectedRevision', 'patch', 'reason', 'clientRequestId']);
  requirePatient(db, actor, 'correction.propose', patientId);
  const date = dateValue(body.date), expected = version(body.expectedRevision, 1), patch = validatePatch(body.patch);
  const reason = textValue(body.reason, '정정 사유', { min: 1, max: 2000 });
  return mutate(db, actor, patientId, 'proposeCorrection', body, () => {
    const record = recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(patientId, date));
    if (!record) throw new HttpError(404, '정정할 직접 입력 기록을 찾을 수 없습니다. 기기 원본은 이 경로에서 변경하지 않습니다.');
    if (record.revision !== expected) throw new HttpError(409, '원기록이 변경되었습니다. 다시 확인해 주세요.');
    const id = randomUUID();
    db.prepare(`INSERT INTO record_corrections(id,patient_id,date,source_revision,source_snapshot_json,source_hash,patch_json,reason,status,version,proposed_by,proposed_at) VALUES (?,?,?,?,?,?,?,?,'proposed',1,?,?)`)
      .run(id, patientId, date, record.revision, JSON.stringify(record), hash(record), JSON.stringify(patch), reason, actor.accountId, timestamp());
    return { correction: correctionFromRow(db.prepare('SELECT * FROM record_corrections WHERE id=?').get(id)) };
  });
}

export function reviewCorrection(db, actor, correctionId, input) {
  const body = objectBody(input); allowedKeys(body, ['version', 'status', 'reason', 'clientRequestId']);
  const existing = db.prepare('SELECT * FROM record_corrections WHERE id=?').get(correctionId);
  if (!existing) throw new HttpError(404, '정정 요청을 찾을 수 없습니다.');
  requirePatient(db, actor, 'correction.approve', existing.patient_id);
  const expected = version(body.version, 1), status = choice(body.status, '검토 결과', ['approved', 'rejected']);
  const reason = textValue(body.reason, '검토 사유', { min: 1, max: 2000 });
  return mutate(db, actor, existing.patient_id, `reviewCorrection:${correctionId}`, body, () => {
    const current = db.prepare('SELECT * FROM record_corrections WHERE id=?').get(correctionId);
    if (current.version !== expected || current.status !== 'proposed') throw new HttpError(409, '이미 처리했거나 변경된 정정 요청입니다.');
    if (status === 'approved') {
      const before = recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(current.patient_id, current.date));
      if (!before || before.revision !== current.source_revision || hash(before) !== current.source_hash) throw new HttpError(409, '정정 제안 이후 원기록이 바뀌었습니다. 원자료를 다시 대조해 새 요청을 작성해 주세요.');
      const patch = JSON.parse(current.patch_json), fields = Object.keys(patch);
      db.prepare(`UPDATE daily_records SET ${fields.map(key => `${dailyColumns[key]}=?`).join(',')},revision=revision+1,updated_at=? WHERE patient_id=? AND date=? AND revision=?`)
        .run(...fields.map(key => patch[key]), timestamp(), current.patient_id, current.date, current.source_revision);
      const after = recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(current.patient_id, current.date));
      appendDailyAudit(db, { patientId: current.patient_id, date: current.date, before, after, actor, reason, source: `approved-correction:${correctionId}` });
    }
    db.prepare('UPDATE record_corrections SET status=?,version=version+1,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?')
      .run(status, actor.accountId, timestamp(), reason, correctionId);
    return { correction: correctionFromRow(db.prepare('SELECT * FROM record_corrections WHERE id=?').get(correctionId)) };
  });
}

function participationFromRow(row) {
  return row ? { patientId: row.patient_id, studyId: row.study_id, status: row.status, startDate: row.start_date, endDate: row.end_date,
    consentVersion: row.consent_version, requiredDomains: JSON.parse(row.required_domains), version: row.version,
    reason: row.reason, updatedBy: row.updated_by, updatedAt: row.updated_at, institutionApproved: false } : null;
}

export function getParticipation(db, actor, patientId) {
  requirePatient(db, actor, 'patient.read', patientId);
  return { participation: participationFromRow(db.prepare('SELECT * FROM study_participation WHERE patient_id=?').get(patientId)),
    history: db.prepare('SELECT * FROM participation_events WHERE patient_id=? ORDER BY version').all(patientId).map(row => ({ version: row.version, actor: JSON.parse(row.actor_json), snapshot: JSON.parse(row.snapshot_json), createdAt: row.created_at })) };
}

export function saveParticipation(db, actor, patientId, input) {
  const body = objectBody(input); allowedKeys(body, ['version', 'studyId', 'status', 'startDate', 'endDate', 'consentVersion', 'requiredDomains', 'reason', 'clientRequestId']);
  requirePatient(db, actor, 'participation.write', patientId);
  const expected = version(body.version), studyId = textValue(body.studyId, '연구 ID', { min: 1, max: 100 });
  const status = choice(body.status, '참여 상태', ['active', 'paused', 'withdrawn', 'completed']);
  const startDate = dateValue(body.startDate), endDate = body.endDate ? dateValue(body.endDate) : null;
  if (endDate && endDate < startDate) throw new HttpError(400, '종료일은 시작일보다 빠를 수 없습니다.');
  if (['withdrawn', 'completed'].includes(status) && !endDate) throw new HttpError(400, '철회·종료 상태에는 적용 종료일을 입력해 주세요.');
  const consentVersion = textValue(body.consentVersion, '동의 문서 버전', { min: 1, max: 100 });
  const reason = textValue(body.reason, '변경 사유', { min: 1, max: 2000 });
  if (!Array.isArray(body.requiredDomains) || !body.requiredDomains.length || body.requiredDomains.length > 5) throw new HttpError(400, '필요한 기록 항목을 선택해 주세요.');
  const domains = [...new Set(body.requiredDomains.map(value => choice(value, '필수 기록', ['meal', 'medication', 'steps', 'sleep', 'weight'])))].sort();
  return mutate(db, actor, patientId, 'saveParticipation', body, () => {
    const old = db.prepare('SELECT * FROM study_participation WHERE patient_id=?').get(patientId);
    if ((old?.version ?? 0) !== expected) throw new HttpError(409, '참여 계획이 변경되었습니다. 다시 확인해 주세요.');
    const now = timestamp();
    db.prepare(`INSERT INTO study_participation(patient_id,study_id,status,start_date,end_date,consent_version,required_domains,version,reason,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(patient_id) DO UPDATE SET study_id=excluded.study_id,status=excluded.status,start_date=excluded.start_date,end_date=excluded.end_date,consent_version=excluded.consent_version,required_domains=excluded.required_domains,version=excluded.version,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(patientId, studyId, status, startDate, endDate, consentVersion, JSON.stringify(domains), expected + 1, reason, actor.accountId, now);
    const participation = participationFromRow(db.prepare('SELECT * FROM study_participation WHERE patient_id=?').get(patientId));
    db.prepare('INSERT INTO participation_events(patient_id,version,actor_json,snapshot_json,created_at) VALUES (?,?,?,?,?)')
      .run(patientId, participation.version, JSON.stringify(actorSnapshot(actor)), JSON.stringify(participation), now);
    return { participation };
  });
}

function delegationFromRow(row) {
  return { id: row.id, patientId: row.patient_id, accountId: row.account_id, scopes: JSON.parse(row.scopes_json), startDate: row.start_date, endDate: row.end_date,
    reason: row.reason, version: row.version, createdBy: row.created_by, createdAt: row.created_at,
    revokedBy: row.revoked_by, revokedAt: row.revoked_at, revokeReason: row.revoke_reason,
    active: !row.revoked_at && row.start_date <= todayKorea() && row.end_date >= todayKorea(),
    accessEnabled: false, notice: '위임 계획만 저장했습니다. 보호자 로그인·대리 입력은 아직 활성화하지 않았습니다.' };
}

export function listDelegations(db, actor, patientId) {
  requirePatient(db, actor, 'delegation.write', patientId);
  return { delegations: db.prepare('SELECT * FROM caregiver_delegations WHERE patient_id=? ORDER BY created_at DESC,id').all(patientId).map(delegationFromRow), accessEnabled: false };
}

export function saveDelegation(db, actor, patientId, input) {
  const body = objectBody(input); allowedKeys(body, ['accountId', 'scopes', 'startDate', 'endDate', 'reason', 'clientRequestId']);
  requirePatient(db, actor, 'delegation.write', patientId);
  const accountId = textValue(body.accountId, '지원자 계정 ID', { min: 1, max: 100 });
  if (!db.prepare('SELECT id FROM auth_accounts WHERE id=?').get(accountId)) throw new HttpError(404, '지원자 계정을 찾을 수 없습니다.');
  const startDate = dateValue(body.startDate), endDate = dateValue(body.endDate);
  if (endDate < startDate) throw new HttpError(400, '종료일은 시작일보다 빠를 수 없습니다.');
  if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > 3) throw new HttpError(400, '위임할 범위를 선택해 주세요.');
  const scopes = [...new Set(body.scopes.map(value => choice(value, '위임 범위', ['record.read', 'record.propose', 'message.read'])))].sort();
  const reason = textValue(body.reason, '위임 근거', { min: 1, max: 2000 });
  return mutate(db, actor, patientId, 'saveDelegation', body, () => {
    const id = randomUUID();
    db.prepare('INSERT INTO caregiver_delegations(id,patient_id,account_id,scopes_json,start_date,end_date,reason,version,created_by,created_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
      .run(id, patientId, accountId, JSON.stringify(scopes), startDate, endDate, reason, actor.accountId, timestamp());
    return { delegation: delegationFromRow(db.prepare('SELECT * FROM caregiver_delegations WHERE id=?').get(id)) };
  });
}

export function revokeDelegation(db, actor, patientId, delegationId, input) {
  const body = objectBody(input); allowedKeys(body, ['version', 'reason', 'clientRequestId']);
  requirePatient(db, actor, 'delegation.write', patientId);
  const expected = version(body.version, 1), reason = textValue(body.reason, '철회 사유', { min: 1, max: 2000 });
  return mutate(db, actor, patientId, `revokeDelegation:${delegationId}`, body, () => {
    const row = db.prepare('SELECT * FROM caregiver_delegations WHERE id=? AND patient_id=?').get(delegationId, patientId);
    if (!row) throw new HttpError(404, '위임 계획을 찾을 수 없습니다.');
    if (row.version !== expected || row.revoked_at) throw new HttpError(409, '이미 철회했거나 변경된 위임 계획입니다.');
    db.prepare('UPDATE caregiver_delegations SET revoked_by=?,revoked_at=?,revoke_reason=?,version=version+1 WHERE id=?')
      .run(actor.accountId, timestamp(), reason, delegationId);
    return { delegation: delegationFromRow(db.prepare('SELECT * FROM caregiver_delegations WHERE id=?').get(delegationId)) };
  });
}
