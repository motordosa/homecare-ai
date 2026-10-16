import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dateOffset, openDatabase, todayKorea } from '../lib/db.mjs';
import { patientSummary } from '../lib/analysis.mjs';
import {
  createMedicationOrder, ensureMedicationSchema, medicationSchedule, saveMedicationEvent,
} from '../lib/medications.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'homecare-analysis-test-'));
  const { db } = openDatabase(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  ensureMedicationSchema(db);

  // A new patient prevents the demo seed's clinical history from supplying
  // coverage or changing the meaning of this test's deliberately missing data.
  const patientId = 'analysis-patient';
  const now = new Date().toISOString();
  db.prepare('INSERT INTO patients (id,name,age,sex,created_at) VALUES (?,?,?,?,?)')
    .run(patientId, '분석 회귀용 가상 환자', 75, 'female', now);
  const today = todayKorea();
  const dates = [-2, -1, 0].map(offset => dateOffset(today, offset));

  function daily(date, { steps = 6000, sleepHours = null, medicationStatus = null } = {}) {
    db.prepare(`INSERT INTO daily_records
      (id,patient_id,date,steps,sleep_hours,medication_status,appetite,mood,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'good','good',?,?)`)
      .run(`daily-${patientId}-${date}`, patientId, date, steps, sleepHours, medicationStatus, now, now);
  }

  function order(times = ['08:00']) {
    return createMedicationOrder(db, patientId, {
      name: '분석 회귀용 확인 약', dose: '1정', times, startDate: dates[0],
    });
  }

  function report(plan, date, status, time = '08:00') {
    return saveMedicationEvent(db, patientId, { orderId: plan.id, date, time, status });
  }

  return { db, patientId, dates, daily, order, report, summary: () => patientSummary(db, patientId) };
}

test('CHG-05 activity alone cannot make unobserved sleep and medication look stable', t => {
  const f = fixture(t);
  for (const date of f.dates) f.daily(date);

  const result = f.summary();
  assert.equal(result.metrics.steps.coverageDays, 3);
  assert.equal(result.metrics.sleepHours.value, null);
  assert.equal(result.metrics.medication.value, null);
  assert.equal(result.risk.level, 'insufficient');
  assert.equal(result.risk.missingData, true);
  assert.deepEqual(result.risk.missingDomains, ['sleep', 'medication']);
  assert.deepEqual(result.risk.reasons, []);
  assert.match(result.briefing.items.find(item => item.domain === 'quality').text, /부족한 영역:.*수면.*복약/);
  assert.doesNotMatch(result.briefing.headline, /안정/);
});

test('CHG-05 three known dose-report days support coverage without fabricating a legacy daily score', t => {
  const f = fixture(t);
  const plan = f.order();
  for (const date of f.dates) {
    f.daily(date, { sleepHours: 8 });
    f.report(plan, date, 'taken');
  }

  const result = f.summary();
  assert.equal(result.risk.level, 'stable');
  assert.equal(result.risk.label, '규칙 미해당');
  assert.equal(result.risk.missingData, false);
  assert.deepEqual(result.risk.missingDomains, []);
  assert.equal(result.metrics.medication.value, null);
  assert.equal(result.metrics.medication.reportedDays, 0);
  assert.equal(result.metrics.medication.doseReportedDays, 3);
  assert.equal(result.metrics.medication.doseReportedSlots, 3);
  assert.ok(result.recentRecords.every(record => record.medicationStatus === null));

  const medication = result.briefing.items.find(item => item.domain === 'medication');
  assert.match(medication.title, /일일.*약별 회차.*별도/);
  assert.match(medication.text, /기존 일일 복약 자기보고는 없습니다/);
  assert.match(medication.text, /약별 회차 보고는 3일 3건/);
  assert.match(medication.text, /실제 복용을 증명하지 않습니다/);
});

test('CHG-05 duplicated missed reports count distinct days while the legacy score keeps its own denominator', t => {
  const f = fixture(t);
  const plan = f.order(['08:00', '20:00']);
  f.daily(f.dates[0], { sleepHours: 8, medicationStatus: 'missed' });
  f.daily(f.dates[1], { sleepHours: 8, medicationStatus: 'taken' });
  f.daily(f.dates[2], { sleepHours: 8, medicationStatus: 'partial' });
  f.report(plan, f.dates[0], 'missed', '08:00');
  f.report(plan, f.dates[0], 'missed', '20:00');

  // One missed day reported in both systems, with two missed doses, is still
  // one day. Repetition must not by itself trigger the two-day review rule.
  const first = f.summary();
  assert.equal(first.risk.level, 'stable');
  assert.deepEqual(first.risk.reasons, []);
  assert.equal(first.metrics.medication.value, 50);

  f.report(plan, f.dates[1], 'missed');
  const result = f.summary();
  assert.equal(result.risk.level, 'watch');
  assert.equal(result.risk.missingData, false);
  assert.equal(result.risk.reasons.length, 1);
  assert.match(result.risk.reasons[0], /미복용 보고 2일/);
  assert.equal(result.metrics.medication.value, 50);
  assert.equal(result.metrics.medication.reportedDays, 3);
  assert.equal(result.metrics.medication.missedDays, 1);
  assert.equal(result.metrics.medication.doseReportedDays, 2);
  assert.equal(result.metrics.medication.doseReportedSlots, 3);
});

test('CHG-05 explicit unknown responses and pending doses do not establish known medication coverage', t => {
  const f = fixture(t);
  const plan = f.order(['08:00', '20:00']);
  for (const date of f.dates) {
    f.daily(date, { sleepHours: 8, medicationStatus: 'unknown' });
    f.report(plan, date, 'unknown');
  }

  // Unknown is a recorded answer, whereas the untouched evening dose is not
  // a report. Neither establishes that the dose was taken or missed.
  const schedule = medicationSchedule(f.db, f.patientId, f.dates[0]);
  assert.equal(schedule.summary.unknown, 1);
  assert.equal(schedule.summary.pending, 1);
  assert.equal(schedule.summary.missed, 0);

  const result = f.summary();
  assert.equal(result.metrics.medication.doseReportedDays, 3);
  assert.equal(result.metrics.medication.doseReportedSlots, 3);
  assert.equal(result.metrics.medication.reportedDays, 0);
  assert.equal(result.metrics.medication.value, null);
  assert.equal(result.risk.level, 'insufficient');
  assert.equal(result.risk.missingData, true);
  assert.deepEqual(result.risk.missingDomains, ['medication']);
  assert.deepEqual(result.risk.reasons, []);
  assert.match(result.briefing.items.find(item => item.domain === 'quality').text, /부족한 영역: 복약/);
});
