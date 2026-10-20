# 카카오 인증·공지·개별 메시지 명세 v0.6

2026-10-20 KST. AUTH-01..03/COM-01..03. 최신 사용자 요청을 코드 작성 전에 정리한 기준이다. 환자는 모바일 웹, 의료진은 데스크톱 웹이다. 실제 카카오톡 발송은 현재 범위에 포함하지 않으며 사이트 내 대화를 우선한다.

## 1. 인증과 데이터 접근

- AUTH_MODE=demo는 명시적인 합성자료 체험 모드다. 기존 기록 API의 공개 데모 호환은 유지하되 새 공지 관리/대화는 데모 세션과 CSRF를 요구한다. UI에 데모 역할임을 표시한다. 실제 개인정보를 이 모드에 넣지 않는다.
- AUTH_MODE=kakao는 카카오 OAuth Authorization Code→서버 token 교환→고정 kapi의 사용자ID 확인→서버 세션이다. production 기본은 kakao이며 배포 Blueprint의 demo 선택은 명시한다. 모드/키/원점 설정 오류가 있으면 보호 API는 잠기며 demo로 자동 전환하지 않는다.
- KAKAO_CLIENT_ID(REST API 키), KAKAO_CLIENT_SECRET, APP_ORIGIN(HTTPS 정규 origin). callback은 APP_ORIGIN/auth/kakao/callback으로 고정한다. kauth.kakao.com/oauth/authorize와 /oauth/token, kapi.kakao.com/v2/user/me만 사용한다. 사진·이메일·친구목록 등 추가 프로필 권한은 요청하지 않는다.
- OAuth state와 브라우저 결합 nonce는 각각 난수32bytes, DB에는 hash만 보존,10분/1회/같은 브라우저 필수. 임의 외부 next URL·redirect·upstream 오류 원문은 거부한다. provider token은 사용자ID 확인 후 저장하지 않는다.
- 세션은 난수 opaque token의 SHA256만 DB, HttpOnly/SameSite=Lax/HTTPS Secure cookie,12시간 만료. 로그인 시 회전, POST logout 시 폐기. CSRF 난수는 세션에 묶어 응답하고 모든 인증된 변경 API는 X-CSRF-Token과 같은 출처를 검사한다. 로그아웃은 HomeCare 세션 종료이며 카카오 전체 계정 로그아웃을 주장하지 않는다.
- 의료진은 서버 CLINICIAN_KAKAO_IDS allowlist만으로 정한다. 클라이언트의 role·환자ID·프로필 문자열로 승격하지 않는다. allowlist 제거는 기존 세션에도 즉시 적용한다. 첫 로그인 사용자는 pending이며 본인 카카오 앱 사용자ID를 계정 화면에서 확인할 수 있다.
- 의료진이 기존 환자의 24시간·1회 초대코드를 발급한다. hash만 DB에 보존하고 새 코드 발급 시 미사용 이전 코드를 폐기한다. pending 사용자가 로그인 세션에서 코드를 입력하면 환자와 연결된다. 실제 카카오 계정은 환자당1개, 계정당1환자. 이미 연결된 계정의 재지정은 자동 허용하지 않는다.
- 환자 세션은 자신의 환자 조회/일일·식사·자기보고·연결·메시지만 가능하다. 다른 patientId, 의료진 목록/대시보드/CSV/처방/초대/공지 관리는 거부한다. 업로드 사진도 소유권을 검사한다. 의료진은 같은 데모 진료공간의 환자를 관리한다. 멀티기관 분리는 후속 범위다.
- 기존 네이티브 /api/health-sync 및 preflight는 환자에 바인딩한 Bearer 토큰 인증을 유지한다. 카카오 cookie/CSRF와 혼합하지 않는다. 공개 health/capabilities에는 비밀이나 식별 가능한 환자 자료를 반환하지 않는다.

## 2. 화면 계약

| 화면 ID | 목적·조작 | 경로·코드 | 닫기/오류·인수조건 |
|---|---|---|---|
| A-LOGIN | 카카오 로그인/설정 상태/데모 진입 | /login, auth-page.js | 키 미설정과 demo를 실제 로그인으로 표시하지 않음. return 경로는 앱 내부만 |
| A-ACCOUNT | 본인ID·초대코드 연결·역할/로그아웃 | /account, auth-page.js | pending은 다른 환자자료 불가. 의료진 권한 없음은 계정 설명·본인 화면 링크 제공 |
| P-NOTICES | 모든 환자 일반 화면의 최상단 공지 | header 아래 인증 strip 다음, #patient-notices | 최신 게시10건, 중요 우선, details 펼쳐 전문. 초안/보관 미노출. 오류와 공지0건 구별. 상단X는 원래 역할 유지 |
| P-MESSAGES | 자신의 대화·답장·읽음 | registry messages, view-messages | 공통X→같은 환자 홈. 입력 보존/미저장 확인/전송 중 탐색 잠금. 다른 환자 응답 무효화 |
| C-NOTICES | 공지 목록·새 초안·편집·게시·보관 | clinician view=notices | 기존 공통 셸 유지. 제목/본문/중요·상태, revision 충돌409. 미저장 이동 확인 |
| C-MESSAGES | 환자 선택·개별 대화·전송·읽음 | clinician view=messages | URL patientId 유지·뒤로 복원. 다른 환자에게 답장 섞지 않음. 내용 입력 중 갱신은 값/포커스 유지 |
| C-INVITE | 선택 환자 카카오 초대코드 발급 | 기존 의료진 modal | 우상단X/취소→열었던 페이지. 코드 일회 표시 후 닫으면 DOM에서 제거. 늦은 응답 무효 |

환자 공통 하단은 **홈/내 기록/복약/메시지/건강 연결/이용 안내 6개**, 의료진은 **대시보드/환자 관리/복약/건강 기록/공지 관리/개별 메시지/설정 7개**로 명세를 먼저 변경한다. 320/390px의 환자 터치 영역44px와 X/역할 전환 규칙 유지. 카카오 환자는 임의 환자 선택을 숨기고 본인ID로 URL을 정규화한다. 공지·메시지는 공통 셸을 임의로 복제하지 않는다.

임시저장 메시지·공지 내용은 URL/localStorage에 넣지 않는다. 환자/화면/로그아웃 변경은 미저장 확인, 전송 중에는 이동 차단한다. clinician popstate 취소는 history index로 원래 위치로 복구하며 이전 기록을 덮어쓰지 않는다. 문서 이탈은 beforeunload의 브라우저 정책을 따른다.

## 3. 공지 데이터/API

- notices: INTEGER id, title(1..120), body(1..5000), status=draft/published/archived, pinned:boolean, version>=1, created_by/updated_by, created_at/updated_at/published_at. 본문은 plain text만 렌더링한다.
- notice_revisions: 공지별 변경 snapshot/actor/version/time. notice_reads: notice/account별 last_read_version/read_at. 게시 수정 후에는 새 버전을 다시 확인해야 한다.
- GET/POST /api/clinician/notices: 의료진 최근100건 관리·작성. POST {title,body,status,pinned}. PATCH /api/clinician/notices/:id는 {title,body,status,pinned,version}, 낙관적 잠금으로 충돌409. 물리 삭제 대신 archived. 초안/보관을 게시하면 게시 시각 갱신.
- GET /api/notices/active: 환자가 볼 published 최신10건, pinned 우선/게시일·ID 내림차순, read 여부. POST /api/notices/:id/read {version}: 화면에서 읽은 버전과 현재 게시 버전 일치 시만 표시. 수정된 공지를 이전 읽음으로 덮지 않는다.

## 4. 대화 데이터/API

- messages: INTEGER 순번, patient_id, sender_account_id/sender_role(patient/clinician), body(1..2000), client_message_id(UUID), created_at. (patient,sender,client_message_id) 유일. 같은 ID/같은 본문은 재전송 결과, 다른 본문은409. 메시지 본문은 로그/공지/CSV에 넣지 않는다.
- conversation_reads: (patient,account), reader_role, through_id, read_at. 읽음은 표시한 최신 순번까지 단조 증가. 타 대화의 ID는 거부한다. 상대 역할이 해당 순번 이상 확인했을 때만 읽음 표시한다.
- GET /api/clinician/conversations: 환자별 마지막 메시지·미리보기·의료진 본인의 미확인 수. GET /api/patients/:id/messages?before/after/limit=50: 해당 대화만. 기본은 최근50건, cursor로 이전/이후 구간. 응답은 시간순. otherReadThrough는 반대 역할의 최대 확인 순번이며 기존 메시지의 읽음 표시를 갱신한다. 이후 갱신은 after cursor로 빠짐없이 최대50건씩 받고, 첫 페이지에 한해 이전 페이지 유무를 정한다.
- POST 같은 경로 {body,clientMessageId}: 서버 세션에서 발신자·역할 확정. 환자는 본인 대상에만 답장. POST .../messages/read {throughId}: 명시적 확인. GET은 읽음 변경 없음.
- 활성 대화는15초·문서가 보이는 동안만 조회, 공지는30초 확인한다. 새 자료로 전체 입력 폼을 지우지 않는다. 응답은 patientId/request generation 대조 후만 적용한다. 실패 시 입력과 재전송 UUID 유지, 내용을 고치면 새 UUID다. 실제 카카오톡/푸시/SMS 전송은 별도 권한·비용·수신 동의가 필요한 후속 기능이다.

## 5. 마이그레이션·리셋·검증

schema4로 추가 테이블만 생성한다. 기존 기록·기기 자료·분석 초안은 보존한다. patient FK 삭제 시 대화/읽음/초대는 CASCADE, 카카오 계정의 patient_id는 SET NULL로 **재연결 필요**가 된다. 같은 합성ID가 재생성돼도 실제 계정을 자동 재연결하지 않는다. 데모 reset은 공지/공지이력/읽음도 지우며 인증 계정 자체/현재 의료진 세션은 유지한다. 연구 전 계정 삭제·보존은 별도 정책이다.

검증은 임시 DB·모의 Kakao 응답으로 state/브라우저 결합·재사용/만료·고정 endpoint·callback·세션 회전/CSRF/로그아웃·직접 URL/사진/타 환자/의료진 승격 차단, 초대1회/충돌, 공지 lifecycle·revision·읽음, 대화 격리·중복/읽음·dirty/지연 응답을 검사한다. 실제 카카오 앱/동의/키·Render 배포는 계정 소유자 설정 후 별도 검증한다. 공개 DB에 테스트 공지나 메시지를 보내지 않는다.

공개 배포 점검은 GET만 사용한다. v0.6부터 화면 진입이 데모 세션 POST를 만들므로 익명 공개 점검에서는 로그인 화면·권한 거부·소스 일치만 확인하고 인증 후 작성/차트는 임시 DB 브라우저 검사 또는 소유자의 수동 인수로 검증한다. 공개 점검 도구가 자동 세션 생성·공지 읽음·메시지 전송을 수행하지 않는다.
