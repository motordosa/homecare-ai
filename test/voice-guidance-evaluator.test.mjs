import test from 'node:test';
import assert from 'node:assert/strict';
import {guidanceClock,ruleInWindow,guidanceCondition,matchingGuidanceRules,valueNeedsConfirmation,guidanceText} from '../public/voice-guidance-evaluator.js';
const date='2026-10-25';
const at=time=>new Date(`${date}T${time}:00+09:00`);
const base={id:'morning',enabled:true,trigger:'period_entry',condition:'any_missing',startTime:'06:00',endTime:'12:00',daysOfWeek:[0,1,2,3,4,5,6],activeFrom:null,activeUntil:null,priority:10};
const summary={today:date,todayRecord:null,todayMeals:[]};
const schedule={date,orders:[],slots:[]};
test('KST boundaries, inclusive start/exclusive end and calendar weekday',()=>{
 assert.deepEqual(guidanceClock(at('05:59')),{date,time:'05:59',weekday:0});
 assert.equal(ruleInWindow(base,at('05:59')),false);assert.equal(ruleInWindow(base,at('06:00')),true);
 assert.equal(ruleInWindow(base,at('11:59')),true);assert.equal(ruleInWindow(base,at('12:00')),false);
 assert.equal(ruleInWindow({...base,startTime:'12:00',endTime:'18:00'},at('12:00')),true);
 assert.equal(ruleInWindow({...base,startTime:'18:00',endTime:'22:00'},at('18:00')),true);
 assert.equal(ruleInWindow({...base,startTime:'18:00',endTime:'22:00'},at('22:00')),false);
 assert.equal(guidanceClock(new Date('2026-10-25T15:00:00Z')).date,'2026-10-26');
 assert.equal(ruleInWindow({...base,daysOfWeek:[1]},at('08:00')),false);
 assert.equal(ruleInWindow({...base,activeFrom:'2026-10-26'},at('08:00')),false);
 assert.equal(ruleInWindow({...base,activeUntil:date},at('08:00')),true);
});
test('actual meal categories, reported zero, and unknown medication are distinct',()=>{
 const c={summary:{...summary,todayRecord:{steps:0,sleepHours:0},todayMeals:[{date,mealType:'breakfast'}]},schedule:null,now:at('08:00')};
 assert.equal(guidanceCondition('missing_breakfast',c),false);assert.equal(guidanceCondition('missing_lunch',c),true);
 assert.equal(guidanceCondition('missing_sleep',c),false);assert.equal(guidanceCondition('missing_steps',c),false);
 assert.equal(guidanceCondition('pending_medication',c),false);assert.equal(guidanceCondition('any_missing',c),false);
 assert.equal(guidanceCondition('any_missing',{...c,now:at('13:00')}),true);
 assert.equal(guidanceCondition('missing_sleep',{...c,summary:{...summary,todayRecord:{sleepHours:null}}}),true);
 assert.equal(guidanceCondition('missing_steps',{...c,summary:{...summary,today:'2026-10-24'}}),false);
});
test('medication checks only currently due unreported slots or known legacy missing report',()=>{
 const c={summary,schedule:{date,orders:[{id:'order'}],slots:[{time:'14:00',status:'pending'},{time:'08:00',status:'missed'}]},now:at('10:00')};
 assert.equal(guidanceCondition('pending_medication',c),false);
 assert.equal(guidanceCondition('pending_medication',{...c,now:at('14:00')}),true);
 assert.equal(guidanceCondition('pending_medication',{...c,schedule}),true);
 assert.equal(guidanceCondition('pending_medication',{...c,schedule:{...schedule,date:'2026-10-24'}}),false);
});
test('numeric checks respect canonical bounds, null/blank, and strict thresholds',()=>{
 const steps={...base,trigger:'value_check',metric:'steps',minValue:100,maxValue:50000};
 for(const value of [null,undefined,'',NaN,-1,100001,1.5,100,50000])assert.equal(valueNeedsConfirmation(steps,'steps',value),false,String(value));
 for(const value of [0,10,99,50001])assert.equal(valueNeedsConfirmation(steps,'steps',value),true,String(value));
 const sleep={...steps,metric:'sleepHours',minValue:2,maxValue:14};
 assert.equal(valueNeedsConfirmation(sleep,'sleepHours',.2),true);assert.equal(valueNeedsConfirmation(sleep,'sleepHours',2),false);assert.equal(valueNeedsConfirmation(sleep,'sleepHours',14),false);assert.equal(valueNeedsConfirmation(sleep,'sleepHours',24),true);assert.equal(valueNeedsConfirmation(sleep,'sleepHours',25),false);
});
test('matching selects priority, disabled rules/config stay silent, text is numeric plain text',()=>{
 const rule={...base,condition:'always',trigger:'value_check',metric:'steps',minValue:100,maxValue:50000,text:'입력한 {value}{unit}이 맞나요?'};
 const config={enabled:true,rules:[rule,{...rule,id:'urgent',priority:100}]};
 assert.equal(matchingGuidanceRules(config,'value_check',{summary,schedule,now:at('08:00'),metric:'steps',value:10})[0].id,'urgent');
 assert.deepEqual(matchingGuidanceRules({...config,enabled:false},'value_check',{now:at('08:00'),metric:'steps',value:10}),[]);
 assert.equal(guidanceText(rule,10),'입력한 10걸음이 맞나요?');
 assert.equal(guidanceText({...rule,metric:'sleepHours'},.2),'입력한 0.2시간이 맞나요?');
});
