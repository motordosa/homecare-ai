import { createHash, randomUUID } from 'node:crypto';
import { HttpError, allowedKeys, choice, numberValue, objectBody, textValue } from './validation.mjs';

const PROVIDER = 'Europe PMC';
const SEARCH_ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const PAGE_SIZE = 20;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const permissions = actor => ({ canReview: actor?.capabilities?.includes('evidence.review') === true });

export function ensureEvidenceSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS evidence_searches (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES auth_accounts(id),
    query TEXT NOT NULL, query_signature TEXT NOT NULL, parameters_json TEXT NOT NULL,
    provider TEXT NOT NULL, searched_at TEXT NOT NULL, result_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS evidence_search_cache ON evidence_searches(query_signature,searched_at);
  CREATE TABLE IF NOT EXISTS evidence_bookmarks (
    id TEXT PRIMARY KEY, article_key TEXT NOT NULL UNIQUE, article_json TEXT NOT NULL,
    search_id TEXT NOT NULL REFERENCES evidence_searches(id),
    review_status TEXT NOT NULL CHECK(review_status IN ('saved','included','excluded','reviewed')),
    note TEXT NOT NULL DEFAULT '', evidence_text TEXT NOT NULL DEFAULT '', locator TEXT NOT NULL DEFAULT '',
    review_basis TEXT NOT NULL DEFAULT 'metadata' CHECK(review_basis IN ('metadata','abstract','external-fulltext')),
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL REFERENCES auth_accounts(id), updated_by TEXT NOT NULL REFERENCES auth_accounts(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evidence_reviews (
    bookmark_id TEXT NOT NULL REFERENCES evidence_bookmarks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES auth_accounts(id),
    snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(bookmark_id,version)
  );`);
}

function requirePermission(actor, capability = 'evidence.read') {
  if (!actor?.accountId || !Array.isArray(actor.capabilities) || !actor.capabilities.includes(capability)) {
    throw new HttpError(403, capability === 'evidence.review' ? '문헌 검토 완료 권한이 필요합니다.' : '문헌 검색·보관 권한이 필요합니다.');
  }
}

const clean = (value, max = 1000) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
const numericId = value => typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
const doiValue = value => typeof value === 'string' && /^10\.\d{4,9}\/[^\s<>"'\u0000]{1,200}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;

function normalizeArticle(row, searchedAt) {
  if (!row || typeof row !== 'object') return null;
  const source = identifier(row.source), sourceId = identifier(row.id);
  const title = clean(row.title, 1500);
  if (!source || !sourceId || !title) return null;
  const pmid = numericId(row.pmid) || (source === 'MED' ? numericId(sourceId) : null);
  const doi = doiValue(row.doi);
  const publicationTypes = (Array.isArray(row.pubTypeList?.pubType) ? row.pubTypeList.pubType : []).filter(x => typeof x === 'string').slice(0, 20).map(x => clean(x, 120));
  const retracted = row.isRetracted === true || row.isRetracted === 'Y' || publicationTypes.some(type => type.toLowerCase() === 'retracted publication');
  // A missing retraction marker does not establish that a paper is current or valid.
  const retractionStatus = retracted ? 'retracted' : 'unknown';
  const abstractText = clean(row.abstractText, 8000);
  const yearText = String(row.pubYear || row.journalInfo?.yearOfPublication || '');
  return {
    articleKey: doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : `${source}:${sourceId}`,
    provider: PROVIDER, source, sourceId, pmid, doi, title,
    authors: clean(row.authorString, 1500), journal: clean(row.journalTitle || row.journalInfo?.journal?.title, 500),
    year: /^\d{4}$/.test(yearText) ? Number(yearText) : null,
    publicationTypes, abstractText, availableContent: abstractText ? 'abstract' : 'metadata',
    abstractTruncated: typeof row.abstractText === 'string' && row.abstractText.length > 8000,
    sourceUrl: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`,
    pubmedUrl: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null,
    doiUrl: doi ? `https://doi.org/${encodeURIComponent(doi).replaceAll('%2F', '/')}` : null,
    retractionStatus, checkedAt: searchedAt,
  };
}

function searchInput(input) {
  const body = objectBody(input);
  allowedKeys(body, ['query', 'yearFrom', 'yearTo', 'cursorMark', 'confirmNoPersonalData']);
  const query = textValue(body.query, '연구 주제 또는 검색식', { min: 2, max: 500 });
  if (/[\u0000-\u001f\u007f]/.test(query)) throw new HttpError(400, '검색식에 제어 문자를 사용할 수 없습니다.');
  if (body.confirmNoPersonalData !== true) throw new HttpError(400, '검색어에 환자 개인정보가 없는지 확인해 주세요.');
  // This catches obvious identifiers; the user must still review the query.
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(query) || /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/.test(query)) {
    throw new HttpError(400, '이메일·휴대전화 번호 대신 일반적인 연구 주제를 입력해 주세요.');
  }
  const yearFrom = body.yearFrom === undefined || body.yearFrom === null ? null : numberValue(body.yearFrom, '시작 연도', 1800, 2200, true);
  const yearTo = body.yearTo === undefined || body.yearTo === null ? null : numberValue(body.yearTo, '종료 연도', 1800, 2200, true);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new HttpError(400, '시작 연도는 종료 연도보다 늦을 수 없습니다.');
  const cursorMark = body.cursorMark === undefined ? '*' : textValue(body.cursorMark, '다음 검색 위치', { min: 1, max: 512 });
  if (/[\u0000-\u001f\u007f]/.test(cursorMark)) throw new HttpError(400, '다음 검색 위치를 확인해 주세요.');
  const executedQuery = yearFrom !== null || yearTo !== null ? `(${query}) AND FIRST_PDATE:[${yearFrom ?? 1800}-01-01 TO ${yearTo ?? 2200}-12-31]` : query;
  return { query, yearFrom, yearTo, cursorMark, executedQuery };
}

async function boundedJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) throw new HttpError(502, '문헌 제공자의 응답이 너무 큽니다. 검색 범위를 줄여 주세요.');
  let size = 0;
  const chunks = [];
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new HttpError(502, '문헌 제공자의 응답이 너무 큽니다. 검색 범위를 줄여 주세요.');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else {
    const value = await response.text();
    if (Buffer.byteLength(value) > MAX_RESPONSE_BYTES) throw new HttpError(502, '문헌 제공자의 응답이 너무 큽니다. 검색 범위를 줄여 주세요.');
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(502, '문헌 제공자의 응답 형식을 확인할 수 없습니다. 다시 검색해 주세요.'); }
}

function bookmarkRow(row) {
  if (!row) return null;
  return { id: row.id, articleKey: row.article_key, article: JSON.parse(row.article_json), searchId: row.search_id,
    status: row.review_status, note: row.note, evidenceText: row.evidence_text, locator: row.locator, reviewBasis: row.review_basis,
    version: row.version, createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createEvidenceService({ db, fetchImpl = fetch, now = Date.now, timeoutMs = 12000 }) {
  ensureEvidenceSchema(db);
  const atomic = operation => {
    db.exec('SAVEPOINT evidence_operation');
    try { const result = operation(); db.exec('RELEASE evidence_operation'); return result; }
    catch (error) { db.exec('ROLLBACK TO evidence_operation; RELEASE evidence_operation'); throw error; }
  };
  const getSearch = (actor, id) => {
    requirePermission(actor);
    const row = db.prepare('SELECT result_json FROM evidence_searches WHERE id=?').get(textValue(id, '검색 ID', { min: 1, max: 80 }));
    if (!row) throw new HttpError(404, '저장한 검색을 찾을 수 없습니다.');
    return { ...JSON.parse(row.result_json), cached: false, savedSnapshot: true };
  };
  const snapshotReview = (id, actor) => {
    const bookmark = bookmarkRow(db.prepare('SELECT * FROM evidence_bookmarks WHERE id=?').get(id));
    db.prepare('INSERT INTO evidence_reviews(bookmark_id,version,actor_id,snapshot_json,created_at) VALUES (?,?,?,?,?)')
      .run(id, bookmark.version, actor.accountId, JSON.stringify(bookmark), bookmark.updatedAt);
    return bookmark;
  };
  async function search(actor, input) {
    requirePermission(actor);
    const parameters = searchInput(input);
    const signature = digest(JSON.stringify({ version: 1, provider: PROVIDER, ...parameters }));
    const cached = db.prepare('SELECT result_json FROM evidence_searches WHERE query_signature=? AND searched_at>=? ORDER BY searched_at DESC,id DESC LIMIT 1')
      .get(signature, new Date(now() - CACHE_MS).toISOString());
    if (cached) return { ...JSON.parse(cached.result_json), cached: true };
    const url = new URL(SEARCH_ENDPOINT);
    url.search = new URLSearchParams({ query: parameters.executedQuery, format: 'json', resultType: 'core', pageSize: String(PAGE_SIZE), cursorMark: parameters.cursorMark }).toString();
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new HttpError(504, '문헌 검색 응답이 늦습니다. 입력한 검색어를 유지했으니 다시 시도해 주세요.')); }, timeoutMs); });
    let body;
    try {
      body = await Promise.race([timeout, (async () => {
        const response = await fetchImpl(url.href, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
        if (response.status === 429) throw new HttpError(503, '문헌 제공자의 요청 한도에 도달했습니다. 잠시 후 다시 검색해 주세요.');
        if (!response.ok) throw new HttpError(502, '문헌 검색 서비스에 연결하지 못했습니다. 검색어를 유지했으니 다시 시도해 주세요.');
        return boundedJson(response);
      })()]);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, '문헌 검색 서비스에 연결하지 못했습니다. 검색어를 유지했으니 다시 시도해 주세요.');
    } finally { clearTimeout(timer); }
    if (!body || typeof body !== 'object' || !Number.isSafeInteger(body.hitCount) || body.hitCount < 0 || !Array.isArray(body.resultList?.result)) {
      throw new HttpError(502, '문헌 제공자의 결과 형식이 올바르지 않습니다. 다시 검색해 주세요.');
    }
    const searchedAt = new Date(now()).toISOString();
    const unique = new Map();
    for (const item of body.resultList.result.slice(0, PAGE_SIZE)) {
      const article = normalizeArticle(item, searchedAt);
      if (article && !unique.has(article.articleKey)) unique.set(article.articleKey, article);
    }
    const results = [...unique.values()];
    if (body.resultList.result.length && !results.length) throw new HttpError(502, '문헌 식별자를 확인할 수 없어 결과를 저장하지 않았습니다.');
    const next = typeof body.nextCursorMark === 'string' && body.nextCursorMark.length <= 512 && !/[\u0000-\u001f\u007f]/.test(body.nextCursorMark) ? body.nextCursorMark : null;
    const result = { id: randomUUID(), provider: PROVIDER, query: parameters.query, executedQuery: parameters.executedQuery,
      parameters: { yearFrom: parameters.yearFrom, yearTo: parameters.yearTo, cursorMark: parameters.cursorMark }, searchedAt,
      totalCount: body.hitCount, results, nextCursor: results.length && next && next !== parameters.cursorMark ? next : null,
      pageSize: PAGE_SIZE, cached: false, savedSnapshot: false };
    db.prepare('INSERT INTO evidence_searches(id,actor_id,query,query_signature,parameters_json,provider,searched_at,result_json) VALUES (?,?,?,?,?,?,?,?)')
      .run(result.id, actor.accountId, result.query, signature, JSON.stringify(parameters), PROVIDER, searchedAt, JSON.stringify(result));
    return result;
  }
  function list(actor) {
    requirePermission(actor);
    const searches = db.prepare('SELECT id,query,parameters_json,provider,searched_at,result_json FROM evidence_searches ORDER BY searched_at DESC,id DESC LIMIT 20').all().map(row => {
      const result = JSON.parse(row.result_json);
      return { id: row.id, query: row.query, parameters: result.parameters, provider: row.provider, searchedAt: row.searched_at, totalCount: result.totalCount };
    });
    const bookmarks = db.prepare('SELECT * FROM evidence_bookmarks ORDER BY updated_at DESC,id DESC LIMIT 100').all().map(bookmarkRow);
    return { searches, bookmarks, limits: { searches: 20, bookmarks: 100 }, permissions: permissions(actor) };
  }
  function createBookmark(actor, input) {
    requirePermission(actor);
    const body = objectBody(input); allowedKeys(body, ['searchId', 'articleKey']);
    const articleKey = textValue(body.articleKey, '문헌 식별자', { min: 1, max: 250 });
    const searchResult = getSearch(actor, body.searchId);
    const article = searchResult.results.find(item => item.articleKey === articleKey);
    if (!article) throw new HttpError(400, '저장된 검색 결과에 있는 문헌을 선택해 주세요.');
    return atomic(() => {
      const existing = db.prepare('SELECT * FROM evidence_bookmarks WHERE article_key=?').get(articleKey);
      if (existing) return { bookmark: bookmarkRow(existing), duplicate: true };
      const id = randomUUID(), timestamp = new Date(now()).toISOString();
      db.prepare("INSERT INTO evidence_bookmarks(id,article_key,article_json,search_id,review_status,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,'saved',?,?,?,?)")
        .run(id, articleKey, JSON.stringify(article), searchResult.id, actor.accountId, actor.accountId, timestamp, timestamp);
      return { bookmark: snapshotReview(id, actor), duplicate: false };
    });
  }
  function updateBookmark(actor, id, input) {
    requirePermission(actor);
    textValue(id, '보관 문헌 ID', { min: 1, max: 80 });
    const body = objectBody(input);
    allowedKeys(body, ['version', 'status', 'note', 'evidenceText', 'locator', 'reviewBasis']);
    const version = numberValue(body.version, '검토 버전', 1, Number.MAX_SAFE_INTEGER, true);
    const status = choice(body.status, '검토 상태', ['saved', 'included', 'excluded', 'reviewed']);
    const note = textValue(body.note ?? '', '검토 메모', { max: 2000 });
    const evidenceText = textValue(body.evidenceText ?? '', '근거 구절', { max: 4000 });
    const locator = textValue(body.locator ?? '', '근거 위치', { max: 500 });
    const reviewBasis = choice(body.reviewBasis ?? 'metadata', '검토한 자료 범위', ['metadata', 'abstract', 'external-fulltext']);
    return atomic(() => {
      const old = db.prepare('SELECT * FROM evidence_bookmarks WHERE id=?').get(id);
      if (!old) throw new HttpError(404, '보관한 문헌을 찾을 수 없습니다.');
      if (old.review_status === 'reviewed' || status === 'reviewed') requirePermission(actor, 'evidence.review');
      if (old.version !== version) throw new HttpError(409, '다른 화면에서 검토 내용이 바뀌었습니다. 입력을 보존한 뒤 최신 문헌을 다시 열어 주세요.');
      if (status === 'excluded' && !note) throw new HttpError(400, '제외한 이유를 검토 메모에 남겨 주세요.');
      if (status === 'reviewed' && (!note || !evidenceText || !locator)) throw new HttpError(400, '검토 완료에는 검토 메모·근거 구절·근거 위치가 필요합니다.');
      if (reviewBasis === 'abstract' && !JSON.parse(old.article_json).abstractText) throw new HttpError(400, '이 문헌에는 확인된 초록이 없습니다. 실제 확인한 자료 범위를 선택해 주세요.');
      const unchanged = old.review_status === status && old.note === note && old.evidence_text === evidenceText && old.locator === locator && old.review_basis === reviewBasis;
      if (unchanged) return { bookmark: bookmarkRow(old), unchanged: true };
      db.prepare('UPDATE evidence_bookmarks SET review_status=?,note=?,evidence_text=?,locator=?,review_basis=?,version=version+1,updated_by=?,updated_at=? WHERE id=?')
        .run(status, note, evidenceText, locator, reviewBasis, actor.accountId, new Date(now()).toISOString(), id);
      return { bookmark: snapshotReview(id, actor), unchanged: false };
    });
  }
  return { search, list, getSearch, createBookmark, updateBookmark };
}
