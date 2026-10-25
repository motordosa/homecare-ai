// Strict, bounded field-specific interpretation. No medical inference or automatic save.
const digits={영:0,공:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};
const native={하나:1,한:1,둘:2,두:2,셋:3,세:3,넷:4,네:4,다섯:5,여섯:6,일곱:7,여덟:8,아홉:9,열:10,스물:20,스무:20,서른:30,마흔:40,쉰:50,예순:60,일흔:70,여든:80,아흔:90};
// The UI and failure guidance use only phrases accepted by this field's grammar.
const examples=Object.freeze(Object.fromEntries(Object.entries({
  steps:['삼천 오백 걸음'],sleepHours:['일곱 시간 삼십 분'],weightKg:['육십이 점 오 킬로그램'],date:['오늘','어제'],
  status:['먹었어요','안 먹었어요','기억 안 나요'],medicationStatus:['모두 먹었어요','일부 먹었어요','안 먹었어요','기억 안 나요'],
  foodType:['밥과 반찬','죽','고기 생선 두부','면과 빵'],portion:['모두','절반','사분의 일','사분의 삼','안 먹음','모르겠어요'],
  note:['아침에 속이 조금 불편했어요'],messageBody:['기록 확인을 부탁드려요']
}).map(([key,value])=>[key,Object.freeze(value)])));
const noExamples=Object.freeze([]);
export function voiceInputExamples(field){return Object.hasOwn(examples,field)?examples[field]:noExamples;}
function exampleFailure(field,instruction){return fail(`${instruction} 예: ${voiceInputExamples(field).join(' · ')}.`);}
const copula=/(이에요|입니다|예요|이요|였어요)$/;
const didEat=/(?:을|를)?(?:먹었어요|먹었습니다|먹었음)$/;
const unknownStatus=/^(?:기억안나요|기억안납니다|기억나지않아요|기억나지않습니다|모르겠어요|모르겠습니다|먹었는지모르겠어요|먹었는지모르겠습니다|복용했는지모르겠어요|복용했는지모르겠습니다)$/;
const missedStatus=/^(?:안먹었어요|안먹었습니다|못먹었어요|못먹었습니다|먹지못했어요|먹지못했습니다|먹지않았어요|먹지않았습니다|복용하지않았어요|복용하지않았습니다|복용하지못했어요|복용하지못했습니다)$/;
const foodTypes=Object.freeze({'밥과반찬':'balanced','죽':'porridge','부드러운식사':'porridge','고기생선두부':'protein','단백질중심식사':'protein','면과빵':'noodles','면빵':'noodles'});
const portions=Object.freeze({모두:1,전부:1,다:1,절반:.5,반:.5,사분의일:.25,사분의삼:.75});
export function koreanNumber(input){
  const text=String(input);
  if(/\d\s+\d/.test(text))return NaN;
  const s=text.replace(/\s/g,'');
  if(/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(s))return Number(s.replaceAll(',',''));
  if(Object.hasOwn(native,s))return native[s];
  for(const [word,value] of Object.entries(native).filter(([,v])=>v>=10))if(s.startsWith(word)&&Object.hasOwn(native,s.slice(word.length))&&native[s.slice(word.length)]<10)return value+native[s.slice(word.length)];
  if(s.includes('점')){const parts=s.split('점');if(parts.length!==2||!parts[1]||![...parts[1]].every(c=>Object.hasOwn(digits,c)))return NaN;return koreanNumber(parts[0])+Number('0.'+[...parts[1]].map(c=>digits[c]).join(''));}
  if(!s||!/^[영공일이삼사오육칠팔구십백천만]+$/.test(s))return NaN;
  if(s.length===1&&Object.hasOwn(digits,s))return digits[s];
  let total=0,group=0,n=0,last=10000,hasDigit=false;
  for(const c of s){if(Object.hasOwn(digits,c)){if(hasDigit)return NaN;n=digits[c];hasDigit=true;}else{const unit={십:10,백:100,천:1000,만:10000}[c];if(hasDigit&&n===0)return NaN;if(unit===10000){if(total||!group&&!n)return NaN;total=(group+n)*unit;group=0;n=0;last=10000;}else{if(unit>=last)return NaN;group+=(n||1)*unit;n=0;last=unit;}hasDigit=false;}}
  return total+group+n;
}
const fail=message=>({ok:false,error:message});
function validDate(value,today){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value&&value<=today;}
export function parseVoiceInput(input,field,{today,currentDate=today}={}){
  const original=String(input||'').trim();if(!original)return fail('말씀하신 내용이 없어요. 다시 말하거나 손으로 입력해 주세요.');
  if(field==='note'||field==='messageBody'){const max=field==='note'?1000:2000;if(original.length>max)return fail('내용이 너무 길어요. 짧게 고쳐 주세요.');return {ok:true,value:original,display:original};}
  // Removing spaces must not join separate Arabic numbers into a guessed value.
  if(/\d\s+\d/.test(original))return exampleFailure(field,'숫자가 여러 개로 나뉘어 있어요. 한 가지 값을 단위와 함께 다시 말하거나 손으로 고쳐 주세요.');
  let s=original.replace(/[。.!]$/,'').replace(/\s/g,'');
  if(field==='date'){
    if(!validDate(today,today))return fail('기록할 날짜를 먼저 확인해 주세요. 날짜를 불러온 뒤 다시 말하거나 손으로 입력해 주세요.');
    let value=s==='오늘'?today:s==='어제'?new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10):s;
    const date=s.match(/^(\d{4})년(\d{1,2})월(\d{1,2})일$/);if(date)value=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;
    return validDate(value,today)?{ok:true,value,display:value}:fail('오늘·어제 또는 년·월·일을 모두 말해 주세요. 미래 날짜는 기록할 수 없어요.');
  }
  const relative=s.match(/^(오늘|어제)(은|는)?/);if(relative){if(!validDate(today,today)||!validDate(currentDate,today))return fail('기록할 날짜를 먼저 확인해 주세요.');const date=relative[1]==='오늘'?today:new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);if(date!==currentDate)return fail('말씀하신 날짜와 입력 화면의 날짜가 달라요. 먼저 기록 날짜를 바꿔 주세요.');s=s.slice(relative[0].length);}
  if(field==='steps'){
    s=s.replace(/^(?:걸음수는|걸음수)/,'').replace(/(?:(?:을|를)?(?:걸었어요|걸었습니다)|이에요|입니다|예요|이요|였어요)$/,'');
    const m=s.match(/^(.+?)(걸음|보)$/);const n=m?koreanNumber(m[1]):NaN;
    return Number.isInteger(n)&&n>=0&&n<=100000?{ok:true,value:n,display:`${n.toLocaleString('ko-KR')} 걸음`}:exampleFailure(field,'한 가지 걸음 수를 단위와 함께 말해 주세요.');
  }
  if(field==='sleepHours'){
    s=s.replace(/^(?:수면시간은|수면시간)/,'').replace(/(?:(?:을|를)?(?:잤어요|잤습니다)|이에요|입니다|예요|이요|였어요)$/,'');
    const m=s.match(/^(?:(.+?)시간)?(?:(.+?)분)?$/);let minutes=NaN;
    if(s.endsWith('시간반')){const h=koreanNumber(s.slice(0,-3));minutes=h*60+30;}
    else if(m&&(m[1]||m[2])){const h=m[1]?koreanNumber(m[1]):0,part=m[2]?koreanNumber(m[2]):0;if(part>=0&&part<60)minutes=h*60+part;}
    if(!Number.isFinite(minutes)||minutes<0||minutes>1440)return exampleFailure(field,'시간과 분을 한 번씩 말해 주세요.');
    const value=Math.round(minutes/60*10)/10;
    return {ok:true,value,display:`${Math.floor(minutes/60)}시간 ${Math.round(minutes%60)}분 → 저장 값 ${value}시간`,notice:'기존 기록의 0.1시간 단위로 반올림해요.'};
  }
  if(field==='weightKg'){
    s=s.replace(/^(?:몸무게는|몸무게|체중은|체중)/,'').replace(copula,'');
    const m=s.match(/^(.+?)(킬로그램|킬로|키로그램|키로|kg)$/i);const n=m?koreanNumber(m[1]):NaN;
    return Number.isFinite(n)&&n>=20&&n<=300&&Math.abs(n*10-Math.round(n*10))<1e-7?{ok:true,value:n,display:`${n} kg`}:exampleFailure(field,'한 가지 몸무게를 단위와 함께 말해 주세요.');
  }
  if(field==='status'||field==='medicationStatus'){
    s=s.replace(/^(?:약을|약)/,'');
    const taken=s.match(/^(모두|전부)?(?:먹었어요|먹었습니다|복용했어요|복용했습니다)$/);
    const partial=/^일부(?:만)?(?:먹었어요|먹었습니다|복용했어요|복용했습니다)$/.test(s);
    const value=taken?'taken':partial?'partial':missedStatus.test(s)?'missed':unknownStatus.test(s)?'unknown':null;
    if(!value||(field==='status'&&value==='partial')||(field==='medicationStatus'&&value==='taken'&&!taken[1]))return exampleFailure(field,field==='medicationStatus'?'하루 전체의 상태를 분명하게 말해 주세요. 모두 복용했다면 ‘모두’를 함께 말해 주세요.':'이 회차의 상태를 하나만 말해 주세요. 일부만 복용했다면 손으로 입력하고 메모를 남겨 주세요.');
    return {ok:true,value,display:({taken:field==='status'?'이 회차 먹었어요':'하루 전체 모두 먹었어요',partial:'하루 전체 일부 먹었어요',missed:'먹지 못했어요',unknown:'기억나지 않아요'})[value]};
  }
  if(field==='foodType'){
    s=s.replace(didEat,'');
    const value=Object.hasOwn(foodTypes,s)?foodTypes[s]:null;
    return value?{ok:true,value,display:({balanced:'밥과 반찬',porridge:'죽·부드러운 식사',protein:'고기·생선·두부',noodles:'면·빵'})[value]}:exampleFailure(field,'화면에 있는 식사 종류를 말하거나 직접 골라 주세요.');
  }
  if(field==='portion'){
    const quantity=s.replace(didEat,'');
    const value=unknownStatus.test(s)&&!s.startsWith('복용')?null:missedStatus.test(s)&&!s.startsWith('복용')||s==='안먹음'||s==='못먹음'?0:Object.hasOwn(portions,quantity)?portions[quantity]:undefined;
    return value!==undefined?{ok:true,value,display:value===null?'먹은 양을 모르겠어요':value===0?'안 먹었어요':`${value*100}% 먹었어요`}:exampleFailure(field,'먹은 양을 하나만 말해 주세요.');
  }
  return fail('이 항목은 손으로 입력해 주세요.');
}
