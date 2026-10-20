# 약봉투 사진 복약 데모 제작 명세 v0.6.1

2026-10-21 KST · 요구사항 MED-PHOTO-01. 사용자가 국내 약 사진 제안의 빠른 A단계를 승인했다. 이 문서는 코드 변경 전에 확정한 구현 기준이다. B단계 국내 품목 API와 C단계 낱알 식별, 카카오·HealthKit의 실계정 활성화는 후속 범위다.

## 화면·상태·코드 계약

| ID / 코드 | 진입·목적 | 상단·하단·닫기 | 자료·상태·인수조건 |
|---|---|---|---|
| P-MED-PHOTO / patient-medication-photo.js, medication-photo-dialog | P-MED의 ‘약봉투 사진으로 기록’. 현재 선택 날짜·환자 고정. 약봉투/포장 글자 읽기→기존 계획 대조→회차별 자기보고 | 공통 입력 dialog의 우상단 X·Escape·바깥 클릭 모두 기존 공통 닫기 함수. 닫으면 같은 환자·날짜 P-MED와 진입 버튼 포커스. 하단6개/헤더 변경 없음 | 초기/파일 읽기/AI 분석/검토/저장/오류. JPEG·PNG·WebP 5MB. HEIC 변환 안내. 약봉투 유형 확인·외부전송 동의 후만 분석. 약과 상태를 미리 선택하지 않음. 회차1..24개와 상태 각각 직접 선택, 최종 확인 필수. 빈 계획·조회 실패면 진입 불가, 미등록 약은 의료진 계획 등록 안내. 오류 시 사진·입력 유지 |
| C-MED-PHOTOS / clinician.js의 C-MED 하단 | 같은 날짜 사진 첨부 보고 확인 | 기존 의료진7개 메뉴/제목·history 유지. 접기식 상세로 사진·OCR·당시 자기보고 조회, 새 역할 링크/상단X 없음 | 환자·날짜별 최신20건. 원본 사진은 권한 검사된 경로에서 로드. AI 후보와 자기보고, 현재 상태와 당시 revision을 구분. 의료진 검토 완료를 자동 표시하지 않음 |

약명 비교는 NFKC·소문자·공백 정규화 후 이름이 정확히 같은 등록 계획만 ‘동일 이름 후보’로 표시한다. 함량이 다르거나 누락이면 그 사실을 표시하고 퍼지 매칭·성분 대체·처방 추정을 하지 않는다. 일치가 없어도 환자가 포장과 계획을 직접 대조하여 선택할 수 있다. 새 처방은 자동 생성하지 않는다. 포장 밖 알약만 있는 사진은 대상이 아님을 확인받는다.

파일 교체·동의 철회·닫기·환자 변경은 AI 초안/확인을 무효화하고 request generation으로 늦은 응답을 버린다. 사진·동의·검토값은 공통 dirty 추적 대상이며 URL/localStorage에 넣지 않는다. 분석 중 닫기 가능하되 응답 무효화, 파일 읽기·분석·저장 중 저장 불가. 저장 중 X/Escape/배경/환자·메뉴·날짜·뒤로가기 차단. 기존 수동 회차 초안이 있으면 사진 입력 진입 시 버리기 확인 후 재조회한다. 성공은 사진 보고+모든 회차 저장 후 표시; 후속 조회 실패는 저장 실패와 구별한다.

## API·동시성·오류 계약

기존 POST /api/patients/:id/photo-analyses에 kind=medication을 사용한다. 고정 OpenAI Responses·서버 키·store=false·30초·24시간 초안·5MB·동시2/환자10초 제한 유지. 미설정/권한/잔액/시간초과는 기존 오류를 보이며 수동 보고를 계속 제공한다. 가짜 AI 결과 없음.

POST /api/patients/:id/medication-photo-reports:
`{clientSubmissionId: UUID, analysisId, imageData, date, patientConfirmed:true, slots:[{orderId,time,status,reason,note,expectedRevision}]}`.
상태는 taken/missed/unknown. date는 KST 오늘 이하, 해당 환자·일자의 계획/시각만 허용. expectedRevision은 조회한 0 이상의 정수. 중복 회차·24개 초과·미확인·다른 사진/환자·종류·만료 초안은 거부한다. 모든 회차+사진 보고를 하나의 트랜잭션으로 저장하고 하나라도 충돌하면409/전체 롤백. 사진이 복용 사실을 증명하지 않으며 보고 시각을 복용 시각으로 사용하지 않는다.

동일 환자/clientSubmissionId·동일 정규 payload(hash 포함) 재전송은 같은 결과를 반환하여 응답 손실 후 중복 생성하지 않는다. 다른 payload 재사용은409. UUID는 실패 시 유지, 입력 변경 시 새 UUID. 동일 분석은 여러 보고에서 사용할 수 있으나 날짜·회차는 매번 환자가 확인한다. 같은 날짜 중복 저장도 기존 이벤트의 동일 내용은 revision을 올리지 않으며 사진 보고는 별도 첨부 이력으로 남는다.

GET 같은 경로?date=YYYY-MM-DD: reports 최신20건(원본 이미지 제외). GET 같은 경로/:reportId/image: 환자·보고 소유권 검사 후 image/jpeg|png|webp, private no-store/nosniff. GET medication-events 응답에 photoReports도 포함하여 C-MED에서 통합 조회한다. 실사용 모드는 기존 본인 환자/의료진+변경 CSRF 규약, demo는 기존 합성자료 공개 API 호환. 다른 환자의 report ID는404. 키/사진 원문을 로그로 출력하지 않는다.

## DB·변수·출처

schema5, 추가 테이블2개. medication_photo_reports: id(UUID), patient_id(FK CASCADE), client_submission_id(환자와 UNIQUE), request_hash(SHA256), analysis_id(FK), date(KST), image_hash, image_bytes(BLOB≤5MB), image_mime, analysis_json(서버의 OCR/provider/model/warnings snapshot), created_at(UTC). medication_photo_report_events: report_id(FK CASCADE), event_id·patient_id(이벤트 복합FK CASCADE), revision, event_json(당시 약명·함량·1회량·시각·상태·사유·메모·보고 시각 snapshot), PRIMARY KEY(report_id,event_id). 사진은 파일 디렉터리 대신 DB에 저장해 소유권·원자성·초기화를 일치시킨다. 기존 DB·기록을 지우지 않는다. 환자 삭제/데모 reset 시 함께 삭제. 무료 Render의 /tmp DB는 재배포 시 사라질 수 있으며 CSV는 사진 복원본이 아니다.

프런트 모듈 상태: imageData/analysis/loading/analyzing/saving/generation/date/patientId/schedule/submissionKey/submissionPayload. 공통 셸은 dirtySnapshot()/reset()/refresh()로 연결, 실제 변수는 generated/VARIABLES.md에 생성한다. 서버 모듈은 검증·원자 저장·메타 조회·사진 조회 담당. AI source=openai-package-text-v1, 보고 source=patient-self-report-with-photo, reviewStatus=unreviewed(자동 의료진 검토 없음). 이후 수동 수정되어도 snapshot은 변하지 않는다.

## 인수·검증 기준

임시 DB에서 정상 다중 회차/다른 환자·사진·초안종류/만료/미확인/미래/계획외/중복/중간 실패 롤백/revision 충돌/동일 재전송/UUID 충돌/수동 수정 후 snapshot 불변/reset/기존schema 추가 마이그레이션 검증. 실제 브라우저에서 320·390px, X→같은 날짜·환자, dirty 거절/수락, 분석 지연 후 닫기, 저장 지연 중 이동 잠금, 오류 입력 유지, 복약 수동 입력 보존 및 의료진 사진 조회. mock 제공자 테스트는 실제 GPT 정확도/실약 판별 검증으로 표시하지 않는다. 기존 식사/공지·메시지/탐색/strict auth 회귀검사 수행. 실제 과금 추론은 키 소유자가 Render 배포 후 직접 확인한다.
