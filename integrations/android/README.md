# Android Health Connect 연결 앱

상태: **개발용 APK 빌드·Android lint 통과 / 설치·갤럭시 워치 실기기 연동 미검증**. 실제 환자·연구 자료를 공개 데모 서버에 연결하지 않는다. APK가 빌드된 사실만으로 웹의 네이티브 연동 상태를 검증 완료로 바꾸지 않는다.

선행 계약은 [`docs/ANDROID_CONNECTOR.md`](../../docs/ANDROID_CONNECTOR.md)와 [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md)다. 요구사항 `SYNC-01`, `SYNC-02`, `QA-01`, 변경 `CHG-2026-10-16-04`와 빌드 검증 `CHG-2026-10-16-07`에 해당한다. 앱/서버가 모두 아래 preflight 계약을 지원해야 하며, 미지원 서버는 자료 전송 전에 중지한다.

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
| Gradle 실행 도구 | 8.11.1 |
| Android Gradle Plugin | 8.10.1 |
| Kotlin Android plugin | 2.1.20 |
| JDK/toolchain | 17 (클라우드 검증: Eclipse Temurin 17.0.20.1+1) |
| compile/target SDK | 36 / 35 |
| Build tools | 35.0.0 |
| min SDK | 28 (Android 9); 실제 Health Connect 사용 가능 여부를 별도 검사 |
| Health Connect client | 1.1.0 |
| WorkManager | 2.10.1 |
| Activity / Core / Lifecycle | 1.10.1 / 1.15.0 / 2.8.7 |
| Coroutines | 1.9.0 |

동적 `+` 버전을 쓰지 않는다. Maven 저장소는 Google/Maven Central이며 플러그인용 Gradle Plugin Portal을 사용한다. 현재 버전 조합의 APK 컴파일과 lint를 검증했다. Health Connect 1.1.0 AAR의 `minCompileSdk=36` 요구로 compile SDK를 36으로 설정했다. target SDK는 35이며, 36으로 변경하려면 동작 변경을 실기기에서 검증해야 한다.

## SDK가 준비된 개발 기기에서 빌드

1. JDK 17, Android SDK Platform 36, Build Tools 35.0.0, Gradle 8.11.1을 공식 경로로 설치한다. 서명/체크섬/TLS 검증을 끄지 않는다. Android Studio에서 이 디렉터리를 열고 Gradle JDK를 17로 설정할 수 있다.
2. 로컬 SDK 위치를 `local.properties`의 `sdk.dir`에 설정한다. 이 파일은 Git 제외 대상이다. 키·토큰을 Gradle 속성이나 소스에 넣지 않는다.
3. 이 디렉터리에서 다음을 실행한다.

```sh
gradle --version
gradle :app:assembleDebug :app:lintDebug
```

Gradle wrapper와 wrapper JAR는 이 작업에서 다운로드·생성하지 않았다. 따라서 아직 `./gradlew`는 없다. 검증된 로컬 Gradle로 wrapper를 생성해 관리하려면 공식 배포판 체크섬을 확인하고 별도 리뷰한다. debug APK 위치는 `app/build/outputs/apk/debug/app-debug.apk`다. 개발용 debug 키로 서명했으며 release 서명키·스토어 배포는 수행하지 않았다.

이 클라우드의 도구·캐시·debug 키·검증 로그는 Git 밖 `/workspace/homecare-deploy-research/android-toolchain/`에 있다. 기존 `HOME`을 바꾸지 않고 `JAVA_HOME`, `ANDROID_USER_HOME`, Gradle user home과 debug signing init script를 작업 디렉터리로 지정했다. 환경에서 제공한 CA를 복사한 truststore에 추가해 TLS 검증을 유지했다. 환경별 프록시 설정은 권한 0600 파일에 실행 중에만 기록하고 끝나면 제거한다. 현재 작업공간에서 동일 검사를 재현하는 명령은 다음과 같다.

```sh
python /workspace/homecare-deploy-research/android-toolchain/run-gradle.py build-recheck.log :app:assembleDebug :app:lintDebug
```

이 명령은 해당 클라우드에 설치한 도구를 사용한다. 새 환경에서는 위 공식 도구를 먼저 설치하고 SDK 라이선스 수락·로컬 경로·환경 CA를 준비해야 한다. 앱이 서버에 보내는 Health Connect 연결 토큰은 빌드에 필요하지 않다.

빌드 후 테스트 폰에 설치하고 웹에서 **해당 테스트 환자**의 Android 토큰을 발급한다. 앱에 HTTPS 검증 서버 origin, 환자 ID, 토큰을 입력하고 주체·개발용 확인을 마친다. 서버 preflight→Health Connect 권한→최근 7일 수동 동기화→웹 출처/수신 시각 대조를 순서대로 수행한다. 삼성 헬스에서 Health Connect로 해당 자료가 실제 공유되는지 먼저 확인한다.

USB 디버깅을 허용한 개발용 테스트 폰에서 사용할 설치 명령 예시다. 이 클라우드에서 실제 폰 설치를 실행하지는 않았다.

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 검증 기록과 남은 인수조건

2026-10-16 공식 Gradle/JDK 배포판의 게시 체크섬, Android command-line tools의 공식 SDK 메타데이터 체크섬을 확인하고 도구를 설치했다. SDK 35를 사용한 첫 시도는 Health Connect AAR의 compile SDK 36 요구 검사에서 중지됐다. 검사 우회 없이 계약과 도구 버전을 갱신한 뒤 **`:app:assembleDebug :app:lintDebug`가 성공했다.** Kotlin·Java 컴파일, manifest merge, APK 패키징, lint를 실행했다. **기기 설치·UI 실행·실제 Health Connect/갤럭시 워치 동기화는 아직 검증하지 않았다.**

실행한 검사는 다음과 같다.

- 앱이 실제 호출하는 `ServerOrigin.java`, `SleepIntervals.java`를 Java compiler 모듈로 직접 컴파일·호출: **16개 통과**. HTTPS origin 제한, 서울 자정 절단, 수면 겹침/중복/각성 간격/분 소수값/일일 상한을 검사했다. Kotlin 구현을 복제한 검사가 아니다.
- Android lint: **오류 0, 경고 22**. 경고는 target SDK 35 유지, 개발용 앱 아이콘 미지정, 한국어 문자열 리소스화와 KTX 사용 제안이다. lint를 끄거나 오류를 무시하도록 설정하지 않았다. 보고서는 `app/build/reports/lint-results-debug.html`에 생성된다.
- Health Connect 1.1.0의 Google Maven 공식 sources JAR에서 `features`, background feature 상수, permission contract, 페이지 인자, 수면 단계 상수를 확인했다. 실제 폰에서 기능 제공·권한·백그라운드 제약은 별도 확인해야 한다.

앱 ID는 `ai.homecare.connector`, versionCode는 `1`, versionName은 `0.1.0-unverified`다. `unverified`는 실기기 연동 미검증을 나타낸다. APK의 debug 서명·체크섬과 정확한 빌드 소스 목록은 도구 디렉터리의 `BUILD-RECORD.md`에 기록한다. 이 개발 APK를 운영 배포 파일로 사용하지 않는다.

이번 최종 개발 APK는 **13,219,849 bytes**, SHA-256 `2730642226671b5d69664240f65429e14f22f80ce4725d09bcde42db87e81f13`이다. APK Signature Scheme v2 검증을 통과했다. 복사본은 현재 작업공간의 `/workspace/homecare-deploy-research/HomeCareAI-connector-debug.apk`에 있으며 APK·debug 키는 Git에 포함하지 않는다. 이 체크섬은 이번 산출물의 값이고 향후 재빌드 산출물의 동일 바이트를 보장하지 않는다.

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
- [Gradle 8.11.1 공식 배포판](https://github.com/gradle/gradle-distributions/releases/tag/v8.11.1)과 [게시 SHA-256](https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256), [Temurin 17 공식 배포판](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1), [Android SDK 공식 메타데이터](https://dl.google.com/android/repository/repository2-3.xml): 이번 도구 설치에서 확인한 배포·검증 출처.
- [AGP 8.10 호환성 안내](https://developer.android.com/build/releases/past-releases/agp-8-10-0-release-notes): 추가 참고 링크. 이 웹 본문을 클라우드에서 직접 열어 읽었다는 뜻은 아니다.
