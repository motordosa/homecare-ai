# v0.8.1 오류 복구 검사 근거

2026-10-25 KST. summary.json은 로컬 완료 상태, patient-results.json은 실제 HTTP/SQLite·클릭에 네트워크 오류를 주입한10개 검사, speech-results.json은 명시적 TTS 모의8개 검사다. new-browser-checks.txt는 신규15+17+8+10=50개 검사의 실행 로그다. 실제 아이폰 마이크/음질 및 운영 배포는 미완료다.

원본 테스트는 저장소 test/의 reliability 관련 파일과 health-connection-issuance.test.mjs, 기존 회귀에 있다. 보고서: [PATIENT_RELIABILITY_REPORT](../../PATIENT_RELIABILITY_REPORT.md). 사용자 인수: [MICROPHONE_ACCEPTANCE](../../MICROPHONE_ACCEPTANCE.md). 원고·음성·토큰·실환자 자료를 증거에 보관하지 않는다.
