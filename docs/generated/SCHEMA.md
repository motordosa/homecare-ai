# DB 스키마 기준

자동 생성: 임시 SQLite에 현재 추가 마이그레이션을 적용한 결과다. 사용자/공개 DB에 접근하지 않으며 행 값·토큰·사진을 저장하지 않는다. 의미와 단위는 [자료 사전](../DATA_DICTIONARY.md)과 [계약](../CONTRACTS.md)을 함께 읽는다.

11 tables. 생성: `npm run docs:variables`, 최신 검사: `npm run docs:check`.

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

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE daily_records (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL, steps INTEGER, sleep_hours REAL, medication_status TEXT,
      appetite TEXT, mood TEXT, note TEXT NOT NULL DEFAULT '', weight_kg REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(patient_id,date)
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
      updated_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY(connection_id,date),
      FOREIGN KEY(connection_id,patient_id) REFERENCES health_connections(id,patient_id) ON DELETE CASCADE
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
| portion | REAL | yes |  |  |
| calories | REAL | yes |  |  |
| protein_grams | REAL | yes |  |  |
| image_filename | TEXT | no |  |  |
| source | TEXT | yes | 'demo-food-table-v1' |  |
| created_at | TEXT | yes |  |  |
| analysis_id | TEXT | no |  |  |
| food_label | TEXT | no |  |  |
| estimation_json | TEXT | no |  |  |

외래키: patient_id → patients.id (DELETE CASCADE)

```sql
CREATE TABLE meals (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL, meal_type TEXT NOT NULL, food_type TEXT NOT NULL, portion REAL NOT NULL,
      calories REAL NOT NULL, protein_grams REAL NOT NULL, image_filename TEXT,
      source TEXT NOT NULL DEFAULT 'demo-food-table-v1', created_at TEXT NOT NULL
    , analysis_id TEXT, food_label TEXT, estimation_json TEXT)
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

## metadata

| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |
|---|---|---|---|---|
| key | TEXT | no |  | 1 |
| value | TEXT | yes |  |  |

```sql
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)
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
