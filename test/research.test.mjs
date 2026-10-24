import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { dateOffset, todayKorea } from '../lib/db.mjs';
import { dashboard, patientSummary } from '../lib/analysis.mjs';
import { ensureMedicationSchema, createMedicationOrder, saveMedicationEvent } from '../lib/medications.mjs';
import { ensureHealthSchema, createHealthConnection, receiveHealthBatch } from '../lib/health-sync.mjs';
import { createResearchSnapshot, describeNumbers, ensureResearchSchema, exportResearchSnapshot, getResearchSnapshot, researchPreview } from '../lib/research.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE patients(id TEXT PRIMARY KEY,name TEXT NOT NULL,age INTEGER,sex TEXT,conditions TEXT DEFAULT '[]',medications TEXT DEFAULT '[]',caregiver TEXT DEFAULT '',created_at TEXT,demo INTEGER DEFAULT 1);
    CREATE TABLE daily_records(id TEXT PRIMARY KEY,patient_id TEXT REFERENCES patients(id),date TEXT,steps INTEGER,sleep_hours REAL,medication_status TEXT,appetite TEXT,mood TEXT,note TEXT DEFAULT '',weight_kg REAL,created_at TEXT,updated_at TEXT,UNIQUE(patient_id,date));
    CREATE TABLE meals(id TEXT PRIMARY KEY,patient_id TEXT REFERENCES patients(id),date TEXT,meal_type TEXT,food_type TEXT,portion REAL,calories REAL,protein_grams REAL,image_filename TEXT,source TEXT,created_at TEXT);
    INSERT INTO metadata VALUES ('generation','fixture-generation');`);
  ensureMedicationSchema(db);
  ensureHealthSchema(db);
  ensureResearchSchema(db);
  const now = new Date().toISOString();
  for (const [id, name] of [['a','Private Patient ALPHA'],['b','Private Patient BETA']]) db.prepare('INSERT INTO patients(id,name,age,sex,created_at) VALUES (?,?,75,\'female\',?)').run(id,name,now);
  const dates = [-2,-1,0].map(offset => dateOffset(todayKorea(), offset));
  const options = { startDate: dates[0], endDate: dates[2], patientIds: ['a','b'], source: 'all' };
  function daily(id,date,values={}) {
    db.prepare(`INSERT INTO daily_records(id,patient_id,date,steps,sleep_hours,medication_status,weight_kg,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'PRIVATE_NOTE',?,?)`).run(randomUUID(),id,date,values.steps??null,values.sleepHours??null,values.medicationStatus??null,values.weightKg??null,now,now);
  }
  function meal(id,date,{calories,proteinGrams,portion=1,source='demo-food-table-v1'}={}) {
    db.prepare('INSERT INTO meals(id,patient_id,date,meal_type,food_type,portion,calories,protein_grams,source,created_at) VALUES (?,?,?,\'lunch\',\'balanced\',?,?,?,?,?)').run(randomUUID(),id,date,portion,calories??null,proteinGrams??null,source,now);
  }
  function order(id='a',times=['08:00']) { return createMedicationOrder(db,id,{name:'Private drug',dose:'1정',times,startDate:dates[0]}); }
  function report(plan,date,status,time='08:00') { return saveMedicationEvent(db,plan.patientId,{orderId:plan.id,date,time,status}); }
  return {db,dates,options,daily,meal,order,report};
}

test('descriptive statistics use sample SD, type7 quantiles and retain explicit zero', () => {
  assert.deepEqual(describeNumbers([null,0,10,20,undefined]), {count:3,mean:10,sd:10,median:10,q1:5,q3:15,iqr:10,min:0,max:20});
  assert.equal(describeNumbers([8]).sd,null);
  assert.equal(describeNumbers([]).mean,null);
  assert.deepEqual(describeNumbers([1,2,3,4]),{count:4,mean:2.5,sd:1.290994,median:2.5,q1:1.75,q3:3.25,iqr:1.5,min:1,max:4});
});

test('cohort separates patient N, observed rows and equal-patient versus observation weighting', t => {
  const f=fixture(t);
  f.daily('a',f.dates[0],{steps:0});f.daily('a',f.dates[1],{steps:10});f.daily('b',f.dates[0],{steps:20});
  const result=researchPreview(f.db,f.options);
  assert.equal(result.summary.patientCount,2);
  assert.equal(result.summary.plannedPatientDays,6);
  assert.equal(result.summary.reportedPatientDays,3);
  assert.equal(result.summary.coveragePercent,50);
  assert.equal(result.metrics.steps.observationCount,3);
  assert.equal(result.metrics.steps.patientCount,2);
  assert.equal(result.metrics.steps.missingPatientDays,3);
  assert.equal(result.metrics.steps.pooled.mean,10);
  assert.equal(result.metrics.steps.patientMeans.mean,12.5);
  assert.equal(result.metrics.steps.patientMeans.sd,10.606602);
  assert.equal(result.metrics.sleepHours.pooled.mean,null);
  assert.deepEqual(result.metrics.steps.sourceCounts,{'patient-self-report':3});
  assert.ok(result.participants.every(p=>/^P-[0-9a-f]{20}$/.test(p.participantId)));
  assert.equal(result.quality.participationPolicyApplied,false);
});

test('unknown meal quantities never become zero nutrition and known zero remains observed', t => {
  const f=fixture(t);
  f.meal('a',f.dates[0],{portion:null});
  let result=patientSummary(f.db,'a');
  assert.equal(result.metrics.nutrition.value,null);
  assert.equal(result.metrics.nutrition.unknownMealCount,1);
  assert.equal(result.trends.find(r=>r.date===f.dates[0]).calories,null);
  assert.equal(result.metrics.completion.reportedDays,1);
  f.meal('a',f.dates[0],{calories:100,proteinGrams:5});
  f.meal('a',f.dates[1],{portion:0,calories:0,proteinGrams:0});
  result=researchPreview(f.db,f.options);
  assert.equal(result.quality.unknownMealCount,1);
  assert.equal(result.quality.knownMealCount,2);
  assert.equal(result.metrics.calories.observationCount,2);
  assert.equal(result.metrics.calories.pooled.mean,50);
  assert.equal(result.metrics.calories.pooled.min,0);
  const summary=patientSummary(f.db,'a');
  assert.equal(summary.metrics.nutrition.value,50);
  assert.equal(summary.metrics.nutrition.estimatedDays,2);
});

test('dose-only reports contribute participation, latest date and dashboard without creating legacy scores', t => {
  const f=fixture(t);const plan=f.order();f.report(plan,f.dates[2],'unknown');
  const result=patientSummary(f.db,'a');
  assert.equal(result.metrics.completion.reportedDays,1);
  assert.equal(result.metrics.completion.totalDays,7);
  assert.equal(result.lastRecordDate,f.dates[2]);
  assert.equal(result.metrics.medication.value,null);
  assert.equal(result.metrics.medication.doseReportedDays,1);
  assert.equal(result.trends.at(-1).hasDoseReport,true);
  const board=dashboard(f.db);
  assert.equal(board.stats.reportedToday,1);
  assert.equal(board.trends.at(-1).reportingPatients,1);
  assert.equal(dashboard(f.db,{patientIds:['b']}).stats.reportedToday,0);
  assert.equal(dashboard(f.db,{},['b']).stats.reportedToday,0);
  assert.equal(dashboard(f.db,{},[]).stats.patients,0);
  assert.equal(dashboard(f.db,{},['b']).patients.length,1);
});

test('explicit period aligns metrics and full trends while review thresholds keep seven-day scope', t => {
  const f=fixture(t);
  f.daily('a',dateOffset(f.dates[0],-10),{steps:100,medicationStatus:'missed'});
  f.daily('a',dateOffset(f.dates[0],-9),{steps:200,medicationStatus:'missed'});
  f.daily('a',f.dates[1],{steps:900});
  const result=patientSummary(f.db,'a',{startDate:f.dates[0],endDate:f.dates[2]});
  assert.equal(result.period.totalDays,3);assert.equal(result.trends.length,3);
  assert.equal(result.metrics.steps.value,900);assert.equal(result.recentRecords.length,1);
  assert.equal(result.metrics.completion.totalDays,3);
  assert.equal(result.risk.period.totalDays,7);
  assert.deepEqual(result.risk.reasons,[]);
  const long=patientSummary(f.db,'a',{startDate:dateOffset(f.dates[0],-12),endDate:f.dates[2]});
  assert.equal(long.metrics.medication.missedDays,2);
  assert.deepEqual(long.risk.reasons,[]);
  assert.throws(()=>patientSummary(f.db,'a',{startDate:f.dates[2],endDate:f.dates[0]}),e=>e.status===400);
  assert.throws(()=>researchPreview(f.db,{...f.options,endDate:dateOffset(f.dates[2],1)}),e=>e.status===400);
});

test('past dashboard counts its reference date without mislabeling it as today', t => {
  const f=fixture(t);const plan=f.order();
  f.report(plan,f.dates[1],'unknown');
  f.daily('b',dateOffset(f.dates[0],-1),{steps:400});
  f.daily('b',f.dates[2],{steps:1000});
  const options={startDate:f.dates[0],endDate:f.dates[1]};
  const board=dashboard(f.db,options);
  assert.equal(board.referenceDate,f.dates[1]);
  assert.equal(board.stats.reportedAtReferenceDate,1);
  assert.equal(board.stats.reportedToday,null);
  assert.equal(board.trends.at(-1).reportingPatients,1);
  assert.equal(board.patients.find(p=>p.id==='b').lastRecordDate,dateOffset(f.dates[0],-1));
  assert.equal(board.patients.find(p=>p.id==='b').metrics.completion.reportedDays,0);
  assert.match(board.patients.find(p=>p.id==='b').lastRecordDateMeaning,/선택 기간 이전/);
  assert.equal(dashboard(f.db,options,['b']).stats.reportedAtReferenceDate,0);
  assert.equal(dashboard(f.db).stats.reportedToday,1);
  assert.equal(dashboard(f.db).stats.reportedAtReferenceDate,1);
});

test('device source filter preserves manual precedence and source-specific missing observations', t => {
  const f=fixture(t);
  const connection=createHealthConnection(f.db,'a',{platform:'apple-health',label:'Fixture device'});
  receiveHealthBatch(f.db,connection.token,{batchId:randomUUID(),timeZone:'Asia/Seoul',days:[
    {date:f.dates[0],steps:500,sleepMinutes:420,updatedAt:new Date().toISOString()},
    {date:f.dates[1],steps:600,sleepMinutes:480,updatedAt:new Date().toISOString()},
  ]});
  f.daily('a',f.dates[0],{steps:0});
  const result=researchPreview(f.db,{...f.options,source:'apple-health'});
  assert.equal(result.metrics.steps.pooled.mean,600);
  assert.equal(result.metrics.steps.observationCount,1);
  assert.equal(result.metrics.sleepHours.pooled.mean,7.5);
  assert.equal(result.metrics.sleepHours.observationCount,2);
  assert.equal(result.quality.mealCount,0);
  const manual=researchPreview(f.db,{...f.options,source:'patient-self-report'});
  assert.equal(manual.metrics.steps.pooled.mean,0);
  assert.equal(manual.metrics.sleepHours.pooled.mean,null);
});

test('dose denominators distinguish pending and unknown from missed using final revisions', t => {
  const f=fixture(t);const plan=f.order('a',['08:00','20:00']);
  f.report(plan,f.dates[0],'taken');f.report(plan,f.dates[0],'unknown','20:00');
  f.report(plan,f.dates[1],'missed');f.report(plan,f.dates[1],'taken');
  const result=researchPreview(f.db,{...f.options,endDate:f.dates[1]});
  assert.equal(result.medication.plannedDueSlots,4);
  assert.equal(result.medication.reportedSlots,3);
  assert.equal(result.medication.takenSlots,2);
  assert.equal(result.medication.missedSlots,0);
  assert.equal(result.medication.unknownSlots,1);
  assert.equal(result.medication.pendingSlots,1);
  assert.equal(result.medication.reportPercent,75);
  assert.equal(result.medication.takenPerPlannedPercent,50);
  assert.equal(result.medication.takenOfKnownPercent,100);
  assert.equal(researchPreview(f.db,{...f.options,patientIds:['b']}).medication.reportPercent,null);
});

test('future time reports are separate from due-dose denominators at a fixed Korea clock', t => {
  t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,23,3,0)}); // Korea noon.
  const f=fixture(t);const plan=f.order('a',['08:00','20:00']);
  f.report(plan,f.dates[2],'unknown','08:00');
  f.report(plan,f.dates[2],'taken','20:00');
  const result=researchPreview(f.db,{...f.options,startDate:f.dates[2],patientIds:['a']});
  assert.equal(result.medication.plannedDueSlots,1);
  assert.equal(result.medication.reportedSlots,1);
  assert.equal(result.medication.unknownSlots,1);
  assert.equal(result.medication.takenSlots,0);
  assert.equal(result.medication.notYetDueReportSlots,1);
  assert.equal(result.medication.takenPerPlannedPercent,0);
  assert.equal(result.medication.takenOfKnownPercent,null);
  assert.equal(result.summary.reportedPatientDays,1);
});

test('future imported records never become current latest record or descriptive observations', t => {
  const f=fixture(t);const today=f.dates[2];const tomorrow=dateOffset(today,1);
  f.daily('a',today,{steps:500});f.daily('a',tomorrow,{steps:99999});
  f.meal('a',tomorrow,{calories:5000,proteinGrams:100});
  const plan=f.order();
  f.db.prepare('INSERT INTO medication_events(id,patient_id,order_id,date,time,status,revision,reported_at,created_at) VALUES (?,?,?,?,?,\'taken\',1,?,?)')
    .run(randomUUID(),'a',plan.id,tomorrow,'08:00',new Date().toISOString(),new Date().toISOString());
  const summary=patientSummary(f.db,'a');
  assert.equal(summary.lastRecordDate,today);
  assert.equal(summary.metrics.steps.value,500);
  assert.equal(summary.metrics.medication.doseReportedSlots,0);
  assert.equal(summary.metrics.nutrition.value,null);
  assert.ok(summary.recentRecords.every(row=>row.date<=today));
  assert.ok(summary.recentMeals.every(row=>row.date<=today));
  const research=researchPreview(f.db,f.options);
  assert.equal(research.metrics.steps.pooled.mean,500);
  assert.equal(research.quality.mealCount,0);
  assert.equal(research.medication.totalReportSlots,0);
});

test('snapshots freeze pseudonymous data, retry idempotently and export a verifiable manifest', t => {
  const f=fixture(t);f.daily('a',f.dates[0],{steps:0});
  const request={...f.options,clientRequestId:randomUUID()};
  const first=createResearchSnapshot(f.db,request,{accountId:'test-researcher'},['a','b']);
  f.db.prepare('UPDATE daily_records SET steps=9876 WHERE patient_id=?').run('a');
  const reread=getResearchSnapshot(f.db,first.id,['a','b']);
  assert.equal(reread.result.metrics.steps.pooled.mean,0);
  assert.equal(researchPreview(f.db,f.options).metrics.steps.pooled.mean,9876);
  assert.equal(createResearchSnapshot(f.db,request,{accountId:'test-researcher'},['a','b']).id,first.id);
  assert.equal(createResearchSnapshot(f.db,request,{accountId:'test-researcher'},['a','b']).duplicate,true);
  assert.throws(()=>createResearchSnapshot(f.db,{...request,source:'apple-health'},'test-researcher'),e=>e.status===409);
  const exported=exportResearchSnapshot(f.db,first.id,['a','b']);
  assert.equal(exported.manifest.rowCount,6);
  assert.equal(exported.manifest.patientCount,2);
  assert.equal(exported.manifest.csvSha256,createHash('sha256').update(exported.csv).digest('hex'));
  assert.doesNotMatch(exported.csv,/Private|PRIVATE_NOTE|patientName|patientId|Private drug/);
  assert.equal(exported.columns.length,exported.manifest.columnDefinitions.length);
  assert.match(exported.csv,/"0","patient-self-report"/);
  assert.throws(()=>f.db.prepare('UPDATE research_snapshots SET created_at=? WHERE id=?').run('invalid',first.id),/immutable/);
});

test('snapshot saves only the reviewed preview and stale hashes leave no row, while retry preserves the original', t => {
  const f=fixture(t);f.daily('a',f.dates[0],{steps:0});
  const preview=researchPreview(f.db,f.options);
  const request={...f.options,clientRequestId:randomUUID(),expectedInputHash:preview.inputHash};
  f.db.prepare('UPDATE daily_records SET steps=100 WHERE patient_id=?').run('a');
  assert.throws(()=>createResearchSnapshot(f.db,request,'actor'),e=>e.status===409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM research_snapshots').get().n,0);
  const current=researchPreview(f.db,f.options);
  const reviewedRequest={...request,expectedInputHash:current.inputHash};
  const snapshot=createResearchSnapshot(f.db,reviewedRequest,'actor');
  assert.equal(snapshot.contentHash,current.inputHash);
  assert.equal(snapshot.result.metrics.steps.pooled.mean,100);
  f.db.prepare('UPDATE daily_records SET steps=200 WHERE patient_id=?').run('a');
  assert.equal(createResearchSnapshot(f.db,reviewedRequest,'actor').id,snapshot.id);
  assert.equal(createResearchSnapshot(f.db,reviewedRequest,'actor').duplicate,true);
  assert.throws(()=>createResearchSnapshot(f.db,{...reviewedRequest,expectedInputHash:researchPreview(f.db,f.options).inputHash},'actor'),e=>e.status===409);
  assert.throws(()=>createResearchSnapshot(f.db,{...request,clientRequestId:randomUUID(),expectedInputHash:'bad-hash'},'actor'),e=>e.status===400);
});

test('current patient scope is checked for creation, read and export including after assignment removal', t => {
  const f=fixture(t);
  assert.throws(()=>researchPreview(f.db,f.options,['a']),e=>e.status===403);
  assert.equal(researchPreview(f.db,{startDate:f.dates[0],endDate:f.dates[2]},['a']).summary.patientCount,1);
  assert.equal(researchPreview(f.db,{startDate:f.dates[0],endDate:f.dates[2]},[]).summary.patientCount,0);
  assert.throws(()=>researchPreview(f.db,f.options,[]),e=>e.status===403);
});

test('empty cohorts and reset generations do not fabricate percentages or reuse pseudonyms', t => {
  const f=fixture(t);
  const empty=researchPreview(f.db,{...f.options,patientIds:[]});
  assert.equal(empty.summary.patientCount,0);assert.equal(empty.summary.coveragePercent,null);
  assert.throws(()=>createResearchSnapshot(f.db,{...f.options,patientIds:[],clientRequestId:randomUUID()},'actor'),e=>e.status===400);
  const snapshot=createResearchSnapshot(f.db,{...f.options,clientRequestId:randomUUID()},'actor');
  assert.throws(()=>getResearchSnapshot(f.db,snapshot.id,['a']),e=>e.status===403);
  assert.throws(()=>exportResearchSnapshot(f.db,snapshot.id,['b']),e=>e.status===403);
  const before=researchPreview(f.db,f.options).participants.map(p=>p.participantId);
  const secret=f.db.prepare("SELECT value FROM metadata WHERE key='research_pseudonym_secret'").get().value;
  ensureResearchSchema(f.db);
  assert.equal(f.db.prepare("SELECT value FROM metadata WHERE key='research_pseudonym_secret'").get().value,secret);
  f.db.prepare("UPDATE metadata SET value=? WHERE key='generation'").run('new-generation');
  assert.notDeepEqual(researchPreview(f.db,f.options).participants.map(p=>p.participantId),before);
  assert.throws(()=>getResearchSnapshot(f.db,snapshot.id),e=>e.status===404);
});
