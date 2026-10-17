# 개발 문서의 기준과 사용 순서

문서 기준: 2026-10-17 KST, 변경 계획 v0.5. 구현 상태의 최종 근거는 CHANGELOG의 검증 결과다.

| 문서 | 책임 |
|---|---|
| [PRODUCT_PLAN.md](PRODUCT_PLAN.md) | 목적, 요구사항 ID, 개발 순서, 인수조건 |
| [SCREEN_SPEC.md](SCREEN_SPEC.md) | 환자·의료진 페이지별 상단/하단·닫기·입력·상태·코드 대응 제작 규약 |
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
| [DEMO_ACCEPTANCE.md](DEMO_ACCEPTANCE.md) | 배포 후 메뉴·복약·사진·Android를 직접 확인하는 순서 |
| `generated/VARIABLES.md` | 코드에서 생성하는 파일별 선언·매개변수·위치 목록 |
| `generated/SCHEMA.md` | 임시 DB에서 생성하는 실제 테이블·컬럼·FK/제약 기준 |

앞선 전략 근거는 `/workspace/homecare-strategy/HomeCareAI_개발전략.md`와 그 research 자료다. 원문 문서의 제안은 요구 검토 자료이며 사용자 지시와 동일하지 않다. 이번 사용자 지시를 현재 요구사항으로 반영했다.

이번 검토의 저장소 내 근거: [임상 검토](research/automation-clinical-review-2026-10-16.md), [건강 연동 근거](research/automation-evidence-2026-10-16.md). 공식 자료로 확인한 내용과 실제 서비스/기기에서 아직 확인하지 않은 내용을 구분했다.

개발자는 작업 시작 시 이 색인→해당 요구사항→해당 계약→변수 의미를 확인한다. 코드와 문서가 다르면 조용히 코드에 맞추지 말고 원래 의도를 확인해 의사결정을 기록한다. 계획과 구현 상태는 별도로 관리한다.
