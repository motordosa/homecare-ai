import http from 'node:http';
import { createReadStream, existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { ensureMealSchema, saveMeal as persistMeal } from './lib/meals.mjs';
import { buildRecordExport } from './lib/export.mjs';
import { assignedPatientIds, hasCapability, assertStaffCapability } from './lib/staff-access.mjs';
import { ensureWorkflowSchema, listTasks, createTask, updateTask, photoReview, listPhotoReviews, reviewPhoto, listCorrections, proposeCorrection, reviewCorrection, getParticipation, saveParticipation, listDelegations, saveDelegation, revokeDelegation, appendDailyAudit } from './lib/workflow.mjs';
import { ensureResearchSchema, researchPreview, createResearchSnapshot, getResearchSnapshot, exportResearchSnapshot } from './lib/research.mjs';
import { ensureEvidenceSchema, createEvidenceService } from './lib/evidence.mjs';
import { foodTable, mealFromRow, openDatabase, recordFromRow, todayKorea, transaction } from './lib/db.mjs';
import { dashboard, effectiveRecords, getPatient, getPatients, patientSummary, provenance } from './lib/analysis.mjs';
import { resetDemo } from './lib/reset.mjs';
import { allowedKeys, choice, csvCell, dateValue, decodeImage, HttpError, numberValue, objectBody, textList, textValue } from './lib/validation.mjs';
import { ensureMedicationSchema, getMedicationOrders, createMedicationOrder, endMedicationOrder, medicationSchedule, saveMedicationEvent, getMedicationEvents } from './lib/medications.mjs';
import { ensureVisionSchema, visionCapabilities, analyzePhoto, resolveMealAnalysis, markAnalysisApplied } from './lib/vision.mjs';
import { ensureMedicationPhotoSchema, saveMedicationPhotoReport, getMedicationPhotoReports, getMedicationPhotoImage } from './lib/medication-photos.mjs';
import { healthCapabilities, ensureHealthSchema, getHealthConnections, createHealthConnection, revokeHealthConnection, receiveHealthBatch, getHealthConnectionIdentity } from './lib/health-sync.mjs';

import { createAuthService } from './lib/auth.mjs';
import { ensureCommunicationSchema, listNotices, createNotice, updateNotice, activeNotices, readNotice, listMessages, sendMessage, readMessages, conversations } from './lib/communications.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const { db, uploadDir } = openDatabase(process.env.DATA_DIR || join(root, 'data'));
ensureMedicationSchema(db);
ensureVisionSchema(db);
ensureMealSchema(db);
ensureMedicationPhotoSchema(db);
ensureHealthSchema(db);
const auth = createAuthService({db});
ensureCommunicationSchema(db);
ensureWorkflowSchema(db);
ensureResearchSchema(db);
ensureEvidenceSchema(db);
const evidenceService=createEvidenceService({db});
db.prepare("INSERT INTO metadata (key,value) VALUES ('schema_version','7') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
const port = Number(process.env.PORT || 3000);
const bodyLimit = 7 * 1024 * 1024;
const schemaVersion = 7;

function respond(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

async function readJson(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Content-Type: application/json을 사용해 주세요.');
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > bodyLimit) throw new HttpError(413, '요청 본문이 너무 큽니다. 사진은 5MB 이하여야 합니다.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > bodyLimit) throw new HttpError(413, '요청 본문이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return objectBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, '올바른 JSON을 입력해 주세요.'); }
}

function legacyStaff(req, capability = 'clinical.write', patientId = null, write = false) {
  return auth.authorize(req,{staff:true,patientId,write,...(auth.capabilities().mode==='kakao'?{capability}:{})});
}
function scopeFor(actor) { return auth.capabilities().mode==='demo' ? null : assignedPatientIds(actor); }
function staffActor(req, capability, patientId=null, write=false) {
  return auth.authorize(req,{staff:true,communication:true,capability,patientId,write});
}
function requirePatientWriter(req, patientId) {
  const actor=auth.authorize(req,{patientId,write:true});
  if(auth.capabilities().mode==='kakao' && actor.role!=='patient') throw new HttpError(403,'환자의 자기보고는 본인 계정에서 기록해 주세요. 직원 정정은 정정 요청·승인 기능을 사용해 주세요.');
  return actor;
}
function photoReports(patientId,date,actor) {
  const result=getMedicationPhotoReports(db,patientId,date);
  result.reports=result.reports.map(report=>{const review=photoReview(db,report.id);return {...report,reviewStatus:review.status,...(actor?.role==='clinician'?{review}:{})};});
  return result;
}

function requirePatient(id) {
  const patient = getPatient(db, id);
  if (!patient) throw new HttpError(404, '환자를 찾을 수 없습니다.');
  return patient;
}

function assertSameOrigin(req) {
  // OAuth uses a canonical origin; demo writes retain the previous local-host contract.
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') throw new HttpError(403, '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.');
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { throw new HttpError(403, '올바르지 않은 요청 출처입니다.'); }
    if(auth.capabilities().mode==='kakao') {
      let expected;
      try { expected=new URL(process.env.APP_ORIGIN).origin; } catch { throw new HttpError(403, '서버 주소 설정이 필요합니다.'); }
      if(new URL(origin).origin!==expected)throw new HttpError(403,'다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.');
      return;
    }
    const forwardedHost = req.headers['x-forwarded-host']?.split(',')[0]?.trim();
    if (originHost !== req.headers.host && originHost !== forwardedHost) throw new HttpError(403, '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.');
  }
}

function health() {
  const counts = {};
  for (const [key, table] of [['patients', 'patients'], ['dailyRecords', 'daily_records'], ['meals', 'meals']]) counts[key] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return { ok: true, status: 'ok', app: 'HomeCare AI Demo', schemaVersion, appVersion:'0.8.0', dataMode: 'demo', seedMode: db.prepare("SELECT value FROM metadata WHERE key='mode'").get()?.value ?? 'seed', today: todayKorea(), timezone: 'Asia/Seoul', storage: 'sqlite', counts, resetAt: db.prepare("SELECT value FROM metadata WHERE key='reset_at'").get()?.value ?? null, provenance };
}

function createPatient(body) {
  allowedKeys(body, ['name', 'age', 'sex', 'conditions', 'medications', 'caregiver']);
  const id = `p-${randomUUID()}`;
  const name = textValue(body.name, '이름', { min: 1, max: 40 });
  const age = numberValue(body.age, '나이', 1, 120, true);
  const sex = choice(body.sex, '성별', ['female', 'male', 'other']);
  const conditions = body.conditions === undefined ? [] : textList(body.conditions, '질환');
  const medications = body.medications === undefined ? [] : textList(body.medications, '복약');
  const caregiver = body.caregiver === undefined ? '' : textValue(body.caregiver, '돌봄 정보', { max: 200 });
  db.prepare('INSERT INTO patients (id,name,age,sex,conditions,medications,caregiver,created_at,demo) VALUES (?,?,?,?,?,?,?,?,1)').run(id, name, age, sex, JSON.stringify(conditions), JSON.stringify(medications), caregiver, new Date().toISOString());
  return getPatient(db, id);
}

function saveDaily(id, body, actor = null) {
  requirePatient(id);
  const fields = ['date', 'steps', 'sleepHours', 'medicationStatus', 'appetite', 'mood', 'note', 'weightKg', 'expectedRevision', 'clientSubmissionId'];
  allowedKeys(body, fields);
  if (!Object.keys(body).some(k => !['date','expectedRevision','clientSubmissionId'].includes(k))) throw new HttpError(400, '하나 이상의 기록 항목을 입력해 주세요.');
  const requestId = body.clientSubmissionId;
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))) throw new HttpError(400, '올바른 일일 기록 저장 요청번호가 필요합니다.');
  // Accepted record fields are scalar. Sorting their keys makes equivalent JSON
  // property order replay the same request, while preserving omitted vs null/0.
  const requestHash = requestId ? createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(body).filter(key => key !== 'clientSubmissionId').sort().map(key => [key, body[key]])))).digest('hex') : null;
  return transaction(db, () => {
  if (requestId) {
    const previous = db.prepare('SELECT request_hash,response_json FROM daily_record_submissions WHERE patient_id=? AND request_id=?').get(id, requestId);
    if (previous) {
      if (previous.request_hash !== requestHash) throw new HttpError(409, '같은 저장 요청번호의 내용이 바뀌었습니다. 새 기록으로 다시 확인해 주세요.');
      return JSON.parse(previous.response_json);
    }
  }
  const date = dateValue(body.date ?? todayKorea());
  if (date > todayKorea()) throw new HttpError(400, '미래의 일일 기록은 미리 저장할 수 없습니다. 날짜를 확인해 주세요.');
  const old = db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(id, date);
  if (body.expectedRevision !== undefined && numberValue(body.expectedRevision, '수정번호', 0, 1000000000, true) !== (old?.revision ?? 0)) throw new HttpError(409, '기록이 다른 곳에서 변경되었습니다. 다시 확인해 주세요.');
  const value = {
    steps: old?.steps ?? null, sleepHours: old?.sleep_hours ?? null,
    medicationStatus: old?.medication_status ?? null, appetite: old?.appetite ?? null,
    mood: old?.mood ?? null, note: old?.note ?? '', weightKg: old?.weight_kg ?? null,
  };
  if ('steps' in body) value.steps = body.steps === null ? null : numberValue(body.steps, '걸음 수', 0, 100000, true);
  if ('sleepHours' in body) value.sleepHours = body.sleepHours === null ? null : numberValue(body.sleepHours, '수면 시간', 0, 24);
  if ('weightKg' in body) value.weightKg = body.weightKg === null ? null : numberValue(body.weightKg, '체중', 10, 350);
  if ('medicationStatus' in body) value.medicationStatus = choice(body.medicationStatus, '복약 상태', ['taken', 'partial', 'missed', 'unknown']);
  if ('appetite' in body) value.appetite = choice(body.appetite, '식욕', ['good', 'normal', 'poor']);
  if ('mood' in body) value.mood = choice(body.mood, '기분', ['good', 'normal', 'poor']);
  if ('note' in body) value.note = textValue(body.note, '메모', { max: 2000 });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO daily_records (id,patient_id,date,steps,sleep_hours,medication_status,appetite,mood,note,weight_kg,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(patient_id,date) DO UPDATE SET steps=excluded.steps,sleep_hours=excluded.sleep_hours,
    medication_status=excluded.medication_status,appetite=excluded.appetite,mood=excluded.mood,note=excluded.note,weight_kg=excluded.weight_kg,updated_at=excluded.updated_at,revision=daily_records.revision+1`)
    .run(old?.id ?? randomUUID(), id, date, value.steps, value.sleepHours, value.medicationStatus, value.appetite, value.mood, value.note, value.weightKg, old?.created_at ?? now, now);
  const record=recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(id, date));
  appendDailyAudit(db,{patientId:id,date,before:recordFromRow(old),after:record,actor,reason:actor?.role==='clinician'?'합성자료 직원 입력':'환자 입력',source:actor?.role==='clinician'?'staff-demo-entry':'patient-self-report'});
  if (requestId) db.prepare('INSERT INTO daily_record_submissions(patient_id,request_id,request_hash,response_json,created_at) VALUES (?,?,?,?,?)').run(id, requestId, requestHash, JSON.stringify(record), now);
  return record;
  });
}

function saveMeal(id, body) { return persistMeal(db, uploadDir, id, body); }

function exportCsv(res, query = {}, allowedPatientIds = null) {
  const result = buildRecordExport(db, query, allowedPatientIds);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(result.csv) });
  res.end(result.csv);
}

function staticFile(req, res, pathname) {
  let file;
  if (pathname.startsWith('/uploads/')) {
    const filename = pathname.slice('/uploads/'.length);
    if (!/^[0-9a-f-]+\.(jpg|png|webp)$/.test(filename) || basename(filename) !== filename) throw new HttpError(404, '파일을 찾을 수 없습니다.');
    file = join(uploadDir, filename);
    const owner=db.prepare('SELECT patient_id FROM meals WHERE image_filename=?').get(filename);
    if(!owner)throw new HttpError(404,'파일을 찾을 수 없습니다.');
    auth.authorize(req,{patientId:owner.patient_id});
  } else {
    const aliases = { '/': '/index.html', '/patient': '/patient.html', '/patient/': '/patient.html', '/clinician': '/clinician.html', '/clinician/': '/clinician.html', '/favicon.ico': '/icon.svg', '/login':'/login.html', '/account':'/account.html' };
    const relative = aliases[pathname] || pathname;
    file = resolve(publicDir, `.${relative}`);
    if (!file.startsWith(`${publicDir}/`)) throw new HttpError(404, '페이지를 찾을 수 없습니다.');
    if (relative.split('/').some(part => part.startsWith('.'))) throw new HttpError(404, '페이지를 찾을 수 없습니다.');
  }
  if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, '페이지를 찾을 수 없습니다.');
  const extension = extname(file);
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }[extension] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': statSync(file).size, 'Cache-Control': pathname.startsWith('/uploads/') ? 'no-store' : 'no-cache' });
  if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, '잘못된 URL입니다.'); }
    const method = req.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) assertSameOrigin(req);
    const redirect=(location,cookies=[])=>{res.writeHead(302,{'Location':location,'Cache-Control':'no-store',...(cookies.length?{'Set-Cookie':cookies}:{})});res.end();};
    if(path==='/auth/kakao' && method==='GET') {
      const result=auth.startOAuth(req,url.searchParams.get('next'));return redirect(result.location,[result.cookie]);
    }
    if(path==='/auth/kakao/callback' && method==='GET') {
      try {const result=await auth.finishOAuth(req,url);return redirect(result.location,result.cookies);}
      catch {return redirect('/login?error=kakao_failed',[auth.clearLoginCookie()]);}
    }
    if(path==='/api/auth/session' && method==='GET')return respond(res,200,auth.sessionInfo(req));
    if(path==='/api/auth/demo' && method==='POST') {
      const result=auth.demoLogin(req,await readJson(req));return respond(res,200,{ok:true,demoToken:result.demoToken},{'Set-Cookie':result.cookie});
    }
    if(path==='/api/auth/logout' && method==='POST')return respond(res,200,{ok:true},{'Set-Cookie':auth.logout(req)});
    if(path==='/api/auth/enroll' && method==='POST')return respond(res,200,auth.enroll(req,await readJson(req)));
    const invite=/^\/api\/clinician\/patients\/([^/]+)\/invitations$/.exec(path);
    if(invite && method==='POST'){allowedKeys(await readJson(req),[]);return respond(res,201,{invitation:auth.issueInvitation(req,invite[1])});}
    if(path==='/api/clinician/notices') {
      const actor=staffActor(req,'notice.write',null,method==='POST');
      if(method==='GET')return respond(res,200,listNotices(db,actor));
      if(method==='POST')return respond(res,201,createNotice(db,actor,await readJson(req)));
    }
    const notice=/^\/api\/clinician\/notices\/([1-9]\d*)$/.exec(path);
    if(notice && method==='PATCH')return respond(res,200,updateNotice(db,staffActor(req,'notice.write',null,true),Number(notice[1]),await readJson(req)));
    if(path==='/api/notices/active' && method==='GET')return respond(res,200,activeNotices(db,auth.authorize(req,{communication:true})));
    const noticeRead=/^\/api\/notices\/([1-9]\d*)\/read$/.exec(path);
    if(noticeRead && method==='POST')return respond(res,200,readNotice(db,auth.authorize(req,{communication:true,write:true}),Number(noticeRead[1]),await readJson(req)));
    if(path==='/api/clinician/conversations' && method==='GET'){const actor=staffActor(req,'message.write');const result=conversations(db,actor);const scope=assignedPatientIds(actor);if(scope!==null)result.conversations=result.conversations.filter(c=>scope.includes(c.patientId));return respond(res,200,result);}
    const messages=/^\/api\/patients\/([^/]+)\/messages(\/read)?$/.exec(path);
    if(messages) {
      const actor=auth.authorize(req,{patientId:messages[1],communication:true,write:method==='POST'});
      if(actor.role==='clinician')assertStaffCapability(actor,'message.write',messages[1]);
      if(!messages[2] && method==='GET')return respond(res,200,listMessages(db,actor,messages[1],Object.fromEntries(url.searchParams)));
      if(!messages[2] && method==='POST')return respond(res,201,sendMessage(db,actor,messages[1],await readJson(req)));
      if(messages[2] && method==='POST')return respond(res,200,readMessages(db,actor,messages[1],await readJson(req)));
    }
    if (path === '/api/health' && method === 'GET') return respond(res, 200, auth.capabilities().mode==='kakao'?{ok:true,status:'ok',storage:'sqlite',schemaVersion,appVersion:'0.8.0'}:health());
    if (path === '/api/capabilities' && method === 'GET') return respond(res, 200, {
      auth: auth.capabilities(),
      vision: visionCapabilities(process.env),
      health: healthCapabilities(),
      medications: { perDose: true, clinicianPlans: true },
      usability: { version:'0.7.0', roleScopes:true, researchSnapshots:true, evidenceProvider:'Europe PMC', caregiverProxyAccess:false, realUserValidation:false },
    });
    if (path === '/api/health-sync/connection' && method === 'GET') {
      const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) throw new HttpError(401, '유효한 연결 토큰이 필요합니다.');
      return respond(res, 200, getHealthConnectionIdentity(db, token));
    }
    if (path === '/api/health-sync' && method === 'POST') {
      const header = req.headers.authorization || '';
      const token = /^Bearer ([^\s]+)$/.exec(header)?.[1];
      if (!token) throw new HttpError(401, '유효한 연결 토큰이 필요합니다.');
      return respond(res, 200, receiveHealthBatch(db, token, await readJson(req)));
    }
    if(path==='/api/clinician/access' && method==='GET') {
      const actor=auth.requireActor(req);
      if(actor.role!=='clinician')throw new HttpError(403,'직원 업무 권한이 필요합니다.');
      return respond(res,200,{staffRoles:actor.staffRoles,capabilities:actor.capabilities,assignedPatientIds:assignedPatientIds(actor),mode:auth.capabilities().mode,delegationAccessEnabled:false});
    }
    if(path==='/api/clinician/tasks') {
      const actor=staffActor(req,method==='POST'?'workflow.write':'patient.read',null,method==='POST');
      if(method==='GET')return respond(res,200,listTasks(db,actor,Object.fromEntries(url.searchParams)));
      if(method==='POST')return respond(res,201,createTask(db,actor,await readJson(req)));
    }
    let workspaceMatch=/^\/api\/clinician\/tasks\/([^/]+)$/.exec(path);
    if(workspaceMatch && method==='PATCH')return respond(res,200,updateTask(db,staffActor(req,'workflow.write',null,true),workspaceMatch[1],await readJson(req)));
    workspaceMatch=/^\/api\/clinician\/corrections\/([^/]+)$/.exec(path);
    if(workspaceMatch && method==='PATCH')return respond(res,200,reviewCorrection(db,staffActor(req,'correction.approve',null,true),workspaceMatch[1],await readJson(req)));
    workspaceMatch=/^\/api\/patients\/([^/]+)\/(photo-reviews|corrections|participation|delegations)(?:\/([^/]+))?$/.exec(path);
    if(workspaceMatch) {
      const [,patientId,operation,entityId]=workspaceMatch;
      const write=['POST','PUT','PATCH','DELETE'].includes(method);
      const capability=operation==='delegations'?'delegation.write':write?({ 'photo-reviews':'workflow.write',corrections:'correction.propose',participation:'participation.write' }[operation]):'patient.read';
      const actor=staffActor(req,capability,patientId,write);
      const query=Object.fromEntries(url.searchParams);
      if(operation==='photo-reviews' && !entityId && method==='GET')return respond(res,200,listPhotoReviews(db,actor,patientId,query));
      if(operation==='photo-reviews' && !entityId && method==='POST'){const body=await readJson(req);return respond(res,200,reviewPhoto(db,actor,patientId,body.reportId,body));}
      if(operation==='corrections' && !entityId && method==='GET')return respond(res,200,listCorrections(db,actor,patientId,query));
      if(operation==='corrections' && !entityId && method==='POST')return respond(res,201,proposeCorrection(db,actor,patientId,await readJson(req)));
      if(operation==='participation' && !entityId && method==='GET')return respond(res,200,getParticipation(db,actor,patientId));
      if(operation==='participation' && !entityId && method==='PUT')return respond(res,200,saveParticipation(db,actor,patientId,await readJson(req)));
      if(operation==='delegations' && !entityId && method==='GET')return respond(res,200,listDelegations(db,actor,patientId));
      if(operation==='delegations' && !entityId && method==='POST')return respond(res,201,saveDelegation(db,actor,patientId,await readJson(req)));
      if(operation==='delegations' && entityId && method==='DELETE')return respond(res,200,revokeDelegation(db,actor,patientId,entityId,await readJson(req)));
    }
    if(path==='/api/research/preview' && method==='GET') {
      const actor=staffActor(req,'research.read');
      const query=Object.fromEntries(url.searchParams);
      if(Object.hasOwn(query,'patientIds'))query.patientIds=query.patientIds?query.patientIds.split(','):[];
      return respond(res,200,researchPreview(db,query,assignedPatientIds(actor)));
    }
    if(path==='/api/research/snapshots' && method==='POST') {
      const actor=staffActor(req,'research.read',null,true);
      return respond(res,201,{snapshot:createResearchSnapshot(db,await readJson(req),actor,assignedPatientIds(actor))});
    }
    workspaceMatch=/^\/api\/research\/snapshots\/([^/]+)(\/export)?$/.exec(path);
    if(workspaceMatch && method==='GET') {
      const actor=staffActor(req,workspaceMatch[2]?'research.export':'research.read');
      return respond(res,200,workspaceMatch[2]?exportResearchSnapshot(db,workspaceMatch[1],assignedPatientIds(actor)):{snapshot:getResearchSnapshot(db,workspaceMatch[1],assignedPatientIds(actor))});
    }
    if(path==='/api/clinician/evidence' && method==='GET')return respond(res,200,evidenceService.list(staffActor(req,'evidence.read')));
    if(path==='/api/clinician/evidence/search' && method==='POST')return respond(res,200,await evidenceService.search(staffActor(req,'evidence.read',null,true),await readJson(req)));
    workspaceMatch=/^\/api\/clinician\/evidence\/searches\/([^/]+)$/.exec(path);
    if(workspaceMatch && method==='GET')return respond(res,200,evidenceService.getSearch(staffActor(req,'evidence.read'),workspaceMatch[1]));
    if(path==='/api/clinician/evidence/bookmarks' && method==='POST')return respond(res,201,evidenceService.createBookmark(staffActor(req,'evidence.read',null,true),await readJson(req)));
    workspaceMatch=/^\/api\/clinician\/evidence\/bookmarks\/([^/]+)$/.exec(path);
    if(workspaceMatch && method==='PATCH')return respond(res,200,evidenceService.updateBookmark(staffActor(req,'evidence.read',null,true),workspaceMatch[1],await readJson(req)));
    if (path === '/api/dashboard' && method === 'GET') {const actor=auth.capabilities().mode==='demo'?legacyStaff(req):auth.requireActor(req);if(auth.capabilities().mode==='kakao' && actor.role!=='clinician')throw new HttpError(403,'의료진 권한이 필요합니다.');if(auth.capabilities().mode==='kakao'&&!hasCapability(actor,'patient.read'))return respond(res,200,{today:todayKorea(),patients:[],alerts:[],trends:[],stats:{patients:0,needsReview:0,reportedToday:0,averageCompletion:null},provenance,restricted:true});const query=Object.fromEntries(url.searchParams);allowedKeys(query,['startDate','endDate','patientIds']);if(Object.hasOwn(query,'patientIds'))query.patientIds=query.patientIds?query.patientIds.split(','):[];return respond(res,200,dashboard(db,query,scopeFor(actor)));}
    if (path === '/api/patients' && method === 'GET') {const actor=auth.authorize(req);let patients=getPatients(db);if(auth.capabilities().mode==='kakao'){if(actor.role!=='clinician')patients=patients.filter(p=>p.id===actor.patientId);else if(!hasCapability(actor,'patient.read'))patients=[];else{const scope=assignedPatientIds(actor);if(scope!==null)patients=patients.filter(p=>scope.includes(p.id));}}return respond(res,200,{patients,today:todayKorea(),provenance});}
    if (path === '/api/patients' && method === 'POST') {const actor=legacyStaff(req,'clinical.write',null,true);if(auth.capabilities().mode==='kakao'&&assignedPatientIds(actor)!==null)throw new HttpError(403,'환자 등록은 기관 전체 관리 권한이 필요합니다.');return respond(res,201,{patient:createPatient(await readJson(req))});}
    let match = /^\/api\/patients\/([^/]+)\/(medication-orders|medication-schedule|medication-events|medication-photo-reports|photo-analyses|health-connections)$/.exec(path);
    if (match) {
      const [, id, operation] = match;
      const actor=auth.authorize(req,{patientId:id,write:method==='POST'});
      if(operation==='medication-orders' && method==='POST')legacyStaff(req,'clinical.write',id,true);
      if(method==='POST' && ['medication-events','medication-photo-reports'].includes(operation))requirePatientWriter(req,id);
      if(method==='POST' && actor?.role==='clinician' && auth.capabilities().mode==='kakao')assertStaffCapability(actor,'clinical.write',id);
      requirePatient(id);
      if (operation === 'medication-orders' && method === 'GET') return respond(res, 200, { orders: getMedicationOrders(db, id) });
      if (operation === 'medication-orders' && method === 'POST') return respond(res, 201, { order: createMedicationOrder(db, id, await readJson(req)) });
      if (operation === 'medication-schedule' && method === 'GET') return respond(res, 200, medicationSchedule(db, id, dateValue(url.searchParams.get('date') ?? todayKorea())));
      if (operation === 'medication-events' && method === 'GET') return respond(res, 200, { ...getMedicationEvents(db, id, dateValue(url.searchParams.get('date') ?? todayKorea())), photoReports: photoReports(id, url.searchParams.get('date') ?? todayKorea(),actor).reports });
      if (operation === 'medication-events' && method === 'POST') return respond(res, 200, { event: saveMedicationEvent(db, id, await readJson(req)) });
      if (operation === 'medication-photo-reports' && method === 'GET') return respond(res, 200, photoReports(id, url.searchParams.get('date') ?? todayKorea(),actor));
      if (operation === 'medication-photo-reports' && method === 'POST') return respond(res, 201, saveMedicationPhotoReport(db, id, await readJson(req)));
      if (operation === 'photo-analyses' && method === 'POST') return respond(res, 201, await analyzePhoto({ db, patientId: id, body: await readJson(req) }));
      if (operation === 'health-connections' && method === 'GET') return respond(res, 200, getHealthConnections(db, id));
      if (operation === 'health-connections' && method === 'POST') return respond(res, 201, createHealthConnection(db, id, await readJson(req)));
    }
    match = /^\/api\/patients\/([^/]+)\/medication-photo-reports\/([^/]+)\/image$/.exec(path);
    if (match && method === 'GET') {
      auth.authorize(req,{patientId:match[1]});
      const image = getMedicationPhotoImage(db, match[1], match[2]);
      res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.buffer.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(image.buffer);
    }
    match = /^\/api\/medication-orders\/([^/]+)$/.exec(path);
    if (match && method === 'PATCH') {const order=db.prepare('SELECT patient_id FROM medication_orders WHERE id=?').get(match[1]);if(!order)throw new HttpError(404,'복약계획을 찾을 수 없습니다.');legacyStaff(req,'clinical.write',order.patient_id,true);return respond(res,200,{order:endMedicationOrder(db,match[1],await readJson(req))});}
    match = /^\/api\/patients\/([^/]+)\/health-connections\/([^/]+)$/.exec(path);
    if (match && method === 'DELETE') {
      const actor=auth.authorize(req,{patientId:match[1],write:true});
      if(auth.capabilities().mode==='kakao'&&actor.role==='clinician')assertStaffCapability(actor,'clinical.write',match[1]);
      requirePatient(match[1]);
      return respond(res, 200, revokeHealthConnection(db, match[1], match[2]));
    }
    match = /^\/api\/patients\/([^/]+)(?:\/(summary|daily|meals))?$/.exec(path);
    if (match) {
      const [, id, operation] = match;
      auth.authorize(req,{patientId:id,write:method==='POST'});
      requirePatient(id);
      if (!operation && method === 'GET') return respond(res, 200, { patient: getPatient(db, id) });
      if (operation === 'summary' && method === 'GET') return respond(res, 200, patientSummary(db, id, Object.fromEntries(url.searchParams)));
      if (operation === 'daily' && method === 'GET') {
        const date = dateValue(url.searchParams.get('date') ?? todayKorea());
        return respond(res, 200, { record: recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(id, date)) });
      }
      if (operation === 'daily' && method === 'POST') return respond(res, 200, { record: saveDaily(id, await readJson(req),requirePatientWriter(req,id)) });
      if (operation === 'meals' && method === 'POST') {requirePatientWriter(req,id);return respond(res, 201, { meal: saveMeal(id, await readJson(req)) });}
    }
    match = /^\/api\/meals\/([^/]+)$/.exec(path);
    if (match && method === 'DELETE') {
      auth.authorize(req,{write:true});
      const meal = db.prepare('SELECT * FROM meals WHERE id=?').get(match[1]);
      if (!meal) throw new HttpError(404, '식사 기록을 찾을 수 없습니다.');
      requirePatientWriter(req,meal.patient_id);
      db.prepare('DELETE FROM meals WHERE id=?').run(meal.id);
      if (meal.image_filename) { try { unlinkSync(join(uploadDir, meal.image_filename)); } catch (error) { if (error.code !== 'ENOENT') console.error('Upload cleanup failed:', error.code); } }
      return respond(res, 200, { ok: true, deletedId: meal.id });
    }
    if (path === '/api/demo/reset' && method === 'POST') {
      if(auth.capabilities().mode!=='demo')throw new HttpError(403,'실제 로그인 환경에서는 데모 전체 초기화를 사용할 수 없습니다.');
      legacyStaff(req,'admin.reset',null,true);
      const body = await readJson(req);
      allowedKeys(body, ['mode', 'confirmation']);
      if (body.confirmation !== 'RESET') throw new HttpError(400, '리셋하려면 confirmation: RESET을 입력해 주세요.');
      const mode = choice(body.mode ?? 'seed', '리셋 종류', ['seed', 'empty']);
      resetDemo(db, uploadDir, mode);
      return respond(res, 200, { ok: true, mode, ...health() });
    }
    if (path === '/api/export-preview' && method === 'GET') {const actor=legacyStaff(req,'clinical.write');const {csv,...preview}=buildRecordExport(db,Object.fromEntries(url.searchParams),scopeFor(actor));return respond(res,200,preview);}
    if (path === '/api/export.csv' && method === 'GET') {const actor=legacyStaff(req,'clinical.write');return exportCsv(res,Object.fromEntries(url.searchParams),scopeFor(actor));}
    if (path.startsWith('/api/')) throw new HttpError(404, '지원하지 않는 API입니다.');
    if (!['GET', 'HEAD'].includes(method)) throw new HttpError(405, '지원하지 않는 요청 방식입니다.');
    staticFile(req, res, path);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('Request failed:', error.message);
    respond(res, status, { error: status === 500 ? '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' : error.message });
  }
});

server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.listen(port, '0.0.0.0', () => console.log(`HomeCare AI Demo running on http://0.0.0.0:${port} (SQLite, demo data)`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { server.close(() => { db.close(); process.exit(0); }); });
}
