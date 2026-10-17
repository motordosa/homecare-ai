# iPhone·GPT 구현 근거 확인

2026-10-17 KST. 아래 공식 문서를 실제 HTTPS GET(검증 유지)로 확인했다. 자료의 제약과 실제 기기/API 실행 증거를 구별한다.

| 공식 자료 | 확인 내용 | 구현 반영 |
|---|---|---|
| [Apple HealthKit 권한](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data) | 읽기 전체 허용과 거절을 앱이 구별하지 못함. 기간 제한 허용도 가능 | 요청 완료를 허용으로 표시하지 않음. 빈 결과를 생략하여 기존 웹 자료 보존. 자동 전체 삭제 미지원 |
| [Apple background delivery](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)) | Background Delivery entitlement 필요, 걸음은 최대 hourly, 앱 delegate launch 안에 observer 설치, 완료 콜백 필수, Simulator background 검증 불가 | entitlement·hourly·동기 bootstrap·모든 handler 경로의 completion 호출. 실제 background 성공은 기기 검증 전까지 미완료 |
| [OpenAI 이미지 입력](https://developers.openai.com/api/docs/guides/images-vision) | Responses 이미지 입력과 base64 data URL, 이미지 내용 이해·분석의 한계 | 고정 OpenAI Responses 목적지, data URL, 구조화 초안·동의·환자 확인·추정 출처 유지 |

공식 Apple 문서는 tutorials/data/documentation JSON으로, OpenAI는 공식 가이드 HTML로 읽었다. 키·자료 주체·건강 수치·제공자 원문은 연구 메모에 기록하지 않는다. 모델 접근/실제 사진 추론은 API 키가 없는 현재 환경에서 검증하지 않았다. Swift/서버 합성 검사는 실제 HealthKit 자료를 읽었다는 증거가 아니다.
