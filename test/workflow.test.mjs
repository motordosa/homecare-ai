import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, seedDatabase, recordFromRow, todayKorea, dateOffset } from '../lib/db.mjs';
import { createAuthService } from '../lib/auth.mjs';
import { staffAccessFor, assertStaffCapability } from '../lib/staff-access.mjs';
import { ensureMedicationSchema } from '../lib/medications.mjs';
import { ensureVisionSchema } from '../lib/vision.mjs';
import { ensureMedicationPhotoSchema } from '../lib/medication-photos.mjs';
import * as workflow from '../lib/workflow.mjs';

const status = code => error => error.status === code;
const requestId = () => randomUUID();
const today = todayKorea();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'homecare-workflow-'));
  const { db } = openDatabase(dir);
  const auth = createAuthService({ db, env: { AUTH_MODE: 'demo' } });
  ensureMedicationSchema(db); ensureVisionSchema(db); ensureMedicationPhotoSchema(db); workflow.ensureWorkflowSchema(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const clinician = { accountId: 'test-clinician', role: 'clinician', provider: 'kakao', ...staffAccessFor({ provider: 'kakao', providerId: '101' }, { CLINICIAN_KAKAO_IDS: '101' }) };
  const support = { accountId: 'test-support', role: 'clinician', provider: 'kakao', ...staffAccessFor({ provider: 'kakao', providerId: '202' }, { STAFF_ACCESS_JSON: JSON.stringify({ 202: { roles: ['support'], patientIds: ['p001'] } }) }) };
  return { db, auth, clinician, support };
}

function photo(db, patientId = 'p001') {
  const analysisId = randomUUID(), id = randomUUID(), time = new Date().toISOString();
  db.prepare('INSERT INTO photo_analyses(id,patient_id,kind,image_hash,provider,model,proposal_json,warnings_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(analysisId, patientId, 'medication', 'fixture-hash', 'mock', 'fixture', '{}', '[]', time, time);
  db.prepare('INSERT INTO medication_photo_reports(id,patient_id,client_submission_id,request_hash,analysis_id,date,image_hash,image_bytes,image_mime,analysis_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, patientId, randomUUID(), 'request', analysisId, today, 'fixture-hash', Buffer.from('synthetic'), 'image/png', '{}', time);
  return id;
}

test('W01 roles are server assigned, scoped, dynamically revocable and malformed policy fails closed', () => {
  const env = { CLINICIAN_KAKAO_IDS: '101', STAFF_ACCESS_JSON: JSON.stringify({ 202: { roles: ['support'], patientIds: ['p001'] }, 303: { roles: ['administrator'], patientIds: ['p001'] }, 404: { roles: ['researcher'], patientIds: ['p002'] } }) };
  const actor = id => ({ accountId: id, role: 'clinician', ...staffAccessFor({ provider: 'kakao', providerId: id }, env) });
  assertStaffCapability(actor('202'), 'workflow.write', 'p001');
  assert.throws(() => assertStaffCapability(actor('202'), 'clinical.write', 'p001'), status(403));
  assert.throws(() => assertStaffCapability(actor('202'), 'patient.read', 'p002'), status(403));
  assert.throws(() => assertStaffCapability(actor('303'), 'clinical.write', 'p001'), status(403));
  assert.throws(() => assertStaffCapability(actor('404'), 'patient.read', 'p002'), status(403));
  assertStaffCapability(actor('404'), 'research.read', 'p002');
  assert.equal(actor('101').assignedPatientIds, null);
  env.STAFF_ACCESS_JSON = '{broken';
  assert.deepEqual(actor('101').capabilities, []);
  env.STAFF_ACCESS_JSON = JSON.stringify({ 202: { roles: ['support'] } });
  assert.deepEqual(actor('202').capabilities, []);
  env.STAFF_ACCESS_JSON = JSON.stringify({ 202: { roles: ['administrator'], patientIds: [] } });
  assert.throws(() => assertStaffCapability(actor('202'), 'admin.reset', 'p001'), status(403));
});

test('W01 new demo capabilities require a session and write CSRF; existing anonymous demo reads remain compatible', t => {
  const { auth } = fixture(t);
  assert.equal(auth.authorize({ headers: {} }, { patientId: 'p001' }), null);
  assert.throws(() => auth.authorize({ headers: {} }, { capability: 'workflow.write', write: true }), status(401));
  const login = auth.demoLogin({ headers: { 'x-homecare-demo': '1' } }, { role: 'clinician' });
  const req = { headers: { cookie: login.cookie.split(';')[0] } };
  assert.throws(() => auth.authorize(req, { capability: 'workflow.write', write: true }), status(403));
  req.headers['x-csrf-token'] = auth.sessionInfo(req).csrfToken;
  assert.equal(auth.authorize(req, { capability: 'workflow.write', write: true }).role, 'clinician');
  assert.ok(auth.sessionInfo(req).user.capabilities.includes('workflow.write'));
  assert.deepEqual(auth.sessionInfo(req).user.staffRoles, ['clinician']);
});

test('W01 configuration status reflects valid staff bindings and fail-closed policy', t => {
  const { db } = fixture(t);
  const env = { AUTH_MODE: 'kakao', STAFF_ACCESS_JSON: JSON.stringify({ 202: { roles: ['support'], patientIds: ['p001'] } }) };
  const auth = createAuthService({ db, env });
  assert.equal(auth.capabilities().staffConfigured, true);
  env.CLINICIAN_KAKAO_IDS = '101';
  env.STAFF_ACCESS_JSON = '{broken';
  assert.equal(auth.capabilities().staffConfigured, false);
  env.STAFF_ACCESS_JSON = JSON.stringify({ 101: { roles: [], patientIds: [] } });
  assert.equal(auth.capabilities().staffConfigured, false);
  env.STAFF_ACCESS_JSON = '{}';
  assert.equal(auth.capabilities().staffConfigured, true);
});

test('W02 task lifecycle keeps actor/history, prevents double retry and confines support to assigned patients', t => {
  const { db, clinician, support } = fixture(t);
  const input = { patientId: 'p001', type: 'clinical_review', title: '복약 기록 검토 요청', note: '합성 자료 확인 요청', clientRequestId: requestId() };
  const first = workflow.createTask(db, support, input);
  assert.equal(workflow.createTask(db, support, input).replayed, true);
  assert.equal(workflow.createTask(db, support, { clientRequestId: input.clientRequestId, title: input.title, note: input.note, type: input.type, patientId: input.patientId }).replayed, true);
  assert.throws(() => workflow.createTask(db, support, { ...input, title: '다른 내용' }), status(409));
  assert.throws(() => workflow.createTask(db, support, { ...input, patientId: 'p002', clientRequestId: requestId() }), status(403));
  assert.throws(() => workflow.updateTask(db, support, first.task.id, { version: 1, status: 'completed', clientRequestId: requestId() }), status(403));
  const update = { version: 1, status: 'review_requested', assignee: '임상 검토자', clientRequestId: requestId() };
  const pending = workflow.updateTask(db, support, first.task.id, update);
  assert.equal(pending.task.version, 2);
  assert.equal(workflow.updateTask(db, support, first.task.id, update).replayed, true);
  assert.throws(() => workflow.updateTask(db, clinician, first.task.id, { version: 1, status: 'completed', clientRequestId: requestId() }), status(409));
  const done = workflow.updateTask(db, clinician, first.task.id, { version: 2, status: 'completed', note: '확인 완료', clientRequestId: requestId() });
  assert.equal(done.task.history.length, 3);
  assert.equal(done.task.history[2].actor.accountId, clinician.accountId);
  workflow.createTask(db, clinician, { ...input, patientId: 'p002', clientRequestId: requestId() });
  const list = workflow.listTasks(db, support);
  assert.equal(list.total, 1); assert.equal(list.tasks[0].patientId, 'p001');
  assert.throws(() => workflow.listTasks(db, support, { patientId: 'p002' }), status(403));
});

test('W02 photo review has separate revisions and history without changing the original image/report', t => {
  const { db, clinician, support } = fixture(t), reportId = photo(db);
  const original = db.prepare('SELECT * FROM medication_photo_reports WHERE id=?').get(reportId);
  const first = workflow.reviewPhoto(db, support, 'p001', reportId, { reportId, version: 0, status: 'needs_information', note: '함량을 다시 확인해 주세요.', clientRequestId: requestId() });
  assert.equal(first.review.version, 1);
  assert.throws(() => workflow.reviewPhoto(db, support, 'p001', reportId, { version: 1, status: 'reviewed', note: '확인', clientRequestId: requestId() }), status(403));
  const input = { version: 1, status: 'reviewed', note: '포장 글자를 확인함. 실제 복용 증명은 아님.', clientRequestId: requestId() };
  workflow.reviewPhoto(db, clinician, 'p001', reportId, input);
  assert.equal(workflow.reviewPhoto(db, clinician, 'p001', reportId, input).replayed, true);
  assert.throws(() => workflow.reviewPhoto(db, clinician, 'p001', reportId, { ...input, clientRequestId: requestId() }), status(409));
  assert.equal(workflow.listPhotoReviews(db, support, 'p001').reports[0].review.status, 'reviewed');
  assert.deepEqual(db.prepare('SELECT * FROM medication_photo_reports WHERE id=?').get(reportId), original);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM medication_photo_review_events').get().n, 2);
  assert.throws(() => workflow.reviewPhoto(db, clinician, 'p002', reportId, { version: 0, status: 'reviewed', note: '다른 환자', clientRequestId: requestId() }), status(404));
  for (let i = 0; i < 22; i++) photo(db);
  const page1 = workflow.listPhotoReviews(db, clinician, 'p001', { limit: 20 });
  const page2 = workflow.listPhotoReviews(db, clinician, 'p001', { limit: 20, offset: 20 });
  assert.equal(page1.total, 23); assert.equal(page2.reports.length, 3);
  assert.equal(new Set([...page1.reports, ...page2.reports].map(report => report.id)).size, 23);
});

test('W03 corrections preserve source snapshot, require clinical approval, reject changed originals and audit before/after', t => {
  const { db, clinician, support } = fixture(t);
  const old = recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get('p001', today));
  const input = { date: today, expectedRevision: old.revision, patch: { steps: 0, sleepHours: null }, reason: '전화로 수치 입력 오류 확인', clientRequestId: requestId() };
  const proposed = workflow.proposeCorrection(db, support, 'p001', input).correction;
  assert.equal(db.prepare('SELECT steps FROM daily_records WHERE patient_id=? AND date=?').get('p001', today).steps, old.steps);
  assert.equal(workflow.proposeCorrection(db, support, 'p001', input).replayed, true);
  assert.throws(() => workflow.reviewCorrection(db, support, proposed.id, { version: 1, status: 'approved', reason: '확인', clientRequestId: requestId() }), status(403));
  const review = { version: 1, status: 'approved', reason: '원 보고 내용을 확인해 정정', clientRequestId: requestId() };
  const approved = workflow.reviewCorrection(db, clinician, proposed.id, review);
  assert.equal(approved.correction.status, 'approved');
  assert.equal(workflow.reviewCorrection(db, clinician, proposed.id, review).replayed, true);
  const next = recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get('p001', today));
  assert.equal(next.steps, 0); assert.equal(next.sleepHours, null); assert.equal(next.revision, 2);
  const audit = db.prepare('SELECT * FROM daily_record_audit').get();
  assert.equal(JSON.parse(audit.before_json).steps, old.steps); assert.equal(JSON.parse(audit.after_json).steps, 0);
  assert.equal(JSON.parse(audit.actor_json).accountId, clinician.accountId);
  const stale = workflow.proposeCorrection(db, support, 'p001', { ...input, expectedRevision: 2, patch: { steps: 120 }, clientRequestId: requestId() }).correction;
  db.prepare('UPDATE daily_records SET steps=500 WHERE patient_id=? AND date=?').run('p001', today);
  assert.throws(() => workflow.reviewCorrection(db, clinician, stale.id, { ...review, clientRequestId: requestId() }), status(409));
  assert.equal(workflow.listCorrections(db, clinician, 'p001').total, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_record_audit').get().n, 1);
});

test('W06 participation is explicit, versioned and does not imply an approved institution protocol', t => {
  const { db, clinician, support } = fixture(t);
  assert.equal(workflow.getParticipation(db, support, 'p001').participation, null);
  const body = { version: 0, studyId: 'demo-study', status: 'active', startDate: dateOffset(today, -7), endDate: null, consentVersion: 'demo-draft-v1', requiredDomains: ['meal', 'medication'], reason: '합성자료 시험', clientRequestId: requestId() };
  assert.throws(() => workflow.saveParticipation(db, support, 'p001', body), status(403));
  const initial = workflow.saveParticipation(db, clinician, 'p001', body);
  assert.equal(initial.participation.institutionApproved, false);
  assert.equal(workflow.saveParticipation(db, clinician, 'p001', body).replayed, true);
  assert.throws(() => workflow.saveParticipation(db, clinician, 'p001', { ...body, clientRequestId: requestId() }), status(409));
  assert.throws(() => workflow.saveParticipation(db, clinician, 'p001', { ...body, version: 1, status: 'withdrawn', clientRequestId: requestId() }), status(400));
  workflow.saveParticipation(db, clinician, 'p001', { ...body, version: 1, status: 'withdrawn', endDate: today, reason: '합성 철회 시나리오', clientRequestId: requestId() });
  const stored = workflow.getParticipation(db, clinician, 'p001');
  assert.equal(stored.participation.status, 'withdrawn'); assert.equal(stored.history.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_records WHERE patient_id=?').get('p001').n > 0, true);
});

test('W04 delegation foundation has explicit scopes/expiry/revocation and never enables proxy login', t => {
  const { db, auth, clinician } = fixture(t);
  const login = auth.demoLogin({ headers: { 'x-homecare-demo': '1' } }, { role: 'patient', patientId: 'p002' });
  const req = { headers: { cookie: login.cookie.split(';')[0] } };
  const caregiver = auth.actor(req);
  const input = { accountId: caregiver.accountId, scopes: ['record.read', 'record.propose'], startDate: today, endDate: dateOffset(today, 7), reason: '위임 기반 합성 시험', clientRequestId: requestId() };
  const created = workflow.saveDelegation(db, clinician, 'p001', input).delegation;
  assert.equal(created.accessEnabled, false); assert.equal(created.active, true);
  assert.equal(auth.actor(req).patientId, 'p002');
  const revoked = workflow.revokeDelegation(db, clinician, 'p001', created.id, { version: 1, reason: '지원 종료', clientRequestId: requestId() }).delegation;
  assert.equal(revoked.active, false); assert.equal(revoked.accessEnabled, false);
  assert.equal(workflow.listDelegations(db, clinician, 'p001').delegations.length, 1);
  assert.throws(() => workflow.saveDelegation(db, clinician, 'p001', { ...input, scopes: ['clinical.write'], clientRequestId: requestId() }), status(400));
});

test('W03/W06 schema is additive/idempotent and explicit demo reset prevents synthetic-ID resurrection', t => {
  const { db, clinician } = fixture(t);
  const before = db.prepare('SELECT id,steps,date FROM daily_records ORDER BY id').all();
  workflow.ensureWorkflowSchema(db);
  assert.deepEqual(db.prepare('SELECT id,steps,date FROM daily_records ORDER BY id').all(), before);
  workflow.createTask(db, clinician, { patientId: 'p001', type: 'contact', title: '연락', clientRequestId: requestId() });
  db.exec('CREATE TABLE research_snapshots(id TEXT PRIMARY KEY); INSERT INTO research_snapshots VALUES (\'snapshot\');');
  seedDatabase(db, 'seed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_tasks').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_mutations').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM research_snapshots').get().n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
