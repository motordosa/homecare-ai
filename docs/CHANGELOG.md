# 의사결정과 검증 이력

## CHG-2026-10-21-14 · MED-PHOTO-01 제작 기준 확정

사용자가 빠른 A단계 데모 개발을 승인했다. 코드보다 먼저 MEDICATION_PHOTO_DEMO_SPEC와 기획·화면·계약·구조·사전을 변경했다. v0.6.1 구현 완료: 환자 P-MED-PHOTO를 공통 dialog/동일 X·dirty·busy에 연결했다. 기존 GPT의 포장 글자 후보와 개인 계획을 정확한 이름 문자열로 대조하고, 약·회차·상태 직접 선택 후 다중 이벤트와 이미지 BLOB을 원자 저장한다. C-MED와 환자 복약에 당시 사진·보고 snapshot을 표시한다. schema5/22tables 추가 마이그레이션, 기존 기록 보존·reset CASCADE, expectedRevision 충돌·전송 UUID 재시도·이미지/환자/종류/만료 검증·strict ACL/CSRF를 적용했다. 국내 약품 API·낱알 식별·실제 API 인식 정확도 검증은 후속이다.

검증: Node84개, 기존 브라우저7개, 자동화20개, strict auth 브라우저4그룹(새 사진/보고 ACL·CSRF 포함), 사진 전용 브라우저4그룹 통과. 사진 전용 테스트는 mock 제공자→실제 분석 초안/DB 저장/의료진 조회, 응답 손실 재전송·동시 수정·늦은 응답·320/390px·공통44px X를 확인했다. 단위6개는 부분 실패 전체 롤백·snapshot 불변·초안 범위·마이그레이션/리셋을 포함한다. docs:check=63 source/4528 declarations,22tables,환자6/입력5/의료진7. 스크린샷은 test-results/medication-photo-*에 로컬 저장. 실제 GPT 유료 호출과 공개 DB 변경/초기화는 하지 않았다. 공개 GET health는 schema4로 아직 이전 배포다. Git 저장소 반영과 Render Live를 구별하며 U-05에 Manual Deploy/사용 절차를 작성했다.

## CHG-2026-10-21-13 — 국내 약 사진 기반 복약 개발안(조사·제안)

- 최신 사용자 요청은 카카오/건강 연동을 보류하고 국내 판매 약의 이미지 분석·API·사진 복약 기록 개발 방안을 제안하는 것이다. 기존 의료진 포장 OCR와 미구현인 환자 사진/품목코드/낱알 후보 기능을 구별했다.
- MEDICATION_PHOTO_KR_PROPOSAL에 사진 유형·API 후보·환자/의료진 화면 규약·자료/API/DB 초안·재전송/늦은 응답·검증/출처를 저장했다. 제품 우선순위와 문서 색인도 연결했다. 애플리케이션 코드/API/스키마/공개 DB는 변경하지 않았다.
- 공개 capabilities는 공통 GPT 설정 ready였다. 실제 약 사진 추론/정확도·잔액은 미검증이다. 사진만으로 복용을 증명하지 않고 후보 식별/확정 계획/회차 자기보고를 분리한다.
- 공식 포털/의약품안전나라/약학정보원은 proxy403으로 직접 확인 불가. 독립 공개 코드에서 MFDS 낱알/허가/e약은요 연동 사례와 필드 사용을 읽었으며 공식 최신 명세·이용권·승인키 호출과 구별했다. 필요한5개 도메인을 기존 환경 초안에 추가 보존했고 실제 반영은 사용자 저장·게시 대기다. 외부 코드를 실행하거나 타인의 키를 사용하지 않았다.


## CHG-2026-10-20-12 — 카카오 로그인·공지·개별 메시지 (구현 전)

- 사용자 요청: 카카오 로그인, 환자 화면 최상단 의료진 공지, 의료진 공지 관리와 환자별 메시징.
- AUTH_COMMUNICATION_SPEC와 AUTH01..03/COM01..03·화면/DB/API/변수 의미를 코드보다 먼저 저장했다. 로그인은 단순 버튼 추가가 아니라 의료진 allowlist·환자 초대 연결·기록/사진/CSV ACL·세션/CSRF를 포함한다.
- 기본 메시징은 사이트 내 대화/읽음이다. 실제 카카오톡 발송은 별도 요청·권한 범위다. 기존 합성 데모와 실제 인증 모드를 구별하고 Kakao 미설정 시 인증 모드가 공개로 fallback하지 않는다.
- schema4 추가 마이그레이션으로 기존 건강/식사/기기 자료 보존. 기존 native Bearer는 유지. 현재 카카오 키/관리 인증이 없고 공식 docs 요청은 network403이므로 필요한 목적지와 설정 요구를 초안에 저장하고 독립 구현·검증을 계속한다.

### v0.6 구현·검증 결과 (2026-10-20)

- AUTH: Kakao 고정 OAuth endpoints·브라우저 결합 state·opaque 세션 hash·CSRF·의료진 서버 allowlist·1회 환자 초대 연결을 구현했다. 실제 인증 모드는 환자의 타 환자 기록/사진/메시지 및 의료진 API/CSV/처방 접근을 차단한다. 키/설정 오류 시 잠금이며 데모로 자동 전환하지 않는다. 신규 세션·공지·메시지는 SQLite에 저장된다.
- COM/화면: 환자 공통 header/X를 보존하고 바로 아래 공지·6개 하단 메뉴를 연결했다. 의료진은 공지·개별 대화를 포함한7개 메뉴를 사용한다. 공지 초안/게시/보관·수정 버전·읽음, 대화/답장·읽음·이전 페이지·증분 조회·재전송 UUID를 구현했다. 작성 중 폼은 갱신으로 지워지지 않고 전환/뒤로/로그아웃을 확인한다. 의료진 popstate 취소는 기존 history 위치로 복구한다. 환자 전환 후 늦은 응답은 폐기한다.
- 문서: AUTH_COMMUNICATION_SPEC/화면별 규약/DB/API/변수 사전/개발 절차와 KAKAO_SETUP의 외부 실행 요청을 갱신했다. 생성 인덱스58개 소스/4204개 선언, schema4의20개 테이블, 환자6/입력4/의료진7개 화면 계약 일치.
- Node/API/모듈78개 통과(기존71+인증·소통7). state/브라우저 결합·재사용·만료·세션 회전/로그아웃·CSRF·allowlist 회수·초대1회/재발급/충돌·타 환자 격리·공지 충돌/읽음·메시지 멱등/페이지/읽음·reset 재연결 필요를 포함한다.
- 기존 브라우저7개, 확장 자동화20개 통과. 확장 탐색 검사는 의료진7개 메뉴와 환자 메시지X도 포함한다. 별도 test:auth는 임시 서버·실제 HTTP/SQLite·모의 Kakao 제공자 응답으로 로그인→초대→환자 연결·직접 API/사진 접근 차단·공지 lifecycle/XSS 평문·409 입력 보존·대화/답장/읽음·전송 응답 유실 후 중복 방지·환자 전환 지연 응답·초안/뒤로가기·연결코드 모달 정리·로그아웃을 검사했고 통과했다. 320/390px 환자 넘침과1440px 의료진 화면을 확인했다. 실제 Kakao 서버 로그인 성공의 증거가 아니다.
- 배포용 실제 Docker 이미지, 비특권 Node/PORT10000/임시 SQLite에서 schema4·공지/대화 저장·조회·기존 Apple Health Bearer preflight/부분 항목 수신 smoke 통과. Kakao 키 없는 production 보호 API401/데모 로그인403도 확인했다. 생성 검증 컨테이너만 정리했다. 변경하지 않은 네이티브 소스의 실기기 동작은 이번 웹 검증으로 대체하지 않는다.
- GET 전용 배포 점검은 새 세션 생성 없이 실행한다. demo27개/실제 인증 모드24개 검사 통과, 인증 후 화면은 명시적 skip(각1개/5개). demo 검사 직후 auth_accounts0행으로 공개 점검에 쓰기가 없음을 확인했다. 인증 후 기능 검증은 별도 임시 DB 브라우저 검사에서 수행한다.
- 공개 사이트 GET 관찰: `/api/health`는schema3, `/api/auth/session`은404였다. 따라서 공개 사이트에는 이번 v0.6이 아직 배포되지 않았다. 실제 카카오 키/앱 설정·Render 관리 인증이 없어 실제 OAuth/수동 배포는 소유자의 실행 대기다. 필요한5개 환경 변수·redirect URI·첫 의료진 등록·환자 초대·인수 절차는 KAKAO_SETUP에 정리했다. 공개 DB에 테스트 공지/메시지/초대/reset을 보내지 않았다. Git 반영·CI 실제 결과·Render 실제 배포를 구별한다.

## CHG-2026-10-17-11 — GPT 활성화·iPhone 우선 (구현 전)

- 사용자 요청: 음식 사진 GPT API·칼로리 기록을 실제 작동시키고 스마트폰 연결은 iPhone을 우선한다. 이전 Android 우선 결정을 최신 요청으로 변경한다.
- 기존 OpenAI Responses/초안/섭취비율/저장 경로는 존재하지만 현재 runtime은 키/모델/flag가 없고 비밀 바인딩도 없다. 실제 추론 완료라고 표시할 수 없다. Render 관리 인증·Mac/Xcode도 현재 없다.
- GPT_ACTIVATION/IOS_CONNECTOR 및 요구ID IMG-04/SYNC-04/QA-04, 화면·API·변수 계약을 코드보다 먼저 저장한다. iOS HealthKit은 읽기 권한 공개 제한 때문에 빈 자료를 생략해 기존 자료를 보존한다.
- 검증 범위: GPT 설정/오류/저장 자동화, apple-health 서버·웹, Swift production core, 가능한 iOS 빌드. API 키·실제 폰·Apple 서명·Render 배포는 실제 실행 결과와 분리해 보고한다.

### v0.5 로컬 구현·검증

- Apple 공식 문서를 실제 GET로 확인했다. 읽기 거절/전체 허용은 구별할 수 없고 제한된 기간 허용도 가능하다. 빈 항목 생략 원칙을 유지한다. background delivery 문서의 ‘didFinishLaunchingWithOptions 반환 전 observer 설치’ 기준을 반영해 초기 등록을 Task에서 동기 bootstrap으로 보완한다. Simulator는 실제 background 쿼리를 검증하지 못한다.

- GPT: 기존 실제 OpenAI Responses 어댑터·사진 초안→섭취비율→SQLite/의료진 영양값 경로를 유지했다. 설정 reasonCode·의료진 GET 진단/재시도·401/403/429 안내와 `npm run ai:check`를 추가했다. 진단은 모델 GET와 명시적 `--image` 추론을 구별한다. Render Blueprint에 활성화/모델/비밀키 입력 요구를 추가했으나 기존 Render 값은 자동 변경되지 않는다.
- iPhone: SwiftUI/HealthKit 앱, 서울 날짜·걸음 집계·실수면 합집합·선택/빈 자료 생략·환자/플랫폼/선택 출처 preflight·서버 시각 revision·Keychain·동일 배치 재시도/재조회·background observer 및 앱 cold launch 등록·웹 복귀·해제를 구현했다. 빈 HealthKit 결과는 거절과 구별할 수 없어 자동 삭제 미지원이다. 웹 기본 선택/설치/권한 안내와 서버 preferredPlatform은 apple-health다. Android 소스는 보존했다.
- Node API/모듈 **71개**, 확장 브라우저 **20개**, 기존 브라우저 **7개** 통과. AI 성공은 mock fixture이며 실제 제공자 정확도 검증이 아니다. apple-health 수신도 합성 fixture다.
- 공식 Swift Docker 이미지(`swift:6.2`, 실제 Swift6.2.4)에서 앱 production Core/ConnectorAPI의 XCTest **11개 통과**. 처음 재전송 검사에서 JSON 키 순서가 달라지는 것을 확인해 실제 전송 인코딩을 sortedKeys로 고정했다. 앱 전체 Swift 구문·Info/entitlements/scheme XML 검사 통과. HealthKit/SwiftUI/Security의 iOS SDK typecheck·simulator 빌드는 macOS CI에서 별도 확인한다. 설치 가능한 서명 IPA를 만들었다는 뜻이 아니다.
- 문서 계약/변수·스키마 일치 검사 통과: **49파일/3526선언**, **11테이블**. Swift도 보조 선언 인덱스에 포함했다. Xcode simulator 빌드 job을 추가했으며 CI 정의와 실제 결과는 구별한다.
- 현재 `ai:check`는 키/flag가 없어 configuration 단계에서 실패(의도된 미설정 진단)했다. 실제 GPT 인증·추론은 미검증이다. 공개 GET capabilities는 vision.enabled/configured=false, preferredPlatform=health-connect로 현재 소스의 미배포를 확인했다. 공개 DB에는 쓰지 않았다. USER_ACTION_REPORT를 iPhone/GPT 중심 U01..04로 갱신했다.
- GitHub 67d7228의 verify와 iOS job은 실제 성공했다. iOS는 production Swift core와 unsigned simulator xcodebuild 모두 통과했으며 서명/실기기와 구별한다. Android는 이전 dee6e70과 동일하게 setup-android 단계에서 실패하고 Gradle 검사에 도달하지 못했다. 설치 action 대신 GitHub runner에 제공된 SDK 존재·실행권한을 먼저 확인해 재사용하고 기존 Kotlin/assemble/lint 검사는 그대로 실행하도록 CI를 보완한다. 검사 생략이나 의존성 후퇴로 성공 처리하지 않는다.
- Docker context에서 iOS 소스/빌드 캐시를 제외했다. 비특권 Docker/PORT10000/임시 DB에서 schema3·현재 patient/clinician JS SHA·apple-health 부분 수신/출처와 신규 capabilities/serverTime smoke 통과. 검증 컨테이너는 정리하고 공개 DB·기존 볼륨은 보존했다.
- **461b402 최종 기능 소스**의 GitHub Actions run38987315942에서 **verify/iOS/Android 모두 실제 성공**했다. 동기 launch observer 보완본도 iOS simulator SDK 컴파일을 통과했고 Android는 재사용 SDK에서 testDebugUnitTest/assembleDebug/lintDebug까지 통과했다. 설치 서명·실기기·실제 GPT는 여전히 별도다. 최신 생성 변수는 **49파일/3529선언**이다.
- 화면 캡처 검토에서 기존 초기화 카드 SVG 크기가 제한되지 않아 제목을 밀어내는 것을 확인했다. C-SETTINGS 제작 규약에 24px 제한을 먼저 추가하고 CSS를 수정한다. iPhone 안내·GPT 설정을 임시 DB의 실제 화면으로 확인하며 무료 Render 유휴 시작과 iOS 배경 수신의 실제 검증 한계도 보고서에 명시한다.

## CHG-2026-10-17-10 — 의료진 뒤로가기 복원 (수정 전)

- 사용자 재현: 건강 기록→데모 설정→브라우저 뒤로가기가 시작 화면으로 이탈. 의료진 render가 매번 replaceState하고 popstate 복원이 없는 것이 원인이다.
- NAV-05 및 SCREEN_SPEC C-SHELL을 코드 변경 전에 보완했다. 메뉴/환자/복약 날짜는 push, 조회·자동 갱신은 replace, popstate는 URL과 선택 문맥 복원·늦은 응답 무효화로 정한다.
- 검증 예정: 시작 화면부터 실제 메뉴 왕복·환자/날짜 복원·중복 기록 방지·지연 응답을 임시 DB 브라우저에서 확인한다. 실제 배포와 로컬 검증은 별도 기록한다.

### CHG10 구현·검증 결과

- C-OVERVIEW/C-PATIENTS/C-MED/C-RECORDS/C-SETTINGS → NAV-05 → SCREEN_SPEC C-SHELL → clinician.js의 syncUrl/render/changeView/selectPatient/restoreRoute에 연결했다. 메뉴·환자·날짜는 push, 동일 목적지·조회·갱신은 기록 추가 없이 처리하고 popstate로 문맥을 복원한다.
- 최초 제보 경로를 포함한 새 브라우저 시나리오3개를 추가했다. 수정 전 소스로 실행하면 실제 뒤로가기 후 건강 기록 복원 검사에서 실패하며, 수정 후 확장 브라우저 **18개**, 기존 브라우저 **7개**가 통과했다. 실제 20초 자동 갱신은 브라우저 시계를 진행해 검증했으며 동일 메뉴·수동 갱신과 함께 기록을 추가하지 않는다.
- 환자 변경 왕복·복약 날짜 왕복/새로고침·지연 환자 응답 무효화를 확인했다. 조회 실패는 현재 환자/URL과 재시도 안내를 유지한다. 문서/화면 계약 검사 통과, 생성 변수 **39파일/3043선언**, DB **11테이블**. 서버·Android 소스는 변경하지 않아 앞선 Node69/Kotlin8/Java16/APK 결과와 구별한다.
- 현재 프런트엔드 patient.js 및 clinician.js의 SHA를 Docker 응답과 대조했다. 비특권 Node/PORT10000/임시 DB의 schema3·부분 수신 smoke 통과. 공개 DB에 쓰기/초기화를 하지 않았다. Git 저장과 실제 Render 배포는 별도이며 U-01 수동 배포가 필요하다.

## CHG-2026-10-17-08 — 화면 제작 규약과 역할 경계 (구현 전)

- 사용자 지적: 식사 대화상자는 X로 닫히지만 복약 일반 화면의 같은 위치에는 의료진 링크가 노출되는 불일치. 기존 기획이 화면 셸·닫기·역할 전환까지 명세하지 못했고 기존 기능 검사가 이를 잡지 못했다.
- SCREEN_SPEC에 모든 환자 화면/입력 변형·의료진 페이지의 목적·탐색·자료·상태·코드 대응을 먼저 저장했다. 일반 서브 공통 X→같은 환자 홈, 입력 X→진입 화면, 의료진 전환은 안내 구역, 공통 dirty/busy/focus 규칙으로 변경한다.
- registry/HTML/문서 일치 검사와 실제 모든 화면 탐색 회귀를 추가한다. 구현/실행 결과는 아래에 별도로 기록한다.
- 홈의 복약 일정 조회 실패도 ‘일정 없음’과 구분하고 기존 일일 자기보고만으로 작업 완료를 추론하지 않도록 명세했다.
- 추가 검토에서 한 회차 저장 후 전체 복약 폼 재생성이 다른 회차의 미저장 입력을 잃게 하는 경로를 확인했다. 저장 회차 상태와 요약만 갱신하고 다른 폼은 유지하는 계약과 회귀 검사를 먼저 추가한다.
- 실제 브라우저 뒤로가기 검사에서 이전 문서 재로딩은 popstate만으로 보호되지 않음을 재현했다. beforeunload의 브라우저 확인을 추가하고, SPA 이동 취소와 문서 이탈 취소를 함께 검사한다. 강제 종료/브라우저 정책의 한계는 SCREEN_SPEC에 명시한다.

## CHG-2026-10-17-09 — 일부 권한의 건강 수집 (구현 전)

- 현재 앱은 걸음·수면 권한이 모두 필요해 한 항목만 공유할 때 다른 자료도 전송하지 못한다. 허용되지 않은 항목을 null로 보내 기존 기록을 지우지 않도록 SMARTPHONE_SYNC_SPEC를 먼저 저장했다.
- day의 생략/명시null/0을 구별하고 schema3의 항목별 revision으로 부분 갱신한다. 이전 전체 스냅샷/재전송 해시를 보존한다. Android는 현재 권한 및 대기배치 권한을 재확인하고 서버 partialMetrics capability를 먼저 확인한다.
- 사용자 외부 실행 항목은 별도 보고서로 정리한다. 코드/fixture/APK 빌드와 실제 Health Connect·갤럭시 워치·공개 배포의 증거를 분리한다.

## v0.4 구현·검증 결과 (2026-10-17 KST)

- 화면 규약: SCREEN_SPEC을 먼저 저장해 환자 일반5/입력4종, 의료진 페이지5 및 대화상자의 목적·탐색·상태·API·코드·인수조건을 명세했다. 환자 registry/HTML/하단 메뉴/문서 및 의료진 viewTitles/문서 일치 검사를 docs:check에 연결하고 AGENTS·PR 양식·개발 절차를 강화했다.
- 환자 UI: 상단 의료진 링크 제거→안내의 역할 전환으로 한정, 동일한 X→홈, 입력 X→진입 화면, 포커스 복귀, 미저장 취소/유지, 저장 중 탐색/환자 변경 잠금. 날짜 변경·실제 브라우저 뒤로가기·문서 이탈 확인도 검사했다. 강제 종료를 방지한다는 보장은 하지 않는다.
- 복약: 일정 조회 실패를 완료로 판정하지 않음. 한 회차 저장 후 다른 회차의 미저장 입력과 보호를 유지한다.
- 스마트폰: 허용된 항목만 읽기/전송, 생략/null/0 구별, 서버 항목별 revision과 schema3 추가 마이그레이션, 기존 전체 payload의 hash/재전송 호환 유지. native preflight에서 새 서버/선택 연결 확인, 철회 항목이 있는 큐를 새 배치로 재집계하고 전송 직전 권한 재확인. 같은 환자 웹 열기에 토큰을 넣지 않는다.
- Node API/모듈 **69개 통과**. 기존 브라우저 **7개**, 확장 브라우저 **15개 통과**. AI 성공은 mock/임시 DB fixture이며 실제 제공자 추론이 아니다. 부분 건강 수신도 합성 fixture이고 실제 기기 자동 연동 완료가 아니다.
- Android Kotlin JVM **8개**, 실제 Java helper **16개 통과**. `testDebugUnitTest/assembleDebug/lintDebug` 성공, lint **오류0/경고23**(OldTargetApi1/MissingApplicationIcon1/UseKtx5/SetTextI18n16). 검사를 끄지 않았다. 개발 APK 0.2.0/versionCode2, 서명 v2 검증 통과. 체크섬/재현은 native README 및 외부 BUILD-RECORD-v0.4.md.
- frozen npm ci 및 docs 생성/일치 검사 통과. 변수 목록은 JS AST와 Kotlin/Java 보조 인덱스, **39파일/3003 선언**, 실제 DB **11테이블**이다. 변수 목록 자체를 화면 규약·임상 정확도 검증으로 대체하지 않는다.
- Docker 비특권 Node/PORT10000/임시 DATA_DIR에서 schema3·정적 모듈·부분 수신/출처 통합 smoke 통과. 검증 컨테이너는 정리하고 기존 서버/볼륨은 보존한다. 실제 공개 DB에 쓰기/초기화를 하지 않았다.
- USER_ACTION_REPORT를 저장하고 Word 산출물을 생성·다시 열어 U01..04/버전/표3개를 확인했다. Health Connect에는 별도 API키가 필요 없음을 명시하고 Render/설치/공유/권한/실기기 검증/선택 사진AI·스토어 작업을 구분했다.
- 공개 확인: 2026-10-17 00:50 KST `/api/health` HTTP200/schema2. 이번 schema3 소스의 공개 배포 완료가 아니다. Render 자동 배포는 꺼져 있고 관리 연결/인증이 없어 U01 수동 배포가 필요하다. 물리 기기·워치/실제 제공자 추론은 미검증이다.

## CHG-2026-10-16-01 — 기획/계약 기준 수립 (구현 전)

- 요구: GOV-01, NAV-01..03, MED-01..03, IMG-01..03, SYNC-01..02, QA-01.
- 변경 전: 단일 일일 폼, 일일 전체 자기보고, 고정 표 영양 추정, 건강 수동 입력. 배포본의 화면/DB 점검은 완료된 상태.
- 확인된 결함: 걸음 수·수면·복약이 같은 폼을 열며 전체 payload 저장; 미보고 식욕/기분이 normal로 채워질 수 있음. 식사 보기 링크가 목록 대신 활동 차트 상단으로 이동. 의료진 사이드바 환자 링크에 선택 ID 누락.
- 변경 결정: 목적별 부분 입력, 의료진 확정 약별 회차, AI 검토 초안, 별도 네이티브 건강 연결 계약. 기존 기록은 추가 마이그레이션으로 유지.
- 선행 문서: PRODUCT_PLAN/ARCHITECTURE/CONTRACTS/DATA_DICTIONARY/DEVELOPMENT_PROCESS 및 AGENTS 저장 후 구현 시작.
- 외부 선행조건: 실제 사진 AI는 제공자 키/비용과 실제 사진 검증, 실제 자동 건강 연동은 선택 OS 앱·동의·실기기 검증이 필요.
- 상태: 설계 기준 저장. 아래 구현/검증 이력에 결과를 추가한다. 이 항목 자체를 구현 완료로 해석하지 않는다.

## CHG-2026-10-16-02 — 복약 종료와 회차 재보고 계약 (구현 전)

- MED-01..03: 기간 양끝 포함, 종료는 오늘 이후의 명시적 endDate로만 단축한다. 과거 보고가 있는 기간을 잘라내는 종료는409. 오늘 종료는 내일부터 신규 일정 없음.
- 회차 미래 보고는 허용하지 않는다. 같은 payload 재전송은 이력/수정번호를 중복 생성하지 않는다. 변경된 보고만 previous/current 이력에 추가한다.
- 과거 약명/용량을 덮어쓰는 편집 대신 종료 후 새 계획을 생성한다. PRN·실제 부분 복용량·검증된 지시 보류는 이번 기본 상태에 억지로 합치지 않고 후속 계약 대상으로 남긴다.

## CHG-2026-10-16-03 — 외부 사진 분석과 연결 수신 세부 계약 (구현 전)

- IMG: 제공자키 `HOMECARE_VISION_API_KEY`, 명시적 활성화 flag, available/configured/enabled 분리. `store:false` 구조화응답·24시간초안·같은사진재사용·동시/호출간격 제한. 실제키가 현재 환경에 없어 실제추론/정확도검증은 대기한다.
- SYNC: 연결 하나만 선택해 사용, 폐기 시 다른 출처로 자동 전환하지 않음. 플랫폼 집계 수정과 동일 batchId의 다른본문 충돌을 분리한다. 네이티브 연결부 implemented/verified=false를 표시한다.
- 임상 검토: 보호자 휴대폰을 환자의 측정원으로 오인하지 않도록 후속 연결 앱에서 소유자 확인이 필요하다. 수면 세션 길이와 실수면 시간, 플랫폼 권한 요청과 실제 읽기 허용을 구별해야 한다.

## CHG-2026-10-16-04 — Android·갤럭시 워치 우선 (구현 전)

- 사용자 답변을 반영해 첫 네이티브 대상으로 확정했다. ANDROID_CONNECTOR.md를 먼저 저장하고 연결 앱 코드를 준비한다.
- 웹 UI/서버 수신 기능과 APK 빌드/실제 권한/기기 자동 전송 검증을 각각 별도 완료 단계로 관리한다.
- 건강 읽기 전에 Bearer 연결의 patientId를 확인하는 GET preflight를 추가했다. 앱에 입력한 환자 ID와 불일치하면 읽기/전송을 중단한다.

## CHG-2026-10-16-05 — 검토에서 발견한 자료 의미/비동기 경계 (수정 전)

- 식사 전 전체 사진과 식후 섭취비율이라는 계산 가정을 촬영 안내에 명시한다. 남은 음식 사진을 전체 제공량으로 해석하지 않는다.
- 레거시 일일 복약 점수/브리핑을 약별 회차 보고와 구별한다. 부족한 영역이 남은 상태를 전체 안정으로 표시하지 않는다. 약별 보고일도 복약 영역의 자료 존재 판단에 포함하되 기존 점수 분모와 섞지 않는다.
- 명시적 reset의 generation을 추가해 분석 중 같은 ID의 합성 환자가 재생성돼도 과거 사진 결과를 적용하지 않는다.

## CHG-2026-10-16-06 — 웹·Android 연결 정보 일치 (수정 전)

- SYNC-01/QA-01: 앱은 정확한 환자 ID를 사전 대조하지만 웹의 코드 안내에는 해당 ID가 표시되지 않는 연결 과정 결함을 확인했다.
- 코드와 함께 서버 origin·환자 이름·patientId를 표시하고 화면 이동·환자 변경·숨김 시 함께 지운다. 기존 API와 token 수명은 변경하지 않는다.
- 해당 브라우저 시나리오에서 정확한 ID/origin 표시와 숨김 후 제거를 검증한다. Android SDK/Gradle 설치 후 실제 APK 빌드도 별도로 시도하며 기기 검증과 구별한다.

## CHG-2026-10-16-07 — 실제 Android 의존성의 컴파일 기준 (수정 전)

- SDK/Gradle/JDK 공식 도구를 설치하고 실행한 첫 APK 빌드는 Health Connect1.1.0의 AAR metadata가 minCompileSdk36을 요구해 실패했다.
- 검사 우회·의존성 버전 후퇴 대신 compileSdk36·API36 지원 AGP8.10.1로 변경한다. Gradle8.11.1/JDK17 및 target35/min28은 유지한다.
- 인수조건은 실제 assembleDebug와 lintDebug 실행 결과 및 APK 체크섬 기록이다. 실기기 Health Connect/삼성 헬스 공유·백그라운드 검증과는 구별한다.
- 같은 컴파일 의존성 문제를 이후 변경에서 발견하도록 별도 Android CI job도 정의한다. 로컬 빌드와 GitHub Actions 실제 실행 여부는 별도로 기록한다.

## v0.3 구현·검증 결과 (2026-10-16)

- GOV: 문서 색인/기획/API·자료 계약/변수 의미/DB 소유권/변경 절차/PR 양식/CI를 추가했다. 전체 JS 선언·매개변수와 Kotlin/Java 보조 인덱스, 실제 스키마를 생성하고 오래된 문서는 검사 실패로 처리한다.
- NAV: 걸음 수·수면·복약 목적 분리, 미보고/0/null 보존, 식사 목록·영양 조회, URL/뒤로가기/같은 환자 링크 수정 완료.
- MED: 의료진 확정 계획·회차별 자기보고·사유/메모·수정 이력·종료/과거 보존 완료. 기존 일일 점수와 약별 회차를 구별한다.
- IMG: 실제 OpenAI 어댑터·동의·초안 검토·사진 hash/환자/유효기간/1회 적용·출처·오류/요청 제한·reset generation 경계 구현. 실제 API 키는 없으므로 제공자 실제 추론과 사진 정확도는 미검증.
- SYNC: 서버 연결·preflight·수신·중복/수정·출처/수동값 우선 구현. Android·갤럭시 워치 우선 연결 앱 구현 후 공식 도구를 설치해 실제 `assembleDebug`·`lintDebug` 빌드 성공. 설치·삼성 헬스 공유·권한·백그라운드·실제 자동 연동은 실기기 미검증.
- 통합 검증: Node API/모듈 **65개 통과**, 기존 브라우저 **7개 통과**, 새 자동화 브라우저 **9개 통과**. AI 성공 사례는 명시적 mock+임시 SQLite fixture이며 실제 AI가 아니다.
- Android 실제 사용하는 Java helper **16개 통과**, XML **3개 파싱 통과**. APK 빌드와 구별한다.
- CHG06: 웹의 연결 origin·정확한 환자 이름/ID 표시와 숨김·이동·폐기 시 제거를 보강하고 자동화 브라우저 **9개 재검증 통과**.
- CHG07: SDK36/AGP8.10.1/Gradle8.11.1/JDK17의 실제 APK·lint 빌드 성공. 별도 Android CI job을 정의했고 YAML 구문을 검사했다. GitHub Actions의 실제 실행/통과는 이 로컬 결과로 대체하지 않는다. APK 체크섬과 설치 안내는 integrations/android/README.md에서 관리한다.
- 무료 호스팅과 같은 Docker/비특권 Node/PORT10000/DATA_DIR=/tmp 설정에서 schema2·화면·약별 회차·건강 수신/출처 smoke 통과. 검증 컨테이너·임시DB는 정리했다. 공개 서버 DB에는 쓰지 않았다.
- 배포 상태: 코드/검증과 Render 실제 배포를 별도 관리한다. 자동 배포가 꺼진 기존 서비스는 수동 배포 후 공개 검증이 필요하다. 기존 v0.2의 공개검증 기록을 v0.3의 증거로 재사용하지 않는다.
