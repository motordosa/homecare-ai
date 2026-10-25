# 화면별 제작·동작 명세 v0.8.1 개발 기준

## REL-01~08 변경 제작 규약 (2026-10-25, 구현 전 확정)

| 화면 | 상태·조작·코드·인수조건 |
|---|---|
| P-SHELL 초기/환자 변경 | patient.js bootstrapApplication, session.js: 초기 재시도는 인증 조회부터 실행.20초 내 요청 종료·재시도 제공. 이전 환자 자료로 성공 표시 금지 |
| P-DAILY/P-STEPS/P-SLEEP | 원본 조회 중 말로 입력 비활성·불러오는 중 안내. ready일 때만 현재 항목과 날짜로 패널 생성. 오류 시 같은 날짜 다시 불러오기, 성공 시 입력·음성·저장 복구. 닫기/날짜변경 뒤 늦은 응답 폐기 |
| P-MEAL/P-DAILY 저장 | 진행 상태와5초 뒤 지연 안내. 응답 유실이면 저장 결과 확인 버튼으로 같은 본문/UUID 재시도. 결과 확인 전 수정은 잠시 잠그되 X/수동 이탈은 경고 후 가능. 확정 저장 뒤 목록 조회 실패는 별도 표시 |
| P-CONNECT | 발급 요청 UUID 재사용, 응답 유실 시 같은 시도 결과 확인. token 재표시 불가이면 그 연결만 명시 재발급. 폐기·새 발급도 중복 클릭 차단. 다른 정상 연결/기록 보존 |
| P-VOICE-INPUT | PATIENT_VOICE_SPEC의 시작/중지 제한·늦은 결과 무효·초안 보존. 수동 입력 대안, 실제 마이크 종료 확인과 UI 복구를 구별 |
| P-VOICE-GUIDE/P-GUIDE | VOICE_PLAYBACK_CONTRACT의 짧은 안내/전체 듣기/목소리·속도 미리듣기·발화 제한. 한국어 미지원이면 텍스트 대안 |

기존 상단/하단 메뉴와 X 복귀 규약을 그대로 사용한다. 새 배포는 실제 iPhone Safari 마이크 검증 이후에만 가능하다.

현재 기준일: 2026-10-24 KST. 요구사항 NAV-04/GOV-02/QA-02/AUTH-01..03/COM-01..03 및 사용자 중심 개선 B/P/W/S/L 작업. 최초 제작 기준에 승인된 변경을 통합한 현행 명세다. 현재 환자 화면·음성/공지 변경 범위는 [실행계획·제작 명세](PATIENT_VOICE_SPEC.md), 기존 v0.7.0 변경은 [이전 실행계획](USABILITY_IMPLEMENTATION_PLAN.md), 완료·검증·보류 상태는 [현재 실행 결과 보고서](PATIENT_VOICE_REPORT.md)와 [변경 이력](CHANGELOG.md)을 따른다. 제품 목적·의료 의미는 PRODUCT_PLAN/CONTRACTS가 기준이며, 이 문서만으로 공개 배포나 실제 사용자 검증 완료를 뜻하지 않는다.

## 1. 공통 화면 구조와 책임

인증·공지·메시지는 [AUTH_COMMUNICATION_SPEC.md](AUTH_COMMUNICATION_SPEC.md), v0.7.0 화면·직무·통계·문헌 변경은 [USABILITY_IMPLEMENTATION_PLAN.md](USABILITY_IMPLEMENTATION_PLAN.md)를 따른다. 공통 header/X 바로 아래 auth strip(계정 조작은 펼치는 ‘계정 관리’)→P-NOTICES→본문 순서다. 환자는 홈/내 기록/복약/메시지/건강 연결/이용 안내의 6개 경로를 유지하고 하단을 3열×2행으로 배치한다. 의료진은 케어 대시보드/환자 관리/복약 계획/건강 기록/업무 목록/연구 분석/문헌 검토/공지 관리/환자 메시지/데모 설정의 10개 경로 중 서버가 허용한 메뉴만 표시한다. 과거 5개·7개 메뉴 규약은 현행 기준이 아니다.

환자는 모바일 웹, 의료진은 데스크톱 웹이다. 각 화면은 아래 ID로 관리한다. 화면별 명세 없이 새 버튼·메뉴·페이지를 추가하지 않는다. 화면 ID, 진입점, 상단/하단 메뉴, 닫기 목적지, API, 입력값, 상태, 코드 위치, 인수 사례를 먼저 정한다.

### 환자 공통 셸 P-SHELL

| 영역 | 제작 규약 | 코드 책임 |
|---|---|---|
| 상단 왼쪽 | HomeCare 로고는 **같은 환자의 홈**으로 이동한다. 시작 화면 `/`이나 의료진으로 이동하지 않는다. | patient.html의 `#patient-home-link`; patient.js의 공통 탐색 처리 |
| 상단 오른쪽 | 홈에서는 닫기 숨김. 모든 일반 서브 화면에는 같은 크기·모양·위치의 X, 접근성 이름 `홈으로 돌아가기`. 역할 전환 링크를 이 자리에 배치하지 않는다. | `#patient-view-close`, `renderNavigation` |
| 환자 문맥 | 선택 환자·오늘 날짜를 공통 위치에 표시. 선택 변경 시 이전 환자의 요청·초안·토큰을 무효화한다. | `#patient-select`, `loadPatient` |
| 하단 | 홈/내 기록/복약/메시지/건강 연결/이용 안내 순서, 3열×2행 고정. 활성 항목 하나만 `aria-current=page`. 아이콘·문구·터치 영역은 페이지마다 바꾸지 않는다. | `.bottom-nav`, `applyView` |
| 역할 전환 | 환자 상단/닫기 영역에는 의료진 링크 없음. **이용 안내의 ‘데모 역할 전환’ 구역**에서만 같은 patientId의 의료진 링크 제공. | `#guide-clinician-link` |
| 저장 중 | 중복 저장·환자 변경·화면 변경·닫기 차단. 버튼을 실제 disabled 상태로 표시한다. 브라우저 뒤로가기도 저장 대상을 바꾸지 않는다. | `state.saving`, 공통 busy 처리 |
| 읽기·조작·반응형 | 주요 본문20px 이상, 필수 도움18px 이상, 주요 누름 영역56px 이상을 제품 기준으로 사용한다. 일반 글자 대비4.5:1, 320/390/480px·키보드·긴 이름·확대 재배치를 검사한다. 표시 순서는 DOM·키보드 순서와 일치하며 ‘글자 더 크게’를 제공한다. WCAG 인증이나 고령자 실사용 평가를 대신하지 않는다. | patient.css의 `.patient-accessible`, patient.js |
| 완료·연결 오류 | 저장한 대상·날짜·항목을 닫기 전까지 표시한다. 저장 성공과 후속 조회 실패를 구별한다. 연결 복구는 안내만 하고 자동 재전송하지 않는다. | `savedFeedback`, `savedRefreshFailed`, `networkNotice` |
| 세션 만료 | 작성 중인 DOM을 보존하고 별도 창 로그인 후 같은 계정·역할·환자 범위인지 확인한 다음 재개한다. 복구 전에는 API 쓰기·로그아웃 우회로 초안을 잃지 않도록 공통 가드를 적용한다. 강제 종료나 새로고침 뒤 초안 복원을 보장하지 않는다. | session.js |

### 닫기·복귀 계약

1. **일반 서브 화면 X:** 해당 화면만 닫고 환자 홈. 현재 환자 ID 유지. 현재 history 항목을 홈으로 replace해 닫은 화면을 즉시 다시 여는 루프를 피한다.
2. **입력 대화상자 X:** 현재 입력 대화상자만 닫고 **열었던 환자 화면**으로 복귀. 홈에서 열었다면 홈, 건강 연결에서 수동 입력을 열었다면 건강 연결이다. X는 어느 입력 화면에서도 닫기 역할만 한다.
3. 대화상자 X/Escape/바깥 영역 클릭은 같은 닫기 함수를 사용한다. 실제로 입력을 바꿨다면 저장하지 않고 나갈지 확인한다. 거절하면 입력·초안·포커스를 유지한다. 기본값/서버에서 불러온 값 자체는 변경으로 간주하지 않는다.
4. 약별 보고를 편집하고 저장하지 않은 채 일반 페이지/환자를 바꾸는 경우에도 확인한다. 저장 중에는 확인창 대신 이동 차단. 미저장 입력은 localStorage/URL에 저장하지 않는다.
5. 닫기 후 포커스는 진입 버튼 또는 현재 화면 본문으로 이동한다. 일반 화면 진입 시 본문, 식사 근거 바로가기는 해당 영역으로 이동한다. 대화상자에서는 배경에 포커스가 가지 않는다.
6. URL에는 patientId/view/metric/section/medication date만 저장. 토큰·사진·미저장 값은 금지. 뒤로가기/앞으로가기는 같은 환자 문맥과 활성 메뉴를 복원한다. 입력 중 경로 변경을 취소하면 현재 URL도 복원한다.
7. 이전 문서를 다시 여는 뒤로가기·새로고침·탭 닫기는 SPA의 popstate만으로 보호되지 않는다. 미저장/저장 중이면 beforeunload로 브라우저 이탈 확인을 요청한다. 확인 문구·표시 여부는 브라우저 정책과 사용자 상호작용에 따르며 강제 종료를 막는다고 보장하지 않는다. 이탈 취소 시 현재 입력 유지.

## 2. 환자 화면별 계약

| 화면 ID / 코드 | 진입·목적 | 상단/닫기·하단 | 자료/API·변수 | 성공·빈 자료·실패 |
|---|---|---|---|---|
| P-HOME / `#view-home`, `renderHome` | `/patient`, 홈 메뉴, 서브 X. 오늘 할 입력과 쉬운 도움을 우선 배치 | 공통 로고; X 숨김; 홈 활성 | summary/todayMedication, todayRecord, todayMeals | 기록 종류 수와 기록 여부 표시; 양 미상 식사와 미기록·실제0 구별; 약별 일정과 일일 점수 분리; 오류는 공통 재시도 |
| P-RECORDS / `#view-records`, `renderRecords/renderChart` | 내 기록, 최근 식사, 단백질 카드. 기록·근거 조회 | 공통 X→홈; 내 기록 활성 | summary recentRecords/trends/recentMeals; metric/section | 값 없음은 빈 차트/안내. 식사는 실제 최근 제공 건수 명시. 기록 편집은 해당 날짜 P-DAILY |
| P-MED / `#view-medication`, `loadMedicationSchedule/saveMedication` | 홈 복약 카드/하단 복약. 날짜·시각별로 묶은 약·회차 보고 | 공통 X→홈; 복약 활성. 의료진으로 보내는 상단 링크 없음 | GET medication-schedule, POST medication-events, orderId/date/time/status/reason/note | 미보고 회차는 상태 무선택, 사유·메모는 선택 펼침. 저장 후 같은 날짜·화면 유지. 날짜 표시와 저장 대상이 다르면 저장 차단·복원. 일정 없음→P-LEGACY. 조회 실패면 입력 불가·재시도 |
| P-CONNECT / `#view-connections`, `loadConnections/createConnection` | 하단 건강 연결. 출처·수신·코드 관리 | 공통 X→홈; 건강 연결 활성 | GET/POST/DELETE health-connections, connections/connectionRequestId | 코드 생성은 연결/수집 성공이 아님. 토큰·origin·이름·ID 일회 표시, 숨김/이탈/환자 변경 시 제거. 연결 없음과 서버 실패 구분 |
| P-GUIDE / `#view-guide` | 이용 안내. 촬영·섭취량·자기보고·연동 설명, 저장하지 않는 기록 연습 | 공통 X→홈; 이용 안내 활성 | 연습은 서버 쓰기 없음; 역할 전환에만 patientId 사용 | 연습 결과에 실제 저장하지 않았음을 표시. ‘데모 역할 전환’ 구역에서 의료진으로 이동한다는 목적 명시 |
| P-MEAL / `#meal-dialog`, `openMeal/saveMeal` | 홈 식사 버튼·기록 화면 식사 추가. 사진/음식 확인→실제 섭취량 선택→저장 | 입력용 공통 상단 X→진입 화면. 배경 하단 탐색 비활성 | date/mealType/imageData/foodType/portion/analysisId/patientConfirmed/clientSubmissionId; POST meals | 음식·섭취량은 무선택에서 시작. 음식은 직접 선택 또는 확인한 AI 초안, 양은 명시 선택. 모름=null, 안 먹음=0, 미선택=저장 불가. 실패 입력·동일 요청ID 유지. 성공 지속 표시. 사진 교체·닫기·날짜 변경·동의 철회→분석 무효 |
| P-DAILY / `#daily-dialog`, `openDaily('all')` | 홈 건강 기록/기존 날짜 수정 | 입력용 공통 X→진입 화면 | date, steps/sleepHours/weightKg/medicationStatus/appetite/mood/note 중 변경 항목, expectedRevision/clientSubmissionId; POST daily | 미기록 선택을 정상/복용으로 미리 채우지 않음. 원자료를 불러온 뒤 변경값만 저장. null/0 구별, 미래 날짜 거부. 동일 내용 재시도ID 유지·실제 정정 충돌409. 성공 지속 표시, 실패·닫기 취소 시 값 보존 |
| P-STEPS / 같은 dialog, `openDaily('steps')` | 걸음 카드·건강 연결의 직접 입력 | P-DAILY와 동일 X | date/steps만 표시·전송. 수동 원본만 baseline | 저장 시 수면·복약 불변. 직접 입력0 우선, 지우면 수신값 복귀 |
| P-SLEEP / 같은 dialog, `openDaily('sleep')` | 수면 카드·건강 연결의 직접 입력 | P-DAILY와 동일 X | date/sleepHours만 전송. 시간·분 보조 입력은 적용 버튼으로 시간 소수1자리 값에 반영한 후 저장 | 걸음 수·복약 불변. null/0 구별. 기기의 분은 서버에서 시간으로 변환 |
| P-LEGACY / `#legacy-medication-form` | P-MED에서 해당 날짜 약별 계획이 없을 때만 | P-MED 안의 구역이며 별도 메뉴/닫기 없음 | date/medicationStatus POST daily | 일일 자기보고임을 명시. 임의 처방 생성·약별 회차로 변환 금지 |
| P-MED-PHOTO / `#medication-photo-dialog`, patient-medication-photo.js | P-MED 사진 버튼, 선택 환자·날짜 고정. 사진 준비→약봉투 글자 확인→보고할 회차·상태 선택 | 공통 입력 X→진입 P-MED. dirty·busy·Escape·배경 클릭·포커스는 공통 셸 | 상세는 [MEDICATION_PHOTO_DEMO_SPEC.md](MEDICATION_PHOTO_DEMO_SPEC.md). 준비한 동일 사진 바이트를 분석·저장에 사용, clientSubmissionId 유지 | 약·상태 자동 선택 없음. 계획 없으면 진입 비활성. 외부전송 동의·최종 확인 필수. 실제 복용 증명 아님 |

### 화면 상태·취소·오류

| 상태 | 표시·조작 규칙 | 검사 |
|---|---|---|
| 최초 loading | 로딩 안내, 중복 진입/환자 선택 잠금 | 응답 지연 중 잘못된 환자 자료 노출 없음 |
| 환자0명 | 가상 환자 없음 안내, 의료진에서 생성하는 방법은 안내 구역 | 깨진 카드/undefined 없음 |
| 요약 조회 실패 | 공통 alert와 다시 불러오기. 재시도는 현재 환자·화면 유지 | 재시도 후 홈으로 조용히 바뀌지 않음 |
| 홈 복약 일정 조회 실패 | `일정 확인 필요` 표시, 하루 자기보고가 있어도 약별/복약 작업 완료로 추론하지 않음 | 일정 없음과 조회 불가 구별 |
| 서브 조회 실패 | 해당 영역 alert/재시도, 기존 초안 덮어쓰기 금지 | 복약 schedule 실패에 저장 버튼 생성 금지 |
| 입력 변경 | 공통 dirty 추적. 환자 입력만 변경으로 표시 | 초기값은 확인창 없음; 입력 후 X/Escape 취소면 유지 |
| 저장 중 | 동일 환자·회차/일자 고정, X/하단/환자 선택 잠금 | 느린 POST 중 클릭/뒤로가기로 섞이지 않음 |
| 저장 성공 | 서버 반영→입력 닫기 또는 회차 화면 유지→summary 갱신 | 저장과 summary 조회 실패를 구분 |
| 복수 회차 편집 | 한 회차를 저장하면 그 회차 상태/수정번호/집계를 갱신하고 다른 회차의 미저장 입력은 유지 | 요약 갱신을 위해 복약 폼 전체를 재생성하지 않음 |
| 입력 검증/전송 실패 | 값 유지·해당 오류 표시·재시도 | 뒤로 자동 이동/가짜 성공 금지 |
| 분석/조회 늦은 응답 | requestId/patientId/date/image hash/current view 검사 | 화면 이동 뒤 다른 화면에 결과 생성 금지 |

## 3. 의료진 화면별 계약

| 화면 ID / 코드 | 목적·진입 | 자료/조작 | 닫기·상태·인수조건 |
|---|---|---|---|
| A-LOGIN / `/login`, auth-page.js | 카카오 로그인·데모 안내 | GET auth/session·OAuth 시작 | 오류 원문/비밀 미노출, 안전한 앱 내부 복귀 |
| A-ACCOUNT / `/account`, auth-page.js | 본인ID·초대 연결·로그아웃 | POST auth/enroll/logout | pending은 다른 자료 불가, 의료진 역할 서버 지정 |
| P-NOTICES / `#patient-notices` | 환자 모든 일반 화면 최상단 공지 | GET active·POST read(version), 우선 공지1건·다른 공지 펼침·details 전문 | 초안/보관 제외, 공지0/조회실패 구별, 메뉴/X 유지. 펼친 공지와 버전별 읽음 유지 |
| P-MESSAGES / `#view-messages` | 메시지 하단 메뉴·대화/답장 | GET/POST patient messages·read, clientMessageId, 자주 쓰는 문구를 입력란에 추가 | 공통X→홈, dirty/busy·환자 격리·재시도 입력 유지. 문구 버튼은 자동 전송하지 않음. 저장 완료 지속 표시, 즉시 답변 보장 없음 |
| C-NOTICES / `notices`, clinician communication module | 공지 관리 메뉴·작성/편집 | 제목/본문/중요/status/version, GET/POST/PATCH | 초안/게시/보관·409·dirty/history 규약 |
| C-MESSAGES / `messages`, clinician communication module | 환자 선택·개별 대화 | conversations/messages/read, patientId URL | 전송 대상 고정·미저장 확인·값/포커스 갱신 보존 |
| C-INVITE / 의료진 modal | 선택 환자 초대 발급 | POST patient invitation, 일회 code/expiry | X→진입 화면, 코드 DOM 제거·늦은 응답 무효 |

P-MEAL의 GPT 동작·오류는 [GPT_ACTIVATION.md](GPT_ACTIVATION.md), P-CONNECT와 iOS I-CONNECT/I-ACCESS/I-SYNC/I-BACKGROUND/I-WEB/I-DISCONNECT는 [IOS_CONNECTOR.md](IOS_CONNECTOR.md)를 따른다. P-CONNECT는 iPhone 기본 선택·같은 화면의 접기식 설치/권한/동기화 안내를 제공한다. 별도 페이지 이동이나 상단 닫기 변경은 없다. C-SETTINGS는 GPT 설정 상태/모델/준비와 실제 검증의 구별·조회 실패/재시도를 표시한다. 서버 설정 확인은 GET capabilities만 호출하며 키 입력/노출·유료 추론은 하지 않는다. 사진·실기기·로그인 외부 설정의 실제 연결은 별도 검증 상태로 보고한다.

C-SETTINGS의 초기화 카드 제목 옆 database SVG는 24×24px, flex 축소 없음으로 제한한다. 아이콘이 카드 너비를 차지하거나 제목을 밀어내지 않으며 GPT 설정 카드와 같은 제목/버튼 체계를 유지한다.

데스크톱 공통 셸은 앞서 정한 10개 메뉴 순서에서 권한 없는 항목을 제외하고, 상단 페이지 제목/새로고침/기간과 선택 환자를 유지한다. 일반 페이지 X를 환자 앱처럼 임의 추가하지 않는다. 등록·종료·이력 대화상자는 우상단 X/취소 후 열었던 페이지로 복귀한다. 다른 역할로 이동하는 링크는 ‘환자 화면’이라고 명시한다.

메뉴 접근은 서버가 제공한 `capabilities`로 판단한다. `overview/patients/medications/records/worklist`는 `patient.read`, 연구는 `research.read`, 문헌은 `evidence.read`, 공지는 `notice.write`, 메시지는 `message.write`, 설정은 `admin.reset`이 필요하다. 지원 인력의 자료 정리와 임상 검토 완료·정정 승인을 구별하고 각 API도 권한·배정 환자를 재검사한다. 클라이언트의 역할 표시나 메뉴 숨김만으로 접근을 통제하지 않는다. 상세 직무표는 실행계획과 `lib/staff-access.mjs`를 따른다.

| ID / 구현 | 목적·진입 | 자료/조작 | 닫기·빈 자료·실패 |
|---|---|---|---|
| C-OVERVIEW / `overview`, `render` | 케어 대시보드 기본 | GET dashboard/summary, 우선순위·선택 환자·추이·브리핑 | 공통 셸 유지; 자료 부족을 안정 진단으로 표시하지 않음 |
| C-PATIENTS / `patients`, `patientRows` | 환자 관리 메뉴 | 이름/질환 검색·필터·환자 선택·가상 환자 등록 | 검색0건과 전체환자0명 구분; 선택 ID 유지 |
| C-MED / `medications`, `medicationsView` | 복약 계획 메뉴/환자 상세 링크 | GET medication orders/schedule/events; 회차·사유·이력·계획 | 환자0명/선택 없음/조회 실패 안내. 일일 자기보고 점수와 회차 분리 |
| C-RECORDS / `records`, `recordTable` | 건강 기록 메뉴 | 선택 환자의 일일·식사·기기 출처, 공통 기간, 범위 미리보기 후 CSV | 기간·분모·관측수/결측/출처 표시. 환자·기간 필터가 내보내기와 일치. CSV는 전체 복원본이 아님 |
| C-WORKLIST / `worklist`, clinician-workflow.js | 업무 목록 메뉴 | 선택 환자의 업무 담당/기한/상태, 사진 검토, 정정 요청/승인, 참여·위임 계획 | 공통 셸/history·dirty/busy·빈자료/실패/재시도. 권한·revision·당시 원자료 보존. 지원 인력은 전문 검토 완료·원자료 승인 불가. 참여/위임 계획 저장은 실제 동의·보호자 로그인 활성화가 아님. 상세는 [실행계획](USABILITY_IMPLEMENTATION_PLAN.md) |
| C-RESEARCH / `research`, clinician-research.js | 연구 분석 메뉴 | 기간/대상/출처 미리보기, 기술통계, 자료 동결, 가명 스냅샷 반출 | 조건·환자N/관측수/분모/결측/출처 표시. null/0 구별, 표본SD·분위수·환자평균 구분. 입력 해시 변경이면 동결 전 재확인. 스냅샷 재현·현재 접근 범위 검사. 자동 대치·추론검정 없음. 상세는 [실행계획](USABILITY_IMPLEMENTATION_PLAN.md) |
| C-EVIDENCE / `evidence`, clinician-evidence.js | 문헌 검토 메뉴 | 일반화한 수동 검색어·연도·개인정보 미포함 확인, Europe PMC 검색/재열람/보관, 사람 검토 근거표 | 검색 중 취소·입력 보존·제공자 실패와0건 구별. PMID/DOI/출처·검색 시각·초록 확보 범위·철회 불명 보존. 검토 완료는 evidence.review 필요. AI 요약·환자자료 자동 전송 없음. 상세는 [EVIDENCE_WORKSPACE_SPEC.md](EVIDENCE_WORKSPACE_SPEC.md) |
| C-MED-PHOTOS / clinician.js C-MED 내부 접기식 상세 | 날짜별 사진 첨부 보고·OCR·당시 revision 조회 | 권한 image API·당시 자기보고, 별도 화면/닫기 없음 | 공통10개 경로·history 유지, 최신20건·빈 상태. 사진 검토 상태와 복용 사실을 구별. 상세는 [약봉투 사진 명세](MEDICATION_PHOTO_DEMO_SPEC.md)와 C-WORKLIST |
| C-SETTINGS / `settings`, `settingsView` | 데모 설정 메뉴 | reset seed/empty 대화상자, CSV | 초기화 확인 문구 필수. 공개 검수 중 전체 초기화 금지 |
| C-ORDER / `openMedicationOrder` | 계획 추가 버튼 | 이름/함량/1회량/경로/시각/기간/주의, OCR 후보 대조·확정 | 우상단 X/취소→C-MED, 오류 시 입력 유지. 사진 후보를 용법으로 자동 확정하지 않음 |
| C-END / `openMedicationEnd` | 계획 종료 버튼 | 명시적 endDate PATCH | 과거 보고 훼손409. 종료 성공→같은 환자·날짜 C-MED |
| C-HISTORY / `openMedicationHistory` | 회차 수정 이력 | GET events의 previous/current/revision | 읽기 전용; X→C-MED, 다른 환자 변경 시 늦은 응답 무효 |
| C-ADD/RESET / `openModal` | 환자 추가/초기화 | POST patients 또는 reset | 초기화는 명시적 확인, 실패 시 해당 modal 유지 |

새 의료진 화면을 변경할 때 해당 render 함수·dialog와 인수 사례를 이 표에 먼저 연결한다. 기존 동작을 바꾸지 않은 행은 이번 환자 화면 수정만으로 재검증 완료라고 표시하지 않는다.

### 의료진 방문 기록 C-SHELL / NAV-05

- 메뉴 클릭과 본문 메뉴 바로가기는 `changeView`에서 실제 목적지가 달라질 때만 `pushState`한다. 환자 선택과 복약 날짜 변경도 각각 하나의 방문 기록이다. 동일 메뉴 재클릭·검색·필터·20초 자동 갱신·수동 새로고침·조회 응답은 새 기록을 추가하지 않는다.
- `syncUrl(mode)`는 view/patientId/medicationDate/startDate/endDate를 동기화한다. 최초 진입·잘못된 경로의 정규화는 replace, 사용자 이동은 push로 구별한다. `render`의 기본 동작은 현재 항목 정규화이며 명시적인 사용자 이동만 push를 요청한다. 초안·사진·토큰은 URL에 넣지 않는다.
- `restoreRoute`는 popstate에서 URL을 읽어 10개 경로 중 허용된 view·환자·복약 날짜·공통 기간을 복원하고 활성 메뉴/제목/본문/환자 화면 링크를 일치시킨다. 복원 자체는 push하지 않는다. 초기 진입 전 시작 화면 방문 기록은 그대로 유지하며 의료진 메뉴 이력이 소진된 뒤에만 시작 화면으로 돌아간다.
- 환자 변경을 복원할 때 이전 환자의 요약을 지우고 로딩/실패 상태를 표시한다. selectionRequest/medicationRequest 세대로 이전 비동기 응답을 무효화한다. 환자가 삭제됐으면 현재 목록의 기본 환자(없으면 빈 상태)로 replace한다. 복원 중 실패 시 URL/메뉴를 시작 화면으로 바꾸지 않고 새로고침 재시도를 제공한다.
- 모든 입력 대화상자는 baseline/dirty/busy를 추적한다. X/Escape/취소/메뉴/환자/날짜/뒤로/로그아웃은 같은 이탈 판단을 거친다. 미저장 이탈을 거절하면 값과 현재 history를 보존하며, 저장·분석 중에는 문맥 이동을 막는다. 이탈이 허용된 뒤 대화상자와 사진 초안을 정리한다. v0.5 NAV-05의 ‘대화상자 미저장 보호 미보장’ 범위는 v0.7.0에서 이 규약으로 대체했다.
- 공지·메시지와 업무/연구/문헌 작업 영역에도 dirty/busy를 적용한다. 같은 문맥의 조회 갱신은 열린 편집기·상세·포커스를 덮어쓰지 않는다. popstate는 서버 쓰기를 발생시키지 않는다. 새로고침·탭 닫기는 beforeunload로 확인을 요청하되 브라우저 정책이나 강제 종료를 통제한다고 보장하지 않는다.
- 화면 이동·복원 후 제목에 포커스를 옮기고 상단으로 이동한다. 자동 갱신은 포커스를 이동하지 않는다.
- 인수: 두 메뉴가 허용된 계정에서 **시작→의료진→건강 기록→데모 설정→뒤로=건강 기록**, 앞으로=데모 설정. 허용 메뉴 연속 왕복, 동일 메뉴/새로고침 중복 기록 없음, 환자·날짜·기간 왕복, 직접 URL 새로고침, 지연 응답 무효화, 편집 중 이탈 취소·저장 중 잠금을 브라우저에서 검사한다. 권한 없는 메뉴와 직접 API 접근도 따로 검사한다.

## 4. 코드와 문서가 어긋나지 않게 하는 장치

- `public/patient-screens.js`: 환자 일반 화면/입력 화면 ID·제목·종류·닫기 목적지·활성 메뉴의 단일 registry. patient.js는 이 정의로 탐색을 처리한다.
- 이 문서의 화면별 상세 의미는 사람이 검토한다. registry/모든 HTML 화면/하단 메뉴/문서 화면 ID가 서로 맞는지 자동 검사한다. 선언 변수 목록 생성만으로 화면 계약을 검증했다고 주장하지 않는다.
- 브라우저에서 모든 일반 서브 화면의 X→홈/동일 환자, 모든 입력 화면 X→진입 화면, 의료진 링크 위치, dirty 취소/유지, 저장 중 이동 잠금, 직접 URL/뒤로가기, 320/390px 넘침을 검사한다.
- 화면 변경 PR에는 `화면ID → 요구ID → 문서 변경 → 코드 함수 → 실제 검증` 표를 필수로 남긴다. 문서 없는 새 화면/액션은 미완료다.

## 5. 변경 이력과 현행 기준의 구분

v0.5는 iPhone/GPT와 의료진5개 메뉴의 방문 기록 복원을, v0.6은 카카오·공지·메시지와 의료진7개 메뉴를, v0.6.1은 약봉투 사진 A단계를 추가했다. v0.7.0은 이 문서의 공통 규약·화면 표에 큰 글자/조작, 명시 입력, 의료진 모달 보호와10개 역할별 경로를 통합했다. 과거 버전 설명은 도입 이력이며 현재 제작 기준을 덮어쓰지 않는다. 각 버전의 검증 증거와 미확인 사항은 CHANGELOG 및 실행 결과 보고서에 남긴다.

## v0.8.0 환자 화면·음성 개선 (2026-10-24, 구현 전)

현재 새 변경의 요구·화면/상태·데이터·지원 범위·변수·검증 기준은 [PATIENT_VOICE_SPEC.md](PATIENT_VOICE_SPEC.md)를 따른다. 기존 v0.7.0 공통 규약을 계승하며 환자 본문20/도움18/누름56 목표, 행동/정보 구분과 인라인 음성 안내·음성 입력·할 일 알림을 추가한다. 기존 의료진/네이티브/API/schema6는 유지하고 음성 인식 결과는 확인 후 기존 입력칸에만 반영한다. 녹음·원고 자동 저장·백그라운드 전달을 구현 완료로 표시하지 않는다.

### v0.8.0 인라인 구성요소 상세

| 화면ID / 구성 | 진입·상태·코드·인수 |
|---|---|
| P-VOICE-GUIDE / 홈 듣기 | 홈 헤더의 큰 듣기/중지(재생 시 교체), 서브에서는 기존 X 유지; 이름은 환자 문맥, 짧은 인사 뒤 기록 행동 표시; 한국어 미준비/재생실패 텍스트 대안, P-GUIDE에서 음성 off; patient-assist.js |
| P-TASKS / 홈 할 일 | 서버 기록·약 일정의 예정/미보고/보고/불명 구별, 안전한 GET 새로고침·정적 리스트와 명시 버튼; patient-tasks.js |
| P-VOICE-INPUT / 기존 입력 인라인 | P-MEAL/DAILY/STEPS/SLEEP/MED/MESSAGES의 말로 입력 버튼; 마이크 상태/동의/중지/문장 정정/날짜·값 확인/입력칸 적용→기존 저장, 지연 무효화·수동대안; patient-dictation.js |
| P-REMIND-SETTINGS / P-GUIDE |15분 화면열림 알림·브라우저 권한 직접 선택·끄기·미지원; 숨김/종료 전달 없음; patient-assist.js |

기존 누름 건강 카드는 입력/수정/보기 동사·진한 하단 띠·명확한 버튼 경계와 그림자로 정적 정보와 구분한다. P-HOME의 식사·약은 서로 다른 진한 색과 ‘기록하기/누르세요’ 문구를 함께 사용한다. 인라인 음성 패널은 새 dialog/경로를 만들지 않는다. 닫기/뒤로/세션/환자·날짜 변화와 권한은 PATIENT_VOICE_SPEC 및 AUTH_COMMUNICATION_SPEC의 현행 규약을 따른다.
