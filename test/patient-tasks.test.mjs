import test from 'node:test';import assert from 'node:assert/strict';
import {buildPatientTasks,koreaClock}from'../public/patient-tasks.js';
const now=new Date('2026-10-24T01:00:00Z');
const base={today:'2026-10-24',todayRecord:null,todayMeals:[]};
const scheduled=slots=>({date:base.today,orders:[{id:'order'}],slots});
test('TASKS due medication reports exclude future and already reported missed/unknown',()=>{
 const b=buildPatientTasks({summary:base,now,schedule:scheduled([{time:'08:00',status:'pending'},{time:'18:00',status:'pending'},{time:'09:00',status:'missed'},{time:'07:00',status:'unknown'}])});
 assert.match(b.tasks[1].detail,/1회차/);assert.equal(b.pending.length,4);assert.ok(!b.speech.includes('18:00'));assert.ok(!b.speech.includes('약을 드세요'));
 const later=buildPatientTasks({summary:base,now,schedule:scheduled([{time:'18:00',status:'pending'}])});assert.equal(later.tasks[1].state,'upcoming');assert.ok(!later.pending.some(t=>t.id==='medication'));
});
test('TASKS zero is a report, meal is not full-day completion, missing schedule is unknown',()=>{
 const b=buildPatientTasks({summary:{...base,todayRecord:{steps:0,sleepHours:0},todayMeals:[{date:base.today}]},schedule:null,now});
 assert.equal(b.tasks[2].state,'recorded');assert.equal(b.tasks[3].state,'recorded');assert.match(b.tasks[0].detail,/추가/);assert.equal(b.tasks[1].state,'unavailable');assert.match(b.speech,/확인하지 못/);
 const none=buildPatientTasks({summary:base,schedule:{date:base.today,orders:[],slots:[]},now});assert.equal(none.tasks[1].state,'optional');assert.ok(!none.pending.some(t=>t.id==='medication'));
});
test('TASKS KST midnight prevents stale yesterday reminders',()=>{
 assert.deepEqual(koreaClock(new Date('2026-10-24T15:00:00Z')),{date:'2026-10-25',time:'00:00'});
 const b=buildPatientTasks({summary:base,schedule:null,now:new Date('2026-10-24T15:00:00Z')});assert.equal(b.stale,true);assert.equal(b.pending.length,0);
});

test('TASKS brief speech has only the next pending task and full guide retains remaining tasks',()=>{
 const b=buildPatientTasks({summary:base,schedule:scheduled([]),now});
 assert.match(b.shortSpeech,/식사 기록/);assert.ok(!b.shortSpeech.includes('걸음 수'));assert.match(b.speech,/걸음 수/);assert.match(b.speech,/주무신 시간/);
 const unavailable=buildPatientTasks({summary:base,schedule:null,now});assert.match(unavailable.shortSpeech,/약 일정을 확인하지 못/);assert.ok(!unavailable.shortSpeech.includes('약을 드세요'));
});
