# 문헌 검색·근거 검토 제작 명세

작성일 2026-10-23. 요구 C10/L01/L02, C13. 현재 실행 범위는 USABILITY_IMPLEMENTATION_PLAN.md를 따른다. 본 명세를 먼저 저장한 뒤 구현한다. AI 문헌 요약·자동 처방·체계적 고찰 인증은 포함하지 않는다.

## 화면 C-EVIDENCE

- 의료진 공통 셸의 `view=evidence` 메뉴에서 진입한다. 환자 선택/URL/history/상단 제목은 기존 셸이 관리한다. 선택 환자의 이름·메모·사진을 검색 폼에 자동 복사하지 않는다.
- `public/clinician-evidence.js`의 `createEvidenceWorkspace({api,getState,toast})`가 `#app-content` 안의 검색·결과·저장검색·북마크·검토 편집기를 담당한다. `mount/deactivate/canLeave/dirty/busy/refresh` 계약을 제공하며 동일 화면 갱신은 편집 입력을 지우지 않는다.
- 사용자가 일반 연구주제를 직접 입력하고 개인정보가 없다는 확인을 한 후 검색한다. 검색식·기간·데이터원·검색 시각·캐시 여부·결과수와 제공 범위를 표시한다. 기본 검색원은 Europe PMC 한 곳이며 검색식은 제공자 문법으로 전달한다.
- 검색 중 진행 상태와 취소를 제공한다. 오류/0건을 구별하고 검색어를 보존한다. 저장·검토 변경 중에는 화면 이탈을 막고, 미저장 내용은 명시적 폐기 확인을 거친다. 실패 시 입력 유지, 성공 후 지속적인 상태 문구를 제공한다.
- 문헌 결과는 제목·저자·연도·학술지·PMID/DOI·연구유형(공급자 메타)·초록 유무·공급자에서 명시한 철회 여부·원문 링크를 표시한다. 철회 여부 미확인은 ‘철회 없음’으로 표시하지 않는다. 링크는 공급자 식별자에서 서버가 구성한다. HTML 본문은 렌더하지 않는다.
- 북마크는 검색 당시 서버 스냅샷에서 선택한 논문만 생성한다. 사람이 포함/제외/검토를 결정하고 이유·근거 구절·위치를 남긴다. metadata/abstract/external-fulltext 근거 범위를 선택하며 마지막 값은 사용자가 별도로 읽었다는 기록일 뿐 앱의 전문 수집을 뜻하지 않는다.

## 권한·경로

모든 경로는 로그인 세션이 필요하며 변경은 CSRF와 같은 출처 검사를 적용한다. 일반 조회/검색/북마크에는 서버가 부여한 `evidence.read`, 검토 완료에는 `evidence.review` capability가 필요하다. 버튼 노출·표시 모드는 권한을 부여하지 않는다. actor.role의 기존 clinician 호환 역할만으로 검토권한을 추론하지 않는다.

| 경로 | 입력 | 결과 |
|---|---|---|
| GET /api/clinician/evidence | 없음 | 최근 검색20건, 북마크100건, 제한 수와 검토 가능 여부 |
| POST /api/clinician/evidence/search | query(2~500), 선택 yearFrom/yearTo, cursorMark, confirmNoPersonalData=true | 검색식/필터/검색일, 공급자 총건수, 중복 제거한 이번 페이지 최대20건, nextCursor, cached |
| GET /api/clinician/evidence/searches/:id | 저장 검색 UUID | 원래 결과 스냅샷. 외부 재검색 없음 |
| POST /api/clinician/evidence/bookmarks | searchId, articleKey | 서버 스냅샷의 문헌 저장. 기존 동일 articleKey면 duplicate=true |
| PATCH /api/clinician/evidence/bookmarks/:id | version, status(saved/included/excluded/reviewed), note, evidenceText, locator, reviewBasis | 수정 버전·행위자·시각·이력. stale version은409 |

검토 완료에는 note/evidenceText/locator가 필요하다. abstract 근거는 저장 문헌에 공급자 초록이 있을 때만 허용한다. 제외에는 사유가 필요하다. 보조 인력은 검토 완료를 생성·해제·수정할 수 없다. 검색/검토 문구는 원자료와 분리하며 임상 판단을 자동 적용하지 않는다.

## 서버·자료 계약

- `lib/evidence.mjs`: `ensureEvidenceSchema(db)`, `createEvidenceService({db,fetchImpl,now})`. 서비스는 search/list/getSearch/createBookmark/updateBookmark를 제공한다.
- `evidence_searches`: UUID, 검색자, query/parameters/query_signature, provider, searched_at, result_json. 성공 응답을 동결하며 검색식·기간·cursor를 포함한 서명으로10분 캐시한다. 캐시 재사용은 원래 검색일을 유지한다.
- `evidence_bookmarks`: UUID, 고유 article_key, 원래 article_json/search_id, 상태·메모·근거·위치·근거범위, version, 작성/수정자·시각. 논문 메타를 클라이언트 입력으로 교체하지 않는다.
- `evidence_reviews`: bookmark_id/version, actor_id, 변경 스냅샷, created_at. 원래 문헌 스냅샷과 사람이 남긴 해석을 구별한다.
- 원문 전체를 서버가 수집하거나 요약하지 않는다. 한 검색의 저장량은 페이지 최대20건/초록별 최대8000자, 제공자 응답 최대1MiB로 제한한다. 최근 목록 제한을 표시하며 오래된 검색의 식별자는 북마크에서 유지한다.
- 외부 주소는 `https://www.ebi.ac.uk/europepmc/webservices/rest/search`로 서버에 고정한다. 사용자 URL·redirect를 허용하지 않는다. query/연도/cursor만 검증·인코딩하여 전달하고 타임아웃을 적용한다. 외부 오류 원문·키·환자정보를 응답/로그에 노출하지 않는다.
- 정상0건은200, 잘못된 입력400, 권한403, 없음404, 버전충돌409, 공급자 오류/형식오류502, 공급자 한도503, 타임아웃504를 구별한다. 실패한 검색을 성공 결과나 가짜 문헌으로 저장하지 않는다.

## 검증 기준

임시 SQLite와 모의 fetch로 실제 공급자 성공/0건/429/타임아웃/과대응답/잘못된JSON/redirect거부·고정주소·입력제약·캐시의 검색시각·후속 cursor·중복 문헌·북마크 주입 차단·권한·낙관잠금·검토이력을 검사한다. 브라우저에서는 XSS 문자열의 텍스트 표시, 미저장/지연 응답/조회 실패 보존을 검사한다. 이 환경의 외부 접속 제한 때문에 실 API 검색을 확인한 것으로 보고하지 않는다. 차단된 문서 요청을 다른 호스트로 우회하지 않으며 실제 배포 서비스에서 별도 확인한다.
