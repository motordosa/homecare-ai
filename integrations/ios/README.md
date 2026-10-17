# HomeCare iPhone 건강 연결 앱 0.1.0

현재 우선 대상은 iPhone·Apple Health다. 환자 사이트는 모바일 웹을 유지하고 이 작은 연결 앱이 HealthKit 읽기 권한으로 걸음 수·실수면을 서버에 보낸다. Apple Watch 데이터는 iPhone의 Apple 건강에 먼저 공유되어야 한다. 별도 건강 API 키는 필요 없다.

**소스·핵심 Swift 검사·앱 구문 검사와 Xcode 빌드·서명·설치·실기기 수신은 별도다.** 이 저장소는 설치 가능한 서명 IPA/TestFlight 링크를 포함하지 않는다. 최신 검증 증거는 docs/CHANGELOG.md, 코드 작성 전 기준은 docs/IOS_CONNECTOR.md를 따른다.

## Mac에서 설치

1. 저장소의 최신 main을 다운로드하거나 clone한다. Xcode15 이상과 iOS16 이상 iPhone이 필요하다. 최신 Xcode/기기의 실제 호환성을 확인한다.
2. `integrations/ios/HomeCareConnector.xcodeproj`를 연다. Scheme은 `HomeCareConnector`다.
3. Target → Signing & Capabilities에서 **본인/기관의 개발팀**을 선택하고 Bundle Identifier를 해당 팀의 고유 값으로 바꾼다. HealthKit 및 Background Delivery capability 서명을 지원하는 팀·프로비저닝이 필요하다. 앱 설치 비용이 무료 Render 서버 요금에 포함되는 것은 아니다.
4. iPhone을 연결하고 개발자 모드·기기 신뢰를 설정한 뒤 기기를 실행 대상으로 선택해 Run한다. 개인 팀의 capability 제한/프로비저닝 실패는 자동으로 우회할 수 없다.
5. Mac이 없으면 계정 소유자가 등록한 Apple Developer 팀에서 Archive → App Store Connect → TestFlight 업로드·테스터 등록이 필요하다. Apple 계정/서명키/인증서를 Git이나 채팅에 보내지 않는다.

## 사용

1. Render 최신 서버를 먼저 배포한다. preflight가 serverTime/partialMetrics를 제공해야 한다.
2. 환자 웹 → **건강 연결 → 연결 프로그램용 코드 준비 → iPhone**에서 코드를 만든다. 서버 origin·환자 이름·정확한 ID를 대조한다.
3. 앱에 origin/ID/코드를 입력하고 자료 주체/시험 동의를 확인한 뒤 저장한다. 이때 서버의 환자·플랫폼·선택 출처를 먼저 검증한다. 토큰은 저장 후 입력창에서 지운다.
4. 걸음·수면 항목을 선택하고 **선택 항목의 읽기 권한 요청**을 누른다. 요청 완료가 읽기 허용을 뜻하지 않으며 Apple 건강에서 실제 허용·자료 공유를 확인한다.
5. **최근7일 동기화** 후 앱의 서버 수신 확인과 웹의 날짜·출처·마지막 수신 시각을 대조한다. 직접 입력값이 있으면 우선 표시한다.
6. 자동 수신은 별도로 켠다. HKObserverQuery/hourly background delivery는 iOS 정책에 따른 최선 노력이며 정시/실시간 보장이 아니다. 잠금·앱 강제종료·절전·워치 공유 지연 후 앱을 열어 재시도한다.

## 자료 의미

- 걸음은 HealthKit cumulativeSum, 원본 폰/워치 합계를 다시 더하지 않는다. 소스 우선순위가 건강 앱 표시와 일치하는지는 실기기 대조가 필요하다.
- 수면은 실제 수면 단계의 합집합이며 inBed/awake 제외. Asia/Seoul 자정 기준으로 나누므로 기상일 기준 화면과 날짜 분배가 다를 수 있다.
- **빈 자료는 생략**한다. HealthKit은 읽기 거절과 자료 없음을 구별하지 않아 자동 null 삭제를 전송하지 않는다. 따라서 원자료 전체 삭제를 서버에 자동 반영하는 기능은 현재 지원하지 않는다.
- Keychain ThisDeviceOnly로 대상/토큰/대기를 저장한다. URL에 토큰을 넣지 않는다. 전송 실패 후 재시도 전 실제 자료를 다시 읽어 철회/변경된 항목을 점검한다. 본문이 바뀌면 새 batchId다.
- 로컬 연결 해제는 서버 토큰 폐기와 별개다. 서버 폐기는 환자 웹의 해당 연결에서 수행한다.

## 개발 검사

```bash
swift test --package-path integrations/ios --jobs 2
xcodebuild -project integrations/ios/HomeCareConnector.xcodeproj \
  -scheme HomeCareConnector -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/homecare-ios-build CODE_SIGNING_ALLOWED=NO build
```

macOS CI의 unsigned simulator build는 설치 가능한 iPhone 서명을 증명하지 않는다. Swift Package는 실제 앱이 사용하는 `Core/`를 그대로 검사하며 HealthKit/Security/SwiftUI 실행을 대신하지 않는다. 외부 Swift 라이브러리 의존성은 없다.

실기기 완료표: 자료 주체/폰·워치 모델·iOS 버전, 항목 하나/둘 선택, 읽기 거절·철회, 빈 데이터, 폰/워치 중복, 밤샘/낮잠, 원자료 변경, 네트워크 실패, 토큰 폐기, 잠금·강제종료·재부팅·백그라운드 지연. 결과는 개인 건강수치/토큰 없이 성공·오류 문구만 공유한다.
