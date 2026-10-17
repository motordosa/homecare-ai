# iPhone·Apple Health 연결 명세 v0.5

2026-10-17 KST. 사용자 요청으로 **아이폰을 첫 검증 대상으로 변경**한다. 기존 Android는 유지한다. SYNC-04/QA-04의 코드 작성 전 계약이며 실제 실행 결과는 CHANGELOG에 별도 기록한다.

## 목적·경계

환자 화면은 모바일 웹 그대로다. iOS 연결 앱은 HealthKit에서 걸음 수와 실제 수면을 읽어 기존 HTTPS 수신 API로 보낸다. Apple Watch는 iPhone 건강 저장소에 공유된 자료를 사용한다. Safari/PWA 단독으로 HealthKit을 읽거나 워치 합계를 다시 더하지 않는다. iOS16 이상, SwiftUI/HealthKit/Security/Foundation, 외부 SDK·유료 건강 API 없음.

앱 설치에는 Mac/Xcode와 Apple 서명이 필요하다. TestFlight에는 계정 소유자의 Apple Developer Program·App Store Connect 설정이 필요하다. Linux에서 핵심 Swift 검사를 수행한 것과 Xcode/iOS 빌드·서명·설치·실제 기기 수집은 각각 구별한다. 미서명 소스/아카이브를 설치 가능한 IPA라고 표시하지 않는다.

## I-SHELL / I-CONNECT / I-SYNC 제작 계약

| 화면/영역 | 조작·자료 | 성공·빈 자료·실패 | 코드 책임 |
|---|---|---|---|
| I-CONNECT | HTTPS 서버 origin·정확한 환자ID·보안 토큰 입력, 자료 주체/시험 동의 | preflight의 patientId/platform=apple-health/selected/partialMetrics 대조 후 저장. 실패 시 저장하지 않음 | ContentView/ConnectorModel/ConnectorAPI |
| I-ACCESS | 걸음·수면을 각각 선택, Apple 건강 읽기 요청 | 권한 요청 완료를 읽기 허용 증거로 표시하지 않음. HealthKit은 읽기 거절과 자료 없음 구분 불가 | HealthReader |
| I-SYNC | 최근7일 전송, 진행 중 설정·중복 저장 잠금 | 실제 수신 응답 후만 수신 건수/시각 표시. 빈 자료는 전송 없음 | ConnectorModel/SyncPayload |
| I-BACKGROUND | 기본 끔, 사용자가 자동 수신 선택 | HKObserverQuery+background delivery, OS가 허용한 때 재집계. 주기/실시간 보장 없음. 잠금/강제종료/네트워크 오류는 다음 앱 실행 재시도 | HealthReader/ConnectorModel |
| I-WEB | 같은 환자 웹 기록 열기 | origin/patientId/view=connections만 URL, 토큰 제외 | ConnectionSettings.patientURL |
| I-DISCONNECT | 로컬 연결 해제 | observer 중지, Keychain 연결/대기배치 제거. 서버 폐기는 웹에서 별도 실행 | ConnectorModel/SecureStore |

폼 저장 전 연결 대상과 건강자료 소유자를 확인한다. 저장 성공 시 입력 토큰을 지운다. 새 연결/항목 변경/해제 시 대기배치를 버리고 새 UUID로 재집계한다. 앱 작업은 직렬화하고 실행 중 버튼을 비활성화한다. 웹의 P-CONNECT에는 같은 환자·상단X·하단 메뉴를 유지한 채 아이폰 설치/권한/수신 절차를 추가한다.

## 수집·단위·권한 계약

- 서버 일자는 Asia/Seoul, 최근7개 날짜(오늘 포함). 걸음은 HKStatisticsCollectionQuery의 cumulativeSum 집계, separateBySource 합산 금지. 플랫폼의 실제 소스 우선순위/건강 앱 합계 일치는 실기기 대조한다.
- 수면은 asleep/asleepUnspecified/core/deep/REM 구간만 사용한다. inBed/awake는 포함하지 않는다. 날짜 경계로 자른 구간 합집합의 분(minute)이다. 밤샘 수면은 서울 자정에서 날짜별로 나뉘므로 건강 앱의 ‘기상일 기준’ 표시와 다를 수 있다.
- HealthKit은 앱의 읽기 허용 여부를 공개하지 않는다. 읽기 요청 성공을 허용이라고 단정하지 않는다. **자료가 없는 항목은 키를 생략**한다. 자동 null 삭제를 보내지 않는다. 거절/철회가 빈 결과로 보이므로 기존 서버 기록을 지우지 않기 위함이다. 삭제·권한 철회를 확인한 전체 원자료 정리는 후속 명시적 동의 계약 전까지 미지원이다.
- 명시적 0이 집계로 반환되면 0을 보낸다. 선택 안 한 항목은 읽지 않으며 대기배치에도 포함시키지 않는다. 날짜에 두 항목 모두 없으면 그 날짜를 생략한다. 수면만 허용/선택해도 전송 가능하다.
- HealthKit 잠금/조회 오류가 있으면 전체 새 배치를 만들지 않고 오류를 표시한다. 잠금 상태를 null/0으로 바꾸지 않는다. 마지막 성공 시각을 실패 시 갱신하지 않는다.

## 통신·보존·재시도

- Keychain의 ThisDeviceOnly 보호로 origin/patientId/token·대기 JSON을 저장한다. URL·UserDefaults·로그·iCloud 백업에 토큰/건강자료를 넣지 않는다. 웹의 연결 안내와 정확히 대조한다.
- 요청 전 preflight, 수집 후 전송 직전 다시 preflight. 플랫폼·환자·선택·부분수신을 검사한다. 서버가 반환하는 serverTime을 revision 기준으로 사용해 폰의 미래 시각으로 거부되는 일을 피한다. 이전 서버에서 serverTime이 없으면 갱신 안내로 중지한다.
- batchId/본문은 재시도 동안 동일하게 유지한다. 네트워크/5xx 후 대기는 Keychain에 보존한다. 401/403/409/기타4xx는 자동 반복하지 않고 연결 확인 안내. 새 연결/항목 선택 변경 시 대기 제거. 건강 권한은 시스템상 재검증 불가하므로 대기배치는 다음 실행 때 재사용하지 않고 **같은 실행에서 생성한 전송이 실패하면 다음 실행은 새로 조회**한다. 사용자/시스템 권한 철회 뒤 과거 대기값을 보내지 않도록 재시도 전에 재조회하며 빈/변경 결과면 새 batchId로 교체한다.
- 외부 HTTP redirect는 따르지 않는다. 토큰이 다른 origin으로 전달되지 않는다. HTTPS만 허용하고 URL의 자격증명/경로/쿼리/fragment를 거부한다.
- 앱 cold/background launch는 AppDelegate의 didFinishLaunchingWithOptions가 **반환하기 전에 observer를 동기적으로 설치**한다. 비동기 Task 안에서 뒤늦게 등록하지 않는다. 자료 조회·HTTPS는 handler에서 비동기로 실행하고 완료 콜백은 성공/실패 모두 호출한다.
- 서버 기존 API/DB schema3/출처 apple-health/수동값 우선 계약 유지. 새 serverTime과 플랫폼별 구현/검증 metadata는 추가 필드다. nativeBridge.implemented/verified의 기존 보수적 false를 유지하고 platforms 목록에서 소스 구현/검증 단계를 구별한다.

## 인수조건

Swift production core: origin 검증·대상 검사·서울 날짜·수면 합집합/밤샘·선택 생략/빈 자료/0·payload 재전송. 임시 서버: apple-health preflight/부분 수신/출처·수동0 우선. 브라우저: iPhone 기본 선택·설치/권한/최근 수신 안내·기존 X/역할 경계·GPT 추안 섭취비율 저장. Xcode simulator unsigned build를 별도 CI에 정의하고 실행 여부를 기록한다. 실제 설치/권한 거절·철회/워치 중복·잠금/강제종료/백그라운드는 기기에서 검증 후 완료 판정한다.

공식 기준 링크(실기기 정책·SDK 버전 확인 필요):

- https://developer.apple.com/documentation/healthkit
- https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
- https://developer.apple.com/documentation/healthkit/hkobserverquery
- https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)
