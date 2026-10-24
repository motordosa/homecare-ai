# 근거 기록

- `patient-measurements.json`: 임시 합성자료·로컬 Chromium 환자 화면 계측. 실제 고령자 평가가 아니다.
- `clinician-observation.json`: 임시 DB에서 복약계획 미저장 소실·선택 텍스트 표본 계측.
- `patient-source-access.json/.tsv`: 환자 관련 공식 자료 요청·접근 결과.
- `patient-evidence-artifacts.json`: 직접 열람한 Apple 공식 본문 JSON 9개 파일의 해시. 외부 원문 전체를 배포 자료에 재수록하지 않았다.
- `clinical-source-access.json`: 의료진 관련 공식 웹 요청 11건의 접근 제한 결과.
- `clinical-independent-source-access.json`: 별도로 공개된 공식 프로젝트 문서 9건의 URL·Git blob SHA·확인 상태. API 자체의 실동작 검증과 다르다.

원문 내용의 적용·제한은 부록 C/D에 요약했다. 로그 속 local 경로는 조사 당시 작업공간을 나타내며 배포 파일/앱 코드가 아니다. 오류 메시지에 드러난 네트워크 제한은 다른 호스트로 동일 요청을 우회하지 않았다. 합성자료 화면 관찰은 운영 DB에 입력하지 않고 수행했다.
