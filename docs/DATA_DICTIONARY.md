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
| portion | 실제 섭취 비율 | null=양 모름, 0=안 먹음, .25/.5/.75/1; 무선택은 저장 불가, 사진만으로 확정 금지 |
| foodType / foodLabel | 호환 분류 / 음식 표시명 | 기본 표와 AI 음식명 구별 |
| provider / model / source | 분석/자료 출처 | 미설정 상태에 AI 출처를 붙이지 않음 |
| requestId/dateRequestId/photoRequestId | UI 요청 generation | 늦은 응답의 환자/날짜/사진 혼합 방지 |
| saving/photoLoading | 저장/사진 읽기 진행 | 중복 클릭/읽기 전 저장 방지 |
| view / metric / section | 환자 화면·추이·초점 영역 | URL에 복원 가능한 값만 허용 |
| connectionId / platform | 선택 건강 연결 | 플랫폼 합계끼리 가산 금지 |
| token / tokenHash | 네이티브 연결 비밀 / DB hash | 최초 발급만 노출, 로그/CSV 제외 |
| batchId / updatedAt | 수신 중복키 / 집계 revision 시각 | 재전송 안전, 오래된 갱신 거부 |
| healthDaily / effective source | 기기 집계 / 표시 우선 출처 | 수동값과 별도 저장, 명시적 수동값 우선 |
| steps_updated_at / sleep_updated_at | 항목별 최신 플랫폼 재집계 revision | 생략은 보존, null도 새 revision으로 반영. 기존 행 1회 backfill, 재시작 시 생략 항목을 채우지 않음 |
| includesSteps / includesSleep | Android가 허용받아 읽은 항목 여부 | false 항목은 JSON 키 생략, true+null은 조회 후 자료 없음 |
| dialogBaseline / medicationBaseline | UI 입력 원본과 현재값 비교 | 사용자가 바꾼 입력만 dirty. 미저장 이동 취소 시 값/초안 보존 |
| patient screen registry | 화면ID/제목/종류/닫기 목적지 | SCREEN_SPEC와 HTML/하단 메뉴/브라우저 검증에 대응 |
| historyMode / restoreRoute | 의료진 기록 갱신 방식 / URL 복원 | push는 사용자 이동, replace는 정규화·조회. 복원 시 요청 세대 무효화·환자/날짜 일치 확인 |
| reasonCode / available | GPT 설정 사유 / 준비 상태 | disabled/missing_key/invalid_model/ready. 실제 인증·추론 성공 증거가 아님 |
| session token / csrf / oauth state | 세션 비밀 / 변경 요청 검증 / 로그인 결합 | session/state는 DB hash, csrf는 session에 결합. 세션·CSRF의 URL·로그 금지. OAuth state는 인증 URL에서만 사용 |
| actor.role / patientId | 서버에서 정한 권한/연결 환자 | Kakao 의료진 allowlist 또는 초대 연결만 신뢰. 클라이언트 role 무시 |
| notice.version / last_read_version | 공지 낙관적 잠금 / 확인 버전 | 수정 시 증가, 이전 버전 읽음으로 새 버전 확인 처리 금지 |
| clientMessageId / throughId | 전송 멱등 UUID / 대화 읽음 순번 | 같은 본문 재시도만 같은 UUID, 대화 소유권·단조 증가 검사 |
| AUTH_MODE / APP_ORIGIN | 합성 체험 또는 실제 Kakao / 고정 HTTPS origin | 미설정 production은 잠금, demo는 합성자료 전용 |
| CLINICIAN_KAKAO_IDS | 관리자 지정 의료진 Kakao 앱 사용자ID 목록 | 서버에서만 승격·회수, 프로필/화면 선택으로 승격 금지 |
| serverTime | preflight 서버 ISO 시각 | iOS 배치 revision 기준, 폰 미래시각 방지 |
| MetricSelection / DayReading | iOS 선택 항목 / 서울 날짜 집계 | 선택 안 함·빈 결과는 키 생략, 실제0은 보존. 수면 분·합집합 |
| ConnectionSettings / PendingUpload | iOS 대상·비밀 / 재시도 JSON | Keychain ThisDeviceOnly, 로그·URL·UserDefaults 제외 |

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

## v0.6 인증·소통 DB와 초기화

| 테이블 | 의미·소유권 | 삭제/보존 |
|---|---|---|
| auth_accounts | Kakao 앱 ID 또는 합성 역할, 환자 1:1 연결 | 환자 삭제 시 연결만 NULL; 동일 ID 시드와 자동 재연결 금지 |
| auth_sessions | opaque cookie hash·CSRF·12시간 만료 | 로그아웃/만료 시 폐기, reset은 의료진 세션 유지 |
| oauth_attempts | 브라우저 nonce hash와 state hash·내부 next | 10분·1회 사용, 제공자 access token 저장 없음 |
| patient_invitations | 환자/발급자/초대 hash/24시간 만료·사용 시각 | 재발급은 미사용 이전 코드 폐기; 환자 삭제 CASCADE |
| notices / notice_revisions | 전체 환자 공지와 수정 snapshot·작성자 | draft/published/archived, 테스트 reset 시 삭제 |
| notice_reads | 계정별 공지 확인 버전 | 수정 시 이전 읽음으로 새 버전 확인 처리하지 않음 |
| messages | 환자별 발신 계정/역할/평문 본문/전송 UUID | 타 환자 조회 불가, 환자 삭제 CASCADE, CSV 제외 |
| conversation_reads | 환자·계정별 읽음 highwater/역할 | 명시적 POST만 단조 증가; 환자 삭제 CASCADE |

otherReadThrough는 해당 대화의 반대 역할이 확인한 최대 순번이다. UI는 증분 조회 응답이 비어도 기존 메시지의 읽음 표시를 갱신한다. clientMessageId는 실패 후 같은 내용을 재전송할 때 유지하고 편집 시 교체한다. generation은 환자·화면 전환 후 늦은 응답을 폐기한다. mounted는 의료진 새 화면의 DOM 식별자이며 일반 갱신에서 작성 폼을 재생성하지 않는다. hcClinicianIndex는 취소된 popstate의 이전 방문 기록 위치를 복구한다.

## 사진 첨부 복약 보고 (MED-PHOTO-01)

medication_photo_reports의 OCR snapshot은 openai-package-text-v1 추정이다. medication_photo_report_events의 event_json은 patient-self-report-with-photo 당시 기록으로 ingestion 증거가 아니다. revision은 기존 이벤트 버전, expectedRevision은 저장 충돌 검사값, reviewStatus=unreviewed는 의료진 검토를 하지 않았다는 뜻이다. date는 KST 회차 일자, createdAt/reportedAt는 UTC 보고 시각이며 복용 시각이 아니다. image_bytes는 JPEG/PNG/WebP 원본 최대5MB. 전체 필드/단위/리셋·재전송 규칙은 MEDICATION_PHOTO_DEMO_SPEC.md, 실제 SQL은 generated/SCHEMA.md를 따른다.

## v0.7.0 추가 변수 의미

- meal.portion=null은 양 모름,0은 미섭취; calories/proteinGrams도 양 모름이면null. clientSubmissionId는 환자 범위 재전송 ID.
- daily.revision/expectedRevision은 변경 충돌 검출. workflow status/version/clientRequestId와 before/after/actor/reason은 임상 원본과 별도 이력.
- staffRoles/capabilities/assignedPatientIds는 서버 설정에서 계산하며 UI 표시모드와 다르다.
- startDate/endDate/calendarDays·N/observationCount/knownCount/unknownMealCount는 서로 다른 분모다. dataset/recipe/hash/manifest는 동결 분석 재현용이며 실명·메모를 기본 포함하지 않는다.
- 문헌 query/provider/searchedAt/articleKey/PMID/DOI/retraction/status/reviewer는 조회 근거와 검토 상태. 미확인은 철회 없음이 아니다.

정확한 자료형·출처·허용값은 USABILITY_IMPLEMENTATION_PLAN을 기준으로 구현 후 생성 스키마/변수 목록과 함께 확인한다.

### 재시도·동결·세션 복구 변수

| 변수/테이블 | 의미와 변경 규칙 |
|---|---|
| daily.clientSubmissionId / daily_record_submissions | 환자 범위 UUID·요청 해시·저장 당시 응답; 같은 내용 재시도는 한 번만 기록·감사 |
| medication_order_requests / clientRequestId | 환자 범위 복약계획 생성 중복 방지. 내용 변경 시 새 키 |
| expectedInputHash | 연구 미리보기 입력 SHA-256; 저장 직전 자료가 다르면409. 동일 저장 재시도는 동결본 반환 |
| referenceDate / reportedAtReferenceDate | 의료진 선택 기간 마지막 날·그날 기록한 환자 수; 과거 기간의 reportedToday는 null |
| appliedStartDate / appliedEndDate | 관리 CSV에 실제 적용된 날짜 경계. 무필터는 1900-01-01부터 오늘까지 |
| recoveryIdentity | 세션 만료 당시 계정/역할/환자/권한/배정 범위 지문. 일치 재인증 전 보호 요청 중단, DOM 초안 보존 |
| photo report.reviewStatus | 환자에게 제공하는 공개 검토 상태. 직원 내부 note/actor는 환자 응답 제외 |

모든 새 테이블의 실제 컬럼·FK·유일성과 삭제 동작은 generated/SCHEMA.md에서 생성·검사한다. 사람 의미는 본 문서와 USABILITY_IMPLEMENTATION_PLAN에 유지한다.

## v0.8.0 환자 화면·음성 개선 (2026-10-24, 구현 전)

현재 새 변경의 요구·화면/상태·데이터·지원 범위·변수·검증 기준은 [PATIENT_VOICE_SPEC.md](PATIENT_VOICE_SPEC.md)를 따른다. 기존 v0.7.0 공통 규약을 계승하며 환자 본문20/도움18/누름56 목표, 행동/정보 구분과 인라인 음성 안내·음성 입력·할 일 알림을 추가한다. 기존 의료진/네이티브와 환자 기록 API는 유지하고 공지 영수증 테이블은 schema7로 추가한다. 음성 인식 결과는 확인 후 기존 입력칸에만 반영한다. 녹음·원고 자동 저장·백그라운드 전달을 구현 완료로 표시하지 않는다.

| v0.8.0 변수 | 의미/범위·보관 |
|---|---|
| demoToken / X-HomeCare-Demo-Session | 명시적 demo 모드의 탭별 세션, RAM 보관. 서버 hash/만료/CSRF 검사, Kakao 모드 무시 |
| notice_submissions / clientRequestId | 공지 actor/UUID·요청 해시·결과·공지FK; reset/공지 삭제 시 CASCADE |
| koreaClock / taskData / checkedAt | KST 날짜/시각·현재 할 일·마지막 서버 확인, 예전 날짜/실패/오래된 자료로 자동알림 금지 |
| homecarePatientAssist | localStorage 비민감 boolean voiceEnabled/remindersEnabled만 보관. 건강값/원고/계정토큰 저장 금지 |
| generation / context.key / finalParts | 음성 인식 세대·환자/폼/날짜/필드/약 회차 고정·세션 최종 문장, 탭 RAM만 사용 |
| parsed / confirmedText | 단위/범위 검사 결과와 읽을 확인문구; 체크 후 입력칸 적용, 자동 DB 저장 없음 |
| recording / lastFailureAt / fresh | 마이크 사용 상태·최신조회 실패 시각·알림 가능한 최신자료 여부 |
