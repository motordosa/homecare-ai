import test from 'node:test';import assert from 'node:assert/strict';
import {koreanNumber,parseVoiceInput,voiceInputExamples} from '../public/voice-parser.js';
const context={today:'2026-10-24',currentDate:'2026-10-24'};
const parse=(text,field)=>parseVoiceInput(text,field,context);
test('VOICE Korean numbers support actual units and reject malformed strings',()=>{
 for(const [s,n]of [['삼천 오백',3500],['일만이천삼백사십오',12345],['일곱',7],['스물셋',23],['육십이점오',62.5],['3,500',3500],['영',0]])assert.equal(koreanNumber(s),n,s);
 for(const s of ['삼오','삼천아니오천','-5','3,5','일백백','네가'])assert.ok(Number.isNaN(koreanNumber(s)),s);
});
test('VOICE numeric interpretation preserves zero, dates, ranges and precision',()=>{
 assert.equal(parse('오늘 삼천 오백 걸음 걸었어요','steps').value,3500);
 assert.equal(parse('0걸음','steps').value,0);
 assert.equal(parse('일곱 시간 삼십 분 잤어요','sleepHours').value,7.5);
 assert.equal(parse('일곱 시간 반','sleepHours').value,7.5);
 assert.equal(parse('0시간','sleepHours').value,0);
 assert.equal(parse('7시간 20분','sleepHours').value,7.3);
 assert.equal(parse('육십이 점 오 킬로그램','weightKg').value,62.5);
 for(const [s,k] of [['3500','steps'],['삼천 오천 걸음','steps'],['3000걸음 5000걸음','steps'],['어제 3500걸음','steps'],['-5걸음','steps'],['100001걸음','steps'],['25시간','sleepHours'],['7시간 90분','sleepHours'],['7시간 아니 8시간','sleepHours'],['500kg','weightKg'],['62.55kg','weightKg']])assert.equal(parse(s,k).ok,false,s);
});
test('VOICE dates require unambiguous complete civil dates',()=>{
 assert.equal(parse('오늘','date').value,'2026-10-24');assert.equal(parse('어제','date').value,'2026-10-23');assert.equal(parse('2026년 10월 23일','date').value,'2026-10-23');
 for(const s of ['내일','2026년2월30일','10월23일','2027-01-01'])assert.equal(parse(s,'date').ok,false,s);
});
test('VOICE medication negatives cannot become taken and partial slot report is rejected',()=>{
 assert.equal(parse('약 안 먹었어요','status').value,'missed');assert.equal(parse('먹었는지 모르겠어요','status').value,'unknown');assert.equal(parse('먹었어요','status').value,'taken');assert.equal(parse('모두 먹었어요','medicationStatus').value,'taken');
 for(const [s,k]of [['먹었어요','medicationStatus'],['먹었어요 아니 안 먹었어요','status'],['아마 먹었을 거예요','status'],['일부 먹었어요','status']])assert.equal(parse(s,k).ok,false,s);
});
test('VOICE meal portion unknown differs from zero and free text stays text',()=>{
 assert.equal(parse('모르겠어요','portion').value,null);assert.equal(parse('안 먹었어요','portion').value,0);assert.equal(parse('절반 먹었어요','portion').value,.5);assert.equal(parse('밥과 반찬','foodType').value,'balanced');assert.equal(parse('조금 먹었어요','portion').ok,false);
 assert.equal(parse('<script>test</script>','note').value,'<script>test</script>');assert.equal(parse('a'.repeat(1001),'note').ok,false);
});
test('REL-07 every displayed example is valid for its own field and error guidance agrees',()=>{
 for(const field of ['steps','sleepHours','weightKg','date','status','medicationStatus','foodType','portion','note','messageBody']){
  const examples=voiceInputExamples(field);assert.ok(examples.length>0,field);assert.ok(Object.isFrozen(examples));
  for(const phrase of examples){assert.equal(parse(phrase,field).ok,true,`${field}: ${phrase}`);if(!['date','note','messageBody'].includes(field))assert.ok(parse('해석할 수 없는 문장',field).error.includes(phrase),`${field} error: ${phrase}`);}
 }
 assert.deepEqual(voiceInputExamples('unknown'),[]);assert.deepEqual(voiceInputExamples('__proto__'),[]);
 assert.match(parse('먹었어요','medicationStatus').error,/모두/);assert.match(parse('일부 먹었어요','status').error,/이 회차/);
});
test('REL-07 Korean particles and respectful endings preserve meaning and explicit units',()=>{
 for(const [phrase,field,value] of [
  ['오늘 삼천 오백 걸음을 걸었어요','steps',3500],['걸음 수는 삼천 오백 걸음을 걸었습니다','steps',3500],['0보를 걸었습니다','steps',0],
  ['일곱 시간 반 잤어요','sleepHours',7.5],['수면 시간은 일곱 시간 삼십 분을 잤습니다','sleepHours',7.5],['체중은 육십이 점 오 킬로그램입니다','weightKg',62.5],
  ['약을 먹었습니다','status','taken'],['약을 복용했습니다','status','taken'],['안 먹었습니다','status','missed'],['약을 먹지 않았습니다','status','missed'],
  ['복용하지 못했습니다','status','missed'],['약을 먹었는지 모르겠습니다','status','unknown'],['약을 모두 먹었습니다','medicationStatus','taken'],['전부 복용했습니다','medicationStatus','taken'],['일부만 먹었습니다','medicationStatus','partial'],
  ['밥과 반찬을 먹었어요','foodType','balanced'],['면과 빵을 먹었습니다','foodType','noodles'],['죽 먹었습니다','foodType','porridge'],
  ['모두','portion',1],['절반','portion',.5],['절반을 먹었습니다','portion',.5],['사분의 일 먹었습니다','portion',.25],['안 먹었습니다','portion',0],['안 먹음','portion',0],['모르겠습니다','portion',null]
 ]){const result=parse(phrase,field);assert.equal(result.ok,true,`${field}: ${phrase}`);assert.equal(result.value,value,`${field}: ${phrase}`);}
});
test('REL-07 new grammar does not erase negation, alternatives, questions, dates, or field boundaries',()=>{
 for(const [phrase,field] of [
  ['삼천 걸음을 안 걸었어요','steps'],['삼천 걸음 아니 오천 걸음','steps'],['삼천 걸음은 아닌데요','steps'],['삼천 걸음입니다 걸었어요','steps'],['걸음 수는 일곱 시간 잤어요','sleepHours'],
  ['수면 시간은 삼천 걸음','steps'],['어제 삼천 오백 걸음을 걸었습니다','steps'],['오늘은 아니고 어제 삼천 걸음','steps'],['일곱 시간은 못 잤어요','sleepHours'],['일곱 시간 또는 여덟 시간','sleepHours'],
  ['약을 먹었습니다','medicationStatus'],['약을 모두 안 먹었습니다','medicationStatus'],['모두 먹었다고 생각해요','medicationStatus'],['먹었어요 아니 안 먹었습니다','status'],['먹었어요?','status'],['약을 일부만 먹었습니다','status'],
  ['약을 먹지 않았는지 모르겠습니다','status'],['약을 복용했습니다 안 했습니다','status'],['밥과 반찬을 안 먹었어요','foodType'],['죽 아니 면과 빵','foodType'],
  ['절반을 안 먹었어요','portion'],['모두 안 먹었어요','portion'],['반 아니 모두','portion'],['안 먹지 않았어요','portion'],['사분의 일 또는 사분의 삼','portion'],['복용하지 않았습니다','portion'],['복용했는지 모르겠어요','portion'],
  ['__proto__','foodType'],['constructor','portion'],['toString','foodType']
 ])assert.equal(parse(phrase,field).ok,false,`${field}: ${phrase}`);
 for(const value of ['영삼','공공오','영천','공백'])assert.ok(Number.isNaN(koreanNumber(value)),value);
});
test('REL-07 missing or invalid date context fails safely instead of throwing',()=>{
 for(const dateContext of [{},{today:'bad-date'},{today:'2026-02-30'},{today:'2026-10-24',currentDate:'bad-date'}]){
  assert.doesNotThrow(()=>parseVoiceInput('어제 삼천 걸음','steps',dateContext));assert.equal(parseVoiceInput('어제 삼천 걸음','steps',dateContext).ok,false);
 }
 assert.equal(parseVoiceInput('어제','date').ok,false);assert.equal(parseVoiceInput('오늘','date',{today:'bad-date'}).ok,false);
});
test('REL-07 separate Arabic numbers are never joined by whitespace normalization',()=>{
 for(const [phrase,field] of [
  ['30 50 걸음','steps'],['3\t500 걸음','steps'],['1 2 시간','sleepHours'],['6 2 kg','weightKg'],['6 2.5 kg','weightKg'],
  ['6.2 5 kg','weightKg'],['6.2 6.3 kg','weightKg'],['1\n2 시간','sleepHours'],['6\u00a02 kg','weightKg'],['2026-1 0-23','date'],['202 6년 10월 23일','date']
 ])assert.equal(parse(phrase,field).ok,false,`${field}: ${phrase}`);
 for(const phrase of ['30 50','6 2.5','6.2 5','1\t2'])assert.ok(Number.isNaN(koreanNumber(phrase)),phrase);
 assert.equal(parse('3,500 걸음','steps').value,3500);assert.equal(parse('삼천 오백 걸음','steps').value,3500);
 assert.equal(parse('육십이 점 오 킬로그램','weightKg').value,62.5);assert.equal(parse('7 시간 20 분','sleepHours').value,7.3);
 assert.equal(parse('2026년 10월 23일','date').value,'2026-10-23');
 assert.equal(parse('30 50 걸음이라고 들었어요','note').value,'30 50 걸음이라고 들었어요');
 assert.equal(parse('6 2 라고 잘못 적었어요','messageBody').value,'6 2 라고 잘못 적었어요');
});
