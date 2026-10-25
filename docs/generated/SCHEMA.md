# DB 스키마 기준

자동 생성: 임시 SQLite에 현재 추가 마이그레이션을 적용한 결과다. 사용자/공개 DB에 접근하지 않으며 행 값·토큰·사진을 저장하지 않는다. 의미와 단위는 [자료 사전](../DATA_DICTIONARY.md)과 [계약](../CONTRACTS.md)을 함께 읽는다.

45 tables. 생성: `npm run docs:variables`, 최신 검사: `npm run docs:check`.

## auth_accounts

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| provider | TEXT | yes |  |  |
| provider_user_id | TEXT | yes |  |  |
| demo_role | TEXT | no |  |  |
| patient_id | TEXT | no |  |  |
| created_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE SET NULL)

```sql
CREATE TABLE auth_accounts (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('kakao','demo')),
    provider_user_id TEXT NOT NULL, demo_role TEXT CHECK(demo_role IN ('patient','clinician')),
    patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, UNIQUE(provider,provider_user_id)
  )
```

## auth_sessions

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| token_hash | TEXT | no |  | 1 |
| account_id | TEXT | yes |  |  |
| csrf_token | TEXT | yes |  |  |
| expires_at | INTEGER | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: account_id → auth_accounts.id (DELETE CASCADE)

```sql
CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  )
```

## caregiver_delegations

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| account_id | TEXT | yes |  |  |
| scopes_json | TEXT | yes |  |  |
| start_date | TEXT | yes |  |  |
| end_date | TEXT | yes |  |  |
| reason | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| created_by | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |
| revoked_by | TEXT | no |  |  |
| revoked_at | TEXT | no |  |  |
| revoke_reason | TEXT | no |  |  |

외래키: account_id → auth_accounts.id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE caregiver_delegations (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE, scopes_json TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL,
    version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    revoked_by TEXT, revoked_at TEXT, revoke_reason TEXT
  )
```

## conversation_reads

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | yes |  | 1 |
| account_id | TEXT | yes |  | 2 |
| reader_role | TEXT | yes |  |  |
| through_id | INTEGER | yes |  |  |
| read_at | TEXT | yes |  |  |

외래키: account_id → auth_accounts.id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE conversation_reads (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    reader_role TEXT NOT NULL CHECK(reader_role IN ('patient','clinician')), through_id INTEGER NOT NULL, read_at TEXT NOT NULL,
    PRIMARY KEY(patient_id,account_id)
  )
```

## daily_record_audit

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | INTEGER | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| before_json | TEXT | no |  |  |
| after_json | TEXT | yes |  |  |
| actor_json | TEXT | yes |  |  |
| reason | TEXT | yes |  |  |
| source | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE daily_record_audit (
    id INTEGER PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, actor_json TEXT NOT NULL,
    reason TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
  )
```

## daily_record_submissions

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | yes |  | 1 |
| request_id | TEXT | yes |  | 2 |
| request_hash | TEXT | yes |  |  |
| response_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE daily_record_submissions (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(patient_id,request_id)
  )
```

## daily_records

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| steps | INTEGER | no |  |  |
| sleep_hours | REAL | no |  |  |
| medication_status | TEXT | no |  |  |
| appetite | TEXT | no |  |  |
| mood | TEXT | no |  |  |
| note | TEXT | yes | '' |  |
| weight_kg | REAL | no |  |  |
| created_at | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |
| revision | INTEGER | yes | 1 |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE daily_records (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL, steps INTEGER, sleep_hours REAL, medication_status TEXT,
      appetite TEXT, mood TEXT, note TEXT NOT NULL DEFAULT '', weight_kg REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, UNIQUE(patient_id,date)
    )
```

## evidence_bookmarks

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| article_key | TEXT | yes |  |  |
| article_json | TEXT | yes |  |  |
| search_id | TEXT | yes |  |  |
| review_status | TEXT | yes |  |  |
| note | TEXT | yes | '' |  |
| evidence_text | TEXT | yes | '' |  |
| locator | TEXT | yes | '' |  |
| review_basis | TEXT | yes | 'metadata' |  |
| version | INTEGER | yes | 1 |  |
| created_by | TEXT | yes |  |  |
| updated_by | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |

외래키: updated_by → auth_accounts.id (DELETE NO ACTION); created_by → auth_accounts.id (DELETE NO ACTION); search_id → evidence_searches.id (DELETE NO ACTION)

```sql
CREATE TABLE evidence_bookmarks (
    id TEXT PRIMARY KEY, article_key TEXT NOT NULL UNIQUE, article_json TEXT NOT NULL,
    search_id TEXT NOT NULL REFERENCES evidence_searches(id),
    review_status TEXT NOT NULL CHECK(review_status IN ('saved','included','excluded','reviewed')),
    note TEXT NOT NULL DEFAULT '', evidence_text TEXT NOT NULL DEFAULT '', locator TEXT NOT NULL DEFAULT '',
    review_basis TEXT NOT NULL DEFAULT 'metadata' CHECK(review_basis IN ('metadata','abstract','external-fulltext')),
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL REFERENCES auth_accounts(id), updated_by TEXT NOT NULL REFERENCES auth_accounts(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )
```

## evidence_reviews

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| bookmark_id | TEXT | yes |  | 1 |
| version | INTEGER | yes |  | 2 |
| actor_id | TEXT | yes |  |  |
| snapshot_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: actor_id → auth_accounts.id (DELETE NO ACTION); bookmark_id → evidence_bookmarks.id (DELETE CASCADE)

```sql
CREATE TABLE evidence_reviews (
    bookmark_id TEXT NOT NULL REFERENCES evidence_bookmarks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES auth_accounts(id),
    snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(bookmark_id,version)
  )
```

## evidence_searches

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| actor_id | TEXT | yes |  |  |
| query | TEXT | yes |  |  |
| query_signature | TEXT | yes |  |  |
| parameters_json | TEXT | yes |  |  |
| provider | TEXT | yes |  |  |
| searched_at | TEXT | yes |  |  |
| result_json | TEXT | yes |  |  |

외래키: actor_id → auth_accounts.id (DELETE NO ACTION)

```sql
CREATE TABLE evidence_searches (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES auth_accounts(id),
    query TEXT NOT NULL, query_signature TEXT NOT NULL, parameters_json TEXT NOT NULL,
    provider TEXT NOT NULL, searched_at TEXT NOT NULL, result_json TEXT NOT NULL
  )
```

## health_batches

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| connection_id | TEXT | yes |  | 1 |
| patient_id | TEXT | yes |  |  |
| batch_id | TEXT | yes |  | 2 |
| body_hash | TEXT | yes |  |  |
| received_at | TEXT | yes |  |  |
| accepted_days | INTEGER | yes |  |  |
| ignored_days | INTEGER | yes |  |  |

외래키: connection_id → health_connections.id (DELETE CASCADE); patient_id → health_connections.patient_id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE health_batches (
      connection_id TEXT NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      received_at TEXT NOT NULL,
      accepted_days INTEGER NOT NULL,
      ignored_days INTEGER NOT NULL,
      PRIMARY KEY(connection_id,batch_id),
      FOREIGN KEY(connection_id,patient_id) REFERENCES health_connections(id,patient_id) ON DELETE CASCADE
    )
```

## health_connection_issuances

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | yes |  | 1 |
| client_request_id | TEXT | yes |  | 2 |
| body_hash | TEXT | yes |  |  |
| connection_id | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: connection_id → health_connections.id (DELETE CASCADE); patient_id → health_connections.patient_id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE health_connection_issuances (
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(patient_id,client_request_id),
      FOREIGN KEY(connection_id,patient_id) REFERENCES health_connections(id,patient_id) ON DELETE CASCADE
    )
```

## health_connections

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| platform | TEXT | yes |  |  |
| label | TEXT | yes |  |  |
| token_hash | TEXT | yes |  |  |
| selected | INTEGER | yes | 1 |  |
| created_at | TEXT | yes |  |  |
| last_received_at | TEXT | no |  |  |
| revoked_at | TEXT | no |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE health_connections (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('health-connect','apple-health')),
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      selected INTEGER NOT NULL DEFAULT 1 CHECK(selected IN (0,1)),
      created_at TEXT NOT NULL,
      last_received_at TEXT,
      revoked_at TEXT,
      UNIQUE(id,patient_id)
    )
```

## health_daily

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| connection_id | TEXT | yes |  | 1 |
| patient_id | TEXT | yes |  |  |
| date | TEXT | yes |  | 2 |
| steps | INTEGER | no |  |  |
| sleep_minutes | REAL | no |  |  |
| steps_updated_at | TEXT | no |  |  |
| sleep_updated_at | TEXT | no |  |  |
| updated_at | TEXT | yes |  |  |
| received_at | TEXT | yes |  |  |

외래키: connection_id → health_connections.id (DELETE CASCADE); patient_id → health_connections.patient_id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE health_daily (
      connection_id TEXT NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      steps INTEGER CHECK(steps IS NULL OR (steps BETWEEN 0 AND 100000 AND steps=CAST(steps AS INTEGER))),
      sleep_minutes REAL CHECK(sleep_minutes IS NULL OR sleep_minutes BETWEEN 0 AND 1440),
      steps_updated_at TEXT,
      sleep_updated_at TEXT,
      updated_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY(connection_id,date),
      FOREIGN KEY(connection_id,patient_id) REFERENCES health_connections(id,patient_id) ON DELETE CASCADE
    )
```

## meal_submissions

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | yes |  | 1 |
| request_id | TEXT | yes |  | 2 |
| request_hash | TEXT | yes |  |  |
| meal_id | TEXT | no |  |  |
| created_at | TEXT | yes |  |  |

외래키: meal_id → meals.id (DELETE SET NULL); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE meal_submissions (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    meal_id TEXT REFERENCES meals(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(patient_id,request_id)
  )
```

## meals

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| meal_type | TEXT | yes |  |  |
| food_type | TEXT | yes |  |  |
| portion | REAL | no |  |  |
| calories | REAL | no |  |  |
| protein_grams | REAL | no |  |  |
| image_filename | TEXT | no |  |  |
| source | TEXT | yes | 'demo-food-table-v1' |  |
| created_at | TEXT | yes |  |  |
| analysis_id | TEXT | no |  |  |
| food_label | TEXT | no |  |  |
| estimation_json | TEXT | no |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE "meals" (
        id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT NOT NULL, meal_type TEXT NOT NULL, food_type TEXT NOT NULL,
        portion REAL, calories REAL, protein_grams REAL, image_filename TEXT,
        source TEXT NOT NULL DEFAULT 'demo-food-table-v1', created_at TEXT NOT NULL,
        analysis_id TEXT, food_label TEXT, estimation_json TEXT
      )
```

## medication_event_audit

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| event_id | TEXT | yes |  |  |
| order_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| time | TEXT | yes |  |  |
| revision | INTEGER | yes |  |  |
| previous_json | TEXT | no |  |  |
| current_json | TEXT | yes |  |  |
| changed_at | TEXT | yes |  |  |

외래키: order_id → medication_orders.id (DELETE CASCADE); patient_id → medication_orders.patient_id (DELETE CASCADE); event_id → medication_events.id (DELETE CASCADE); patient_id → medication_events.patient_id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE medication_event_audit (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL, order_id TEXT NOT NULL,
        date TEXT NOT NULL, time TEXT NOT NULL, revision INTEGER NOT NULL,
        previous_json TEXT, current_json TEXT NOT NULL, changed_at TEXT NOT NULL,
        UNIQUE(event_id,revision),
        FOREIGN KEY(event_id,patient_id) REFERENCES medication_events(id,patient_id) ON DELETE CASCADE,
        FOREIGN KEY(order_id,patient_id) REFERENCES medication_orders(id,patient_id) ON DELETE CASCADE
      )
```

## medication_events

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| order_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| time | TEXT | yes |  |  |
| status | TEXT | yes |  |  |
| reason | TEXT | yes | '' |  |
| note | TEXT | yes | '' |  |
| revision | INTEGER | yes |  |  |
| reported_at | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: order_id → medication_orders.id (DELETE CASCADE); patient_id → medication_orders.patient_id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE medication_events (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('taken','missed','unknown')),
        reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL CHECK(revision>=1),
        reported_at TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(order_id,date,time), UNIQUE(id,patient_id),
        FOREIGN KEY(order_id,patient_id) REFERENCES medication_orders(id,patient_id) ON DELETE CASCADE
      )
```

## medication_order_requests

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | yes |  | 1 |
| request_id | TEXT | yes |  | 2 |
| request_hash | TEXT | yes |  |  |
| order_id | TEXT | yes |  |  |

외래키: order_id → medication_orders.id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE medication_order_requests (
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES medication_orders(id) ON DELETE CASCADE,
        PRIMARY KEY(patient_id,request_id)
      )
```

## medication_orders

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| name | TEXT | yes |  |  |
| strength | TEXT | yes | '' |  |
| dose | TEXT | yes |  |  |
| route | TEXT | yes | '' |  |
| times | TEXT | yes |  |  |
| start_date | TEXT | yes |  |  |
| end_date | TEXT | no |  |  |
| instructions | TEXT | yes | '' |  |
| status | TEXT | yes | 'active' |  |
| created_at | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE medication_orders (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        name TEXT NOT NULL, strength TEXT NOT NULL DEFAULT '', dose TEXT NOT NULL,
        route TEXT NOT NULL DEFAULT '', times TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT, instructions TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(id,patient_id), CHECK(end_date IS NULL OR end_date>=start_date)
      )
```

## medication_photo_report_events

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| report_id | TEXT | yes |  | 1 |
| patient_id | TEXT | yes |  |  |
| event_id | TEXT | yes |  | 2 |
| revision | INTEGER | yes |  |  |
| event_json | TEXT | yes |  |  |

외래키: event_id → medication_events.id (DELETE CASCADE); patient_id → medication_events.patient_id (DELETE CASCADE); report_id → medication_photo_reports.id (DELETE CASCADE); patient_id → medication_photo_reports.patient_id (DELETE CASCADE)

```sql
CREATE TABLE medication_photo_report_events (
    report_id TEXT NOT NULL, patient_id TEXT NOT NULL, event_id TEXT NOT NULL,
    revision INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(report_id,event_id),
    FOREIGN KEY(report_id,patient_id) REFERENCES medication_photo_reports(id,patient_id) ON DELETE CASCADE,
    FOREIGN KEY(event_id,patient_id) REFERENCES medication_events(id,patient_id) ON DELETE CASCADE
  )
```

## medication_photo_reports

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| client_submission_id | TEXT | yes |  |  |
| request_hash | TEXT | yes |  |  |
| analysis_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| image_hash | TEXT | yes |  |  |
| image_bytes | BLOB | yes |  |  |
| image_mime | TEXT | yes |  |  |
| analysis_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: analysis_id → photo_analyses.id (DELETE CASCADE); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE medication_photo_reports (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    client_submission_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    analysis_id TEXT NOT NULL REFERENCES photo_analyses(id) ON DELETE CASCADE,
    date TEXT NOT NULL, image_hash TEXT NOT NULL, image_bytes BLOB NOT NULL,
    image_mime TEXT NOT NULL, analysis_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(patient_id,client_submission_id), UNIQUE(id,patient_id)
  )
```

## medication_photo_review_events

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | INTEGER | no |  | 1 |
| report_id | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| actor_json | TEXT | yes |  |  |
| snapshot_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: report_id → medication_photo_reports.id (DELETE CASCADE)

```sql
CREATE TABLE medication_photo_review_events (
    id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES medication_photo_reports(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(report_id,version)
  )
```

## medication_photo_reviews

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| report_id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| status | TEXT | yes |  |  |
| note | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| reviewed_by | TEXT | yes |  |  |
| reviewed_at | TEXT | yes |  |  |

외래키: report_id → medication_photo_reports.id (DELETE CASCADE); patient_id → medication_photo_reports.patient_id (DELETE CASCADE)

```sql
CREATE TABLE medication_photo_reviews (
    report_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reviewed','needs_information')),
    note TEXT NOT NULL, version INTEGER NOT NULL, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL,
    FOREIGN KEY(report_id,patient_id) REFERENCES medication_photo_reports(id,patient_id) ON DELETE CASCADE
  )
```

## messages

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | INTEGER | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| sender_account_id | TEXT | yes |  |  |
| sender_role | TEXT | yes |  |  |
| body | TEXT | yes |  |  |
| client_message_id | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: sender_account_id → auth_accounts.id (DELETE NO ACTION); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    sender_account_id TEXT NOT NULL REFERENCES auth_accounts(id), sender_role TEXT NOT NULL CHECK(sender_role IN ('patient','clinician')),
    body TEXT NOT NULL, client_message_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(patient_id,sender_account_id,client_message_id)
  )
```

## metadata

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| key | TEXT | no |  | 1 |
| value | TEXT | yes |  |  |

```sql
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)
```

## notice_reads

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| notice_id | INTEGER | yes |  | 1 |
| account_id | TEXT | yes |  | 2 |
| last_read_version | INTEGER | yes |  |  |
| read_at | TEXT | yes |  |  |

외래키: account_id → auth_accounts.id (DELETE CASCADE); notice_id → notices.id (DELETE CASCADE)

```sql
CREATE TABLE notice_reads (
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    last_read_version INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(notice_id,account_id)
  )
```

## notice_revisions

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| notice_id | INTEGER | yes |  | 1 |
| version | INTEGER | yes |  | 2 |
| actor_id | TEXT | yes |  |  |
| snapshot | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: actor_id → auth_accounts.id (DELETE NO ACTION); notice_id → notices.id (DELETE CASCADE)

```sql
CREATE TABLE notice_revisions (
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    actor_id TEXT NOT NULL REFERENCES auth_accounts(id), snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(notice_id,version)
  )
```

## notice_submissions

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| actor_id | TEXT | yes |  | 1 |
| client_request_id | TEXT | yes |  | 2 |
| request_hash | TEXT | yes |  |  |
| notice_id | INTEGER | yes |  |  |
| result_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: notice_id → notices.id (DELETE CASCADE); actor_id → auth_accounts.id (DELETE CASCADE)

```sql
CREATE TABLE notice_submissions (
    actor_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(actor_id,client_request_id)
  )
```

## notices

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | INTEGER | no |  | 1 |
| title | TEXT | yes |  |  |
| body | TEXT | yes |  |  |
| status | TEXT | yes |  |  |
| pinned | INTEGER | yes | 0 |  |
| version | INTEGER | yes | 1 |  |
| created_by | TEXT | yes |  |  |
| updated_by | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |
| published_at | TEXT | no |  |  |

외래키: updated_by → auth_accounts.id (DELETE NO ACTION); created_by → auth_accounts.id (DELETE NO ACTION)

```sql
CREATE TABLE notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','published','archived')), pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES auth_accounts(id), updated_by TEXT NOT NULL REFERENCES auth_accounts(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT
  )
```

## oauth_attempts

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| state_hash | TEXT | no |  | 1 |
| browser_hash | TEXT | yes |  |  |
| return_path | TEXT | yes |  |  |
| expires_at | INTEGER | yes |  |  |

```sql
CREATE TABLE oauth_attempts (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, return_path TEXT NOT NULL, expires_at INTEGER NOT NULL
  )
```

## participation_events

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | INTEGER | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| actor_json | TEXT | yes |  |  |
| snapshot_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE participation_events (
    id INTEGER PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(patient_id,version)
  )
```

## patient_invitations

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| token_hash | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| created_by | TEXT | yes |  |  |
| expires_at | INTEGER | yes |  |  |
| consumed_at | TEXT | no |  |  |

외래키: created_by → auth_accounts.id (DELETE NO ACTION); patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE patient_invitations (
    token_hash TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES auth_accounts(id), expires_at INTEGER NOT NULL, consumed_at TEXT
  )
```

## patients

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| name | TEXT | yes |  |  |
| age | INTEGER | yes |  |  |
| sex | TEXT | yes |  |  |
| conditions | TEXT | yes | '[]' |  |
| medications | TEXT | yes | '[]' |  |
| caregiver | TEXT | yes | '' |  |
| created_at | TEXT | yes |  |  |
| demo | INTEGER | yes | 1 |  |

```sql
CREATE TABLE patients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, sex TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '[]', medications TEXT NOT NULL DEFAULT '[]',
      caregiver TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 1
    )
```

## photo_analyses

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| kind | TEXT | yes |  |  |
| image_hash | TEXT | yes |  |  |
| provider | TEXT | yes |  |  |
| model | TEXT | yes |  |  |
| proposal_json | TEXT | yes |  |  |
| warnings_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |
| expires_at | TEXT | yes |  |  |
| applied_at | TEXT | no |  |  |
| applied_meal_id | TEXT | no |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE photo_analyses (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('meal','medication')),
      image_hash TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      proposal_json TEXT NOT NULL, warnings_json TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      applied_at TEXT, applied_meal_id TEXT
    )
```

## record_corrections

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| source_revision | INTEGER | yes |  |  |
| source_snapshot_json | TEXT | yes |  |  |
| source_hash | TEXT | yes |  |  |
| patch_json | TEXT | yes |  |  |
| reason | TEXT | yes |  |  |
| status | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| proposed_by | TEXT | yes |  |  |
| proposed_at | TEXT | yes |  |  |
| reviewed_by | TEXT | no |  |  |
| reviewed_at | TEXT | no |  |  |
| review_reason | TEXT | no |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE record_corrections (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date TEXT NOT NULL, source_revision INTEGER NOT NULL, source_snapshot_json TEXT NOT NULL,
    source_hash TEXT NOT NULL, patch_json TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')), version INTEGER NOT NULL,
    proposed_by TEXT NOT NULL, proposed_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT
  )
```

## research_snapshots

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| client_request_id | TEXT | yes |  |  |
| created_by | TEXT | yes |  |  |
| request_hash | TEXT | yes |  |  |
| scope_json | TEXT | yes |  |  |
| recipe_json | TEXT | yes |  |  |
| data_json | TEXT | yes |  |  |
| content_hash | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |
| generation | TEXT | yes |  |  |

```sql
CREATE TABLE research_snapshots (
      id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL, created_by TEXT NOT NULL,
      request_hash TEXT NOT NULL, scope_json TEXT NOT NULL, recipe_json TEXT NOT NULL,
      data_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      generation TEXT NOT NULL, UNIQUE(created_by,client_request_id)
    )
```

## study_participation

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | no |  | 1 |
| study_id | TEXT | yes |  |  |
| status | TEXT | yes |  |  |
| start_date | TEXT | yes |  |  |
| end_date | TEXT | no |  |  |
| consent_version | TEXT | yes |  |  |
| required_domains | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| reason | TEXT | yes |  |  |
| updated_by | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE study_participation (
    patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE, study_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','paused','withdrawn','completed')),
    start_date TEXT NOT NULL, end_date TEXT, consent_version TEXT NOT NULL, required_domains TEXT NOT NULL,
    version INTEGER NOT NULL, reason TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  )
```

## voice_guidance_config

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| scope_key | TEXT | no |  | 1 |
| patient_id | TEXT | no |  |  |
| revision | INTEGER | yes |  |  |
| configuration_json | TEXT | no |  |  |
| updated_by | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE voice_guidance_config (
      scope_key TEXT PRIMARY KEY, patient_id TEXT UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, configuration_json TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK ((scope_key='global' AND patient_id IS NULL AND configuration_json IS NOT NULL) OR (patient_id IS NOT NULL AND scope_key='patient:'||patient_id))
    )
```

## voice_guidance_playbacks

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| claim_id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| rule_id | TEXT | yes |  |  |
| date | TEXT | yes |  |  |
| bucket | TEXT | yes |  |  |
| configuration_key | TEXT | yes |  |  |
| state | TEXT | yes |  |  |
| reserved_at | TEXT | yes |  |  |
| expires_at | TEXT | yes |  |  |
| started_at | TEXT | no |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE voice_guidance_playbacks (
      claim_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL, date TEXT NOT NULL, bucket TEXT NOT NULL,
      configuration_key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','started','released')),
      reserved_at TEXT NOT NULL, expires_at TEXT NOT NULL, started_at TEXT,
      UNIQUE(patient_id,rule_id,date,bucket)
    )
```

## voice_guidance_preferences

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| patient_id | TEXT | no |  | 1 |
| enabled | INTEGER | yes |  |  |
| updated_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE voice_guidance_preferences (
      patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL
    )
```

## voice_guidance_submissions

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| actor_id | TEXT | yes |  | 1 |
| scope_key | TEXT | yes |  | 2 |
| request_id | TEXT | yes |  | 3 |
| request_hash | TEXT | yes |  |  |
| response_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: scope_key → voice_guidance_config.scope_key (DELETE CASCADE)

```sql
CREATE TABLE voice_guidance_submissions (
      actor_id TEXT NOT NULL, scope_key TEXT NOT NULL REFERENCES voice_guidance_config(scope_key) ON DELETE CASCADE,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(actor_id,scope_key,request_id)
    )
```

## workflow_mutations

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| actor_id | TEXT | yes |  | 1 |
| client_request_id | TEXT | yes |  | 2 |
| operation | TEXT | yes |  |  |
| patient_id | TEXT | yes |  |  |
| request_hash | TEXT | yes |  |  |
| result_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE workflow_mutations (
    actor_id TEXT NOT NULL, client_request_id TEXT NOT NULL, operation TEXT NOT NULL,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id,client_request_id)
  )
```

## workflow_task_events

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | INTEGER | no |  | 1 |
| task_id | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| actor_json | TEXT | yes |  |  |
| snapshot_json | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |

외래키: task_id → workflow_tasks.id (DELETE CASCADE)

```sql
CREATE TABLE workflow_task_events (
    id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workflow_tasks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(task_id,version)
  )
```

## workflow_tasks

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| id | TEXT | no |  | 1 |
| patient_id | TEXT | yes |  |  |
| type | TEXT | yes |  |  |
| title | TEXT | yes |  |  |
| note | TEXT | yes |  |  |
| assignee | TEXT | yes | '' |  |
| due_date | TEXT | no |  |  |
| status | TEXT | yes |  |  |
| version | INTEGER | yes |  |  |
| created_by | TEXT | yes |  |  |
| updated_by | TEXT | yes |  |  |
| created_at | TEXT | yes |  |  |
| updated_at | TEXT | yes |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE workflow_tasks (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('contact','photo_review','data_quality','clinical_review')),
    title TEXT NOT NULL, note TEXT NOT NULL, assignee TEXT NOT NULL DEFAULT '', due_date TEXT,
    status TEXT NOT NULL CHECK(status IN ('new','in_progress','waiting','review_requested','completed')),
    version INTEGER NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )
```
