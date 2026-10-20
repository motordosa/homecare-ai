import { HttpError, allowedKeys, objectBody, textValue, choice, numberValue } from './validation.mjs';

export function ensureCommunicationSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','published','archived')), pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES auth_accounts(id), updated_by TEXT NOT NULL REFERENCES auth_accounts(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT
  );
  CREATE TABLE IF NOT EXISTS notice_revisions (
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    actor_id TEXT NOT NULL REFERENCES auth_accounts(id), snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(notice_id,version)
  );
  CREATE TABLE IF NOT EXISTS notice_reads (
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    last_read_version INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(notice_id,account_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    sender_account_id TEXT NOT NULL REFERENCES auth_accounts(id), sender_role TEXT NOT NULL CHECK(sender_role IN ('patient','clinician')),
    body TEXT NOT NULL, client_message_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(patient_id,sender_account_id,client_message_id)
  );
  CREATE INDEX IF NOT EXISTS messages_patient_sequence ON messages(patient_id,id);
  CREATE TABLE IF NOT EXISTS conversation_reads (
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    reader_role TEXT NOT NULL CHECK(reader_role IN ('patient','clinician')), through_id INTEGER NOT NULL, read_at TEXT NOT NULL,
    PRIMARY KEY(patient_id,account_id)
  );`);
}
const atomic = (db, operation) => {
  db.exec('SAVEPOINT communication_operation');
  try { const result = operation(); db.exec('RELEASE communication_operation'); return result; }
  catch (error) { db.exec('ROLLBACK TO communication_operation; RELEASE communication_operation'); throw error; }
};
const staff = actor => { if (actor?.role !== 'clinician') throw new HttpError(403, '의료진 권한이 필요합니다.'); };
function participant(db, actor, patientId) {
  if (!actor || !['patient','clinician'].includes(actor.role)) throw new HttpError(403, '환자 연결 또는 의료진 권한이 필요합니다.');
  if (actor.role !== 'clinician' && actor.patientId !== patientId) throw new HttpError(403, '본인의 대화만 확인할 수 있습니다.');
  if (!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
}
function noticeRow(row) {
  return row ? { id: row.id, title: row.title, body: row.body, status: row.status, pinned: Boolean(row.pinned), version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at, read: row.last_read_version >= row.version } : null;
}
function noticeValues(input, editing) {
  const body = objectBody(input); allowedKeys(body, editing ? ['title','body','status','pinned','version'] : ['title','body','status','pinned']);
  if (typeof body.pinned !== 'boolean') throw new HttpError(400, '중요 공지 여부를 선택해 주세요.');
  return { title: textValue(body.title, '공지 제목', { min: 1, max: 120 }), body: textValue(body.body, '공지 내용', { min: 1, max: 5000 }),
    status: choice(body.status, '공지 상태', ['draft','published','archived']), pinned: body.pinned ? 1 : 0,
    ...(editing ? { version: numberValue(body.version, '공지 버전', 1, Number.MAX_SAFE_INTEGER, true) } : {}) };
}
function saveRevision(db, id, actorId) {
  const notice = noticeRow(db.prepare('SELECT * FROM notices WHERE id=?').get(id));
  db.prepare('INSERT INTO notice_revisions(notice_id,version,actor_id,snapshot,created_at) VALUES (?,?,?,?,?)')
    .run(id, notice.version, actorId, JSON.stringify(notice), notice.updatedAt);
  return notice;
}
export function listNotices(db, actor) {
  staff(actor);
  return { notices: db.prepare('SELECT * FROM notices ORDER BY updated_at DESC,id DESC LIMIT 100').all().map(noticeRow), limit: 100 };
}
export function createNotice(db, actor, input) {
  staff(actor); const value = noticeValues(input, false), now = new Date().toISOString();
  return atomic(db, () => {
    const result = db.prepare('INSERT INTO notices(title,body,status,pinned,created_by,updated_by,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(value.title, value.body, value.status, value.pinned, actor.accountId, actor.accountId, now, now, value.status === 'published' ? now : null);
    return { notice: saveRevision(db, Number(result.lastInsertRowid), actor.accountId) };
  });
}
export function updateNotice(db, actor, id, input) {
  staff(actor); numberValue(id, '공지 ID', 1, Number.MAX_SAFE_INTEGER, true); const value = noticeValues(input, true), now = new Date().toISOString();
  return atomic(db, () => {
    const old = db.prepare('SELECT * FROM notices WHERE id=?').get(id);
    if (!old) throw new HttpError(404, '공지를 찾을 수 없습니다.');
    if (old.version !== value.version) throw new HttpError(409, '다른 화면에서 공지가 수정되었습니다. 최신 내용을 다시 불러와 주세요.');
    db.prepare('UPDATE notices SET title=?,body=?,status=?,pinned=?,version=version+1,updated_by=?,updated_at=?,published_at=? WHERE id=?')
      .run(value.title, value.body, value.status, value.pinned, actor.accountId, now, value.status === 'published' && old.status !== 'published' ? now : old.published_at, id);
    return { notice: saveRevision(db, id, actor.accountId) };
  });
}
export function activeNotices(db, actor) {
  if (!actor || !['patient','clinician'].includes(actor.role)) throw new HttpError(403, '로그인과 환자 연결이 필요합니다.');
  return { notices: db.prepare(`SELECT n.*,r.last_read_version FROM notices n LEFT JOIN notice_reads r ON r.notice_id=n.id AND r.account_id=?
    WHERE n.status='published' ORDER BY n.pinned DESC,n.published_at DESC,n.id DESC LIMIT 10`).all(actor.accountId).map(noticeRow), limit: 10 };
}
export function readNotice(db, actor, id, input) {
  if(!actor || !['patient','clinician'].includes(actor.role))throw new HttpError(403,'로그인이 필요합니다.');
  numberValue(id, '공지 ID', 1, Number.MAX_SAFE_INTEGER, true);
  const body = objectBody(input); allowedKeys(body, ['version']);
  const version = numberValue(body.version, '확인 버전', 1, Number.MAX_SAFE_INTEGER, true);
  const row = db.prepare("SELECT * FROM notices WHERE id=? AND status='published'").get(id);
  if (!row) throw new HttpError(404, '게시된 공지를 찾을 수 없습니다.');
  if (row.version !== version) throw new HttpError(409, '공지가 수정되었습니다. 새 내용을 확인해 주세요.');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO notice_reads(notice_id,account_id,last_read_version,read_at) VALUES (?,?,?,?)
    ON CONFLICT(notice_id,account_id) DO UPDATE SET last_read_version=MAX(notice_reads.last_read_version,excluded.last_read_version),read_at=excluded.read_at`)
    .run(id, actor.accountId, version, now);
  return { noticeId: id, version, read: true };
}
function messageRow(row) {
  return { id: row.id, patientId: row.patient_id, senderRole: row.sender_role, body: row.body, createdAt: row.created_at,
    clientMessageId: row.client_message_id, readByOther: Boolean(row.read_by_other) };
}
export function listMessages(db, actor, patientId, query = {}) {
  participant(db, actor, patientId);
  if (query.before && query.after) throw new HttpError(400, '이전/이후 조회 중 하나만 선택해 주세요.');
  const limit = query.limit === undefined ? 50 : numberValue(Number(query.limit), '메시지 수', 1, 100, true);
  const cursor = query.before || query.after;
  if (cursor && (!/^\d+$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) <= 0)) throw new HttpError(400, '메시지 순번을 확인해 주세요.');
  const operator = query.after ? '>' : '<', order = query.after ? 'ASC' : 'DESC';
  const rows = db.prepare(`SELECT m.*,EXISTS(SELECT 1 FROM conversation_reads r WHERE r.patient_id=m.patient_id AND r.reader_role<>m.sender_role AND r.through_id>=m.id) AS read_by_other
    FROM messages m WHERE m.patient_id=? ${cursor ? `AND m.id ${operator} ?` : ''} ORDER BY m.id ${order} LIMIT ?`)
    .all(patientId, ...(cursor ? [Number(cursor)] : []), limit + 1);
  const hasMore = rows.length > limit, result = rows.slice(0, limit).sort((a,b) => a.id - b.id).map(messageRow);
  const unread = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE patient_id=? AND sender_role<>? AND id>COALESCE((SELECT through_id FROM conversation_reads WHERE patient_id=? AND account_id=?),0)`).get(patientId,actor.role,patientId,actor.accountId).n;
  const otherReadThrough = db.prepare('SELECT COALESCE(MAX(through_id),0) AS n FROM conversation_reads WHERE patient_id=? AND reader_role<>?').get(patientId,actor.role).n;
  return { patientId, unread, otherReadThrough, messages: result, hasMore, nextBefore: result[0]?.id ?? null, nextAfter: result.at(-1)?.id ?? null };
}
export function sendMessage(db, actor, patientId, input) {
  participant(db, actor, patientId);
  const body = objectBody(input); allowedKeys(body, ['body','clientMessageId']);
  const text = textValue(body.body, '메시지', { min: 1, max: 2000 });
  if (typeof body.clientMessageId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientMessageId)) throw new HttpError(400, '메시지 전송 식별자를 확인해 주세요.');
  return atomic(db, () => {
    const old = db.prepare('SELECT * FROM messages WHERE patient_id=? AND sender_account_id=? AND client_message_id=?').get(patientId, actor.accountId, body.clientMessageId);
    if (old) {
      if (old.body !== text) throw new HttpError(409, '같은 전송 식별자의 내용이 다릅니다. 새 메시지로 전송해 주세요.');
      return { message: messageRow(old), duplicate: true };
    }
    const result = db.prepare('INSERT INTO messages(patient_id,sender_account_id,sender_role,body,client_message_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(patientId, actor.accountId, actor.role, text, body.clientMessageId, new Date().toISOString());
    return { message: messageRow(db.prepare('SELECT * FROM messages WHERE id=?').get(Number(result.lastInsertRowid))), duplicate: false };
  });
}
export function readMessages(db, actor, patientId, input) {
  participant(db, actor, patientId);
  const body = objectBody(input); allowedKeys(body, ['throughId']);
  const throughId = numberValue(body.throughId, '읽음 순번', 1, Number.MAX_SAFE_INTEGER, true);
  if (!db.prepare('SELECT id FROM messages WHERE patient_id=? AND id=?').get(patientId, throughId)) throw new HttpError(400, '대화에 표시된 메시지 순번을 확인해 주세요.');
  db.prepare(`INSERT INTO conversation_reads(patient_id,account_id,reader_role,through_id,read_at) VALUES (?,?,?,?,?)
    ON CONFLICT(patient_id,account_id) DO UPDATE SET reader_role=excluded.reader_role,through_id=MAX(conversation_reads.through_id,excluded.through_id),read_at=excluded.read_at`)
    .run(patientId, actor.accountId, actor.role, throughId, new Date().toISOString());
  return { patientId, throughId: db.prepare('SELECT through_id FROM conversation_reads WHERE patient_id=? AND account_id=?').get(patientId, actor.accountId).through_id };
}
export function conversations(db, actor) {
  staff(actor);
  return { conversations: db.prepare(`SELECT p.id AS patient_id,p.name,p.age,
    (SELECT MAX(m.id) FROM messages m WHERE m.patient_id=p.id) AS last_id,
    (SELECT m.body FROM messages m WHERE m.patient_id=p.id ORDER BY m.id DESC LIMIT 1) AS preview,
    (SELECT m.created_at FROM messages m WHERE m.patient_id=p.id ORDER BY m.id DESC LIMIT 1) AS last_at,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_role='patient' AND m.id>COALESCE((SELECT r.through_id FROM conversation_reads r WHERE r.patient_id=p.id AND r.account_id=?),0)) AS unread
    FROM patients p ORDER BY last_id DESC,p.name,p.id`).all(actor.accountId).map(row => ({ patientId: row.patient_id, name: row.name, age: row.age, lastMessageId: row.last_id,
      preview: row.preview?.slice(0,80) ?? '', lastMessageAt: row.last_at, unread: row.unread })) };
}
