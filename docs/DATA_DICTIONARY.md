# 변수·자료 사전

전체 선언/매개변수 위치는 `generated/VARIABLES.md`로 생성한다. 이 문서는 코드에서 자동 추출할 수 없는 의미·단위·책임을 설명한다. 파생 변수와 임시 루프 변수까지 목록에 포함하되, 변경 계약은 외부에 영향을 주는 아래 의미를 중심으로 관리한다.

| 이름/영역 | 의미/단위 | 규칙/책임 |
|---|---|---|
| patientId / selectedId | 선택 환자 식별자 | URL/요청/저장 소유권 일치; localStorage는 보조 |
| date / today | Asia/Seoul 일자 | UTC 날짜 절단으로 대체하지 않음 |
| steps | 일별 걸음 수, 정수 | 0은 측정값; null은 미측정 |
| sleepHours / sleepMinutes | 웹 표시 시간 / 수신 분 | 변환은 `/60`, 날짜별 하루 최대24시간 |
| medicationStatus | 기존 일일 자기보고 | taken/partial/missed/unknown/null, 약별 복용률과 다름 |
| orderId / times / time | 복약계획 / 예정 시각 | `(orderId,date,time)` 회차 유일성 |
| status (medication event) | 약별 자기보고 상태 | taken/missed/unknown, 부재 pending |
| reason / note | 자기보고 사유 / 메모 | 임상 지시나 확정 진단으로 해석 금지 |
| revision / reportedAt | 이벤트 변경 번호 / 보고 시각 | 현재 상태와 수정 이력 함께 보존 |
| imageData | 일시적 사진 data URL | 5MB 제한, 원문 로그 금지 |
| imageHash | 분석 사진 SHA256 | 사진 변경 시 이전 초안 적용 차단 |
| analysisId | 환자·사진에 묶인 AI 초안 | 유효기간/종류/1회 적용 확인 |
| calories / proteinGrams | kcal / g | 식사 추정값, 임상 검증 수치 아님 |
| portion | 실제 섭취 비율 | .25/.5/.75/1, 사진만으로 확정 금지 |
| foodType / foodLabel | 호환 분류 / 음식 표시명 | 기본 표와 AI 음식명 구별 |
| provider / model / source | 분석/자료 출처 | 미설정 상태에 AI 출처를 붙이지 않음 |
| requestId/dateRequestId/photoRequestId | UI 요청 generation | 늦은 응답의 환자/날짜/사진 혼합 방지 |
| saving/photoLoading | 저장/사진 읽기 진행 | 중복 클릭/읽기 전 저장 방지 |
| view / metric / section | 환자 화면·추이·초점 영역 | URL에 복원 가능한 값만 허용 |
| connectionId / platform | 선택 건강 연결 | 플랫폼 합계끼리 가산 금지 |
| token / tokenHash | 네이티브 연결 비밀 / DB hash | 최초 발급만 노출, 로그/CSV 제외 |
| batchId / updatedAt | 수신 중복키 / 집계 revision 시각 | 재전송 안전, 오래된 갱신 거부 |
| healthDaily / effective source | 기기 집계 / 표시 우선 출처 | 수동값과 별도 저장, 명시적 수동값 우선 |

## 환경 변수

| 이름 | 의미 | 비밀 여부 |
|---|---|---|
| PORT | HTTP 포트 | 공개 |
| DATA_DIR | SQLite/업로드 위치 | 경로 |
| NODE_ENV | 실행 모드 | 공개 |
| HOMECARE_VISION_API_KEY | 선택 사진 분석 제공자 키 | 비밀, 서버/api.openai.com 목적지만 |
| VISION_MODEL | 사진 모델, 기본 제공자 호환 모델 | 공개 설정, 실제 검증 모델 기록 |
| VISION_ENABLED | 외부 사진 분석 활성 여부 | 공개 설정, 키와 함께 판단 |
| CHROMIUM_PATH | 개발 검증 브라우저 | 로컬 경로 |

정확한 DB table/column과 새 환경 설정은 해당 모듈 구현 시 이 문서에 추가하고, 자동 변수 목록은 검사와 함께 다시 생성한다. 연결 토큰을 로그인 자격증명으로 혼동하지 않는다. 현재 데모는 의료진 신원을 인증하지 않는다.

## DB 소유권과 역할

실제 컬럼·자료형·외래키·SQL 제약은 [생성 스키마](generated/SCHEMA.md)에서 확인한다.

| 테이블 | 소유/의미 |
|---|---|
| metadata | initialized/mode/reset_at/schema_version/generation, 비동기 초기화 경계 |
| patients | 가상 환자, legacy medications는 참고 문구 |
| daily_records | 직접 입력 원본, 날짜당1행, 기기 집계를 덮어쓰지 않음 |
| meals | 확정 식사, portion 적용 영양 추정·사진·출처·초안 provenance |
| medication_orders | 확정 계획의 이름/함량/1회량/기간/시각, 변경은 종료+새 계획 |
| medication_events | 회차 현재 자기보고, (order,date,time) 유일 |
| medication_event_audit | 회차 생성/수정 전후 snapshot, 실제 의사 신원 인증 이력 아님 |
| photo_analyses | 환자·사진 hash에 연결한 유효기간 초안/적용 이력, 원본 이미지 없음 |
| health_connections | 플랫폼·선택 상태·token hash·폐기/최근 수신, secret 재노출 없음 |
| health_daily | 연결/날짜별 집계 snapshot, 최신 revision만 교체 |
| health_batches | 연결/batch 중복키·본문 hash·수신 결과, 재전송 안전성 |

연결부 Kotlin/Java 변수는 생성 목록의 보조 인덱스와 integrations/android의 실제 소스를 함께 읽는다. Java 핵심 로직 검증은 APK/Kotlin 빌드 성공과 다르다.
