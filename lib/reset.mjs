import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, seedDatabase } from './db.mjs';

export function removeOwnedUploads(uploadDir) {
  for (const filename of readdirSync(uploadDir)) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(filename)) {
      try { unlinkSync(join(uploadDir, filename)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

export function resetDemo(db, uploadDir, mode) {
  seedDatabase(db, mode);
  removeOwnedUploads(uploadDir);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv.includes('--empty') ? 'empty' : 'seed';
  if (!process.argv.includes('--confirm=RESET')) {
    console.error('리셋에는 --confirm=RESET이 필요합니다. 예: node lib/reset.mjs --empty --confirm=RESET');
    process.exit(1);
  }
  const { db, uploadDir } = openDatabase(process.env.DATA_DIR || new URL('../data', import.meta.url).pathname);
  resetDemo(db, uploadDir, mode);
  console.log(mode === 'empty' ? '데모 DB와 업로드를 비웠습니다. 스키마는 유지됩니다.' : '합성 데모 데이터로 리셋했습니다.');
  db.close();
}
