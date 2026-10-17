// Explicit operator diagnostic. No public database is opened or modified.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../lib/db.mjs';
import { analyzePhoto, checkVisionAccess, ensureVisionSchema } from '../lib/vision.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--image')) {
  console.error('Usage: npm run ai:check [-- --image /path/to/meal.jpg]');
  process.exitCode = 2;
} else {
  const access = await checkVisionAccess();
  console.log(JSON.stringify(access));
  if (!access.ok) {
    console.error('Render 또는 실행 서버의 HOMECARE_VISION_API_KEY / VISION_ENABLED=true / VISION_MODEL을 확인하세요. 비밀값을 로그나 채팅에 보내지 마세요.');
    process.exitCode = 1;
  } else if (args.length) {
    let directory, db;
    try {
      const path = args[1], type = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[extname(path).toLowerCase()];
      if (!type) throw new Error('unsupported');
      const bytes = await readFile(path);
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('too_large');
      directory = await mkdtemp(join(tmpdir(), 'homecare-live-vision-'));
      ({ db } = openDatabase(directory));
      ensureVisionSchema(db);
      db.prepare("INSERT INTO patients(id,name,age,sex,created_at) VALUES ('vision-operator-check','가상 사진 검증',75,'other',?)").run(new Date().toISOString());
      const { analysis } = await analyzePhoto({ db, patientId: 'vision-operator-check', body: { kind: 'meal', imageData: `data:image/${type};base64,${bytes.toString('base64')}`, consentExternalProcessing: true } });
      console.log(JSON.stringify({ ok: true, stage: 'image_inference', model: analysis.model, calories: analysis.proposal.calories, proteinGrams: analysis.proposal.proteinGrams, foodCount: analysis.proposal.foods.length, imageInferenceVerified: true, clinicalAccuracyVerified: false }));
    } catch {
      console.error('사진 추론 검증 실패: 지원 사진/용량, 제공자 설정·한도와 네트워크를 확인하세요. 원문 오류는 출력하지 않았습니다.');
      process.exitCode = 1;
    } finally { db?.close(); if (directory) await rm(directory, { recursive: true, force: true }); }
  }
}
