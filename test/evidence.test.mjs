import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createEvidenceService, ensureEvidenceSchema } from '../lib/evidence.mjs';

const clinician = { accountId: 'clinical-1', role: 'clinician', capabilities: ['evidence.read', 'evidence.review'] };
const support = { accountId: 'support-1', role: 'clinician', capabilities: ['evidence.read'] };
const administrator = { accountId: 'admin-1', role: 'clinician', capabilities: ['admin.reset'] };
const input = { query: 'older adults medication adherence', confirmNoPersonalData: true };
const status = expected => error => error.status === expected;
const article = (overrides = {}) => ({ id: '12345678', source: 'MED', pmid: '12345678', doi: '10.1234/HomeCare.Test',
  title: 'A synthetic older-adult usability study <img onerror=bad()>', authorString: 'Kim A, Lee B', pubYear: '2025',
  journalInfo: { journal: { title: 'Synthetic Study Journal' } }, abstractText: 'This entirely fictional abstract describes a usability test.',
  pubTypeList: { pubType: ['Journal Article'] }, ...overrides });
const payload = (results = [article()], overrides = {}) => ({ hitCount: results.length, resultList: { result: results }, ...overrides });

function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE auth_accounts(id TEXT PRIMARY KEY)');
  for (const actor of [clinician, support, administrator]) db.prepare('INSERT INTO auth_accounts VALUES(?)').run(actor.accountId);
  let clock = Date.parse('2026-10-23T05:00:00Z');
  const calls = [];
  const fetchImpl = options.fetchImpl || (async (url, request) => { calls.push({ url, request }); return Response.json(payload()); });
  const service = createEvidenceService({ db, fetchImpl, now: () => clock, ...options });
  t.after(() => db.close());
  return { db, service, calls, tick: milliseconds => { clock += milliseconds; } };
}

test('Evidence provider uses a fixed HTTPS endpoint, encoded query and bounded core page, with explicit source metadata', async t => {
  const { service, calls } = fixture(t);
  const result = await service.search(clinician, { ...input, yearFrom: 2020, yearTo: 2026 });
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://www.ebi.ac.uk');
  assert.equal(url.pathname, '/europepmc/webservices/rest/search');
  assert.equal(url.searchParams.get('query'), '(older adults medication adherence) AND FIRST_PDATE:[2020-01-01 TO 2026-12-31]');
  assert.equal(url.searchParams.get('resultType'), 'core');
  assert.equal(url.searchParams.get('pageSize'), '20');
  assert.equal(calls[0].request.redirect, 'error');
  assert.ok(calls[0].request.signal instanceof AbortSignal);
  assert.equal(result.results[0].doi, '10.1234/homecare.test');
  assert.equal(result.results[0].articleKey, 'doi:10.1234/homecare.test');
  assert.equal(result.results[0].retractionStatus, 'unknown');
  assert.equal(result.results[0].availableContent, 'abstract');
  assert.equal(result.results[0].sourceUrl, 'https://europepmc.org/article/MED/12345678');
  assert.equal(result.results[0].pubmedUrl, 'https://pubmed.ncbi.nlm.nih.gov/12345678/');
});

test('Search requires explicit capability, no-personal-data confirmation and bounded known inputs before any request', async t => {
  const { service, calls } = fixture(t);
  for (const actor of [null, { accountId: 'clinical-1', role: 'clinician' }, administrator, { accountId: 'clinical-1', capabilities: ['patient.read'] }]) {
    await assert.rejects(service.search(actor, input), status(403));
  }
  for (const body of [
    { query: input.query }, { ...input, confirmNoPersonalData: false }, { ...input, query: 'x' },
    { ...input, query: 'x'.repeat(501) }, { ...input, query: 'query\nnewline' },
    { ...input, query: 'person@example.org health' }, { ...input, query: '010-1234-5678 기록' },
    { ...input, yearFrom: 2027, yearTo: 2020 }, { ...input, yearFrom: '2020' },
    { ...input, cursorMark: 'bad\nrequest' }, { ...input, url: 'https://private.invalid' },
  ]) await assert.rejects(service.search(clinician, body), status(400));
  assert.equal(calls.length, 0);
});

test('Successful zero results are persisted as zero, while provider errors are never synthetic results', async t => {
  const { service, db } = fixture(t, { fetchImpl: async () => Response.json(payload([])) });
  const result = await service.search(clinician, input);
  assert.deepEqual(result.results, []); assert.equal(result.totalCount, 0); assert.equal(result.nextCursor, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_searches').get().n, 1);
  assert.equal(service.list(clinician).searches[0].totalCount, 0);
});

test('Cache and saved search retrieval preserve original time; filters and cursor have independent keys', async t => {
  const { service, db, calls, tick } = fixture(t);
  const first = await service.search(clinician, input);
  tick(60000);
  const cached = await service.search(support, input);
  assert.equal(cached.cached, true); assert.equal(cached.id, first.id); assert.equal(cached.searchedAt, first.searchedAt);
  const stored = service.getSearch(clinician, first.id);
  assert.equal(stored.savedSnapshot, true); assert.equal(stored.searchedAt, first.searchedAt); assert.equal(calls.length, 1);
  await service.search(clinician, { ...input, yearFrom: 2024 });
  await service.search(clinician, { ...input, cursorMark: 'next-token==' });
  assert.equal(calls.length, 3);
  tick(600001); await service.search(clinician, input); assert.equal(calls.length, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_searches').get().n, 4);
  assert.throws(() => service.getSearch(clinician, 'missing'), status(404));
});

test('Pagination retains provider cursor, deduplicates source records by DOI and never trusts arbitrary source URLs', async t => {
  const { service } = fixture(t, { fetchImpl: async () => Response.json(payload([
    article(), article({ id: 'PMC1234', source: 'PMC' }),
    article({ id: '12345/../../evil', title: 'Bad id', doi: 'javascript:bad' }),
    article({ id: '99887766', pmid: '99887766', doi: 'bad doi', sourceUrl: 'javascript:alert(1)', abstractText: '' }),
  ], { hitCount: 70, nextCursorMark: 'next123=' })) });
  const result = await service.search(clinician, input);
  assert.equal(result.totalCount, 70); assert.equal(result.results.length, 2); assert.equal(result.nextCursor, 'next123=');
  assert.equal(result.results[1].availableContent, 'metadata'); assert.equal(result.results[1].doi, null);
  assert.equal(result.results[1].sourceUrl, 'https://europepmc.org/article/MED/99887766');
  assert.equal(JSON.stringify(result).includes('javascript:'), false);
});

test('Retraction is true only on explicit source marker; absence never becomes not-retracted', async t => {
  const { service } = fixture(t, { fetchImpl: async () => Response.json(payload([
    article({ isRetracted: true }),
    article({ id: '2', pmid: '2', doi: null, isRetracted: 'N' }),
    article({ id: '3', pmid: '3', doi: null, pubTypeList: { pubType: ['Retracted Publication'] } }),
  ])) });
  const result = await service.search(clinician, input);
  assert.deepEqual(result.results.map(a => a.retractionStatus), ['retracted', 'unknown', 'retracted']);
});

test('Provider HTTP and malformed-body errors keep exception details out and store no failed search', async t => {
  for (const [responseFactory, code] of [
    [() => new Response('quota private-details', { status: 429 }), 503],
    [() => new Response('upstream private-details', { status: 500 }), 502],
    [() => new Response('not-json private-details', { status: 200 }), 502],
    [() => Response.json({ hitCount: 0 }), 502],
    [() => Response.json(payload([{ id: 'bad/id', source: 'MED', title: 'x' }])), 502],
    [() => { throw Error('private-details'); }, 502],
  ]) {
    const { service, db } = fixture(t, { fetchImpl: async () => responseFactory() });
    await assert.rejects(service.search(clinician, input), error => error.status === code && !error.message.includes('private-details'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_searches').get().n, 0);
  }
});

test('Response size is bounded with and without content-length', async t => {
  for (const withHeader of [true, false]) {
    const { service, db } = fixture(t, { fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1), withHeader ? { headers: { 'content-length': String(1024 * 1024 + 1) } } : {}) });
    await assert.rejects(service.search(clinician, input), status(502));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_searches').get().n, 0);
  }
});

test('Provider timeout aborts the request and cannot save a late result', async t => {
  let requestSignal;
  const { service, db } = fixture(t, { timeoutMs: 15, fetchImpl: async (_url, options) => { requestSignal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(service.search(clinician, input), status(504));
  assert.equal(requestSignal.aborted, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_searches').get().n, 0);
});

test('Bookmarks only use stored provider snapshots, deduplicate retries and keep metadata immutable', async t => {
  const { service, db } = fixture(t);
  const result = await service.search(clinician, input), selection = { searchId: result.id, articleKey: result.results[0].articleKey };
  assert.throws(() => service.createBookmark(clinician, { ...selection, article: article({ title: 'forged' }) }), status(400));
  assert.throws(() => service.createBookmark(clinician, { ...selection, articleKey: 'doi:10.0000/invented' }), status(400));
  const first = service.createBookmark(support, selection), duplicate = service.createBookmark(clinician, selection);
  assert.equal(first.duplicate, false); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.bookmark.id, first.bookmark.id);
  assert.equal(first.bookmark.article.title, result.results[0].title);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_reviews').get().n, 1);
  assert.equal(service.list(support).permissions.canReview, false);
  assert.throws(() => service.list(administrator), status(403));
});

test('Evidence review requires source range, reasons, explicit permission and optimistic versions with preserved history', async t => {
  const { service, db } = fixture(t);
  const result = await service.search(clinician, input);
  const initial = service.createBookmark(clinician, { searchId: result.id, articleKey: result.results[0].articleKey }).bookmark;
  const review = { version: 1, status: 'reviewed', note: '합성 과제 검토', evidenceText: 'fictional abstract', locator: '초록', reviewBasis: 'abstract' };
  assert.throws(() => service.updateBookmark(support, initial.id, review), status(403));
  assert.throws(() => service.updateBookmark(clinician, initial.id, { ...review, locator: '' }), status(400));
  assert.throws(() => service.updateBookmark(support, initial.id, { version: 1, status: 'excluded', note: '' }), status(400));
  const reviewed = service.updateBookmark(clinician, initial.id, review).bookmark;
  assert.equal(reviewed.version, 2); assert.equal(reviewed.status, 'reviewed');
  assert.throws(() => service.updateBookmark(clinician, initial.id, review), status(409));
  assert.throws(() => service.updateBookmark(support, initial.id, { ...review, version: 2, status: 'saved' }), status(403));
  const duplicate = service.updateBookmark(clinician, initial.id, { ...review, version: 2 });
  assert.equal(duplicate.unchanged, true); assert.equal(duplicate.bookmark.version, 2);
  const history = db.prepare('SELECT * FROM evidence_reviews WHERE bookmark_id=? ORDER BY version').all(initial.id);
  assert.equal(history.length, 2); assert.equal(JSON.parse(history[0].snapshot_json).status, 'saved');
  assert.equal(JSON.parse(history[1].snapshot_json).article.title, initial.article.title);
});

test('Missing abstracts cannot be reviewed as if an abstract was retrieved, while explicit external reading is distinguished', async t => {
  const { service } = fixture(t, { fetchImpl: async () => Response.json(payload([article({ abstractText: '' })])) });
  const result = await service.search(clinician, input);
  const initial = service.createBookmark(clinician, { searchId: result.id, articleKey: result.results[0].articleKey }).bookmark;
  const inputReview = { version: 1, status: 'reviewed', note: '별도 확인', evidenceText: '직접 읽은 가상 근거', locator: '별도 원문 3쪽', reviewBasis: 'abstract' };
  assert.throws(() => service.updateBookmark(clinician, initial.id, inputReview), status(400));
  const reviewed = service.updateBookmark(clinician, initial.id, { ...inputReview, reviewBasis: 'external-fulltext' }).bookmark;
  assert.equal(reviewed.reviewBasis, 'external-fulltext');
  assert.equal(reviewed.article.availableContent, 'metadata');
});

test('Evidence schema rerun preserves existing searches, bookmark versions and review history', async t => {
  const { service, db } = fixture(t);
  const result = await service.search(clinician, input);
  const initial = service.createBookmark(clinician, { searchId: result.id, articleKey: result.results[0].articleKey }).bookmark;
  ensureEvidenceSchema(db); ensureEvidenceSchema(db);
  assert.equal(service.getSearch(clinician, result.id).results[0].articleKey, initial.articleKey);
  assert.equal(service.list(clinician).bookmarks[0].version, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evidence_reviews').get().n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
