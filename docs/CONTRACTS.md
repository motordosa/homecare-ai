# 데이터와 API 계약 v0.8.0

이 문서는 구현 전 합의한 기준이다. 세부 계약을 변경할 때 구현보다 먼저 이 문서와 CHANGELOG를 갱신한다. 기존 v0.2 경로는 삭제하지 않는다. 구현 여부는 CHANGELOG에서 확인한다.

## 공통

v0.6 AUTH/COM의 세부 API·세션·권한·읽음/중복·reset 계약은 AUTH_COMMUNICATION_SPEC.md를 따른다. AUTH_MODE=kakao는 보호 API와 업로드 소유권을 서버에서 검사하며 미설정 시 공개 데모로 fallback하지 않는다. demo 호환은 명시적 합성 체험 모드뿐이다. 인증 테이블은 schema4에서 도입했으며 현재 통합 스키마는 schema6이다.

- JSON 객체, unknown 필드 거부, 유효한 날짜 `YYYY-MM-DD`, 저장 기본 일자 `Asia/Seoul`.
- 시각은 offset을 포함한 ISO8601. `0`과 `null`(미측정)을 구별한다. 미응답을 정상/미복용으로 추론하지 않는다.
- 요청 오류 `{error:string}`, HTTP 400/401/403/404/409/410/413/415/429/502/503/504. 비밀값·사진 원문·모델 내부 응답을 오류에 노출하지 않는다.
- 환자별 데이터는 경로 ID와 DB 소유권을 함께 검사한다. 로그인 없는 데모의 clinician 표시를 인증된 의료진 신원으로 해석하지 않는다.
- 상태 변경은 같은 출처 검사. 네이티브 수신은 환자에 바인딩한 Bearer 연결 토큰을 추가 요구한다.

## 일일 기록 / 메뉴

의료진 방문 기록은 SCREEN_SPEC C-SHELL/NAV-05 기준이다. 사용자 이동(push)과 조회 갱신(replace)을 구별하며 popstate는 같은 화면·환자·복약 날짜를 복원한다. URL 복원은 조회만 수행하며 저장 API를 호출하지 않는다.

환자 화면의 상단·하단·닫기·미저장/저장 중·역할 전환 계약은 SCREEN_SPEC.md가 기준이다. 단일 화면 registry와 브라우저 검증을 연결한다. 일반 서브 X는 같은 환자 홈, 입력 X는 진입 화면이며 우상단 위치를 의료진 전환으로 재사용하지 않는다.

`POST /api/patients/:id/daily`는 부분 갱신이다. 활동 모드는 `{date,steps}`, 수면 모드는 `{date,sleepHours}`, 기존 일일 복약 모드는 `{date,medicationStatus}`만 보낸다. 전체 폼도 미입력 식욕·기분을 `normal`로 만들지 않는다. 직접 보고한 unknown과 미응답 null을 구별한다. 입력하지 않은 필드를 전송하지 않는다. UI는 `expectedRevision`과 내용별 UUID `clientSubmissionId`를 함께 보낸다. 동일 키·동일 본문 재전송은 저장 당시 응답, 동일 키·다른 본문 또는 새로운 수정번호 충돌은409이다. 감사 이력은 성공한 새 저장에만 추가한다.

## 복약 계획/회차

- `GET /api/patients/:id/medication-orders` → `{orders:MedicationOrder[]}`.
- `POST /api/patients/:id/medication-orders` →201 `{order}`. 입력 `{name,strength,dose,route,times,startDate,endDate,instructions,clientRequestId?}`. times는 중복 없는 `HH:MM` 배열. 선택 UUID `clientRequestId`의 같은 내용 재시도는 기존 계획을 반환하며 다른 내용은409이다. 실제 약명·용량·시간을 합성 시드의 일반 질환명에서 추론해 자동 처방하지 않는다.
- `PATCH /api/medication-orders/:id` 입력 `{endDate:'YYYY-MM-DD'}` → `{order}`. 종료일은 필수이며 오늘(KST)·시작일 이상, 기존 종료일보다 늦출 수 없다. 이미 보고된 최대 회차 날짜보다 앞선 종료는409. 시작/종료일은 포함하므로 오늘 종료는 내일부터 신규 회차가 없다. 이름/용량 변경은 종료 후 새 계획으로 만든다. status는 active/ended이며 종료한 계획도 종료일 이전 일정과 이벤트를 조회·수정할 수 있다.
- `GET /api/patients/:id/medication-schedule?date=...` → `{date,orders,slots,summary}`. 회차 key는 `(orderId,date,time)`이며 기록 없는 회차의 status는 `pending`이다.
- `POST /api/patients/:id/medication-events` → `{event}`. 입력 `{orderId,date,time,status,reason?,note?}`. status는 `taken|missed|unknown`; pending은 이벤트 부재로만 표현한다. 미래 날짜 보고는400. 계획/기간/시간과 환자 소유권 검사. 같은 회차 재보고는 현재 상태를 갱신하고 이전/이후 상태를 별도 이력에 보존한다. 동일 payload 재전송은 revision을 늘리지 않는다. reason/note 생략은 빈 문자열인 완전한 회차 보고다.
- `GET /api/patients/:id/medication-events?date=...` → 현재 이벤트와 수정 이력에 접근할 자료. 일일 레거시 자기보고와 약별 회차 비율은 구별하여 표시한다.
- `MedicationOrder`: id,patientId,name,strength,dose,route,times,startDate,endDate,instructions,status,createdAt,updatedAt. `MedicationEvent`: id,patientId,orderId,date,time,status,reason,note,revision,reportedAt. 보고 시각이 실제 섭취 시각이라는 보장은 없다.
- schedule slots는 orderId,patientId,date,time,name,strength,dose,route,instructions,status,eventId,reason,note,revision,reportedAt. 미보고는 eventId/reportedAt=null,revision=0. summary는 total/taken/missed/unknown/pending/reported. events 응답은 `{date,events,audit}`이며 audit는 previous/current와changedAt을 보존한다. 계획 생성 필수값은 name/dose/times/startDate, strength/route/instructions 기본 빈 문자열,endDate 기본null이다.

## 사진 분석

v0.5 활성화/오류 계약은 GPT_ACTIVATION.md가 기준이다. vision capability에 reasonCode를 추가하며 available을 실제 제공자 인증/추론 검증으로 해석하지 않는다. 서버 키·동의·초안·섭취비율 저장 계약은 유지한다.

- `GET /api/capabilities` → 외부 사진분석 설정 여부, 모델/제공자, 건강 웹 직접수집 불가, 네이티브 연결부 구현/검증 상태. API 키 값은 반환하지 않는다.
- `POST /api/patients/:id/photo-analyses` 입력 `{kind:'meal'|'medication',imageData,consentExternalProcessing:true}`. JPEG/PNG/WebP 최대5MB, magic bytes 검증. 미설정503, 제공자 오류502/시간초과. 사진 속 텍스트를 시스템 지시로 실행하지 않는다.
- 분석 결과는 `{analysis:{id,patientId,kind,provider,model,createdAt,expiresAt,proposal,warnings}}`. 항상 검토가 필요한 초안이며 제안된 영양은 추정이다.
- 식사 proposal: `{foodType,foodLabel,foods:[{name}],calories,proteinGrams,confidence}`. 값은 사진에 보이는 식사 전체의 추정이며 섭취량은 환자가 확인한다. 약 proposal: `{medications:[{name,strength,labelText}],confidence}`. 용법/복용 시간은 의료진이 확정한다.
- `POST .../meals` 기존 입력에 `analysisId`, `patientConfirmed:true`를 추가할 수 있다. 서버가 같은 환자·kind·유효기간·이미지 hash를 검사하고 초안의 영양값에 portion을 적용한다. 클라이언트가 영양값/출처를 임의 지정하지 못한다. 초안은 1회만 적용한다. 고정 표와 AI 추정의 출처가 다르다.
- 원본 사진은 기존 식사 저장 때만 보관한다. 분석 초안에는 원본 전체 대신 이미지 hash·제안·제공자/모델/시간을 보존한다. 외부 처리 동의 없는 사진을 전송하지 않는다.
- AI 식사 입력은 **먹기 전 제공된 전체 음식 사진**을 기준으로 하고 식후 실제 섭취비율을 확인한다. 남은 음식 사진을 원래 제공량으로 취급하지 않는다. 분석 중 DB 초기화/환자 교체가 발생하면 generation 불일치로409이며 늦은 결과를 새 데이터에 연결하지 않는다.
- vision capability는 `{enabled,configured,available,provider,model,reason}`. enabled는 명시적 기능 flag, configured는 유효한 키/모델 설정, available은 둘 모두 충족이다. 키는 `HOMECARE_VISION_API_KEY`, 기본 모델은 `gpt-4.1-mini`, 활성화는 `VISION_ENABLED=true`일 때만이다.
- OpenAI `/v1/responses`, input_image data URL, strict JSON Schema, `store:false`를 사용한다. 초안24시간, 환자당동시1건/전체2건/10초간격, 제공자시간초과30초/자동재호출없음. 같은 환자/종류/사진 hash의 유효한 미사용 초안은 재사용한다. confidence 0..1은 모델 자체 판단이며 검증된 정확도 확률이 아니다.
- 분석 확정 해석은 `{analysisId,foodType,foodLabel,calories,proteinGrams,source:'openai-image-estimate-v1',estimation}`을 반환한다. calories/proteinGrams는 섭취비율 적용 전, 서버가 portion을 곱한다. estimation은 provider/model/시각/proposal/warnings/patientConfirmed를 보존한다.

## 건강 수신 기반

v0.5는 IOS_CONNECTOR.md에 따라 iPhone을 우선한다. preflight에 `serverTime`(서버 ISO8601 현재시각)을 추가한다. health capability에 platforms별 implemented/verified를 추가하되 기존 nativeBridge의 보수적 false는 유지한다. iOS 빈 조회는 키 생략이며 자동 삭제를 보내지 않는다.

v0.4 부분 권한/항목별 revision 확장은 SMARTPHONE_SYNC_SPEC.md가 기준이다. day의 steps/sleepMinutes는 최소 하나 필수이며 생략은 보존, null은 명시적 삭제다. health_daily의 steps_updated_at/sleep_updated_at으로 각 항목의 최신 수정만 적용한다. 이전 전체 스냅샷 및 batch hash 호환은 유지한다. preflight는 partialMetrics:true/selected를 추가하며 새 Android는 이를 먼저 확인한다. schemaVersion3 추가 마이그레이션으로 기존 자료를 보존한다. 아래 v0.3의 두 항목 전체 전송은 계속 유효하다.

- `GET /api/patients/:id/health-connections`: 연결과 마지막 수신, 웹 직접수집 불가, 선택 출처, 준비 상태.
- `POST /api/patients/:id/health-connections`: `{platform:'health-connect'|'apple-health',label?}` → 연결 ID와 최초1회 표시하는 비밀 token. 토큰 hash만 DB 저장. 새 선택 출처는 기존 자료를 삭제하거나 두 플랫폼 합계를 가산하지 않는다.
- 웹의 일회성 연결 안내에는 서버 origin, 환자 이름, 정확한 patientId를 함께 표시한다. 앱 입력값과 대조할 수 있어야 하며 화면 이동·환자 변경·코드 숨김 시 token과 함께 이전 연결 정보를 지운다. URL 전체나 환자 이름을 patientId 대신 사용하지 않는다.
- `DELETE /api/patients/:id/health-connections/:connectionId`: 해당 연결 폐기. 새 수신 차단, 과거 자료 보존.
- `POST /api/health-sync`: `Authorization: Bearer ...`, `{batchId,timeZone:'Asia/Seoul',days:[{date,steps,sleepMinutes,updatedAt}]}`. 최대31일, steps정수0..100000 또는null, sleepMinutes0..1440 또는null. updatedAt은 플랫폼 집계 revision의 시각이다. 같은 connection/date는 upsert, 오래된 revision은 무시, 같은 batch 재전송은 중복 생성 금지.
- `GET /api/health-sync/connection`: 같은 Bearer로 `{connectionId,patientId,platform,partialMetrics:true,selected}`를 확인한다. 네이티브 앱은 환자 ID·연결 주체를 먼저 대조한 뒤 건강 저장소를 읽고 전송한다. 잘못 복사한 토큰으로 다른 환자에게 자료를 먼저 보내지 않는다. 토큰 폐기/오류는401이며 원문 토큰은 반환하지 않는다.
- 일별 입력은 플랫폼이 폰·워치 원자료 중복을 정리한 집계다. 서버가 서로 다른 기기/플랫폼 값을 더하지 않는다. 원자료 삭제로 수정된 합계는 더 최신 revision의 null/0을 포함해 교체한다.
- 수동 일일 기록과 기기 전송을 별도 저장한다. 요약 출처의 우선순위는 명시적 수동값이 있으면 수동, 없으면 선택된 연결의 집계다. 0도 명시적 수동값이다. 수동 보완을 지우면 기기값으로 복귀한다. UI에 선택 출처·마지막 수신·미연결을 표시한다.
- 이 수신 API의 구현/fixture 테스트는 실제 폰·워치 자동 연동 완료를 뜻하지 않는다. 네이티브 권한/기기/백그라운드 검증은 별도 인수조건이다.
- connections 응답은 `{connections,selectedConnectionId,webDirectCollection:false,nativeBridge:{implemented:false,verified:false}}`. 연결은 id,patientId,platform,label,status(awaiting_native/connected/revoked),selected,createdAt,lastReceivedAt,revokedAt. 생성은 `{connection,token}`, 폐기는 `{connection}`. 새 연결 선택은 기존을 선택 해제하며, 선택 연결 폐기 시 자동 다른 출처로 전환하지 않는다.
- 수신 결과는 `{connectionId,patientId,batchId,duplicate,acceptedDays,ignoredDays,receivedAt}`. 같은 batchId에 다른 payload는409. 요약용 선택 연결의 자료는 date,steps,sleepMinutes,sleepHours,updatedAt,receivedAt,connectionId,platform,source를 포함한다. 비밀 token은 이 응답/자료에 재노출하지 않는다.
- 요약의 todayRecord/recentRecords/trends는 표시용 유효값이며 stepsSource/sleepSource가 `patient-self-report|health-connect|apple-health|null`, dataOrigin이 `manual|device|mixed`이다. metrics.steps/sleepHours.sourceCounts는 출처별 보고 일수다. `GET .../daily`는 수동 원본만 반환해 기기값을 다시 수동값으로 저장하지 않는다. CSV 일일자료도 유효값과 각 출처를 표시하고 복약 회차·기기 수신 원본은 recordType으로 구별한다. 비밀 연결 토큰은 내보내지 않는다.

## DB 변경

추가 table/column은 존재 확인 후 transaction에서 생성한다. 기존 DB/기록을 보존하고 migration 재실행이 안전해야 한다. 새 table은 patient FK CASCADE를 사용해 명시적 데모 reset에서 함께 정리한다. 분석 초안의 적용 이력은 식사 삭제 이후에도 재적용을 막는다. 연결 토큰/외부 키는 CSV·리포트·로그에 넣지 않는다.

metadata.generation은 DB 초기 생성과 명시적 reset마다 바뀌는 UUID다. 기존 DB에 없는 경우만 추가하고, 비동기 분석 시작/완료 사이 generation을 대조한다. 요약의 stable은 '확보된 기록에서 규칙 미해당'일 뿐 건강 안정 진단이 아니다. 활동/수면/복약의 최소 자료 기준 중 부족 영역이 있으면 missingData=true와 자료부족을 표시한다. 복약 자료 충분성은 기존 일일 보고와 명시적인 약별 회차 보고일을 함께 참고하되, 일일 점수와 약별 횟수는 섞어 계산하지 않는다.

복약 최소자료는 taken/partial/missed인 일일 보고일과 taken/missed 회차 보고일의 합집합으로3일을 확인한다(unknown은 알려진 복용 상태가 아님). 미복용 확인 규칙은 일일 또는 회차별 missed 날짜를 중복 없이 합친다. metrics.medication의 기존 점수/일수는 기존 일일 의미를 유지하며 doseReportedDays/doseReportedSlots로 약별 자료 존재를 따로 전달한다. 브리핑은 두 종류를 명시하고 근거를 분리한다.

## MED-PHOTO-01 사진 첨부 복약 보고 (schema5)

MEDICATION_PHOTO_DEMO_SPEC.md의 POST/GET medication-photo-reports 및 image 경로·expectedRevision·일괄 원자성·UUID 재전송 계약을 따른다. OCR 추정/환자 자기보고/의료진 검토 상태를 분리한다. 기존 수동 보고 API는 유지한다.

## v0.7.0 변경 계약 (코드 작성 전)

상세 payload·상태·단위·오류·동시성·호환성은 USABILITY_IMPLEMENTATION_PLAN의 식사/일일·기간/반출·직무/업무·문헌 API 절을 따른다. portion=null/0 허용, 식사 UUID 재전송, daily revision/감사, 약별 보고일 포함, 명시 기간, 범위 CSV, 세션/CSRF 기반 역할·scope, 동결 가명 연구자료와 출처 보존 문헌 검토를 추가한다. 기존 다른 환자/출처/null·0/사진 snapshot 보호는 유지한다.

### v0.7.0 세부 기준의 위치

화면별 행위·오류는 SCREEN_SPEC, 새 API와 요청 키·revision·통계 분모·스냅샷 미리보기 해시 계약은 USABILITY_IMPLEMENTATION_PLAN, 문헌의 정확한 필드와 검토 근거는 EVIDENCE_WORKSPACE_SPEC이 기준이다. 실제 생성 테이블은 generated/SCHEMA, 선언·매개변수와 코드 위치는 generated/VARIABLES에서 대조한다. 완료 범위와 미검증 항목은 USABILITY_IMPLEMENTATION_REPORT에 기록한다.

## v0.8.0 환자 화면·음성 개선 (2026-10-24, 구현 전)

현재 새 변경의 요구·화면/상태·데이터·지원 범위·변수·검증 기준은 [PATIENT_VOICE_SPEC.md](PATIENT_VOICE_SPEC.md)를 따른다. 기존 v0.7.0 공통 규약을 계승하며 환자 본문20/도움18/누름56 목표, 행동/정보 구분과 인라인 음성 안내·음성 입력·할 일 알림을 추가한다. 기존 의료진/네이티브와 환자 기록 API는 유지하고 공지 영수증 테이블은 schema7로 추가한다. 음성 인식 결과는 확인 후 기존 입력칸에만 반영한다. 녹음·원고 자동 저장·백그라운드 전달을 구현 완료로 표시하지 않는다.
