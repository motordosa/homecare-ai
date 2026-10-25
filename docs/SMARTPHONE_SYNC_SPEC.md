# 스마트폰 수집·전송 상세 명세 v0.5

v0.5 변경: 최신 사용자 요청은 iPhone 우선이다. IOS_CONNECTOR.md를 추가 기준으로 읽는다. HealthKit 읽기 권한은 판별할 수 없으므로 iOS의 빈 결과는 기존 자료를 지우지 않도록 **생략**하며 Android의 허용 조회 후 null 계약과 구별한다. preflight는 serverTime을 추가한다.

2026-10-17 KST. SYNC-03/QA-03. 기존 Android·갤럭시 워치 경로를 유지하고 **일부 권한만 허용해도 허용된 항목을 수집**하도록 코드 수정 전에 확장한 기준이다.

## 문제와 목적

기존 연결 앱은 걸음·수면 권한을 모두 요구한다. 수면을 공유하지 않는 폰/워치 환경에서는 걸음 수까지 막힌다. 허용되지 않은 항목을 null로 보내면 기존 수면을 지울 수도 있다. 이에 ‘전송 생략’과 ‘허용받아 조회했으나 원자료 없음’을 구분한다.

## 서버 계약

- 기존 POST `/api/health-sync`와 전체 스냅샷 payload는 호환 유지. 각 day는 date/updatedAt 및 steps/sleepMinutes 중 **최소 하나**를 포함한다.
- 키 생략: 해당 항목을 읽지 않거나 권한이 없으므로 기존 자료·수정시각 유지. 명시적 null: 허용된 항목을 읽었으나 자료가 없거나 삭제되어 해당 항목을 null로 교체. 0은 실제 측정값이다. undefined는 JSON 값이 아니며 모듈 직접 호출에서도 명시값으로 허용하지 않는다.
- `health_daily`에 nullable `steps_updated_at`, `sleep_updated_at`을 추가한다. 기존 행은 두 수정시각을 기존 updated_at으로 1회 이관한다. 부분 자료 행의 생략 항목 timestamp는 null로 유지한다. 재시작 시 다시 채워서는 안 된다.
- 해당 항목의 updatedAt보다 새 revision일 때만 그 항목을 바꾼다. 걸음 수정이 더 최신이어도 그 사이 시각의 수면 수정은 따로 반영한다. 같은시각/오래된 값은 무시한다.
- 날짜당 어느 항목이든 반영되면 acceptedDays 1, 모두 무시되면 ignoredDays 1. 합계는 보낸 날짜 수와 일치한다. updated_at은 두 항목 시각의 최대값, received_at은 그 행에 자료가 반영된 최종 서버시각이다.
- batchId 재사용/충돌, 토큰 폐기/환자 소유권, 명시적 null/0, 트랜잭션, 수동 입력 우선은 기존 계약을 유지한다. 기존 두 키 payload의 정규화 순서를 유지해 이미 저장된 body_hash/재전송을 깨지 않는다.
- preflight 응답에 `partialMetrics:true`, `selected:boolean`을 추가한다. 새 Android 앱은 부분 수신 지원과 현재 선택 연결임을 확인한 뒤만 자료를 읽는다. 이전 서버면 서버 갱신 안내, 다른 새 연결이 선택됐으면 새 토큰 설정 안내 후 중지한다. 기존 앱은 추가 응답 키를 무시하고 계속 두 항목 전송이 가능하다. 서버는 미선택 토큰의 과거 자료 보관 계약을 유지한다.
- DB schemaVersion은3. 삭제 없는 추가 마이그레이션이며 reset은 실행하지 않는다. 조회는 stepsUpdatedAt/sleepUpdatedAt도 제공한다.

## Android 코드·변수 책임

| 구성 | 변경 기준 |
|---|---|
| HealthReader | 현재 허용된 권한을 매회 조회. 하나 이상이면 해당 항목만 최근7일 읽기. 수면 미허용일 때 readRecords 자체를 호출하지 않음. 백그라운드는 별도 기능+권한도 필수 |
| DailyReading | steps/sleepMinutes 값과 includesSteps/includesSleep 별도 보유. toJson은 허용받아 읽은 항목만 넣음. null을 임의로 생략하지 않음 |
| MetricAccess | 실제 허용된 항목 집합·하나 이상 허용 여부·대기 payload의 모든 날짜/키 전송 가능 여부를 한 production 정책으로 판정. JVM 검사는 이 구현을 직접 호출 |
| SyncCoordinator | 환자/연결 및 partialMetrics preflight→현재 권한→대기배치 항목 대조→조회/전송. 현재 권한 없는 항목이 대기배치에 있으면 그 배치는 **전송하지 않고 삭제**하고 새 batchId로 허용된 항목을 재집계한다. 이전 본문을 같은 ID로 수정 금지 |
| BackgroundSync | 한 항목 이상 읽기+background 권한+사용자 선택이 있어야 예약. 권한 모두 철회/영구실패면 중지, 네트워크 실패는 원본 배치 유지 |
| MainActivity | 걸음/수면 권한을 각각 표시. ‘하나 이상 허용’ 안내. 연결 저장 후 토큰 지우기, 대상 확인, 수동동기화, 자동동기화 선택 유지. ‘같은 환자의 웹 기록 열기’는 저장한 origin/patientId/view만 전달하고 token은 URL에 넣지 않음 |
| 웹 연결 화면 | 일부 항목 수신과 기기 자동 검증을 구분. API 키가 필요한 것처럼 안내하지 않는다. Android/Health Connect는 사용자 기기 권한이 선행조건 |

## 인수조건과 실행 증거

1. 서버: 이전스키마→3 보존/반복, 부분 입력·전체입력 혼합, 양방향 revision, 생략/null/0, 재전송/충돌, 오래된 배치, 잘못된 값의 전체 롤백, 재시작 후 생략 timestamp 유지.
2. 실제 native production helper로 권한별 직렬화·대기배치 허용 판정·수면 구간 검증. Kotlin JVM 단위검사는 JUnit4.13.2와 테스트용 org.json20250517을 사용해 실제 DailyReading/MetricAccess를 호출한다. Android 플랫폼 API 실행과 구별한다. 실제 Kotlin/Java APK 컴파일·lint. 데이터 제공자는 mock이라고 표시하고 실제기기 성공으로 기록하지 않는다.
3. 임시 서버/DB→연결토큰→preflight→걸음만 전송→수면만 추가→웹 요약/출처/수동 보완 검증. 공개 DB에는 실험 자료를 쓰지 않는다.
4. 실기기에서는 걸음만/수면만/둘다/모두철회/선택철회/오프라인복귀/자정·중복·수정삭제·OS절전을 검증한 뒤 해당 기종 자동수집 완료로 판정한다.

## 외부 선행조건

사용자 실행 항목은 `USER_ACTION_REPORT.md`에 우선순위·필요이유·방법·제출할 비밀 없는 결과·완료기준으로 기록한다. API키가 없는 것과 기기 권한이 없는 것을 혼동하지 않는다. 인증 없는 공개 데모에 실제 환자/연구 자료를 연결하지 않는다.

## REL-06 연결 코드 발급·응답 유실 복구 계약 (2026-10-25, 구현 전 확정)

연결 생성 후 응답이 끊겼을 때 재시도가 활성 연결을 추가하지 않도록 다음 계약을 적용한다. 네이티브 집계 수신·토큰 형식·hash-only 보관·기존 연결 조회는 유지한다.

- `POST /api/patients/:id/health-connections`는 기존 `platform,label?`에 선택 UUID `clientRequestId`와 선택 UUID `replacesConnectionId`를 추가한다. 예전 클라이언트의 키 없는 신규 발급은 계속 가능하다. 재발급에는 두 UUID가 모두 필요하다.
- 새 발급은 HTTP201 `{connection,token,duplicate:false,codeUnavailable:false}`다. 동일 환자·동일 요청키·동일 정규화 본문의 재전송은 HTTP200 `{connection,token:null,duplicate:true,codeUnavailable:true}`로 현재 연결 상태를 반환하며 추가 발급·선택 변경·기존 토큰 폐기를 하지 않는다. 같은 키로 플랫폼·이름·교체 대상이 달라지면409이다.
- 코드는 최초 응답에만 존재한다. 유실 후에는 ‘연결은 만들어졌지만 코드를 다시 보여드릴 수 없어요’와 명시적인 ‘새 코드 받기’를 제공한다. 화면은 동일 요청키로 결과를 먼저 확인하며 자동으로 새 요청키를 만들어 재발급하지 않는다.
- 명시 재발급은 **새** `clientRequestId`와 교체할 정확한 `replacesConnectionId`를 사용한다. 동일 환자의 아직 폐기되지 않은 연결만 원자적으로 폐기·교체한다. 교체 전 연결이 선택 중이면 새 연결을 선택하고, 이미 다른 연결이 선택된 경우 그 선택을 유지한다. 다른 정상 연결이나 과거 집계·배치는 지우지 않는다.
- 재발급 응답도 유실될 수 있다. 동일 재발급 요청 재전송은 이미 만든 교체 연결을 반환하고 새 활성 연결을 만들지 않는다. 다른 요청키로 이미 교체된 예전 연결을 다시 교체하면409다. 원래 요청 재전송은 폐기된 원래 연결을 반환할 수 있으며 자동 부활하지 않는다.
- 새 `health_connection_issuances` 영수증은 `(patient_id,client_request_id)` 기본키, 정규화 요청 SHA256, 결과 `connection_id`, 생성 시각만 보관한다. 비밀 token 또는 가역 암호문을 저장하지 않는다. 연결/환자 FK CASCADE, 기존 DB 삭제 없는 schema8 추가 테이블이며 재실행 안전해야 한다.
- 서버 라우트는 매 요청마다 기존 인증·현재 환자 범위·CSRF·의료진 쓰기 권한을 검사한 **후** 영수증 재전송 여부를 확인한다. 요청키는 인증 수단이 아니다.

인수조건: 첫 응답 유실 뒤 재시도에서 활성 연결1개 유지, 서로 다른 본문409, 재발급 연타·응답 유실 후 교체1개, 예전 토큰401, 다른 환자/권한 회수 시 재전송 거부, 다른 선택 연결·기존 집계 보존, 재시작·추가 이행·명시 리셋의 FK 정합성을 임시 DB와 실제 HTTP로 검사한다. 실제 Apple Health 기기 권한·수집 검증과 구별한다.

REL-06 서버 구현 검증: `health-connection-issuance.test.mjs`의 새8개 시나리오와 기존 health-sync/automation-api 회귀를 함께 실행해34개 통과. 실제 로컬 HTTP 응답 본문을 읽기 전에 연결을 끊은 뒤 재전송, 동일 요청5개·동일 재발급5개 동시 전송, 현재 CSRF·타 환자 범위·세션 만료, 실패 트랜잭션 롤백, 재시작·기존자료·FK 보존을 검사했다. 이 결과는 서버·임시 DB 검증이며 환자 화면 클릭과 iPhone 실제 기기 수집·공개 배포 완료를 뜻하지 않는다.
