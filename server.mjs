import http from 'node:http';
import { createReadStream, existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
ensureMedicationPhotoSchema(db);
ensureHealthSchema(db);
const auth = createAuthService({db});
ensureCommunicationSchema(db);
db.prepare("INSERT INTO metadata (key,value) VALUES ('schema_version','5') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
const port = Number(process.env.PORT || 3000);
const bodyLimit = 7 * 1024 * 1024;
const schemaVersion = 5;

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
  return { ok: true, status: 'ok', app: 'HomeCare AI Demo', schemaVersion, dataMode: 'demo', seedMode: db.prepare("SELECT value FROM metadata WHERE key='mode'").get()?.value ?? 'seed', today: todayKorea(), timezone: 'Asia/Seoul', storage: 'sqlite', counts, resetAt: db.prepare("SELECT value FROM metadata WHERE key='reset_at'").get()?.value ?? null, provenance };
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

function saveDaily(id, body) {
  requirePatient(id);
  const fields = ['date', 'steps', 'sleepHours', 'medicationStatus', 'appetite', 'mood', 'note', 'weightKg'];
  allowedKeys(body, fields);
  if (!Object.keys(body).some(k => k !== 'date')) throw new HttpError(400, '하나 이상의 기록 항목을 입력해 주세요.');
  const date = dateValue(body.date ?? todayKorea());
  const old = db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(id, date);
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
    medication_status=excluded.medication_status,appetite=excluded.appetite,mood=excluded.mood,note=excluded.note,weight_kg=excluded.weight_kg,updated_at=excluded.updated_at`)
    .run(old?.id ?? randomUUID(), id, date, value.steps, value.sleepHours, value.medicationStatus, value.appetite, value.mood, value.note, value.weightKg, old?.created_at ?? now, now);
  return recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(id, date));
}

function saveMeal(id, body) {
  requirePatient(id);
  allowedKeys(body, ['date', 'mealType', 'foodType', 'portion', 'imageData', 'analysisId', 'patientConfirmed']);
  const date = dateValue(body.date ?? todayKorea());
  const mealType = choice(body.mealType, '식사 종류', ['breakfast', 'lunch', 'dinner', 'snack']);
  const portion = choice(body.portion, '섭취 비율', [.25, .5, .75, 1]);
  const analysis = body.analysisId === undefined ? null : resolveMealAnalysis(db, { analysisId: body.analysisId, patientId: id, imageData: body.imageData, patientConfirmed: body.patientConfirmed });
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
  try {
    transaction(db, () => {
      db.prepare('INSERT INTO meals (id,patient_id,date,meal_type,food_type,portion,calories,protein_grams,image_filename,source,created_at,analysis_id,food_label,estimation_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(mealId, id, date, mealType, foodType, portion, Math.round(food.calories * portion), Math.round(food.proteinGrams * portion * 10) / 10, filename, analysis?.source ?? 'demo-food-table-v1', new Date().toISOString(), analysis?.analysisId ?? null, analysis?.foodLabel ?? null, analysis ? JSON.stringify(analysis.estimation) : null);
      if (analysis) markAnalysisApplied(db, analysis.analysisId, mealId);
    });
  } catch (error) { if (filename) unlinkSync(join(uploadDir, filename)); throw error; }
  return mealFromRow(db.prepare('SELECT * FROM meals WHERE id=?').get(mealId));
}

function exportCsv(res) {
  const columns = ['recordType', 'id', 'patientId', 'patientName', 'date', 'steps', 'sleepHours', 'medicationStatus', 'appetite', 'mood', 'note', 'weightKg', 'mealType', 'foodType', 'portion', 'calories', 'proteinGrams', 'source', 'createdAt', 'updatedAt', 'stepsSource', 'sleepSource', 'orderId', 'time', 'status', 'reason', 'revision', 'reportedAt', 'name', 'strength', 'dose', 'route', 'times', 'startDate', 'endDate', 'instructions', 'connectionId'];
  const names = new Map(getPatients(db).map(p => [p.id, p.name]));
  const rows = getPatients(db).flatMap(patient => effectiveRecords(db, patient.id, '1900-01-01', '2200-01-01')).map(r => ({ ...r, recordType: 'daily', patientName: names.get(r.patientId), source: r.dataOrigin }));
  rows.push(...db.prepare('SELECT * FROM meals ORDER BY date,patient_id,created_at').all().map(mealFromRow).map(m => ({ ...m, recordType: 'meal', patientName: names.get(m.patientId) })));
  rows.push(...db.prepare('SELECT * FROM medication_orders ORDER BY patient_id,created_at').all().map(row => ({ recordType: 'medication-order', id: row.id, patientId: row.patient_id, patientName: names.get(row.patient_id), name: row.name, strength: row.strength, dose: row.dose, route: row.route, times: JSON.parse(row.times).join('|'), startDate: row.start_date, endDate: row.end_date, instructions: row.instructions, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, source: 'clinician-entered-demo' })));
  rows.push(...db.prepare('SELECT * FROM medication_events ORDER BY date,patient_id,time').all().map(row => ({ recordType: 'medication', id: row.id, patientId: row.patient_id, patientName: names.get(row.patient_id), date: row.date, orderId: row.order_id, time: row.time, status: row.status, reason: row.reason, note: row.note, revision: row.revision, reportedAt: row.reported_at, source: 'patient-self-report' })));
  rows.push(...db.prepare('SELECT d.*,c.platform FROM health_daily d JOIN health_connections c ON c.id=d.connection_id ORDER BY d.date,d.patient_id').all().map(row => ({ recordType: 'health', patientId: row.patient_id, patientName: names.get(row.patient_id), date: row.date, steps: row.steps, sleepHours: row.sleep_minutes === null ? null : row.sleep_minutes / 60, updatedAt: row.updated_at, source: row.platform, connectionId: row.connection_id })));
  const body = '\ufeff' + [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="homecare-demo-${todayKorea()}.csv"`, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
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
      const result=auth.demoLogin(req,await readJson(req));return respond(res,200,{ok:true},{'Set-Cookie':result.cookie});
    }
    if(path==='/api/auth/logout' && method==='POST')return respond(res,200,{ok:true},{'Set-Cookie':auth.logout(req)});
    if(path==='/api/auth/enroll' && method==='POST')return respond(res,200,auth.enroll(req,await readJson(req)));
    const invite=/^\/api\/clinician\/patients\/([^/]+)\/invitations$/.exec(path);
    if(invite && method==='POST'){allowedKeys(await readJson(req),[]);return respond(res,201,{invitation:auth.issueInvitation(req,invite[1])});}
    if(path==='/api/clinician/notices') {
      const actor=auth.authorize(req,{staff:true,communication:true,write:method==='POST'});
      if(method==='GET')return respond(res,200,listNotices(db,actor));
      if(method==='POST')return respond(res,201,createNotice(db,actor,await readJson(req)));
    }
    const notice=/^\/api\/clinician\/notices\/([1-9]\d*)$/.exec(path);
    if(notice && method==='PATCH')return respond(res,200,updateNotice(db,auth.authorize(req,{staff:true,communication:true,write:true}),Number(notice[1]),await readJson(req)));
    if(path==='/api/notices/active' && method==='GET')return respond(res,200,activeNotices(db,auth.authorize(req,{communication:true})));
    const noticeRead=/^\/api\/notices\/([1-9]\d*)\/read$/.exec(path);
    if(noticeRead && method==='POST')return respond(res,200,readNotice(db,auth.authorize(req,{communication:true,write:true}),Number(noticeRead[1]),await readJson(req)));
    if(path==='/api/clinician/conversations' && method==='GET')return respond(res,200,conversations(db,auth.authorize(req,{staff:true,communication:true})));
    const messages=/^\/api\/patients\/([^/]+)\/messages(\/read)?$/.exec(path);
    if(messages) {
      const actor=auth.authorize(req,{patientId:messages[1],communication:true,write:method==='POST'});
      if(!messages[2] && method==='GET')return respond(res,200,listMessages(db,actor,messages[1],Object.fromEntries(url.searchParams)));
      if(!messages[2] && method==='POST')return respond(res,201,sendMessage(db,actor,messages[1],await readJson(req)));
      if(messages[2] && method==='POST')return respond(res,200,readMessages(db,actor,messages[1],await readJson(req)));
    }
    if (path === '/api/health' && method === 'GET') return respond(res, 200, auth.capabilities().mode==='kakao'?{ok:true,status:'ok',storage:'sqlite',schemaVersion}:health());
    if (path === '/api/capabilities' && method === 'GET') return respond(res, 200, {
      auth: auth.capabilities(),
      vision: visionCapabilities(process.env),
      health: healthCapabilities(),
      medications: { perDose: true, clinicianPlans: true },
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
    if (path === '/api/dashboard' && method === 'GET') {auth.authorize(req,{staff:true});return respond(res,200,dashboard(db));}
    if (path === '/api/patients' && method === 'GET') {const actor=auth.authorize(req);const patients=getPatients(db);return respond(res,200,{patients:auth.capabilities().mode==='kakao' && actor.role!=='clinician'?patients.filter(p=>p.id===actor.patientId):patients,today:todayKorea(),provenance});}
    if (path === '/api/patients' && method === 'POST') {auth.authorize(req,{staff:true,write:true});return respond(res,201,{patient:createPatient(await readJson(req))});}
    let match = /^\/api\/patients\/([^/]+)\/(medication-orders|medication-schedule|medication-events|medication-photo-reports|photo-analyses|health-connections)$/.exec(path);
    if (match) {
      const [, id, operation] = match;
      auth.authorize(req,{patientId:id,write:method==='POST'});
      if(operation==='medication-orders' && method==='POST')auth.authorize(req,{staff:true,write:true});
      requirePatient(id);
      if (operation === 'medication-orders' && method === 'GET') return respond(res, 200, { orders: getMedicationOrders(db, id) });
      if (operation === 'medication-orders' && method === 'POST') return respond(res, 201, { order: createMedicationOrder(db, id, await readJson(req)) });
      if (operation === 'medication-schedule' && method === 'GET') return respond(res, 200, medicationSchedule(db, id, dateValue(url.searchParams.get('date') ?? todayKorea())));
      if (operation === 'medication-events' && method === 'GET') return respond(res, 200, { ...getMedicationEvents(db, id, dateValue(url.searchParams.get('date') ?? todayKorea())), photoReports: getMedicationPhotoReports(db, id, url.searchParams.get('date') ?? todayKorea()).reports });
      if (operation === 'medication-events' && method === 'POST') return respond(res, 200, { event: saveMedicationEvent(db, id, await readJson(req)) });
      if (operation === 'medication-photo-reports' && method === 'GET') return respond(res, 200, getMedicationPhotoReports(db, id, url.searchParams.get('date') ?? todayKorea()));
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
    if (match && method === 'PATCH') {auth.authorize(req,{staff:true,write:true});return respond(res,200,{order:endMedicationOrder(db,match[1],await readJson(req))});}
    match = /^\/api\/patients\/([^/]+)\/health-connections\/([^/]+)$/.exec(path);
    if (match && method === 'DELETE') {
      auth.authorize(req,{patientId:match[1],write:true});
      requirePatient(match[1]);
      return respond(res, 200, revokeHealthConnection(db, match[1], match[2]));
    }
    match = /^\/api\/patients\/([^/]+)(?:\/(summary|daily|meals))?$/.exec(path);
    if (match) {
      const [, id, operation] = match;
      auth.authorize(req,{patientId:id,write:method==='POST'});
      requirePatient(id);
      if (!operation && method === 'GET') return respond(res, 200, { patient: getPatient(db, id) });
      if (operation === 'summary' && method === 'GET') return respond(res, 200, patientSummary(db, id));
      if (operation === 'daily' && method === 'GET') {
        const date = dateValue(url.searchParams.get('date') ?? todayKorea());
        return respond(res, 200, { record: recordFromRow(db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date=?').get(id, date)) });
      }
      if (operation === 'daily' && method === 'POST') return respond(res, 200, { record: saveDaily(id, await readJson(req)) });
      if (operation === 'meals' && method === 'POST') return respond(res, 201, { meal: saveMeal(id, await readJson(req)) });
    }
    match = /^\/api\/meals\/([^/]+)$/.exec(path);
    if (match && method === 'DELETE') {
      auth.authorize(req,{write:true});
      const meal = db.prepare('SELECT * FROM meals WHERE id=?').get(match[1]);
      if (!meal) throw new HttpError(404, '식사 기록을 찾을 수 없습니다.');
      auth.authorize(req,{patientId:meal.patient_id,write:true});
      db.prepare('DELETE FROM meals WHERE id=?').run(meal.id);
      if (meal.image_filename) { try { unlinkSync(join(uploadDir, meal.image_filename)); } catch (error) { if (error.code !== 'ENOENT') console.error('Upload cleanup failed:', error.code); } }
      return respond(res, 200, { ok: true, deletedId: meal.id });
    }
    if (path === '/api/demo/reset' && method === 'POST') {
      auth.authorize(req,{staff:true,write:true});
      const body = await readJson(req);
      allowedKeys(body, ['mode', 'confirmation']);
      if (body.confirmation !== 'RESET') throw new HttpError(400, '리셋하려면 confirmation: RESET을 입력해 주세요.');
      const mode = choice(body.mode ?? 'seed', '리셋 종류', ['seed', 'empty']);
      resetDemo(db, uploadDir, mode);
      return respond(res, 200, { ok: true, mode, ...health() });
    }
    if (path === '/api/export.csv' && method === 'GET') {auth.authorize(req,{staff:true});return exportCsv(res);}
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
