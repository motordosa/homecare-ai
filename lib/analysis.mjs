import { dateOffset, mealFromRow, patientFromRow, recordFromRow, todayKorea } from './db.mjs';
import { healthDailyForPatient } from './health-sync.mjs';

const mean = (values, digits = 1) => values.length ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length * 10 ** digits) / 10 ** digits : null;
const sum = values => values.reduce((total, n) => total + n, 0);
const present = value => value !== null && value !== undefined;
export const provenance = {
  mode: 'demo', data: '가상 인물의 합성 기록 및 사용자가 입력한 데모 기록',
  analysis: 'rule-based-demo-v1', nutrition: 'demo-food-table-v1',
  notice: '확인 우선순위는 기록 기반 데모 규칙입니다. 임상적으로 검증된 위험예측이나 진단이 아닙니다.',
  nutritionNotice: '영양값은 각 식사 출처에 따라 고정 표 또는 사진 분석의 추정값에 섭취 비율을 적용합니다. 사용자 확인은 임상 영양 검증을 뜻하지 않습니다.',
};

export function getPatients(db) {
  return db.prepare('SELECT * FROM patients ORDER BY created_at,id').all().map(patientFromRow);
}

export function getPatient(db, id) { return patientFromRow(db.prepare('SELECT * FROM patients WHERE id=?').get(id)); }

// Preserve self-reports and device aggregates separately. An explicit manual
// zero wins; clearing a manual numeric value reveals the selected device value.
export function effectiveRecords(db, id, startDate, endDate) {
  const manual = db.prepare('SELECT * FROM daily_records WHERE patient_id=? AND date>=? AND date<=? ORDER BY date').all(id, startDate, endDate).map(recordFromRow);
  const hasHealth = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='health_daily'").get();
  const device = hasHealth ? healthDailyForPatient(db, id, startDate, endDate) : [];
  const byDate = new Map(manual.map(record => [record.date, record]));
  const devices = new Map(device.filter(record => present(record.steps) || present(record.sleepHours)).map(record => [record.date, record]));
  return [...new Set([...byDate.keys(), ...devices.keys()])].sort().map(date => {
    const record = byDate.get(date);
    const health = devices.get(date);
    const manualSteps = present(record?.steps);
    const manualSleep = present(record?.sleepHours);
    const steps = manualSteps ? record.steps : health?.steps ?? null;
    const sleepHours = manualSleep ? record.sleepHours : health?.sleepHours ?? null;
    const usesDevice = (!manualSteps && present(health?.steps)) || (!manualSleep && present(health?.sleepHours));
    const base = record || { id: `device:${health.connectionId}:${date}`, patientId: id, date, medicationStatus: null, appetite: null, mood: null, note: '', weightKg: null, createdAt: health.receivedAt, updatedAt: health.receivedAt };
    return { ...base, steps, sleepHours,
      stepsSource: present(steps) ? manualSteps ? 'patient-self-report' : health.source : null,
      sleepSource: present(sleepHours) ? manualSleep ? 'patient-self-report' : health.source : null,
      dataOrigin: usesDevice ? record ? 'mixed' : 'device' : record ? 'manual' : 'device',
      healthReceivedAt: usesDevice ? health.receivedAt : null,
    };
  });
}

export function patientSummary(db, id) {
  const patient = getPatient(db, id);
  if (!patient) return null;
  const today = todayKorea();
  const start = dateOffset(today, -27);
  const allRecords = effectiveRecords(db, id, '1900-01-01', '2200-01-01');
  const records = allRecords.filter(record => record.date >= start && record.date <= today);
  const meals = db.prepare('SELECT * FROM meals WHERE patient_id=? AND date>=? AND date<=? ORDER BY date,created_at').all(id, start, today).map(mealFromRow);
  const recentStart = dateOffset(today, -6);
  const recent = records.filter(r => r.date >= recentStart);
  const recentMeals = meals.filter(m => m.date >= recentStart);
  const stepValues = recent.filter(r => present(r.steps)).map(r => r.steps);
  const sleepValues = recent.filter(r => present(r.sleepHours)).map(r => r.sleepHours);
  const medicationRecords = recent.filter(r => ['taken', 'partial', 'missed'].includes(r.medicationStatus));
  const doseEvents = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='medication_events'").get()
    ? db.prepare('SELECT * FROM medication_events WHERE patient_id=? AND date>=? AND date<=? ORDER BY date,time').all(id, recentStart, today) : [];
  const knownMedicationDates = new Set([...medicationRecords.map(record => record.date), ...doseEvents.filter(event => ['taken', 'missed'].includes(event.status)).map(event => event.date)]);
  const missedMedicationDates = new Set([...medicationRecords.filter(record => record.medicationStatus === 'missed').map(record => record.date), ...doseEvents.filter(event => event.status === 'missed').map(event => event.date)]);
  const medicationValue = medicationRecords.length ? Math.round(sum(medicationRecords.map(r => r.medicationStatus === 'taken' ? 1 : r.medicationStatus === 'partial' ? .5 : 0)) / medicationRecords.length * 100) : null;
  const mealDays = [...new Set(recentMeals.map(m => m.date))];
  const mealTotals = mealDays.map(date => ({ calories: sum(recentMeals.filter(m => m.date === date).map(m => m.calories)), proteinGrams: sum(recentMeals.filter(m => m.date === date).map(m => m.proteinGrams)) }));
  const weights = records.filter(r => present(r.weightKg));
  const lastWeight = weights.at(-1);
  const metrics = {
    steps: { value: mean(stepValues, 0), unit: '걸음', target: 5000, coverageDays: stepValues.length, totalDays: 7, meaning: '최근 7일 중 보고된 날의 평균' },
    sleepHours: { value: mean(sleepValues), unit: '시간', target: 7, coverageDays: sleepValues.length, totalDays: 7, meaning: '최근 7일 중 보고된 날의 평균' },
    medication: { value: medicationValue, unit: '%', takenDays: medicationRecords.filter(r => r.medicationStatus === 'taken').length, partialDays: medicationRecords.filter(r => r.medicationStatus === 'partial').length, missedDays: medicationRecords.filter(r => r.medicationStatus === 'missed').length, reportedDays: medicationRecords.length, meaning: '복약 자기보고 점수: 복용 1, 일부 0.5, 미복용 0. 알 수 없음은 제외' },
    nutrition: { value: mean(mealTotals.map(d => d.calories), 0), unit: 'kcal', proteinGrams: mean(mealTotals.map(d => d.proteinGrams)), recordedDays: mealDays.length, mealCount: recentMeals.length, meaning: '최근 7일의 식사 기록이 있는 날별 기록된 영양 추정 합계 평균. 미기록 식사 제외' },
    weightKg: { value: lastWeight?.weightKg ?? null, unit: 'kg', date: lastWeight?.date ?? null, change: weights.length >= 2 ? Math.round((lastWeight.weightKg - weights[0].weightKg) * 10) / 10 : null },
    completion: { value: Math.round(new Set([...recent.map(r => r.date), ...mealDays]).size / 7 * 100), reportedDays: new Set([...recent.map(r => r.date), ...mealDays]).size, totalDays: 7 },
  };
  const sourceCounts = key => recent.reduce((counts, record) => {
    const source = record[key];
    if (source) counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
  metrics.steps.sourceCounts = sourceCounts('stepsSource');
  metrics.sleepHours.sourceCounts = sourceCounts('sleepSource');
  metrics.medication.doseReportedDays = new Set(doseEvents.map(event => event.date)).size;
  metrics.medication.doseReportedSlots = doseEvents.length;
  metrics.steps.meaning = '최근 7일 중 기록된 날의 평균 · 직접 입력 우선, 없으면 선택 기기 집계';
  metrics.sleepHours.meaning = '최근 7일 중 기록된 날의 평균 · 직접 입력 우선, 없으면 선택 기기 집계';
  const reasons = [];
  if (missedMedicationDates.size >= 2) reasons.push(`최근 7일 중 일일 또는 약별 회차의 미복용 보고 ${missedMedicationDates.size}일`);
  if (stepValues.length >= 3 && metrics.steps.value < 1500) reasons.push(`보고된 ${stepValues.length}일의 평균 활동 ${metrics.steps.value.toLocaleString('ko-KR')}걸음`);
  if (sleepValues.length >= 3 && metrics.sleepHours.value < 5.5) reasons.push(`보고된 ${sleepValues.length}일의 평균 수면 ${metrics.sleepHours.value}시간`);
  const poorAppetite = recent.filter(r => r.appetite === 'poor').length;
  if (poorAppetite >= 3) reasons.push(`최근 7일 중 식욕 저하 보고 ${poorAppetite}일`);
  const poorMood = recent.filter(r => r.mood === 'poor').length;
  if (poorMood >= 3) reasons.push(`최근 7일 중 좋지 않은 기분 보고 ${poorMood}일`);
  const missingDomains = [stepValues.length < 3 ? 'activity' : null, sleepValues.length < 3 ? 'sleep' : null, knownMedicationDates.size < 3 ? 'medication' : null].filter(Boolean);
  const insufficient = metrics.completion.reportedDays < 3 || missingDomains.length > 0;
  const level = reasons.length >= 2 ? 'high' : reasons.length === 1 ? 'watch' : insufficient ? 'insufficient' : 'stable';
  const labels = { high: '확인 우선', watch: '관찰 필요', stable: '규칙 미해당', insufficient: '자료 부족' };
  const risk = { level, label: labels[level], reasons, score: reasons.length, scoreMeaning: '확인 규칙에 해당하는 항목 수. 질병 발생 확률이 아닙니다.', missingData: insufficient, missingDomains, disclaimer: provenance.notice };
  const recordByDate = new Map(records.map(r => [r.date, r]));
  const trends = Array.from({ length: 28 }, (_, i) => {
    const date = dateOffset(today, i - 27);
    const record = recordByDate.get(date);
    const dayMeals = meals.filter(m => m.date === date);
    return { date, steps: record?.steps ?? null, sleepHours: record?.sleepHours ?? null, stepsSource: record?.stepsSource ?? null, sleepSource: record?.sleepSource ?? null, dataOrigin: record?.dataOrigin ?? null, medicationStatus: record?.medicationStatus ?? null, appetite: record?.appetite ?? null, mood: record?.mood ?? null, calories: dayMeals.length ? sum(dayMeals.map(m => m.calories)) : null, proteinGrams: dayMeals.length ? Math.round(sum(dayMeals.map(m => m.proteinGrams)) * 10) / 10 : null, mealCount: dayMeals.length, weightKg: record?.weightKg ?? null, hasDaily: Boolean(record) };
  });
  const evidenceFor = field => recent.filter(r => present(r[field])).map(r => ({ date: r.date, source: ({ 'health-connect': 'Health Connect 집계', 'apple-health': 'Apple 건강 집계' }[(field === 'steps' ? r.stepsSource : field === 'sleepHours' ? r.sleepSource : null)] || '환자 일일 자기보고'), value: r[field], recordId: r.id }));
  const briefingItems = [
    { domain: 'activity', title: '활동과 수면', text: `최근 7일 활동 ${metrics.steps.value === null ? '자료 없음' : `보고일 평균 ${metrics.steps.value.toLocaleString('ko-KR')}걸음 (${stepValues.length}일)`}, 수면 ${metrics.sleepHours.value === null ? '자료 없음' : `보고일 평균 ${metrics.sleepHours.value}시간 (${sleepValues.length}일)`}입니다.`, evidence: [...evidenceFor('steps'), ...evidenceFor('sleepHours')] },
    { domain: 'medication', title: '일일 복약 자기보고 · 약별 회차는 별도', text: `${medicationRecords.length ? `기존 일일 자기보고는 복용 ${metrics.medication.takenDays}일, 일부 ${metrics.medication.partialDays}일, 미복용 ${metrics.medication.missedDays}일입니다.` : '최근 7일에 기존 일일 복약 자기보고는 없습니다.'} 약별 회차 보고는 ${metrics.medication.doseReportedDays}일 ${doseEvents.length}건이며 복약 계획에서 확인합니다. 자기보고만으로 실제 복용을 증명하지 않습니다.`, evidence: [...evidenceFor('medicationStatus'), ...doseEvents.map(event => ({ date: event.date, source: '환자 약별 회차 자기보고', value: `${event.time} · ${event.status}`, medicationEventId: event.id }))] },
    { domain: 'nutrition', title: '식사 기록', text: recentMeals.length ? `${mealDays.length}일에 식사 ${recentMeals.length}건을 기록했습니다. 기록일별 추정 합계 평균은 ${metrics.nutrition.value} kcal, 단백질 ${metrics.nutrition.proteinGrams} g입니다. 미기록 식사는 합산하지 않았습니다.` : '최근 7일에 식사 기록이 없습니다.', evidence: recentMeals.map(m => ({ date: m.date, source: m.source, value: `${m.calories} kcal / 단백질 ${m.proteinGrams} g`, mealId: m.id })) },
    { domain: 'quality', title: '자료 완성도', text: `최근 7일 중 ${metrics.completion.reportedDays}일에 일일·기기 또는 식사 기록이 있습니다. 입력하지 않은 값은 미측정으로 유지합니다.${missingDomains.length ? ` 확인할 자료가 부족한 영역: ${missingDomains.map(domain => ({ activity: '활동', sleep: '수면', medication: '복약' }[domain])).join(', ')}.` : ' 자료 기준 충족이 건강 안정의 진단을 뜻하지 않습니다.'}`, evidence: [{ date: today, source: '저장된 기록 집계', value: `${metrics.completion.reportedDays}/7일` }] },
  ];
  const questions = [];
  if (missedMedicationDates.size) questions.push('복약을 빠뜨린 이유와 복용 일정의 어려움을 확인해 주세요.');
  if (poorAppetite >= 3) questions.push('식욕 저하, 씹기·삼키기 불편, 실제 섭취량을 확인해 주세요.');
  if (metrics.steps.value !== null && metrics.steps.value < 1500) questions.push('활동 감소와 관련한 통증, 낙상 우려, 생활환경 변화를 확인해 주세요.');
  if (sleepValues.length && metrics.sleepHours.value < 5.5) questions.push('수면 시간과 낮잠, 야간 증상, 기기 측정 여부를 확인해 주세요.');
  if (insufficient) questions.push('기록이 적은 이유와 기기·입력 지원이 필요한지 확인해 주세요.');
  if (!questions.length) questions.push('방문 시 평소 생활과 기록 내용이 일치하는지 확인해 주세요.');
  const briefing = { headline: `${patient.name} 님 · ${risk.label}`, items: briefingItems, questions, generatedAt: new Date().toISOString(), method: 'rule-based-demo-v1', disclaimer: provenance.notice };
  const allRecentRecords = [...allRecords].reverse().slice(0, 14);
  const allRecentMeals = db.prepare('SELECT * FROM meals WHERE patient_id=? ORDER BY date DESC,created_at DESC LIMIT 24').all(id).map(mealFromRow);
  const todayRecord = records.find(r => r.date === today) ?? null;
  const todayMeals = meals.filter(m => m.date === today).reverse();
  const lastMealDate = db.prepare('SELECT MAX(date) AS date FROM meals WHERE patient_id=?').get(id).date;
  const lastRecordDate = [allRecords.at(-1)?.date, lastMealDate].filter(Boolean).sort().at(-1) ?? null;
  return { patient, today, metrics, risk, briefing, trends, recentMeals: allRecentMeals, recentRecords: allRecentRecords, todayRecord, todayMeals, lastRecordDate, provenance };
}

export function dashboard(db) {
  const today = todayKorea();
  const summaries = getPatients(db).map(p => patientSummary(db, p.id));
  const patients = summaries.map(({ patient, metrics, risk, lastRecordDate }) => ({ ...patient, metrics, risk, lastRecordDate }));
  const alerts = summaries.flatMap(({ patient, risk }) => risk.reasons.map(reason => ({ patientId: patient.id, patientName: patient.name, level: risk.level, title: risk.label, detail: reason })));
  const trends = Array.from({ length: 14 }, (_, i) => {
    const date = dateOffset(today, i - 13);
    const days = summaries.map(s => s.trends.find(t => t.date === date)).filter(Boolean);
    return { date, reportingPatients: days.filter(d => d.hasDaily || d.mealCount > 0).length, averageSteps: mean(days.filter(d => present(d.steps)).map(d => d.steps), 0), averageSleepHours: mean(days.filter(d => present(d.sleepHours)).map(d => d.sleepHours)) };
  });
  return {
    today, patients,
    stats: { patients: patients.length, needsReview: patients.filter(p => p.risk.level === 'high' || p.risk.level === 'watch').length, reportedToday: summaries.filter(s => s.todayRecord || s.todayMeals.length).length, averageCompletion: mean(patients.map(p => p.metrics.completion.value), 0) ?? 0 },
    alerts, trends, provenance,
    resetAt: db.prepare("SELECT value FROM metadata WHERE key='reset_at'").get()?.value ?? null,
  };
}
