# 환자 화면 오류 점검 증거 (2026-10-25)

기준 main d58f2c4/v0.8.0. 새 감사19개 묶음: root4·voice7·flow8. 제품 변경 및 이번 공개 쓰기 없음. 보고서·수정 계획은 ../../PATIENT_RELIABILITY_AUDIT.md 및 ../../PATIENT_RELIABILITY_PLAN.md.

| 파일 | 범위 |
|---|---|
|root-results.json|로컬 Chromium·임시DB, 초기세션/실패재시도/전환/빠른메뉴·뒤로·확대.65초는 브라우저 시계 진행|
|voice-results.json|로컬 실제 화면·DB와 모의 Speech 이벤트.90초는 시계 진행. 실제 음질·마이크 아님|
|flow-results.json|저장·조회·사진·연결·메시지·오프라인·잘못된 입력8개. 잘못된 최초 식사목록 판정은 저장ID 재대조로 교정|
|public-baseline.json|현재 공개 GET health와27개 프런트엔드 파일 비교|
|prior-public-voice-load.json|같은v0.8.0 공개앱의 기존 재현. 실제daily응답1.5초지연, 쓰기없음|

실행 스크립트·화면·세부 로그는 작업공간 /workspace/scratch/patient-adversarial-2026-10-25 및 최종 검증자료 ZIP에 있다. 브라우저는 Chromium이며 WebKit은 설치 호스트가403차단되어 미실행. iPhone Safari 기기 인수는 별도 계획이다.
