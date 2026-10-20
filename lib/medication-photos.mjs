import { createHash, randomUUID } from 'node:crypto';
import { todayKorea, transaction } from './db.mjs';
import { medicationSchedule, saveMedicationEvent } from './medications.mjs';
import { allowedKeys, choice, dateValue, decodeImage, HttpError, objectBody, textValue } from './validation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureMedicationPhotoSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS medication_photo_reports (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    client_submission_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    analysis_id TEXT NOT NULL REFERENCES photo_analyses(id) ON DELETE CASCADE,
    date TEXT NOT NULL, image_hash TEXT NOT NULL, image_bytes BLOB NOT NULL,
    image_mime TEXT NOT NULL, analysis_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(patient_id,client_submission_id), UNIQUE(id,patient_id)
  );
  CREATE TABLE IF NOT EXISTS medication_photo_report_events (
    report_id TEXT NOT NULL, patient_id TEXT NOT NULL, event_id TEXT NOT NULL,
    revision INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(report_id,event_id),
    FOREIGN KEY(report_id,patient_id) REFERENCES medication_photo_reports(id,patient_id) ON DELETE CASCADE,
    FOREIGN KEY(event_id,patient_id) REFERENCES medication_events(id,patient_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS medication_photos_patient_date ON medication_photo_reports(patient_id,date,created_at);`);
}

function requirePatient(db, patientId) {
  if (!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
}

function reportFromRow(db, row) {
  return { id: row.id, patientId: row.patient_id, date: row.date, createdAt: row.created_at,
    source: 'patient-self-report-with-photo', reviewStatus: 'unreviewed',
    imageUrl: `/api/patients/${encodeURIComponent(row.patient_id)}/medication-photo-reports/${encodeURIComponent(row.id)}/image`,
    analysis: JSON.parse(row.analysis_json),
    events: db.prepare('SELECT event_json FROM medication_photo_report_events WHERE report_id=? ORDER BY event_id').all(row.id).map(item => JSON.parse(item.event_json)),
  };
}

export function getMedicationPhotoReports(db, patientId, requestedDate) {
  requirePatient(db, patientId);
  const date = dateValue(requestedDate ?? todayKorea());
  const rows = db.prepare(`SELECT id,patient_id,date,created_at,analysis_json FROM medication_photo_reports
    WHERE patient_id=? AND date=? ORDER BY created_at DESC,id DESC LIMIT 20`).all(patientId, date);
  return { date, reports: rows.map(row => reportFromRow(db, row)) };
}

export function getMedicationPhotoImage(db, patientId, reportId) {
  const row = db.prepare('SELECT image_bytes,image_mime FROM medication_photo_reports WHERE patient_id=? AND id=?').get(patientId, reportId);
  if (!row) throw new HttpError(404, '사진 첨부 보고를 찾을 수 없습니다.');
  return { buffer: Buffer.from(row.image_bytes), mime: row.image_mime };
}

export function saveMedicationPhotoReport(db, patientId, input) {
  requirePatient(db, patientId);
  const body = objectBody(input);
  allowedKeys(body, ['clientSubmissionId', 'analysisId', 'imageData', 'date', 'patientConfirmed', 'slots']);
  if (typeof body.clientSubmissionId !== 'string' || !uuid.test(body.clientSubmissionId)) throw new HttpError(400, '전송 ID를 확인해 주세요.');
  if (body.patientConfirmed !== true) throw new HttpError(400, '포장과 약·회차·복약 상태를 직접 확인해 주세요.');
  const analysisId = textValue(body.analysisId, '분석 ID', { min: 1, max: 100 });
  const date = dateValue(body.date);
  if (date > todayKorea()) throw new HttpError(400, '미래 날짜의 복약을 보고할 수 없습니다.');
  const image = decodeImage(body.imageData);
  const imageHash = hash(image.buffer);
  if (!Array.isArray(body.slots) || body.slots.length < 1 || body.slots.length > 24) throw new HttpError(400, '보고할 회차를 1~24개 선택해 주세요.');
  const slots = body.slots.map(inputSlot => {
    const slot = objectBody(inputSlot);
    allowedKeys(slot, ['orderId', 'time', 'status', 'reason', 'note', 'expectedRevision']);
    if (!Number.isSafeInteger(slot.expectedRevision) || slot.expectedRevision < 0) throw new HttpError(400, '회차 수정번호를 확인해 주세요.');
    return { orderId: textValue(slot.orderId, '계획 ID', { min: 1, max: 100 }),
      time: textValue(slot.time, '시각', { min: 5, max: 5 }),
      status: choice(slot.status, '복약 상태', ['taken', 'missed', 'unknown']),
      reason: slot.reason === undefined ? '' : textValue(slot.reason, '사유', { max: 1000 }),
      note: slot.note === undefined ? '' : textValue(slot.note, '메모', { max: 2000 }), expectedRevision: slot.expectedRevision };
  }).sort((a,b) => a.orderId.localeCompare(b.orderId) || a.time.localeCompare(b.time));
  const keys = slots.map(slot => JSON.stringify([slot.orderId, slot.time]));
  if (new Set(keys).size !== keys.length) throw new HttpError(400, '보고 회차가 중복되었습니다.');
  const requestHash = hash(JSON.stringify({ analysisId, imageHash, date, patientConfirmed: true, slots }));
  return transaction(db, () => {
    const existing = db.prepare('SELECT id,patient_id,date,created_at,analysis_json,request_hash FROM medication_photo_reports WHERE patient_id=? AND client_submission_id=?').get(patientId, body.clientSubmissionId);
    if (existing) {
      if (existing.request_hash !== requestHash) throw new HttpError(409, '같은 전송 ID의 내용이 달라졌습니다. 화면을 다시 열어 주세요.');
      return { report: reportFromRow(db, existing), replayed: true };
    }
    const analysis = db.prepare('SELECT * FROM photo_analyses WHERE id=? AND patient_id=?').get(analysisId, patientId);
    if (!analysis) throw new HttpError(404, '이 환자의 분석 초안을 찾을 수 없습니다. 다시 분석해 주세요.');
    if (analysis.kind !== 'medication') throw new HttpError(400, '약봉투 사진 분석만 사용할 수 있습니다.');
    if (analysis.image_hash !== imageHash) throw new HttpError(409, '분석한 사진과 첨부 사진이 다릅니다.');
    if (analysis.expires_at <= new Date().toISOString()) throw new HttpError(409, '분석 초안이 만료되었습니다. 다시 분석해 주세요.');
    const schedule = medicationSchedule(db, patientId, date);
    const selected = slots.map(slot => {
      const current = schedule.slots.find(item => item.orderId === slot.orderId && item.time === slot.time);
      if (!current) throw new HttpError(400, '선택한 회차가 이 환자·날짜의 계획에 없습니다.');
      if (current.revision !== slot.expectedRevision) throw new HttpError(409, '복약 기록이 다른 창에서 변경되었습니다. 닫은 뒤 목록을 다시 불러와 주세요.');
      return { slot, current };
    });
    const id = randomUUID(), createdAt = new Date().toISOString();
    const snapshot = { id: analysis.id, source: 'openai-package-text-v1', provider: analysis.provider, model: analysis.model,
      createdAt: analysis.created_at, proposal: JSON.parse(analysis.proposal_json), warnings: JSON.parse(analysis.warnings_json) };
    db.prepare(`INSERT INTO medication_photo_reports (id,patient_id,client_submission_id,request_hash,analysis_id,date,image_hash,image_bytes,image_mime,analysis_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, patientId, body.clientSubmissionId, requestHash, analysisId, date, imageHash, image.buffer,
      `image/${image.extension === 'jpg' ? 'jpeg' : image.extension}`, JSON.stringify(snapshot), createdAt);
    for (const { slot, current } of selected) {
      const { expectedRevision, ...fields } = slot;
      const event = saveMedicationEvent(db, patientId, { ...fields, date });
      const eventSnapshot = { ...event, name: current.name, strength: current.strength, dose: current.dose, route: current.route };
      db.prepare('INSERT INTO medication_photo_report_events (report_id,patient_id,event_id,revision,event_json) VALUES (?,?,?,?,?)')
        .run(id, patientId, event.id, event.revision, JSON.stringify(eventSnapshot));
    }
    return { report: reportFromRow(db, { id, patient_id: patientId, date, created_at: createdAt, analysis_json: JSON.stringify(snapshot) }), replayed: false };
  });
}
