# 구성과 화면 동작

## 실행 구조

v0.6: AUTH_COMMUNICATION_SPEC를 먼저 따른다. lib/auth.mjs가 Kakao OAuth/opaque session/role·patient ACL/CSRF/초대 연결을 담당하고 lib/communications.mjs가 공지 revision·대화·읽음을 담당한다. public/session.js는 공통 인증·CSRF, auth-page는 로그인/연결, patient/clinician communication 모듈은 기존 셸을 사용한다. 기존 네이티브 Bearer 인증은 유지한다.

v0.5: iPhone 우선 iOS HealthKit 연결 앱을 integrations/ios에 추가한다. 수집 없는 모바일 웹·기존 Node/SQLite·Android 경로는 유지한다. GPT_ACTIVATION/IOS_CONNECTOR의 계약을 먼저 따른다. 외부 API 키와 Apple 설치 서명은 서로 다른 선행조건이다.

Node.js 24 단일 HTTP 서버 + SQLite + `public/`의 모바일/데스크톱 웹이다. 기존 서버·DB는 유지하고 복약/사진 분석/건강 수신을 독립 모듈로 추가한다. 외부 AI 키는 서버에서만 사용한다. 브라우저에는 공개 가능 여부만 전달한다.

| 구성 | 책임 |
|---|---|
| server.mjs | 공통 JSON/출처/정적파일 처리, 모듈 경로 연결, 일일·식사 저장 |
| lib/db.mjs | 기본 스키마·시드·추가 스키마 초기화 연결 |
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
