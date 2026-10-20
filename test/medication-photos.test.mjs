import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, todayKorea } from '../lib/db.mjs';
import { ensureVisionSchema, analyzePhoto } from '../lib/vision.mjs';
import { ensureMedicationSchema, createMedicationOrder, saveMedicationEvent, getMedicationEvents } from '../lib/medications.mjs';
import { ensureMedicationPhotoSchema, saveMedicationPhotoReport, getMedicationPhotoReports, getMedicationPhotoImage } from '../lib/medication-photos.mjs';
import { resetDemo } from '../lib/reset.mjs';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WlEAAAAASUVORK5CYII=';
const env = { VISION_ENABLED: 'true', HOMECARE_VISION_API_KEY: 'test-fixture-never-real' };
const proposal = { medications: [{ name: '테스트약', strength: '5mg', labelText: '테스트약 5mg' }], confidence: .7 };
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(),'hc-med-photo-test-'));
  const { db, uploadDir } = openDatabase(dir);
  t.after(() => { db.close(); rmSync(dir,{recursive:true,force:true}); });
  ensureMedicationSchema(db); ensureVisionSchema(db); ensureMedicationPhotoSchema(db);
  const date = todayKorea();
  const order = createMedicationOrder(db,'p001',{name:'테스트약',strength:'5mg',dose:'1정',times:['08:00','20:00'],startDate:date});
  const { analysis } = await analyzePhoto({ db, patientId:'p001', body:{kind:'medication',imageData:png,consentExternalProcessing:true},env,
    fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]})) });
  const body = { clientSubmissionId:randomUUID(),analysisId:analysis.id,imageData:png,date,patientConfirmed:true,
    slots:['08:00','20:00'].map(time=>({orderId:order.id,time,status:time==='08:00'?'taken':'unknown',expectedRevision:0})) };
  return {db,uploadDir,dir,date,order,analysis,body};
}
const rejects = (code, action) => assert.throws(action,error=>error.status===code);
test('photo report atomically saves multiple self reports, immutable evidence and idempotent retries',async t=>{
  const {db,body,order,date}=await setup(t);
  const result=saveMedicationPhotoReport(db,'p001',body);
  assert.equal(result.report.source,'patient-self-report-with-photo');assert.equal(result.report.reviewStatus,'unreviewed');
  assert.equal(result.report.events.length,2);assert.equal(result.report.analysis.source,'openai-package-text-v1');
  assert.equal(getMedicationEvents(db,'p001',date).audit.length,2);
  assert.deepEqual(getMedicationPhotoImage(db,'p001',result.report.id).buffer,Buffer.from(png.split(',')[1],'base64'));
  saveMedicationEvent(db,'p001',{orderId:order.id,date,time:'08:00',status:'missed'});
  const replay=saveMedicationPhotoReport(db,'p001',body);
  assert.equal(replay.replayed,true);assert.equal(replay.report.id,result.report.id);
  assert.equal(replay.report.events.find(e=>e.time==='08:00').status,'taken');
  assert.equal(getMedicationEvents(db,'p001',date).events.find(e=>e.time==='08:00').status,'missed');
  assert.equal(getMedicationPhotoReports(db,'p001',date).reports.length,1);
  rejects(409,()=>saveMedicationPhotoReport(db,'p001',{...body,slots:[{...body.slots[0],status:'missed'}]}));
});
test('photo draft is bound to patient, image, medication kind and expiry',async t=>{
  const {db,body}=await setup(t);
  rejects(404,()=>saveMedicationPhotoReport(db,'p002',body));
  const another='data:image/png;base64,'+Buffer.concat([Buffer.from(png.split(',')[1],'base64'),Buffer.from('different')]).toString('base64');
  rejects(409,()=>saveMedicationPhotoReport(db,'p001',{...body,imageData:another}));
  db.prepare("UPDATE photo_analyses SET kind='meal' WHERE id=?").run(body.analysisId);
  rejects(400,()=>saveMedicationPhotoReport(db,'p001',body));
  db.prepare("UPDATE photo_analyses SET kind='medication',expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(body.analysisId);
  rejects(409,()=>saveMedicationPhotoReport(db,'p001',body));
  assert.equal(db.prepare('SELECT count(*) n FROM medication_events').get().n,0);
});
test('unconfirmed, duplicate, invalid and foreign slots cannot create partial records',async t=>{
  const {db,body,date}=await setup(t);
  const foreign=createMedicationOrder(db,'p002',{name:'다른환자약',dose:'1정',times:['08:00'],startDate:date});
  const bad=[{patientConfirmed:false},{clientSubmissionId:'bad'},{slots:[]},{slots:[...body.slots,body.slots[0]]},
    {slots:[body.slots[0],{...body.slots[1],orderId:foreign.id}]},{slots:[body.slots[0],{...body.slots[1],time:'21:00'}]},
    {slots:[{...body.slots[0],status:'pending'}]},{slots:[{...body.slots[0],expectedRevision:-1}]},
    {slots:[{...body.slots[0],expectedRevision:0.5}]},{date:'2200-01-01'},{slots:[{...body.slots[0],dose:'2정'}]}];
  for(const fields of bad)rejects(400,()=>saveMedicationPhotoReport(db,'p001',{...body,...fields}));
  assert.equal(db.prepare('SELECT count(*) n FROM medication_events').get().n,0);
  assert.equal(getMedicationPhotoReports(db,'p001',date).reports.length,0);
});
test('optimistic revision conflict preserves existing record and rejects all selected slots',async t=>{
  const {db,body,order,date}=await setup(t);
  saveMedicationEvent(db,'p001',{orderId:order.id,date,time:'20:00',status:'missed',note:'다른 창'});
  rejects(409,()=>saveMedicationPhotoReport(db,'p001',body));
  const events=getMedicationEvents(db,'p001',date);
  assert.equal(events.events.length,1);assert.equal(events.events[0].note,'다른 창');assert.equal(events.audit.length,1);
  assert.equal(getMedicationPhotoReports(db,'p001',date).reports.length,0);
});
test('database failure on second attachment rolls back first event, audit and image BLOB',async t=>{
  const {db,body,date}=await setup(t);
  db.exec(`CREATE TRIGGER fail_second_photo BEFORE INSERT ON medication_photo_report_events
    WHEN (SELECT COUNT(*) FROM medication_photo_report_events)>0 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
  assert.throws(()=>saveMedicationPhotoReport(db,'p001',body),/fixture failure/);
  assert.equal(getMedicationEvents(db,'p001',date).events.length,0);assert.equal(getMedicationEvents(db,'p001',date).audit.length,0);
  assert.equal(getMedicationPhotoReports(db,'p001',date).reports.length,0);
});
test('additive migration is repeatable and reset cascades photo evidence without deleting legacy first',async t=>{
  const {db,body,uploadDir,date}=await setup(t);
  const old=db.prepare('SELECT count(*) n FROM meals').get().n;
  ensureMedicationPhotoSchema(db);ensureMedicationPhotoSchema(db);
  assert.equal(db.prepare('SELECT count(*) n FROM meals').get().n,old);
  const {report}=saveMedicationPhotoReport(db,'p001',body);
  rejects(404,()=>getMedicationPhotoImage(db,'p002',report.id));
  resetDemo(db,uploadDir,'seed');
  assert.equal(db.prepare('SELECT count(*) n FROM medication_photo_reports').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM medication_photo_report_events').get().n,0);
  rejects(404,()=>saveMedicationPhotoReport(db,'p001',body));
  assert.equal(getMedicationPhotoReports(db,'p001',date).reports.length,0);
});
