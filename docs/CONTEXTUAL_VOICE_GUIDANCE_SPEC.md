# 의료진 설정형 자동 음성 안내 v0.9.0

2026-10-25 KST, 사용자 요청에 따른 구현 전 확정 계획. 환자가 안내를 반복 재생하는 방식에서 의료진이 정한 시점·조건의 짧은 안내로 전환한다. 모바일 웹/기존 음성 입력/기록·의료진 기능을 유지한다. 새 유료 음성 API나 네이티브 기능은 추가하지 않는다. 목표0.9.0/schema9는 아직 공개 배포된 버전이 아니다.

## 단계와 인수조건

| ID | 단계 | 완료 조건 |
|---|---|---|
| CVG-01 | 규칙·권한·저장 계약 | 기본 문구/상속·revision·환자범위·추가 schema9, 기존 DB 보존 |
| CVG-02 | 의료진 설정 화면 | C-VOICE-GUIDANCE 메뉴, 공통/선택 환자 설정, 상세 조건·문구·빈도·기준값, 추가/삭제/미리듣기/저장/취소/상속복구, 충돌·오류·dirty/history 보호 |
| CVG-03 | 환자 자동 안내 | 오전/오후/저녁 첫 진입·메뉴 이벤트, 날짜/시간/환자/재생 영수증·우선순위·단일 발화, 재생 버튼 제거·멈춤·on/off·텍스트 대안 |
| CVG-04 | 입력값 확인 | blur/저장 시 단계적 확인, 같은 값 반복 억제·값 변경 시 재확인, 확인한 실제 수치 저장 허용, null/0 구별 |
| CVG-05 | 통합·회귀 | 의료진 저장→환자 자동 반영, 재접속·동시 탭·시간 경계·권한·응답 유실·미지원·음성입력 경합·320px/데스크톱 확인 |
| CVG-06 | 보고·저장소 | 생성 사전/화면 검사·정식 CI, 실제 음성/기기 미검증과 코드/저장소/배포 구별 |

## 화면 규약

**C-VOICE-GUIDANCE**: 의료진 공통 셸의 `view=voice-guidance`, 메뉴 이름 ‘음성 안내 설정’. 기존10메뉴에 추가해11개다. 화면 내 대상은 ‘공통 기본’과 ‘선택 환자’로 명시한다. 환자 선택은 기존 셸/URL/history를 사용한다. 전역 설정 수정은 전체 환자 범위의 clinical.write, 환자별 수정은 해당 환자 범위의 clinical.write만 가능하다. patient.read 직원은 조회 가능하되 편집/저장 버튼을 비활성 또는 숨긴다. 연구 전용 계정에는 메뉴를 제공하지 않는다.

설정은 전체 사용 여부·말하기 속도(0.85/1/1.15)와 규칙 목록이다. 규칙 상세에서 제목, 사용, 발생 동작, 짧은 문장, 시각 범위, 요일, 적용 시작/종료일, 필요한 기록 조건, 반복 기준, 최소 간격, 하루 상한, 우선순위, 수치 확인 범위를 조절한다. 기본 예시 불러오기·규칙 추가/삭제·현재 문장 미리듣기/멈춤을 제공한다. 미리듣기는 임상/환자 재생 기록을 생성하지 않는다. 편집 중 자동 갱신/환자 전환/뒤로가기가 원고를 덮지 않는다. 저장 실패는 원고·UUID 유지, revision409는 최신 설정 재조회 선택과 입력 보존. 환자별 ‘공통 설정 따르기’도 명시 저장이다.

**P-VOICE-GUIDE/P-GUIDE**: 홈 안내 듣기/다시 듣기/전체 듣기와 환자 목소리·속도 미리듣기 버튼을 삭제한다. 환자 설정에는 ‘음성 안내 켜기/끄기’만 남기고 안내 중 멈춤을 보인다. 기존 알림 설정은 화면 내/브라우저 알림으로 유지하되15분 주기의 반복 음성은 제거한다. 음성 입력의 마이크 시작/중지·인식글 수정·확인·적용·저장은 유지한다. 인식 확인의 별도 읽기 버튼도 제거하며 큰 글자 확인을 제공한다.

**P-MEAL/P-MED/P-MED-PHOTO/P-STEPS/P-SLEEP/P-DAILY**: 메뉴 진입 이벤트에서 조건에 맞는 안내1개만 선택한다. 입력값 확인은 해당 필드 아래 읽기 쉬운 값/단위를 표시하고 ‘이 값이 맞아요’/‘수정하기’를 제공한다. 확인이 필요한 값은 첫 저장을 멈추지만 명시 확인 후 저장할 수 있다. 임상 ‘정상/비정상’ 판정이나 자동 보정·자동 저장을 하지 않는다. 음성 off/미지원이어도 같은 시각적 확인을 유지한다.

## 규칙 데이터

공유 카탈로그/기본값은 `public/voice-guidance-rules.js`의 `GUIDANCE_EVENTS`, `GUIDANCE_CONDITIONS`, `DEFAULT_GUIDANCE_RULES`, `defaultGuidanceConfig()`가 기준이다. 브라우저 조건 계산은 별도 순수 모듈로 테스트한다.

Configuration: `{enabled:boolean,rate:0.85|1|1.15,rules:Rule[]}`. 최대40규칙, ID 중복 불가. Rule: `{id,label,enabled,trigger,text,startTime,endTime,daysOfWeek,activeFrom,activeUntil,frequency,condition,metric,minValue,maxValue,cooldownMinutes,maxPerDay,priority}`.

- id는 영문 소문자/숫자/하이픈 최대48자, label1..60자, text1..180자 plain text. 문장의 허용 치환은 `{value}`와 `{unit}`뿐이다. HTML/SSML 실행·코드/임의 식 평가 없음.
- trigger: `period_entry|meal_open|medication_open|medication_photo_open|steps_open|sleep_open|daily_open|value_check`.
- 시간은 KST `HH:MM`, 시작00:00~23:59, 종료는24:00 허용, start<end. 경계는 시작 포함/종료 제외. 날짜null 또는YYYY-MM-DD, 시작<=종료. 요일0(일)~6(토)의 중복 없는 배열.
- frequency: `day|entry|value`. period_entry는day, value_check는value, 메뉴는day/entry 선택. 하루 규칙 ID를 바꾸지 않은 문구 수정은 그날 이미 안내한 기록을 지우지 않는다.
- condition: `always|any_missing|missing_breakfast|missing_lunch|missing_dinner|pending_medication|missing_sleep|missing_steps`. 실제 최신 summary/schedule에서 평가한다. pending_medication은 조회된 실제 약별 예정 중 이미 시각이 된 미보고 또는 계획 없을 때 미보고 일일 자기보고를 구별한다. 조회 실패를 미복용으로 해석하지 않는다. any_missing은 해당 시간대 식사·미보고 복약, 오전은수면/저녁은걸음을 포함한다.
- metric은 value_check에서만 `steps|sleepHours`, 그외null. min/max는 각각null 또는허용범위 내 숫자, 최소 하나 필요, 둘 모두 있으면min<max. 수치는미만/초과 조건. steps정수0..100000, sleepHours0..24. 이는 입력 확인 기준이며 서버의 절대 입력 제한을 바꾸지 않는다.
- cooldownMinutes0..1440, maxPerDay1..10, priority0..100. value_check는 간격0/하루 상한 미적용(다른값 재확인 가능). 선택된 같은 트리거의 최우선 규칙1개만 재생한다.

## 기본 규칙·문장

| ID | 시점·기본 조건 | 짧은 문구 |
|---|---|---|
| morning |06:00–12:00 첫 접속,any_missing,하루1회 |안녕하세요. 아침 식사와 복약 여부, 지난밤 수면 기록을 확인해 주세요.|
| afternoon |12:00–18:00 첫 접속,any_missing,하루1회 |오후 식사와 드신 약을 확인해 기록해 주세요.|
| evening |18:00–22:00 첫 접속,any_missing,하루1회 |오늘 식사와 복약, 걸음 수 기록을 확인해 주세요.|
| meal-photo |식사 입력,하루1회 |음식 전체가 보이도록 사진을 찍어 주세요.|
| medication |복약 진입,하루1회 |약 이름과 시간을 보고 복용 여부를 골라 주세요.|
| medication-photo |약 사진 입력,하루1회 |약봉투의 글자가 잘 보이게 찍어 주세요.|
| steps |걸음 입력,하루1회 |휴대폰에 표시된 걸음 수를 정확히 입력해 주세요.|
| sleep |수면 입력,하루1회 |주무신 시간과 분을 확인해 입력해 주세요.|
| daily |전체 건강 입력,하루1회 |확인한 항목만 정확히 입력해 주세요.|
| steps-check |걸음<100 또는>50000,값별 |입력한 {value}{unit}이 맞나요? 다시 확인해 주세요.|
| sleep-check |수면<2시간 또는>14시간,값별 |입력한 수면 {value}{unit}이 맞나요? 다시 확인해 주세요.|

메뉴 기본 시간00–24, 모든요일/적용기간제한없음/최소간격0, 우선순위:기간10·메뉴50·확인100. 22–06에는 정기 인사하지 않지만 직접 연 입력의 설명/확인은 가능하다. 짧은 수면과10걸음은 실제값일 수 있으므로 의료진이 기준을 바꾸거나 끌 수 있다.

## API·DB 계약 (schema9 추가 이행)

- `GET /api/clinician/voice-guidance?patientId=ID`(ID생략=공통): `{scope,patientId,exists,revision,inherited,configuration,configurationKey,canWrite,catalog}`. patient.read와대상범위 검사. 환자별 override없으면 공통 설정 상속.
- 같은 경로 `PUT`: `{revision,clientRequestId,configuration}` 또는 `{revision,clientRequestId,inherit:true}`(환자만). UUID/CSRF/현재clinical.write와범위 검사. 동일actor/scope/UUID·같은본문 재전송은기존결과, 다른본문409. revision경합409. scope의revision은상속복구에도증가한다. 공통수정은전체범위만.
- `GET /api/patients/:id/voice-guidance`: `{configuration,configurationKey,preference:{enabled,configured},serverTime}`. 본인 또는권한있는대상직원. `PUT .../preference` `{enabled:boolean}`은환자본인만(합성demo환자세션도필수). 의료진설정enabled=false가환자on보다우선한다. preference.configured는서버에명시선택행이있는지나타낸다. 기존브라우저voiceEnabled=false는서버configured=false일때만현재환자의끄기선택으로이행하며,이미서버에명시저장된선택을덮지않는다. PUT결과는{preference:{enabled,configured:true}}다.
- `POST .../claims`: `{configurationKey,ruleId,event,contextId?,recordDate?,value?}`. 현재환자세션/CSRF/실제규칙/서버KST시간·날짜·요일·기간·numeric조건을검사한다. 메뉴entry의contextId는UUID. value는실수면시간또는정수걸음,recordDate는과거/오늘만. `{allowed,reason,claimId?,text?,rate?,expiresAt?}`. 재생 예약과다른탭중복차단은원자적이다.
- `POST .../receipts/:claimId` `{outcome:'started'|'released'}`: 해당환자·세션권한재검사. onstart에started, 실패/취소전에는released. started는중지해도다시미재생으로되돌리지않는다. 실패한재생을완료처리하지않는다. 예약유효기간30초,미시작예약은기간후재확보가능. 만료/다른환자의receipt가새예약을덮지않는다. ACK응답유실후같은요청재시도안전.
- receipt키는patient/규칙ID/KST일자/빈도별bucket(하루고정·entryUUID·값/기록일의hash). 설정revision변경만으로새하루기회를만들지않는다. 실제로소리를들었다는증거는아니며브라우저시작보고다. 원고/숫자원문/음성녹음/토큰은영수증·로그에보관하지않는다.
- config/변경영수증/환자preference/재생예약·영수증 테이블을추가한다. 환자별자료는FK CASCADE,공통설정은명시demo reset에서기본으로복구. 기존DB·건강자료를자동삭제하지않는다.

## 클라이언트 실행·오류

설정은환자초기조회·활성화/재진입·일정간격의보이는화면에서GET갱신하되입력을덮지않는다. 환자/날짜/폼/규칙세대가바뀌면대기예약과발화를무효화한다. 네트워크실패는텍스트/손입력을유지하며오래된의료진설정으로새자동발화를시작하지않는다. 설정오프는즉시중지,서버저장실패를명시하고현재화면은꺼진상태를유지한다. 다시켜기실패는성공표시하지않는다.

환자 일반 재생 버튼은없다. 자동재생을시도하고차단되면그문구를글로표시하며다음일반터치/키보드조작에현재유효한안내만재시도한다. 실패만으로하루기회를소모하지않고지나간시간대/이전폼안내를나중에재생하지않는다. 동일문맥에서재생시작실패재시도는최대2회후텍스트대안이다. 웹자동재생·잠금/백그라운드·실제음질은기기정책의한계를명시한다.

기존TTS시작3초/문장종료제한·마이크중단미확인보호를유지한다. 우선순위는값확인>메뉴설명>시간대인사다. 겹쳐재생하지않고값확인처럼명시조작에연결된현재안내만우선한다. 마이크사용/종료미확인중에는발화하지않고수동입력은유지한다. 미리듣기는의료진화면에서만가능하고영수증에기록하지않는다.

수치확인서명은patient/폼세대/기록일/항목/정확한숫자/규칙설정키다. blur·음성적용/수면보조적용·저장시점에검사한다. 확인체크후값/날짜/환자/설정이바뀌면확인은무효다. 미보고null/공란은0으로변환하지않는다. 폼의하드유효성검사는기존HTML/서버범위가우선이다.

## 검증

KST05:59/06:00/12:00/18:00/22:00/날짜변경,첫 실행·새로고침·새탭·두탭동시·설정변경/끄기·환자전환, claim/ack응답유실·예약만료·TTS시작/종료누락·권한/미지원·onstart외시작확정0을검사한다. 의료진공통/개별상속·UUID재시도·409원고유지·권한/담당환자·이탈취소·서버재시작/DB이행도검사한다. 10걸음/10분·0·공란·경계·값변경/과거날짜·음성입력·저장/의료진조회는실제폼/HTTP/임시DB로실행한다. 실제iPhone소리/마이크와모의이벤트를구별해보고한다.


## 구현 중 확인한 호환·저장 보강

이전 브라우저 설정에 음성 끄기가 남아 있으면 서버 preference.configured=false인 환자에 한해 끄기 선택을 이전한다. 이미 서버에 저장된 명시적 선택을 과거 브라우저 값으로 덮지 않는다. 이전 실패 중에는 현재 탭을 무음으로 유지한다.

환자 음성 원고·입력 수치 원문은 재생 영수증에 저장하지 않는다. 의료진 설정 변경의 UUID 영수증에는 동일 응답 반환을 위한 설정 응답이 보관된다. 자동 재생이 거절되면 다음 일반 조작 전에 유효한 예약을 준비하고, 조작 이벤트 안에서 동기 발화를 시도한다. 예약 유효기간을 넘겼다면 다시 준비한 뒤 다음 조작을 기다린다. 목소리 목록이 늦게 준비돼도 글을 유지하고 제한된 재시도만 허용한다. 실제 iPhone 검증을 대신하지 않는다.
