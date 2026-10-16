# HomeCare AI 자동 연동: 확인 근거와 구현 전 계약 제안

검토일: 2026-10-16. 범위: 모바일 웹과 네이티브 건강정보 접근, 폰·워치의 걸음수/수면 동기화, 중복·권한·시간대·백그라운드 동작. 저장소 앱 코드는 변경하지 않았다. 아래에서 **확인**은 실제 열람한 출처의 내용, **제안**은 HomeCare AI 설계 판단, **미확인**은 실기기나 공급자 문서로 추가 확인할 사항이다.

## 1. 결론: 웹 UI + 선택 설치 네이티브 연결 모듈

**제안:** 사진 촬영·식사 AI 자동기록·복약 자기보고·기록 조회는 웹에서 먼저 완성할 수 있다. HealthKit/Health Connect의 개인 건강기록 자동 읽기는 같은 서비스의 **설치형 네이티브 연결 모듈**로 제공한다. 사용자가 연동을 선택할 수 있다는 의미이지, 센서 자동수집을 요구하는데 네이티브 구현을 생략할 수 있다는 의미는 아니다.

**확인:** Android 공식 SDK는 Android `Context`, 앱 권한, Health Connect 서비스 연결을 사용한다.[A1,A2] Stanford의 HealthKit 연동 구현은 Swift의 `HKHealthStore`, 사용자 승인, 관찰/앵커 쿼리를 사용한다.[I1,I2,I3] Capacitor 공식 프로젝트는 웹 코드가 Swift/Kotlin 네이티브 플러그인을 호출하는 앱 구조를 명시한다.[W1]

**이로부터의 설계 판단:** 일반 Safari/Chrome 탭 또는 홈 화면에 추가한 PWA만으로 위 네이티브 저장소를 직접 읽는 경로를 제품 계약에 넣지 않는다. 웹 화면에 권한 버튼을 그리거나 브라우저 센서 API를 사용하는 것은 HealthKit/Health Connect 과거 기록의 연동 완료와 다르다. 서비스워커를 추가해도 HealthKit 권한과 네이티브 SDK가 생기지 않는다. 별도 승인된 공급자의 클라우드 API는 다른 연동 경로가 될 수 있으나 이번 조사에서 확보하지 않았다.

권장 기본안은 **웹 UI를 재사용하는 설치형 앱 셸 + 작고 독립적인 Swift/Kotlin 건강정보 플러그인**이다. Capacitor는 후보 도구이며 채택 확정이나 건강정보 플러그인 검증 완료를 뜻하지 않는다. 순수 웹 사용자도 식사·복약·조회 기능을 이용한다. 기존 앱 재사용·배포 조건이 맞지 않으면 별도 작은 네이티브 연결 앱을 두고 같은 계정에 연결하는 대안도 가능하다.

```text
사진/복약/조회 웹 UI ────────────────────────┐
                                           │
설치형 앱 셸                               서버 API
  ├─ Android Health Connect 연결 모듈 ──────→ 권한·참여자 확인
  └─ iOS HealthKit 연결 모듈 ───────────────→ 멱등 수신·원자료 출처
       ├─ 네이티브 변경 읽기/재시도             일별 집계·품질 상태
       └─ 암호화된 전송 대기열                  의료진/환자 웹 조회
```

앱 UI의 JavaScript 타이머가 계속 살아 있다고 가정하지 않는다. 운영체제가 허용하는 네이티브 작업이 변경분을 읽어 로컬에 안전하게 보관하고, 통신 가능 시 서버에 전송한다. 앱을 열 때 보충 동기화를 수행한다. 연동 앱은 측정기 그 자체가 아니므로, 원본 수집기나 워치가 기록하지 않은 수면을 생성할 수 없다.

## 2. 지원 경로와 사실 수준

| 사용자 환경 | 제안하는 경로 | 계약상 조건·미확인사항 |
|---|---|---|
| Android 폰만 사용 | 폰/건강 앱이 만든 걸음수 → Health Connect → 연결 모듈 | 폰이 걸음을 실제 기록하고 Health Connect에 제공하는지 실기기 확인. 폰만으로 자동 수면이 존재한다고 약속하지 않음. |
| Galaxy Watch + Android | Watch 측정 → 연결된 Samsung Health/폰 → Health Connect → 연결 모듈 | 이번에 Samsung 공식 지원표를 직접 열람하지 못함. 모델·OS·Samsung Health 버전·개별 항목 공유 설정·지연을 실제 기기에서 검증한 뒤 지원표에 등록. 모든 워치/모든 수면 단계 공유 보장 금지. |
| iPhone만 사용 | iPhone/지원 건강 앱 기록 → Apple 건강 저장소 → HealthKit 연결 모듈 | 읽을 수 있는 실제 걸음/수면 기록의 존재와 출처 확인. 앱 설치만으로 수면 추정 시작을 보장하지 않음. |
| Apple Watch + iPhone | Watch 기록 → iPhone 건강 저장소 → HealthKit 연결 모듈 | 연결·착용·수면 설정 및 원본 생성/전달 지연을 실기기에서 확인. 손목에서 서버까지 실시간 전송이라고 표시하지 않음. |
| 순수 모바일 웹 | 사진·복약·서버에 도착한 건강기록 조회 | 건강기록 메뉴에서 연결 앱 설치/열기, 동기화 상태 확인. 실제 연동 전 임의 수치를 보여주지 않음. |
| 보호자 폰으로 대리 입력 | 웹에서 지정 환자의 식사·복약 대리 기록 | **보호자 자신의 건강 저장소를 환자 데이터로 업로드하지 않도록 차단.** 건강기록 연결은 실제 데이터 소유자와 참여자를 별도로 확인. |

위 기기 경로는 제품 설계 후보이다. **이번 검토로 Galaxy Watch·Apple Watch 종단간 연동을 테스트한 것은 아니다.** 기기별 지원은 `지원 확인 / 조건부 / 미검증 / 미지원`으로 관리한다. Android 샘플의 최소 OS 표기와 SDK 개발 브랜치의 실행 조건이 다를 수 있으므로 오래된 README 숫자 하나를 제품 최소 사양으로 복사하지 않는다.[A1,A6]

## 3. 반드시 문서에 넣을 데이터·행동 계약

### 3.1 연결과 권한

- 연결은 로그인된 환자 선택만으로 자동 바뀌지 않는다. `participant_id + connector_installation_id + platform_store_binding`을 명시적으로 결합하고, 재연결 시 기존 큐/커서가 다른 환자에게 전송되지 않게 한다.
- 수집 대상은 초기에는 걸음수·수면 읽기만으로 제한한다. 기록 쓰기·위치·심박 등 미사용 권한은 함께 요청하지 않는다.
- 연구 동의, OS 건강정보 접근 승인, 서버 전송 동의는 별개 상태로 기록한다. 권한을 철회하면 신규 수집을 중지하고, 이미 저장된 자료의 처리와 연구 철회는 별도 승인된 정책에 따른다.
- Android 백그라운드 읽기는 기능 지원 검사와 별도 `READ_HEALTH_DATA_IN_BACKGROUND` 승인이 필요하다. 이 기능이 없으면 앱을 연 때 읽는 경로를 제공하고 자동 백그라운드 지원이라고 표시하지 않는다.[A2]
- Health Connect의 과거 자료 권한은 최초 승인 이전 30일보다 오래된 자료의 접근에 영향을 준다. 연구에 필요한 기간만 요청한다. 이것은 변경 커서의 30일 만료와 **서로 다른 제한**이다.[A1,A2]
- iOS에서는 승인 요청 완료를 실제 읽기 허용 완료로 단정하지 않는다. Spezi 구현은 요청 상태가 true라도 사용자가 접근을 허용했다는 뜻이 아니라고 명시한다.[I2] 빈 결과만으로 `권한 거부`와 `측정 없음`을 확정 구분하지 못하는 경우 `자료 없음/접근 확인 필요`로 표현한다.

### 3.2 수신·삭제·재처리

최소 원자료 필드: `participant_id`, `connector_installation_id`, `platform`, `record_type`, `source_record_id`, `source_app`, `source_device`(있을 때), `recording_method`, `start_at`, `end_at`, `start_utc_offset`, `end_utc_offset`, `timezone_id`(알 때), `source_modified_at`, `received_at`, `value/unit`, `schema_version`, `sync_run_id`, `status`.

- Android는 `Metadata.id`, `dataOrigin`, `lastModifiedTime`, 기록 방법·기기 정보를 제공한다. 원 기록의 ID와 출처를 함께 보존한다.[A3]
- 서버 수신은 같은 레코드 재전송 시 합산하지 않는 upsert로 한다. 플랫폼+연결+원본 ID 등으로 키를 정한다. 기기 변경·재설치 후 중복 여부도 별도 시험한다.
- 새 기록뿐 아니라 수정·삭제를 처리한다. Android `getChanges`는 페이지 처리와 만료 복구가 필요하며, 변경 토큰은 생성 후 30일 유효라고 SDK에 명시되어 있다.[A1] iOS 구현에도 추가 표본과 `HKDeletedObject` 처리 경로가 있다.[I1,I3]
- 네이티브 큐에 기록을 안전하게 보관하거나 서버가 수신을 확정하기 전 커서를 앞당겨 유실시키지 않는다. 변경분 수신 중 앱 종료와 서버 응답 손실을 테스트한다.
- 삭제 이벤트는 활성 집계에서 제외되게 반영하되 연구 동결자료·감사 이력 보존 및 법적 삭제는 승인된 정책으로 구분한다. 플랫폼 원본 삭제가 병원 연구자료의 모든 물리적 복사본 즉시 삭제와 같다고 임의 정의하지 않는다.

### 3.3 중복과 걸음수

**제안:** 동일 레코드 재전송 중복과 여러 기기가 같은 움직임을 관측한 중복을 구분한다. 단순 UUID 중복 제거로 폰+워치의 의미상 중복까지 해결됐다고 판단하지 않는다.

- Android 공식 API는 시간·출처 필터를 받는 집계를 제공하고, 공식 샘플은 `StepsRecord.COUNT_TOTAL`와 `dataOriginFilter`를 사용한다.[A1,A4,A6]
- 일별 걸음수는 해당 플랫폼의 검증된 집계/출처 정책으로 만들고 집계 버전을 남긴다. 원시 폰 걸음+워치 걸음+Samsung Health 합계를 다시 더하지 않는다.
- 플랫폼 우선순위/출처 정책이 이미 반영된 일별 합계와 원시 표본의 합계를 혼합하지 않는다. API 집계가 모든 공급자·모든 데이터형의 중복을 자동 해결한다는 보장은 이번 자료로 확인하지 못했다.
- 수동입력과 자동기록을 구분하고 알려지지 않은 기록방법을 자동기록으로 단정하지 않는다. 최종 연구 포함/제외 규칙을 데이터 사전에 둔다.
- `0걸음`은 유효한 집계 결과가 0일 때만 표시한다. 비착용/미휴대/권한 미확인/미수신을 0으로 바꾸지 않는다.

### 3.4 수면의 의미와 시간대

**확인:** Android `SleepSessionRecord`는 시작·종료 `Instant`, 두 시점의 선택적 UTC offset, 수면 단계 목록을 갖는다. 같은 세션의 단계는 겹치지 않아야 하며, `SLEEP_DURATION_TOTAL` 주석은 “total sleep session duration”이라고 설명한다.[A5]

**제안:** `수면 세션 길이`, `실제 잠든 단계 합계`, `침대에 머문 시간`을 같은 변수로 합치지 않는다. 잠든 시간은 확인된 단계 정의에 따라 계산하고, 단계가 없으면 전체 세션을 정밀한 실제 수면으로 바꾸지 않는다. 서로 다른 앱의 겹치는 수면 기록이나 in-bed와 asleep 관측을 중복 합산하지 않는다. 낮잠 포함 여부·주 수면 선택·밤샘 수면의 날짜 귀속 규칙을 문서화한다.

**확인:** Android `TimeRangeFilter`는 절대 시각과 현지 시각을 별도로 지원하며, offset이 없는 기록은 현지 시각 쿼리 시 현재 시스템 offset을 가정할 수 있다고 명시한다.[A7]

**제안:** UTC 원시 시각과 관측 당시 offset을 보존하고, 화면/연구 일자의 시간대 정책을 버전 관리한다. 국내 연구 기본 일자는 `Asia/Seoul`로 설정할 수 있으나, 여행·시간대 변경·수동 시계 변경과 offset 없는 원본은 품질 표시가 필요하다. `오늘`을 서버 UTC 자정으로 자르지 않는다. 수면은 원 세션을 보존하고 예를 들어 기상일 귀속 정책을 따르되 연구팀이 확정한다.

### 3.5 자동 동기화와 UI 상태

**확인:** Android WorkManager의 반복 작업 최소 간격은 15분이며, doze/배터리 최적화·제약 때문에 지연될 수 있다고 공식 코드가 설명한다.[A8] iOS에서 확인한 구현은 HealthKit observer/anchored query를 사용한다. 그 코드의 `.immediate` 요청이 특정 분 단위 도착 보장을 뜻하는지는 이번 자료로 확인하지 못했다.[I3]

**제안:** 사용자 문구는 “연동 후 자동으로 가져오기, 앱을 열면 추가 동기화”로 한다. “항상 실시간”, “5분마다 반드시 수집”, “화면을 닫아도 즉시 병원에 도착” 같은 보장은 두지 않는다. 이 경로를 긴급 알림·응급 모니터링의 전제로 삼지 않는다.

사용자 화면에서는 `연결 필요`, `연결 중`, `자료 가져오는 중`, `업로드 대기`, `최근 동기화 완료`, `자료 없음/접근 확인 필요`, `연결 확인 필요`, `기기 미지원`을 구분한다. 환자에게 구현 용어를 나열하지 않고 필요한 행동과 마지막 성공 시각을 보여 준다. 내부 상태는 세분화하되 iOS에서 관측할 수 없는 권한 상태를 확정값으로 저장하지 않는다.

`활동·수면` 메뉴는 오늘/최근 7일 자료, 실제 출처, 마지막 업데이트, 자료 누락 설명, 연결 관리로 이동한다. 버튼을 누르면 화면 숫자만 임의 갱신하는 데모 로직은 실연동 상태와 분리한다. `동기화 완료`는 조회 성공뿐 아니라 해당 배치의 서버 영속화까지 확인된 상태로 정한다.

## 4. 구현 전·후 검증 단계 제안

| 단계 | 수행 내용 | 다음 단계 기준 |
|---|---|---|
| 계약 확정 | 수집 항목·소유자 결합·시간대·걸음 집계·수면 정의·수정/삭제·지원 상태·실패 UX를 명시 | 음식/복약/센서 메뉴가 각각 할 일을 설명할 수 있고, 미구현을 성공 표시하지 않음 |
| 읽기 전용 기기 실증 | Android 폰, Galaxy Watch 연결 폰, iPhone, Apple Watch 연결 iPhone에서 승인→원기록→서버→웹을 연결. 워치 없는 경로도 점검 | 기기·OS·건강 앱 버전과 실제 읽힌 항목·출처·지연을 기록. 모의자료와 실측자료 분리 |
| 데이터 신뢰성 시험 | 재전송·수정·삭제·페이지 처리·커서 만료·재설치·환자 전환·보호자 계정·자정/시간대·폰+워치 중복 | 중복 합산/환자 혼합/확정 수신 자료 유실 0. 원본과 집계 차이를 설명 가능 |
| 72시간 이상 실사용 시험 | 최소 두 번의 야간 수면, 앱 백그라운드/강제 종료, 잠금, 재부팅, 저전력, 네트워크 단절/복귀, 권한 철회/재허용, 워치 미착용 | 상태와 복구가 설명 가능. 수집 지연·동기화 성공률·배터리/지원 부담을 실제 측정 |
| 소규모 사용자 파일럿 | 최소 5명 정도의 서로 다른 지원 기기에서 1주 운영하는 계획을 연구 여건에 맞춰 확정 | 실기기 검증 결과로 지원표·목표 동기화 지연·운영 지원 절차를 정한 뒤 연구 확대 |

72시간·5명·1주는 **제안한 기술검증 계획**이며 문헌이 보장하는 충분한 표본 수나 임상 타당도 기준이 아니다. 실제 임상 연구자료 수집은 승인된 연구 범위에 따른다. 현재 단계에서는 소스 확인만 수행했으므로 위 검증을 통과했다고 표시하지 않는다.

## 5. 직접 열람한 출처와 정확한 확인 범위

아래 GitHub 개발 브랜치는 배포 SDK의 고정 사양과 다를 수 있다. 구현 때는 검증한 릴리스·의존성 버전을 고정한다. 원문 사이트 접근 제한은 우회하지 않았으며, Apple/Samsung 공식 개발자 원문을 읽었다고 주장하지 않는다.

- **[A1] AndroidX 공식 HealthConnectClient.kt**: https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/HealthConnectClient.kt — Android Context 기반 연결, 기록/집계 API, 수정·삭제, 변경 토큰. 직접 확인 문구: “Changes-tokens are only valid for 30 days after they're generated.”
- **[A2] AndroidX 공식 HealthPermission.kt**: https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/permission/HealthPermission.kt — 타입별 읽기/쓰기, 별도 background/history 권한과 기능검사. 문구: “An attempt to read data in background without this permission may result in an error.”
- **[A3] AndroidX 공식 Metadata.kt**: https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/metadata/Metadata.kt — 원본 ID·출처·수정시각·기기·기록방법·clientRecordVersion.
- **[A4] AndroidX 공식 AggregateRequest.kt**: https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/request/AggregateRequest.kt — 집계의 시간·출처 필터.
- **[A5] AndroidX 공식 SleepSessionRecord.kt**: https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/SleepSessionRecord.kt — 세션/단계 구조, 시각/offset, 단계 비중첩 조건. 이전 조사에서 보관한 `healthconnect_sleep.source`를 재검토했다.
- **[A6] Android 공식 Health samples**: https://github.com/android/health-samples/tree/main/health-connect/HealthConnectSample — 앞선 조사 보관본 `healthconnect_manager.source`, `healthconnect_sample.source`를 재검토했다. 집계에 source filter를 사용하는 예시와 단계별 수면 모델을 확인했다. 샘플의 랜덤 생성 데이터는 실측 검증 근거로 사용하지 않았다.
- **[A7] AndroidX 공식 TimeRangeFilter.kt**: https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/time/TimeRangeFilter.kt — 절대시각/현지시각 구분. 문구: “Record without specifying zoneOffset will assume the current system zone offset at query time.”
- **[A8] AndroidX 공식 PeriodicWorkRequest.kt**: https://github.com/androidx/androidx/blob/androidx-main/work/work-runtime/src/main/java/androidx/work/PeriodicWorkRequest.kt — 반복 작업의 최소 간격과 배터리 최적화에 따른 지연. 문구: “Periodic work has a minimum interval of 15 minutes.”
- **[I1] Stanford SpeziHealthKit 공식 프로젝트 README**: https://github.com/StanfordSpezi/SpeziHealthKit/blob/main/README.md — 대학 프로젝트의 Swift HealthKit 통합, 추가/삭제 표본 전달, 배경 수집. Apple의 공식 개발 문서 자체는 아니다.
- **[I2] Stanford Spezi HealthKit.swift**: https://github.com/StanfordSpezi/SpeziHealthKit/blob/main/Sources/SpeziHealthKit/HealthKit.swift — 요청 완료 상태와 실제 읽기 허용의 차이. 문구: “A true return value does not imply that the user actually granted access; it just means that the user was asked.”
- **[I3] Stanford Spezi HealthKitSampleCollector.swift**: https://github.com/StanfordSpezi/SpeziHealthKit/blob/main/Sources/SpeziHealthKit/Health%20Data%20Collection/HealthKitSampleCollector.swift — observer/anchor 쿼리, 추가/삭제, 앵커 저장, 완료 콜백. 보완 구현: https://github.com/StanfordSpezi/SpeziHealthKit/blob/main/Sources/SpeziHealthKit/HealthKit%20Extensions/HKHealthStore%2BBackgroundDelivery.swift
- **[W1] Ionic Capacitor 공식 README**: https://github.com/ionic-team/capacitor/blob/main/README.md — 웹 앱의 네이티브 셸 및 Swift/Kotlin 플러그인. 특정 HealthKit 플러그인의 품질이나 앱스토어 승인까지 보장하는 자료는 아니다.

원본 보관: 같은 research 폴더의 `automation-*.kt`, `automation-*.swift`, `automation-*.md`. 기존 third-party Flutter health README도 비교했으나, 플랫폼 지원 버전/정책은 그 README 하나로 확정하지 않았다.

## 6. 남은 확인 사항

1. 실제 대상자의 폰·워치·OS·건강 앱 버전 분포와 원본 건강기록 존재 여부.
2. 삼성의 현재 Health Connect 항목별 공유 지원 및 Apple의 최신 HealthKit 배경 전달·잠금/강제 종료 관련 공식 사양. 접근 가능한 자료 또는 배포 환경에서 확인 필요.
3. 플랫폼 집계와 원 건강 앱 화면의 차이, 우선순위 변경, 겹치는 공급자 수면 처리. 단순 원시합과 비교하지 말고 원본 정의를 맞춰 대조.
4. 네이티브 플러그인 채택, 배포·서명·스토어 건강정보 권한 심사, 유지보수 담당자. 웹 개발만으로 이 절차가 완료되지 않는다.
5. 연구기관의 장치 연결/보호자 위임/보관·삭제 정책과 목표 동기화 지연. 사용자 동의 없이 보호자·다른 환자 건강기록을 혼합하지 않는 연결 절차.
