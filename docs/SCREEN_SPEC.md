# 화면별 제작·동작 명세 v0.4

작성일: 2026-10-17 KST. 요구사항 NAV-04/GOV-02/QA-02. **코드 수정 전에 작성한 제작 기준**이며 완료 증거는 CHANGELOG에 별도로 기록한다. 제품 목적·의료 의미는 PRODUCT_PLAN/CONTRACTS가 기준이다.

## 1. 공통 화면 구조와 책임

환자는 모바일 웹, 의료진은 데스크톱 웹이다. 각 화면은 아래 ID로 관리한다. 화면별 명세 없이 새 버튼·메뉴·페이지를 추가하지 않는다. 화면 ID, 진입점, 상단/하단 메뉴, 닫기 목적지, API, 입력값, 상태, 코드 위치, 인수 사례를 먼저 정한다.

### 환자 공통 셸 P-SHELL

| 영역 | 제작 규약 | 코드 책임 |
|---|---|---|
| 상단 왼쪽 | HomeCare 로고는 **같은 환자의 홈**으로 이동한다. 시작 화면 `/`이나 의료진으로 이동하지 않는다. | patient.html의 `#patient-home-link`; patient.js의 공통 탐색 처리 |
| 상단 오른쪽 | 홈에서는 닫기 숨김. 모든 일반 서브 화면에는 같은 크기·모양·위치의 X, 접근성 이름 `홈으로 돌아가기`. 역할 전환 링크를 이 자리에 배치하지 않는다. | `#patient-view-close`, `renderNavigation` |
| 환자 문맥 | 선택 환자·오늘 날짜를 공통 위치에 표시. 선택 변경 시 이전 환자의 요청·초안·토큰을 무효화한다. | `#patient-select`, `loadPatient` |
| 하단 | 홈/내 기록/복약/건강 연결/이용 안내 순서 고정. 활성 항목 하나만 `aria-current=page`. 아이콘·문구·터치 영역은 페이지마다 바꾸지 않는다. | `.bottom-nav`, `applyView` |
| 역할 전환 | 환자 상단/닫기 영역에는 의료진 링크 없음. **이용 안내의 ‘데모 역할 전환’ 구역**에서만 같은 patientId의 의료진 링크 제공. | `#guide-clinician-link` |
| 저장 중 | 중복 저장·환자 변경·화면 변경·닫기 차단. 버튼을 실제 disabled 상태로 표시한다. 브라우저 뒤로가기도 저장 대상을 바꾸지 않는다. | `state.saving`, 공통 busy 처리 |
| 반응형 | 320/390/480px, 키보드·긴 이름·확대 시 가로 넘침 없음. 주요 버튼 최소44×44 CSS px. 표시 순서는 DOM·키보드 순서와 일치. | patient.css |

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
| P-HOME / `#view-home`, `renderHome` | `/patient`, 홈 메뉴, 서브 X. 오늘 기록과 입력 진입점 | 공통 로고; X 숨김; 홈 활성 | summary/todayMedication, todayRecord, todayMeals | 기록 없으면 미보고; 약별 일정과 일일 점수 분리; 오류는 공통 재시도 |
| P-RECORDS / `#view-records`, `renderRecords/renderChart` | 내 기록, 최근 식사, 단백질 카드. 기록·근거 조회 | 공통 X→홈; 내 기록 활성 | summary recentRecords/trends/recentMeals; metric/section | 값 없음은 빈 차트/안내. 식사는 실제 최근 제공 건수 명시. 기록 편집은 해당 날짜 P-DAILY |
| P-MED / `#view-medication`, `loadMedicationSchedule/saveMedication` | 홈 복약 카드/하단 복약. 날짜·약·회차 보고 | 공통 X→홈; 복약 활성. 의료진으로 보내는 상단 링크 없음 | GET medication-schedule, POST medication-events, orderId/date/time/status/reason/note | 저장 후 같은 날짜·화면 유지. 미보고=pending. 일정 없음→P-LEGACY. 불러오기 실패 시 입력 불가·재시도 |
| P-CONNECT / `#view-connections`, `loadConnections/createConnection` | 하단 건강 연결. 출처·수신·코드 관리 | 공통 X→홈; 건강 연결 활성 | GET/POST/DELETE health-connections, connections/connectionRequestId | 코드 생성은 연결/수집 성공이 아님. 토큰·origin·이름·ID 일회 표시, 숨김/이탈/환자 변경 시 제거. 연결 없음과 서버 실패 구분 |
| P-GUIDE / `#view-guide` | 이용 안내. 촬영·섭취량·자기보고·연동 설명 | 공통 X→홈; 이용 안내 활성 | 서버 쓰기 없음; 역할 전환에만 patientId 사용 | ‘데모 역할 전환’ 구역에서 의료진으로 이동한다는 목적 명시 |
| P-MEAL / `#meal-dialog`, `openMeal/saveMeal` | 홈 식사 버튼·기록 화면 식사 추가. 식사 작성 | 입력용 공통 상단 X→진입 화면. 배경 하단 탐색 비활성 | date/mealType/imageData/foodType/portion/analysisId/patientConfirmed; POST meals | 성공 후 닫기·요약 갱신. 실패 시 입력 유지. 사진 교체·닫기·날짜 변경→늦은 분석 무효. 먹기 전 전체 사진/식후 섭취비율 |
| P-DAILY / `#daily-dialog`, `openDaily('all')` | 홈 건강 기록/기존 날짜 수정 | 입력용 공통 X→진입 화면 | date, steps/sleepHours/weightKg/medicationStatus/appetite/mood/note 중 변경 항목만 POST daily | 미보고를 정상으로 생성하지 않음; 성공 후 진입 화면 갱신; 실패·닫기 취소 시 값 보존 |
| P-STEPS / 같은 dialog, `openDaily('steps')` | 걸음 카드·건강 연결의 직접 입력 | P-DAILY와 동일 X | date/steps만 표시·전송. 수동 원본만 baseline | 저장 시 수면·복약 불변. 직접 입력0 우선, 지우면 수신값 복귀 |
| P-SLEEP / 같은 dialog, `openDaily('sleep')` | 수면 카드·건강 연결의 직접 입력 | P-DAILY와 동일 X | date/sleepHours만 표시·전송. 웹 단위 시간 | 걸음 수·복약 불변. null/0 구별. 기기의 분은 서버에서 시간으로 변환 |
| P-LEGACY / `#legacy-medication-form` | P-MED에서 해당 날짜 약별 계획이 없을 때만 | P-MED 안의 구역이며 별도 메뉴/닫기 없음 | date/medicationStatus POST daily | 일일 자기보고임을 명시. 임의 처방 생성·약별 회차로 변환 금지 |

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

데스크톱 공통 셸은 좌측 5개 메뉴 순서 고정, 상단 페이지 제목/새로고침, 선택 환자 유지다. 일반 페이지 X를 환자 앱처럼 임의 추가하지 않는다. 등록·종료·이력 대화상자만 우상단 X/취소를 사용하고 열었던 페이지로 복귀한다. 다른 역할로 이동하는 링크는 ‘환자 화면’이라고 명시한다.

| ID / 구현 | 목적·진입 | 자료/조작 | 닫기·빈 자료·실패 |
|---|---|---|---|
| C-OVERVIEW / `overview`, `render` | 케어 대시보드 기본 | GET dashboard/summary, 우선순위·선택 환자·추이·브리핑 | 공통 셸 유지; 자료 부족을 안정 진단으로 표시하지 않음 |
| C-PATIENTS / `patients`, `patientRows` | 환자 관리 메뉴 | 이름/질환 검색·필터·환자 선택·가상 환자 등록 | 검색0건과 전체환자0명 구분; 선택 ID 유지 |
| C-MED / `medications`, `medicationsView` | 복약 계획 메뉴/환자 상세 링크 | GET medication orders/schedule/events; 회차·사유·이력·계획 | 환자0명/선택 없음/조회 실패 안내. 일일 자기보고 점수와 회차 분리 |
| C-RECORDS / `records`, `recordTable` | 건강 기록 메뉴 | 선택 환자의 일일·식사·기기 출처, CSV | 표본/누락/출처 표시. CSV는 전체 복원본이 아님 |
| C-SETTINGS / `settings`, `settingsView` | 데모 설정 메뉴 | reset seed/empty 대화상자, CSV | 초기화 확인 문구 필수. 공개 검수 중 전체 초기화 금지 |
| C-ORDER / `openMedicationOrder` | 계획 추가 버튼 | 이름/함량/1회량/경로/시각/기간/주의, OCR 후보 대조·확정 | 우상단 X/취소→C-MED, 오류 시 입력 유지. 사진 후보를 용법으로 자동 확정하지 않음 |
| C-END / `openMedicationEnd` | 계획 종료 버튼 | 명시적 endDate PATCH | 과거 보고 훼손409. 종료 성공→같은 환자·날짜 C-MED |
| C-HISTORY / `openMedicationHistory` | 회차 수정 이력 | GET events의 previous/current/revision | 읽기 전용; X→C-MED, 다른 환자 변경 시 늦은 응답 무효 |
| C-ADD/RESET / `openModal` | 환자 추가/초기화 | POST patients 또는 reset | 초기화는 명시적 확인, 실패 시 해당 modal 유지 |

새 의료진 화면을 변경할 때 해당 render 함수·dialog와 인수 사례를 이 표에 먼저 연결한다. 기존 동작을 바꾸지 않은 행은 이번 환자 화면 수정만으로 재검증 완료라고 표시하지 않는다.

### 의료진 방문 기록 C-SHELL / NAV-05

- 메뉴 클릭과 본문 메뉴 바로가기는 `changeView`에서 실제 목적지가 달라질 때만 `pushState`한다. 환자 선택과 복약 날짜 변경도 각각 하나의 방문 기록이다. 동일 메뉴 재클릭·검색·필터·20초 자동 갱신·수동 새로고침·조회 응답은 새 기록을 추가하지 않는다.
- `syncUrl(mode)`는 view/patientId/medicationDate만 동기화한다. 최초 진입·잘못된 경로의 정규화는 replace, 사용자 이동은 push로 구별한다. `render`의 기본 동작은 현재 항목 정규화이며 명시적인 사용자 이동만 push를 요청한다.
- `restoreRoute`는 popstate에서 URL을 읽어 5개 허용 view·환자·복약 날짜를 복원하고 활성 메뉴/제목/본문/환자 화면 링크를 일치시킨다. 복원 자체는 push하지 않는다. 초기 진입 전 시작 화면 방문 기록은 그대로 유지하며 의료진 메뉴 이력이 소진된 뒤에만 시작 화면으로 돌아간다.
- 환자 변경을 복원할 때 이전 환자의 요약을 지우고 로딩/실패 상태를 표시한다. selectionRequest/medicationRequest 세대로 이전 비동기 응답을 무효화한다. 환자가 삭제됐으면 현재 목록의 기본 환자(없으면 빈 상태)로 replace한다. 복원 중 실패 시 URL/메뉴를 시작 화면으로 바꾸지 않고 새로고침 재시도를 제공한다.
- 다른 화면으로 복귀하면 열린 대화상자를 닫고 사진 분석을 무효화한다. popstate는 서버 저장 요청을 새로 발생시키지 않는다. 문서 외부 이동은 일반 브라우저 방문 기록을 따른다. 이 변경이 의료진 입력 대화상자의 미저장 보호를 새로 보장하는 것은 아니다.
- 화면 이동·복원 후 제목에 포커스를 옮기고 상단으로 이동한다. 자동 갱신은 포커스를 이동하지 않는다.
- 인수: **시작→의료진→건강 기록→데모 설정→뒤로=건강 기록**, 앞으로=데모 설정. 다섯 메뉴 연속 왕복, 동일 메뉴/새로고침 중복 기록 없음, 환자 변경 왕복, 복약 날짜 왕복·직접 URL 새로고침, 지연 조회 중 왕복 후 늦은 응답 무효화를 실제 브라우저에서 검사한다.

## 4. 코드와 문서가 어긋나지 않게 하는 장치

- `public/patient-screens.js`: 환자 일반 화면/입력 화면 ID·제목·종류·닫기 목적지·활성 메뉴의 단일 registry. patient.js는 이 정의로 탐색을 처리한다.
- 이 문서의 화면별 상세 의미는 사람이 검토한다. registry/모든 HTML 화면/하단 메뉴/문서 화면 ID가 서로 맞는지 자동 검사한다. 선언 변수 목록 생성만으로 화면 계약을 검증했다고 주장하지 않는다.
- 브라우저에서 모든 일반 서브 화면의 X→홈/동일 환자, 모든 입력 화면 X→진입 화면, 의료진 링크 위치, dirty 취소/유지, 저장 중 이동 잠금, 직접 URL/뒤로가기, 320/390px 넘침을 검사한다.
- 화면 변경 PR에는 `화면ID → 요구ID → 문서 변경 → 코드 함수 → 실제 검증` 표를 필수로 남긴다. 문서 없는 새 화면/액션은 미완료다.
