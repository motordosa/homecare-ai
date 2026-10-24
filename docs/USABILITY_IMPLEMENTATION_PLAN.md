# 사용자 중심 개선 실행계획 — v0.7.0

2026-10-23. 사용자가 개선 전략에 따른 수정·검증·결과 보고를 지시했다. 이전 연구 보고서의 38개 발견사항과 36개 작업을 기준으로, 독립적으로 검증 가능한 기본 기능을 순서대로 구현한다. 이번 버전은 합성자료 데모 개선이며 연구 운영 승인을 뜻하지 않는다. 계획 작성 당시 코드는 v0.6.1/schema5, 목표는 v0.7.0/schema6이다. 최종 구현·검증 결과는 USABILITY_IMPLEMENTATION_REPORT.md를 따른다. 아래 계약을 먼저 저장하고 구현을 시작한다.

## 순서와 완료 조건

| 단계 | 보고서 작업 | 이번 구현 | 완료 증거 |
|---|---|---|---|
| 1 기획/기준 | G01~G04 | 화면·권한·단위·오류·이행 계약과 이 문서 | 기존 사용자 목적 보존, 파일별 담당과 변경/검증 연결 |
| 2 기본 사용성 | B01~B06 | 큰 글자/대비/터치, 공지 요약, 입력 보존, 정확한 지표, 범위 CSV | 320/390px 화면·계산 스타일·미저장/저장 중·보고일/범위 회귀 |
| 3 환자 기록 | P01~P07 | 오늘 행동, 단계 안내, 시간별 복약, 섭취량 무선택/모름/안먹음, 지속 완료, 쉬운 도움·사진 처리 | null/0, 부정확한 기본 저장 방지, 사진 오류·중복 저장·기존 X/history |
| 4 의료진 업무 | W01~W06 | 서버 역할/대상 범위, 업무 목록·사진 검토·정정 이력·참여 기간, 위임 기반 | 직접 API 권한·revision/재전송·당시 사진 보존·기관 범위 |
| 5 연구·문헌 | S01~S03, L01~L02 | 기간/대상/출처 기술통계, 동결 자료·가명 반출, 검색·보관·사람 검토 | 참조 수치·N/행수·결측·재현성·범위·모의 제공자 오류/인용 검증 |
| 6 종합 검증 | B06/P08/R02~R04의 자동화 부분 | 기존+새 API/브라우저 검사, 생성 문서, 독립 검토, 결과 보고 | 통과/실패/미실행/외부대기 구분. 공개 DB 변경 없음 |

보류/외부 관문: 실제 고령자·직무별 평가(P08/R03), 기관 프로토콜·동의·역할 정책 승인(G01/G03/W06), 실제 카카오·HealthKit/Health Connect 활성화, 보호자의 실제 계정 연결, 실서비스 문헌 API 도달/약관 확인, 연구용 영구 저장·백업복원 운영 승인(R01/R04)은 구현/합성자료 검증과 구분한다. S04의 추론 비교, S05 전문모형·대치, L03 AI 문헌 요약은 보고서의 별도 승인 범위로 유지한다. 이를 가짜 성공 화면이나 임상 성능으로 표시하지 않는다.

## 공통 화면 규약

- 환자 주요 본문18px 이상·필수 도움16px, 주요 누름 영역48px 이상을 제품 목표로 둔다. 일반 글자 대비4.5:1. 확대/긴 한국어/키보드와 320px 재배치를 검증한다. WCAG 인증을 주장하지 않는다.
- 환자 기존6개 경로와 X/history 목적지는 보존한다. 탐색은 큰3열×2행 배치로 읽기 쉽게 하고 홈 핵심 행동을 앞세운다. 메뉴3개로 축소하는 안은 실제 사용자 비교 후 결정한다.
- 공지는 상단에 가장 중요한1건과 전체 펼치기를 제공한다. 모두 읽기와 버전별 읽음은 유지한다.
- 완료는 대상/날짜를 포함한 지속 표시. 서버 저장 성공과 후속 조회 실패를 구분한다. 오류는 관련 필드·설명에 연결하며 입력 유지·재시도 경로를 둔다.
- 모든 의료진 입력 대화상자에 baseline/dirty/busy 적용. X/Escape/메뉴/환자/날짜/뒤로/로그아웃에서 같은 원칙. 저장 중 문맥 이동 금지, late response 무효화. 동일 문맥의 갱신은 열린 상세·포커스·스크롤 보존.
- 카카오 세션 만료 시 작성 중인 DOM을 지우거나 자동으로 페이지를 떠나지 않는다. 별도 로그인 창 후 세션 재확인을 제공하되 같은 사용자임을 확인해야 재개한다. 초기 익명 진입은 기존 로그인 경로 유지. 건강자료를 localStorage에 평문 저장하지 않으며 강제종료/장기오프라인 복구 완료라고 표시하지 않는다.

## 식사·일일 기록 계약

- 새 식사·일일 자기보고의 미래 날짜는 서버에서도400으로 거부한다. 과거부터 존재한 미래 import 자료는 분석 기간 밖으로 제외하며 자동 삭제하지 않는다.
- POST meals: `portion`은 필수이며 null(먹은 양 모름),0(먹지 않음),0.25/0.5/0.75/1 중 하나. 미선택과 null은 다르다. 음식 유형은 명시 선택 또는 확인한 사진 초안에서 얻는다. UI에서 밥/모두를 기본 확정하지 않는다.
- portion=null이면 calories/proteinGrams=null. 실제0이면 영양0. 기록된 알려진 끼니만 영양 합계에 포함하고 unknownMealCount를 병기한다. 모두 모르면 합계도null이다.
- `clientSubmissionId`(UUID) 선택 필드: 환자/요청ID와 payload hash를 결합. 동일 재전송은 같은 식사, 다른 내용은409. 사진 분석 소비 확인 전에 이전 성공 결과를 조회한다. 파일 저장 실패/DB 실패는 정리하며 사진과 중복 식사가 생기지 않는다.
- SQLite 기존 meals의 NOT NULL을 해제하는 schema6 이행은 트랜잭션 안에서 기존 행·ID·사진·추정 provenance·인덱스를 그대로 복사하여 제약만 변경한다. 지원하지 않는 추가 컬럼이 있으면 중단한다. DB 파일 삭제/초기화로 이행하지 않는다. v1/v5→v6 보존·재실행·외래키 검사를 수행한다.
- POST medication-orders의 선택 clientRequestId(UUID)는 환자별 동일 요청/내용 재전송에 같은 계획을 반환하며 변경된 내용은409다. 날짜/약명 등 정규화된 입력과 hash를 보존한다.
- daily_records.revision을 추가한다. 기존 POST는 호환하며 expectedRevision이 있으면 충돌409, 저장 시 증가. 변경 전후·행위자·사유/출처를 감사 이벤트로 남긴다. 직원의 임상 자료 정정은 정정요청/승인 경로를 사용한다.

## 지표·기간·반출 계약

- patientSummary(db,id,{startDate,endDate})는 기본 기존7일 요약/28일 추이를 유지하며 명시 기간은 1~366일·미래 제외로 계산한다. 모든 카드에 기간·분모·자료수가 일치해야 한다.
- 일일·기기·식사와 약별 자기보고의 날짜 합집합을 보고일로 센다. 약별 보고만 있어도 lastRecordDate/dashboard 보고가 존재한다. 프로토콜이 확정되지 않은 비율은 ‘선택 기간 기록일 비율’이며 연구 완결률이 아니다. 일일 복약 partial=.5 점수는 약별 회차 비율과 구분한다.
- GET /api/export-preview, GET /api/export.csv: patientId 선택/전체·startDate/endDate 필터 동일 적용. 미리보기 환자수/기간/열/행수와 결과 일치. 기존 기본 전체 내보내기는 명확히 표시하되 접근 범위 제한. 연구용 반출은 아래 별도 가명 스냅샷 경로만 사용한다.
- 연구 preview: GET /api/research/preview?startDate&endDate&patientIds(쉼표)&source. 환자N/관측수·유효값·null/0·기기/자기보고·표본SD·type7 분위수·환자평균을 구분한다. 결측 자동 대치·p값 없음.
- POST /api/research/snapshots {clientRequestId,startDate,endDate,patientIds?,source}; GET /api/research/snapshots/:id; GET .../:id/export → {manifest,columns,csv}. 스냅샷은 가명 자료/recipe/input hash/분모/코드버전/생성자·시각을 보존하며 읽을 때 현재 권한·대상 범위를 재검사한다. 실명·자유서술·사진 기본 제외.

## 직무·업무 API 계약

- 서버 설정 STAFF_ACCESS_JSON은 Kakao ID별 {roles:[clinician|support|researcher|administrator],patientIds:[...]}를 지정한다. 클라이언트 역할 선택으로 권한을 부여하지 않는다. 기존 CLINICIAN_KAKAO_IDS는 임상 역할 호환이다. 미설정/잘못된 설정은 권한을 넓히지 않는다.
- actor/session에 staffRoles/capabilities/assignedPatientIds를 공개한다. 공개 데모의 기존 API 호환은 유지하되 새 업무·연구·문헌 API는 demo에서도 세션+변경CSRF를 요구한다. 데모 clinician은 합성 검수 권한을 갖고 실제 임상 자격으로 표시하지 않는다.
- capability 문자열: patient.read, clinical.write, workflow.write, workflow.review, correction.propose, correction.approve, research.read, research.export, evidence.read, evidence.review, notice.write, message.write, participation.write, delegation.write, admin.reset. 환자/기관 범위는 각 자료 접근 때 검사한다. 실제 모드 초기화는 기본 거부한다.
- GET/POST /api/clinician/tasks; PATCH /api/clinician/tasks/:id. 상태 new/in_progress/waiting/review_requested/completed. patientId/type/title/note/assignee/status/version/clientRequestId. 임상 검토 업무의 완료는 workflow.review 필요. 기존 알림과 별도이며 담당/기한/이력 보존.
- GET/POST /api/patients/:id/photo-reviews. 검토 대상 reportId, 상태/사유/version/clientRequestId; 사진 원본/당시 보고 snapshot은 수정하지 않음. ‘사진 검토’는 실제 복용 증명이 아님.
- GET/POST /api/patients/:id/corrections; PATCH /api/clinician/corrections/:id. 일일 기록의 원본 snapshot/revision+변경 제안·사유, 승인/반려는 별도 임상 권한. 동시 원자료 변경이면409, 원본/전후/승인자를 남긴다.
- GET/PUT /api/patients/:id/participation: 시작/종료/상태/필수 항목·동의 버전/정정 버전. 미보고와 정식 중단을 구별하며 연구 정책 승인 자체로 표시하지 않는다.
- GET/POST /api/patients/:id/delegations, DELETE .../:delegationId: 위임의 범위/기간/철회 기반. 실제 보호자 인증·기록 권한 부여는 별도 관문 전 활성화하지 않는다.

## 문헌 API·화면 계약

- POST /api/clinician/evidence/search {query,yearFrom?,yearTo?,cursorMark?,confirmNoPersonalData:true}. 고정 EuropePMC HTTPS 제공자만 사용, query2~500자. 외부 요청의0건/시간초과/429/실패 구분. 성공 검색의 조건/시간/결과 snapshot 보존. 실제 연결 가능 여부를 모의 검증 결과와 구별한다.
- GET /api/clinician/evidence → 검색/보관 목록. POST /api/clinician/evidence/bookmarks {searchId,articleKey}는 서버 검색 결과의 실제 식별자를 사용한다. PATCH .../bookmarks/:id {version,status:saved|included|excluded|reviewed,note,evidenceText,locator}; reviewed는 evidence.review 필요. 초록/전문 확보 범위·철회 불명 상태를 보존하고 원문 링크만으로 전문 열람이라 하지 않는다.
- 새 C-WORKLIST(view=worklist), C-RESEARCH(research), C-EVIDENCE(evidence)는 기존 데스크톱 셸의 메뉴/제목/뒤로/선택 환자를 사용한다. 공통 기간은 자료 조회와 내보내기에 적용한다. 권한 없는 메뉴를 숨기고 직접 API도 차단한다.
- 각 module은 create...Workspace({api,getState,toast}) → mount/deactivate/canLeave/dirty/busy/refresh 형태. 신규 화면 상태의 빈자료/로딩/실패/재시도를 제공하고 저장 중 공통 탐색을 잠근다.

## 파일 담당·통합 검증

환자 담당: patient HTML/CSS/JS·communications·medication-photo·새 patient-image.js. 의료진 담당: clinician HTML/CSS/JS·communications·새 clinician-workflow.js/clinician-research.js. 업무 담당: workflow/staff-access/auth/db 및 업무 테스트. 연구 담당: analysis/research와 수치 테스트. 문헌 담당: evidence·clinician-evidence와 모의 제공자 테스트. 통합 담당: server/meals/session·공통 문서·schema/화면 검사·버전·최종 보고. QA 담당: 새 통합/브라우저 회귀.

검증은 임시 DB만 사용한다. 기존 Node/브라우저/자동화/인증/약사진 검사를 실행하고 의미가 바뀐 기본선택 등은 새 명세에 맞게 고친다. 새 UI/API를 시험하지 않고 기존 테스트 통과만으로 완료 판정하지 않는다. 생성 변수·스키마·화면 계약 검사를 마지막에 실행한다. 실제 고령자 성공률·실 AI·외부 문헌·실기기·공개 배포는 별도 상태로 보고한다.

### 통합 검토에 따른 재시도 계약 보강

- 일일 기록 POST의 `clientSubmissionId`는 선택 UUID이며 환자·요청 키별 요청 해시와 저장 당시 응답을 보존한다. 같은 키/같은 내용은 `expectedRevision` 재검사 전에 기존 응답을 반환하고, 같은 키/다른 내용은409이다. 환자 UI는 내용이 같으면 재전송 키를 유지한다. 실제 새 변경의 수정번호 충돌은 계속409이다. 저장 응답만 끊겼을 때 안전한 재시도가 목적이다.
- 연구 스냅샷 POST의 `expectedInputHash`는 미리보기의 입력 해시이다. UI는 필수로 보내며, 서버는 전달된 해시와 현재 자료를 트랜잭션 안에서 비교해 바뀌었으면409/재미리보기를 요구한다. 동일 키 재전송은 먼저 기존 스냅샷을 반환한다. 키에는 입력 해시를 포함한 요청 내용을 결합하므로 조건이 같더라도 새 자료 미리보기는 새 저장이다.
