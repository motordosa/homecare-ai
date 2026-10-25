# 구성과 화면 동작 v0.8.1 개발 기준

## 환자 오류 복구 경계 (REL-01~08, 구현 전 확정)

공통 session 요청은20초 제한을 두고 patient.js는 이벤트를 먼저1회 등록한 뒤 재진입 가능한 bootstrap을 실행한다. 초기 실패의 다시 불러오기도 인증 조회부터 재실행한다. 일일 입력은 `recordLoadState`와 `dailyLoadedDate/dateRequestId`를 함께 검사하여 ready인 선택 날짜에만 음성·저장을 허용한다. 같은 날짜 재조회 버튼은 실패 상태에도 남긴다.

patient.js의 저장 요청은 진행→지연→확정 또는 결과 불명으로 구분하고 기존 요청 UUID를 유지한다. 식사·일일 기록 응답 유실은 동일 본문/UUID를 다시 보내 결과를 확인한 후에만 새 입력을 허용한다. 서버 오류가 미저장을 증명하지 않는 경우 임의로 실패 확정하지 않는다. 요약 조회 실패는 저장 실패와 별도 표시한다. 사진 분석에는65초, 일반 API에는20초 제한을 유지한다.

음성 수명·초안과 파서 계약은 PATIENT_VOICE_SPEC, 발화 설정/종료는 VOICE_PLAYBACK_CONTRACT, 세션/이미지 준비는 CLIENT_IO_RELIABILITY_SPEC을 따른다. 건강 코드 발급은 health-sync의 선택 UUID 영수증(schema8)으로 동일 시도 재생성 및 재발급 중복을 막으며 토큰 평문은 보관하지 않는다. 기존 네이티브 수집/인증 계약은 유지한다.

## 실행 구조

v0.6: AUTH_COMMUNICATION_SPEC를 먼저 따른다. lib/auth.mjs가 Kakao OAuth/opaque session/role·patient ACL/CSRF/초대 연결을 담당하고 lib/communications.mjs가 공지 revision·대화·읽음을 담당한다. public/session.js는 공통 인증·CSRF, auth-page는 로그인/연결, patient/clinician communication 모듈은 기존 셸을 사용한다. 기존 네이티브 Bearer 인증은 유지한다.

v0.5: iPhone 우선 iOS HealthKit 연결 앱을 integrations/ios에 추가한다. 수집 없는 모바일 웹·기존 Node/SQLite·Android 경로는 유지한다. GPT_ACTIVATION/IOS_CONNECTOR의 계약을 먼저 따른다. 외부 API 키와 Apple 설치 서명은 서로 다른 선행조건이다.

Node.js 24 단일 HTTP 서버 + SQLite + `public/`의 모바일/데스크톱 웹이다. 기존 서버·DB는 유지하고 복약/사진 분석/건강 수신을 독립 모듈로 추가한다. 외부 AI 키는 서버에서만 사용한다. 브라우저에는 공개 가능 여부만 전달한다.

| 구성 | 책임 |
|---|---|
| server.mjs | 공통 JSON/출처/정적파일 처리, 모듈 경로 연결, 일일·식사 저장 |
| lib/db.mjs | 기본 스키마·시드·추가 스키마 초기화 연결 |
| lib/meals.mjs / lib/export.mjs | 식사 보존 이행·명시 섭취량·재시도, 범위 관리 CSV 미리보기/반출 |
| lib/staff-access.mjs / lib/workflow.mjs | 서버 역할·환자 범위·업무/사진 검토·정정 감사·참여/위임 기반 |
| lib/research.mjs / lib/evidence.mjs | 기술통계·불변 가명 스냅샷, 고정 문헌 제공자·검색보관·사람 검토 |
| public/clinician-workflow.js / clinician-research.js / clinician-evidence.js | 공통 의료진 셸과 연결한 독립 작업 상태·dirty/busy·API 화면 |
| public/patient-image.js | 파일 크기/형식 확인·브라우저 해상도 축소·변환 실패 안내 |
| lib/analysis.mjs | 출처를 유지하는 요약·추이·의료진 브리핑 |
| lib/medications.mjs | 계획·회차·복약 이벤트/수정 이력 |
| lib/vision.mjs | 외부 사진 분석·출력 검증·초안 적용 계약 |
| lib/auth.mjs | Kakao 고정 OAuth·서버 세션·CSRF·역할/환자 ACL·초대 연결 |
| lib/communications.mjs | 공지 상태/수정이력/버전 읽음·개별 대화/중복/읽음 |
| public/session.js / auth-page.js | 인증 진입/계정 연결/공통 CSRF·세션 만료 처리 |
| public/*-communications.js | 기존 셸의 공지·대화 DOM·초안 보존·증분 갱신/늦은 응답 폐기 |
| lib/health-sync.mjs | 연결 토큰·일별 집계 수신·중복/오래된 수정 방지 |
| public/patient.* | 목적별 입력, 복약 회차, 사진 초안 확인, 연동 상태 |
| public/clinician.* | 복약계획 작성·기록 확인, 사진 보조 입력, 데이터 출처 |
| 네이티브 연결부(후속) | OS별 동의·권한·집계·백그라운드 작업·재전송 |

## 환자 메뉴 계약

모든 화면의 제작 규약과 코드 대응은 SCREEN_SPEC.md, 부분 건강 수집·전송은 SMARTPHONE_SYNC_SPEC.md를 먼저 읽는다. patient-screens.js registry를 탐색의 단일 기준으로 사용한다. 일반 화면 상단 X/입력 닫기/역할 전환을 구별하며 공통 닫기·busy·dirty 처리 없이 페이지별로 구현하지 않는다.

| 액션 | 도착점 | 저장/조회 범위 |
|---|---|---|
| 식사 기록 | 식사 작성 대화상자 | 사진 분석 초안 또는 수동 선택, 섭취비율 확인 |
| 복약 기록/복약 카드 | 전용 복약 화면 | 의료진 목록의 날짜·약·회차별 상태; 목록 없으면 일일 자기보고 안내 |
| 걸음 수 | 활동 전용 입력/연동 상태 | 날짜·걸음 수만 수동 보완 |
| 수면 | 수면 전용 입력/연동 상태 | 날짜·수면 시간만 수동 보완 |
| 단백질 | 식사 기록/영양 근거 영역 | 기존 기록 조회; 추가 버튼은 별도 |
| 오늘의 건강 기록 | 전체 일일 입력 | 입력/변경한 항목만 전송, 미보고는 미보고 유지 |
| 최근 식사 보기 | 기록의 식사 영역 | 실제 제공하는 최근 건수 안내·포커스 이동 |
| 홈/내 기록/안내/연동 | 각 화면 | URL 상태·뒤로가기·새로고침·선택 환자 유지 |
| 의료진 링크 | 같은 patientId의 의료진 화면 | 다른 환자로 조용히 전환 금지 |

사진 바뀜/환자 바뀜/폼 닫힘/날짜 변경 시 늦게 도착한 응답을 request generation으로 무효화한다. 저장 중 중복 클릭을 막는다. 폼에서 숨긴 필드는 전송하지 않는다.

## 데이터 흐름과 신뢰 경계

의료진 탐색은 SCREEN_SPEC의 C-SHELL/NAV-05를 따른다. 명시적인 메뉴·환자·복약 날짜 이동은 push, 조회/갱신은 replace로 구분한다. popstate는 URL의 화면·환자·날짜를 복원하고 이전 조회 세대를 무효화한다. render 자체가 메뉴 이동 이력을 덮어쓰지 않도록 호출 목적을 전달한다.

식사 사진→외부 전송에 대한 사용자 확인→서버 검증→AI 구조화 응답 검증→환자별 유효기간 있는 초안→섭취 확인→식사 저장. 실패/미설정은 수동 경로로 안내하며 고정 식단 표를 AI 분석으로 표시하지 않는다.

약 사진→글자/후보 초안→의료진이 이름·함량·용법을 대조→확정 복약계획. 환자 자기보고는 확정 계획과 구별하고 과거 이벤트를 변경 이력으로 남긴다.

Health Connect/HealthKit→권한을 가진 네이티브 연결부의 일별 집계→환자에 묶인 비밀 연결 토큰→중복 방지 수신→출처별 스냅샷→출처가 보이는 요약. 웹에는 실제 권한과 마지막 성공 수신 전까지 연결 완료를 표시하지 않는다.

## 복약 사진 A단계

lib/medication-photos.mjs는 기존 vision 초안의 환자·hash·종류·만료 검증과 사진+회차 원자 저장을 담당한다. public/patient-medication-photo.js는 공통 patient dialog 셸에 연결한다. 이미지 BLOB은 같은 DB 트랜잭션과 CASCADE로 보관·삭제하며 인증된 image API로만 제공한다. 상세 계약: MEDICATION_PHOTO_DEMO_SPEC.md.

## v0.7.0 확장 구조

공통 셸을 유지하고 clinician-workflow/research/evidence 모듈을 추가한다. 서버는 기존 라우트와 별도 workflow/research/evidence 도메인 함수를 통합한다. 공통 auth의 capability+환자 범위 검증을 재사용하며 연구자료와 원기록, 문헌 근거와 환자 임상결정을 분리한다. DB schema6 이행/보존 계약과 식사 nullable 영양량은 USABILITY_IMPLEMENTATION_PLAN에 명시했다.

## v0.8.0 환자 화면·음성 개선 (2026-10-24, 구현 전)

현재 새 변경의 요구·화면/상태·데이터·지원 범위·변수·검증 기준은 [PATIENT_VOICE_SPEC.md](PATIENT_VOICE_SPEC.md)를 따른다. 기존 v0.7.0 공통 규약을 계승하며 환자 본문20/도움18/누름56 목표, 행동/정보 구분과 인라인 음성 안내·음성 입력·할 일 알림을 추가한다. 기존 의료진/네이티브와 환자 기록 API는 유지하고 공지 영수증 테이블은 schema7로 추가한다. 음성 인식 결과는 확인 후 기존 입력칸에만 반영한다. 녹음·원고 자동 저장·백그라운드 전달을 구현 완료로 표시하지 않는다.

### v0.8.0 추가 모듈

- patient-tasks.js: KST·오늘 기록·현재 약 일정에서 텍스트/음성/알림의 공통 상태 계산.
- patient-assist.js: 한국어 발화·재생 제약·중지/끄기·중복 억제·화면열림 갱신/알림·오류/최신성.
- voice-parser.js: 필드별 한국어 수치/단위/날짜·명확한 상태의 제한 해석. 임상 의미/처방 추론 없음.
- patient-dictation.js: 브라우저 인식·마이크 상태·원고 수정·검토·확인 후 기존 폼 반영, 세대/대상/세션 경계.
- patient-assist.css: 기존 기본 레이아웃 위의 행동/정보·큰 글자·헤더 소리 제어 토큰/컴포넌트 규칙.
- 공지 저장 receipt는 communications 모듈에서 기존 공지/이력과 원자 저장한다. 실제 Kakao 인증 채널은 cookie 기반이고, demo 탭 보조 헤더는 그 모드에서만 유효하다.
