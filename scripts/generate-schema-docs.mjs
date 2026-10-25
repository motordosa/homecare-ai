import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../lib/db.mjs';
import { ensureMedicationSchema } from '../lib/medications.mjs';
import { ensureVisionSchema } from '../lib/vision.mjs';
import { ensureMedicationPhotoSchema } from '../lib/medication-photos.mjs';
import { ensureHealthSchema } from '../lib/health-sync.mjs';

import { ensureAuthSchema } from '../lib/auth.mjs';
import { ensureCommunicationSchema } from '../lib/communications.mjs';
import { ensureMealSchema } from '../lib/meals.mjs';
import { ensureWorkflowSchema } from '../lib/workflow.mjs';
import { ensureResearchSchema } from '../lib/research.mjs';
import { ensureEvidenceSchema } from '../lib/evidence.mjs';
import { ensureVoiceGuidanceSchema } from '../lib/voice-guidance.mjs';

const output = new URL('../docs/generated/SCHEMA.md', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'homecare-schema-doc-'));
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
let db;
try {
  ({ db } = openDatabase(temp));
  ensureMedicationSchema(db);
  ensureVisionSchema(db);
  ensureMealSchema(db);
  ensureMedicationPhotoSchema(db);
  ensureHealthSchema(db);
  ensureAuthSchema(db);
  ensureCommunicationSchema(db);
  ensureWorkflowSchema(db);
  ensureResearchSchema(db);
  ensureEvidenceSchema(db);
  ensureVoiceGuidanceSchema(db);
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const sections = tables.map(table => {
    const columns = db.prepare(`PRAGMA table_info("${table.name}")`).all();
    const keys = db.prepare(`PRAGMA foreign_key_list("${table.name}")`).all();
    return `## ${table.name}\n\n| 컬럼 | SQL형 | NOT NULL | 기본값 | PK |\n|---|---|---|---|---|\n${columns.map(column => `| ${escape(column.name)} | ${escape(column.type)} | ${column.notnull ? 'yes' : 'no'} | ${escape(column.dflt_value)} | ${column.pk || ''} |`).join('\n')}\n\n${keys.length ? '외래키: ' + keys.map(key => `${key.from} → ${key.table}.${key.to} (DELETE ${key.on_delete})`).join('; ') + '\n\n' : ''}\`\`\`sql\n${table.sql}\n\`\`\`\n`;
  });
  const document = `# DB 스키마 기준\n\n자동 생성: 임시 SQLite에 현재 추가 마이그레이션을 적용한 결과다. 사용자/공개 DB에 접근하지 않으며 행 값·토큰·사진을 저장하지 않는다. 의미와 단위는 [자료 사전](../DATA_DICTIONARY.md)과 [계약](../CONTRACTS.md)을 함께 읽는다.\n\n${tables.length} tables. 생성: \`npm run docs:variables\`, 최신 검사: \`npm run docs:check\`.\n\n${sections.join('\n')}`;
  if (process.argv.includes('--check')) {
    let existing = '';
    try { existing = await readFile(output, 'utf8'); } catch {}
    if (existing !== document) { console.error('Schema documentation is stale. Update the contracts then run npm run docs:variables.'); process.exitCode = 1; }
    else console.log(`Schema documentation matches ${tables.length} tables.`);
  } else {
    await mkdir(new URL('../docs/generated/', import.meta.url), { recursive: true });
    await writeFile(output, document);
    console.log(`Generated docs/generated/SCHEMA.md: ${tables.length} tables.`);
  }
} finally { if (db) db.close(); await rm(temp, { recursive: true, force: true }); }
