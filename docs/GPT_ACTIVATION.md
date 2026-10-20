# GPT 사진·칼로리 분석 활성화 계약 v0.5

2026-10-17 KST. IMG-04. 기존 OpenAI Responses 경로를 실제 설정과 연결한다. API 키는 서버 환경 변수만 사용하며 로그인 없는 웹 화면에서 입력/저장하지 않는다. 키가 없는 상태를 분석 성공으로 표시하지 않는다.

## 배포 설정과 검증

Render 기존 서비스 → Environment에 `HOMECARE_VISION_API_KEY`(OpenAI API 프로젝트 키), `VISION_ENABLED=true`, `VISION_MODEL=gpt-4.1-mini`를 설정하고 최신 커밋 배포. ChatGPT 유료 구독은 API 크레딧을 대신하지 않는다. 계정 소유자가 API 결제·사용 한도를 설정한다. 개발 클라우드 설정과 Render 환경 변수는 별개다.

`npm run ai:check`는 설정 확인 후 고정 OpenAI 모델 조회(GET, 이미지/유료 추론 없음)로 인증을 검사한다. `--image /경로/식사.jpg`는 명시적으로 선택한 사진에 실제 추론을 수행하고 임시 DB에서 초안을 확인한다. 키·원본사진·토큰·제공자 원문 오류는 출력하지 않는다. 실제 사진 내용·수치 정확도 검증은 별도로 남긴다. 모델 조회 성공도 이미지 추론 성공의 증거와 구별한다.

## 화면·오류·자료 계약

- P-MEAL은 기존 공통 닫기/dirty/busy·외부전송 동의·사진별 초안·환자 확인을 유지한다. GPT가 제안한 전체 음식 kcal/protein에 실제 섭취비율을 곱해 저장하고 내 기록/의료진에서 같은 출처를 표시한다. 모델·시간·음식목록·원본추정/적용비율을 보존한다.
- C-SETTINGS에 서버 설정 확인 구역을 추가한다. GET capabilities의 enabled/configured/available/model과 아직 실제 호출을 검증하지 않았다는 설명을 표시한다. 키 값이나 계정 정보를 반환하지 않는다. 조회 실패는 미설정과 구별하고 다시 확인 버튼을 제공한다. 이 버튼은 유료 AI를 호출하지 않는다.
- capability 추가 `reasonCode`: disabled/missing_key/invalid_model/ready. enabled=true이나 키가 없으면 missing_key. available은 로컬 설정 준비 상태이며 실제 인증/잔액/모델 접근권한 검증이 아니다.
- 제공자401/403는 키/모델 권한 확인 안내, 429는 호출 한도·API 잔액 확인 안내, 5xx/비정상 결과는 다시 시도/수동 입력 안내. 제공자 원문·비밀값은 오류에 노출하지 않는다. 자동 유료 재시도 없음.
- JPEG/PNG/WebP 최대5MB 유지. iPhone에서 HEIC 등 읽을 수 없는 형식은 JPEG/PNG로 선택하도록 안내한다. Safari가 JPEG로 전달한 카메라 사진은 그대로 처리한다.

인수조건: 설정 없음·비활성·모델 오류·401/403/429/5xx 분리, 실제 모델 조회/사진 추론은 자격 증명 있을 때만 수행. mock 서버의 GPT 형식→초안→실제 POST meals→SQLite·요약 kcal/단백질·출처는 자동검사하되 실제 GPT 정확도라고 표시하지 않는다.

## v0.6.1 약봉투 사진 자기보고

환자 복약의 새 사진 입력도 같은 HOMECARE_VISION_API_KEY/VISION_ENABLED/VISION_MODEL을 재사용한다. 추가 국내 약품 API 키 없이 포장 글자 후보만 읽는다. 약·회차·상태는 직접 확인하며 사진+자기보고 저장/조회는 MEDICATION_PHOTO_DEMO_SPEC.md와 USER_ACTION_REPORT.md U-05를 따른다. 기존 의료진 사진 작성 보조와 식사 분석은 유지한다.
