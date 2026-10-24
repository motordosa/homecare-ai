# v0.8.0 재현·검증 증거 (2026-10-24)

변경 전 로컬 기본선0.7.0, 최신 로컬0.8.0/schema7, 공개 API0.7.0/schema6를 구분한다.

- baseline.json / before-390.png: 작업 시작 당시 실제 모바일 화면·기능 존재 여부
- notice-baseline.json / notice-shared-session-before.json / notice-duplicate-before.json: 기본 임시 저장·같은 컨텍스트403·중복 기본선
- public-notice-api.json: 공개 서버의 실제 HTTP 검증 및 자기 합성 공지 archived 정리 결과. 화면 클릭 검증이 아님
- public-notice-check.json: 공개 Chromium 인증서 신뢰 실패, UI 검증 미실행 증거. TLS 검증을 끄지 않았다
- menu-flows.json / menu-flows.txt: 같은 브라우저 두 역할·주요 양방향 저장·메뉴 이동/새로고침 실제 클릭
- clinical-workspaces.txt: 실제 로컬 업무·참여·정정 승인·연구 동결본 실습6개
- voice-browser.txt:12개 모의 음성/알림 제공자+실제 폼·HTTP 저장 검사. 실제 마이크/음성 서비스 성능 아님
- node-tests.txt:150개 단위·HTTP 검사
- browser.txt / automation.txt / auth.txt / medication-photo.txt / usability.txt: 기존 회귀
- docs-check.txt: 최종 선언·스키마·화면 계약 대조
- fresh-home-390.png / voice-review.png / notice-after.png: 최신 합성 화면
- visual-measurements.json / action-measurements.json: 대표 텍스트·제어 계측. 전체 접근성 인증 아님

녹음·세션 토큰·API 키는 포함하지 않는다. 실제 인물 자료는 사용하지 않았다. tests/는 임시 DB를 끝에 삭제하며 공개 합성 공지는 archived로 보관했다. 실제 외부 AI·HealthKit·고령자 평가·공개 배포를 통과로 표시하지 않는다.
