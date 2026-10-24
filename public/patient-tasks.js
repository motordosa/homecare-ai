// One source for visible suggestions, speech and foreground reminders.
export function koreaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(now);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
const known=value=>typeof value==='number'&&Number.isFinite(value);
export function buildPatientTasks({summary,schedule,now=new Date()}={}) {
  const clock=koreaClock(now);
  if(!summary||summary.today!==clock.date) return {date:clock.date,stale:true,tasks:[],pending:[],speech:'새 날짜의 기록을 다시 확인해 주세요.',signature:'stale:'+clock.date};
  const record=summary.todayRecord;
  const meals=(summary.todayMeals||[]).filter(m=>m.date===clock.date);
  const slots=schedule?.date===clock.date?schedule.slots||[]:[];
  const due=slots.filter(s=>s.status==='pending'&&s.time<=clock.time);
  const future=slots.filter(s=>s.status==='pending'&&s.time>clock.time);
  const registered=Boolean(schedule?.date===clock.date&&schedule.orders?.length);
  const tasks=[
    {id:'meal',label:'식사',action:'meal',state:meals.length?'recorded':'pending',detail:meals.length?`오늘 ${meals.length}건 남겼어요. 다음 식사도 추가할 수 있어요.`:'식사를 하셨다면 드신 내용을 남겨 주세요.',say:'식사를 하셨다면 식사 기록을 남겨 주세요.'},
    {id:'medication',label:'약 기록',action:'medication',state:!schedule||schedule.date!==clock.date?'unavailable':registered?due.length?'pending':future.length?'upcoming':'recorded':record?.medicationStatus?'recorded':'optional',detail:!schedule||schedule.date!==clock.date?'약 일정을 확인하지 못했어요. 다시 확인해 주세요.':registered?due.length?`시간이 지난 ${due.length}회차의 복용 여부를 알려 주세요.`:future.length?`다음 기록은 ${future[0].time} 예정이에요.`:'오늘 약별 회차는 모두 보고했어요.':record?.medicationStatus?'하루 복약 상태를 남겼어요.':'약별 일정이 없어요. 필요하면 하루 상태를 남길 수 있어요.',say:`시간이 지난 약 ${due.length}회차를 드셨는지 복약 기록에서 확인해 주세요.`},
    {id:'steps',label:'걸음 수',action:'steps',state:known(record?.steps)?'recorded':'pending',detail:known(record?.steps)?'오늘 걸음 수가 기록되어 있어요.':'확인한 걸음 수를 남길 수 있어요.',say:'확인한 오늘 걸음 수를 남길 수 있어요.'},
    {id:'sleep',label:'수면',action:'sleep',state:known(record?.sleepHours)?'recorded':'pending',detail:known(record?.sleepHours)?'오늘 수면 시간이 기록되어 있어요.':'지난밤 주무신 시간을 남길 수 있어요.',say:'지난밤 주무신 시간을 남길 수 있어요.'}
  ];
  const pending=tasks.filter(t=>t.state==='pending');
  const missingSchedule=tasks.find(t=>t.state==='unavailable');
  const speech='안녕하세요. 오늘도 함께 건강 기록을 남겨 볼까요? '+(pending.length?pending.map(t=>t.say).join(' '):'현재 확인한 기록은 남겨 주셨어요. 식사를 더 하셨다면 추가로 기록할 수 있어요.')+(missingSchedule?' 약 일정은 확인하지 못했으니 다시 확인해 주세요.':'');
  return {date:clock.date,stale:false,tasks,pending,speech,signature:JSON.stringify(tasks.map(t=>[t.id,t.state,t.detail]))};
}
