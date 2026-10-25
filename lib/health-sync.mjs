import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpError, objectBody, allowedKeys, textValue, numberValue, choice, dateValue } from './validation.mjs';

const platforms = ['health-connect', 'apple-health'];

export function healthCapabilities() {
  return { webDirectCollection: false, nativeBridge: { implemented: false, verified: false }, preferredPlatform: 'apple-health', partialMetrics: true,
    platforms: { 'apple-health': { implemented: true, verified: false, installationRequired: true }, 'health-connect': { implemented: true, verified: false, installationRequired: true } } };
}

function atomic(db, operation) {
  db.exec('SAVEPOINT health_sync_operation');
  try {
    const result = operation();
    db.exec('RELEASE SAVEPOINT health_sync_operation');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT health_sync_operation');
    db.exec('RELEASE SAVEPOINT health_sync_operation');
    throw error;
  }
}

export function ensureHealthSchema(db) {
  atomic(db, () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS health_connections (
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
    );
    CREATE UNIQUE INDEX IF NOT EXISTS health_one_selected_connection
      ON health_connections(patient_id) WHERE selected=1 AND revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS health_connection_issuances (
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(patient_id,client_request_id),
      FOREIGN KEY(connection_id,patient_id) REFERENCES health_connections(id,patient_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS health_daily (
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
    );
    CREATE INDEX IF NOT EXISTS health_daily_patient_date ON health_daily(patient_id,date);
    CREATE TABLE IF NOT EXISTS health_batches (
      connection_id TEXT NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      received_at TEXT NOT NULL,
      accepted_days INTEGER NOT NULL,
      ignored_days INTEGER NOT NULL,
      PRIMARY KEY(connection_id,batch_id),
      FOREIGN KEY(connection_id,patient_id) REFERENCES health_connections(id,patient_id) ON DELETE CASCADE
    );
    `);
    const columns = new Set(db.prepare('PRAGMA table_info(health_daily)').all().map(column => column.name));
    // Backfill only when adding a column. A partial snapshot's null timestamp must stay null on restart.
    for (const column of ['steps_updated_at', 'sleep_updated_at']) {
      if (!columns.has(column)) {
        db.exec(`ALTER TABLE health_daily ADD COLUMN ${column} TEXT`);
        db.exec(`UPDATE health_daily SET ${column}=updated_at`);
      }
    }
  });
}

function assertPatient(db, patientId) {
  if (!db.prepare('SELECT 1 FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
}

function publicConnection(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    platform: row.platform,
    label: row.label,
    status: row.revoked_at ? 'revoked' : row.last_received_at ? 'connected' : 'awaiting_native',
    selected: Boolean(row.selected) && !row.revoked_at,
    createdAt: row.created_at,
    lastReceivedAt: row.last_received_at,
    revokedAt: row.revoked_at,
  };
}

export function getHealthConnections(db, patientId) {
  assertPatient(db, patientId);
  const connections = db.prepare('SELECT * FROM health_connections WHERE patient_id=? ORDER BY created_at DESC,id').all(patientId).map(publicConnection);
  return {
    connections,
    selectedConnectionId: connections.find(connection => connection.selected)?.id ?? null,
    webDirectCollection: false,
    nativeBridge: { implemented: false, verified: false },
  };
}

export function createHealthConnection(db, patientId, input) {
  assertPatient(db, patientId);
  const body = objectBody(input);
  allowedKeys(body, ['platform', 'label', 'clientRequestId', 'replacesConnectionId']);
  const platform = choice(body.platform, '건강 플랫폼', platforms);
  const label = body.label === undefined ? (platform === 'health-connect' ? 'Android Health Connect' : 'Apple Health') : textValue(body.label, '연결 이름', { min: 1, max: 80 });
  const clientRequestId = body.clientRequestId === undefined ? null : connectionRequestUuid(body.clientRequestId, '발급 요청');
  const replacesConnectionId = body.replacesConnectionId === undefined ? null : connectionRequestUuid(body.replacesConnectionId, '교체 연결');
  if (replacesConnectionId && !clientRequestId) throw new HttpError(400, '새 코드를 받으려면 발급 요청 ID가 필요합니다.');
  const bodyHash = createHash('sha256').update(JSON.stringify({ platform, label, replacesConnectionId })).digest('hex');
  return atomic(db, () => {
    const previous = clientRequestId && db.prepare('SELECT * FROM health_connection_issuances WHERE patient_id=? AND client_request_id=?').get(patientId, clientRequestId);
    if (previous) {
      if (previous.body_hash !== bodyHash) throw new HttpError(409, '같은 발급 요청에 다른 연결 정보를 사용할 수 없습니다. 입력 내용을 확인해 주세요.');
      const connection = db.prepare('SELECT * FROM health_connections WHERE id=? AND patient_id=?').get(previous.connection_id, patientId);
      // Replay never changes selection or revocation and cannot recover a hash-only secret.
      return { connection: publicConnection(connection), token: null, duplicate: true, codeUnavailable: true };
    }
    let selected = 1;
    const createdAt = new Date().toISOString();
    if (replacesConnectionId) {
      const original = db.prepare('SELECT * FROM health_connections WHERE id=? AND patient_id=?').get(replacesConnectionId, patientId);
      if (!original) throw new HttpError(404, '교체할 건강 연결을 찾을 수 없습니다.');
      if (original.revoked_at) throw new HttpError(409, '이미 해제되거나 교체된 연결입니다. 연결 목록을 다시 확인해 주세요.');
      selected = original.selected;
      db.prepare('UPDATE health_connections SET selected=0,revoked_at=? WHERE id=? AND patient_id=?').run(createdAt, replacesConnectionId, patientId);
    } else {
      db.prepare('UPDATE health_connections SET selected=0 WHERE patient_id=? AND selected=1').run(patientId);
    }
    // The 256-bit secret is returned only here. Neither plaintext nor a reversible form is stored.
    const token = `hc_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const id = randomUUID();
    db.prepare(`INSERT INTO health_connections (id,patient_id,platform,label,token_hash,selected,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, patientId, platform, label, tokenHash, selected, createdAt);
    if (clientRequestId) db.prepare(`INSERT INTO health_connection_issuances (patient_id,client_request_id,body_hash,connection_id,created_at)
      VALUES (?,?,?,?,?)`).run(patientId, clientRequestId, bodyHash, id, createdAt);
    return { connection: publicConnection(db.prepare('SELECT * FROM health_connections WHERE id=?').get(id)), token, duplicate: false, codeUnavailable: false };
  });
}

function connectionRequestUuid(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, `${name} ID를 확인해 주세요.`);
  return value.toLowerCase();
}

export function revokeHealthConnection(db, patientId, connectionId) {
  assertPatient(db, patientId);
  return atomic(db, () => {
    const row = db.prepare('SELECT * FROM health_connections WHERE id=? AND patient_id=?').get(connectionId, patientId);
    if (!row) throw new HttpError(404, '건강 연결을 찾을 수 없습니다.');
    if (!row.revoked_at) db.prepare('UPDATE health_connections SET selected=0,revoked_at=? WHERE id=? AND patient_id=?').run(new Date().toISOString(), connectionId, patientId);
    return { connection: publicConnection(db.prepare('SELECT * FROM health_connections WHERE id=? AND patient_id=?').get(connectionId, patientId)) };
  });
}

function todayKorea() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function revisionValue(value, now) {
  // Keep nanoseconds so Android Instant revisions are not collapsed to JS milliseconds.
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new HttpError(400, 'updatedAt은 시간대를 포함한 유효한 ISO8601 시각이어야 합니다.');
  dateValue(match[1]);
  if (match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4)) > 59)) throw new HttpError(400, 'updatedAt의 시간대를 확인해 주세요.');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new HttpError(400, 'updatedAt은 미래가 아닌 유효한 시각이어야 합니다.');
  const fraction = (match[5] ?? '').padEnd(9, '0');
  const normalized = `${new Date(milliseconds).toISOString().slice(0, 19)}.${fraction}Z`;
  const nowIso = new Date(now).toISOString().replace(/Z$/, '000000Z');
  if (normalized > nowIso) throw new HttpError(400, 'updatedAt은 미래가 아닌 유효한 시각이어야 합니다.');
  return normalized;
}

function batchValue(input) {
  const body = objectBody(input);
  allowedKeys(body, ['batchId', 'timeZone', 'days']);
  const batchId = textValue(body.batchId, '배치 ID', { min: 1, max: 128 });
  choice(body.timeZone, '시간대', ['Asia/Seoul']);
  if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > 31) throw new HttpError(400, '일별 집계는 1~31일을 입력해 주세요.');
  const now = Date.now();
  const today = todayKorea();
  const dates = new Set();
  const days = body.days.map(inputDay => {
    const day = objectBody(inputDay);
    allowedKeys(day, ['date', 'steps', 'sleepMinutes', 'updatedAt']);
    const date = dateValue(day.date);
    if (date > today) throw new HttpError(400, '미래 날짜의 건강 자료는 받을 수 없습니다.');
    if (dates.has(date)) throw new HttpError(400, '같은 날짜의 집계는 배치당 한 번만 입력해 주세요.');
    dates.add(date);
    if (!Object.hasOwn(day, 'steps') && !Object.hasOwn(day, 'sleepMinutes')) throw new HttpError(400, '걸음 수 또는 수면 중 하나 이상의 항목이 필요합니다.');
    // Preserve the original full-snapshot property order and hash for old pending batches.
    const normalized = { date };
    if (Object.hasOwn(day, 'steps')) normalized.steps = day.steps === null ? null : numberValue(day.steps, '걸음 수', 0, 100000, true);
    if (Object.hasOwn(day, 'sleepMinutes')) normalized.sleepMinutes = day.sleepMinutes === null ? null : numberValue(day.sleepMinutes, '수면 시간(분)', 0, 1440);
    normalized.updatedAt = revisionValue(day.updatedAt, now);
    return normalized;
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { batchId, timeZone: 'Asia/Seoul', days };
}

function healthConnectionForToken(db, bearerToken) {
  if (typeof bearerToken !== 'string' || !/^hc_[A-Za-z0-9_-]{43}$/.test(bearerToken)) throw new HttpError(401, '유효한 건강 연결 토큰이 필요합니다.');
  const tokenHash = createHash('sha256').update(bearerToken).digest('hex');
  const connection = db.prepare('SELECT * FROM health_connections WHERE token_hash=? AND revoked_at IS NULL').get(tokenHash);
  if (!connection) throw new HttpError(401, '건강 연결이 없거나 폐기되었습니다.');
  return connection;
}

export function getHealthConnectionIdentity(db, bearerToken) {
  const connection = healthConnectionForToken(db, bearerToken);
  return { connectionId: connection.id, patientId: connection.patient_id, platform: connection.platform, partialMetrics: true, selected: Boolean(connection.selected), serverTime: new Date().toISOString() };
}

export function receiveHealthBatch(db, bearerToken, input) {
  return atomic(db, () => {
    const connection = healthConnectionForToken(db, bearerToken);
    const batch = batchValue(input);
    const bodyHash = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
    const previous = db.prepare('SELECT * FROM health_batches WHERE connection_id=? AND batch_id=?').get(connection.id, batch.batchId);
    const identity = { connectionId: connection.id, patientId: connection.patient_id, batchId: batch.batchId };
    if (previous) {
      if (previous.body_hash !== bodyHash) throw new HttpError(409, '같은 배치 ID에 다른 자료를 사용할 수 없습니다. 새 배치 ID로 전송해 주세요.');
      return { ...identity, duplicate: true, acceptedDays: 0, ignoredDays: batch.days.length, receivedAt: previous.received_at };
    }
    const receivedAt = new Date().toISOString();
    let acceptedDays = 0;
    const findDay = db.prepare('SELECT * FROM health_daily WHERE connection_id=? AND date=?');
    const saveDay = db.prepare(`INSERT INTO health_daily (connection_id,patient_id,date,steps,sleep_minutes,steps_updated_at,sleep_updated_at,updated_at,received_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,date) DO UPDATE SET
      steps=excluded.steps,sleep_minutes=excluded.sleep_minutes,steps_updated_at=excluded.steps_updated_at,
      sleep_updated_at=excluded.sleep_updated_at,updated_at=excluded.updated_at,received_at=excluded.received_at`);
    for (const day of batch.days) {
      const existing = findDay.get(connection.id, day.date);
      const updateSteps = Object.hasOwn(day, 'steps') && (!existing?.steps_updated_at || day.updatedAt > existing.steps_updated_at);
      const updateSleep = Object.hasOwn(day, 'sleepMinutes') && (!existing?.sleep_updated_at || day.updatedAt > existing.sleep_updated_at);
      if (!updateSteps && !updateSleep) continue;
      const stepsAt = updateSteps ? day.updatedAt : existing?.steps_updated_at ?? null;
      const sleepAt = updateSleep ? day.updatedAt : existing?.sleep_updated_at ?? null;
      const updatedAt = [stepsAt, sleepAt].filter(Boolean).sort().at(-1);
      saveDay.run(connection.id, connection.patient_id, day.date,
        updateSteps ? day.steps : existing?.steps ?? null,
        updateSleep ? day.sleepMinutes : existing?.sleep_minutes ?? null,
        stepsAt, sleepAt, updatedAt, receivedAt);
      acceptedDays++;
    }
    const ignoredDays = batch.days.length - acceptedDays;
    db.prepare(`INSERT INTO health_batches (connection_id,patient_id,batch_id,body_hash,received_at,accepted_days,ignored_days)
      VALUES (?,?,?,?,?,?,?)`).run(connection.id, connection.patient_id, batch.batchId, bodyHash, receivedAt, acceptedDays, ignoredDays);
    db.prepare('UPDATE health_connections SET last_received_at=? WHERE id=?').run(receivedAt, connection.id);
    return { ...identity, duplicate: false, acceptedDays, ignoredDays, receivedAt };
  });
}

export function healthDailyForPatient(db, patientId, startDate, endDate) {
  assertPatient(db, patientId);
  const start = dateValue(startDate);
  const end = dateValue(endDate);
  if (start > end) throw new HttpError(400, '조회 시작일은 종료일보다 늦을 수 없습니다.');
  return db.prepare(`SELECT d.*,c.platform FROM health_daily d JOIN health_connections c
    ON c.id=d.connection_id AND c.patient_id=d.patient_id
    WHERE d.patient_id=? AND d.date BETWEEN ? AND ? AND c.selected=1 AND c.revoked_at IS NULL
    ORDER BY d.date`).all(patientId, start, end).map(row => ({
      date: row.date,
      steps: row.steps,
      sleepMinutes: row.sleep_minutes,
      sleepHours: row.sleep_minutes === null ? null : row.sleep_minutes / 60,
      updatedAt: row.updated_at,
      stepsUpdatedAt: row.steps_updated_at,
      sleepUpdatedAt: row.sleep_updated_at,
      receivedAt: row.received_at,
      connectionId: row.connection_id,
      platform: row.platform,
      source: row.platform,
    }));
}
