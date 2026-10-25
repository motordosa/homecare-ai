import test from 'node:test';import assert from 'node:assert/strict';
import {koreanNumber,parseVoiceInput} from '../public/voice-parser.js';
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
