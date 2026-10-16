# Android Health Connect 연결 앱

상태: **기본 소스 구현 / APK 빌드·설치·갤럭시 워치 실기기 미검증**. 실제 환자·연구 자료를 공개 데모 서버에 연결하지 않는다. 이 디렉터리의 코드가 존재한다는 이유로 웹의 네이티브 연동 상태를 검증 완료로 바꾸지 않는다.

선행 계약은 [`docs/ANDROID_CONNECTOR.md`](../../docs/ANDROID_CONNECTOR.md)와 [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md)다. 요구사항 `SYNC-01`, `SYNC-02`, `QA-01`, 변경 `CHG-2026-10-16-04`에 해당한다. 앱/서버가 모두 아래 preflight 계약을 지원해야 하며, 미지원 서버는 자료 전송 전에 중지한다.

## 구현한 경로

갤럭시 워치 → 삼성 헬스 등 호환 앱 → 폰 Health Connect → 이 연결 앱 → 입력한 HTTPS 서버 → 기존 환자/의료진 웹.

- 로그인 없는 웹에서 발급한 **Health Connect 연결 토큰**을 입력한다. 앱의 별도 사용자 로그인은 구현하지 않았다.
- 건강자료 소유자 확인과 웹 환자 ID 입력 후 `GET /api/health-sync/connection`의 Bearer 응답 `{connectionId,patientId,platform}`를 대조한다. 일치해야 연결을 저장한다. 매 동기화에서도 건강자료 읽기와 대기 배치 전송 전에 재확인한다.
- 걸음·수면 읽기를 모두 허용한 경우 최근 7일(오늘 포함)을 `Asia/Seoul` 경계로 조회한다. 한 종류 권한이 없으면 부분 자료를 null로 덮어쓰지 않고 전체 전송을 중지한다.
- 걸음 수는 Health Connect `StepsRecord.COUNT_TOTAL` 집계를 사용한다. 폰과 워치 원시 합계를 다시 더하지 않는다.
- 수면은 알려진 asleep/light/deep/REM 단계 구간을 날짜 경계로 자른 합집합이다. awake/out-of-bed/awake-in-bed는 제외한다. 기록 없음, 단계 없음, 알 수 없는 단계는 null로 처리한다. 세션 길이나 침대 시간을 수면으로 바꾸지 않는다. 알려진 단계 사이의 미기록 간격은 잠든 시간에 포함하지 않는다. 이 값은 확인된 단계의 합계이며 전일 완전측정을 보장하지 않는다.
- `POST /api/health-sync`로 `{batchId,timeZone,days:[{date,steps,sleepMinutes,updatedAt}]}`를 전송한다. 수정 시각은 재집계 시각이다. 수정·삭제는 7일 스냅샷 재조회와 null/0 교체로 반영한다. 7일보다 오래된 변경을 자동으로 소급하지 않는 범위다.
- 요청 전에 정확한 직렬화 본문을 암호화 저장한다. 네트워크 실패·서버 오류 재시도는 같은 본문·batchId를 유지한다. 서버 응답의 환자·연결·배치 ID와 수신 시각을 확인한 뒤 큐에서 삭제한다. 대기 배치 재전송 후 최신 재집계는 다음 동기화에서 수행한다.
- 별도 Health Connect background 기능·권한과 사용자의 앱 내 선택이 모두 있어야 WorkManager를 예약한다. 최소 15분 주기는 정시·상시 전송 보장이 아니다. OS 강제 종료·절전·잠금·공유 지연 조건의 실제 동작은 검증하지 않았다.
- 401/403, 409, 잘못된 응답·권한 등의 영구 실패는 자동 작업을 끄고 사용자 확인으로 돌린다. 일시 오류는 배치 본문을 보존하며 각 작업에서 제한적으로 backoff 재시도한다.

## 저장과 보안 경계

`SecureStore`는 토큰·설정·대기 배치·상태를 Android Keystore의 AES-GCM 키로 암호화한다. 백업과 기기간 전송 제외 설정을 포함했다. 키 유실/암호문 손상 시 연결을 다시 설정해야 하며 평문 fallback은 없다. 앱에서 연결 삭제는 로컬 삭제이며 서버 토큰 폐기·서버 자료 삭제가 아니다.

HTTPS origin만 허용하고 URL의 계정·경로·query·fragment를 거부한다. HTTP redirect를 따라가지 않으며 기본 TLS 인증서/호스트 검증을 유지한다. 토큰·URL 자격증명·원자료·서버 오류 본문을 앱 로그/WorkManager 결과에 출력하지 않는다. 입력 토큰은 UI 상태 저장·자동완성에서 제외하고 연결 저장 후 입력란에서 지운다.

현재 앱은 개발 검증용이다. 공개 서버의 의료진 인증, 연구 동의, IRB, 서버 보관·삭제, 실제 플랫폼 정책/스토어 심사, 기관 책임자·문의처를 대신 완성하지 않는다. 개인정보 안내 화면은 개발용 설명이며 기관 개인정보 처리방침으로 제출할 완성본이 아니다.

## 고정한 도구와 의존성

| 항목 | 버전/설정 |
|---|---|
| Gradle 실행 도구 | 8.11.1 권장·아직 이 환경에 설치하지 않음 |
| Android Gradle Plugin | 8.9.2 |
| Kotlin Android plugin | 2.1.20 |
| JDK/toolchain | 17 |
| compile/target SDK | 35 / 35 |
| min SDK | 28 (Android 9); 실제 Health Connect 사용 가능 여부를 별도 검사 |
| Health Connect client | 1.1.0 |
| WorkManager | 2.10.1 |
| Activity / Core / Lifecycle | 1.10.1 / 1.15.0 / 2.8.7 |
| Coroutines | 1.9.0 |

동적 `+` 버전을 쓰지 않는다. Maven 저장소는 Google/Maven Central이며 플러그인용 Gradle Plugin Portal을 사용한다. 현재 버전 조합의 APK 컴파일은 아직 검증하지 않았다. 버전 변경 전 계약·실기기 지원과 변경 이력을 검토한다.

## SDK가 준비된 개발 기기에서 빌드

1. JDK 17, Android SDK Platform 35와 해당 build-tools, Gradle 8.11.1을 공식 경로로 설치한다. 서명/체크섬/TLS 검증을 끄지 않는다. Android Studio에서 이 디렉터리를 열고 Gradle JDK를 17로 설정할 수 있다.
2. 로컬 SDK 위치를 `local.properties`의 `sdk.dir`에 설정한다. 이 파일은 Git 제외 대상이다. 키·토큰을 Gradle 속성이나 소스에 넣지 않는다.
3. 이 디렉터리에서 다음을 실행한다.

```sh
gradle --version
gradle :app:assembleDebug :app:lintDebug
```

Gradle wrapper와 wrapper JAR는 이 작업에서 다운로드·생성하지 않았다. 따라서 아직 `./gradlew`는 없다. 검증된 로컬 Gradle로 wrapper를 생성해 관리하려면 공식 배포판 체크섬을 확인하고 별도 리뷰한다. debug APK 위치는 정상 빌드 시 `app/build/outputs/apk/debug/app-debug.apk`다. release 서명키·스토어 배포·APK 배포는 수행하지 않았다.

빌드 후 테스트 폰에 설치하고 웹에서 **해당 테스트 환자**의 Android 토큰을 발급한다. 앱에 HTTPS 검증 서버 origin, 환자 ID, 토큰을 입력하고 주체·개발용 확인을 마친다. 서버 preflight→Health Connect 권한→최근 7일 수동 동기화→웹 출처/수신 시각 대조를 순서대로 수행한다. 삼성 헬스에서 Health Connect로 해당 자료가 실제 공유되는지 먼저 확인한다.

## 검증 기록과 남은 인수조건

2026-10-16 이 클라우드에는 Java 실행환경은 있지만 Gradle·Android SDK·Kotlin compiler가 없어 **APK 빌드, Android lint, UI 실행, 실제 Health Connect/갤럭시 워치 동기화를 실행하지 못했다.**

실행한 검사는 다음과 같다.

- 앱이 실제 호출하는 `ServerOrigin.java`, `SleepIntervals.java`를 Java compiler 모듈로 직접 컴파일·호출: **16개 통과**. HTTPS origin 제한, 서울 자정 절단, 수면 겹침/중복/각성 간격/분 소수값/일일 상한을 검사했다. Kotlin 구현을 복제한 검사가 아니다.
- Manifest·스타일·백업 XML 3개 파싱 통과. XML 파싱은 Android manifest merge/lint를 대신하지 않는다.
- Health Connect 1.1.0의 Google Maven 공식 sources JAR에서 `features`, background feature 상수, permission contract, 페이지 인자, 수면 단계 상수를 확인했다. 확인한 API 존재가 전체 앱 컴파일 성공을 의미하지 않는다.

핵심 Java 검사 재실행:

```sh
bash checks/run-core-checks.sh
```

이 스크립트는 앱에 포함되는 실제 Java helper만 컴파일한다. Android 의존성과 Kotlin·APK는 다루지 않는다. 임시 출력은 삭제한다.

실기기에서 남은 검증:

- 토큰 환자 불일치·서버 폐기·선택 변경, 보호자 폰 오연결 방지, 기기 로컬 연결 삭제.
- 걸음·수면·background 개별 거부/철회/재허용, provider 없음/업데이트·Android 9~13 및 14+ 설정 화면.
- 폰/워치 동시 걸음, 낮잠·자정 넘는 수면·중복 세션·unknown 단계·단계 미제공.
- 오프라인/복귀, 응답 유실 후 동일 배치, 앱/worker 동시 실행, 잠금·강제 종료·재부팅·절전.
- Health Connect 원기록 수정/삭제 후 최근 7일 교체, 웹에 수신시각·null/0·수동값 우선순위가 정확한지 확인.
- 배포 대상 기기별 삼성 헬스 항목 공유 지원, 기록 지연, 백그라운드 수집 지연, 배터리 소모를 측정.

## 코드 위치와 참고 자료

- `MainActivity`: 연결·소유자 확인·권한·상태 UI, `PrivacyActivity`: Health Connect의 사용 목적 안내.
- `HealthReader`: 플랫폼 집계와 실제 수면 단계; `SleepIntervals`: 중복 구간 합집합.
- `SyncCoordinator`: preflight·암호화 큐·동기화 직렬화; `BackgroundSync`: 선택 WorkManager.
- `ConnectorApi` / `ServerOrigin`: HTTPS 계약; `SecureStore`: Android Keystore 보관.

직접 확인한 공식 자료:

- [Android Health Connect sample](https://github.com/android/health-samples/tree/main/health-connect/HealthConnectSample): 권한/manifest/집계 흐름 참고. 샘플의 랜덤 수면 생성 기능은 사용하지 않았다.
- [AndroidX HealthConnectClient](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/HealthConnectClient.kt), [권한](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/permission/HealthPermission.kt), [WorkManager](https://github.com/androidx/androidx/blob/androidx-main/work/work-runtime/src/main/java/androidx/work/PeriodicWorkRequest.kt).
- [배포된 Health Connect 1.1.0 sources](https://dl.google.com/dl/android/maven2/androidx/health/connect/connect-client/1.1.0/connect-client-1.1.0-sources.jar): 고정 릴리스의 사용 API 확인.
- [Gradle 8.11.1 공식 릴리스 정보](https://docs.gradle.org/8.11.1/release-notes.html), [AGP 8.9 공식 호환성 안내](https://developer.android.com/build/releases/past-releases/agp-8-9-0-release-notes): SDK 준비 환경에서 확인할 빌드 기준 링크. 이 클라우드에서 이 웹 본문을 읽거나 해당 조합을 빌드했다는 뜻은 아니다.
