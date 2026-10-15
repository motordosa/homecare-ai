# Render 무료 데모 배포

이 구성은 `plan: free`인 Docker 웹서비스 하나만 생성합니다. 유료 디스크, 유료 데이터베이스, 추가 유료 서비스는 포함하지 않습니다. 환자 사이트·의료진 사이트·SQLite API를 같은 서버에서 실행합니다.

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

같은 서버 인스턴스가 실행되는 동안 환자·의료진은 같은 DB를 공유합니다. 페이지 새로고침만으로 DB가 지워지지는 않습니다. 이는 무료 기능 검증을 위한 구성이며 실제 연구자료 보관용 서버가 아닙니다.

## 배포 후 확인

- `/api/health`의 `ok`가 `true`, `storage`가 `sqlite`인지 확인합니다.
- 환자·의료진 화면이 열리고, 저장한 식사·복약 기록이 두 화면에 반영되는지 확인합니다.
- 새로고침 후에도 현재 인스턴스에 기록이 남는지 확인합니다.
- 테스트를 마친 뒤 의료진의 데모 설정에서 비우거나 샘플로 복원합니다.

## 근거

- [Render 공식 무료 웹서비스 안내](https://github.com/render-oss/skills/blob/main/skills/render-web-services/SKILL.md)
- [Render 공식 파일시스템·영구 디스크 설명](https://github.com/render-oss/skills/blob/main/skills/render-web-services/references/persistent-disks.md)
- [Render 공식 무료 웹서비스 구성 예제](https://github.com/render-examples/express-hello-world/blob/main/render.yaml)
- [Render 공식 Blueprint 설정 안내](https://github.com/render-oss/skills/blob/main/skills/render-blueprints/SKILL.md)

요금제·리소스 표시가 문서와 다르면 생성 전에 Render 화면에서 무료 구성을 다시 확인합니다. 이 구성 파일을 저장하거나 GitHub에 올린 것만으로 실제 서비스가 생성된 것은 아닙니다.
