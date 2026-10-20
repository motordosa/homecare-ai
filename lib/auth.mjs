import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError, objectBody, allowedKeys, choice, textValue } from './validation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_MS = 10 * 60 * 1000;

export function ensureAuthSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_accounts (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('kakao','demo')),
    provider_user_id TEXT NOT NULL, demo_role TEXT CHECK(demo_role IN ('patient','clinician')),
    patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, UNIQUE(provider,provider_user_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS kakao_patient_account ON auth_accounts(patient_id) WHERE provider='kakao' AND patient_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_attempts (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, return_path TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS patient_invitations (
    token_hash TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES auth_accounts(id), expires_at INTEGER NOT NULL, consumed_at TEXT
  );`);
}

function configuration(env) {
  const mode = env.AUTH_MODE ?? (env.NODE_ENV === 'production' ? 'kakao' : 'demo');
  let origin = null;
  try {
    const url = new URL(env.APP_ORIGIN || '');
    if (!url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
        (url.protocol === 'https:' || (env.NODE_ENV === 'test' && url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) origin = url.origin;
  } catch { /* Missing origin deliberately leaves real OAuth unavailable. */ }
  const clientId = (env.KAKAO_CLIENT_ID || '').trim();
  const clientSecret = (env.KAKAO_CLIENT_SECRET || '').trim();
  const configured = Boolean(origin && /^[A-Za-z0-9_-]{1,100}$/.test(clientId) && clientSecret.length > 0 && clientSecret.length <= 500);
  const validMode = ['demo','kakao'].includes(mode);
  return { mode: mode === 'demo' ? 'demo' : 'kakao', configured: validMode && configured, origin, clientId, clientSecret,
    secure: origin?.startsWith('https:') === true,
    staffIds: new Set((env.CLINICIAN_KAKAO_IDS || '').split(',').map(x => x.trim()).filter(x => /^\d{1,30}$/.test(x))) };
}

function cookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('='); if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key && !Object.hasOwn(result, key)) result[key] = part.slice(index + 1).trim();
  }
  return result;
}

export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const url = new URL(value, 'https://homecare.invalid');
    if (url.origin !== 'https://homecare.invalid' || !['/patient','/clinician','/account'].includes(url.pathname)) return null;
    const allowed = new Set(['view','patientId','metric','section','medicationDate']);
    for (const key of [...url.searchParams.keys()]) if (!allowed.has(key)) url.searchParams.delete(key);
    return url.pathname + url.search;
  } catch { return null; }
}

export function createAuthService({ db, env = process.env, fetchImpl = fetch, now = Date.now }) {
  ensureAuthSchema(db);
  const sessionName = () => configuration(env).secure ? '__Host-hc_session' : 'hc_session';
  const loginName = () => configuration(env).secure ? '__Host-hc_login' : 'hc_login';
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${configuration(env).secure ? '; Secure' : ''}`;
  const transaction = operation => {
    db.exec('SAVEPOINT auth_operation');
    try { const result = operation(); db.exec('RELEASE auth_operation'); return result; }
    catch (error) { db.exec('ROLLBACK TO auth_operation; RELEASE auth_operation'); throw error; }
  };
  function capabilities() {
    const cfg = configuration(env);
    return { mode: cfg.mode, provider: 'kakao', kakaoAvailable: cfg.mode === 'kakao' && cfg.configured, staffConfigured: cfg.staffIds.size > 0,
      reason: cfg.mode === 'demo' ? '합성자료 데모 체험 모드입니다.' : cfg.configured ? null : '카카오 앱 키와 서버 주소 설정이 필요합니다.' };
  }
  function actor(req) {
    const token = cookies(req)[sessionName()];
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return null;
    const cfg = configuration(env);
    if (cfg.mode === 'kakao' && !cfg.configured) return null;
    const row = db.prepare(`SELECT a.*,s.token_hash,s.csrf_token,s.expires_at FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_hash=?`).get(hash(token));
    if (!row || row.expires_at <= now() || row.provider !== cfg.mode) return null;
    const role = row.provider === 'demo' ? row.demo_role : cfg.staffIds.has(row.provider_user_id) ? 'clinician' : row.patient_id ? 'patient' : 'pending';
    return { accountId: row.id, provider: row.provider, providerId: row.provider_user_id, role, patientId: row.patient_id,
      sessionHash: row.token_hash, csrf: row.csrf_token };
  }
  function publicActor(value) {
    return value ? { id: value.accountId, role: value.role, patientId: value.patientId,
      kakaoId: value.provider === 'kakao' ? value.providerId : null, displayName: value.role === 'clinician' ? '의료진' : value.role === 'patient' ? '환자' : '환자 연결 대기' } : null;
  }
  function sessionInfo(req) {
    const value = actor(req);
    return { ...capabilities(), user: publicActor(value), csrfToken: value?.csrf ?? null };
  }
  function requireActor(req, { write = false, allowPending = false } = {}) {
    const value = actor(req);
    if (!value) throw new HttpError(401, '로그인이 필요합니다.');
    if (!allowPending && value.role === 'pending') throw new HttpError(403, '의료진의 초대코드로 환자를 먼저 연결해 주세요.');
    if (write && !equal(req.headers['x-csrf-token'], value.csrf)) throw new HttpError(403, '요청 확인 정보가 만료되었습니다. 화면을 새로 열어 주세요.');
    return value;
  }
  function authorize(req, { staff = false, patientId = null, write = false, communication = false } = {}) {
    if (configuration(env).mode === 'demo' && !communication) return actor(req);
    const value = requireActor(req, { write });
    if (staff && value.role !== 'clinician') throw new HttpError(403, '의료진 권한이 필요합니다.');
    if (patientId && value.role !== 'clinician' && value.patientId !== patientId) throw new HttpError(403, '본인의 환자 자료만 확인할 수 있습니다.');
    return value;
  }
  function newSession(req, accountId) {
    const old = actor(req); if (old) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(old.sessionHash);
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now());
    const token = secret(), csrf = secret();
    db.prepare('INSERT INTO auth_sessions(token_hash,account_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run(hash(token), accountId, csrf, now() + SESSION_MS, new Date(now()).toISOString());
    return { cookie: cookie(sessionName(), token, SESSION_MS / 1000) };
  }
  function demoLogin(req, input) {
    if (configuration(env).mode !== 'demo') throw new HttpError(403, '실제 로그인 모드에서 데모 계정을 만들 수 없습니다.');
    if (req.headers['x-homecare-demo'] !== '1') throw new HttpError(403, '데모 체험 요청을 확인해 주세요.');
    const body = objectBody(input); allowedKeys(body, ['role','patientId']);
    const role = choice(body.role, '데모 역할', ['patient','clinician']);
    let patientId = null;
    if (role === 'patient') {
      const selected = body.patientId ? db.prepare('SELECT id FROM patients WHERE id=?').get(body.patientId) : db.prepare('SELECT id FROM patients ORDER BY name,id LIMIT 1').get();
      if (body.patientId && !selected) throw new HttpError(404, '환자를 찾을 수 없습니다.');
      patientId = selected?.id ?? null;
    }
    const identity = role === 'clinician' ? 'clinician' : `patient:${patientId ?? 'empty'}`;
    let account = db.prepare("SELECT id FROM auth_accounts WHERE provider='demo' AND provider_user_id=?").get(identity);
    if (!account) {
      account = { id: randomUUID() };
      db.prepare("INSERT INTO auth_accounts(id,provider,provider_user_id,demo_role,patient_id,created_at) VALUES (?,'demo',?,?,?,?)").run(account.id, identity, role, patientId, new Date(now()).toISOString());
    } else db.prepare('UPDATE auth_accounts SET patient_id=? WHERE id=?').run(patientId, account.id);
    return newSession(req, account.id);
  }
  function startOAuth(req, next) {
    const cfg = configuration(env);
    if (cfg.mode !== 'kakao' || !cfg.configured) throw new HttpError(503, '카카오 로그인 설정이 필요합니다.');
    db.prepare('DELETE FROM oauth_attempts WHERE expires_at<=?').run(now());
    const state = secret(), browser = secret();
    db.prepare('INSERT INTO oauth_attempts(state_hash,browser_hash,return_path,expires_at) VALUES (?,?,?,?)')
      .run(hash(state), hash(browser), safeReturnPath(next) || '/account', now() + LOGIN_MS);
    const url = new URL('https://kauth.kakao.com/oauth/authorize');
    url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: `${cfg.origin}/auth/kakao/callback`, response_type: 'code', state }).toString();
    return { location: url.href, cookie: cookie(loginName(), browser, LOGIN_MS / 1000) };
  }
  async function providerRequest(url, options) {
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 65536) throw new Error('provider');
      const text = await response.text(); if (Buffer.byteLength(text) > 65536) throw new Error('size');
      return JSON.parse(text);
    } catch { throw new HttpError(502, '카카오 로그인 응답을 확인할 수 없습니다. 다시 로그인해 주세요.'); }
  }
  async function finishOAuth(req, url) {
    const cfg = configuration(env);
    if (cfg.mode !== 'kakao' || !cfg.configured) throw new HttpError(503, '카카오 로그인 설정이 필요합니다.');
    const state = url.searchParams.get('state'), browser = cookies(req)[loginName()];
    if (!/^[A-Za-z0-9_-]{43}$/.test(state || '') || !/^[A-Za-z0-9_-]{43}$/.test(browser || '')) throw new HttpError(400, '로그인 확인 정보가 만료되었습니다.');
    const attempt = transaction(() => {
      const row = db.prepare('SELECT * FROM oauth_attempts WHERE state_hash=?').get(hash(state));
      if (!row || row.expires_at <= now() || !equal(row.browser_hash, hash(browser))) throw new HttpError(400, '로그인 확인 정보가 만료되었습니다.');
      db.prepare('DELETE FROM oauth_attempts WHERE state_hash=?').run(hash(state)); return row;
    });
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code || code.length > 2048) throw new HttpError(400, '카카오 로그인이 취소되었거나 만료되었습니다.');
    const token = await providerRequest('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: `${cfg.origin}/auth/kakao/callback`, code }).toString() });
    if (typeof token.access_token !== 'string' || !token.access_token || /[\r\n]/.test(token.access_token) || token.access_token.length > 8192) throw new HttpError(502, '카카오 로그인 응답을 확인할 수 없습니다.');
    const profile = await providerRequest('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const id = typeof profile.id === 'number' && Number.isSafeInteger(profile.id) && profile.id > 0 ? String(profile.id) : typeof profile.id === 'string' && /^\d{1,30}$/.test(profile.id) ? profile.id : null;
    if (!id) throw new HttpError(502, '카카오 회원 정보를 확인할 수 없습니다.');
    let account = db.prepare("SELECT * FROM auth_accounts WHERE provider='kakao' AND provider_user_id=?").get(id);
    if (!account) {
      account = { id: randomUUID(), patient_id: null };
      db.prepare("INSERT INTO auth_accounts(id,provider,provider_user_id,created_at) VALUES (?,'kakao',?,?)").run(account.id, id, new Date(now()).toISOString());
    }
    const session = newSession(req, account.id);
    const role = cfg.staffIds.has(id) ? 'clinician' : account.patient_id ? 'patient' : 'pending';
    const location = role === 'pending' ? '/account' : role === 'patient' ? '/patient' : attempt.return_path.startsWith('/clinician') || attempt.return_path.startsWith('/patient') ? attempt.return_path : '/clinician';
    return { location, cookies: [session.cookie, cookie(loginName(), '', 0)] };
  }
  function logout(req) {
    const value = requireActor(req, { write: true, allowPending: true });
    db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(value.sessionHash);
    return cookie(sessionName(), '', 0);
  }
  function issueInvitation(req, patientId) {
    const value = authorize(req, { staff: true, communication: true, write: true });
    if (!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) throw new HttpError(404, '환자를 찾을 수 없습니다.');
    const code = `hci_${secret()}`, expiresAt = now() + 24 * 60 * 60 * 1000;
    transaction(() => {
      db.prepare('DELETE FROM patient_invitations WHERE patient_id=? AND consumed_at IS NULL').run(patientId);
      db.prepare('INSERT INTO patient_invitations(token_hash,patient_id,created_by,expires_at) VALUES (?,?,?,?)').run(hash(code), patientId, value.accountId, expiresAt);
    });
    return { code, patientId, expiresAt: new Date(expiresAt).toISOString() };
  }
  function enroll(req, input) {
    const value = requireActor(req, { write: true, allowPending: true });
    const body = objectBody(input); allowedKeys(body, ['code']);
    const code = textValue(body.code, '초대코드', { min: 1, max: 100 });
    if (value.provider !== 'kakao' || value.role !== 'pending') throw new HttpError(409, '환자 연결 대기 계정에서만 초대코드를 사용할 수 있습니다.');
    return transaction(() => {
      const invitation = db.prepare('SELECT * FROM patient_invitations WHERE token_hash=?').get(hash(code));
      if (!invitation || invitation.consumed_at || invitation.expires_at <= now()) throw new HttpError(400, '초대코드가 유효하지 않거나 만료되었습니다.');
      if (db.prepare("SELECT id FROM auth_accounts WHERE provider='kakao' AND patient_id=?").get(invitation.patient_id)) throw new HttpError(409, '이미 카카오 계정과 연결된 환자입니다. 의료진에게 확인해 주세요.');
      db.prepare('UPDATE auth_accounts SET patient_id=? WHERE id=? AND patient_id IS NULL').run(invitation.patient_id, value.accountId);
      db.prepare('UPDATE patient_invitations SET consumed_at=? WHERE token_hash=?').run(new Date(now()).toISOString(), hash(code));
      return { patientId: invitation.patient_id };
    });
  }
  return { capabilities, actor, sessionInfo, authorize, demoLogin, startOAuth, finishOAuth, logout, issueInvitation, enroll,
    clearLoginCookie: () => cookie(loginName(), '', 0) };
}
