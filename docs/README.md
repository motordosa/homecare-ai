# 개발 문서의 기준과 사용 순서

문서 기준: 2026-10-24 KST, v0.8.0. 새 환자·음성·공지 변경은 [PATIENT_VOICE_SPEC.md](PATIENT_VOICE_SPEC.md)와 [결과 보고서](PATIENT_VOICE_REPORT.md)가 기준이다. 이전 변경 범위는 [사용자 중심 개선 실행계획](USABILITY_IMPLEMENTATION_PLAN.md), 구현·검증·보류 상태는 [실행 결과 보고서](USABILITY_IMPLEMENTATION_REPORT.md)와 [변경 이력](CHANGELOG.md)을 따른다. 소스 구현, 합성자료 검증, 공개 배포, 실제 사용자·외부 서비스 검증은 서로 다른 완료 상태다.

| 문서 | 책임 |
|---|---|
| [PATIENT_VOICE_REPORT.md](PATIENT_VOICE_REPORT.md) | v0.8.0 구현·공개/로컬 재현·메뉴별 클릭·모의 음성·실기기 제약·저장소/배포 상태 |
| [PATIENT_VOICE_SPEC.md](PATIENT_VOICE_SPEC.md) | v0.8.0 환자 행동/정보 구분·한국어 음성/할 일/입력 확인 실행계획과 제작 계약 |
| [USABILITY_IMPLEMENTATION_PLAN.md](USABILITY_IMPLEMENTATION_PLAN.md) | v0.7.0 승인 실행 범위·단계·공통 화면·권한·API·자료 이행·검증 관문 |
| [USABILITY_IMPLEMENTATION_REPORT.md](USABILITY_IMPLEMENTATION_REPORT.md) | 이번 구현 결과·실행한 검증·발견 후 수정·미실행/외부 대기·다음 실행 조건 |
| [PRODUCT_PLAN.md](PRODUCT_PLAN.md) | 목적, 요구사항 ID, 개발 순서, 인수조건 |
| [SCREEN_SPEC.md](SCREEN_SPEC.md) | 현행 환자6경로·역할별 의료진10경로, 큰 글자/조작, 닫기·입력·모달 보호·상태·코드 대응 규약 |
| [EVIDENCE_WORKSPACE_SPEC.md](EVIDENCE_WORKSPACE_SPEC.md) | Europe PMC 수동 문헌 검색·검색 스냅샷·보관·사람 검토·출처/오류/권한 계약 |
| [MEDICATION_PHOTO_DEMO_SPEC.md](MEDICATION_PHOTO_DEMO_SPEC.md) | 구현된 약봉투 사진 A단계의 화면·API·동시성·사진 보관·인수조건 |
| [MEDICATION_PHOTO_KR_PROPOSAL.md](MEDICATION_PHOTO_KR_PROPOSAL.md) | 국내 의약품 사진·복약 입력 조사와 후속 API 제안. A단계 구현 범위는 위 데모 명세, 나머지 제안은 별도 계획 |
| [SMARTPHONE_SYNC_SPEC.md](SMARTPHONE_SYNC_SPEC.md) | 일부 권한·항목 생략/삭제·revision·Android 코드의 상세 계약 |
| [USER_ACTION_REPORT.md](USER_ACTION_REPORT.md) | 사용자 계정·기기·API 실행 요청과 단계별 완료 기준·회신 양식 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 구성요소, 화면별 동작, 데이터 흐름·경계 |
| [CONTRACTS.md](CONTRACTS.md) | API·상태·자료형·단위·동시성·출처 계약 |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | 핵심 변수·DB·설정의 의미와 소유권 |
| [DEVELOPMENT_PROCESS.md](DEVELOPMENT_PROCESS.md) | 기획 변경→계약 변경→개발→검증→배포 절차 |
| [CHANGELOG.md](CHANGELOG.md) | 의사결정, 구현/미구현, 검증/미검증 기록 |
| [ANDROID_CONNECTOR.md](ANDROID_CONNECTOR.md) | 기존 Android·갤럭시 워치 연결 경로와 실기기 완료 기준 |
| [IOS_CONNECTOR.md](IOS_CONNECTOR.md) | 최신 우선순위 iPhone·Apple Health의 화면·수집·보안·서명·검증 계약 |
| [GPT_ACTIVATION.md](GPT_ACTIVATION.md) | GPT 실제 API 활성화·설정 진단·칼로리 저장·외부 실행 계약 |
| [KAKAO_SETUP.md](KAKAO_SETUP.md) | 카카오 앱·Render 설정·의료진 등록·환자 초대·수동 인수 절차 |
| [AUTH_COMMUNICATION_SPEC.md](AUTH_COMMUNICATION_SPEC.md) | 카카오 인증·권한·초대 연결·상단 공지·개별 메시지/읽음 계약 |
| [DEMO_ACCEPTANCE.md](DEMO_ACCEPTANCE.md) | 배포 후 메뉴·복약·사진·Android를 직접 확인하는 순서 |
| `generated/VARIABLES.md` | 코드에서 생성하는 파일별 선언·매개변수·위치 목록 |
| `generated/SCHEMA.md` | 임시 DB에서 생성하는 실제 테이블·컬럼·FK/제약 기준 |

현재 개선의 조사·발견사항·우선순위 근거는 [사용자 중심 개선 연구 보고서](research/usability-2026-10-23/README.md)다. 해당 보고서의 ‘보고만 수행’ 상태는 작성 당시 범위이며, 이후 사용자의 수정·검증 지시에 따른 실행 범위는 실행계획에서 관리한다. 연구 제안 전체를 이번 버전에 완료했다고 해석하지 않는다.

초기 전략 근거는 작성 당시 작업공간의 `/workspace/homecare-strategy/HomeCareAI_개발전략.md`와 그 research 자료이며 저장소 배포물에는 포함되지 않을 수 있다. 첨부 원문 문서의 제안은 요구 검토 자료이며 사용자 지시와 동일하지 않다.

이전 버전의 저장소 내 근거: [임상 검토](research/automation-clinical-review-2026-10-16.md), [건강 연동 근거](research/automation-evidence-2026-10-16.md), [v0.5 iPhone·GPT 자료](research/iphone-gpt-evidence-2026-10-17.md). 당시 자료 확인과 현재 실제 서비스/기기 연결 검증을 구별한다.

개발자는 작업 시작 시 이 색인→실행계획/해당 요구사항→화면·API 계약→변수 의미→최근 검증 결과 순으로 확인한다. 의도나 동작을 바꾸면 해당 현행 규칙을 먼저 고치고 변경 이력을 남긴다. 기존 규칙과 충돌하는 새 문단만 덧붙이지 않는다. 코드와 문서가 다르면 원래 의도를 확인해 의사결정을 기록하며 계획·구현·검증·배포 상태를 각각 관리한다.
