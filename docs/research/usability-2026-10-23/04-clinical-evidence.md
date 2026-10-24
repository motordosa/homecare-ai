# 부록 D. 의료진·연구 근거

작성·조회 기준: 2026-10-23 KST. 이번 산출물은 조사·기획 자료이며 코드 변경, 실데이터 분석, API 가입·키 발급·유료 호출, 배포를 수행하지 않았다.

## 1. 근거 확인 수준과 제한

- **직접 확인:** 허용된 GitHub 서비스에서 자료 제작자가 별도로 공개한 공식 프로젝트 README와 현재 개발 문서 원본 9건. 파일 원문은 `clinical-sources/`, 파일 경로·blob SHA는 `clinical-independent-source-access.json`에 보존했다. 공식 소프트웨어의 제공 기능과 자료 의미를 확인한 것이며 해당 소프트웨어가 HomeCare AI 연구에 자동으로 적합하다는 임상 검증은 아니다.
- **원문 미열람:** AHRQ/NIST/FDA/STROBE/CONSORT/PRISMA/JMIR/NLM/Europe PMC/OpenAlex 구 문서/ASA 공식 웹 11건은 정상 HTTPS GET에서 proxy CONNECT 403을 반환했다. 상세 기록은 `clinical-source-access.json`. 동일 주소 반복 시도, 다른 프록시·TLS 해제·차단 문서 미러 다운로드를 하지 않았다. 아래 해당 자료의 주제·서지정보는 알려진 참조정보이며 **이번 최신 본문 확인·준수 인증 근거로 사용하지 않는다.**
- 설계 권고는 직접 읽은 기술 근거, 현재 제품 목적, 임상연구의 일반적 방법론에 기반한 **제품 제안**이다. 법적 의무나 규제 적합성 인증으로 표시하지 않는다. 연구 설계·통계분석계획(SAP)·기관별 권한은 책임연구자와 통계전문가가 확정해야 한다.

## 2. 직접 확인한 독립 공식 자료

| 근거 ID | 제작자·자료·판본 | 직접 읽은 내용 | HomeCare AI 적용 / 한계 |
|---|---|---|---|
| CE-01 | Europe PMC 공식 `epmc-tools` README. [원문](https://github.com/EuropePMC/epmc-tools/blob/main/README.md), 조회 2026-10-23 | 논문·과제·annotation 검색 API, article metadata, JATS XML 원문 처리, OAI-PMH 수집 기능을 README에 명시. `articles search`, `articles get`, `articles fulltext` 예시 확인 | 논문 검색→식별자·메타 확인→이용 가능한 원문 연결을 단계적으로 구현할 기술 경로가 있다. 실제 서비스 응답·현재 요청 제한·모든 논문의 원문 이용권을 확인한 것은 아님 |
| CE-02 | OurResearch `openalex-help` README. [원문](https://github.com/ourresearch/openalex-help/blob/main/README.md), 조회 2026-10-23 | 현재 통합 사이트 `help.openalex.org`, Help/Docs/API/Learn 독자별 구분, `content/`를 정본으로 수동 관리한다고 명시. 과거 GitBook 저장소 검색 메타는 retired 상태 | 외부 API 설명서 URL·버전을 고정값으로 방치하지 않는다. 비전문/전문 독자의 같은 사실을 다른 상세 수준으로 표현하는 사례로 참고. HomeCare UI의 우수성을 검증한 비교 연구가 아님 |
| CE-03 | OurResearch OpenAlex Authentication. [원문](https://github.com/ourresearch/openalex-help/blob/main/content/api/authentication.md), 문서 `updated: 2026-10-15` | 기본 keyless 사용과 무료 API key 사용을 구분. 키의 이메일 확인, 일일 예산, 초당 요청 제한, 429, cursor paging과 키 요구를 명시. 페이지 당시 표는 무키10/무료키30 requests/s지만 변경 가능한 공급자 값임 | 서버 측 API key·호출량/예산 모니터·캐시·429 backoff·중단/재시작을 설계한다. 수치와 요금은 개발 착수 시 재확인. 이번 조사에서 계정/이메일/키를 만들지 않았고 실제 API를 실행하지 않음 |
| CE-04 | OurResearch OpenAlex Search. [원문](https://github.com/ourresearch/openalex-help/blob/main/content/api/searching.md), `updated: 2026-10-03` | 검색 범위(title/abstract/fulltext/keywords), exact/Boolean/phrase, stemming·stop words, URL 길이 제한, 요청별 과금 설명. 같은 키워드라도 범위에 따라 결과 집합이 다름 | 저장된 검색식·필터·필드범위·DB·검색일·요청 버전을 함께 보존한다. 쉬운 검색과 고급 검색을 같은 결과 조건으로 연결한다. 자연어 AI 요약만 저장해서 검색을 재현할 수 있다고 표시하지 않음 |
| CE-05 | OurResearch OpenAlex Fulltext. [원문](https://github.com/ourresearch/openalex-help/blob/main/content/access/fulltext.md), `updated: 2026-09-18` | 원문 보유 여부 `has_content`, 다운로드 주소 `content_urls`, API key와 usage metering, OA/CC 라이선스 필터를 명시. 제공 원문은 살아 있는 데이터셋이라고 설명 | ‘서지 있음/초록 있음/원문 있음/이용권 확인’을 구분한다. 기본 버전은 원문 링크와 북마크부터 제공하고 무차별 전문 복제·임베딩은 하지 않는다. 메타데이터가 개방됐다는 이유로 모든 전문의 재배포 권한을 가정하지 않음 |
| CE-06 | OurResearch OpenAlex Work Attributes. [원문](https://github.com/ourresearch/openalex-help/blob/main/content/data/works/attributes.md), `updated: 2026-10-17` | DOI/PMID/PMCID ID, type/preprint, 원문 위치, abstract index 누락 가능, 자동 연구유형 태깅, `is_retracted`(Retraction Watch 기반), updated_date를 명시 | 논문카드에 ID·연도·연구유형/자동분류 여부·철회 상태·원문 링크·갱신일을 표시. DOI/PMID 중복 제거 및 preprint/출판본 연결. 자동 태그를 의료진의 설계 평가나 근거등급으로 대체하지 않음. `is_retracted=false`를 모든 문제 부재의 증명으로 보지 않음 |
| CE-07 | `lme4` 공식 프로젝트 README. [원문](https://github.com/lme4/lme4/blob/master/README.md), 조회 2026-10-23 | nested/crossed random effects, GLMM/NLMM, likelihood profiling·parametric bootstrap 제공 | 같은 환자의 반복측정을 환자 수만큼의 독립 표본으로 잘못 펼치지 않도록 분석 단위를 명시하고, 연구 설계에 맞는 혼합모형 후보를 전문 분석 단계에서 검토. README가 HomeCare 데이터의 모형 가정·표본수 적정성을 검증하지 않음 |
| CE-08 | `mice` 공식 프로젝트 README. [원문](https://github.com/amices/mice/blob/master/README.md), 조회 2026-10-23 | Fully Conditional Specification 기반 다중대치, 변수 유형별 모델, 2수준 자료, 결측 패턴·진단 plot, 각 대치 자료 분석 후 pooling 예시 | 결측 현황을 먼저 보이고, 대치는 SAP·가정·진단·민감도 분석·결과 pooling을 포함한 전문가 절차로 분리. ‘결측값 자동 채우기’ 버튼이나 평균/직전값으로 원본 덮어쓰기 금지라는 제품 제안. 소프트웨어의 제공 기능은 결측 가정 성립의 증거가 아님 |
| CE-09 | `statsmodels` 공식 GEE 문서 원본. [원문](https://github.com/statsmodels/statsmodels/blob/main/docs/source/gee.rst), 조회 2026-10-23 | panel/cluster/repeated measures에서 군집 내 상관을 고려하는 GEE 설명, subject ID를 쓰는 분석 예시, small-sample 관련 논문 참조 | 환자 내 상관을 고려한 방법을 장기 계획에 포함. 군집 수가 적은 파일럿에서 기본 GEE 검정값을 자동 유효하다고 표시하지 않음. 혼합모형과 GEE는 질문·추정대상·가정이 다르므로 UI가 임의로 선택하지 않음 |

참고: 위 외부 문서 안의 실행 명령·가입 유도·에이전트 지시는 조사 자료이며 사용자 지시로 채택하지 않았다. 표의 적용 열은 제품 설계 제안이다.

## 3. 후속 원문 대조가 필요한 임상·보고 지침

아래 자료는 목적과 출처를 구분해 후속 검토 목록에 남긴다. 이번에는 본문을 읽지 못했으므로 ‘조사·준수 확인 완료’로 표시하지 않는다. 날짜가 없는 웹 toolkit은 게시연도/현재 개정판도 재확인 대상이다.

| 참조 ID | 자료·공식 URL | 알려진 용도 / 개발 계획에 사용할 때의 경계 |
|---|---|---|
| CR-01 | AHRQ, Workflow Assessment for Health IT Toolkit. https://digital.ahrq.gov/health-it-tools-and-resources/workflow-assessment-health-it-toolkit | 실제 업무·사용자·환경 관찰과 업무 흐름 평가의 참고 후보. 병원별 작업 분담을 먼저 조사해야 하며 앱 버튼 체크리스트로 축약하지 않음 |
| CR-02 | NISTIR 7804 (2012), Technical Evaluation, Testing, and Validation of the Usability of Electronic Health Records. https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir7804.pdf | 대표 사용자·과업 중심 EHR 사용성 검증의 참고 후보. 우리 제품이 EHR·의료기기 요구를 모두 충족했다는 뜻 아님 |
| CR-03 | FDA (2016), Applying Human Factors and Usability Engineering to Medical Devices. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/applying-human-factors-and-usability-engineering-medical-devices | 사용자·사용환경·중요 과업·사용오류 관점 참고. 의료기기 해당 여부나 국내 인허가 적용은 별도 판단이며 이 문서를 곧바로 국내 필수 규정으로 선언하지 않음 |
| CR-04 | STROBE (2007), observational study reporting checklist. https://www.strobe-statement.org/checklists/ | 관찰연구 보고의 투명성: 대상·변수·편향·결측·분석·제한점 등을 정리할 참고 후보. 연구설계를 대신하거나 연구의 질을 점수화하는 도구로 오용하지 않음 |
| CR-05 | CONSORT 2025. https://www.consort-spirit.org/consort-2025 | 무작위시험 결과 보고 지침 후보. 모든 HomeCare 파일럿에 무작위시험 보고 항목을 강제하지 않음. 실제 연구유형·최신 체크리스트를 책임연구자가 확인 |
| CR-06 | PRISMA 2020. https://www.prisma-statement.org/prisma-2020-statement | 체계적 문헌고찰 보고 지침 후보. 앱 내 간단한 관련 논문 검색을 PRISMA 준수 체계적 고찰로 표시하지 않음. 검색식·선정/제외 이유·중복 제거·검토 기록은 추후 확장 기반으로 설계 |
| CR-07 | Eysenbach G, CONSORT-EHEALTH (2011), JMIR 13(4):e126. https://www.jmir.org/2011/4/e126/ ; DOI 10.2196/jmir.1923 | 웹/모바일 중재의 이용·순응·탈락·버전 변화 보고 참고 후보. 단순 페이지뷰를 치료 순응도나 임상효과로 해석하지 않음 |
| CR-08 | NLM, Entrez Programming Utilities Help. https://www.ncbi.nlm.nih.gov/books/NBK25501/ | PubMed 등 NCBI 검색·상세 메타 API 후보. 현재 인증·호출 제한·bulk 사용 조건·정책은 착수 전 공식 원문 대조 필수. 기억에 있는 예전 제한값을 고정 계약으로 사용하지 않음 |
| CR-09 | Europe PMC RESTful Web Service. https://europepmc.org/RestfulWebService | 문헌 검색·메타/원문 API 후보. 이번에는 CE-01 공식 개발 도구 README만 직접 확인했으며 이 서비스 명세와 실응답은 미확인 |
| CR-10 | OpenAlex 구 API overview. https://docs.openalex.org/how-to-use-the-api/api-overview | 구 주소는 접근 차단됐고, 공식 GitHub의 retired 메타/현재 README를 통해 문서 체계 변경을 확인. 구현할 때는 CE-02..06에 따른 현재 정본과 서비스 이용조건을 다시 확인 |
| CR-11 | ASA (2016), Statement on Statistical Significance and P-values. https://www.amstat.org/asa/files/pdfs/P-ValueStatement.pdf ; DOI 10.1080/00031305.2016.1154108 | p값 한 값으로 효과 크기·중요성·진실 여부를 판단하지 않는 통계 해석의 참고 후보. 이번 본문 미열람. 제품에서는 효과량·불확실성·표본/결측·분석계획을 함께 표시하도록 제안 |

SPIRIT(시험 프로토콜)·ICH E9(R1)(estimand/민감도분석) 등은 연구 유형이 정해지면 추가 검토할 후보다. 이번에 직접 조회·판본 대조를 수행한 자료로 세지 않는다.

## 4. 의료진·보조인력의 역할별 사용 구조 제안

‘간단 모드/전문 모드’는 표시 상세 수준이고, **서버 권한을 바꾸는 스위치가 아니다.** 기관이 부여한 역할과 담당 환자 범위를 서버가 검증해야 한다. 의학 교육 정도를 AI나 사용자의 자기 선택만으로 추정하지 않는다.

| 업무 | 보조 인력 / 환자관리 담당 | 의사·임상 책임자 | 연구자·분석 담당 | 관리자 |
|---|---|---|---|---|
| 미입력 확인·연락·예약·자료정리 | 지정 환자 작업목록, 정해진 문구·누락 사유·연락 결과 기록 | 검토·예외 처리 | 연구 누락 패턴 열람(승인 범위) | 역할/범위 관리 |
| 약명·함량·용법 신규/변경 | 초안 작성·사진 대조 요청, 확정 불가 | 근거 검토 후 확정·변경 이유 | 승인된 분석용 변수만 열람 | 임상 결정 권한을 관리자라는 이유로 자동 부여하지 않음 |
| 위험 신호/환자 증상 | ‘의료진 확인 필요’로 전달, 진단·중단 지시 금지 | 임상 검토·대응·완료 | 비식별 추세 분석 | 전달 경로·감사 설정 |
| 기록 오류 정정 | 원본 유지한 정정 요청·사유 | 승인된 정정 확정 | 정정 버전·분석 제외 상태 열람 | 감사 추적·보존 정책 |
| 분석·반출 | 정해진 기술통계와 허용된 목록 | 임상 해석·검토 | 코호트/SAP/분석실행/결과검토 | export scope·권한·감사 |
| 문헌 | 검색·보관·요약 초안 | 임상 적용 가능성·근거 검토 | 검색 전략·선정 기준·근거표 | 공급자/이용권/예산 설정 |

이 행렬은 제안이며 병원 내 실제 직무·책임·기관 규정 확인 후 확정한다. UI에서 메뉴를 숨기는 것만으로 권한 통제를 완료하지 않는다.

## 5. 통계 기능의 단계와 계산 계약 제안

### 먼저 만들어야 할 공통 자료 의미

- 단위: `환자`, `환자-일`, `계획된 복약 회차`, `자기보고`, `측정값`을 분리한다. 예를 들어 환자6명의30일 자료는 환자180명이 아니다.
- 원천: 환자 자기보고·보호자 대리입력·보조인력 전사·기기 수신·AI 추정·합성자료를 구분하고, 기록 시각·측정/대상일·기기 시간대·수정 버전을 따로 보존한다.
- 결측: 미기록·기억 안 남·기기 미수신·권한/연결 문제·임상적 비대상·예정 없음·연구 중단을 같은 0으로 합치지 않는다. 기기 데이터0도 유효 측정인지 착용/연결 자료로 해석 한계를 표시한다.
- 분석 대상을 결정하는 코호트 조건·관찰창·변수 정의·단위·일자 경계·포함/제외 이유·분모를 버전으로 저장한다. 분석용 정제는 원본을 덮어쓰지 않는다.

### 기술통계 → 비교/연관성 → 전문 분석 순서

| 단계 | 기능 | 기본 출력과 방지해야 할 오류 |
|---|---|---|
| 기술통계 | 기간/환자군 필터, 환자별 추이, 분포, 결측 heatmap, source filter, 요약표 | 환자수/관찰일수/유효값수/분모/기간/단위·결측을 항상 표시. 유효값이 없으면 계산불가. 평균만으로 분포나 환자간 차이를 숨기지 않음 |
| 제한된 비교 | 사전 정의한 baseline·follow-up 변화, 두 군/하위군 비교 템플릿 | 같은 대상의 paired 변화인지 서로 다른 군인지 구분. 동일 환자 반복행의 독립성 오류를 막고, 효과량·불확실성·선정 조건·공변량과 결측 처리 표시. 관찰자료의 단순 차이를 치료 인과효과로 표시하지 않음 |
| 전문 분석 | 책임연구자 승인 SAP에 따른 mixed-effects/GEE 등, 선택한 결측 전략·민감도분석 | 모형 목적·가정·적합/수렴·군집수·희소자료·결측 가정 검토 필요. 작은 파일럿에서 자동 p값/위험예측을 유효하다고 표시하지 않음. 전문 도구와 결과 검증 후 승인된 모형 템플릿만 제공 |
| 재현 가능한 결과 묶음 | 분석 스냅샷·설정·실행환경/코드 버전·seed(사용 시)·입력 hash·결과표·변수 사전 export | 같은 데이터 버전과 설정에서 같은 결과가 나오는지 검사. 화면의 현재 필터만 캡처한 PDF를 분석 재현성 확보로 표시하지 않음 |

복약 지표 예시(제안; 연구의 primary endpoint는 SAP에서 선택):

- **보고율:** `(taken + missed + unknown) / 대상 예정 회차`. ‘기억 안 남’은 응답은 했지만 복용 상태 불명이라는 뜻이다.
- **예정 회차 대비 복용 보고율:** `taken / 대상 예정 회차`. 자기보고 지표이며 실제 복용률이 아니다. unknown·pending·missed를 별도 개수로 병기한다.
- **복용 상태가 명확한 응답 중 복용 보고 비율:** `taken / (taken + missed)`. 반드시 전체 예정 회차와 보고율을 함께 보여야 한다. 10회 중1회만 응답해1회 복용인 경우 ‘100%’만 크게 표시하지 않는다.
- **무계획/해당 없음:** 분모0이면0%가 아니라 계산불가/예정 회차 없음. 기존 일일 복약 점수를 회차 기반 분모와 섞지 않는다.

체중·수면·걸음수는 환자별 변화와 환자군 요약을 구분한다. 한 환자의 관찰일이 많다는 이유로 집단 평균을 더 강하게 지배하게 할지 여부를 사전 정의하고 표에 표시한다. 이 상세 계산 계약은 외부 지침의 그대로 인용이 아니라 HomeCare 목적에 맞춘 설계 제안이다.

## 6. 문헌 검토 기능의 실행 범위 제안

1. **1차: 검색·북마크·원문 이동.** PubMed/Europe PMC를 의학 검색 우선 후보로 검토하고 OpenAlex를 인용/메타 보강 후보로 둔다. API 정책·서비스 도달·결과 매핑 확인 전에는 연결 완료라고 표시하지 않는다. 일반 임상 주제/PICO 검색만 외부에 보내고 환자 이름·연락처·원문 증상 메모를 검색어로 자동 전송하지 않는다.
2. **2차: 근거 카드와 비교표.** PMID/DOI/PMCID, 제목/연도/저널/연구유형(원문확인 또는 자동태그), 대상/설계/중재·비교/결과/제한점, 초록/원문 구분, 철회/갱신 상태·조회일·검토자를 보존한다. 인용 횟수·AI 요약 점수를 근거등급으로 사용하지 않는다.
3. **3차: 출처가 연결된 요약 보조.** 모델이 접근한 문서 범위만 요약하고 주장마다 출처ID·원문 구절/쪽/절 연결. 초록만 읽었으면 ‘초록 기반’ 표기. 의료진 검토 전은 초안이며 환자 처방/안내에 자동 반영하지 않는다. 인용 ID의 실존·내용 지지 여부를 검사하고 생성된 가짜 DOI·논문을 허용하지 않는다.
4. **체계적 고찰은 별도 모듈.** 저장된 검색식·실행일·DB·중복 제거·선정/제외 사유·독립 검토/불일치 해결·흐름도를 추가할 수 있으나, 일반 관련 문헌 검색을 체계적 고찰이라고 부르지 않는다.

API 운영 인수조건: 결과0건과 장애를 구분, 429/시간초과/공급자변경에 입력 보존·재시도, 서버 키 비노출, 페이지 누락/중복 검사, 제한된 검색 캐시와 조회일 표시, 약관·저작권에 맞는 원문 보관, 저장 검색 재실행 시 변경 결과를 구분. 실제 공급자 최신 요금·한도는 개발 착수 시 확인한다.

## 7. 업무별 사용성 검증 제안

의사/교수, 연구간호사·CRC(있을 경우), 의학교육이 적은 보조 인력을 따로 모집하고 실제 과업으로 검증한다. 각각의 지원·교육 조건도 기록해야 한다. 아래 성공률·시간 값은 향후 파일럿에서 조정할 **제품 목표**이지 외부 표준의 의무값이 아니다.

- 과업: 오늘 연락할 대상 찾기, 환자·기간·자료 출처 확인, 미보고와 실제0 구분, 사진/OCR와 확정 약 구분, 자료 정정 요청, 임상 검토 전달, 승인된 정정 확인, 특정 코호트 기술통계 만들기, 논문 저장·근거 확인.
- 중요 오류: 다른 환자에게 기록/안내 연결, 무계획 회차를 미복용으로 처리, 미보고를 정상으로 해석, 보조인력이 처방 확정, 전체 환자 반출, AI 논문 요약을 검토 완료로 착각. 중요 오류0건·오류 후 안전 복구 여부를 출시 게이트 후보로 둔다.
- 일반 목표: 대표 핵심 과업의 지원 없이 성공률≥90%, 중도 이탈·도움 요청·오류/복구·시간·이해도 기록. 작업별 시간은 현장 기존 업무의 기준선을 측정한 후 설정한다. 소규모 형성평가의 비율을 전체 의료진에게 통계적으로 일반화하지 않는다.
- 확인 질문: ‘이 그래프의 숫자는 몇 명의 어떤 기간입니까?’, ‘빈칸은0입니까?’, ‘사진에 약이 보이면 복용이 확인됐습니까?’, ‘이 논문은 초록만 읽은 요약입니까?’ 등으로 해석 오류를 측정한다.

## 8. 버전업에 반영할 의존관계

역할/대상/확정 책임 + 원천·결측·분모 정의 → 누락/연락/검토 작업목록과 상세 drill-down → 검증된 기술통계/자료정제·반출 → 근거 검색/북마크 → 승인된 전문 분석/SAP + 출처 연결 요약 순서를 권고한다. 기술통계와 논문 검색의 일부는 병렬 개발할 수 있지만, 실제 연구 투입은 계정별 권한·영구 저장/백업·감사·분석 스냅샷·기관 절차를 갖춘 뒤 별도 승인 게이트로 둔다.

현재 작업에서는 위 항목을 구현하거나 활성화하지 않았다. 설계가 승인되면 화면 ID·역할별 행위·자료/오류/단위 계약·변수 사전·테스트 계획을 먼저 확정한 뒤 개발한다.
