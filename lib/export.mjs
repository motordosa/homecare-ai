import { getPatients, effectiveRecords } from './analysis.mjs';
import { mealFromRow, todayKorea } from './db.mjs';
import { allowedKeys, csvCell, dateValue, HttpError } from './validation.mjs';

export const exportColumns = ['recordType','id','patientId','patientName','date','steps','sleepHours','medicationStatus','appetite','mood','note','weightKg','mealType','foodType','portion','calories','proteinGrams','source','createdAt','updatedAt','stepsSource','sleepSource','orderId','time','status','reason','revision','reportedAt','name','strength','dose','route','times','startDate','endDate','instructions','connectionId'];

export function buildRecordExport(db, query = {}, allowedPatientIds = null) {
  allowedKeys(query, ['patientId','startDate','endDate']);
  const startDate = query.startDate ? dateValue(query.startDate) : null;
  const endDate = query.endDate ? dateValue(query.endDate) : null;
  if ((startDate && startDate > todayKorea()) || (endDate && endDate > todayKorea())) throw new HttpError(400, '미래 날짜는 내보내기 기간에 포함할 수 없습니다.');
  if (startDate && endDate && startDate > endDate) throw new HttpError(400, '시작일이 종료일보다 늦습니다.');
  const patients = getPatients(db).filter(p => allowedPatientIds === null || allowedPatientIds.includes(p.id));
  if (query.patientId && !patients.some(p=>p.id===query.patientId)) throw new HttpError(403, '내보낼 환자에 접근할 수 없습니다.');
  const selected = patients.filter(p=>!query.patientId || p.id===query.patientId);
  const start = startDate || '1900-01-01';
  const end = endDate || todayKorea();
  const rows = [];
  for (const patient of selected) {
    const common = {patientId:patient.id,patientName:patient.name};
    rows.push(...effectiveRecords(db,patient.id,start,end).map(r=>({...r,...common,recordType:'daily',source:r.dataOrigin})));
    rows.push(...db.prepare('SELECT * FROM meals WHERE patient_id=? AND date>=? AND date<=? ORDER BY date,created_at').all(patient.id,start,end)
      .map(mealFromRow).map(m=>({...m,...common,recordType:'meal'})));
    rows.push(...db.prepare('SELECT * FROM medication_orders WHERE patient_id=? AND start_date<=? AND (end_date IS NULL OR end_date>=?) ORDER BY created_at,id').all(patient.id,end,start)
      .map(r=>({...common,recordType:'medication-order',id:r.id,name:r.name,strength:r.strength,dose:r.dose,route:r.route,times:JSON.parse(r.times).join('|'),startDate:r.start_date,endDate:r.end_date,instructions:r.instructions,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at,source:'clinician-entered-demo'})));
    rows.push(...db.prepare('SELECT * FROM medication_events WHERE patient_id=? AND date>=? AND date<=? ORDER BY date,time,id').all(patient.id,start,end)
      .map(r=>({...common,recordType:'medication',id:r.id,date:r.date,orderId:r.order_id,time:r.time,status:r.status,reason:r.reason,note:r.note,revision:r.revision,reportedAt:r.reported_at,source:'patient-self-report'})));
    rows.push(...db.prepare('SELECT d.*,c.platform FROM health_daily d JOIN health_connections c ON c.id=d.connection_id WHERE d.patient_id=? AND d.date>=? AND d.date<=? ORDER BY d.date,d.connection_id').all(patient.id,start,end)
      .map(r=>({...common,recordType:'health',date:r.date,steps:r.steps,sleepHours:r.sleep_minutes===null?null:r.sleep_minutes/60,updatedAt:r.updated_at,source:r.platform,connectionId:r.connection_id})));
  }
  const byRecordType = rows.reduce((counts,row)=>(counts[row.recordType]=(counts[row.recordType]||0)+1,counts),{});
  const scope = {patientId:query.patientId||null,patientIds:selected.map(p=>p.id),startDate,endDate,appliedStartDate:start,appliedEndDate:end,includesIdentifiers:true};
  const preview = {scope,patientCount:selected.length,rowCount:rows.length,columns:exportColumns,byRecordType,
    filename:`homecare-records-${todayKorea()}.csv`,
    notice:'선택한 범위의 식별 가능한 관리용 기록입니다. 전체 기간은 오늘까지의 자료입니다. 사진·대화·전체 DB 복원본은 포함하지 않습니다. 연구용 가명 반출은 연구 분석에서 사용해 주세요.'};
  const csv='\ufeff'+[exportColumns.map(csvCell).join(','),...rows.map(row=>exportColumns.map(column=>csvCell(row[column])).join(','))].join('\r\n')+'\r\n';
  return {...preview,csv};
}
