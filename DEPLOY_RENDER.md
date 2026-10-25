# Render 무료 데모 배포

## v0.8.1 수정본: 실제 마이크 인수 전 운영 배포 보류

2026-10-25 사용자 지시로 실제 마이크 인식까지 검증한 후에만 운영 배포한다. `codex/patient-reliability-fixes`의0.8.1/schema8 수정본과 운영0.8.0/schema7을 구별한다. [실제 iPhone 인수 절차](docs/MICROPHONE_ACCEPTANCE.md)에 별도 무료 테스트 서버 준비·실제로 듣고 말하기·저장 검증·운영 배포 관문을 정리했다. 지금 아래0.8.0 절차를 다시 실행해도 수정본이 반영되지 않는다. 실제 기기 인수 전 main 병합과 운영 배포를 수행하지 않는다.

## 기존 v0.8.0 배포 기준 (2026-10-25)

기존 서비스 관리 화면: https://dashboard.render.com/web/srv-db923oss728c73bgipug

1. GitHub `main`에 **v0.8.0 환자 음성·공지 개선**이 병합됐는지 확인한다. 기능 커밋 `92e8259`를 포함해야 하며, `main`의 `package.json`은 `0.8.0`, `server.mjs`는 schema7이다. 최종 배포 커밋은 아래의 소스 확인 링크와 개발 완료 보고를 대조한다. 별도 개발 브랜치에만 새 커밋이 있는 상태로 배포하지 않는다.
2. 위 기존 서비스에서 **Settings → Build & Deploy → Branch**가 `main`인지 확인한다. 이전 `codex/free-demo-deploy` 브랜치를 사용 중이면 `main`으로 변경한다. **Deploy latest commit은 이 Branch의 최신 커밋**이며 저장소 전체의 최신 개발 커밋을 자동으로 선택하지 않는다.
3. 필요한 기존 테스트 결과를 먼저 내보낸다. 무료 서버의 임시 DB·사진은 재배포 시 사라질 수 있으며 CSV는 전체 복원본이 아니다.
4. 오른쪽 위 **Manual Deploy → Deploy latest commit**을 선택한다. 새 서비스·DB 생성이나 환경 변수 변경은 이번 음성·공지 개선에 필요하지 않다. 기존 GPT 키·로그인 설정은 유지한다. 이번 릴리스를 위해 전체 DB 리셋을 실행하지 않는다.
5. 상태가 **Live**가 되면 https://homecare-ai-demo.onrender.com/api/health 에서 `appVersion:"0.8.0"`, `schemaVersion:7`, `ok:true`를 확인한다. Render Events의 배포 커밋도 GitHub `main`의 대상 커밋과 대조한다. `0.7.0/schema6`이면 최신 배포 완료가 아니다.
6. 환자 홈에서 색으로 구분한 식사/복약 버튼·‘안내 듣기’와 정지/설정을 확인한다. 음성 입력은 인식→수치/날짜 확인·수정→입력란 반영→별도 저장 순서다. 실제 기기의 한국어 음성·마이크 권한은 별도 확인한다.
7. 같은 브라우저의 의료진·환자 탭을 열고 식별 가능한 합성 공지를 ‘환자에게 게시’로 게시한다. 환자 수신·새로고침 유지·수정 반영을 확인하고 자신이 만든 공지만 보관한다. 식사·복약·건강 기록→의료진 조회도 확인한다. 실제 Kakao 모드에서는 계정 권한에 맞는 메뉴만 표시된다.

소스 확인: [main package.json](https://github.com/motordosa/homecare-ai/blob/main/package.json), [main 최신 커밋](https://github.com/motordosa/homecare-ai/commits/main), [v0.8.0 PR #1](https://github.com/motordosa/homecare-ai/pull/1).

위 절은 기존0.8.0 배포 기준이다.0.8.1은 최상단의 실제 마이크 인수 조건을 먼저 따른다. 아래 이전 버전의 schema 값과 검증 기록은 도입 이력이며 v0.8.0 배포 완료의 증거가 아니다. 구현·검증 근거는 [환자 음성·공지 보고서](docs/PATIENT_VOICE_REPORT.md)를 따른다. GitHub 병합/검사 통과와 Render Live는 각각 확인한다. 최종 배포는 사용자가 Render에서 실행한다.

이 구성은 `plan: free`인 Docker 웹서비스 하나만 생성합니다. 유료 디스크, 유료 데이터베이스, 추가 유료 서비스는 포함하지 않습니다. 환자 사이트·의료진 사이트·SQLite API를 같은 서버에서 실행합니다.

## 현재 배포 주소

사용자가 제공한 배포 주소는 [homecare-ai-demo.onrender.com](https://homecare-ai-demo.onrender.com)입니다.

- [환자 모바일 화면](https://homecare-ai-demo.onrender.com/patient?patientId=p001)
- [의료진 데스크톱 화면](https://homecare-ai-demo.onrender.com/clinician?patientId=p001)
- [서버·DB 상태](https://homecare-ai-demo.onrender.com/api/health)

휴대폰과 PC에서 같은 환자를 선택하면 같은 서버의 기록을 확인합니다. 무료 서버가 절전 상태였다면 첫 화면이 열리기까지 기다려야 할 수 있습니다.

2026-10-16에 **v0.2 배포본(e635e69)**의 공개 HTTPS 주소에서 서버·SQLite·CSV·정적 파일 일치·모바일/데스크톱 화면·차트 등 읽기 검사 22개를 통과했습니다. 별도로 환자 화면의 임시 식사사진 저장 → 의료진 화면 반영 → 새로고침 후 보존을 확인한 뒤, 그 테스트 기록과 사진만 삭제했습니다. 검사 전후 기존 환자·일일 기록·식사 수는 같았습니다. 이후 배포나 데이터가 바뀌면 다시 점검해야 합니다. 이 기록은 v0.3 배포 완료의 증거가 아닙니다.

## v0.4 반영 절차

기획/계약, 목적별 메뉴, 약별 복약, 사진 분석 어댑터, 건강 수신 기반의 새 코드는 로컬 통합 검증을 거칩니다. GitHub `main`의 새 커밋을 Render **Manual Deploy → Deploy latest commit**으로 반영한 뒤 `/api/health`의 schemaVersion이3인지 확인하고 공개 점검 도구를 실행합니다. 소스를 푸시한 상태와 실제 서버 갱신을 구별합니다.

사진 분석은 기본 비활성입니다. Render의 서버 환경 변수에 `HOMECARE_VISION_API_KEY`와 `VISION_ENABLED=true`, `VISION_MODEL=gpt-4.1-mini`를 설정해야 실제 외부 분석을 사용할 수 있습니다. 키를 Git이나 채팅에 넣지 마세요. AI API 비용은 Render 무료 요금과 별개입니다. 설정 후 `/api/capabilities`의 vision.available을 확인하고 합성/동의된 검증 사진으로 결과를 대조합니다. 제공자 키 없는 상태의 fixture 테스트는 실제 정확도 검증이 아닙니다.

건강 연동은 빌드한 Android 연결 앱을 설치하고 Health Connect/삼성 헬스 공유·실기기 권한 검증을 거쳐야 합니다. 소스에서 재빌드하는 방법과 실제 APK·lint 빌드 결과는 [연결 앱 지침](integrations/android/README.md)을 참고하세요. 서버 수신 API·APK 빌드만으로 폰/워치 자동 기록이 완료되지 않습니다.

## 계정 연결 및 생성

[Render 무료 배포 시작](https://dashboard.render.com/blueprint/new?repo=https://github.com/motordosa/homecare-ai)

1. 위 링크를 열어 Render 계정을 만들거나 로그인합니다. GitHub 로그인으로 연결할 수 있습니다. 계정 로그인·OAuth 동의는 계정 소유자가 직접 수행해야 합니다.
2. 저장소 `motordosa/homecare-ai`와 기본 브랜치 `main`을 선택합니다.
3. Blueprint에서 `homecare-ai-demo` 서비스의 요금제가 **Free**인지 확인하고 생성/적용합니다. 유료 요금제·디스크·DB를 추가하지 않습니다.
4. 배포 상태가 Live가 되면 Render가 발급한 실제 서비스 주소를 엽니다. 주소는 생성 결과에 따라 정해지므로 이 문서에서 임의로 만들지 않습니다.

서버 설정·빌드·실행 명령·환경 변수·상태 확인 경로는 `render.yaml`과 Dockerfile에 있습니다. 별도의 DB 계정이나 API 키 없이 첫 실행에서 합성 환자 6명과 테스트 기록이 생성됩니다. 포트는 Render가 제공하는 `PORT`를 사용합니다.

## 접속과 테스트

발급된 주소를 기준으로 다음 화면을 사용합니다.

| 경로 | 용도 |
|---|---|
| `/` | 시작 화면 |
| `/patient` | 모바일 환자 화면 |
| `/clinician` | 데스크톱 의료진 화면 |
| `/api/health` | 서버·SQLite 상태 확인 |

환자 화면에서 기록을 저장한 뒤 의료진 화면에서 같은 환자를 선택하고 새로고침합니다. 의료진의 데모 설정에서 CSV 내보내기, 전체 비우기, 샘플 복원을 사용할 수 있습니다.

## 무료 서비스의 데이터 보존

Render 무료 웹서비스는 미사용 시 절전되며 영구 디스크를 지원하지 않습니다. 이 구성은 `/tmp/homecare-data`에 SQLite DB와 사진을 저장합니다. **서버 재시작·재배포 시 테스트 기록과 업로드 사진은 삭제될 수 있습니다.** 보관할 테스트 결과는 CSV로 내보내세요. 새 파일시스템으로 시작하면 샘플 데이터가 다시 생성됩니다.

CSV는 기록 표이며 사진 파일·환자 전체 속성·수정 이력·연결 비밀을 포함하는 전체 DB 백업/복원본이 아닙니다. 실제 연구 전에는 영구 DB/파일 보관과 정식 백업·복원 절차를 별도 준비합니다.

같은 서버 인스턴스가 실행되는 동안 환자·의료진은 같은 DB를 공유합니다. 페이지 새로고침만으로 DB가 지워지지는 않습니다. 이는 무료 기능 검증을 위한 구성이며 실제 연구자료 보관용 서버가 아닙니다.

## 배포 후 확인

개발 환경에서 기존 데이터를 변경하지 않고 배포본을 점검할 수 있습니다. Playwright와 Chromium 준비는 README의 테스트 안내를 따릅니다.

```bash
npm run demo:check -- https://homecare-ai-demo.onrender.com
```

이 명령은 GET 요청만 사용하며 화면·API·CSV와 배포된 정적 파일을 확인합니다. 결과와 화면 캡처는 Git에 포함되지 않는 `test-results/deployment/`에 저장합니다. `test:browser`는 별도의 로컬 임시 DB에서 초기화까지 검사하는 명령이며 공개 배포본 검사와 구별합니다.

- `/api/health`의 `ok`가 `true`, `storage`가 `sqlite`인지 확인합니다.
- 환자·의료진 화면이 열리고, 저장한 식사·복약 기록이 두 화면에 반영되는지 확인합니다.
- 새로고침 후에도 현재 인스턴스에 기록이 남는지 확인합니다.
- 입력·사진 저장 검증은 가상 환자로 수행합니다. 전체 초기화는 현재 테스트 기록이 필요 없을 때만 의료진의 데모 설정에서 실행합니다.

`render.yaml`의 자동 배포는 꺼져 있습니다. 소스 변경을 반영하려면 Render 서비스의 **Manual Deploy → Deploy latest commit**을 사용합니다. 재배포 전에 보관할 테스트 결과를 내보내세요. GitHub에 올린 변경이 실제 서버에 반영됐는지는 배포 완료 후 다시 점검해야 합니다.

## 근거

- [Render 공식 무료 웹서비스 안내](https://github.com/render-oss/skills/blob/main/skills/render-web-services/SKILL.md)
- [Render 공식 파일시스템·영구 디스크 설명](https://github.com/render-oss/skills/blob/main/skills/render-web-services/references/persistent-disks.md)
- [Render 공식 무료 웹서비스 구성 예제](https://github.com/render-examples/express-hello-world/blob/main/render.yaml)
- [Render 공식 Blueprint 설정 안내](https://github.com/render-oss/skills/blob/main/skills/render-blueprints/SKILL.md)

요금제·리소스 표시가 문서와 다르면 생성 전에 Render 화면에서 무료 구성을 다시 확인합니다. 이 구성 파일을 저장하거나 GitHub에 올린 것만으로 실제 서비스가 생성된 것은 아닙니다.
