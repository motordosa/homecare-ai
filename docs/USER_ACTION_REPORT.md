# GPT·iPhone 사용자 실행 요청 보고서 v0.5

2026-10-17 KST. 최신 요청은 **음식 사진 GPT 분석과 iPhone 우선 건강 연결**이다. 이전 Android 경로는 보존하되 첫 설치·검증 대상은 아이폰으로 변경했다. 구현·검사 결과는 CHANGELOG, 제작 기준은 SCREEN_SPEC/GPT_ACTIVATION/IOS_CONNECTOR에 있다.

## 현재 상태와 필요한 외부 작업

| 영역 | 개발자가 수행한 범위 | 계정·기기 소유자가 해야 할 일 |
|---|---|---|
| 음식 사진 | OpenAI Responses·동의·초안·칼로리/단백질·섭취비율·DB/의료진 표시·설정/제공자 오류 진단 | 실제 API 키·API 결제/한도, Render 설정과 실제 사진 검증 |
| iPhone | HealthKit/SwiftUI 앱 소스·환자 대조·집계·Keychain·재시도·자동 수신 선택·웹 안내 | Apple 팀 서명·설치 또는 TestFlight, 실제 읽기 권한·폰/워치 검증 |
| 서버/웹 | apple-health 수신·출처·부분 항목·수동값 우선·최근 수신 표시 | 최신 Render 배포, 기기에서 실제 HTTPS 수신 확인 |

이 세션의 실행 환경에는 OpenAI 키·Render 관리 인증·Mac/Xcode·연결된 iPhone이 없다. 핵심 Swift 검사와 테스트 fixture를 실제 GPT 분석·HealthKit 실기기 성공으로 표시하지 않는다.

## U-01 최신 Render 배포

1. https://dashboard.render.com → 기존 `homecare-ai-demo` → Manual Deploy → Deploy latest commit. 배포 브랜치는 main이다. 최신 커밋은 최종 개발 보고에서 확인한다.
2. 필요한 가상 기록을 먼저 내보낸다. 무료 Render 재배포 시 DB/사진이 사라질 수 있고 CSV는 전체 복원본이 아니다.
3. https://homecare-ai-demo.onrender.com/api/health 의 ok:true/storage:sqlite/schemaVersion:3, `/api/capabilities`의 health.preferredPlatform:apple-health를 확인한다. schema만으로 새 프런트엔드까지 일치한다고 단정하지 않는다.
4. 환자 건강 연결의 iPhone 기본 선택·설치 안내, 의료진 데모 설정의 GPT 상태, 건강 기록→설정→뒤로가기를 확인한다.

완료 증거: 배포 커밋·Live·위 API 필드·화면. Render 비밀번호/토큰은 채팅에 보내지 않는다.

## U-02 GPT 음식 사진·칼로리 분석 활성화

현재 반드시 필요한 외부 항목이다. ChatGPT 구독과 OpenAI API 결제는 별개다.

1. 본인/기관 OpenAI API 프로젝트에서 이미지 입력을 지원하는 모델 접근권한·결제/크레딧·사용 한도를 확인한다. https://platform.openai.com 에서 API 키를 만든다.
2. Render 기존 서비스 → Environment → 아래 값을 **Render 보안 입력란**에 직접 저장하고 재배포한다. 키는 채팅·Git·브라우저 코드에 넣지 않는다.
   - `HOMECARE_VISION_API_KEY`: 실제 OpenAI API 프로젝트 키
   - `VISION_ENABLED`: `true`
   - `VISION_MODEL`: `gpt-4.1-mini` (다른 모델을 쓰면 Responses 이미지 입력/구조화 출력을 지원하는지 별도 확인)
3. 의료진 → 데모 설정 → GPT 설정 상태가 ‘서버 설정 준비됨’인지 확인한다. 이는 키 존재/모델 문자열 검사이며 실제 인증·잔액 검증은 아니다.
4. 환자 → 식사 기록 → **먹기 전 전체 음식 사진**(JPEG/PNG/WebP, 최대5MB) → 외부 AI 전송 동의 → 사진 분석 → 음식·전체 kcal/단백질 초안 확인 → 실제 섭취비율 선택·확인 → 저장한다.
5. 내 기록과 의료진 화면에서 음식명·섭취비율 적용 kcal/단백질·AI 출처를 확인한다. 예: 전체600kcal/단백질20g 초안에서 절반 섭취면 저장300kcal/10g이다. 이 수치는 설명 예시이며 실제 분석 결과가 아니다.
6. 키/권한 오류면 API 키·모델 접근권한, 한도/잔액 오류면 OpenAI 결제·사용 제한을 확인한다. iPhone HEIC가 선택되지 않으면 JPEG/PNG로 저장해 선택한다.

운영자가 서버 CLI에 접근할 수 있으면 `npm run ai:check`로 이미지 없이 모델 GET 인증 검사, `npm run ai:check -- --image /path/meal.jpg`로 명시적으로 선택한 사진의 실제 유료 추론을 검사한다. 명령에 키를 직접 쓰지 말고 서버 환경 변수만 사용한다. 개발 클라우드의 키 설정이 Render에 자동 복사되지는 않는다.

완료 증거: API 설정 상태·실제 초안 수신·저장/의료진 표시. 회신에는 오류 문구·성공/실패만 포함한다. 실제 수치 정확도는 음식·양 기준을 가진 별도 평가가 필요하다.

## U-03 iPhone 연결 앱 서명·설치

앱 소스: integrations/ios. iOS16 이상, Xcode15 이상이 기준이다. 별도 Apple 건강 API 키는 필요 없다. 웹/PWA 설치만으로 HealthKit 권한을 얻을 수 없다.

- **Mac이 있는 경우:** HomeCareConnector.xcodeproj → HomeCareConnector Target → Signing & Capabilities에서 HealthKit·Background Delivery를 지원하는 본인/기관 개발팀 선택 → 고유 Bundle Identifier → iPhone 연결·개발자 모드/신뢰 → Run.
- **Mac이 없는 경우:** Apple Developer 팀 소유자가 Xcode Archive 후 App Store Connect/TestFlight 배포·테스터 등록을 해야 한다. 무료 서버 요금과 Apple 개발자 계정 비용은 별개이며 개인 무료 팀의 capability 제한을 우회하지 않는다.
- 현재 서명된 IPA/TestFlight 링크는 없다. CI simulator 빌드·소스 ZIP은 설치 파일이 아니다. Apple 계정·인증서·서명키·비밀번호를 채팅이나 Git에 보내지 않는다.

완료 증거: 앱0.1.0 실행, iPhone/iOS/워치 모델·버전, 서명/설치 오류 문구. 계정 ID·기기 일련번호는 필요 없다.

## U-04 Apple 건강 공유·수신·자동 동기화 검증

1. 가상 시험 환자의 웹 → 건강 연결 → iPhone 코드 생성. 서버 origin·환자 이름·정확한 ID를 앱 입력과 대조한다. 보호자 폰 자료를 환자 자료로 보내지 않는다.
2. 앱에 origin/ID/token 입력 → 자료 주체·시험 확인 → 연결 저장. 토큰은 Keychain에 저장하고 입력창에서 지운다.
3. 걸음·수면 항목 선택 → 읽기 권한 요청. Apple 건강에서 실제 읽기 허용·자료 공유를 확인한다. iPhone 자체로는 워치 등의 수면 기록이 없을 수 있다.
4. 최근7일 동기화 → 앱의 서버 수신 확인 → 웹 출처 Apple Health·마지막 수신·날짜/단위 대조. 수동 입력값은 우선하므로 기기 수치와 구별한다.
5. 자동 수신은 별도로 켠다. iOS 이벤트·절전·잠금·강제종료 때문에 정시·실시간은 보장하지 않는다. 앱을 열어 수동 재시도할 수 있다.

무료 Render의 유휴 서버 시작 지연으로 첫 요청이 시간 초과되면 웹을 먼저 열고 앱에서 다시 동기화한다. 무료 서버와 iOS 백그라운드의 조합은 실제 지연·누락을 확인해야 하며 상시 수신을 보장하지 않는다.

| 검증 | 기대 결과 | 현재 실기기 결과 |
|---|---|---|
| 걸음만/수면만 선택 | 선택 자료만 전송, 다른 항목 보존 | 미실행 |
| 권한 거절·철회/자료 없음 | 빈 항목 생략·기존 웹 기록 유지. 자동 null 삭제 없음 | 미실행 |
| 실제0 | 0 보존, 미측정과 구별 | 미실행 |
| 폰/워치·수면 단계 중복 | 플랫폼 집계·수면 합집합, 중복 합산 없음 | 미실행 |
| 밤샘 수면 | 서울 자정에서 날짜 분할. 기상일 기준 표시와 차이 확인 | 미실행 |
| 네트워크 실패 후 복귀 | 다시 읽어 대기값 대조, 같은 값은 같은 batchId, 변경이면 새 배치 | 미실행 |
| 토큰 폐기·다른 연결 선택 | 대상 확인에서 중단, 새 연결 안내 | 미실행 |
| 잠금·강제종료·절전·재부팅 | 지연 기록·수신 성공 시각 대조, 가짜 성공 없음 | 미실행 |

HealthKit의 읽기 개인정보 보호 때문에 원자료 전체 삭제를 서버에 자동 반영하는 기능은 현재 지원하지 않는다. 이를 수정/삭제 자동 반영 완료라고 기록하지 않는다. 실제 환자/연구자료는 인증·동의·영구 보관·기관 승인 등이 갖춰진 검증 서버에서 다룬다.

## 회신 양식

- Render 커밋/Live/아이폰 기본 선택: ___
- GPT 설정/실제 초안/섭취비율 저장/의료진 표시: ___
- Mac 사용 가능 여부·Apple 개발팀 서명/설치 상태: ___
- 폰/iOS·워치 버전·수동 수신·자동 수신·실패한 U번호/오류 문구: ___

키·토큰·계정 비밀번호·개인 건강자료는 회신에 포함하지 않는다. Android 기존 설치가 필요하면 integrations/android/README.md를 따른다.
